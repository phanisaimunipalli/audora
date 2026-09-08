/// <reference types="node" />
/**
 * The mock provider's assets — the ones the whole pipeline is exercised against with no key, no
 * network and no credits (docs/BACKEND.md §4, "the mock provider is the end-to-end path").
 *
 * The collider is the one that has to be real. Since the accuracy pass (docs/ACCURACY.md §3.2) the
 * worker MEASURES the collider it just stored, so a mock world whose `collider.glb` is an empty
 * glTF would leave the whole measurement path — the GLB reader, the floor and ceiling slabs, the
 * wall rectangle, the fusion, the metric room — unexercised by every test that runs the pipeline
 * end to end. So the mock draws a room: four walls, a floor slab, a ceiling slab and one doorway
 * the reconstruction saw through, written into a real .glb.
 *
 * Conventions:
 * - **Deterministic.** No clock, no randomness: the same spec always produces the same bytes, so a
 *   mock world's collider hashes the same on every machine and every run.
 * - **Raw units, capture point at the origin.** Exactly the frame `shared/collider.ts` measures in:
 *   the mesh is authored around the room's centre and a node translation puts that centre where it
 *   belongs relative to the photographer, so reading the file has to apply the node transform to
 *   get the room back — which is the thing worth testing.
 * - **Small.** ~7k vertices, about 85 kB. Enough for a 1°-binned wall band to see four walls AND
 *   the doorway (which needs the samples: at 64 per wall run the door's bins hold no evidence
 *   rather than a far surface, and the opening goes unreported), few enough that a test can build a
 *   dozen of them without noticing.
 * - Dependency-free apart from `node:buffer`; nothing here imports `src/` or `shared/`.
 *
 * Compiles under tsconfig.node.json (bundler) and tsconfig.server.json (NodeNext): relative
 * imports inside server/ carry the `.js` extension.
 */
import { Buffer } from 'node:buffer';

/* ---------- a minimal .glb writer ---------- */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;

/** One mesh in the file: its vertices in its own space, and where its node puts that space. */
export interface GlbMesh {
  /** Flat `[x, y, z, …]`. */
  positions: ArrayLike<number>;
  translation?: readonly [number, number, number];
}

const pad4 = (n: number): number => (4 - (n % 4)) % 4;

/**
 * A glTF 2.0 binary with one node and one POSITION accessor per mesh. Tight (no `byteStride`) and
 * indexless, because a point cloud of a room is all the collider measurement reads.
 */
export function writeGlb(meshes: GlbMesh[]): Buffer {
  const bufferViews: Record<string, number>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const chunks: Buffer[] = [];
  let binLength = 0;
  for (const mesh of meshes) {
    const count = Math.floor(mesh.positions.length / 3);
    const bytes = Buffer.alloc(count * 12);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i += 1) {
      for (let k = 0; k < 3; k += 1) {
        const v = mesh.positions[i * 3 + k];
        bytes.writeFloatLE(v, i * 12 + k * 4);
        // The accessor states the box of what it holds in the precision it is stored in, the way a
        // real exporter does, so `boundsFromAccessors` agrees with the vertices to the last bit.
        const f = Math.fround(v);
        if (f < min[k]) min[k] = f;
        if (f > max[k]) max[k] = f;
      }
    }
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.length });
    accessors.push({ bufferView: bufferViews.length - 1, componentType: FLOAT, count, type: 'VEC3', min, max });
    chunks.push(bytes);
    binLength += bytes.length + pad4(bytes.length);
  }

  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0', generator: 'audora-mock' },
      scene: 0,
      scenes: [{ nodes: meshes.map((_, i) => i) }],
      nodes: meshes.map((m, i) => ({ mesh: i, ...(m.translation ? { translation: [...m.translation] } : {}) })),
      meshes: meshes.map((_, i) => ({ primitives: [{ attributes: { POSITION: i }, mode: 0 }] })),
      accessors,
      bufferViews,
      buffers: [{ byteLength: binLength }],
    }),
    'utf8',
  );
  const jsonPad = pad4(json.length);
  const out = Buffer.alloc(12 + 8 + json.length + jsonPad + 8 + binLength);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length + jsonPad, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  json.copy(out, 20);
  out.fill(0x20, 20 + json.length, 20 + json.length + jsonPad); // the JSON chunk pads with spaces
  const bin = 20 + json.length + jsonPad;
  out.writeUInt32LE(binLength, bin);
  out.writeUInt32LE(CHUNK_BIN, bin + 4);
  let at = bin + 8;
  for (const chunk of chunks) {
    chunk.copy(out, at);
    at += chunk.length + pad4(chunk.length);
  }
  return out;
}

