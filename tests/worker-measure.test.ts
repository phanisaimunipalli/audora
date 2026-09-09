/// <reference types="node" />
/**
 * Server-side measurement, end to end — docs/ACCURACY.md §3.2.
 *
 * The whole path runs here with no network, no Supabase and no provider: the mock provider's
 * `collider.glb` is a real room written by server/mockAssets.ts, the worker copies it into the fake
 * storage and measures it, and `shared/collider.ts` + `shared/fusion.ts` turn those bytes into the
 * metres a published room shows. Because the mock's room is 5.00 × 6.00 × 3.50 raw units and the
 * fixture's anchor is 0.70 m per unit, **every expected number below is arithmetic on those two
 * facts** — 3.50 × 4.20 m with a 2.45 m ceiling — rather than a value copied out of a previous run.
 *
 * The three questions: does a mock generation leave a measurement behind, does correcting a plan
 * dimension re-fuse and report the disagreement, and does the recipe hash move when (and only when)
 * an input the model sees has changed.
 */
import { describe, expect, it } from 'vitest';
import {
  createUnit,
  addPhoto,
  generateUnit,
  measureColliderBytes,
  measureRoom,
  planRecipes,
  publicTour,
  publishUnit,
  type PlanContext,
  type RoomGeometryJson,
  type RoomMeasurement,
  type RoomRow,
  type Row,
  type WorldRow,
} from '../server/pipeline';
import { handleV1, type V1Context, type V1Request, type V1Response } from '../server/routes';
import { mockProvider, runWorkerOnce, type WorldProvider } from '../server/worker';
import { MOCK_ROOM, MOCK_ROOM_METRES_PER_UNIT, mockColliderGlb } from '../server/mockAssets';
import { orientPlan } from '../shared/fusion';
import { ceilingUnitsOf, wallFacingCapture, type ExifCamera } from '../shared/exifPrior';
import type { Actor } from '../server/auth';
import { DOOR_ANCHOR, FakeDb, FakeStorage, START, clock, pngDataUrl, type Clock } from './support/backend';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACTOR: Actor = { userId: '99999999-9999-4999-8999-999999999999', email: 'agent@example.com', orgId: ORG, role: 'owner', dev: false };
const PHOTO = pngDataUrl(6, 4, [40, 60, 80]);
const PLAN: PlanContext = { pipelineVersion: '1', provider: 'mock', model: 'mock-draft-1' };

/** What the mock's collider really is, in metres, at the fixture's anchor. The test's ground truth. */
const TRUE = {
  width: MOCK_ROOM.width * MOCK_ROOM_METRES_PER_UNIT, // 3.50
  depth: MOCK_ROOM.depth * MOCK_ROOM_METRES_PER_UNIT, // 4.20
  height: MOCK_ROOM.height * MOCK_ROOM_METRES_PER_UNIT, // 2.45
};

/** A plan that agrees with the model: the drawing and the reconstruction describe the same room. */
const PLAN_DIMS = { width: TRUE.width, depth: TRUE.depth, height: TRUE.height };

/** The anchor the fixture taps is 0.70 m/unit exactly — the scale the mock room was drawn for. */
const ANCHOR = { ...DOOR_ANCHOR, metresPerUnit: MOCK_ROOM_METRES_PER_UNIT };

function backend() {
  const clk = clock();
  return { clk, db: new FakeDb(clk), storage: new FakeStorage() };
}

/** One unit, one photographed and anchored room: the smallest thing that can generate and measure. */
async function seedUnit(db: FakeDb, storage: FakeStorage, planDims: Record<string, number> | null = PLAN_DIMS) {
  const created = await createUnit(db, ORG, {
    address: '1247 Oak Street',
    lat: 37.7749,
    lon: -122.4194,
    rooms: [{ name: 'Bedroom', type: 'bedroom', planDims, anchor: ANCHOR }],
  });
  await addPhoto(db, storage, ORG, created.unit.id, { roomId: created.rooms[0].id, role: 'primary', dataUrl: PHOTO });
  return { ...created, room: created.rooms[0] };
}

