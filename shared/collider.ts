/**
 * Measuring a room out of a provider's collider mesh — the one copy of that arithmetic.
 *
 * `shared/` is compiled into both builds (tsconfig.app.json for the browser, tsconfig.server.json
 * for the worker), so the number the pipeline stores on a room and the number the viewer draws come
 * from the same code. The browser keeps its own `fetch` (services/marble) and the server its own
 * download; everything from the bytes onward is here.
 *
 * Conventions:
 * - **Dependency-free.** No imports at all: no three, no node built-ins, nothing from `src/` or
 *   `server/`. `readGlbPositions` is a small glTF reader because pulling a loader into the worker
 *   for eight floats per vertex is not worth it.
 * - **Pure and deterministic.** No clock, no randomness, no locale. The same vertices always give
 *   the same measurement, because that measurement is hashed into what a room reports.
 * - **Raw units, capture point at the origin.** Nothing here knows metres; scale arrives later
 *   (`shared/fusion.ts`). Distances are the provider's own units and every extent is stated
 *   relative to the capture point, which is the origin of the collider's frame.
 * - **Two frames, named.** The mesh arrives y-up with the camera at the origin. Audora's axes are
 *   x east, z south, so the horizontal map is `(x, z) → (x, −z)`; `roomRect` is the only place that
 *   turn is applied, and everything else reads the rectangle through it.
 *
 * ## The collider is a reflection, not a rotation (`COLLIDER_MIRROR`)
 *
 * Marble delivers the SPZ splat in its `marble_raw_opencv` frame (y down, z forward) and the
 * collider as `(x_raw, −y_raw, z_raw)` — a *reflection* of it, which is why the viewer draws the
 * mesh with `scale = COLLIDER_MIRROR` inside a group turned by `π + yaw` (src/three/splat/frame.ts
 * has the full table). Measurement happens in the collider's delivered frame, before the mirror:
 * the mirror is a symmetry of everything measured here — the wall band is radial about the capture
 * point, and the fitted rectangle comes back the same size, the same score and the same openings,
 * reflected in x (`minX ↔ −maxX`, `rotation → −rotation` folded back into `[0, π/2)`). Feeding
 * mirrored vertices in is therefore safe and tested; what it must never do is silently change the
 * room's dimensions.
 */

/* ---------- shapes (structurally identical to src/state/types.ts) ---------- */

export type WallSide = 'north' | 'south' | 'east' | 'west';

/** An opening found in the wall band — a window, or a doorway into the next room. Raw units. */
export interface WallOpening {
  /** The wall of Audora's metric room it falls on. */
  wall: WallSide;
  /** Distance along that wall from its start (west end for north/south, north end for east/west). */
  offset: number;
  width: number;
}

/**
 * The room's own walls, measured from the collider's wall band and expressed the same way the
 * bounding box is: raw units, **relative to the capture point**, which sits at the origin.
 *
 * `rotation` is the yaw of the fitted rectangle relative to the provider's axes, radians in
 * [0, π/2). The extents are the room's own, each named after the raw axis it is closer to — a
 * labelling that preserves sizes and capture-point distances but not the sense of the axes.
 * **Read the rectangle through {@link roomRect}**; nothing else should interpret these four
 * numbers directly.
 *
 * `score` is the fraction of the wall band (0..1) that lies on this rectangle — how much of a room
 * the mesh really is.
 */
export interface WallRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  rotation: number;
  score?: number;
  openings?: WallOpening[];
}

/** Which measurement the room extent came from. */
export type ExtentMethod = 'walls' | 'aabb';

/**
 * Everything the collider mesh knows about the room, in raw units with the capture point at the
 * origin. Exactly what a world stores (`RoomWorld['bounds']`, `rooms.geometry` on the server), so a
 * measurement can be put on a record as it is and read back after a round trip through JSON.
 */
export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /** The mesh's own floor and ceiling planes: the densest horizontal slab in the bottom / top quarter. */
  floorY?: number;
  ceilingY?: number;
  walls?: WallRect;
  method?: ExtentMethod;
}

export interface DoorSpec {
  wall: WallSide;
  offset: number;
  width: number;
  height: number;
}

export interface WindowSpec extends DoorSpec {
  sill: number;
}

/** Room proportions in raw units: `src/engine/types.ts` `RawGeometry`, structurally. */
export interface RawRoomGeometry {
  width: number;
  depth: number;
  height: number;
  door: DoorSpec;
  windows: WindowSpec[];
  /** Height of a standard door in raw units (what makes the door a scale anchor). */
  doorHeightUnits: number;
  /** Height of an outlet centre in raw units. */
  outletHeightUnits: number;
}

/* ---------- everyday heights (mirrors src/engine/anchor.ts) ---------- */

/** The ceiling every "how many raw units is this height" question assumes until an anchor says otherwise. */
export const CEILING_HEIGHT_M = 2.44;
/** Knees to shoulders: the slice of a room that is wall rather than floor or ceiling. */
export const WALL_BAND_MARGIN_M = 0.3;
/** A plausible window: sill 0.90 m, head 2.10 m. Used only where the reconstruction is silent. */
export const WINDOW_SILL_M = 0.9;
export const WINDOW_HEAD_M = 2.1;

/**
 * A height in metres expressed in the raw units of a reconstruction whose floor-to-ceiling distance
 * is `ceilingUnits`, assuming a standard ceiling — the same assumption `anchorFromCeiling` makes,
 * so the two agree to the centimetre.
 */
export function unitsFromMetres(metres: number, ceilingUnits: number): number {
  if (!(ceilingUnits > 0)) return 0;
  return (metres / CEILING_HEIGHT_M) * ceilingUnits;
}

