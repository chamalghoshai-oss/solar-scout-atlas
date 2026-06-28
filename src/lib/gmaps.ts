/// <reference types="google.maps" />

// Manual <script> bootstrap (callback-based) — the @googlemaps/js-api-loader
// v2 functional API was not reliably injecting the script tag in this app.

let scriptPromise: Promise<typeof google> | null = null;

function ensureMaps(): Promise<typeof google> {
  if (typeof window !== "undefined" && window.google?.maps) {
    return Promise.resolve(window.google);
  }
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<typeof google>((resolve, reject) => {
    const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
    const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
    if (!key) {
      reject(new Error("Missing VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"));
      return;
    }
    const cbName = "__vertxInitGmaps";
    (window as unknown as Record<string, unknown>)[cbName] = () => resolve(window.google);
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key,
      v: "weekly",
      libraries: "geometry,marker",
      loading: "async",
      callback: cbName,
    });
    if (channel) params.set("channel", channel);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load Google Maps JS"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export async function loadMaps() {
  const g = await ensureMaps();
  await g.maps.importLibrary?.("maps");
  return { maps: g.maps, marker: g.maps, g };
}

export async function loadDrawing() {
  const g = await ensureMaps();
  await Promise.all([
    g.maps.importLibrary?.("maps"),
    g.maps.importLibrary?.("geometry"),
  ]);
  return { maps: g.maps, geometry: g.maps.geometry, g };
}

// Haversine distance in meters
export function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Snap a lat/lng to a ~22m grid cell key
export function cellKey(lat: number, lng: number, precision = 4): string {
  const factor = Math.pow(10, precision);
  return `${Math.round(lat * factor) / factor}_${Math.round(lng * factor) / factor}`;
}