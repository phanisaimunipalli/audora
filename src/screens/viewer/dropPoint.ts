import type { Footprint, PlacedPiece, RoomGeometry } from '@/engine/types';
import { clampToRoom } from '@/engine/geometry';
import { pieceStatus } from '@/engine/fit';
import { spawnPose } from '@/three/WalkControls';
import type { Pose } from '@/three/viewerStore';

/**
 * Where a buyer's piece lands when they test it: 1.2 m in front of where they stand
 * (or in front of the door when they have not walked yet), facing them. When that spot
 * is taken by another piece, slide sideways until it is free; if nothing is free, the room centre.
 */
export function dropFootprint(room: RoomGeometry, w: number, d: number, pose: Pose | undefined, occupied: PlacedPiece[]): Footprint {
  const p = pose ?? spawnPose(room);
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const ahead = 1.2 + d / 2;
  const base = { x: p.x + fx * ahead, z: p.z + fz * ahead };
  const rot = p.yaw;
  const probe = (x: number, z: number): Footprint => clampToRoom({ x, z, w, d, rot }, room);
  const trial: PlacedPiece = { id: '__probe', itemId: 'custom', name: 'probe', kind: 'box', h: 1, owner: 'buyer', verified: false, x: 0, z: 0, w, d, rot };
  const step = Math.max(0.6, w * 0.6);
  for (const k of [0, 1, -1, 2, -2, 3, -3]) {
    const f = probe(base.x + rx * step * k, base.z + rz * step * k);
    if (pieceStatus({ ...trial, ...f }, occupied, room) === 'ok') return f;
  }
  const centre = probe(0, 0);
  if (pieceStatus({ ...trial, ...centre }, occupied, room) === 'ok') return centre;
  return probe(base.x, base.z);
}