/** Tick until the queue is empty, five seconds at a time — what the real loop does between polls. */
async function drain(db: FakeDb, storage: FakeStorage, provider: WorldProvider, clk: Clock, max = 12) {
  for (let i = 0; i < max; i += 1) {
    const result = await runWorkerOnce(db, storage, provider, 'worker-1', { env: { MARBLE_MOCK: '1' }, now: () => clk.ms });
    if (!result.claimed) return;
    clk.ms += 5_000;
  }
}

/** Generate one unit through the mock provider and run it to done. */
async function generated(planDims: Record<string, number> | null = PLAN_DIMS) {
  const { db, storage, clk } = backend();
  const seeded = await seedUnit(db, storage, planDims);
  const summary = await generateUnit(db, ORG, seeded.unit.id, 'draft', PLAN, clk.ms);
  await drain(db, storage, mockProvider(), clk);
  return { db, storage, clk, ...seeded, worldId: summary.rooms[0].worldId };
}

const roomOf = (db: FakeDb, id: string) => db.row<RoomRow>('rooms', id)!;
const measurementOf = (db: FakeDb, id: string) => roomOf(db, id).measurement as unknown as RoomMeasurement;
const geometryOf = (db: FakeDb, id: string) => roomOf(db, id).geometry as unknown as RoomGeometryJson;

/* ---------- the PATCH route, called the way server/api.ts calls it ---------- */

class Res implements V1Response {
  statusCode = 200;
  body = '';
  setHeader(): void {}
  end(chunk: string): void {
    this.body = chunk;
  }
}

async function patchRoom(db: FakeDb, storage: FakeStorage, clk: Clock, unitId: string, roomId: string, patch: unknown, method = 'PATCH') {
  const res = new Res();
  const req: V1Request = { method, url: `/api/v1/units/${unitId}/rooms/${roomId}`, headers: {} };
  const ctx: V1Context = { db, storage, env: {}, readBody: async () => patch, auth: async () => ACTOR, now: () => clk.ms };
  const handled = await handleV1(req, res, ctx);
  return { handled, status: res.statusCode, body: JSON.parse(res.body || 'null') as Record<string, unknown> };
}

/* ---------- 1. the worker measures what it copied ---------- */

