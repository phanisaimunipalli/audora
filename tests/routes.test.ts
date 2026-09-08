/// <reference types="node" />
/**
 * server/routes.ts — the /api/v1 table in docs/BACKEND.md §6, against the in-memory doubles in
 * tests/support/backend.ts. No network, no Supabase, no provider: `ctx.auth` is a function and the
 * body is handed straight to the router, which is exactly how `server/api.ts` calls it.
 */
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { AuthError, type Actor } from '../server/auth';
import { addPhoto, createUnit, type PublicationRow, type UnitRow } from '../server/pipeline';
import { BodyTooLargeError, configureEnv, readBody } from '../server/api';
import { handleV1, type V1Context, type V1Request, type V1Response } from '../server/routes';
import { mockProvider, runWorkerOnce } from '../server/worker';
import { DOOR_ANCHOR, FakeDb, FakeStorage, clock, pngDataUrl, type Clock } from './support/backend';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const ACTOR: Actor = { userId: '99999999-9999-4999-8999-999999999999', email: 'agent@example.com', orgId: ORG, role: 'owner', dev: false };
const PHOTO = pngDataUrl(6, 4, [40, 60, 80]);

/** A `ServerResponse` in the shape the routes actually use. */
class Res implements V1Response {
  statusCode = 200;
  readonly headers: Record<string, string> = {};
  body = '';

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  end(chunk: string): void {
    this.body = chunk;
  }

  json<T = Record<string, unknown>>(): T {
    return JSON.parse(this.body || 'null') as T;
  }
}

/**
 * The slice of `IncomingMessage` `readBody` uses: headers and a `data`/`end` stream. Emitted on the
 * next turn so the promise is already listening, exactly as a socket would deliver it.
 */
function request(body: string, headers?: Record<string, string>): IncomingMessage {
  const req = new EventEmitter() as EventEmitter & { headers: Record<string, string>; resume: () => void };
  req.headers = headers ?? { 'content-length': String(Buffer.byteLength(body)) };
  req.resume = () => undefined;
  queueMicrotask(() => {
    req.emit('data', Buffer.from(body, 'utf8'));
    req.emit('end');
  });
  return req as unknown as IncomingMessage;
}

type Call = (method: string, url: string, body?: unknown, headers?: Record<string, string>) => Promise<{ handled: boolean; status: number; body: Record<string, unknown> }>;

interface Harness {
  db: FakeDb;
  storage: FakeStorage;
  clk: Clock;
  ctx: V1Context;
  call: Call;
  /** The same database and storage, a different caller. */
  as: (actor: Actor) => Call;
  /** The same database and storage, a different way of resolving the caller (or refusing to). */
  withAuth: (auth: V1Context['auth']) => Call;
}

function harness(overrides: Partial<V1Context> = {}): Harness {
  const clk = clock();
  const db = new FakeDb(clk);
  const storage = new FakeStorage();
  const ctx: V1Context = {
    db,
    storage,
    env: {},
    readBody: async () => ({}),
    auth: async () => ACTOR,
    now: () => clk.ms,
    ...overrides,
  };
  // The call's own body is what `readBody` returns, unless a test overrode `readBody` to fail.
  const withAuth = (auth: V1Context['auth']): Call => async (method, url, body, headers = {}) => {
    const res = new Res();
    const req: V1Request = { method, url, headers };
    const readBody = overrides.readBody ?? (async () => body ?? {});
    const handled = await handleV1(req, res, { ...ctx, auth, readBody });
    return { handled, status: res.statusCode, body: res.json() };
  };
  return { db, storage, clk, ctx, call: withAuth(ctx.auth), as: (actor) => withAuth(async () => actor), withAuth };
}

