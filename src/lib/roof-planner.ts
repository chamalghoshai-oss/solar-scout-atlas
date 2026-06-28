// Roof + panel layout geometry helpers (all distances in metres).
// Uses equirectangular projection around an anchor lat/lng — fine for roof scale.

export type LatLng = { lat: number; lng: number };
export type XY = { x: number; y: number };

export type PanelSpec = {
  /** Panel rated watts */
  watt: number;
  /** Long side in metres (slope direction) */
  length: number;
  /** Short side in metres (ridge direction) */
  width: number;
  /** Gap between rows in metres (anti-shading) */
  rowGap: number;
  /** Gap between panels in a row */
  colGap: number;
  /** Tilt in degrees from horizontal */
  tiltDeg: number;
  /** Azimuth panels face, in degrees from north (180 = south) */
  azimuthDeg: number;
  /** Orientation: portrait keeps panel long side along slope */
  orientation: "portrait" | "landscape";
};

export const DEFAULT_PANEL: PanelSpec = {
  watt: 550,
  length: 2.28,
  width: 1.13,
  rowGap: 0.3,
  colGap: 0.05,
  tiltDeg: 11,
  azimuthDeg: 180,
  orientation: "portrait",
};

const R = 6378137;

export function toXY(p: LatLng, anchor: LatLng): XY {
  const dLat = ((p.lat - anchor.lat) * Math.PI) / 180;
  const dLng = ((p.lng - anchor.lng) * Math.PI) / 180;
  const x = dLng * Math.cos((anchor.lat * Math.PI) / 180) * R;
  const y = dLat * R;
  return { x, y };
}

export function toLatLng(p: XY, anchor: LatLng): LatLng {
  const lat = anchor.lat + ((p.y / R) * 180) / Math.PI;
  const lng = anchor.lng + ((p.x / (R * Math.cos((anchor.lat * Math.PI) / 180))) * 180) / Math.PI;
  return { lat, lng };
}

function rotate(p: XY, deg: number): XY {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Ray-casting point-in-polygon */
export function pointInPoly(pt: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersect =
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polyCentroid(poly: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const p of poly) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / poly.length, lng: lng / poly.length };
}

/** Shoelace area in m² */
export function polyAreaM2(poly: LatLng[]): number {
  if (poly.length < 3) return 0;
  const anchor = polyCentroid(poly);
  const xy = poly.map((p) => toXY(p, anchor));
  let s = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    s += xy[j].x * xy[i].y - xy[i].x * xy[j].y;
  }
  return Math.abs(s) / 2;
}

export type PanelRect = {
  /** 4 corners in lat/lng order */
  corners: LatLng[];
  center: LatLng;
  /** unique id used for toggling */
  id: string;
};

/**
 * Fill a roof polygon (lat/lng) with panel rectangles oriented to the given azimuth.
 * Cutouts (obstacle polygons) are subtracted: a panel is dropped if its centre falls
 * inside any cutout polygon.
 */
export function layoutPanels(
  roof: LatLng[],
  spec: PanelSpec,
  cutouts: LatLng[][] = []
): PanelRect[] {
  if (roof.length < 3) return [];
  const anchor = polyCentroid(roof);

  // Plan-view panel footprint: slope-direction length shortens by cos(tilt).
  const cosT = Math.cos((spec.tiltDeg * Math.PI) / 180);
  // "portrait" => long side along slope (rotated by azimuth), so plan dims:
  //   slope-dir = length * cos(tilt), ridge-dir = width
  // "landscape" swaps which side is along the slope.
  const slopeDim = (spec.orientation === "portrait" ? spec.length : spec.width) * cosT;
  const ridgeDim = spec.orientation === "portrait" ? spec.width : spec.length;

  // Rotate polygon into panel-frame: panel rows run along ridge axis (east-west
  // when azimuth=180). We rotate by -(azimuth - 180) so south-facing arrays line
  // up with the +Y axis (north).
  const rot = -(spec.azimuthDeg - 180);
  const roofXY = roof.map((p) => rotate(toXY(p, anchor), rot));
  const cutXY = cutouts.map((c) => c.map((p) => rotate(toXY(p, anchor), rot)));

  const xs = roofXY.map((p) => p.x);
  const ys = roofXY.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const pitchX = ridgeDim + spec.colGap;
  const pitchY = slopeDim + spec.rowGap;
  if (pitchX <= 0 || pitchY <= 0) return [];

  // Small inset so panels don't kiss the eaves.
  const inset = 0.2;
  const out: PanelRect[] = [];
  let idx = 0;

  for (let y = minY + inset; y + slopeDim <= maxY - inset + 1e-6; y += pitchY) {
    for (let x = minX + inset; x + ridgeDim <= maxX - inset + 1e-6; x += pitchX) {
      const cx = x + ridgeDim / 2;
      const cy = y + slopeDim / 2;
      const cornersFrame: XY[] = [
        { x, y },
        { x: x + ridgeDim, y },
        { x: x + ridgeDim, y: y + slopeDim },
        { x, y: y + slopeDim },
      ];
      // All four corners + centre must be inside the roof.
      const allInside =
        pointInPoly({ x: cx, y: cy }, roofXY) &&
        cornersFrame.every((c) => pointInPoly(c, roofXY));
      if (!allInside) continue;
      // Skip if centre is inside any cutout.
      if (cutXY.some((c) => pointInPoly({ x: cx, y: cy }, c))) continue;

      // Rotate corners back to map frame and convert to lat/lng.
      const corners = cornersFrame
        .map((c) => rotate(c, -rot))
        .map((c) => toLatLng(c, anchor));
      const center = toLatLng(rotate({ x: cx, y: cy }, -rot), anchor);
      out.push({ corners, center, id: `p${idx++}` });
    }
  }
  return out;
}

export function totalKW(count: number, watt: number): number {
  return (count * watt) / 1000;
}