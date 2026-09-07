import type { Footprint, RoomGeometry, Vec2, WallSide } from './types';

const EPS = 1e-6;

export function corners(f: Footprint): Vec2[] {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const hw = f.w / 2;
  const hd = f.d / 2;
  // local (lx, lz) -> world: x = cx + lx*c + lz*s ; z = cz - lx*s + lz*c  (rotation about +Y)
  const pts: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return pts.map(([lx, lz]) => ({ x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c }));
}

/** Half-extents of the axis-aligned bounding box of a rotated footprint. */
export function extents(f: Footprint): { ex: number; ez: number } {
  const c = Math.abs(Math.cos(f.rot));
  const s = Math.abs(Math.sin(f.rot));
  return { ex: (f.w * c + f.d * s) / 2, ez: (f.w * s + f.d * c) / 2 };
}

export function aabb(f: Footprint) {
  const { ex, ez } = extents(f);
  return { minX: f.x - ex, maxX: f.x + ex, minZ: f.z - ez, maxZ: f.z + ez };
}

export function area(f: Footprint): number {
  return f.w * f.d;
}

function project(pts: Vec2[], ax: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const v = p.x * ax.x + p.z * ax.z;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

function axesOf(f: Footprint): Vec2[] {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  return [
    { x: c, z: -s },
    { x: s, z: c },
  ];
}

/** Separating-axis test for two oriented rectangles. Touching edges do not count as overlap. */
export function overlaps(a: Footprint, b: Footprint): boolean {
  const pa = corners(a);
  const pb = corners(b);
  for (const ax of [...axesOf(a), ...axesOf(b)]) {
    const [amin, amax] = project(pa, ax);
    const [bmin, bmax] = project(pb, ax);
    if (amax <= bmin + EPS || bmax <= amin + EPS) return false;
  }
  return true;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const wx = p.x - a.x;
  const wz = p.z - a.z;
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2));
  const dx = p.x - (a.x + t * vx);
  const dz = p.z - (a.z + t * vz);
  return Math.hypot(dx, dz);
}

/** Minimum gap between two oriented rectangles (0 when they overlap). */
export function separation(a: Footprint, b: Footprint): number {
  if (overlaps(a, b)) return 0;
  const pa = corners(a);
  const pb = corners(b);
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const a1 = pa[i];
    const a2 = pa[(i + 1) % 4];
    const b1 = pb[i];
    const b2 = pb[(i + 1) % 4];
    for (let j = 0; j < 4; j++) {
      best = Math.min(best, segDist(pb[j], a1, a2), segDist(pa[j], b1, b2));
    }
  }
  return best;
}

export function pointInFootprint(p: Vec2, f: Footprint): boolean {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const dx = p.x - f.x;
  const dz = p.z - f.z;
  // inverse rotation
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= f.w / 2 + EPS && Math.abs(lz) <= f.d / 2 + EPS;
}

export function insideRoom(f: Footprint, room: RoomGeometry, tolerance = 1e-3): boolean {
  const { minX, maxX, minZ, maxZ } = aabb(f);
  return (
    minX >= -room.width / 2 - tolerance &&
    maxX <= room.width / 2 + tolerance &&
    minZ >= -room.depth / 2 - tolerance &&
    maxZ <= room.depth / 2 + tolerance
  );
}

export function fitsInRoom(f: Footprint, room: RoomGeometry): boolean {
  const { ex, ez } = extents(f);
  return ex * 2 <= room.width + 1e-6 && ez * 2 <= room.depth + 1e-6;
}

/** Push a footprint back inside the walls. If it cannot fit at all it is centred. */
export function clampToRoom(f: Footprint, room: RoomGeometry): Footprint {
  const { ex, ez } = extents(f);
  const maxX = room.width / 2 - ex;
  const maxZ = room.depth / 2 - ez;
  const x = maxX < 0 ? 0 : Math.max(-maxX, Math.min(maxX, f.x));
  const z = maxZ < 0 ? 0 : Math.max(-maxZ, Math.min(maxZ, f.z));
  return { ...f, x, z };
}

