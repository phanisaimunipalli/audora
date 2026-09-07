import type { Footprint, PlacedPiece, RoomGeometry } from '@/engine/types';
import { clampToRoom } from '@/engine/geometry';
import { pieceStatus } from '@/engine/fit';
import { spawnPose } from '@/three/walkMath';
import type { Pose } from '@/three/viewerStore';

/** Metres of clear air a buyer wants between them and a piece that has just landed. */
const MIN_AHEAD = 1.2;
/** Closer than this and the piece is a slab across the lens rather than furniture in a room. */
const MIN_CLEAR = 0.9;
/** Candidate spacing for the floor sweep. */
const STEP = 0.25;

interface Candidate {
  x: number;
  z: number;
  rot: number;
  cost: number;
}

/**
 * Where a buyer's piece lands when they test it.
 *
 * The honest answer to "will my queen bed fit?" is about the room, never about where the buyer
 * happened to be standing — so a piece dropped on top of the staged bed and reported as "does not
 * fit" is a bug, not a verdict. This sweeps the whole floor and takes the cheapest spot that is
 * genuinely clear: in front of the buyer and about a stride away if such a spot exists, anywhere
 * else in the room if it does not, turned a quarter turn only as a last resort. Only when the room
 * truly has no free rectangle of this size does the piece land overlapping — and then the verdict
 * is the truth.
 */
export function dropFootprint(room: RoomGeometry, w: number, d: number, pose: Pose | undefined, occupied: PlacedPiece[]): Footprint {
  const p = pose ?? spawnPose(room);
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const probe = (x: number, z: number, rot: number): Footprint => clampToRoom({ x, z, w, d, rot }, room);
  const trial: PlacedPiece = { id: '__probe', itemId: 'custom', name: 'probe', kind: 'box', h: 1, owner: 'buyer', verified: false, x: 0, z: 0, w, d, rot: 0 };
  const free = (f: Footprint) => pieceStatus({ ...trial, ...f }, occupied, room) === 'ok';

  // A big piece needs to stand further off or it fills the frame; a stool can land at arm's length.
  const ahead = Math.max(MIN_AHEAD, d * 0.8) + d / 2;
  const want = { x: p.x + fx * ahead, z: p.z + fz * ahead };

  const first = probe(want.x, want.z, p.yaw);
  if (free(first)) return first;

  const candidates: Candidate[] = [];
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  const angles = [p.yaw, p.yaw + Math.PI / 2];
  for (let i = 0; i < angles.length; i++) {
    const rot = angles[i];
    for (let x = -halfW + STEP / 2; x < halfW; x += STEP) {
      for (let z = -halfD + STEP / 2; z < halfD; z += STEP) {
        const dxp = x - p.x;
        const dzp = z - p.z;
        const dist = Math.hypot(dxp, dzp) || 1e-6;
        const forward = (dxp * fx + dzp * fz) / dist;
        let cost = Math.hypot(x - want.x, z - want.z);
        // In their line of sight, please: a piece that appears behind the buyer reads as a no-show.
        if (forward < 0.25) cost += 4;
        // ...and not on their toes.
        if (dist < MIN_CLEAR + Math.max(w, d) / 2) cost += 8;
        // Turning it is a compromise, so only if nothing at this angle works.
        if (i) cost += 0.5;
        candidates.push({ x, z, rot, cost });
      }
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  for (const c of candidates) {
    const f = probe(c.x, c.z, c.rot);
    if (free(f)) return f;
  }

  // Nothing in the room is clear: land it where they asked and let the verdict say why.
  const centre = probe(0, 0, p.yaw);
  return free(centre) ? centre : first;
}