/**
 * The scale that puts a delivered collider mesh back into the same frame as the splat: a reflection
 * in x. See the module header — this is a *drawing* convention, not a measurement one.
 *
 * Verified on the demo world 24be684c against `public/demo/empty-room-corner-windows.jpg`: with
 * this mirror, looking from the capture point into the room puts the tall window on the LEFT wall
 * and the small window on the far wall, and the wireframe hugs the panorama's walls. Without it the
 * room is a mirror image of the photograph. It is also why the horizontal map is `(x, z) → (x, −z)`
 * rather than a plain 180° turn: raw +x is our EAST, not our west.
 *
 * `src/three/MarbleWorld.tsx` re-exports this rather than restating it.
 */
export const COLLIDER_MIRROR: [number, number, number] = [-1, 1, 1];

/** A vertex array with a per-axis sign applied. Used to prove the measurement survives the mirror. */
export function applyMirror(xyz: ArrayLike<number>, mirror: readonly [number, number, number] = COLLIDER_MIRROR): Float32Array {
  const out = new Float32Array(xyz.length - (xyz.length % 3));
  for (let i = 0; i + 2 < out.length; i += 3) {
    out[i] = xyz[i] * mirror[0];
    out[i + 1] = xyz[i + 1] * mirror[1];
    out[i + 2] = xyz[i + 2] * mirror[2];
  }
  return out;
}

const AZIMUTH_BINS = 360;
const RAD = Math.PI / 180;

/* ---------- reading the collider ---------- */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENT_FLOAT = 5126;

/** A 4×4 column-major matrix, glTF's own layout. */
type Mat4 = number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** glTF TRS → matrix, in the order the spec states: `M = T · R · S`. */
function trs(t?: number[], r?: number[], s?: number[]): Mat4 {
  const [x, y, z, w] = r && r.length === 4 ? r : [0, 0, 0, 1];
  const [sx, sy, sz] = s && s.length === 3 ? s : [1, 1, 1];
  const [tx, ty, tz] = t && t.length === 3 ? t : [0, 0, 0];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function nodeMatrix(node: Record<string, unknown> | undefined): Mat4 {
  if (!node) return IDENTITY;
  const m = node.matrix;
  if (Array.isArray(m) && m.length === 16 && m.every((v) => typeof v === 'number' && Number.isFinite(v))) return m as Mat4;
  return trs(node.translation as number[] | undefined, node.rotation as number[] | undefined, node.scale as number[] | undefined);
}

interface Placement {
  mesh: number;
  matrix: Mat4;
}

/**
 * Every mesh the file draws, with the world matrix its node chain gives it. A mesh no node
 * references is still read, at identity: a collider exported as a bare mesh list is common, and
 * dropping its vertices would silently report a room with no walls.
 */
function placements(json: any): Placement[] {
  const nodes: any[] = Array.isArray(json?.nodes) ? json.nodes : [];
  const meshCount = Array.isArray(json?.meshes) ? json.meshes.length : 0;
  const out: Placement[] = [];
  const drawn = new Set<number>();
  const scene = json?.scenes?.[typeof json?.scene === 'number' ? json.scene : 0];
  const roots: number[] = Array.isArray(scene?.nodes)
    ? scene.nodes
    : // No scene: every node is a root, minus the ones that are somebody's child.
      nodes.map((_, i) => i).filter((i) => !nodes.some((n) => Array.isArray(n?.children) && n.children.includes(i)));
  const seen = new Set<number>();
  const walk = (index: number, parent: Mat4) => {
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length || seen.has(index)) return;
    seen.add(index);
    const node = nodes[index];
    const matrix = multiply(parent, nodeMatrix(node));
    if (Number.isInteger(node?.mesh) && node.mesh >= 0 && node.mesh < meshCount) {
      out.push({ mesh: node.mesh, matrix });
      drawn.add(node.mesh);
    }
    for (const child of Array.isArray(node?.children) ? node.children : []) walk(child, matrix);
    // A node may be reached again through another parent; the first chain wins, which is stable.
  };
  for (const root of roots) walk(root, IDENTITY);
  for (let i = 0; i < meshCount; i++) if (!drawn.has(i)) out.push({ mesh: i, matrix: IDENTITY });
  return out;
}

interface Chunks {
  json: any;
  bin: { start: number; length: number } | null;
}

