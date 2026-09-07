import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlacedPiece, RoomGeometry } from '@/engine/types';
import { EYE_HEIGHT_M } from '@/engine/anchor';
import { useViewer, type Pose } from './viewerStore';
import { readJoystick } from './TouchJoystick';
import { colliderProbe } from './splat/colliderProbe';
import { integrate, intentFrom, isMoving, keyCode, nearestFree, spawnPose, standable, type WalkBounds, type WalkState } from './walkMath';

export { blocked, nearestFree, spawnPose, standable } from './walkMath';
export type { WalkBounds } from './walkMath';

export type LookMode = 'drag' | 'pointerLock';

export interface WalkControlsProps {
  room: RoomGeometry;
  /** Solid pieces block movement. */
  pieces?: PlacedPiece[];
  enabled?: boolean;
  eyeHeight?: number;
  /** Where to stand when walk mode starts. Defaults to just inside the door, facing the room. */
  spawn?: Pose;
  /** Walking speed, m/s. Shift multiplies it. */
  speed?: number;
  /** 'drag' (default, Matterport-like) or 'pointerLock' (FPS). Double-click toggles pointer lock in either mode. */
  lookMode?: LookMode;
  /** Allow double-click to enter pointer lock. */
  doubleClickLocks?: boolean;
  /** Click (no drag) on the floor glides there. */
  clickToGlide?: boolean;
  /** Seconds for a glide; scaled up slightly for long hops. */
  glideSeconds?: number;
  /** Seconds to fly from the current camera (e.g. the dollhouse) down to eye height when walk mode starts. 0 cuts. */
  entrySeconds?: number;
  /**
   * The real reconstruction's walkable floor (see `walkMask.ts`). The room rectangle is only the
   * collider's bounding box, so without this the buyer glides straight through the photographed
   * wall into a black void.
   */
  mask?: WalkBounds | null;
  /**
   * The reconstruction's collider mesh, already placed in our metric frame. Used only when `mask` is
   * missing — a mesh that does not enclose the capture point gets no mask — as a direct raycast test
   * against the real walls, so the buyer is never left free to walk out of the photograph.
   */
  collider?: THREE.Object3D | null;
  /** A point known to be inside the walkable floor — the capture point. Used to rescue a spawn, a click or a walker that ends up outside it. */
  home?: { x: number; z: number };
  onArrive?: (pose: Pose) => void;
}

