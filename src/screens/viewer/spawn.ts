import type { DoorSpec, PlacedPiece, RoomGeometry } from '@/engine/types';
import { pointInFootprint } from '@/engine/geometry';
import { spawnPose } from '@/three/walkMath';
import type { Pose } from '@/three/viewerStore';

const RADIUS = 0.3;

function blocked(x: number, z: number, room: RoomGeometry, solids: PlacedPiece[]): boolean {
  if (Math.abs(x) > room.width / 2 - RADIUS || Math.abs(z) > room.depth / 2 - RADIUS) return true;
  for (const p of solids) {
    if (pointInFootprint({ x, z }, { x: p.x, z: p.z, w: p.w + RADIUS * 2, d: p.d + RADIUS * 2, rot: p.rot })) return true;
  }
  return false;
}

/**
 * A standing spot that is not inside furniture. Starts from `base` (or just inside the door) and, when
 * that is blocked, walks forward and sideways until it finds clear floor. The walker collides with
 * solids, so spawning inside one would leave the renter stuck.
 *
 * `door` is the doorway the shell actually cut (`doorOpeningsFor`, three/RoomShell) — the room's own
 * door spec is only where the reconstruction put the photographer, and once a floor plan says where
 * this room's doors are, spawning at the spec puts the renter in front of a wall. Ignored when
 * `base` is given, which is every real capture: there the renter starts where the camera stood.
 */
/** No furniture at all, as one stable array, so a caller memoising on it does not thrash. */
const NO_PIECES: PlacedPiece[] = [];

/**
 * The staged pieces a spawn has to stay out of: the ones the walker will actually meet.
 *
 * The viewer collides with staged furniture only while the staging layer is drawn
 * (`showStaging`), so a spawn computed against the whole list steps the renter aside for a sofa
 * that is neither rendered nor solid — up to 1.72 m from the doorway on the demo unit — and then
 * lets them walk straight through where it "was", which is the opposite of the reason
 * {@link freeSpawn} avoids solids at all. One rule, so the two cannot disagree.
 */
export function spawnSolids(pieces: PlacedPiece[], showStaging: boolean): PlacedPiece[] {
  return showStaging ? pieces : NO_PIECES;
}

export function freeSpawn(room: RoomGeometry, pieces: PlacedPiece[], base?: Pose, door?: Pick<DoorSpec, 'wall' | 'offset'>): Pose {
  const p = base ?? spawnPose(room, door ?? room.door);
  const solids = pieces.filter((s) => !s.flat);
  if (!blocked(p.x, p.z, room, solids)) return p;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  for (let step = 0; step <= 5; step += 0.25) {
    for (const side of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
      const x = p.x + fx * step + rx * side;
      const z = p.z + fz * step + rz * side;
      if (!blocked(x, z, room, solids)) return { x, z, yaw: p.yaw };
    }
  }
  return { x: 0, z: 0, yaw: p.yaw };
}
