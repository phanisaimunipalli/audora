/// <reference types="node" />
/**
 * The intake's decisions have to reach the request.
 *
 * docs/ACCURACY.md 3.4 and 3.5 give the wizard two choices per room — the model (full quality routes
 * a room over 30 m² of printed floor, or an open plan, to `marble-1.1-plus`) and reconstruction mode
 * (`reconstruct_images` from the second angle up). Both are only worth anything if they survive the
 * trip to World Labs, and both are part of the recipe hash, so a link that silently substituted
 * something else would not merely generate the wrong world: it would record a hash describing a
 * request nobody made, and the next identical run would miss the cache and spend the credits again.
 *
 * This file walks the whole chain and pins each hand-off:
 *
 *   intake rule (shared/modelPolicy) → browser recipe (src/services/marble) → POST body
 *     → the server's mapping and allowlist (server/marbleRequest) → the route (server/api)
 *     → the world the viewer labels (worldFromMarble)
 *
 * and the backend's own path, `planRecipes` (server/pipeline), which has to reach the same answer
 * from the stored rows.
 *
 * No network anywhere: `fetch` is a fake, the database and storage are the in-memory doubles, and
 * the one route test that gets as far as the provider call has a stubbed `fetch` in front of it.
 */
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DRAFT_MODEL,
  DEFAULT_FULL_MODEL,
  FULL_PLUS_MODEL,
  knownModels,
  modelForModelRoom,
  PLUS_AREA_M2,
  resolveModel,
} from '../shared/modelPolicy';
import { modelRoomOf } from '../src/screens/create/intake';
import { browserRecipe, recipeForRoom, recipeHashBrowser, startGeneration, worldFromMarble } from '../src/services/marble';
import { marbleGenerateRequest, modelFor } from '../server/marbleRequest';
import { configureEnv, handleApi } from '../server/api';
import { modelForRoomRow, planRecipes, type PlanContext, type RoomRow } from '../server/pipeline';
import { createUnit, addPhoto } from '../server/pipeline';
import { DOOR_ANCHOR as DB_DOOR_ANCHOR, FakeDb, FakeStorage, clock, pngDataUrl } from './support/backend';
import type { PhotoRecord, Room } from '../src/state/types';
import type { AnchorSpec, RawGeometry } from '../src/engine/types';
import { applyScale } from '../src/engine/anchor';

/* ---------- fixtures ---------- */

