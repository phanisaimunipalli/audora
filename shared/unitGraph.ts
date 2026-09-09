/**
 * The unit as one model — docs/ACCURACY.md section 3.3.
 *
 * A tour is a set of rooms that each know their own size and nothing about each other. A listing
 * plan is the one document that says how they fit together: which rooms there are, how big each is,
 * which way north points, and — by drawing them side by side — which room you reach through which
 * door. This module turns a parsed plan into that graph, so the viewer can put a doorway marker on
 * the real opening the collider found, walk the buyer through it into the next room, and draw one
 * minimap of the whole unit with "you are here" on it.
 *
 * Conventions:
 * - **Dependency-free and pure.** The only import is a type (erased at build time), so this module
 *   is compiled into the browser bundle and the worker unchanged. No clock, no randomness, no I/O:
 *   the same plan always gives the same graph, because the graph decides where a buyer is standing.
 * - **Metres, and Audora's axes.** Positions are room centres in metres on the *sheet*: x grows
 *   right across the page, z grows down it, which is Audora's own (x east, z south) whenever the
 *   plan's north arrow points up. `northArrowDeg` says by how much the sheet disagrees, and
 *   `yawToNorth` on each room is the turn that fixes it (see below).
 * - **Walls are named the way `engine/geometry` names them**: north is the low-z wall, south the
 *   high-z one, and a wall's `offset` is measured from its start — the west end for north and south
 *   walls, the north end for east and west walls.
 * - **Nothing is invented, and inference says so.** A parsed plan carries no room positions and no
 *   adjacency at all (see `src/services/floorplan.ts`: names, types, printed dimensions, door and
 *   window *counts*, a north arrow). So both are derived here, by rules written down below, and the
 *   result says in `positions`, `adjacency` and `notes` exactly how much of it was drawn and how
 *   much was reasoned.
 *
 * ## The room's own frame, and the quarter turn between them
 *
 * A reconstruction's room frame is the capture's: `roomRect` (shared/collider) turns the capture so
 * the room's walls run along Audora's axes, and `rawFromBounds` then calls the wall the
 * photographer stood at "south". That is a convention about the *photograph*, not about the
 * building, so the room's frame and the plan's frame differ by a quarter turn — 0°, 90°, 180° or
 * 270° — and which one is exactly what the plan can tell us. {@link matchPortals} recovers it by
 * trying all four and keeping the one that puts the most plan doors on top of the openings the
 * collider actually measured; everything after that is expressed through {@link foldWall}, so there
 * is one turn in the code and not one per caller.
 */
import type { WallSide } from './collider.js';

/* ---------- what a plan says (structurally `FloorPlan` from src/services/floorplan.ts) ---------- */

/** One room as the plan drew it. `position`, when a parser ever provides one, is the room centre in metres. */
export interface PlanRoomInput {
  name: string;
  type?: string;
  /** Metres, present only when the plan printed dimensions for this room. */
  width?: number;
  depth?: number;
  /** How many doors the plan prints for this room. Advisory: it never changes the graph. */
  doors?: number;
  position?: { x: number; z: number };
}

export interface PlanFloorInput {
  label?: string;
  rooms: readonly PlanRoomInput[];
}

/** Where the plan's north arrow points on the page. */
export interface PlanNorthInput {
  present?: boolean;
  direction?: 'up' | 'right' | 'down' | 'left';
  /** Degrees clockwise from "up the page". */
  degrees?: number;
}

export interface UnitPlanInput {
  floors: readonly PlanFloorInput[];
  northArrow?: PlanNorthInput | null;
  /** Adjacency, when something upstream knows it. Order-insensitive; duplicates and unknown refs are dropped. */
  adjacency?: readonly { a: string; b: string }[];
}

/* ---------- what the graph is ---------- */

/** A doorway out of one room, on one of its four walls, in the plan's own frame. */
export interface UnitDoor {
  wall: WallSide;
  /** Metres from that wall's start (west end for north/south walls, north end for east/west). */
  offset: number;
  width: number;
  toRoomRef: string;
  /** The two rooms do not share a wall in the layout, so this door is where one *would* be. */
  nominal?: boolean;
}

export interface UnitRoom {
  /** `${floorIndex}:${roomIndex}` — the same key `planRooms()` gives a `FlatPlanRoom`. */
  roomRef: string;
  name: string;
  floor: string;
  floorIndex: number;
  /** Exactly what the plan printed, or null when it printed nothing for this room. */
  planDims: { width: number; depth: number } | null;
  /** Metres the room is drawn at: `planDims` when there are any, the default for its type otherwise. */
  width: number;
  depth: number;
  /** Room centre, metres, on the sheet. */
  position: { x: number; z: number };
  /**
   * Radians to turn this room's world by so that its own north wall faces the plan's north. The
   * layout is axis-aligned to the sheet, so this is `−northArrowDeg` in radians for every room; it
   * is stored per room because a plan that ever places its rooms may also turn them.
   */
  yawToNorth: number;
  doors: UnitDoor[];
  /** The door count printed on the plan, when it printed one. Never used to build the graph. */
  doorsPrinted?: number;
}

