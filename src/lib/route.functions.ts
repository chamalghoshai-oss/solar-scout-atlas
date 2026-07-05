import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Point = z.object({ lat: z.number(), lng: z.number() });
const Input = z.object({
  // Routes API allows up to 25 intermediates + origin + destination.
  points: z.array(Point).min(2).max(25),
  travelMode: z.enum(["DRIVE", "WALK", "BICYCLE", "TWO_WHEELER"]).optional(),
});

export type ComputedRoute = {
  encodedPolyline: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  error: string | null;
};

export const computeRoute = createServerFn({ method: "POST" })
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data }): Promise<ComputedRoute> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !mapsKey) {
      return { encodedPolyline: null, distanceMeters: null, durationSeconds: null, error: "missing_credentials" };
    }
    const pts = data.points;
    const origin = pts[0];
    const destination = pts[pts.length - 1];
    const intermediates = pts.slice(1, -1);
    const body = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      intermediates: intermediates.map((p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })),
      travelMode: data.travelMode ?? "DRIVE",
      polylineEncoding: "ENCODED_POLYLINE",
    };
    try {
      const r = await fetch("https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": mapsKey,
          "Content-Type": "application/json",
          "X-Goog-FieldMask": "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) return { encodedPolyline: null, distanceMeters: null, durationSeconds: null, error: `http_${r.status}` };
      const j = (await r.json()) as {
        routes?: Array<{
          polyline?: { encodedPolyline?: string };
          distanceMeters?: number;
          duration?: string;
        }>;
      };
      const route = j.routes?.[0];
      if (!route) return { encodedPolyline: null, distanceMeters: null, durationSeconds: null, error: "no_route" };
      const durStr = route.duration ?? null;
      const durSec = durStr && /^(\d+)s$/.test(durStr) ? Number(durStr.replace("s", "")) : null;
      return {
        encodedPolyline: route.polyline?.encodedPolyline ?? null,
        distanceMeters: route.distanceMeters ?? null,
        durationSeconds: durSec,
        error: null,
      };
    } catch {
      return { encodedPolyline: null, distanceMeters: null, durationSeconds: null, error: "fetch_failed" };
    }
  });