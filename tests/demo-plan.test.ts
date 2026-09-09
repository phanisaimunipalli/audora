/**
 * The demo unit's floor plan — the one place "plan says / model measures" can be seen with real
 * numbers before anything is generated (docs/ACCURACY.md §1).
 *
 * Three things are pinned here, because all three are load-bearing for the demo:
 *
 *  1. **The sheet and the store agree.** `public/demo/floorplan-oak-unit3.png` prints each room's
 *     dimensions and `src/state/seed.ts` stores the parsed form. They are written in two places (a
 *     generator script and a TypeScript table), so the printed string is re-read here with the
 *     app's own `metresFromDimensions` and has to give back the metres the seed holds — which is
 *     also what makes `dimensionsFrom: 'text'` a true statement rather than a label.
 *  2. **The printed dimensions are the rooms' own sizes**, to the ±5 cm a drawing is worth. A plan
 *     that disagreed with the model by more than its own uncertainty would make every residual in
 *     the demo meaningless.
 *  3. **The migration is additive.** A browser that already holds the demo gets the plan, the room
 *     dimensions and the measurements, and nothing else on the tour or its rooms moves.
 *
 * No network: `fetchColliderGeometry` (the full-quality world's collider, on the Marble CDN) is the
 * one thing the seed reaches for, and `fetch` is a fake that always rejects.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('tests do not use the network'))));

import { useAudora } from '@/state/store';
import { DEMO_PLAN_FILE, DEMO_PLAN_IMAGE, DEMO_SHARE_ID, demoFloorPlan, migrateDemoPlan, seedDemo } from '@/state/seed';
import { pickWorld } from '@/state/publish';
import { roomAccuracy, tourAccuracy } from '@/screens/hub/accuracy';
import { roomPlan, unitModel } from '@/screens/viewer/unit';
import { freeSpawn, spawnSolids } from '@/screens/viewer/spawn';
import { arrivalPose } from '@shared/unitGraph';
import { FLOORPLAN_UNCERTAINTY_M, metresFromDimensions } from '@/services/floorplan';
import type { Room, Tour, TourFloorPlan } from '@/state/types';

const PLAN_ROOMS = 6;
/** Every room on the sheet is photographed, the corridor included — that is what makes it walkable. */
const CORRIDOR = 'Hallway';

function tour(): Tour {
  const t = Object.values(useAudora.getState().tours).find((x) => x.shareId === DEMO_SHARE_ID);
  if (!t) throw new Error('the demo tour was not seeded');
  return t;
}

const rooms = (): Room[] => tour().roomIds.map((id) => useAudora.getState().rooms[id]).filter(Boolean);
const plan = (): TourFloorPlan => {
  const p = tour().floorPlan;
  if (!p) throw new Error('the demo tour has no floor plan');
  return p;
};

/** Millimetres, so a residual that is exactly the plan's ±5 cm is not failed by binary rounding. */
const mm = (v: number) => Math.round(v * 1000) / 1000;

beforeAll(() => {
  seedDemo();
});