export interface UnitGraph {
  rooms: UnitRoom[];
  /** Degrees clockwise from "up the page" to true north. 0 when the plan draws no arrow. */
  northArrowDeg: number;
  /** `plan` when every room came with a position, `adjacency` when they were laid out here. */
  positions: 'plan' | 'adjacency';
  /** `plan` when the doors were given, `inferred` when they were reasoned from room types and sheet order. */
  adjacency: 'plan' | 'inferred';
  /** What had to be assumed, in plain words, for a UI that shows its work. */
  notes: string[];
}

/* ---------- constants ---------- */

/** An interior doorway. Plans do not print door widths; every one drawn here is this wide. */
export const DOOR_WIDTH_M = 0.85;
/** How far a collider opening may sit from where the plan puts the door and still be that door. */
export const PORTAL_TOLERANCE_M = 0.5;
/** Metres inside the destination room the buyer lands, having walked through a portal. */
export const ARRIVAL_INSET_M = 0.9;
/** How close the buyer has to be to a doorway for walking to count as going through it. */
export const PORTAL_ENTER_M = 0.6;
/** Sheet metres left between one storey's rooms and the next's. */
export const FLOOR_GAP_M = 2;
/** Sheet metres between two groups of rooms on one storey that no door connects. */
export const COMPONENT_GAP_M = 1.5;
/** How far a room is nudged along a wall, looking for a free spot. */
const LAYOUT_STEP_M = 0.25;
const LAYOUT_MAX_SHIFT_M = 12;
/** Every position and offset is rounded to a tenth of a millimetre, so the graph is stable to print and hash. */
const DECIMALS = 4;

/**
 * What a room is drawn as when the plan printed no dimensions for it. Not a measurement — the
 * minimap has to draw *something*, and a hallway that is drawn as square is a worse lie than one
 * drawn as a corridor.
 */
export const DEFAULT_ROOM_M: Record<string, { width: number; depth: number }> = {
  hallway: { width: 1.2, depth: 4 },
  bathroom: { width: 2, depth: 2.4 },
  kitchen: { width: 3, depth: 3.4 },
  other: { width: 2.4, depth: 2.4 },
};
const DEFAULT_ROOM_FALLBACK = { width: 3.2, depth: 3.8 };

