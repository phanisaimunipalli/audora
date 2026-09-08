/**
 * Synthetic collider fixtures for the reconstruction eval — six box rooms whose dimensions,
 * ceiling, rotation and doorway are known exactly, because they are written in here.
 *
 * A real Marble collider is 76k vertices of a room the model imagined; there is no tape measure
 * behind it. So the eval's ground truth starts synthetic: a room authored in metres, converted to
 * the provider's raw units by a per-room `metresPerUnit`, turned by a known yaw, meshed as walls +
 * floor + ceiling, written as a real .glb, and then read back through the same
 * `measureColliderGlb` → `fuseScale` path the worker runs. Every number the eval reports is the
 * round trip: metres in, bytes, metres out.
 *
 * What is deliberately *not* clean about these fixtures:
 * - **The capture point is off centre and at eye height**, as a photographer's is. Everything the
 *   measurement reports is relative to it, so a fixture centred on the room would hide a whole
 *   class of frame bug.
 * - **The doorway leaks.** Where the door is, the mesh does not stop at the wall: it continues
 *   `beyond` times further along the same line of sight, which is what Marble does with an open
 *   door and what makes its bounding box the flat rather than the room. That is the case the wall
 *   rectangle exists for, and it is why every fixture's bounding box is much bigger than its room.
 * - **The scale is different in every room** (0.31 to 2.22 metres per raw unit, including the real
 *   `metric_scale_factor` of the demo full-quality world), so a fusion that quietly assumed one
 *   would fail five of six.
 *
 * Conventions:
 * - **The room's own frame is `(u, v)` in metres**, u across the width, v along the depth, the room
 *   centred on `(0, 0)`. Everything authored here is in that frame; the eval converts.
 * - **Pure and deterministic.** No clock, no randomness: the same spec always writes the same
 *   bytes, which is what lets the eval assert determinism over a re-read from disk.
 * - **Dependency-free** apart from `node:fs` for writing. No glTF library: the writer is 60 lines
 *   because a collider is one POSITION accessor per mesh and nothing else.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* ---------- the spec ---------- */

/** A wall of the room's own frame: `u-` is the low-u wall, `v+` the high-v one. */
export type RoomWall = 'u-' | 'u+' | 'v-' | 'v+';

export interface SyntheticRoom {
  id: string;
  title: string;
  /** Room size in metres: `widthM` along u, `depthM` along v, floor to ceiling `ceilingM`. */
  widthM: number;
  depthM: number;
  ceilingM: number;
  /** The room's yaw relative to the collider's raw axes, degrees. The photographer faced this way. */
  yawDeg: number;
  /** Metres per raw unit — the number fusion has to recover from nothing but a ceiling and a plan. */
  metresPerUnit: number;
  /** Where the photographer stood, in the room's own frame, metres from the room centre. */
  cameraM: { u: number; v: number };
  /** Height of the capture point above the floor, metres. */
  eyeM: number;
  door: {
    wall: RoomWall;
    /** Centre of the doorway along that wall, in the room's own frame (u for `v±`, v for `u±`). */
    centreM: number;
    widthM: number;
    heightM: number;
    /** How much further than the wall the mesh runs where the door is: the room next door. */
    beyond: number;
  };
  note: string;
}

/** Bump when a spec or the writer changes: `ensureSyntheticFixtures` rewrites the .glb files. */
export const FIXTURE_VERSION = 1;

/** Wall samples every 5 cm, a level every 10 cm, floor and ceiling on a 25 cm grid. */
const WALL_STEP_M = 0.05;
const LEVEL_STEP_M = 0.1;
const SLAB_STEP_M = 0.25;

