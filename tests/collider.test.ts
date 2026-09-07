/**
 * The wall band: measuring a real room out of a reconstruction that also contains the street.
 *
 * Marble's collider is everything the model rebuilt, windows included, so its bounding box is not
 * the room — on the demo corner room it is 41 % too big. These tests drive `colliderGeometry` with
 * synthetic point sets where the answer is known exactly, including the case that breaks a naive
 * box: a room with a window the model saw a building through.
 */
import { describe, expect, it } from 'vitest';
import {
  colliderGeometry,
  extentMethodOf,
  fitWallRect,
  rawFromBounds,
  rawFromBoundsOr,
  roomExtent,
  roomRect,
  splatTransform,
  wallBandProfile,
  type WorldBounds,
} from '../src/services/marble';
import { anchorFromCeiling, applyScale, CEILING_HEIGHT_M } from '../src/engine/anchor';
import type { RawGeometry } from '../src/engine/types';

interface RoomSpec {
  /** Room size in raw units. */
  w: number;
  d: number;
  /** Where the room's centre sits relative to the capture point, which is always the origin. */
  cx?: number;
  cz?: number;
  /** Yaw of the room relative to the raw axes, radians. */
  yaw?: number;
  floor?: number;
  ceiling?: number;
  /**
   * A window in the +z wall, as a span in the room's own x. Instead of the wall, the reconstruction
   * put whatever it saw through the glass `times` further along the same line of sight — exactly
   * what Marble does with a real window, and what makes its bounding box the street.
   */
  window?: { from: number; to: number; times?: number };
  samples?: number;
}

/** A rectangular room as a collider would carry it: four walls, a floor slab and a ceiling slab. */
function roomPoints(spec: RoomSpec): number[] {
  const { w, d, cx = 0, cz = 0, yaw = 0, floor = -1.6, ceiling = 1.8, window: win, samples = 120 } = spec;
  const out: number[] = [];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const put = (u: number, v: number, y: number, times = 1) =>
    out.push((cx + u * c - v * s) * times, y, (cz + u * s + v * c) * times);
  const levels = 16;
  for (let k = 0; k <= levels; k++) {
    const y = floor + ((ceiling - floor) * k) / levels;
    for (let i = 0; i <= samples; i++) {
      const u = -w / 2 + (w * i) / samples;
      const v = -d / 2 + (d * i) / samples;
      const inWindow = win && u > win.from && u < win.to && y > floor + 0.9 && y < ceiling - 0.3;
      // The far wall: real, except where the model looked through the glass and rebuilt the street.
      put(u, d / 2, y, inWindow ? (win!.times ?? 8) : 1);
      put(u, -d / 2, y);
      put(w / 2, v, y);
      put(-w / 2, v, y);
    }
  }
  const grid = 48;
  for (let i = 0; i <= grid; i++) {
    for (let j = 0; j <= grid; j++) {
      const u = -w / 2 + (w * i) / grid;
      const v = -d / 2 + (d * j) / grid;
      put(u, v, floor);
      put(u, v, ceiling);
    }
  }
  return out;
}

