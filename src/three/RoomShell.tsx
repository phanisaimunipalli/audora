import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RoomGeometry, WallSide, WindowSpec } from '@/engine/types';
import { wallFeaturePosition, wallLength } from '@/engine/geometry';
import { coveGradient, floorTextures, lightPool, skyGradient, wallBump, withRepeat, type FloorStyle } from './textures';

export interface RoomShellProps {
  room: RoomGeometry;
  /** Hide walls between the camera and the room (dollhouse view). */
  cullNearWalls?: boolean;
  /** Draw the ceiling (default on). With `cullNearWalls` it hides itself whenever the camera is above the room. */
  showCeiling?: boolean;
  showGrid?: boolean;
  /** Tint for the floor. With a textured floor style this multiplies the texture; leave unset for the natural colour. */
  floorColor?: string;
  wallColor?: string;
  /** Fade the shell (e.g. when a real splat is rendered underneath). */
  opacity?: number;
  /** Procedural floor finish. */
  floorStyle?: FloorStyle;
  /** Build a dim corridor beyond the door opening. */
  hallway?: boolean;
  /** Sky through the windows, glowing glass, and light pools on the floor. */
  windowLight?: boolean;
  /** Emit the room's lights. Turn off if the parent scene owns lighting. */
  lights?: boolean;
  /** Shadow map resolution for the sun; 'low' is kinder to phones. */
  shadowQuality?: 'low' | 'high';
}

/** Wall thickness in metres. */
export const WALL_T = 0.12;
const T = WALL_T;

interface Segment {
  along: number; // centre along the wall
  len: number;
  bottom: number;
  top: number;
}

/** Solid wall pieces once the door and windows are cut out. Exported for the minimap and tests. */
export function wallSegments(room: RoomGeometry, wall: WallSide): Segment[] {
  const L = wallLength(room, wall);
  const H = room.height;
  const feats = [
    ...(room.door.wall === wall ? [{ offset: room.door.offset, width: room.door.width, bottom: 0, top: room.door.height }] : []),
    ...room.windows.filter((w) => w.wall === wall).map((w) => ({ offset: w.offset, width: w.width, bottom: w.sill, top: w.sill + w.height })),
  ]
    .map((f) => ({ ...f, start: Math.max(0, f.offset - f.width / 2), end: Math.min(L, f.offset + f.width / 2) }))
    .sort((a, b) => a.start - b.start);
  const segs: Segment[] = [];
  let cursor = 0;
  for (const f of feats) {
    if (f.start > cursor + 0.01) segs.push({ along: (cursor + f.start) / 2, len: f.start - cursor, bottom: 0, top: H });
    const w = f.end - f.start;
    if (w <= 0) continue;
    if (f.bottom > 0.01) segs.push({ along: (f.start + f.end) / 2, len: w, bottom: 0, top: f.bottom });
    if (f.top < H - 0.01) segs.push({ along: (f.start + f.end) / 2, len: w, bottom: f.top, top: H });
    cursor = Math.max(cursor, f.end);
  }
  if (cursor < L - 0.01) segs.push({ along: (cursor + L) / 2, len: L - cursor, bottom: 0, top: H });
  return segs;
}

export function wallFrame(wall: WallSide): { rotY: number; alongSign: 1 | -1 } {
  // Local +z always points into the room; local +x runs along the wall (sign-corrected).
  switch (wall) {
    case 'north':
      return { rotY: 0, alongSign: 1 };
    case 'south':
      return { rotY: Math.PI, alongSign: -1 };
    case 'east':
      return { rotY: -Math.PI / 2, alongSign: 1 };
    case 'west':
      return { rotY: Math.PI / 2, alongSign: -1 };
  }
}

type Registry = { sky: THREE.Object3D[]; hallCeiling: THREE.Object3D[] };

const TRIM = '#ece6da';
const WALLS: WallSide[] = ['north', 'south', 'east', 'west'];

