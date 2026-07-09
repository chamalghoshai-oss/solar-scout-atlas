import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import { Suspense } from "react";
import * as THREE from "three";

/**
 * Placeholder 3D scene shown while a real photogrammetric mesh isn't wired
 * yet. Renders a stylized roof + panel grid using the job's kW estimate so
 * reps get an immediate visual result. Replace `<PlaceholderRoof/>` with a
 * `useGLTF(meshUrl)` load once the provider returns a real model.
 */
export function SimViewer({ kwEstimate }: { kwEstimate?: number | null }) {
  const panelCount = Math.max(4, Math.round((kwEstimate ?? 5) / 0.55));
  const cols = Math.ceil(Math.sqrt(panelCount * 1.6));
  const rows = Math.ceil(panelCount / cols);
  return (
    <div className="h-[420px] w-full overflow-hidden rounded-lg border border-border bg-gradient-to-b from-sky-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
      <Canvas camera={{ position: [6, 5, 8], fov: 45 }} shadows>
        <Suspense fallback={null}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[8, 10, 6]} intensity={1.1} castShadow />
          <Environment preset="sunset" />
          <Grid args={[30, 30]} cellColor="#94a3b8" sectionColor="#64748b" fadeDistance={25} infiniteGrid />
          <PlaceholderRoof rows={rows} cols={cols} />
          <OrbitControls enablePan enableZoom minDistance={4} maxDistance={20} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function PlaceholderRoof({ rows, cols }: { rows: number; cols: number }) {
  const w = cols * 1.2 + 1.5;
  const d = rows * 1.6 + 1.5;
  const panelGeom = new THREE.BoxGeometry(1.0, 0.05, 1.4);
  return (
    <group position={[0, 0, 0]}>
      {/* House body */}
      <mesh position={[0, -0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 1, 1, d + 1]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      {/* Roof plane tilted 11° south */}
      <group rotation={[-(11 * Math.PI) / 180, 0, 0]} position={[0, 0.3, 0]}>
        <mesh receiveShadow>
          <boxGeometry args={[w, 0.1, d]} />
          <meshStandardMaterial color="#475569" />
        </mesh>
        {/* Panels grid */}
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => {
            const x = (c - (cols - 1) / 2) * 1.2;
            const z = (r - (rows - 1) / 2) * 1.6;
            return (
              <mesh
                key={`${r}-${c}`}
                geometry={panelGeom}
                position={[x, 0.13, z]}
                castShadow
              >
                <meshStandardMaterial color="#1e3a8a" metalness={0.5} roughness={0.35} />
              </mesh>
            );
          })
        )}
      </group>
    </group>
  );
}