describe('colliderGeometry', () => {
  it('finds the floor and ceiling slabs, not the stray lowest vertex', () => {
    const pts = roomPoints({ w: 4, d: 5, cx: -0.8, cz: -1.7, floor: -1.6, ceiling: 1.8 });
    pts.push(0.2, -1.72, 0.3); // a skirt below the floor, like the demo draft world's
    const b = colliderGeometry(pts);
    expect(b.minY).toBeCloseTo(-1.72, 2);
    expect(b.floorY).toBeCloseTo(-1.6, 1);
    expect(b.ceilingY).toBeCloseTo(1.8, 1);
  });

  it('measures the room to its walls, not to what the model saw through the window', () => {
    const spec: RoomSpec = { w: 4, d: 5, cx: -0.8, cz: -1.7, window: { from: -0.6, to: 1.4 } };
    const b = colliderGeometry(roomPoints(spec));

    // The bounding box swallowed the street outside: several times the room, in both directions.
    const boxArea = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    expect(boxArea).toBeGreaterThan(4 * 4 * 5);
    expect(b.method).toBe('walls');
    const walls = b.walls!;
    expect(walls.maxX - walls.minX).toBeCloseTo(4, 1);
    expect(walls.maxZ - walls.minZ).toBeCloseTo(5, 1);
    // Capture-relative: the capture point is inside, at the offset it was placed at.
    expect(walls.maxX).toBeCloseTo(1.2, 1);
    expect(walls.minZ).toBeCloseTo(-4.2, 1);
    expect(walls.minX).toBeLessThan(0);
    expect(walls.maxZ).toBeGreaterThan(0);
    expect(walls.rotation).toBeLessThan(0.1);
    expect(walls.score ?? 0).toBeGreaterThan(0.6);
  });

  it('measures a room that is at 45° to the capture, where the box is 41% too big', () => {
    // The demo corner room: the photographer faced a corner, so the reconstruction's axes are not
    // the room's. The box is then the room's diagonal; the wall band is still the room.
    const b = colliderGeometry(roomPoints({ w: 4, d: 5, yaw: Math.PI / 4, cx: -0.4, cz: -1.2 }));
    expect(b.method).toBe('walls');
    const walls = b.walls!;
    const sides = [walls.maxX - walls.minX, walls.maxZ - walls.minZ].sort((x, y) => x - y);
    expect(sides[0]).toBeCloseTo(4, 0);
    expect(sides[1]).toBeCloseTo(5, 0);
    // The box it replaces is the diagonal of that room — a third bigger in each direction.
    expect(b.maxX - b.minX).toBeGreaterThan(6);
    expect((b.maxX - b.minX) * (b.maxZ - b.minZ)).toBeGreaterThan(1.3 * sides[0] * sides[1]);
    expect(walls.rotation).toBeGreaterThan(0.6); // ~45°, recorded so the orientation is not implied
  });

  it('says nothing rather than something wrong when the mesh is not a rectangular room', () => {
    // A round mesh (a stairwell, a bay) agrees with no rectangle: the box is the honest answer.
    const pts: number[] = [];
    for (let k = 0; k <= 16; k++) {
      const y = -1.6 + (3.4 * k) / 16;
      for (let a = 0; a < 720; a++) {
        const t = (a * Math.PI) / 360;
        pts.push(3 * Math.cos(t), y, 3 * Math.sin(t));
      }
    }
    for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) pts.push(-3 + (6 * i) / 40, -1.6, -3 + (6 * j) / 40);
    const b = colliderGeometry(pts);
    expect(b.method).toBe('aabb');
    expect(b.walls).toBeUndefined();
  });

  it('is unbothered by a mesh with nothing in it', () => {
    expect(() => colliderGeometry([])).toThrow();
    const b = colliderGeometry([0, 0, 0, 1, 1, 1]);
    expect(b.method).toBe('aabb');
    expect(b.maxX).toBe(1);
  });
});

describe('wallBandProfile', () => {
  it('traces the room and leaves no evidence where the mesh has none', () => {
    const prof = wallBandProfile(roomPoints({ w: 4, d: 4 }), -1, 1);
    expect(prof).toHaveLength(360);
    // A square room 4 units across, seen from its centre: 2 units to a wall, 2.83 to a corner.
    expect(prof[0]).toBeCloseTo(2, 1);
    expect(prof[90]).toBeCloseTo(2, 1);
    expect(prof[45]).toBeCloseTo(Math.SQRT2 * 2, 0);
    const empty = wallBandProfile([0, 0, 0], 5, 6);
    expect(empty.every((d) => !Number.isFinite(d))).toBe(true);
    expect(fitWallRect(empty)).toBeNull();
  });
});

