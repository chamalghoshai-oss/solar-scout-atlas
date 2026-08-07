import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Box, Building2, Cylinder, Grid3X3, Loader2, Pause, Pencil, Play, Sun, Trees, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { dateFromDayHour, sunPosition, sunVector, MONTH_LABELS } from "@/lib/sun";
import {
  allPanels,
  buildCasters,
  emptyModel,
  centroid,
  panelShading,
  polyArea,
  polyBounds,
  roofShadeGrid,
  systemKw,
  uid,
  yearSamples,
  type CadModel,
  type Pt,
  type Vec3,
} from "@/lib/cad-model";
import { FootprintCanvas, type DrawMode } from "@/components/cad/FootprintCanvas";
import type { Selection } from "@/components/cad/CadScene";

const CadScene = lazy(() => import("@/components/cad/CadScene").then((m) => ({ default: m.CadScene })));

const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const GRID = { cols: 40, rows: 30 };

type NPt = { u: number; v: number };

export function CadStudio({
  imageUrl,
  lat = 11.2588,
  lng = 75.7804,
}: {
  imageUrl?: string | null;
  lat?: number;
  lng?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [model, setModel] = useState<CadModel>(() => emptyModel());
  const [siteWidthM, setSiteWidthM] = useState(30);
  const [draw, setDraw] = useState<DrawMode | null>("outline");
  const [outlineN, setOutlineN] = useState<NPt[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [heatOn, setHeatOn] = useState(true);
  const [selStorey, setSelStorey] = useState<string | null>(null);

  const [dayOfYear, setDayOfYear] = useState(() => {
    const now = new Date();
    return Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
  });
  const [hour, setHour] = useState(12);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setHour((h) => (h >= 18 ? 6 : Math.round((h + 0.25) * 100) / 100)), 100);
    return () => clearInterval(t);
  }, [playing]);

  const year = new Date().getFullYear();
  const pos = useMemo(
    () => sunPosition(dateFromDayHour(year, dayOfYear, hour, lng), lat, lng),
    [year, dayOfYear, hour, lat, lng],
  );
  const sunVec = useMemo(() => sunVector(pos, 150) as Vec3, [pos]);

  /* ---------- derived model data ---------- */
  const hasRoof = model.footprint.length >= 3;
  const casters = useMemo(() => buildCasters(model), [model]);
  const panels = useMemo(() => (hasRoof ? allPanels(model) : []), [model, hasRoof]);
  const samples = useMemo(() => yearSamples(lat, lng, year), [lat, lng, year]);

  const panelAccess = useMemo(
    () => (heatOn && panels.length ? panelShading(panels, casters, samples) : panels.map(() => 1)),
    [heatOn, panels, casters, samples],
  );
  const roofGrid = useMemo(() => {
    if (!heatOn || !hasRoof) return null;
    return roofShadeGrid(model, casters, samples, GRID.cols, GRID.rows)?.grid ?? null;
  }, [heatOn, hasRoof, model, casters, samples]);

  const kw = systemKw(panels.length, model.panel.watt);
  const avgAccess = panelAccess.length
    ? panelAccess.reduce((a, b) => a + b, 0) / panelAccess.length
    : 0;

  /* ---------- editing helpers ---------- */
  function patch(p: Partial<CadModel>) {
    setModel((m) => ({ ...m, ...p }));
  }

  function finishDraw(nPts: NPt[], metres: Pt[]) {
    if (draw === "outline") {
      const c = centroid(metres);
      const centred = metres.map((p) => ({ x: p.x - c.x, z: p.z - c.z }));
      const b = polyBounds(centred);
      setOutlineN(nPts);
      setModel((m) => ({
        ...m,
        footprint: centred,
        ridge: {
          a: { x: b.minX * 0.6, z: 0 },
          b: { x: b.maxX * 0.6, z: 0 },
          height: m.wallHeight + 1.8,
        },
      }));
      toast.success(`Footprint set · ${polyArea(centred).toFixed(1)} m²`);
    } else if (draw === "storey") {
      const oc = centroid(
        outlineN.map((p) => ({
          x: (p.u - 0.5) * siteWidthM,
          z: (p.v - 0.5) * (siteWidthM / aspect),
        })),
      );
      const s = {
        id: uid("storey"),
        footprint: metres.map((p) => ({ x: p.x - oc.x, z: p.z - oc.z })),
        wallHeight: 3,
        parapetHeight: 0.6,
      };
      setModel((m) => ({ ...m, storeys: [...m.storeys, s] }));
      setSelStorey(s.id);
      toast.success("Building block added");
    } else if (draw === "ridge" && metres.length === 2) {
      // ridge points come in the same image frame; re-centre with the outline
      const oc = centroid(
        outlineN.map((p) => ({
          x: (p.u - 0.5) * siteWidthM,
          z: (p.v - 0.5) * (siteWidthM / aspect),
        })),
      );
      setModel((m) => ({
        ...m,
        roofType: "sloped",
        ridge: {
          a: { x: metres[0].x - oc.x, z: metres[0].z - oc.z },
          b: { x: metres[1].x - oc.x, z: metres[1].z - oc.z },
          height: m.ridge.height,
        },
      }));
      toast.success("Ridge line set");
    }
    setDraw(null);
  }

  function addPrim(kind: "block" | "cylinder") {
    if (!hasRoof) return toast.error("Draw the roof outline first");
    const p = {
      id: uid(kind),
      kind,
      x: 0,
      z: 0,
      base: "roof" as const,
      rotY: 0,
      w: 1.5,
      d: 1.2,
      r: 0.5,
      h: kind === "block" ? 1.2 : 1.6,
    };
    setModel((m) => ({ ...m, prims: [...m.prims, p] }));
    setSelection({ kind: "prim", id: p.id });
  }

  function addTree() {
    const b = hasRoof ? polyBounds(model.footprint) : { maxX: 6, minZ: 0, minX: -6, maxZ: 0 };
    const t = { id: uid("tree"), x: b.maxX + 4, z: 0, h: 8, r: 2.2 };
    setModel((m) => ({ ...m, trees: [...m.trees, t] }));
    setSelection({ kind: "tree", id: t.id });
  }

  function addGroup() {
    if (!hasRoof) return toast.error("Draw the roof outline first");
    const g = { id: uid("grp"), cols: 4, rows: 3, x: 0, z: 0, rotY: 0 };
    setModel((m) => ({ ...m, groups: [...m.groups, g] }));
    setSelection({ kind: "group", id: g.id });
  }

  function deleteSelected() {
    if (!selection) return;
    setModel((m) => ({
      ...m,
      prims: selection.kind === "prim" ? m.prims.filter((p) => p.id !== selection.id) : m.prims,
      trees: selection.kind === "tree" ? m.trees.filter((t) => t.id !== selection.id) : m.trees,
      groups: selection.kind === "group" ? m.groups.filter((g) => g.id !== selection.id) : m.groups,
    }));
    setSelection(null);
  }

  const aspect = 4 / 3;
  const num = (v: string, f: number) => (Number.isFinite(Number(v)) ? Number(v) : f);

  const selPrim = selection?.kind === "prim" ? model.prims.find((p) => p.id === selection.id) : undefined;
  const selTree = selection?.kind === "tree" ? model.trees.find((t) => t.id === selection.id) : undefined;
  const selGroup = selection?.kind === "group" ? model.groups.find((g) => g.id === selection.id) : undefined;

  return (
    <div className="space-y-3">
      {/* Drawing surface */}
      {draw ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {draw === "outline"
                ? "Draw roof outline"
                : draw === "storey"
                  ? "Draw extra building / storey"
                  : "Draw ridge line"}
            </span>
            <div className="flex items-center gap-1.5">
              <Label className="text-[11px] text-muted-foreground">Image width (m)</Label>
              <Input
                className="h-7 w-20"
                type="number"
                value={String(siteWidthM)}
                onChange={(e) => setSiteWidthM(num(e.target.value, siteWidthM))}
              />
            </div>
          </div>
          <FootprintCanvas
            imageUrl={imageUrl}
            mode={draw}
            siteWidthM={siteWidthM}
            aspect={aspect}
            existingOutline={outlineN}
            onFinish={finishDraw}
            onCancel={() => setDraw(null)}
          />
        </div>
      ) : mounted ? (
        <Suspense fallback={<SceneFallback />}>
          <CadScene
            model={model}
            panels={panels}
            panelAccess={panelAccess}
            roofGrid={roofGrid}
            gridSize={GRID}
            sunVec={sunVec}
            altitude={pos.altitude}
            heatOn={heatOn}
            selection={selection}
            onSelect={setSelection}
            onMovePrim={(id, x, z) =>
              setModel((m) => ({ ...m, prims: m.prims.map((p) => (p.id === id ? { ...p, x, z } : p)) }))
            }
            onMoveTree={(id, x, z) =>
              setModel((m) => ({ ...m, trees: m.trees.map((t) => (t.id === id ? { ...t, x, z } : t)) }))
            }
            onMoveGroup={(id, x, z) =>
              setModel((m) => ({ ...m, groups: m.groups.map((g) => (g.id === id ? { ...g, x, z } : g)) }))
            }
          />
        </Suspense>
      ) : (
        <SceneFallback />
      )}

      {/* Sun controls — directly under the 3D view */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Sun className="h-4 w-4 text-primary" />
            {formatHour(hour)} ·{" "}
            {new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <Label className="text-[11px] text-muted-foreground">Time of day (6 am – 6 pm)</Label>
        <Slider className="my-2" min={6} max={18} step={0.25} value={[hour]} onValueChange={([v]) => setHour(v)} />
        <Label className="text-[11px] text-muted-foreground">Day of year</Label>
        <Slider className="my-2" min={1} max={365} step={1} value={[dayOfYear]} onValueChange={([v]) => setDayOfYear(v)} />
        <div className="flex flex-wrap gap-1">
          {MONTH_LABELS.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setDayOfYear(MONTH_STARTS[i] + 14)}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
            >
              {m}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Sun elevation {((pos.altitude * 180) / Math.PI).toFixed(1)}° · azimuth {((pos.azimuth * 180) / Math.PI).toFixed(0)}°
        </p>
      </div>

      {/* Live totals */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Panels" value={String(panels.length)} />
        <Stat label="System" value={`${kw.toFixed(2)} kW`} accent />
        <Stat label="Avg sun access" value={`${Math.round(avgAccess * 100)}%`} />
      </div>

      {/* Modelling toolbar */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modelling tools</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tool icon={<Pencil className="h-3.5 w-3.5" />} label="Roof outline" onClick={() => setDraw("outline")} />
          <Tool
            icon={<Pencil className="h-3.5 w-3.5" />}
            label="Ridge line"
            onClick={() => {
              if (!hasRoof) return toast.error("Draw the roof outline first");
              setDraw("ridge");
            }}
          />
          <Tool icon={<Box className="h-3.5 w-3.5" />} label="Block" onClick={() => addPrim("block")} />
          <Tool icon={<Cylinder className="h-3.5 w-3.5" />} label="Cylinder" onClick={() => addPrim("cylinder")} />
          <Tool icon={<Trees className="h-3.5 w-3.5" />} label="Tree" onClick={addTree} />
          <Tool icon={<Grid3X3 className="h-3.5 w-3.5" />} label="Panel grid" onClick={addGroup} />
          <Tool
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="Add building / storey"
            onClick={() => setDraw("storey")}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Tap an object in the 3D view to select it, then drag it to move. Everything you place casts real shadows.
          Draw a building block over the main roof to stack a second storey, or beside it for an adjacent building.
        </p>
      </div>

      {/* Extra buildings / storeys */}
      {model.storeys.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Buildings & storeys
          </div>
          <div className="space-y-2">
            {model.storeys.map((s, i) => (
              <div key={s.id} className="rounded-md border border-border p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold">Block {i + 1} · {polyArea(s.footprint).toFixed(1)} m²</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => setModel((m) => ({ ...m, storeys: m.storeys.filter((x) => x.id !== s.id) }))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField
                    label="Wall height (m)"
                    value={s.wallHeight}
                    onChange={(v) => updStorey(setModel, s.id, { wallHeight: Math.max(0.5, v) })}
                  />
                  <NumField
                    label="Parapet (m)"
                    value={s.parapetHeight}
                    onChange={(v) => updStorey(setModel, s.id, { parapetHeight: Math.max(0, v) })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Roof form */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roof form</span>
          <div className="flex overflow-hidden rounded-md border border-border text-[11px]">
            {(["flat", "sloped"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => patch({ roofType: t })}
                className={`px-2.5 py-1 capitalize ${model.roofType === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <SliderRow
          label="Wall height"
          unit="m"
          min={2}
          max={20}
          step={0.1}
          value={model.wallHeight}
          onChange={(v) => patch({ wallHeight: v })}
        />
        {model.roofType === "flat" ? (
          <SliderRow
            label="Parapet height"
            unit="m"
            min={0}
            max={2}
            step={0.05}
            value={model.parapetHeight}
            onChange={(v) => patch({ parapetHeight: v })}
          />
        ) : (
          <SliderRow
            label="Ridge height"
            unit="m"
            min={model.wallHeight}
            max={model.wallHeight + 8}
            step={0.1}
            value={Math.max(model.ridge.height, model.wallHeight)}
            onChange={(v) => patch({ ridge: { ...model.ridge, height: v } })}
          />
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {hasRoof
            ? `Footprint ${polyArea(model.footprint).toFixed(1)} m² · ${model.footprint.length} corners`
            : "No footprint yet — draw the roof outline to begin."}
        </p>
      </div>

      {/* Inspector */}
      {(selPrim || selTree || selGroup) && (
        <div className="rounded-xl border border-primary/40 bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              {selPrim ? `Selected ${selPrim.kind}` : selTree ? "Selected tree" : "Selected panel group"}
            </span>
            <Button size="sm" variant="outline" className="h-7" onClick={deleteSelected}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
            </Button>
          </div>

          {selPrim && (
            <div className="grid grid-cols-2 gap-2">
              {selPrim.kind === "block" ? (
                <>
                  <NumField label="Length (m)" value={selPrim.w} onChange={(v) => updPrim(setModel, selPrim.id, { w: Math.max(0.05, v) })} />
                  <NumField label="Breadth (m)" value={selPrim.d} onChange={(v) => updPrim(setModel, selPrim.id, { d: Math.max(0.05, v) })} />
                </>
              ) : (
                <NumField
                  label="Diameter (m)"
                  value={Math.round(selPrim.r * 200) / 100}
                  onChange={(v) => updPrim(setModel, selPrim.id, { r: Math.max(0.025, v / 2) })}
                />
              )}
              <NumField label="Height (m)" value={selPrim.h} onChange={(v) => updPrim(setModel, selPrim.id, { h: Math.max(0.05, v) })} />
              <NumField label="Rotation (°)" value={selPrim.rotY} onChange={(v) => updPrim(setModel, selPrim.id, { rotY: v })} />
              <div className="col-span-2 flex items-center justify-between rounded-md border border-border px-2 py-1.5">
                <Label className="text-[11px] text-muted-foreground">Sits on roof</Label>
                <Switch
                  checked={selPrim.base === "roof"}
                  onCheckedChange={(v) => updPrim(setModel, selPrim.id, { base: v ? "roof" : "ground" })}
                />
              </div>
            </div>
          )}

          {selTree && (
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Height (m)" value={selTree.h} onChange={(v) => updTree(setModel, selTree.id, { h: v })} />
              <NumField label="Canopy radius (m)" value={selTree.r} onChange={(v) => updTree(setModel, selTree.id, { r: v })} />
            </div>
          )}

          {selGroup && (
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Columns" value={selGroup.cols} onChange={(v) => updGroup(setModel, selGroup.id, { cols: Math.max(1, Math.round(v)) })} />
              <NumField label="Rows" value={selGroup.rows} onChange={(v) => updGroup(setModel, selGroup.id, { rows: Math.max(1, Math.round(v)) })} />
              <NumField label="Rotation (°)" value={selGroup.rotY} onChange={(v) => updGroup(setModel, selGroup.id, { rotY: v })} />
              <NumField
                label="Panel watt"
                value={model.panel.watt}
                onChange={(v) => patch({ panel: { ...model.panel, watt: Math.max(50, v) } })}
              />
              <p className="col-span-2 text-[11px] text-muted-foreground">
                Panels are always mounted at 11° facing south on rafters, with 1 sq ft concrete footings — on both
                flat and sloped roofs. Rafters scale with size (3 kW → 4, 5 kW → 6).
              </p>
            </div>
          )}
        </div>
      )}

      {/* Heatmap */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Annual shading heatmap
          </span>
          <Switch checked={heatOn} onCheckedChange={setHeatOn} />
        </div>
        <div
          className="h-2.5 w-full rounded-full"
          style={{ background: "linear-gradient(90deg,#a8187a,#d6444a,#f08a20,#f6c82c,#96c837,#2ebe5a)" }}
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>Heavily shaded</span>
          <span>Full sun</span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Cumulative 6 am–6 pm sun access sampled across the year. Panels are tinted with their own score, so
          underperforming positions stand out.
        </p>
      </div>
    </div>
  );
}

/* ---------------- small pieces ---------------- */

function updPrim(set: React.Dispatch<React.SetStateAction<CadModel>>, id: string, p: Record<string, unknown>) {
  set((m) => ({ ...m, prims: m.prims.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
}
function updTree(set: React.Dispatch<React.SetStateAction<CadModel>>, id: string, p: Record<string, unknown>) {
  set((m) => ({ ...m, trees: m.trees.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
}
function updGroup(set: React.Dispatch<React.SetStateAction<CadModel>>, id: string, p: Record<string, unknown>) {
  set((m) => ({ ...m, groups: m.groups.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
}
function updStorey(set: React.Dispatch<React.SetStateAction<CadModel>>, id: string, p: Record<string, unknown>) {
  set((m) => ({ ...m, storeys: m.storeys.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
}

function SceneFallback() {
  return (
    <div className="flex h-[460px] items-center justify-center rounded-xl border border-border bg-muted/40">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
    </div>
  );
}

function Tool({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="justify-start" onClick={onClick}>
      <span className="mr-1.5">{icon}</span>
      <span className="text-xs">{label}</span>
    </Button>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${accent ? "border-primary/30 bg-primary/10" : "border-border"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function SliderRow({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        <Input
          className="h-7 w-24"
          type="number"
          value={String(Math.round(value * 100) / 100)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      </div>
      <Slider className="my-2" min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
      <div className="text-right text-[10px] text-muted-foreground">{unit}</div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        className="mt-1 h-8"
        type="number"
        inputMode="decimal"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const ampm = hh >= 12 ? "pm" : "am";
  const disp = hh % 12 === 0 ? 12 : hh % 12;
  return `${disp}:${String(mm).padStart(2, "0")} ${ampm}`;
}