/** Which way each wall faces out of the room, and which way its offset runs. Audora's axes. */
const NORMAL: Record<WallSide, readonly [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const ALONG: Record<WallSide, readonly [number, number]> = { north: [1, 0], south: [1, 0], east: [0, 1], west: [0, 1] };

const round = (v: number) => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS;
const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/* ---------- the sheet's north ---------- */

const ARROW_DEGREES: Record<string, number> = { up: 0, right: 90, down: 180, left: 270 };

/** Degrees clockwise from "up the page" to true north. An explicit bearing wins over the arrow's direction. */
export function northArrowDegrees(arrow: PlanNorthInput | null | undefined): number {
  if (!arrow) return 0;
  if (finite(arrow.degrees)) return ((arrow.degrees % 360) + 360) % 360;
  const d = arrow.direction ? ARROW_DEGREES[arrow.direction] : undefined;
  return d ?? 0;
}

/* ---------- rectangles ---------- */

interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

const minX = (r: Rect) => r.x - r.w / 2;
const maxX = (r: Rect) => r.x + r.w / 2;
const minZ = (r: Rect) => r.z - r.d / 2;
const maxZ = (r: Rect) => r.z + r.d / 2;

/** How much two intervals share. Negative is the gap between them. */
const overlap1 = (aLo: number, aHi: number, bLo: number, bHi: number) => Math.min(aHi, bHi) - Math.max(aLo, bLo);

function overlaps(a: Rect, b: Rect, eps = 1e-6): boolean {
  return overlap1(minX(a), maxX(a), minX(b), maxX(b)) > eps && overlap1(minZ(a), maxZ(a), minZ(b), maxZ(b)) > eps;
}

/** Length of one wall of a rectangle. */
export function wallLengthOf(size: { width: number; depth: number }, wall: WallSide): number {
  return wall === 'north' || wall === 'south' ? size.width : size.depth;
}

/**
 * The point on a wall at `offset` from its start, in the room's own frame (centre at the origin,
 * floor y = 0). Mirrors `wallFeaturePosition` in src/engine/geometry.ts, which `shared/` may not
 * import; the two must agree, and the wall convention above is the contract between them.
 */
export function wallPoint(size: { width: number; depth: number }, wall: WallSide, offset: number): { x: number; z: number } {
  switch (wall) {
    case 'north':
      return { x: -size.width / 2 + offset, z: -size.depth / 2 };
    case 'south':
      return { x: -size.width / 2 + offset, z: size.depth / 2 };
    case 'east':
      return { x: size.width / 2, z: -size.depth / 2 + offset };
    case 'west':
      return { x: -size.width / 2, z: -size.depth / 2 + offset };
  }
}

/**
 * The yaw of a direction in Audora's frame: 0 looks north (−z), and a positive yaw turns west.
 * Same convention as `viewerStore.Pose` and the minimap's view cone (`dir = (−sin y, −cos y)`).
 */
export function yawOf(direction: readonly [number, number]): number {
  return Math.atan2(-direction[0], -direction[1]);
}

/** Radians folded into (−π, π]. */
export function normaliseYaw(yaw: number): number {
  const t = ((yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return t - Math.PI;
}

/* ---------- the door between two rooms ---------- */

/**
 * Where a door between two placed rooms goes: the wall of `a` that faces `b`, and the middle of
 * what the two rectangles share along it. Rooms that share no wall (a plan that places its rooms
 * apart, or a layout that had to give up) still get a door, marked `nominal`, aimed at the other
 * room's centre — the graph's job is to say which room is through which wall, and it must not go
 * quiet just because the drawing is loose.
 *
 * "Share a wall" is both conditions, not one: the rectangles have to overlap **along** the wall
 * *and* meet **across** it. Reading only the overlap called a door real between two rooms that were
 * side by side in z and 4.8 m apart in x — a doorway drawn solid, in a wall with nothing behind it.
 */
function doorBetween(a: Rect, b: Rect, toRoomRef: string): UnitDoor {
  const shareX = overlap1(minX(a), maxX(a), minX(b), maxX(b));
  const shareZ = overlap1(minZ(a), maxZ(a), minZ(b), maxZ(b));
  // The wall that faces the other room, chosen by which way they are actually separated: the axis
  // whose gap is larger is the one the rooms are side by side on.
  const gapX = Math.max(minX(a) - maxX(b), minX(b) - maxX(a));
  const gapZ = Math.max(minZ(a) - maxZ(b), minZ(b) - maxZ(a));
  const alongX = gapZ >= gapX;
  const wall: WallSide = alongX ? (b.z >= a.z ? 'south' : 'north') : b.x >= a.x ? 'east' : 'west';
  const share = alongX ? shareX : shareZ;
  const length = alongX ? a.w : a.d;
  const start = alongX ? minX(a) : minZ(a);
  const centre = alongX ? (Math.max(minX(a), minX(b)) + Math.min(maxX(a), maxX(b))) / 2 : (Math.max(minZ(a), minZ(b)) + Math.min(maxZ(a), maxZ(b))) / 2;
  // Flush across the wall, to the tenth of a millimetre the layout is rounded to.
  const touching = Math.abs(alongX ? gapZ : gapX) <= 1e-4;
  const nominal = !(share > 0 && touching);
  const width = Math.min(DOOR_WIDTH_M, Math.max(0.3, nominal ? DOOR_WIDTH_M : share));
  const along = nominal ? (alongX ? b.x : b.z) : centre;
  const offset = clamp(along - start, width / 2, length - width / 2);
  return nominal ? { wall, offset: round(offset), width: round(width), toRoomRef, nominal } : { wall, offset: round(offset), width: round(width), toRoomRef };
}

/* ---------- adjacency ---------- */

interface Entry {
  ref: string;
  name: string;
  type: string;
  floor: string;
  floorIndex: number;
  planDims: { width: number; depth: number } | null;
  size: { width: number; depth: number };
  doorsPrinted?: number;
  position?: { x: number; z: number };
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Which rooms a door joins, when the plan does not draw its doors — which is every plan the parser
 * reads today.
 *
 * The rule is the one a floor plan itself obeys: **a home is organised around its circulation.**
 * Where the storey has a hallway, every other room on it opens off the nearest hallway at or before
 * it in sheet order, and the hallways are strung together; where it has none, the rooms are strung
 * together in sheet order, which is the order the vision model read them off the drawing (roughly
 * left to right). Storeys are never joined: a plan does not draw the stair, and inventing one would
 * put a doorway in a wall that has none.
 */
function inferAdjacency(entries: readonly Entry[]): { a: string; b: string }[] {
  const out: { a: string; b: string }[] = [];
  const byFloor = new Map<number, Entry[]>();
  for (const e of entries) {
    const list = byFloor.get(e.floorIndex);
    if (list) list.push(e);
    else byFloor.set(e.floorIndex, [e]);
  }
  for (const floor of [...byFloor.keys()].sort((x, y) => x - y)) {
    const rooms = byFloor.get(floor) ?? [];
    const hubs = rooms.filter((r) => r.type === 'hallway');
    if (!hubs.length) {
      for (let i = 1; i < rooms.length; i++) out.push({ a: rooms[i - 1].ref, b: rooms[i].ref });
      continue;
    }
    for (let i = 1; i < hubs.length; i++) out.push({ a: hubs[i - 1].ref, b: hubs[i].ref });
    for (const room of rooms) {
      if (room.type === 'hallway') continue;
      const index = rooms.indexOf(room);
      let hub = hubs[0];
      for (const h of hubs) if (rooms.indexOf(h) < index) hub = h;
      out.push({ a: hub.ref, b: room.ref });
    }
  }
  return out;
}

/** Every room's neighbours, deduplicated, symmetric, and in sheet order. */
function neighbourMap(entries: readonly Entry[], edges: readonly { a: string; b: string }[]): Map<string, string[]> {
  const index = new Map(entries.map((e, i) => [e.ref, i]));
  const map = new Map<string, Set<string>>(entries.map((e) => [e.ref, new Set<string>()]));
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.a === e.b || !index.has(e.a) || !index.has(e.b)) continue;
    const k = key(e.a, e.b);
    if (seen.has(k)) continue;
    seen.add(k);
    map.get(e.a)?.add(e.b);
    map.get(e.b)?.add(e.a);
  }
  const out = new Map<string, string[]>();
  for (const [ref, set] of map) out.set(ref, [...set].sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0)));
  return out;
}

