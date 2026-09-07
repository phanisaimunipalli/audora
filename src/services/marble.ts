import type { PhotoAngle, PhotoRecord, ProviderStatus, Room, RoomWorld, Tier, WorldBoundsRecord, WorldWallOpening, WorldWallRect } from '@/state/types';
import type { RawGeometry, WallSide, WindowSpec } from '@/engine/types';
import { applyScale, plausibility, unitsFromMetres, WALL_BAND_MARGIN_M, WINDOW_HEAD_M, WINDOW_SILL_M } from '@/engine/anchor';
import { mockRawGeometry } from './mockWorld';

/**
 * An opening found in the wall band — a window, or a doorway into the next room. Raw units, on a
 * wall of Audora's metric room (the shape lives in state/types so a stored world carries it).
 */
export type WallOpening = WorldWallOpening;

/**
 * The room's own walls, measured from the collider's wall band and expressed the same way the
 * bounding box is: raw units, **relative to the capture point**, which sits at the origin. So
 * `maxX` is how far the nearest wall is to one side of the photographer, and the capture point is
 * inside the rectangle by construction.
 *
 * `rotation` is the yaw of the fitted rectangle relative to the provider's axes, radians in
 * [0, π/2). Marble's frame is the camera's, not the room's: the demo corner room comes out at 47°
 * to it (the photographer faced a corner), which is exactly why its bounding box is 41 % too big.
 * The extents are the room's own, each named after the raw axis it is closer to — a labelling that
 * preserves sizes and capture-point distances but not the sense of the axes. **Read the rectangle
 * through {@link roomRect}** to get it in Audora's axes, with that turn recovered; nothing else
 * should interpret these four numbers directly.
 *
 * `score` is the fraction of the wall band (0..1) that lies on this rectangle — how much of a room
 * the mesh really is. 0.80 on the demo corner room, 0.72 on the full-quality flat; a mesh that
 * agrees with no rectangle at all never gets one (`MIN_WALL_SCORE`).
 */
export type WallRect = WorldWallRect;

/** Which measurement the room extent came from. */
export type ExtentMethod = 'walls' | 'aabb';

/**
 * Everything the collider mesh knows about the room, in the provider's raw units with the capture
 * point at the origin. Exactly what a world stores (`RoomWorld['bounds']`), so a measurement can be
 * put on a record as it is and read back after a round trip through localStorage.
 */
export type WorldBounds = WorldBoundsRecord;

/** The wall rectangle a stored world carries, when it has one. */
export function wallsOf(bounds: WorldBounds | undefined): WallRect | undefined {
  return bounds?.walls;
}

/**
 * The rectangle a world's room is both measured and placed with — the one rule `rawFromBounds` and
 * `splatTransform` share, so the room can never be sized from one rectangle and centred on another.
 * `method: 'aabb'` on bounds that carry a wall rectangle means it was found but is not this room (a
 * collider covering a whole flat, see `roomExtent`); the rectangle stays on the record unused.
 */
export function extentWalls(bounds: WorldBounds | undefined): WallRect | undefined {
  return bounds?.walls && bounds.method !== 'aabb' ? bounds.walls : undefined;
}

/** How a stored world's room extent was measured: what was recorded, or what the shape implies. */
export function extentMethodOf(bounds: WorldBounds | undefined): ExtentMethod | undefined {
  if (!bounds) return undefined;
  return bounds.method ?? (bounds.walls ? 'walls' : 'aabb');
}

const AZIMUTH_BINS = 360;
const RAD = Math.PI / 180;

/* ---------- reading the collider ---------- */

interface GlbChunks {
  json: any;
  positions: Float32Array;
}

/** Split a .glb into its JSON chunk and every POSITION it carries, as one flat xyz array. */
function readGlb(buf: ArrayBuffer): GlbChunks {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const total = dv.getUint32(8, true);
  let off = 12;
  let json: any = null;
  let bin: { start: number; length: number } | null = null;
  while (off + 8 <= total && off + 8 <= buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    if (type === 0x004e4942) bin = { start: off + 8, length: len };
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, positions: bin ? readPositions(buf, json, bin) : new Float32Array(0) };
}

