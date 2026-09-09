/**
 * The measured room, drawn: textured floor, matte walls with real openings, baseboards, a corridor
 * beyond each doorway, daylight through the windows, and soft shadows.
 *
 * Conventions:
 * - **Metres, Audora's room frame.** Room centre at the origin, floor y = 0, north wall at −z. Each
 *   wall is one group whose local +x runs along the wall and whose local +z points into the room,
 *   so nothing below does frame arithmetic ({@link wallFrame}).
 * - **A room has one set of doorways, and this file computes it.** {@link doorOpeningsFor} is the
 *   rule — the matched portal, else the collider's own opening, else the room's door spec — and it
 *   is what both the wall the shell cuts and the lit marker `three/Portals` stands in the hole read.
 *   A doorway the shell cuts but the marker does not stand in (or the other way round) is the bug
 *   this single function exists to make impossible.
 * - **Nothing here reads a clock or a random source.** The same room always gets the same doorways
 *   in the same order, because a door that moves between two frames is not a measurement.
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DoorSpec, RoomGeometry, WallSide, WindowSpec } from '@/engine/types';
import { wallFeaturePosition, wallLength } from '@/engine/geometry';
import { PORTAL_TOLERANCE_M, yawOf, type ColliderOpening, type Portal } from '@shared/unitGraph';
import { coveGradient, floorTextures, lightPool, skyGradient, wallBump, withRepeat, type FloorStyle } from './textures';

export interface RoomShellProps {
  room: RoomGeometry;
  /**
   * The room's doorways, from {@link doorOpeningsFor} — the same array `three/Portals` is given, so
   * the hole in the wall and the marker standing in it are one opening. Omitted, the shell falls
   * back to the room's own door spec, which is what a room with no unit graph and no measured
   * opening has anyway.
   *
   * Pass *every* doorway the room has, not only the ones the renter can walk through: a doorway
   * into a room nobody photographed is still a hole in this room's wall, and the marker list is the
   * subset of this one that leads somewhere (see `TourViewer`).
   */
  doorways?: readonly DoorOpening[];
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
  /**
   * The scene brings its own sun (`three/SunLight`, computed from the address and the hour). The
   * shell keeps its fill, its ceiling bounce and its window frames, but stops emitting the studio
   * key by the window — two suns in one room is one sun too many.
   */
  externalSun?: boolean;
  /**
   * The walls the sun is really on right now. Only their windows glow into the room and pool on the
   * floor, so the daylight moves round the room with the hour. Undefined keeps the old behaviour:
   * every window glows.
   */
  sunWalls?: WallSide[];
  /** Shadow map resolution for the sun; 'low' is kinder to phones. */
  shadowQuality?: 'low' | 'high';
  /**
   * Radians the whole shell is turned about y, so the measured room stands on the same walls as the
   * capture drawn over it.
   *
   * The Marble group carries the room's whole turn (`planYaw` in services/marble: the collider
   * rectangle's own rotation, the quarter turn portal matching recovered, and the plan's north
   * arrow). A quarter turn of that is absorbed by the room's own geometry — folding `door.wall`,
   * the window walls and, on an odd quarter, width against depth, leaves the shell axis-aligned and
   * every wall correctly named — so what is left for the shell is the part that is **not** a
   * quarter turn: the north arrow. Pass that, and the shell's walls stay parallel to the
   * photograph's; pass nothing and the shell is exactly where it has always been.
   *
   * Everything else about the room stays in the room's own frame: `room` is still the axis-aligned
   * rectangle, and the pose, the staging and the minimap are still expressed against it. So a
   * caller that turns the shell **must turn what stands in it by the same angle**, in the same
   * parent group — the `Portals` markers built from `doorOpeningsFor` (a lit pane that is not in the
   * hole it names is the bug those two share one rule to avoid), the staging layer, and whatever
   * bounds the walker, or the renter will walk through a wall they can see. Left at 0 there is
   * nothing to coordinate: the shell is exactly where it has always been.
   */
  yaw?: number;
}

/** Wall thickness in metres. */
export const WALL_T = 0.12;
const T = WALL_T;

/* ------------------------------------------------------------------ doorways */

