import { describe, expect, it } from 'vitest';
import type { PlacedPiece, RoomGeometry } from '../src/engine/types';
import { blocked, integrate, intentFrom, keyCode, nearestFree, spawnPose, standable, type WalkState } from '../src/three/walkMath';
import { freeSpawn, spawnSolids } from '../src/screens/viewer/spawn';

const room: RoomGeometry = {
  width: 5,
  depth: 6,
  height: 2.5,
  door: { wall: 'south', offset: 1.2, width: 0.85, height: 2.03 },
  windows: [],
};

const sofa: PlacedPiece = { id: 'sofa', itemId: 'sofa-3', name: '3-seat sofa', kind: 'sofa', x: 0, z: -2.5, w: 2.2, d: 0.95, h: 0.85, rot: 0, owner: 'seller', verified: false };
const rug: PlacedPiece = { id: 'rug', itemId: 'rug-l', name: 'Rug', kind: 'rug', x: 0, z: 0, w: 2.4, d: 1.7, h: 0.01, rot: 0, owner: 'seller', flat: true, verified: true };

/** Run the walker for `seconds` at 60 fps with a fixed intent. */
function run(st: WalkState, keys: Record<string, boolean>, yaw: number, seconds: number, pieces: PlacedPiece[] = []) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) integrate(st, intentFrom(keys), yaw, dt, 1.5, room, pieces);
  return st;
}

describe('keyCode', () => {
  it('prefers the physical code and falls back to key', () => {
    expect(keyCode({ code: 'KeyW', key: 'w' })).toBe('KeyW');
    expect(keyCode({ code: '', key: 'w' })).toBe('KeyW');
    expect(keyCode({ code: '', key: 'W' })).toBe('KeyW');
    expect(keyCode({ code: '', key: 'KeyS' })).toBe('KeyS');
    expect(keyCode({ code: '', key: 'ArrowUp' })).toBe('ArrowUp');
    expect(keyCode({ code: '', key: 'Shift' })).toBe('ShiftLeft');
  });
});

describe('intentFrom', () => {
  it('reads WASD and arrows', () => {
    expect(intentFrom({ KeyW: true })).toMatchObject({ fwd: 1, strafe: 0 });
    expect(intentFrom({ KeyS: true })).toMatchObject({ fwd: -1, strafe: 0 });
    expect(intentFrom({ ArrowRight: true })).toMatchObject({ fwd: 0, strafe: 1 });
    expect(intentFrom({ KeyA: true })).toMatchObject({ fwd: 0, strafe: -1 });
  });
  it('normalises diagonals and adds the joystick', () => {
    const d = intentFrom({ KeyW: true, KeyD: true });
    expect(Math.hypot(d.fwd, d.strafe)).toBeCloseTo(1, 5);
    expect(intentFrom({}, { x: 0, y: -1 }).fwd).toBe(1);
    expect(intentFrom({}, { x: Number.NaN, y: Number.NaN }).fwd).toBe(0);
  });
});

describe('integrate', () => {
  it('walks north on W from the door at 1.5 m/s', () => {
    const st = run({ x: -1.3, z: 2.3, vx: 0, vz: 0 }, { KeyW: true }, 0, 1);
    expect(st.z).toBeLessThan(2.3 - 1.0);
    expect(st.z).toBeGreaterThan(2.3 - 1.6);
    expect(st.x).toBeCloseTo(-1.3, 5);
  });
  it('walks south on S, east on D, and faster with Shift', () => {
    expect(run({ x: 0, z: 0, vx: 0, vz: 0 }, { KeyS: true }, 0, 1).z).toBeGreaterThan(1);
    expect(run({ x: 0, z: 0, vx: 0, vz: 0 }, { KeyD: true }, 0, 1).x).toBeGreaterThan(1);
    const slow = run({ x: 0, z: 0, vx: 0, vz: 0 }, { KeyW: true }, 0, 1).z;
    const fast = run({ x: 0, z: 0, vx: 0, vz: 0 }, { KeyW: true, ShiftLeft: true }, 0, 1).z;
    expect(fast).toBeLessThan(slow);
  });
  it('moves in the direction faced', () => {
    const st = run({ x: 0, z: 0, vx: 0, vz: 0 }, { KeyW: true }, Math.PI / 2, 1);
    expect(st.x).toBeLessThan(-1); // facing west
    expect(Math.abs(st.z)).toBeLessThan(0.01);
  });
  it('stops at walls and solid furniture but walks over rugs', () => {
    const wall = run({ x: 0, z: -2.5, vx: 0, vz: 0 }, { KeyW: true }, 0, 2);
    expect(wall.z).toBeCloseTo(-3 + 0.25, 1);
    const st = run({ x: 0, z: -0.5, vx: 0, vz: 0 }, { KeyW: true }, 0, 2, [sofa, rug]);
    expect(st.z).toBeGreaterThan(-2.5 + 0.95 / 2 + 0.25 - 0.05);
    const over = run({ x: 0, z: 1.5, vx: 0, vz: 0 }, { KeyW: true }, 0, 1, [rug]);
    expect(over.z).toBeLessThan(0.5);
  });
  it('coasts to a stop when the keys are released', () => {
    const st = run({ x: 0, z: 0, vx: 0, vz: 0 }, { KeyW: true }, 0, 0.5);
    const z1 = st.z;
    run(st, {}, 0, 1);
    expect(st.vz).toBe(0);
    expect(st.z).toBeLessThan(z1);
    expect(st.z).toBeGreaterThan(z1 - 0.4);
  });
});

