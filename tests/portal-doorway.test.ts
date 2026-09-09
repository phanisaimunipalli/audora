/**
 * The shell's doorway and the lit portal are one opening.
 *
 * QA saw a lit portal standing on one wall while the shell's dark doorway was cut into another:
 * `RoomShell` was cutting `room.geometry.door` (which `rawFromBounds` puts on the wall the
 * photographer stood at) while `Portals` drew what `matchPortals` matched to the floor plan. There
 * is now one rule — `doorOpeningsFor` — and these tests pin it: the three sources of a doorway in
 * order of evidence, two doors giving two cuts, the clamp that keeps an opening on its wall, and
 * the invariant that the wall the shell cuts is the place the marker stands.
 */
import { describe, expect, it } from 'vitest';
import type { RoomGeometry } from '../src/engine/types';
import { wallFeaturePosition, wallLength } from '../src/engine/geometry';
import { DOORWAY_HEIGHT_M, MIN_DOORWAY_M, doorOpeningsFor, doorsOn, wallSegments, windowsOn, type DoorOpening } from '../src/three/RoomShell';
import { buildUnitGraph, matchPortals, wallPoint, type ColliderOpening, type Portal, type UnitGraph } from '@shared/unitGraph';

/** A plain 4.00 × 5.00 m room whose door spec sits where the photographer stood: the south wall. */
const ROOM: RoomGeometry = {
  width: 4,
  depth: 5,
  height: 2.5,
  door: { wall: 'south', offset: 1.2, width: 0.85, height: 2.03 },
  windows: [{ wall: 'north', offset: 2, width: 1.4, height: 1.2, sill: 0.9 }],
};

/** One portal, as `matchPortals` hands them over: already on one of the room's four walls. */
function portal(over: Partial<Portal> = {}): Portal {
  const wall = over.wall ?? 'east';
  const offset = over.offset ?? 2.5;
  const p = wallPoint(ROOM, wall, offset);
  return {
    id: 'a>b',
    fromRoomRef: '0:0',
    toRoomRef: '0:1',
    toName: 'Hallway',
    wall,
    offset,
    width: 0.85,
    x: p.x,
    z: p.z,
    yaw: 0,
    source: 'collider',
    quarters: 0,
    ...over,
  };
}

/**
 * The floor at one wall, as the shell leaves it: the runs of wall that are actually open. Read back
 * off `wallSegments`, so it measures the hole the renter walks through and not our intent.
 */
function gapsAtFloor(room: RoomGeometry, wall: RoomGeometry['door']['wall'], doorways?: readonly DoorOpening[]): { start: number; end: number }[] {
  const L = wallLength(room, wall);
  const solid = wallSegments(room, wall, doorways)
    .filter((s) => s.bottom < 0.01)
    .map((s) => ({ start: s.along - s.len / 2, end: s.along + s.len / 2 }))
    .sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const s of solid) {
    if (s.start > cursor + 1e-6) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < L - 1e-6) gaps.push({ start: cursor, end: L });
  return gaps;
}