/** A unit with one photographed, anchored room, created through the API itself. */
async function seedUnit(h: Harness) {
  const created = await createUnit(h.db, ORG, {
    address: '1247 Oak Street',
    lat: 37.7749,
    lon: -122.4194,
    rooms: [{ name: 'Bedroom', type: 'bedroom', planDims: { width: 3.4, depth: 4.1 }, anchor: DOOR_ANCHOR }],
  });
  await addPhoto(h.db, h.storage, ORG, created.unit.id, { roomId: created.rooms[0].id, role: 'primary', dataUrl: PHOTO });
  return created;
}

describe('mounting', () => {
  it('leaves anything that is not /api/v1 to the caller', async () => {
    const h = harness();
    expect((await h.call('GET', '/api/status')).handled).toBe(false);
    expect((await h.call('GET', '/index.html')).handled).toBe(false);
  });

  it('answers 503 for every v1 route when the backend is not configured', async () => {
    const h = harness({ db: null, storage: null });
    for (const [method, url] of [
      ['GET', '/api/v1/units/11111111-1111-4111-8111-111111111111'],
      ['POST', '/api/v1/units'],
      ['GET', '/api/v1/public/oak1247'],
      ['GET', '/api/v1/stuff?visitor=v1'],
    ] as const) {
      const r = await h.call(method, url);
      expect(r.handled).toBe(true);
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ error: 'backend not configured' });
    }
  });

  it('404s an unknown v1 path rather than falling through', async () => {
    const h = harness();
    const r = await h.call('GET', '/api/v1/nonsense');
    expect(r.status).toBe(404);
    expect(String(r.body.error)).toContain('/api/v1/nonsense');
  });
});

describe('authentication', () => {
  it('401s an authenticated route without a token', async () => {
    const h = harness({
      auth: async (authorization) => {
        if (!authorization) throw new AuthError(401, 'Sign in required');
        return ACTOR;
      },
    });
    const r = await h.call('POST', '/api/v1/units', { address: '1247 Oak Street' });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'Sign in required' });
    expect(h.db.rows('units')).toHaveLength(0);
  });

  it('403s a signed-in user who belongs to no organisation', async () => {
    const h = harness({ auth: async () => { throw new AuthError(403, 'You are not a member of any organisation'); } });
    expect((await h.call('GET', '/api/v1/units/11111111-1111-4111-8111-111111111111')).status).toBe(403);
  });

  it('404s a unit that belongs to another organisation, without saying it exists', async () => {
    const h = harness();
    const created = await seedUnit(h);
    // The same database, a caller from a different organisation.
    const res = await h.as({ ...ACTOR, orgId: '22222222-2222-4222-8222-222222222222' })('GET', `/api/v1/units/${created.unit.id}`);
    expect(res.status).toBe(404);
  });

  it('404s every WRITE into another organisation\u2019s unit, and writes nothing', async () => {
    const h = harness();
    const created = await seedUnit(h);
    const other = h.as({ ...ACTOR, orgId: OTHER_ORG });
    const photosBefore = h.db.rows('photos').length;
    const objectsBefore = h.storage.keys().length;

    for (const [path, body] of [
      [`/api/v1/units/${created.unit.id}/photos`, { roomId: created.rooms[0].id, dataUrl: PHOTO }],
      [`/api/v1/units/${created.unit.id}/floor-plan`, { dataUrl: PHOTO }],
      [`/api/v1/units/${created.unit.id}/generate`, {}],
      [`/api/v1/units/${created.unit.id}/publish`, { published: true }],
    ] as const) {
      const r = await other('POST', path, body);
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
    }
    // Nothing landed: no photo row with the attacker's org_id, no plan, no object in their folder.
    expect(h.db.rows('photos')).toHaveLength(photosBefore);
    expect(h.db.rows('floor_plans')).toHaveLength(0);
    expect(h.db.rows('publications')).toHaveLength(0);
    expect(h.storage.keys()).toHaveLength(objectsBefore);
    expect(h.storage.keys().some((k) => k.includes(OTHER_ORG))).toBe(false);
  });
});