function Window({ w, alongSign, room, opacity, windowLight, registry }: { w: WindowSpec; alongSign: 1 | -1; room: RoomGeometry; opacity: number; windowLight: boolean; registry: Registry }) {
  const sky = useMemo(() => skyGradient(), []);
  const target = useMemo(() => new THREE.Object3D(), []);
  const skyRef = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const m = skyRef.current;
    if (!m) return;
    m.userData.measureIgnore = true;
    m.userData.stillsSky = true;
    registry.sky.push(m);
    return () => {
      const i = registry.sky.indexOf(m);
      if (i >= 0) registry.sky.splice(i, 1);
    };
  }, [registry, windowLight]);
  const cy = w.sill + w.height / 2;
  const f = 0.06;
  const trim = <meshStandardMaterial color={TRIM} roughness={0.5} transparent={opacity < 1} opacity={opacity} />;
  return (
    <group position={[alongSign * w.offset, cy, 0]}>
      {/* frame */}
      <mesh position={[0, w.height / 2 + f / 2, 0]} castShadow>
        <boxGeometry args={[w.width + f * 2, f, T + 0.06]} />
        {trim}
      </mesh>
      <mesh position={[0, -w.height / 2 - f / 2, 0]} castShadow>
        <boxGeometry args={[w.width + f * 2, f, T + 0.06]} />
        {trim}
      </mesh>
      <mesh position={[-w.width / 2 - f / 2, 0, 0]} castShadow>
        <boxGeometry args={[f, w.height, T + 0.06]} />
        {trim}
      </mesh>
      <mesh position={[w.width / 2 + f / 2, 0, 0]} castShadow>
        <boxGeometry args={[f, w.height, T + 0.06]} />
        {trim}
      </mesh>
      {/* interior sill */}
      <mesh position={[0, -w.height / 2 - f - 0.012, 0.05]} castShadow receiveShadow>
        <boxGeometry args={[w.width + f * 2 + 0.1, 0.03, T + 0.16]} />
        {trim}
      </mesh>
      {/* mullions */}
      <mesh castShadow>
        <boxGeometry args={[0.035, w.height, T + 0.02]} />
        {trim}
      </mesh>
      <mesh position={[0, w.height * 0.2, 0]} castShadow>
        <boxGeometry args={[w.width, 0.035, T + 0.02]} />
        {trim}
      </mesh>
      {/* glass */}
      <mesh>
        <planeGeometry args={[w.width, w.height]} />
        <meshStandardMaterial
          color="#dbe9f7"
          roughness={0.08}
          metalness={0}
          transparent
          opacity={0.32 * opacity}
          depthWrite={false}
          side={THREE.DoubleSide}
          emissive="#cfe4f5"
          emissiveIntensity={windowLight ? 0.55 : 0.2}
        />
      </mesh>
      {windowLight ? (
        <>
          {/* the outside, seen through the glass */}
          <mesh position={[0, 0.35, -0.95]} ref={skyRef}>
            <planeGeometry args={[w.width * 3.4, w.height * 2.8]} />
            <meshBasicMaterial map={sky} fog={false} toneMapped={false} />
          </mesh>
          {/* glow into the room */}
          <spotLight position={[0, w.height / 2 + 0.4, -0.5]} target={target} intensity={30} angle={0.75} penumbra={0.7} decay={1.7} distance={10} color="#ffe9cf" />
          <primitive object={target} position={[0, -cy, Math.min(2.4, room.depth * 0.45)]} />
        </>
      ) : null}
    </group>
  );
}

