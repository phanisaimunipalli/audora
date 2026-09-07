/**
 * The walkable floor of a *real* reconstruction, read off its collider mesh.
 *
 * Audora's room rectangle is a rectangle — the room measured to its walls (`roomRect`) when the
 * collider gave one, its bounding box when it did not. A real room is not a rectangle: it has a
 * chimney breast, a bay, a doorway the model reconstructed the hall through. Walking the rectangle
 * takes the buyer through the photographed wall into a black void; walking the mesh does not.
 *
 * So: rasterise the collider's wall band (waist height, where a person actually collides) into a
 * coarse occupancy grid, grow it by the walker's radius, and flood-fill the free cells from the
 * capture point. What the flood reaches is the room the photographer stood in; everything else —
 * beyond the walls, outside the windows, down the hall through a doorway gap — is off limits.
 *
 * Pure apart from reading `Object3D.matrixWorld`, so it can be exercised with a hand-built
 * BufferGeometry in tests.
 */
import * as THREE from 'three';
import { WALK_RADIUS } from './walkMath';

export interface WalkMask {
  /** True when a walker's centre cannot stand at (x, z) — outside the real walls, or inside one. */
  blocked(x: number, z: number): boolean;
  /** Cell size in metres. */
  readonly cell: number;
  /** Reachable floor area in m², for logging and for sanity checks. */
  readonly areaM2: number;
}

declare global {
  interface Window {
    /** Dev only: the walkable mask of the room on screen, so a script can assert where the walls are. */
    __audoraWalkMask?: WalkMask | null;
  }
}

export interface WalkMaskOptions {
  /** Grid resolution in metres (default 0.12). */
  cell?: number;
  /** Walker radius the occupancy is grown by (default `WALK_RADIUS`). */
  radius?: number;
  /** A point known to be inside the room — the capture point. The flood starts here. */
  seed?: { x: number; z: number };
  /** Metres above our floor (y = 0) that count as "wall" (default 0.30–1.70: knees to shoulders). */
  band?: [number, number];
  /** Ignore geometry further than this from the seed, in metres (default 25). */
  reach?: number;
  /** Below this reachable area the mask is not trustworthy and null is returned (default 2 m²). */
  minAreaM2?: number;
  /**
   * The room Audora states, as half-extents about the origin. Cells outside it are walled off before
   * the flood, so the mask measures the floor the buyer can *actually* stand on rather than every
   * square metre the collider happens to reach.
   *
   * It matters most where the two disagree: the full-quality flat's collider is a whole open-plan
   * apartment, `roomExtent` rejects that as "not one room" and the tour states 5.50 × 4.00 m — and
   * the mask then reported 52.5 m² of walkable floor for a 22 m² room, while `standable` clamped the
   * walker to the rectangle anyway. One number, and it is the true one.
   */
  limit?: { halfWidth: number; halfDepth: number };
  /** Cap on triangles read; beyond it the mesh is strided (default 400k). */
  maxTriangles?: number;
}

const v0 = new THREE.Vector3();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

/**
 * Rasterise one segment between two in-band points into the grid (Bresenham on cell centres, so a
 * wall made of long thin triangles still comes out as an unbroken line).
 */
function stroke(occ: Uint8Array, cols: number, rows: number, ax: number, az: number, bx: number, bz: number): void {
  if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) return;
  const dx = bx - ax;
  const dz = bz - az;
  // Capped: one stray vertex a kilometre away would otherwise ask for a million steps, and a
  // segment that long is a meshing artefact rather than a wall anyway.
  const steps = Math.min(cols + rows, Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)))));
  for (let i = 0; i <= steps; i++) {
    const cx = Math.round(ax + (dx * i) / steps);
    const cz = Math.round(az + (dz * i) / steps);
    if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) continue;
    occ[cz * cols + cx] = 1;
  }
}

/** Chebyshev dilation by `r` cells, done separably (two passes) so it stays O(n·r). */
function dilate(src: Uint8Array, cols: number, rows: number, r: number): Uint8Array {
  if (r <= 0) return src;
  const mid = new Uint8Array(src.length);
  for (let z = 0; z < rows; z++) {
    const row = z * cols;
    for (let x = 0; x < cols; x++) {
      if (!src[row + x]) continue;
      const lo = Math.max(0, x - r);
      const hi = Math.min(cols - 1, x + r);
      for (let k = lo; k <= hi; k++) mid[row + k] = 1;
    }
  }
  const out = new Uint8Array(src.length);
  for (let z = 0; z < rows; z++) {
    const lo = Math.max(0, z - r);
    const hi = Math.min(rows - 1, z + r);
    for (let x = 0; x < cols; x++) {
      if (!mid[z * cols + x]) continue;
      for (let k = lo; k <= hi; k++) out[k * cols + x] = 1;
    }
  }
  return out;
}

/**
 * Build the walkable mask for a loaded collider mesh, already placed in Audora's metric frame
 * (floor y = 0, room centre at the origin). Returns null when the mesh says nothing useful — no
 * geometry in the wall band, a seed that is itself walled in, or a suspiciously tiny room — so the
 * caller falls back to the room rectangle rather than freezing the walker.
 */