describe('the worker measures the collider it just stored', () => {
  it('writes the mesh onto the world and the metric room onto the room', async () => {
    const { db, clk, room, worldId } = await generated();

    const world = db.row<WorldRow>('worlds', worldId)!;
    expect(world.status).toBe('done');
    // The mesh, in its own raw units: the room is 5.00 × 6.00 × 3.50 and the fit found it.
    const bounds = world.bounds as unknown as { walls?: { minX: number; maxX: number; minZ: number; maxZ: number; score?: number }; method?: string; floorY?: number; ceilingY?: number; minX: number; maxX: number };
    expect(bounds.method).toBe('walls');
    expect(bounds.walls!.maxX - bounds.walls!.minX).toBeCloseTo(MOCK_ROOM.width, 1);
    expect(bounds.walls!.maxZ - bounds.walls!.minZ).toBeCloseTo(MOCK_ROOM.depth, 1);
    expect(bounds.walls!.score ?? 0).toBeGreaterThan(0.6);
    expect(bounds.ceilingY! - bounds.floorY!).toBeCloseTo(MOCK_ROOM.height, 1);
    // And it is emphatically not the bounding box: the model saw six times too far through the
    // open door, so the box is three rooms wide. That gap is the reason the measurement exists.
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(2 * MOCK_ROOM.width);
    const raw = world.raw as unknown as { width: number; depth: number; height: number };
    expect(raw.width).toBeCloseTo(MOCK_ROOM.width, 1);
    expect(raw.depth).toBeCloseTo(MOCK_ROOM.depth, 1);

    // The room, in metres, from the plan + the anchor + the printed ceiling, which all agree.
    const geometry = geometryOf(db, room.id);
    expect(geometry.width).toBeCloseTo(TRUE.width, 2);
    expect(geometry.depth).toBeCloseTo(TRUE.depth, 2);
    expect(geometry.height).toBeCloseTo(TRUE.height, 2);
    expect(geometry.door.wall).toBe('south');
    expect(roomOf(db, room.id).raw).toBeTruthy();
    // Written with the worker's own clock, which is an input: no `Date.now()` anywhere on this path.
    const measuredAt = Date.parse(String(roomOf(db, room.id).measured_at));
    expect(measuredAt).toBeGreaterThan(0);
    expect(measuredAt).toBeLessThanOrEqual(clk.ms);
  });

  it('records the fused scale, every source that fed it, and no flags when they agree', async () => {
    const { db, room, worldId } = await generated();
    const m = measurementOf(db, room.id);

    expect(m.scale).toBeCloseTo(MOCK_ROOM_METRES_PER_UNIT, 3);
    expect(m.sigmaRel).toBeGreaterThan(0);
    expect(m.sigmaRel).toBeLessThan(0.01);
    expect(m.confidence).toBeGreaterThan(0.9);
    expect(m.method).toBe('walls');
    expect(m.oneRoom).toBe(true);
    expect(m.worldId).toBe(worldId);
    expect(m.measuredAt).toBe(roomOf(db, room.id).measured_at);
    // Plan width, plan depth, the anchor and the printed ceiling: four independent sources.
    expect(m.residuals.map((r) => r.source).sort()).toEqual(['anchor', 'ceiling', 'plan-depth', 'plan-width']);
    expect(m.residuals.every((r) => r.sigmas <= 2)).toBe(true);
    expect(m.flags).toEqual([]);
    expect(m.lines.map((l) => l.dimension)).toEqual(['width', 'depth', 'height']);
    expect(m.lines[0].text).toMatch(/^Plan says 3\.50 m · model measures 3\.50 m/);
  });

  it('stamps the world’s recipe hash and its stale flag onto the measurement it writes', async () => {
    // Not only on the PATCH path: "this room would generate a new world" is most useful on a room
    // the seller has never touched, which is exactly the room that used to carry neither field.
    const { db, room, worldId } = await generated();
    const m = measurementOf(db, room.id);
    expect(m.recipeHash).toBe(db.row<WorldRow>('worlds', worldId)!.recipe_hash);
    expect(m.stale).toBe(false);
  });

  it('measures a room with no plan from its anchor and the standard ceiling alone', async () => {
    const withPlan = await generated();
    const bare = await generated(null);
    const m = measurementOf(bare.db, bare.room.id);

    expect(m.residuals.map((r) => r.source)).toEqual(['anchor', 'ceiling']);
    expect(m.residuals.find((r) => r.source === 'ceiling')?.label).toBe('assumed ceiling');
    // Two sources, one of them a ±12 cm assumption: measured, and honest about how well.
    expect(m.scale).toBeCloseTo(MOCK_ROOM_METRES_PER_UNIT, 2);
    expect(m.confidence).toBeGreaterThan(0);
    expect(m.confidence).toBeLessThan(measurementOf(withPlan.db, withPlan.room.id).confidence);
    expect(geometryOf(bare.db, bare.room.id).width).toBeCloseTo(TRUE.width, 1);
    // Nothing printed a width, so the line states the measurement and claims nothing about a plan.
    expect(m.lines[0].text).toMatch(/^Model measures 3\.5\d m$/);
  });

  it('reads "the plan was the other way round" off orientPlan, not off comparing two numbers', () => {
    const bounds = measureColliderBytes(mockColliderGlb(MOCK_ROOM));
    // A plan printed 4.20 × 3.50 against a room the model measures 3.50 × 4.20: exchanged.
    expect(measureRoom({ bounds, planDims: { width: TRUE.depth, depth: TRUE.width }, anchor: ANCHOR, now: START }).measurement.planSwapped).toBe(true);
    // Taken exactly as drawn: never claimed.
    expect(measureRoom({ bounds, planDims: PLAN_DIMS, anchor: ANCHOR, now: START }).measurement.planSwapped).toBeUndefined();
    // The case the old value comparison could not see: `plan_dims` is rounded to the centimetre
    // before it is stored, so a room read as square arrives with two identical numbers and the
    // comparison is blind by construction. `orientPlan` still gives a definite answer, and it is
    // that answer the measurement records — the flag no longer depends on the two differing.
    const side = 4;
    const square = measureRoom({ bounds, planDims: { width: side, depth: side }, anchor: ANCHOR, now: START });
    expect(square.measurement.planSwapped).toBe(orientPlan(square.raw, { width: side, depth: side }).swapped || undefined);
  });

  it('sets a wall rectangle aside when it measures a floor plan rather than a room', () => {
    // 14 × 14 raw units is 9.8 × 9.8 m at this anchor: 96 m², which is a flat. Marble really does
    // return this for a full-quality world of an open-plan unit (ARCHITECTURE.md, "still open").
    const bounds = measureColliderBytes(mockColliderGlb({ ...MOCK_ROOM, width: 14, depth: 14, door: null }));
    expect(bounds.method).toBe('walls');

    const measured = measureRoom({ bounds, anchor: ANCHOR, now: START });

    // The rectangle stays on the record, unused: `aabb` is what tells every reader to place the
    // capture from the bounding box instead of a rectangle that is not this room.
    expect(measured.bounds.walls).toBeTruthy();
    expect(measured.bounds.method).toBe('aabb');
    expect(measured.measurement.oneRoom).toBe(false);
    expect(measured.measurement.confidence).toBe(0);
    expect(measured.measurement.flags.at(-1)).toMatch(/which is not one room/);
    // And the scale is still the honest one: the anchor did not stop being 0.70 m per unit.
    expect(measured.measurement.scale).toBeCloseTo(MOCK_ROOM_METRES_PER_UNIT, 2);
  });

  it('serves the measurement with the room in the public tour', async () => {
    const { db, storage, clk, unit, room } = await generated();
    await publishUnit(db, ORG, unit.id, true, { now: clk.ms });

    const tour = await publicTour(db, storage, (await db.select<{ share_id: string }>('publications', { filters: { unit_id: unit.id }, single: true }))!.share_id);
    const published = tour.rooms.find((r) => r.id === room.id)!;
    expect((published.measurement as unknown as RoomMeasurement).scale).toBeCloseTo(MOCK_ROOM_METRES_PER_UNIT, 3);
    expect(published.measuredAt).toBe(roomOf(db, room.id).measured_at);
    expect((published.geometry as unknown as RoomGeometryJson).width).toBeCloseTo(TRUE.width, 2);
    // …but not the recipe. The stored measurement carries the hash for the seller's hub; the buyer's
    // copy must not, because the hash is a fingerprint of the prompt, the photos and the tier.
    expect(measurementOf(db, room.id).recipeHash).toBeTruthy();
    const shown = published.measurement as unknown as Record<string, unknown>;
    expect(shown.recipeHash).toBeUndefined();
    expect(shown.stale).toBeUndefined();
    expect(JSON.stringify(tour)).not.toContain('recipe');
  });
});