/**
 * Six rooms, small to open-plan, at yaws from 0° to 80°.
 *
 * The sizes are the ones the product actually meets: a box bedroom, the demo corner room's own
 * measured 3.00 × 4.06 m, a wide kitchen, a long bedroom past the 45° fold where the fitted
 * rectangle swaps which axis it calls width, a tall studio, and the demo flat's 6.5 × 11.8 m
 * open plan — which is over `MAX_ROOM_AREA_M2` and must be *rejected* as one room, not measured
 * confidently. Door distances are 1.5–3.5 m from the capture point, so every doorway subtends
 * more than the 8° an opening needs to be seen at all.
 */
export const SYNTHETIC_ROOMS: SyntheticRoom[] = [
  {
    id: 'bedroom-small',
    title: 'Small bedroom, square to the capture',
    widthM: 2.4,
    depthM: 3.0,
    ceilingM: 2.44,
    yawDeg: 0,
    metresPerUnit: 0.6869,
    cameraM: { u: 0.3, v: -0.45 },
    eyeM: 1.5,
    door: { wall: 'u-', centreM: 0.2, widthM: 0.86, heightM: 2.03, beyond: 5 },
    note: 'The easy case: no rotation, a standard ceiling, a standard door 1.5 m away.',
  },
  {
    id: 'living-corner',
    title: 'Living room at 12°, the demo corner room’s own size',
    widthM: 3.0,
    depthM: 4.06,
    ceilingM: 2.5,
    yawDeg: 12,
    metresPerUnit: 0.4497,
    cameraM: { u: 0.42, v: -1.35 },
    eyeM: 1.55,
    door: { wall: 'v+', centreM: -0.6, widthM: 0.9, heightM: 2.03, beyond: 6 },
    note: 'The size the real corner-window world measures to, at a small yaw.',
  },
  {
    id: 'kitchen-wide',
    title: 'Wide kitchen at 30°',
    widthM: 4.2,
    depthM: 3.6,
    ceilingM: 2.7,
    yawDeg: 30,
    metresPerUnit: 1,
    cameraM: { u: -1.3, v: 0.55 },
    eyeM: 1.45,
    door: { wall: 'u+', centreM: -0.4, widthM: 0.95, heightM: 2.05, beyond: 5 },
    note: 'Raw units are metres here, so a scale error shows up as a scale error and nothing else.',
  },
  {
    id: 'bedroom-turned',
    title: 'Long bedroom at 52°, past the 45° fold',
    widthM: 3.1,
    depthM: 5.2,
    ceilingM: 2.44,
    yawDeg: 52,
    metresPerUnit: 2.2239592,
    cameraM: { u: 0.55, v: 1.8 },
    eyeM: 1.6,
    door: { wall: 'v-', centreM: 0, widthM: 1.1, heightM: 2.03, beyond: 5 },
    note: 'Past 45° the fitted rectangle names the room’s depth "width"; the plan has to be matched to it. Scale is the demo full-quality world’s real metric_scale_factor.',
  },
  {
    id: 'studio-tall',
    title: 'Studio at 63°, 3.00 m ceiling',
    widthM: 5,
    depthM: 5.2,
    ceilingM: 3,
    yawDeg: 63,
    metresPerUnit: 0.31,
    cameraM: { u: 0.9, v: -1.4 },
    eyeM: 1.52,
    door: { wall: 'u-', centreM: -1, widthM: 0.92, heightM: 2.03, beyond: 5 },
    note: 'A ceiling 56 cm above the assumed 2.44 m: the case where an assumed anchor alone is wrong by 19 %.',
  },
  {
    id: 'open-plan-flat',
    title: 'Open-plan flat at 80°, 6.5 × 11.8 m',
    widthM: 6.5,
    depthM: 11.8,
    ceilingM: 2.9,
    yawDeg: 80,
    metresPerUnit: 0.75,
    cameraM: { u: 1.1, v: 2.9 },
    eyeM: 1.48,
    door: { wall: 'v+', centreM: -1.2, widthM: 1.8, heightM: 2.1, beyond: 4 },
    note: 'The demo flat’s wall-band size. 76.7 m² is not one room: isOneRoom must reject it so the pipeline keeps the caller’s estimate.',
  },
];

