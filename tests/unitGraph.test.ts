/**
 * The unit as one model (`shared/unitGraph.ts`) — docs/ACCURACY.md section 3.3.
 *
 * The graph decides which room is through which door and where a buyer lands when they walk
 * through it, so this is a contract test: the same plan must always give the same rooms in the same
 * places, every door must lead both ways, and a plan door must only claim a collider opening that
 * is really standing where it says.
 */
import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_INSET_M,
  arrivalPose,
  bestFold,
  buildUnitGraph,
  DOOR_WIDTH_M,
  foldDoor,
  foldReverses,
  foldWall,
  linkRooms,
  matchPortals,
  PORTAL_TOLERANCE_M,
  roomOf,
  toRoomPoint,
  toUnitPose,
  type UnitGraph,
  type UnitPlanInput,
} from '../shared/unitGraph';

/**
 * A one-storey flat: a corridor with a living room on one side and a bedroom on the other. Exactly
 * what the parser hands over — names, types, printed dimensions, door counts, a north arrow, and no
 * positions and no adjacency at all.
 */
const FLAT: UnitPlanInput = {
  northArrow: { present: true, direction: 'up' },
  floors: [
    {
      label: 'Ground floor',
      rooms: [
        { name: 'Hall', type: 'hallway', width: 1.2, depth: 4, doors: 3 },
        { name: 'Living room', type: 'living', width: 3.75, depth: 4.6, doors: 1 },
        { name: 'Bedroom', type: 'bedroom', width: 3.4, depth: 3.6, doors: 1 },
      ],
    },
  ],
};

const rect = (g: UnitGraph, name: string) => {
  const r = g.rooms.find((x) => x.name === name)!;
  return { minX: r.position.x - r.width / 2, maxX: r.position.x + r.width / 2, minZ: r.position.z - r.depth / 2, maxZ: r.position.z + r.depth / 2 };
};

/** Rounded to the millimetre: the graph rounds its output, so flush walls may miss by 0.1 mm. */
const overlapArea = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
  Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));