function splitGlb(buf: ArrayBuffer): Chunks {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('Not a GLB file');
  const total = Math.min(dv.getUint32(8, true), buf.byteLength);
  let off = 12;
  let json: any = null;
  let bin: { start: number; length: number } | null = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (off + 8 + len > buf.byteLength) break;
    if (type === CHUNK_JSON && !json) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    if (type === CHUNK_BIN && !bin) bin = { start: off + 8, length: len };
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

/**
 * Every float POSITION in a .glb, in world space, as one flat `[x, y, z, …]` array.
 *
 * Interleaved buffer views (`byteStride`) and node transforms are both applied; sparse accessors
 * and non-float positions are skipped, because no collider a provider has ever handed us used them
 * and guessing is worse than measuring less.
 */
export function readGlbPositions(buffer: ArrayBuffer): Float32Array {
  const { json, bin } = splitGlb(buffer);
  return positionsOf(buffer, json, bin, placements(json));
}

function positionsOf(buffer: ArrayBuffer, json: any, bin: { start: number; length: number } | null, places: Placement[]): Float32Array {
  if (!bin) return new Float32Array(0);
  const dv = new DataView(buffer, bin.start, bin.length);
  const chunks: Float32Array[] = [];
  let total = 0;
  for (const { mesh, matrix } of places) {
    for (const prim of json.meshes?.[mesh]?.primitives || []) {
      const acc = json.accessors?.[prim?.attributes?.POSITION];
      if (!acc || acc.componentType !== COMPONENT_FLOAT || acc.type !== 'VEC3') continue;
      const view = json.bufferViews?.[acc.bufferView];
      if (!view) continue;
      const stride = view.byteStride || 12;
      const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
      const count = Math.max(0, acc.count | 0);
      const part = new Float32Array(count * 3);
      let w = 0;
      for (let i = 0; i < count; i++) {
        const at = base + i * stride;
        if (at < 0 || at + 12 > bin.length) break;
        const x = dv.getFloat32(at, true);
        const y = dv.getFloat32(at + 4, true);
        const z = dv.getFloat32(at + 8, true);
        part[w++] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
        part[w++] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
        part[w++] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
      }
      if (w) {
        chunks.push(w === part.length ? part : part.subarray(0, w));
        total += w;
      }
    }
  }
  const out = new Float32Array(total);
  let at = 0;
  for (const part of chunks) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The bounding box glTF states in its accessors, before a single vertex is read. */
export function boundsFromAccessors(buffer: ArrayBuffer): WorldBounds | undefined {
  const { json } = splitGlb(buffer);
  return statedBounds(json, placements(json));
}

function statedBounds(json: any, places: Placement[]): WorldBounds | undefined {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const { mesh, matrix } of places) {
    for (const prim of json.meshes?.[mesh]?.primitives || []) {
      const acc = json.accessors?.[prim?.attributes?.POSITION];
      if (!Array.isArray(acc?.min) || !Array.isArray(acc?.max)) continue;
      // The node transform can rotate the box, so every corner of it is a candidate.
      for (let c = 0; c < 8; c++) {
        const p = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
        const x = matrix[0] * p[0] + matrix[4] * p[1] + matrix[8] * p[2] + matrix[12];
        const y = matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2] + matrix[13];
        const z = matrix[2] * p[0] + matrix[6] * p[1] + matrix[10] * p[2] + matrix[14];
        if (x < b.minX) b.minX = x;
        if (x > b.maxX) b.maxX = x;
        if (y < b.minY) b.minY = y;
        if (y > b.maxY) b.maxY = y;
        if (z < b.minZ) b.minZ = z;
        if (z > b.maxZ) b.maxZ = z;
      }
    }
  }
  return Number.isFinite(b.minX) ? b : undefined;
}

/** Read a collider .glb and measure the room in it: the container is parsed once. */
export function measureColliderGlb(buffer: ArrayBuffer): WorldBounds {
  const { json, bin } = splitGlb(buffer);
  const places = placements(json);
  return measureCollider(positionsOf(buffer, json, bin, places), statedBounds(json, places));
}

/* ---------- the measurement ---------- */

/**
 * Measure a room from a collider's vertices: bounding box, floor and ceiling planes, and the wall
 * rectangle. `xyz` is a flat `[x, y, z, …]` array in the provider's raw units with the capture
 * point at the origin, so a synthetic point set exercises exactly what a 76k-vertex mesh does.
 *
 * The bounding box alone is not the room — Marble reconstructs what it saw *through* the windows —
 * which is why this reads the vertices rather than trusting the accessors' min/max (`stated`, used
 * only when there are no vertices at all).
 */
export function measureCollider(xyz: ArrayLike<number>, stated?: WorldBounds): WorldBounds {
  const aabb = boundsOfPositions(xyz) ?? stated;
  if (!aabb) throw new Error('Collider has no positions');
  const b: WorldBounds = { ...aabb, method: 'aabb' };
  const span = b.maxY - b.minY;
  if (!(span > 0) || xyz.length < 3 * 64) return b;

  // The floor is the densest horizontal slab in the bottom quarter, the ceiling the densest in the
  // top quarter. Everything between them is wall, sill, furniture — and whatever the model
  // imagined through the glass.
  const floorY = densestSlab(xyz, b.minY, b.minY + span * 0.25);
  const ceilingY = densestSlab(xyz, b.maxY - span * 0.25, b.maxY);
  if (floorY != null) b.floorY = floorY;
  if (ceilingY != null) b.ceilingY = ceilingY;

  const low = floorY ?? b.minY;
  const high = ceilingY ?? b.maxY;
  const ceilingUnits = high - low;
  const margin = unitsFromMetres(WALL_BAND_MARGIN_M, ceilingUnits);
  if (!(ceilingUnits > 3 * margin)) return b;

  const profile = wallBandProfile(xyz, low + margin, high - margin);
  // Openings are looked for in the band a window occupies — sill to head — and across its height,
  // so a sill under the glass does not read as a solid wall (see `wallBandProfile`).
  const openingProfile = wallBandProfile(
    xyz,
    low + unitsFromMetres(WINDOW_SILL_M, ceilingUnits),
    Math.min(high - margin, low + unitsFromMetres(WINDOW_HEAD_M, ceilingUnits)),
    6,
  );
  const walls = fitWallRect(profile, ceilingUnits, openingProfile);
  if (!walls) return b;
  // The wall rectangle only earns its place by being tighter than the box it replaces.
  const boxArea = (b.maxX - b.minX) * (b.maxZ - b.minZ);
  const wallArea = (walls.maxX - walls.minX) * (walls.maxZ - walls.minZ);
  if (!(wallArea > 0) || wallArea > boxArea) return b;
  return { ...b, walls, method: 'walls' };
}

/** The wall rectangle a stored world carries, when it has one. */
export function wallsOf(bounds: WorldBounds | undefined): WallRect | undefined {
  return bounds?.walls;
}

