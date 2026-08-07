import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Undo2, X, Check } from "lucide-react";
import type { Pt } from "@/lib/cad-model";

export type DrawMode = "outline" | "ridge";

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

  function addPoint(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
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

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        onClick={addPoint}
        onDoubleClick={finish}
        className="relative w-full cursor-crosshair select-none overflow-hidden rounded-lg border border-border bg-muted"
        style={{ aspectRatio: String(aspect) }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="Site plan" className="pointer-events-none h-full w-full object-cover" />
        ) : (
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px),linear-gradient(hsl(var(--border))_1px,transparent_1px)] bg-[length:24px_24px] opacity-60" />
        )}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          {ghost && mode === "ridge" && (
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
        </svg>
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-background/85 px-2 py-1 text-[11px] font-medium">
          {mode === "ridge"
            ? `Click the ridge start and end (${pts.length}/2)`
            : `Click roof corners · double-click or Enter to close (${pts.length})`}
        </div>
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