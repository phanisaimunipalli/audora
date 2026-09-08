/// <reference types="node" />
/**
 * The v1 HTTP routes — docs/BACKEND.md §6, exactly the table in it and nothing else.
 *
 * `handleV1` is mounted at the top of `handleApi` (server/api.ts) for every path under `/api/v1/`,
 * so the dev server, the preview server and `server/prod.ts` all serve the same routes with no
 * framework: plain request in, JSON out.
 *
 * Conventions this module relies on:
 * - The request and the response are structural (`V1Request` / `V1Response`), not Node's classes.
 *   `IncomingMessage` and `ServerResponse` satisfy them, and a test can answer a route with an
 *   object literal. Reading the body is `ctx.readBody`, because that is the one thing that really
 *   is a stream, and `server/api.ts` already owns that pattern.
 * - Authentication is `ctx.auth`, built by `defaultAuth` from `server/auth.ts`: a Supabase access
 *   token as `Authorization: Bearer`, or `AUDORA_DEV_ORG` outside production. Public routes never
 *   call it — a buyer with a share link has no account, and the visitor's furniture is keyed by a
 *   visitor id the browser generates.
 * - When the backend is not configured (`dbFromEnv` returned null) every v1 route answers
 *   503 `{ error: 'backend not configured' }` and the app keeps its browser-local store, so
 *   nothing existing breaks.
 * - Errors carry their own status: `PipelineError`, `AuthError`, `DbError` and `StorageError` all
 *   expose `status`; anything else is a 500 with its message. No response ever contains a key: the
 *   only strings that reach the client are our own sentences and PostgREST's.
 *
 * Compiles under tsconfig.node.json (bundler) and tsconfig.server.json (NodeNext): relative
 * imports inside server/ carry the `.js` extension.
 */
import { AuthError, authenticate, type Actor } from './auth.js';
import type { Db } from './db.js';
import {
  PipelineError,
  addFloorPlan,
  addPhoto,
  createUnit,
  generateUnit,
  getStuff,
  publicTour,
  publishUnit,
  putStuff,
  recordEvent,
  TIERS,
  unitDocument,
  unitJobs,
  type CreateRoomInput,
  type PipelineDb,
  type PipelineStorage,
  type PlanContext,
  type Row,
  type SiteJson,
} from './pipeline.js';
import type { RecipeTier } from './recipe.js';
import { providerFor } from './worker.js';

/* ---------- the ports ---------- */

/** What a route reads off the request. `IncomingMessage` satisfies it. */
export interface V1Request {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/** What a route writes. `ServerResponse` satisfies it. */
export interface V1Response {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(chunk: string): unknown;
}

export interface V1Context {
  /** Null when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are not set: every route then answers 503. */
  db: PipelineDb | null;
  storage: PipelineStorage | null;
  env: Record<string, string | undefined>;
  /** Parse the request body as JSON. Rejects on malformed JSON, which becomes a 400. */
  readBody: (req: V1Request) => Promise<unknown>;
  /** Resolve the caller. `defaultAuth(db, env)` is the real one; tests inject their own. */
  auth: (authorization: string | undefined) => Promise<Actor>;
  /** The model id each tier resolves to, from `server/api.ts`'s `models()`. */
  models?: { draft: string; full: string };
  now?: () => number;
}

/** The real resolver: a verified Supabase user and their organisation, or `AUDORA_DEV_ORG`. */
export function defaultAuth(db: Db, env: Record<string, string | undefined>): (authorization: string | undefined) => Promise<Actor> {
  return (authorization) => authenticate(db, authorization ?? null, env);
}

/* ---------- plumbing ---------- */

function json(res: V1Response, status: number, body: unknown): true {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
  return true;
}

/** The status an error already knows about; 500 for anything that does not. */
function statusOf(e: unknown): number {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500;
}

function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'server error';
}