/** Gap between the footprint's bounding box and each wall (negative when poking through). */
export function wallGaps(f: Footprint, room: RoomGeometry): Record<WallSide, number> {
  const { minX, maxX, minZ, maxZ } = aabb(f);
  return {
    west: minX + room.width / 2,
    east: room.width / 2 - maxX,
    north: minZ + room.depth / 2,
    south: room.depth / 2 - maxZ,
  };
}

/** Snap flush to any wall that is within `threshold` metres. */
export function snapToWalls(f: Footprint, room: RoomGeometry, threshold = 0.12): Footprint {
  const gaps = wallGaps(f, room);
  let { x, z } = f;
  if (Math.abs(gaps.west) <= threshold) x -= gaps.west;
  else if (Math.abs(gaps.east) <= threshold) x += gaps.east;
  if (Math.abs(gaps.north) <= threshold) z -= gaps.north;
  else if (Math.abs(gaps.south) <= threshold) z += gaps.south;
  return { ...f, x, z };
}

/** Snap rotation to the nearest multiple of `step` radians (default 15°). */
export function snapRotation(rot: number, step = Math.PI / 12): number {
  return Math.round(rot / step) * step;
}

/** World-space centre of a wall-mounted feature (door/window) plus the direction the wall faces into the room. */
export function wallFeaturePosition(
  room: RoomGeometry,
  wall: WallSide,
  offset: number,
): { x: number; z: number; inward: Vec2; along: Vec2 } {
  switch (wall) {
    case 'north':
      return { x: -room.width / 2 + offset, z: -room.depth / 2, inward: { x: 0, z: 1 }, along: { x: 1, z: 0 } };
    case 'south':
      return { x: -room.width / 2 + offset, z: room.depth / 2, inward: { x: 0, z: -1 }, along: { x: 1, z: 0 } };
    case 'east':
      return { x: room.width / 2, z: -room.depth / 2 + offset, inward: { x: -1, z: 0 }, along: { x: 0, z: 1 } };
    case 'west':
      return { x: -room.width / 2, z: -room.depth / 2 + offset, inward: { x: 1, z: 0 }, along: { x: 0, z: 1 } };
  }
}

/** The floor area a door needs to swing open: a square of the door width just inside the wall. */
export function doorSwing(room: RoomGeometry): Footprint {
  const { door } = room;
  const p = wallFeaturePosition(room, door.wall, door.offset);
  const half = door.width / 2;
  return { x: p.x + p.inward.x * half, z: p.z + p.inward.z * half, w: door.width, d: door.width, rot: 0 };
}

export function wallLength(room: RoomGeometry, wall: WallSide): number {
  return wall === 'north' || wall === 'south' ? room.width : room.depth;
}

/** Rotation that makes a piece's front (local +z) face into the room from the given wall. */
export function rotationFacingFromWall(wall: WallSide): number {
  switch (wall) {
    case 'north':
      return 0;
    case 'south':
      return Math.PI;
    case 'east':
      return -Math.PI / 2;
    case 'west':
      return Math.PI / 2;
  }
}

/** Centre for a piece of size (w,d) placed with its back flush against `wall`, `along` metres from the wall start. */
export function placeAgainstWall(
  room: RoomGeometry,
  wall: WallSide,
  along: number,
  w: number,
  d: number,
  inset = 0,
): Footprint {
  const rot = rotationFacingFromWall(wall);
  const p = wallFeaturePosition(room, wall, along);
  const half = d / 2 + inset;
  return { x: p.x + p.inward.x * half, z: p.z + p.inward.z * half, w, d, rot };
}

export function oppositeWall(wall: WallSide): WallSide {
  return wall === 'north' ? 'south' : wall === 'south' ? 'north' : wall === 'east' ? 'west' : 'east';
}

export function adjacentWalls(wall: WallSide): [WallSide, WallSide] {
  return wall === 'north' || wall === 'south' ? ['west', 'east'] : ['north', 'south'];
}

export function wallLabel(room: RoomGeometry, wall: WallSide): string {
  if (room.door.wall === wall) return 'the door wall';
  if (room.windows.some((w) => w.wall === wall)) return 'the window wall';
  return `the ${wall} wall`;
}

export function round(n: number, dp = 2): number {
  const p = 10 ** dp;
  return Math.round(n * p) / p;
}
