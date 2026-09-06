import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SparkRenderer as SparkRendererT, SplatMesh as SplatMeshT } from '@sparkjsdev/spark';
import type { RoomWorld } from '@/state/types';
import { splatTransform } from '@/services/marble';

export type SplatStatus = 'loading' | 'ready' | 'error';

export interface SplatWorldProps {
  world: RoomWorld;
  visible?: boolean;
  onStatus?: (s: SplatStatus, detail?: string) => void;
  /** 0..1 global opacity of the splat. */
  opacity?: number;
  /** Extra placement inside the metric room frame (after Marble's own metric transform). */
  transform?: { x?: number; z?: number; yaw?: number; y?: number };
  /**
   * The room anchor's metres per raw unit. Draft worlds carry no `metricScaleFactor`, so this is what
   * scales them; with collider `bounds` on the world it also centres the capture on the room origin
   * with its floor at y = 0 (see `splatTransform` in services/marble).
   */
  metresPerUnit?: number;
}

type SparkModule = typeof import('@sparkjsdev/spark');

/**
 * One SparkRenderer per WebGLRenderer, shared by every SplatWorld on that canvas and kept for the
 * life of the renderer. It sits at the scene root and drives sorting for all splat meshes.
 */
const renderers = new WeakMap<THREE.WebGLRenderer, { spark: SparkRendererT; refs: number }>();

function acquireSpark(mod: SparkModule, gl: THREE.WebGLRenderer, scene: THREE.Scene): () => void {
  let entry = renderers.get(gl);
  if (!entry) {
    const spark = new mod.SparkRenderer({ renderer: gl });
    spark.name = 'audora-spark';
    spark.userData.measureIgnore = true;
    entry = { spark, refs: 0 };
    renderers.set(gl, entry);
  }
  entry.refs += 1;
  if (!entry.spark.parent) scene.add(entry.spark);
  let released = false;
  return () => {
    if (released || !entry) return;
    released = true;
    entry.refs -= 1;
    if (entry.refs <= 0 && entry.spark.parent) entry.spark.parent.remove(entry.spark);
  };
}

/**
 * Place a Marble splat in the metric room frame, in world space, using the same
 * `splatTransform(world, metresPerUnit)` that MarbleWorld's group uses — so the splat, the panorama
 * sphere and the collider wireframe all land on top of each other.
 *
 * The SPZ is in Marble's `marble_raw_opencv` frame (x right, y down, z forward), a proper
 * right-handed frame, so it needs no mirror: a 180° turn about x brings it to y-up with the capture
 * looking along −z. That is exactly `T(position)·rotX(π)·S(scale)` — the same composition as being a
 * child of a group at `position` with `rotationY = π`, whose local frame is the collider's.
 * (The collider itself is a reflection of that frame and is mirrored back inside the group; see
 * MarbleWorld's COLLIDER_MIRROR.)
 */
export function applyMarbleFrame(
  obj: THREE.Object3D,
  world: Pick<RoomWorld, 'metricScaleFactor' | 'groundPlaneOffset' | 'provider' | 'bounds'>,
  extra?: SplatWorldProps['transform'],
  metresPerUnit?: number,
) {
  const rotX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const yaw = extra?.yaw ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), extra.yaw) : null;
  const t = splatTransform(world, metresPerUnit && metresPerUnit > 0 ? metresPerUnit : (world.metricScaleFactor ?? 1));
  obj.scale.setScalar(t.scale);
  obj.quaternion.copy(rotX);
  if (yaw) obj.quaternion.premultiply(yaw);
  obj.position.set(t.position[0] + (extra?.x ?? 0), t.position[1] + (extra?.y ?? 0), t.position[2] + (extra?.z ?? 0));
  obj.updateMatrixWorld();
}

/**
 * Renders a real Marble world (Gaussian splat, .spz) with Spark. Spark is loaded lazily so the app
 * never pays for it when a room is procedural. Never throws: failures are reported via onStatus.
 */
export function SplatWorld({ world, visible = true, onStatus, opacity = 1, transform, metresPerUnit }: SplatWorldProps) {
  const { scene, gl, invalidate } = useThree();
  const meshRef = useRef<SplatMeshT | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const url = world.spzUrl;
  const scale = world.metricScaleFactor ?? null;
  const ground = world.groundPlaneOffset ?? null;
  const bounds = world.bounds;
  const boundsKey = bounds ? [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, bounds.minZ, bounds.maxZ].join(',') : '';
  const mpu = metresPerUnit ?? null;
  const tx = transform?.x ?? 0;
  const tz = transform?.z ?? 0;
  const ty = transform?.y ?? 0;
  const tyaw = transform?.yaw ?? 0;

  useEffect(() => {
    if (!url) return;
    let disposed = false;
    let release: (() => void) | null = null;
    let mesh: SplatMeshT | null = null;
    const report = (s: SplatStatus, d?: string) => {
      if (!disposed) statusRef.current?.(s, d);
    };
    report('loading');
    (async () => {
      const mod = await import('@sparkjsdev/spark');
      if (disposed) return;
      release = acquireSpark(mod, gl, scene);
      mesh = new mod.SplatMesh({ url, raycastable: true });
      mesh.name = 'audora-splat';
      mesh.userData.stillsKeep = true;
      applyMarbleFrame(mesh, { metricScaleFactor: scale, groundPlaneOffset: ground, provider: world.provider, bounds }, { x: tx, z: tz, y: ty, yaw: tyaw }, mpu ?? undefined);
      mesh.visible = false;
      scene.add(mesh);
      meshRef.current = mesh;
      await mesh.initialized;
      if (disposed) return;
      mesh.visible = visible;
      mesh.opacity = opacity;
      const n = mesh.packedSplats?.numSplats ?? 0;
      report('ready', n ? `${(n / 1000).toFixed(0)}k splats` : undefined);
      invalidate();
    })().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not load the splat';
      if (mesh) {
        scene.remove(mesh);
        try {
          mesh.dispose();
        } catch {
          /* ignore */
        }
        if (meshRef.current === mesh) meshRef.current = null;
      }
      release?.();
      release = null;
      report('error', msg);
    });
    return () => {
      disposed = true;
      const m = mesh;
      if (m) {
        scene.remove(m);
        try {
          m.dispose();
        } catch {
          /* ignore */
        }
      }
      if (meshRef.current === m) meshRef.current = null;
      release?.();
    };
    // Re-load only when the asset or its metric frame changes; visibility/opacity are applied live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, scale, ground, boundsKey, mpu, tx, tz, ty, tyaw, scene, gl]);

  useEffect(() => {
    const m = meshRef.current;
    if (!m || !m.isInitialized) return;
    m.visible = visible;
    m.opacity = opacity;
    invalidate();
  }, [visible, opacity, invalidate]);

  return null;
}
