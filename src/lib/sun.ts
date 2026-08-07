// Solar position (NOAA / SunCalc-style formulas). All angles in radians unless noted.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = RAD * 23.4397; // obliquity of the Earth

function toJulian(date: Date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970;
}
function toDays(date: Date) {
  return toJulian(date) - J2000;
}
function solarMeanAnomaly(d: number) {
  return RAD * (357.5291 + 0.98560028 * d);
}
function eclipticLongitude(M: number) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}
function declination(L: number, b: number) {
  return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(L));
}
function rightAscension(L: number, b: number) {
  return Math.atan2(Math.sin(L) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(L));
}
function siderealTime(d: number, lw: number) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

export type SunPos = {
  /** radians above the horizon (negative = below) */
  altitude: number;
  /** radians, measured clockwise from north (0 = N, PI/2 = E, PI = S) */
  azimuth: number;
};

export function sunPosition(date: Date, lat: number, lng: number): SunPos {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const ra = rightAscension(L, 0);
  const H = siderealTime(d, lw) - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // SunCalc azimuth is measured from south; convert to compass-from-north.
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  let azimuth = azSouth + Math.PI; // now 0 = north, increasing clockwise
  if (azimuth < 0) azimuth += 2 * Math.PI;
  if (azimuth >= 2 * Math.PI) azimuth -= 2 * Math.PI;
  return { altitude, azimuth };
}

/**
 * Date for a given day-of-year + decimal clock hour *at the site*, independent of
 * the device timezone. The site offset is derived from its longitude (15° per hour),
 * so 12:00 always means local midday-ish at the roof, not on the phone.
 */
export function dateFromDayHour(year: number, dayOfYear: number, hour: number, lng = 0): Date {
  const offsetH = Math.round(lng / 15);
  const dayIdx = Math.max(0, Math.round(dayOfYear) - 1);
  const utcMs = Date.UTC(year, 0, 1) + dayIdx * DAY_MS + (hour - offsetH) * 3600000;
  return new Date(utcMs);
}

/** Scene-space sun direction. Scene axes: +x = east, +z = south, +y = up. */
export function sunVector(pos: SunPos, distance = 60): [number, number, number] {
  const cosAlt = Math.cos(pos.altitude);
  const x = distance * cosAlt * Math.sin(pos.azimuth); // east component
  const z = -distance * cosAlt * Math.cos(pos.azimuth); // north is -z, so south is +z
  const y = distance * Math.sin(pos.altitude);
  return [x, y, z];
}

export type Obstruction = {
  enabled: boolean;
  /** metres tall, measured above roof base level */
  height: number;
  /** metres from the roof centre */
  distance: number;
  /** compass bearing in degrees from the roof to the obstruction */
  bearingDeg: number;
  /** width in metres */
  width: number;
};

/** True when the obstruction blocks direct sun at the roof centre. */
export function isShaded(pos: SunPos, obs: Obstruction): boolean {
  if (!obs.enabled || pos.altitude <= 0) return false;
  const bearing = obs.bearingDeg * RAD;
  let dAz = Math.abs(pos.azimuth - bearing);
  if (dAz > Math.PI) dAz = 2 * Math.PI - dAz;
  const halfAngle = Math.atan2(obs.width / 2, obs.distance);
  if (dAz > halfAngle) return false;
  const blockAngle = Math.atan2(obs.height, obs.distance);
  return pos.altitude < blockAngle;
}

export type ShadeSummary = {
  /** percentage of 6am–6pm daylight hours with direct sun, averaged over the year */
  sunPercent: number;
  /** per-month percentage, January first */
  monthly: number[];
};