describe('the demo unit carries its own floor plan', () => {
  it('is a six-room sheet with a north arrow and the drawing behind it', () => {
    const p = plan();
    expect(p.floors).toHaveLength(1);
    expect(p.floors[0].label).toBe('Third floor');
    expect(p.floors[0].rooms).toHaveLength(PLAN_ROOMS);
    expect(p.northArrow).toEqual({ present: true, direction: 'up' });
    expect(p.units).toBe('mixed');
    // The parsed shape is stored, so nothing has to read the picture at runtime — but the picture
    // is what the leasing team looks at, so the plan says where it is.
    expect(p.imageUrl).toBe(DEMO_PLAN_IMAGE);
    expect(p.fileName).toBe(DEMO_PLAN_FILE);
  });

  it('stores the metres it prints: every dimension re-reads to the number the seed holds', () => {
    const p = plan();
    for (const r of p.floors[0].rooms) {
      expect(r.dimensionsText, `${r.name} prints no dimensions`).toBeTruthy();
      expect(r.dimensionsFrom).toBe('text');
      expect(metresFromDimensions(r.dimensionsText as string, p.units), `${r.name}: ${r.dimensionsText}`).toEqual({
        width: r.width,
        depth: r.depth,
      });
    }
  });

  it('prints dimensions that match the rooms’ own geometry to within the plan’s ±5 cm', () => {
    const byName = new Map(rooms().map((r) => [r.name, r]));
    let compared = 0;
    for (const p of plan().floors[0].rooms) {
      const room = byName.get(p.name);
      // Every room on the sheet has a capture: a plan room the tour has not got is a doorway that
      // leads nowhere for every room that opens off it (see "walkable room to room" below).
      expect(room, `${p.name} is on the sheet with no room in the tour`).toBeTruthy();
      if (!room) continue;
      compared++;
      expect(mm(Math.abs((p.width as number) - room.geometry.width)), `${p.name} width`).toBeLessThanOrEqual(FLOORPLAN_UNCERTAINTY_M);
      expect(mm(Math.abs((p.depth as number) - room.geometry.depth)), `${p.name} depth`).toBeLessThanOrEqual(FLOORPLAN_UNCERTAINTY_M);
    }
    expect(compared).toBe(PLAN_ROOMS);
  });

  it('gives every plan room it named its printed dimensions, and no others', () => {
    const named = new Set(plan().floors[0].rooms.map((r) => r.name));
    for (const room of rooms()) {
      if (!named.has(room.name)) {
        // The furnished flat is a showcase world from another building, not a room of this unit.
        expect(room.planDims).toBeUndefined();
        continue;
      }
      expect(room.planDims, room.name).toBeTruthy();
      expect(room.planDims?.planRoomName).toBe(room.name);
      expect(room.planDims?.floor).toBe('Third floor');
      expect(room.planDims?.text).toBe(plan().floors[0].rooms.find((r) => r.name === room.name)?.dimensionsText);
    }
  });
});

describe('the hub’s accuracy line', () => {
  it('reports every simulated room as measured against the plan', () => {
    const simulated = rooms().filter((r) => pickWorld(r.draft, r.full)?.provider === 'mock');
    // The four rooms of the original seed, plus the corridor they all open off.
    expect(simulated.length).toBe(5);
    for (const room of simulated) {
      const a = roomAccuracy(room);
      expect(a.measured, `${room.name} is not measured`).toBe(true);
      expect(a.scale).toBeGreaterThan(0);
      // Two independent things measured it: the drawing and the room's own anchor.
      expect(a.independentSources).toBe(2);
      const dims = a.lines.filter((l) => l.dimension !== 'height');
      expect(dims).toHaveLength(2);
      for (const line of dims) {
        expect(line.text, `${room.name} ${line.dimension}`).toContain('Plan says');
        expect(line.expected).toBeGreaterThan(0);
        // docs/ACCURACY.md §1: median under 5 %, every room under 10 %.
        expect(line.level, `${room.name} ${line.dimension}: ${line.text}`).toBe('ok');
      }
    }
  });

  it('summarises the unit against the plan rather than saying "not measured yet"', () => {
    const t = tourAccuracy(rooms());
    expect(t.rooms).toBe(7);
    // Six of the seven: the furnished flat is a showcase world with no plan room to compare against.
    expect(t.measured).toBe(6);
    expect(t.overLimit).toBe(0);
    expect(t.withinTarget).toBe(6);
    expect(t.medianErrorPct).toBeLessThan(5);
    expect(t.text).toContain('against the plan');
    expect(t.text).not.toContain('not measured yet');
  });

  it('shows the second bedroom disagreeing with the plan by the 5 cm it really is out', () => {
    const room = rooms().find((r) => r.name === 'Second bedroom');
    const a = roomAccuracy(room as Room);
    const width = a.lines.find((l) => l.dimension === 'width');
    expect(width?.expected).toBe(2.8);
    expect(width?.measured).toBeCloseTo(2.75, 2);
    expect(width?.text).toBe('Plan says 2.80 m · model measures 2.75 m (−0.05 m)');
  });
});

