// Manual CAD solar-design model: geometry, roof generation, panel layout and
// analytic shading. Scene axes: +x = east, +z = south, +y = up. Metres.

import { sunPosition, dateFromDayHour, sunDir, type SunPos } from "@/lib/sun";

export type Pt = { x: number; z: number };
export type Vec3 = [number, number, number];

export type RoofType = "flat" | "sloped";

export type Ridge = { a: Pt; b: Pt; height: number };

export type Prim = {
  id: string;
  kind: "block" | "cylinder";
  x: number;
  z: number;
  /** placement base: on the roof surface or on the ground */
  base: "roof" | "ground";
  rotY: number; // degrees
  w: number; // block width (x, local)
  d: number; // block depth (z, local)
  r: number; // cylinder radius
  h: number; // height
};

export type Tree = {
  id: string;
  x: number;
  z: number;
  /** total height */
  h: number;
  /** canopy radius */
  r: number;
};

export type PanelSpec = {
  watt: number;
  width: number; // short side (m)
  length: number; // long side (m)
  gapX: number;
  gapZ: number;
};

export const DEFAULT_PANEL_SPEC: PanelSpec = {
  watt: 550,
  width: 1.13,
  length: 2.28,
  gapX: 0.04,
  gapZ: 0.06,
};

export type PanelGroup = {
  id: string;
  cols: number;
  rows: number;
  x: number;
  z: number;
  rotY: number; // degrees, 0 = rows run north-south
};

export type CadModel = {
  footprint: Pt[]; // metres, centred on footprint centroid
  roofType: RoofType;
  wallHeight: number;
  parapetHeight: number;
  parapetThickness: number;
  ridge: Ridge;
  prims: Prim[];
  trees: Tree[];
  groups: PanelGroup[];
  panel: PanelSpec;
};

export function emptyModel(): CadModel {
  return {
    footprint: [],
    roofType: "flat",
    wallHeight: 3.2,
    parapetHeight: 0.6,
    parapetThickness: 0.15,
    ridge: { a: { x: -3, z: 0 }, b: { x: 3, z: 0 }, height: 5.2 },
    prims: [],
    trees: [],
    groups: [],
    panel: { ...DEFAULT_PANEL_SPEC },
  };
}

export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ *
 * Polygon helpers (xz plane)
 * ------------------------------------------------------------------ */

export function centroid(pts: Pt[]): Pt {
  if (!pts.length) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    z += p.z;
  }
  return { x: x / pts.length, z: z / pts.length };
}

export function polyArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    s += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  }
  return Math.abs(s) / 2;
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const hit =
      a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

export function polyBounds(poly: Pt[]) {
  const xs = poly.map((p) => p.x);
  const zs = poly.map((p) => p.z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return { ...a };
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, z: a.z + t * dz };
}

/* ------------------------------------------------------------------ *
 * Roof surface generation
 * ------------------------------------------------------------------ */

export type RoofFace = {
  /** ordered vertices, world space */
  verts: Vec3[];
  normal: Vec3;
  /** horizontal projection used for hit-testing */
  poly: Pt[];
  tiltDeg: number;
  /** downslope compass azimuth in degrees from north */
  azimuthDeg: number;
};

function faceFromVerts(verts: Vec3[]): RoofFace | null {
  if (verts.length < 3) return null;
  const [a, b, c] = verts;
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-9) return null;
  n = [n[0] / len, n[1] / len, n[2] / len];
  if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
  const tiltDeg = (Math.acos(Math.max(-1, Math.min(1, n[1]))) * 180) / Math.PI;
  // downslope direction is the horizontal part of -normal
  const hx = n[0];
  const hz = n[2];
  let azimuthDeg = 180;
  if (Math.hypot(hx, hz) > 1e-6) {
    // scene: +x east, +z south → compass azimuth from north
    azimuthDeg = (Math.atan2(hx, -hz) * 180) / Math.PI;
    if (azimuthDeg < 0) azimuthDeg += 360;
  }
  return {
    verts,
    normal: n,
    poly: verts.map((p) => ({ x: p[0], z: p[2] })),
    tiltDeg,
    azimuthDeg,
  };
}