/* ---------- laying the rooms out ---------- */

/** Lateral nudges tried on a wall, nearest the middle first: 0, ±25 cm, ±50 cm … */
function shifts(): number[] {
  const out = [0];
  for (let s = LAYOUT_STEP_M; s <= LAYOUT_MAX_SHIFT_M; s += LAYOUT_STEP_M) out.push(s, -s);
  return out;
}

/**
 * Where along one wall a room may be tried: the fixed grid above, and then the places where it
 * lands **flush** against a room already on that wall or packed into the parent's own end.
 *
 * The grid alone misses by less than one step on exactly the case that matters — a corridor whose
 * long wall has just enough left for one more doorway — and a miss there is not a room drawn a
 * little wrong: `placeChild` gives up, the room is put east of the whole storey, and its door then
 * lands on top of a sibling's (`doorBetween` reads the rectangles, and two rooms that never touched
 * the corridor share whatever wall faces them). One hole in the wall, two destinations.
 *
 * Deterministic: `placed` is in placement order, and the candidates are sorted by how far they move
 * the room, ties broken by sign.
 */
function shiftsAlong(parent: Rect, wall: WallSide, size: { width: number; depth: number }, placed: readonly Rect[]): number[] {
  const alongX = wall === 'north' || wall === 'south';
  const half = (alongX ? size.width : size.depth) / 2;
  const centre = alongX ? parent.x : parent.z;
  const lo = (r: Rect) => (alongX ? minX(r) : minZ(r));
  const hi = (r: Rect) => (alongX ? maxX(r) : maxZ(r));
  const flush: number[] = [hi(parent) - half - centre, lo(parent) + half - centre];
  for (const p of placed) flush.push(hi(p) + half - centre, lo(p) - half - centre);
  const out = shifts();
  for (const s of flush.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)) {
    if (Math.abs(s) <= LAYOUT_MAX_SHIFT_M && !out.some((o) => Math.abs(o - s) < 1e-9)) out.push(s);
  }
  return out;
}

/** A child placed flush against one wall of its parent, nudged `shift` metres along that wall. */
function against(parent: Rect, wall: WallSide, size: { width: number; depth: number }, shift: number): Rect {
  const w = size.width;
  const d = size.depth;
  switch (wall) {
    case 'north':
      return { x: parent.x + shift, z: minZ(parent) - d / 2, w, d };
    case 'south':
      return { x: parent.x + shift, z: maxZ(parent) + d / 2, w, d };
    case 'east':
      return { x: maxX(parent) + w / 2, z: parent.z + shift, w, d };
    case 'west':
      return { x: minX(parent) - w / 2, z: parent.z + shift, w, d };
  }
}

/**
 * Where a room goes, given the room it opens off.
 *
 * The parent's **long** walls are tried first for every child — a corridor is flanked, not capped —
 * and which of the two a child starts with alternates with its order, so siblings spread to both
 * sides instead of queueing on one. Each wall is then searched outward from the middle
 * ({@link shiftsAlong}). A spot counts only when the room lands clear of everything already placed
 * *and* shares enough wall with its parent for a door to fit in it — a room touching another at a
 * corner is not a room you can walk into.
 *
 * The wall list used to be rotated by the child's order, which sent the third room off a
 * 7.00 × 1.20 m hallway to a 1.20 m end wall while both 7 m walls still had room, and left the
 * fifth with nowhere to go at all — so its doorway ended up drawn on top of the third's.
 */
function placeChild(parent: Rect, size: { width: number; depth: number }, order: number, placed: readonly Rect[]): Rect | null {
  const long: WallSide[] = parent.w >= parent.d ? ['north', 'south', 'east', 'west'] : ['east', 'west', 'north', 'south'];
  const walls: WallSide[] = order % 2 ? [long[1], long[0], long[3], long[2]] : long;
  for (const wall of walls) {
    const need = Math.min(DOOR_WIDTH_M, wallLengthOf({ width: parent.w, depth: parent.d }, wall), wallLengthOf(size, wall));
    for (const shift of shiftsAlong(parent, wall, size, placed)) {
      const rect = against(parent, wall, size, shift);
      if (placed.some((p) => overlaps(rect, p))) continue;
      const share = wall === 'north' || wall === 'south' ? overlap1(minX(parent), maxX(parent), minX(rect), maxX(rect)) : overlap1(minZ(parent), maxZ(parent), minZ(rect), maxZ(rect));
      if (share + 1e-9 < need) continue;
      return rect;
    }
  }
  return null;
}