describe('request bodies', () => {
  it('keeps the status of a body refused for its SIZE instead of calling it malformed JSON', async () => {
    const h = harness({ readBody: async () => { throw new BodyTooLargeError(24 * 1024 * 1024); } });
    const created = await seedUnit(h);
    const r = await h.call('POST', `/api/v1/units/${created.unit.id}/photos`, {});

    expect(r.status).toBe(413);
    expect(String(r.body.error)).toMatch(/larger than 24 MB/);
  });

  it('reads a body under the limit and refuses one over it, by header and by what arrives', async () => {
    configureEnv({ AUDORA_MAX_BODY_BYTES: '64' });
    await expect(readBody(request('{"a":1}'))).resolves.toEqual({ a: 1 });
    // The declared length alone is enough: nothing is read.
    await expect(readBody(request('{}', { 'content-length': '65' }))).rejects.toMatchObject({ status: 413 });
    // A body with no honest length is stopped by the running total instead.
    await expect(readBody(request(`{"a":"${'x'.repeat(200)}"}`, {}))).rejects.toMatchObject({ status: 413 });
    configureEnv({});
  });
});

describe('units', () => {
  it('creates a property, a unit and its rooms', async () => {
    const h = harness();
    const r = await h.call('POST', '/api/v1/units', {
      address: '1247 Oak Street',
      unitNumber: '3B',
      floorLevel: 2,
      rooms: [{ name: 'Bedroom', type: 'bedroom', anchor: DOOR_ANCHOR }],
    });

    expect(r.status).toBe(201);
    const unit = (r.body as { unit: UnitRow }).unit;
    expect(unit.unit_number).toBe('3B');
    expect(h.db.rows('properties')).toHaveLength(1);
    expect(h.db.rows('rooms')).toHaveLength(1);
  });

  it('400s without an address and 400s a body that is not JSON', async () => {
    const h = harness();
    expect((await h.call('POST', '/api/v1/units', {})).status).toBe(400);

    const res = new Res();
    await handleV1({ method: 'POST', url: '/api/v1/units', headers: {} }, res, {
      ...h.ctx,
      readBody: async () => { throw new SyntaxError('Unexpected token <'); },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'The request body is not valid JSON.' });
  });

  it('returns the unit with its rooms, photos, worlds and jobs', async () => {
    const h = harness();
    const created = await seedUnit(h);
    const r = await h.call('GET', `/api/v1/units/${created.unit.id}`);

    expect(r.status).toBe(200);
    expect(r.body.unit).toMatchObject({ id: created.unit.id });
    expect(r.body.rooms).toHaveLength(1);
    expect(r.body.photos).toHaveLength(1);
    expect(r.body.worlds).toEqual([]);
    expect(r.body.jobs).toEqual([]);
    expect(r.body.publication).toBeNull();
  });

  it('uploads a photo and reports the duplicate on the second try', async () => {
    const h = harness();
    const created = await createUnit(h.db, ORG, { address: '1247 Oak Street', rooms: [{ name: 'Bedroom', type: 'bedroom', anchor: DOOR_ANCHOR }] });
    const payload = { roomId: created.rooms[0].id, role: 'primary', dataUrl: PHOTO, origin: 'file' };

    const first = await h.call('POST', `/api/v1/units/${created.unit.id}/photos`, payload);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ duplicate: false });
    const photo = first.body.photo as Record<string, unknown>;
    expect(String(photo.sha256)).toMatch(/^[0-9a-f]{64}$/);
    // The response says where nothing: no storage path, no org id, nothing the buyer's side needs.
    expect(Object.keys(photo).sort()).toEqual(['angle', 'azimuth', 'canonicalSha256', 'exif', 'height', 'id', 'role', 'roomId', 'sha256', 'width']);

    const second = await h.call('POST', `/api/v1/units/${created.unit.id}/photos`, payload);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    expect(h.db.rows('photos')).toHaveLength(1);
  });

  it('lists the unit’s jobs', async () => {
    const h = harness();
    const created = await seedUnit(h);
    await h.call('POST', `/api/v1/units/${created.unit.id}/generate`, {});
    const r = await h.call('GET', `/api/v1/units/${created.unit.id}/jobs`);

    expect(r.status).toBe(200);
    expect((r.body.jobs as unknown[])).toHaveLength(1);
    expect((r.body.jobs as { kind: string }[])[0].kind).toBe('generate');
  });
});