/** Roof faces for the current model. Flat = one horizontal face. */
export function buildRoofFaces(m: CadModel): RoofFace[] {
  const fp = m.footprint;
  if (fp.length < 3) return [];
  if (m.roofType === "flat") {
    const f = faceFromVerts(fp.map((p) => [p.x, m.wallHeight, p.z] as Vec3));
    return f ? [f] : [];
  }
  const out: RoofFace[] = [];
  const { a, b, height } = m.ridge;
  for (let i = 0; i < fp.length; i++) {
    const p1 = fp[i];
    const p2 = fp[(i + 1) % fp.length];
    const r1 = closestOnSegment(p1, a, b);
    const r2 = closestOnSegment(p2, a, b);
    const same = Math.hypot(r1.x - r2.x, r1.z - r2.z) < 0.05;
    const verts: Vec3[] = same
      ? [
          [p1.x, m.wallHeight, p1.z],
          [p2.x, m.wallHeight, p2.z],
          [r1.x, height, r1.z],
        ]
      : [
          [p1.x, m.wallHeight, p1.z],
          [p2.x, m.wallHeight, p2.z],
          [r2.x, height, r2.z],
          [r1.x, height, r1.z],
        ];
    const f = faceFromVerts(verts);
    if (f) out.push(f);
  }
  return out;
}