/** The bounding box of a set of rectangles. */
function boundsOf(rects: readonly Rect[]): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (!rects.length) return null;
  return {
    minX: Math.min(...rects.map(minX)),
    maxX: Math.max(...rects.map(maxX)),
    minZ: Math.min(...rects.map(minZ)),
    maxZ: Math.max(...rects.map(maxZ)),
  };
}

/**
 * Rooms on one storey, laid out from their doors: breadth-first from the storey's circulation (its
 * first hallway, else its first room), each room hung off the one it opens from. Rooms no door
 * reaches start their own group, placed east of everything so far. Deterministic: the order is the
 * plan's own, and every candidate position is tried in a fixed sequence.
 */
function layoutFloor(rooms: readonly Entry[], neighbours: Map<string, string[]>): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const placed: Rect[] = [];
  const children = new Map<string, number>();
  const roots = [...rooms].sort((a, b) => Number(b.type === 'hallway') - Number(a.type === 'hallway'));
  for (const root of roots) {
    if (out.has(root.ref)) continue;
    const box = boundsOf(placed);
    const start: Rect = box
      ? { x: box.maxX + COMPONENT_GAP_M + root.size.width / 2, z: 0, w: root.size.width, d: root.size.depth }
      : { x: 0, z: 0, w: root.size.width, d: root.size.depth };
    out.set(root.ref, start);
    placed.push(start);
    const queue = [root.ref];
    for (let head = 0; head < queue.length; head++) {
      const ref = queue[head];
      const parent = out.get(ref);
      if (!parent) continue;
      for (const next of neighbours.get(ref) ?? []) {
        if (out.has(next)) continue;
        const entry = rooms.find((r) => r.ref === next);
        if (!entry) continue;
        const order = children.get(ref) ?? 0;
        children.set(ref, order + 1);
        const spot = placeChild(parent, entry.size, order, placed) ?? {
          // Nothing fits against the parent: put the room east of the whole storey. The door it
          // gets is `nominal`, which is the graph saying so.
          x: (boundsOf(placed)?.maxX ?? 0) + COMPONENT_GAP_M + entry.size.width / 2,
          z: parent.z,
          w: entry.size.width,
          d: entry.size.depth,
        };
        out.set(next, spot);
        placed.push(spot);
        queue.push(next);
      }
    }
  }
  return out;
}

/* ---------- the graph ---------- */

function sizeOf(room: PlanRoomInput, type: string): { planDims: { width: number; depth: number } | null; size: { width: number; depth: number } } {
  if (finite(room.width) && finite(room.depth) && room.width > 0 && room.depth > 0) {
    const planDims = { width: room.width, depth: room.depth };
    return { planDims, size: planDims };
  }
  return { planDims: null, size: DEFAULT_ROOM_M[type] ?? DEFAULT_ROOM_FALLBACK };
}

/**
 * The unit's rooms, where they sit relative to each other, and the doors between them.
 *
 * Give it a parsed `FloorPlan` (it takes the shape structurally, so `shared/` need not import the
 * browser's parser). What comes back always has every room in it: a plan with no dimensions still
 * produces a graph, drawn at the default sizes, and says so in `notes`.
 */
