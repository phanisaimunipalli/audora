import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { RoomGeometry } from '@/engine/types';
import { wallFeaturePosition } from '@/engine/geometry';
import { PHOTO_FOV_MAX, PHOTO_FOV_MIN } from './viewerStore';

export interface OrbitRigProps {
  room: RoomGeometry;
  enabled?: boolean;
  /** Re-frames the camera when this changes. */
  resetKey?: string | number;
  /** Extra azimuth (radians) added to the door-side framing. */
  azimuthOffset?: number;
  /** Fraction of the room bounding sphere to leave as margin. */
  margin?: number;
  /** Tween length for a re-frame, seconds. 0 jumps. */
  duration?: number;
  autoRotate?: boolean;
}

interface Framing {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Camera pose that shows the whole room, three-quarter from the door side, for the given
 * vertical fov and aspect. Uses the room's bounding sphere so any aspect ratio fits.
 */
export function dollhouseFraming(room: RoomGeometry, fovDeg: number, aspect: number, azimuthOffset = 0.42, margin = 1.02): Framing {
  const target = new THREE.Vector3(0, room.height * 0.3, 0);
  const radius = 0.5 * Math.hypot(room.width, room.height * 1.2, room.depth);
  const vfov = THREE.MathUtils.degToRad(fovDeg);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.2, aspect));
  const fit = Math.min(vfov, hfov);
  const dist = (radius / Math.sin(fit / 2)) * margin;
  const d = wallFeaturePosition(room, room.door.wall, room.door.offset);
  const az = Math.atan2(-d.inward.x, -d.inward.z) + azimuthOffset;
  const polar = 0.95; // ~54° from vertical: high enough to read the plan, low enough to see the walls
  const position = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(dist).add(target);
  return { position, target };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Dollhouse view: orbit around the room from above the walls, never below the floor. */
export function OrbitRig({ room, enabled = true, resetKey, azimuthOffset = 0.42, margin = 1.02, duration = 0.7, autoRotate = false }: OrbitRigProps) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useRef<OrbitControlsImpl>(null);
  const anim = useRef<{ from: Framing; to: Framing; t0: number; dur: number } | null>(null);
  const first = useRef(true);
  const span = Math.max(room.width, room.depth);
  const bounds = useMemo(() => ({ x: room.width / 2 + 1, z: room.depth / 2 + 1, y: room.height }), [room]);

  useEffect(() => {
    if (!enabled) return;
    const cam = camera as THREE.PerspectiveCamera;
    const framing = dollhouseFraming(room, cam.fov ?? 55, size.width / Math.max(1, size.height), azimuthOffset, margin);
    const c = controls.current;
    cam.up.set(0, 1, 0);
    // First frame ever: jump. Afterwards (room change, resetKey, or coming back from walk mode) tween from wherever the camera is.
    if (first.current || duration <= 0 || !c) {
      first.current = false;
      cam.position.copy(framing.position);
      if (c) {
        c.target.copy(framing.target);
        c.update();
      } else {
        cam.lookAt(framing.target);
      }
      cam.updateProjectionMatrix();
      anim.current = null;
      return;
    }
    anim.current = { from: { position: cam.position.clone(), target: c.target.clone() }, to: framing, t0: performance.now(), dur: duration };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, room, resetKey, camera, azimuthOffset, margin]);

  useFrame(() => {
    const c = controls.current;
    if (!enabled || !c) return;
    const a = anim.current;
    if (a) {
      const t = Math.min(1, (performance.now() - a.t0) / (a.dur * 1000));
      const k = easeInOut(t);
      camera.position.lerpVectors(a.from.position, a.to.position, k);
      c.target.lerpVectors(a.from.target, a.to.target, k);
      if (t >= 1) anim.current = null;
    }
    // keep the pivot inside the house and the camera above the floor
    c.target.x = THREE.MathUtils.clamp(c.target.x, -bounds.x, bounds.x);
    c.target.z = THREE.MathUtils.clamp(c.target.z, -bounds.z, bounds.z);
    c.target.y = THREE.MathUtils.clamp(c.target.y, 0.2, bounds.y);
    if (camera.position.y < 0.25) camera.position.y = 0.25;
    c.update();
  });

  if (!enabled) return null;
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.65}
      zoomSpeed={0.8}
      minDistance={1.6}
      maxDistance={span * 4}
      maxPolarAngle={Math.PI / 2 - 0.06}
      minPolarAngle={0.12}
      enablePan
      panSpeed={0.6}
      screenSpacePanning={false}
      autoRotate={autoRotate}
      autoRotateSpeed={0.5}
      onStart={() => {
        anim.current = null;
      }}
    />
  );
}

/* ------------------------------------------------------------------ photo view */

export interface PhotoRigProps {
  /** The capture point in Audora's metric frame — the Marble group's `position`. */
  origin: [number, number, number];
  enabled?: boolean;
  /** Facing at entry, radians, 0 = along −z (the reconstruction's own forward). */
  initialYaw?: number;
  /** Vertical field of view in degrees. The wheel changes it between 40 and 90. */
  fov?: number;
  onFov?: (fov: number) => void;
  /** Drift slowly around the capture point until the first pointer down. */
  drift?: boolean;
  /** Degrees per second of drift. */
  driftSpeed?: number;
  /** Re-centres the camera when this changes (room switch). */
  resetKey?: string | number;
}