/* ---------- the room the mock reconstructs ---------- */

/**
 * A doorway in one wall, as a span in the room's own depth axis. Where the door is, the model did
 * not see a wall: it saw the next room, `times` further along the same line of sight — which is
 * what Marble does with an open door, and what makes its bounding box bigger than the room.
 */
export interface MockDoorway {
  from: number;
  to: number;
  times: number;
}

export interface MockRoomSpec {
  /** Room size in raw units. */
  width: number;
  depth: number;
  height: number;
  /** The floor plane, relative to the capture point (which is the origin and the camera's eye). */
  floorY: number;
  /** Where the room's centre sits relative to the capture point: the photographer stands off it. */
  centre: readonly [number, number];
  /** The doorway in the room's `-x` wall, or none. */
  door?: MockDoorway | null;
  /** Points along each wall run, per height level. */
  samples: number;
  /** Height levels of wall points, floor to ceiling. */
  levels: number;
  /** Floor and ceiling slabs are a `grid × grid` lattice each. */
  grid: number;
}

/**
 * The mock's room: 5.00 × 6.00 × 3.50 raw units, which is **3.50 × 4.20 m with a 2.45 m ceiling**
 * at the 0.70 m/unit a tapped interior door gives (2.03 m over 2.9 units). Round numbers on both
 * sides of the anchor, so a test can state what the measurement should come back as without
 * copying a magic constant out of the implementation.
 *
 * The photographer stands 0.5 units west and 0.8 units north of the centre, in the doorway of the
 * `-x` wall — the reconstruction saw six times too far through it, so the mesh's bounding box is
 * the flat and only the wall rectangle is the room.
 */
export const MOCK_ROOM: MockRoomSpec = {
  width: 5,
  depth: 6,
  height: 3.5,
  // 1.60 m of eye height in a 2.44 m room, expressed in this room's units: the camera sits 2.30
  // units above the floor of a 3.50-unit room.
  floorY: -2.3,
  centre: [0.5, 0.8],
  door: { from: -0.5, to: 0.5, times: 6 },
  samples: 128,
  levels: 12,
  grid: 12,
};

/** Metres per raw unit the mock room was drawn for: a tapped interior door, 2.03 m over 2.9 units. */
export const MOCK_ROOM_METRES_PER_UNIT = 0.7;

/**
 * The room as a point cloud in the mesh's own space (centred on the room), ready for a node whose
 * translation is `spec.centre`. Walls first, then the floor and ceiling slabs the densest-slab
 * detector needs.
 */
export function mockRoomPositions(spec: MockRoomSpec = MOCK_ROOM): Float32Array {
  const { width: w, depth: d, height: h, floorY, centre, door, samples, levels, grid } = spec;
  const ceilingY = floorY + h;
  // The camera, in the mesh's own space: the capture point is the origin of the world, and the node
  // translation moves this mesh by `centre`, so the camera sits at minus that.
  const camX = -centre[0];
  const camZ = -centre[1];
  const out: number[] = [];
  // A point pushed `times` further along the ray from the camera: what the model reconstructed
  // where it could see past a wall.
  const put = (x: number, y: number, z: number, times = 1): void => {
    out.push(camX + (x - camX) * times, y, camZ + (z - camZ) * times);
  };
  // The head of the doorway: a 2.03 m door in a 2.44 m room, in this room's units.
  const doorHead = floorY + (2.03 / 2.44) * h;
  for (let k = 0; k <= levels; k += 1) {
    const y = floorY + (h * k) / levels;
    for (let i = 0; i <= samples; i += 1) {
      const x = -w / 2 + (w * i) / samples;
      const z = -d / 2 + (d * i) / samples;
      put(x, y, d / 2);
      put(x, y, -d / 2);
      put(w / 2, y, z);
      // The doorway: no wall from the floor to the head of the opening, the next room instead.
      const open = door != null && z > door.from && z < door.to && y < doorHead;
      put(-w / 2, y, z, open ? door!.times : 1);
    }
  }
  for (let i = 0; i <= grid; i += 1) {
    for (let j = 0; j <= grid; j += 1) {
      const x = -w / 2 + (w * i) / grid;
      const z = -d / 2 + (d * j) / grid;
      put(x, floorY, z);
      put(x, ceilingY, z);
    }
  }
  return Float32Array.from(out);
}

/** The mock provider's `collider.glb`: {@link MOCK_ROOM}, as bytes a glTF reader can open. */
export function mockColliderGlb(spec: MockRoomSpec = MOCK_ROOM): Buffer {
  return writeGlb([{ positions: mockRoomPositions(spec), translation: [spec.centre[0], 0, spec.centre[1]] }]);
}
