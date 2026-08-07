import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Sky } from "@react-three/drei";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  buildRoofFaces,
  centroid,
  FOOTING_M,
  MOUNT_CLEARANCE,
  PANEL_TILT_DEG,
  polyBounds,
  primBaseY,
  rafterCount,
  roofSurfaceAt,
  shadeRamp,
  storeyBaseY,
  type CadModel,
  type PanelGroup,
  type PlacedPanel,
  type Prim,
  type Storey,
  type Tree,
  type Vec3,
} from "@/lib/cad-model";

export type Selection = { kind: "prim" | "tree" | "group"; id: string } | null;

/* ---------------- textures ---------------- */

/** Roof tile checks sized to 1 ft x 0.75 ft. */
const TILE_W = 0.3048;
const TILE_H = 0.2286;

function brickTexture(dx: number, dz: number): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#c96a3f";
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = "#e8d3c0";
  ctx.lineWidth = 2;
  for (let row = 0; row < 4; row++) {
    const y = row * 16;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y);
    ctx.stroke();
    const off = row % 2 === 0 ? 0 : 16;
    for (let x = off; x < 128; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 16);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // canvas holds 4 x 4 checks; scale so each check is TILE_W x TILE_H metres
  t.repeat.set(Math.max(1, dx / (4 * TILE_W)), Math.max(1, dz / (4 * TILE_H)));
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function heatTexture(grid: Float32Array | null, cols: number, rows: number): THREE.Texture | null {
  if (!grid || typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(cols, rows);
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v < 0) {
      img.data[i * 4 + 3] = 0;
      continue;
    }
    const [r, g, b] = shadeRamp(v);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 235;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- geometry builders ---------------- */

function shapeFromPts(pts: { x: number; z: number }[]) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i === 0 ? s.moveTo(p.x, -p.z) : s.lineTo(p.x, -p.z)));
  s.closePath();
  return s;
}

function footprintShape(m: CadModel) {
  return shapeFromPts(m.footprint);
}

function applyPlanarUV(geo: THREE.BufferGeometry, b: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const dx = Math.max(1e-6, b.maxX - b.minX);
  const dz = Math.max(1e-6, b.maxZ - b.minZ);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - b.minX) / dx;
    uv[i * 2 + 1] = 1 - (pos.getZ(i) - b.minZ) / dz;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/* ---------------- dragging ---------------- */

function useDrag(
  baseY: number,
  onMove: (x: number, z: number) => void,
  setDragging: (v: boolean) => void,
) {
  const active = useRef(false);
  const offset = useRef<[number, number]>([0, 0]);

  function planeHit(e: ThreeEvent<PointerEvent>): [number, number] | null {
    const o = e.ray.origin;
    const d = e.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (baseY - o.y) / d.y;
    if (t < 0) return null;
    return [o.x + d.x * t, o.z + d.z * t];
  }

  return {
    onPointerDown(e: ThreeEvent<PointerEvent>, cur: [number, number]) {
      e.stopPropagation();
      const hit = planeHit(e);
      if (!hit) return;
      offset.current = [cur[0] - hit[0], cur[1] - hit[1]];
      active.current = true;
      setDragging(true);
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e: ThreeEvent<PointerEvent>) {
      if (!active.current) return;
      e.stopPropagation();
      const hit = planeHit(e);
      if (!hit) return;
      onMove(hit[0] + offset.current[0], hit[1] + offset.current[1]);
    },
    onPointerUp(e: ThreeEvent<PointerEvent>) {
      if (!active.current) return;
      active.current = false;
      setDragging(false);
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    },
  };
}

/* ---------------- scene pieces ---------------- */

function Ground({ span }: { span: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[span * 8, span * 8]} />
      <meshStandardMaterial color="#8dc46a" roughness={1} />
    </mesh>
  );
}