describe('blocked / standable', () => {
  it('treats the room edge and expanded footprints as blocked', () => {
    expect(blocked(2.2, 0, room, [])).toBe(false);
    expect(blocked(2.3, 0, room, [])).toBe(true);
    expect(blocked(0, -2.5, room, [sofa])).toBe(true);
    expect(blocked(0, -1.5, room, [sofa])).toBe(false);
    expect(blocked(0, 0, room, [rug])).toBe(false);
  });
  it('backs off toward the walker when the target is inside a piece', () => {
    const p = standable(0, -2.5, 0, 0, room, [sofa]);
    expect(p).not.toBeNull();
    expect(p!.z).toBeGreaterThan(-2.5 + 0.95 / 2);
  });

  /* A real capture is not a rectangle: the walk mask is the photographed room and the rectangle is
     the box around it. Clicking the floor seen through a doorway used to land the buyer in the far
     corner *inside* a wall, because a blocked start let the target through unchecked. */
  describe('a glide never crosses a wall the mask knows about', () => {
    // A 2 m wall down the middle of the room, with the walker standing against it.
    const wall = { blocked: (x: number) => Math.abs(x) < 0.35 };

    it('stops at the wall instead of jumping to the far side', () => {
      const p = standable(2, 0, -1.5, 0, room, [], wall);
      expect(p).not.toBeNull();
      expect(p!.x).toBeLessThan(-0.35);
    });

    it('refuses the target when nothing on the way to it is free', () => {
      // The only standable floor is off the line the glide would take.
      const elsewhere = { blocked: (x: number, z: number) => !(x > 1 && z < -1) };
      expect(standable(2, 2, -2, -2, room, [], elsewhere)).toBeNull();
    });

    it('walks a stuck walker out instead of freezing them', () => {
      // Standing inside the mask's wall: every direction reads "blocked", so collision must yield
      // or the buyer is frozen with no way out but a mode switch.
      const st: WalkState = { x: 0, z: 0, vx: 0, vz: 0 };
      const dt = 1 / 60;
      for (let t = 0; t < 1.2; t += dt) integrate(st, intentFrom({ KeyS: true }), 0, dt, 1.5, room, [], wall);
      expect(st.z).toBeGreaterThan(0.5);
      // ...and normal collision comes back the moment they are on free floor again.
      const outside: WalkState = { x: -1, z: 0, vx: 0, vz: 0 };
      for (let t = 0; t < 3; t += dt) integrate(outside, intentFrom({ KeyD: true }), 0, dt, 1.5, room, [], wall);
      expect(outside.x).toBeLessThan(-0.35);
    });

    it('finds the nearest place a walker can actually stand', () => {
      const free = nearestFree(0, 0, room, [], wall, { x: -1.5, z: 0 });
      expect(free).not.toBeNull();
      expect(wall.blocked(free!.x)).toBe(false);
      expect(nearestFree(-2, 0, room, [], wall)).toEqual({ x: -2, z: 0 });
    });
  });
});

/* ---------- where walking starts ---------- */

describe('the walk spawn', () => {
  /** The doorway the shell cut: the plan's, in the middle of the south wall rather than at 1.20 m. */
  const doorway = { wall: 'south' as const, offset: room.width / 2, width: 0.9 };
  /** A sofa parked just inside that doorway. */
  const inTheWay: PlacedPiece = { ...sofa, x: 0, z: 2.2 };

  it('stands in the doorway when the furniture nobody can see is not counted', () => {
    // Staging hidden: the walker collides with nothing, so the spawn is the doorway exactly.
    expect(freeSpawn(room, spawnSolids([inTheWay], false), undefined, doorway)).toEqual(spawnPose(room, doorway));
    // Staging shown: the walker WILL meet the sofa, so the spawn steps around it.
    const shown = freeSpawn(room, spawnSolids([inTheWay], true), undefined, doorway);
    expect(shown).not.toEqual(spawnPose(room, doorway));
    expect(blocked(shown.x, shown.z, room, [inTheWay])).toBe(false);
  });

  it('gives the hidden layer one stable empty array, so a memo on it does not thrash', () => {
    expect(spawnSolids([inTheWay], false)).toBe(spawnSolids([sofa, rug], false));
    expect(spawnSolids([inTheWay], true)).toEqual([inTheWay]);
  });
});
