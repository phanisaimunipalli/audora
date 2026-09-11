/// <reference types="node" />
/**
 * server/localRoutes.ts — the read-only routes that serve what `npx audora generate` wrote
 * (docs/CLI.md, "Server and app"). Mounted by both servers: the Vite plugin in development and
 * `server/prod.ts` in production, so one URL works whichever one is listening.
 *
 *   GET /api/local/units                 → the units in the store, newest first
 *   GET /api/local/units/:id             → that unit's file, byte for byte
 *   GET /local-assets/<worldId>/<file>   → one asset out of the store's `assets/`
 *
 * Conventions:
 * - **`server/local.ts` owns the store; this module only reads it.** Every path, every id rule and
 *   the URL an asset is linked by come from there (`localPaths`, `unitFile`, `localAssetFile`,
 *   `listUnits`, `isSafeSegment`, `LOCAL_ASSET_PREFIX`), so the writer and the reader cannot drift
 *   apart. Nothing here writes, deletes or generates, and anything but GET and HEAD is a 405.
 * - **Two prefixes, one handler.** `/local-assets/` is deliberately not under `/api/`, because it is
 *   what ends up inside a unit file as the URL of a splat, a collider or a panorama, and those read
 *   (and cache) better as plain asset paths. `isLocalRoute` is the single test both servers mount
 *   on; `handleLocal` answers `false` for everything else so the caller carries on.
 * - **Nothing outside the store.** Every path segment is percent-decoded *first* and then checked
 *   with `isSafeSegment`, so `..`, `/`, `\` and NUL cannot survive it however they were encoded; the
 *   resolved absolute path is then checked to still be inside its own directory before a byte is
 *   read. A refusal is the same 404 an unknown id gets — a probe learns nothing.
 * - **Assets are immutable, unit files are not.** A world id names bytes that never change, so its
 *   assets get a year of `immutable`. A unit file is rewritten whenever the CLI regenerates, so it
 *   gets `no-cache` and an ETag, and the viewer re-imports only when the file really changed.
 * - **Never throws.** The dev plugin mounts this without a `catch`, so a missing directory, an
 *   unreadable file or malformed JSON all come back as a JSON status rather than as an unhandled
 *   rejection.
 *
 * Compiles under tsconfig.node.json (bundler) and tsconfig.server.json (NodeNext): relative
 * imports inside server/ carry the `.js` extension.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import {
  LOCAL_ASSET_PREFIX,
  isSafeSegment,
  listUnits,
  localAssetFile,
  localPaths,
  localRoot,
  unitFile,
  type LocalPaths,
  type LocalUnit,
} from './local.js';

/* ---------- the two prefixes ---------- */

const UNITS_PREFIX = '/api/local/units';
const API_PREFIX = '/api/local';

/** True for the paths `handleLocal` owns. Both servers mount on exactly this. */
export function isLocalRoute(pathname: string): boolean {
  return (
    pathname === API_PREFIX ||
    pathname.startsWith(`${API_PREFIX}/`) ||
    pathname === LOCAL_ASSET_PREFIX ||
    pathname.startsWith(`${LOCAL_ASSET_PREFIX}/`)
  );
}

/**
 * Where to read from: the resolved store (`localPaths(localRoot(repoRoot, env))`, which is what a
 * server that honours `AUDORA_LOCAL_DIR` should pass), or a repository root, which is resolved to
 * the default `<root>/.audora/local` with no environment override applied. Taking the resolved
 * paths keeps the environment in the caller, so this module never reads `process.env` behind a
 * request's back.
 */
export type LocalStore = string | LocalPaths;

const storePaths = (store: LocalStore): LocalPaths => (typeof store === 'string' ? localPaths(localRoot(store, {})) : store);

/* ---------- request and response, structurally ----------
 * `IncomingMessage` and `ServerResponse` satisfy these, and a test can answer with an object
 * literal — the same trade server/routes.ts makes for /api/v1. Nothing here reads a body: these
 * routes have none. */

export interface LocalRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface LocalResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(chunk?: string | Uint8Array): unknown;
}