const header = (req: V1Request, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

const asRecord = (body: unknown): Row => (body && typeof body === 'object' && !Array.isArray(body) ? (body as Row) : {});

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A uuid path segment. Anything else is a 404 rather than a query against a column that will not match. */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A share id: what `shareIdForUnit` mints, plus the demo's own hand-written ones. */
const SHARE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

async function body(req: V1Request, ctx: V1Context): Promise<Row> {
  try {
    return asRecord(await ctx.readBody(req));
  } catch (e) {
    // A body that was refused for its SIZE already knows its own status (413) and its own sentence;
    // only a parse failure is "not valid JSON".
    const status = (e as { status?: unknown } | null)?.status;
    if (typeof status === 'number' && status >= 400 && status <= 599) throw e;
    throw new PipelineError(400, 'The request body is not valid JSON.');
  }
}

const MOCK_MODEL: Record<RecipeTier, string> = { draft: 'mock-draft-1', full: 'mock-full-1' };

function planContext(ctx: V1Context, tier: RecipeTier): PlanContext {
  const provider = providerFor(ctx.env);
  const models = ctx.models ?? { draft: 'marble-1.0-draft', full: 'marble-1.1' };
  return {
    pipelineVersion: (ctx.env.PIPELINE_VERSION || '1').trim() || '1',
    provider,
    // The model id is part of the recipe, so it has to name what will really run: a simulated world
    // and a Marble world of the same room are two different recipes, which is the honest answer.
    model: provider === 'mock' ? MOCK_MODEL[tier] : tier === 'full' ? models.full : models.draft,
  };
}

/**
 * The tier a `generate` body asks for. Absent means draft (the documented default); anything that
 * is not one of the two is refused rather than quietly downgraded — the tier is part of the recipe,
 * so a caller who typed `"Full"` would otherwise get a draft world and a hash they cannot predict,
 * with nothing in the answer saying so.
 */
function tierOf(value: unknown): RecipeTier {
  if (value === undefined || value === null) return 'draft';
  if (typeof value === 'string' && TIERS.has(value)) return value as RecipeTier;
  throw new PipelineError(400, `tier must be draft or full, got ${JSON.stringify(value)}`);
}

/* ---------- the router ---------- */

/**
 * Answer one `/api/v1/*` request. Resolves false only for a path that is not v1 at all, so the
 * caller can go on serving; every v1 path, known or not, gets a JSON answer.
 */
export async function handleV1(req: V1Request, res: V1Response, ctx: V1Context): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/api/v1' && !path.startsWith('/api/v1/')) return false;
  const method = (req.method || 'GET').toUpperCase();
  try {
    return await route(req, res, ctx, method, path, url);
  } catch (e) {
    return json(res, statusOf(e), { error: messageOf(e) });
  }
}

