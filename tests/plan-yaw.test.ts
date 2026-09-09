/**
 * Yawing a room's world onto plan north — the last row of docs/ACCURACY.md section 1
 * ("orientation error ... versus the plan's north arrow") and section 3.3's "each room world
 * oriented to plan north".
 *
 * A capture knows which way its own walls run and nothing else. Which of those walls is the room's
 * north, and where north is, come from the floor plan: `matchPortals().quarters` and
 * `UnitRoom.yawToNorth`. Both are folded into the ONE turn `splatTransform` gives the Marble group,
 * so this file is the contract that the fold is in exactly one place and composes with the two
 * modules that consume it — `shared/unitGraph`, which decides which wall a plan door is on, and
 * `UnitMap`, which draws the renter on the sheet.
 *
 * Pure arithmetic throughout: no world, no network, no clock.
 */
import { describe, expect, it } from 'vitest';
import { headingAfterYaw, planYaw, QUARTER_TURN, splatTransform, type WorldBounds } from '../src/services/marble';
import { captureYaw, marbleFrame } from '../src/three/splat/frame';
import { poseOnSheet } from '../src/screens/viewer/UnitMap';
import {
  arrivalPose,
  buildUnitGraph,
  foldWall,
  matchPortals,
  normaliseYaw,
  roomOf,
  type UnitGraph,
  type UnitPlanInput,
  type UnitRoom,
} from '../shared/unitGraph';
import { roomRect } from '../shared/collider';
import type { WallSide } from '../src/engine/types';

const DEG = Math.PI / 180;

/**
 * The demo corner room's collider, wall rectangle and all (raw units, y up as delivered). Its walls
 * sit 47° off Marble's axes because the photographer faced a corner, which `roomRect` recovers as a
 * 43° turn of the room — the number every case below is measured against.
 */
const CORNER: WorldBounds = {
  minX: -0.85,
  maxX: 3.5236,
  minY: -1.66,
  maxY: 1.8928,
  minZ: -1.2867,
  maxZ: 4.6218,
  floorY: -1.5953,
  walls: { minX: -0.85, maxX: 3.5236, minZ: -1.2867, maxZ: 4.6218, rotation: 0.8203, score: 0.8 },
  method: 'walls',
};
/** Metres per raw unit, from the room's assumed-ceiling anchor. */
const MPU = 0.6868;
const WORLD = { metricScaleFactor: null, groundPlaneOffset: null, bounds: CORNER };

/** `Ry(a)` on the floor plane — the same turn the Marble group applies. */
const turn = (x: number, z: number, a: number) => ({ x: x * Math.cos(a) + z * Math.sin(a), z: z * Math.cos(a) - x * Math.sin(a) });

/** A point of the fitted rectangle (raw units, capture frame) where it lands in the metric room. */
function inRoom(t: ReturnType<typeof splatTransform>, rx: number, rz: number) {
  const p = turn(rx, rz, t.planYaw);
  return { x: t.position[0] + t.scale * p.x, z: t.position[2] + t.scale * p.z };
}

/** The middle of one wall of the fitted rectangle, in the capture's own frame. */
function wallMidpoint(wall: WallSide) {
  const r = roomRect(CORNER)!;
  const midX = (r.minX + r.maxX) / 2;
  const midZ = (r.minZ + r.maxZ) / 2;
  switch (wall) {
    case 'north':
      return { x: midX, z: r.minZ };
    case 'south':
      return { x: midX, z: r.maxZ };
    case 'east':
      return { x: r.maxX, z: midZ };
    case 'west':
      return { x: r.minX, z: midZ };
  }
}

/** Radians, compared the way angles have to be compared. */
const sameAngle = (a: number, b: number, places = 9) => expect(normaliseYaw(a - b)).toBeCloseTo(0, places);

