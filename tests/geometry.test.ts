import { describe, expect, it } from 'vitest';
import { clampToRoom, corners, doorSwing, insideRoom, overlaps, placeAgainstWall, separation, snapToWalls, wallGaps } from '../src/engine/geometry';
import type { RoomGeometry } from '../src/engine/types';

const room: RoomGeometry = {
  width: 4,
  depth: 5,
  height: 2.6,
  door: { wall: 'south', offset: 1, width: 0.9, height: 2.03 },
  windows: [{ wall: 'north', offset: 2, width: 1.4, height: 1.2, sill: 0.9 }],
};

describe('oriented rectangles', () => {
  it('detects overlap and touching', () => {
    const a = { x: 0, z: 0, w: 2, d: 1, rot: 0 };
    expect(overlaps(a, { x: 1, z: 0, w: 2, d: 1, rot: 0 })).toBe(true);
    expect(overlaps(a, { x: 2, z: 0, w: 2, d: 1, rot: 0 })).toBe(false); // edge to edge
    expect(overlaps(a, { x: 2.5, z: 0, w: 2, d: 1, rot: 0 })).toBe(false);
  });
  it('handles rotation', () => {
    const a = { x: 0, z: 0, w: 2, d: 0.5, rot: 0 };
    const b = { x: 0, z: 1, w: 2, d: 0.5, rot: Math.PI / 2 }; // vertical bar crossing a
    expect(overlaps(a, b)).toBe(true);
    const c = { x: 0, z: 1.5, w: 2, d: 0.5, rot: Math.PI / 2 };
    expect(overlaps(a, c)).toBe(false);
  });
  it('computes separation', () => {
    const a = { x: 0, z: 0, w: 2, d: 1, rot: 0 };
    expect(separation(a, { x: 3, z: 0, w: 2, d: 1, rot: 0 })).toBeCloseTo(1, 5);
    expect(separation(a, { x: 0, z: 2, w: 2, d: 1, rot: 0 })).toBeCloseTo(1, 5);
    expect(separation(a, { x: 0.5, z: 0, w: 2, d: 1, rot: 0 })).toBe(0);
  });
  it('rotated corners land where expected', () => {
    const c = corners({ x: 0, z: 0, w: 2, d: 1, rot: Math.PI / 2 });
    const xs = c.map((p) => Math.abs(p.x));
    const zs = c.map((p) => Math.abs(p.z));
    expect(Math.max(...xs)).toBeCloseTo(0.5, 5);
    expect(Math.max(...zs)).toBeCloseTo(1, 5);
  });
});

describe('room bounds', () => {
  it('clamps to walls', () => {
    const f = clampToRoom({ x: 5, z: -9, w: 1, d: 1, rot: 0 }, room);
    expect(f.x).toBeCloseTo(1.5);
    expect(f.z).toBeCloseTo(-2);
    expect(insideRoom(f, room)).toBe(true);
  });
  it('snaps when close to a wall', () => {
    const f = snapToWalls({ x: 1.45, z: 0, w: 1, d: 1, rot: 0 }, room, 0.12);
    expect(f.x).toBeCloseTo(1.5);
    expect(wallGaps(f, room).east).toBeCloseTo(0);
  });
  it('places against a wall facing inward', () => {
    const sofa = placeAgainstWall(room, 'north', 2, 2.2, 0.95);
    expect(sofa.z).toBeCloseTo(-2.5 + 0.475);
    expect(sofa.rot).toBe(0);
    const east = placeAgainstWall(room, 'east', 2.5, 2.2, 0.95);
    expect(east.x).toBeCloseTo(2 - 0.475);
    expect(insideRoom(east, room)).toBe(true);
  });
  it('door swing sits just inside the door wall', () => {
    const s = doorSwing(room);
    expect(s.z).toBeCloseTo(2.5 - 0.45);
    expect(s.x).toBeCloseTo(-2 + 1);
  });
});