/** A standard interior door: the same 2.03 m the door anchor measures against. */
export const DOORWAY_HEIGHT_M = 2.03;
/** A doorway's drawn height: a standard door, kept under the room's own ceiling and never a slot. */
export const doorwayHeight = (roomHeight: number, preferred = DOORWAY_HEIGHT_M): number => Math.max(1.4, Math.min(preferred, roomHeight - 0.1));
/** No doorway is drawn narrower than this. A hole a renter cannot walk through is not a doorway. */
export const MIN_DOORWAY_M = 0.6;
/**
 * How far a measured opening may sit from where the room's own door spec puts the door and still be
 * that door. The same tolerance `matchPortals` uses to say an opening *is* a plan door, so the two
 * rules below cannot disagree about what counts as a match.
 */
export const DOORWAY_MATCH_M = PORTAL_TOLERANCE_M;

/** Where a doorway came from, most evidence first. */
export type DoorOpeningSource =
  /** A doorway the unit graph matched for this room (`matchPortals`); `portal.source` says whether the plan door landed on a measured opening. */
  | 'portal'
  /** No plan, but the collider measured an opening standing where the room's own door spec puts the door. */
  | 'collider'
  /** Nothing measured it: the room's door spec, which is where `rawFromBounds` put the photographer. */
  | 'engine';

/**
 * One doorway in one wall of the metric room — the hole the shell cuts, and the place the lit
 * marker stands. Metres and radians, in the room's own frame.
 */
export interface DoorOpening {
  /** Stable across frames and across worlds landing under an open viewer, so nothing remounts. */
  id: string;
  wall: WallSide;
  /** Metres from the wall's start (west end for north/south walls, north end for east/west) to the centre. */
  offset: number;
  width: number;
  height: number;
  /** Metres, on the floor, in the wall plane: `wallFeaturePosition(room, wall, offset)`. */
  x: number;
  z: number;
  /** Radians, looking out through the doorway — the same convention as `Portal.yaw` and `Pose.yaw`. */
  yaw: number;
  source: DoorOpeningSource;
  /** The unit graph's doorway this is, when it is one: who it leads to, and how sure the plan is. */
  portal?: Portal;
  /** Why the drawn doorway is not exactly what was measured. Absent when nothing had to be moved. */
  note?: string;
}

/** The room, as the doorway rule reads it: its metric frame plus whatever measured it. */
export interface DoorwayRoom {
  /** Metres — `Room.geometry`. */
  geometry: RoomGeometry;
  /** What the collider found in the wall band, in the provider's raw units (`world.bounds.walls.openings`). */
  openings?: readonly ColliderOpening[];
  /** Metres per raw unit for those openings (`Room.anchor.metresPerUnit`); 1 when they are already metres. */
  metresPerUnit?: number;
}

/** The unit graph's side of the same room: the doorways `matchPortals` found for it. */
export interface DoorwayGraphRoom {
  portals?: readonly Portal[];
}

const round4 = (v: number) => {
  const r = Math.round(v * 1e4) / 1e4;
  return r === 0 ? 0 : r;
};
const clampTo = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const metres = (v: number) => `${v.toFixed(2)} m`;

interface OpeningInput {
  id: string;
  wall: WallSide;
  offset: number;
  width: number;
  height: number;
  source: DoorOpeningSource;
  portal?: Portal;
}

/**
 * One doorway, put on the wall it names: narrowed to the wall it is in, moved back onto it if it
 * ran off the end, and capped under the ceiling. Every clamp says so in `note`, because a doorway
 * drawn somewhere other than where it was measured is exactly the thing a renter must be told.
 */