describe('doorOpeningsFor: the three sources, in order of evidence', () => {
  it('takes the matched portal when the unit graph found one', () => {
    const p = portal({ wall: 'east', offset: 2.5, width: 0.92 });
    const [opening, ...rest] = doorOpeningsFor({ geometry: ROOM }, { portals: [p] });
    expect(rest).toEqual([]);
    expect(opening.source).toBe('portal');
    expect(opening.portal).toBe(p);
    expect(opening.wall).toBe('east');
    expect(opening.offset).toBeCloseTo(2.5, 6);
    expect(opening.width).toBeCloseTo(0.92, 6);
    // The room's own door spec is on the south wall; with a portal it is not a doorway any more.
    expect(doorsOn(ROOM, 'south', [opening])).toEqual([]);
  });

  it('takes the collider opening the door spec is standing on when there is no plan', () => {
    // Raw units, capture point at the origin: 0.5 m per unit puts this at 1.30 m along the south
    // wall, 10 cm from where the reconstruction guessed the photographer stood.
    const openings: ColliderOpening[] = [{ wall: 'south', offset: 2.6, width: 1.8 }];
    const [opening, ...rest] = doorOpeningsFor({ geometry: ROOM, openings, metresPerUnit: 0.5 });
    expect(rest).toEqual([]);
    expect(opening.source).toBe('collider');
    expect(opening.wall).toBe('south');
    expect(opening.offset).toBeCloseTo(1.3, 6);
    expect(opening.width).toBeCloseTo(0.9, 6);
  });

  it('ignores an opening on another wall, or too far from the door, and falls back to the spec', () => {
    const elsewhere: ColliderOpening[] = [
      { wall: 'north', offset: 2, width: 1 },
      { wall: 'south', offset: 3.4, width: 1 }, // 3.40 m along a 4 m wall: 2.20 m from the door spec
    ];
    const [opening, ...rest] = doorOpeningsFor({ geometry: ROOM, openings: elsewhere, metresPerUnit: 1 });
    expect(rest).toEqual([]);
    expect(opening.source).toBe('engine');
    expect(opening.wall).toBe('south');
    expect(opening.offset).toBeCloseTo(ROOM.door.offset, 6);
    expect(opening.width).toBeCloseTo(ROOM.door.width, 6);
    expect(opening.height).toBeCloseTo(ROOM.door.height, 6);
  });

  it('falls back to the door spec for a simulated room, which measures no openings at all', () => {
    const [opening] = doorOpeningsFor({ geometry: ROOM });
    expect(opening.source).toBe('engine');
    expect(opening.id).toBe('door');
    expect(opening.note).toBeUndefined();
  });

  it('is deterministic: the same room gives the same doorways, in the same order', () => {
    const portals = [portal({ id: 'a>b', wall: 'east', offset: 2.5 }), portal({ id: 'a>c', wall: 'west', offset: 1 })];
    const room = { geometry: ROOM, openings: [{ wall: 'south' as const, offset: 1.25, width: 0.9 }], metresPerUnit: 1 };
    expect(doorOpeningsFor(room, { portals })).toEqual(doorOpeningsFor(room, { portals }));
    expect(doorOpeningsFor(room)).toEqual(doorOpeningsFor(room));
    expect(doorOpeningsFor(room, { portals }).map((d) => d.id)).toEqual(['a>b', 'a>c']);
  });
});

describe('the shell cuts where the marker stands', () => {
  it('puts every doorway on the floor the marker is drawn on', () => {
    const openings = doorOpeningsFor({ geometry: ROOM }, { portals: [portal({ wall: 'east', offset: 2.5 })] });
    for (const o of openings) {
      // `Portals` draws at (x, z); `RoomShell` cuts at (wall, offset). They are the same point.
      const p = wallFeaturePosition(ROOM, o.wall, o.offset);
      expect(o.x).toBeCloseTo(p.x, 6);
      expect(o.z).toBeCloseTo(p.z, 6);
      // ...and the same point `matchPortals` computed with the unit graph's own arithmetic.
      const q = wallPoint(ROOM, o.wall, o.offset);
      expect(o.x).toBeCloseTo(q.x, 6);
      expect(o.z).toBeCloseTo(q.z, 6);
      // A yaw's own direction is (−sin, −cos), and the marker's group is turned `yaw + π` so its
      // local +z points that way: out of the room, through the doorway.
      expect(-Math.sin(o.yaw)).toBeCloseTo(-p.inward.x, 6);
      expect(-Math.cos(o.yaw)).toBeCloseTo(-p.inward.z, 6);
    }
  });

  it('cuts the wall at exactly the doorway offset and width', () => {
    const openings = doorOpeningsFor({ geometry: ROOM }, { portals: [portal({ wall: 'east', offset: 2.5, width: 0.92 })] });
    const [o] = openings;
    const gaps = gapsAtFloor(ROOM, 'east', openings);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].start).toBeCloseTo(o.offset - o.width / 2, 6);
    expect(gaps[0].end).toBeCloseTo(o.offset + o.width / 2, 6);
    // ...and the wall the door spec used to be cut into is now solid.
    expect(gapsAtFloor(ROOM, 'south', openings)).toEqual([]);
  });

  it('cuts the wall only as high as the doorway is drawn', () => {
    const openings = doorOpeningsFor({ geometry: ROOM }, { portals: [portal({ wall: 'east', offset: 2.5 })] });
    const [o] = openings;
    expect(o.height).toBeCloseTo(DOORWAY_HEIGHT_M, 6);
    const over = wallSegments(ROOM, 'east', openings).find((s) => s.bottom > 0.01);
    expect(over?.bottom).toBeCloseTo(o.height, 6);
    expect(over?.top).toBeCloseTo(ROOM.height, 6);
  });

  it('keeps the doorway under a low ceiling, for the shell and the marker together', () => {
    const low: RoomGeometry = { ...ROOM, height: 2.1 };
    const [o] = doorOpeningsFor({ geometry: low }, { portals: [portal({ wall: 'east', offset: 2.5 })] });
    expect(o.height).toBeCloseTo(2.0, 6);
    const over = wallSegments(low, 'east', [o]).find((s) => s.bottom > 0.01);
    expect(over?.bottom).toBeCloseTo(2.0, 6);
  });
});