function Wall({ room, wall, color, opacity, hallway, windowLight, visibleRef, registry }: { room: RoomGeometry; wall: WallSide; color: string; opacity: number; hallway: boolean; windowLight: boolean; visibleRef: (g: THREE.Group | null) => void; registry: Registry }) {
  const segs = useMemo(() => wallSegments(room, wall), [room, wall]);
  const bump = useMemo(() => wallBump(), []);
  const cove = useMemo(() => coveGradient(), []);
  const hallFloor = useMemo(() => {
    const set = floorTextures('walnut');
    return withRepeat(set.map, 1, 1.4);
  }, []);
  const hallCeilingRef = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const m = hallCeilingRef.current;
    if (!m) return;
    registry.hallCeiling.push(m);
    return () => {
      const i = registry.hallCeiling.indexOf(m);
      if (i >= 0) registry.hallCeiling.splice(i, 1);
    };
  }, [registry, hallway, room]);
  const base = wallFeaturePosition(room, wall, 0);
  const { rotY, alongSign } = wallFrame(wall);
  const L = wallLength(room, wall);
  const H = room.height;
  const mid = wallFeaturePosition(room, wall, L / 2);
  const offOut = { x: -base.inward.x * (T / 2), z: -base.inward.z * (T / 2) };
  const windows = room.windows.filter((w) => w.wall === wall);
  const door = room.door.wall === wall ? room.door : null;
  const paint = (
    <meshStandardMaterial color={color} roughness={0.96} metalness={0} bumpMap={bump} bumpScale={0.35} transparent={opacity < 1} opacity={opacity} />
  );
  const trim = <meshStandardMaterial color={TRIM} roughness={0.5} transparent={opacity < 1} opacity={opacity} />;
  const hw = door ? door.width + 1.5 : 0;
  const hd = 3.0;
  return (
    <group ref={visibleRef} position={[base.x + offOut.x, 0, base.z + offOut.z]} rotation={[0, rotY, 0]} userData={{ audoraWall: { wall, inward: base.inward, x: mid.x, z: mid.z } }}>
      {segs.map((s, i) => (
        <mesh key={i} position={[alongSign * s.along, (s.bottom + s.top) / 2, 0]} receiveShadow castShadow>
          <boxGeometry args={[s.len, s.top - s.bottom, T]} />
          {paint}
        </mesh>
      ))}
      {/* baseboards follow the solid segments, so they stop at the door */}
      {segs
        .filter((s) => s.bottom < 0.01)
        .map((s, i) => (
          <mesh key={`b${i}`} position={[alongSign * s.along, 0.055, T / 2 + 0.008]} castShadow>
            <boxGeometry args={[s.len, 0.11, 0.016]} />
            {trim}
          </mesh>
        ))}
      {/* faint shadow under the ceiling */}
      <mesh position={[alongSign * (L / 2), H - 0.3, T / 2 + 0.004]} renderOrder={2} userData={{ measureIgnore: true }}>
        <planeGeometry args={[L, 0.6]} />
        <meshBasicMaterial map={cove} color="#000000" transparent depthWrite={false} opacity={opacity} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      {/* contact shadow on the floor along the wall */}
      <mesh position={[alongSign * (L / 2), 0.004, T / 2 + 0.19]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} userData={{ measureIgnore: true }}>
        <planeGeometry args={[L, 0.38]} />
        <meshBasicMaterial map={cove} color="#000000" transparent depthWrite={false} opacity={0.75 * opacity} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      {windows.map((w, i) => (
        <Window key={`w${i}`} w={w} alongSign={alongSign} room={room} opacity={opacity} windowLight={windowLight} registry={registry} />
      ))}
      {door ? (
        <group position={[alongSign * door.offset, 0, 0]}>
          {/* jambs, head and threshold */}
          <mesh position={[-(door.width / 2 + 0.03), door.height / 2, 0]} castShadow>
            <boxGeometry args={[0.06, door.height, T + 0.05]} />
            {trim}
          </mesh>
          <mesh position={[door.width / 2 + 0.03, door.height / 2, 0]} castShadow>
            <boxGeometry args={[0.06, door.height, T + 0.05]} />
            {trim}
          </mesh>
          <mesh position={[0, door.height + 0.03, 0]} castShadow>
            <boxGeometry args={[door.width + 0.12, 0.06, T + 0.05]} />
            {trim}
          </mesh>
          <mesh position={[0, 0.006, 0]}>
            <boxGeometry args={[door.width, 0.012, T + 0.04]} />
            <meshStandardMaterial color="#c9b391" roughness={0.6} />
          </mesh>
          {hallway ? (
            <group>
              {/* corridor beyond the door: floor, walls, ceiling, a dim lamp */}
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -T / 2 - hd / 2]} receiveShadow>
                <planeGeometry args={[hw, hd]} />
                <meshStandardMaterial map={hallFloor} color="#8a7460" roughness={0.8} />
              </mesh>
              <mesh rotation={[0, Math.PI / 2, 0]} position={[-hw / 2, H / 2, -T / 2 - hd / 2]}>
                <planeGeometry args={[hd, H]} />
                <meshStandardMaterial color="#d8cfc2" roughness={0.95} />
              </mesh>
              <mesh rotation={[0, -Math.PI / 2, 0]} position={[hw / 2, H / 2, -T / 2 - hd / 2]}>
                <planeGeometry args={[hd, H]} />
                <meshStandardMaterial color="#d8cfc2" roughness={0.95} />
              </mesh>
              <mesh position={[0, H / 2, -T / 2 - hd]}>
                <planeGeometry args={[hw, H]} />
                <meshStandardMaterial color="#cfc5b7" roughness={0.95} />
              </mesh>
              {/* a second doorway down the hall, for depth */}
              <mesh position={[hw * 0.18, 1.0, -T / 2 - hd + 0.01]} userData={{ measureIgnore: true }}>
                <planeGeometry args={[0.82, 2.0]} />
                <meshBasicMaterial color="#17130f" />
              </mesh>
              <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, -T / 2 - hd / 2]} ref={hallCeilingRef}>
                <planeGeometry args={[hw, hd]} />
                <meshStandardMaterial color="#e6e0d5" roughness={1} />
              </mesh>
              <pointLight position={[0, H - 0.25, -T / 2 - hd * 0.5]} intensity={5} distance={6} decay={2} color="#ffd8ac" />
              {/* the door leaf, swung open into the hall */}
              <group position={[-door.width / 2, 0, -T / 2]} rotation={[0, 1.72, 0]}>
                <mesh position={[door.width / 2, door.height / 2, -0.02]} castShadow>
                  <boxGeometry args={[door.width, door.height - 0.01, 0.04]} />
                  <meshStandardMaterial color="#efe9df" roughness={0.45} />
                </mesh>
                <mesh position={[door.width - 0.07, 1.0, -0.055]}>
                  <sphereGeometry args={[0.022, 12, 12]} />
                  <meshStandardMaterial color="#b9a07a" roughness={0.3} metalness={0.8} />
                </mesh>
              </group>
            </group>
          ) : (
            <mesh position={[0, door.height / 2, -T]}>
              <planeGeometry args={[door.width, door.height]} />
              <meshBasicMaterial color="#141210" side={THREE.DoubleSide} transparent opacity={0.9 * opacity} />
            </mesh>
          )}
        </group>
      ) : null}
    </group>
  );
}