function openingOn(geometry: RoomGeometry, input: OpeningInput): DoorOpening {
  const L = wallLength(geometry, input.wall);
  const notes: string[] = [];
  const wantedWidth = Math.max(0, input.width);
  const width = Math.min(L, Math.max(Math.min(MIN_DOORWAY_M, L), wantedWidth));
  if (width < wantedWidth - 1e-6) notes.push(`This doorway measures ${metres(wantedWidth)} on a ${metres(L)} wall, so it is drawn ${metres(width)} wide.`);
  const offset = clampTo(input.offset, width / 2, L - width / 2);
  if (Math.abs(offset - input.offset) > 1e-6) notes.push(`It sat past the end of the ${metres(L)} wall, so it is drawn ${metres(offset)} from that wall's start.`);
  const height = doorwayHeight(geometry.height, input.height);
  const p = wallFeaturePosition(geometry, input.wall, offset);
  return {
    id: input.id,
    wall: input.wall,
    offset: round4(offset),
    width: round4(width),
    height: round4(height),
    x: round4(p.x),
    z: round4(p.z),
    yaw: yawOf([-p.inward.x, -p.inward.z]),
    source: input.source,
    ...(input.portal ? { portal: input.portal } : {}),
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}

/**
 * The opening the collider measured where the room's own door spec puts the door, or null.
 *
 * `rawFromBounds` puts the door on the wall the photographer stood at, at the offset they project
 * onto it — a statement about where the photographer was, not a measurement of the hole. When the
 * collider's wall band found an opening on that same wall within {@link DOORWAY_MATCH_M}, that
 * opening *is* the doorway, measured, and it is where the renter has to walk.
 */
function measuredDoorway(room: DoorwayRoom): DoorOpening | null {
  const door = room.geometry.door;
  const scale = typeof room.metresPerUnit === 'number' && room.metresPerUnit > 0 ? room.metresPerUnit : 1;
  let best: ColliderOpening | null = null;
  let bestErr = Infinity;
  for (const o of room.openings ?? []) {
    if (o.wall !== door.wall) continue;
    const err = Math.abs(o.offset * scale - door.offset);
    // First wins a tie: the order the collider reported them in is deterministic, so this is too.
    if (err <= DOORWAY_MATCH_M && err < bestErr) {
      best = o;
      bestErr = err;
    }
  }
  if (!best) return null;
  return openingOn(room.geometry, { id: 'door', wall: best.wall, offset: best.offset * scale, width: best.width * scale, height: door.height, source: 'collider' });
}

/**
 * **The one rule for where a room's doorways are** (docs/ACCURACY.md 3.3).
 *
 * In order of evidence:
 * 1. the doorways the unit graph matched for this room — a plan door standing on the opening the
 *    collider measured, or, where the collider measured none, the plan door on its own;
 * 2. failing that, the opening the collider measured where the room's own door spec puts the door;
 * 3. failing that, the door spec itself, which is where the reconstruction put the photographer.
 *
 * Rule 1 is a *set*: a room with two doors on the plan gets two doorways, and the shell cuts both.
 * Rules 2 and 3 describe the one door a reconstruction knows about on its own. Simulated rooms take
 * the same three rules — a mock world measures no openings, so it lands on 1 or 3 and never on 2.
 *
 * Pure and deterministic: same room, same doorways, in the same order.
 */
export function doorOpeningsFor(room: DoorwayRoom, graphRoom?: DoorwayGraphRoom | null): DoorOpening[] {
  const geometry = room.geometry;
  const portals = graphRoom?.portals ?? [];
  if (portals.length) {
    return portals.map((p) => openingOn(geometry, { id: p.id, wall: p.wall, offset: p.offset, width: p.width, height: DOORWAY_HEIGHT_M, source: 'portal', portal: p }));
  }
  const measured = measuredDoorway(room);
  if (measured) return [measured];
  const d: DoorSpec = geometry.door;
  return [openingOn(geometry, { id: 'door', wall: d.wall, offset: d.offset, width: d.width, height: d.height, source: 'engine' })];
}

/* ------------------------------------------------------------------ walls */

interface Segment {
  along: number; // centre along the wall
  len: number;
  bottom: number;
  top: number;
}

interface Span {
  start: number;
  end: number;
}

/** What a feature covers along its wall, in metres from the wall's start, cut off at both ends. */
const spanOn = (length: number, offset: number, width: number): Span => ({ start: Math.max(0, offset - width / 2), end: Math.min(length, offset + width / 2) });

/** How much of the wall two openings share. A doorway and a window are never the same hole twice. */
const sharesWall = (a: Span, b: Span) => Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.02;

/** This wall's doorways, from the room's own rule when the caller did not bring an answer. */
export function doorsOn(room: RoomGeometry, wall: WallSide, doorways?: readonly DoorOpening[]): DoorOpening[] {
  return (doorways ?? doorOpeningsFor({ geometry: room })).filter((d) => d.wall === wall);
}

/**
 * The windows really drawn on a wall: the ones no doorway is already standing in.
 *
 * The collider reports one opening per hole and cannot tell a doorway from a window, so the same
 * hole can arrive both as a doorway and in `rawFromBounds`'s window list. The doorway wins — it is
 * the one a renter walks through — and the window is dropped rather than framed inside the door.
 */
export function windowsOn(room: RoomGeometry, wall: WallSide, doorways: readonly DoorOpening[]): WindowSpec[] {
  const L = wallLength(room, wall);
  const doors = doorways.filter((d) => d.wall === wall).map((d) => spanOn(L, d.offset, d.width));
  return room.windows.filter((w) => w.wall === wall && !doors.some((d) => sharesWall(spanOn(L, w.offset, w.width), d)));
}

/**
 * Solid wall pieces once the doorways and windows are cut out. Exported for the minimap and tests.
 *
 * `doorways` is {@link doorOpeningsFor}'s answer for the whole room; only the ones on this wall are
 * cut. A window that overlaps a doorway is dropped rather than cut a second time: the collider
 * reports one opening, and both the doorway rule and `rawFromBounds`'s window list can name it, so
 * the doorway wins and the shell does not brick up the bottom half of its own door.
 */
export function wallSegments(room: RoomGeometry, wall: WallSide, doorways?: readonly DoorOpening[]): Segment[] {
  const L = wallLength(room, wall);
  const H = room.height;
  const cuts = doorsOn(room, wall, doorways);
  const doors = cuts.map((d) => ({ ...spanOn(L, d.offset, d.width), bottom: 0, top: d.height }));
  const windows = windowsOn(room, wall, cuts).map((w) => ({ ...spanOn(L, w.offset, w.width), bottom: w.sill, top: w.sill + w.height }));
  const feats = [...doors, ...windows].sort((a, b) => a.start - b.start);
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

const TRIM = '#ffffff';
const WALLS: WallSide[] = ['north', 'south', 'east', 'west'];

function Window({ w, alongSign, room, opacity, windowLight, glow, registry }: { w: WindowSpec; alongSign: 1 | -1; room: RoomGeometry; opacity: number; windowLight: boolean; glow: boolean; registry: Registry }) {
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
          emissiveIntensity={windowLight ? (glow ? 0.55 : 0.34) : 0.2}
        />
      </mesh>
      {windowLight ? (
        <>
          {/* the outside, seen through the glass */}
          <mesh position={[0, 0.35, -0.95]} ref={skyRef}>
            <planeGeometry args={[w.width * 3.4, w.height * 2.8]} />
            <meshBasicMaterial map={sky} fog={false} toneMapped={false} />
          </mesh>
          {/* glow into the room — only from the windows the sun is actually on */}
          {glow ? (
            <>
              <spotLight position={[0, w.height / 2 + 0.4, -0.5]} target={target} intensity={30} angle={0.75} penumbra={0.7} decay={1.7} distance={10} color="#ffe9cf" />
              <primitive object={target} position={[0, -cy, Math.min(2.4, room.depth * 0.45)]} />
            </>
          ) : null}
        </>
      ) : null}
    </group>
  );
}

/**
 * One doorway in a wall: jambs, head and threshold, and beyond them either a dim corridor or the
 * dark of the next room. Drawn in the wall's own local frame (+x along the wall, +z into the room),
 * at exactly the offset, width and height {@link doorOpeningsFor} decided — which is the same place
 * `three/Portals` stands its lit marker.
 */
function Doorway({
  door,
  alongSign,
  room,
  opacity,
  hallway,
  hallFloor,
  trim,
  registry,
}: {
  door: DoorOpening;
  alongSign: 1 | -1;
  room: RoomGeometry;
  opacity: number;
  hallway: boolean;
  hallFloor: THREE.CanvasTexture;
  trim: ReactElement;
  registry: Registry;
}) {
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
  const H = room.height;
  /** The corridor beyond this doorway: as wide as the doorway plus a shoulder either side. */
  const hw = door.width + 1.5;
  const hd = 3.0;
  return (
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
            <meshStandardMaterial color="#e4e2de" roughness={0.95} />
          </mesh>
          <mesh rotation={[0, -Math.PI / 2, 0]} position={[hw / 2, H / 2, -T / 2 - hd / 2]}>
            <planeGeometry args={[hd, H]} />
            <meshStandardMaterial color="#e4e2de" roughness={0.95} />
          </mesh>
          <mesh position={[0, H / 2, -T / 2 - hd]}>
            <planeGeometry args={[hw, H]} />
            <meshStandardMaterial color="#dcd9d4" roughness={0.95} />
          </mesh>
          {/* a second doorway down the hall, for depth */}
          <mesh position={[hw * 0.18, 1.0, -T / 2 - hd + 0.01]} userData={{ measureIgnore: true }}>
            <planeGeometry args={[0.82, 2.0]} />
            <meshBasicMaterial color="#17130f" />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, -T / 2 - hd / 2]} ref={hallCeilingRef}>
            <planeGeometry args={[hw, hd]} />
            <meshStandardMaterial color="#efeeea" roughness={1} />
          </mesh>
          <pointLight position={[0, H - 0.25, -T / 2 - hd * 0.5]} intensity={5} distance={6} decay={2} color="#ffd8ac" />
          {/* the door leaf, swung open into the hall */}
          <group position={[-door.width / 2, 0, -T / 2]} rotation={[0, 1.72, 0]}>
            <mesh position={[door.width / 2, door.height / 2, -0.02]} castShadow>
              <boxGeometry args={[door.width, door.height - 0.01, 0.04]} />
              <meshStandardMaterial color="#f6f5f2" roughness={0.45} />
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
  );
}