/* ---------- 2. correcting a plan dimension ---------- */

describe('PATCH /api/v1/units/:id/rooms/:roomId', () => {
  it('re-fuses at once and flags a plan dimension that disagrees by more than 2σ', async () => {
    const { db, storage, clk, unit, room } = await generated();
    const before = measurementOf(db, room.id);

    // 3.75 m where the model measures 3.50: five sigmas of plan error, which is not noise.
    const patched = await patchRoom(db, storage, clk, unit.id, room.id, { planDims: { ...PLAN_DIMS, width: 3.75 } });

    expect(patched.status).toBe(200);
    expect(patched.body.changed).toEqual(['plan_dims']);
    const m = measurementOf(db, room.id);
    expect(m.measuredAt).not.toBe(before.measuredAt);
    // The fit moves toward the plan — it is the tightest source — but not all the way, and it says so.
    expect(m.scale).toBeGreaterThan(before.scale);
    expect(m.flags).toHaveLength(1);
    expect(m.flags[0]).toMatch(/^plan width says 3\.75 m, model measures 3\.5\d m \(\d\.\dσ\)\.$/);
    const width = m.residuals.find((r) => r.source === 'plan-width')!;
    expect(width.expected).toBe(3.75);
    expect(width.sigmas).toBeGreaterThan(2);
    // A source in that much disagreement is not a precision problem, so the confidence collapses.
    expect(m.confidence).toBeLessThan(0.2);
    expect(m.lines[0].text).toMatch(/^Plan says 3\.75 m · model measures 3\.5\d m \(−0\.\d\d m\)$/);
    // The room's own numbers moved with the fit, and the answer carried them back.
    expect(geometryOf(db, room.id).width).toBeCloseTo(m.scale * MOCK_ROOM.width, 2);
    expect((patched.body.measurement as RoomMeasurement).scale).toBe(m.scale);
  });

  it('renames a room without touching its measurement', async () => {
    const { db, storage, clk, unit, room } = await generated();
    const before = measurementOf(db, room.id);

    const patched = await patchRoom(db, storage, clk, unit.id, room.id, { name: 'Primary bedroom' });

    expect(patched.status).toBe(200);
    expect(patched.body.changed).toEqual(['name']);
    expect(roomOf(db, room.id).name).toBe('Primary bedroom');
    const m = measurementOf(db, room.id);
    expect(m.scale).toBe(before.scale);
    expect(m.flags).toEqual([]);
    expect(m.stale).toBe(false);
  });

  it('refuses a room of another unit, an unknown room and an empty patch', async () => {
    const { db, storage, clk, unit, room } = await generated();
    const other = await createUnit(db, ORG, { address: '9 Mission St' });

    expect((await patchRoom(db, storage, clk, other.unit.id, room.id, { name: 'Nope' })).status).toBe(404);
    expect((await patchRoom(db, storage, clk, unit.id, unit.id, { name: 'Nope' })).status).toBe(404);
    expect((await patchRoom(db, storage, clk, unit.id, room.id, {})).status).toBe(400);
    expect((await patchRoom(db, storage, clk, unit.id, room.id, { planDims: { width: -3 } })).status).toBe(400);
    // The route exists only for PATCH; a GET of the same path is a 404 with the rest of them.
    expect((await patchRoom(db, storage, clk, unit.id, room.id, {}, 'GET')).status).toBe(404);
    expect(roomOf(db, room.id).name).toBe('Bedroom');
  });

  it('measures a room whose world was generated before the patch, even with no plan at all', async () => {
    const { db, storage, clk, unit, room } = await generated(null);

    const patched = await patchRoom(db, storage, clk, unit.id, room.id, { plan_dims: { width: 3.5, depth: 4.2, height: 2.45 } });

    expect(patched.status).toBe(200);
    const m = measurementOf(db, room.id);
    expect(m.residuals.map((r) => r.source).sort()).toEqual(['anchor', 'ceiling', 'plan-depth', 'plan-width']);
    expect(m.residuals.find((r) => r.source === 'ceiling')?.label).toBe('printed ceiling');
    expect(m.confidence).toBeGreaterThan(0.9);
  });
});