const dataUrl = (bytes: string) => `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
const photo = (bytes: string, angle?: PhotoRecord['angle']): PhotoRecord => ({
  dataUrl: dataUrl(bytes),
  width: 1600,
  height: 1200,
  brightness: 0.5,
  darkFraction: 0.1,
  detail: 0.2,
  ...(angle ? { angle } : {}),
});

const RAW: RawGeometry = {
  width: 4,
  depth: 5,
  height: 2.6,
  door: { wall: 'south', offset: 1, width: 0.9, height: 2.1 },
  windows: [],
  doorHeightUnits: 2.1,
  outletHeightUnits: 0.3,
};

const ANCHOR: AnchorSpec = {
  method: 'door',
  referenceMetres: 2.03,
  referenceUnits: 2.1,
  metresPerUnit: 2.03 / 2.1,
  uncertaintyM: 0.04,
  label: 'interior door · 2.03 m · ±4 cm',
};

/** A room the plan measured. `m2` is the printed area, which is the only area the rule reads. */
function room(over: Partial<Room> = {}): Room {
  return {
    id: 'room_a',
    tourId: 'tour_a',
    name: 'Living room',
    type: 'living',
    order: 0,
    photo: photo('photo-a'),
    raw: RAW,
    anchor: ANCHOR,
    geometry: applyScale(RAW, ANCHOR.metresPerUnit),
    staging: [],
    stagingStyle: 'modern' as Room['stagingStyle'],
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

/** 35 m² of printed floor: over the threshold, so full quality goes to the larger model. */
const BIG = room({ planDims: { width: 5, depth: 7 } });
/** 20 m²: under it, so full quality is the tier's own model. */
const SMALL = room({ planDims: { width: 4, depth: 5 } });

/**
 * The one line `src/state/jobs.ts` runs before every generation (`marbleModelId`), restated so this
 * file tests the composition and not just its two halves.
 */
const chosenModel = (r: Room, tier: 'draft' | 'full', models?: { marbleDraft?: string; marbleFull?: string }) =>
  modelForModelRoom(modelRoomOf(r), tier, models).model;

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------- 1. the rule ---------- */

describe('the model the intake chooses', () => {
  it('sends a room over 30 m² of printed floor to the larger model and leaves a smaller one alone', () => {
    expect(BIG.planDims!.width * BIG.planDims!.depth).toBeGreaterThan(PLUS_AREA_M2);
    expect(chosenModel(BIG, 'full')).toBe(FULL_PLUS_MODEL);
    expect(chosenModel(SMALL, 'full')).toBe(DEFAULT_FULL_MODEL);
    // Draft is one model for every room: it carries no metric scale, so size buys nothing.
    expect(chosenModel(BIG, 'draft')).toBe(DEFAULT_DRAFT_MODEL);
  });

  it('routes an open plan whatever its size, and reads the plan rather than the room’s own guess', () => {
    expect(chosenModel(room({ type: 'studio', planDims: { width: 3, depth: 3 } }), 'full')).toBe(FULL_PLUS_MODEL);
    expect(chosenModel(room({ name: 'Kitchen / dining', planDims: { width: 3, depth: 3 } }), 'full')).toBe(FULL_PLUS_MODEL);
    // 35 m² of *reconstruction estimate* and no plan: the estimate is exactly what we have not measured.
    expect(chosenModel(room({ planDims: undefined }), 'full')).toBe(DEFAULT_FULL_MODEL);
  });
});

/* ---------- 2. the browser recipe ---------- */

describe('the browser recipe', () => {
  it('carries marble-1.1-plus for a 35 m² room and the tier default for a 20 m² one', async () => {
    const big = await recipeForRoom(BIG, 'full', { modelId: chosenModel(BIG, 'full') });
    const small = await recipeForRoom(SMALL, 'full', { modelId: chosenModel(SMALL, 'full') });
    expect(big.recipe.model).toBe(FULL_PLUS_MODEL);
    expect(small.recipe.model).toBe(DEFAULT_FULL_MODEL);
  });

  it('changes the hash when the model changes, and nothing else does', async () => {
    const plus = await browserRecipe(BIG, 'full', FULL_PLUS_MODEL);
    const plain = await browserRecipe(BIG, 'full', DEFAULT_FULL_MODEL);
    // The two recipes differ in exactly one field...
    expect({ ...plus, model: null }).toEqual({ ...plain, model: null });
    // ...and that is enough to name a different world.
    expect(await recipeHashBrowser(plus)).not.toBe(await recipeHashBrowser(plain));
    // The same model twice is the same hash: the seed and the cache key are stable.
    expect(await recipeHashBrowser(plus)).toBe(await recipeHashBrowser(await browserRecipe(BIG, 'full', FULL_PLUS_MODEL)));
  });

  it('sets reconstruction mode from the second photo up', async () => {
    const one = await browserRecipe(SMALL, 'full', DEFAULT_FULL_MODEL);
    const two = await browserRecipe(room({ ...SMALL, photos: [photo('photo-b', 'right')] }), 'full', DEFAULT_FULL_MODEL);
    expect(one.reconstructImages).toBe(false);
    expect(one.photos).toHaveLength(1);
    expect(two.reconstructImages).toBe(true);
    expect(two.photos).toHaveLength(2);
  });
});

/* ---------- 3. the request the browser sends ---------- */

/** `startGeneration` with a fake `fetch`; returns the body that was POSTed to /api/marble/generate. */
async function sentBody(r: Room, tier: 'draft' | 'full', modelId?: string): Promise<any> {
  const calls: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return { ok: true, text: async () => JSON.stringify({ operation_id: 'op_1', metadata: { world_id: 'w_1' } }) } as unknown as Response;
    }),
  );
  await startGeneration(r, tier, modelId === undefined ? {} : { modelId });
  return calls[0];
}

describe('startGeneration', () => {
  it('puts the chosen model on the request and reports it back for the world', async () => {
    const calls: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return { ok: true, text: async () => JSON.stringify({ operation_id: 'op_1', metadata: { world_id: 'w_1' } }) } as unknown as Response;
      }),
    );
    const started = await startGeneration(BIG, 'full', { modelId: chosenModel(BIG, 'full') });
    expect(calls[0].model).toBe(FULL_PLUS_MODEL);
    expect(calls[0].tier).toBe('full');
    expect(started.model).toBe(FULL_PLUS_MODEL);
    // The hash the world will record is the hash of the recipe that named that model.
    expect(started.recipeHash).toBe((await recipeForRoom(BIG, 'full', { modelId: FULL_PLUS_MODEL })).recipeHash);
  });

  it('names no model when the caller has not resolved one, so the server uses the tier default', async () => {
    const body = await sentBody(SMALL, 'draft');
    expect('model' in body).toBe(false);
  });

  it('sends both angles, and the server turns that into reconstruct_images', async () => {
    const body = await sentBody(room({ ...SMALL, photos: [photo('photo-b', 'right')] }), 'full', DEFAULT_FULL_MODEL);
    expect(body.images).toHaveLength(2);
    expect(body.images[1].azimuth).toBe(90);

    const mapped = marbleGenerateRequest(body, { draft: DEFAULT_DRAFT_MODEL, full: DEFAULT_FULL_MODEL });
    if (!('request' in mapped)) throw new Error(mapped.error);
    expect(mapped.request.world_prompt.type).toBe('multi-image');
    if (mapped.request.world_prompt.type !== 'multi-image') return;
    expect(mapped.request.world_prompt.reconstruct_images).toBe(true);
    expect(mapped.request.model).toBe(DEFAULT_FULL_MODEL);
  });
});

/* ---------- 4. the server's allowlist ---------- */

describe('modelFor', () => {
  const models = { draft: DEFAULT_DRAFT_MODEL, full: DEFAULT_FULL_MODEL };

  it('accepts the tier’s own model and full quality’s larger sibling', () => {
    expect(modelFor('full', DEFAULT_FULL_MODEL, models)).toEqual({ model: DEFAULT_FULL_MODEL });
    expect(modelFor('full', FULL_PLUS_MODEL, models)).toEqual({ model: FULL_PLUS_MODEL });
    expect(modelFor('draft', DEFAULT_DRAFT_MODEL, models)).toEqual({ model: DEFAULT_DRAFT_MODEL });
  });

  it('falls back to the tier default when nothing was named', () => {
    for (const nothing of [undefined, null, '', '   ']) {
      expect(modelFor('full', nothing, models)).toEqual({ model: DEFAULT_FULL_MODEL });
      expect(modelFor('draft', nothing, models)).toEqual({ model: DEFAULT_DRAFT_MODEL });
    }
  });

  it('refuses anything else with a 400 rather than quietly running the default', () => {
    // A model that does not exist, one from the other tier, and a non-string.
    for (const bad of ['marble-9.9', DEFAULT_FULL_MODEL, FULL_PLUS_MODEL]) {
      const r = modelFor('draft', bad, models);
      expect('status' in r && r.status, String(bad)).toBe(400);
    }
    const other = modelFor('full', DEFAULT_DRAFT_MODEL, models);
    expect('status' in other && other.status).toBe(400);
    expect('error' in other && other.error).toMatch(/marble-1\.1/);
    expect('status' in modelFor('full', 42, models)).toBe(true);
  });

  it('follows a deployment that renamed its models', () => {
    const renamed = { draft: 'marble-1.0-draft-next', full: 'marble-1.2' };
    expect(knownModels('full', renamed)).toEqual(['marble-1.2', 'marble-1.2-plus', FULL_PLUS_MODEL]);
    expect(knownModels('draft', renamed)).toEqual(['marble-1.0-draft-next']);
    expect(modelFor('full', 'marble-1.2-plus', renamed)).toEqual({ model: 'marble-1.2-plus' });
    // The routing decision keeps its canonical id, so the server still has to accept it.
    expect(modelFor('full', FULL_PLUS_MODEL, renamed)).toEqual({ model: FULL_PLUS_MODEL });
    expect(resolveModel('full', DEFAULT_FULL_MODEL, renamed)).toHaveProperty('error');
  });

  it('is refused before the images are decoded, so a bad model is one 400 and not two', () => {
    const bad = marbleGenerateRequest({ imageDataUrl: dataUrl('a'), tier: 'full', model: 'marble-9.9' }, models);
    expect(bad).toMatchObject({ status: 400 });
    expect('error' in bad && bad.error).toMatch(/Unknown Marble model/);
  });
});

/* ---------- 5. the route ---------- */

/** The slice of `IncomingMessage` `readBody` uses (same shape as tests/routes.test.ts). */
function request(url: string, body: unknown): IncomingMessage {
  const text = JSON.stringify(body);
  const req = new EventEmitter() as EventEmitter & { headers: Record<string, string>; method: string; url: string; resume: () => void };
  req.headers = { 'content-length': String(Buffer.byteLength(text)) };
  req.method = 'POST';
  req.url = url;
  req.resume = () => undefined;
  queueMicrotask(() => {
    req.emit('data', Buffer.from(text, 'utf8'));
    req.emit('end');
  });
  return req as unknown as IncomingMessage;
}

class Res {
  statusCode = 200;
  body = '';
  setHeader(): void {}
  end(chunk: string): void {
    this.body = chunk;
  }
  json(): any {
    return JSON.parse(this.body || 'null');
  }
}

/** POST a generate body through the real route. `fetch` is stubbed, so nothing leaves the process. */
async function post(body: unknown): Promise<{ status: number; body: any; sent: any[] }> {
  const sent: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return { status: 200, text: async () => JSON.stringify({ operation_id: 'op_1' }) } as unknown as Response;
    }),
  );
  const res = new Res();
  await handleApi(request('/api/marble/generate', body), res as unknown as ServerResponse);
  return { status: res.statusCode, body: res.json(), sent };
}

/** `GET /api/status`, which reports how many live generations this process has already started. */
async function status(): Promise<{ liveGenerations: number; models: Record<string, string> }> {
  const res = new Res();
  await handleApi({ url: '/api/status', method: 'GET', headers: {} } as unknown as IncomingMessage, res as unknown as ServerResponse);
  return res.json();
}

/**
 * A key so the route reaches the provider call (`fetch` is stubbed inside `post`, so nothing leaves
 * the process) and a cap of exactly one more generation than this process has already started —
 * `liveGenerations` is process state, so the guard has to be armed relative to it rather than to 0.
 */
async function armGuard(extra: number): Promise<void> {
  configureEnv({ WORLDLABS_API_KEY: 'test-key-not-real', MARBLE_MAX_GENERATIONS: '99' });
  const { liveGenerations } = await status();
  configureEnv({ WORLDLABS_API_KEY: 'test-key-not-real', MARBLE_MAX_GENERATIONS: String(liveGenerations + extra) });
}

describe('POST /api/marble/generate', () => {
  const image = dataUrl('photo-a');

  it('runs the model the body named when it is one this server knows', async () => {
    configureEnv({ WORLDLABS_API_KEY: 'test-key-not-real', MARBLE_MAX_GENERATIONS: '99' });
    const plus = await post({ imageDataUrl: image, tier: 'full', model: FULL_PLUS_MODEL });
    expect(plus.status).toBe(200);
    expect(plus.sent).toHaveLength(1);
    expect(plus.sent[0].model).toBe(FULL_PLUS_MODEL);

    // Naming nothing still means the tier's own model, which is what an older client sends.
    const plain = await post({ imageDataUrl: image, tier: 'full' });
    expect(plain.sent[0].model).toBe(DEFAULT_FULL_MODEL);
    expect((await post({ imageDataUrl: image, tier: 'draft' })).sent[0].model).toBe(DEFAULT_DRAFT_MODEL);
  });

  it('refuses an unknown model with 400, without calling the provider or using a credit slot', async () => {
    // Exactly one generation left: if a refused request spent it, the valid one after would 429.
    await armGuard(1);
    const bad = await post({ imageDataUrl: image, tier: 'full', model: 'marble-1.1-turbo' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Unknown Marble model/);
    expect(bad.sent).toHaveLength(0);

    const good = await post({ imageDataUrl: image, tier: 'full', model: FULL_PLUS_MODEL });
    expect(good.status).toBe(200);
  });

  it('keeps the credit guard in front of the provider', async () => {
    await armGuard(1);
    expect((await post({ imageDataUrl: image, tier: 'draft' })).status).toBe(200);
    const guarded = await post({ imageDataUrl: image, tier: 'draft' });
    expect(guarded.status).toBe(429);
    expect(guarded.body.error).toMatch(/Credit guard/);
    expect(guarded.sent).toHaveLength(0);
  });
});

/* ---------- 6. what the world says it is ---------- */

describe('worldFromMarble', () => {
  it('labels the world with the model that was requested when the provider’s record omits one', () => {
    const echoed = worldFromMarble(BIG, 'full', { world_id: 'w_1', model: FULL_PLUS_MODEL }, 1580, 600, undefined, { model: FULL_PLUS_MODEL });
    expect(echoed.model).toBe(FULL_PLUS_MODEL);
    // Marble sometimes answers with a record that carries no model at all; the tier default would
    // relabel every plus room as `marble-1.1` in the tier chip and the measured panel.
    const silent = worldFromMarble(BIG, 'full', { world_id: 'w_1' }, 1580, 600, undefined, { model: FULL_PLUS_MODEL });
    expect(silent.model).toBe(FULL_PLUS_MODEL);
    // With neither, the tier default is still the honest answer.
    expect(worldFromMarble(BIG, 'full', { world_id: 'w_1' }).model).toBe(DEFAULT_FULL_MODEL);
  });
});

/* ---------- 7. the backend reaches the same answer ---------- */

const ORG = '11111111-1111-4111-8111-111111111111';
const MARBLE_PLAN: PlanContext = { pipelineVersion: '1', provider: 'marble', model: DEFAULT_FULL_MODEL };
const PNG = pngDataUrl(6, 4, [40, 60, 80]);

/** A unit with one room of the given printed size, a door anchor and a photo. */
async function seed(width: number, depth: number, name = 'Living room', type = 'living') {
  const clk = clock();
  const db = new FakeDb(clk);
  const storage = new FakeStorage();
  const created = await createUnit(db, ORG, {
    address: '1247 Oak Street',
    rooms: [{ name, type, planDims: { width, depth, height: 2.6 }, anchor: DB_DOOR_ANCHOR }],
  });
  await addPhoto(db, storage, ORG, created.unit.id, { roomId: created.rooms[0].id, role: 'primary', dataUrl: PNG, origin: 'file' });
  return { db, storage, unit: created.unit, room: created.rooms[0] };
}

describe('planRecipes', () => {
  it('plans marble-1.1-plus for a 35 m² room and the tier default for a 20 m² one', async () => {
    const big = await seed(5, 7);
    const bigPlan = await planRecipes(big.db, ORG, big.unit.id, 'full', MARBLE_PLAN);
    expect(bigPlan.planned[0].recipe.model).toBe(FULL_PLUS_MODEL);

    const small = await seed(4, 5);
    const smallPlan = await planRecipes(small.db, ORG, small.unit.id, 'full', MARBLE_PLAN);
    expect(smallPlan.planned[0].recipe.model).toBe(DEFAULT_FULL_MODEL);

    // Draft is one model for every room, however big the plan draws it.
    const draft = await planRecipes(big.db, ORG, big.unit.id, 'draft', { ...MARBLE_PLAN, model: DEFAULT_DRAFT_MODEL });
    expect(draft.planned[0].recipe.model).toBe(DEFAULT_DRAFT_MODEL);
  });

  it('is the same rule the browser used, so the two sides name the same model for the same room', async () => {
    const big = await seed(5, 7);
    const plan = await planRecipes(big.db, ORG, big.unit.id, 'full', MARBLE_PLAN);
    expect(plan.planned[0].recipe.model).toBe(chosenModel(BIG, 'full'));
    expect(modelForRoomRow(big.room as RoomRow, 'full', MARBLE_PLAN)).toBe(FULL_PLUS_MODEL);
    // An open plan by name, with a plan that draws it small.
    const studio = await seed(3, 3, 'Kitchen / dining', 'kitchen');
    expect(modelForRoomRow(studio.room as RoomRow, 'full', MARBLE_PLAN)).toBe(FULL_PLUS_MODEL);
    // The mock provider has only the two ids it has; nothing routes it to a sibling that does not exist.
    expect(modelForRoomRow(big.room as RoomRow, 'full', { provider: 'mock', model: 'mock-full-1' })).toBe('mock-full-1');
  });

  it('gives the plus room a different recipe hash from the same room at the plain model', async () => {
    const big = await seed(5, 7);
    const routed = await planRecipes(big.db, ORG, big.unit.id, 'full', MARBLE_PLAN);
    // The same inputs with the routing suppressed (what the unrouted pipeline used to send).
    const unrouted = await planRecipes(big.db, ORG, big.unit.id, 'full', { ...MARBLE_PLAN, provider: 'mock', model: DEFAULT_FULL_MODEL });
    expect(routed.planned[0].hash).not.toBe(unrouted.planned[0].hash);
    // And it is stable: the same unit planned twice is the same world.
    const again = await planRecipes(big.db, ORG, big.unit.id, 'full', MARBLE_PLAN);
    expect(again.planned[0].hash).toBe(routed.planned[0].hash);
    expect(again.planned[0].seed).toBe(routed.planned[0].seed);
  });

  it('sets reconstruct_images on a room with two photos', async () => {
    const two = await seed(4, 5);
    await addPhoto(two.db, two.storage, ORG, two.unit.id, { roomId: two.room.id, role: 'extra', angle: 'right', dataUrl: pngDataUrl(5, 4, [200, 30, 10]) });
    const plan = await planRecipes(two.db, ORG, two.unit.id, 'full', MARBLE_PLAN);
    expect(plan.planned[0].recipe.photos).toHaveLength(2);
    expect(plan.planned[0].recipe.reconstructImages).toBe(true);

    const one = await seed(4, 5);
    const single = await planRecipes(one.db, ORG, one.unit.id, 'full', MARBLE_PLAN);
    expect(single.planned[0].recipe.reconstructImages).toBe(false);
  });
});