describe('generate', () => {
  it('enqueues the first time and attaches the second, and says which', async () => {
    const h = harness();
    const created = await seedUnit(h);

    const first = await h.call('POST', `/api/v1/units/${created.unit.id}/generate`, { tier: 'draft' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ tier: 'draft', attached: 0, enqueued: 1, skipped: [] });
    expect((first.body.rooms as { attached: boolean; jobId: string }[])[0].attached).toBe(false);

    const second = await h.call('POST', `/api/v1/units/${created.unit.id}/generate`, { tier: 'draft' });
    expect(second.body).toMatchObject({ attached: 1, enqueued: 0 });
    expect(h.db.rows('jobs')).toHaveLength(1);
    expect(h.db.rows('worlds')).toHaveLength(1);
  });

  it('names the mock model in the recipe when no World Labs key is configured', async () => {
    const h = harness({ env: {} });
    const created = await seedUnit(h);
    await h.call('POST', `/api/v1/units/${created.unit.id}/generate`, {});
    const world = h.db.rows<{ provider: string; model: string; tier: string; pipeline_version: string }>('worlds')[0];

    expect(world.provider).toBe('mock');
    expect(world.model).toBe('mock-draft-1');
    expect(world.tier).toBe('draft');
    expect(world.pipeline_version).toBe('1');
  });

  it('refuses a tier that is neither draft nor full instead of quietly making a draft', async () => {
    const h = harness();
    const created = await seedUnit(h);
    for (const tier of ['ultra', 'Full', 7, '']) {
      const r = await h.call('POST', `/api/v1/units/${created.unit.id}/generate`, { tier });
      expect({ tier, status: r.status }).toEqual({ tier, status: 400 });
      expect(String(r.body.error)).toContain('tier must be draft or full');
    }
    // ...and nothing was planned or enqueued behind the refusal.
    expect(h.db.rows('worlds')).toHaveLength(0);
    expect(h.db.rows('jobs')).toHaveLength(0);
    // An absent tier is still the documented default.
    expect((await h.call('POST', `/api/v1/units/${created.unit.id}/generate`, {})).body).toMatchObject({ tier: 'draft' });
  });

  it('reports the rooms it could not plan instead of quietly skipping them', async () => {
    const h = harness();
    const created = await createUnit(h.db, ORG, { address: '1247 Oak Street', rooms: [{ name: 'Bedroom', type: 'bedroom', anchor: DOOR_ANCHOR }] });
    const r = await h.call('POST', `/api/v1/units/${created.unit.id}/generate`, {});

    expect(r.body).toMatchObject({ attached: 0, enqueued: 0 });
    expect(r.body.skipped).toEqual([{ roomId: created.rooms[0].id, name: 'Bedroom', reason: 'no photo' }]);
  });
});

