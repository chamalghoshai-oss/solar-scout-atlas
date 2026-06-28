import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { loadMaps, cellKey } from "@/lib/gmaps";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device";
import { Loader2, Layers, ChevronDown, ChevronUp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/atlas")({
  head: () => ({
    meta: [
      { title: "Atlas — Coverage Map" },
      { name: "description", content: "See every street you've covered, repeat-route hotspots, and untouched gray areas across all your marketing runs." },
      { property: "og:title", content: "Atlas — Coverage Map" },
      { property: "og:description", content: "Coverage view of all field-marketing runs with repeat-route heat." },
    ],
  }),
  component: AtlasPage,
});

function AtlasPage() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const layersRef = useRef<{
    runLines: google.maps.Polyline[];
    heatMarkers: google.maps.Marker[];
    leadMarkers: { marker: google.maps.Marker; status: string; type: string }[];
    potentialMarkers: google.maps.Marker[];
  }>({ runLines: [], heatMarkers: [], leadMarkers: [], potentialMarkers: [] });

  const [loading, setLoading] = useState(true);
  const [showRuns, setShowRuns] = useState(true);
  const [showHeat, setShowHeat] = useState(true);
  const [showLeads, setShowLeads] = useState(true);
  const [showPotential, setShowPotential] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Record<string, boolean>>({
    hot: true,
    warm: true,
    cold: true,
    reference: true,
    not_interested: true,
    other: true,
  });
  const [stats, setStats] = useState({ runs: 0, leads: 0, potential: 0, km: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { g } = await loadMaps();
      if (cancelled || !mapEl.current) return;
      const map = new g.maps.Map(mapEl.current, {
        center: { lat: 11.2588, lng: 75.7804 },
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: false,
        gestureHandling: "greedy",
        clickableIcons: false,
      });
      mapRef.current = map;
      await draw(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function draw(map: google.maps.Map) {
    const device = getDeviceId();
    const [runsR, pointsR, leadsR] = await Promise.all([
      supabase.from("runs").select("id,distance_m").eq("device_id", device),
      supabase.from("run_points").select("run_id,lat,lng,ts").eq("device_id", device).order("ts", { ascending: true }).limit(20000),
      supabase.from("leads").select("id,lat,lng,type,status,name").eq("device_id", device),
    ]);

    const runs = runsR.data ?? [];
    const points = pointsR.data ?? [];
    const leads = leadsR.data ?? [];

    // group points by run
    const byRun = new Map<string, { lat: number; lng: number }[]>();
    for (const p of points) {
      const arr = byRun.get(p.run_id) ?? [];
      arr.push({ lat: Number(p.lat), lng: Number(p.lng) });
      byRun.set(p.run_id, arr);
    }

    // polylines per run
    const { g } = await loadMaps();
    const bounds = new g.maps.LatLngBounds();
    for (const [, path] of byRun) {
      if (path.length < 2) continue;
      const line = new g.maps.Polyline({
        path,
        strokeColor: "#ea7a1d",
        strokeOpacity: 0.55,
        strokeWeight: 4,
        map,
      });
      layersRef.current.runLines.push(line);
      path.forEach((pt) => bounds.extend(pt));
    }

    // repeat-cell heat
    const cellCount = new Map<string, { count: number; lat: number; lng: number }>();
    for (const p of points) {
      const k = cellKey(Number(p.lat), Number(p.lng), 4);
      const cur = cellCount.get(k);
      if (cur) cur.count++;
      else cellCount.set(k, { count: 1, lat: Number(p.lat), lng: Number(p.lng) });
    }
    for (const { count, lat, lng } of cellCount.values()) {
      if (count < 2) continue;
      const color = count >= 5 ? "#dc2626" : count >= 3 ? "#f97316" : "#fbbf24";
      const m = new g.maps.Marker({
        position: { lat, lng },
        map,
        label: count >= 3 ? { text: String(count), color: "#1c0f02", fontSize: "11px", fontWeight: "700" } : undefined,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: Math.min(8 + count, 18),
          fillColor: color,
          fillOpacity: 0.55,
          strokeColor: color,
          strokeWeight: 1,
        },
        zIndex: 50,
      });
      layersRef.current.heatMarkers.push(m);
    }

    // lead pins
    for (const l of leads) {
      const isPot = l.type === "potential";
      const m = new g.maps.Marker({
        position: { lat: Number(l.lat), lng: Number(l.lng) },
        map,
        title: l.name ?? (isPot ? "Potential house" : "Lead"),
        icon: pinFor(l.type as string, l.status as string, l.name ?? null),
        label: undefined,
        zIndex: 200,
      });
      if (isPot) {
        layersRef.current.potentialMarkers.push(m);
      } else {
        layersRef.current.leadMarkers.push({ marker: m, status: String(l.status), type: String(l.type) });
      }
      bounds.extend({ lat: Number(l.lat), lng: Number(l.lng) });
    }

    if (!bounds.isEmpty()) map.fitBounds(bounds, 60);

    const km = runs.reduce((acc, r) => acc + Number(r.distance_m ?? 0), 0) / 1000;
    setStats({
      runs: runs.length,
      leads: leads.filter((l) => l.type !== "potential").length,
      potential: leads.filter((l) => l.type === "potential").length,
      km: Math.round(km * 10) / 10,
    });
  }

  useEffect(() => {
    layersRef.current.runLines.forEach((p) => p.setMap(showRuns ? mapRef.current : null));
  }, [showRuns]);
  useEffect(() => {
    layersRef.current.heatMarkers.forEach((m) => m.setMap(showHeat ? mapRef.current : null));
  }, [showHeat]);
  useEffect(() => {
    layersRef.current.leadMarkers.forEach(({ marker, status }) => {
      const key = statusKey(status);
      const visible = showLeads && (statusFilter[key] ?? true);
      marker.setMap(visible ? mapRef.current : null);
    });
  }, [showLeads, statusFilter]);
  useEffect(() => {
    layersRef.current.potentialMarkers.forEach((m) => m.setMap(showPotential ? mapRef.current : null));
  }, [showPotential]);

  return (
    <AppShell fullBleed>
      <div ref={mapEl} className="absolute inset-0 bg-muted" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto mx-auto max-w-md rounded-2xl bg-background/95 p-3 shadow-sm backdrop-blur">
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <Stat n={stats.runs} l="Runs" />
            <Stat n={`${stats.km}`} l="km" />
            <Stat n={stats.leads} l="Leads" />
            <Stat n={stats.potential} l="Pinned" />
          </div>
        </div>
      </div>

      <div className="absolute bottom-24 left-4 right-4 z-10 mx-auto max-w-md">
        {panelOpen ? (
          <div className="rounded-2xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Layers className="h-3.5 w-3.5" /> LAYERS &amp; FILTERS
              </div>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPanelOpen(false)}>
                <ChevronDown className="h-3.5 w-3.5" /> Hide
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Toggle id="l-runs" checked={showRuns} onChange={setShowRuns} label="Route trails" dot="#ea7a1d" />
              <Toggle id="l-heat" checked={showHeat} onChange={setShowHeat} label="Repeat heat" dot="#dc2626" />
              <Toggle id="l-leads" checked={showLeads} onChange={setShowLeads} label="Leads" dot="#ea7a1d" />
              <Toggle id="l-pot" checked={showPotential} onChange={setShowPotential} label="Potential" dot="#9ca3af" />
            </div>
            <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Lead status
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Toggle id="s-hot" checked={statusFilter.hot} onChange={(v) => setStatusFilter((s) => ({ ...s, hot: v }))} label="Hot" dot="#dc2626" />
              <Toggle id="s-warm" checked={statusFilter.warm} onChange={(v) => setStatusFilter((s) => ({ ...s, warm: v }))} label="Warm" dot="#f97316" />
              <Toggle id="s-cold" checked={statusFilter.cold} onChange={(v) => setStatusFilter((s) => ({ ...s, cold: v }))} label="Cold (quoted)" dot="#facc15" />
              <Toggle id="s-ref" checked={statusFilter.reference} onChange={(v) => setStatusFilter((s) => ({ ...s, reference: v }))} label="Reference" dot="#16a34a" square />
              <Toggle id="s-ni" checked={statusFilter.not_interested} onChange={(v) => setStatusFilter((s) => ({ ...s, not_interested: v }))} label="Not interested" dot="#6b7280" />
              <Toggle id="s-other" checked={statusFilter.other} onChange={(v) => setStatusFilter((s) => ({ ...s, other: v }))} label="Other" dot="#9ca3af" />
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" variant="default" className="h-9 rounded-full px-3 shadow" onClick={() => setPanelOpen(true)}>
              <Layers className="mr-1 h-4 w-4" /> Layers
              <ChevronUp className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ n, l }: { n: string | number; l: string }) {
  return (
    <div>
      <div className="text-lg font-bold tabular-nums">{n}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</div>
    </div>
  );
}

function Toggle({ id, checked, onChange, label, dot, square }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; dot: string; square?: boolean }) {
  return (
    <Label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
      <span className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 ${square ? "" : "rounded-full"}`}
          style={{ background: dot }}
        />
        {label}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Label>
  );
}

function statusKey(status: string): "hot" | "warm" | "cold" | "reference" | "not_interested" | "other" {
  // Map legacy statuses to the new buckets.
  switch (status) {
    case "hot":
    case "interested":
      return "hot";
    case "warm":
    case "follow_up":
    case "not_home":
      return "warm";
    case "cold":
    case "converted":
      return "cold";
    case "reference":
      return "reference";
    case "not_interested":
      return "not_interested";
    default:
      return "other";
  }
}

function statusColor(key: ReturnType<typeof statusKey>): string {
  return key === "hot"
    ? "#dc2626"
    : key === "warm"
    ? "#f97316"
    : key === "cold"
    ? "#facc15"
    : key === "reference"
    ? "#16a34a"
    : key === "not_interested"
    ? "#6b7280"
    : "#9ca3af";
}

function pinFor(type: string, status: string, name: string | null): google.maps.Icon {
  const key = type === "potential" ? "other" : statusKey(status);
  const fill = type === "potential" ? "#9ca3af" : statusColor(key);
  const isSquare = key === "reference";
  const label = (name ?? "").trim();
  const shape = isSquare
    ? `<rect x="3" y="8" width="14" height="14" fill="${fill}" stroke="#1c0f02" stroke-width="1.5"/>`
    : `<circle cx="10" cy="15" r="7" fill="${fill}" stroke="#1c0f02" stroke-width="1.5"/>`;
  const textNode = label
    ? `<text x="22" y="19" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="12" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${escapeXml(label)}</text>`
    : "";
  const width = label ? Math.min(200, 26 + label.length * 7) : 22;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30" viewBox="0 0 ${width} 30">${shape}${textNode}</svg>`;
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    anchor: new google.maps.Point(10, 15),
    scaledSize: new google.maps.Size(width, 30),
  };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;"
  );
}