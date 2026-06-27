import { Loader } from "@googlemaps/js-api-loader";

let loaderPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (!loaderPromise) {
    const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string;
    const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
    const loader = new Loader({
      apiKey: key,
      version: "weekly",
      libraries: ["maps", "marker"],
      ...(channel ? { channel } : {}),
    });
    loaderPromise = loader.load();
  }
  return loaderPromise;
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