/* ---------- the unit is walkable ---------- */

describe('the demo unit is walkable room to room', () => {
  const model = () => unitModel(tour().floorPlan, rooms());

  it('gives every room on the plan a doorway that leads somewhere the renter can stand', () => {
    const m = model();
    for (const room of rooms()) {
      if (!m.planRefs[room.id]) {
        // The furnished flat is a showcase world from another building and is on no sheet.
        expect(room.name).toBe('Furnished flat');
        continue;
      }
      const p = roomPlan(m, room);
      expect(p.doorways.length, `${room.name} has no doorway`).toBeGreaterThan(0);
      expect(p.markers.length, `${room.name}: ${p.doorways.length} doorways, none leading to a room the tour has`).toBeGreaterThan(0);
      // The markers are the same objects as the doorways they stand in, never a second list.
      for (const marker of p.markers) expect(p.doorways).toContain(marker);
    }
  });

  it('walks the renter through a doorway into the room on the other side', () => {
    const m = model();
    const all = rooms();
    const living = all.find((r) => r.name === 'Living room') as Room;
    const hall = all.find((r) => r.name === CORRIDOR) as Room;
    // Exactly what `TourViewer.onPortal` does: the marker names a room the tour has, and the room
    // on the other side has a doorway back — the same opening, measured from inside it — which is
    // the one the renter steps out of.
    const marker = roomPlan(m, living).markers[0];
    expect(m.roomIdForRef[marker.portal!.toRoomRef]).toBe(hall.id);
    const back = roomPlan(m, hall).match.portals.find((p) => p.toRoomRef === m.planRefs[living.id]);
    expect(back, 'the corridor has no doorway back to the living room').toBeTruthy();
    const pose = arrivalPose(back!, hall.geometry);
    // Standing inside the corridor, facing into it, and not inside its walls.
    expect(Math.abs(pose.x)).toBeLessThan(hall.geometry.width / 2);
    expect(Math.abs(pose.z)).toBeLessThan(hall.geometry.depth / 2);
    expect(freeSpawn(hall.geometry, spawnSolids(hall.staging, false), pose)).toEqual(pose);
  });

  it('opens all five rooms off the corridor, each through its own hole in the wall', () => {
    const m = model();
    const hall = rooms().find((r) => r.name === CORRIDOR) as Room;
    const p = roomPlan(m, hall);
    expect(p.markers).toHaveLength(PLAN_ROOMS - 1);
    expect(new Set(p.markers.map((d) => d.portal?.toRoomRef)).size).toBe(PLAN_ROOMS - 1);
    // Two markers in one hole would leave the renter's destination to hit-test order, and the hole
    // the shell cuts is one doorway wide whatever the plan says opens off it.
    for (const room of rooms()) {
      const doorways = roomPlan(m, room).doorways;
      for (let i = 0; i < doorways.length; i++) {
        for (let j = i + 1; j < doorways.length; j++) {
          const a = doorways[i];
          const b = doorways[j];
          const apart = a.wall !== b.wall || Math.abs(a.offset - b.offset) > (a.width + b.width) / 2;
          expect(apart, `${room.name}: ${a.wall}@${a.offset} and ${b.wall}@${b.offset} are the same hole`).toBe(true);
        }
      }
    }
  });
});

/* ---------- the migration ---------- */

