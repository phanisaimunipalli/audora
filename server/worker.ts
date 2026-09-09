/// <reference types="node" />
/**
 * The job worker — docs/BACKEND.md §4 steps 4 and 5. It claims jobs from `public.jobs`
 * (supabase/migrations/0002_claim_jobs.sql), submits a room's recipe to the reconstruction
 * provider, polls the operation, copies every asset the provider made into our own `worlds` bucket
 * so a share link keeps working after the provider's signed URLs expire, and then **measures the
 * collider it just stored** (docs/ACCURACY.md §3.2) so the room's metric dimensions, their
 * residuals against the plan and their confidence are computed once, on the server, rather than
 * re-derived by every reader.
 *
 * Conventions this module relies on:
 * - **State lives in the world row, never in this process.** A `generate` job that has already been
 *   submitted is recognised by `worlds.provider_operation_id`, so a worker that restarts mid-flight
 *   resumes polling instead of paying for a second generation. That is what makes rule 5 hold
 *   across a crash, and it is why `claim_jobs` may re-claim a `running` job.
 * - **A poll is not an attempt.** `claim_jobs` increments `attempts` only for a job it took from
 *   `queued`; between polls the worker leaves the job `running` and pushes `run_after` five seconds
 *   out, which is both the schedule and the lease.
 * - **The credit guard is real money.** A live Marble generation costs ~230 credits, so this
 *   process refuses more than `MARBLE_MAX_GENERATIONS` (default 3) of them, exactly as the
 *   `/api/marble/generate` route does. Exceeding it fails the job outright rather than retrying.
 * - **The mock provider is the end-to-end path.** `MARBLE_MOCK=1`, or no `WORLDLABS_API_KEY`, and
 *   the whole pipeline runs against tiny in-memory assets. Tests use it; nothing here ever calls a
 *   live API on its own.
 * - Time is an input: `now()` is injectable, and nothing that feeds a recipe or a hash reads a clock.
 *
 * Compiles under tsconfig.node.json (bundler) and tsconfig.server.json (NodeNext): relative
 * imports inside server/ carry the `.js` extension.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { FetchLike } from './db.js';
import { extensionForMime, sniffImage } from './photos.js';
import { mockColliderGlb } from './mockAssets.js';
import {
  PipelineError,
  measureColliderBytes,
  measureRoom,
  orderPhotos,
  pointRoomAtWorld,
  roomRecipeState,
  splitStoragePath,
  worldAssetPath,
  writeMeasurement,
  type JobRow,
  type PhotoRow,
  type PipelineDb,
  type PipelineStorage,
  type RoomRow,
  type Row,
  type UnitRow,
  type WorldAssets,
  type WorldRow,
} from './pipeline.js';
import { marbleRequestFrom, recipeHash, type MarbleImageInput, type MarbleRequestBody, type Recipe, type RecipeTier } from './recipe.js';

/* ---------- the provider port ---------- */

export interface ProviderSubmission {
  operationId: string;
  /** Marble hands the world id back on the first poll, not on submission; the mock knows it at once. */
  worldId?: string;
}

export interface ProviderProgress {
  done: boolean;
  /** 0–100 when the provider reports one. Marble reports a description, not a number. */
  progress?: number;
  /** The provider's own status line, shown as the job's `detail`. */
  status?: string;
  worldId?: string;
  error?: string;
}

/** What a finished world offers, as URLs on the provider's own CDN. Kept only as provenance. */
export interface ProviderAssets {
  worldId: string;
  /** Every splat resolution, keyed the way the provider keys it (`100k`, `500k`, `full_res`). */
  spz: Record<string, string>;
  collider?: string;
  pano?: string;
  thumbnail?: string;
  caption?: string;
  metricScaleFactor?: number | null;
  groundPlaneOffset?: number | null;
  /** The provider's own viewer link, for the provenance record. */
  worldUrl?: string;
}

export interface FetchedAsset {
  bytes: Buffer;
  contentType: string;
}

export interface WorldProvider {
  readonly name: 'marble' | 'mock';
  generate(request: MarbleRequestBody): Promise<ProviderSubmission>;
  poll(operationId: string): Promise<ProviderProgress>;
  world(worldId: string): Promise<ProviderAssets>;
  /**
   * The bytes behind one of `world()`'s URLs. Part of the port because the mock serves its assets
   * from memory: `copy_assets` must be exercisable without a network.
   */
  fetchAsset(url: string): Promise<FetchedAsset>;
}

