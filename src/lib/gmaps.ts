/// <reference types="google.maps" />
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let configured = false;

function configure() {
  if (configured) return;
  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
  setOptions({ key, v: "weekly", ...(channel ? { channel } : {}) });
  configured = true;
}

export async function loadMaps() {
  configure();
  const [maps, marker] = await Promise.all([
    importLibrary("maps"),
    importLibrary("marker"),
  ]);
  return { maps, marker, g: google };
}

export async function loadDrawing() {
  configure();
  const [maps, drawing, geometry] = await Promise.all([
    importLibrary("maps"),
    importLibrary("drawing"),
    importLibrary("geometry"),
  ]);
  return { maps, drawing, geometry, g: google };
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