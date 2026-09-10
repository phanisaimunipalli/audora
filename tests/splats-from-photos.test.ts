/// <reference types="node" />
/**
 * **Is Audora building its 3D Gaussian splats out of the photographs the leasing team uploads?**
 *
 * The other suites pin the pieces (`tests/marble-seed.test.ts` the browser recipe and the seed,
 * `tests/recipe.test.ts` the canonical recipe, `tests/pipeline.test.ts` the backend end to end,
 * `tests/splat.test.ts` the viewer's ladder). What none of them does is *join* them, so this file
 * proves the three links of the actual claim, with bytes rather than shapes:
 *
 *  1. **The photographs are what the reconstruction request carries — byte for byte.** In the
 *     browser flow, what `startGeneration` posts and `marbleGenerateRequest` maps onto the World
 *     Labs request must base64-DECODE to the very files the room holds, primary first, in order.
 *     In the backend flow, what the worker submits must decode to the bytes stored under each
 *     photo's `canonical_sha256` — the canonicalised upload, and nothing else.
 *  2. **What comes back and is stored is Gaussian splat data.** Several SPZ resolutions plus the
 *     collider and the panorama, in our own `worlds` bucket, byte-identical to what the provider
 *     served — and a real `.spz` from Marble's CDN parsed with a real SPZ reader
 *     (`tests/support/spz.ts`) so "SPZ" is a claim about the container, not about a file extension.
 *  3. **The viewer's splat pipeline picks those files up.** `worldFromMarble` over a *recorded real*
 *     Marble response (`public/demo/marble-world-corner-windows.json`), then `spzTiers` →
 *     `planLadder` → `wantsUpgrade`, which is exactly the chain `src/three/SplatWorld.tsx` runs.
 *
 * What is deliberately NOT here: `loadSpz` handing its bytes to Spark's `SplatMesh`. `SplatWorld`
 * constructs `new SplatMesh({ fileBytes, fileType: SPZ })` (src/three/SplatWorld.tsx:214), which
 * decodes and uploads to a WebGL context; there is no GL in this node environment, and faking one
 * would prove nothing about the real decoder. The last link tested here is therefore the URL the
 * viewer hands to `loadSpz` — `tests/splat.test.ts` already pins that `loadSpz` returns the bytes.
 *
 * No network and no credits: `fetch` is stubbed for the browser flow, the backend runs against the
 * in-memory doubles in `tests/support/backend.ts` and a spy wrapped round the mock provider, and
 * the one real Marble file is a checked-in fixture, never downloaded by a test.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyScale } from '../src/engine/anchor';
import { generationImages, pickSpz, recipeForRoom, startGeneration, worldFromMarble, type MarbleWorld } from '../src/services/marble';
import { MAX_ROOM_PHOTOS } from '../src/services/marblePrompt';
import { planLadder, spzTiers, wantsUpgrade } from '../src/three/splat/tiers';
import { MARBLE_MAX_IMAGES, marbleGenerateRequest } from '../server/marbleRequest';
import {
  addPhoto,
  createUnit,
  generateUnit,
  orderPhotos,
  planRecipes,
  publicTour,
  publishUnit,
  splitStoragePath,
  type PhotoRow,
  type PlanContext,
  type WorldRow,
} from '../server/pipeline';
import type { MarbleRequestBody } from '../server/recipe';
import { mockProvider, runWorkerOnce, type FetchedAsset, type ProviderAssets, type WorldProvider } from '../server/worker';
import type { AnchorSpec, RawGeometry } from '../src/engine/types';
import type { PhotoAngle, PhotoRecord, Room } from '../src/state/types';
import { DOOR_ANCHOR, FakeDb, FakeStorage, clock, png, type Clock } from './support/backend';
import { isGzip, looksLikeSpz, readSpzHeader, spzPayload, spzPayloadBytes, startsWithSpzMagic } from './support/spz';

/* ---------- shared fixtures ---------- */

const ORG = '11111111-1111-4111-8111-111111111111';
const PLAN: PlanContext = { pipelineVersion: '1', provider: 'mock', model: 'mock-draft-1' };
const MODELS = { draft: 'marble-1.0-draft', full: 'marble-1.1' };

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Real photographs, as real PNG bytes — `tests/support/backend.ts` builds a genuine 8-bit RGB PNG,
 * and `server/photos.ts` decodes it whether sharp is installed or not. Every one of them is a
 * different file, so "the request carries THIS photo" is a statement a hash can check.
 */
