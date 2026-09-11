/**
 * `npx audora generate ./photos` → one URL that works (docs/CLI.md).
 *
 * The CLI writes `.audora/local/units/<id>.json`, the server serves it, and
 * `src/services/localUnit.ts` turns it into the same store records a tour made in the app has — so
 * the viewer walks, measures and maps a local unit without knowing it is one. What is pinned here:
 *
 *  1. **The conversion.** A fixture unit file becomes a tour whose `shareId` IS the unit id, rooms
 *     whose anchors come from what the file actually knows (the model's own metric scale, else the
 *     drawing, else the assumed ceiling), and worlds whose every asset URL points at
 *     `/local-assets/…` rather than at the provider's CDN.
 *  2. **The unit is a unit.** With a plan in the file, `unitModel`/`roomPlan` build the graph the
 *     map and the portals are drawn from — the same functions the demo unit goes through.
 *  3. **Idempotence.** Re-opening the link re-imports only when the bytes changed, and when they do
 *     the rooms keep their ids (so `/t/<unit>/<room>` still works) and pick up the new numbers.
 *  4. **Not-found still means not-found.** An id no local unit has leaves the store untouched.
 *
 * No network: `fetch` is a fake over an in-memory set of unit files, which is also the only thing
 * this module ever reaches for. Nothing here can call World Labs or Nebius.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAudora } from '@/state/store';
import { anchorForRoom, contentHash, importLocalUnit, localRoomId, localUnitUrl, openLocalUnit, rawForRoom, type LocalRoom, type LocalUnitFile } from '@/services/localUnit';
import { roomPlan, unitModel } from '@/screens/viewer/unit';
import { splatTransform } from '@/services/marble';
import { CEILING_HEIGHT_M } from '@/engine/anchor';
import type { Room, Tour } from '@/state/types';

/* ---------- the fixture: what the CLI writes ---------- */

const UNIT = '3f9a1c2e';
const ASSETS = (world: string) => ({
  spz: { '100k': `/local-assets/${world}/spz-100k.spz`, '500k': `/local-assets/${world}/spz-500k.spz` },
  collider: `/local-assets/${world}/collider.glb`,
  pano: `/local-assets/${world}/pano.png`,
  thumbnail: `/local-assets/${world}/thumb.webp`,
});

/** A collider that measured a real room: 4.37 × 5.91 raw units of walls inside a wider box. */
const BOUNDS = {
  minX: -3.6,
  maxX: 4.23,
  minY: -1.66,
  maxY: 1.89,
  minZ: -1.55,
  maxZ: 5.78,
  floorY: -1.6,
  ceilingY: 1.82,
  method: 'walls' as const,
  walls: { minX: -0.85, maxX: 3.52, minZ: -1.29, maxZ: 4.62, rotation: 0.82, score: 0.8, openings: [] },
};

/** The room in the world's own units, as `measureRoom` reported it: 1 unit ≈ 2.03/2.44 of a ceiling. */
const RAW = {
  width: 4.37,
  depth: 5.91,
  height: 3.42,
  door: { wall: 'south', offset: 2.18, width: 0.9, height: 1 },
  windows: [{ wall: 'north', offset: 2, width: 1.4, height: 1.5, sill: 1.2 }],
  doorHeightUnits: 2.85,
  outletHeightUnits: 0.42,
};

function room(over: Partial<LocalRoom> & { id: string }): LocalRoom {
  const worldId = `w-${over.id}`;
  return {
    name: over.name ?? over.id,
    type: over.type ?? 'living',
    order: over.order ?? 0,
    recipeHash: `hash-${over.id}`,
    seed: 12345,
    prompt: `An empty ${over.id}.`,
    model: 'marble-1.0-draft',
    ...over,
    world: {
      worldId,
      model: 'marble-1.0-draft',
      caption: `An empty ${over.id}.`,
      assets: ASSETS(worldId),
      metricScaleFactor: null,
      groundPlaneOffset: null,
      bounds: BOUNDS,
      raw: RAW,
      credits: 230,
      seconds: 38,
      createdAt: '2026-09-09T10:00:00.000Z',
      ...(over.world ?? {}),
    },
  };
}