describe('the plan yaw', () => {
  it('is nothing at all without a plan', () => {
    expect(planYaw(undefined)).toBe(0);
    expect(planYaw(null)).toBe(0);
    expect(planYaw({})).toBe(0);
    // A parser that answers with nulls or nonsense is a plan that says nothing, not a room turned by NaN.
    expect(planYaw({ quarters: null, yawToNorth: null })).toBe(0);
    expect(planYaw({ quarters: Number.NaN, yawToNorth: Number.NaN })).toBe(0);
    expect(planYaw(0)).toBe(0);
    expect(planYaw(Number.NaN)).toBe(0);
  });

  it('takes a turn it has already worked out, unchanged', () => {
    // What lets a component fold the two terms once and hand the number back down.
    for (const plan of [{ quarters: 1 }, { quarters: 3, yawToNorth: -30 * DEG }, { yawToNorth: 1.1 }]) {
      const once = planYaw(plan);
      expect(planYaw(once)).toBe(once);
      expect(splatTransform(WORLD, MPU, 0, once)).toEqual(splatTransform(WORLD, MPU, 0, plan));
    }
  });

  it('adds the north arrow as the graph states it and subtracts the quarter turn', () => {
    // `yawToNorth` is already "radians to turn this room's world by", so it goes in as it stands.
    sameAngle(planYaw({ yawToNorth: -30 * DEG }), -30 * DEG);
    // The quarter turn runs the other way: `toUnitPose` turns a pose +q onto the sheet, so turning
    // the room's content the same way is Ry(−q·π/2).
    sameAngle(planYaw({ quarters: 1 }), -QUARTER_TURN);
    sameAngle(planYaw({ quarters: 3 }), QUARTER_TURN);
    sameAngle(planYaw({ quarters: 1, yawToNorth: -30 * DEG }), -120 * DEG);
    // Out-of-range and negative quarters are the same four turns.
    sameAngle(planYaw({ quarters: 5 }), planYaw({ quarters: 1 }));
    sameAngle(planYaw({ quarters: -1 }), planYaw({ quarters: 3 }));
  });
});