/* ---------- Marble ---------- */

export const MARBLE_BASE = 'https://api.worldlabs.ai/marble/v1';

interface MarbleOperationBody {
  operation_id?: string;
  done?: boolean;
  metadata?: { progress_percent?: number; progress?: { status?: string; description?: string }; world_id?: string } | null;
  response?: MarbleWorldBody | null;
  error?: { code?: string; message?: string } | null;
}

interface MarbleWorldBody {
  world_id?: string;
  world_marble_url?: string;
  assets?: {
    thumbnail_url?: string;
    caption?: string;
    imagery?: { pano_url?: string };
    mesh?: { collider_mesh_url?: string };
    splats?: { spz_urls?: Record<string, string>; semantics_metadata?: { metric_scale_factor?: number | null; ground_plane_offset?: number | null } | null };
  } | null;
}

/**
 * The live provider: the same three endpoints `server/api.ts` proxies for the browser, with the
 * same `WLT-Api-Key` header. It is only ever constructed when a key is configured and
 * `MARBLE_MOCK` is not set — see `selectProvider`.
 */
export function marbleProvider(env: Record<string, string | undefined>, fetchImpl?: FetchLike): WorldProvider {
  const key = (env.WORLDLABS_API_KEY || '').trim();
  if (!key) throw new PipelineError(503, 'WORLDLABS_API_KEY is not set on the server.');
  const base = (env.MARBLE_BASE || MARBLE_BASE).replace(/\/+$/, '');
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await doFetch(`${base}${path}`, {
      ...init,
      headers: { 'WLT-Api-Key': key, 'content-type': 'application/json', ...((init?.headers as Record<string, string>) || {}) },
    });
    const text = await r.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: text };
    }
    if (!r.ok) {
      const message = (body as { error?: { message?: string } | string; detail?: string } | null)?.detail ?? (body as { error?: { message?: string } | string } | null)?.error;
      throw new PipelineError(r.status === 429 ? 429 : 502, `Marble ${path} answered ${r.status}: ${typeof message === 'string' ? message : JSON.stringify(message ?? text.slice(0, 200))}`);
    }
    return body as T;
  }

  return {
    name: 'marble',
    async generate(request) {
      const op = await call<MarbleOperationBody>('/worlds:generate', { method: 'POST', body: JSON.stringify(request) });
      if (!op.operation_id) throw new PipelineError(502, 'Marble returned no operation id.');
      return { operationId: op.operation_id, worldId: op.metadata?.world_id };
    },
    async poll(operationId) {
      const op = await call<MarbleOperationBody>(`/operations/${encodeURIComponent(operationId)}`);
      const progress = op.metadata?.progress;
      return {
        done: Boolean(op.done),
        progress: typeof op.metadata?.progress_percent === 'number' ? op.metadata.progress_percent : undefined,
        status: progress?.description || progress?.status || undefined,
        worldId: op.metadata?.world_id || op.response?.world_id || undefined,
        error: op.error?.message || (op.error?.code ? String(op.error.code) : undefined),
      };
    },
    async world(worldId) {
      const w = await call<MarbleWorldBody>(`/worlds/${encodeURIComponent(worldId)}`);
      const a = w.assets ?? {};
      return {
        worldId: w.world_id || worldId,
        spz: a.splats?.spz_urls ?? {},
        collider: a.mesh?.collider_mesh_url,
        pano: a.imagery?.pano_url,
        thumbnail: a.thumbnail_url,
        caption: a.caption,
        metricScaleFactor: a.splats?.semantics_metadata?.metric_scale_factor ?? null,
        groundPlaneOffset: a.splats?.semantics_metadata?.ground_plane_offset ?? null,
        worldUrl: w.world_marble_url,
      };
    },
    async fetchAsset(url) {
      const r = await doFetch(url, { method: 'GET' });
      if (!r.ok) throw new PipelineError(502, `The provider asset ${url.slice(0, 80)} answered ${r.status}.`);
      return { bytes: Buffer.from(await r.arrayBuffer()), contentType: (r.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() };
    },
  };
}

/* ---------- the mock ---------- */

/** Polls before a mock operation reports `done`, so a test sees the running state at least once. */
export const MOCK_POLLS_TO_FINISH = 2;
const MOCK_SPZ_BYTES = 200;