const FILES = {
  primary: png(9, 7, [40, 60, 80]),
  right: png(9, 7, [200, 30, 10]),
  left: png(9, 7, [10, 120, 200]),
  spare: png(8, 6, [90, 90, 90]),
};

const dataUrlOf = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString('base64')}`;
const decode = (base64: string): Buffer => Buffer.from(base64, 'base64');

/** The image container these bytes really are, read off the magic — never off a declared type. */
function containerOf(bytes: Uint8Array): 'jpg' | 'png' | 'other' {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return 'other';
}

/* ---------- the browser flow ---------- */

const RAW: RawGeometry = {
  width: 4,
  depth: 5,
  height: 2.6,
  door: { wall: 'south', offset: 1, width: 0.9, height: 2.1 },
  windows: [],
  doorHeightUnits: 2.1,
  outletHeightUnits: 0.3,
};

const BROWSER_ANCHOR: AnchorSpec = {
  method: 'door',
  referenceMetres: 2.03,
  referenceUnits: 2.1,
  metresPerUnit: 2.03 / 2.1,
  uncertaintyM: 0.04,
  label: 'interior door · 2.03 m · ±4 cm',
};

function photoRecord(bytes: Buffer, angle?: PhotoAngle): PhotoRecord {
  return { dataUrl: dataUrlOf(bytes), width: 9, height: 7, brightness: 0.5, darkFraction: 0.1, detail: 0.2, ...(angle ? { angle } : {}) };
}

/** A room the browser flow can generate: the primary shot first, then the extra angles in order. */
function browserRoom(shots: PhotoRecord[]): Room {
  return {
    id: 'room_a',
    tourId: 'tour_a',
    name: 'Bedroom',
    type: 'bedroom',
    order: 0,
    photo: shots[0],
    photos: shots.slice(1),
    raw: RAW,
    anchor: BROWSER_ANCHOR,
    geometry: applyScale(RAW, BROWSER_ANCHOR.metresPerUnit),
    staging: [],
    stagingStyle: 'modern' as Room['stagingStyle'],
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
  };
}

/** Run `startGeneration` against a stubbed `fetch` and hand back the body it posted. */
async function postedBody(room: Room): Promise<Record<string, unknown>> {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ operation_id: 'op_1', done: false, metadata: { world_id: 'w_1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  await startGeneration(room, 'draft');
  expect(bodies).toHaveLength(1);
  return bodies[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('link 1a — the browser posts the leasing team’s own photographs', () => {
  it('carries every shot through to Marble’s request, primary first, decoding byte for byte', async () => {
    const room = browserRoom([photoRecord(FILES.primary), photoRecord(FILES.right, 'right'), photoRecord(FILES.left, 'left')]);
    const expected = await recipeForRoom(room, 'draft');
    const body = await postedBody(room);

    // What the browser posts: the three files, primary first, with the azimuths their labels mean.
    const posted = body.images as { dataUrl: string; azimuth?: number }[];
    expect(posted.map((i) => i.azimuth)).toEqual([undefined, 90, 270]);
    expect(posted).toEqual(generationImages(room));

    // What the server would send Marble, from exactly that body — the pure mapping, no HTTP.
    const mapped = marbleGenerateRequest(body, MODELS);
    if (!('request' in mapped)) throw new Error(mapped.error);
    const prompt = mapped.request.world_prompt;
    if (prompt.type !== 'multi-image') throw new Error(`expected a multi-image prompt, got ${prompt.type}`);

    // THE LINK: each image Marble receives decodes to the bytes of the photograph in that slot.
    const ordered = [FILES.primary, FILES.right, FILES.left];
    expect(prompt.multi_image_prompt).toHaveLength(3);
    prompt.multi_image_prompt.forEach((shot, i) => {
      expect(shot.content.source).toBe('data_base64');
      expect(shot.content.extension).toBe('png');
      expect(sha256(decode(shot.content.data_base64)), `image ${i}`).toBe(sha256(ordered[i]));
      expect(decode(shot.content.data_base64).equals(ordered[i]), `image ${i} byte for byte`).toBe(true);
    });
    // ...and in that order, primary first: the first image is the shot the anchor was tapped on.
    expect(sha256(decode(prompt.multi_image_prompt[0].content.data_base64))).toBe(sha256(FILES.primary));
    expect(prompt.multi_image_prompt.map((s) => s.azimuth)).toEqual([undefined, 90, 270]);

    // Two shots of one room are two views of one geometry: reconstruction, not description.
    expect(prompt.reconstruct_images).toBe(true);
    // Where the two knobs sit (server/recipe.ts says why): recaptioning off INSIDE the world
    // prompt, next to the text it is about; the seed BESIDE it, as a generation parameter.
    expect(prompt.disable_recaption).toBe(true);
    expect('disable_recaption' in mapped.request).toBe(false);
    expect(mapped.request.seed).toBe(expected.seed);
    expect('seed' in prompt).toBe(false);
    expect(prompt.text_prompt).toBe(expected.prompt);
  });

  it('reconstructs from more than four angles, and never posts more shots than a room may hold', async () => {
    const many = [FILES.primary, FILES.right, FILES.left, FILES.spare, FILES.primary, FILES.right, FILES.left];
    const room = browserRoom(many.map((b, i) => photoRecord(b, i === 0 ? undefined : (['right', 'back', 'left', 'centre'][i % 4] as PhotoAngle))));
    const body = await postedBody(room);

    // `MAX_ROOM_PHOTOS` is the room's cap and it bites before Marble's own does.
    expect(MAX_ROOM_PHOTOS).toBeLessThanOrEqual(MARBLE_MAX_IMAGES);
    expect((body.images as unknown[]).length).toBe(MAX_ROOM_PHOTOS);

    const mapped = marbleGenerateRequest(body, MODELS);
    if (!('request' in mapped)) throw new Error(mapped.error);
    const prompt = mapped.request.world_prompt;
    if (prompt.type !== 'multi-image') throw new Error(`expected a multi-image prompt, got ${prompt.type}`);
    expect(prompt.multi_image_prompt).toHaveLength(MAX_ROOM_PHOTOS);
    // Six images is past the four a plain multi-image prompt takes, so this is reconstruction mode —
    // which is the whole point: `reconstruct_images` is what makes six angles buy geometry.
    expect(prompt.multi_image_prompt.length).toBeGreaterThan(4);
    expect(prompt.reconstruct_images).toBe(true);
    // Still the leasing team's files, in the order they were added.
    prompt.multi_image_prompt.forEach((shot, i) => {
      expect(sha256(decode(shot.content.data_base64)), `image ${i}`).toBe(sha256(many[i]));
    });
  });

  it('sends the single photograph itself when a room has only one', async () => {
    const room = browserRoom([photoRecord(FILES.primary)]);
    const body = await postedBody(room);
    const mapped = marbleGenerateRequest(body, MODELS);
    if (!('request' in mapped)) throw new Error(mapped.error);
    const prompt = mapped.request.world_prompt;
    if (prompt.type !== 'image') throw new Error(`expected a single-image prompt, got ${prompt.type}`);
    expect(decode(prompt.image_prompt.data_base64).equals(FILES.primary)).toBe(true);
    expect(sha256(decode(prompt.image_prompt.data_base64))).toBe(sha256(FILES.primary));
    // One photograph is a description, not a reconstruction: no `reconstruct_images` at all.
    expect('reconstruct_images' in prompt).toBe(false);
  });
});

/* ---------- the backend flow ---------- */

interface SpyProvider {
  provider: WorldProvider;
  /** Every request submitted to `generate`, deep-copied at the moment it was submitted. */
  requests: MarbleRequestBody[];
  /** Every asset the worker pulled, by the provider URL it pulled it from. */
  fetched: Map<string, FetchedAsset>;
  /** The last `world()` answer, so a test can compare stored bytes with what was offered. */
  world: ProviderAssets | null;
}

/**
 * The mock provider with a recorder round it. `name` stays `mock`, so the credit guard in
 * `submitGenerate` is never armed and nothing can reach World Labs even by accident.
 */
function spyOn(inner: WorldProvider = mockProvider()): SpyProvider {
  const spy: SpyProvider = { requests: [], fetched: new Map(), world: null, provider: null as unknown as WorldProvider };
  spy.provider = {
    name: inner.name,
    async generate(request) {
      spy.requests.push(JSON.parse(JSON.stringify(request)) as MarbleRequestBody);
      return inner.generate(request);
    },
    poll: (operationId) => inner.poll(operationId),
    async world(worldId) {
      spy.world = await inner.world(worldId);
      return spy.world;
    },
    async fetchAsset(url) {
      const asset = await inner.fetchAsset(url);
      spy.fetched.set(url, asset);
      return asset;
    },
  };
  return spy;
}

interface Upload {
  bytes: Buffer;
  role: 'primary' | 'extra';
  angle?: PhotoAngle;
}

/** One unit, one bedroom, and the uploads posted to it exactly as the browser posts them. */
async function backendUnit(uploads: Upload[], opts: { address?: string; unitNumber?: string } = {}) {
  const clk = clock();
  const db = new FakeDb(clk);
  const storage = new FakeStorage();
  const created = await createUnit(db, ORG, {
    address: opts.address ?? '1247 Oak Street',
    lat: 37.7749,
    lon: -122.4194,
    site: { heading: 264 },
    unitNumber: opts.unitNumber ?? '3B',
    floorLevel: 2,
    rooms: [{ name: 'Bedroom', type: 'bedroom', planDims: { width: 3.4, depth: 4.1, height: 2.6 }, anchor: DOOR_ANCHOR }],
  });
  const room = created.rooms[0];
  const photos: PhotoRow[] = [];
  for (const up of uploads) {
    const added = await addPhoto(db, storage, ORG, created.unit.id, { roomId: room.id, role: up.role, angle: up.angle ?? null, dataUrl: dataUrlOf(up.bytes), origin: 'file' });
    photos.push(added.photo);
  }
  return { clk, db, storage, unit: created.unit, room, photos };
}

/** The single image a submitted request carries, decoded. Throws on a multi-image request. */
function submittedImage(request: MarbleRequestBody): Buffer {
  const prompt = request.world_prompt;
  if (prompt.type !== 'image') throw new Error(`expected a single-image prompt, got ${prompt.type}`);
  return decode(prompt.image_prompt.data_base64);
}

/** Tick the worker until nothing is claimed, five seconds of clock per tick — the real loop. */
async function drain(db: FakeDb, storage: FakeStorage, provider: WorldProvider, clk: Clock, max = 12): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const tick = await runWorkerOnce(db, storage, provider, 'worker-1', { env: { MARBLE_MOCK: '1' }, now: () => clk.ms });
    expect(tick.failed, 'a job failed').toBe(0);
    if (!tick.claimed) return;
    clk.ms += 5_000;
  }
  throw new Error('the worker never went quiet');
}

describe('link 1b — the backend submits the canonicalised uploads', () => {
  it('stores the file it was given and hashes both copies of it', async () => {
    const { storage, photos } = await backendUnit([{ bytes: FILES.primary, role: 'primary' }]);
    const [photo] = photos;

    // The ORIGINAL object is the upload, unchanged, and its hash is the hash of the file.
    const original = splitStoragePath(photo.storage_path);
    const stored = await storage.download(original.bucket, original.key);
    expect(stored.equals(FILES.primary)).toBe(true);
    expect(photo.sha256).toBe(sha256(FILES.primary));

    // The CANONICAL object is what the recipe names and what Marble is given, and its hash is the
    // hash of those bytes — so `canonical_sha256` is a claim anyone can check against the object.
    const canonical = splitStoragePath(String(photo.canonical_path));
    const canonicalBytes = await storage.download(canonical.bucket, canonical.key);
    expect(sha256(canonicalBytes)).toBe(photo.canonical_sha256);
    // Both copies are still a decodable image — the canonical one is a JPEG re-encode where sharp
    // is installed and the original container where it is not, and never anything else.
    expect(containerOf(canonicalBytes)).not.toBe('other');
    expect(containerOf(stored)).toBe('png');
    expect(storage.objects.get(photo.canonical_path!)?.contentType.startsWith('image/')).toBe(true);
  });

  it('hands Marble the stored canonical bytes of every photograph on the room, primary first', async () => {
    const { db, storage, unit, room, clk } = await backendUnit([
      { bytes: FILES.primary, role: 'primary' },
      { bytes: FILES.right, role: 'extra', angle: 'right' },
    ]);

    const plan = await planRecipes(db, ORG, unit.id, 'draft', PLAN);
    const planned = plan.planned[0];
    const ordered = orderPhotos(planned.photos);
    // The recipe names the canonical copies, in room order.
    expect(planned.recipe.photos.map((p) => p.sha256)).toEqual(ordered.map((p) => p.canonical_sha256));
    expect(ordered[0].role).toBe('primary');

    await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    const spy = spyOn();
    await drain(db, storage, spy.provider, clk);

    expect(spy.requests).toHaveLength(1);
    const prompt = spy.requests[0].world_prompt;
    if (prompt.type !== 'multi-image') throw new Error(`expected a multi-image prompt, got ${prompt.type}`);

    // THE LINK: what was submitted decodes, image by image, to the bytes sitting in storage under
    // each photo's `canonical_sha256` — the canonicalised upload, in recipe order, primary first.
    expect(prompt.multi_image_prompt).toHaveLength(2);
    for (const [i, shot] of prompt.multi_image_prompt.entries()) {
      const bytes = decode(shot.content.data_base64);
      expect(sha256(bytes), `image ${i}`).toBe(String(ordered[i].canonical_sha256));
      const at = splitStoragePath(String(ordered[i].canonical_path));
      expect(bytes.equals(await storage.download(at.bucket, at.key)), `image ${i} byte for byte`).toBe(true);
      // The extension Marble is told is read off those bytes, so the request never mis-describes
      // what it carries (`recipeImages` in server/worker.ts sniffs rather than trusting the name).
      expect(shot.content.extension, `image ${i} extension`).toBe(containerOf(bytes));
    }
    expect(sha256(decode(prompt.multi_image_prompt[0].content.data_base64))).toBe(String(ordered[0].canonical_sha256));
    // The labelled extra keeps its azimuth, and two angles mean reconstruction.
    expect(prompt.multi_image_prompt.map((s) => s.azimuth)).toEqual([undefined, 90]);
    expect(prompt.reconstruct_images).toBe(true);

    // The request is the recipe's own: its seed, its `recipe:` tag, its prompt, its model.
    expect(spy.requests[0].seed).toBe(planned.seed);
    expect(spy.requests[0].tags).toEqual(['audora', `recipe:${planned.hash.slice(0, 12)}`]);
    expect(prompt.text_prompt).toBe(planned.recipe.prompt);
    expect(spy.requests[0].model).toBe(planned.recipe.model);
    expect(spy.requests[0].display_name).toBe(`Audora · ${room.name}`);
  });
});

describe('link 2 — what comes back is splat files, and they are ours', () => {
  it('stores every resolution plus the collider and the panorama, byte-identical to the provider’s', async () => {
    const { db, storage, unit, clk } = await backendUnit([{ bytes: FILES.primary, role: 'primary' }]);
    const summary = await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    const worldId = summary.rooms[0].worldId;
    const spy = spyOn();
    await drain(db, storage, spy.provider, clk);

    const world = db.row<WorldRow>('worlds', worldId)!;
    expect(world.status).toBe('done');
    const assets = world.assets ?? {};

    // Several resolutions — the ladder the viewer climbs — and each one really is in our bucket.
    expect(Object.keys(assets.spz ?? {}).sort()).toEqual(['100k', '500k', 'full']);
    for (const [tier, storedPath] of Object.entries(assets.spz ?? {})) {
      const at = splitStoragePath(storedPath);
      expect(at.bucket, tier).toBe('worlds');
      expect(at.key, tier).toBe(`${worldId}/spz-${tier}.spz`);
      expect(storage.objects.has(storedPath), tier).toBe(true);
    }
    expect(assets.collider).toBe(`worlds/${worldId}/collider.glb`);
    expect(assets.pano).toBe(`worlds/${worldId}/pano.jpg`);

    // THE LINK: the bytes under our key are the bytes the provider served for that url — the
    // download is a copy, not a re-render, so what the renter streams is what was reconstructed.
    const offered = spy.world!;
    for (const [tier, url] of Object.entries(offered.spz)) {
      const served = spy.fetched.get(url)!;
      const stored = storage.objects.get(String((assets.spz ?? {})[tier === 'full_res' ? 'full' : tier]))!;
      expect(stored.bytes.equals(served.bytes), tier).toBe(true);
      // ...and they open with the SPZ container the provider returned.
      expect(startsWithSpzMagic(stored.bytes), `${tier} magic`).toBe(true);
    }
    expect(storage.objects.get(assets.collider!)!.bytes.subarray(0, 4).toString('ascii')).toBe('glTF');
    expect(storage.objects.get(assets.pano!)!.bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
  });
});

describe('link 2 — determinism is the evidence that the photographs are the input', () => {
  it('regenerates for changed bytes and attaches — calling the provider zero times — for identical ones', async () => {
    const a = await backendUnit([{ bytes: FILES.primary, role: 'primary' }]);
    const firstPlan = (await planRecipes(a.db, ORG, a.unit.id, 'draft', PLAN)).planned[0];
    await generateUnit(a.db, ORG, a.unit.id, 'draft', PLAN, a.clk.ms);
    const spy = spyOn();
    await drain(a.db, a.storage, spy.provider, a.clk);
    expect(spy.requests).toHaveLength(1);

    /* A second unit of the same organisation, identical in every way except that its photograph is
       a different file. Everything else — address, room, plan, anchor, model, pipeline version — is
       held fixed, so a different hash can only have come from the bytes. */
    const changed = await createUnit(a.db, ORG, {
      address: '1247 Oak Street',
      lat: 37.7749,
      lon: -122.4194,
      site: { heading: 264 },
      unitNumber: '4B',
      floorLevel: 2,
      rooms: [{ name: 'Bedroom', type: 'bedroom', planDims: { width: 3.4, depth: 4.1, height: 2.6 }, anchor: DOOR_ANCHOR }],
    });
    await addPhoto(a.db, a.storage, ORG, changed.unit.id, { roomId: changed.rooms[0].id, role: 'primary', dataUrl: dataUrlOf(FILES.spare), origin: 'file' });
    const changedPlan = (await planRecipes(a.db, ORG, changed.unit.id, 'draft', PLAN)).planned[0];

    expect(changedPlan.recipe.photos[0].sha256).not.toBe(firstPlan.recipe.photos[0].sha256);
    expect(changedPlan.hash).not.toBe(firstPlan.hash);
    expect(changedPlan.seed).not.toBe(firstPlan.seed);

    const second = await generateUnit(a.db, ORG, changed.unit.id, 'draft', PLAN, a.clk.ms);
    expect(second).toMatchObject({ attached: 0, enqueued: 1 });
    await drain(a.db, a.storage, spy.provider, a.clk);
    // A second world, from a second submission, with its own seed: different photographs, different splats.
    expect(a.db.rows('worlds')).toHaveLength(2);
    expect(spy.requests).toHaveLength(2);
    expect(spy.requests[1].seed).toBe(changedPlan.seed);
    expect(spy.requests[1].seed).not.toBe(spy.requests[0].seed);
    // ...and the two submissions carried two different photographs, which is the point.
    expect(sha256(submittedImage(spy.requests[1]))).not.toBe(sha256(submittedImage(spy.requests[0])));
    expect(sha256(submittedImage(spy.requests[1]))).toBe(String(changedPlan.photos[0].canonical_sha256));

    /* And a third unit whose photograph is the SAME file as the first: the recipe is the recipe
       that already has a world, so it attaches it and the provider is not called at all. Nothing
       else in this suite proves the no-second-charge rule at the provider port itself. */
    const same = await createUnit(a.db, ORG, {
      address: '1247 Oak Street',
      lat: 37.7749,
      lon: -122.4194,
      site: { heading: 264 },
      unitNumber: '5B',
      floorLevel: 2,
      rooms: [{ name: 'Bedroom', type: 'bedroom', planDims: { width: 3.4, depth: 4.1, height: 2.6 }, anchor: DOOR_ANCHOR }],
    });
    await addPhoto(a.db, a.storage, ORG, same.unit.id, { roomId: same.rooms[0].id, role: 'primary', dataUrl: dataUrlOf(FILES.primary), origin: 'file' });
    const samePlan = (await planRecipes(a.db, ORG, same.unit.id, 'draft', PLAN)).planned[0];
    expect(samePlan.hash).toBe(firstPlan.hash);

    const before = spy.requests.length;
    const third = await generateUnit(a.db, ORG, same.unit.id, 'draft', PLAN, a.clk.ms);
    await drain(a.db, a.storage, spy.provider, a.clk);
    expect(third).toMatchObject({ attached: 1, enqueued: 0 });
    expect(spy.requests).toHaveLength(before);
    expect(a.db.rows('worlds')).toHaveLength(2);
  });
});

/* ---------- the format itself ---------- */

const FIXTURE = path.resolve(process.cwd(), 'tests/support/fixtures/corner-100k.spz');

describe('link 2 — the files really are Gaussian splats', () => {
  /**
   * The corner room's own 100k rung, downloaded once from Marble's public CDN (the url is in
   * `public/demo/marble-world-corner-windows.json` under `assets.splats.spz_urls`) and checked in.
   * No test fetches it; if it is not on disk this case says so and skips rather than failing.
   */
  it('reads a real Marble capture as SPZ: magic, version, point count and SH degree', (ctx) => {
    if (!existsSync(FIXTURE)) {
      ctx.skip(
        `no SPZ fixture at ${FIXTURE}. Fetch it once, outside the tests, from the 100k url in ` +
          'public/demo/marble-world-corner-windows.json (a public CDN object, no credits) to run this case.',
      );
      return;
    }
    const file = readFileSync(FIXTURE);
    // A `.spz` is a gzip stream; the container is inside it.
    expect(isGzip(file)).toBe(true);
    expect(file.byteLength).toBeGreaterThan(500_000);
    expect(file.byteLength).toBeLessThan(3_000_000);

    const header = readSpzHeader(file);
    expect(header.magicAscii).toBe('NGSP');
    expect([1, 2]).toContain(header.version);
    // The 100k rung really holds ~100 000 Gaussians — within 20%, because Marble decimates to a
    // budget rather than to an exact count.
    expect(header.numPoints).toBeGreaterThan(80_000);
    expect(header.numPoints).toBeLessThan(120_000);
    expect(header.shDegree).toBeGreaterThanOrEqual(0);
    expect(header.shDegree).toBeLessThanOrEqual(3);
    expect(header.fractionalBits).toBe(12);

    // Version 2 packs a fixed number of bytes per point, so the payload length is a function of the
    // header alone: this is the assertion that says the body is splat data and not padding.
    if (header.version === 2) expect(spzPayloadBytes(header)).toBe(spzPayload(file).byteLength);
  });

  it('says honestly what the mock provider’s splats are: a magic prefix, not a container', async () => {
    const provider = mockProvider();
    const submitted = await provider.generate({ seed: 7 } as unknown as MarbleRequestBody);
    const offered = await provider.world(submitted.worldId!);
    const bytes = (await provider.fetchAsset(offered.spz['100k'])).bytes;

    // It opens with the four magic characters, which is what `copy_assets` and the tests above see...
    expect(startsWithSpzMagic(bytes)).toBe(true);
    // ...but it is not gzipped and its 200 bytes are a hash stream, so it is NOT a readable SPZ
    // file: everything after the magic is noise, and no real splat can be decoded from it. The mock
    // exercises the transport (submit → poll → copy → serve), never the format.
    expect(isGzip(bytes)).toBe(false);
    expect(bytes.byteLength).toBe(200);
    const header = looksLikeSpz(bytes);
    if (!header) throw new Error('the mock splat did not even carry the magic');
    expect([1, 2]).not.toContain(header.version);
    expect(spzPayloadBytes(header)).not.toBe(bytes.byteLength);
  });
});

/* ---------- the viewer ---------- */

/** The recorded response of a real Marble generation — a world that was actually made from a photo. */
function recordedWorld(): MarbleWorld {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), 'public/demo/marble-world-corner-windows.json'), 'utf8')) as MarbleWorld;
}

describe('link 3 — the viewer’s splat pipeline picks the files up', () => {
  it('carries a real Marble response’s whole spz ladder onto the world the viewer streams', () => {
    const recorded = recordedWorld();
    const urls = recorded.assets!.splats!.spz_urls!;
    const world = worldFromMarble(browserRoom([photoRecord(FILES.primary)]), 'draft', recorded);

    // Every resolution survives the trip into the store — not just the one the viewer opens on.
    expect(world.spzUrls).toEqual(urls);
    expect(Object.keys(world.spzUrls!).sort()).toEqual(['100k', '500k', 'full_res']);
    expect(world.spzUrl).toBe(pickSpz(urls));
    expect(world.spzUrl).toBe(urls['500k']);
    expect(world.colliderUrl).toBe(recorded.assets!.mesh!.collider_mesh_url);
    expect(world.panoUrl).toBe(recorded.assets!.imagery!.pano_url);
    for (const url of Object.values(world.spzUrls!)) expect(url.endsWith('.spz')).toBe(true);

    // `SplatWorld` runs exactly this: spzTiers → planLadder → (later) wantsUpgrade.
    const ladder = spzTiers(world);
    expect(ladder.map((a) => a.tier)).toEqual(['100k', '500k', 'full_res']);
    expect(ladder.map((a) => a.url)).toEqual([urls['100k'], urls['500k'], urls.full_res]);
    expect(planLadder(ladder, 'full_res').map((a) => a.url)).toEqual([urls['100k'], urls['500k']]);
    expect(planLadder(ladder, '150k').map((a) => a.url)).toEqual([urls['100k']]);
    expect(wantsUpgrade(ladder, '500k', 1800, 'full_res')?.url).toBe(urls.full_res);
  });

  it('climbs the ladder of a world this pipeline generated and serves', async () => {
    const { db, storage, unit, clk } = await backendUnit([{ bytes: FILES.primary, role: 'primary' }]);
    await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    await drain(db, storage, mockProvider(), clk);
    const published = await publishUnit(db, ORG, unit.id, true, { now: clk.ms });
    const tour = await publicTour(db, storage, published.share_id);
    const served = tour.rooms[0].draft!;

    // Our own bucket, our own keys, one url per rung — and every one is an object that exists.
    expect(Object.keys(served.spzUrls ?? {}).sort()).toEqual(['100k', '500k', 'full']);
    for (const url of Object.values(served.spzUrls ?? {})) {
      const key = url.split('/object/public/')[1];
      expect(storage.objects.has(key), url).toBe(true);
      expect(startsWithSpzMagic(storage.objects.get(key)!.bytes), url).toBe(true);
    }

    const ladder = spzTiers({ worldId: served.worldId, spzUrl: served.spzUrl, spzUrls: served.spzUrls });
    // The renter sees the small file first and climbs to 500k, which is what `planLadder` promises.
    expect(planLadder(ladder, 'full_res').map((a) => a.tier)).toEqual(['100k', '500k']);
    expect(planLadder(ladder, 'full_res')[0].url).toBe(served.spzUrls!['100k']);
  });

  /**
   * KNOWN DEFECT, pinned with `it.fails` so the suite stays honest without turning red.
   *
   * `spzName()` (server/worker.ts:553-558) and `spzAssetName()` (server/localGenerate.ts:566-569)
   * both fold Marble's `full_res` key to **`full`**, and name the object `spz-full.spz`. The viewer
   * knows no such tier: `SplatTier` (src/three/splat/tiers.ts:15) lists `full_res` only, and
   * `tierOfUrl` (src/three/splat/tiers.ts:43-51) matches `_full_res` but not `spz-full.spz`, so the
   * rung classifies as `unknown` — and `withinCeiling` (line 136) drops every `unknown` rung.
   *
   * The consequence: for any world our own pipeline copied (the backend AND `npx audora generate`,
   * whose output the viewer really does load through `src/services/localUnit.ts`), the full-
   * resolution splat is downloaded, stored, served — and unreachable. A desktop that has earned the
   * upgrade is offered nothing. A world read straight off Marble's CDN, whose key is still
   * `full_res`, upgrades correctly, which is why no existing test catches it.
   *
   * The fix is one line on either side (add `full` to `SplatTier`/`TIER_ORDER`, or stop renaming
   * the key) — a source change, so it is not made here.
   */
  it.fails('offers the full-resolution rung of a world we copied ourselves (see the comment: it does not)', async () => {
    const { db, storage, unit, clk } = await backendUnit([{ bytes: FILES.primary, role: 'primary' }]);
    await generateUnit(db, ORG, unit.id, 'draft', PLAN, clk.ms);
    await drain(db, storage, mockProvider(), clk);
    const published = await publishUnit(db, ORG, unit.id, true, { now: clk.ms });
    const served = (await publicTour(db, storage, published.share_id)).rooms[0].draft!;
    const ladder = spzTiers({ worldId: served.worldId, spzUrl: served.spzUrl, spzUrls: served.spzUrls });

    // The stored `full` rung is a real object the renter paid to have copied...
    expect(Object.keys(served.spzUrls ?? {})).toContain('full');
    // ...but the viewer classifies it `unknown` and will never load it: this is the failing line.
    expect(wantsUpgrade(ladder, '500k', 1500, 'full_res')?.url).toBe(served.spzUrls!.full);
  });
});
