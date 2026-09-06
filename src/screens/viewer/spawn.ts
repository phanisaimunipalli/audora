import type { PlacedPiece, RoomGeometry } from '@/engine/types';
import { pointInFootprint } from '@/engine/geometry';
import { spawnPose } from '@/three/WalkControls';
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
 * solids, so spawning inside one would leave the buyer stuck.
 */
export function freeSpawn(room: RoomGeometry, pieces: PlacedPiece[], base?: Pose): Pose {
  const p = base ?? spawnPose(room);
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
