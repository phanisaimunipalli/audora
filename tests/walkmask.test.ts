import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildWalkMask } from '../src/three/walkMask';
import { blocked, standable } from '../src/three/walkMath';
import type { RoomGeometry } from '../src/engine/types';

/**
 * A box of four walls, `size` metres across, floor at y = 0, `height` tall — the shape a Marble
 * collider has where the real walls are, inside a room rectangle that is deliberately larger (the
 * bounding box of everything the camera saw, windows included).
 */
function boxRoom(size = 4, height = 2.4, offset = { x: 0, z: 0 }): THREE.Object3D {
  const h = size / 2;
  const corners: [number, number][] = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const pos: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = corners[i];
    const [x2, z2] = corners[(i + 1) % 4];
    const a = [x1 + offset.x, 0, z1 + offset.z];
    const b = [x2 + offset.x, 0, z2 + offset.z];
    const c = [x2 + offset.x, height, z2 + offset.z];
    const d = [x1 + offset.x, height, z1 + offset.z];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  const group = new THREE.Group();
  group.add(mesh);
  group.updateMatrixWorld(true);
  return group;
}

const room: RoomGeometry = {
  // deliberately 40% wider than the real walls, the way `rawFromBounds` overstates a corner room
  width: 5.6,
  depth: 5.6,
  height: 2.6,
  door: { wall: 'south', offset: 1.2, width: 0.85, height: 2.03 },
  windows: [],
};

describe('buildWalkMask', () => {
  it('keeps the walker inside the real walls, not inside the bounding box', () => {
    const mask = buildWalkMask(boxRoom(4), { seed: { x: 0, z: 0 }, reach: 8 });
    expect(mask).not.toBeNull();
    expect(mask!.blocked(0, 0)).toBe(false);
    expect(mask!.blocked(1.4, 0)).toBe(false);
    // the wall is at 2.0; with the walker's radius grown in, 1.8 and beyond is out
    expect(mask!.blocked(1.85, 0)).toBe(true);
    expect(mask!.blocked(2.4, 0)).toBe(true);
    // ...and the room rectangle alone would happily let them stand there
    expect(blocked(2.4, 0, room, [])).toBe(false);
    expect(blocked(2.4, 0, room, [], mask)).toBe(true);
  });

  it('reports a plausible floor area and blocks everything outside the flood', () => {
    const mask = buildWalkMask(boxRoom(4), { seed: { x: 0, z: 0 }, reach: 8 })!;
    // (4 − 2 × 0.25)² ≈ 12.25 m², give or take the cell size
    expect(mask.areaM2).toBeGreaterThan(9);
    expect(mask.areaM2).toBeLessThan(14);
    expect(mask.blocked(7.9, 7.9)).toBe(true);
    expect(mask.blocked(-100, 0)).toBe(true);
  });

  it('follows a capture point that is not at the room centre', () => {
    const mask = buildWalkMask(boxRoom(4, 2.4, { x: 1, z: 0 }), { seed: { x: 1, z: 0 }, reach: 8 })!;
    expect(mask.blocked(1, 0)).toBe(false);
    expect(mask.blocked(-1.2, 0)).toBe(true);
    expect(mask.blocked(2.5, 0)).toBe(false);
  });

  it('gives up rather than freezing the walker when the mesh says nothing useful', () => {
    // a ceiling-only mesh: nothing in the wall band
    const high = buildWalkMask(boxRoom(4, 0.1), { seed: { x: 0, z: 0 }, reach: 8 });
    expect(high).toBeNull();
    // a seed walled into a cupboard-sized space
    expect(buildWalkMask(boxRoom(0.6), { seed: { x: 0, z: 0 }, reach: 8 })).toBeNull();
    expect(buildWalkMask(new THREE.Group(), { seed: { x: 0, z: 0 }, reach: 8 })).toBeNull();
  });
});

describe('standable with a mask', () => {
  const mask = buildWalkMask(boxRoom(4), { seed: { x: 0, z: 0 }, reach: 8 })!;

  it('stops a click-to-glide at the real wall instead of walking through it', () => {
    // the QA case: a click on the floor beyond the photographed wall, inside the room rectangle
    const dest = standable(2.6, 0, 0, 0, room, [], mask)!;
    expect(dest).not.toBeNull();
    expect(dest.x).toBeLessThan(1.85);
    expect(mask.blocked(dest.x, dest.z)).toBe(false);
  });

  it('walks someone who is already outside back in', () => {
    const dest = standable(0, 0, 2.5, 0, room, [], mask)!;
    expect(dest).not.toBeNull();
    expect(mask.blocked(dest.x, dest.z)).toBe(false);
  });

  it('still reaches a clear target inside the room', () => {
    const dest = standable(1.2, 1.2, -1, -1, room, [], mask)!;
    expect(dest.x).toBeCloseTo(1.2, 1);
    expect(dest.z).toBeCloseTo(1.2, 1);
  });
});