describe('rawFromBounds', () => {
  const withWindow = colliderGeometry(roomPoints({ w: 4, d: 5, cx: -0.8, cz: -1.7, window: { from: -0.6, to: 1.4 } }));

  it('takes the room from the wall rectangle and the ceiling from the box', () => {
    const raw = rawFromBounds(withWindow);
    expect(raw.width).toBeCloseTo(4, 1);
    expect(raw.depth).toBeCloseTo(5, 1);
    expect(raw.height).toBeCloseTo(withWindow.maxY - withWindow.minY, 6);
  });

  it('puts the door where the photographer stood, on the wall behind them', () => {
    const raw = rawFromBounds(withWindow);
    expect(raw.door.wall).toBe('south');
    // Raw +x is our EAST (the frame is `(x, z) → (x, −z)`, not a 180° turn — see roomRect), so the
    // capture point stands 2.8 units from the WEST wall and the door is that far along the south
    // wall. Equivalently: the door is directly under the photographer.
    expect(raw.door.offset).toBeCloseTo(-withWindow.walls!.minX, 3);
    expect(raw.door.offset).toBeCloseTo(2.8, 1);
    expect(raw.door.offset).toBeGreaterThan(0);
    expect(raw.door.offset).toBeLessThan(raw.width);
  });

  it('turns the gap the model looked through into a window on that wall', () => {
    const raw = rawFromBounds(withWindow);
    expect(raw.windows).toHaveLength(1);
    const win = raw.windows[0];
    // The window is in the wall the photographer faced (raw +z), which is our north wall.
    expect(win.wall).toBe('north');
    expect(win.width).toBeGreaterThan(0.8);
    // The gap spans the room's own x from −0.6 to 1.4, i.e. raw x −1.4 to 0.6, i.e. 1.4 to 3.4
    // along the north wall from its west end.
    expect(win.offset).toBeCloseTo(2.4, 1);
    expect(win.offset).toBeGreaterThan(win.width / 2);
    expect(win.offset + win.width / 2).toBeLessThanOrEqual(raw.width);
    // A plausible sill: 0.90 m of a 2.44 m ceiling, in the reconstruction's own units.
    const ceilingUnits = withWindow.ceilingY! - withWindow.floorY!;
    expect(win.sill).toBeCloseTo((0.9 / CEILING_HEIGHT_M) * ceilingUnits, 2);
    expect(win.sill + win.height).toBeLessThan(raw.height);
  });

  it('falls back to the bounding box when there is no wall rectangle', () => {
    const box: WorldBounds = { minX: -3.6, maxX: 4.2, minY: -1.66, maxY: 1.89, minZ: -1.55, maxZ: 5.78 };
    const raw = rawFromBounds(box);
    expect(raw.width).toBeCloseTo(7.8, 3);
    expect(raw.depth).toBeCloseTo(7.33, 2);
    // Under the photographer again: 3.6 units from the west end of a 7.8 m wall.
    expect(raw.door.offset).toBeCloseTo(3.6, 3);
    expect(raw.windows).toEqual([]);
  });
});

/** The demo corner room, as `fetchColliderGeometry` reads its 76k-vertex collider. */
const CORNER: WorldBounds = {
  minX: -3.5989,
  maxX: 4.233,
  minY: -1.6597,
  maxY: 1.8928,
  minZ: -1.552,
  maxZ: 5.7774,
  floorY: -1.5953,
  ceilingY: 1.8239,
  method: 'walls',
  walls: { minX: -0.85, maxX: 3.5236, minZ: -1.2867, maxZ: 4.6218, rotation: 0.8203, score: 0.8 },
};