/**
 * The rectangle a world's room is both measured and placed with — the one rule `rawFromBounds` and
 * `splatTransform` share, so the room can never be sized from one rectangle and centred on another.
 * `method: 'aabb'` on bounds that carry a wall rectangle means it was found but is not this room (a
 * collider covering a whole flat); the rectangle stays on the record unused.
 */
export function extentWalls(bounds: WorldBounds | undefined): WallRect | undefined {
  return bounds?.walls && bounds.method !== 'aabb' ? bounds.walls : undefined;
}

/** How a stored world's room extent was measured: what was recorded, or what the shape implies. */
export function extentMethodOf(bounds: WorldBounds | undefined): ExtentMethod | undefined {
  if (!bounds) return undefined;
  return bounds.method ?? (bounds.walls ? 'walls' : 'aabb');
}

function boundsOfPositions(xyz: ArrayLike<number>): WorldBounds | undefined {
  if (xyz.length < 3) return undefined;
  const b: WorldBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i + 2 < xyz.length; i += 3) {
    const x = xyz[i];
    const y = xyz[i + 1];
    const z = xyz[i + 2];
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return Number.isFinite(b.minX) ? b : undefined;
}

/**
 * The reconstruction's own floor plane, in raw units: the densest horizontal slab in the bottom
 * quarter of the collider mesh (and, run over the top quarter, its ceiling).
 *
 * Neither of the two numbers Marble hands over is that plane. `minY` is the mesh's lowest stray
 * vertex — a skirt a few centimetres under the floor (6 cm on the demo draft world). And
 * `ground_plane_offset` is a *different* plane again. The panorama's floor is the mesh's floor, and
 * the photograph is the ground truth, so this is the plane Audora maps to y = 0 on a draft world.
 */
function densestSlab(xyz: ArrayLike<number>, lo: number, hi: number, bins = 200): number | undefined {
  if (!(hi > lo)) return undefined;
  const counts = new Int32Array(bins);
  let seen = 0;
  for (let i = 1; i < xyz.length; i += 3) {
    const y = xyz[i];
    if (y < lo || y > hi) continue;
    counts[Math.min(bins - 1, Math.max(0, Math.floor(((y - lo) / (hi - lo)) * bins)))]++;
    seen++;
  }
  if (seen < 64) return undefined;
  let best = 0;
  for (let i = 1; i < bins; i++) if (counts[i] > counts[best]) best = i;
  return lo + ((best + 0.5) / bins) * (hi - lo);
}

/* ---------- the wall band ----------
 * A person standing at the capture point sees, in every direction, one nearest vertical surface:
 * the wall. Slice the mesh between the floor and the ceiling (a `WALL_BAND_MARGIN_M` margin off
 * each keeps the slabs themselves out) and record, per degree of azimuth, the distance to the
 * nearest vertex. For a rectangular room that profile traces the room exactly; where the model
 * hallucinated a building through a window it runs away, and that is how openings are found. */

/**
 * Nearest vertex distance per degree of azimuth around the capture point, in raw units.
 * `Infinity` means no evidence in that direction — which is not the same as an opening.
 *
 * `slices` splits the band by height and returns the median of the slices instead of the single
 * nearest point. One slice (the default) is what a walker collides with; several is what a *hole*
 * looks like — a window with a sill is solid at knee height and open above it, so the nearest
 * surface alone would report a wall right across the glass.
 */
export function wallBandProfile(xyz: ArrayLike<number>, lowY: number, highY: number, slices = 1): Float64Array {
  const n = Math.max(1, Math.floor(slices));
  const grid = new Float64Array(AZIMUTH_BINS * n).fill(Infinity);
  const span = highY - lowY;
  for (let i = 0; i + 2 < xyz.length; i += 3) {
    const y = xyz[i + 1];
    if (y < lowY || y > highY) continue;
    const x = xyz[i];
    const z = xyz[i + 2];
    const d = Math.sqrt(x * x + z * z);
    if (!(d > 1e-6)) continue;
    let a = Math.atan2(z, x) / RAD;
    if (a < 0) a += 360;
    const bin = Math.min(AZIMUTH_BINS - 1, Math.max(0, Math.floor(a)));
    const slice = n === 1 || !(span > 0) ? 0 : Math.min(n - 1, Math.max(0, Math.floor(((y - lowY) / span) * n)));
    const at = bin * n + slice;
    if (d < grid[at]) grid[at] = d;
  }
  const prof = new Float64Array(AZIMUTH_BINS).fill(Infinity);
  for (let b = 0; b < AZIMUTH_BINS; b++) {
    if (n === 1) {
      prof[b] = grid[b];
      continue;
    }
    const v: number[] = [];
    for (let k = 0; k < n; k++) {
      const d = grid[b * n + k];
      if (Number.isFinite(d)) v.push(d);
    }
    if (!v.length) continue;
    v.sort((x, y) => x - y);
    prof[b] = v[Math.floor(v.length / 2)];
  }
  return prof;
}

interface FittedRect {
  rotation: number;
  px: number;
  nx: number;
  pz: number;
  nz: number;
  area: number;
  /** Fraction of the wall band that lies on this rectangle — how much of a room it really is. */
  score: number;
}

/**
 * Below this, the wall band is not a rectangular room and the bounding box is the honest answer.
 * Both demo worlds sit at 0.72–0.80; a circular mesh — a stairwell, a bay — tops out at 0.39,
 * because a rectangle can only agree with a circle where it touches it.
 */
const MIN_WALL_SCORE = 0.5;
/** A profile distance within this fraction of the rectangle counts as "on the wall". */
const WALL_TOLERANCE = 0.05;

