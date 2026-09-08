/// <reference types="node" />
/**
 * server/pipeline.ts and server/worker.ts end to end, against the in-memory doubles in
 * tests/support/backend.ts and the mock provider. Nothing here reaches World Labs, Nebius,
 * Supabase or the network at all: the mock provider's assets live in memory, and the only image
 * bytes involved are a PNG this test builds itself.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  addFloorPlan,
  addPhoto,
  createUnit,
  generateUnit,
  planRecipes,
  publicTour,
  publishUnit,
  recordEvent,
  shareIdForUnit,
  unitDocument,
  splitStoragePath,
  uuidFromHash,
  type PipelineDb,
  type PlanContext,
  type RoomRow,
  type WorldRow,
} from '../server/pipeline';
import { MOCK_POLLS_TO_FINISH, mockProvider, runWorkerOnce, type WorldProvider } from '../server/worker';
import { DOOR_ANCHOR, FakeDb, FakeStorage, clock, pngDataUrl, type Clock } from './support/backend';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const PLAN: PlanContext = { pipelineVersion: '1', provider: 'mock', model: 'mock-draft-1' };

const PHOTO_A = pngDataUrl(6, 4, [40, 60, 80]);
const PHOTO_B = pngDataUrl(5, 4, [200, 30, 10]);

/** The photo id `addPhoto` derives, restated here so the test pins the rule and not a magic value. */
const photoIdOf = (unitId: string, sha256: string) => uuidFromHash(createHash('sha256').update(`photo:${unitId}:${sha256}`, 'utf8').digest('hex'));

/** Present on this machine or not; the one case that needs a real decoder skips without it. */
const sharp = await import('sharp').then((m) => m.default).catch(() => null);

function backend() {
  const clk = clock();
  const db = new FakeDb(clk);
  const storage = new FakeStorage();
  return { clk, db, storage };
}

/** One unit, one bedroom with a plan, an anchor and a photo: the smallest thing that can generate. */
async function seedUnit(db: FakeDb, storage: FakeStorage, address = '1247 Oak Street') {
  const created = await createUnit(db, ORG, {
    address,
    lat: 37.7749,
    lon: -122.4194,
    site: { heading: 264 },
    unitNumber: '3B',
    floorLevel: 2,
    rooms: [{ name: 'Bedroom', type: 'bedroom', planDims: { width: 3.4, depth: 4.1, height: 2.6 }, anchor: DOOR_ANCHOR }],
  });
  const room = created.rooms[0];
  const photo = await addPhoto(db, storage, ORG, created.unit.id, { roomId: room.id, role: 'primary', dataUrl: PHOTO_A, origin: 'file' });
  return { ...created, room, photo: photo.photo };
}

/**
 * Tick the worker until nothing is claimed, moving the clock five seconds each time — which is
 * exactly what the real loop does between polls of a running operation.
 */
async function drain(db: FakeDb, storage: FakeStorage, provider: WorldProvider, clk: Clock, max = 12) {
  const ticks = [];
  for (let i = 0; i < max; i += 1) {
    const result = await runWorkerOnce(db, storage, provider, 'worker-1', { env: { MARBLE_MOCK: '1' }, now: () => clk.ms });
    ticks.push(result);
    if (!result.claimed) break;
    clk.ms += 5_000;
  }
  return ticks;
}

describe('createUnit', () => {
  it('creates the property once for the same address, whatever the spacing and case', async () => {
    const { db } = backend();
    const first = await createUnit(db, ORG, { address: '1247 Oak Street', rooms: [{ name: 'Living', type: 'living' }] });
    const second = await createUnit(db, ORG, { address: '  1247   oak street ', unitNumber: '2A' });

    expect(second.property.id).toBe(first.property.id);
    expect(db.rows('properties')).toHaveLength(1);
    expect(db.rows('units')).toHaveLength(2);
    expect(first.rooms).toHaveLength(1);
    expect(first.rooms[0].sort_order).toBe(0);
    expect(first.rooms[0].type).toBe('living');
  });

  it('keeps two genuinely different addresses apart and refuses an empty one', async () => {
    const { db } = backend();
    await createUnit(db, ORG, { address: '1247 Oak Street' });
    await createUnit(db, ORG, { address: '1249 Oak Street' });
    expect(db.rows('properties')).toHaveLength(2);
    await expect(createUnit(db, ORG, { address: '   ' })).rejects.toThrow(/address is required/i);
  });

  it('gives an unknown room type the honest label rather than dropping the room', async () => {
    const { db } = backend();
    const created = await createUnit(db, ORG, { address: '5 Mission St', rooms: [{ name: 'Nook', type: 'conservatory' }] });
    expect(created.rooms[0].type).toBe('other');
  });
});

