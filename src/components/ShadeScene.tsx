import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Sky } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import type { Obstruction } from "@/lib/sun";

export type RoofDims = {
  /** roof length in metres (ridge direction) */
  length: number;
  /** roof width in metres (slope direction) */
  width: number;
  /** wall height in metres */
  wallHeight: number;
  /** roof tilt in degrees */
  tiltDeg: number;
  /** roof azimuth in degrees from north (180 = facing south) */
  azimuthDeg: number;
};

export function ShadeScene({
  dims,
  obstruction,
  sunVec,
  altitude,
  panelCount,
}: {
  dims: RoofDims;
  obstruction: Obstruction;
  sunVec: [number, number, number];
  altitude: number;
  panelCount: number;
}) {
  const dayLight = altitude > 0;
  const span = Math.max(dims.length, dims.width, obstruction.distance + obstruction.width) + 12;
  return (
    <div className="h-[420px] w-full overflow-hidden rounded-lg border border-border bg-gradient-to-b from-sky-100 to-slate-200 dark:from-slate-900 dark:to-slate-950">
      <Canvas
        shadows
        camera={{ position: [dims.length * 1.4 + 6, dims.wallHeight + 10, dims.width * 1.6 + 10], fov: 45 }}
      >
        <Suspense fallback={null}>
          <Sky sunPosition={sunVec} turbidity={6} rayleigh={dayLight ? 1 : 6} />
          <ambientLight intensity={dayLight ? 0.35 : 0.12} />
          <hemisphereLight args={["#bcd9ff", "#4b5563", dayLight ? 0.5 : 0.15]} />
          {dayLight && (
            <directionalLight
              position={sunVec}
              intensity={1.4}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-span}
              shadow-camera-right={span}
              shadow-camera-top={span}
              shadow-camera-bottom={-span}
              shadow-camera-near={0.5}
              shadow-camera-far={200}
              shadow-bias={-0.0005}
            />
          )}

          {/* Ground */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
            <planeGeometry args={[span * 3, span * 3]} />
            <meshStandardMaterial color="#8ea88a" />
          </mesh>
          <Grid
            args={[span * 3, span * 3]}
            cellColor="#9ca3af"
            sectionColor="#6b7280"
            fadeDistance={span * 2.2}
            position={[0, 0.01, 0]}
          />

          <House dims={dims} panelCount={panelCount} />
          {obstruction.enabled && <Obstacle obs={obstruction} />}
          <Compass span={span} />

          <OrbitControls enablePan enableZoom maxPolarAngle={Math.PI / 2.05} minDistance={5} maxDistance={span * 3} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function House({ dims, panelCount }: { dims: RoofDims; panelCount: number }) {
  const { length: L, width: W, wallHeight: H, tiltDeg, azimuthDeg } = dims;
  // Scene rotation so the roof's downslope faces the requested azimuth.
  const yaw = ((180 - azimuthDeg) * Math.PI) / 180;
  const tilt = (tiltDeg * Math.PI) / 180;
  const slopeLen = W / Math.cos(tilt);

  const panels = useMemo(() => {
    const pw = 1.13;
    const pl = 2.28;
    const gap = 0.06;
    const cols = Math.max(1, Math.floor((L - 0.6) / (pw + gap)));
    const rows = Math.max(1, Math.ceil(panelCount / cols));
    const out: Array<[number, number]> = [];
    let placed = 0;
    for (let r = 0; r < rows && placed < panelCount; r++) {
      for (let c = 0; c < cols && placed < panelCount; c++) {
        const x = (c - (cols - 1) / 2) * (pw + gap);
        const z = (r - (rows - 1) / 2) * (pl + 0.3);
        if (Math.abs(z) > slopeLen / 2 - pl / 2) continue;
        out.push([x, z]);
        placed++;
      }
    }
    return out;
  }, [L, panelCount, slopeLen]);

  return (
    <group rotation={[0, yaw, 0]}>
      {/* Walls */}
      <mesh position={[0, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[L, H, W]} />
        <meshStandardMaterial color="#e7e5e4" />
      </mesh>
      {/* Tilted roof slab: rotate about the ridge axis (x) */}
      <group position={[0, H, 0]} rotation={[-tilt, 0, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[L + 0.4, 0.16, slopeLen]} />
          <meshStandardMaterial color="#7f1d1d" />
        </mesh>
        {panels.map(([x, z], i) => (
          <mesh key={i} position={[x, 0.14, z]} castShadow receiveShadow>
            <boxGeometry args={[1.13, 0.05, 2.28]} />
            <meshStandardMaterial color="#1e3a8a" metalness={0.55} roughness={0.3} />
          </mesh>
        ))}
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
      <meshStandardMaterial color="#3f6212" />
    </mesh>
  );
}

function Compass({ span }: { span: number }) {
  const r = span * 1.1;
  return (
    <group>
      {/* north marker (-z) */}
      <mesh position={[0, 0.2, -r]}>
        <coneGeometry args={[0.8, 2, 4]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
      {/* south marker (+z) */}
      <mesh position={[0, 0.2, r]}>
        <coneGeometry args={[0.6, 1.4, 4]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
    </group>
  );
}