/** Bytes that are the same on every machine and every run: a hash stream, so no two assets match. */
function fakeBytes(name: string, length: number, magic?: Buffer): Buffer {
  const out = Buffer.alloc(length);
  let written = magic ? magic.copy(out, 0) : 0;
  let block = createHash('sha256').update(name).digest();
  while (written < length) {
    written += block.copy(out, written);
    block = createHash('sha256').update(block).digest();
  }
  return out;
}

/** A JPEG's first and last markers with a JFIF header between them: enough to be recognisably one. */
function fakeJpeg(name: string): Buffer {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([head, fakeBytes(name, 64), Buffer.from([0xff, 0xd9])]);
}

/**
 * A provider that finishes after `MOCK_POLLS_TO_FINISH` polls and serves tiny assets from memory.
 * This is the end-to-end path: the whole pipeline — submit, poll, copy, publish, walk — runs
 * against it with no key, no network and no credits.
 */
export function mockProvider(): WorldProvider {
  const polls = new Map<string, number>();
  const worlds = new Map<string, string>();
  const assets = new Map<string, FetchedAsset>();

  const put = (worldId: string, name: string, asset: FetchedAsset): string => {
    const url = `mock://worlds/${worldId}/${name}`;
    assets.set(url, asset);
    return url;
  };

  return {
    name: 'mock',
    async generate(request) {
      // Derived from the seed, which is derived from the recipe hash: the same room always gets the
      // same mock ids, so a test can assert them.
      const tag = (request.seed >>> 0).toString(36);
      const operationId = `mock-op-${tag}`;
      const worldId = `mock-world-${tag}`;
      polls.set(operationId, 0);
      worlds.set(operationId, worldId);
      return { operationId, worldId };
    },
    async poll(operationId) {
      const seen = (polls.get(operationId) ?? 0) + 1;
      polls.set(operationId, seen);
      const worldId = worlds.get(operationId);
      if (seen < MOCK_POLLS_TO_FINISH) {
        return { done: false, progress: Math.round((seen / MOCK_POLLS_TO_FINISH) * 100), status: 'Simulating reconstruction', worldId };
      }
      return { done: true, progress: 100, status: 'Simulated world ready', worldId };
    },
    async world(worldId) {
      const spz: Record<string, string> = {};
      for (const tier of ['100k', '500k', 'full_res']) {
        spz[tier] = put(worldId, `${tier}.spz`, { bytes: fakeBytes(`${worldId}/${tier}`, MOCK_SPZ_BYTES, Buffer.from('NGSP', 'ascii')), contentType: 'application/octet-stream' });
      }
      return {
        worldId,
        spz,
        // A real room, not an empty glTF: `copy_assets` measures the collider it just stored, so a
        // mock world with nothing in its mesh would leave the whole measurement path untested
        // (server/mockAssets.ts says what the room is and why it is that size).
        collider: put(worldId, 'collider.glb', { bytes: mockColliderGlb(), contentType: 'model/gltf-binary' }),
        pano: put(worldId, 'pano.jpg', { bytes: fakeJpeg(`${worldId}/pano`), contentType: 'image/jpeg' }),
        thumbnail: put(worldId, 'thumb.jpg', { bytes: fakeJpeg(`${worldId}/thumb`), contentType: 'image/jpeg' }),
        caption: 'A simulated reconstruction.',
        metricScaleFactor: null,
        groundPlaneOffset: null,
      };
    },
    async fetchAsset(url) {
      const hit = assets.get(url);
      if (!hit) throw new PipelineError(404, `The mock provider has no asset at ${url}.`);
      return hit;
    },
  };
}

/**
 * Which provider this environment would use. It is not only the worker's question: the provider is
 * part of the recipe (a simulated world and a Marble world of the same room are two different
 * documents), so `server/routes.ts` asks it before it builds one.
 */
export function providerFor(env: Record<string, string | undefined>): 'marble' | 'mock' {
  if ((env.MARBLE_MOCK || '').trim() === '1') return 'mock';
  return (env.WORLDLABS_API_KEY || '').trim() ? 'marble' : 'mock';
}

/** The mock when `MARBLE_MOCK=1` or no key is configured; the live provider otherwise. */
export function selectProvider(env: Record<string, string | undefined>, fetchImpl?: FetchLike): WorldProvider {
  return providerFor(env) === 'mock' ? mockProvider() : marbleProvider(env, fetchImpl);
}