function Building({
  model,
  heat,
  brick,
}: {
  model: CadModel;
  heat: THREE.Texture | null;
  brick: THREE.Texture | null;
}) {
  const bounds = useMemo(() => polyBounds(model.footprint), [model.footprint]);

  const walls = useMemo(() => {
    if (model.footprint.length < 3) return null;
    const g = new THREE.ExtrudeGeometry(footprintShape(model), { depth: model.wallHeight, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [model.footprint, model.wallHeight]);

  const flatDeck = useMemo(() => {
    if (model.roofType !== "flat" || model.footprint.length < 3) return null;
    const g = new THREE.ShapeGeometry(footprintShape(model));
    g.rotateX(-Math.PI / 2);
    g.translate(0, model.wallHeight + 0.02, 0);
    applyPlanarUV(g, bounds);
    return g;
  }, [model.roofType, model.footprint, model.wallHeight, bounds]);

  const slopedGeo = useMemo(() => {
    if (model.roofType !== "sloped" || model.footprint.length < 3) return null;
    const faces = buildRoofFaces(model);
    const pos: number[] = [];
    for (const f of faces) {
      for (let i = 1; i < f.verts.length - 1; i++) {
        pos.push(...f.verts[0], ...f.verts[i], ...f.verts[i + 1]);
      }
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    applyPlanarUV(g, bounds);
    return g;
  }, [model, bounds]);

  const parapets = useMemo(() => {
    if (model.roofType !== "flat" || model.parapetHeight <= 0) return [];
    const fp = model.footprint;
    const out: Array<{ x: number; z: number; len: number; rot: number }> = [];
    for (let i = 0; i < fp.length; i++) {
      const p1 = fp[i];
      const p2 = fp[(i + 1) % fp.length];
      const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      if (len < 0.05) continue;
      out.push({
        x: (p1.x + p2.x) / 2,
        z: (p1.z + p2.z) / 2,
        len,
        rot: Math.atan2(p2.x - p1.x, p2.z - p1.z),
      });
    }
    return out;
  }, [model.footprint, model.roofType, model.parapetHeight]);

  if (!walls) return null;

  return (
    <group>
      <mesh geometry={walls} castShadow receiveShadow>
        <meshStandardMaterial color="#d3d6d8" roughness={0.9} />
      </mesh>

      {flatDeck && (
        <>
          <mesh geometry={flatDeck} receiveShadow>
            <meshStandardMaterial color="#b9bcbe" roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          {heat && (
            <mesh geometry={flatDeck} position={[0, 0.03, 0]}>
              <meshBasicMaterial map={heat} transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          )}
        </>
      )}

      {slopedGeo && (
        <>
          <mesh geometry={slopedGeo} castShadow receiveShadow>
            <meshStandardMaterial
              map={brick ?? undefined}
              color={brick ? "#ffffff" : "#c96a3f"}
              roughness={0.95}
              side={THREE.DoubleSide}
            />
          </mesh>
          {heat && (
            <mesh geometry={slopedGeo} position={[0, 0.04, 0]}>
              <meshBasicMaterial map={heat} transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          )}
        </>
      )}

      {parapets.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, model.wallHeight + model.parapetHeight / 2, p.z]}
          rotation={[0, p.rot, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[model.parapetThickness, model.parapetHeight, p.len]} />
          <meshStandardMaterial color="#c8cbcd" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function PrimMesh({
  model,
  prim,
  selected,
  onSelect,
  onMove,
  setDragging,
}: {
  model: CadModel;
  prim: Prim;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, z: number) => void;
  setDragging: (v: boolean) => void;
}) {
  const baseY = primBaseY(model, prim);
  const drag = useDrag(baseY, onMove, setDragging);
  const color = selected ? "#f97316" : prim.kind === "cylinder" ? "#dcdfe1" : "#b6bcc0";
  return (
    <mesh
      position={[prim.x, baseY + prim.h / 2, prim.z]}
      rotation={[0, (prim.rotY * Math.PI) / 180, 0]}
      castShadow
      receiveShadow
      onPointerDown={(e) => {
        onSelect();
        drag.onPointerDown(e, [prim.x, prim.z]);
      }}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
    >
      {prim.kind === "block" ? (
        <boxGeometry args={[prim.w, prim.h, prim.d]} />
      ) : (
        <cylinderGeometry args={[prim.r, prim.r, prim.h, 24]} />
      )}
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  );
}

/** Extra building block (adjacent building or upper storey). */
function StoreyMesh({ model, storey }: { model: CadModel; storey: Storey }) {
  const base = storeyBaseY(model, storey);
  const walls = useMemo(() => {
    if (storey.footprint.length < 3) return null;
    const g = new THREE.ExtrudeGeometry(shapeFromPts(storey.footprint), {
      depth: storey.wallHeight,
      bevelEnabled: false,
    });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [storey.footprint, storey.wallHeight]);

  const deck = useMemo(() => {
    if (storey.footprint.length < 3) return null;
    const g = new THREE.ShapeGeometry(shapeFromPts(storey.footprint));
    g.rotateX(-Math.PI / 2);
    g.translate(0, storey.wallHeight + 0.02, 0);
    return g;
  }, [storey.footprint, storey.wallHeight]);

  const parapets = useMemo(() => {
    if (storey.parapetHeight <= 0) return [];
    const fp = storey.footprint;
    const out: Array<{ x: number; z: number; len: number; rot: number }> = [];
    for (let i = 0; i < fp.length; i++) {
      const p1 = fp[i];
      const p2 = fp[(i + 1) % fp.length];
      const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      if (len < 0.05) continue;
      out.push({
        x: (p1.x + p2.x) / 2,
        z: (p1.z + p2.z) / 2,
        len,
        rot: Math.atan2(p2.x - p1.x, p2.z - p1.z),
      });
    }
    return out;
  }, [storey.footprint, storey.parapetHeight]);

  if (!walls) return null;
  return (
    <group position={[0, base, 0]}>
      <mesh geometry={walls} castShadow receiveShadow>
        <meshStandardMaterial color="#d7dadc" roughness={0.9} />
      </mesh>
      {deck && (
        <mesh geometry={deck} receiveShadow castShadow>
          <meshStandardMaterial color="#b9bcbe" roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      )}
      {parapets.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, storey.wallHeight + storey.parapetHeight / 2, p.z]}
          rotation={[0, p.rot, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[model.parapetThickness, storey.parapetHeight, p.len]} />
          <meshStandardMaterial color="#c8cbcd" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** Tilted rafters + 1 sq ft concrete footings under a panel group. */
function Racking({ model, group }: { model: CadModel; group: PanelGroup }) {
  const spec = model.panel;
  const tilt = (PANEL_TILT_DEG * Math.PI) / 180;
  const extentX = group.cols * (spec.width + spec.gapX);
  const extentZ = group.rows * (spec.length + spec.gapZ);
  const kw = (group.cols * group.rows * spec.watt) / 1000;
  const n = rafterCount(kw);
  const surf = roofSurfaceAt(model, { x: group.x, z: group.z });
  const baseY = surf ? surf.y : model.wallHeight;
  const rise = extentZ * Math.tan(tilt);
  const beamLen = extentZ / Math.cos(tilt);
  const xs = Array.from({ length: n }, (_, i) =>
    group.x + (n === 1 ? 0 : (i / (n - 1) - 0.5) * extentX),
  );
  const footY = baseY + FOOTING_M / 2;
  return (
    <group>
      {xs.map((x, i) => (
        <group key={i}>
          <mesh position={[x, baseY + MOUNT_CLEARANCE + rise / 2, group.z]} rotation={[tilt, 0, 0]} castShadow>
            <boxGeometry args={[0.06, 0.09, beamLen]} />
            <meshStandardMaterial color="#8a9298" metalness={0.4} roughness={0.5} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[x, footY, group.z + (s * extentZ) / 2]} castShadow receiveShadow>
              <boxGeometry args={[FOOTING_M, FOOTING_M, FOOTING_M]} />
              <meshStandardMaterial color="#9aa0a4" roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function TreeMesh({
  tree,
  selected,
  onSelect,
  onMove,
  setDragging,
}: {
  tree: Tree;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, z: number) => void;
  setDragging: (v: boolean) => void;
}) {
  const drag = useDrag(0, onMove, setDragging);
  return (
    <group
      position={[tree.x, 0, tree.z]}
      onPointerDown={(e) => {
        onSelect();
        drag.onPointerDown(e, [tree.x, tree.z]);
      }}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
    >
      <mesh position={[0, tree.h * 0.28, 0]} castShadow>
        <cylinderGeometry args={[tree.r * 0.12, tree.r * 0.16, tree.h * 0.55, 10]} />
        <meshStandardMaterial color="#7a5230" roughness={1} />
      </mesh>
      <mesh position={[0, tree.h * 0.72, 0]} castShadow>
        <sphereGeometry args={[tree.r, 18, 14]} />
        <meshStandardMaterial color={selected ? "#f97316" : "#3f8f43"} roughness={1} />
      </mesh>
    </group>
  );
}

function PanelMesh({ p, color }: { p: PlacedPanel; color: string }) {
  const w = 1.13;
  const l = 2.28;
  return (
    <group position={p.pos} rotation={[0, p.yaw, 0]}>
      <group rotation={[p.tilt, 0, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[w, 0.04, l]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

function PanelGroupMesh({
  panels,
  access,
  heatOn,
  selected,
  baseY,
  center,
  onSelect,
  onMove,
  setDragging,
}: {
  panels: PlacedPanel[];
  access: number[];
  heatOn: boolean;
  selected: boolean;
  baseY: number;
  center: [number, number];
  onSelect: () => void;
  onMove: (x: number, z: number) => void;
  setDragging: (v: boolean) => void;
}) {
  const drag = useDrag(baseY, onMove, setDragging);
  return (
    <group
      onPointerDown={(e) => {
        onSelect();
        drag.onPointerDown(e, center);
      }}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
    >
      {panels.map((p, i) => {
        const a = access[i] ?? 1;
        const [r, g, b] = shadeRamp(a);
        const color = selected ? "#f97316" : heatOn ? `rgb(${r},${g},${b})` : "#16324a";
        return <PanelMesh key={`${p.groupId}-${p.index}`} p={p} color={color} />;
      })}
    </group>
  );
}

function SunMarker({ vec }: { vec: Vec3 }) {
  return (
    <mesh position={vec}>
      <sphereGeometry args={[2.2, 16, 16]} />
      <meshBasicMaterial color="#ffd83d" />
    </mesh>
  );
}

function Controls({ enabled, target }: { enabled: boolean; target: [number, number, number] }) {
  const { camera } = useThree();
  return (
    <OrbitControls
      enabled={enabled}
      enablePan
      maxPolarAngle={Math.PI / 2.05}
      minDistance={4}
      maxDistance={400}
      target={target}
      camera={camera}
      makeDefault
    />
  );
}

/* ---------------- main ---------------- */

export function CadScene({
  model,
  panels,
  panelAccess,
  roofGrid,
  gridSize,
  sunVec,
  altitude,
  heatOn,
  selection,
  onSelect,
  onMovePrim,
  onMoveTree,
  onMoveGroup,
}: {
  model: CadModel;
  panels: PlacedPanel[];
  panelAccess: number[];
  roofGrid: Float32Array | null;
  gridSize: { cols: number; rows: number };
  sunVec: Vec3;
  altitude: number;
  heatOn: boolean;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onMovePrim: (id: string, x: number, z: number) => void;
  onMoveTree: (id: string, x: number, z: number) => void;
  onMoveGroup: (id: string, x: number, z: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const brick = useMemo(() => brickTexture(), []);
  const heat = useMemo(
    () => (heatOn ? heatTexture(roofGrid, gridSize.cols, gridSize.rows) : null),
    [heatOn, roofGrid, gridSize.cols, gridSize.rows],
  );

  const b = useMemo(
    () => (model.footprint.length >= 3 ? polyBounds(model.footprint) : { minX: -6, maxX: 6, minZ: -5, maxZ: 5 }),
    [model.footprint],
  );
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 8) + 10;
  const top = model.roofType === "flat" ? model.wallHeight + model.parapetHeight : model.ridge.height;
  const dayLight = altitude > 0;

  const groupPanels = useMemo(() => {
    const map = new Map<string, { panels: PlacedPanel[]; access: number[] }>();
    panels.forEach((p, i) => {
      const e = map.get(p.groupId) ?? { panels: [], access: [] };
      e.panels.push(p);
      e.access.push(panelAccess[i] ?? 1);
      map.set(p.groupId, e);
    });
    return map;
  }, [panels, panelAccess]);

  return (
    <div className="h-[460px] w-full overflow-hidden rounded-xl border border-border">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [span * 0.9, top + span * 0.8, span * 1.1], fov: 40, far: 2000 }}
        onPointerMissed={() => onSelect(null)}
      >
        <Suspense fallback={null}>
          <Sky sunPosition={sunVec} turbidity={4} rayleigh={dayLight ? 0.7 : 5} mieCoefficient={0.008} />
          <ambientLight intensity={dayLight ? 0.5 : 0.15} />
          <hemisphereLight args={["#eaf3ff", "#7fa05f", dayLight ? 0.6 : 0.2]} />
          {dayLight && (
            <directionalLight
              position={sunVec}
              intensity={2}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-span}
              shadow-camera-right={span}
              shadow-camera-top={span}
              shadow-camera-bottom={-span}
              shadow-camera-near={0.5}
              shadow-camera-far={600}
              shadow-bias={-0.0005}
            />
          )}
          {dayLight && <SunMarker vec={sunVec} />}

          <Ground span={span} />
          <Building model={model} heat={heat} brick={brick} />

          {model.prims.map((p) => (
            <PrimMesh
              key={p.id}
              model={model}
              prim={p}
              selected={selection?.kind === "prim" && selection.id === p.id}
              onSelect={() => onSelect({ kind: "prim", id: p.id })}
              onMove={(x, z) => onMovePrim(p.id, x, z)}
              setDragging={setDragging}
            />
          ))}

          {model.trees.map((t) => (
            <TreeMesh
              key={t.id}
              tree={t}
              selected={selection?.kind === "tree" && selection.id === t.id}
              onSelect={() => onSelect({ kind: "tree", id: t.id })}
              onMove={(x, z) => onMoveTree(t.id, x, z)}
              setDragging={setDragging}
            />
          ))}

          {model.groups.map((g) => {
            const e = groupPanels.get(g.id);
            if (!e || !e.panels.length) return null;
            const surf = roofSurfaceAt(model, { x: g.x, z: g.z });
            return (
              <PanelGroupMesh
                key={g.id}
                panels={e.panels}
                access={e.access}
                heatOn={heatOn}
                selected={selection?.kind === "group" && selection.id === g.id}
                baseY={surf ? surf.y : model.wallHeight}
                center={[g.x, g.z]}
                onSelect={() => onSelect({ kind: "group", id: g.id })}
                onMove={(x, z) => onMoveGroup(g.id, x, z)}
                setDragging={setDragging}
              />
            );
          })}

          <Controls enabled={!dragging} target={[0, top * 0.5, 0]} />
        </Suspense>
      </Canvas>
    </div>
  );
}