/** Sample every 15 min from 06:00–18:00 for the 15th of each month. */
export function annualShade(lat: number, lng: number, obs: Obstruction, year = new Date().getFullYear()): ShadeSummary {
  const monthly: number[] = [];
  for (let m = 0; m < 12; m++) {
    let daylight = 0;
    let sunny = 0;
    for (let h = 6; h <= 18; h += 0.25) {
      const dayOfYear = Math.round((Date.UTC(year, m, 15) - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
      const d = dateFromDayHour(year, dayOfYear, h, lng);
      const p = sunPosition(d, lat, lng);
      if (p.altitude <= 0) continue;
      daylight++;
      if (!isShaded(p, obs)) sunny++;
    }
    monthly.push(daylight ? Math.round((sunny / daylight) * 100) : 0);
  }
  const sunPercent = Math.round(monthly.reduce((a, b) => a + b, 0) / 12);
  return { sunPercent, monthly };
}

export const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

// Axis-aligned box shading + roof irradiance grid (Arka-style heat map).
// Scene axes: +x = east, +z = south, +y = up.

export type Box = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export function boxFrom(cx: number, cz: number, w: number, d: number, base: number, top: number): Box {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: base, maxY: top };
}

/** Slab-method ray/AABB test; true when the ray leaving `o` along `d` hits `b`. */
export function rayHitsBox(o: [number, number, number], d: [number, number, number], b: Box): boolean {
  let tmin = 0;
  let tmax = 1e6;
  const lo = [b.minX, b.minY, b.minZ];
  const hi = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    const di = d[i];
    const oi = o[i];
    if (Math.abs(di) < 1e-9) {
      if (oi < lo[i] || oi > hi[i]) return false;
      continue;
    }
    let t1 = (lo[i] - oi) / di;
    let t2 = (hi[i] - oi) / di;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmax > 0.02;
}

/** Unit vector pointing from the site toward the sun, in scene axes. */
export function sunDir(pos: SunPos): [number, number, number] {
  const cosAlt = Math.cos(pos.altitude);
  return [cosAlt * Math.sin(pos.azimuth), Math.sin(pos.altitude), -cosAlt * Math.cos(pos.azimuth)];
}

export function pointShaded(pos: SunPos, boxes: Box[], p: [number, number, number]): boolean {
  if (pos.altitude <= 0) return true;
  const d = sunDir(pos);
  for (const b of boxes) if (rayHitsBox(p, d, b)) return true;
  return false;
}

/** Sun positions sampled across the year (15th of each month, every 30 min 6–18). */
export function yearSunSamples(lat: number, lng: number, year = new Date().getFullYear()): SunPos[] {
  const out: SunPos[] = [];
  for (let m = 0; m < 12; m++) {
    const dayOfYear = Math.round((Date.UTC(year, m, 15) - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
    for (let h = 6; h <= 18; h += 0.5) {
      const p = sunPosition(dateFromDayHour(year, dayOfYear, h, lng), lat, lng);
      if (p.altitude > 0) out.push(p);
    }
  }
  return out;
}

/**
 * Per-cell yearly sun access (0–1) across a rectangular roof plane, weighted by
 * the sine of the sun altitude (irradiance proxy on a horizontal surface).
 */
export function roofIrradianceGrid(opts: {
  samples: SunPos[];
  boxes: Box[];
  length: number;
  width: number;
  y: number;
  cols: number;
  rows: number;
}): Float32Array {
  const { samples, boxes, length, width, y, cols, rows } = opts;
  const grid = new Float32Array(cols * rows);
  let maxV = 1e-6;
  for (let r = 0; r < rows; r++) {
    const z = -width / 2 + ((r + 0.5) / rows) * width;
    for (let c = 0; c < cols; c++) {
      const x = -length / 2 + ((c + 0.5) / cols) * length;
      let sum = 0;
      for (const s of samples) {
        if (pointShaded(s, boxes, [x, y, z])) continue;
        sum += Math.sin(s.altitude);
      }
      grid[r * cols + c] = sum;
      if (sum > maxV) maxV = sum;
    }
  }
  for (let i = 0; i < grid.length; i++) grid[i] /= maxV;
  return grid;
}