/** The unit the tests import: a metric room, a room with printed dimensions, and a bare one. */
function unitFile(over: Partial<LocalUnitFile> = {}): LocalUnitFile {
  return {
    id: UNIT,
    name: 'Unit 3',
    createdAt: '2026-09-09T10:05:00.000Z',
    address: '1247 Oak St, San Francisco',
    tier: 'draft',
    rooms: [
      room({
        id: 'living',
        name: 'Living room',
        type: 'living',
        order: 0,
        planDims: { width: 5.3, depth: 5.78, height: 2.55, text: `17'-5" × 19'-0" (5.30 × 5.78 m)`, planRoomName: 'Living room', floor: 'Third floor' },
        measurement: {
          scale: 0.93,
          sigma: 0.02,
          sigmaRel: 0.02,
          confidence: 0.72,
          independentSources: 2,
          residuals: [],
          flags: [],
          lines: [],
          method: 'walls',
          oneRoom: true,
          worldId: 'w-living',
          measuredAt: '2026-09-09T10:04:00.000Z',
        },
      }),
      room({
        id: 'bedroom-1',
        name: 'Primary bedroom',
        type: 'bedroom',
        order: 1,
        world: { metricScaleFactor: 2.2239592, groundPlaneOffset: 1.3064681 },
      }),
      room({ id: 'kitchen', name: 'Kitchen', type: 'kitchen', order: 2 }),
    ],
    plan: {
      units: 'mixed',
      floors: [
        {
          label: 'Third floor',
          rooms: [
            { name: 'Living room', type: 'living', width: 5.3, depth: 5.78, height: 2.55, doors: 2, windows: 2 },
            { name: 'Primary bedroom', type: 'bedroom', width: 3.3, depth: 3.8, doors: 1, windows: 2 },
            { name: 'Kitchen', type: 'kitchen', width: 3.1, depth: 3.4, doors: 1, windows: 1 },
          ],
        },
      ],
      northArrow: { present: true, direction: 'up' },
      notes: [],
      source: 'heuristic',
      parsedAt: '2026-09-09T10:02:00.000Z',
      imageUrl: '/local-assets/plan/plan.png',
      fileName: 'plan.png',
    },
    ...over,
  };
}

/* ---------- the server, faked ---------- */

/** The unit files this machine has; `fetch` answers 404 for anything else, exactly as the server does. */
let served = new Map<string, string>();

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string) => {
    const body = served.get(String(url));
    if (body == null) return new Response(JSON.stringify({ error: 'no such unit' }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }),
);

const serve = (file: LocalUnitFile) => {
  const text = JSON.stringify(file);
  served.set(localUnitUrl(file.id), text);
  return text;
};

const tourOf = (shareId: string): Tour | undefined => Object.values(useAudora.getState().tours).find((t) => t.shareId === shareId);
const roomsOf = (tour: Tour): Room[] => tour.roomIds.map((id) => useAudora.getState().rooms[id]).filter(Boolean);
const roomNamed = (tour: Tour, name: string): Room => {
  const r = roomsOf(tour).find((x) => x.name === name);
  if (!r) throw new Error(`the imported unit has no room called ${name}`);
  return r;
};

beforeEach(() => {
  served = new Map();
  useAudora.setState({ tours: {}, rooms: {}, jobs: {}, events: [], deleted: {} });
});

/* ---------- 1. the conversion ---------- */