describe('the room yaw the Marble group carries', () => {
  it('is the collider rectangle alone for a room with no plan', () => {
    const t = splatTransform(WORLD, MPU);
    expect((t.rectYaw * 180) / Math.PI).toBeCloseTo(43, 1);
    expect(t.yaw).toBe(t.rectYaw);
    expect(t.planYaw).toBe(0);
    expect(t.rotationY).toBeCloseTo(Math.PI + t.rectYaw, 12);
    // Passing "no plan" in any of its shapes is passing nothing: the same transform, field for field.
    expect(splatTransform(WORLD, MPU, 0, undefined)).toEqual(t);
    expect(splatTransform(WORLD, MPU, 0, {})).toEqual(t);
    expect(splatTransform(WORLD, MPU, 0, { quarters: 0, yawToNorth: 0 })).toEqual(t);
    // …and the frame the three.js side asks for is the same object graph, as it always was.
    expect(marbleFrame(WORLD, MPU)).toEqual(t);
  });

  it('is the rectangle plus the plan: 43° of capture, 30° of north arrow, 13° of room', () => {
    const graph = buildUnitGraph({ northArrow: { present: true, degrees: 30 }, floors: [{ rooms: [{ name: 'Living room', type: 'living', width: 4, depth: 3 }] }] });
    expect(graph.northArrowDeg).toBe(30);
    const room = graph.rooms[0];
    sameAngle(room.yawToNorth, -30 * DEG);

    const t = splatTransform(WORLD, MPU, 0, { quarters: 0, yawToNorth: room.yawToNorth });
    expect((t.rectYaw * 180) / Math.PI).toBeCloseTo(43, 1);
    expect((t.planYaw * 180) / Math.PI).toBeCloseTo(-30, 9);
    expect((t.yaw * 180) / Math.PI).toBeCloseTo(13, 1);
    expect(t.rotationY).toBeCloseTo(Math.PI + t.yaw, 12);
    // The capture still looks where the camera looked, so photo view and the walk spawn still open
    // on the photograph — the camera turns with the room.
    expect(captureYaw(t)).toBe(t.yaw);
  });

  it('never moves the room off the origin, however far it is turned', () => {
    const r = roomRect(CORNER)!;
    const centre = { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
    for (const plan of [undefined, { quarters: 1 }, { quarters: 2 }, { quarters: 3 }, { yawToNorth: -30 * DEG }, { quarters: 3, yawToNorth: 1.1 }]) {
      const t = splatTransform(WORLD, MPU, 0, plan);
      const p = inRoom(t, centre.x, centre.z);
      expect(p.x).toBeCloseTo(0, 9);
      expect(p.z).toBeCloseTo(0, 9);
    }
  });

  it('leaves the scale and the floor alone — a turn about y is a turn about y', () => {
    const flat = splatTransform(WORLD, MPU);
    for (const plan of [{ quarters: 1 }, { quarters: 2, yawToNorth: 0.4 }, { quarters: 3 }]) {
      const t = splatTransform(WORLD, MPU, 0.05, plan);
      expect(t.scale).toBe(flat.scale);
      expect(t.position[1]).toBeCloseTo(flat.position[1] + 0.05, 12);
      expect(t.metric).toBe(false);
      // The capture point stays exactly as far from the room centre as it was; only its bearing moves.
      expect(Math.hypot(t.position[0], t.position[2])).toBeCloseTo(Math.hypot(flat.position[0], flat.position[2]), 9);
    }
  });
});

describe('the quarter turn, composed', () => {
  /**
   * The one thing the quarter turn is *for*: `foldWall(W, q)` is the capture's own wall that the
   * plan calls `W`, so after the fold that wall has to be standing on the room frame's `W`. Assert
   * it for every wall and every quarter — 0°, 90°, 180°, 270° — by turning the fitted rectangle's
   * wall midpoints through the transform and reading which axis they land on.
   */
  const WALLS: WallSide[] = ['north', 'south', 'east', 'west'];
  /** Which axis a wall's midpoint must sit on, and on which side of the origin. */
  const AXIS: Record<WallSide, { on: 'x' | 'z'; sign: -1 | 1 }> = {
    north: { on: 'z', sign: -1 },
    south: { on: 'z', sign: 1 },
    east: { on: 'x', sign: 1 },
    west: { on: 'x', sign: -1 },
  };

  for (const quarters of [0, 1, 2, 3]) {
    it(`puts the plan's walls on Audora's walls at ${quarters * 90}°`, () => {
      const t = splatTransform(WORLD, MPU, 0, { quarters });
      sameAngle(t.yaw, t.rectYaw - quarters * QUARTER_TURN);
      for (const wall of WALLS) {
        const mid = wallMidpoint(foldWall(wall, quarters));
        const p = inRoom(t, mid.x, mid.z);
        const { on, sign } = AXIS[wall];
        const along = on === 'x' ? p.x : p.z;
        const across = on === 'x' ? p.z : p.x;
        expect(Math.abs(across)).toBeLessThan(1e-9);
        expect(Math.sign(along)).toBe(sign);
      }
    });
  }

  it('does not disturb a room whose plan says the capture was already square to it', () => {
    expect(splatTransform(WORLD, MPU, 0, { quarters: 0 })).toEqual(splatTransform(WORLD, MPU));
  });
});

describe('the sun after the yaw', () => {
  it('re-expresses a heading against the wall that is now north', () => {
    // A room whose north wall faced 264° (west), turned a quarter so the west wall becomes north.
    expect(headingAfterYaw(264, 0)).toBe(264);
    expect(headingAfterYaw(264, QUARTER_TURN)).toBeCloseTo(354, 9);
    expect(headingAfterYaw(264, -QUARTER_TURN)).toBeCloseTo(174, 9);
    // Yaw a room fully onto plan north and its north wall faces north — which is the whole point.
    const arrow = 30;
    const room = buildUnitGraph({ northArrow: { degrees: arrow }, floors: [{ rooms: [{ name: 'Bedroom', type: 'bedroom', width: 3, depth: 3 }] }] }).rooms[0];
    expect(headingAfterYaw(arrow, room.yawToNorth)).toBeCloseTo(0, 9);
  });
});

/* ---------- walking through a doorway ---------- */

/** Two rooms side by side, one door between them, with a north arrow the sheet is not drawn to. */
const TWO_ROOMS: UnitPlanInput = {
  northArrow: { present: true, degrees: 30 },
  floors: [
    {
      label: 'Ground floor',
      rooms: [
        { name: 'Living room', type: 'living', width: 4, depth: 3, doors: 1 },
        { name: 'Bedroom', type: 'bedroom', width: 3, depth: 3, doors: 1 },
      ],
    },
  ],
};

/** The room's own metric geometry, in the capture's frame: an odd quarter swaps width against depth. */
const geometryOf = (room: UnitRoom, quarters: number) => (quarters % 2 ? { width: room.depth, depth: room.width } : { width: room.width, depth: room.depth });

/** Every doorway of one room, as the viewer builds them, for a room whose capture is `quarters` off the plan. */
function doorwaysOf(graph: UnitGraph, roomRef: string, quarters: number) {
  const room = roomOf(graph, roomRef)!;
  return matchPortals({ graph, roomRef, geometry: geometryOf(room, quarters), quarters });
}

describe('walking through a doorway', () => {
  const graph = buildUnitGraph(TWO_ROOMS);
  const [a, b] = graph.rooms;

  it('is one flat with one door in it', () => {
    expect(graph.rooms.map((r) => r.name)).toEqual(['Living room', 'Bedroom']);
    expect(a.doors.map((d) => d.toRoomRef)).toEqual([b.roomRef]);
    expect(b.doors.map((d) => d.toRoomRef)).toEqual([a.roomRef]);
    expect(a.doors[0].nominal).toBeUndefined();
  });

  /**
   * The renter walks out of one room and into the next without turning: the way they were facing
   * going out through the door is the way they are facing coming in. Both poses are in their own
   * room's frame, so the assertion is made where they can be compared — on the sheet.
   */
  for (const qa of [0, 1, 2, 3]) {
    for (const qb of [0, 1, 2, 3]) {
      it(`lands the visitor facing into the next room (${qa * 90}° → ${qb * 90}°)`, () => {
        const out = doorwaysOf(graph, a.roomRef, qa).portals.find((p) => p.toRoomRef === b.roomRef)!;
        const back = doorwaysOf(graph, b.roomRef, qb).portals.find((p) => p.toRoomRef === a.roomRef)!;
        const pose = arrivalPose(back, geometryOf(b, qb));

        // Inside the destination room, off the wall it came through, and facing away from it.
        expect(Math.abs(pose.x)).toBeLessThan(geometryOf(b, qb).width / 2);
        expect(Math.abs(pose.z)).toBeLessThan(geometryOf(b, qb).depth / 2);
        expect(Math.hypot(pose.x - back.x, pose.z - back.z)).toBeGreaterThan(0.5);
        // Stepping forward from the arrival goes further into the room, never back through the door.
        const ahead = { x: pose.x - Math.sin(pose.yaw), z: pose.z - Math.cos(pose.yaw) };
        expect(Math.hypot(ahead.x - back.x, ahead.z - back.z)).toBeGreaterThan(Math.hypot(pose.x - back.x, pose.z - back.z));

        // …and on the sheet, the two directions are the same direction: walking through a door does
        // not turn you, whichever way either room's capture happened to face.
        const leaving = poseOnSheet(a, { x: out.x, z: out.z, yaw: out.yaw }, qa);
        const arriving = poseOnSheet(b, pose, qb);
        sameAngle(leaving.yaw, arriving.yaw, 6);
        // The doorway is one doorway: both rooms put it in the same place on the plan.
        expect(Math.hypot(leaving.x - arriving.x, leaving.z - arriving.z)).toBeLessThan(1.2);
      });
    }
  }

  /**
   * The two ways a room can be oriented put the renter on the same spot of the sheet: drawn in its
   * capture's frame (`quarters` un-folded, no turn), or yawed onto plan north (geometry folded by
   * the quarter turn, the north arrow left as the frame's own turn). That is what lets `UnitMap`
   * consume the turn rather than re-derive one.
   */
  it('draws the same dot whether the room was yawed onto plan north or not', () => {
    for (const quarters of [0, 1, 2, 3]) {
      const capture = { x: 0.7, z: -0.4, yaw: 1.1 };
      const unyawed = poseOnSheet(b, capture, quarters, 0);
      // The same standing point, measured in a room world yawed onto plan north.
      const t = turn(capture.x, capture.z, planYaw({ quarters, yawToNorth: b.yawToNorth }));
      const yawed = poseOnSheet(b, { ...t, yaw: capture.yaw + planYaw({ quarters, yawToNorth: b.yawToNorth }) }, 0, b.yawToNorth);
      expect(yawed.x).toBeCloseTo(unyawed.x, 9);
      expect(yawed.z).toBeCloseTo(unyawed.z, 9);
      sameAngle(yawed.yaw, unyawed.yaw);
    }
  });
});
