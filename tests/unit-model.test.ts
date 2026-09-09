/**
 * The plan, met by one room — `src/screens/viewer/unit.ts`, the module the renter's viewer, the
 * staging editor, the hub and the publish panel all read instead of each answering for themselves.
 *
 * The bug this module exists to make impossible: the shell cut one doorway while the lit marker
 * stood in another, because the viewer gave `RoomShell` the engine's door spec and `Portals` the
 * plan's matched portals. So the first thing asserted below is not a number, it is an **identity** —
 * every marker is one of the openings the shell was given, the same object.
 *
 * The rest is the room's turn: one number, four consumers (the Marble group, the shell, the markers
 * and the unit map), and the policy that says how much of the plan's turn Audora carries as a
 * rotation. The shipped policy carries none, so every default here is 0; the policy is still driven
 * with both terms non-zero, because the point of one rule is that turning it turns everything.
 */
import { describe, expect, it } from 'vitest';
import type { FloorPlan } from '@/services/floorplan';
import type { Room, TourFloorPlan } from '@/state/types';
import {
  DEFAULT_TURN_POLICY,
  roomPlan,
  roomTurn,
  roomTurnFor,
  sunHeading,
  unitModel,
  type TurnPolicy,
  type UnitRoomInput,
} from '@/screens/viewer/unit';
import { poseOnSheet } from '@/screens/viewer/UnitMap';
import { doorOpeningsFor } from '@/three/RoomShell';
import { arrivalPose, normaliseYaw } from '@shared/unitGraph';
import { planYaw } from '@/services/marble';

/* ---------- a three-room flat with a kitchen nobody photographed ---------- */

const plan = (northArrowDeg = 0): TourFloorPlan => ({
  units: 'metres',
  source: 'heuristic',
  parsedAt: 0,
  notes: [],
  northArrow: { present: true, degrees: northArrowDeg },
  floors: [
    {
      label: 'Ground floor',
      rooms: [
        { name: 'Living room', type: 'living', width: 4.2, depth: 5, dimensionsText: '4.20 × 5.00 m' },
        { name: 'Hallway', type: 'hallway', width: 4, depth: 1.2, dimensionsText: '4.00 × 1.20 m' },
        { name: 'Bedroom', type: 'bedroom', width: 3.3, depth: 3.8, dimensionsText: '3.30 × 3.80 m' },
        { name: 'Kitchen', type: 'kitchen', width: 3, depth: 3.2, dimensionsText: '3.00 × 3.20 m' },
      ],
    },
  ],
} as unknown as TourFloorPlan & FloorPlan);

const geometry = (width: number, depth: number): Room['geometry'] => ({
  width,
  depth,
  height: 2.44,
  door: { wall: 'south', offset: width / 2, width: 0.9, height: 2.03 },
  windows: [{ wall: 'north', offset: width / 2, width: 1.2, height: 1.4, sill: 0.9 }],
});

/** A room of the tour: only the fields the module reads. */
const room = (id: string, name: string, width: number, depth: number): UnitRoomInput => ({
  id,
  name,
  geometry: geometry(width, depth),
  anchor: { method: 'door', metresPerUnit: 0.7, uncertaintyM: 0.04, referenceMetres: 2.03, label: 'door 2.03 m ±4 cm' } as Room['anchor'],
  planDims: { width, depth, planRoomName: name, floor: 'Ground floor' },
});

/**
 * The three rooms the tour photographed. The kitchen is on the drawing and has no capture, which is
 * the ordinary case: a leasing team photographs the rooms that sell the unit. `buildUnitGraph` hangs
 * every room off the hallway, so the hallway is where several doorways meet.
 */
const ROOMS: UnitRoomInput[] = [room('r-living', 'Living room', 4.2, 5), room('r-hall', 'Hallway', 4, 1.2), room('r-bed', 'Bedroom', 3.3, 3.8)];
const HALL = ROOMS[1];
const BED = ROOMS[2];

const model = () => unitModel(plan(), ROOMS);

/* ---------- 1. the shell and the marker read one list ---------- */

