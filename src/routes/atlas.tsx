import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { loadMaps, cellKey } from "@/lib/gmaps";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device";
import { Loader2, Layers } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

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
    leadMarkers: google.maps.Marker[];
    potentialMarkers: google.maps.Marker[];
  }>({ runLines: [], heatMarkers: [], leadMarkers: [], potentialMarkers: [] });

  const [loading, setLoading] = useState(true);
  const [showRuns, setShowRuns] = useState(true);
  const [showHeat, setShowHeat] = useState(true);
  const [showLeads, setShowLeads] = useState(true);
  const [showPotential, setShowPotential] = useState(true);
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
        icon: pinFor(l.type as string, l.status as string),
        zIndex: 200,
      });
      (isPot ? layersRef.current.potentialMarkers : layersRef.current.leadMarkers).push(m);
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
    layersRef.current.leadMarkers.forEach((m) => m.setMap(showLeads ? mapRef.current : null));
  }, [showLeads]);
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

      <div className="absolute bottom-24 left-4 right-4 z-10 mx-auto max-w-md rounded-2xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Layers className="h-3.5 w-3.5" /> LAYERS
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Toggle id="l-runs" checked={showRuns} onChange={setShowRuns} label="Route trails" dot="#ea7a1d" />
          <Toggle id="l-heat" checked={showHeat} onChange={setShowHeat} label="Repeat heat" dot="#dc2626" />
          <Toggle id="l-leads" checked={showLeads} onChange={setShowLeads} label="Leads" dot="#ea7a1d" />
          <Toggle id="l-pot" checked={showPotential} onChange={setShowPotential} label="Potential" dot="#9ca3af" />
        </div>
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

function Toggle({ id, checked, onChange, label, dot }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; dot: string }) {
  return (
    <Label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
      <span className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />
        {label}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Label>
  );
}

function pinFor(type: string, status: string): google.maps.Symbol {
  const fill =
    type === "potential"
      ? "#9ca3af"
      : status === "converted"
      ? "#16a34a"
      : status === "follow_up"
      ? "#eab308"
      : status === "not_home"
      ? "#a78bfa"
      : status === "not_interested"
      ? "#6b7280"
      : "#ea7a1d";
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 7,
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: "#1c0f02",
    strokeWeight: 1.5,
  };
}