/* ---------- the mesh ---------- */

/** The capture point in the mesh's own space: the room centre is the mesh origin. */
function cameraInMesh(spec: SyntheticRoom): { x: number; z: number } {
  const t = (spec.yawDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: (spec.cameraM.u * c - spec.cameraM.v * s) / spec.metresPerUnit, z: (spec.cameraM.u * s + spec.cameraM.v * c) / spec.metresPerUnit };
}

/** Is this point of this wall inside the doorway — i.e. did the model see the next room here? */
function isDoorway(spec: SyntheticRoom, wall: RoomWall, alongM: number, yM: number): boolean {
  const d = spec.door;
  return d.wall === wall && Math.abs(alongM - d.centreM) < d.widthM / 2 && yM < -spec.eyeM + d.heightM;
}

interface MeshPositions {
  /** Four walls, with the doorway pushed out to the room next door. */
  walls: number[];
  /** Floor and ceiling slabs — a second mesh, because a real collider is more than one primitive. */
  slabs: number[];
}

/**
 * The room as vertices in the collider's raw units, room centre at the mesh origin.
 *
 * `beyond` pushes a doorway point along the line of sight *from the capture point*, so the geometry
 * behind the door is where a reconstruction would put it: further away, in the same direction,
 * making the bounding box useless and the wall band the only honest measurement.
 */
