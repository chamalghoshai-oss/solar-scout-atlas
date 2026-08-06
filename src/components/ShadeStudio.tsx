import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Play, Pause, Sun, Loader2 } from "lucide-react";
import { annualShade, dateFromDayHour, isShaded, MONTH_LABELS, sunPosition, sunVector, type Obstruction } from "@/lib/sun";
import type { RoofDims } from "@/components/ShadeScene";

const ShadeScene = lazy(() => import("@/components/ShadeScene").then((m) => ({ default: m.ShadeScene })));

const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

export function ShadeStudio({
  kwEstimate,
  lat = 11.2588,
  lng = 75.7804,
}: {
  kwEstimate?: number | null;
  lat?: number;
  lng?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [dims, setDims] = useState<RoofDims>({
    length: 10,
    width: 8,
    wallHeight: 3.2,
    tiltDeg: 11,
    azimuthDeg: 180,
  });
  const [obs, setObs] = useState<Obstruction>({
    enabled: true,
    height: 8,
    distance: 9,
    bearingDeg: 250,
    width: 4,
  });
  const [dayOfYear, setDayOfYear] = useState(() => {
    const now = new Date();
    return Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
  });
  const [hour, setHour] = useState(12);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setHour((h) => (h >= 18 ? 6 : Math.round((h + 0.25) * 100) / 100));
    }, 90);
    return () => clearInterval(t);
  }, [playing]);

  const year = new Date().getFullYear();
  const date = useMemo(() => dateFromDayHour(year, dayOfYear, hour), [year, dayOfYear, hour]);
  const pos = useMemo(() => sunPosition(date, lat, lng), [date, lat, lng]);
  const vec = useMemo(() => sunVector(pos, 80), [pos]);
  const shaded = isShaded(pos, obs);
  const summary = useMemo(() => annualShade(lat, lng, obs, year), [lat, lng, obs, year]);

  const panelCount = Math.max(2, Math.round(((kwEstimate ?? 5) * 1000) / 550));

  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <div className="space-y-3">
      {mounted ? (
        <Suspense
          fallback={
            <div className="flex h-[420px] items-center justify-center rounded-lg border border-border bg-muted/40">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          }
        >
          <ShadeScene dims={dims} obstruction={obs} sunVec={vec} altitude={pos.altitude} panelCount={panelCount} />
        </Suspense>
      ) : (
        <div className="flex h-[420px] items-center justify-center rounded-lg border border-border bg-muted/40">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {/* Time controls */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Sun className="h-4 w-4 text-primary" />
            {formatHour(hour)} · {date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${shaded ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>
              {pos.altitude <= 0 ? "Sun below horizon" : shaded ? "Roof shaded" : "Full sun"}
            </span>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
          </div>
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
          Sun elevation {(pos.altitude * 180 / Math.PI).toFixed(1)}° · azimuth {(pos.azimuth * 180 / Math.PI).toFixed(0)}°
        </p>
      </div>

      {/* Annual shade summary */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Yearly sun access</span>
          <span className="text-lg font-bold text-primary">{summary.sunPercent}%</span>
        </div>
        <div className="flex items-end gap-1">
          {summary.monthly.map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-16 w-full items-end rounded bg-muted">
                <div className="w-full rounded bg-primary" style={{ height: `${Math.max(4, v)}%` }} />
              </div>
              <span className="text-[9px] text-muted-foreground">{MONTH_LABELS[i]}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Share of 6 am–6 pm daylight with direct sun on the roof, sampled every 15 minutes.
        </p>
      </div>

      {/* Dimensions */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roof dimensions</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Length (m)" value={dims.length} onChange={(v) => setDims((d) => ({ ...d, length: num(v, d.length) }))} />
          <Field label="Width (m)" value={dims.width} onChange={(v) => setDims((d) => ({ ...d, width: num(v, d.width) }))} />
          <Field label="Wall height (m)" value={dims.wallHeight} onChange={(v) => setDims((d) => ({ ...d, wallHeight: num(v, d.wallHeight) }))} />
          <Field label="Tilt (°)" value={dims.tiltDeg} onChange={(v) => setDims((d) => ({ ...d, tiltDeg: num(v, d.tiltDeg) }))} />
          <Field label="Facing azimuth (°)" value={dims.azimuthDeg} onChange={(v) => setDims((d) => ({ ...d, azimuthDeg: num(v, d.azimuthDeg) }))} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Azimuth: 180° = south-facing, 90° = east, 270° = west.</p>
      </div>

      {/* Obstruction */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nearby obstruction</span>
          <Switch checked={obs.enabled} onCheckedChange={(v) => setObs((o) => ({ ...o, enabled: v }))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Height (m)" value={obs.height} onChange={(v) => setObs((o) => ({ ...o, height: num(v, o.height) }))} />
          <Field label="Distance (m)" value={obs.distance} onChange={(v) => setObs((o) => ({ ...o, distance: num(v, o.distance) }))} />
          <Field label="Width (m)" value={obs.width} onChange={(v) => setObs((o) => ({ ...o, width: num(v, o.width) }))} />
          <Field label="Direction (° from N)" value={obs.bearingDeg} onChange={(v) => setObs((o) => ({ ...o, bearingDeg: num(v, o.bearingDeg) }))} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        className="mt-1 h-8"
        type="number"
        inputMode="decimal"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
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