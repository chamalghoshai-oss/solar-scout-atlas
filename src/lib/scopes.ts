// Geographic scope presets for map zoom + pin filtering.
// Bounds are approximate bounding boxes: [southLat, westLng, northLat, eastLng].

export type Scope = {
  id: string;
  label: string;
  group: "District" | "State" | "Country" | "Global";
  bounds: [number, number, number, number]; // [south, west, north, east]
};

export const SCOPES: Scope[] = [
  // Kerala districts
  { id: "kl-tvm", label: "Thiruvananthapuram", group: "District", bounds: [8.28, 76.75, 8.85, 77.35] },
  { id: "kl-klm", label: "Kollam", group: "District", bounds: [8.75, 76.45, 9.25, 77.30] },
  { id: "kl-ptm", label: "Pathanamthitta", group: "District", bounds: [9.15, 76.55, 9.55, 77.30] },
  { id: "kl-alp", label: "Alappuzha", group: "District", bounds: [9.05, 76.25, 9.90, 76.75] },
  { id: "kl-ktm", label: "Kottayam", group: "District", bounds: [9.30, 76.35, 9.95, 77.05] },
  { id: "kl-idk", label: "Idukki", group: "District", bounds: [9.40, 76.65, 10.35, 77.45] },
  { id: "kl-ekm", label: "Ernakulam", group: "District", bounds: [9.75, 76.10, 10.35, 76.90] },
  { id: "kl-tsr", label: "Thrissur", group: "District", bounds: [10.20, 75.85, 10.85, 76.75] },
  { id: "kl-pkd", label: "Palakkad", group: "District", bounds: [10.35, 76.15, 11.15, 77.15] },
  { id: "kl-mpm", label: "Malappuram", group: "District", bounds: [10.65, 75.80, 11.45, 76.75] },
  { id: "kl-kkd", label: "Kozhikode (Calicut)", group: "District", bounds: [11.10, 75.45, 11.80, 76.20] },
  { id: "kl-wyd", label: "Wayanad", group: "District", bounds: [11.55, 75.80, 12.05, 76.55] },
  { id: "kl-knr", label: "Kannur", group: "District", bounds: [11.65, 74.95, 12.35, 75.90] },
  { id: "kl-ksd", label: "Kasaragod", group: "District", bounds: [12.10, 74.85, 12.80, 75.75] },
  // State / country / world
  { id: "kerala", label: "Kerala", group: "State", bounds: [8.20, 74.85, 12.85, 77.45] },
  { id: "india", label: "India", group: "Country", bounds: [6.5, 68.0, 35.5, 97.5] },
  { id: "world", label: "World", group: "Global", bounds: [-60, -180, 75, 180] },
];

export const DEFAULT_SCOPE_ID = "kl-kkd";

export function getScope(id: string): Scope | undefined {
  return SCOPES.find((s) => s.id === id);
}

export function inScope(scope: Scope, lat: number, lng: number): boolean {
  const [s, w, n, e] = scope.bounds;
  return lat >= s && lat <= n && lng >= w && lng <= e;
}

export function scopeToLatLngBounds(scope: Scope): google.maps.LatLngBoundsLiteral {
  const [s, w, n, e] = scope.bounds;
  return { south: s, west: w, north: n, east: e };
}