describe('a unit file becomes a tour the viewer can open', () => {
  beforeEach(async () => {
    serve(unitFile());
    expect(await openLocalUnit(UNIT)).toBe('imported');
  });

  it('puts the unit id on the tour as its share id, published and named', () => {
    const tour = tourOf(UNIT);
    expect(tour).toBeDefined();
    expect(tour?.shareId).toBe(UNIT);
    expect(tour?.title).toBe('Unit 3');
    expect(tour?.address).toBe('1247 Oak St, San Francisco');
    expect(tour?.published).toBe(true);
    expect(tour?.quality).toBe('draft');
    expect(tour?.localUnit?.id).toBe(UNIT);
  });

  it('gives every room a deterministic id, so /t/<unit>/<room> is the same link every time', () => {
    const tour = tourOf(UNIT) as Tour;
    expect(tour.roomIds).toEqual([localRoomId(UNIT, 'living'), localRoomId(UNIT, 'bedroom-1'), localRoomId(UNIT, 'kitchen')]);
    expect(roomsOf(tour).map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it('anchors each room on what the file actually knows', () => {
    const tour = tourOf(UNIT) as Tour;

    // The model measured itself, and nothing fused it: its own scale, quoted as the ceiling it implies.
    const metric = roomNamed(tour, 'Primary bedroom');
    expect(metric.anchor.method).toBe('marble');
    expect(metric.anchor.metresPerUnit).toBeCloseTo(2.2239592, 6);

    // Nothing but a reconstruction: the standard ceiling, and the room is that many metres tall.
    const bare = roomNamed(tour, 'Kitchen');
    expect(bare.anchor.method).toBe('ceiling');
    expect(bare.geometry.height).toBeCloseTo(CEILING_HEIGHT_M, 2);
  });

  it('shows the metres the CLI measured, not the printed width echoed back', () => {
    // The drawing printed 5.30 m, the fusion weighed it against the depth and the ceiling and came
    // out at 0.93 m per unit, and that is the number the terminal printed and stored in `geometry`.
    // Anchoring on the plan alone would put "5.30 × 6.36 m" on screen under a line that says the
    // model measures 4.06 m — the panel contradicting itself about one room.
    const planned = roomNamed(tourOf(UNIT) as Tour, 'Living room');
    expect(planned.anchor.method).toBe('floorplan'); // the source is still named
    expect(planned.anchor.metresPerUnit).toBeCloseTo(0.93, 6); // …at the fused scale
    expect(planned.geometry.width).toBeCloseTo(4.37 * 0.93, 3);
    expect(planned.geometry.depth).toBeCloseTo(5.91 * 0.93, 3);
    // The ± is the fusion's own, on the reference the chip quotes.
    expect(planned.anchor.uncertaintyM).toBeCloseTo(0.08, 6);
    expect(planned.anchor.label).toContain('measured');
  });

  it('keeps the measured scale after the world is attached, even when the model reports its own', () => {
    // `attachWorld` replaces an anchor with `anchorFromMarble` when a world carries a metric scale.
    // A room the CLI already measured must not lose the fused answer to that.
    serve(
      unitFile({
        id: 'msf12345',
        rooms: [
          room({
            id: 'living',
            name: 'Living room',
            world: { provider: 'marble', metricScaleFactor: 1.11 },
            measurement: { scale: 0.93, sigma: 0.02, sigmaRel: 0.02, confidence: 0.7, independentSources: 2, residuals: [], flags: [], lines: [], method: 'walls', oneRoom: true, measuredAt: '2026-09-09T10:04:00.000Z' },
          }),
        ],
        plan: undefined,
      }),
    );
    return openLocalUnit('msf12345').then(() => {
      const only = roomNamed(tourOf('msf12345') as Tour, 'Living room');
      expect(only.anchor.metresPerUnit).toBeCloseTo(0.93, 6);
      expect(only.geometry.height).toBeCloseTo(3.42 * 0.93, 3);
    });
  });

  it('points every asset at /local-assets, so the unit opens offline', () => {
    const world = roomNamed(tourOf(UNIT) as Tour, 'Living room').draft;
    expect(world?.provider).toBe('marble');
    expect(world?.worldId).toBe('w-living');
    expect(world?.spzUrls).toEqual(ASSETS('w-living').spz);
    // `pickSpz` prefers the 500k rung; the streamer climbs the rest from `spzUrls`.
    expect(world?.spzUrl).toBe('/local-assets/w-living/spz-500k.spz');
    expect(world?.colliderUrl).toBe('/local-assets/w-living/collider.glb');
    expect(world?.panoUrl).toBe('/local-assets/w-living/pano.png');
    expect(world?.thumbnailUrl).toBe('/local-assets/w-living/thumb.webp');
    for (const url of [world?.spzUrl, world?.colliderUrl, world?.panoUrl, world?.thumbnailUrl]) expect(url).toMatch(/^\/local-assets\//);
    // Provenance travels with the world: the recipe it was asked for, its seed and its prompt.
    expect(world?.recipeHash).toBe('hash-living');
    expect(world?.seed).toBe(12345);
    expect(world?.credits).toBe(230);
    expect(world?.createdAt).toBe(Date.parse('2026-09-09T10:00:00.000Z'));
  });

  it('keeps the measurement and the raw room the CLI printed, rather than re-deriving them', () => {
    const room = roomNamed(tourOf(UNIT) as Tour, 'Living room');
    expect(room.measurement?.worldId).toBe('w-living');
    expect(room.measurement?.scale).toBe(0.93);
    expect(room.measurement?.method).toBe('walls');
    expect(room.raw.width).toBeCloseTo(RAW.width, 6);
    expect(room.raw.depth).toBeCloseTo(RAW.depth, 6);
    expect(room.draft?.bounds?.walls?.rotation).toBeCloseTo(0.82, 6);
    expect(room.planDims?.text).toBe(`17'-5" × 19'-0" (5.30 × 5.78 m)`);
    expect(room.status).toBe('ready');
  });

  it('places the reconstruction the way every other Marble world is placed', () => {
    const room = roomNamed(tourOf(UNIT) as Tour, 'Living room');
    const t = splatTransform(room.draft as NonNullable<Room['draft']>, room.anchor.metresPerUnit, room.floorOffset);
    // The capture point stands above Audora's floor, the reconstruction is scaled by the room's own
    // anchor (a draft world carries no metric scale), and the room carries the turn the wall fit
    // found — the photographer faced a corner, and `roomRect` is the one place that is worked out.
    expect(t.position[1]).toBeGreaterThan(1);
    expect(t.scale).toBeCloseTo(room.anchor.metresPerUnit, 6);
    expect(t.metric).toBe(false);
    expect(t.planYaw).toBe(0);
    expect(t.yaw).toBe(t.rectYaw);
    expect(Math.abs(t.rectYaw)).toBeGreaterThan(0.1);
  });

  it('carries the floor plan, so the unit map and the portals have a unit to draw', () => {
    const tour = tourOf(UNIT) as Tour;
    expect(tour.floorPlan?.floors[0].label).toBe('Third floor');
    expect(tour.floorPlan?.imageUrl).toBe('/local-assets/plan/plan.png');
    const model = unitModel(tour.floorPlan, roomsOf(tour));
    expect(model.graph).not.toBeNull();
    expect(model.graph?.rooms.length).toBe(3);
    // Every photographed room is matched to the room the drawing names, which is what makes a
    // doorway on the plan a doorway the renter can walk through.
    expect(Object.keys(model.planRefs)).toHaveLength(3);
    const here = roomPlan(model, roomNamed(tour, 'Living room'));
    expect(here.unitRoom?.name).toBe('Living room');
    expect(here.match.portals.length).toBeGreaterThan(0);
  });
});

/* ---------- 2. a unit with nothing but photos ---------- */

describe('the happy path needs nothing but a room', () => {
  it('imports a unit with no plan, no dimensions and no address', async () => {
    serve({ id: 'bare1234', rooms: [room({ id: 'photos', name: 'Photos', type: 'other' })] });
    expect(await openLocalUnit('bare1234')).toBe('imported');
    const tour = tourOf('bare1234') as Tour;
    expect(tour.title).toBe('bare1234');
    expect(tour.floorPlan).toBeUndefined();
    const only = roomsOf(tour)[0];
    expect(only.status).toBe('ready');
    expect(only.anchor.method).toBe('ceiling');
    expect(unitModel(tour.floorPlan, roomsOf(tour)).graph).toBeNull();
  });

  it('says a simulated run was simulated (MARBLE_MOCK=1 writes real files from no capture)', async () => {
    serve({ id: 'mock1234', rooms: [room({ id: 'living', name: 'Living room', world: { provider: 'mock', model: 'mock-draft', worldUrl: 'https://example.invalid/w' } })] });
    expect(await openLocalUnit('mock1234')).toBe('imported');
    const world = roomNamed(tourOf('mock1234') as Tour, 'Living room').draft;
    expect(world?.provider).toBe('mock');
    expect(world?.marbleUrl).toBe('https://example.invalid/w');
    // The assets are still ours, so the room still renders.
    expect(world?.panoUrl).toBe('/local-assets/w-living/pano.png');
  });

  it('falls back to a deterministic room when a world carries no measurement at all', () => {
    const bare: LocalRoom = { id: 'living', name: 'Living', type: 'living', world: { worldId: 'w1', assets: ASSETS('w1') } };
    const a = rawForRoom(bare);
    const b = rawForRoom(bare);
    expect(a).toEqual(b);
    expect(anchorForRoom(a, bare).method).toBe('ceiling');
  });
});

/* ---------- 3. idempotence ---------- */

describe('re-opening the link re-imports only when the file changed', () => {
  it('does nothing at all the second time', async () => {
    serve(unitFile());
    expect(await openLocalUnit(UNIT)).toBe('imported');
    const before = tourOf(UNIT) as Tour;
    const roomsBefore = roomsOf(before);

    expect(await openLocalUnit(UNIT)).toBe('unchanged');
    const after = tourOf(UNIT) as Tour;
    // Identity, not equality: an unchanged file must not even touch the records, or every open of
    // the link would churn the store and every React tree hanging off it.
    expect(after).toBe(before);
    expect(roomsOf(after).every((r, i) => r === roomsBefore[i])).toBe(true);
  });

  it('picks up a regenerated unit, keeping the room ids its links are made of', async () => {
    serve(unitFile());
    await openLocalUnit(UNIT);
    const first = tourOf(UNIT) as Tour;
    const livingId = roomNamed(first, 'Living room').id;

    // The unit is generated again with a tighter drawing and one room fewer.
    const next = unitFile({
      name: 'Unit 3 (rev B)',
      rooms: [
        room({
          id: 'living',
          name: 'Living room',
          type: 'living',
          order: 0,
          planDims: { width: 5.1, depth: 5.78, height: 2.55, planRoomName: 'Living room', floor: 'Third floor' },
        }),
        room({ id: 'bedroom-1', name: 'Primary bedroom', type: 'bedroom', order: 1, world: { metricScaleFactor: 2.2239592 } }),
      ],
    });
    serve(next);

    expect(await openLocalUnit(UNIT)).toBe('imported');
    const after = tourOf(UNIT) as Tour;
    expect(after.id).toBe(first.id);
    expect(after.title).toBe('Unit 3 (rev B)');
    expect(after.roomIds).toEqual([localRoomId(UNIT, 'living'), localRoomId(UNIT, 'bedroom-1')]);
    // The renter standing in the living room keeps their link, and sees the new number.
    const living = roomNamed(after, 'Living room');
    expect(living.id).toBe(livingId);
    expect(living.planDims?.width).toBe(5.1);
    expect(living.geometry.width).toBeCloseTo(5.1, 2);
    // The room the regeneration dropped is gone, and gone from the tour.
    expect(useAudora.getState().rooms[localRoomId(UNIT, 'kitchen')]).toBeUndefined();
    expect(roomsOf(after)).toHaveLength(2);

    // A room that comes back is not held down by its own tombstone.
    serve(unitFile());
    expect(await openLocalUnit(UNIT)).toBe('imported');
    expect(useAudora.getState().deleted[localRoomId(UNIT, 'kitchen')]).toBeUndefined();
    expect(roomsOf(tourOf(UNIT) as Tour)).toHaveLength(3);
  });

  it('hashes the bytes, so the same file is the same hash and a changed one is not', () => {
    const a = serve(unitFile());
    const b = JSON.stringify(unitFile({ name: 'Unit 4' }));
    expect(contentHash(a)).toBe(contentHash(a));
    expect(contentHash(a)).not.toBe(contentHash(b));
  });

  it('imports the same file into the same records whichever way it is reached', () => {
    const file = unitFile();
    const hash = contentHash(JSON.stringify(file));
    const tourId = importLocalUnit(file, hash);
    const snapshot = JSON.stringify(useAudora.getState().tours[tourId].roomIds);
    expect(importLocalUnit(file, hash)).toBe(tourId);
    expect(JSON.stringify(useAudora.getState().tours[tourId].roomIds)).toBe(snapshot);
  });
});

/* ---------- 4. not found ---------- */

describe('an id no local unit has', () => {
  it('answers not-found and leaves the store alone', async () => {
    expect(await openLocalUnit('nosuch99')).toBe('not-found');
    expect(tourOf('nosuch99')).toBeUndefined();
    expect(Object.keys(useAudora.getState().tours)).toHaveLength(0);
  });

  it('does not swallow a server that is broken rather than empty', async () => {
    served.set(localUnitUrl('badjson1'), '{ not json');
    await expect(openLocalUnit('badjson1')).rejects.toThrow(/JSON/);
    expect(tourOf('badjson1')).toBeUndefined();
  });
});