export function buildWalkMask(root: THREE.Object3D, options: WalkMaskOptions = {}): WalkMask | null {
  const cell = options.cell ?? 0.12;
  const radius = options.radius ?? WALK_RADIUS;
  const seed = options.seed ?? { x: 0, z: 0 };
  const [bandLow, bandHigh] = options.band ?? [0.3, 1.7];
  const reach = options.reach ?? 25;
  const minArea = options.minAreaM2 ?? 2;
  const maxTriangles = options.maxTriangles ?? 400_000;
  if (!(cell > 0) || !(reach > 0)) return null;

  root.updateWorldMatrix(true, true);

  const minX = seed.x - reach;
  const minZ = seed.z - reach;
  const cols = Math.ceil((reach * 2) / cell);
  const rows = cols;
  const occ = new Uint8Array(cols * rows);
  const gx = (x: number) => (x - minX) / cell;
  const gz = (z: number) => (z - minZ) / cell;

  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.getAttribute('position')) meshes.push(m);
  });
  if (!meshes.length) return null;

  let total = 0;
  for (const m of meshes) {
    const index = m.geometry.getIndex();
    total += (index ? index.count : m.geometry.getAttribute('position').count) / 3;
  }
  const stride = total > maxTriangles ? Math.ceil(total / maxTriangles) : 1;

  let marked = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = m.geometry.getIndex();
    const count = index ? index.count : pos.count;
    const at = (i: number) => (index ? index.getX(i) : i);
    const mat = m.matrixWorld;
    for (let i = 0; i + 2 < count; i += 3 * stride) {
      v0.fromBufferAttribute(pos, at(i)).applyMatrix4(mat);
      v1.fromBufferAttribute(pos, at(i + 1)).applyMatrix4(mat);
      v2.fromBufferAttribute(pos, at(i + 2)).applyMatrix4(mat);
      // Anything that *crosses* the band is a wall to a person, whether or not it has a vertex in
      // it: one wall quad from floor to ceiling has vertices only at its two ends. The floor
      // (entirely below) and the ceiling (entirely above) fall out here, which is the point.
      const lo = Math.min(v0.y, v1.y, v2.y);
      const hi = Math.max(v0.y, v1.y, v2.y);
      if (hi < bandLow || lo > bandHigh) continue;
      stroke(occ, cols, rows, gx(v0.x), gz(v0.z), gx(v1.x), gz(v1.z));
      stroke(occ, cols, rows, gx(v1.x), gz(v1.z), gx(v2.x), gz(v2.z));
      stroke(occ, cols, rows, gx(v2.x), gz(v2.z), gx(v0.x), gz(v0.z));
      marked++;
    }
  }
  if (marked === 0) return null;

  const solid = dilate(occ, cols, rows, Math.max(1, Math.round(radius / cell)));

  /* The stated room is a wall too (see `limit`). Applied after the dilation, because the walker's
     radius is already taken off the rectangle by `standable`; double-counting it would shave another
     25 cm off every side. */
  if (options.limit) {
    const hx = Math.max(cell, options.limit.halfWidth - radius - 0.02);
    const hz = Math.max(cell, options.limit.halfDepth - radius - 0.02);
    for (let z = 0; z < rows; z++) {
      const wz = minZ + z * cell;
      for (let x = 0; x < cols; x++) {
        const wx = minX + x * cell;
        if (Math.abs(wx) > hx || Math.abs(wz) > hz) solid[z * cols + x] = 1;
      }
    }
  }

  // Flood-fill the free cells from the capture point. Anything the flood cannot reach is either
  // beyond a wall or outside the room, and the buyer has no business there.
  const sx = Math.round(gx(seed.x));
  const sz = Math.round(gz(seed.z));
  let start = -1;
  outer: for (let r = 0; r <= Math.round(1.5 / cell); r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = sx + dx;
        const z = sz + dz;
        if (x < 0 || z < 0 || x >= cols || z >= rows) continue;
        if (!solid[z * cols + x]) {
          start = z * cols + x;
          break outer;
        }
      }
    }
  }
  if (start < 0) return null;

  const open = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  open[start] = 1;
  let free = 0;
  let leaked = false;
  while (head < tail) {
    const i = queue[head++];
    free++;
    const x = i % cols;
    const z = (i / cols) | 0;
    // The flood ran off the edge of the grid: this mesh does not enclose the capture point, so it
    // has nothing trustworthy to say about where the walls are. Better the room rectangle than a
    // mask that stops the buyer at an imaginary line.
    if (x === 0 || z === 0 || x === cols - 1 || z === rows - 1) leaked = true;
    if (x > 0 && !open[i - 1] && !solid[i - 1]) (open[i - 1] = 1), (queue[tail++] = i - 1);
    if (x < cols - 1 && !open[i + 1] && !solid[i + 1]) (open[i + 1] = 1), (queue[tail++] = i + 1);
    if (z > 0 && !open[i - cols] && !solid[i - cols]) (open[i - cols] = 1), (queue[tail++] = i - cols);
    if (z < rows - 1 && !open[i + cols] && !solid[i + cols]) (open[i + cols] = 1), (queue[tail++] = i + cols);
  }

  const areaM2 = free * cell * cell;
  if (leaked || areaM2 < minArea) return null;

  return {
    cell,
    areaM2,
    blocked(x: number, z: number): boolean {
      const cx = Math.round((x - minX) / cell);
      const cz = Math.round((z - minZ) / cell);
      if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) return true;
      return open[cz * cols + cx] === 0;
    },
  };
}