/** Surface height + normal at a horizontal point, or null when outside. */
export function roofSurfaceAt(
  m: CadModel,
  p: Pt,
  faces?: RoofFace[],
): { y: number; normal: Vec3; tiltDeg: number; azimuthDeg: number } | null {
  if (m.roofType === "flat") {
    if (!pointInPoly(p, m.footprint)) return null;
    return { y: m.wallHeight, normal: [0, 1, 0], tiltDeg: 0, azimuthDeg: 180 };
  }
  const fs = faces ?? buildRoofFaces(m);
  for (const f of fs) {
    if (!pointInPoly(p, f.poly)) continue;
    const [nx, ny, nz] = f.normal;
    if (Math.abs(ny) < 1e-6) continue;
    const v0 = f.verts[0];
    const y = v0[1] - (nx * (p.x - v0[0]) + nz * (p.z - v0[2])) / ny;
    return { y, normal: f.normal, tiltDeg: f.tiltDeg, azimuthDeg: f.azimuthDeg };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Panel layout
 * ------------------------------------------------------------------ */

export type PlacedPanel = {
  groupId: string;
  index: number;
  /** panel centre, world */
  pos: Vec3;
  /** yaw in radians */
  yaw: number;
  /** tilt in radians (rotation about local x) */
  tilt: number;
};

const PANEL_CLEARANCE = 0.06;

export function layoutGroup(m: CadModel, g: PanelGroup, faces?: RoofFace[]): PlacedPanel[] {
  const fs = faces ?? buildRoofFaces(m);
  const spec = m.panel;
  const out: PlacedPanel[] = [];
  const yaw = (g.rotY * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const pitchX = spec.width + spec.gapX;
  const pitchZ = spec.length + spec.gapZ;
  let index = 0;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const lx = (c - (g.cols - 1) / 2) * pitchX;
      const lz = (r - (g.rows - 1) / 2) * pitchZ;
      const x = g.x + lx * cos - lz * sin;
      const z = g.z + lx * sin + lz * cos;
      const surf = roofSurfaceAt(m, { x, z }, fs);
      if (!surf) {
        index++;
        continue;
      }
      if (m.roofType === "flat") {
        out.push({
          groupId: g.id,
          index,
          pos: [x, surf.y + PANEL_CLEARANCE, z],
          yaw,
          tilt: 0,
        });
      } else {
        // follow roof slope: yaw to the downslope azimuth, tilt = face tilt
        const faceYaw = ((180 - surf.azimuthDeg) * Math.PI) / 180;
        out.push({
          groupId: g.id,
          index,
          pos: [x, surf.y + PANEL_CLEARANCE, z],
          yaw: faceYaw,
          tilt: (surf.tiltDeg * Math.PI) / 180,
        });
      }
      index++;
    }
  }
  return out;
}

export function allPanels(m: CadModel, faces?: RoofFace[]): PlacedPanel[] {
  const fs = faces ?? buildRoofFaces(m);
  return m.groups.flatMap((g) => layoutGroup(m, g, fs));
}

export function systemKw(count: number, watt: number) {
  return (count * watt) / 1000;
}

/* ------------------------------------------------------------------ *
 * Shadow casters + analytic ray tests
 * ------------------------------------------------------------------ */

export type Caster =
  | { kind: "obb"; cx: number; cz: number; w: number; d: number; minY: number; maxY: number; rotY: number }
  | { kind: "cyl"; cx: number; cz: number; r: number; minY: number; maxY: number };

/** Ray/OBB (vertical axis aligned, yaw-rotated) */
function hitOBB(o: Vec3, dir: Vec3, c: Extract<Caster, { kind: "obb" }>): boolean {
  const a = (-c.rotY * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const ox = (o[0] - c.cx) * ca - (o[2] - c.cz) * sa;
  const oz = (o[0] - c.cx) * sa + (o[2] - c.cz) * ca;
  const dx = dir[0] * ca - dir[2] * sa;
  const dz = dir[0] * sa + dir[2] * ca;
  const lo = [-c.w / 2, c.minY, -c.d / 2];
  const hi = [c.w / 2, c.maxY, c.d / 2];
  const org = [ox, o[1], oz];
  const d = [dx, dir[1], dz];
  let tmin = 0;
  let tmax = 1e6;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (org[i] < lo[i] || org[i] > hi[i]) return false;
      continue;
    }
    let t1 = (lo[i] - org[i]) / d[i];
    let t2 = (hi[i] - org[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmax > 0.05;
}

/** Ray/vertical finite cylinder */
function hitCyl(o: Vec3, dir: Vec3, c: Extract<Caster, { kind: "cyl" }>): boolean {
  const ox = o[0] - c.cx;
  const oz = o[2] - c.cz;
  const a = dir[0] * dir[0] + dir[2] * dir[2];
  const b = 2 * (ox * dir[0] + oz * dir[2]);
  const cc = ox * ox + oz * oz - c.r * c.r;
  if (a < 1e-9) return cc <= 0 && o[1] < c.maxY;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  for (const t of [t1, t2]) {
    if (t < 0.05) continue;
    const y = o[1] + dir[1] * t;
    if (y >= c.minY && y <= c.maxY) return true;
  }
  return false;
}

export function rayBlocked(o: Vec3, dir: Vec3, casters: Caster[]): boolean {
  for (const c of casters) {
    if (c.kind === "obb" ? hitOBB(o, dir, c) : hitCyl(o, dir, c)) return true;
  }
  return false;
}

/** All shadow casters implied by the model (building, parapet, prims, trees). */
export function buildCasters(m: CadModel): Caster[] {
  const out: Caster[] = [];
  const fp = m.footprint;
  if (fp.length >= 3) {
    if (m.roofType === "flat" && m.parapetHeight > 0) {
      for (let i = 0; i < fp.length; i++) {
        const p1 = fp[i];
        const p2 = fp[(i + 1) % fp.length];
        const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        if (len < 0.05) continue;
        const ang = (Math.atan2(p2.x - p1.x, p2.z - p1.z) * 180) / Math.PI;
        out.push({
          kind: "obb",
          cx: (p1.x + p2.x) / 2,
          cz: (p1.z + p2.z) / 2,
          w: m.parapetThickness,
          d: len,
          minY: m.wallHeight,
          maxY: m.wallHeight + m.parapetHeight,
          rotY: ang,
        });
      }
    }
    if (m.roofType === "sloped") {
      // approximate the roof mass with a thin block along the ridge so the far
      // slope is correctly shaded in the morning/evening
      const { a, b, height } = m.ridge;
      const len = Math.max(0.5, Math.hypot(b.x - a.x, b.z - a.z));
      const ang = (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI;
      out.push({
        kind: "obb",
        cx: (a.x + b.x) / 2,
        cz: (a.z + b.z) / 2,
        w: 0.3,
        d: len,
        minY: m.wallHeight,
        maxY: height,
        rotY: ang,
      });
    }
  }
  for (const p of m.prims) {
    const base = primBaseY(m, p);
    if (p.kind === "block") {
      out.push({ kind: "obb", cx: p.x, cz: p.z, w: p.w, d: p.d, minY: base, maxY: base + p.h, rotY: p.rotY });
    } else {
      out.push({ kind: "cyl", cx: p.x, cz: p.z, r: p.r, minY: base, maxY: base + p.h });
    }
  }
  for (const t of m.trees) {
    out.push({ kind: "cyl", cx: t.x, cz: t.z, r: Math.max(0.15, t.r * 0.18), minY: 0, maxY: t.h * 0.55 });
    out.push({ kind: "cyl", cx: t.x, cz: t.z, r: t.r, minY: t.h * 0.45, maxY: t.h });
  }
  return out;
}

export function primBaseY(m: CadModel, p: Prim): number {
  if (p.base === "ground") return 0;
  const s = roofSurfaceAt(m, { x: p.x, z: p.z });
  return s ? s.y : m.wallHeight;
}

/* ------------------------------------------------------------------ *
 * Sun sampling + per-panel shading
 * ------------------------------------------------------------------ */

export type SunSample = { pos: SunPos; dir: Vec3; weight: number; month: number };

/** 6:00–18:00 only, 15th of each month, every 30 minutes. */
export function yearSamples(lat: number, lng: number, year = new Date().getFullYear()): SunSample[] {
  const out: SunSample[] = [];
  for (let m = 0; m < 12; m++) {
    const dayOfYear =
      Math.round((Date.UTC(year, m, 15) - Date.UTC(year, 0, 1)) / 86400000) + 1;
    for (let h = 6; h <= 18; h += 0.5) {
      const pos = sunPosition(dateFromDayHour(year, dayOfYear, h, lng), lat, lng);
      if (pos.altitude <= 0) continue;
      out.push({ pos, dir: sunDir(pos), weight: Math.sin(pos.altitude), month: m });
    }
  }
  return out;
}

export type PanelShade = {
  /** 0–1 share of weighted annual irradiance actually received */
  access: number;
};

/** Per-panel yearly sun access, ignoring the panels themselves as casters. */
export function panelShading(
  panels: PlacedPanel[],
  casters: Caster[],
  samples: SunSample[],
): number[] {
  return panels.map((p) => {
    let total = 0;
    let got = 0;
    const o: Vec3 = [p.pos[0], p.pos[1] + 0.05, p.pos[2]];
    for (const s of samples) {
      total += s.weight;
      if (!rayBlocked(o, s.dir, casters)) got += s.weight;
    }
    return total > 0 ? got / total : 0;
  });
}

/** Sun-access grid across the roof bounding box, used for the heat overlay. */
export function roofShadeGrid(
  m: CadModel,
  casters: Caster[],
  samples: SunSample[],
  cols: number,
  rows: number,
): { grid: Float32Array; bounds: ReturnType<typeof polyBounds> } | null {
  if (m.footprint.length < 3) return null;
  const bounds = polyBounds(m.footprint);
  const faces = buildRoofFaces(m);
  const grid = new Float32Array(cols * rows).fill(-1);
  for (let r = 0; r < rows; r++) {
    const z = bounds.minZ + ((r + 0.5) / rows) * (bounds.maxZ - bounds.minZ);
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + ((c + 0.5) / cols) * (bounds.maxX - bounds.minX);
      const surf = roofSurfaceAt(m, { x, z }, faces);
      if (!surf) continue;
      let total = 0;
      let got = 0;
      const o: Vec3 = [x, surf.y + 0.05, z];
      for (const s of samples) {
        total += s.weight;
        if (!rayBlocked(o, s.dir, casters)) got += s.weight;
      }
      grid[r * cols + c] = total > 0 ? got / total : 0;
    }
  }
  return { grid, bounds };
}

/** magenta → orange → yellow → green ramp (low → high sun access) */
export function shadeRamp(v: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [168, 24, 122]],
    [0.35, [214, 68, 74]],
    [0.55, [240, 138, 32]],
    [0.75, [246, 200, 44]],
    [0.9, [150, 200, 55]],
    [1.0, [46, 190, 90]],
  ];
  const t0 = Math.max(0, Math.min(1, v));
  for (let i = 1; i < stops.length; i++) {
    if (t0 <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (t0 - a) / (b - a || 1);
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t)) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

export function rampCss(v: number) {
  const [r, g, b] = shadeRamp(v);
  return `rgb(${r},${g},${b})`;
}