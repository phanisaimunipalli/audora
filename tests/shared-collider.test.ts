/// <reference types="node" />
/**
 * The shared collider reader and the measurement on top of it (`shared/collider.ts`), driven
 * end-to-end: a real .glb, written here byte by byte, read back and measured.
 *
 * `tests/collider.test.ts` already drives the wall-band arithmetic with synthetic point sets. What
 * this file adds is everything between the bytes and those points — the GLB container, interleaved
 * accessors, node transforms — plus the three properties the accuracy pass depends on:
 *
 * 1. a box room of known size, with a door in one wall, measures back to within 1 %,
 * 2. the same mesh mirrored (`COLLIDER_MIRROR`: the collider arrives as a reflection of the splat's
 *    frame) gives the same room, reflected in x and not resized, and
 * 3. a room the photographer met at 30° comes back with its 30° recovered, not smeared into a
 *    bounding box a third too big.
 *
 * No network and no fixtures: the .glb is built in the test, so the expected numbers are the ones
 * that were written in.
 */
import { describe, expect, it } from 'vitest';
import {
  applyMirror,
  boundsFromAccessors,
  COLLIDER_MIRROR,
  measureCollider,
  measureColliderGlb,
  readGlbPositions,
  roomRect,
  type WorldBounds,
} from '../shared/collider';

/* ---------- a tiny GLB writer ---------- */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface GlbMesh {
  /** Flat `[x, y, z, …]` in the mesh's own space. */
  positions: number[];
  translation?: [number, number, number];
  /** Quaternion `[x, y, z, w]`, glTF order. */
  rotation?: [number, number, number, number];
  /** Extra bytes between vertices, to exercise the interleaved path. */
  padFloats?: number;
}

/** A .glb with one node per mesh, POSITION accessors, and whatever node transforms were asked for. */
function writeGlb(meshes: GlbMesh[]): ArrayBuffer {
  const views: { byteOffset: number; byteLength: number; byteStride?: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const chunks: { bytes: Uint8Array; stride: number; count: number }[] = [];
  let binLength = 0;
  for (const mesh of meshes) {
    const count = Math.floor(mesh.positions.length / 3);
    const stride = 12 + 4 * (mesh.padFloats ?? 0);
    const bytes = new Uint8Array(count * stride);
    const dv = new DataView(bytes.buffer);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        const v = mesh.positions[i * 3 + k];
        dv.setFloat32(i * stride + k * 4, v, true);
        // The accessor states the box of what it holds, in Float32 precision, as an exporter would.
        const f = Math.fround(v);
        if (f < min[k]) min[k] = f;
        if (f > max[k]) max[k] = f;
      }
    }
    views.push({ byteOffset: binLength, byteLength: bytes.length, ...(stride === 12 ? {} : { byteStride: stride }) });
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count, type: 'VEC3', min, max });
    chunks.push({ bytes, stride, count });
    binLength += bytes.length + ((4 - (bytes.length % 4)) % 4);
  }

  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({
      mesh: i,
      ...(m.translation ? { translation: m.translation } : {}),
      ...(m.rotation ? { rotation: m.rotation } : {}),
    })),
    meshes: meshes.map((_, i) => ({ primitives: [{ attributes: { POSITION: i } }] })),
    accessors,
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    buffers: [{ byteLength: binLength }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + binLength;
  const buffer = new ArrayBuffer(total);
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true);
  dv.setUint32(16, CHUNK_JSON, true);
  u8.set(jsonBytes, 20);
  u8.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad); // JSON pads with spaces
  const binChunk = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(binChunk, binLength, true);
  dv.setUint32(binChunk + 4, CHUNK_BIN, true);
  let at = binChunk + 8;
  for (const chunk of chunks) {
    u8.set(chunk.bytes, at);
    at += chunk.bytes.length + ((4 - (chunk.bytes.length % 4)) % 4);
  }
  return buffer;
}

/* ---------- a room, as a collider carries it ---------- */

interface RoomSpec {
  /** Room size in raw units, in the room's own frame. */
  w: number;
  d: number;
  /** Yaw of the room relative to the raw axes, radians. */
  yaw?: number;
  floor?: number;
  ceiling?: number;
  /**
   * A doorway in the `-x` wall of the room's own frame, as a span in the room's own z. Where the
   * door is, the reconstruction did not put a wall: it put the next room, `times` further along the
   * same line of sight — which is what Marble does with an open door, and what makes its bounding
   * box the flat.
   */
  door?: { from: number; to: number; times?: number };
  /** The capture point, in the mesh's own space — the node translation, negated. */
  camera: [number, number];
  samples?: number;
}