export function buildUnitGraph(plan: UnitPlanInput): UnitGraph {
  const notes: string[] = [];
  const northArrowDeg = northArrowDegrees(plan.northArrow);
  // Not rounded: this is the turn every room's world is folded by, and it must stay exactly a
  // quarter of a circle when the arrow is a cardinal one.
  const yawToNorth = normaliseYaw(-(northArrowDeg * Math.PI) / 180);

  const entries: Entry[] = [];
  plan.floors.forEach((floor, fi) => {
    floor.rooms.forEach((room, ri) => {
      const type = typeof room.type === 'string' && room.type ? room.type : 'other';
      const { planDims, size } = sizeOf(room, type);
      entries.push({
        ref: `${fi}:${ri}`,
        name: room.name,
        type,
        floor: floor.label ?? `Floor ${fi + 1}`,
        floorIndex: fi,
        planDims,
        size,
        doorsPrinted: finite(room.doors) ? Math.max(0, Math.round(room.doors)) : undefined,
        position: room.position && finite(room.position.x) && finite(room.position.z) ? { x: room.position.x, z: room.position.z } : undefined,
      });
    });
  });

  if (!entries.length) return { rooms: [], northArrowDeg, positions: 'adjacency', adjacency: 'inferred', notes: ['This plan has no rooms on it.'] };

  const given = plan.adjacency?.length ? plan.adjacency : undefined;
  const edges = given ?? inferAdjacency(entries);
  const neighbours = neighbourMap(entries, edges);
  const adjacency: UnitGraph['adjacency'] = given ? 'plan' : 'inferred';

  const drawn = entries.every((e) => e.position);
  const positions: UnitGraph['positions'] = drawn ? 'plan' : 'adjacency';

  /* Every storey is laid out on its own and the storeys are then set side by side, because a plan
     that draws two sheets draws two buildings' worth of coordinates and stacking them would put a
     bedroom inside a kitchen. */
  const rects = new Map<string, Rect>();
  if (drawn) {
    for (const e of entries) rects.set(e.ref, { x: e.position!.x, z: e.position!.z, w: e.size.width, d: e.size.depth });
  } else {
    let cursor = 0;
    const floors = [...new Set(entries.map((e) => e.floorIndex))].sort((a, b) => a - b);
    for (const fi of floors) {
      const rooms = entries.filter((e) => e.floorIndex === fi);
      const laid = layoutFloor(rooms, neighbours);
      const box = boundsOf([...laid.values()]);
      const shift = box ? cursor - box.minX : 0;
      for (const [ref, r] of laid) rects.set(ref, { ...r, x: r.x + shift });
      cursor = box ? cursor + (box.maxX - box.minX) + FLOOR_GAP_M : cursor;
    }
  }

  const rooms: UnitRoom[] = entries.map((e) => {
    const rect = rects.get(e.ref)!;
    const doors = (neighbours.get(e.ref) ?? [])
      .map((toRef) => {
        const other = rects.get(toRef);
        return other ? doorBetween(rect, other, toRef) : null;
      })
      .filter((d): d is UnitDoor => d != null);
    return {
      roomRef: e.ref,
      name: e.name,
      floor: e.floor,
      floorIndex: e.floorIndex,
      planDims: e.planDims,
      width: e.size.width,
      depth: e.size.depth,
      position: { x: round(rect.x), z: round(rect.z) },
      yawToNorth,
      doors,
      ...(e.doorsPrinted != null ? { doorsPrinted: e.doorsPrinted } : {}),
    };
  });

  if (adjacency === 'inferred') {
    const hubs = entries.filter((e) => e.type === 'hallway');
    notes.push(
      hubs.length
        ? `The plan draws no doors, so every room is taken to open off ${hubs.length === 1 ? hubs[0].name : 'the hallway nearest it'}.`
        : 'The plan draws no doors and has no hallway, so the rooms are linked in the order they are drawn.',
    );
  }
  if (positions === 'adjacency') notes.push('The plan does not place its rooms, so they are laid out from those doors: the sizes are the plan’s, the arrangement is not.');
  const undimensioned = entries.filter((e) => !e.planDims).length;
  if (undimensioned) notes.push(`${undimensioned} of ${entries.length} rooms print no dimensions, so they are drawn at a typical size for their type.`);
  if (!plan.northArrow?.present && !finite(plan.northArrow?.degrees)) notes.push('The plan draws no north arrow, so up the page is taken as north.');
  if (new Set(entries.map((e) => e.floorIndex)).size > 1) notes.push('Storeys are drawn side by side and are not joined: a plan does not draw its stair.');

  return { rooms, northArrowDeg, positions, adjacency, notes };
}

/** The room with this ref, or undefined. */
export function roomOf(graph: UnitGraph, roomRef: string | undefined): UnitRoom | undefined {
  return roomRef ? graph.rooms.find((r) => r.roomRef === roomRef) : undefined;
}

/** The bounding box, in sheet metres, of one storey's rooms — what a minimap has to fit on screen. */
export function floorBounds(graph: UnitGraph, floorIndex: number): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  const rects = graph.rooms.filter((r) => r.floorIndex === floorIndex).map((r) => ({ x: r.position.x, z: r.position.z, w: r.width, d: r.depth }));
  return boundsOf(rects);
}

/* ---------- tying the tour's rooms to the plan's ---------- */

/** Enough of a `Room` to recognise which room on the plan it is. */
export interface RoomLinkInput {
  id: string;
  name: string;
  /** `Room.planDims.planRoomName` — the plan's own name for it, when the wizard matched one. */
  planRoomName?: string;
  /** `Room.planDims.floor`. */
  floor?: string;
}

const fold = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Which plan room each tour room is, as `{ roomId: roomRef }`.
 *
 * The wizard records the plan's own name and floor on `Room.planDims`, so the strongest match is
 * both of those; a room the seller renamed still finds its plan room through them. Each plan room
 * is claimed once, in the order the rooms are given, so a flat with two identically named bedrooms
 * maps them to the plan's two rather than both to the first.
 */
export function linkRooms(graph: UnitGraph, rooms: readonly RoomLinkInput[]): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  const rounds: ((room: RoomLinkInput, plan: UnitRoom) => boolean)[] = [
    (r, p) => Boolean(r.planRoomName) && fold(r.planRoomName) === fold(p.name) && fold(r.floor) === fold(p.floor),
    (r, p) => Boolean(r.planRoomName) && fold(r.planRoomName) === fold(p.name),
    (r, p) => fold(r.name) === fold(p.name) && fold(r.floor) === fold(p.floor),
    (r, p) => fold(r.name) === fold(p.name),
  ];
  for (const matches of rounds) {
    for (const room of rooms) {
      if (out[room.id]) continue;
      const hit = graph.rooms.find((p) => !taken.has(p.roomRef) && matches(room, p));
      if (hit) {
        out[room.id] = hit.roomRef;
        taken.add(hit.roomRef);
      }
    }
  }
  return out;
}