describe('the demo corner room', () => {
  const raw = rawFromBounds(CORNER);
  const anchor = anchorFromCeiling(raw);
  const g = applyScale(raw, anchor.metresPerUnit);

  it('is a room, not a bounding box: 3.0 × 4.1 m instead of 5.4 × 5.0 m', () => {
    // Measured against the mesh's own wall planes (the dominant peaks in a histogram of the wall
    // band's projections, 4.40 and 5.87 raw units apart), this is inside 1%.
    expect(g.width).toBeCloseTo(3.0, 1);
    expect(g.depth).toBeCloseTo(4.06, 1);
    expect(g.width * g.depth).toBeLessThan(13);
    // What it used to report, from the bounding box:
    const box = applyScale(rawFromBounds({ ...CORNER, walls: undefined, method: 'aabb' }), anchor.metresPerUnit);
    expect(box.width * box.depth).toBeGreaterThan(2 * g.width * g.depth);
  });

  it('keeps the assumed-ceiling anchor: the height and the scale do not move', () => {
    expect(g.height).toBeCloseTo(CEILING_HEIGHT_M, 2);
    expect(anchor.metresPerUnit).toBeCloseTo(0.6869, 3);
    expect(anchor.method).toBe('ceiling');
  });

  it('leaves the photographer standing in the room, near the wall they came through', () => {
    const t = splatTransform({ metricScaleFactor: null, groundPlaneOffset: null, bounds: CORNER }, anchor.metresPerUnit);
    expect(Math.abs(t.position[0])).toBeLessThan(g.width / 2);
    expect(Math.abs(t.position[2])).toBeLessThan(g.depth / 2);
    // The door is on the south wall under them: the same projection, from the same rectangle.
    expect(g.door.offset).toBeCloseTo(t.position[0] + g.width / 2, 2);
    expect(g.depth / 2 - t.position[2]).toBeLessThan(1.2); // ...and the south wall is right behind
  });
});

describe('splatTransform with a wall rectangle', () => {
  const mpu = 0.6869;
  const boxOnly: WorldBounds = { ...CORNER, walls: undefined, method: 'aabb' };

  it('does not move the floor', () => {
    const withWalls = splatTransform({ metricScaleFactor: null, groundPlaneOffset: null, bounds: CORNER }, mpu);
    const withBox = splatTransform({ metricScaleFactor: null, groundPlaneOffset: null, bounds: boxOnly }, mpu);
    expect(withWalls.position[1]).toBeCloseTo(withBox.position[1], 9);
    expect(withWalls.position[1]).toBeCloseTo(-CORNER.floorY! * mpu, 6);
    expect(withWalls.scale).toBeCloseTo(withBox.scale, 9);
    // The wall rectangle does turn the capture — that is the point of measuring it — by the room's
    // own 47°, folded into the group as `π + yaw`. The bounding box has no orientation to recover.
    expect(withBox.rotationY).toBeCloseTo(Math.PI, 9);
    expect(withWalls.yaw).toBeCloseTo(Math.PI / 2 - CORNER.walls!.rotation, 9);
    expect(withWalls.rotationY).toBeCloseTo(Math.PI + withWalls.yaw, 9);
  });

  it('turns and centres the room without moving anything relative to the capture point', () => {
    const withWalls = splatTransform({ metricScaleFactor: null, groundPlaneOffset: null, bounds: CORNER }, mpu);
    const withBox = splatTransform({ metricScaleFactor: null, groundPlaneOffset: null, bounds: boxOnly }, mpu);
    // The map every real layer obeys: p_world = position + s · Ry(yaw) · diag(1, −1, −1) · p_raw.
    // `bounds` are in the collider's delivered frame, whose y is already flipped, so here it is
    // `(x, y, −z)` — the same map, read in the frame the numbers below are written in.
    const map = (t: typeof withWalls, p: [number, number, number]): [number, number, number] => {
      const x = p[0] * t.scale;
      const y = p[1] * t.scale;
      const z = -p[2] * t.scale;
      return [x * Math.cos(t.yaw) + z * Math.sin(t.yaw) + t.position[0], y + t.position[1], -x * Math.sin(t.yaw) + z * Math.cos(t.yaw) + t.position[2]];
    };
    const from = (t: typeof withWalls, p: [number, number, number]) => {
      const q = map(t, p);
      return Math.hypot(q[0] - t.position[0], q[1] - t.position[1], q[2] - t.position[2]);
    };
    // Everything the buyer can see keeps the same relationship to the capture point: both frames are
    // isometries of the same reconstruction, so measuring it is free.
    for (const p of [[1.2, CORNER.floorY!, 2.5], [-3, 1.5, 4]] as [number, number, number][]) {
      expect(from(withWalls, p)).toBeCloseTo(from(withBox, p), 9);
    }
    // The mesh's floor plane lands on ours either way.
    expect(map(withWalls, [0, CORNER.floorY!, 0])[1]).toBeCloseTo(0, 9);
    // ...and the wall rectangle's corners land exactly on the metric room's corners, which is the
    // point: the photographed walls ARE the walls a sofa can stand against.
    const rect = roomRect(CORNER)!;
    const g = rawFromBounds(CORNER);
    expect(withWalls.position[0] + rect.minX * mpu).toBeCloseTo((-g.width / 2) * mpu, 6);
    expect(withWalls.position[0] + rect.maxX * mpu).toBeCloseTo((g.width / 2) * mpu, 6);
    expect(withWalls.position[2] + rect.minZ * mpu).toBeCloseTo((-g.depth / 2) * mpu, 6);
    expect(withWalls.position[2] + rect.maxZ * mpu).toBeCloseTo((g.depth / 2) * mpu, 6);
  });
});