/** Four walls, a floor slab and a ceiling slab, authored around the room's own centre. */
function roomPoints(spec: RoomSpec): number[] {
  const { w, d, yaw = 0, floor = -1.55, ceiling = 0.95, door, camera, samples = 200 } = spec;
  const out: number[] = [];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // `times` pushes a point away along the line of sight FROM THE CAMERA, which is what a
  // reconstruction does where it saw past a wall — so it has to know where the camera stands.
  const put = (u: number, v: number, y: number, times = 1) => {
    const x = u * c - v * s;
    const z = u * s + v * c;
    out.push(camera[0] + (x - camera[0]) * times, y, camera[1] + (z - camera[1]) * times);
  };
  const levels = 24;
  for (let k = 0; k <= levels; k++) {
    const y = floor + ((ceiling - floor) * k) / levels;
    for (let i = 0; i <= samples; i++) {
      const u = -w / 2 + (w * i) / samples;
      const v = -d / 2 + (d * i) / samples;
      // The doorway: no wall from the floor to the head of the opening, the next room instead.
      const open = door && v > door.from && v < door.to && y < floor + 2.05;
      put(u, d / 2, y);
      put(u, -d / 2, y);
      put(w / 2, v, y);
      put(-w / 2, v, y, open ? (door!.times ?? 6) : 1);
    }
  }
  const grid = 60;
  for (let i = 0; i <= grid; i++) {
    for (let j = 0; j <= grid; j++) {
      put(-w / 2 + (w * i) / grid, -d / 2 + (d * j) / grid, floor);
      put(-w / 2 + (w * i) / grid, -d / 2 + (d * j) / grid, ceiling);
    }
  }
  return out;
}

/** The room this file measures: 3.00 × 4.00 raw units, 2.50 high, the camera 0.4 / 0.6 off centre. */
const ROOM = { w: 3, d: 4, floor: -1.55, ceiling: 0.95 };
/** Where the room's centre sits relative to the capture point, which is the origin. */
const CENTRE: [number, number, number] = [0.4, 0, 0.6];
/** The doorway, as a span in the room's own z (0.9 wide, its centre 0.55 past the room centre). */
const DOOR = { from: 0.1, to: 1.0 };

const within = (value: number, expected: number, fraction: number) => expect(Math.abs(value - expected)).toBeLessThanOrEqual(Math.abs(expected) * fraction);

function boxRoomGlb(over: Partial<RoomSpec> = {}, node: Partial<GlbMesh> = {}): ArrayBuffer {
  const camera: [number, number] = [-CENTRE[0], -CENTRE[2]];
  return writeGlb([{ positions: roomPoints({ ...ROOM, door: DOOR, camera, ...over }), translation: CENTRE, padFloats: 1, ...node }]);
}

describe('readGlbPositions', () => {
  it('reads interleaved POSITION data and applies the node transform', () => {
    const glb = writeGlb([{ positions: [1, 2, 3, 4, 5, 6], translation: [10, 0, -10], padFloats: 2 }]);
    expect(Array.from(readGlbPositions(glb))).toEqual([11, 2, -7, 14, 5, -4]);
    // The accessors state the box before the transform; `boundsFromAccessors` places it too.
    expect(boundsFromAccessors(glb)).toMatchObject({ minX: 11, maxX: 14, minY: 2, maxY: 5, minZ: -7, maxZ: -4 });
  });

  it('reads every mesh in the file, and refuses bytes that are not a GLB', () => {
    const two = writeGlb([{ positions: [0, 0, 0] }, { positions: [1, 1, 1], translation: [0, 1, 0] }]);
    expect(Array.from(readGlbPositions(two))).toEqual([0, 0, 0, 1, 2, 1]);
    expect(() => readGlbPositions(new ArrayBuffer(8))).toThrow(/GLB/);
  });
});