/** Every float POSITION in the file, concatenated. Interleaved buffer views are handled. */
function readPositions(buf: ArrayBuffer, json: any, bin: { start: number; length: number }): Float32Array {
  const parts: { acc: any; view: any }[] = [];
  let total = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const acc = json.accessors?.[prim.attributes?.POSITION];
      if (!acc || acc.componentType !== 5126 || acc.type !== 'VEC3') continue;
      const view = json.bufferViews?.[acc.bufferView];
      if (!view) continue;
      parts.push({ acc, view });
      total += acc.count;
    }
  }
  const out = new Float32Array(total * 3);
  const dv = new DataView(buf, bin.start, bin.length);
  let w = 0;
  for (const { acc, view } of parts) {
    const stride = view.byteStride || 12;
    const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
    for (let i = 0; i < acc.count; i++) {
      const at = base + i * stride;
      if (at < 0 || at + 12 > bin.length) break;
      out[w++] = dv.getFloat32(at, true);
      out[w++] = dv.getFloat32(at + 4, true);
      out[w++] = dv.getFloat32(at + 8, true);
    }
  }
  return w === out.length ? out : out.slice(0, w);
}

/**
 * Read the collider mesh and measure the room in it: the bounding box, the floor and ceiling
 * planes, and the wall band that says where the real walls are.
 *
 * The bounding box alone is not the room — Marble reconstructs what it saw *through* the windows —
 * so this reads the POSITION data, not just the accessor min/max the JSON chunk carries.
 */
export async function fetchColliderGeometry(url: string): Promise<WorldBounds> {
  const buf = await (await fetch(url)).arrayBuffer();
  const { json, positions } = readGlb(buf);
  return colliderGeometry(positions, boundsFromAccessors(json));
}

/** @deprecated Use {@link fetchColliderGeometry}: same result, plus the wall rectangle. */
export const fetchColliderBounds = fetchColliderGeometry;

/** The bounding box glTF states in its accessors, before a single vertex is read. */
function boundsFromAccessors(json: any): WorldBounds | undefined {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const acc = json.accessors?.[prim.attributes?.POSITION];
      if (!acc?.min || !acc?.max) continue;
      b.minX = Math.min(b.minX, acc.min[0]);
      b.minY = Math.min(b.minY, acc.min[1]);
      b.minZ = Math.min(b.minZ, acc.min[2]);
      b.maxX = Math.max(b.maxX, acc.max[0]);
      b.maxY = Math.max(b.maxY, acc.max[1]);
      b.maxZ = Math.max(b.maxZ, acc.max[2]);
    }
  }
  return Number.isFinite(b.minX) ? b : undefined;
}

/**
 * Measure a room from a collider's vertices: bounding box, floor and ceiling planes, and the wall
 * rectangle. Pure and provider-agnostic — `xyz` is a flat `[x, y, z, x, y, z, …]` array in the
 * provider's raw units with the capture point at the origin — so a synthetic point set exercises
 * exactly what a 76k-vertex mesh does.
 */
