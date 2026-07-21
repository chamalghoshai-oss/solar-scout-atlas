import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { LeadFormSheet, type LeadDraft } from "@/components/LeadFormSheet";
import { Loader2, Play, Square, Crosshair, Plus, Sun, MapPin, X } from "lucide-react";
import { loadMaps, distM } from "@/lib/gmaps";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device";
import { snapToRoads } from "@/lib/roads.functions";
import { toast } from "sonner";
import { ScopeSelector } from "@/components/ScopeSelector";
import { DEFAULT_SCOPE_ID, SCOPES, getScope, inScope, scopeToLatLngBounds } from "@/lib/scopes";
import { loadBoundaryGeoJSON } from "@/lib/boundaries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live Run — VertX Field" },
      { name: "description", content: "Start a marketing run and capture solar leads as you walk the street." },
      { property: "og:title", content: "Live Run — VertX Field" },
      { property: "og:description", content: "Start a marketing run and capture solar leads as you walk the street." },
    ],
  }),
  component: LiveRun,
});

function LiveRun() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const breadcrumbRef = useRef<google.maps.Polyline | null>(null);
  const rawTrailRef = useRef<google.maps.Polyline | null>(null);
  const rawPointsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const snappedPointsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const snapTimerRef = useRef<number | null>(null);
  const snapInFlightRef = useRef(false);
  const meMarkerRef = useRef<google.maps.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const runIdRef = useRef<string | null>(null);
  const lastPointRef = useRef<{ lat: number; lng: number } | null>(null);
  const distanceRef = useRef(0);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const pinMarkerRef = useRef<google.maps.Marker | null>(null);

  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [points, setPoints] = useState(0);
  const [distance, setDistance] = useState(0);
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number } | null>(null);
  const [scopeId, setScopeId] = useState<string>(DEFAULT_SCOPE_ID);
  const scope = getScope(scopeId) ?? SCOPES[0];
  const leadMarkersRef = useRef<google.maps.Marker[]>([]);
  const scopeDataRef = useRef<google.maps.Data | null>(null);
  const boundaryRequestIdRef = useRef(0);

  const openDraft = useCallback((lat: number, lng: number, type: "lead" | "potential") => {
    setDraft({ lat, lng, type });
    setSheetOpen(true);
  }, []);

  const clearPin = useCallback(() => {
    pinMarkerRef.current?.setMap(null);
    pinMarkerRef.current = null;
    setPendingPin(null);
  }, []);

  const dropPin = useCallback(async (lat: number, lng: number) => {
    const { g } = await loadMaps();
    if (!mapRef.current) return;
    if (pinMarkerRef.current) pinMarkerRef.current.setMap(null);
    const m = new g.maps.Marker({
      position: { lat, lng },
      map: mapRef.current,
      draggable: true,
      animation: g.maps.Animation.DROP,
      zIndex: 1000,
    });
    m.addListener("dragend", () => {
      const p = m.getPosition();
      if (p) setPendingPin({ lat: p.lat(), lng: p.lng() });
    });
    pinMarkerRef.current = m;
    setPendingPin({ lat, lng });
    navigator.vibrate?.(40);
  }, []);

  // init map
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { g } = await loadMaps();
        if (cancelled || !mapEl.current) return;
        const start: google.maps.LatLngLiteral = { lat: 11.2588, lng: 75.7804 }; // Kozhikode default
        const map = new g.maps.Map(mapEl.current, {
          center: start,
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: false,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        mapRef.current = map;
        breadcrumbRef.current = new g.maps.Polyline({
          path: [],
          strokeColor: "#ea7a1d",
          strokeOpacity: 0.95,
          strokeWeight: 5,
          map,
        });
        rawTrailRef.current = new g.maps.Polyline({
          path: [],
          strokeColor: "#9ca3af",
          strokeOpacity: 0.6,
          strokeWeight: 2,
          map,
        });
        // long-press (single finger) → drop a draggable pin the user can reposition
        const div = mapEl.current;
        const cancel_lp = () => {
          if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
          longPressStart.current = null;
        };
        const dropAt = (clientX: number, clientY: number) => {
          const rect = div.getBoundingClientRect();
          const proj = map.getProjection();
          const bounds = map.getBounds();
          if (!proj || !bounds) return;
          const ne = proj.fromLatLngToPoint(bounds.getNorthEast());
          const sw = proj.fromLatLngToPoint(bounds.getSouthWest());
          if (!ne || !sw) return;
          const scale = Math.pow(2, map.getZoom() ?? 0);
          const worldX = sw.x + ((clientX - rect.left) / rect.width) * (ne.x - sw.x);
          const worldY = ne.y + ((clientY - rect.top) / rect.height) * (sw.y - ne.y);
          const ll = proj.fromPointToLatLng(new google.maps.Point(worldX, worldY));
          if (!ll) return;
          void dropPin(ll.lat(), ll.lng());
        };
        div.addEventListener("touchstart", (e) => {
          if (e.touches.length !== 1) {
            cancel_lp();
            return;
          }
          const t = e.touches[0];
          longPressStart.current = { x: t.clientX, y: t.clientY };
          longPressTimer.current = window.setTimeout(() => {
            const s = longPressStart.current;
            if (s) dropAt(s.x, s.y);
            cancel_lp();
          }, 550);
        }, { passive: true });
        div.addEventListener("touchmove", (e) => {
          if (e.touches.length > 1) { cancel_lp(); return; }
          const s = longPressStart.current;
          if (!s) return;
          const t = e.touches[0];
          if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) cancel_lp();
        }, { passive: true });
        div.addEventListener("touchend", cancel_lp);
        div.addEventListener("touchcancel", cancel_lp);
        div.addEventListener("mousedown", (e) => {
          longPressStart.current = { x: e.clientX, y: e.clientY };
          longPressTimer.current = window.setTimeout(() => {
            const s = longPressStart.current;
            if (s) dropAt(s.x, s.y);
            cancel_lp();
          }, 550);
        });
        div.addEventListener("mousemove", (e) => {
          const s = longPressStart.current;
          if (!s) return;
          if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel_lp();
        });
        div.addEventListener("mouseup", cancel_lp);
        div.addEventListener("mouseleave", cancel_lp);

        setReady(true);
        loadExistingLeads(map);
      } catch (e) {
        console.error(e);
        toast.error("Could not load map. Check Google Maps connection.");
      }
    })();
    return () => {
      cancelled = true;
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadExistingLeads(map: google.maps.Map) {
    const { data } = await supabase.from("leads").select("id,lat,lng,type,status,name");
    if (!data) return;
    const { g } = await loadMaps();
    // Clear previous
    leadMarkersRef.current.forEach((m) => m.setMap(null));
    leadMarkersRef.current = [];
    for (const l of data) {
      const lat = Number(l.lat);
      const lng = Number(l.lng);
      const visible = inScope(scope, lat, lng);
      const m = new g.maps.Marker({
        position: { lat, lng },
        map: visible ? map : null,
        icon: pinFor(l.type as string, l.status as string),
        title: l.name ?? (l.type === "potential" ? "Potential house" : "Lead"),
      });
      leadMarkersRef.current.push(m);
    }
  }

  // Zoom + filter pins + real boundary on scope change
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.fitBounds(scopeToLatLngBounds(scope), 20);
    const requestId = ++boundaryRequestIdRef.current;
    (async () => {
      const geo = await loadBoundaryGeoJSON(scope);
      if (!mapRef.current) return;
      if (boundaryRequestIdRef.current !== requestId) return;
      if (!scopeDataRef.current) {
        scopeDataRef.current = new google.maps.Data({ map: mapRef.current });
        scopeDataRef.current.setStyle((feature) => {
          const geom = feature.getGeometry();
          const isLine =
            geom?.getType() === "LineString" || geom?.getType() === "MultiLineString";
          return {
            strokeColor: "#ea7a1d",
            strokeOpacity: 0.9,
            strokeWeight: 2,
            fillColor: "#ea7a1d",
            fillOpacity: isLine ? 0 : 0.06,
            clickable: false,
            zIndex: 1,
          };
        });
      }
      scopeDataRef.current.forEach((f) => scopeDataRef.current?.remove(f));
      if (geo) scopeDataRef.current.addGeoJson(geo);
    })();
    leadMarkersRef.current.forEach((m) => {
      const p = m.getPosition();
      const ok = !!p && inScope(scope, p.lat(), p.lng());
      m.setMap(ok ? mapRef.current : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId, ready]);

  function locationMessage(err: GeolocationPositionError) {
    if (err.code === err.PERMISSION_DENIED) {
      return "Location is blocked. Allow location for this site, then tap locate again.";
    }
    if (err.code === err.POSITION_UNAVAILABLE) return "Location unavailable. Move outdoors or use Add lead at center.";
    if (err.code === err.TIMEOUT) return "Location timed out. Try again or use Add lead at center.";
    return err.message || "Location unavailable";
  }

  function isGeoError(err: unknown): err is GeolocationPositionError {
    return typeof err === "object" && err !== null && "code" in err && "message" in err;
  }

  function getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location is not supported on this device"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 12000,
      });
    });
  }

  async function recenter() {
    try {
      const pos = await getCurrentPosition();
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      mapRef.current?.panTo(c);
      mapRef.current?.setZoom(17);
      showMe(c);
    } catch (err) {
      toast.error(isGeoError(err) ? locationMessage(err) : err instanceof Error ? err.message : "Location unavailable");
    }
  }

  async function showMe(c: google.maps.LatLngLiteral) {
    const { g } = await loadMaps();
    if (!meMarkerRef.current) {
      meMarkerRef.current = new g.maps.Marker({
        position: c,
        map: mapRef.current,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#1d4ed8",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 999,
      });
    } else {
      meMarkerRef.current.setPosition(c);
    }
  }

  async function startRun() {
    const uid = (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) { toast.error("Please sign in again"); return; }
    const { data, error } = await supabase.from("runs").insert({ device_id: getDeviceId(), user_id: uid }).select("id").single();
    if (error || !data) {
      toast.error("Could not start run");
      return;
    }
    runIdRef.current = data.id;
    distanceRef.current = 0;
    lastPointRef.current = null;
    breadcrumbRef.current?.setPath([]);
    rawTrailRef.current?.setPath([]);
    rawPointsRef.current = [];
    snappedPointsRef.current = [];
    setPoints(0);
    setDistance(0);
    setRunning(true);
    toast.success("Run started");
    try {
      const firstPos = await getCurrentPosition();
      onPosition(firstPos);
    } catch {
      // no initial fix — watchPosition will report errors as they occur
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      onPosition,
      (err) => toast.error(locationMessage(err)),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }

  async function onPosition(pos: GeolocationPosition) {
    const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    showMe(c);
    mapRef.current?.panTo(c);
    const last = lastPointRef.current;
    if (last) {
      const d = distM(last, c);
      if (d < 6) return; // throttle
      distanceRef.current += d;
      setDistance(distanceRef.current);
    }
    lastPointRef.current = c;
    rawPointsRef.current.push(c);
    rawTrailRef.current?.getPath().push(new google.maps.LatLng(c.lat, c.lng));
    // Optimistic: extend the snapped polyline straight to the new point until the snap call returns.
    breadcrumbRef.current?.getPath().push(new google.maps.LatLng(c.lat, c.lng));
    scheduleSnap();
    setPoints((n) => n + 1);
    const rid = runIdRef.current;
    if (!rid) return;
    const uid = (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) return;
    await supabase.from("run_points").insert({
      run_id: rid,
      device_id: getDeviceId(),
      user_id: uid,
      lat: c.lat,
      lng: c.lng,
      accuracy: pos.coords.accuracy ?? null,
    });
  }

  async function stopRun() {
    if (snapTimerRef.current) window.clearTimeout(snapTimerRef.current);
    snapTimerRef.current = null;
    // Final pass so the saved trail is road-aligned.
    await runSnap();
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    const rid = runIdRef.current;
    if (rid) {
      await supabase.from("runs").update({ ended_at: new Date().toISOString(), distance_m: distanceRef.current }).eq("id", rid);
    }
    runIdRef.current = null;
    setRunning(false);
    toast.success(`Run ended · ${(distanceRef.current / 1000).toFixed(2)} km`);
  }

  function scheduleSnap() {
    if (snapTimerRef.current) window.clearTimeout(snapTimerRef.current);
    snapTimerRef.current = window.setTimeout(() => {
      void runSnap();
    }, 1500);
  }

  async function runSnap() {
    if (snapInFlightRef.current) {
      scheduleSnap();
      return;
    }
    const raw = rawPointsRef.current;
    if (raw.length < 2) return;
    const tail = raw.slice(-100);
    snapInFlightRef.current = true;
    try {
      const { snapped, error } = await snapToRoads({ data: { points: tail, interpolate: true } });
      if (error || snapped.length === 0) return;
      const olderCount = Math.max(0, raw.length - tail.length);
      const kept = snappedPointsRef.current.slice(0, olderCount);
      const next = [...kept, ...snapped.map((s) => ({ lat: s.lat, lng: s.lng }))];
      snappedPointsRef.current = next;
      breadcrumbRef.current?.setPath(next.map((p) => new google.maps.LatLng(p.lat, p.lng)));
    } finally {
      snapInFlightRef.current = false;
    }
  }

  function addAtCenter() {
    const c = mapRef.current?.getCenter();
    if (!c) return;
    openDraft(c.lat(), c.lng(), "lead");
  }

  return (
    <AppShell fullBleed>
      <div ref={mapEl} className="absolute inset-0 bg-muted" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* top brand pill */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-between gap-2 rounded-full bg-background/90 px-3 py-1.5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sun className="h-4 w-4 text-primary" />
            VertX Field
          </div>
          <ScopeSelector value={scopeId} onChange={setScopeId} />
          {running && (
            <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              {(distance / 1000).toFixed(2)} km · {points} pts
            </div>
          )}
        </div>
      </div>

      {/* recenter */}
      <button
        onClick={() => recenter()}
        className="absolute right-4 top-20 z-10 rounded-full border border-border bg-background/95 p-2.5 shadow"
        aria-label="Recenter"
      >
        <Crosshair className="h-5 w-5" />
      </button>

      {/* add at center */}
      <button
        onClick={addAtCenter}
        className="absolute right-4 top-36 z-10 rounded-full border border-border bg-background/95 p-2.5 shadow"
        aria-label="Add lead at center"
      >
        <Plus className="h-5 w-5" />
      </button>

      {/* start/stop */}
      <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center px-4">
        {!running ? (
          <Button size="lg" className="h-14 w-full max-w-sm rounded-full text-base font-semibold shadow-lg" onClick={startRun}>
            <Play className="mr-2 h-5 w-5" /> Start Marketing Run
          </Button>
        ) : (
          <Button size="lg" variant="destructive" className="h-14 w-full max-w-sm rounded-full text-base font-semibold shadow-lg" onClick={stopRun}>
            <Square className="mr-2 h-5 w-5" /> Stop Run
          </Button>
        )}
      </div>

      <p className="pointer-events-none absolute bottom-44 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
        Long-press to drop a pin, drag to place it exactly
      </p>

      {pendingPin && (
        <div className="absolute inset-x-0 bottom-40 z-20 flex justify-center px-4">
          <div className="pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-2xl border border-border bg-background/95 p-2 shadow-lg backdrop-blur">
            <div className="flex flex-1 items-center gap-2 pl-2 text-xs text-muted-foreground">
              <MapPin className="h-4 w-4 text-primary" />
              Drag the pin to place it
            </div>
            <Button size="sm" variant="ghost" onClick={clearPin} aria-label="Cancel pin">
              <X className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => { if (pendingPin) { openDraft(pendingPin.lat, pendingPin.lng, "potential"); clearPin(); } }}>
              Potential
            </Button>
            <Button size="sm" onClick={() => { if (pendingPin) { openDraft(pendingPin.lat, pendingPin.lng, "lead"); clearPin(); } }}>
              Lead
            </Button>
          </div>
        </div>
      )}

      <LeadFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        draft={draft}
        onSaved={() => {
          if (mapRef.current) loadExistingLeads(mapRef.current);
        }}
      />
    </AppShell>
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
    scale: 8,
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: "#1c0f02",
    strokeWeight: 1.5,
  };
}