describe('addPhoto', () => {
  it('stores both copies and records the hashes', async () => {
    const { db, storage } = backend();
    const { unit, room, photo } = await seedUnit(db, storage);

    expect(photo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(photo.canonical_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(photo.role).toBe('primary');
    expect(photo.storage_path.startsWith(`photos/${ORG}/${unit.id}/`)).toBe(true);
    expect(photo.canonical_path).toBe(`photos/${ORG}/${unit.id}/${photo.id}.canonical.jpg`);
    expect(photo.room_id).toBe(room.id);
    // Both objects really landed in the private bucket.
    for (const path of [photo.storage_path, String(photo.canonical_path)]) {
      const { bucket, key } = splitStoragePath(path);
      expect(storage.objects.has(`${bucket}/${key}`)).toBe(true);
    }
  });

  it('dedupes by the original hash: the same file twice is one row', async () => {
    const { db, storage } = backend();
    const { unit, room, photo } = await seedUnit(db, storage);
    const again = await addPhoto(db, storage, ORG, unit.id, { roomId: room.id, role: 'primary', dataUrl: PHOTO_A });

    expect(again.duplicate).toBe(true);
    expect(again.photo.id).toBe(photo.id);
    expect(db.rows('photos')).toHaveLength(1);
    // The id is derived from (unit, hash), so the second upload could not have made a new object.
    expect(photo.id).toBe(photoIdOf(unit.id, photo.sha256));
  });

  it('takes a second, different photo as an extra angle with its azimuth', async () => {
    const { db, storage } = backend();
    const { unit, room } = await seedUnit(db, storage);
    const extra = await addPhoto(db, storage, ORG, unit.id, { roomId: room.id, role: 'extra', angle: 'left', dataUrl: PHOTO_B });

    expect(extra.duplicate).toBe(false);
    expect(extra.photo.angle).toBe('left');
    expect(extra.photo.azimuth).toBe(270);
    expect(db.rows('photos')).toHaveLength(2);
  });

  it('refuses anything that is not a base64 image data URL', async () => {
    const { db, storage } = backend();
    const { unit } = await seedUnit(db, storage);
    await expect(addPhoto(db, storage, ORG, unit.id, { dataUrl: 'https://example.com/a.jpg' })).rejects.toThrow(/data URL/i);
    await expect(addPhoto(db, storage, ORG, unit.id, {})).rejects.toThrow(/No image bytes/i);
  });
});

describe.skipIf(!sharp)('addPhoto with bytes that are not an image', () => {
  it('answers 415, not 500: an undecodable upload is the client\'s problem', async () => {
    const { db, storage } = backend();
    const { unit, room } = await seedUnit(db, storage);
    const junk = `data:image/png;base64,${Buffer.from('this is not a png').toString('base64')}`;
    await expect(addPhoto(db, storage, ORG, unit.id, { roomId: room.id, dataUrl: junk })).rejects.toMatchObject({ status: 415 });
  });
});

describe('addFloorPlan', () => {
  it('stores the drawing, and enqueues a parse only when there is something left to parse', async () => {
    const { db, storage } = backend();
    const { unit } = await seedUnit(db, storage);

    // The wizard reads the plan in the browser and posts what it read: nothing to queue, and no
    // `parse_plan` job for the seller to watch fail while no worker implements that kind.
    const alreadyParsed = await addFloorPlan(db, storage, ORG, unit.id, { dataUrl: PHOTO_B, parsed: { rooms: [] } });
    expect(alreadyParsed.jobId).toBeUndefined();
    expect(db.rows('jobs')).toHaveLength(0);
    expect(String((alreadyParsed.plan as { storage_path?: string }).storage_path).startsWith('plans/')).toBe(true);

    // A raw drawing still queues the job docs/BACKEND.md §6 promises.
    const raw = await addFloorPlan(db, storage, ORG, unit.id, { dataUrl: PHOTO_A });
    expect(raw.jobId).toBeTruthy();
    expect(db.rows<{ kind: string }>('jobs').map((j) => j.kind)).toEqual(['parse_plan']);
  });

  it('takes the same drawing twice: the row that is there comes back, not floor_plans_pkey', async () => {
    const { db, storage } = backend();
    const { unit } = await seedUnit(db, storage);

    const first = await addFloorPlan(db, storage, ORG, unit.id, { dataUrl: PHOTO_B, parsed: { rooms: [] } });
    const again = await addFloorPlan(db, storage, ORG, unit.id, { dataUrl: PHOTO_B, parsed: { rooms: [] } });

    expect((again.plan as { id: string }).id).toBe((first.plan as { id: string }).id);
    expect(db.rows('floor_plans')).toHaveLength(1);
    // Re-uploading is what a seller does after a failed parse: it must not queue a second read either.
    expect(again.jobId).toBeUndefined();
    expect(db.rows('jobs')).toHaveLength(0);
  });

  it('refuses a unit in another organisation, before it stores anything', async () => {
    const { db, storage } = backend();
    const { unit, room } = await seedUnit(db, storage);
    const objects = storage.keys().length;

    await expect(addFloorPlan(db, storage, OTHER_ORG, unit.id, { dataUrl: PHOTO_B })).rejects.toMatchObject({ status: 404 });
    await expect(addPhoto(db, storage, OTHER_ORG, unit.id, { roomId: room.id, dataUrl: PHOTO_B })).rejects.toMatchObject({ status: 404 });

    expect(db.rows('floor_plans')).toHaveLength(0);
    expect(db.rows('photos')).toHaveLength(1);
    expect(storage.keys()).toHaveLength(objects);
  });
});

describe('planRecipes', () => {
  it('is identical for identical inputs and different for a changed one', async () => {
    const { db, storage } = backend();
    const { unit, room } = await seedUnit(db, storage);

    const first = await planRecipes(db, ORG, unit.id, 'draft', PLAN);
    const second = await planRecipes(db, ORG, unit.id, 'draft', PLAN);
    expect(first.planned).toHaveLength(1);
    expect(first.skipped).toEqual([]);
    expect(second.planned[0].hash).toBe(first.planned[0].hash);
    expect(second.planned[0].seed).toBe(first.planned[0].seed);
    expect(first.planned[0].seed).toBeGreaterThanOrEqual(0);
    expect(first.planned[0].seed).toBeLessThanOrEqual(4294967295);
    // The recipe hashes the CANONICAL copy, not the bytes the seller uploaded.
    expect(first.planned[0].recipe.photos[0].sha256).toBe(first.planned[0].photos[0].canonical_sha256);

    const otherTier = await planRecipes(db, ORG, unit.id, 'full', { ...PLAN, model: 'mock-full-1' });
    expect(otherTier.planned[0].hash).not.toBe(first.planned[0].hash);

    await db.update('rooms', { id: room.id }, { plan_dims: { width: 3.9, depth: 4.1, height: 2.6 } });
    const wider = await planRecipes(db, ORG, unit.id, 'draft', PLAN);
    expect(wider.planned[0].hash).not.toBe(first.planned[0].hash);

    const otherPipeline = await planRecipes(db, ORG, unit.id, 'draft', { ...PLAN, pipelineVersion: '2' });
    expect(otherPipeline.planned[0].hash).not.toBe(wider.planned[0].hash);
  });

  it('adds a second angle to the recipe in order, with its azimuth', async () => {
    const { db, storage } = backend();
    const { unit, room } = await seedUnit(db, storage);
    const before = await planRecipes(db, ORG, unit.id, 'draft', PLAN);
    await addPhoto(db, storage, ORG, unit.id, { roomId: room.id, role: 'extra', angle: 'right', dataUrl: PHOTO_B });
    const after = await planRecipes(db, ORG, unit.id, 'draft', PLAN);

    expect(after.planned[0].recipe.photos).toHaveLength(2);
    expect(after.planned[0].recipe.photos[0].role).toBe('primary');
    expect(after.planned[0].recipe.photos[0].azimuth).toBeUndefined();
    expect(after.planned[0].recipe.photos[1].azimuth).toBe(90);
    expect(after.planned[0].hash).not.toBe(before.planned[0].hash);
  });

  it("puts the vision model's caption in the prompt and ignores the heuristic placeholder", async () => {
    const { db, storage } = backend();
    const { unit, photo } = await seedUnit(db, storage);

    await db.update('photos', { id: photo.id }, { analysis: { isEmpty: true, caption: 'White walls and an oak floor.', source: 'nebius' } });
    const described = await planRecipes(db, ORG, unit.id, 'draft', PLAN);
    expect(described.planned[0].recipe.prompt).toContain('As photographed: White walls and an oak floor.');
    expect(described.planned[0].recipe.prompt).toContain('one real, empty bedroom');

    await db.update('photos', { id: photo.id }, { analysis: { isEmpty: true, caption: 'An empty room.', source: 'heuristic' } });
    const placeholder = await planRecipes(db, ORG, unit.id, 'draft', PLAN);
    expect(placeholder.planned[0].recipe.prompt).not.toContain('As photographed');
    // ...and the two are different recipes, because the prompt is hashed.
    expect(placeholder.planned[0].hash).not.toBe(described.planned[0].hash);
  });

  it('says why a room was skipped instead of silently doing nothing', async () => {
    const { db, storage } = backend();
    const { unit } = await seedUnit(db, storage);
    const [noPhoto] = await db.insert<RoomRow>('rooms', { org_id: ORG, unit_id: unit.id, name: 'Kitchen', type: 'kitchen', sort_order: 1, anchor: DOOR_ANCHOR });
    const [noAnchor] = await db.insert<RoomRow>('rooms', { org_id: ORG, unit_id: unit.id, name: 'Hall', type: 'hallway', sort_order: 2 });
    await addPhoto(db, storage, ORG, unit.id, { roomId: noAnchor.id, role: 'primary', dataUrl: PHOTO_B });

    const plan = await planRecipes(db, ORG, unit.id, 'draft', PLAN);
    expect(plan.planned).toHaveLength(1);
    expect(plan.skipped).toEqual([
      { roomId: noPhoto.id, name: 'Kitchen', reason: 'no photo' },
      { roomId: noAnchor.id, name: 'Hall', reason: 'no scale anchor' },
    ]);
  });

  it('refuses a unit in another organisation', async () => {
    const { db, storage } = backend();
    const { unit } = await seedUnit(db, storage);
    await expect(planRecipes(db, '22222222-2222-4222-8222-222222222222', unit.id, 'draft', PLAN)).rejects.toThrow(/No such unit/);
  });
});

describe('attachOrEnqueue', () => {
  it('enqueues once and attaches every time after that', async () => {
    const { db, storage, clk } = backend();
    const { unit, room } = await seedUnit(db, storage);

    const first = await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    expect(first).toMatchObject({ tier: 'draft', attached: 0, enqueued: 1, skipped: [] });
    expect(db.rows('worlds')).toHaveLength(1);
    expect(db.rows('jobs')).toHaveLength(1);
    expect(db.row<RoomRow>('rooms', room.id)?.draft_world_id).toBe(first.rooms[0].worldId);
    expect(db.row<RoomRow>('rooms', room.id)?.status).toBe('generating');

    const second = await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    expect(second).toMatchObject({ attached: 1, enqueued: 0 });
    expect(second.rooms[0].worldId).toBe(first.rooms[0].worldId);
    expect(second.rooms[0].jobId).toBeUndefined();
    // Rule 5: the same recipe never generates twice, so there is still exactly one job.
    expect(db.rows('worlds')).toHaveLength(1);
    expect(db.rows('jobs')).toHaveLength(1);
  });

  it('shares one world across identical units, and every reader still finds it', async () => {
    const { db, storage, clk } = backend();
    // Unit A: generated and finished, so its world is a real cache hit.
    const a = await seedUnit(db, storage);
    await generateUnit(db, ORG, a.unit.id, 'draft', PLAN, clk.ms);
    await drain(db, storage, mockProvider(), clk);
    const worldId = db.rows<WorldRow>('worlds')[0].id;

    // Unit B: the same organisation, the same address, the same room and the same photo — which is
    // exactly what docs/BACKEND.md §4.8 means by "unit types share worlds across identical units".
    const b = await createUnit(db, ORG, {
      address: '1247 Oak Street',
      lat: 37.7749,
      lon: -122.4194,
      site: { heading: 264 },
      unitNumber: '4B',
      floorLevel: 2,
      rooms: [{ name: 'Bedroom', type: 'bedroom', planDims: { width: 3.4, depth: 4.1, height: 2.6 }, anchor: DOOR_ANCHOR }],
    });
    await addPhoto(db, storage, ORG, b.unit.id, { roomId: b.rooms[0].id, role: 'primary', dataUrl: PHOTO_A, origin: 'file' });
    const attached = await generateUnit(db, ORG, b.unit.id, 'draft', PLAN, clk.ms);

    expect(attached).toMatchObject({ attached: 1, enqueued: 0 });
    expect(attached.rooms[0].worldId).toBe(worldId);
    expect(db.rows('worlds')).toHaveLength(1);
    expect(db.row<RoomRow>('rooms', b.rooms[0].id)?.status).toBe('ready');

    // The world lives on unit A's room, so reading `worlds` by `room_id` alone would lose it and the
    // buyer would get a room marked `ready` with nothing in it. Every reader follows the pointer.
    const doc = await unitDocument(db, ORG, b.unit.id);
    expect(doc.worlds.map((w) => w.id)).toEqual([worldId]);

    const pub = await publishUnit(db, ORG, b.unit.id, true, { now: clk.ms });
    expect(pub.model_date).toBe(db.row<WorldRow>('worlds', worldId)?.finished_at);

    const tour = await publicTour(db, storage, pub.share_id);
    expect(tour.rooms[0].status).toBe('ready');
    expect(tour.rooms[0].draft?.worldId).toBe(worldId);
    expect(tour.rooms[0].draft?.spzUrl).toContain(`worlds/${worldId}/`);
  });

  it('never attaches another organisation\u2019s world, even for the very same recipe', async () => {
    const { db, storage, clk } = backend();
    const a = await seedUnit(db, storage);
    const mine = await generateUnit(db, ORG, a.unit.id, 'draft', PLAN, clk.ms);

    // The other organisation photographs the same room shape with the same file: same recipe, same
    // hash. It must still get its own world — a world carries an org_id, a room and storage objects
    // that organisation owns, so another tenant's is not a cache hit but someone else's property.
    const b = await createUnit(db, OTHER_ORG, {
      address: '1247 Oak Street',
      lat: 37.7749,
      lon: -122.4194,
      site: { heading: 264 },
      unitNumber: '3B',
      floorLevel: 2,
      rooms: [{ name: 'Bedroom', type: 'bedroom', planDims: { width: 3.4, depth: 4.1, height: 2.6 }, anchor: DOOR_ANCHOR }],
    });
    await addPhoto(db, storage, OTHER_ORG, b.unit.id, { roomId: b.rooms[0].id, role: 'primary', dataUrl: PHOTO_A, origin: 'file' });
    const theirs = await generateUnit(db, OTHER_ORG, b.unit.id, 'draft', PLAN, clk.ms);

    const worlds = db.rows<WorldRow>('worlds');
    expect(theirs).toMatchObject({ attached: 0, enqueued: 1 });
    expect(theirs.rooms[0].worldId).not.toBe(mine.rooms[0].worldId);
    // The same recipe hash on both, one world each, each owned by its own organisation.
    expect(new Set(worlds.map((w) => w.recipe_hash)).size).toBe(1);
    expect(worlds.map((w) => w.org_id).sort()).toEqual([ORG, OTHER_ORG].sort());
    expect((await unitDocument(db, ORG, a.unit.id)).worlds.map((w) => w.id)).toEqual([mine.rooms[0].worldId]);
    expect((await unitDocument(db, OTHER_ORG, b.unit.id)).worlds.map((w) => w.id)).toEqual([theirs.rooms[0].worldId]);
  });

  it('generates again once an input really changed', async () => {
    const { db, storage, clk } = backend();
    const { unit, room } = await seedUnit(db, storage);
    await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    await db.update('rooms', { id: room.id }, { plan_dims: { width: 3.9, depth: 4.1, height: 2.6 } });
    const after = await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);

    expect(after.enqueued).toBe(1);
    expect(db.rows('worlds')).toHaveLength(2);
    expect(db.rows('jobs')).toHaveLength(2);
  });
});

describe('the worker, against the mock provider', () => {
  it('drives a generate job to done, owns the assets and points the room at the world', async () => {
    const { db, storage, clk } = backend();
    const { unit, room } = await seedUnit(db, storage);
    const summary = await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    const worldId = summary.rooms[0].worldId;
    const photoObjects = storage.keys().length;

    const ticks = await drain(db, storage, mockProvider(), clk);
    expect(ticks[0]).toMatchObject({ claimed: 1, submitted: 1 });
    // One poll says "still running", the next says "done": the mock finishes after two.
    expect(ticks.reduce((n, t) => n + t.polled, 0)).toBe(MOCK_POLLS_TO_FINISH);
    expect(ticks.reduce((n, t) => n + t.copied, 0)).toBe(1);
    expect(ticks.reduce((n, t) => n + t.failed, 0)).toBe(0);

    const world = db.row<WorldRow>('worlds', worldId)!;
    expect(world.status).toBe('done');
    expect(world.provider_operation_id).toMatch(/^mock-op-/);
    expect(world.finished_at).toBeTruthy();
    expect(world.caption).toBe('A simulated reconstruction.');
    expect(world.assets).toEqual({
      spz: { '100k': `worlds/${worldId}/spz-100k.spz`, '500k': `worlds/${worldId}/spz-500k.spz`, full: `worlds/${worldId}/spz-full.spz` },
      collider: `worlds/${worldId}/collider.glb`,
      pano: `worlds/${worldId}/pano.jpg`,
      thumbnail: `worlds/${worldId}/thumb.jpg`,
    });
    // Six assets copied on top of the photo's two objects, and the bytes really are ours now.
    expect(storage.keys().length).toBe(photoObjects + 6);
    expect(storage.objects.get(`worlds/${worldId}/spz-500k.spz`)?.bytes.byteLength).toBe(200);
    expect(storage.objects.get(`worlds/${worldId}/collider.glb`)?.bytes.subarray(0, 4).toString('ascii')).toBe('glTF');

    const after = db.row<RoomRow>('rooms', room.id)!;
    expect(after.draft_world_id).toBe(worldId);
    expect(after.status).toBe('ready');

    const jobs = db.rows<{ kind: string; status: string; progress: number; attempts: number }>('jobs');
    expect(jobs.map((j) => `${j.kind}:${j.status}:${j.progress}`).sort()).toEqual(['copy_assets:done:100', 'generate:done:100']);
    // A poll is not an attempt: the generate job was started once, whatever it took to finish.
    expect(jobs.find((j) => j.kind === 'generate')?.attempts).toBe(1);
    expect(db.rows<{ status: string }>('units')[0].status).toBe('ready');
  });

  it('resumes rather than resubmitting when a worker dies mid-flight', async () => {
    const { db, storage, clk } = backend();
    const { unit } = await seedUnit(db, storage);
    await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    const provider = mockProvider();
    let submissions = 0;
    const counting: WorldProvider = {
      ...provider,
      async generate(request) {
        submissions += 1;
        return provider.generate(request);
      },
    };

    await runWorkerOnce(db, storage, counting, 'worker-1', { now: () => clk.ms });
    // The worker vanishes without releasing the job; its lease is five minutes.
    clk.ms += 6 * 60 * 1000;
    await drain(db, storage, counting, clk);

    expect(submissions).toBe(1);
    expect(db.rows<{ status: string }>('worlds')[0].status).toBe('done');
  });

  it('never submits a second time when the database loses the operation id it just returned', async () => {
    const { db, storage, clk } = backend();
    const { unit } = await seedUnit(db, storage);
    await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    const provider = mockProvider();
    let submissions = 0;
    const counting: WorldProvider = {
      ...provider,
      async generate(request) {
        submissions += 1;
        return provider.generate(request);
      },
    };

    // The ordinary way this write fails: a transport error on the way to PostgREST, AFTER the
    // provider has accepted (and, on Marble, charged for) the request.
    let lose = true;
    const lossy: PipelineDb = {
      select: ((table: string, opts?: never) => db.select(table, opts)) as PipelineDb['select'],
      insert: (table, rows) => db.insert(table, rows),
      del: (table, filters) => db.del(table, filters),
      rpc: (fn, args) => db.rpc(fn, args),
      async update(table, filters, patch) {
        if (lose && table === 'worlds' && patch.provider_operation_id) {
          lose = false;
          throw Object.assign(new Error('PATCH /rest/v1/worlds: fetch failed'), { name: 'DbError', status: 502, code: 'FETCH_FAILED' });
        }
        return db.update(table, filters, patch);
      },
    };

    await drain(lossy as unknown as FakeDb & PipelineDb, storage, counting, clk);

    // One recipe, one submission — whatever the queue did afterwards.
    expect(submissions).toBe(1);
    const job = db.rows<{ status: string; attempts: number; error: string }>('jobs')[0];
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    // And the failure says what an operator has to do, because the generation was already paid for.
    expect(job.error).toMatch(/was submitted \(operation mock-op-/);
    expect(job.error).toMatch(/will not be retried/);
  });

  it('fails the job and its world when the provider reports an error, and does not retry it', async () => {
    const { db, storage, clk } = backend();
    const { unit, room } = await seedUnit(db, storage);
    const summary = await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    const provider = mockProvider();
    const failing: WorldProvider = { ...provider, poll: async () => ({ done: true, error: 'the reconstruction diverged' }) };

    await drain(db, storage, failing, clk);

    const world = db.row<WorldRow>('worlds', summary.rooms[0].worldId)!;
    expect(world.status).toBe('failed');
    expect(world.error).toMatch(/diverged/);
    expect(db.row<RoomRow>('rooms', room.id)?.status).toBe('failed');
    const job = db.rows<{ kind: string; status: string; attempts: number }>('jobs')[0];
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
  });

  it('retries a transient failure with a backoff before giving up', async () => {
    const { db, storage, clk } = backend();
    const { unit } = await seedUnit(db, storage);
    await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    const provider = mockProvider();
    const flaky: WorldProvider = { ...provider, generate: async () => { throw new Error('the provider is unreachable'); } };

    await runWorkerOnce(db, storage, flaky, 'worker-1', { now: () => clk.ms });
    let job = db.rows<{ status: string; attempts: number; error: string; run_after: string }>('jobs')[0];
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(1);
    expect(Date.parse(job.run_after)).toBe(clk.ms + 5_000);

    clk.ms += 5_000;
    await runWorkerOnce(db, storage, flaky, 'worker-1', { now: () => clk.ms });
    clk.ms += 10_000;
    await runWorkerOnce(db, storage, flaky, 'worker-1', { now: () => clk.ms });

    job = db.rows<{ status: string; attempts: number; error: string; run_after: string }>('jobs')[0];
    expect(job.attempts).toBe(3);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/unreachable/);
    expect(db.rows<{ status: string }>('worlds')[0].status).toBe('failed');
  });

  it('fails a job kind it has no handler for rather than leaving it in the queue', async () => {
    const { db, storage, clk } = backend();
    const { unit } = await seedUnit(db, storage);
    await db.insert('jobs', { org_id: ORG, unit_id: unit.id, kind: 'parse_plan', status: 'queued', run_after: new Date(clk.ms).toISOString() });

    await runWorkerOnce(db, storage, mockProvider(), 'worker-1', { now: () => clk.ms });
    const job = db.rows<{ status: string; error: string }>('jobs')[0];
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/not implemented/);
  });
});