describe('publish and the public routes', () => {
  async function publishedUnit(h: Harness) {
    const created = await seedUnit(h);
    await h.call('POST', `/api/v1/units/${created.unit.id}/generate`, {});
    const provider = mockProvider();
    for (let i = 0; i < 8; i += 1) {
      const tick = await runWorkerOnce(h.db, h.storage, provider, 'worker-1', { now: () => h.clk.ms });
      if (!tick.claimed) break;
      h.clk.ms += 5_000;
    }
    const publish = await h.call('POST', `/api/v1/units/${created.unit.id}/publish`, { published: true, disclosures: { staged: true } });
    return { created, publish };
  }

  it('publishes, and the public document needs no token at all', async () => {
    const h = harness();
    const { created, publish } = await publishedUnit(h);

    expect(publish.status).toBe(200);
    expect(String(publish.body.shareId)).toMatch(/^[a-z0-9]{8}$/);
    expect(publish.body.published).toBe(true);
    expect(publish.body.modelDate).toBeTruthy();

    // The same database, reached by a caller whose token would be rejected: a buyer has no account.
    const anonymous = h.withAuth(async () => { throw new AuthError(401, 'Sign in required'); });
    const res = await anonymous('GET', `/api/v1/public/${publish.body.shareId}`);
    expect(res.handled).toBe(true);
    expect(res.status).toBe(200);
    const tour = res.body as unknown as { unit: { id: string }; rooms: { draft: { spzUrl: string } | null }[] };
    expect(tour.unit.id).toBe(created.unit.id);
    expect(tour.rooms[0].draft?.spzUrl).toContain('/storage/v1/object/public/worlds/');
    expect(JSON.stringify(tour)).not.toContain('mock://');
  });

  it('takes an event from the public page without a token, and refuses an unknown type', async () => {
    const h = harness();
    const { publish } = await publishedUnit(h);
    const shareId = String(publish.body.shareId);

    const ok = await h.call('POST', `/api/v1/public/${shareId}/events`, { type: 'walk', visitorId: 'v-1' });
    expect(ok.status).toBe(200);
    expect(h.db.rows('analytics_events')).toHaveLength(1);

    expect((await h.call('POST', `/api/v1/public/${shareId}/events`, { type: 'ransack' })).status).toBe(400);
    expect((await h.call('GET', '/api/v1/public/nope')).status).toBe(404);
  });

  it('unpublishes, and the share link stops working', async () => {
    const h = harness();
    const { created, publish } = await publishedUnit(h);
    const off = await h.call('POST', `/api/v1/units/${created.unit.id}/publish`, { published: false });

    expect(off.body.published).toBe(false);
    expect(off.body.shareId).toBe(publish.body.shareId);
    expect((await h.call('GET', `/api/v1/public/${publish.body.shareId}`)).status).toBe(404);
    expect(h.db.rows<PublicationRow>('publications')).toHaveLength(1);
  });
});

describe('the renter’s furniture', () => {
  it('round-trips a visitor’s list by visitor id, with no account anywhere', async () => {
    // Every call below goes through a context whose auth would throw: none of them may reach it.
    const h = harness({ auth: async () => { throw new AuthError(401, 'Sign in required'); } });
    const sofa = { id: 's1', name: 'Sectional', w: 2.2, d: 0.95, h: 0.85 };
    const rug = { id: 'r1', name: 'Rug', w: 2.4, d: 1.7, h: 0.02 };

    expect((await h.call('GET', '/api/v1/stuff?visitor=v-1')).body).toEqual({ items: [] });
    const put = await h.call('POST', '/api/v1/stuff', { visitorId: 'v-1', items: [sofa] });
    expect(put.body).toEqual({ items: [sofa] });

    const added = await h.call('POST', '/api/v1/stuff', { visitorId: 'v-1', item: rug });
    expect(added.body).toEqual({ items: [sofa, rug] });

    const renamed = await h.call('POST', '/api/v1/stuff', { visitorId: 'v-1', item: { ...rug, name: 'Hallway rug' } });
    expect(renamed.body).toEqual({ items: [sofa, { ...rug, name: 'Hallway rug' }] });
    expect((await h.call('GET', '/api/v1/stuff', undefined, { 'x-audora-visitor': 'v-1' })).body).toEqual({ items: [sofa, { ...rug, name: 'Hallway rug' }] });

    // One visitor never sees another's.
    expect((await h.call('GET', '/api/v1/stuff?visitor=v-2')).body).toEqual({ items: [] });
    expect((await h.call('GET', '/api/v1/stuff')).status).toBe(400);
  });
});