export function roomPositions(spec: SyntheticRoom): MeshPositions {
  const mpu = spec.metresPerUnit;
  const t = (spec.yawDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const cam = cameraInMesh(spec);
  const walls: number[] = [];
  const slabs: number[] = [];
  const put = (into: number[], uM: number, vM: number, yM: number, times = 1) => {
    const x = (uM * c - vM * s) / mpu;
    const z = (uM * s + vM * c) / mpu;
    into.push(cam.x + (x - cam.x) * times, yM / mpu, cam.z + (z - cam.z) * times);
  };

  const u2 = spec.widthM / 2;
  const v2 = spec.depthM / 2;
  const floorM = -spec.eyeM;
  const stepsU = Math.max(2, Math.ceil(spec.widthM / WALL_STEP_M));
  const stepsV = Math.max(2, Math.ceil(spec.depthM / WALL_STEP_M));
  const levels = Math.max(4, Math.ceil(spec.ceilingM / LEVEL_STEP_M));
  for (let k = 0; k <= levels; k++) {
    const yM = floorM + (spec.ceilingM * k) / levels;
    for (let i = 0; i <= stepsU; i++) {
      const uM = -u2 + (spec.widthM * i) / stepsU;
      put(walls, uM, -v2, yM, isDoorway(spec, 'v-', uM, yM) ? spec.door.beyond : 1);
      put(walls, uM, v2, yM, isDoorway(spec, 'v+', uM, yM) ? spec.door.beyond : 1);
    }
    for (let j = 0; j <= stepsV; j++) {
      const vM = -v2 + (spec.depthM * j) / stepsV;
      put(walls, -u2, vM, yM, isDoorway(spec, 'u-', vM, yM) ? spec.door.beyond : 1);
      put(walls, u2, vM, yM, isDoorway(spec, 'u+', vM, yM) ? spec.door.beyond : 1);
    }
  }

  const gridU = Math.max(2, Math.ceil(spec.widthM / SLAB_STEP_M));
  const gridV = Math.max(2, Math.ceil(spec.depthM / SLAB_STEP_M));
  for (let i = 0; i <= gridU; i++) {
    for (let j = 0; j <= gridV; j++) {
      const uM = -u2 + (spec.widthM * i) / gridU;
      const vM = -v2 + (spec.depthM * j) / gridV;
      put(slabs, uM, vM, floorM);
      put(slabs, uM, vM, floorM + spec.ceilingM);
    }
  }
  return { walls, slabs };
}

/* ---------- a tiny GLB writer ---------- */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENT_FLOAT = 5126;

/** One node per mesh, all sharing a translation, POSITION accessors with their stated min/max. */
function writeGlb(meshes: number[][], translation: [number, number, number]): ArrayBuffer {
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const blobs: Uint8Array[] = [];
  let binLength = 0;
  for (const positions of meshes) {
    const count = Math.floor(positions.length / 3);
    const bytes = new Uint8Array(count * 12);
    const dv = new DataView(bytes.buffer);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        const v = positions[i * 3 + k];
        dv.setFloat32(i * 12 + k * 4, v, true);
        // State the box in the precision the file actually holds, as an exporter would.
        const f = Math.fround(v);
        if (f < min[k]) min[k] = f;
        if (f > max[k]) max[k] = f;
      }
    }
    views.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.length });
    accessors.push({ bufferView: views.length - 1, componentType: COMPONENT_FLOAT, count, type: 'VEC3', min, max });
    blobs.push(bytes);
    binLength += bytes.length + ((4 - (bytes.length % 4)) % 4);
  }

  const json = {
    asset: { version: '2.0', generator: 'audora evals/fixtures/reconstruction' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((_, i) => ({ mesh: i, translation })),
    meshes: meshes.map((_, i) => ({ primitives: [{ attributes: { POSITION: i } }] })),
    accessors,
    bufferViews: views,
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
  const binAt = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(binAt, binLength, true);
  dv.setUint32(binAt + 4, CHUNK_BIN, true);
  let at = binAt + 8;
  for (const bytes of blobs) {
    u8.set(bytes, at);
    at += bytes.length + ((4 - (bytes.length % 4)) % 4);
  }
  return buffer;
}

/** One room as a real .glb: two meshes (walls, slabs) under nodes that put the capture point at the origin. */
export function roomGlb(spec: SyntheticRoom): ArrayBuffer {
  const { walls, slabs } = roomPositions(spec);
  const cam = cameraInMesh(spec);
  return writeGlb([walls, slabs], [-cam.x, 0, -cam.z]);
}

/* ---------- writing the fixtures ---------- */

export interface SyntheticFixture {
  spec: SyntheticRoom;
  /** Absolute path of the .glb on disk. */
  file: string;
}

interface Manifest {
  version: number;
  note: string;
  rooms: SyntheticRoom[];
}

const MANIFEST_NOTE =
  'Generated by evals/fixtures/reconstruction/rooms.ts. Ground truth is exact by construction: each room is authored in metres, converted to raw units by metresPerUnit, turned by yawDeg and written as a .glb with the capture point at the origin. Delete this file to regenerate.';

function manifestOf(): Manifest {
  return { version: FIXTURE_VERSION, note: MANIFEST_NOTE, rooms: SYNTHETIC_ROOMS };
}

/**
 * The six .glb fixtures and their manifest, written into `dir` when they are missing or stale.
 *
 * Regenerating is deterministic and takes about 40 ms, so the eval simply calls this: a fresh
 * checkout has fixtures, and a changed spec cannot be scored against a stale mesh.
 */
export function ensureSyntheticFixtures(dir: string): SyntheticFixture[] {
  mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const wanted = JSON.stringify(manifestOf(), null, 2) + '\n';
  let stale = true;
  try {
    stale = readFileSync(manifestPath, 'utf8') !== wanted;
  } catch {
    stale = true;
  }
  const out: SyntheticFixture[] = [];
  for (const spec of SYNTHETIC_ROOMS) {
    const file = path.join(dir, `${spec.id}.glb`);
    let missing = false;
    try {
      missing = readFileSync(file).byteLength === 0;
    } catch {
      missing = true;
    }
    if (stale || missing) writeFileSync(file, new Uint8Array(roomGlb(spec)));
    out.push({ spec, file });
  }
  if (stale) writeFileSync(manifestPath, wanted);
  return out;
}
