/// <reference types="google.maps" />
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Pencil, Ban, Trash2, RefreshCw, Save, Compass } from "lucide-react";
import { loadDrawing } from "@/lib/gmaps";
import {
  DEFAULT_PANEL,
  layoutPanels,
  polyAreaM2,
  totalKW,
  type LatLng,
  type PanelSpec,
  type PanelRect,
} from "@/lib/roof-planner";

export type RoofPlan = {
  roof: LatLng[];
  cutouts: LatLng[][];
  panels: PanelRect[];
  disabled: string[]; // panel ids the user removed
  spec: PanelSpec;
  center: LatLng;
};

export function RoofPlanner({
  open,
  onOpenChange,
  center,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  center: LatLng;
  initial: RoofPlan | null;
  onSave: (plan: RoofPlan) => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const drawerRef = useRef<google.maps.drawing.DrawingManager | null>(null);
  const roofPolyRef = useRef<google.maps.Polygon | null>(null);
  const cutoutPolysRef = useRef<google.maps.Polygon[]>([]);
  const panelPolysRef = useRef<Map<string, google.maps.Polygon>>(new Map());
  const listenersRef = useRef<google.maps.MapsEventListener[]>([]);

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"idle" | "roof" | "cutout">("idle");
  const [hasRoof, setHasRoof] = useState(false);
  const [spec, setSpec] = useState<PanelSpec>(initial?.spec ?? DEFAULT_PANEL);
  const [disabled, setDisabled] = useState<Set<string>>(new Set(initial?.disabled ?? []));
  const [panels, setPanels] = useState<PanelRect[]>(initial?.panels ?? []);
  const [autoFit, setAutoFit] = useState(true);

  // Init map.
  useEffect(() => {
    if (!open || !mapEl.current) return;
    let cancelled = false;
    (async () => {
      const { maps } = await loadDrawing();
      if (cancelled || !mapEl.current) return;
      const map = new maps.Map(mapEl.current, {
        center,
        zoom: 20,
        mapTypeId: "satellite",
        tilt: 0,
        rotateControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        gestureHandling: "greedy",
        clickableIcons: false,
      });
      mapRef.current = map;

      const dm = new google.maps.drawing.DrawingManager({
        drawingMode: null,
        drawingControl: false,
        polygonOptions: {
          fillColor: "#22c55e",
          fillOpacity: 0.15,
          strokeColor: "#16a34a",
          strokeWeight: 2,
          clickable: true,
          editable: true,
          draggable: false,
          zIndex: 2,
        },
      });
      dm.setMap(map);
      drawerRef.current = dm;

      google.maps.event.addListener(dm, "polygoncomplete", (poly: google.maps.Polygon) => {
        dm.setDrawingMode(null);
        if (mode === "cutout") {
          poly.setOptions({ fillColor: "#ef4444", strokeColor: "#dc2626", fillOpacity: 0.25 });
          cutoutPolysRef.current.push(poly);
          // edits → re-layout
          attachPolyListeners(poly, "cutout");
        } else {
          // replace existing roof
          if (roofPolyRef.current) roofPolyRef.current.setMap(null);
          roofPolyRef.current = poly;
          attachPolyListeners(poly, "roof");
          setHasRoof(true);
        }
        setMode("idle");
        scheduleRelayout();
      });

      // Restore initial geometry if any.
      if (initial?.roof?.length) {
        const rp = new google.maps.Polygon({
          paths: initial.roof,
          fillColor: "#22c55e",
          fillOpacity: 0.15,
          strokeColor: "#16a34a",
          strokeWeight: 2,
          editable: true,
          map,
          zIndex: 2,
        });
        roofPolyRef.current = rp;
        attachPolyListeners(rp, "roof");
        setHasRoof(true);
        for (const c of initial.cutouts ?? []) {
          const cp = new google.maps.Polygon({
            paths: c,
            fillColor: "#ef4444",
            fillOpacity: 0.25,
            strokeColor: "#dc2626",
            strokeWeight: 2,
            editable: true,
            map,
            zIndex: 2,
          });
          cutoutPolysRef.current.push(cp);
          attachPolyListeners(cp, "cutout");
        }
        const bounds = new google.maps.LatLngBounds();
        initial.roof.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 60);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function cleanup() {
    listenersRef.current.forEach((l) => l.remove());
    listenersRef.current = [];
    roofPolyRef.current?.setMap(null);
    roofPolyRef.current = null;
    cutoutPolysRef.current.forEach((p) => p.setMap(null));
    cutoutPolysRef.current = [];
    panelPolysRef.current.forEach((p) => p.setMap(null));
    panelPolysRef.current.clear();
    drawerRef.current?.setMap(null);
    drawerRef.current = null;
    mapRef.current = null;
    setReady(false);
    setHasRoof(false);
    setPanels([]);
    setDisabled(new Set());
  }

  // Debounced re-layout when polygons edit.
  const relayoutTimer = useRef<number | null>(null);
  const scheduleRelayout = useCallback(() => {
    if (relayoutTimer.current) window.clearTimeout(relayoutTimer.current);
    relayoutTimer.current = window.setTimeout(() => relayout(), 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pathToLatLng(p: google.maps.Polygon): LatLng[] {
    return p
      .getPath()
      .getArray()
      .map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
  }

  function attachPolyListeners(p: google.maps.Polygon, kind: "roof" | "cutout") {
    const path = p.getPath();
    const handler = () => scheduleRelayout();
    listenersRef.current.push(google.maps.event.addListener(path, "set_at", handler));
    listenersRef.current.push(google.maps.event.addListener(path, "insert_at", handler));
    listenersRef.current.push(google.maps.event.addListener(path, "remove_at", handler));
    if (kind === "cutout") {
      listenersRef.current.push(
        google.maps.event.addListener(p, "rightclick", (e: google.maps.PolyMouseEvent) => {
          if (typeof e.vertex === "number") {
            p.getPath().removeAt(e.vertex);
          } else {
            // remove whole cutout on rightclick body
            p.setMap(null);
            cutoutPolysRef.current = cutoutPolysRef.current.filter((x) => x !== p);
            scheduleRelayout();
          }
        })
      );
    } else {
      listenersRef.current.push(
        google.maps.event.addListener(p, "rightclick", (e: google.maps.PolyMouseEvent) => {
          if (typeof e.vertex === "number" && p.getPath().getLength() > 3) {
            p.getPath().removeAt(e.vertex);
          }
        })
      );
    }
  }

  function relayout() {
    const rp = roofPolyRef.current;
    if (!rp) {
      setPanels([]);
      renderPanels([]);
      return;
    }
    const roof = pathToLatLng(rp);
    const cutouts = cutoutPolysRef.current.map(pathToLatLng);
    const next = layoutPanels(roof, spec, cutouts);
    setPanels(next);
    // Drop disabled ids that no longer exist (re-layout produces new ids).
    if (autoFit) {
      setDisabled(new Set());
      renderPanels(next, new Set());
    } else {
      renderPanels(next, disabled);
    }
  }

  function renderPanels(list: PanelRect[], skipSet: Set<string> = disabled) {
    panelPolysRef.current.forEach((p) => p.setMap(null));
    panelPolysRef.current.clear();
    const map = mapRef.current;
    if (!map) return;
    for (const p of list) {
      const off = skipSet.has(p.id);
      const poly = new google.maps.Polygon({
        paths: p.corners,
        fillColor: off ? "#64748b" : "#0ea5e9",
        fillOpacity: off ? 0.25 : 0.75,
        strokeColor: off ? "#475569" : "#075985",
        strokeWeight: 1,
        clickable: true,
        map,
        zIndex: 3,
      });
      poly.addListener("click", () => {
        setDisabled((prev) => {
          const n = new Set(prev);
          if (n.has(p.id)) n.delete(p.id);
          else n.add(p.id);
          // re-render just this one for snappy feedback
          const on = !n.has(p.id);
          poly.setOptions({
            fillColor: on ? "#0ea5e9" : "#64748b",
            fillOpacity: on ? 0.75 : 0.25,
            strokeColor: on ? "#075985" : "#475569",
          });
          return n;
        });
      });
      panelPolysRef.current.set(p.id, poly);
    }
  }

  // Re-run layout when spec changes.
  useEffect(() => {
    if (!ready) return;
    relayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.azimuthDeg, spec.tiltDeg, spec.rowGap, spec.orientation, ready]);

  function startRoof() {
    if (!drawerRef.current) return;
    setMode("roof");
    drawerRef.current.setOptions({
      polygonOptions: {
        fillColor: "#22c55e",
        fillOpacity: 0.15,
        strokeColor: "#16a34a",
        strokeWeight: 2,
        editable: true,
      },
    });
    drawerRef.current.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
  }
  function startCutout() {
    if (!drawerRef.current || !hasRoof) return;
    setMode("cutout");
    drawerRef.current.setOptions({
      polygonOptions: {
        fillColor: "#ef4444",
        fillOpacity: 0.25,
        strokeColor: "#dc2626",
        strokeWeight: 2,
        editable: true,
      },
    });
    drawerRef.current.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
  }
  function clearAll() {
    roofPolyRef.current?.setMap(null);
    roofPolyRef.current = null;
    cutoutPolysRef.current.forEach((p) => p.setMap(null));
    cutoutPolysRef.current = [];
    panelPolysRef.current.forEach((p) => p.setMap(null));
    panelPolysRef.current.clear();
    setHasRoof(false);
    setPanels([]);
    setDisabled(new Set());
  }

  const activeCount = panels.filter((p) => !disabled.has(p.id)).length;
  const roofAreaM2 = useMemo(() => {
    if (!roofPolyRef.current) return 0;
    return polyAreaM2(pathToLatLng(roofPolyRef.current));
  }, [panels]);
  const kw = totalKW(activeCount, spec.watt);

  function handleSave() {
    const rp = roofPolyRef.current;
    if (!rp) {
      onOpenChange(false);
      return;
    }
    const plan: RoofPlan = {
      roof: pathToLatLng(rp),
      cutouts: cutoutPolysRef.current.map(pathToLatLng),
      panels,
      disabled: Array.from(disabled),
      spec,
      center,
    };
    onSave(plan);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[100dvh] max-h-[100dvh] w-full max-w-full gap-0 rounded-none border-0 p-0 sm:rounded-none">
        <DialogHeader className="border-b px-3 py-2">
          <DialogTitle className="text-base">Roof & solar planner</DialogTitle>
        </DialogHeader>

        <div className="relative flex-1 overflow-hidden">
          <div ref={mapEl} className="absolute inset-0" />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}

          {/* Top toolbar */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-1.5 p-2">
            <div className="pointer-events-auto flex flex-wrap gap-1.5">
              <Button size="sm" variant={mode === "roof" ? "default" : "secondary"} onClick={startRoof} className="h-8 shadow">
                <Pencil className="mr-1 h-3.5 w-3.5" /> {hasRoof ? "Redraw roof" : "Draw roof"}
              </Button>
              <Button size="sm" variant={mode === "cutout" ? "default" : "secondary"} onClick={startCutout} disabled={!hasRoof} className="h-8 shadow">
                <Ban className="mr-1 h-3.5 w-3.5" /> Obstacle
              </Button>
              <Button size="sm" variant="secondary" onClick={() => relayout()} disabled={!hasRoof} className="h-8 shadow">
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-fit
              </Button>
              <Button size="sm" variant="ghost" onClick={clearAll} disabled={!hasRoof} className="h-8 bg-background/80 shadow">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {mode !== "idle" && (
              <div className="pointer-events-none mx-auto rounded-md bg-foreground/85 px-2 py-1 text-[11px] font-medium text-background shadow">
                {mode === "roof" ? "Tap roof corners · click first point to close" : "Tap obstacle corners · click first point to close"}
              </div>
            )}
          </div>

          {/* Bottom controls + stats */}
          <div className="absolute inset-x-0 bottom-0 max-h-[58dvh] overflow-y-auto rounded-t-2xl border-t bg-background/95 p-3 shadow-2xl backdrop-blur">
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="Panels" value={`${activeCount}/${panels.length}`} />
              <Stat label="System" value={`${kw.toFixed(2)} kW`} accent />
              <Stat label="Roof" value={`${roofAreaM2.toFixed(0)} m²`} />
            </div>

            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <Label className="flex items-center gap-1"><Compass className="h-3.5 w-3.5" /> Azimuth (where panels face)</Label>
                  <span className="font-mono">{spec.azimuthDeg}° {compassLabel(spec.azimuthDeg)}</span>
                </div>
                <Slider
                  value={[spec.azimuthDeg]}
                  min={0} max={359} step={1}
                  onValueChange={(v) => setSpec((s) => ({ ...s, azimuthDeg: v[0] }))}
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <Label>Tilt</Label>
                  <span className="font-mono">{spec.tiltDeg}°</span>
                </div>
                <Slider
                  value={[spec.tiltDeg]}
                  min={0} max={45} step={1}
                  onValueChange={(v) => setSpec((s) => ({ ...s, tiltDeg: v[0] }))}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <NumField label="Panel W" value={spec.watt} onChange={(v) => setSpec((s) => ({ ...s, watt: v }))} />
                <NumField label="Row gap (m)" value={spec.rowGap} step={0.05} onChange={(v) => setSpec((s) => ({ ...s, rowGap: v }))} />
                <div className="flex items-end justify-between rounded-md border px-2 pb-1 pt-2">
                  <Label className="text-[11px]">Landscape</Label>
                  <Switch
                    checked={spec.orientation === "landscape"}
                    onCheckedChange={(v) => setSpec((s) => ({ ...s, orientation: v ? "landscape" : "portrait" }))}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                <Label>Auto re-fit when roof edits</Label>
                <Switch checked={autoFit} onCheckedChange={setAutoFit} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Tap any panel to disable/enable it. Right-click a vertex to delete it. Right-click an obstacle body to remove the whole obstacle.
              </p>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button className="flex-1" onClick={handleSave} disabled={!hasRoof}>
                  <Save className="mr-1 h-4 w-4" /> Save plan
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${accent ? "bg-primary/10 border-primary/30" : ""}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function NumField({
  label, value, step = 1, onChange,
}: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
    </div>
  );
}

function compassLabel(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}