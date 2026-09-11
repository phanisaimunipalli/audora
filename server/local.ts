/// <reference types="node" />
/**
 * The CLI's local store — docs/CLI.md, "The unit file" and step 7.
 *
 * `npx audora generate` needs somewhere to put a unit that is not Supabase and not the browser's
 * store: a folder of plain JSON and downloaded assets under `.audora/local/`, which the dev plugin
 * and the production server read back over `GET /api/local/units*` and `/local-assets/<worldId>/*`.
 * This module owns that shape — the paths, the ids, the unit document, the world cache — and
 * nothing else. It does no I/O beyond the store itself: no network, no provider, no clock.
 *
 * Conventions this module relies on:
 * - **The id is a hash, never a clock.** `unitIdFor` is the first 8 hex of sha256 over the sorted
 *   recipe hashes (docs/CLI.md step 7), so the same photos and options give the same unit id and
 *   therefore the same URL, every run, on every machine. `createdAt` is written into the document
 *   but never into the id.
 * - **The world cache is keyed by recipe hash**, which is the same rule the backend's unique
 *   `worlds_recipe` index enforces (docs/BACKEND.md §2 rule 5): a recipe that already has a world
 *   never generates a second time. Because the plan dimensions and the ceiling are *in* the recipe,
 *   changing `--dims` or `--ceiling` is a new recipe and a new world — the honest answer, and the
 *   same one the backend gives.
 * - **Paths are checked, never trusted.** A world id or an asset name that is not a single safe
 *   path segment is refused rather than joined, because both end up in a file path and in a URL.
 * - The root is an argument. `localRoot()` resolves it from the repository root (or
 *   `AUDORA_LOCAL_DIR`), and everything else takes the resolved `LocalPaths`, so a test runs the
 *   whole flow against a temporary directory.
 *
 * Compiles under tsconfig.node.json (bundler) and tsconfig.server.json (NodeNext): relative
 * imports inside server/ carry the `.js` extension. server/ never imports src/.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RawRoomGeometry, WorldBounds } from '../shared/collider.js';
import type { RoomMeasurement } from '../shared/fusion.js';
import type { RoomType } from '../shared/marblePrompt.js';
import type { PhotoAngle, RecipeAnchor, RecipeTier } from './recipe.js';

/* ---------- where it lives ---------- */

/** The store's directory, relative to the repository root. Kept out of git (.gitignore has `.audora/`). */
export const LOCAL_DIR = path.join('.audora', 'local');

/** The URL prefix the server mounts `assets/` under (docs/CLI.md, "Server and app"). */
export const LOCAL_ASSET_PREFIX = '/local-assets';

/** The three subdirectories of the store, resolved. */
export interface LocalPaths {
  /** `<repo>/.audora/local`, or whatever `AUDORA_LOCAL_DIR` named. */
  root: string;
  units: string;
  worlds: string;
  assets: string;
}

/**
 * The store's root for a repository. `AUDORA_LOCAL_DIR` overrides it — that is how the tests point
 * the whole flow at a temporary directory, and how a demo machine can keep its units on a volume.
 */
export function localRoot(repoRoot: string, env: Record<string, string | undefined> = {}): string {
  const override = (env.AUDORA_LOCAL_DIR || '').trim();
  return override ? path.resolve(override) : path.join(repoRoot, LOCAL_DIR);
}

export function localPaths(root: string): LocalPaths {
  const abs = path.resolve(root);
  return { root: abs, units: path.join(abs, 'units'), worlds: path.join(abs, 'worlds'), assets: path.join(abs, 'assets') };
}

/** Create the store's directories. Idempotent; the CLI calls it before its first write. */
export function ensureLocalPaths(paths: LocalPaths): LocalPaths {
  for (const dir of [paths.root, paths.units, paths.worlds, paths.assets]) mkdirSync(dir, { recursive: true });
  return paths;
}

/* ---------- path segments ---------- */

/**
 * One safe path segment: what a world id, a unit id and an asset name must each be before they are
 * joined into a file path or a URL. The check is the whole defence — these strings come from a
 * provider and from a folder name — so it is deliberately narrower than the filesystem allows.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeSegment(value: string): boolean {
  return SEGMENT.test(value) && value !== '.' && value !== '..' && !value.includes('..');
}

function segment(what: string, value: string): string {
  if (!isSafeSegment(value)) throw new Error(`${what} ${JSON.stringify(value)} is not a safe path segment`);
  return value;
}

/* ---------- the documents ---------- */