describe('measureCollider, on a box room read out of a .glb', () => {
  const glb = boxRoomGlb();
  const bounds = measureColliderGlb(glb);

  it('is the same measurement whether the vertices arrive as bytes or as an array', () => {
    expect(bounds).toEqual(measureCollider(readGlbPositions(glb), boundsFromAccessors(glb)));
  });

  it('measures the floor, the ceiling and both wall runs to within 1 %', () => {
    expect(bounds.method).toBe('walls');
    // The slabs are the mesh's own planes, and they are where they were written.
    within(bounds.floorY as number, ROOM.floor, 0.01);
    within(bounds.ceilingY as number, ROOM.ceiling, 0.01);
    const walls = bounds.walls!;
    within(walls.maxX - walls.minX, ROOM.w, 0.01); // 2.996 of 3.000
    within(walls.maxZ - walls.minZ, ROOM.d, 0.01); // 3.994 of 4.000
    // Capture-relative, so the node translation that placed the room has to have been applied:
    // the +x wall is 1.9 units away and the −x wall 1.1, not 1.5 and 1.5.
    within(walls.maxX, CENTRE[0] + ROOM.w / 2, 0.01);
    within(walls.minX, CENTRE[0] - ROOM.w / 2, 0.01);
    expect(walls.rotation).toBeLessThan(0.02);
    expect(walls.score ?? 0).toBeGreaterThan(0.6);
  });

  it('puts the doorway on the right wall, at the right place along it', () => {
    // The bounding box swallowed the room next door; the wall rectangle did not.
    expect((bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ)).toBeGreaterThan(2 * ROOM.w * ROOM.d);
    const openings = bounds.walls?.openings ?? [];
    expect(openings).toHaveLength(1);
    // The room's own −x wall is Audora's west wall, and an offset along it counts from the north end.
    const rect = roomRect(bounds)!;
    expect(openings[0].wall).toBe('west');
    // The wall band is binned at 1°, and the door's wall is 1.1 units away, so its edges can only
    // be located to ~2 cm: 0.882 for a 0.900 door, and an offset 2 cm along the wall.
    within(openings[0].width, DOOR.to - DOOR.from, 0.03);
    // The door's centre in Audora's axes: raw +z is our north, so the wall runs from −z to +z and
    // the offset is measured from the north end.
    const centreZ = -(CENTRE[2] + (DOOR.from + DOOR.to) / 2);
    expect(Math.abs(openings[0].offset - (centreZ - rect.minZ))).toBeLessThan(0.05);
  });

  it("reports the room in Audora's axes, capture point at the origin", () => {
    const rect = roomRect(bounds)!;
    expect(rect.yaw).toBeCloseTo(0, 2);
    within(rect.maxX - rect.minX, ROOM.w, 0.01);
    within(rect.maxZ - rect.minZ, ROOM.d, 0.01);
    // Raw +z is our north (the frame is `(x, z) → (x, −z)`), so the room's centre is at −0.6.
    within((rect.minZ + rect.maxZ) / 2, -CENTRE[2], 0.02);
    within((rect.minX + rect.maxX) / 2, CENTRE[0], 0.02);
  });
});

describe('the mirror the collider arrives with (COLLIDER_MIRROR)', () => {
  const bounds = measureColliderGlb(boxRoomGlb());
  const mirrored = measureCollider(applyMirror(readGlbPositions(boxRoomGlb())));

  it('is a reflection in x, not a resize', () => {
    expect(COLLIDER_MIRROR).toEqual([-1, 1, 1]);
    const a = bounds.walls!;
    const b = mirrored.walls!;
    expect(b.maxX - b.minX).toBeCloseTo(a.maxX - a.minX, 6);
    expect(b.maxZ - b.minZ).toBeCloseTo(a.maxZ - a.minZ, 6);
    expect(b.score).toBe(a.score);
    expect(mirrored.floorY).toBeCloseTo(bounds.floorY as number, 6);
    expect(mirrored.ceilingY).toBeCloseTo(bounds.ceilingY as number, 6);
  });

  it('gives the same rectangle, read through roomRect, with x reflected and z untouched', () => {
    const a = roomRect(bounds)!;
    const b = roomRect(mirrored)!;
    expect(b.minX).toBeCloseTo(-a.maxX, 6);
    expect(b.maxX).toBeCloseTo(-a.minX, 6);
    expect(b.minZ).toBeCloseTo(a.minZ, 6);
    expect(b.maxZ).toBeCloseTo(a.maxZ, 6);
  });

  it('keeps the doorway the same size, on the mirrored wall', () => {
    const door = bounds.walls!.openings![0];
    const mirroredDoor = mirrored.walls!.openings![0];
    expect(mirroredDoor.wall).toBe('east'); // the west wall, reflected
    expect(mirroredDoor.width).toBeCloseTo(door.width, 6);
    expect(mirroredDoor.offset).toBeCloseTo(door.offset, 6);
  });
});

describe('a room the photographer met at 30°', () => {
  const bounds: WorldBounds = measureColliderGlb(boxRoomGlb({ yaw: Math.PI / 6, door: undefined }));

  it('recovers the turn instead of reporting the diagonal', () => {
    expect(bounds.method).toBe('walls');
    const walls = bounds.walls!;
    expect((walls.rotation * 180) / Math.PI).toBeCloseTo(30, 0);
    // The box it replaces is the room's diagonal: 4.6 × 5.0 for a 3.0 × 4.0 room.
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(1.4 * ROOM.w);
    expect((bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ)).toBeGreaterThan(1.4 * ROOM.w * ROOM.d);
  });

  it("measures the room itself to within 2 %, in Audora's axes", () => {
    const rect = roomRect(bounds)!;
    // yaw is the turn that puts the room's walls back on our axes: the room is 30° round in raw,
    // and the raw → world map flips z, so the world turn is −30°.
    expect((rect.yaw * 180) / Math.PI).toBeCloseTo(-30, 0);
    within(rect.maxX - rect.minX, ROOM.w, 0.02);
    within(rect.maxZ - rect.minZ, ROOM.d, 0.02);
  });
});
