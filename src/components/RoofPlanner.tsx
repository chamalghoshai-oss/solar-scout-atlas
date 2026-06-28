/// <reference types="google.maps" />
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Pencil, Ban, Trash2, RefreshCw, Save, Compass, Check, X, ChevronDown, ChevronUp } from "lucide-react";
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
  disabled: string[];
  spec: PanelSpec;
  center: LatLng;
};

type Mode = "idle" | "roof" | "cutout";

const ROOF_STYLE: google.maps.PolygonOptions = {
  fillColor: "#22c55e",
  fillOpacity: 0.15,
  strokeColor: "#16a34a",
  strokeWeight: 2,
  editable: true,
  draggable: false,
  zIndex: 2,
};
const CUT_STYLE: google.maps.PolygonOptions = {
  fillColor: "#ef4444",
  fillOpacity: 0.25,
  strokeColor: "#dc2626",
  strokeWeight: 2,
  editable: true,
  draggable: false,
  zIndex: 2,
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
  const roofPolyRef = useRef<google.maps.Polygon | null>(null);
  const cutoutPolysRef = useRef<google.maps.Polygon[]>([]);
  const panelPolysRef = useRef<Map<string, google.maps.Polygon>>(new Map());
  const draftLineRef = useRef<google.maps.Polyline | null>(null);
  const draftDotsRef = useRef<google.maps.Marker[]>([]);
  const projectionOverlayRef = useRef<google.maps.OverlayView | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastPointerDraftAtRef = useRef(0);
  const mapClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const editListenersRef = useRef<google.maps.MapsEventListener[]>([]);
  const resizeObsRef = useRef<ResizeObserver | null>(null);

  const [mapHost, setMapHost] = useState<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const modeRef = useRef<Mode>("idle");
  modeRef.current = mode;
  const [hasRoof, setHasRoof] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [spec, setSpec] = useState<PanelSpec>(initial?.spec ?? DEFAULT_PANEL);
  const [disabled, setDisabled] = useState<Set<string>>(new Set(initial?.disabled ?? []));
  const [panels, setPanels] = useState<PanelRect[]>(initial?.panels ?? []);
  const [autoFit, setAutoFit] = useState(true);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // Init map.
  useEffect(() => {
    if (!open || !mapHost) return;
    let cancelled = false;
    (async () => {
      setMapError(null);
      let maps: typeof google.maps;
      try {
        ({ maps } = await loadDrawing());
      } catch (err) {
        if (!cancelled) setMapError(err instanceof Error ? err.message : "Could not load satellite map");
        return;
      }
      if (cancelled) return;
      const map = new maps.Map(mapHost, {
        center,
        zoom: 20,
        mapTypeId: "satellite",
        tilt: 0,
        heading: 0,
        rotateControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        gestureHandling: "greedy",
        clickableIcons: false,
      });
      // Force flat top-down satellite — disable Google's 45° aerial imagery.
      map.setTilt(0);
      mapRef.current = map;
      const projectionOverlay = new google.maps.OverlayView();
      projectionOverlay.onAdd = () => undefined;
      projectionOverlay.draw = () => undefined;
      projectionOverlay.onRemove = () => undefined;
      projectionOverlay.setMap(map);
      projectionOverlayRef.current = projectionOverlay;

      // The dialog can mount with 0 size for a frame; trigger resize so
      // Google Maps re-measures and actually paints satellite tiles.
      const kickResize = () => {
        if (!mapRef.current) return;
        google.maps.event.trigger(mapRef.current, "resize");
        mapRef.current.setCenter(center);
      };
      requestAnimationFrame(() => {
        kickResize();
        setTimeout(kickResize, 250);
      });
      if ("ResizeObserver" in window) {
        const ro = new ResizeObserver(() => kickResize());
        ro.observe(mapHost);
        resizeObsRef.current = ro;
      }

      mapClickListenerRef.current = map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (Date.now() - lastPointerDraftAtRef.current < 450) return;
        const m = modeRef.current;
        if ((m === "roof" || m === "cutout") && e.latLng) {
          addDraftVertex({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        }
      });

      // Restore initial geometry.
      if (initial?.roof?.length) {
        const rp = new google.maps.Polygon({ ...ROOF_STYLE, paths: initial.roof, map });
        roofPolyRef.current = rp;
        attachPolyListeners(rp, "roof");
        setHasRoof(true);
        for (const c of initial.cutouts ?? []) {
          const cp = new google.maps.Polygon({ ...CUT_STYLE, paths: c, map });
          cutoutPolysRef.current.push(cp);
          attachPolyListeners(cp, "cutout");
        }
        const bounds = new google.maps.LatLngBounds();
        initial.roof.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 60);
        // Render saved panels immediately.
        renderPanels(initial.panels, new Set(initial.disabled));
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapHost]);

  function cleanup() {
    resizeObsRef.current?.disconnect();
    resizeObsRef.current = null;
    mapClickListenerRef.current?.remove();
    mapClickListenerRef.current = null;
    projectionOverlayRef.current?.setMap(null);
    projectionOverlayRef.current = null;
    pointerStartRef.current = null;
    editListenersRef.current.forEach((l) => l.remove());
    editListenersRef.current = [];
    clearDraft();
    roofPolyRef.current?.setMap(null);
    roofPolyRef.current = null;
    cutoutPolysRef.current.forEach((p) => p.setMap(null));
    cutoutPolysRef.current = [];
    panelPolysRef.current.forEach((p) => p.setMap(null));
    panelPolysRef.current.clear();
    mapRef.current = null;
    setReady(false);
    setMapError(null);
    setHasRoof(false);
    setPanels([]);
    setDisabled(new Set());
    setMode("idle");
    setDraftCount(0);
  }

  // --- Drafting helpers ---
  function ensureDraftLine() {
    if (draftLineRef.current || !mapRef.current) return;
    const stroke = modeRef.current === "cutout" ? "#dc2626" : "#16a34a";
    draftLineRef.current = new google.maps.Polyline({
      map: mapRef.current,
      path: [],
      strokeColor: stroke,
      strokeWeight: 2,
      strokeOpacity: 0.9,
      zIndex: 5,
    });
  }
  function addDraftVertex(p: LatLng) {
    ensureDraftLine();
    const line = draftLineRef.current!;
    line.getPath().push(new google.maps.LatLng(p.lat, p.lng));
    const dot = new google.maps.Marker({
      position: p,
      map: mapRef.current!,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 5,
        fillColor: modeRef.current === "cutout" ? "#dc2626" : "#16a34a",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 1.5,
      },
      zIndex: 6,
    });
    draftDotsRef.current.push(dot);
    setDraftCount(line.getPath().getLength());
  }

  function pointToLatLng(clientX: number, clientY: number): LatLng | null {
    const projection = projectionOverlayRef.current?.getProjection();
    const el = mapEl.current;
    if (!projection || !el) return null;
    const rect = el.getBoundingClientRect();
    const ll = projection.fromContainerPixelToLatLng(new google.maps.Point(clientX - rect.left, clientY - rect.top));
    return ll ? { lat: ll.lat(), lng: ll.lng() } : null;
  }

  function handleMapPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (modeRef.current !== "roof" && modeRef.current !== "cutout") return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }

  function handleMapPointerUp(e: PointerEvent<HTMLDivElement>) {
    const m = modeRef.current;
    if (m !== "roof" && m !== "cutout") return;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved > 12 || Date.now() - start.t > 700) return;
    const p = pointToLatLng(e.clientX, e.clientY);
    if (!p) return;
    lastPointerDraftAtRef.current = Date.now();
    addDraftVertex(p);
  }

  function clearDraft() {
    draftLineRef.current?.setMap(null);
    draftLineRef.current = null;
    draftDotsRef.current.forEach((m) => m.setMap(null));
    draftDotsRef.current = [];
    setDraftCount(0);
  }
  function finishDraft() {
    const line = draftLineRef.current;
    const map = mapRef.current;
    if (!line || !map) return;
    const path = line
      .getPath()
      .getArray()
      .map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
    if (path.length < 3) {
      clearDraft();
      setMode("idle");
      return;
    }
    const isCut = modeRef.current === "cutout";
    const poly = new google.maps.Polygon({
      ...(isCut ? CUT_STYLE : ROOF_STYLE),
      paths: path,
      map,
    });
    if (isCut) {
      cutoutPolysRef.current.push(poly);
      attachPolyListeners(poly, "cutout");
    } else {
      if (roofPolyRef.current) roofPolyRef.current.setMap(null);
      roofPolyRef.current = poly;
      attachPolyListeners(poly, "roof");
      setHasRoof(true);
    }
    clearDraft();
    setMode("idle");
    scheduleRelayout();
  }

  // --- Polygon edit wiring ---
  function pathToLatLng(p: google.maps.Polygon): LatLng[] {
    return p
      .getPath()
      .getArray()
      .map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
  }
  function attachPolyListeners(p: google.maps.Polygon, kind: "roof" | "cutout") {
    const path = p.getPath();
    const onChange = () => scheduleRelayout();
    editListenersRef.current.push(google.maps.event.addListener(path, "set_at", onChange));
    editListenersRef.current.push(google.maps.event.addListener(path, "insert_at", onChange));
    editListenersRef.current.push(google.maps.event.addListener(path, "remove_at", onChange));
    editListenersRef.current.push(
      google.maps.event.addListener(p, "rightclick", (e: google.maps.PolyMouseEvent) => {
        if (typeof e.vertex === "number") {
          if (kind === "roof" && p.getPath().getLength() <= 3) return;
          p.getPath().removeAt(e.vertex);
          return;
        }
        if (kind === "cutout") {
          p.setMap(null);
          cutoutPolysRef.current = cutoutPolysRef.current.filter((x) => x !== p);
          scheduleRelayout();
        }
      })
    );
  }

  // --- Layout ---
  const relayoutTimer = useRef<number | null>(null);
  const scheduleRelayout = useCallback(() => {
    if (relayoutTimer.current) window.clearTimeout(relayoutTimer.current);
    relayoutTimer.current = window.setTimeout(() => relayout(), 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function relayout() {
    const rp = roofPolyRef.current;
    if (!rp) {
      setPanels([]);
      renderPanels([], new Set());
      return;
    }
    const roof = pathToLatLng(rp);
    const cutouts = cutoutPolysRef.current.map(pathToLatLng);
    const next = layoutPanels(roof, spec, cutouts);
    setPanels(next);
    if (autoFit) {
      setDisabled(new Set());
      renderPanels(next, new Set());
    } else {
      renderPanels(next, disabled);
    }
  }

  function renderPanels(list: PanelRect[], skipSet: Set<string>) {
    panelPolysRef.current.forEach((p) => p.setMap(null));
    panelPolysRef.current.clear();
    const map = mapRef.current;
    if (!map) return;
    for (const p of list) {
      const off = skipSet.has(p.id);
      const poly = new google.maps.Polygon({
        paths: p.corners,
        fillColor: off ? "#64748b" : "#0ea5e9",
        fillOpacity: off ? 0.25 : 0.78,
        strokeColor: off ? "#475569" : "#075985",
        strokeWeight: 1,
        clickable: true,
        map,
        zIndex: 3,
      });
      poly.addListener("click", () => {
        setDisabled((prev) => {
          const n = new Set(prev);
          const willOff = !n.has(p.id);
          if (willOff) n.add(p.id);
          else n.delete(p.id);
          poly.setOptions({
            fillColor: willOff ? "#64748b" : "#0ea5e9",
            fillOpacity: willOff ? 0.25 : 0.78,
            strokeColor: willOff ? "#475569" : "#075985",
          });
          return n;
        });
      });
      panelPolysRef.current.set(p.id, poly);
    }
  }

  useEffect(() => {
    if (!ready) return;
    relayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.azimuthDeg, spec.tiltDeg, spec.rowGap, spec.orientation, spec.watt, ready]);

  // --- Toolbar actions ---
  function startRoof() {
    clearDraft();
    setMode("roof");
  }
  function startCutout() {
    if (!hasRoof) return;
    clearDraft();
    setMode("cutout");
  }
  function cancelDraw() {
    clearDraft();
    setMode("idle");
  }
  function clearAll() {
    roofPolyRef.current?.setMap(null);
    roofPolyRef.current = null;
    cutoutPolysRef.current.forEach((p) => p.setMap(null));
    cutoutPolysRef.current = [];
    panelPolysRef.current.forEach((p) => p.setMap(null));
    panelPolysRef.current.clear();
    editListenersRef.current.forEach((l) => l.remove());
    editListenersRef.current = [];
    setHasRoof(false);
    setPanels([]);
    setDisabled(new Set());
  }

  const activeCount = panels.filter((p) => !disabled.has(p.id)).length;
  const roofAreaM2 = useMemo(() => {
    const rp = roofPolyRef.current;
    if (!rp) return 0;
    return polyAreaM2(pathToLatLng(rp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, hasRoof]);
  const kw = totalKW(activeCount, spec.watt);

  function handleSave() {
    const rp = roofPolyRef.current;
    if (!rp) {
      onOpenChange(false);
      return;
    }
    onSave({
      roof: pathToLatLng(rp),
      cutouts: cutoutPolysRef.current.map(pathToLatLng),
      panels,
      disabled: Array.from(disabled),
      spec,
      center,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 rounded-none border-0 p-0 sm:rounded-none">
        <DialogHeader className="shrink-0 border-b px-3 py-2">
          <DialogTitle className="text-base">Roof & solar planner</DialogTitle>
        </DialogHeader>

        <div className="relative flex-1 overflow-hidden">
          <div
            ref={(el) => {
              mapEl.current = el;
              setMapHost(el);
            }}
            className="absolute inset-0"
            onPointerDownCapture={handleMapPointerDown}
            onPointerUpCapture={handleMapPointerUp}
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-background px-6 text-center">
              <div className="max-w-sm rounded-lg border bg-card p-4 shadow-sm">
                <p className="text-sm font-semibold">Satellite map could not load</p>
                <p className="mt-1 text-xs text-muted-foreground">{mapError}</p>
                <Button size="sm" className="mt-3" onClick={() => onOpenChange(false)}>Back to lead</Button>
              </div>
            </div>
          )}

          {/* Toolbar */}
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
          </div>

          {/* Drawing status bar */}
          {mode !== "idle" && (
            <div className="absolute inset-x-2 top-14 z-10 flex items-center gap-2 rounded-lg bg-foreground/90 px-3 py-2 text-[12px] text-background shadow">
              <span className="flex-1">
                {mode === "roof" ? "Tap roof corners" : "Tap obstacle corners"} · {draftCount} point{draftCount === 1 ? "" : "s"}
                {draftCount < 3 && " (need ≥ 3)"}
              </span>
              <Button size="sm" variant="ghost" onClick={cancelDraw} className="h-7 px-2 text-background hover:bg-white/15">
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" onClick={finishDraft} disabled={draftCount < 3} className="h-7 px-2">
                <Check className="mr-1 h-3.5 w-3.5" /> Done
              </Button>
            </div>
          )}

          {/* Bottom controls + stats — collapsible for fullscreen map */}
          <div
            className={`absolute inset-x-0 bottom-0 rounded-t-2xl border-t bg-background/95 shadow-2xl backdrop-blur transition-[max-height] duration-200 ${
              panelCollapsed ? "max-h-[64px] overflow-hidden" : "max-h-[58dvh] overflow-y-auto"
            }`}
          >
            <button
              type="button"
              onClick={() => setPanelCollapsed((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs"
              aria-label={panelCollapsed ? "Expand controls" : "Collapse controls for fullscreen map"}
            >
              <span className="flex items-center gap-2 font-medium">
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{kw.toFixed(2)} kW</span>
                <span className="text-muted-foreground">{activeCount}/{panels.length} panels · {roofAreaM2.toFixed(0)} m²</span>
              </span>
              {panelCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            <div className={`space-y-3 px-3 pb-3 ${panelCollapsed ? "hidden" : ""}`}>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Panels" value={`${activeCount}/${panels.length}`} />
                <Stat label="System" value={`${kw.toFixed(2)} kW`} accent />
                <Stat label="Roof" value={`${roofAreaM2.toFixed(0)} m²`} />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <Label className="flex items-center gap-1"><Compass className="h-3.5 w-3.5" /> Azimuth (panels face)</Label>
                  <span className="font-mono">{spec.azimuthDeg}° {compassLabel(spec.azimuthDeg)}</span>
                </div>
                <Slider value={[spec.azimuthDeg]} min={0} max={359} step={1}
                  onValueChange={(v) => setSpec((s) => ({ ...s, azimuthDeg: v[0] }))} />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <Label>Tilt</Label>
                  <span className="font-mono">{spec.tiltDeg}°</span>
                </div>
                <Slider value={[spec.tiltDeg]} min={0} max={45} step={1}
                  onValueChange={(v) => setSpec((s) => ({ ...s, tiltDeg: v[0] }))} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <NumField label="Panel W" value={spec.watt} onChange={(v) => setSpec((s) => ({ ...s, watt: v }))} />
                <NumField label="Row gap (m)" value={spec.rowGap} step={0.05}
                  onChange={(v) => setSpec((s) => ({ ...s, rowGap: v }))} />
                <div className="flex items-end justify-between rounded-md border px-2 pb-1 pt-2">
                  <Label className="text-[11px]">Landscape</Label>
                  <Switch checked={spec.orientation === "landscape"}
                    onCheckedChange={(v) => setSpec((s) => ({ ...s, orientation: v ? "landscape" : "portrait" }))} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                <Label>Auto re-fit on edits</Label>
                <Switch checked={autoFit} onCheckedChange={setAutoFit} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Tap a panel to disable/enable it. Drag vertices to reshape. Right-click a vertex to delete it. Right-click an obstacle body to remove it.
              </p>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
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
    <div className={`rounded-lg border px-2 py-1.5 ${accent ? "border-primary/30 bg-primary/10" : ""}`}>
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
      <Input type="number" inputMode="decimal" step={step} value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }} />
    </div>
  );
}

function compassLabel(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}