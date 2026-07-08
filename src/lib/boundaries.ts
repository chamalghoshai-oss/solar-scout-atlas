// Real administrative boundary outlines for the scope selector.
// Data sources:
// - Kerala districts & state: geohacker/kerala (OpenStreetMap-derived, ODbL)
// - India: datameet/maps (ODbL)
// These are fetched once and cached for the session.

import type { Scope } from "@/lib/scopes";

export type GeoJSONFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry: GeoJSONGeometry;
};

export type GeoJSONGeometry = {
  type: string;
  coordinates: unknown;
};

export type GeoJSONFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
};

const KL_DISTRICT_GEOJSON =
  "https://cdn.jsdelivr.net/gh/geohacker/kerala@master/geojsons/district.geojson";
const KL_STATE_GEOJSON =
  "https://cdn.jsdelivr.net/gh/geohacker/kerala@master/geojsons/state.geojson";
const INDIA_GEOJSON =
  "https://raw.githubusercontent.com/datameet/maps/master/Country/india-land-simplified.geojson";

const cache = new Map<string, GeoJSONFeatureCollection>();

const DISTRICT_NAME_MAP: Record<string, string> = {
  "kl-tvm": "Thiruvananthapuram",
  "kl-klm": "Kollam",
  "kl-ptm": "Pathanamthitta",
  "kl-alp": "Alappuzha",
  "kl-ktm": "Kottayam",
  "kl-idk": "Idukki",
  "kl-ekm": "Ernakulam",
  "kl-tsr": "Thrissur",
  "kl-pkd": "Palakkad",
  "kl-mpm": "Malappuram",
  "kl-kkd": "Kozhikode",
  "kl-wyd": "Wayanad",
  "kl-knr": "Kannur",
  "kl-ksd": "Kasaragod",
};

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function clearBoundaryCache() {
  cache.clear();
}

export async function loadBoundaryGeoJSON(
  scope: Scope
): Promise<GeoJSONFeatureCollection | null> {
  if (scope.id === "world") return null;

  const cached = cache.get(scope.id);
  if (cached) return cached;

  let url: string | null = null;
  let filter: ((feature: GeoJSONFeature) => boolean) | null = null;

  if (scope.group === "District") {
    const name = DISTRICT_NAME_MAP[scope.id];
    if (!name) return null;
    url = KL_DISTRICT_GEOJSON;
    const target = normalizeName(name);
    filter = (f) =>
      normalizeName(String(f.properties?.DISTRICT ?? "")) === target;
  } else if (scope.id === "kerala") {
    url = KL_STATE_GEOJSON;
    filter = (f) => f.properties?.ST_NM === "Kerala";
  } else if (scope.id === "india") {
    url = INDIA_GEOJSON;
    filter = null;
  } else {
    return null;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const fc = (await res.json()) as GeoJSONFeatureCollection;
    if (filter) {
      const features = fc.features.filter(filter);
      if (features.length === 0) return null;
      const filtered: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features,
      };
      cache.set(scope.id, filtered);
      return filtered;
    }
    cache.set(scope.id, fc);
    return fc;
  } catch (err) {
    console.error("Failed to load boundary for", scope.id, err);
    return null;
  }
}