describe('buildUnitGraph', () => {
  it('reads three rooms and two doors off a plan that draws neither', () => {
    const g = buildUnitGraph(FLAT);
    expect(g.rooms.map((r) => r.name)).toEqual(['Hall', 'Living room', 'Bedroom']);
    expect(g.rooms.map((r) => r.roomRef)).toEqual(['0:0', '0:1', '0:2']);
    expect(g.adjacency).toBe('inferred');
    expect(g.positions).toBe('adjacency');

    // The corridor is the circulation: both rooms open off it, and they do not open into each other.
    const hall = roomOf(g, '0:0')!;
    expect(hall.doors.map((d) => d.toRoomRef).sort()).toEqual(['0:1', '0:2']);
    expect(roomOf(g, '0:1')!.doors.map((d) => d.toRoomRef)).toEqual(['0:0']);
    expect(roomOf(g, '0:2')!.doors.map((d) => d.toRoomRef)).toEqual(['0:0']);
    // Two doorways in the unit, four door records — one on each side of each.
    expect(g.rooms.reduce((n, r) => n + r.doors.length, 0)).toBe(4);

    // The plan's own numbers survive; the arrangement is ours, and the result says so.
    expect(hall.planDims).toEqual({ width: 1.2, depth: 4 });
    expect(hall.doorsPrinted).toBe(3);
    expect(g.notes.join(' ')).toMatch(/does not place its rooms/);
    expect(g.notes.join(' ')).toMatch(/draws no doors/);
  });

  it('hangs the rooms off the corridor without overlapping them', () => {
    const g = buildUnitGraph(FLAT);
    const hall = rect(g, 'Hall');
    const living = rect(g, 'Living room');
    const bedroom = rect(g, 'Bedroom');
    // A corridor is flanked, not capped: its long walls are tried first, so the rooms land either side.
    expect(living.minX).toBeCloseTo(hall.maxX, 6);
    expect(bedroom.maxX).toBeCloseTo(hall.minX, 6);
    expect(overlapArea(hall, living)).toBeLessThan(1e-3);
    expect(overlapArea(hall, bedroom)).toBeLessThan(1e-3);
    expect(overlapArea(living, bedroom)).toBeLessThan(1e-3);
  });

  it('puts every door in the wall the two rooms actually share', () => {
    const g = buildUnitGraph(FLAT);
    const hall = roomOf(g, '0:0')!;
    const toLiving = hall.doors.find((d) => d.toRoomRef === '0:1')!;
    const toBedroom = hall.doors.find((d) => d.toRoomRef === '0:2')!;
    expect(toLiving.wall).toBe('east');
    expect(toBedroom.wall).toBe('west');
    // Both walls are the corridor's full 4 m and both rooms straddle its middle, so both doors are
    // half way along it, and neither is a placeholder.
    expect(toLiving.offset).toBeCloseTo(2, 6);
    expect(toBedroom.offset).toBeCloseTo(2, 6);
    expect(toLiving.width).toBeCloseTo(DOOR_WIDTH_M, 6);
    expect(toLiving.nominal).toBeUndefined();
    // The living room's own west wall is 4.6 m; the corridor meets it in the middle.
    expect(roomOf(g, '0:1')!.doors[0]).toMatchObject({ wall: 'west', toRoomRef: '0:0' });
    expect(roomOf(g, '0:1')!.doors[0].offset).toBeCloseTo(2.3, 6);
  });

  it('is symmetric: every door leads back', () => {
    const g = buildUnitGraph(FLAT);
    const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' } as const;
    for (const room of g.rooms) {
      for (const door of room.doors) {
        const other = roomOf(g, door.toRoomRef)!;
        const back = other.doors.find((d) => d.toRoomRef === room.roomRef);
        expect(back, `${other.name} has no door back to ${room.name}`).toBeDefined();
        expect(back!.wall).toBe(opposite[door.wall]);
        expect(back!.width).toBeCloseTo(door.width, 6);
      }
    }
  });

  it('is deterministic', () => {
    // Same plan, same graph — down to the last position: a room's place is what "you are here" is
    // drawn against, and it may not wobble between two loads of the same tour.
    expect(buildUnitGraph(FLAT)).toEqual(buildUnitGraph(FLAT));
    expect(JSON.stringify(buildUnitGraph(FLAT))).toBe(JSON.stringify(buildUnitGraph(structuredClone(FLAT))));
  });

  it('strings rooms together in sheet order when the plan has no hallway', () => {
    const g = buildUnitGraph({
      floors: [
        {
          label: 'Floor plan',
          rooms: [
            { name: 'Kitchen', type: 'kitchen', width: 3, depth: 3.2 },
            { name: 'Dining', type: 'dining', width: 3.4, depth: 3.2 },
            { name: 'Study', type: 'office', width: 2.6, depth: 3 },
          ],
        },
      ],
    });
    expect(g.rooms.map((r) => r.doors.map((d) => d.toRoomRef))).toEqual([['0:1'], ['0:0', '0:2'], ['0:1']]);
    expect(g.notes.join(' ')).toMatch(/no hallway/);
    expect(g.notes.join(' ')).toMatch(/no north arrow/);
  });

  it('draws a room the plan gave no dimensions at a typical size for its type, and says so', () => {
    const g = buildUnitGraph({ floors: [{ label: 'Ground floor', rooms: [{ name: 'Couloir', type: 'hallway' }, { name: 'Chambre', type: 'bedroom' }] }] });
    expect(g.rooms[0].planDims).toBeNull();
    expect(g.rooms[0].width).toBeLessThan(g.rooms[0].depth); // a corridor is drawn as one
    expect(g.notes.join(' ')).toMatch(/2 of 2 rooms print no dimensions/);
  });

  it('sets each room a yaw onto the plan’s north, and lays storeys side by side', () => {
    const east = buildUnitGraph({ ...FLAT, northArrow: { present: true, direction: 'right' } });
    expect(east.northArrowDeg).toBe(90);
    // North is to the right of the page, so every room turns a quarter the other way to face it.
    for (const r of east.rooms) expect(r.yawToNorth).toBeCloseTo(-Math.PI / 2, 6);

    const two = buildUnitGraph({
      floors: [
        { label: 'Ground floor', rooms: [{ name: 'Living room', type: 'living', width: 4, depth: 4 }] },
        { label: 'First floor', rooms: [{ name: 'Bedroom', type: 'bedroom', width: 3, depth: 3 }] },
      ],
    });
    expect(two.rooms[1].position.x).toBeGreaterThan(two.rooms[0].position.x + 4);
    expect(two.rooms[0].doors).toEqual([]);
    expect(two.notes.join(' ')).toMatch(/Storeys are drawn side by side/);
  });

  it('uses the positions and doors a plan does give', () => {
    const g = buildUnitGraph({
      northArrow: { present: true, degrees: 0 },
      adjacency: [{ a: '0:0', b: '0:1' }],
      floors: [
        {
          label: 'Ground floor',
          rooms: [
            { name: 'Kitchen', type: 'kitchen', width: 3, depth: 4, position: { x: 0, z: 0 } },
            { name: 'Dining', type: 'dining', width: 3, depth: 4, position: { x: 3, z: 0 } },
          ],
        },
      ],
    });
    expect(g.positions).toBe('plan');
    expect(g.adjacency).toBe('plan');
    expect(g.rooms[0].position).toEqual({ x: 0, z: 0 });
    expect(g.rooms[0].doors[0]).toMatchObject({ wall: 'east', toRoomRef: '0:1' });
    expect(g.rooms[0].doors[0].offset).toBeCloseTo(2, 6);
  });
});