describe('two doors, two cuts', () => {
  const portals = [portal({ id: 'a>b', wall: 'east', offset: 1.5, width: 0.9 }), portal({ id: 'a>c', wall: 'east', offset: 3.8, width: 0.8 })];

  it('gives a room with two doors two doorways', () => {
    const openings = doorOpeningsFor({ geometry: ROOM }, { portals });
    expect(openings.map((o) => o.id)).toEqual(['a>b', 'a>c']);
    expect(openings.every((o) => o.source === 'portal')).toBe(true);
  });

  it('cuts both of them into the same wall', () => {
    const openings = doorOpeningsFor({ geometry: ROOM }, { portals });
    const gaps = gapsAtFloor(ROOM, 'east', openings);
    expect(gaps).toHaveLength(2);
    expect(gaps[0].start).toBeCloseTo(1.05, 6);
    expect(gaps[0].end).toBeCloseTo(1.95, 6);
    expect(gaps[1].start).toBeCloseTo(3.4, 6);
    expect(gaps[1].end).toBeCloseTo(4.2, 6);
  });

  it('cuts one on each wall when the doors are on different walls', () => {
    const openings = doorOpeningsFor({ geometry: ROOM }, { portals: [portal({ id: 'a>b', wall: 'north', offset: 1 }), portal({ id: 'a>c', wall: 'west', offset: 2 })] });
    expect(gapsAtFloor(ROOM, 'north', openings)).toHaveLength(1);
    expect(gapsAtFloor(ROOM, 'west', openings)).toHaveLength(1);
    expect(gapsAtFloor(ROOM, 'east', openings)).toEqual([]);
    expect(gapsAtFloor(ROOM, 'south', openings)).toEqual([]);
  });
});