/** One row of `GET /api/local/units`: enough for `npx audora list` and a picker, nothing more. */
export interface LocalUnitSummary {
  /** The id in the URL: `/t/<id>` and `/api/local/units/<id>`. */
  id: string;
  name: string;
  createdAt: string | null;
  address: string | null;
  tier: string | null;
  /** How many rooms the unit file lists. */
  rooms: number;
  /** The first room thumbnail, as a `/local-assets/...` URL, when the unit has one. */
  thumbnail: string | null;
}

/* ---------- plumbing ---------- */

const CONTENT_TYPES: Record<string, string> = {
  // Gaussian splats: no registered media type, and octet-stream is what Marble's own CDN serves.
  '.spz': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ply': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.json': 'application/json; charset=utf-8',
};

const JSON_TYPE = 'application/json; charset=utf-8';
const IMMUTABLE = 'public, max-age=31536000, immutable';

function json(res: LocalResponse, status: number, body: unknown): true {
  res.statusCode = status;
  res.setHeader('content-type', JSON_TYPE);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
  return true;
}

const notFound = (res: LocalResponse, what: string): true => json(res, 404, { error: what });

const methodOf = (req: LocalRequest): string => (req.method || 'GET').toUpperCase();

function header(req: LocalRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Percent-decoding that refuses what it cannot safely open, rather than throwing on `%zz`. Decoding
 * comes first and `isSafeSegment` (server/local.ts, the same rule the writer uses) second, so an
 * encoded separator is judged as the separator it decodes to.
 */
function decodeSegment(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isSafeSegment(decoded) ? decoded : null;
}

/** `stat`, but a missing file, a directory and an unreadable one are all the same "no". */
async function statFile(abs: string): Promise<Stats | null> {
  try {
    const st = await stat(abs);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/** Belt and braces over `isSafeSegment`: the file we are about to open is still inside `dir`. */
function inside(dir: string, abs: string): boolean {
  return abs.startsWith(path.resolve(dir) + path.sep);
}

/**
 * Send a body, or a 304 when the client already has it. HEAD gets every header and no bytes, which
 * is what makes `curl -I` and a size check without a download work.
 */
function send(req: LocalRequest, res: LocalResponse, body: Buffer, type: string, cacheControl: string, etag: string): true {
  res.setHeader('etag', etag);
  res.setHeader('cache-control', cacheControl);
  res.setHeader('x-content-type-options', 'nosniff');
  const asked = header(req, 'if-none-match');
  if (asked && asked.split(',').some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
    res.statusCode = 304;
    res.end();
    return true;
  }
  res.statusCode = 200;
  res.setHeader('content-type', type);
  res.setHeader('content-length', String(body.byteLength));
  res.end(methodOf(req) === 'HEAD' ? undefined : body);
  return true;
}

/**
 * A unit file's ETag is a hash of its bytes, because the bytes are what the viewer re-imports on:
 * regenerating a unit that came out identical must not force the import to run again. An asset's is
 * its size and mtime — the same cheap tag `server/prod.ts` uses for `dist/` — because a `full_res`
 * splat is tens of megabytes and its world id already promises the bytes never change.
 */
const contentEtag = (body: Buffer): string => `"${createHash('sha256').update(body).digest('hex').slice(0, 24)}"`;
const statEtag = (st: Stats): string => `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;

/* ---------- the unit list ---------- */

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The first room thumbnail the unit offers, as long as it is one of our own asset URLs. */
function firstThumbnail(unit: LocalUnit): string | null {
  for (const room of unit.rooms ?? []) {
    const thumb = str(room?.world?.assets?.thumbnail);
    if (thumb && thumb.startsWith(`${LOCAL_ASSET_PREFIX}/`)) return thumb;
  }
  return null;
}

/**
 * The summary row for one unit. Every field is re-checked rather than trusted: these documents are
 * files on someone's disk, and a hand-edited one must come back as a thin row, not as a 500.
 */
function summarize(unit: LocalUnit): LocalUnitSummary {
  return {
    id: unit.id,
    name: str(unit.name) ?? unit.id,
    createdAt: str(unit.createdAt),
    address: str(unit.address),
    tier: str(unit.tier),
    rooms: Array.isArray(unit.rooms) ? unit.rooms.length : 0,
    thumbnail: firstThumbnail(unit),
  };
}

/**
 * Every unit the CLI has written, newest first — `listUnits` (server/local.ts) does the reading and
 * the ordering, so `npx audora list` and this route can only ever agree. A store that does not
 * exist yet is an empty list, not an error: nothing has been generated, which is a good answer.
 *
 * Synchronous, because the store's reader is: a handful of small JSON files on localhost, read once
 * per list request, is not worth a second implementation.
 */
export function localUnitSummaries(store: LocalStore): LocalUnitSummary[] {
  return listUnits(storePaths(store)).map(summarize);
}

/* ---------- the routes ---------- */

async function serveUnits(req: LocalRequest, res: LocalResponse, paths: LocalPaths, pathname: string): Promise<boolean> {
  if (pathname === UNITS_PREFIX || pathname === `${UNITS_PREFIX}/`) {
    const body = Buffer.from(JSON.stringify({ units: localUnitSummaries(paths) }), 'utf8');
    return send(req, res, body, JSON_TYPE, 'no-cache', contentEtag(body));
  }
  if (!pathname.startsWith(`${UNITS_PREFIX}/`)) return notFound(res, `No local route for ${pathname}`);
  const rest = pathname.slice(UNITS_PREFIX.length + 1);
  const id = rest.includes('/') ? null : decodeSegment(rest);
  if (!id) return notFound(res, 'No unit with that id has been generated here.');
  const abs = path.resolve(unitFile(paths, id));
  if (!inside(paths.units, abs) || !(await statFile(abs))) {
    return notFound(res, `No unit ${id} in ${paths.units}. Run npx audora list to see what is there.`);
  }
  // Served byte for byte rather than re-serialised: what the CLI wrote is what the viewer imports,
  // so a field this module does not know about survives the trip and the ETag is over the real file.
  const body = await readFile(abs);
  // Parsed once first, and answered for rather than streamed: `listUnits` already drops a file it
  // cannot parse, so a truncated or hand-edited unit is invisible to `audora list` and to the list
  // route — serving it as `200 application/json` would be the one place that lies about it, and the
  // viewer's only symptom is "did not answer with JSON" three layers away.
  try {
    JSON.parse(body.toString('utf8'));
  } catch {
    return json(res, 500, { error: `The unit file for ${id} is not valid JSON. Re-run npx audora generate for this folder, or delete ${unitFile(paths, id)}.` });
  }
  return send(req, res, body, JSON_TYPE, 'no-cache', contentEtag(body));
}

async function serveAsset(req: LocalRequest, res: LocalResponse, paths: LocalPaths, pathname: string): Promise<boolean> {
  const rest = pathname === LOCAL_ASSET_PREFIX ? '' : pathname.slice(LOCAL_ASSET_PREFIX.length + 1);
  const parts = rest.split('/');
  const worldId = parts.length === 2 ? decodeSegment(parts[0]) : null;
  const file = parts.length === 2 ? decodeSegment(parts[1]) : null;
  if (!worldId || !file) return notFound(res, 'That is not a local asset path.');
  const abs = path.resolve(localAssetFile(paths, worldId, file));
  if (!inside(paths.assets, abs)) return notFound(res, 'That is not a local asset path.');
  const st = await statFile(abs);
  if (!st) return notFound(res, `No asset ${file} for world ${worldId}.`);
  const type = CONTENT_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  // Read into memory rather than streamed: this is a localhost demo tool, the worst case is one
  // full-resolution splat, and a Buffer keeps the response structural enough to unit-test.
  return send(req, res, await readFile(abs), type, IMMUTABLE, statEtag(st));
}

/**
 * Answer a local route, or resolve `false` when the request is not one so the caller can go on to
 * its own routes and its static files. Never rejects.
 */
export async function handleLocal(req: LocalRequest, res: LocalResponse, store: LocalStore): Promise<boolean> {
  let pathname: string;
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    return false;
  }
  if (!isLocalRoute(pathname)) return false;
  const method = methodOf(req);
  if (method !== 'GET' && method !== 'HEAD') {
    return json(res, 405, { error: `${method} is not allowed: the local routes only read what the CLI wrote.` });
  }
  try {
    const paths = storePaths(store);
    if (pathname === LOCAL_ASSET_PREFIX || pathname.startsWith(`${LOCAL_ASSET_PREFIX}/`)) return await serveAsset(req, res, paths, pathname);
    return await serveUnits(req, res, paths, pathname);
  } catch (e: unknown) {
    return json(res, 500, { error: e instanceof Error && e.message ? e.message : 'local route error' });
  }
}
