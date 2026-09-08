/**
 * server/db.ts, server/storage.ts and server/auth.ts against a fake fetch. Nothing here touches a
 * network: every test records the requests the clients make and asserts the exact URL, headers and
 * body, then feeds back a canned response.
 */
import { describe, expect, it } from 'vitest';
import { Db, DbError, dbFromEnv, filterParams, selectQuery } from '../server/db';
import { Storage, StorageError, encodeObjectPath } from '../server/storage';
import { AuthError, authenticate, bearerToken, createOrgWithOwner, devOrg, memberOrg, verifyUser } from '../server/auth';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Uint8Array | null;
}

interface Canned {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A fetch that answers from a queue of canned responses and remembers what it was asked. */
function fakeFetch(queue: Canned[] = []) {
  const calls: Recorded[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) || {})) headers[k] = v;
    const raw = init?.body;
    calls.push({
      url,
      method: init?.method || 'GET',
      headers,
      body: raw == null ? null : typeof raw === 'string' ? raw : raw instanceof Uint8Array ? raw : String(raw),
    });
    const next = queue.shift() ?? { status: 200, body: [] };
    const status = next.status ?? 200;
    const body = next.body === undefined ? null : typeof next.body === 'string' || next.body instanceof Uint8Array ? next.body : JSON.stringify(next.body);
    return new Response(status === 204 ? null : (body as ConstructorParameters<typeof Response>[0]), {
      status,
      headers: { 'content-type': 'application/json', ...(next.headers || {}) },
    });
  };
  return { fetch, calls };
}

const URL_ = 'https://ref.supabase.co';
const KEY = 'service-role-key';
const db = (queue?: Canned[]) => {
  const f = fakeFetch(queue);
  return { db: new Db({ url: URL_, serviceKey: KEY, fetch: f.fetch }), calls: f.calls };
};

describe('dbFromEnv', () => {
  it('returns null without the url and the service key', () => {
    expect(dbFromEnv({})).toBeNull();
    expect(dbFromEnv({ SUPABASE_URL: URL_ })).toBeNull();
    expect(dbFromEnv({ SUPABASE_SERVICE_ROLE_KEY: KEY })).toBeNull();
    expect(dbFromEnv({ SUPABASE_URL: '  ', SUPABASE_SERVICE_ROLE_KEY: KEY })).toBeNull();
  });

  it('builds a client and strips the trailing slash', () => {
    const d = dbFromEnv({ SUPABASE_URL: `${URL_}/`, SUPABASE_SERVICE_ROLE_KEY: KEY, SUPABASE_ANON_KEY: 'anon' });
    expect(d).not.toBeNull();
    expect(d!.url).toBe(URL_);
    expect(d!.config.anonKey).toBe('anon');
  });
});

describe('query syntax', () => {
  it('turns filters into PostgREST operators, sorted by column', () => {
    expect(
      filterParams({
        unit_id: 'u1',
        deleted: null,
        status: { op: 'in', value: ['queued', 'running'] },
        progress: { op: 'gte', value: 50 },
        name: { op: 'like', value: '*Oak*' },
        archived: { op: 'is', value: false },
      }),
    ).toEqual([
      ['archived', 'is.false'],
      ['deleted', 'is.null'],
      ['name', 'like.*Oak*'],
      ['progress', 'gte.50'],
      ['status', 'in.(queued,running)'],
      ['unit_id', 'eq.u1'],
    ]);
  });

  it('quotes in-list items that would split the list', () => {
    expect(filterParams({ name: { op: 'in', value: ['Oak Street', 'a,b', 'plain'] } })).toEqual([['name', 'in.("Oak Street","a,b",plain)']]);
  });

  it('builds select, filters, order, limit and offset in a fixed order', () => {
    expect(
      selectQuery({
        columns: 'id,name',
        filters: { org_id: 'o1' },
        order: [{ column: 'created_at', ascending: false }, { column: 'id' }],
        limit: 5,
        offset: 10,
      }),
    ).toBe('select=id%2Cname&org_id=eq.o1&order=created_at.desc%2Cid.asc&limit=5&offset=10');
    expect(selectQuery({})).toBe('select=*');
    expect(selectQuery({ order: 'sort_order.asc.nullslast' })).toBe('select=*&order=sort_order.asc.nullslast');
  });
});

