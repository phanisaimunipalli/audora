import { describe, expect, it } from 'vitest';
import type { PlacedPiece, RoomGeometry } from '../src/engine/types';
import { pieceStatus, buyerVerdict } from '../src/engine/fit';
import { insideRoom } from '../src/engine/geometry';
import { dropFootprint } from '../src/screens/viewer/dropPoint';

const room: RoomGeometry = {
  width: 5.38,
  depth: 5.03,
  height: 2.44,
  door: { wall: 'south', offset: 3.6, width: 0.9, height: 2.03 },
  windows: [],
};

const piece = (id: string, kind: PlacedPiece['kind'], x: number, z: number, w: number, d: number, rot = 0): PlacedPiece => ({
  id,
  itemId: id,
  name: id,
  kind,
  x,
  z,
  w,
  d,
  h: 0.6,
  rot,
  owner: 'seller',
  verified: true,
});

/** The corner room's staging: a king bed against the north wall with a nightstand beside it. */
const staging: PlacedPiece[] = [piece('king bed', 'bed', -0.4, -1.2, 1.9, 2.1), piece('nightstand', 'nightstand', 0.9, -2.0, 0.45, 0.4)];

const QUEEN = { w: 1.6, d: 2.1 };

function probe(f: { x: number; z: number; w: number; d: number; rot: number }): PlacedPiece {
  return { ...piece('mine', 'bed', f.x, f.z, f.w, f.d, f.rot), owner: 'buyer', verified: false };
}

describe('dropFootprint', () => {
  it('lands a buyer piece on free floor rather than on top of the staging', () => {
    // The buyer stands at the capture point looking north — straight at the staged bed.
    const f = dropFootprint(room, QUEEN.w, QUEEN.d, { x: 0.2, z: 1.8, yaw: 0 }, staging);
    expect(pieceStatus(probe(f), staging, room)).toBe('ok');
    expect(insideRoom(f, room)).toBe(true);
    const v = buyerVerdict(probe(f), staging, room);
    expect(v.fits).toBe(true);
  });

  it('keeps it out of the viewer\'s lap', () => {
    const pose = { x: 0.2, z: 1.8, yaw: 0 };
    const f = dropFootprint(room, QUEEN.w, QUEEN.d, pose, staging);
    expect(Math.hypot(f.x - pose.x, f.z - pose.z)).toBeGreaterThan(0.9);
  });

  it('uses the spot straight ahead when it is free', () => {
    const pose = { x: 0, z: 2, yaw: 0 };
    const f = dropFootprint(room, 0.9, 0.9, pose, []);
    expect(f.x).toBeCloseTo(0, 1);
    expect(f.z).toBeLessThan(2);
    expect(pieceStatus(probe(f), [], room)).toBe('ok');
  });

  it('finds floor behind the buyer when everything ahead is taken', () => {
    // A wall of wardrobes across the north half; the only free floor is behind the viewer.
    const wall: PlacedPiece[] = [
      piece('a', 'wardrobe', -1.8, -0.6, 1.6, 3.4),
      piece('b', 'wardrobe', 0, -0.6, 1.6, 3.4),
      piece('c', 'wardrobe', 1.8, -0.6, 1.6, 3.4),
    ];
    const f = dropFootprint(room, 1.2, 0.9, { x: 0, z: 1.4, yaw: 0 }, wall);
    expect(pieceStatus(probe(f), wall, room)).toBe('ok');
  });

  it('falls back to the asked-for spot when the room genuinely has no room', () => {
    const full: PlacedPiece[] = [piece('slab', 'bed', 0, 0, 5.3, 4.9)];
    const f = dropFootprint(room, 1.6, 2.1, { x: 0, z: 2, yaw: 0 }, full);
    expect(insideRoom(f, room)).toBe(true);
    expect(buyerVerdict(probe(f), full, room).fits).toBe(false);
  });
});
