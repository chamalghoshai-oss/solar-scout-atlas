import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { loadMaps, loadDrawing, cellKey } from "@/lib/gmaps";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device";
import { Loader2, Layers, ChevronDown, ChevronUp, PenLine, Trash2, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { computeRoute } from "@/lib/route.functions";
import { ScopeSelector } from "@/components/ScopeSelector";
import { DEFAULT_SCOPE_ID, SCOPES, getScope, inScope, scopeToLatLngBounds } from "@/lib/scopes";

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
  const navigate = useNavigate();
  const layersRef = useRef<{
    runLines: { runId: string; line: google.maps.Polyline }[];
    heatMarkers: google.maps.Marker[];
    leadMarkers: { marker: google.maps.Marker; status: string; type: string }[];
    potentialMarkers: google.maps.Marker[];
  }>({ runLines: [], heatMarkers: [], leadMarkers: [], potentialMarkers: [] });

  // Manual route builder state
  const buildLineRef = useRef<google.maps.Polyline | null>(null);
  const buildMarkersRef = useRef<google.maps.Marker[]>([]);
  const buildPointsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const buildSnappedPathRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const buildSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildReqIdRef = useRef(0);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const buildModeRef = useRef(false);
  const [buildMode, setBuildMode] = useState(false);
  const [buildCount, setBuildCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [buildDistanceM, setBuildDistanceM] = useState(0);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const runsMetaRef = useRef<Map<string, { distanceM: number; startedAt: string | null; endedAt: string | null; leadsCount: number; pointsCount: number }>>(new Map());
  const computeRouteFn = useServerFn(computeRoute);
  const pressTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pressPositionRef = useRef<google.maps.LatLng | null>(null);
  const pressFiredRef = useRef(false);

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
  const [scopeId, setScopeId] = useState<string>(DEFAULT_SCOPE_ID);
  const scope = getScope(scopeId) ?? SCOPES[0];
  const scopeRectRef = useRef<google.maps.Rectangle | null>(null);

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

  function clearRunLayers() {
    layersRef.current.runLines.forEach(({ line }) => line.setMap(null));
    layersRef.current.heatMarkers.forEach((m) => m.setMap(null));
    layersRef.current.leadMarkers.forEach(({ marker }) => marker.setMap(null));
    layersRef.current.potentialMarkers.forEach((m) => m.setMap(null));
    layersRef.current.runLines = [];
    layersRef.current.heatMarkers = [];
    layersRef.current.leadMarkers = [];
    layersRef.current.potentialMarkers = [];
  }

  async function draw(map: google.maps.Map) {
    const [runsR, pointsR, leadsR] = await Promise.all([
      supabase.from("runs").select("id,distance_m,started_at,ended_at"),
      supabase.from("run_points").select("run_id,lat,lng,ts").order("ts", { ascending: true }).limit(20000),
      supabase.from("leads").select("id,lat,lng,type,status,name"),
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
    const { g } = await loadDrawing();
    const nonPotentialLeads = leads.filter((l) => l.type !== "potential");
    runsMetaRef.current.clear();
    const bounds = new g.maps.LatLngBounds();
    for (const [runId, path] of byRun) {
      if (path.length < 2) continue;
      const runRow = runs.find((r) => r.id === runId);
      // leads-in-route: within ~40m of any run point
      let leadsInRoute = 0;
      for (const lead of nonPotentialLeads) {
        const lp = { lat: Number(lead.lat), lng: Number(lead.lng) };
        let hit = false;
        for (const rp of path) {
          if (haversine(rp, lp) <= 40) { hit = true; break; }
        }
        if (hit) leadsInRoute++;
      }
      runsMetaRef.current.set(runId, {
        distanceM: Number(runRow?.distance_m ?? 0),
        startedAt: (runRow?.started_at as string | null) ?? null,
        endedAt: (runRow?.ended_at as string | null) ?? null,
        leadsCount: leadsInRoute,
        pointsCount: path.length,
      });
      const line = new g.maps.Polyline({
        path,
        strokeColor: "#ea7a1d",
        strokeOpacity: 0.55,
        strokeWeight: 4,
        map,
        clickable: true,
      });
      attachRunLineHandlers(runId, line);
      layersRef.current.runLines.push({ runId, line });
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
      if (!isPot) {
        m.addListener("click", () => {
          navigate({ to: "/leads/$id", params: { id: String(l.id) } });
        });
      }
      if (isPot) {
        layersRef.current.potentialMarkers.push(m);
      } else {
        layersRef.current.leadMarkers.push({ marker: m, status: String(l.status), type: String(l.type) });
      }
      bounds.extend({ lat: Number(l.lat), lng: Number(l.lng) });
    }

    // Initial framing is driven by the scope selector effect.

    const km = runs.reduce((acc, r) => acc + Number(r.distance_m ?? 0), 0) / 1000;
    setStats({
      runs: runs.length,
      leads: leads.filter((l) => l.type !== "potential").length,
      potential: leads.filter((l) => l.type === "potential").length,
      km: Math.round(km * 10) / 10,
    });
  }

  async function refresh() {
    if (!mapRef.current) return;
    clearRunLayers();
    await draw(mapRef.current);
  }

  async function promptDeleteRun(runId: string) {
    if (!confirm("Delete this route trail? This cannot be undone.")) return;
    const { error } = await supabase.from("runs").delete().eq("id", runId);
    if (error) {
      toast.error("Could not delete route", { description: error.message });
      return;
    }
    toast.success("Route deleted");
    await refresh();
  }

  function showRunInfo(runId: string, at: google.maps.LatLng) {
    if (!mapRef.current) return;
    const meta = runsMetaRef.current.get(runId);
    if (!meta) return;
    const km = (meta.distanceM / 1000).toFixed(meta.distanceM >= 10000 ? 1 : 2);
    let durText = "—";
    if (meta.startedAt && meta.endedAt) {
      const ms = new Date(meta.endedAt).getTime() - new Date(meta.startedAt).getTime();
      if (ms > 0 && Number.isFinite(ms)) durText = formatDuration(ms);
    }
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; min-width: 180px; padding: 2px 4px;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px;">Route</div>
        <div style="display: grid; grid-template-columns: auto auto; gap: 4px 12px; font-size: 13px;">
          <div style="color:#6b7280;">Length</div><div style="font-weight:600; text-align:right;">${km} km</div>
          <div style="color:#6b7280;">Leads on route</div><div style="font-weight:600; text-align:right;">${meta.leadsCount}</div>
          <div style="color:#6b7280;">Time</div><div style="font-weight:600; text-align:right;">${durText}</div>
          <div style="color:#6b7280;">Points</div><div style="font-weight:600; text-align:right;">${meta.pointsCount}</div>
        </div>
        <div style="margin-top:6px; font-size: 11px; color: #9ca3af;">Long-press the route to delete.</div>
      </div>`;
    if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();
    infoWindowRef.current.setContent(html);
    infoWindowRef.current.setPosition(at);
    infoWindowRef.current.open({ map: mapRef.current });
  }

  function attachRunLineHandlers(runId: string, line: google.maps.Polyline) {
    const LONG_PRESS_MS = 550;
    line.addListener("mousedown", (e: google.maps.PolyMouseEvent) => {
      if (buildModeRef.current) return;
      pressFiredRef.current = false;
      pressPositionRef.current = e.latLng ?? null;
      const t = setTimeout(() => {
        pressFiredRef.current = true;
        infoWindowRef.current?.close();
        promptDeleteRun(runId);
      }, LONG_PRESS_MS);
      pressTimersRef.current.set(runId, t);
    });
    const cancelPress = () => {
      const t = pressTimersRef.current.get(runId);
      if (t) {
        clearTimeout(t);
        pressTimersRef.current.delete(runId);
      }
    };
    line.addListener("mouseup", () => cancelPress());
    line.addListener("mouseout", () => cancelPress());
    line.addListener("click", (e: google.maps.PolyMouseEvent) => {
      if (buildModeRef.current) return;
      if (pressFiredRef.current) {
        pressFiredRef.current = false;
        return;
      }
      if (e.latLng) showRunInfo(runId, e.latLng);
    });
  }

  // Manual route builder
  async function enterBuildMode() {
    if (!mapRef.current) return;
    const { g } = await loadDrawing();
    buildModeRef.current = true;
    setBuildMode(true);
    buildPointsRef.current = [];
    buildSnappedPathRef.current = [];
    setBuildDistanceM(0);
    setBuildCount(0);
    buildLineRef.current = new g.maps.Polyline({
      path: [],
      strokeColor: "#2563eb",
      strokeOpacity: 0.9,
      strokeWeight: 5,
      map: mapRef.current,
      zIndex: 500,
    });
    clickListenerRef.current = mapRef.current.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng || !mapRef.current) return;
      const pt = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      buildPointsRef.current.push(pt);
      const idx = buildPointsRef.current.length;
      const m = new g.maps.Marker({
        position: pt,
        map: mapRef.current,
        draggable: true,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: "#2563eb",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: 600,
      });
      const localIdx = idx - 1;
      m.addListener("dragend", () => {
        const p = m.getPosition();
        if (!p) return;
        buildPointsRef.current[localIdx] = { lat: p.lat(), lng: p.lng() };
        scheduleSnap();
      });
      m.addListener("rightclick", () => removeBuildPoint(localIdx));
      buildMarkersRef.current.push(m);
      setBuildCount(buildPointsRef.current.length);
      scheduleSnap();
    });
    toast("Tap the map to add points — the route will follow real roads.");
  }

  function scheduleSnap() {
    if (buildSnapTimerRef.current) clearTimeout(buildSnapTimerRef.current);
    buildSnapTimerRef.current = setTimeout(() => {
      void refreshSnappedPath();
    }, 350);
  }

  async function refreshSnappedPath() {
    const pts = buildPointsRef.current;
    const line = buildLineRef.current;
    if (!line) return;
    if (pts.length < 2) {
      line.setPath(pts.map((p) => new google.maps.LatLng(p.lat, p.lng)));
      buildSnappedPathRef.current = pts.slice();
      const d = computePathDistance(pts);
      setBuildDistanceM(d);
      return;
    }
    const reqId = ++buildReqIdRef.current;
    setSnapping(true);
    try {
      // Routes API supports up to 25 waypoints; sample if needed.
      const sample = samplePoints(pts, 25);
      const res = await computeRouteFn({ data: { points: sample, travelMode: "DRIVE" } });
      if (reqId !== buildReqIdRef.current) return; // stale
      let snapped: Array<{ lat: number; lng: number }> = [];
      if (res.encodedPolyline && google.maps.geometry?.encoding) {
        const decoded = google.maps.geometry.encoding.decodePath(res.encodedPolyline);
        snapped = decoded.map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
      }
      if (snapped.length < 2) {
        // fallback: straight lines
        snapped = pts.slice();
      }
      buildSnappedPathRef.current = snapped;
      line.setPath(snapped.map((p) => new google.maps.LatLng(p.lat, p.lng)));
      setBuildDistanceM(res.distanceMeters ?? computePathDistance(snapped));
    } catch {
      // fallback to straight line
      buildSnappedPathRef.current = pts.slice();
      line.setPath(pts.map((p) => new google.maps.LatLng(p.lat, p.lng)));
      setBuildDistanceM(computePathDistance(pts));
    } finally {
      if (reqId === buildReqIdRef.current) setSnapping(false);
    }
  }

  function removeBuildPoint(idx: number) {
    const m = buildMarkersRef.current[idx];
    if (!m) return;
    m.setMap(null);
    buildMarkersRef.current.splice(idx, 1);
    buildPointsRef.current.splice(idx, 1);
    setBuildCount(buildPointsRef.current.length);
    scheduleSnap();
  }

  function undoBuildPoint() {
    if (buildPointsRef.current.length === 0) return;
    removeBuildPoint(buildPointsRef.current.length - 1);
  }

  function cancelBuildMode() {
    if (buildSnapTimerRef.current) {
      clearTimeout(buildSnapTimerRef.current);
      buildSnapTimerRef.current = null;
    }
    buildReqIdRef.current++;
    clickListenerRef.current?.remove();
    clickListenerRef.current = null;
    buildLineRef.current?.setMap(null);
    buildLineRef.current = null;
    buildMarkersRef.current.forEach((m) => m.setMap(null));
    buildMarkersRef.current = [];
    buildPointsRef.current = [];
    buildSnappedPathRef.current = [];
    setBuildDistanceM(0);
    setBuildCount(0);
    setSnapping(false);
    buildModeRef.current = false;
    setBuildMode(false);
  }

  async function saveBuildRoute() {
    if (buildPointsRef.current.length < 2) {
      toast.error("Add at least 2 points");
      return;
    }
    setSaving(true);
    try {
      const deviceId = getDeviceId();
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? null;

      // Prefer the snapped (road-following) path if available.
      const pathToSave =
        buildSnappedPathRef.current.length >= 2
          ? buildSnappedPathRef.current
          : buildPointsRef.current;
      const dist = computePathDistance(pathToSave);

      const { data: runIns, error: runErr } = await supabase
        .from("runs")
        .insert({ device_id: deviceId, user_id: userId, distance_m: Math.round(dist), ended_at: new Date().toISOString() })
        .select("id")
        .single();
      if (runErr || !runIns) throw runErr ?? new Error("Failed to create run");

      const baseTs = Date.now();
      const rows = pathToSave.map((p, i) => ({
        run_id: runIns.id,
        device_id: deviceId,
        user_id: userId,
        lat: p.lat,
        lng: p.lng,
        ts: new Date(baseTs + i * 1000).toISOString(),
      }));
      const { error: ptsErr } = await supabase.from("run_points").insert(rows);
      if (ptsErr) throw ptsErr;

      toast.success("Route saved");
      cancelBuildMode();
      await refresh();
    } catch (err) {
      toast.error("Could not save route", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function deleteAllRoutes() {
    const n = layersRef.current.runLines.length;
    if (n === 0) {
      toast("No route trails to delete");
      return;
    }
    if (!confirm(`Delete ALL ${n} route trails? This cannot be undone.`)) return;
    const ids = layersRef.current.runLines.map((r) => r.runId);
    const { error } = await supabase.from("runs").delete().in("id", ids);
    if (error) {
      toast.error("Could not delete trails", { description: error.message });
      return;
    }
    toast.success(`${n} trails deleted`);
    await refresh();
  }

  useEffect(() => {
    const map = mapRef.current;
    const lineInScope = (line: google.maps.Polyline) => {
      const path = line.getPath();
      for (let i = 0; i < path.getLength(); i++) {
        const ll = path.getAt(i);
        if (inScope(scope, ll.lat(), ll.lng())) return true;
      }
      return false;
    };
    layersRef.current.runLines.forEach(({ line }) => {
      line.setMap(showRuns && lineInScope(line) ? map : null);
    });
    layersRef.current.heatMarkers.forEach((m) => {
      const p = m.getPosition();
      const ok = !!p && inScope(scope, p.lat(), p.lng());
      m.setMap(showHeat && ok ? map : null);
    });
    layersRef.current.leadMarkers.forEach(({ marker, status }) => {
      const key = statusKey(status);
      const p = marker.getPosition();
      const inB = !!p && inScope(scope, p.lat(), p.lng());
      const visible = showLeads && inB && (statusFilter[key] ?? true);
      marker.setMap(visible ? map : null);
    });
    layersRef.current.potentialMarkers.forEach((m) => {
      const p = m.getPosition();
      const ok = !!p && inScope(scope, p.lat(), p.lng());
      m.setMap(showPotential && ok ? map : null);
    });
  }, [showRuns, showHeat, showLeads, showPotential, statusFilter, scope]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.fitBounds(scopeToLatLngBounds(scope), 20);
    const bounds = scopeToLatLngBounds(scope);
    if (!scopeRectRef.current) {
      scopeRectRef.current = new google.maps.Rectangle({
        bounds,
        map: mapRef.current,
        strokeColor: "#ea7a1d",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: "#ea7a1d",
        fillOpacity: 0.06,
        clickable: false,
        zIndex: 1,
      });
    } else {
      scopeRectRef.current.setBounds(bounds);
      scopeRectRef.current.setMap(mapRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId, loading]);

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
          <div className="mt-2 flex justify-center">
            <ScopeSelector value={scopeId} onChange={setScopeId} />
          </div>
        </div>
      </div>

      <div className="absolute bottom-24 left-4 right-4 z-10 mx-auto max-w-md">
        {buildMode ? (
          <div className="rounded-2xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                BUILDING ROUTE — {buildCount} point{buildCount === 1 ? "" : "s"}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {snapping ? (
                  <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> snapping…</span>
                ) : buildDistanceM > 0 ? (
                  <span className="tabular-nums">{(buildDistanceM / 1000).toFixed(2)} km</span>
                ) : null}
              </div>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Tap the map to add points — the route auto-follows real roads between them. Drag a point to adjust.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={undoBuildPoint} disabled={buildCount === 0 || saving}>
                Undo
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={cancelBuildMode} disabled={saving}>
                <X className="mr-1 h-3.5 w-3.5" /> Cancel
              </Button>
              <Button size="sm" className="flex-1" onClick={saveBuildRoute} disabled={buildCount < 2 || saving}>
                {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                Save
              </Button>
            </div>
          </div>
        ) : panelOpen ? (
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
              <Toggle id="l-pot" checked={showPotential} onChange={setShowPotential} label="Potential" dot="#3b82f6" />
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
              <Toggle id="s-other" checked={statusFilter.other} onChange={(v) => setStatusFilter((s) => ({ ...s, other: v }))} label="Potential houses" dot="#3b82f6" />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" className="flex-1" onClick={enterBuildMode}>
                <PenLine className="mr-1 h-3.5 w-3.5" /> Build route
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-destructive hover:text-destructive" onClick={deleteAllRoutes}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete all trails
              </Button>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Tip: tap any orange route trail on the map to delete just that one.
            </p>
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

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function computePathDistance(pts: Array<{ lat: number; lng: number }>): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}

function samplePoints<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
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
  const fill = type === "potential" ? "#3b82f6" : statusColor(key);
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