/* ---------- 3. the recipe, and what a correction does to it ---------- */

describe('the recipe a room would generate', () => {
  const hashOf = async (db: FakeDb, unitId: string) => (await planRecipes(db, ORG, unitId, 'draft', PLAN)).planned[0].hash;

  it('is unchanged by a rename and changed by a plan dimension', async () => {
    const { db, storage, clk, unit, room, worldId } = await generated();
    const generatedHash = db.row<WorldRow>('worlds', worldId)!.recipe_hash;
    expect(await hashOf(db, unit.id)).toBe(generatedHash);

    const renamed = await patchRoom(db, storage, clk, unit.id, room.id, { name: 'Primary bedroom' });
    expect(await hashOf(db, unit.id)).toBe(generatedHash);
    expect(renamed.body.recipe).toMatchObject({ hash: generatedHash, worldRecipeHash: generatedHash, stale: false });

    const corrected = await patchRoom(db, storage, clk, unit.id, room.id, { planDims: { ...PLAN_DIMS, width: 3.75 } });
    const after = await hashOf(db, unit.id);
    expect(after).not.toBe(generatedHash);
    expect(corrected.body.recipe).toMatchObject({ hash: after, worldRecipeHash: generatedHash, stale: true });
    expect(measurementOf(db, room.id).stale).toBe(true);
  });

  it('decides whether the next generate builds a world or attaches the one it has', async () => {
    const { db, storage, clk, unit, room } = await generated();

    // A rename changes nothing the model sees, so the same recipe attaches the same world.
    await patchRoom(db, storage, clk, unit.id, room.id, { name: 'Primary bedroom' });
    expect(await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms)).toMatchObject({ attached: 1, enqueued: 0 });
    expect(db.rows('worlds')).toHaveLength(1);

    // A corrected dimension is a different prompt and a different seed: a new world, and only then.
    await patchRoom(db, storage, clk, unit.id, room.id, { planDims: { ...PLAN_DIMS, width: 3.75 } });
    expect(await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms)).toMatchObject({ attached: 0, enqueued: 1 });
    expect(db.rows('worlds')).toHaveLength(2);
  });

  it('keeps re-fusing from the finished world while a new one is generating', async () => {
    const { db, storage, clk, unit, room } = await generated();
    await patchRoom(db, storage, clk, unit.id, room.id, { planDims: { ...PLAN_DIMS, width: 3.75 } });
    await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);

    // The room now points at a queued world with no mesh; the measurement still comes from the one
    // that finished, because that is the capture the seller is looking at.
    const patched = await patchRoom(db, storage, clk, unit.id, room.id, { planDims: PLAN_DIMS });
    expect(patched.status).toBe(200);
    expect((patched.body.measurement as RoomMeasurement).flags).toEqual([]);
    expect(geometryOf(db, room.id).width).toBeCloseTo(TRUE.width, 2);
  });
});