/**
 * How far the room reaches in one direction: a high percentile of the profile's support in it.
 *
 * For a rectangle seen from anywhere inside, every boundary point projects onto a direction at most
 * the distance to the wall facing that way, and the whole facing wall projects to exactly it — so
 * the maximum is the wall. The percentile is what makes it survive a hallucination: a few degrees
 * of "wall" three rooms away are trimmed instead of stretching the room to reach them.
 */
function support(prof: Float64Array, dirX: number, dirZ: number, pct: number, keep?: Uint8Array): number | null {
  const v: number[] = [];
  for (let i = 0; i < AZIMUTH_BINS; i++) {
    const d = prof[i];
    if (!Number.isFinite(d)) continue;
    if (keep && !keep[i]) continue;
    const a = (i + 0.5) * RAD;
    v.push(d * (Math.cos(a) * dirX + Math.sin(a) * dirZ));
  }
  if (v.length < AZIMUTH_BINS * 0.4) return null;
  v.sort((a, b) => a - b);
  const q = v[Math.min(v.length - 1, Math.round(pct * (v.length - 1)))];
  return q > 1e-3 ? q : null;
}

/**
 * The room's own rectangle: the yaw (swept at 1°) where the most of the wall band lies ON the
 * rectangle, ties going to the smaller room.
 *
 * Agreement beats area. Minimising area alone slides the rectangle around whatever is nearest the
 * capture point, while a rectangular room has exactly one orientation where wall after wall falls
 * on the fit — and it announces itself: on the demo corner room 75 % of the band lands on the
 * rectangle at 45°, against 14 % at every orientation more than 10° away. `score` is also the
 * honest confidence: a mesh that is not a rectangular room never reaches `MIN_WALL_SCORE`.
 */
function fitRotatedRect(prof: Float64Array, pct: number, keep?: Uint8Array): FittedRect | null {
  let best: FittedRect | null = null;
  for (let t = 0; t < 90; t++) {
    const c = Math.cos(t * RAD);
    const s = Math.sin(t * RAD);
    const px = support(prof, c, s, pct, keep);
    const nx = support(prof, -c, -s, pct, keep);
    const pz = support(prof, -s, c, pct, keep);
    const nz = support(prof, s, -c, pct, keep);
    if (px == null || nx == null || pz == null || nz == null) continue;
    const cand: FittedRect = { rotation: t * RAD, px, nx, pz, nz, area: (px + nx) * (pz + nz), score: 0 };
    cand.score = wallScore(prof, cand, keep);
    if (!best || cand.score > best.score || (cand.score === best.score && cand.area < best.area)) best = cand;
  }
  return best;
}

/** Distance from the capture point to a fitted rectangle's boundary, in the rectangle's own frame. */
function fittedRadius(fit: FittedRect, azimuth: number): number {
  const t = azimuth - fit.rotation;
  const c = Math.cos(t);
  const s = Math.sin(t);
  let best = Infinity;
  if (c > 1e-9) best = Math.min(best, fit.px / c);
  if (c < -1e-9) best = Math.min(best, -fit.nx / c);
  if (s > 1e-9) best = Math.min(best, fit.pz / s);
  if (s < -1e-9) best = Math.min(best, -fit.nz / s);
  return best;
}

/**
 * Re-measure each of the four walls from the band that lies on it — the median of those points'
 * projections — instead of the percentile that found the orientation. A percentile is a robust way
 * to *locate* a wall and a poor way to measure one: it sits at the outer edge of the noise. On the
 * demo corner room the mesh's own wall planes are 5.87 and 4.40 raw units apart; the percentile fit
 * says 6.02 × 4.41 and this pass brings it to 5.91 × 4.37, inside 1 %.
 */
function refineRect(prof: Float64Array, fit: FittedRect, keep?: Uint8Array): FittedRect {
  const c = Math.cos(fit.rotation);
  const s = Math.sin(fit.rotation);
  const faces: [keyof Pick<FittedRect, 'px' | 'nx' | 'pz' | 'nz'>, number, number][] = [
    ['px', c, s],
    ['nx', -c, -s],
    ['pz', -s, c],
    ['nz', s, -c],
  ];
  const onWall: Record<string, number[]> = { px: [], nx: [], pz: [], nz: [] };
  for (let i = 0; i < AZIMUTH_BINS; i++) {
    const d = prof[i];
    if (!Number.isFinite(d)) continue;
    if (keep && !keep[i]) continue;
    const a = (i + 0.5) * RAD;
    const r = fittedRadius(fit, a);
    if (!Number.isFinite(r) || Math.abs(d - r) > WALL_TOLERANCE * r) continue;
    // The wall this point belongs to is the one it projects closest to.
    let bestFace: string | null = null;
    let bestProj = 0;
    let bestGap = Infinity;
    for (const [name, dx, dz] of faces) {
      const proj = d * (Math.cos(a) * dx + Math.sin(a) * dz);
      const gap = Math.abs(proj - fit[name]);
      if (gap < bestGap) {
        bestGap = gap;
        bestFace = name;
        bestProj = proj;
      }
    }
    if (bestFace && bestGap <= WALL_TOLERANCE * fit[bestFace as 'px']) onWall[bestFace].push(bestProj);
  }
  const out: FittedRect = { ...fit };
  for (const [name] of faces) {
    const v = onWall[name];
    if (v.length < 8) continue; // too little of that wall was seen to re-measure it
    v.sort((a, b) => a - b);
    const mid = v[Math.floor(v.length / 2)];
    if (mid > 1e-3) out[name] = mid;
  }
  out.area = (out.px + out.nx) * (out.pz + out.nz);
  out.score = wallScore(prof, out, keep);
  return out;
}