describe('one room, one set of doorways', () => {
  it('gives the markers as objects out of the shell’s own array, not a second reading', () => {
    const here = roomPlan(model(), HALL);
    expect(here.doorways.length).toBeGreaterThan(0);
    expect(here.markers.length).toBeGreaterThan(0);
    // Identity, not equality: the pane cannot be the size or the place of a hole that is not there.
    for (const m of here.markers) expect(here.doorways).toContain(m);
    expect(here.portals).toEqual(here.markers.map((m) => m.portal));
  });

  it('cuts a doorway into a room nobody photographed, and stands no marker in it', () => {
    const here = roomPlan(model(), HALL);
    const toKitchen = here.doorways.filter((d) => d.portal?.toName === 'Kitchen');
    expect(toKitchen).toHaveLength(1);
    // The kitchen is on the drawing and not in the tour: still a hole in this wall, still nowhere
    // to walk. The shell cuts it; the marker list does not carry it.
    expect(here.doorways).toContain(toKitchen[0]);
    expect(here.markers).not.toContain(toKitchen[0]);
    expect(here.markers.length).toBe(here.doorways.length - 1);
  });

  it('is exactly what `doorOpeningsFor` answers for the room, in the same order', () => {
    const m = model();
    const here = roomPlan(m, HALL);
    const direct = doorOpeningsFor({ geometry: HALL.geometry, openings: [], metresPerUnit: 0.7 }, { portals: here.match.portals });
    expect(here.doorways).toEqual(direct);
  });

  it('falls back to the room’s own door spec when the tour has no plan at all', () => {
    const here = roomPlan(unitModel(undefined, ROOMS), ROOMS[0]);
    expect(here.doorways).toHaveLength(1);
    expect(here.doorways[0].source).toBe('engine');
    expect(here.markers).toEqual([]);
    expect(here.unitRef).toBeUndefined();
    expect(here.turn).toEqual({ world: 0, shell: 0, map: 0, quarters: 0 });
  });

  it('is deterministic: the same plan and the same room give the same doorways', () => {
    expect(roomPlan(model(), ROOMS[0])).toEqual(roomPlan(model(), ROOMS[0]));
  });
});

/* ---------- 2. walking through one lands inside the next room ---------- */

describe('a doorway between two rooms', () => {
  it('names the other room from both sides, and arrival is inside the room you enter', () => {
    const m = model();
    const hall = roomPlan(m, HALL);
    const bed = roomPlan(m, BED);
    const out = hall.markers.find((d) => d.portal!.toRoomRef === bed.unitRef);
    const back = bed.markers.find((d) => d.portal!.toRoomRef === hall.unitRef);
    expect(out).toBeDefined();
    expect(back).toBeDefined();
    // The renter steps out of the doorway on the *far* side, so the pose is inside the bedroom,
    // facing away from the wall they came through.
    const pose = arrivalPose(back!.portal!, BED.geometry);
    expect(Math.abs(pose.x)).toBeLessThanOrEqual(BED.geometry.width / 2);
    expect(Math.abs(pose.z)).toBeLessThanOrEqual(BED.geometry.depth / 2);
    // The doorway the renter walked out of is the one the shell cut, not a second reading of it.
    expect(bed.doorways).toContain(back);
  });
});

/* ---------- 3. the turn: one number, four consumers ---------- */

