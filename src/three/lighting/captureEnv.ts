/**
 * The room's environment map, delivered to the furniture layer and to nothing else.
 *
 * `scene.environment` would be one line, and it would be wrong for this product: it is a property of
 * the *scene*, so it lights whatever standard material happens to be mounted — the measured shell,
 * a future overlay, anything a teammate adds later — and portrait-mode layering says the photo layer
 * is never re-lit by us. So the PMREM texture is published here, per renderer, and picked up only by
 * `Mat` in `three/furniture/parts` (every procedural piece's only material). The splat's shader
 * material and the panorama's `MeshBasicMaterial` cannot read it even in principle, and now neither
 * can anything else: an environment applied through a material's own `envMap` reaches exactly the
 * materials that ask for it.
 *
 * Keyed by `WebGLRenderer` rather than kept in a module global because a PMREM render target belongs
 * to the context that made it: the buyer's viewer and the offscreen stills canvas each have their
 * own, and handing one canvas's texture to the other would draw noise.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import type { LightBudget, PanoramaLight } from './panoramaLight';

export interface CaptureEnvironment {
  /** The panorama, prefiltered (PMREM) so a rough material integrates it correctly. */
  envMap: THREE.Texture;
  /** Calibrated so a white piece reads like the walls around it. See `lightBudget`. */
  envMapIntensity: number;
  /** Turn about y that lines the environment up with the room, radians. */
  rotationY: number;
  /** What the panorama measured, for panels and tests. */
  light: PanoramaLight;
  budget: LightBudget;
}

const values = new WeakMap<THREE.WebGLRenderer, CaptureEnvironment | null>();
const subscribers = new Map<THREE.WebGLRenderer, Set<() => void>>();

/** Publish (or, with null, withdraw) the environment for one canvas. Called by CaptureLight. */
export function publishCaptureEnv(gl: THREE.WebGLRenderer, env: CaptureEnvironment | null): void {
  values.set(gl, env);
  const set = subscribers.get(gl);
  if (set) for (const fn of [...set]) fn();
}

/** The environment for one canvas, outside React. */
export function readCaptureEnv(gl: THREE.WebGLRenderer): CaptureEnvironment | null {
  return values.get(gl) ?? null;
}

/**
 * The environment for the canvas this component is mounted in, or null when no real capture is on
 * screen (a simulated room keeps the measured shell's own studio lights).
 */
export function useCaptureEnv(): CaptureEnvironment | null {
  const gl = useThree((s) => s.gl);
  const subscribe = useCallback(
    (onChange: () => void) => {
      let set = subscribers.get(gl);
      if (!set) {
        set = new Set();
        subscribers.set(gl, set);
      }
      set.add(onChange);
      return () => {
        set?.delete(onChange);
        if (set && set.size === 0) subscribers.delete(gl);
      };
    },
    [gl],
  );
  const snapshot = useCallback(() => values.get(gl) ?? null, [gl]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