/** The demo's own plan as it stood before SEED_VERSION 10: five rooms, feet, and no drawing. */
function olderDemoPlan(): TourFloorPlan {
  return {
    units: 'feet',
    floors: [
      {
        label: 'Third floor',
        rooms: [
          { name: 'Living room', type: 'living', width: 5.3086, depth: 5.7912, dimensionsText: `17'-5" × 19'-0"`, dimensionsFrom: 'text' },
          { name: 'Dining room', type: 'dining', width: 3.302, depth: 4.0894, dimensionsText: `10'-10" × 13'-5"`, dimensionsFrom: 'text' },
          { name: 'Primary bedroom', type: 'bedroom', width: 3.3274, depth: 3.7846, dimensionsText: `10'-11" × 12'-5"`, dimensionsFrom: 'text' },
          { name: 'Second bedroom', type: 'bedroom', width: 2.7432, depth: 3.048, dimensionsText: `9'-0" × 10'-0"`, dimensionsFrom: 'text' },
          { name: 'Kitchen', type: 'kitchen', width: 2.5908, depth: 3.4036, dimensionsText: `8'-6" × 11'-2"`, dimensionsFrom: 'text' },
        ],
      },
    ],
    northArrow: { present: true, direction: 'up' },
    notes: ['Dimensions are printed to the nearest inch, as drawn.'],
    source: 'heuristic',
    parsedAt: 1_757_000_000_000,
  };
}

/** Which top-level keys differ between two records, ignoring the store's own `updatedAt` stamp. */
function changed(before: object, after: object): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete('updatedAt');
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

describe('the seed migration', () => {
  it('replaces the demo’s older plan and touches nothing else on the tour or its rooms', () => {
    const id = tour().id;
    const seeded = { tour: tour(), rooms: Object.fromEntries(rooms().map((r) => [r.id, r])) };

    // Wind the store back to a browser seeded before SEED_VERSION 10.
    useAudora.setState((s) => ({
      tours: { ...s.tours, [id]: { ...s.tours[id], floorPlan: olderDemoPlan() } },
      rooms: Object.fromEntries(
        Object.entries(s.rooms).map(([rid, r]) => {
          const { planDims: _planDims, measurement: _measurement, ...rest } = r;
          return [rid, rest as Room];
        }),
      ),
    }));
    const before = { tour: tour(), rooms: Object.fromEntries(rooms().map((r) => [r.id, r])) };

    migrateDemoPlan(id);

    // The tour gains the plan and nothing else.
    expect(changed(before.tour, tour())).toEqual(['floorPlan']);
    expect(tour().floorPlan?.fileName).toBe(DEMO_PLAN_FILE);
    expect(tour().floorPlan?.floors[0].rooms).toHaveLength(PLAN_ROOMS);

    // Each room gains its plan dimensions and its measurement, and nothing else.
    for (const room of rooms()) {
      const was = before.rooms[room.id];
      const keys = changed(was, room);
      const expected = room.name === 'Furnished flat' ? [] : ['measurement', 'planDims'];
      expect(keys, room.name).toEqual(expected);
    }

    // And it lands on exactly the state a fresh seed produces.
    for (const room of rooms()) {
      expect(room.planDims, room.name).toEqual(seeded.rooms[room.id].planDims);
      expect(room.measurement, room.name).toEqual(seeded.rooms[room.id].measurement);
    }
  });

  it('is deterministic: running it twice changes nothing', () => {
    const id = tour().id;
    const before = rooms().map((r) => JSON.stringify(r.measurement ?? null));
    migrateDemoPlan(id);
    expect(rooms().map((r) => JSON.stringify(r.measurement ?? null))).toEqual(before);
  });

  it('leaves a plan the leasing team uploaded alone', () => {
    const id = tour().id;
    const theirs: TourFloorPlan = { ...demoFloorPlan(), source: 'nebius', fileName: 'unit-3-agent-copy.jpg', model: 'vision', parsedAt: 1_757_100_000_000 };
    useAudora.getState().updateTour(id, { floorPlan: theirs });
    migrateDemoPlan(id);
    expect(tour().floorPlan).toEqual(theirs);
  });
});