/** How much of the wall band this rectangle explains, 0..1. */
function wallScore(prof: Float64Array, fit: FittedRect, keep?: Uint8Array): number {
  let hit = 0;
  let seen = 0;
  for (let i = 0; i < AZIMUTH_BINS; i++) {
    const d = prof[i];
    if (!Number.isFinite(d)) continue;
    if (keep && !keep[i]) continue;
    const r = fittedRadius(fit, (i + 0.5) * RAD);
    if (!Number.isFinite(r)) continue;
    seen++;
    if (Math.abs(d - r) <= WALL_TOLERANCE * r) hit++;
  }
  return seen ? hit / seen : 0;
}

/** Distance from the capture point to the rectangle's boundary at one azimuth. */
function boxRadius(box: Pick<WallRect, 'minX' | 'maxX' | 'minZ' | 'maxZ'>, azimuth: number): number {
  const cx = Math.cos(azimuth);
  const sz = Math.sin(azimuth);
  let best = Infinity;
  if (cx > 1e-9) best = Math.min(best, box.maxX / cx);
  if (cx < -1e-9) best = Math.min(best, box.minX / cx);
  if (sz > 1e-9) best = Math.min(best, box.maxZ / sz);
  if (sz < -1e-9) best = Math.min(best, box.minZ / sz);
  return best;
}

/** Rectangle extents in raw axes, keeping each wall's distance from the capture point. */
function toRawBox(fit: FittedRect): Omit<WallRect, 'openings'> {
  const deg = (fit.rotation / RAD) % 90;
  // The fitted rectangle's own axes are `rotation` off the raw ones; name each extent after the raw
  // axis it is closer to. The capture-point distances are what is preserved — the door, the walk
  // and every dimension the buyer reads are relative to where the photographer stood.
  const turned = deg > 45;
  return {
    minX: -(turned ? fit.nz : fit.nx),
    maxX: turned ? fit.pz : fit.px,
    minZ: -(turned ? fit.nx : fit.nz),
    maxZ: turned ? fit.px : fit.pz,
    rotation: fit.rotation,
  };
}

/* ---------- the room's own frame ---------- */

/**
 * The room, in **Audora's axes**: metres-per-unit aside, this is the rectangle the buyer walks,
 * expressed the way our engine expresses rooms (x east, z south, north wall at low z) and measured
 * from the capture point, which sits at the origin.
 *
 * `yaw` is the turn that gets there. Marble's frame is the camera's, not the room's — the demo
 * corner room is 47° off it because the photographer faced a corner — so the whole capture is
 * turned by `yaw` about the room centre before anything else happens. Everything real is drawn in
 * ONE group (`splatTransform` → `rotationY = π + yaw`), so the panorama, the splat and the collider
 * turn together and the view from the capture point is unchanged; what changes is that the
 * photographed walls now coincide with the metric room's walls.
 */