/* ---------- 5. the EXIF field of view reaches the fit ---------- */

/**
 * The prior is only ever fed from `photos.exif`, which `server/photos.ts` reads off the upload and
 * then strips. The fixture's PNG carries none, so the camera below is written onto the stored row —
 * which is exactly the shape the worker reads — and its focal length is derived from the mock
 * room's own collider rather than picked: the lens that frames the wall the photographer faced,
 * floor to ceiling, is the one photograph the prior's assumption is actually true of.
 */
describe('the EXIF field of view, from the photos table to the residual line', () => {
  const PIXELS = { width: 4032, height: 3024 };

  /** The 35 mm equivalent that frames a mock room's far wall exactly, whole millimetres as a camera writes it. */
  function framingLens(spec?: Parameters<typeof mockColliderGlb>[0]): number {
    const bounds = measureColliderBytes(mockColliderGlb(spec));
    const facing = wallFacingCapture(bounds)!;
    const tanV = ceilingUnitsOf(bounds) / (2 * facing.distance);
    const tanH = tanV * (PIXELS.width / PIXELS.height);
    return Math.round(36 / (2 * tanH));
  }

  /** Put a camera on the room's stored photo, the way `canonicalizePhoto` would have. */
  async function withCamera(db: FakeDb, roomId: string, exif: ExifCamera | null) {
    await db.update('photos', { room_id: roomId }, { exif: (exif as unknown as Row) ?? null, width: PIXELS.width, height: PIXELS.height });
  }

  /** Generate a unit, but stamp the camera on before the worker gets to measure. */
  async function generatedWithCamera(exif: ExifCamera | null) {
    const { db, storage, clk } = backend();
    const seeded = await seedUnit(db, storage, null);
    await withCamera(db, seeded.room.id, exif);
    await generateUnit(db, ORG, seeded.unit.id, 'draft', PLAN, clk.ms);
    await drain(db, storage, mockProvider(), clk);
    return { db, storage, clk, ...seeded };
  }

  it('appears as a residual when the primary photo carries a lens the prior can read', async () => {
    const camera: ExifCamera = { make: 'Apple', model: 'iPhone 13 Pro', focalLength35: framingLens() };
    const { db, room } = await generatedWithCamera(camera);
    const row = measurementOf(db, room.id).residuals.find((r) => r.source === 'exif');
    expect(row?.label).toBe('EXIF field of view');
    // A prior, never a measurement: it is marked assumed and does not corroborate the anchor.
    expect(row?.assumed).toBe(true);
    expect(measurementOf(db, room.id).independentSources).toBe(1);
    // It agrees with the room the mock collider really is, so it moves the scale by very little.
    expect(geometryOf(db, room.id).width).toBeCloseTo(TRUE.width, 1);
  });

  it('is absent when the photo has no EXIF at all', async () => {
    const { db, room } = await generatedWithCamera(null);
    expect(measurementOf(db, room.id).residuals.some((r) => r.source === 'exif')).toBe(false);
    // and the room is still measured from everything else
    expect(geometryOf(db, room.id).width).toBeCloseTo(TRUE.width, 2);
  });

  it('is absent when the camera is unknown and wrote no 35 mm equivalent', async () => {
    const { db, room } = await generatedWithCamera({ make: 'Acme', model: 'Cameraphone 1', focalLength: 4.2 });
    expect(measurementOf(db, room.id).residuals.some((r) => r.source === 'exif')).toBe(false);
  });

  it('survives a plan correction, because the PATCH re-fuses with the same photo', async () => {
    const camera: ExifCamera = { make: 'Apple', model: 'iPhone 13 Pro', focalLength35: framingLens() };
    const { db, storage, clk, unit, room } = await generatedWithCamera(camera);
    const patched = await patchRoom(db, storage, clk, unit.id, room.id, { planDims: PLAN_DIMS });
    expect(patched.status).toBe(200);
    expect((patched.body.measurement as RoomMeasurement).residuals.some((r) => r.source === 'exif')).toBe(true);
  });

  /**
   * A collider that reconstructed down a corridor: its wall rectangle is a real 3.29 × 9.10 m
   * measurement, which is not one room (over the 9 m side), so pass two records the extent as
   * `aabb` — and `writeMeasurement` stores exactly that on the world, which is what the next
   * `PATCH` re-fuses from.
   */
  const THROUGH_THE_DOOR = { ...MOCK_ROOM, width: 4.7, depth: 13 };

  it('survives the room being re-measured from the record the first measurement wrote', () => {
    const camera: ExifCamera = { make: 'Apple', model: 'iPhone 13 Pro', focalLength35: framingLens(THROUGH_THE_DOOR) };
    const photo = { exif: camera, ...PIXELS };
    const bounds = measureColliderBytes(mockColliderGlb(THROUGH_THE_DOOR));
    expect(bounds.method).toBe('walls');

    const first = measureRoom({ bounds, anchor: ANCHOR, photo, now: START });
    expect(first.measurement.oneRoom).toBe(false);
    expect(first.bounds.method).toBe('aabb');
    expect(first.measurement.residuals.some((r) => r.source === 'exif')).toBe(true);

    /* The second measurement is handed the bounds the first one stored, which is the whole of what
       a plan correction has to go on. It must fit from the same rectangle: reading `method` back as
       the fit's input measured the bounding box instead of the room, which moved a real room's
       published scale by 48 % on a no-op PATCH and took the wall the photograph faces to the far
       side of the box, so the field-of-view prior was withheld the second time round. */
    const again = measureRoom({ bounds: first.bounds, anchor: ANCHOR, photo, now: START });
    expect(again.measurement).toEqual(first.measurement);
    expect(again.raw).toEqual(first.raw);
    expect(again.bounds).toEqual(first.bounds);
    expect(again.geometry).toEqual(first.geometry);
  });

  /** The mock provider, but the collider it copies ran down the corridor beyond the door. */
  function throughTheDoorProvider(): WorldProvider {
    const base = mockProvider();
    const bytes = mockColliderGlb(THROUGH_THE_DOOR);
    return {
      ...base,
      async fetchAsset(url: string) {
        const asset = await base.fetchAsset(url);
        return url.endsWith('collider.glb') ? { ...asset, bytes } : asset;
      },
    };
  }

  it('is still there after a plan correction on a room whose collider is not one room', async () => {
    const camera: ExifCamera = { make: 'Apple', model: 'iPhone 13 Pro', focalLength35: framingLens(THROUGH_THE_DOOR) };
    const { db, storage, clk } = backend();
    const seeded = await seedUnit(db, storage, null);
    await withCamera(db, seeded.room.id, camera);
    await generateUnit(db, ORG, seeded.unit.id, 'draft', PLAN, clk.ms);
    await drain(db, storage, throughTheDoorProvider(), clk);

    const measured = measurementOf(db, seeded.room.id);
    expect(measured.oneRoom).toBe(false);
    expect(measured.residuals.map((r) => r.source)).toContain('exif');

    /* The correction that corrects nothing — the same (absent) plan dimensions the room already
       holds. It must report the room the worker measured, not a second, different one. */
    const patched = await patchRoom(db, storage, clk, seeded.unit.id, seeded.room.id, { planDims: null });
    const after = patched.body.measurement as RoomMeasurement;
    expect(after.scale).toBeCloseTo(measured.scale, 6);
    expect(after.sigmaRel).toBeCloseTo(measured.sigmaRel, 6);
    expect(after.residuals.map((r) => r.source)).toEqual(measured.residuals.map((r) => r.source));
    expect(after.lines.map((l) => l.text)).toEqual(measured.lines.map((l) => l.text));
  });

  it('shares one group with the ceiling it is closed on, so the assumption is not counted twice', () => {
    const bounds = measureColliderBytes(mockColliderGlb());
    const camera: ExifCamera = { make: 'Apple', model: 'iPhone 13 Pro', focalLength35: framingLens() };
    const withPrior = measureRoom({ bounds, anchor: ANCHOR, photo: { exif: camera, ...PIXELS }, now: START });
    const without = measureRoom({ bounds, anchor: ANCHOR, now: START });
    expect(withPrior.measurement.residuals.some((r) => r.source === 'exif')).toBe(true);
    /* Grouped with the ceiling, the prior cannot tighten σ by pretending to be a second opinion
       about the same 2.44 m: it splits the ceiling group's weight rather than adding to it. Ungrouped
       it used to report roughly 5 % less σ than it had earned. */
    expect(withPrior.measurement.sigmaRel).toBeGreaterThanOrEqual(without.measurement.sigmaRel - 1e-9);
    expect(withPrior.measurement.independentSources).toBe(without.measurement.independentSources);
  });
});
