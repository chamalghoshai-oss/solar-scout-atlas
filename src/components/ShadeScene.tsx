import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sky, ContactShadows } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import {
  boxFrom,
  roofIrradianceGrid,
  yearSunSamples,
  type Box,
  type Obstruction,
} from "@/lib/sun";

export type RoofDims = {
  /** roof length in metres (east–west extent) */
  length: number;
  /** roof width in metres (north–south extent) */
  width: number;
  /** wall height in metres */
  wallHeight: number;
  /** panel rack tilt in degrees */
  tiltDeg: number;
  /** panel facing azimuth in degrees from north (180 = facing south) */
  azimuthDeg: number;
};

const PARAPET_H = 0.9;
const PARAPET_T = 0.35;

/** Rooftop clutter (AC units, tanks, vents) derived from the roof size. */
function rooftopUnits(L: number, W: number) {
  return [
    { x: -L * 0.3, z: -W * 0.32, w: Math.min(2.2, L * 0.22), d: Math.min(1.6, W * 0.2), h: 1.1, kind: "ac" as const },
    { x: L * 0.32, z: -W * 0.3, w: Math.min(1.6, L * 0.16), d: Math.min(1.6, W * 0.16), h: 1.6, kind: "tank" as const },
    { x: L * 0.18, z: W * 0.36, w: 0.7, d: 0.7, h: 0.9, kind: "vent" as const },
    { x: -L * 0.06, z: W * 0.3, w: 0.6, d: 0.6, h: 0.75, kind: "vent" as const },
  ].filter((u) => Math.abs(u.x) + u.w / 2 < L / 2 - 0.6 && Math.abs(u.z) + u.d / 2 < W / 2 - 0.6);
}

/** magenta → orange → yellow → green ramp (low → high irradiance) */
function ramp(v: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [168, 24, 122]],
    [0.35, [214, 68, 74]],
    [0.55, [240, 138, 32]],
    [0.75, [246, 200, 44]],
    [0.9, [150, 200, 55]],
    [1.0, [46, 190, 90]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (v - a) / (b - a || 1);
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t)) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

function useHeatmapTexture(dims: RoofDims, obstruction: Obstruction, lat: number, lng: number) {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const { length: L, width: W, wallHeight: H } = dims;
    const cols = 48;
    const rows = Math.max(12, Math.round((48 * W) / L));

    const boxes: Box[] = [];
    // parapet walls
    boxes.push(boxFrom(0, -W / 2 + PARAPET_T / 2, L, PARAPET_T, H, H + PARAPET_H));
    boxes.push(boxFrom(0, W / 2 - PARAPET_T / 2, L, PARAPET_T, H, H + PARAPET_H));
    boxes.push(boxFrom(-L / 2 + PARAPET_T / 2, 0, PARAPET_T, W, H, H + PARAPET_H));
    boxes.push(boxFrom(L / 2 - PARAPET_T / 2, 0, PARAPET_T, W, H, H + PARAPET_H));
    for (const u of rooftopUnits(L, W)) boxes.push(boxFrom(u.x, u.z, u.w, u.d, H, H + u.h));
    if (obstruction.enabled) {
      const b = (obstruction.bearingDeg * Math.PI) / 180;
      boxes.push(
        boxFrom(
          obstruction.distance * Math.sin(b),
          -obstruction.distance * Math.cos(b),
          obstruction.width,
          obstruction.width,
          0,
          obstruction.height,
        ),
      );
    }

    const samples = yearSunSamples(lat, lng);
    const grid = roofIrradianceGrid({ samples, boxes, length: L, width: W, y: H + 0.05, cols, rows });

    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < grid.length; i++) {
      const [r, g, b] = ramp(Math.min(1, Math.max(0, grid[i])));
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [dims, obstruction, lat, lng]);
}