async function route(req: V1Request, res: V1Response, ctx: V1Context, method: string, path: string, url: URL): Promise<boolean> {
  const { db, storage } = ctx;
  // docs/BACKEND.md §6: without Supabase the routes answer 503 and the app keeps its local store.
  if (!db || !storage) return json(res, 503, { error: 'backend not configured' });

  /* ----- public: no account, no token ----- */

  let m = /^\/api\/v1\/public\/([^/]+)$/.exec(path);
  if (m && method === 'GET') {
    const shareId = decodeURIComponent(m[1]);
    if (!SHARE_ID.test(shareId)) return json(res, 404, { error: 'No such tour.' });
    return json(res, 200, await publicTour(db, storage, shareId));
  }
  m = /^\/api\/v1\/public\/([^/]+)\/events$/.exec(path);
  if (m && method === 'POST') {
    const shareId = decodeURIComponent(m[1]);
    if (!SHARE_ID.test(shareId)) return json(res, 404, { error: 'No such tour.' });
    const b = await body(req, ctx);
    return json(res, 200, await recordEvent(db, shareId, {
      type: String(b.type ?? ''),
      roomId: str(b.roomId) ?? null,
      item: str(b.item) ?? null,
      visitorId: str(b.visitorId) ?? header(req, 'x-audora-visitor') ?? null,
    }));
  }

  /* ----- the renter's own furniture, by visitor id ----- */

  if (path === '/api/v1/stuff' && (method === 'GET' || method === 'POST')) {
    if (method === 'GET') {
      const visitor = url.searchParams.get('visitor') || header(req, 'x-audora-visitor') || '';
      return json(res, 200, { items: await getStuff(db, visitor) });
    }
    const b = await body(req, ctx);
    const visitor = str(b.visitorId) || header(req, 'x-audora-visitor') || '';
    return json(res, 200, { items: await putStuff(db, visitor, { items: b.items, item: b.item }) });
  }

  /* ----- everything else acts inside an organisation ----- */

  if (!path.startsWith('/api/v1/units')) return json(res, 404, { error: `No route for ${method} ${path}` });
  const actor = await ctx.auth(header(req, 'authorization'));
  const org = actor.orgId;

  if (path === '/api/v1/units' && method === 'POST') {
    const b = await body(req, ctx);
    const address = str(b.address);
    if (!address) return json(res, 400, { error: 'An address is required.' });
    const created = await createUnit(db, org, {
      address,
      propertyName: str(b.propertyName),
      lat: num(b.lat),
      lon: num(b.lon),
      site: (b.site as SiteJson | null | undefined) ?? null,
      unitNumber: str(b.unitNumber) ?? null,
      floorLevel: num(b.floorLevel) ?? null,
      beds: num(b.beds) ?? null,
      baths: num(b.baths) ?? null,
      sqft: num(b.sqft) ?? null,
      rentCents: num(b.rentCents) ?? null,
      currency: str(b.currency) ?? null,
      availableOn: str(b.availableOn) ?? null,
      listingUrl: str(b.listingUrl) ?? null,
      listingSource: str(b.listingSource) ?? null,
      summary: str(b.summary) ?? null,
      externalRef: str(b.externalRef) ?? null,
      rooms: Array.isArray(b.rooms) ? (b.rooms as CreateRoomInput[]) : [],
    });
    return json(res, 201, created);
  }

  m = /^\/api\/v1\/units\/([^/]+)(\/[a-z-]+)?$/.exec(path);
  if (!m) return json(res, 404, { error: `No route for ${method} ${path}` });
  const unitId = decodeURIComponent(m[1]);
  const leaf = m[2] ?? '';
  if (!UUID.test(unitId)) return json(res, 404, { error: 'No such unit.' });

  if (leaf === '' && method === 'GET') return json(res, 200, await unitDocument(db, org, unitId));

  if (leaf === '/photos' && method === 'POST') {
    const b = await body(req, ctx);
    const added = await addPhoto(db, storage, org, unitId, {
      roomId: str(b.roomId) ?? null,
      role: str(b.role),
      angle: str(b.angle) ?? null,
      dataUrl: str(b.dataUrl),
      fileName: str(b.fileName) ?? null,
      origin: str(b.origin),
      sourceUrl: str(b.sourceUrl) ?? null,
    });
    return json(res, added.duplicate ? 200 : 201, {
      duplicate: added.duplicate,
      photo: {
        id: added.photo.id,
        roomId: added.photo.room_id ?? null,
        sha256: added.photo.sha256,
        canonicalSha256: added.photo.canonical_sha256 ?? null,
        width: added.photo.width ?? null,
        height: added.photo.height ?? null,
        role: added.photo.role ?? 'extra',
        angle: added.photo.angle ?? null,
        azimuth: added.photo.azimuth ?? null,
        exif: added.photo.exif ?? null,
      },
    });
  }

  if (leaf === '/floor-plan' && method === 'POST') {
    const b = await body(req, ctx);
    const added = await addFloorPlan(db, storage, org, unitId, {
      dataUrl: str(b.dataUrl),
      fileName: str(b.fileName) ?? null,
      parsed: (b.parsed as Row) ?? null,
    }, (ctx.now ?? Date.now)());
    return json(res, 201, added);
  }

  if (leaf === '/generate' && method === 'POST') {
    const b = await body(req, ctx);
    const tier = tierOf(b.tier);
    return json(res, 200, await generateUnit(db, org, unitId, tier, planContext(ctx, tier), (ctx.now ?? Date.now)()));
  }

  if (leaf === '/jobs' && method === 'GET') return json(res, 200, { jobs: await unitJobs(db, org, unitId) });

  if (leaf === '/publish' && method === 'POST') {
    const b = await body(req, ctx);
    const published = b.published === undefined ? true : b.published === true;
    const pub = await publishUnit(db, org, unitId, published, {
      disclosures: b.disclosures === undefined ? undefined : ((b.disclosures as Row) ?? null),
      now: (ctx.now ?? Date.now)(),
    });
    return json(res, 200, {
      shareId: pub.share_id,
      published: pub.published,
      publishedAt: pub.published_at ?? null,
      modelDate: pub.model_date ?? null,
      disclosures: pub.disclosures ?? null,
    });
  }

  return json(res, 404, { error: `No route for ${method} ${path}` });
}

/** Re-exported so `server/api.ts` maps the same errors the routes do. */
export { AuthError, PipelineError };