/* ---------- the credit guard ---------- */

let liveGenerations = 0;

/** Live generations this process has started. `/api/status` reports it beside the route's own count. */
export function workerLiveGenerations(): number {
  return liveGenerations;
}

/** Test seam: the counter is process-wide on purpose, so a test that exercises it has to clear it. */
export function resetWorkerLiveGenerations(): void {
  liveGenerations = 0;
}

export function maxGenerations(env: Record<string, string | undefined>): number {
  const n = Number(env.MARBLE_MAX_GENERATIONS ?? 3);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

/* ---------- the tick ---------- */

/** Jobs claimed per tick. Three is what one process can hold open against Marble without queueing. */
export const WORKER_BATCH = 3;
/** How long a running generate job waits between polls of the provider's operation. */
export const POLL_INTERVAL_MS = 5_000;
/** A job gets three starts; the third failure fails its world too. */
export const MAX_ATTEMPTS = 3;
/** How long the worker sleeps between ticks. */
export const TICK_INTERVAL_MS = 3_000;

export interface WorkerOptions {
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Claimed per tick; the default is `WORKER_BATCH`. */
  batch?: number;
  log?: (message: string, detail?: unknown) => void;
}

export interface TickResult {
  claimed: number;
  submitted: number;
  polled: number;
  copied: number;
  failed: number;
}

/** A failure that must not be retried: a second attempt would cost credits or fail the same way. */
class FatalJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalJobError';
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface Ctx {
  db: PipelineDb;
  storage: PipelineStorage;
  provider: WorldProvider;
  env: Record<string, string | undefined>;
  now: () => number;
  log: (message: string, detail?: unknown) => void;
  result: TickResult;
}

/**
 * One pass of the queue: claim up to `batch` due jobs and run each to its next resting point. A
 * `generate` job's resting points are "submitted", "polled again in five seconds" and "done"; a
 * `copy_assets` job's is "our bucket has every asset".
 */
export async function runWorkerOnce(db: PipelineDb, storage: PipelineStorage, provider: WorldProvider, workerId: string, opts: WorkerOptions = {}): Promise<TickResult> {
  const ctx: Ctx = {
    db,
    storage,
    provider,
    env: opts.env ?? {},
    now: opts.now ?? Date.now,
    log: opts.log ?? (() => undefined),
    result: { claimed: 0, submitted: 0, polled: 0, copied: 0, failed: 0 },
  };
  const jobs = await db.rpc<JobRow[]>('claim_jobs', { worker: workerId, n: opts.batch ?? WORKER_BATCH });
  const claimed = Array.isArray(jobs) ? jobs : [];
  ctx.result.claimed = claimed.length;
  for (const job of claimed) {
    try {
      await runJob(ctx, job);
    } catch (e) {
      ctx.result.failed += 1;
      await failJob(ctx, job, e);
    }
  }
  return ctx.result;
}

async function runJob(ctx: Ctx, job: JobRow): Promise<void> {
  switch (job.kind) {
    case 'generate':
      return runGenerate(ctx, job);
    case 'copy_assets':
      return runCopyAssets(ctx, job);
    default:
      // analyze / parse_plan / stage / publish are enqueued by routes but have no worker yet.
      // Failing them is the honest answer: a job that will never run must not sit in the queue
      // looking like progress.
      throw new FatalJobError(`${job.kind} jobs are not implemented in this build.`);
  }
}

/* ---------- generate ---------- */

async function loadWorld(ctx: Ctx, job: JobRow): Promise<WorldRow> {
  if (!job.world_id) throw new FatalJobError('the job carries no world id');
  const world = await ctx.db.select<WorldRow>('worlds', { filters: { id: job.world_id }, single: true });
  if (!world) throw new FatalJobError(`world ${job.world_id} is gone`);
  return world;
}

async function runGenerate(ctx: Ctx, job: JobRow): Promise<void> {
  const world = await loadWorld(ctx, job);
  // The operation id on the world row — not anything in this process — is what says the request was
  // already paid for. A restarted worker therefore polls; it never resubmits.
  if (world.provider_operation_id) return pollGenerate(ctx, job, world);
  return submitGenerate(ctx, job, world);
}

/** The canonical photo bytes, in recipe order, as base64 with the extension the bytes really are. */
async function recipeImages(ctx: Ctx, job: JobRow, recipe: Recipe): Promise<MarbleImageInput[]> {
  const rows = job.room_id ? await ctx.db.select<PhotoRow>('photos', { filters: { room_id: job.room_id } }) : [];
  const byHash = new Map<string, PhotoRow>();
  for (const p of rows) byHash.set(String(p.canonical_sha256 || p.sha256), p);
  const images: MarbleImageInput[] = [];
  for (const photo of recipe.photos) {
    const row = byHash.get(photo.sha256);
    if (!row) throw new FatalJobError(`the canonical photo ${photo.sha256.slice(0, 12)} is no longer on this room`);
    const { bucket, key } = splitStoragePath(String(row.canonical_path || row.storage_path));
    const bytes = await ctx.storage.download(bucket, key);
    // The stored name always ends `.canonical.jpg`, but the passthrough path (no sharp) keeps the
    // original format, so the extension Marble is told comes from the bytes rather than the name.
    const mime = sniffImage(bytes)?.mime;
    images.push({ base64: bytes.toString('base64'), extension: mime ? extensionForMime(mime) : 'jpg' });
  }
  return images;
}

async function submitGenerate(ctx: Ctx, job: JobRow, world: WorldRow): Promise<void> {
  const recipe = world.recipe;
  if (!recipe || typeof recipe !== 'object' || !Array.isArray(recipe.photos)) throw new FatalJobError('the world has no recipe');
  // The recipe is stored canonical, so it must still hash to the row's own hash. If it does not,
  // something rewrote it and the seed no longer belongs to it: refuse rather than generate.
  if (recipeHash(recipe) !== world.recipe_hash) throw new FatalJobError('the stored recipe does not match its recipe_hash');

  if (ctx.provider.name === 'marble') {
    const cap = maxGenerations(ctx.env);
    if (liveGenerations >= cap) {
      throw new FatalJobError(`Credit guard: this server has already started ${liveGenerations} live Marble generations (cap ${cap}). Set MARBLE_MAX_GENERATIONS to raise it, or run with MARBLE_MOCK=1.`);
    }
  }

  const room = job.room_id ? await ctx.db.select<RoomRow>('rooms', { filters: { id: job.room_id }, single: true }) : null;
  const images = await recipeImages(ctx, job, recipe);
  const request = marbleRequestFrom(recipe, images, { displayName: `Audora · ${room?.name ?? 'room'}` });

  if (ctx.provider.name === 'marble') liveGenerations += 1;
  const submission = await ctx.provider.generate(request);
  ctx.result.submitted += 1;

  // Everything from here is after money has been spent. The operation id on the world row is the
  // ONLY record that this recipe was already paid for, so losing this write must never be retried:
  // a `DbError` here is an ordinary transport failure, and a retry would claim the job again, find
  // `provider_operation_id` still null and submit — and charge — a second time. Fatal instead, with
  // the id in the message, so an operator can put it on the row by hand and let the poller resume.
  try {
    await ctx.db.update('worlds', { id: world.id }, {
      provider_operation_id: submission.operationId,
      ...(submission.worldId ? { provider_world_id: submission.worldId } : {}),
      status: 'running',
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new FatalJobError(
      `the generation was submitted (operation ${submission.operationId}${submission.worldId ? `, world ${submission.worldId}` : ''}) but the world row could not record it: ${reason}. ` +
        'This job will not be retried: it was already paid for. Set worlds.provider_operation_id by hand and release the job to resume polling.',
    );
  }
  await ctx.db.update('jobs', { id: job.id }, {
    status: 'running',
    progress: 10,
    step: 'Generating',
    detail: null,
    error: null,
    run_after: iso(ctx.now() + POLL_INTERVAL_MS),
  });
  if (job.room_id) await ctx.db.update('rooms', { id: job.room_id }, { status: 'generating' });
}

async function pollGenerate(ctx: Ctx, job: JobRow, world: WorldRow): Promise<void> {
  const state = await ctx.provider.poll(String(world.provider_operation_id));
  ctx.result.polled += 1;
  if (state.worldId && state.worldId !== world.provider_world_id) {
    await ctx.db.update('worlds', { id: world.id }, { provider_world_id: state.worldId });
  }
  if (state.error) {
    // The operation itself failed. Retrying would mean a second submission and a second charge, so
    // this is terminal for the recipe: the seller fixes an input, which makes a new recipe.
    throw new FatalJobError(`the provider reported: ${state.error}`);
  }
  if (!state.done) {
    await ctx.db.update('jobs', { id: job.id }, {
      status: 'running',
      // Marble reports a description, not a percentage; 10–90 is the band this step owns either way.
      progress: clamp(Math.round(10 + (state.progress ?? 0) * 0.8), 10, 90),
      step: 'Generating',
      detail: state.status ?? null,
      run_after: iso(ctx.now() + POLL_INTERVAL_MS),
    });
    return;
  }

  const providerWorldId = state.worldId || world.provider_world_id;
  if (!providerWorldId) throw new FatalJobError('the operation finished without a world id');
  // docs/BACKEND.md §4: completion enqueues copy_assets. The world stays `running` until its assets
  // are ours, so nothing points a buyer at a URL that expires.
  await ctx.db.insert('jobs', {
    org_id: job.org_id,
    unit_id: job.unit_id,
    room_id: job.room_id ?? null,
    world_id: world.id,
    kind: 'copy_assets',
    status: 'queued',
    progress: 0,
    step: 'Copying assets',
    run_after: iso(ctx.now()),
  });
  await ctx.db.update('jobs', { id: job.id }, {
    status: 'done',
    progress: 100,
    step: 'Generated',
    detail: state.status ?? null,
    error: null,
    finished_at: iso(ctx.now()),
  });
}

/* ---------- copy_assets ---------- */

/** Our own name for one of a provider's assets. `full_res` is our `full`; every other key is kept. */
function spzName(providerKey: string): { key: string; name: string } {
  const clean = providerKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const key = clean === 'full-res' || clean === 'fullres' ? 'full' : clean || 'default';
  return { key, name: `spz-${key}.spz` };
}

/** `pano.jpg` when the panorama really is a JPEG, `pano.png` when it is a PNG: the name never lies. */
function namedFor(base: string, contentType: string, fallback: string): string {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  const ext = type.startsWith('image/') ? extensionForMime(type) : fallback;
  return `${base}.${ext === 'bin' ? fallback : ext}`;
}

async function runCopyAssets(ctx: Ctx, job: JobRow): Promise<void> {
  const world = await loadWorld(ctx, job);
  if (!world.provider_world_id) throw new FatalJobError('the world has no provider world id to copy from');
  const provider = await ctx.provider.world(world.provider_world_id);

  const wanted: { name: string; url: string; slot: 'spz' | 'collider' | 'pano' | 'thumbnail'; key?: string }[] = [];
  for (const [providerKey, url] of Object.entries(provider.spz ?? {})) {
    if (!url) continue;
    const { key, name } = spzName(providerKey);
    wanted.push({ name, url, slot: 'spz', key });
  }
  if (provider.collider) wanted.push({ name: 'collider.glb', url: provider.collider, slot: 'collider' });
  if (provider.pano) wanted.push({ name: 'pano', url: provider.pano, slot: 'pano' });
  if (provider.thumbnail) wanted.push({ name: 'thumb', url: provider.thumbnail, slot: 'thumbnail' });
  if (!wanted.length) throw new FatalJobError('the finished world has no assets to copy');

  const assets: WorldAssets = {};
  const providerAssets: Row = { spz: provider.spz ?? {}, collider: provider.collider ?? null, pano: provider.pano ?? null, thumbnail: provider.thumbnail ?? null, worldUrl: provider.worldUrl ?? null };
  // The collider is measured below; it is kept here rather than downloaded again, because the bytes
  // this loop uploaded ARE the bytes to measure and a second round trip could only disagree.
  let colliderBytes: Buffer | null = null;
  for (let i = 0; i < wanted.length; i += 1) {
    const item = wanted[i];
    const fetched = await ctx.provider.fetchAsset(item.url);
    if (item.slot === 'collider') colliderBytes = fetched.bytes;
    const name = item.slot === 'pano' ? namedFor('pano', fetched.contentType, 'jpg') : item.slot === 'thumbnail' ? namedFor('thumb', fetched.contentType, 'jpg') : item.name;
    const path = worldAssetPath(world.id, name);
    const { bucket, key } = splitStoragePath(path);
    // The world id is in the key and a world's assets never change under it, so these are safe to
    // cache for a year — which is the whole point of owning them.
    await ctx.storage.upload(bucket, key, fetched.bytes, fetched.contentType, { upsert: true, cacheControl: 31_536_000 });
    if (item.slot === 'spz') (assets.spz ??= {})[item.key as string] = path;
    else assets[item.slot] = path;
    await ctx.db.update('jobs', { id: job.id }, { status: 'running', progress: clamp(Math.round(((i + 1) / wanted.length) * 90), 5, 90), step: 'Copying assets' });
  }
  ctx.result.copied += 1;

  const created = Date.parse(String(world.created_at ?? '')) || ctx.now();
  await ctx.db.update('worlds', { id: world.id }, {
    assets: assets as unknown as Row,
    provider_assets: providerAssets,
    metric_scale_factor: provider.metricScaleFactor ?? null,
    ground_plane_offset: provider.groundPlaneOffset ?? null,
    ...(provider.caption ? { caption: provider.caption } : {}),
    status: 'done',
    error: null,
    seconds: Math.max(0, Math.round((ctx.now() - created) / 1000)),
    finished_at: iso(ctx.now()),
  });
  if (job.room_id) await pointRoomAtWorld(ctx.db, job.room_id, (world.tier === 'full' ? 'full' : 'draft') as RecipeTier, world.id, 'ready');
  await measureWorld(ctx, job, world, colliderBytes, provider.metricScaleFactor ?? null);
  await ctx.db.update('jobs', { id: job.id }, { status: 'done', progress: 100, step: 'Ready', error: null, finished_at: iso(ctx.now()) });
  await settleUnit(ctx, job);
}

/**
 * Step 5's second half (docs/BACKEND.md §4, docs/ACCURACY.md §3.2): the assets are ours, so measure
 * the collider and say what the room is. `worlds.bounds` and `worlds.raw` get what the mesh says;
 * `rooms.geometry`, `rooms.raw`, `rooms.measurement` and `rooms.measured_at` get what the room
 * shows, once the plan, the anchor, the printed ceiling and the provider's own metric scale have
 * been fused into one number with its residuals (`measureRoom` in server/pipeline.ts).
 *
 * A measurement failure does not fail the world. The assets are already copied and paid for, the
 * capture is walkable, and the browser can still measure the collider itself — so a mesh this
 * reader cannot parse is logged and left as null rather than throwing away a generation over it.
 */
async function measureWorld(ctx: Ctx, job: JobRow, world: WorldRow, collider: Buffer | null, metricScaleFactor: number | null): Promise<void> {
  if (!collider) {
    ctx.log(`world ${world.id}: no collider mesh, so the room is unmeasured`);
    return;
  }
  try {
    const room = job.room_id ? await ctx.db.select<RoomRow>('rooms', { filters: { id: job.room_id }, single: true }) : null;
    /* The shot the reconstruction is of, for the field-of-view prior (`shared/exifPrior.ts`). It is
       the same ordering the recipe used, so the photo the prior reads is the photo Marble was given
       first. A room with no photos, or a photo whose EXIF says nothing about the lens, contributes
       nothing — `exifScalePrior` returns null rather than a guess. */
    const primaryPhoto = job.room_id
      ? orderPhotos(await ctx.db.select<PhotoRow>('photos', { filters: { room_id: job.room_id, org_id: world.org_id } }))[0] ?? null
      : null;
    const result = measureRoom({
      bounds: measureColliderBytes(collider),
      planDims: room?.plan_dims,
      anchor: room?.anchor,
      metricScaleFactor,
      photo: primaryPhoto,
      worldId: world.id,
      now: ctx.now(),
    });
    /* The same provenance a PATCH writes (`updateRoom` in server/pipeline.ts), because a reader
       cannot tell where a measurement came from and `RoomMeasurement` documents both fields. It is
       not always false either: a seller can correct a plan dimension while the job is in the queue,
       so the answer is computed, not assumed. A recipe that cannot be rebuilt leaves the flag off
       rather than guessing — the measurement itself is already paid for and must not be lost to it. */
    result.measurement.recipeHash = String(world.recipe_hash ?? '');
    if (room) {
      try {
        const unit = await ctx.db.select<UnitRow>('units', { filters: { id: job.unit_id }, single: true });
        if (unit) result.measurement.stale = (await roomRecipeState(ctx.db, world.org_id, unit, room, world)).stale;
      } catch (e) {
        ctx.log(`world ${world.id}: the recipe state could not be compared`, e);
      }
    }
    await writeMeasurement(ctx.db, world.id, room?.id, result);
    if (result.measurement.flags.length) ctx.log(`world ${world.id}: ${result.measurement.flags.join(' ')}`);
  } catch (e) {
    ctx.log(`world ${world.id}: the collider could not be measured`, e);
  }
}

/** A unit with nothing left in the queue is no longer "generating". */
async function settleUnit(ctx: Ctx, job: JobRow): Promise<void> {
  const open = await ctx.db.select<JobRow>('jobs', { filters: { unit_id: job.unit_id, status: { op: 'in', value: ['queued', 'running'] } }, columns: 'id', limit: 1 });
  if (open.length) return;
  const unit = await ctx.db.select<UnitRow>('units', { filters: { id: job.unit_id }, single: true });
  if (unit && unit.status === 'generating') await ctx.db.update('units', { id: job.unit_id }, { status: 'ready' });
}

/* ---------- failure ---------- */

/** 5 s, then 10 s, then 20 s: long enough for a provider hiccup to pass, short enough to feel alive. */
function backoffMs(attempts: number): number {
  return POLL_INTERVAL_MS * 2 ** Math.max(0, attempts - 1);
}

async function failJob(ctx: Ctx, job: JobRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const attempts = job.attempts ?? MAX_ATTEMPTS;
  const terminal = error instanceof FatalJobError || attempts >= MAX_ATTEMPTS;
  ctx.log(`job ${job.id} (${job.kind}) failed: ${message}`, { terminal, attempts });
  try {
    if (!terminal) {
      await ctx.db.update('jobs', { id: job.id }, {
        status: 'queued',
        error: message,
        detail: `retrying (attempt ${attempts + 1} of ${MAX_ATTEMPTS})`,
        locked_by: null,
        locked_at: null,
        run_after: iso(ctx.now() + backoffMs(attempts)),
      });
      return;
    }
    await ctx.db.update('jobs', { id: job.id }, { status: 'failed', error: message, finished_at: iso(ctx.now()) });
    if (job.world_id) await ctx.db.update('worlds', { id: job.world_id }, { status: 'failed', error: message });
    if (job.room_id) await ctx.db.update('rooms', { id: job.room_id }, { status: 'failed' });
  } catch (e) {
    // Losing the database while recording a failure must not take the tick down with it: the lease
    // on `run_after` brings the job back on its own.
    ctx.log(`job ${job.id}: could not record the failure`, e);
  }
}

/* ---------- the loop ---------- */

export interface StartWorkerOptions extends WorkerOptions {
  db: PipelineDb;
  storage: PipelineStorage;
  provider: WorldProvider;
  workerId?: string;
  intervalMs?: number;
}

export interface RunningWorker {
  readonly workerId: string;
  /** Run one tick now (what the tests drive); overlapping ticks are skipped, not queued. */
  tick(): Promise<TickResult | null>;
  stop(): void;
}

const EMPTY_TICK: TickResult = { claimed: 0, submitted: 0, polled: 0, copied: 0, failed: 0 };

/**
 * The polling loop the dev and production servers start when the backend is configured. One tick at
 * a time: a tick that is still running when the timer fires again is left alone, because two ticks
 * in one process would only race for the same claim.
 */
export function startWorker(opts: StartWorkerOptions): RunningWorker {
  const workerId = opts.workerId || `audora-worker-${process.pid}`;
  const interval = opts.intervalMs ?? TICK_INTERVAL_MS;
  const log = opts.log ?? ((message: string, detail?: unknown) => console.error(`[worker] ${message}`, detail ?? ''));
  let busy = false;
  let stopped = false;

  const tick = async (): Promise<TickResult | null> => {
    if (busy || stopped) return null;
    busy = true;
    try {
      return await runWorkerOnce(opts.db, opts.storage, opts.provider, workerId, { ...opts, log });
    } catch (e) {
      log('tick failed', e);
      return { ...EMPTY_TICK, failed: 1 };
    } finally {
      busy = false;
    }
  };

  const timer: ReturnType<typeof setInterval> = setInterval(() => void tick(), interval);
  // The HTTP server keeps the process alive; the worker's timer must not keep a test one alive.
  // (`unref` exists on Node's Timeout and not on the DOM's number, and this file is type-checked
  // against both, so it is reached through a cast rather than the declared return type.)
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    workerId,
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