export function ShadeScene({
  dims,
  obstruction,
  sunVec,
  altitude,
  panelCount,
  lat = 11.2588,
  lng = 75.7804,
}: {
  dims: RoofDims;
  obstruction: Obstruction;
  sunVec: [number, number, number];
  altitude: number;
  panelCount: number;
  lat?: number;
  lng?: number;
}) {
  const dayLight = altitude > 0;
  const span = Math.max(dims.length, dims.width, obstruction.distance + obstruction.width) + 12;
  const heat = useHeatmapTexture(dims, obstruction, lat, lng);

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-xl border border-border">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [dims.length * 1.1 + 8, dims.wallHeight + 14, dims.width * 1.4 + 12], fov: 42 }}
      >
        <Suspense fallback={null}>
          <Sky sunPosition={sunVec} turbidity={4} rayleigh={dayLight ? 0.6 : 5} mieCoefficient={0.008} />
          <fog attach="fog" args={["#dfe7ee", span * 2.2, span * 5]} />
          <ambientLight intensity={dayLight ? 0.55 : 0.15} />
          <hemisphereLight args={["#eaf3ff", "#9aa5ad", dayLight ? 0.75 : 0.2]} />
          {dayLight && (
            <directionalLight
              position={sunVec}
              intensity={1.8}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-span}
              shadow-camera-right={span}
              shadow-camera-top={span}
              shadow-camera-bottom={-span}
              shadow-camera-near={0.5}
              shadow-camera-far={300}
              shadow-bias={-0.0004}
            />
          )}

          <Ground span={span} />
          <ContactShadows position={[0, 0.02, 0]} scale={span * 2} blur={2.5} opacity={0.35} far={20} />

          <Building dims={dims} panelCount={panelCount} heat={heat} />
          {obstruction.enabled && <Obstacle obs={obstruction} />}
          <Compass span={span} />

          <OrbitControls
            enablePan
            enableZoom
            maxPolarAngle={Math.PI / 2.08}
            minDistance={6}
            maxDistance={span * 3}
            target={[0, dims.wallHeight * 0.5, 0]}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

function Ground({ span }: { span: number }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[span * 6, span * 6]} />
        <meshStandardMaterial color="#b9bfc2" roughness={1} />
      </mesh>
      {/* faint plot outline, like a site plan under the model */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[span * 0.9, span * 0.92, 64]} />
        <meshBasicMaterial color="#9aa3a8" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function Building({ dims, panelCount, heat }: { dims: RoofDims; panelCount: number; heat: THREE.Texture | null }) {
  const { length: L, width: W, wallHeight: H, tiltDeg, azimuthDeg } = dims;
  const units = rooftopUnits(L, W);

  const panels = useMemo(() => {
    const pw = 1.13;
    const pl = 2.28;
    const gapX = 0.04;
    const rowPitch = pl * Math.cos((tiltDeg * Math.PI) / 180) + 1.1;
    const usableL = L - 2 * PARAPET_T - 1.2;
    const usableW = W - 2 * PARAPET_T - 1.2;
    const cols = Math.max(1, Math.floor(usableL / (pw + gapX)));
    const maxRows = Math.max(1, Math.floor(usableW / rowPitch));
    const rows = Math.min(maxRows, Math.ceil(panelCount / cols));
    const out: Array<[number, number]> = [];
    let placed = 0;
    for (let r = 0; r < rows && placed < panelCount; r++) {
      const z = (r - (rows - 1) / 2) * rowPitch;
      for (let c = 0; c < cols && placed < panelCount; c++) {
        const x = (c - (cols - 1) / 2) * (pw + gapX);
        const clash = units.some(
          (u) => Math.abs(u.x - x) < (u.w + pw) / 2 + 0.4 && Math.abs(u.z - z) < (u.d + pl) / 2 + 0.4,
        );
        if (clash) continue;
        out.push([x, z]);
        placed++;
      }
    }
    return out;
  }, [L, W, tiltDeg, panelCount, units]);

  const yaw = ((180 - azimuthDeg) * Math.PI) / 180;
  const tilt = (tiltDeg * Math.PI) / 180;

  return (
    <group>
      {/* Walls */}
      <mesh position={[0, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[L, H, W]} />
        <meshStandardMaterial color="#d5d8da" roughness={0.85} />
      </mesh>

      {/* Roof deck with irradiance heat map */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, H + 0.02, 0]} receiveShadow>
        <planeGeometry args={[L, W]} />
        {heat ? (
          <meshStandardMaterial map={heat} roughness={0.95} />
        ) : (
          <meshStandardMaterial color="#e6a23c" roughness={0.95} />
        )}
      </mesh>

      {/* Parapet */}
      <Parapet L={L} W={W} H={H} />

      {/* Rooftop units */}
      {units.map((u, i) => (
        <mesh key={i} position={[u.x, H + u.h / 2, u.z]} castShadow receiveShadow>
          <boxGeometry args={[u.w, u.h, u.d]} />
          <meshStandardMaterial
            color={u.kind === "tank" ? "#e8e8e6" : "#c9ccce"}
            roughness={0.6}
            metalness={u.kind === "vent" ? 0.4 : 0.1}
          />
        </mesh>
      ))}

      {/* Tilted panel array on racking */}
      <group position={[0, H + 0.02, 0]} rotation={[0, yaw, 0]}>
        {panels.map(([x, z], i) => (
          <PanelOnRack key={i} x={x} z={z} tilt={tilt} />
        ))}
      </group>
    </group>
  );
}

