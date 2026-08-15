import { useRef, useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Undo2, X, Check, Ruler } from "lucide-react";
import type { Pt } from "@/lib/cad-model";

export type DrawMode = "outline" | "ridge" | "storey";

/** Normalised (0–1) point on the site image. */
type NPt = { u: number; v: number };

export function FootprintCanvas({
  imageUrl,
  mode,
  siteWidthM,
  aspect,
  existingOutline,
  onFinish,
  onCancel,
}: {
  imageUrl?: string | null;
  mode: DrawMode;
  /** real-world width covered by the image, in metres */
  siteWidthM: number;
  aspect: number;
  existingOutline?: NPt[];
  onFinish: (pts: NPt[], metres: Pt[]) => void;
  onCancel: () => void;
}) {
  const [pts, setPts] = useState<NPt[]>([]);
  const [measuring, setMeasuring] = useState(false);
  const [mpts, setMpts] = useState<NPt[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const need = mode === "ridge" ? 2 : 3;

  useEffect(() => {
    setPts([]);
  }, [mode]);

  function toMetres(list: NPt[]): Pt[] {
    const hM = siteWidthM / aspect;
    const raw = list.map((p) => ({ x: (p.u - 0.5) * siteWidthM, z: (p.v - 0.5) * hM }));
    return raw;
  }

  /** Distance between two normalised points, in metres. */
  function distM(a: NPt, b: NPt) {
    const hM = siteWidthM / aspect;
    return Math.hypot((b.u - a.u) * siteWidthM, (b.v - a.v) * hM);
  }

  function addPoint(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    if (measuring) {
      setMpts((m) => (m.length % 2 === 0 ? [...m, { u, v }] : [...m, { u, v }]));
      return;
    }
    setPts((p) => {
      const next = [...p, { u, v }];
      if (mode === "ridge" && next.length === 2) {
        setTimeout(() => onFinish(next, toMetres(next)), 0);
      }
      return next;
    });
  }

  function finish() {
    if (pts.length < need) return;
    onFinish(pts, toMetres(pts));
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Enter") finish();
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const poly = pts.map((p) => `${p.u * 100},${p.v * 100}`).join(" ");
  const ghost = (existingOutline ?? []).map((p) => `${p.u * 100},${p.v * 100}`).join(" ");

  // Edge labels for the shape being drawn.
  const edges: { a: NPt; b: NPt }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) edges.push({ a: pts[i], b: pts[i + 1] });
  if (mode !== "ridge" && pts.length > 2) edges.push({ a: pts[pts.length - 1], b: pts[0] });

  const mPairs: { a: NPt; b: NPt }[] = [];
  for (let i = 0; i + 1 < mpts.length; i += 2) mPairs.push({ a: mpts[i], b: mpts[i + 1] });

  /* ---------- 1 m grid lines in real-world coordinates ---------- */
  const hM = siteWidthM / aspect;
  const gridLines = useMemo(() => {
    const vLines: { u: number; m: number }[] = [];
    const hLines: { v: number; m: number }[] = [];
    const xMin = Math.ceil(-siteWidthM / 2);
    const xMax = Math.floor(siteWidthM / 2);
    for (let x = xMin; x <= xMax; x++) {
      vLines.push({ u: (x / siteWidthM + 0.5) * 100, m: x });
    }
    const zMin = Math.ceil(-hM / 2);
    const zMax = Math.floor(hM / 2);
    for (let z = zMin; z <= zMax; z++) {
      hLines.push({ v: (z / hM + 0.5) * 100, m: z });
    }
    return { vLines, hLines };
  }, [siteWidthM, hM]);


  return (
    <div className="space-y-2">
      <div
        ref={ref}
        onClick={addPoint}
        onDoubleClick={finish}
        className="relative mx-auto w-full max-w-[560px] cursor-crosshair select-none overflow-hidden rounded-lg border border-border bg-muted"
        style={{ aspectRatio: String(aspect) }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="Site plan" className="pointer-events-none h-full w-full object-cover" />
        ) : (
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px),linear-gradient(hsl(var(--border))_1px,transparent_1px)] bg-[length:24px_24px] opacity-60" />
        )}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          {/* 1 m grid lines */}
          <g>
            {gridLines.vLines.map(({ u, m }) => (
              <line
                key={`vx${m}`}
                x1={u}
                y1={0}
                x2={u}
                y2={100}
                stroke="#ffffff"
                strokeOpacity={m % 5 === 0 ? 0.85 : 0.4}
                strokeWidth={m % 5 === 0 ? 1.2 : 0.6}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {gridLines.hLines.map(({ v, m }) => (
              <line
                key={`hy${m}`}
                x1={0}
                y1={v}
                x2={100}
                y2={v}
                stroke="#ffffff"
                strokeOpacity={m % 5 === 0 ? 0.85 : 0.4}
                strokeWidth={m % 5 === 0 ? 1.2 : 0.6}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          {/* axis / 5 m labels */}
          <g>
            {gridLines.vLines
              .filter(({ m }) => m !== 0 && m % 5 === 0)
              .map(({ u, m }) => (
                <text key={`vl${m}`} x={u + 0.6} y={3} fill="hsl(var(--muted-foreground))" fontSize={2.2} fontWeight={500}>
                  {m}m
                </text>
              ))}
            {gridLines.hLines
              .filter(({ m }) => m !== 0 && m % 5 === 0)
              .map(({ v, m }) => (
                <text key={`hl${m}`} x={0.6} y={v - 0.6} fill="hsl(var(--muted-foreground))" fontSize={2.2} fontWeight={500}>
                  {m}m
                </text>
              ))}
          </g>
          {ghost && mode !== "outline" && (
            <polygon points={ghost} fill="rgba(56,189,248,0.15)" stroke="#38bdf8" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
          )}
          {pts.length > 1 &&
            (mode === "ridge" ? (
              <polyline points={poly} fill="none" stroke="#f97316" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            ) : (
              <polygon points={poly} fill="rgba(249,115,22,0.2)" stroke="#f97316" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            ))}
          {pts.map((p, i) => (
            <circle key={i} cx={p.u * 100} cy={p.v * 100} r={1} fill="#fff" stroke="#f97316" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
          ))}
          {mPairs.map((m, i) => (
            <line
              key={`m${i}`}
              x1={m.a.u * 100}
              y1={m.a.v * 100}
              x2={m.b.u * 100}
              y2={m.b.v * 100}
              stroke="#22c55e"
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {mpts.map((p, i) => (
            <circle key={`md${i}`} cx={p.u * 100} cy={p.v * 100} r={1} fill="#22c55e" stroke="#fff" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {/* Length labels (HTML so text isn't distorted by the viewBox) */}
        <div className="pointer-events-none absolute inset-0">
          {edges.map((e, i) => (
            <span
              key={`e${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-orange-500 px-1 py-px text-[9px] font-semibold text-white"
              style={{ left: `${((e.a.u + e.b.u) / 2) * 100}%`, top: `${((e.a.v + e.b.v) / 2) * 100}%` }}
            >
              {distM(e.a, e.b).toFixed(2)} m
            </span>
          ))}
          {mPairs.map((m, i) => (
            <span
              key={`ml${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-emerald-600 px-1 py-px text-[9px] font-semibold text-white"
              style={{ left: `${((m.a.u + m.b.u) / 2) * 100}%`, top: `${((m.a.v + m.b.v) / 2) * 100}%` }}
            >
              {distM(m.a, m.b).toFixed(2)} m
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-background/85 px-2 py-1 text-[11px] font-medium">
          {measuring
            ? `Ruler: tap two points to measure (${mpts.length % 2 === 0 ? "start" : "end"})`
            : mode === "ridge"
            ? `Click the ridge start and end (${pts.length}/2)`
            : mode === "storey"
              ? `Click corners of the extra building / upper storey · double-click or Enter to close (${pts.length})`
              : `Click roof corners · double-click or Enter to close (${pts.length})`}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={measuring ? "default" : "outline"}
          className="flex-1"
          onClick={() => setMeasuring((m) => !m)}
        >
          <Ruler className="mr-1.5 h-3.5 w-3.5" /> {measuring ? "Measuring" : "Measure"}
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => setMpts([])} disabled={!mpts.length}>
          Clear measures
        </Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => setPts((p) => p.slice(0, -1))} disabled={!pts.length}>
          <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Undo
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={onCancel}>
          <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
        </Button>
        <Button size="sm" className="flex-1" onClick={finish} disabled={pts.length < need}>
          <Check className="mr-1.5 h-3.5 w-3.5" /> Done
        </Button>
      </div>
    </div>
  );
}