describe('roomTurn', () => {
  it('is zero everywhere under the shipped policy, whatever the plan says', () => {
    for (const arrow of [0, 30, 90, 213]) {
      const m = unitModel(plan(arrow), ROOMS);
      for (const r of ROOMS) expect(roomTurnFor(m, r)).toEqual({ world: 0, shell: 0, map: 0, quarters: expect.any(Number) });
    }
    expect(DEFAULT_TURN_POLICY).toEqual({ foldedQuarters: 0, turnScene: false });
  });

  it('reports the quarter turn the map still has to undo itself', () => {
    const m = unitModel(plan(), ROOMS);
    const here = roomPlan(m, HALL);
    expect(here.turn.quarters).toBe(here.match.quarters);
  });

  it('turns the group back onto a geometry that has been folded, and leaves the shell alone', () => {
    const policy: TurnPolicy = { foldedQuarters: 1, turnScene: false };
    const t = roomTurn({ quarters: 1 }, { yawToNorth: 0.4 }, policy);
    expect(t.world).toBeCloseTo(-Math.PI / 2, 12);
    // The shell is axis-aligned because the fold put the room's own walls in the plan's frame.
    expect(t.shell).toBe(0);
    // And the map has nothing left to undo: the room frame IS the plan frame.
    expect(t.quarters).toBe(0);
  });

  it('turns the shell, the markers and the map together when the scene carries the north arrow', () => {
    const policy: TurnPolicy = { foldedQuarters: 0, turnScene: true };
    const t = roomTurn({ quarters: 2 }, { yawToNorth: 0.4 }, policy);
    expect(t.world).toBeCloseTo(0.4, 12);
    expect(t.shell).toBe(t.world);
    expect(t.map).toBe(t.world);
    // Nothing was folded, so the quarter turn is still between the room's frame and the sheet's.
    expect(t.quarters).toBe(2);
  });

  it('is the same turn `splatTransform` folds, for every fold and arrow', () => {
    for (const q of [0, 1, 2, 3]) {
      for (const arrow of [0, 0.4, -1.2]) {
        const t = roomTurn({ quarters: q }, { yawToNorth: arrow }, { foldedQuarters: q, turnScene: true });
        // `planYaw({quarters, yawToNorth})` is `yawToNorth − quarters·π/2`, and `world` is the same
        // sum — so the group's one turn and this module's answer can never be two numbers.
        expect(normaliseYaw(t.world)).toBeCloseTo(planYaw({ quarters: q, yawToNorth: arrow }), 12);
      }
    }
  });
});

/* ---------- 4. the map consumes the turn, it does not invent one ---------- */

describe('the unit map reads the same turn', () => {
  it('undoes exactly what the scene applied, so the dot does not move when the policy does', () => {
    const at = { x: 0.8, z: -1.4, yaw: 0.3 };
    const here = roomPlan(model(), HALL);
    const room0 = here.unitRoom!;
    const shipped = poseOnSheet(room0, at, here.turn.quarters, here.turn.map);

    // The same room with its geometry folded by the quarter turn: the pose it publishes is the
    // shipped one turned by `-world`, and the map has one fewer quarter to undo. Same dot.
    const folded = roomTurn(here.match, room0, { foldedQuarters: here.match.quarters, turnScene: false });
    const turned = (() => {
      const a = -folded.world;
      return { x: at.x * Math.cos(a) + at.z * Math.sin(a), z: at.z * Math.cos(a) - at.x * Math.sin(a), yaw: at.yaw - folded.world };
    })();
    const alt = poseOnSheet(room0, turned, folded.quarters, folded.map);
    expect(alt.x).toBeCloseTo(shipped.x, 9);
    expect(alt.z).toBeCloseTo(shipped.z, 9);
  });
});

/* ---------- 5. the sun reads it too ---------- */

describe('sunHeading', () => {
  const NO_TURN = { world: 0, shell: 0, map: 0, quarters: 0 };

  it('is the room’s own north wall over the building’s, unchanged by a zero turn', () => {
    expect(sunHeading(180, { northWallHeading: 264 } as Room, NO_TURN)).toBe(264);
    expect(sunHeading(180, { northWallHeading: undefined } as unknown as Room, NO_TURN)).toBe(180);
    expect(sunHeading(undefined, undefined, NO_TURN)).toBe(0);
  });

  it('moves with the room’s world, because a bearing runs clockwise and the yaw does not', () => {
    // A quarter turn of the world puts a different wall at the room's north, 90° round.
    expect(sunHeading(0, { northWallHeading: 90 } as Room, { ...NO_TURN, world: Math.PI / 2 })).toBeCloseTo(180, 9);
    expect(sunHeading(0, { northWallHeading: 90 } as Room, { ...NO_TURN, world: -Math.PI / 2 })).toBeCloseTo(0, 9);
  });
});