describe('publish and the public tour', () => {
  async function published() {
    const { db, storage, clk } = backend();
    const seeded = await seedUnit(db, storage);
    await generateUnit(db, ORG, seeded.unit.id, 'draft', PLAN, clk.ms);
    await drain(db, storage, mockProvider(), clk);
    await db.insert('stagings', { org_id: ORG, room_id: seeded.room.id, style: 'warm', pieces: [{ id: 'p1', itemId: 'sofa-01', name: 'Sofa' }] });
    const publication = await publishUnit(db, ORG, seeded.unit.id, true, { now: clk.ms, disclosures: { staged: true } });
    return { db, storage, clk, publication, ...seeded };
  }

  it('derives the share id from the unit and sets the model date to the newest finished world', async () => {
    const { db, unit, publication } = await published();
    const world = db.rows<WorldRow>('worlds')[0];

    expect(publication.share_id).toBe(shareIdForUnit(unit.id));
    expect(publication.share_id).toMatch(/^[a-z0-9]{8}$/);
    expect(publication.published).toBe(true);
    expect(publication.model_date).toBe(world.finished_at);
    expect(publication.disclosures).toEqual({ staged: true });
    expect(db.rows<{ status: string }>('units')[0].status).toBe('published');
  });

  it('keeps the same share id and the same published_at when it is republished', async () => {
    const { db, clk, unit, publication } = await published();
    const off = await publishUnit(db, ORG, unit.id, false, { now: clk.ms + 60_000 });
    const on = await publishUnit(db, ORG, unit.id, true, { now: clk.ms + 120_000 });

    expect(off.published).toBe(false);
    expect(on.share_id).toBe(publication.share_id);
    expect(on.published_at).toBe(publication.published_at);
    expect(db.rows('publications')).toHaveLength(1);
  });

  it('serves our own asset URLs, and never a photo, a provider id or a recipe', async () => {
    const { db, storage, publication, room } = await published();
    const tour = await publicTour(db, storage, publication.share_id);
    const world = db.rows<WorldRow>('worlds')[0];

    expect(tour.shareId).toBe(publication.share_id);
    expect(tour.unit.address).toBe('1247 Oak Street');
    expect(tour.unit.unitNumber).toBe('3B');
    expect(tour.site).toMatchObject({ heading: 264, lat: 37.7749, lon: -122.4194 });
    expect(tour.rooms).toHaveLength(1);
    expect(tour.rooms[0].id).toBe(room.id);
    expect(tour.rooms[0].staging).toEqual([{ id: 'p1', itemId: 'sofa-01', name: 'Sofa' }]);
    expect(tour.rooms[0].full).toBeNull();

    const draft = tour.rooms[0].draft!;
    expect(draft.worldId).toBe(world.id);
    expect(draft.spzUrl).toBe(`https://ref.supabase.co/storage/v1/object/public/worlds/${world.id}/spz-500k.spz`);
    expect(draft.spzUrls).toEqual({
      '100k': `https://ref.supabase.co/storage/v1/object/public/worlds/${world.id}/spz-100k.spz`,
      '500k': `https://ref.supabase.co/storage/v1/object/public/worlds/${world.id}/spz-500k.spz`,
      full: `https://ref.supabase.co/storage/v1/object/public/worlds/${world.id}/spz-full.spz`,
    });
    expect(draft.panoUrl).toContain('/public/worlds/');
    expect(draft.colliderUrl).toContain('/collider.glb');

    // Nothing of the provider's, nothing of the seller's private material.
    const serialised = JSON.stringify(tour);
    expect(serialised).not.toContain('mock://');
    expect(serialised).not.toContain('mock-world-');
    expect(serialised).not.toContain('mock-op-');
    expect(serialised).not.toContain('canonical');
    expect(serialised).not.toContain('photos/');
    expect(serialised).not.toContain('recipe');
    expect(serialised).not.toContain('external_ref');
    expect(Object.keys(tour)).toEqual(['shareId', 'publishedAt', 'modelDate', 'disclosures', 'unit', 'site', 'rooms']);
  });

  it('is a 404 while the unit is unpublished, and so are its events', async () => {
    const { db, storage, clk, unit, publication } = await published();
    await publishUnit(db, ORG, unit.id, false, { now: clk.ms });

    await expect(publicTour(db, storage, publication.share_id)).rejects.toThrow(/No such tour/);
    await expect(recordEvent(db, publication.share_id, { type: 'visit' })).rejects.toThrow(/No such tour/);
  });

  it('records a known event and refuses an invented one', async () => {
    const { db, publication, room, unit } = await published();
    await recordEvent(db, publication.share_id, { type: 'walk', roomId: room.id, visitorId: 'v-1' });
    await expect(recordEvent(db, publication.share_id, { type: 'ransack' })).rejects.toThrow(/Unknown event type/);

    const events = db.rows<{ unit_id: string; type: string; room_id: string; visitor_id: string }>('analytics_events');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ unit_id: unit.id, type: 'walk', room_id: room.id, visitor_id: 'v-1' });
  });
});