/** The full-quality demo world, as read from its collider. */
const FLAT_BOUNDS: WorldBounds = {
  minX: -2.2447,
  maxX: 2.5201,
  minY: -0.7308,
  maxY: 0.6125,
  minZ: -3.1248,
  maxZ: 2.7291,
  floorY: -0.6544,
  ceilingY: 0.5864,
  method: 'walls',
  walls: { minX: -1.3117, maxX: 1.6221, minZ: -3.0299, maxZ: 2.2875, rotation: 1.2043, score: 0.72 },
};

describe('rawFromBoundsOr', () => {
  const fallback: RawGeometry = {
    width: 2.473,
    depth: 1.798,
    height: 1.214,
    door: { wall: 'south', offset: 1.236, width: 0.387, height: 0.913 },
    windows: [],
    doorHeightUnits: 0.913,
    outletHeightUnits: 0.135,
  };

  it('keeps a wall rectangle that describes one room', () => {
    const raw = rawFromBoundsOr(CORNER, 0.6869, fallback);
    expect(raw).not.toBe(fallback);
    expect(applyScale(raw, 0.6869).width).toBeCloseTo(3.0, 1);
  });

  it('marks the bounds as a bounding box when the estimate wins, so the placement follows', () => {
    // Extent and placement must come from one rectangle. When the wall rectangle is not this room,
    // `splatTransform` must not centre the room on it either — or the reconstruction slides.
    const flat = FLAT_BOUNDS;
    const e = roomExtent(flat, 2.2239592, fallback);
    expect(e.raw).toBe(fallback);
    expect(e.method).toBe('estimate');
    expect(extentMethodOf(e.bounds)).toBe('aabb');
    expect(e.bounds?.walls).toBeDefined(); // kept on the record, just not used as the room
    const placed = splatTransform({ metricScaleFactor: 2.2239592, groundPlaneOffset: null, bounds: e.bounds }, 1);
    const box = splatTransform({ metricScaleFactor: 2.2239592, groundPlaneOffset: null, bounds: { ...flat, walls: undefined } }, 1);
    expect(placed.position[0]).toBeCloseTo(box.position[0], 9);
    expect(placed.position[2]).toBeCloseTo(box.position[2], 9);
    // ...and the room it reports is the box's too, so nothing is sized from one and placed on another.
    expect(rawFromBounds(e.bounds!).width).toBeCloseTo(flat.maxX - flat.minX, 6);
  });

  it('keeps the wall rectangle for a room the extent came from', () => {
    const e = roomExtent(CORNER, 0.6869, fallback);
    expect(e.method).toBe('walls');
    expect(e.bounds).toBe(CORNER);
  });

  it('rejects a wall rectangle that describes a whole flat', () => {
    // The full-quality demo world: its wall band is a real measurement of a real open-plan space,
    // 6.5 × 11.8 m. That is a flat, not a living room, so the caller's estimate stands.
    expect(rawFromBoundsOr(FLAT_BOUNDS, 2.2239592, fallback)).toBe(fallback);
  });
});