function Wall({ room, wall, doors, color, opacity, hallway, windowLight, glow, visibleRef, registry }: { room: RoomGeometry; wall: WallSide; doors: readonly DoorOpening[]; color: string; opacity: number; hallway: boolean; windowLight: boolean; glow: boolean; visibleRef: (g: THREE.Group | null) => void; registry: Registry }) {
  const segs = useMemo(() => wallSegments(room, wall, doors), [room, wall, doors]);
  const bump = useMemo(() => wallBump(), []);
  const cove = useMemo(() => coveGradient(), []);
  const hallFloor = useMemo(() => {
    const set = floorTextures('walnut');
    return withRepeat(set.map, 1, 1.4);
  }, []);
  const base = wallFeaturePosition(room, wall, 0);
  const { rotY, alongSign } = wallFrame(wall);
  const L = wallLength(room, wall);
  const H = room.height;
  const mid = wallFeaturePosition(room, wall, L / 2);
  const offOut = { x: -base.inward.x * (T / 2), z: -base.inward.z * (T / 2) };
  const windows = windowsOn(room, wall, doors);
  const paint = (
    <meshStandardMaterial color={color} roughness={0.96} metalness={0} bumpMap={bump} bumpScale={0.35} transparent={opacity < 1} opacity={opacity} />
  );
  const trim = <meshStandardMaterial color={TRIM} roughness={0.5} transparent={opacity < 1} opacity={opacity} />;
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
        <Window key={`w${i}`} w={w} alongSign={alongSign} room={room} opacity={opacity} windowLight={windowLight} glow={glow} registry={registry} />
      ))}
      {doors.map((d) => (
        <Doorway key={d.id} door={d} alongSign={alongSign} room={room} opacity={opacity} hallway={hallway} hallFloor={hallFloor} trim={trim} registry={registry} />
      ))}
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
  doorways,
  cullNearWalls = false,
  showCeiling = true,
  showGrid = false,
  floorColor,
  wallColor = '#f1f0ed',
  opacity = 1,
  floorStyle = 'oak',
  hallway = true,
  windowLight = true,
  lights = true,
  externalSun = false,
  sunWalls,
  shadowQuality = 'high',
  yaw = 0,
}: RoomShellProps) {
  /** Every window glows unless the caller says which walls the sun is on. */
  const litWall = (w: WallSide) => !sunWalls || sunWalls.includes(w);
  /* One rule, one answer, four walls. The caller passes the same array it gives `three/Portals`;
     with none, the room's own door spec is the answer (`doorOpeningsFor`). */
  const openings = useMemo(() => doorways ?? doorOpeningsFor({ geometry: room }), [doorways, room]);
  const doorsByWall = useMemo(() => {
    const out: Record<WallSide, DoorOpening[]> = { north: [], south: [], east: [], west: [] };
    for (const d of openings) out[d.wall].push(d);
    return out;
  }, [openings]);
  /* A window a doorway is standing in is not drawn, so it must not pool light on the floor either. */
  const drawnWindows = useMemo(() => WALLS.flatMap((w) => windowsOn(room, w, openings)), [room, openings]);
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
    /* Every wall below is positioned in the shell's own frame, so the camera has to be read there
       too: `Ry(yaw)` takes the shell into the scene, and `Ry(−yaw)` brings the camera back. With no
       turn this is the camera's own x and z, exactly as before. */
    const cy = yaw ? Math.cos(-yaw) : 1;
    const sy = yaw ? Math.sin(-yaw) : 0;
    const camX = camera.position.x * cy + camera.position.z * sy;
    const camZ = camera.position.z * cy - camera.position.x * sy;
    for (const w of WALLS) {
      const g = walls.current[w];
      if (!g) continue;
      if (!cullNearWalls) {
        g.visible = true;
        continue;
      }
      const p = wallFeaturePosition(room, w, wallLength(room, w) / 2);
      tmp.set(camX - p.x, 0, camZ - p.z);
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
    <group rotation={[0, yaw, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow userData={{ audoraFloor: true }}>
        <planeGeometry args={[room.width, room.depth]} />
        <meshStandardMaterial
          map={floor.map}
          roughnessMap={floor.roughnessMap}
          color={floorColor ?? (floorStyle === 'plain' ? '#cdbba4' : '#ffffff')}
          roughness={floor.roughness}
          metalness={0.02}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
      {showGrid ? <gridHelper args={[Math.max(room.width, room.depth), Math.round(Math.max(room.width, room.depth)), '#c4c4c4', '#dcdcdc']} position={[0, 0.003, 0]} /> : null}
      {showCeiling ? (
        /* A ceiling plane faces down, so it catches the hemisphere's *ground* colour and none of the
           sun: left to the lights alone it renders near-black, and standing in the room you see a
           hole where the ceiling should be. A little emissive plaster is what a real ceiling does
           anyway — it is lit by everything the room bounces up at it. */
        <mesh ref={ceiling} rotation={[Math.PI / 2, 0, 0]} position={[0, room.height, 0]} userData={{ audoraCeiling: room.height }}>
          <planeGeometry args={[room.width, room.depth]} />
          <meshStandardMaterial color="#fafafa" roughness={1} emissive="#f0efec" emissiveIntensity={0.42} transparent={opacity < 1} opacity={opacity} />
        </mesh>
      ) : null}
      {WALLS.map((w) => (
        <Wall key={w} room={room} wall={w} doors={doorsByWall[w]} color={wallColor} opacity={opacity} hallway={hallway} windowLight={windowLight} glow={litWall(w)} registry={registry} visibleRef={(g) => (walls.current[w] = g)} />
      ))}
      {windowLight ? drawnWindows.filter((w) => litWall(w.wall)).map((w, i) => <LightPool key={`pool${i}`} room={room} w={w} />) : null}
      {lights ? (
        <>
          <hemisphereLight args={['#fff2e2', '#3d3128', 0.55]} />
          <ambientLight intensity={0.16} />
          {externalSun ? null : (
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
          )}
          {externalSun ? null : <primitive object={sunTarget} position={sun.target.toArray()} />}
          <pointLight position={[0, room.height - 0.25, 0]} intensity={7} color="#ffe4c4" distance={14} decay={1.8} />
        </>
      ) : null}
    </group>
  );
}