/** How far the camera sits from its own pivot. Small enough that looking around is a pure rotation. */
const PIVOT = 0.01;

/**
 * Photo view: the camera stands exactly where the photographer stood — the Marble capture point
 * mapped into our metric frame — and can only look around. Drag turns the world (OrbitControls with
 * pan and zoom off, negative rotate speed, pivot 1 cm ahead of the lens), the wheel changes the
 * field of view instead of moving, and until the first touch the view drifts slowly so a still
 * screenshot reads as alive. Because the camera never leaves the capture point, the panorama stays
 * parallax-free and looks like the photograph it is.
 */
export function PhotoRig({ origin, enabled = true, initialYaw = 0, fov = 78, onFov, drift = true, driftSpeed = 2.6, resetKey }: PhotoRigProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const [touched, setTouched] = useState(false);
  const fovRef = useRef(fov);
  fovRef.current = fov;
  const onFovRef = useRef(onFov);
  onFovRef.current = onFov;
  const ox = origin[0];
  const oy = origin[1];
  const oz = origin[2];

  // Stand at the capture point looking along −z (turned by initialYaw). The camera sits PIVOT
  // behind its target so OrbitControls' orbit is, to the viewer, a turn of the head.
  useEffect(() => {
    if (!enabled) return;
    const cam = camera as THREE.PerspectiveCamera;
    const look = new THREE.Vector3(-Math.sin(initialYaw), 0, -Math.cos(initialYaw));
    cam.up.set(0, 1, 0);
    cam.position.set(ox - look.x * PIVOT, oy - look.y * PIVOT, oz - look.z * PIVOT);
    const c = controls.current;
    if (c) {
      c.target.set(ox, oy, oz);
      c.update();
    } else {
      cam.lookAt(ox, oy, oz);
    }
    setTouched(false);
    invalidate();
  }, [enabled, ox, oy, oz, initialYaw, camera, resetKey, invalidate]);

  // Keep the pivot pinned to the capture point and apply the fov the store holds.
  useEffect(() => {
    if (!enabled) return;
    const cam = camera as THREE.PerspectiveCamera;
    if (!('fov' in cam)) return;
    cam.fov = THREE.MathUtils.clamp(fov, PHOTO_FOV_MIN, PHOTO_FOV_MAX);
    cam.updateProjectionMatrix();
    invalidate();
  }, [enabled, fov, camera, invalidate]);

  /**
   * Zoom changes the LENS, never the position — you cannot step forward inside a photograph. The
   * wheel does it on a desktop and a two-finger pinch does it on a phone, which is what the buyer's
   * welcome card promises there. OrbitControls has both pan and dolly switched off, so two fingers
   * are ours to read.
   */
  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;
    /**
     * Photo view owns the gestures on this canvas. Without this, mobile Safari and Chrome treat the
     * two-finger pinch as a page zoom and the first millimetres of a drag as a page pan, so the
     * "drag to look around · pinch to zoom" the welcome card promises never reaches the handlers
     * below. Walk mode does the same thing (WalkControls); the previous value is put back on the way
     * out so neither mode leaves the page unscrollable.
     */
    const prevTouch = el.style.touchAction;
    el.style.touchAction = 'none';
    const setFov = (next: number) => {
      const v = THREE.MathUtils.clamp(next, PHOTO_FOV_MIN, PHOTO_FOV_MAX);
      if (v === fovRef.current) return;
      fovRef.current = v;
      onFovRef.current?.(v);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setFov(fovRef.current + Math.sign(e.deltaY) * 3);
    };
    const fingers = new Map<number, { x: number; y: number }>();
    let spread = 0;
    const measure = () => {
      const [a, b] = [...fingers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const onDown = (e: PointerEvent) => {
      setTouched(true);
      if (e.pointerType !== 'touch') return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) spread = measure();
    };
    const onMove = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size !== 2 || !spread) return;
      const now = measure();
      // Fingers apart = zoom in = a narrower lens. Scaled by the canvas so it feels the same on any screen.
      setFov(fovRef.current - ((now - spread) / Math.max(1, el.clientHeight)) * 120);
      spread = now;
    };
    const onLift = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (fingers.size < 2) spread = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onLift);
    el.addEventListener('pointercancel', onLift);
    return () => {
      el.style.touchAction = prevTouch;
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onLift);
      el.removeEventListener('pointercancel', onLift);
    };
  }, [enabled, gl]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!enabled || !c) return;
    if (drift && !touched) {
      // Rotate the tiny camera→pivot offset about y; OrbitControls reads it back next update().
      const a = THREE.MathUtils.degToRad(driftSpeed) * Math.min(dt, 0.05);
      const dx = camera.position.x - c.target.x;
      const dz = camera.position.z - c.target.z;
      camera.position.x = c.target.x + dx * Math.cos(a) - dz * Math.sin(a);
      camera.position.z = c.target.z + dx * Math.sin(a) + dz * Math.cos(a);
    }
    c.target.set(ox, oy, oz);
    c.update();
  });

  if (!enabled) return null;
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableZoom={false}
      enableDamping
      dampingFactor={0.12}
      rotateSpeed={-0.32}
      minDistance={PIVOT}
      maxDistance={PIVOT}
      minPolarAngle={0.06}
      maxPolarAngle={Math.PI - 0.06}
      target={[ox, oy, oz]}
      onStart={() => setTouched(true)}
    />
  );
}
