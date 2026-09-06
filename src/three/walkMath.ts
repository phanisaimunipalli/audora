/**
 * The walker's physics, kept pure so it can be unit-tested without a WebGL context.
 * Metres, radians; yaw 0 looks north (-z). See WalkControls for the input wiring.
 */
import type { PlacedPiece, RoomGeometry } from '@/engine/types';
import { pointInFootprint } from '@/engine/geometry';

/** The walker's collision radius. */
export const WALK_RADIUS = 0.25;

export interface WalkState {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface WalkIntent {
  /** -1..1, forward positive. */
  fwd: number;
  /** -1..1, right positive. */
  strafe: number;
  hurry: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `KeyboardEvent.key` values that carry the same meaning as the codes the walker reads. */
const KEY_TO_CODE: Record<string, string> = {
  w: 'KeyW',
  a: 'KeyA',
  s: 'KeyS',
  d: 'KeyD',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  shift: 'ShiftLeft',
  ' ': 'Space',
};

/**
 * The physical key a keyboard event refers to. Real keyboards fill `code`; some virtual keyboards,
 * IME layers and automation tools only fill `key` (or put the code in `key`), so fall back to that.
 */
export function keyCode(e: Pick<KeyboardEvent, 'code' | 'key'>): string {
  if (e.code) return e.code;
  const k = e.key || '';
  if (/^(Key[A-Z]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space)$/.test(k)) return k;
  return KEY_TO_CODE[k.toLowerCase()] ?? k;
}

/** Turn the pressed keys plus a joystick (x right, y down = backward) into a movement intent. */
export function intentFrom(keys: Record<string, boolean>, joy: { x: number; y: number } = { x: 0, y: 0 }): WalkIntent {
  const kf = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const ks = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const jx = Number.isFinite(joy.x) ? joy.x : 0;
  const jy = Number.isFinite(joy.y) ? joy.y : 0;
  let fwd = kf - jy;
  let strafe = ks + jx;
  const mag = Math.hypot(fwd, strafe);
  if (mag > 1) {
    fwd /= mag;
    strafe /= mag;
  }
  return { fwd, strafe, hurry: Boolean(keys.ShiftLeft || keys.ShiftRight) };
}

export function isMoving(i: WalkIntent): boolean {
  return Math.hypot(i.fwd, i.strafe) > 0.02;
}

/**
 * The walkable floor of a real reconstruction, read off its collider mesh (see `walkMask.ts`).
 * The room rectangle is the collider's *bounding box* and so overstates the photographed room by
 * 15–20%; where a mask is available it is the truth about where the walls are.
 */
export interface WalkBounds {
  blocked(x: number, z: number): boolean;
}

/** Where the walker stands when walk mode starts: just inside the door, facing into the room. */
export function spawnPose(room: RoomGeometry): { x: number; z: number; yaw: number } {
  const d = room.door;
  const inset = 0.7;
  switch (d.wall) {
    case 'south':
      return { x: -room.width / 2 + d.offset, z: room.depth / 2 - inset, yaw: 0 };
    case 'north':
      return { x: -room.width / 2 + d.offset, z: -room.depth / 2 + inset, yaw: Math.PI };
    case 'east':
      return { x: room.width / 2 - inset, z: -room.depth / 2 + d.offset, yaw: Math.PI / 2 };
    case 'west':
      return { x: -room.width / 2 + inset, z: -room.depth / 2 + d.offset, yaw: -Math.PI / 2 };
  }
}

export function blocked(x: number, z: number, room: RoomGeometry, pieces: PlacedPiece[], mask?: WalkBounds | null): boolean {
  if (Math.abs(x) > room.width / 2 - WALK_RADIUS || Math.abs(z) > room.depth / 2 - WALK_RADIUS) return true;
  if (mask?.blocked(x, z)) return true;
  for (const p of pieces) {
    if (p.flat) continue;
    if (pointInFootprint({ x, z }, { x: p.x, z: p.z, w: p.w + WALK_RADIUS * 2, d: p.d + WALK_RADIUS * 2, rot: p.rot })) return true;
  }
  return false;
}

/**
 * The furthest point toward (x,z) the walker can actually reach from (fx,fz) in a straight line.
 *
 * It is not enough for the destination itself to be free: a click on the floor beyond a wall used
 * to land the buyer *outside* the reconstruction, because the target was inside the room rectangle
 * and nothing checked the way there. Marching out from the walker and stopping at the last free
 * point keeps every glide inside the room the photograph shows. Returns null when even the first
 * step is blocked.
 */
export function standable(
  x: number,
  z: number,
  fx: number,
  fz: number,
  room: RoomGeometry,
  pieces: PlacedPiece[],
  mask?: WalkBounds | null,
): { x: number; z: number } | null {
  const cx = clamp(x, -room.width / 2 + WALK_RADIUS + 0.02, room.width / 2 - WALK_RADIUS - 0.02);
  const cz = clamp(z, -room.depth / 2 + WALK_RADIUS + 0.02, room.depth / 2 - WALK_RADIUS - 0.02);
  const dx = cx - fx;
  const dz = cz - fz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return blocked(cx, cz, room, pieces, mask) ? null : { x: cx, z: cz };
  const ux = dx / len;
  const uz = dz / len;
  if (blocked(fx, fz, room, pieces, mask)) {
    // The walker is standing somewhere they should not be (a mask arrived under their feet):
    // the nearest free point on the way to the target is the way out.
    for (let s = 0.1; s <= len; s += 0.1) {
      const px = fx + ux * s;
      const pz = fz + uz * s;
      if (!blocked(px, pz, room, pieces, mask)) return { x: px, z: pz };
    }
    return blocked(cx, cz, room, pieces, mask) ? null : { x: cx, z: cz };
  }
  let best = { x: fx, z: fz };
  for (let s = 0.1; s <= len; s += 0.1) {
    const px = fx + ux * s;
    const pz = fz + uz * s;
    if (blocked(px, pz, room, pieces, mask)) return best;
    best = { x: px, z: pz };
  }
  return blocked(cx, cz, room, pieces, mask) ? best : { x: cx, z: cz };
}

/**
 * One physics step: ease the velocity toward the wanted velocity (in the yaw frame), then move,
 * sliding along whatever blocks each axis. Mutates `st` and returns true when the position changed.
 */
export function integrate(
  st: WalkState,
  intent: WalkIntent,
  yaw: number,
  dt: number,
  speed: number,
  room: RoomGeometry,
  pieces: PlacedPiece[],
  mask?: WalkBounds | null,
): boolean {
  const hurry = intent.hurry ? 1.9 : 1;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // forward is -z in camera space; yaw rotates about +y
  const wantX = (-sin * intent.fwd + cos * intent.strafe) * speed * hurry;
  const wantZ = (-cos * intent.fwd - sin * intent.strafe) * speed * hurry;
  const moving = isMoving(intent);
  const accel = 1 - Math.exp(-dt * (moving ? 9 : 13));
  st.vx += (wantX - st.vx) * accel;
  st.vz += (wantZ - st.vz) * accel;
  if (Math.abs(st.vx) < 0.002) st.vx = 0;
  if (Math.abs(st.vz) < 0.002) st.vz = 0;
  if (!st.vx && !st.vz) return false;
  const x0 = st.x;
  const z0 = st.z;
  const nx = st.x + st.vx * dt;
  const nz = st.z + st.vz * dt;
  if (!blocked(nx, st.z, room, pieces, mask)) st.x = nx;
  else st.vx = 0;
  if (!blocked(st.x, nz, room, pieces, mask)) st.z = nz;
  else st.vz = 0;
  return st.x !== x0 || st.z !== z0;
}