/** The warm light a window throws across the floor. Purely cosmetic and ignored by measuring. */
function LightPool({ room, w }: { room: RoomGeometry; w: WindowSpec }) {
  const tex = useMemo(() => lightPool(), []);
  const p = wallFeaturePosition(room, w.wall, w.offset);
  const { rotY } = wallFrame(w.wall);
  const len = Math.min(2.6, wallLength(room, w.wall === 'north' || w.wall === 'south' ? 'east' : 'north') * 0.55);
  const width = w.width * 1.15;
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.006, len / 2]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} userData={{ measureIgnore: true, stillsKeep: true }}>
        <planeGeometry args={[width, len]} />
        <meshBasicMaterial map={tex} transparent opacity={0.32} depthWrite={false} blending={THREE.AdditiveBlending} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
    </group>
  );
}

/**
 * The metric room: textured floor, matte walls with real openings, baseboards, a corridor beyond
 * the door, daylight through the windows, and soft shadows.
 * Coordinates: room centre at the origin, floor at y=0, north wall at -z.
 */
export function RoomShell({
  room,
  cullNearWalls = false,
  showCeiling = true,
  showGrid = false,
  floorColor,
  wallColor = '#e7dfd2',
  opacity = 1,
  floorStyle = 'oak',
  hallway = true,
  windowLight = true,
  lights = true,
  shadowQuality = 'high',
}: RoomShellProps) {
  const walls = useRef<Record<WallSide, THREE.Group | null>>({ north: null, south: null, east: null, west: null });
  const ceiling = useRef<THREE.Mesh | null>(null);
  const registry = useMemo<Registry>(() => ({ sky: [], hallCeiling: [] }), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const floor = useMemo(() => {
    const set = floorTextures(floorStyle);
    return {
      map: withRepeat(set.map, room.width / set.metresPerTile, room.depth / set.metresPerTile),
      roughnessMap: withRepeat(set.roughnessMap, room.width / set.metresPerTile, room.depth / set.metresPerTile),
      roughness: set.roughness,
    };
  }, [floorStyle, room.width, room.depth]);

  useFrame(({ camera }) => {
    const wallsVisible: Record<WallSide, boolean> = { north: true, south: true, east: true, west: true };
    for (const w of WALLS) {
      const g = walls.current[w];
      if (!g) continue;
      if (!cullNearWalls) {
        g.visible = true;
        continue;
      }
      const p = wallFeaturePosition(room, w, wallLength(room, w) / 2);
      tmp.set(camera.position.x - p.x, 0, camera.position.z - p.z);
      const dot = tmp.x * p.inward.x + tmp.z * p.inward.z;
      // camera is outside this wall (beyond it) → hide so it does not block the view
      g.visible = dot > -0.2;
      wallsVisible[w] = g.visible;
    }
    const above = camera.position.y > room.height - 0.05;
    if (ceiling.current) ceiling.current.visible = !cullNearWalls || !above;
    for (const s of registry.sky) s.visible = !cullNearWalls || camera.position.y < room.height + 0.8;
    for (const h of registry.hallCeiling) h.visible = !cullNearWalls || !above;
  });

  const sun = useMemo(() => {
    const w = room.windows[0];
    if (!w) {
      const span = Math.max(room.width, room.depth);
      return { position: new THREE.Vector3(span * 0.6, room.height + 3, span * 0.4), target: new THREE.Vector3(0, 0, 0) };
    }
    const p = wallFeaturePosition(room, w.wall, w.offset);
    const out = { x: -p.inward.x, z: -p.inward.z };
    return {
      position: new THREE.Vector3(p.x + out.x * 2.4 + p.along.x * 0.9, w.sill + w.height + 2.0, p.z + out.z * 2.4 + p.along.z * 0.9),
      target: new THREE.Vector3(p.x + p.inward.x * 2.2 - p.along.x * 0.3, 0, p.z + p.inward.z * 2.2 - p.along.z * 0.3),
    };
  }, [room]);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const span = Math.max(room.width, room.depth);
  const shadowSize = shadowQuality === 'high' ? 2048 : 1024;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow userData={{ audoraFloor: true }}>
        <planeGeometry args={[room.width, room.depth]} />
        <meshStandardMaterial
          map={floor.map}
          roughnessMap={floor.roughnessMap}
          color={floorColor ?? (floorStyle === 'plain' ? '#b89a7a' : '#ffffff')}
          roughness={floor.roughness}
          metalness={0.02}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
      {showGrid ? <gridHelper args={[Math.max(room.width, room.depth), Math.round(Math.max(room.width, room.depth)), '#5a4d40', '#3a322b']} position={[0, 0.003, 0]} /> : null}
      {showCeiling ? (
        <mesh ref={ceiling} rotation={[Math.PI / 2, 0, 0]} position={[0, room.height, 0]} userData={{ audoraCeiling: room.height }}>
          <planeGeometry args={[room.width, room.depth]} />
          <meshStandardMaterial color="#f3eee6" roughness={1} transparent={opacity < 1} opacity={opacity} />
        </mesh>
      ) : null}
      {WALLS.map((w) => (
        <Wall key={w} room={room} wall={w} color={wallColor} opacity={opacity} hallway={hallway} windowLight={windowLight} registry={registry} visibleRef={(g) => (walls.current[w] = g)} />
      ))}
      {windowLight ? room.windows.map((w, i) => <LightPool key={`pool${i}`} room={room} w={w} />) : null}
      {lights ? (
        <>
          <hemisphereLight args={['#fff2e2', '#3d3128', 0.55]} />
          <ambientLight intensity={0.16} />
          <directionalLight
            position={sun.position.toArray()}
            target={sunTarget}
            intensity={2.4}
            color="#ffe6c8"
            castShadow
            shadow-mapSize={[shadowSize, shadowSize]}
            shadow-bias={-0.00025}
            shadow-normalBias={0.02}
            shadow-radius={shadowQuality === 'high' ? 4 : 2}
            shadow-camera-near={0.1}
            shadow-camera-far={span * 4 + 10}
            shadow-camera-left={-span * 0.8}
            shadow-camera-right={span * 0.8}
            shadow-camera-top={span * 0.8}
            shadow-camera-bottom={-span * 0.8}
          />
          <primitive object={sunTarget} position={sun.target.toArray()} />
          <pointLight position={[0, room.height - 0.25, 0]} intensity={7} color="#ffe4c4" distance={14} decay={1.8} />
        </>
      ) : null}
    </group>
  );
}
