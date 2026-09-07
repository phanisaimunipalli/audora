/**
 * One `SparkRenderer` per WebGL renderer, shared by every splat mesh on that canvas.
 *
 * Spark sorts *all* the splat meshes parented under one SparkRenderer into a single depth order, so
 * two tiers cross-fading during a swap composite correctly instead of fighting. It also means the
 * renderer must outlive individual meshes: it is reference-counted and only detached when the last
 * splat on the canvas goes away.
 *
 * Quality settings are chosen for a walked room rather than a turntable: radial sorting (stable when
 * the buyer turns on the spot), a sort interval that keeps a phone's worker from thrashing, and no
 * depth writes, so our procedural furniture still composites into the capture.
 */
import * as THREE from 'three';
import type { SparkRenderer as SparkRendererT } from '@sparkjsdev/spark';
import { deviceHints, type DeviceHints } from './tiers';

export type SparkModule = typeof import('@sparkjsdev/spark');

interface Entry {
  spark: SparkRendererT;
  refs: number;
}

const renderers = new WeakMap<THREE.WebGLRenderer, Entry>();

export interface SparkOptions {
  /** Called when Spark finishes a sort and the frame is stale — drives `invalidate()` on demand loops. */
  onDirty?: () => void;
  hints?: DeviceHints;
}

/**
 * Attach (or reuse) the canvas's SparkRenderer and return a release function. Safe to call from an
 * effect; the release is idempotent.
 */
export function acquireSpark(mod: SparkModule, gl: THREE.WebGLRenderer, scene: THREE.Scene, options: SparkOptions = {}): () => void {
  let entry = renderers.get(gl);
  if (!entry) {
    const hints = options.hints ?? deviceHints();
    const spark = new mod.SparkRenderer({
      renderer: gl,
      // A phone that re-sorts 500k splats every frame drops the frame it was sorting for; 40 Hz is
      // indistinguishable while walking and leaves the worker time to breathe.
      minSortIntervalMs: hints.coarsePointer ? 25 : 0,
      // Radial (geometric) sorting stays stable as the buyer turns on the spot, which is most of
      // what walking a room is.
      sortRadial: true,
      onDirty: options.onDirty,
    });
    spark.name = 'audora-spark';
    spark.userData.measureIgnore = true;
    spark.userData.stillsKeep = true;
    entry = { spark, refs: 0 };
    renderers.set(gl, entry);
  }
  entry.refs += 1;
  if (!entry.spark.parent) scene.add(entry.spark);
  let released = false;
  const held = entry;
  return () => {
    if (released) return;
    released = true;
    held.refs -= 1;
    if (held.refs <= 0 && held.spark.parent) held.spark.parent.remove(held.spark);
  };
}