describe('an opening that does not fit its wall', () => {
  it('clamps a doorway wider than the wall, and says so', () => {
    const narrow: RoomGeometry = { ...ROOM, width: 2.4, windows: [] };
    const [o] = doorOpeningsFor({ geometry: narrow }, { portals: [portal({ wall: 'north', offset: 1.2, width: 3.2 })] });
    expect(o.width).toBeCloseTo(2.4, 6);
    expect(o.offset).toBeCloseTo(1.2, 6);
    expect(o.note).toBeTruthy();
    expect(o.note).toContain('3.20 m');
    expect(o.note).toContain('2.40 m');
    // The whole wall is open, and nothing is drawn at negative width.
    const gaps = gapsAtFloor(narrow, 'north', [o]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].start).toBeCloseTo(0, 6);
    expect(gaps[0].end).toBeCloseTo(2.4, 6);
  });

  it('moves a doorway that runs off the end back onto its wall, and says so', () => {
    const [o] = doorOpeningsFor({ geometry: ROOM }, { portals: [portal({ wall: 'north', offset: 3.9, width: 0.9 })] });
    expect(o.offset).toBeCloseTo(3.55, 6);
    expect(o.note).toBeTruthy();
    expect(o.note).toContain("wall's start");
    const gaps = gapsAtFloor(ROOM, 'north', [o]);
    expect(gaps[gaps.length - 1].end).toBeCloseTo(4, 6);
  });

  it('never draws a doorway too narrow to walk through', () => {
    const [o] = doorOpeningsFor({ geometry: ROOM }, { portals: [portal({ wall: 'north', offset: 2, width: 0.12 })] });
    expect(o.width).toBeCloseTo(MIN_DOORWAY_M, 6);
  });

  it('says nothing when nothing had to be moved', () => {
    const [o] = doorOpeningsFor({ geometry: ROOM }, { portals: [portal({ wall: 'north', offset: 2, width: 0.9 })] });
    expect(o.note).toBeUndefined();
  });
});

describe('a doorway and a window are never the same hole twice', () => {
  it('drops the window a doorway is standing in, so the shell does not brick up its own door', () => {
    // The collider reported one opening on the north wall; `rawFromBounds` filed it as a window and
    // the plan calls it a door. Cutting both would leave a sill across the bottom of the doorway.
    const openings = doorOpeningsFor({ geometry: ROOM }, { portals: [portal({ wall: 'north', offset: 2, width: 1.4 })] });
    expect(windowsOn(ROOM, 'north', openings)).toEqual([]);
    const gaps = gapsAtFloor(ROOM, 'north', openings);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].start).toBeCloseTo(1.3, 6);
    expect(gaps[0].end).toBeCloseTo(2.7, 6);
  });

  it('keeps a window that stands clear of the doorway', () => {
    const openings = doorOpeningsFor({ geometry: ROOM }, { portals: [portal({ wall: 'north', offset: 0.6, width: 0.9 })] });
    expect(windowsOn(ROOM, 'north', openings)).toHaveLength(1);
    // Two holes in the wall: the doorway, and the window above its sill.
    expect(gapsAtFloor(ROOM, 'north', openings)).toHaveLength(1);
    expect(wallSegments(ROOM, 'north', openings).filter((s) => s.bottom > 0.01)).toHaveLength(2);
  });
});

describe('the rule end to end, from a floor plan', () => {
  /** Two rooms side by side on one sheet: the graph puts a door on the wall they share. */
  // Built through the real thing rather than by hand, so this test breaks if the graph changes.
  const graph: UnitGraph = buildUnitGraph({
    floors: [
      {
        label: 'Ground floor',
        rooms: [
          { name: 'Living room', type: 'living', width: 4, depth: 5 },
          { name: 'Hallway', type: 'hallway', width: 1.2, depth: 4 },
        ],
      },
    ],
  });

  it('cuts the shell where the plan says the door is, not where the photographer stood', () => {
    const { portals } = matchPortals({ graph, roomRef: '0:0', geometry: ROOM });
    expect(portals.length).toBeGreaterThan(0);
    const openings = doorOpeningsFor({ geometry: ROOM }, { portals });
    expect(openings).toHaveLength(portals.length);
    for (const [i, o] of openings.entries()) {
      expect(o.wall).toBe(portals[i].wall);
      expect(o.offset).toBeCloseTo(portals[i].offset, 4);
      expect(o.x).toBeCloseTo(portals[i].x, 4);
      expect(o.z).toBeCloseTo(portals[i].z, 4);
      const gaps = gapsAtFloor(ROOM, o.wall, openings);
      expect(gaps.some((g) => Math.abs(g.start - (o.offset - o.width / 2)) < 1e-6 && Math.abs(g.end - (o.offset + o.width / 2)) < 1e-6)).toBe(true);
    }
  });
});