/* ---------- the quarter turn between the plan's frame and the room's ---------- */

const COS = [1, 0, -1, 0];
const SIN = [0, 1, 0, -1];
const quarterOf = (q: number) => ((Math.round(q) % 4) + 4) % 4;

/** A direction turned by `q` quarter turns of yaw. Exact: the sines and cosines are 0 and ±1. */
function rotQuarter(v: readonly [number, number], q: number): readonly [number, number] {
  const i = quarterOf(q);
  const c = COS[i];
  const s = SIN[i];
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c];
}

function sideOfNormal(n: readonly [number, number]): WallSide {
  if (Math.abs(n[0]) > Math.abs(n[1])) return n[0] > 0 ? 'east' : 'west';
  return n[1] > 0 ? 'south' : 'north';
}

/** The wall a plan wall becomes when the room's world is turned by `q` quarter turns. */
export function foldWall(wall: WallSide, q: number): WallSide {
  return sideOfNormal(rotQuarter(NORMAL[wall], q));
}

/**
 * Whether that turn also reverses the wall's offsets — a wall's offset runs from its west or north
 * end, and a quarter turn can map a wall's start onto the other wall's finish.
 */
export function foldReverses(wall: WallSide, q: number): boolean {
  const turned = rotQuarter(ALONG[wall], q);
  const target = ALONG[foldWall(wall, q)];
  return turned[0] * target[0] + turned[1] * target[1] < 0;
}

/** Where a plan door lands on the room's own walls, under a given quarter turn. */
export function foldDoor(room: Pick<UnitRoom, 'width' | 'depth'>, door: Pick<UnitDoor, 'wall' | 'offset'>, q: number): { wall: WallSide; offset: number } {
  const length = wallLengthOf(room, door.wall);
  return { wall: foldWall(door.wall, q), offset: foldReverses(door.wall, q) ? length - door.offset : door.offset };
}

/* ---------- portals ---------- */

/** An opening the collider found in the wall band (`WorldWallRect.openings`). */
export interface ColliderOpening {
  wall: WallSide;
  offset: number;
  width: number;
}

/**
 * A doorway you can walk through: where the room's own wall opens, and which room is on the other
 * side of it.
 */
export interface Portal {
  id: string;
  fromRoomRef: string;
  toRoomRef: string;
  /** The plan's name for the room through it — what a marker in the scene says. */
  toName: string;
  /** The wall of the room's own frame it is in. */
  wall: WallSide;
  /** Metres from that wall's start. */
  offset: number;
  width: number;
  /** Metres, on the room's floor, in the room's own frame (centre at the origin). */
  x: number;
  z: number;
  /** Radians: looking out through the doorway. */
  yaw: number;
  /** `collider` when a measured opening is standing here; `plan` when only the drawing says so. */
  source: 'collider' | 'plan';
  /** Metres between where the plan puts this door and where the collider found the opening. */
  residual?: number;
  /** The quarter turn this portal was folded with. */
  quarters: number;
}

export interface PortalMatchInput {
  graph: UnitGraph;
  roomRef: string;
  /** The room's metric geometry — metres, Audora's room frame (`Room.geometry`). */
  geometry: { width: number; depth: number };
  /** What the collider measured, in the provider's raw units (`world.bounds.walls.openings`). */
  openings?: readonly ColliderOpening[];
  /** Metres per raw unit for those openings. 1 when they are already metres. */
  metresPerUnit?: number;
  /** Force the fold instead of taking the one that explains the most doors. */
  quarters?: number;
  toleranceM?: number;
}

export interface PortalMatch {
  portals: Portal[];
  /** The quarter turn between the plan's frame and the room's, that the portals were built with. */
  quarters: number;
  /** How many plan doors a measured opening was found for. */
  matched: number;
}

interface Pairing {
  matched: number;
  error: number;
  pairs: Map<number, number>;
}

/** Pair each plan door with the nearest unclaimed opening on the same wall, within tolerance. */
function pairDoors(room: UnitRoom, openings: readonly ColliderOpening[], q: number, tolerance: number): Pairing {
  const pairs = new Map<number, number>();
  const claimed = new Set<number>();
  let error = 0;
  room.doors.forEach((door, di) => {
    const want = foldDoor(room, door, q);
    let best = -1;
    let bestErr = Infinity;
    openings.forEach((o, oi) => {
      if (claimed.has(oi) || o.wall !== want.wall) return;
      const err = Math.abs(o.offset - want.offset);
      if (err <= tolerance && err < bestErr) {
        best = oi;
        bestErr = err;
      }
    });
    if (best >= 0) {
      pairs.set(di, best);
      claimed.add(best);
      error += bestErr;
    }
  });
  return { matched: pairs.size, error, pairs };
}

/**
 * The quarter turn that best explains the room: the one that puts the most of the plan's doors on
 * top of openings the collider actually measured, breaking ties on total offset error and then on
 * the smallest turn — so a room with nothing to go on stays where the capture put it.
 */