describe('the quarter turn between the plan and the room', () => {
  it('turns a wall and its offsets together', () => {
    // A yaw of one quarter turns north toward west (three/splat/frame's convention), so the cycle
    // is north → west → south → east and four quarters are the identity.
    expect([0, 1, 2, 3].map((q) => foldWall('north', q))).toEqual(['north', 'west', 'south', 'east']);
    for (const wall of ['north', 'south', 'east', 'west'] as const) expect(foldWall(wall, 4)).toBe(wall);
    // A wall's offset runs from its west or north end, so half the turns swap its ends.
    expect(foldReverses('north', 0)).toBe(false);
    expect(foldReverses('north', 1)).toBe(true);
    expect(foldReverses('east', 1)).toBe(false);
    expect(foldReverses('east', 2)).toBe(true);
    // A door 1 m from the north wall's west end is 1 m from the west wall's *south* end, a quarter on.
    const room = { width: 4, depth: 3 };
    expect(foldDoor(room, { wall: 'north', offset: 1 }, 1)).toEqual({ wall: 'west', offset: 3 });
    expect(foldDoor(room, { wall: 'north', offset: 1 }, 0)).toEqual({ wall: 'north', offset: 1 });
  });
});

describe('matchPortals', () => {
  const g = buildUnitGraph(FLAT);
  /** The living room's metric geometry, and its only plan door: 2.3 m along its west wall. */
  const geometry = { width: 3.75, depth: 4.6 };

  it('claims a collider opening standing where the plan puts the door', () => {
    // Raw units at 0.5 m each: 4.4 units along the west wall is 2.20 m, 10 cm from the plan's 2.30.
    const m = matchPortals({ graph: g, roomRef: '0:1', geometry, openings: [{ wall: 'west', offset: 4.4, width: 1.8 }], metresPerUnit: 0.5 });
    expect(m.quarters).toBe(0);
    expect(m.matched).toBe(1);
    expect(m.portals).toHaveLength(1);
    const p = m.portals[0];
    expect(p).toMatchObject({ fromRoomRef: '0:1', toRoomRef: '0:0', toName: 'Hall', wall: 'west', source: 'collider' });
    // Placed where the collider found it — that is where the doorway is in the photograph.
    expect(p.offset).toBeCloseTo(2.2, 6);
    expect(p.width).toBeCloseTo(0.9, 6);
    expect(p.residual).toBeCloseTo(0.1, 6);
    // On the west wall of a 3.75 × 4.60 room, 2.20 m from its north end.
    expect(p.x).toBeCloseTo(-1.875, 6);
    expect(p.z).toBeCloseTo(-2.3 + 2.2, 6);
    // Looking out through it: west is a quarter turn past north.
    expect(p.yaw).toBeCloseTo(Math.PI / 2, 6);
  });

  it('holds the tolerance: half a metre out is the same door, more is not', () => {
    const near = matchPortals({ graph: g, roomRef: '0:1', geometry, openings: [{ wall: 'west', offset: 2.3 + PORTAL_TOLERANCE_M - 0.05, width: 0.9 }] });
    expect(near.matched).toBe(1);
    expect(near.portals[0].source).toBe('collider');

    const far = matchPortals({ graph: g, roomRef: '0:1', geometry, openings: [{ wall: 'west', offset: 2.3 + PORTAL_TOLERANCE_M + 0.05, width: 0.9 }] });
    expect(far.matched).toBe(0);
    // Still a portal: the drawing says there is a door there, and a unit you cannot walk is worse.
    expect(far.portals).toHaveLength(1);
    expect(far.portals[0]).toMatchObject({ source: 'plan', wall: 'west' });
    expect(far.portals[0].offset).toBeCloseTo(2.3, 6);
    expect(far.portals[0].residual).toBeUndefined();

    // An opening on another wall is another opening, however close its offset. (With the turn left
    // free, a lone opening on the east wall is explained by turning the room half round — which is
    // the point of the fold — so this pins it.)
    const elsewhere = matchPortals({ graph: g, roomRef: '0:1', geometry, openings: [{ wall: 'east', offset: 2.3, width: 0.9 }], quarters: 0 });
    expect(elsewhere.matched).toBe(0);
  });

  it('recovers the turn between the capture’s frame and the plan’s', () => {
    // The photographer faced the other way, so the doorway the plan puts on the west wall is on the
    // capture's south wall. One quarter turn explains that, and no other does.
    const openings = [{ wall: 'south' as const, offset: 2.3, width: 0.9 }];
    const fold = bestFold(roomOf(g, '0:1')!, openings);
    expect(fold).toMatchObject({ quarters: 1, matched: 1 });
    const m = matchPortals({ graph: g, roomRef: '0:1', geometry, openings });
    expect(m.quarters).toBe(1);
    expect(m.portals[0]).toMatchObject({ wall: 'south', source: 'collider' });

    // With nothing measured there is nothing to recover, and the capture is left where it is.
    expect(matchPortals({ graph: g, roomRef: '0:1', geometry }).quarters).toBe(0);
    // A caller that knows better is obeyed.
    expect(matchPortals({ graph: g, roomRef: '0:1', geometry, openings, quarters: 0 }).portals[0]).toMatchObject({ wall: 'west', source: 'plan' });
  });

  it('lands the buyer just inside the room they walked into, facing in', () => {
    const hall = matchPortals({ graph: g, roomRef: '0:0', geometry: { width: 1.2, depth: 4 } });
    const back = hall.portals.find((p) => p.toRoomRef === '0:1')!;
    expect(back.wall).toBe('east');
    const pose = arrivalPose(back, { width: 1.2, depth: 4 });
    // Stepping out of the corridor's east doorway puts you inside it, looking west (a yaw of 0
    // looks north, and a positive yaw turns west — viewerStore's convention).
    expect(pose.x).toBeCloseTo(0.6 - ARRIVAL_INSET_M, 6);
    expect(pose.z).toBeCloseTo(0, 6);
    expect(pose.yaw).toBeCloseTo(Math.PI / 2, 6);
    // Never outside the room, however narrow it is.
    const tight = arrivalPose(back, { width: 1, depth: 4 });
    expect(Math.abs(tight.x)).toBeLessThanOrEqual(0.5);
  });
});

