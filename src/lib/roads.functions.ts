import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Point = z.object({ lat: z.number(), lng: z.number() });
const Input = z.object({
  // Roads API: max 100 points per request.
  points: z.array(Point).min(2).max(100),
  interpolate: z.boolean().optional(),
});

export type SnappedPoint = { lat: number; lng: number; originalIndex?: number; placeId?: string };

export const snapToRoads = createServerFn({ method: "POST" })
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data }): Promise<{ snapped: SnappedPoint[]; error: string | null }> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !mapsKey) {
      return { snapped: [], error: "missing_credentials" };
    }
    const path = data.points.map((p) => `${p.lat},${p.lng}`).join("|");
    const interp = data.interpolate === false ? "false" : "true";
    const url = `https://connector-gateway.lovable.dev/roads/v1/snapToRoads?path=${encodeURIComponent(path)}&interpolate=${interp}`;
    try {
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": mapsKey,
        },
      });
      if (!r.ok) return { snapped: [], error: `http_${r.status}` };
      const j = (await r.json()) as {
        snappedPoints?: Array<{
          location: { latitude: number; longitude: number };
          originalIndex?: number;
          placeId?: string;
        }>;
      };
      const snapped = (j.snappedPoints ?? []).map((s) => ({
        lat: s.location.latitude,
        lng: s.location.longitude,
        originalIndex: s.originalIndex,
        placeId: s.placeId,
      }));
      return { snapped, error: null };
    } catch {
      return { snapped: [], error: "fetch_failed" };
    }
  });