function Parapet({ L, W, H }: { L: number; W: number; H: number }) {
  const mat = <meshStandardMaterial color="#eceeef" roughness={0.9} />;
  const cap = "#5b6469";
  return (
    <group>
      {[
        [0, -W / 2 + PARAPET_T / 2, L, PARAPET_T],
        [0, W / 2 - PARAPET_T / 2, L, PARAPET_T],
        [-L / 2 + PARAPET_T / 2, 0, PARAPET_T, W],
        [L / 2 - PARAPET_T / 2, 0, PARAPET_T, W],
      ].map(([x, z, w, d], i) => (
        <group key={i}>
          <mesh position={[x, H + PARAPET_H / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[w, PARAPET_H, d]} />
            {mat}
          </mesh>
          <mesh position={[x, H + PARAPET_H + 0.045, z]} castShadow>
            <boxGeometry args={[w + 0.08, 0.09, d + 0.08]} />
            <meshStandardMaterial color={cap} roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function PanelOnRack({ x, z, tilt }: { x: number; z: number; tilt: number }) {
  const pw = 1.13;
  const pl = 2.28;
  const front = 0.35;
  const rise = pl * Math.sin(tilt);
  const cy = front + rise / 2;
  return (
    <group position={[x, 0, z]}>
      {/* legs */}
      {[
        [-pw / 2 + 0.12, front, (pl / 2) * Math.cos(tilt)],
        [pw / 2 - 0.12, front, (pl / 2) * Math.cos(tilt)],
        [-pw / 2 + 0.12, front + rise, -(pl / 2) * Math.cos(tilt)],
        [pw / 2 - 0.12, front + rise, -(pl / 2) * Math.cos(tilt)],
      ].map(([lx, lh, lz], i) => (
        <mesh key={i} position={[lx, lh / 2, lz]} castShadow>
          <boxGeometry args={[0.05, lh, 0.05]} />
          <meshStandardMaterial color="#9aa1a6" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {/* module */}
      <group position={[0, cy, 0]} rotation={[tilt, 0, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[pw, 0.045, pl]} />
          <meshStandardMaterial color="#1b3d2a" metalness={0.35} roughness={0.28} />
        </mesh>
        <mesh position={[0, 0.026, 0]}>
          <boxGeometry args={[pw - 0.06, 0.005, pl - 0.06]} />
          <meshStandardMaterial color="#2e7d4f" metalness={0.5} roughness={0.18} />
        </mesh>
      </group>
    </group>
  );
}

function Obstacle({ obs }: { obs: Obstruction }) {
  const b = (obs.bearingDeg * Math.PI) / 180;
  const x = obs.distance * Math.sin(b);
  const z = -obs.distance * Math.cos(b);
  return (
    <mesh position={[x, obs.height / 2, z]} castShadow receiveShadow>
      <boxGeometry args={[obs.width, obs.height, obs.width]} />
      <meshStandardMaterial color="#c3c7c9" roughness={0.9} />
    </mesh>
  );
}

function Compass({ span }: { span: number }) {
  const r = span * 1.05;
  return (
    <group>
      <mesh position={[0, 0.2, -r]}>
        <coneGeometry args={[0.8, 2, 4]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
      <mesh position={[0, 0.2, r]}>
        <coneGeometry args={[0.6, 1.4, 4]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
    </group>
  );
}