/** One photograph as the unit file records it (docs/CLI.md, "The unit file"). */
export interface LocalPhoto {
  /** Path as given on disk, relative to the folder that was scanned. */
  file: string;
  /** sha256 of the original bytes. */
  sha256: string;
  /** sha256 of the canonical copy — what the recipe hashed and what Marble received. */
  canonicalSha256: string;
  /** `left` / `right` / `back` / `centre` from the file name, else null. */
  angle: PhotoAngle | null;
  /** Degrees round the capture point, primary at 0. Null on the primary and on unlabelled angles. */
  azimuth: number | null;
  /** Pixels of the canonical copy. */
  width: number;
  height: number;
}

/** Our own copies, as URLs the local server serves: `/local-assets/<worldId>/<name>`. */
export interface LocalWorldAssets {
  /** Keyed the way Marble keys its ladder, with `full_res` folded to `full` (`spz-100k.spz`, …). */
  spz: Record<string, string>;
  collider?: string;
  pano?: string;
  thumbnail?: string;
}

/**
 * A generated world, owned locally. It is also the world-cache document
 * (`.audora/local/worlds/<recipeHash>.json`): a second run with the same recipe reads this back
 * and spends nothing, which is why it carries everything a reader needs — including the measured
 * `bounds`, so the room can be re-fused without re-reading a 20 MB collider.
 */
export interface LocalWorld {
  worldId: string;
  provider: 'marble' | 'mock';
  model: string;
  tier: RecipeTier;
  /** The recipe this world was generated for; the cache file is named after it. */
  recipeHash: string;
  seed: number;
  assets: LocalWorldAssets;
  metricScaleFactor: number | null;
  groundPlaneOffset: number | null;
  /** What the collider measures, after `measureRoom` chose the rectangle. Null when it could not be read. */
  bounds: WorldBounds | null;
  /** The room in the provider's raw units. Null when there was no collider to measure. */
  raw: RawRoomGeometry | null;
  caption?: string;
  /** The provider's own viewer link, provenance only. */
  worldUrl?: string;
  /** The provider's URLs, kept as provenance; ours are in `assets`. */
  providerAssets?: Record<string, unknown>;
  /** Credits the tier is known to cost. Absent for the mock, which spends nothing. */
  credits?: number;
  /** Wall-clock seconds from submission to the last asset. */
  seconds?: number;
  createdAt: string;
}

/** Mirrors `rooms.plan_dims` (`PlanDimsJson` in server/pipeline.ts), which is what `measureRoom` reads. */
export interface LocalPlanDims {
  /** Metres. */
  width?: number;
  depth?: number;
  /** The ceiling height that was *stated* (`--ceiling`), metres. Mirrors `rooms.plan_dims.height`. */
  height?: number;
  [key: string]: unknown;
}

export interface LocalRoom {
  /** Slug of the folder name; unique within the unit, and the room id in the viewer. */
  id: string;
  name: string;
  type: RoomType;
  order: number;
  photos: LocalPhoto[];
  recipeHash: string;
  seed: number;
  prompt: string;
  model: string;
  world: LocalWorld | null;
  planDims: LocalPlanDims | null;
  /** The recipe's anchor. The CLI's only pre-generation scale claim is the ceiling height. */
  anchor: RecipeAnchor | null;
  /** The room in metres, from the fused scale. Null when there was nothing to measure. */
  geometry: { width: number; depth: number; height: number; door: unknown; windows: unknown[] } | null;
  measurement: RoomMeasurement | null;
}

export interface LocalUnit {
  /** First 8 hex of sha256 over the sorted recipe hashes; the `/t/<id>` in the URL. */
  id: string;
  name: string;
  /** ISO 8601. Never part of the id. */
  createdAt: string;
  address: string | null;
  tier: RecipeTier;
  rooms: LocalRoom[];
  /** The CLI does not parse floor plans; a unit made here has no plan. */
  plan: null;
}

/* ---------- ids and urls ---------- */

/** Characters of the unit id. Eight hex is 4 billion units before a collision is likely — plenty for a demo. */
export const UNIT_ID_CHARS = 8;

/**
 * The unit id for a set of recipes: the first 8 hex of sha256 over the recipe hashes, sorted and
 * newline-joined (docs/CLI.md step 7). Sorted, so the order rooms happened to be scanned in cannot
 * move the URL; over the recipe hashes, so the same photos and options always land on the same one.
 */
