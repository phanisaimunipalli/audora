/** Floor-plane maths and small timing helpers shared by the staging interaction. */
import * as THREE from 'three';

/** The room floor: y = 0, normal up. */
export const FLOOR_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const scratch = new THREE.Vector3();

/** Where a pointer ray meets the floor, in room coordinates; null when the ray never reaches it. */
export function floorPoint(ray: THREE.Ray): { x: number; z: number } | null {
  const hit = ray.intersectPlane(FLOOR_PLANE, scratch);
  if (!hit) return null;
  return { x: hit.x, z: hit.z };
}

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  /** Send the pending trailing call now. */
  flush(): void;
  cancel(): void;
}

/** Leading + trailing throttle: the first call fires immediately, later calls at most once per `ms`. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A> {
  let last = 0;
  let timer: number | null = null;
  let pending: A | null = null;
  const fire = () => {
    timer = null;
    if (pending) {
      const args = pending;
      pending = null;
      last = Date.now();
      fn(...args);
    }
  };
  const t = ((...args: A) => {
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0 && timer === null) {
      last = now;
      fn(...args);
      return;
    }
    pending = args;
    if (timer === null) timer = window.setTimeout(fire, Math.max(0, wait));
  }) as Throttled<A>;
  t.flush = () => {
    if (timer !== null) window.clearTimeout(timer);
    fire();
  };
  t.cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return t;
}

/** Degrees in [0, 360). */
export function degrees(rot: number): number {
  const d = Math.round((rot * 180) / Math.PI) % 360;
  return d < 0 ? d + 360 : d;
}

/** Normalise an angle into (-π, π]. */
export function wrapAngle(rot: number): number {
  let r = rot;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

/** Is the keyboard event aimed at a text field (so editor shortcuts must stay out of the way)? */
export function inTextField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Pointer capture that never throws: synthetic events (tests, automation) and pointers that are already
 * gone make the DOM call raise, and a drag handler must not die on that.
 */
export function capture(e: { pointerId: number; target: unknown }, mode: 'set' | 'release'): void {
  const t = e.target as { setPointerCapture?: (id: number) => void; releasePointerCapture?: (id: number) => void } | null;
  try {
    if (mode === 'set') t?.setPointerCapture?.(e.pointerId);
    else t?.releasePointerCapture?.(e.pointerId);
  } catch {
    /* not an active pointer */
  }
}