export function colliderGeometry(xyz: ArrayLike<number>, stated?: WorldBounds): WorldBounds {
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
 * `ground_plane_offset` is a *different* plane again: on the reference build's full-quality world it
 * sits 15 cm above the mesh's floor, which is exactly why that build needed a floor-height slider to
 * make furniture stand on the photograph. The panorama's floor is the mesh's floor, and the
 * photograph is the ground truth, so this is the plane Audora maps to y = 0.
 *
 * Measured on both demo worlds: floor −1.5953 vs minY −1.6597 (draft corner room) and −0.6544 vs
 * −0.7308 with `ground_plane_offset` 1.3065 (full-quality flat). Using it puts the reconstruction's
 * floor on y = 0 in both, instead of 6 cm under it and 15 cm over it.
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
 * demo corner room the mesh's own wall planes are 5.87 and 4.40 raw units apart (the two dominant
 * peaks in a histogram of the band's projections); the percentile fit says 6.02 × 4.41 and this
 * pass brings it to 5.91 × 4.37, inside 1 %.
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
 * photographed walls now coincide with the metric room's walls, which is what lets a sofa stand
 * against a wall the buyer can see.
 *
 * Measured on the demo corner room (34,948 wall-band vertices through this transform): the walls
 * land on x = ±1.50 and z = ±2.03, i.e. exactly the 3.00 × 4.06 m room, instead of a diamond
 * across a 5.4 × 5.0 m box.
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
  const rough = toRawBox(coarse);

  const keep = new Uint8Array(AZIMUTH_BINS).fill(1);
  let dropped = 0;
  for (let i = 0; i < AZIMUTH_BINS; i++) {
    if (!Number.isFinite(prof[i])) continue; // no evidence is not an opening
    if (prof[i] > boxRadius(rough, (i + 0.5) * RAD) * OPENING_FACTOR) {
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
 * that the run points at.
 *
 * This used to be suppressed whenever the fitted rectangle was more than 20° off the raw axes,
 * because at 45° "left wall" and "far wall" are the same surface and naming one was a guess. That
 * is no longer true: the room's own yaw is now folded into the frame the capture is drawn in
 * ({@link roomRect}), so the fitted walls ARE Audora's four walls and a run points at exactly one
 * of them. Both demo worlds report their real windows again.
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
export function rawFromBounds(b: WorldBounds, ceilingRatio = { door: 2.03 / 2.44, outlet: 0.3 / 2.44 }): RawGeometry {
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

export interface SplatTransform {
  /** Uniform scale from the provider's raw units to metres. */
  scale: number;
  /** Where the provider's origin — the capture point — lands in Audora's frame. */
  position: [number, number, number];
  /** The Marble group's turn about y: `π + yaw`. */
  rotationY: number;
  /**
   * The room's own turn (see {@link RoomRect}), radians. Also the direction the capture looked in
   * Audora's frame, so walk mode spawns at `position` facing `yaw` and the first frame is the
   * photograph. 0 when the collider gave no wall rectangle.
   */
  yaw: number;
  /** True when the world carried Marble's own metric semantics (full quality), false when the anchor supplied the scale. */
  metric: boolean;
}

/**
 * Where a provider's world sits inside Audora's metric room frame (floor y = 0, centre at the
 * origin, door on the south wall). Everything real — panorama sphere, SPZ splat, collider mesh —
 * hangs off ONE group carrying this transform:
 *
 * ```tsx
 * const t = splatTransform(world, room.anchor.metresPerUnit, room.floorOffset);
 * <group position={t.position} rotation={[0, t.rotationY, 0]} scale={t.scale}>…</group>
 * ```
 *
 * `rotationY` is `π + rect.yaw`. The 180° is what makes the capture look the way Audora's rooms do
 * (Marble's room extends toward +z from the camera; ours extends toward −z from the south door);
 * the rest is the room's own turn, because Marble's frame is the camera's and the photographer may
 * have faced a corner (see {@link RoomRect}). `position` is exactly where the capture point lands,
 * so the photo view puts its camera there — facing `yaw`, which is where the camera looked.
 *
 * The two ways a world knows its own size, handled the same way whether or not `bounds` are known:
 * - **Full quality** carries `metric_scale_factor` (raw units → metres) and `ground_plane_offset`
 *   (metres the capture point sits ABOVE the ground plane — already metric, so it is never
 *   multiplied by the scale). Verified against the reference build, which draws its collider at
 *   `position.y = -ground_plane_offset` with the camera left at the origin.
 * - **Draft** carries neither, so `metresPerUnit` comes from the room's anchor.
 *
 * **The floor, in order of preference: `ground_plane_offset`, then `bounds.floorY`, then
 * `bounds.minY`.** Marble publishes `ground_plane_offset` only with a full-quality world's metric
 * semantics, and where it publishes one it is right: measured against the world's own Gaussians —
 * the thing the buyer actually sees — the flat's splat floor lands 1.2 cm above y = 0 with the
 * ground plane and 16 cm above it with the collider's floor slab, which is what made furniture look
 * sunk into the photographed floorboards. (The earlier reading, that the ground plane sat 15 cm
 * *above* the floor, compared it with the collider mesh rather than with the splat; the collider is
 * the one that is 15 cm out.) A draft world publishes no ground plane, so there `bounds.floorY` —
 * the densest horizontal slab in the mesh — still stands, with `bounds.minY` behind it.
 *
 * `bounds`, when present, additionally turn and centre the room on the origin — around the **same**
 * rectangle `rawFromBounds` measured the room with (`bounds.walls` when the wall band produced one,
 * the bounding box otherwise), so the reconstruction's own walls land ON the room's walls instead of
 * at an angle inside them. `floorOffset` (`Room.floorOffset`, metres) raises the whole
 * reconstruction so its floor meets ours; nothing in the metric frame moves, so furniture keeps
 * standing on y = 0.
 *
 * Measuring the room more honestly does not move the reconstruction relative to itself: the scale
 * and the floor plane are untouched and the capture point stays exactly where it is relative to
 * everything Marble reconstructed — it is the room rectangle drawn around it that shrinks onto the
 * real walls and turns onto them, so `position` (which IS the capture point) reports new
 * coordinates in a frame whose origin and axes moved. Every distance the buyer can see is
 * unchanged, and so is the view from the capture point, which is why photo view looks identical
 * before and after: the camera turns with the room.
 */
export function splatTransform(world: WorldPlacement, metresPerUnit: number, floorOffset = 0): SplatTransform {
  const msf = world.metricScaleFactor;
  const metric = msf != null && msf > 0;
  const s = metric ? (msf as number) : metresPerUnit > 0 ? metresPerUnit : 1;
  const b = world.bounds;
  // Height of the capture point above Audora's floor. Marble's own ground plane when the world
  // carries metric semantics (measured against its splat: 1.2 cm), else the collider's floor plane,
  // else the drop from the camera to the lowest point of the mesh.
  const captureY =
    metric && world.groundPlaneOffset != null
      ? world.groundPlaneOffset
      : b?.floorY != null
        ? -b.floorY * s
        : b
          ? -b.minY * s
          : 0;
  // The same rectangle the room is measured with, in the same axes (see `roomRect`). The capture
  // point sits at its origin, so putting the room centre on ours is one subtraction.
  const rect = roomRect(b);
  const x = rect ? -((rect.minX + rect.maxX) / 2) * s : 0;
  const z = rect ? -((rect.minZ + rect.maxZ) / 2) * s : 0;
  const yaw = rect?.yaw ?? 0;
  return { scale: s, position: [x, captureY + floorOffset, z], rotationY: Math.PI + yaw, yaw, metric };
}

/** What `splatTransform` needs of a world; every `RoomWorld` satisfies it. */
export interface WorldPlacement {
  metricScaleFactor?: number | null;
  groundPlaneOffset?: number | null;
  bounds?: WorldBounds;
}

/** Nothing this big is one room, whatever the collider says. */
const MAX_ROOM_AREA_M2 = 60;
const MAX_ROOM_SIDE_M = 9;

export interface RoomExtent {
  raw: RawGeometry;
  /** The bounds to store: the same object, with `method` set to what the extent actually came from. */
  bounds?: WorldBounds;
  method: ExtentMethod | 'estimate';
}

/**
 * The room a world should report, and the bounds to store beside it.
 *
 * `rawFromBounds`, unless the metric room that comes out of it is not a room at all: Marble's
 * collider includes whatever the model hallucinated through the windows and the open doors, which
 * for a full-quality world of a flat is the whole floor plan. Measured: the demo flat's bounding
 * box is 138 m², and even its wall band — a real measurement of a real open-plan space — comes to
 * 6.5 × 11.8 m. That is a flat, not a living room, so the caller's estimate stands and the bounds
 * are stored as `aabb`, which keeps the wall rectangle on the record without letting
 * `splatTransform` centre the room on a rectangle the room is not.
 */
export function roomExtent(bounds: WorldBounds | undefined, metresPerUnit: number, fallback: RawGeometry): RoomExtent {
  if (!bounds) return { raw: fallback, method: 'estimate' };
  const raw = rawFromBounds(bounds);
  const g = applyScale(raw, metresPerUnit);
  const sane =
    plausibility(g).every((w) => w.severity !== 'error') &&
    g.width * g.depth <= MAX_ROOM_AREA_M2 &&
    Math.max(g.width, g.depth) <= MAX_ROOM_SIDE_M &&
    g.height >= 2.1 &&
    g.height <= 3.6;
  if (sane) return { raw, bounds, method: bounds.walls ? 'walls' : 'aabb' };
  return { raw: fallback, bounds: { ...bounds, method: 'aabb' }, method: 'estimate' };
}

/** `roomExtent`, for callers that only want the geometry. */
export function rawFromBoundsOr(bounds: WorldBounds | undefined, metresPerUnit: number, fallback: RawGeometry): RawGeometry {
  return roomExtent(bounds, metresPerUnit, fallback).raw;
}

export interface MarbleOperation {
  operation_id: string;
  done: boolean;
  metadata?: {
    progress_percent?: number;
    /** What the API actually returns today: a status object, no percentage. */
    progress?: { status?: string; description?: string };
    world_id?: string;
    operation_type?: string;
    public_model_name?: string;
  } | null;
  response?: MarbleWorld | null;
  error?: { code?: string; message?: string } | null;
  cost?: { total_credits?: number } | null;
  created_at?: string;
  updated_at?: string;
}

export interface MarbleWorld {
  world_id: string;
  display_name?: string;
  world_marble_url?: string;
  model?: string;
  assets?: {
    thumbnail_url?: string;
    caption?: string;
    imagery?: { pano_url?: string };
    mesh?: { full_res_mesh_url?: string; hq_mesh_url?: string; collider_mesh_url?: string };
    splats?: { spz_urls?: Record<string, string>; semantics_metadata?: { metric_scale_factor?: number | null; ground_plane_offset?: number | null } };
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const text = await r.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!r.ok) throw new Error(body?.error?.message || body?.error || body?.detail || `${r.status} ${path}`);
  return body as T;
}

export async function providerStatus(): Promise<ProviderStatus> {
  try {
    const s = await api<{ nebius: boolean; marble: boolean; models: Record<string, string> }>('/api/status');
    return { ...s, checkedAt: Date.now() };
  } catch {
    return { nebius: false, marble: false, checkedAt: Date.now() };
  }
}

/** Kick off a Marble generation for a room photo. Returns immediately with the operation id. */
/* ---------- what a room sends to Marble ----------
 * One photo is the floor of the product; more angles are the ceiling. `room.photo` is the primary
 * shot (the one the anchor was tapped on) and `room.photos` holds the extra angles in the order the
 * seller added them, up to `MAX_ROOM_PHOTOS` between them.
 *
 * When the seller says which way an angle faces, that becomes Marble's `azimuth`: degrees round the
 * capture point with the primary shot at 0, matching the Front / Left / Right the Marble UI offers.
 * An unlabelled angle sends no azimuth at all, which is the documented "work it out yourself" mode —
 * a wrong hint is worse than none. */

/** Marble's own cap in reconstruction mode; the create flow stops the seller at six. */
export const MAX_ROOM_PHOTOS = 6;

/** Where an angle faces, relative to the room's primary photo (declared on the stored photo record). */
export type { PhotoAngle };

export const AZIMUTH_FOR_ANGLE: Record<PhotoAngle, number> = { centre: 0, right: 90, back: 180, left: 270 };

export const ANGLE_LABELS: Record<PhotoAngle, string> = {
  centre: 'Straight ahead',
  left: 'Turned left',
  right: 'Turned right',
  back: 'From the far side',
};

/** Every photo a room will send, primary first. */
export function roomPhotos(room: Pick<Room, 'photo' | 'photos'>): PhotoRecord[] {
  return [...(room.photo ? [room.photo] : []), ...(room.photos ?? [])].slice(0, MAX_ROOM_PHOTOS);
}

/** The images and azimuth hints a room's generation request carries. */
export function generationImages(room: Pick<Room, 'photo' | 'photos'>): { dataUrl: string; azimuth?: number }[] {
  return roomPhotos(room).map((p, i) => {
    const angle = p.angle;
    // The primary shot defines 0°, so it never needs a hint of its own.
    if (i === 0 || !angle) return { dataUrl: p.dataUrl };
    return { dataUrl: p.dataUrl, azimuth: AZIMUTH_FOR_ANGLE[angle] };
  });
}

export async function startGeneration(room: Room, tier: Tier): Promise<{ operationId: string; worldId?: string }> {
  const images = generationImages(room);
  if (!images.length) throw new Error('This room has no photo to reconstruct from.');
  const op = await api<MarbleOperation>('/api/marble/generate', {
    method: 'POST',
    body: JSON.stringify({
      images,
      // Kept so an older server (or a replay of a stored request) still gets the primary shot.
      imageDataUrl: images[0].dataUrl,
      tier,
      displayName: `Audora · ${room.name}`,
      textPrompt:
        images.length > 1
          ? 'One residential room photographed from several angles. All the images are the same room; keep the real geometry and do not invent extra space.'
          : undefined,
    }),
  });
  return { operationId: op.operation_id, worldId: op.metadata?.world_id };
}

export async function pollOperation(operationId: string): Promise<MarbleOperation> {
  return api<MarbleOperation>(`/api/marble/operations/${operationId}`);
}

export async function fetchWorld(worldId: string): Promise<MarbleWorld> {
  return api<MarbleWorld>(`/api/marble/worlds/${worldId}`);
}

/* ---------- the panorama lands late ----------
 * A draft operation reports `done` before Marble has finished writing the equirectangular
 * panorama, so `assets.imagery.pano_url` is often missing for a few seconds — and the panorama is
 * what the photo view renders. The reference build polls the world record every 2.5 s for about a
 * minute; so do we, and we attach the world either way when the time is up (the viewer falls back
 * to the room shell, and a later regeneration picks the panorama up). */

export const PANO_POLL_INTERVAL_MS = 2500;
export const PANO_POLL_TIMEOUT_MS = 60_000;

export function panoUrlOf(world: MarbleWorld | undefined | null): string | undefined {
  return world?.assets?.imagery?.pano_url || undefined;
}

export interface PanoWaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  getWorld?: (worldId: string) => Promise<MarbleWorld>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called before every poll with the attempt number (1-based) and how long we have waited, in ms. */
  onAttempt?: (attempt: number, elapsedMs: number) => void;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll a world until its panorama appears. Never throws and never returns nothing useful: the
 * freshest world record seen comes back, panorama or not, so the caller can attach it anyway.
 */
export async function waitForPano(worldId: string, initial?: MarbleWorld | null, opts: PanoWaitOptions = {}): Promise<MarbleWorld | undefined> {
  const { intervalMs = PANO_POLL_INTERVAL_MS, timeoutMs = PANO_POLL_TIMEOUT_MS, getWorld = fetchWorld, sleep = wait, now = Date.now, onAttempt } = opts;
  let best = initial ?? undefined;
  if (panoUrlOf(best)) return best;
  const started = now();
  let attempt = 0;
  while (now() - started < timeoutMs) {
    await sleep(intervalMs);
    attempt += 1;
    onAttempt?.(attempt, now() - started);
    try {
      const w = await getWorld(worldId);
      // A record that carries assets is always the better one to keep.
      if (w?.assets || !best) best = w;
      if (panoUrlOf(best)) return best;
    } catch {
      /* transient: keep polling until the timeout */
    }
  }
  return best;
}

/** Pick the smallest / most web-friendly SPZ url from the map Marble returns. */
export function pickSpz(urls?: Record<string, string>): string | undefined {
  if (!urls) return undefined;
  const entries = Object.entries(urls);
  if (!entries.length) return undefined;
  const pref = ['500k', '1m', 'low', 'medium', 'preview', 'default', 'full_res', 'high'];
  for (const p of pref) {
    const hit = entries.find(([k]) => k.toLowerCase().includes(p));
    if (hit) return hit[1];
  }
  return entries[0][1];
}

/** Convert a finished Marble world into Audora's RoomWorld. Pass collider bounds to derive raw room geometry from the world itself. */
export function worldFromMarble(room: Room, tier: Tier, w: MarbleWorld, credits?: number, seconds?: number, bounds?: WorldBounds): RoomWorld {
  const a = w.assets || {};
  const msf = a.splats?.semantics_metadata?.metric_scale_factor ?? null;
  const fallbackRaw = room.raw ?? mockRawGeometry(room.id, room.type);
  const extent = roomExtent(bounds, msf && msf > 0 ? msf : (room.anchor?.metresPerUnit ?? 1), fallbackRaw);
  return {
    bounds: extent.bounds,
    provider: 'marble',
    tier,
    worldId: w.world_id,
    model: w.model || (tier === 'draft' ? 'marble-1.0-draft' : 'marble-1.1'),
    createdAt: Date.now(),
    raw: extent.raw,
    spzUrl: pickSpz(a.splats?.spz_urls),
    // The whole ladder, not just the tier the viewer starts on: `SplatWorld` streams the smallest
    // file first and climbs (three/splat/tiers), which it can only do if the urls survive the trip
    // into the store.
    spzUrls: a.splats?.spz_urls ?? null,
    colliderUrl: a.mesh?.collider_mesh_url,
    meshUrl: a.mesh?.hq_mesh_url || a.mesh?.full_res_mesh_url,
    thumbnailUrl: a.thumbnail_url,
    panoUrl: a.imagery?.pano_url,
    caption: a.caption,
    marbleUrl: w.world_marble_url,
    metricScaleFactor: a.splats?.semantics_metadata?.metric_scale_factor ?? null,
    groundPlaneOffset: a.splats?.semantics_metadata?.ground_plane_offset ?? null,
    credits,
    usd: credits ? credits / 1250 : undefined,
    seconds,
  };
}