export function unitIdFor(recipeHashes: readonly string[]): string {
  if (!recipeHashes.length) throw new Error('a unit needs at least one recipe');
  const sorted = [...recipeHashes].map((h) => String(h).trim().toLowerCase()).sort();
  return createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex').slice(0, UNIT_ID_CHARS);
}

/** Where one of a world's own assets is served from: `/local-assets/<worldId>/<name>`. */
export function localAssetUrl(worldId: string, name: string): string {
  return `${LOCAL_ASSET_PREFIX}/${segment('world id', worldId)}/${segment('asset name', name)}`;
}

/** Where that asset is written: `.audora/local/assets/<worldId>/<name>`. */
export function localAssetFile(paths: LocalPaths, worldId: string, name: string): string {
  return path.join(paths.assets, segment('world id', worldId), segment('asset name', name));
}

/** The page that walks a unit. The port is which local server is answering, not part of the id. */
export function tourUrl(port: number, unitId: string): string {
  return `http://localhost:${port}/t/${segment('unit id', unitId)}`;
}

export function unitFile(paths: LocalPaths, unitId: string): string {
  return path.join(paths.units, `${segment('unit id', unitId)}.json`);
}

export function worldCacheFile(paths: LocalPaths, recipeHash: string): string {
  return path.join(paths.worlds, `${segment('recipe hash', recipeHash)}.json`);
}

/* ---------- reading and writing ---------- */

/**
 * Write JSON where a half-written file can never be read as a whole one: a sibling temp file, then
 * a rename, which is atomic within a directory on every platform the demo runs on.
 */
function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    renameSync(tmp, file);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* the rename is the error worth reporting */
    }
    throw e;
  }
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    // A corrupt file is a cache miss, not a crash: the CLI regenerates or re-reads rather than
    // refusing to run because something truncated a write.
    return null;
  }
}

export function writeUnit(paths: LocalPaths, unit: LocalUnit): string {
  const file = unitFile(paths, unit.id);
  writeJsonAtomic(file, unit);
  return file;
}

export function readUnit(paths: LocalPaths, unitId: string): LocalUnit | null {
  if (!isSafeSegment(unitId)) return null;
  return readJson<LocalUnit>(unitFile(paths, unitId));
}

/** Every unit in the store, newest first; the id breaks a tie so the order never depends on the filesystem. */
export function listUnits(paths: LocalPaths): LocalUnit[] {
  if (!existsSync(paths.units)) return [];
  const out: LocalUnit[] = [];
  for (const name of readdirSync(paths.units).sort()) {
    if (!name.endsWith('.json')) continue;
    const unit = readJson<LocalUnit>(path.join(paths.units, name));
    if (unit && typeof unit.id === 'string' && Array.isArray(unit.rooms)) out.push(unit);
  }
  return out.sort((a, b) => {
    const ta = Date.parse(String(a.createdAt ?? '')) || 0;
    const tb = Date.parse(String(b.createdAt ?? '')) || 0;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The world a recipe already has, or null. This is the whole of docs/CLI.md step 3: a hit means the
 * run spends nothing, and the unit that comes out is byte-for-byte the one the first run produced.
 */
export function readCachedWorld(paths: LocalPaths, recipeHash: string): LocalWorld | null {
  if (!isSafeSegment(recipeHash)) return null;
  const world = readJson<LocalWorld>(worldCacheFile(paths, recipeHash));
  // A record without a world id or without a splat is not a world anyone can walk; treat it as a miss.
  if (!world || typeof world.worldId !== 'string' || !world.worldId) return null;
  if (!world.assets || typeof world.assets !== 'object') return null;
  return world;
}

export function writeCachedWorld(paths: LocalPaths, world: LocalWorld): string {
  const file = worldCacheFile(paths, world.recipeHash);
  writeJsonAtomic(file, world);
  return file;
}

/** Which of a world's asset files are not on disk. Empty is the healthy answer; the CLI warns on the rest. */
export function missingAssetFiles(paths: LocalPaths, world: LocalWorld): string[] {
  const urls = [...Object.values(world.assets.spz ?? {}), world.assets.collider, world.assets.pano, world.assets.thumbnail];
  const missing: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    const name = url.slice(url.lastIndexOf('/') + 1);
    if (!isSafeSegment(name)) continue;
    if (!existsSync(localAssetFile(paths, world.worldId, name))) missing.push(name);
  }
  return missing;
}