describe('placing a room on the plan', () => {
  const g = buildUnitGraph(FLAT);

  it('moves a pose out of a room’s frame onto the sheet and back', () => {
    const living = roomOf(g, '0:1')!;
    const pose = { x: 1.1, z: -0.4, yaw: 0.3 };
    for (const q of [0, 1, 2, 3]) {
      const unit = toUnitPose(living, pose, q);
      const back = toRoomPoint(living, unit, q);
      expect(back.x).toBeCloseTo(pose.x, 9);
      expect(back.z).toBeCloseTo(pose.z, 9);
    }
    // Unturned, the room's own frame is the sheet's, offset to where the room stands on it.
    const straight = toUnitPose(living, pose, 0);
    expect(straight.x).toBeCloseTo(living.position.x + 1.1, 9);
    expect(straight.z).toBeCloseTo(living.position.z - 0.4, 9);
    expect(straight.yaw).toBeCloseTo(0.3, 9);
    // A quarter turn of the room turns the walker with it.
    expect(toUnitPose(living, pose, 1).yaw).toBeCloseTo(0.3 - Math.PI / 2, 9);
  });

  it('ties a tour’s rooms to the plan’s, one each', () => {
    const links = linkRooms(g, [
      { id: 'a', name: 'The lounge', planRoomName: 'Living room', floor: 'Ground floor' },
      { id: 'b', name: 'Bedroom' },
      { id: 'c', name: 'Nothing on the plan' },
    ]);
    expect(links).toEqual({ a: '0:1', b: '0:2' });

    // Two rooms with the same name take the plan's two, in order, rather than both the first.
    const twin = buildUnitGraph({
      floors: [{ label: 'Ground floor', rooms: [{ name: 'Bedroom', type: 'bedroom', width: 3, depth: 3 }, { name: 'Bedroom', type: 'bedroom', width: 3.4, depth: 3 }] }],
    });
    expect(linkRooms(twin, [{ id: 'x', name: 'Bedroom' }, { id: 'y', name: 'Bedroom' }])).toEqual({ x: '0:0', y: '0:1' });
  });
});