const PITCH_MAX = 1.25;
const DRAG_PX = 5;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * First-person walking at eye height (1.60 m by default; this number is the product's scale claim).
 * Drag to look (mouse or finger), click a spot on the floor to glide there, WASD / arrows to move,
 * Shift to hurry. Double-click for pointer lock; Esc releases. Collides with walls and solid furniture.
 */
export function WalkControls({
  room,
  pieces = [],
  enabled = true,
  eyeHeight = EYE_HEIGHT_M,
  spawn,
  speed = 1.5,
  lookMode = 'drag',
  doubleClickLocks = true,
  clickToGlide = true,
  glideSeconds = 0.6,
  entrySeconds = 0.9,
  mask = null,
  collider = null,
  home,
  onArrive,
}: WalkControlsProps) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const yaw = useRef(0);
  const pitch = useRef(0);
  const targetYaw = useRef(0);
  const targetPitch = useRef(0);
  const pos = useRef(new THREE.Vector3());
  const vel = useRef(new THREE.Vector2());
  const glide = useRef<{ from: THREE.Vector2; to: THREE.Vector2; t0: number; dur: number; yaw?: number; yaw0: number } | null>(null);
  const entry = useRef<{ fromPos: THREE.Vector3; fromQuat: THREE.Quaternion; toQuat: THREE.Quaternion; t0: number; dur: number } | null>(null);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  /* The rasterised mask is the cheap, complete answer; the collider raycast is the net for a
     reconstruction that could not produce one (see splat/colliderProbe). One of them, never both. */
  const probe = useMemo(() => (mask || !collider ? null : colliderProbe(collider)), [mask, collider]);
  const bounds = mask ?? probe;
  const maskRef = useRef(bounds);
  maskRef.current = bounds;
  const homeRef = useRef(home);
  homeRef.current = home;
  const spawnRef = useRef(spawn);
  spawnRef.current = spawn;
  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;
  const setPose = useViewer((s) => s.setPose);
  const setLocked = useViewer((s) => s.setLocked);
  const setGliding = useViewer((s) => s.setGliding);
  const lastPose = useRef<Pose>({ x: 0, z: 0, yaw: 0 });
  const raycaster = useRef(new THREE.Raycaster());
  const floorPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));

  const startGlide = (x: number, z: number, faceYaw?: number) => {
    const dist = Math.hypot(x - pos.current.x, z - pos.current.z);
    if (dist < 0.05 && faceYaw === undefined) return;
    glide.current = {
      from: new THREE.Vector2(pos.current.x, pos.current.z),
      to: new THREE.Vector2(x, z),
      t0: performance.now(),
      dur: (glideSeconds + Math.min(0.5, dist * 0.06)) * 1000,
      yaw: faceYaw,
      yaw0: targetYaw.current,
    };
    setGliding(true);
  };

  /**
   * The nearest spot to (x,z) that is inside the real walls, reached by walking from `from`.
   *
   * Never a point the walker could not walk to: `standable` marches and stops at the last free step,
   * and when the walker is themselves stuck the fallback is a step back toward home, not a jump to
   * the target. A click through an open doorway therefore stops at the doorway, and can never put
   * the buyer inside the photographed wall on the far side of the room.
   */
  const reachable = (x: number, z: number, fromX: number, fromZ: number): { x: number; z: number } | null => {
    const direct = standable(x, z, fromX, fromZ, room, piecesRef.current, maskRef.current);
    if (direct) return direct;
    const h = homeRef.current;
    if (!h) return null;
    return nearestFree(fromX, fromZ, room, piecesRef.current, maskRef.current, h);
  };

  /* Respawn on a *changed* spawn, never on a new object with the same numbers in it. The store
     hands out a fresh room record whenever anything about it is touched (a note, a floor nudge, an
     analytics write), and re-running this effect on that yanks a walking buyer back to the door. */
  const roomRef = useRef(room);
  roomRef.current = room;
  const spawnKey = `${room.width},${room.depth},${room.door.wall},${room.door.offset},${spawn ? `${spawn.x},${spawn.z},${spawn.yaw}` : 'door'}`;

  /* spawn / respawn.
   *
   * Two rules, both learned the hard way:
   *
   * 1. **The camera is placed here, synchronously, never by the frame loop.** The entry tween is a
   *    nicety layered on top; the camera is already standing in the room before the first frame is
   *    drawn. When frames are slow or throttled (a background tab, a software renderer, a 23 MB
   *    splat decoding) the old code left the camera at r3f's default `[4, 3, 6]` — outside the
   *    room, looking at the shell from behind its back faces, which reads as "a black void with
   *    the furniture floating in it".
   * 2. **It runs whether or not input is enabled.** Turning the ruler on unmounts the walker's
   *    input (`enabled = false`) and used to skip placement entirely, so reaching for the ruler in
   *    the first seconds of a room threw the buyer outside it.
   */
  useEffect(() => {
    const room = roomRef.current;
    const spawn = spawnRef.current;
    const want = spawn ?? spawnPose(room);
    const h = homeRef.current;
    // The spawn is computed from the room *rectangle*; on a real reconstruction that is a few
    // centimetres wider than the walk mask, so the capture point itself can read as blocked. Pull
    // it to the nearest spot the buyer can actually stand — and can walk out of.
    const safe = nearestFree(want.x, want.z, room, piecesRef.current, maskRef.current, h ?? null) ?? want;
    const p: Pose = { x: safe.x, z: safe.z, yaw: want.yaw };
    const from = camera.position.clone();
    const fromQuat = camera.quaternion.clone();
    pos.current.set(p.x, eyeHeight, p.z);
    yaw.current = targetYaw.current = p.yaw;
    /* Picking up the ruler re-runs this with the walker exactly where they already stand: that is a
       freeze, not a respawn, so the direction they were looking in — including how far down — is
       left alone. Only a real move levels the view. */
    const standingHere = from.distanceTo(pos.current) < 0.01;
    if (!standingHere) pitch.current = targetPitch.current = 0;
    vel.current.set(0, 0);
    glide.current = null;
    // Stand there now. Whatever happens to the frame loop, the next frame is drawn from eye height.
    camera.position.copy(pos.current);
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix?.();
    const far = from.distanceTo(pos.current) > 0.5;
    if (enabled && far && entrySeconds > 0) {
      // fly down from wherever the camera was (the dollhouse, usually) to eye height at the door
      const toQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, 0, 'YXZ'));
      entry.current = { fromPos: from, fromQuat, toQuat, t0: performance.now(), dur: entrySeconds * 1000 };
      setGliding(true);
    } else {
      entry.current = null;
      setGliding(false);
    }
    lastPose.current = { ...p };
    setPose(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, spawnKey, eyeHeight, camera, setPose, setGliding, entrySeconds]);

  // teleport requests from the HUD / minimap
  useEffect(() => {
    if (!enabled) return;
    return useViewer.subscribe((s, prev) => {
      const t = s.teleport;
      if (!t || t === prev.teleport) return;
      const dest = reachable(t.x, t.z, pos.current.x, pos.current.z);
      if (dest) startGlide(dest.x, dest.z, t.yaw);
      useViewer.getState().clearTeleport();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, room]);

  /**
   * The collider mesh lands a second or two after the walker does, so the real walls can appear
   * under someone already standing outside them. Walk them back in rather than leaving them in the
   * void with nothing but a mode switch to recover.
   */
  useEffect(() => {
    if (!bounds) return;
    const h = home ?? { x: 0, z: 0 };
    if (!bounds.blocked(pos.current.x, pos.current.z)) return;
    const dest = nearestFree(pos.current.x, pos.current.z, room, piecesRef.current, bounds, h) ?? h;
    pos.current.x = dest.x;
    pos.current.z = dest.z;
    glide.current = null;
    vel.current.set(0, 0);
    camera.position.set(dest.x, eyeHeight, dest.z);
    setGliding(false);
    setPose({ x: dest.x, z: dest.z, yaw: wrapAngle(yaw.current) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bounds, home, room, eyeHeight]);

  // input
  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;
    const prevCursor = el.style.cursor;
    const prevTouch = el.style.touchAction;
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';

    const editing = (e: Event) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(t?.isContentEditable);
    };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      if (editing(e)) return;
      const code = keyCode(e);
      keys.current[code] = down;
      if (down && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) e.preventDefault();
      if (down && (code.startsWith('Key') || code.startsWith('Arrow'))) glide.current = null;
    };
    const kd = onKey(true);
    const ku = onKey(false);
    const onBlur = () => {
      keys.current = {};
    };

    // drag-to-look
    let drag: { id: number; x0: number; y0: number; x: number; y: number; moved: boolean; touch: boolean } | null = null;
    const isLocked = () => document.pointerLockElement === el;
    const onDown = (e: PointerEvent) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (isLocked()) return;
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, touch: e.pointerType !== 'mouse' };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > DRAG_PX) drag.moved = true;
      if (!drag.moved) return;
      const k = drag.touch ? 0.0052 : 0.0034;
      // dragging the world: pull left → look right, like Matterport / Street View
      targetYaw.current += dx * k;
      targetPitch.current = THREE.MathUtils.clamp(targetPitch.current + dy * k * 0.9, -PITCH_MAX, PITCH_MAX);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.style.cursor = 'grab';
      if (d.moved || !clickToGlide) return;
      if (useViewer.getState().tool === 'measure') return;
      // a tap: glide to that spot on the floor
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.current.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.current.ray.intersectPlane(floorPlane.current, hit)) return;
      // clicking far above the horizon: walk toward it a sensible distance instead
      const dist = Math.hypot(hit.x - pos.current.x, hit.z - pos.current.z);
      let tx = hit.x;
      let tz = hit.z;
      if (dist > 12) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        tx = pos.current.x + dir.x * 3;
        tz = pos.current.z + dir.z * 3;
      }
      const dest = reachable(tx, tz, pos.current.x, pos.current.z);
      if (dest) startGlide(dest.x, dest.z);
    };
    const onCancel = (e: PointerEvent) => {
      if (drag && drag.id === e.pointerId) drag = null;
      el.style.cursor = 'grab';
    };
    const onDbl = (e: MouseEvent) => {
      if (!doubleClickLocks) return;
      e.preventDefault();
      if (isLocked()) document.exitPointerLock?.();
      else el.requestPointerLock?.();
    };
    const onLockMove = (e: MouseEvent) => {
      if (!isLocked()) return;
      targetYaw.current -= e.movementX * 0.0022;
      targetPitch.current = THREE.MathUtils.clamp(targetPitch.current - e.movementY * 0.0022, -PITCH_MAX, PITCH_MAX);
    };
    const onLock = () => {
      const locked = isLocked();
      setLocked(locked);
      el.style.cursor = locked ? 'none' : 'grab';
    };
    const onContext = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', kd, { capture: true });
    window.addEventListener('keyup', ku, { capture: true });
    window.addEventListener('blur', onBlur);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('contextmenu', onContext);
    document.addEventListener('mousemove', onLockMove);
    document.addEventListener('pointerlockchange', onLock);
    if (lookMode === 'pointerLock') {
      // FPS mode: a plain click grabs the pointer
      const grab = () => {
        if (!isLocked()) el.requestPointerLock?.();
      };
      el.addEventListener('click', grab);
      return () => {
        el.removeEventListener('click', grab);
        cleanup();
      };
    }
    function cleanup() {
      window.removeEventListener('keydown', kd, { capture: true });
      window.removeEventListener('keyup', ku, { capture: true });
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('contextmenu', onContext);
      document.removeEventListener('mousemove', onLockMove);
      document.removeEventListener('pointerlockchange', onLock);
      if (document.pointerLockElement === el) document.exitPointerLock?.();
      setLocked(false);
      keys.current = {};
      el.style.cursor = prevCursor;
      el.style.touchAction = prevTouch;
    }
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, gl, camera, room, lookMode, doubleClickLocks, clickToGlide, setLocked]);

  useFrame((_, rawDt) => {
    if (!enabled) return;
    const dt = Math.min(rawDt, 0.05);
    const k = keys.current;

    const en = entry.current;
    if (en) {
      const t = Math.min(1, (performance.now() - en.t0) / en.dur);
      const e = easeInOut(t);
      camera.position.lerpVectors(en.fromPos, pos.current, e);
      camera.quaternion.slerpQuaternions(en.fromQuat, en.toQuat, e);
      if (t >= 1) {
        entry.current = null;
        camera.position.copy(pos.current);
        camera.rotation.set(0, yaw.current, 0, 'YXZ');
        setGliding(false);
      }
      return;
    }

    // look: ease toward the target so drags and lock feel weighted, never laggy
    const lookK = 1 - Math.exp(-dt * 26);
    yaw.current += wrapAngle(targetYaw.current - yaw.current) * lookK;
    pitch.current += (targetPitch.current - pitch.current) * lookK;

    // move
    const intent = intentFrom(k, readJoystick());
    const moving = isMoving(intent);
    if (moving && glide.current) {
      glide.current = null;
      setGliding(false);
    }

    const g = glide.current;
    if (g) {
      vel.current.set(0, 0);
      const t = Math.min(1, (performance.now() - g.t0) / g.dur);
      const e = easeInOut(t);
      pos.current.x = THREE.MathUtils.lerp(g.from.x, g.to.x, e);
      pos.current.z = THREE.MathUtils.lerp(g.from.y, g.to.y, e);
      if (g.yaw !== undefined) targetYaw.current = g.yaw0 + wrapAngle(g.yaw - g.yaw0) * e;
      if (t >= 1) {
        glide.current = null;
        setGliding(false);
        onArriveRef.current?.({ x: pos.current.x, z: pos.current.z, yaw: yaw.current });
      }
    } else {
      const st: WalkState = { x: pos.current.x, z: pos.current.z, vx: vel.current.x, vz: vel.current.y };
      integrate(st, intent, yaw.current, dt, speed, room, piecesRef.current, maskRef.current);
      pos.current.x = st.x;
      pos.current.z = st.z;
      vel.current.set(st.vx, st.vz);
    }

    camera.position.set(pos.current.x, eyeHeight, pos.current.z);
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    const p = lastPose.current;
    if (Math.abs(p.x - pos.current.x) > 0.015 || Math.abs(p.z - pos.current.z) > 0.015 || Math.abs(wrapAngle(p.yaw - yaw.current)) > 0.01) {
      lastPose.current = { x: pos.current.x, z: pos.current.z, yaw: wrapAngle(yaw.current) };
      setPose(lastPose.current);
    }
  });

  return null;
}
