/**
 * A last-resort wall test against the collider mesh itself.
 *
 * `walkMask.ts` is the fast path: it rasterises the collider's wall band into a 12 cm grid once and
 * answers in constant time, and it is what both demo worlds use (7.1 m² of standable floor in the
 * corner room, 52.7 m² in the furnished flat). But it deliberately gives up when the flood-fill
 * escapes the grid or encloses almost nothing — a reconstruction that does not enclose the capture
 * point has nothing trustworthy to say — and until now that meant falling back to the room
 * *rectangle*, i.e. walking straight through the photographed walls.
 *
 * This is the net under that case: a point test that casts four short rays from the walker's chest
 * and calls the spot blocked if any of them hits real geometry within the walker's radius. Raycasts
 * against a 150k-triangle mesh are not cheap, so every answer is memoised per grid cell and the
 * whole probe is skipped for points outside the collider's bounding box. It runs only when the mask
 * is missing; when the mask is there, this file costs nothing.
 */
import * as THREE from 'three';
import { WALK_RADIUS, type WalkBounds } from '../walkMath';

export interface ColliderProbeOptions {
  /** Metres of clearance a walker needs around them (default `WALK_RADIUS`). */
  radius?: number;
  /** Heights above our floor to probe at — knees and chest by default. */
  heights?: number[];
  /** Memo cell size in metres. */
  cell?: number;
}

/**
 * Build a {@link WalkBounds} from a loaded collider, already placed in Audora's metric frame.
 * Returns null when the mesh has no geometry to test against.
 */
export function colliderProbe(root: THREE.Object3D | null | undefined, options: ColliderProbeOptions = {}): WalkBounds | null {
  if (!root) return null;
  const radius = options.radius ?? WALK_RADIUS;
  const heights = options.heights ?? [0.5, 1.2];
  const cell = options.cell ?? 0.12;

  root.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.getAttribute('position')) meshes.push(m);
  });
  if (!meshes.length) return null;

  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;

  const ray = new THREE.Raycaster();
  ray.far = radius;
  const origin = new THREE.Vector3();
  const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
  const hits: THREE.Intersection[] = [];
  const memo = new Map<string, boolean>();

  return {
    blocked(x: number, z: number): boolean {
      // Outside the reconstruction entirely: there is nothing there to stand in.
      if (x < box.min.x - radius || x > box.max.x + radius || z < box.min.z - radius || z > box.max.z + radius) return true;
      const key = `${Math.round(x / cell)},${Math.round(z / cell)}`;
      const seen = memo.get(key);
      if (seen !== undefined) return seen;
      let blocked = false;
      outer: for (const h of heights) {
        for (const d of dirs) {
          origin.set(x, h, z);
          ray.set(origin, d);
          ray.far = radius;
          hits.length = 0;
          for (const m of meshes) {
            m.raycast(ray, hits);
            if (hits.length) {
              blocked = true;
              break outer;
            }
          }
        }
      }
      memo.set(key, blocked);
      return blocked;
    },
  };
}
