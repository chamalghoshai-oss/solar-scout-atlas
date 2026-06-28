import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const reverseGeocode = createServerFn({ method: "GET" })
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !mapsKey) {
      return { address: null as string | null, error: "missing_credentials" as const };
    }
    const url = `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?latlng=${data.lat},${data.lng}&result_type=street_address|premise|subpremise|route`;
    try {
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": mapsKey,
        },
      });
      if (!r.ok) return { address: null, error: `http_${r.status}` as const };
      const j = (await r.json()) as { results?: Array<{ formatted_address?: string }> };
      return { address: j.results?.[0]?.formatted_address ?? null, error: null };
    } catch {
      return { address: null, error: "fetch_failed" as const };
    }
  });