export interface RoomRect {
  /** Radians the capture is turned by so the room's walls run along Audora's axes. */
  yaw: number;
  /** Raw units, capture point at the origin, Audora's axes. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The fitted rectangle in Audora's axes.
 *
 * The raw → world map every real layer obeys is `(x, y, z)_raw → (x, −y, −z)` (three/splat/frame),
 * so the horizontal part is `(x, z) → (x, −z)`: raw +x is our EAST and raw +z — the direction the
 * photographer faced — is our NORTH. The fit's own axes (`u` at `rotation`, `v` 90° on) therefore
 * land at −rotation and −rotation−90°; `yaw` is the smallest turn that brings them onto ours, and
 * which of `u`/`v` becomes x follows from it.
 */
function worldRectOfFit(fit: FittedRect): RoomRect {
  const turned = (fit.rotation / RAD) % 90 > 45;
  return turned
    ? { yaw: Math.PI / 2 - fit.rotation, minX: -fit.pz, maxX: fit.nz, minZ: -fit.px, maxZ: fit.nx }
    : { yaw: -fit.rotation, minX: -fit.nx, maxX: fit.px, minZ: -fit.pz, maxZ: fit.nz };
}

/** The fit that produced a stored wall rectangle: distances from the capture point along its axes. */
function fitOf(w: Pick<WallRect, 'minX' | 'maxX' | 'minZ' | 'maxZ' | 'rotation'>): FittedRect {
  const turned = (w.rotation / RAD) % 90 > 45;
  const f = turned
    ? { px: w.maxZ, nx: -w.minZ, pz: w.maxX, nz: -w.minX }
    : { px: w.maxX, nx: -w.minX, pz: w.maxZ, nz: -w.minZ };
  return { ...f, rotation: w.rotation, area: (f.px + f.nx) * (f.pz + f.nz), score: 0 };
}

/**
 * The room a stored world reports, in Audora's axes — the one rule `rawFromBounds`, `splatTransform`
 * and the window finder all share, so a room can never be sized from one rectangle, placed with
 * another and have its windows named against a third.
 *
 * The wall rectangle when the collider gave a usable one, the bounding box otherwise (`yaw` 0: a
 * box has no orientation to recover).
 */
export function roomRect(bounds: WorldBounds | undefined): RoomRect | undefined {
  if (!bounds) return undefined;
  const walls = extentWalls(bounds);
  if (walls) return worldRectOfFit(fitOf(walls));
  return { yaw: 0, minX: bounds.minX, maxX: bounds.maxX, minZ: -bounds.maxZ, maxZ: -bounds.minZ };
}

/** A raw azimuth (the wall-band profile's own bins) as an azimuth in Audora's axes. */
function worldAzimuth(rect: RoomRect, rawAzimuth: number): number {
  return -(rawAzimuth + rect.yaw);
}

/** A gap has to be this much further than the fitted wall, and this wide, to count as an opening. */
const OPENING_FACTOR = 1.3;
const OPENING_MIN_DEGREES = 8;

/**
 * Fit the room's walls to a wall-band profile.
 *
 * Two passes, because the one thing that breaks a support fit is the hallucination it exists to
 * remove: a coarse, low-percentile rectangle first, then everything the profile says is well
 * beyond it is set aside as an opening and the rectangle is refitted tightly on what is left. On
 * the demo corner room that is the difference between a 27 m² bounding box and a 12.2 m² room.
 */
export function fitWallRect(prof: Float64Array, ceilingUnits = 0, openingProfile?: Float64Array): WallRect | null {
  const coarse = fitRotatedRect(prof, 0.9);
  if (!coarse) return null;

  const keep = new Uint8Array(AZIMUTH_BINS).fill(1);
  let dropped = 0;
  for (let i = 0; i < AZIMUTH_BINS; i++) {
    if (!Number.isFinite(prof[i])) continue; // no evidence is not an opening
    // Measure the gap against the ROTATED coarse rectangle, not an axis-aligned box drawn round it.
    // `toRawBox` relabels the fit's extents onto the raw axes and drops the rotation, so on a room
    // that is well off the provider's axes the box bulges past the real walls near its corners and
    // past its own extents nowhere: honest wall returns get read as "beyond the wall", are set
    // aside as openings, and the room is refitted on the third of the band that survived. At 63°
    // that turned a 5.00 m wall into 2.43 m. `fittedRadius` is the same distance through the
    // rectangle the fit actually found, and is what `refineRect` and `wallScore` already use.
    if (prof[i] > fittedRadius(coarse, (i + 0.5) * RAD) * OPENING_FACTOR) {
      keep[i] = 0;
      dropped++;
    }
  }
  // More than a third of the room "beyond the walls" means the coarse fit, not the mesh, is wrong.
  const found = dropped > AZIMUTH_BINS * 0.4 ? coarse : (fitRotatedRect(prof, 0.98, keep) ?? coarse);
  const fine = refineRect(prof, found, keep);
  // Reported and judged over the WHOLE band, openings included: the orientation is chosen without
  // them, but "how much of this room did we explain" must count what was set aside. A mesh that is
  // not a rectangular room — a stairwell, a corridor bend, half a flat — never agrees with any
  // rectangle, and saying "no" is more honest than shrinking the box onto clutter.
  const explained = wallScore(prof, fine);
  if (explained < MIN_WALL_SCORE) return null;
  const box = toRawBox(fine);
  if (!(box.maxX - box.minX > 0.2) || !(box.maxZ - box.minZ > 0.2)) return null;
  const score = Math.round(explained * 100) / 100;
  const openings = ceilingUnits > 0 ? openingsOf(openingProfile ?? prof, worldRectOfFit(fine), ceilingUnits) : [];
  return openings.length ? { ...box, score, openings } : { ...box, score };
}

/**
 * Runs of azimuth where the nearest surface is well beyond the fitted wall: a window the model saw
 * through, or a doorway into the next room. Each is mapped onto the wall of Audora's metric room
 * that the run points at — the room's own yaw is folded into the frame the capture is drawn in
 * ({@link roomRect}), so the fitted walls ARE Audora's four walls and a run points at exactly one
 * of them.
 */
function openingsOf(prof: Float64Array, rect: RoomRect, ceilingUnits: number): WallOpening[] {
  const minWidth = unitsFromMetres(0.4, ceilingUnits);
  // 2 = the mesh is further away than the wall (the model saw through it), 1 = the mesh says
  // nothing here at all. A hole in a reconstruction is a hole in the wall too, so an unknown bin
  // extends an opening — but only a bin that really is beyond the wall can start one.
  const state = new Uint8Array(AZIMUTH_BINS);
  for (let i = 0; i < AZIMUTH_BINS; i++) {
    if (!Number.isFinite(prof[i])) state[i] = 1;
    else if (prof[i] > boxRadius(rect, worldAzimuth(rect, (i + 0.5) * RAD)) * OPENING_FACTOR) state[i] = 2;
  }
  // Walk from a closed bin so a run that straddles 0° is not cut in two.
  let start = 0;
  while (start < AZIMUTH_BINS && state[start]) start++;
  if (start === AZIMUTH_BINS) return [];

  const out: WallOpening[] = [];
  for (let k = 0; k < AZIMUTH_BINS && out.length < 3; k++) {
    const i = (start + k) % AZIMUTH_BINS;
    if (state[i] !== 2) continue;
    let n = 0;
    let seen = 0;
    while (n < AZIMUTH_BINS && state[(i + n) % AZIMUTH_BINS]) {
      if (state[(i + n) % AZIMUTH_BINS] === 2) seen++;
      state[(i + n) % AZIMUTH_BINS] = 0;
      n++;
    }
    // Trim trailing "nothing here" bins: an opening ends at the last thing actually seen past it.
    while (n > 1 && !Number.isFinite(prof[(i + n - 1) % AZIMUTH_BINS])) n--;
    k += n - 1;
    if (n < OPENING_MIN_DEGREES || seen * 2 < n) continue;
    const a0 = worldAzimuth(rect, i * RAD);
    const a1 = worldAzimuth(rect, ((i + n) % AZIMUTH_BINS) * RAD);
    const mid = worldAzimuth(rect, (i + n / 2) * RAD);
    const wall = wallAt(rect, mid);
    if (!wall) continue;
    const p0 = alongWall(rect, wall, a0);
    const p1 = alongWall(rect, wall, a1);
    if (p0 == null || p1 == null) continue;
    const wallLength = wall === 'north' || wall === 'south' ? rect.maxX - rect.minX : rect.maxZ - rect.minZ;
    const width = Math.min(Math.abs(p1 - p0), wallLength - 2 * minWidth);
    if (!(width >= minWidth)) continue;
    const offset = Math.min(wallLength - width / 2 - minWidth / 2, Math.max(width / 2 + minWidth / 2, (p0 + p1) / 2));
    out.push({ wall, offset, width });
  }
  return out;
}

/**
 * Which wall of Audora's metric room a ray leaves through, and where.
 *
 * Both take a **world** azimuth (see {@link worldAzimuth}) and the room rectangle in Audora's own
 * axes, so there is no frame arithmetic left to get wrong here: north is the low-z wall, south the
 * high-z one the photographer stood in, east the high-x one.
 */
function wallAt(rect: RoomRect, azimuth: number): WallSide | null {
  const r = boxRadius(rect, azimuth);
  if (!Number.isFinite(r)) return null;
  const x = r * Math.cos(azimuth);
  const z = r * Math.sin(azimuth);
  const dx = Math.min(Math.abs(x - rect.minX), Math.abs(rect.maxX - x));
  const dz = Math.min(Math.abs(z - rect.minZ), Math.abs(rect.maxZ - z));
  if (dx <= dz) return Math.abs(rect.maxX - x) <= Math.abs(x - rect.minX) ? 'east' : 'west';
  return Math.abs(rect.maxZ - z) <= Math.abs(z - rect.minZ) ? 'south' : 'north';
}

/** Where a ray meets a wall, as a distance from that wall's start (west end / north end). */
function alongWall(rect: RoomRect, wall: WallSide, azimuth: number): number | null {
  const r = boxRadius(rect, azimuth);
  if (!Number.isFinite(r)) return null;
  const x = r * Math.cos(azimuth);
  const z = r * Math.sin(azimuth);
  return wall === 'north' || wall === 'south' ? x - rect.minX : z - rect.minZ;
}

/**
 * Raw (unscaled) room geometry from a world's collider. Marble's frame is y-up with the camera at
 * the origin and the room extending toward +z; Audora's frame puts the photographer's doorway on
 * the south wall, so the door is placed where the camera stood.
 *
 * The extent is the **wall rectangle** when the collider gave one, and the bounding box only when
 * it did not: the box holds everything the model reconstructed through the windows, which on the
 * demo corner room is 5.38 × 5.03 m of a room that is really 3.00 × 4.06 m. Both are recorded on
 * the world (`bounds.walls`, `bounds.method`) so the difference is never silent.
 */
export function rawFromBounds(b: WorldBounds, ceilingRatio = { door: 2.03 / 2.44, outlet: 0.3 / 2.44 }): RawRoomGeometry {
  const rect = roomRect(b) ?? { yaw: 0, minX: b.minX, maxX: b.maxX, minZ: -b.maxZ, maxZ: -b.minZ };
  const width = Math.max(0.5, rect.maxX - rect.minX);
  const depth = Math.max(0.5, rect.maxZ - rect.minZ);
  const height = Math.max(0.5, b.maxY - b.minY);
  const ceilingUnits = b.ceilingY != null && b.floorY != null ? b.ceilingY - b.floorY : height;
  // The photographer stood in the doorway, so the door goes where they stood: on the wall behind
  // them (our south) at the offset where they project onto it. The capture point is the rectangle's
  // origin, so that offset is simply its distance from the west end.
  const doorOffset = Math.min(width - 0.3, Math.max(0.3, -rect.minX));
  const sill = unitsFromMetres(WINDOW_SILL_M, ceilingUnits);
  const windows: WindowSpec[] = (extentWalls(b)?.openings ?? []).map((o) => ({
    wall: o.wall,
    offset: o.offset,
    width: o.width,
    sill,
    height: Math.max(0.2, unitsFromMetres(WINDOW_HEAD_M - WINDOW_SILL_M, ceilingUnits)),
  }));
  return {
    width,
    depth,
    height,
    door: { wall: 'south', offset: doorOffset, width: Math.min(0.45 * height, width * 0.3), height: height * ceilingRatio.door },
    windows,
    doorHeightUnits: height * ceilingRatio.door,
    outletHeightUnits: height * ceilingRatio.outlet,
  };
}

/* ---------- is this one room? ---------- */

/** Nothing this big is one room, whatever the collider says. */
export const MAX_ROOM_AREA_M2 = 60;
export const MAX_ROOM_SIDE_M = 9;
export const MIN_ROOM_HEIGHT_M = 2.1;
export const MAX_ROOM_HEIGHT_M = 3.6;

/**
 * Whether a metric room measured off a collider is a room at all.
 *
 * Marble's collider includes whatever the model hallucinated through the windows and the open
 * doors, which for a full-quality world of a flat is the whole floor plan: the demo flat's bounding
 * box is 138 m², and even its wall band — a real measurement of a real open-plan space — comes to
 * 6.5 × 11.8 m. That is a flat, not a living room, so the caller's estimate has to stand and the
 * bounds are stored as `aabb`. The browser adds `plausibility()` on top of this (services/marble
 * `roomExtent`); every check that can *reject* a room lives here so the worker applies the same one.
 */
export function isOneRoom(g: { width: number; depth: number; height: number }): boolean {
  return (
    g.width * g.depth <= MAX_ROOM_AREA_M2 &&
    Math.max(g.width, g.depth) <= MAX_ROOM_SIDE_M &&
    g.height >= MIN_ROOM_HEIGHT_M &&
    g.height <= MAX_ROOM_HEIGHT_M
  );
}
