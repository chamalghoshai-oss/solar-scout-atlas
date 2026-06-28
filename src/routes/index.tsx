import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { LeadFormSheet, type LeadDraft } from "@/components/LeadFormSheet";
import { Loader2, Play, Square, Crosshair, Plus, Sun } from "lucide-react";
import { loadMaps, distM } from "@/lib/gmaps";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device";
import { snapToRoads } from "@/lib/roads.functions";
import { toast } from "sonner";

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
  const longPressFired = useRef(false);

  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [points, setPoints] = useState(0);
  const [distance, setDistance] = useState(0);
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openDraft = useCallback((lat: number, lng: number, type: "lead" | "potential") => {
    setDraft({ lat, lng, type });
    setSheetOpen(true);
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
        // map clicks → quick lead
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (longPressFired.current) {
            longPressFired.current = false;
            return;
          }
          if (!e.latLng) return;
          openDraft(e.latLng.lat(), e.latLng.lng(), "lead");
        });
        // long-press → potential
        const div = mapEl.current;
        const start_lp = () => {
          longPressFired.current = false;
          longPressTimer.current = window.setTimeout(() => {
            longPressFired.current = true;
            const c = map.getCenter();
            if (c) openDraft(c.lat(), c.lng(), "potential");
            navigator.vibrate?.(40);
          }, 700);
        };
        const cancel_lp = () => {
          if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        };
        div.addEventListener("touchstart", start_lp, { passive: true });
        div.addEventListener("touchend", cancel_lp);
        div.addEventListener("touchmove", cancel_lp);
        div.addEventListener("mousedown", start_lp);
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
    const device = getDeviceId();
    const { data } = await supabase.from("leads").select("id,lat,lng,type,status,name").eq("device_id", device);
    if (!data) return;
    const { g } = await loadMaps();
    for (const l of data) {
      new g.maps.Marker({
        position: { lat: Number(l.lat), lng: Number(l.lng) },
        map,
        icon: pinFor(l.type as string, l.status as string),
        title: l.name ?? (l.type === "potential" ? "Potential house" : "Lead"),
      });
    }
  }

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
    let firstPos: GeolocationPosition;
    try {
      firstPos = await getCurrentPosition();
    } catch (err) {
      toast.error(isGeoError(err) ? locationMessage(err) : err instanceof Error ? err.message : "Location unavailable");
      return;
    }
    const device = getDeviceId();
    const { data, error } = await supabase.from("runs").insert({ device_id: device }).select("id").single();
    if (error || !data) {
      toast.error("Could not start run");
      return;
    }
    runIdRef.current = data.id;
    distanceRef.current = 0;
    lastPointRef.current = null;
    breadcrumbRef.current?.setPath([]);
    setPoints(0);
    setDistance(0);
    setRunning(true);
    toast.success("Run started");
    onPosition(firstPos);
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
    await supabase.from("run_points").insert({
      run_id: rid,
      device_id: getDeviceId(),
      lat: c.lat,
      lng: c.lng,
      accuracy: pos.coords.accuracy ?? null,
    });
  }

  async function stopRun() {
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
        <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-between rounded-full bg-background/90 px-3 py-1.5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sun className="h-4 w-4 text-primary" />
            VertX Field
          </div>
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
        Tap map for a lead · long-press for a potential house
      </p>

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