export function bestFold(room: UnitRoom, openings: readonly ColliderOpening[], tolerance = PORTAL_TOLERANCE_M): { quarters: number; matched: number; error: number } {
  let best = { quarters: 0, matched: -1, error: Infinity };
  for (let q = 0; q < 4; q++) {
    const { matched, error } = pairDoors(room, openings, q, tolerance);
    if (matched > best.matched || (matched === best.matched && error < best.error - 1e-9)) best = { quarters: q, matched, error };
  }
  return best;
}

/**
 * The doorways of one room, matched to what the collider measured.
 *
 * Each of the plan's doors is folded onto the room's own walls and then looked for in the
 * collider's openings, by wall and by offset within {@link PORTAL_TOLERANCE_M}. A door that is
 * found is placed **where the collider found it** — that is where the doorway is in the photograph,
 * and it is where the buyer has to walk. A door that is not found is still a portal, marked
 * `plan`, drawn where the drawing says: a draft world measures no openings at all, and a unit you
 * cannot walk through is worse than one whose doorway is 20 cm off.
 */
export function matchPortals({ graph, roomRef, geometry, openings = [], metresPerUnit = 1, quarters, toleranceM = PORTAL_TOLERANCE_M }: PortalMatchInput): PortalMatch {
  const room = roomOf(graph, roomRef);
  if (!room) return { portals: [], quarters: quarters ?? 0, matched: 0 };
  const scale = finite(metresPerUnit) && metresPerUnit > 0 ? metresPerUnit : 1;
  const metric: ColliderOpening[] = openings.map((o) => ({ wall: o.wall, offset: o.offset * scale, width: o.width * scale }));
  const q = quarters != null ? quarterOf(quarters) : bestFold(room, metric, toleranceM).quarters;
  const { pairs } = pairDoors(room, metric, q, toleranceM);

  const portals = room.doors.map((door, di) => {
    const want = foldDoor(room, door, q);
    const hit = pairs.has(di) ? metric[pairs.get(di)!] : undefined;
    const wall = hit ? hit.wall : want.wall;
    const length = wallLengthOf(geometry, wall);
    const width = Math.min(hit ? hit.width : door.width, length);
    const offset = clamp(hit ? hit.offset : want.offset, width / 2, length - width / 2);
    const point = wallPoint(geometry, wall, offset);
    const to = roomOf(graph, door.toRoomRef);
    return {
      id: `${room.roomRef}>${door.toRoomRef}`,
      fromRoomRef: room.roomRef,
      toRoomRef: door.toRoomRef,
      toName: to?.name ?? 'the next room',
      wall,
      offset: round(offset),
      width: round(width),
      x: round(point.x),
      z: round(point.z),
      yaw: yawOf(NORMAL[wall]),
      source: hit ? ('collider' as const) : ('plan' as const),
      ...(hit ? { residual: round(Math.abs(hit.offset - want.offset)) } : {}),
      quarters: q,
    };
  });
  return { portals, quarters: q, matched: pairs.size };
}

/**
 * Where the buyer stands, having walked through a portal: just inside the room it leads into,
 * facing in. Takes the *destination's* portal — the one pointing back the way they came — because
 * that is the doorway they are stepping out of.
 */
export function arrivalPose(portal: Pick<Portal, 'x' | 'z' | 'wall'>, geometry: { width: number; depth: number }, inset = ARRIVAL_INSET_M): { x: number; z: number; yaw: number } {
  const inward: readonly [number, number] = [-NORMAL[portal.wall][0], -NORMAL[portal.wall][1]];
  const margin = 0.25;
  return {
    x: round(clamp(portal.x + inward[0] * inset, -geometry.width / 2 + margin, geometry.width / 2 - margin)),
    z: round(clamp(portal.z + inward[1] * inset, -geometry.depth / 2 + margin, geometry.depth / 2 - margin)),
    yaw: yawOf(inward),
  };
}

/**
 * A pose in one room's own frame, expressed on the plan: the room's frame turned back by the
 * quarter turn {@link matchPortals} recovered, then moved onto the room's place on the sheet. This
 * is the one conversion the unit minimap needs, and the only place that turn is undone.
 */
export function toUnitPose(room: Pick<UnitRoom, 'position'>, pose: { x: number; z: number; yaw?: number }, quarters = 0): { x: number; z: number; yaw: number } {
  const i = quarterOf(quarters);
  // The inverse of the room's turn: R(−θ), with θ = i quarter turns.
  const c = COS[i];
  const s = SIN[i];
  return {
    x: room.position.x + (pose.x * c - pose.z * s),
    z: room.position.z + (pose.x * s + pose.z * c),
    yaw: normaliseYaw((pose.yaw ?? 0) - (i * Math.PI) / 2),
  };
}

/** {@link toUnitPose} the other way: a point on the sheet, in one room's own frame. */
export function toRoomPoint(room: Pick<UnitRoom, 'position'>, point: { x: number; z: number }, quarters = 0): { x: number; z: number } {
  const i = quarterOf(quarters);
  const c = COS[i];
  const s = SIN[i];
  const dx = point.x - room.position.x;
  const dz = point.z - room.position.z;
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
}