describe('Db.select', () => {
  it('GETs /rest/v1/<table> with the service key as apikey and bearer', async () => {
    const { db: d, calls } = db([{ body: [{ id: 'r1' }] }]);
    const rows = await d.select('rooms', { filters: { unit_id: 'u1' }, order: { column: 'sort_order' }, limit: 20 });
    expect(rows).toEqual([{ id: 'r1' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`${URL_}/rest/v1/rooms?select=*&unit_id=eq.u1&order=sort_order.asc&limit=20`);
    expect(calls[0].headers).toEqual({ apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' });
    expect(calls[0].body).toBeNull();
  });

  it('asks for a single object with the pgrst.object Accept header', async () => {
    const { db: d, calls } = db([{ body: { id: 'u1', status: 'draft' } }]);
    const row = await d.select<{ id: string }>('units', { filters: { id: 'u1' }, single: true });
    expect(row).toEqual({ id: 'u1', status: 'draft' });
    expect(calls[0].headers.Accept).toBe('application/vnd.pgrst.object+json');
    expect(calls[0].url).toBe(`${URL_}/rest/v1/units?select=*&id=eq.u1`);
  });

  it('reads a 406 for zero rows as null, and anything else as an error', async () => {
    const zero = { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' };
    const two = { code: 'PGRST116', details: 'Results contain 2 rows, application/vnd.pgrst.object+json requires 1 row', message: 'JSON object requested, multiple (or no) rows returned' };
    const { db: d } = db([
      { status: 406, body: zero },
      { status: 406, body: two },
    ]);
    expect(await d.select('units', { filters: { id: 'nope' }, single: true })).toBeNull();
    await expect(d.select('units', { filters: { status: 'draft' }, single: true })).rejects.toMatchObject({ name: 'DbError', status: 406, code: 'PGRST116' });
  });

  it('reads zero rows as null whichever status PostgREST used for it', async () => {
    // PostgREST has answered both 404 and 406 for PGRST116 across versions; the details are the
    // stable half of the signal, so the client keys on them and not on the status.
    const { db: d } = db([{ status: 404, body: { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested' } }]);
    expect(await d.select('publications', { filters: { share_id: 'nope' }, single: true })).toBeNull();
  });
});

describe('Db writes', () => {
  it('inserts with return=representation and always sends an array', async () => {
    const { db: d, calls } = db([{ status: 201, body: [{ id: 'p1', name: 'Oak' }] }]);
    const rows = await d.insert('properties', { name: 'Oak', org_id: 'o1' });
    expect(rows).toEqual([{ id: 'p1', name: 'Oak' }]);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${URL_}/rest/v1/properties`);
    expect(calls[0].headers).toEqual({
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
      Prefer: 'return=representation',
      'Content-Type': 'application/json',
    });
    expect(calls[0].body).toBe(JSON.stringify([{ name: 'Oak', org_id: 'o1' }]));
  });

  it('upserts with resolution=merge-duplicates and on_conflict', async () => {
    const { db: d, calls } = db([{ status: 201, body: [{ id: 'w1' }] }]);
    await d.insert('worlds', [{ recipe_hash: 'abc' }], { upsert: true, onConflict: 'recipe_hash' });
    expect(calls[0].url).toBe(`${URL_}/rest/v1/worlds?on_conflict=recipe_hash`);
    expect(calls[0].headers.Prefer).toBe('return=representation,resolution=merge-duplicates');
    expect(calls[0].body).toBe(JSON.stringify([{ recipe_hash: 'abc' }]));
  });

  it('patches the rows the filters select', async () => {
    const { db: d, calls } = db([{ body: [{ id: 'j1', status: 'running' }] }]);
    const rows = await d.update('jobs', { id: 'j1', status: 'queued' }, { status: 'running', progress: 10 });
    expect(rows).toEqual([{ id: 'j1', status: 'running' }]);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toBe(`${URL_}/rest/v1/jobs?id=eq.j1&status=eq.queued`);
    expect(calls[0].headers.Prefer).toBe('return=representation');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(calls[0].body).toBe(JSON.stringify({ status: 'running', progress: 10 }));
  });

  it('deletes the rows the filters select', async () => {
    const { db: d, calls } = db([{ body: [{ id: 'x' }] }]);
    await d.del('photos', { id: 'x' });
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe(`${URL_}/rest/v1/photos?id=eq.x`);
    expect(calls[0].headers.Prefer).toBe('return=representation');
    expect(calls[0].body).toBeNull();
  });

  it('refuses an update or delete without a filter', async () => {
    const { db: d, calls } = db();
    await expect(d.update('jobs', {}, { status: 'done' })).rejects.toBeInstanceOf(DbError);
    await expect(d.del('jobs', {})).rejects.toBeInstanceOf(DbError);
    expect(calls).toHaveLength(0);
  });

  it('calls a function through /rpc', async () => {
    const { db: d, calls } = db([{ body: true }]);
    expect(await d.rpc('is_org_member', { org: 'o1' })).toBe(true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${URL_}/rest/v1/rpc/is_org_member`);
    expect(calls[0].body).toBe(JSON.stringify({ org: 'o1' }));
  });

  it('treats an empty body as no rows', async () => {
    const { db: d } = db([{ status: 204 }]);
    expect(await d.insert('analytics_events', { unit_id: 'u1', type: 'visit' })).toEqual([]);
  });
});

describe('DbError', () => {
  it('carries the status and the PostgREST message, code, details and hint', async () => {
    const { db: d } = db([
      {
        status: 409,
        body: { code: '23505', message: 'duplicate key value violates unique constraint "worlds_recipe"', details: 'Key (recipe_hash)=(abc) already exists.', hint: null },
      },
    ]);
    const err = await d.insert('worlds', { recipe_hash: 'abc' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbError);
    const e = err as DbError;
    expect(e.status).toBe(409);
    expect(e.code).toBe('23505');
    expect(e.message).toBe('duplicate key value violates unique constraint "worlds_recipe"');
    expect(e.details).toBe('Key (recipe_hash)=(abc) already exists.');
    expect(e.hint).toBeNull();
    expect(e.method).toBe('POST');
    expect(e.path).toBe('/rest/v1/worlds');
  });

  it('still reports a non-JSON error body', async () => {
    const { db: d } = db([{ status: 502, body: 'bad gateway', headers: { 'content-type': 'text/plain' } }]);
    await expect(d.select('rooms')).rejects.toMatchObject({ status: 502, message: 'bad gateway' });
  });

  it('turns an unreachable Supabase into a DbError rather than a raw TypeError', async () => {
    const boom = new TypeError('fetch failed');
    const d = new Db({
      url: URL_,
      serviceKey: KEY,
      fetch: () => Promise.reject(boom),
    });
    const err = await d.select('rooms').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbError);
    expect(err as DbError).toMatchObject({ status: 502, code: 'FETCH_FAILED', method: 'GET', path: '/rest/v1/rooms', cause: boom });
  });
});

describe('Storage', () => {
  const storage = (queue?: Canned[]) => {
    const f = fakeFetch(queue);
    return { s: new Storage({ url: `${URL_}/`, serviceKey: KEY, fetch: f.fetch }), calls: f.calls };
  };

  it('encodes each path segment and keeps the slashes', () => {
    expect(encodeObjectPath('org1/unit 2/a#b.jpg')).toBe('org1/unit%202/a%23b.jpg');
    expect(encodeObjectPath('/leading//double/')).toBe('leading/double');
  });

  it('uploads with the service key, the content type and x-upsert', async () => {
    const { s, calls } = storage([{ body: { Key: 'photos/o1/u1/abc.jpg', Id: 'obj-1' } }]);
    const bytes = new Uint8Array([1, 2, 3]);
    const out = await s.upload('photos', 'o1/u1/abc.jpg', bytes, 'image/jpeg');
    expect(out).toEqual({ key: 'photos/o1/u1/abc.jpg', id: 'obj-1', path: 'o1/u1/abc.jpg' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${URL_}/storage/v1/object/photos/o1/u1/abc.jpg`);
    expect(calls[0].headers).toEqual({
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'false',
    });
    expect(calls[0].body).toBe(bytes);
  });

  it('sets x-upsert and cache-control when asked', async () => {
    const { s, calls } = storage([{ body: {} }]);
    await s.upload('worlds', 'w1/500k.spz', 'text', 'application/octet-stream', { upsert: true, cacheControl: 31536000 });
    expect(calls[0].headers['x-upsert']).toBe('true');
    expect(calls[0].headers['Cache-Control']).toBe('max-age=31536000');
    expect(calls[0].url).toBe(`${URL_}/storage/v1/object/worlds/w1/500k.spz`);
  });

  it('maps a storage error to StorageError', async () => {
    const { s } = storage([{ status: 400, body: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } }]);
    const err = await s.upload('photos', 'o1/u1/abc.jpg', 'x', 'image/jpeg').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err as StorageError).toMatchObject({ status: 400, code: '409', message: 'The resource already exists' });
  });

  it('downloads through the authenticated route as a Buffer', async () => {
    const { s, calls } = storage([{ body: new Uint8Array([9, 8, 7]), headers: { 'content-type': 'image/jpeg' } }]);
    const buf = await s.download('plans', 'o1/u1/plan.png');
    expect(Array.from(buf)).toEqual([9, 8, 7]);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`${URL_}/storage/v1/object/plans/o1/u1/plan.png`);
    expect(calls[0].headers).toEqual({ apikey: KEY, Authorization: `Bearer ${KEY}` });
  });

  it('builds the public URL without touching the network', () => {
    const { s, calls } = storage();
    expect(s.publicUrl('worlds', 'w1/collider.glb')).toBe(`${URL_}/storage/v1/object/public/worlds/w1/collider.glb`);
    expect(s.publicUrl('stills', 'o1/u1/still 1.jpg')).toBe(`${URL_}/storage/v1/object/public/stills/o1/u1/still%201.jpg`);
    expect(calls).toHaveLength(0);
  });

  it('signs a private object and returns an absolute URL', async () => {
    const { s, calls } = storage([{ body: { signedURL: '/object/sign/photos/o1/u1/abc.jpg?token=tok' } }]);
    const url = await s.signedUrl('photos', 'o1/u1/abc.jpg', 600);
    expect(url).toBe(`${URL_}/storage/v1/object/sign/photos/o1/u1/abc.jpg?token=tok`);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${URL_}/storage/v1/object/sign/photos/o1/u1/abc.jpg`);
    expect(calls[0].body).toBe(JSON.stringify({ expiresIn: 600 }));
  });

  it('removes objects by prefix list', async () => {
    const { s, calls } = storage([{ body: [{ name: 'o1/u1/a.jpg' }, { name: 'o1/u1/b.jpg' }] }]);
    const gone = await s.remove('photos', ['o1/u1/a.jpg', 'o1/u1/b.jpg']);
    expect(gone).toEqual(['o1/u1/a.jpg', 'o1/u1/b.jpg']);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe(`${URL_}/storage/v1/object/photos`);
    expect(calls[0].body).toBe(JSON.stringify({ prefixes: ['o1/u1/a.jpg', 'o1/u1/b.jpg'] }));
    expect(await s.remove('photos', [])).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('turns an unreachable object store into a StorageError', async () => {
    const boom = new TypeError('fetch failed');
    const s = new Storage({ url: URL_, serviceKey: KEY, fetch: () => Promise.reject(boom) });
    const err = await s.download('worlds', 'w1/collider.glb').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err as StorageError).toMatchObject({ status: 502, code: 'FETCH_FAILED', cause: boom });
  });

  it('shares a Db’s configuration', () => {
    const f = fakeFetch();
    const d = new Db({ url: URL_, serviceKey: KEY, fetch: f.fetch });
    expect(Storage.from(d).publicUrl('worlds', 'x')).toBe(`${URL_}/storage/v1/object/public/worlds/x`);
  });
});

describe('auth', () => {
  it('reads a bearer token out of the header', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer   abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
  });

  it('verifies a user token with the anon key as apikey and the user token as bearer', async () => {
    const f = fakeFetch([{ body: { id: 'user-1', email: 'agent@example.com' } }]);
    const d = new Db({ url: URL_, serviceKey: KEY, anonKey: 'anon-key', fetch: f.fetch });
    const user = await verifyUser(d, 'Bearer user-jwt');
    expect(user).toEqual({ userId: 'user-1', email: 'agent@example.com' });
    expect(f.calls[0].method).toBe('GET');
    expect(f.calls[0].url).toBe(`${URL_}/auth/v1/user`);
    expect(f.calls[0].headers).toEqual({ apikey: 'anon-key', Authorization: 'Bearer user-jwt', Accept: 'application/json' });
  });

  it('falls back to the service key as apikey and rejects a bad token with 401', async () => {
    const f = fakeFetch([{ status: 401, body: { msg: 'invalid JWT' } }]);
    const d = new Db({ url: URL_, serviceKey: KEY, fetch: f.fetch });
    await expect(verifyUser(d, 'bad')).rejects.toMatchObject({ name: 'AuthError', status: 401, message: 'Invalid access token: invalid JWT' });
    expect(f.calls[0].headers.apikey).toBe(KEY);
    expect(f.calls[0].headers.Authorization).toBe('Bearer bad');
  });

  it('does not read an unreachable GoTrue as a rejected token', async () => {
    // A 401 here would tell a signed-in user their session expired because Supabase was down.
    const d = new Db({ url: URL_, serviceKey: KEY, fetch: () => Promise.reject(new TypeError('fetch failed')) });
    const err = await verifyUser(d, 'Bearer jwt').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AuthError);
    expect(err).toBeInstanceOf(DbError);
    expect(err as DbError).toMatchObject({ status: 502, code: 'FETCH_FAILED', path: '/auth/v1/user' });
  });

  it('reads the first membership', async () => {
    const { db: d, calls } = db([{ body: [{ org_id: 'org-1', role: 'admin' }] }]);
    expect(await memberOrg(d, 'user-1')).toEqual({ orgId: 'org-1', role: 'admin' });
    expect(calls[0].url).toBe(`${URL_}/rest/v1/org_members?select=org_id%2Crole&user_id=eq.user-1&order=created_at.asc&limit=1`);
    const none = db([{ body: [] }]);
    expect(await memberOrg(none.db, 'user-2')).toBeNull();
  });

  it('acts as AUDORA_DEV_ORG without a token, except in production', async () => {
    expect(devOrg({ AUDORA_DEV_ORG: 'org-dev' })).toBe('org-dev');
    expect(devOrg({ AUDORA_DEV_ORG: 'org-dev', NODE_ENV: 'development' })).toBe('org-dev');
    expect(devOrg({ AUDORA_DEV_ORG: 'org-dev', NODE_ENV: 'production' })).toBeNull();
    expect(devOrg({})).toBeNull();

    const { db: d, calls } = db();
    const actor = await authenticate(d, undefined, { AUDORA_DEV_ORG: 'org-dev' });
    expect(actor).toEqual({ userId: null, email: null, orgId: 'org-dev', role: 'owner', dev: true });
    expect(calls).toHaveLength(0);
    await expect(authenticate(d, undefined, { AUDORA_DEV_ORG: 'org-dev', NODE_ENV: 'production' })).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(d, undefined, {})).rejects.toBeInstanceOf(AuthError);
  });

  it('401s a header that carries no usable token instead of handing back the dev organisation', async () => {
    const { db: d, calls } = db();
    // A client that SENT `Authorization` and nothing in it — an empty `Bearer `, a token it just
    // cleared — is asking to be told to sign in. Taking the escape hatch here would make the
    // signed-out path impossible to test locally, and it is the opposite of what the caller means.
    // An empty or whitespace-only header is indistinguishable from no header at all, and keeps the
    // escape hatch; anything with content in it does not.
    expect(await authenticate(d, '   ', { AUDORA_DEV_ORG: 'org-dev' })).toMatchObject({ dev: true });
    for (const header of ['Bearer ', 'Bearer', 'Basic ', 'Bearer\t']) {
      await expect(authenticate(d, header, { AUDORA_DEV_ORG: 'org-dev' })).rejects.toMatchObject({ status: 401, message: 'Sign in required' });
    }
    expect(calls).toHaveLength(0);
  });

  it('resolves a signed-in user to their organisation, and 403s one with none', async () => {
    const f = fakeFetch([{ body: { id: 'user-1', email: 'a@b.c' } }, { body: [{ org_id: 'org-1', role: 'owner' }] }]);
    const d = new Db({ url: URL_, serviceKey: KEY, anonKey: 'anon', fetch: f.fetch });
    // A token in the header wins over the escape hatch even when it is configured.
    const actor = await authenticate(d, 'Bearer jwt', { AUDORA_DEV_ORG: 'org-dev' });
    expect(actor).toEqual({ userId: 'user-1', email: 'a@b.c', orgId: 'org-1', role: 'owner', dev: false });
    expect(f.calls.map((c) => c.url)).toEqual([`${URL_}/auth/v1/user`, `${URL_}/rest/v1/org_members?select=org_id%2Crole&user_id=eq.user-1&order=created_at.asc&limit=1`]);

    const g = fakeFetch([{ body: { id: 'user-9' } }, { body: [] }]);
    const d2 = new Db({ url: URL_, serviceKey: KEY, fetch: g.fetch });
    await expect(authenticate(d2, 'Bearer jwt', {})).rejects.toMatchObject({ status: 403 });
  });

  it('creates an organisation and its owner membership', async () => {
    const { db: d, calls } = db([{ status: 201, body: [{ id: 'org-1', name: 'Acme Leasing', slug: 'acme' }] }, { status: 201, body: [{ org_id: 'org-1', user_id: 'user-1', role: 'owner' }] }]);
    const org = await createOrgWithOwner(d, 'Acme Leasing', 'acme', 'user-1');
    expect(org).toEqual({ id: 'org-1', name: 'Acme Leasing', slug: 'acme' });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', `${URL_}/rest/v1/organizations`, JSON.stringify([{ name: 'Acme Leasing', slug: 'acme' }])],
      ['POST', `${URL_}/rest/v1/org_members`, JSON.stringify([{ org_id: 'org-1', user_id: 'user-1', role: 'owner' }])],
    ]);
  });

  it('removes the organisation again when the membership insert fails', async () => {
    const { db: d, calls } = db([
      { status: 201, body: [{ id: 'org-1', name: 'Acme', slug: 'acme' }] },
      { status: 409, body: { code: '23503', message: 'insert or update on table "org_members" violates foreign key constraint' } },
      { body: [{ id: 'org-1' }] },
    ]);
    await expect(createOrgWithOwner(d, 'Acme', 'acme', 'ghost')).rejects.toMatchObject({ status: 409, code: '23503' });
    expect(calls[2].method).toBe('DELETE');
    expect(calls[2].url).toBe(`${URL_}/rest/v1/organizations?id=eq.org-1`);
  });
});
