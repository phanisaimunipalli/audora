/// <reference types="node" />
/**
 * `audora generate` — docs/CLI.md, "Input layout" and "What it does, in order".
 *
 * A folder of photographs in, a walkable unit in the local store out. It is the same pipeline the
 * backend runs (docs/BACKEND.md §4), with the database, the queue and Storage taken out: scan the
 * folder into rooms, canonicalise and hash every photo (`server/photos.ts`), build one canonical
 * recipe per room (`server/recipe.ts`), look the recipe up in the local world cache, and only for
 * the misses submit to the provider (`selectProvider` in server/worker.ts — the very same port the
 * worker uses, so the mock is the end-to-end test path and Marble is the demo path), poll, wait for
 * the panorama, download every asset, measure the collider (`shared/collider.ts`) and fuse the
 * scale (`shared/fusion.ts`) into the room's metric dimensions.
 *
 * Conventions this module relies on:
 * - **Deterministic by construction.** Nothing that feeds a recipe, a hash or the unit id reads a
 *   clock, a random source or the network. `now` is injected and lands only in `createdAt` and
 *   `measuredAt`. The same folder and the same options therefore give the same recipe hashes, the
 *   same unit id and the same URL — which is what makes the cache in step 3 a *guarantee* rather
 *   than an optimisation.
 * - **Money is asked for once, before anything is spent.** The cost table and the confirmation come
 *   after the cache lookup, so a run with nothing to generate never asks; and without a terminal to
 *   ask on, the run refuses rather than spending. `MARBLE_MAX_GENERATIONS` is honoured exactly as
 *   the worker honours it.
 * - **A live failure has to be diagnosable.** Every provider response is described — which fields
 *   were present, which splat keys came back, with the signed URLs cut down to their path — into
 *   the log when a step fails, because the real demo runs against the real API with real credits
 *   and "it did not work" is not a bug report.
 * - **The extras never block the happy path.** No plan parsing, no geocoding, and the vision label
 *   only when `--ai` asked for it. Each of them falls back silently to what the folder name gave.
 * - **Nothing on the network happens without consent.** The Marble generation is asked for once
 *   (the cost table and the confirmation); the vision label — the only other paid call in here — is
 *   opt-in with `--ai` and is refused outright on a simulated run, because "MARBLE_MOCK=1 spends
 *   nothing" (docs/CLI.md) has to mean *nothing*, not "nothing at World Labs".
 *
 * server/ never imports src/; relative imports carry the `.js` extension (NodeNext).
 */
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CEILING_HEIGHT_M } from '../shared/collider.js';
import { CEILING_ASSUMED_SIGMA_M, CEILING_PRINTED_SIGMA_M } from '../shared/fusion.js';
import type { RoomType } from '../shared/marblePrompt.js';
import { modelForModelRoom } from '../shared/modelPolicy.js';
import {
  ensureLocalPaths,
  localAssetFile,
  localAssetUrl,
  missingAssetFiles,
  readCachedWorld,
  readUnit,
  tourUrl,
  unitIdFor,
  writeCachedWorld,
  writeUnit,
  type LocalPaths,
  type LocalPhoto,
  type LocalPlanDims,
  type LocalRoom,
  type LocalUnit,
  type LocalWorld,
  type LocalWorldAssets,
} from './local.js';
import { UnreadablePhotoError, azimuthForAngle, canonicalizePhoto, extensionForMime, sniffImage, type PhotoAngle, type PhotoExif } from './photos.js';
import { measureColliderBytes, measureRoom } from './pipeline.js';
import { MARBLE_MAX_IMAGES, buildRecipe, marbleRequestFrom, recipeHash, recipeSeed, type Recipe, type RecipeAnchor, type RecipeContext, type RecipeTier } from './recipe.js';
import { POLL_INTERVAL_MS, maxGenerations, selectProvider, type ProviderAssets, type ProviderProgress, type WorldProvider } from './worker.js';

/* ---------- what a tier costs ---------- */

/**
 * The price and the promise per tier. Copied from `TIERS` in src/services/mockWorld.ts, which is
 * what the browser shows — server/ must not import src/, and the two must agree or the CLI would
 * quote a number the app contradicts.
 */
export const TIER_COST: Readonly<Record<RecipeTier, { usd: number; credits: number; label: string; about: string }>> = Object.freeze({
  draft: { usd: 0.18, credits: 230, label: 'Draft', about: 'about 35 s, no metric scale' },
  full: { usd: 1.26, credits: 1580, label: 'Full', about: 'about 10 minutes, metric scale' },
});

/* ---------- how long we wait ---------- */

/** Poll cadence while a world is generating. The worker's number, so the two behave alike. */
export const CLI_POLL_INTERVAL_MS = POLL_INTERVAL_MS;
/** A draft takes ~35 s and a full ~10 min; past this something is wrong and the operation id is printed. */
export const GENERATE_TIMEOUT_MS = 25 * 60_000;
/** The panorama lands after the operation reports done. Mirrors src/services/marble.ts. */
export const PANO_POLL_INTERVAL_MS = 2_500;
export const PANO_POLL_TIMEOUT_MS = 60_000;

/* ---------- the folder ---------- */

/** What the scanner accepts (docs/CLI.md, "Input layout"). HEIC only gets as far as sharp's decoder. */
const IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
});

/** The four angle labels a file name can carry; docs/CLI.md names three, `centre` is the primary's own. */
const ANGLE_SUFFIX = /[-_ ](left|right|back|centre|center)$/;

const ROOM_TYPE_WORDS: readonly (readonly [RegExp, RoomType])[] = [
  [/\b(living|lounge|family|great|sitting)\b/, 'living'],
  [/\b(bed|bedroom|master|guest|nursery)\b/, 'bedroom'],
  [/\b(kitchen|kitchenette|galley)\b/, 'kitchen'],
  [/\b(bath|bathroom|ensuite|shower|powder|wc|toilet)\b/, 'bathroom'],
  [/\b(dining|diner)\b/, 'dining'],
  [/\b(office|study|den|workroom)\b/, 'office'],
  [/\b(hall|hallway|corridor|entry|entrance|foyer|landing)\b/, 'hallway'],
  [/\b(studio|loft)\b/, 'studio'],
];

/** What a room of each type is called when the folder name is exactly the type word. */
const ROOM_TYPE_LABEL: Readonly<Record<RoomType, string>> = Object.freeze({
  living: 'Living room',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  dining: 'Dining room',
  bathroom: 'Bathroom',
  office: 'Office',
  hallway: 'Hallway',
  studio: 'Studio',
  other: 'Room',
});

export interface ScannedPhoto {
  /** Relative to the folder that was scanned, so the unit file says where the shot came from. */
  file: string;
  abs: string;
  angle: PhotoAngle | null;
}

export interface ScannedRoom {
  id: string;
  name: string;
  type: RoomType;
  order: number;
  /** Primary first, then the extra angles by file name. At most `MARBLE_MAX_IMAGES`. */
  photos: ScannedPhoto[];
}

export interface ScanResult {
  rooms: ScannedRoom[];
  /** Everything that was not used, and why. Printed, never silent (docs/CLI.md). */
  notes: string[];
  /** True when subfolders were read as rooms of one unit rather than the folder as one room. */
  perRoomFolders: boolean;
}

/** A URL- and path-safe room id from a folder name: `Bedroom 1` → `bedroom-1`. */
export function slug(name: string): string {
  const s = String(name)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'room';
}

/** The room type a folder name names, or `other` — the vision model is the only other opinion. */
export function roomTypeFromName(name: string): RoomType {
  const words = String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [re, type] of ROOM_TYPE_WORDS) if (re.test(words)) return type;
  return 'other';
}

/** `bedroom-1` → "Bedroom 1"; `living` → "Living room" (the type's own label). */
export function roomNameFromFolder(folder: string): string {
  const s = slug(folder);
  const type = roomTypeFromName(s);
  if (type !== 'other' && s === type) return ROOM_TYPE_LABEL[type];
  const words = s.split('-').filter(Boolean);
  if (!words.length) return ROOM_TYPE_LABEL.other;
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * Compare two file names the way a person reads them: digit runs compare as numbers, so `IMG_2`
 * sorts before `IMG_10`. Deterministic and locale-free — `localeCompare` is neither, and the photo
 * order is hashed into the recipe.
 */
export function compareNames(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const as = a.toLowerCase().match(re) ?? [];
  const bs = b.toLowerCase().match(re) ?? [];
  for (let i = 0; i < Math.min(as.length, bs.length); i += 1) {
    const x = as[i];
    const y = bs[i];
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d < 0 ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  if (as.length !== bs.length) return as.length < bs.length ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The angle a file name labels, from its `-left` / `-right` / `-back` suffix. */
export function angleFromName(file: string): PhotoAngle | null {
  const base = path.basename(file, path.extname(file)).toLowerCase();
  const m = ANGLE_SUFFIX.exec(base);
  if (!m) return null;
  return m[1] === 'center' ? 'centre' : (m[1] as PhotoAngle);
}

interface FoundFile {
  file: string;
  abs: string;
}

/** The image files directly inside one directory, sorted, plus a note for everything skipped. */
function imagesIn(dir: string, prefix: string, notes: string[]): FoundFile[] {
  const out: FoundFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // .DS_Store and friends are not worth a note
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_TYPES[ext]) {
      notes.push(`skipped ${prefix}${entry.name}: ${ext ? `${ext} is not an accepted image` : 'no file extension'}`);
      continue;
    }
    out.push({ file: `${prefix}${entry.name}`, abs: path.join(dir, entry.name) });
  }
  return out.sort((a, b) => compareNames(a.file, b.file));
}

/** Primary first (the file whose name says `primary`, else the first by name), then the rest in order. */
function orderRoomPhotos(files: FoundFile[]): ScannedPhoto[] {
  const primary = files.findIndex((f) => path.basename(f.file).toLowerCase().includes('primary'));
  const ordered = primary > 0 ? [files[primary], ...files.filter((_, i) => i !== primary)] : files;
  return ordered.map((f) => ({ file: f.file, abs: f.abs, angle: angleFromName(f.file) }));
}

/**
 * Read a photos folder into rooms — docs/CLI.md, "Input layout". A flat folder is one room; a
 * folder with subfolders that hold images is a unit whose rooms are those subfolders. Everything
 * that is not used comes back as a note, because a silently ignored photograph is the one failure
 * a seller would not notice until the tour is wrong.
 */
export function scanPhotos(dir: string): ScanResult {
  const root = path.resolve(dir);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(root);
  } catch {
    throw new Error(`No such folder: ${dir}`);
  }
  if (!stat.isDirectory()) throw new Error(`${dir} is not a folder. Give me a folder of photographs.`);

  const notes: string[] = [];
  const subdirs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort(compareNames);

  const roomFolders = subdirs.filter((name) => imagesIn(path.join(root, name), '', []).length > 0);
  const rooms: ScannedRoom[] = [];

  if (roomFolders.length) {
    const loose = imagesIn(root, '', notes);
    if (loose.length) notes.push(`ignored ${loose.length} photo(s) at the top level: this folder has room subfolders, so rooms come from those`);
    const used = new Set<string>();
    for (const folder of roomFolders) {
      let id = slug(folder);
      // Two folders can slug to one id (`Bedroom 1` and `bedroom-1`); the id is a URL segment and a
      // room key, so the second one is numbered rather than allowed to overwrite the first.
      if (used.has(id)) {
        let n = 2;
        while (used.has(`${id}-${n}`)) n += 1;
        id = `${id}-${n}`;
      }
      used.add(id);
      const files = imagesIn(path.join(root, folder), `${folder}/`, notes);
      const kept = files.slice(0, MARBLE_MAX_IMAGES);
      if (files.length > kept.length) notes.push(`${folder}: kept the first ${MARBLE_MAX_IMAGES} photos; Marble takes no more`);
      rooms.push({ id, name: roomNameFromFolder(folder), type: roomTypeFromName(folder), order: rooms.length, photos: orderRoomPhotos(kept) });
    }
    return { rooms, notes, perRoomFolders: true };
  }

  const files = imagesIn(root, '', notes);
  if (!files.length) return { rooms, notes, perRoomFolders: false };
  const kept = files.slice(0, MARBLE_MAX_IMAGES);
  if (files.length > kept.length) notes.push(`kept the first ${MARBLE_MAX_IMAGES} photos; Marble takes no more`);
  const folder = path.basename(root);
  rooms.push({ id: slug(folder), name: roomNameFromFolder(folder), type: roomTypeFromName(folder), order: 0, photos: orderRoomPhotos(kept) });
  return { rooms, notes, perRoomFolders: false };
}

/* ---------- options ---------- */

export interface GenerateIo {
  log: (line: string) => void;
  /** One line per room, rewritten as it changes: "living: generating 42% · World generation in progress". */
  progress: (roomId: string, line: string) => void;
  /**
   * Ask before spending. **Absent means there is nothing to ask on** (no terminal), and the run
   * refuses instead of generating — which is the whole of "the CLI never generates without a
   * confirmation or `--yes`" in a script or a pipe.
   */
  confirm?: (question: string) => Promise<boolean>;
}

export interface GenerateOptions {
  /** The photos folder. */
  dir: string;
  paths: LocalPaths;
  io: GenerateIo;
  env?: Record<string, string | undefined>;
  tier?: RecipeTier;
  /** Unit name; defaults to the folder's own name. */
  name?: string | null;
  /** Printed plan dimensions in metres, per room id. */
  dims?: Record<string, { width: number; depth: number }> | null;
  /** Printed or known ceiling height, metres. */
  ceiling?: number | null;
  address?: string | null;
  port?: number;
  yes?: boolean;
  /**
   * True for `--ai`: may ask the vision model what an unnamed room is. **Off by default**, because
   * it is a live, billed call to a third party and the CLI asks before it spends (docs/CLI.md).
   * Even with it on, a simulated run (`MARBLE_MOCK=1`, or no Marble key) never asks.
   */
  ai?: boolean;
  /** Defaults to `selectProvider(env)`; tests pass a counting mock. */
  provider?: WorldProvider;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  panoIntervalMs?: number;
  panoTimeoutMs?: number;
  timeoutMs?: number;
}

export interface GenerateResult {
  unit: LocalUnit;
  /** The one line the CLI prints at the end. */
  url: string;
  file: string;
  generated: number;
  reused: number;
  provider: 'marble' | 'mock';
  notes: string[];
}

/* ---------- describing a provider answer ---------- */

/** A signed URL, cut to what identifies it: the host and the last path segment, never the query. */
function shortUrl(url: string | undefined | null): string {
  if (!url) return '—';
  const clean = String(url).split('?')[0];
  const slash = clean.lastIndexOf('/');
  const tail = slash >= 0 ? clean.slice(slash + 1) : clean;
  const scheme = clean.slice(0, Math.max(0, clean.indexOf('//') + 2));
  const host = clean.slice(scheme.length).split('/')[0];
  return `${scheme}${host}/…/${tail}`;
}

/**
 * What the provider actually returned, in one line. This is the diagnosis for a live run: the field
 * names are Marble's own (`assets.splats.spz_urls`, `mesh.collider_mesh_url`, `imagery.pano_url`,
 * `thumbnail_url`, `semantics_metadata`) as `marbleProvider` maps them, so an empty one here points
 * straight at the response key that was missing.
 */
export function describeAssets(a: ProviderAssets | null | undefined): string {
  if (!a) return 'no world record';
  const spz = Object.keys(a.spz ?? {});
  return [
    `worldId=${a.worldId || '—'}`,
    `spz_urls=[${spz.join(', ') || 'none'}]`,
    `collider_mesh_url=${shortUrl(a.collider)}`,
    `pano_url=${shortUrl(a.pano)}`,
    `thumbnail_url=${shortUrl(a.thumbnail)}`,
    `metric_scale_factor=${a.metricScaleFactor ?? 'null'}`,
    `ground_plane_offset=${a.groundPlaneOffset ?? 'null'}`,
  ].join(' ');
}

/**
 * One line of someone else's error. An image decoder's failure arrives as a paragraph of its own
 * internals ("Input buffer has corrupt header: source: bad seek to 1024 / …"); the first clause
 * says which photograph and why, and the rest scrolls a progress log at the moment a person is
 * watching it. The tail is dropped, with a `…` so nobody thinks that was all of it.
 */
export function firstLine(text: string): string {
  const all = String(text).replace(/\r/g, '');
  const cut = all.indexOf('\n');
  const head = (cut < 0 ? all : all.slice(0, cut)).trim();
  if (!head) return all.trim().slice(0, 200);
  return cut < 0 || !all.slice(cut).trim() ? head : `${head} …`;
}

/**
 * Two answers about the same world, merged field by field, keeping every URL already held.
 *
 * Marble fills a world record in as the pieces land, so a later poll can come back with less in it
 * than the one before — `assets: null`, or `splats` present with no `spz_urls` yet. Replacing the
 * record wholesale (which is what the pano wait used to do) therefore throws away the splat, the
 * collider and the thumbnail that had already arrived, and the run dies on "has no assets" after a
 * generation that was paid for and finished. The browser's `waitForPano` (src/services/marble.ts)
 * keeps the better record for exactly this reason; this is the same rule, per field.
 */
export function mergeAssets(held: ProviderAssets, fresh: ProviderAssets | null | undefined): ProviderAssets {
  if (!fresh) return held;
  const spz: Record<string, string> = { ...(held.spz ?? {}) };
  for (const [key, url] of Object.entries(fresh.spz ?? {})) if (url) spz[key] = url;
  return {
    worldId: fresh.worldId || held.worldId,
    spz,
    ...(fresh.collider || held.collider ? { collider: fresh.collider || held.collider } : {}),
    ...(fresh.pano || held.pano ? { pano: fresh.pano || held.pano } : {}),
    ...(fresh.thumbnail || held.thumbnail ? { thumbnail: fresh.thumbnail || held.thumbnail } : {}),
    ...(fresh.caption || held.caption ? { caption: fresh.caption || held.caption } : {}),
    ...(fresh.worldUrl || held.worldUrl ? { worldUrl: fresh.worldUrl || held.worldUrl } : {}),
    metricScaleFactor: fresh.metricScaleFactor ?? held.metricScaleFactor ?? null,
    groundPlaneOffset: fresh.groundPlaneOffset ?? held.groundPlaneOffset ?? null,
  };
}

export function describeProgress(p: ProviderProgress | null | undefined): string {
  if (!p) return 'no operation record';
  return `done=${p.done} progress=${p.progress ?? '—'} status=${JSON.stringify(p.status ?? null)} worldId=${p.worldId || '—'} error=${JSON.stringify(p.error ?? null)}`;
}

/* ---------- the address ---------- */

/**
 * The city an address names, for the prompt's context (docs/BACKEND.md §3, point 5). Deliberately a
 * string rule and not a geocoder: the CLI does no network lookup, so `site` stays null and the sun
 * is left to the app. The rule is: the last comma-separated part, skipping a trailing country or
 * state code and any part carrying digits (a street number or a postcode).
 */
export function cityFromAddress(address: string | null | undefined): string | undefined {
  if (!address) return undefined;
  const parts = String(address)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return undefined;
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const part = parts[i];
    if (/\d/.test(part)) continue;
    if (/^[A-Z]{2,3}$/.test(part)) continue; // CA, USA, UK — a state or country, not a city
    return part;
  }
  return undefined;
}

/* ---------- the plan dimensions ---------- */

/** The key a bare `--dims 5.3x5.8` uses: "the room", when the folder has exactly one. */
export const ONLY_ROOM = '*';

/**
 * Plan dimensions, resolved onto the rooms that were actually found. A name that matches no room is
 * refused rather than dropped: a printed dimension is a measurement, and one silently ignored
 * because of a typo would leave the room measured by the assumed ceiling alone with nothing saying
 * so. The bare form needs exactly one room, for the same reason.
 */
export function resolveDims(
  dims: Record<string, { width: number; depth: number }> | null,
  rooms: readonly ScannedRoom[],
): Record<string, { width: number; depth: number }> | null {
  if (!dims) return null;
  const ids = rooms.map((r) => r.id);
  const out: Record<string, { width: number; depth: number }> = {};
  for (const [key, value] of Object.entries(dims)) {
    if (key === ONLY_ROOM) {
      if (ids.length !== 1) throw new Error(`--dims needs a room name (${ids.join(', ')}) when the folder has ${ids.length} rooms.`);
      out[ids[0]] = value;
      continue;
    }
    if (!ids.includes(key)) throw new Error(`--dims names "${key}", which is not one of the rooms (${ids.join(', ')}).`);
    out[key] = value;
  }
  return out;
}

/* ---------- the anchor ---------- */

/**
 * The scale claim the CLI can make *before* a world exists, which the recipe requires
 * (docs/BACKEND.md §1: an anchor is required). The CLI has no tapped door and no floor plan, so the
 * claim is the ceiling: the height printed on the drawing when `--ceiling` gave one (±3 cm), else
 * the standard 2.44 m (±12 cm). `referenceUnits` is 1 because the collider does not exist yet and
 * its units are unknown — which is exactly why `measureRoom` is given `anchor: null` and fuses the
 * ceiling directly instead of this placeholder. It is in the recipe because the recipe hashes the
 * inputs, and a run with a different stated ceiling is honestly a different generation.
 */
export function ceilingAnchor(ceilingM: number | null | undefined): RecipeAnchor {
  const printed = typeof ceilingM === 'number' && Number.isFinite(ceilingM) && ceilingM > 0;
  const height = printed ? (ceilingM as number) : CEILING_HEIGHT_M;
  return {
    method: printed ? 'ceiling' : 'assumed',
    referenceMetres: height,
    referenceUnits: 1,
    metresPerUnit: height,
    uncertaintyM: printed ? CEILING_PRINTED_SIGMA_M : CEILING_ASSUMED_SIGMA_M,
  };
}

/* ---------- canonical photos ---------- */

interface PreparedPhoto {
  file: string;
  angle: PhotoAngle | null;
  sha256: string;
  canonicalSha256: string;
  width: number;
  height: number;
  exif: PhotoExif | null;
  /** The canonical bytes, base64, and the extension the bytes really are (mirrors the worker). */
  base64: string;
  extension: string;
}

async function preparePhoto(photo: ScannedPhoto): Promise<PreparedPhoto> {
  const bytes = readFileSync(photo.abs);
  const mime = IMAGE_TYPES[path.extname(photo.abs).toLowerCase()] ?? 'application/octet-stream';
  const canonical = await canonicalizePhoto(bytes, mime);
  const sniffed = sniffImage(canonical.canonical)?.mime;
  /* With sharp installed an undecodable file has already thrown `UnreadablePhotoError`. Without it
     (`method: "passthrough"`) nothing decodes anything, and a container our sniffer does not know —
     a HEIC, which is exactly the format docs/CLI.md says needs sharp — comes back with no
     dimensions at all. Refuse it here rather than hand Marble bytes labelled as a JPEG that are
     not one: "heic only when sharp can decode it" has to hold on a machine without sharp too. */
  if (!(canonical.width > 0) || !(canonical.height > 0)) {
    throw new UnreadablePhotoError(`this image could not be read (${canonical.method === 'passthrough' ? 'no decoder on this machine: install sharp for HEIC' : 'no dimensions'})`);
  }
  return {
    file: photo.file,
    angle: photo.angle,
    sha256: canonical.sha256Original,
    canonicalSha256: canonical.sha256Canonical,
    width: canonical.width,
    height: canonical.height,
    exif: canonical.exif,
    base64: Buffer.from(canonical.canonical).toString('base64'),
    extension: sniffed ? extensionForMime(sniffed) : 'jpg',
  };
}

/* ---------- the vision label ---------- */

const NEBIUS_BASE = 'https://api.tokenfactory.nebius.com/v1';
const DEFAULT_VISION_MODEL = 'openbmb/MiniCPM-V-4_5';
const VISION_TYPES: readonly RoomType[] = ['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'studio', 'other'];

/**
 * Whether this run may ask the vision model at all, and what to tell someone whose room stayed
 * `other` when it may not. One decision, taken once, before any photograph is prepared.
 *
 * The rules, in the order they are checked, are all the same rule: **money is asked for first.**
 * A live Nebius call is not part of "generate this folder", it is a second purchase from a second
 * vendor, so it takes `--ai`; and a run that is spending nothing at World Labs must spend nothing
 * at Nebius either, or `MARBLE_MOCK=1` is not a dry run and the team cannot rehearse the demo.
 */
export function visionPlan(
  ai: boolean | undefined,
  env: Record<string, string | undefined>,
  providerName: 'marble' | 'mock',
): { ask: boolean; why: string } {
  if (ai !== true) return { ask: false, why: 'pass --ai to ask the vision model (a live Nebius call), or name the folder living/bedroom/kitchen/…' };
  if (providerName === 'mock') return { ask: false, why: '--ai is ignored on a simulated run: MARBLE_MOCK spends nothing, and the vision model is a live call' };
  if (!(env.NEBIUS_API_KEY || '').trim()) return { ask: false, why: '--ai needs NEBIUS_API_KEY; the folder name stands' };
  return { ask: true, why: '' };
}

/**
 * What the vision model calls this room — docs/CLI.md, `--ai`. Only ever asked when the run opted
 * in *and* the folder name said nothing (`other`), at temperature 0 with a seed, and **cached by
 * the canonical photo hash**, so the answer that goes into the recipe is stable across runs and the
 * unit id does not move under a model's mood. Any failure at all — no key, a refusal, a word that
 * is not a room type — falls back to the folder name.
 *
 * The request is announced before it is made: it costs someone money, and one log line after the
 * fact is not how a spend gets noticed.
 */
async function visionRoomType(
  photo: PreparedPhoto,
  env: Record<string, string | undefined>,
  paths: LocalPaths,
  log: (line: string) => void,
  label: string,
): Promise<RoomType | null> {
  const key = (env.NEBIUS_API_KEY || '').trim();
  if (!key) return null;
  /* The second lock on the same door as `visionPlan`. A simulated run promises to spend nothing,
     and this is the only function in the CLI that can break that promise, so it refuses here too
     rather than trusting every future caller to have asked first. */
  if ((env.MARBLE_MOCK || '').trim() === '1') return null;
  const cacheDir = path.join(paths.root, 'vision');
  const cacheFile = path.join(cacheDir, `${photo.canonicalSha256}.json`);
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { roomType?: string };
      if (typeof cached.roomType === 'string' && (VISION_TYPES as readonly string[]).includes(cached.roomType)) return cached.roomType as RoomType;
    } catch {
      /* a corrupt cache entry is a miss */
    }
  }
  const model = env.NEBIUS_VISION_MODEL || DEFAULT_VISION_MODEL;
  try {
    const base = (env.NEBIUS_BASE || NEBIUS_BASE).replace(/\/+$/, '');
    log(`${label}: asking the vision model (${model} at ${base}) what room this is — one live call`);
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        // Seeded from the photo itself, so the same picture asks the same question the same way.
        seed: parseInt(photo.canonicalSha256.slice(0, 8), 16),
        max_tokens: 8,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `Which room is this? Answer with exactly one word from: ${VISION_TYPES.join(', ')}.` },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${photo.base64}` } },
            ],
          },
        ],
      }),
    });
    if (!r.ok) {
      log(`the vision model answered ${r.status}; keeping the folder name`);
      return null;
    }
    const body = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const word = String(body.choices?.[0]?.message?.content ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const type = (VISION_TYPES as readonly string[]).includes(word) ? (word as RoomType) : null;
    if (!type) return null;
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, `${JSON.stringify({ roomType: type, sha256: photo.canonicalSha256 }, null, 2)}\n`, 'utf8');
    return type;
  } catch (e) {
    log(`the vision model could not be reached (${e instanceof Error ? e.message : String(e)}); keeping the folder name`);
    return null;
  }
}

/* ---------- asset names ---------- */

/**
 * Our own name for one of the provider's splats. The same rule `spzName` applies in server/worker.ts
 * (`full_res` is our `full`), duplicated because that one is module-private; docs/CLI.md names the
 * files, and both places must produce `spz-100k.spz`, `spz-500k.spz`, `spz-full.spz`.
 */
export function spzAssetName(providerKey: string): { key: string; name: string } {
  const clean = providerKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const key = clean === 'full-res' || clean === 'fullres' ? 'full' : clean || 'default';
  return { key, name: `spz-${key}.spz` };
}

/** `pano.jpg` when the panorama is a JPEG, `pano.png` when it is a PNG — mirrors `namedFor` in the worker. */
export function namedForType(base: string, contentType: string, fallback: string): string {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  const ext = type.startsWith('image/') ? extensionForMime(type) : fallback;
  return `${base}.${ext === 'bin' ? fallback : ext}`;
}

/* ---------- generating one world ---------- */

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface WorldRun {
  world: LocalWorld;
  colliderBytes: Buffer | null;
}

interface RoomPlan {
  scanned: ScannedRoom;
  type: RoomType;
  photos: PreparedPhoto[];
  recipe: Recipe;
  hash: string;
  seed: number;
  planDims: LocalPlanDims | null;
  cached: LocalWorld | null;
}

interface RunContext {
  provider: WorldProvider;
  paths: LocalPaths;
  io: GenerateIo;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollIntervalMs: number;
  panoIntervalMs: number;
  panoTimeoutMs: number;
  timeoutMs: number;
  tier: RecipeTier;
}

/**
 * Submit, poll, wait for the panorama, download. Everything that can fail says what the provider
 * answered before it throws, because this is the path that runs against the live API with credits.
 */
async function generateWorld(ctx: RunContext, room: RoomPlan): Promise<WorldRun> {
  const started = ctx.now();
  const request = marbleRequestFrom(room.recipe, room.photos.map((p) => ({ base64: p.base64, extension: p.extension })), { displayName: `Audora · ${room.scanned.name}` });
  ctx.io.progress(room.scanned.id, `${room.scanned.id}: submitting · ${room.recipe.model}, seed ${room.seed}`);

  let submission;
  try {
    submission = await ctx.provider.generate(request);
  } catch (e) {
    ctx.io.log(
      `${room.scanned.id}: the provider refused the request (model=${room.recipe.model} seed=${room.seed} images=${room.photos.length} ` +
        `prompt=${room.recipe.prompt.length} chars reconstruct=${room.recipe.reconstructImages} pano=${room.recipe.isPano})`,
    );
    throw e;
  }

  const operationId = submission.operationId;
  let worldId = submission.worldId;
  let last: ProviderProgress | null = null;
  const deadline = started + ctx.timeoutMs;
  for (;;) {
    await ctx.sleep(ctx.pollIntervalMs);
    let state: ProviderProgress;
    try {
      state = await ctx.provider.poll(operationId);
    } catch (e) {
      ctx.io.log(`${room.scanned.id}: polling operation ${operationId} failed; last answer was ${describeProgress(last)}`);
      throw e;
    }
    last = state;
    if (state.worldId) worldId = state.worldId;
    if (state.error) {
      ctx.io.log(`${room.scanned.id}: the provider reported a failure — ${describeProgress(state)}`);
      throw new Error(`${room.scanned.name}: the provider reported: ${state.error} (operation ${operationId})`);
    }
    if (state.done) break;
    const pct = typeof state.progress === 'number' ? `${Math.round(state.progress)}%` : '…';
    ctx.io.progress(room.scanned.id, `${room.scanned.id}: generating ${pct}${state.status ? ` · ${state.status}` : ''}`);
    if (ctx.now() >= deadline) {
      ctx.io.log(`${room.scanned.id}: gave up waiting; last answer was ${describeProgress(state)}`);
      throw new Error(
        `${room.scanned.name}: the generation did not finish within ${Math.round(ctx.timeoutMs / 60_000)} minutes. ` +
          `It may still complete: operation ${operationId}${worldId ? `, world ${worldId}` : ''}.`,
      );
    }
  }
  if (!worldId) {
    ctx.io.log(`${room.scanned.id}: the operation finished without a world id — ${describeProgress(last)}`);
    throw new Error(`${room.scanned.name}: the operation finished without a world id (operation ${operationId}).`);
  }

  ctx.io.progress(room.scanned.id, `${room.scanned.id}: fetching the world`);
  let assets: ProviderAssets;
  try {
    assets = await ctx.provider.world(worldId);
  } catch (e) {
    ctx.io.log(`${room.scanned.id}: the world record ${worldId} could not be read (operation ${operationId})`);
    throw e;
  }

  // The panorama lands a few seconds after the operation says done, and it is what the photo view
  // renders. Poll for it, and attach the world either way when the time is up (src/services/marble.ts
  // does exactly this for the browser flow).
  if (!assets.pano) {
    const until = ctx.now() + ctx.panoTimeoutMs;
    while (ctx.now() < until) {
      ctx.io.progress(room.scanned.id, `${room.scanned.id}: waiting for the panorama`);
      await ctx.sleep(ctx.panoIntervalMs);
      try {
        // Merged, never replaced: a record still filling in must not take back the splat and the
        // collider this one already has (`mergeAssets`).
        assets = mergeAssets(assets, await ctx.provider.world(worldId));
        if (assets.pano) break;
      } catch {
        /* transient: keep polling until the timeout */
      }
    }
    if (!assets.pano) ctx.io.log(`${room.scanned.id}: no panorama after ${Math.round(ctx.panoTimeoutMs / 1000)} s — ${describeAssets(assets)}`);
  }

  const wanted: { name: string; url: string; slot: 'spz' | 'collider' | 'pano' | 'thumbnail'; key?: string }[] = [];
  for (const [providerKey, url] of Object.entries(assets.spz ?? {})) {
    if (!url) continue;
    const { key, name } = spzAssetName(providerKey);
    wanted.push({ name, url, slot: 'spz', key });
  }
  if (assets.collider) wanted.push({ name: 'collider.glb', url: assets.collider, slot: 'collider' });
  if (assets.pano) wanted.push({ name: 'pano', url: assets.pano, slot: 'pano' });
  if (assets.thumbnail) wanted.push({ name: 'thumb', url: assets.thumbnail, slot: 'thumbnail' });
  if (!wanted.length) {
    ctx.io.log(`${room.scanned.id}: the finished world has nothing to download — ${describeAssets(assets)}`);
    throw new Error(`${room.scanned.name}: the finished world ${worldId} has no assets.`);
  }

  const stored: LocalWorldAssets = { spz: {} };
  let colliderBytes: Buffer | null = null;
  // Through `localAssetFile` rather than `path.join`, so the provider's world id is checked as a
  // path segment once, here, before anything is written under it.
  mkdirSync(path.dirname(localAssetFile(ctx.paths, worldId, 'placeholder.bin')), { recursive: true });
  for (let i = 0; i < wanted.length; i += 1) {
    const item = wanted[i];
    ctx.io.progress(room.scanned.id, `${room.scanned.id}: downloading ${i + 1}/${wanted.length}`);
    let fetched;
    try {
      fetched = await ctx.provider.fetchAsset(item.url);
    } catch (e) {
      ctx.io.log(`${room.scanned.id}: ${item.slot} could not be downloaded from ${shortUrl(item.url)} — ${describeAssets(assets)}`);
      throw e;
    }
    const name = item.slot === 'pano' ? namedForType('pano', fetched.contentType, 'jpg') : item.slot === 'thumbnail' ? namedForType('thumb', fetched.contentType, 'jpg') : item.name;
    writeFileSync(localAssetFile(ctx.paths, worldId, name), fetched.bytes);
    if (item.slot === 'collider') colliderBytes = Buffer.from(fetched.bytes);
    if (item.slot === 'spz') stored.spz[item.key as string] = localAssetUrl(worldId, name);
    else stored[item.slot] = localAssetUrl(worldId, name);
  }

  const world: LocalWorld = {
    worldId,
    provider: ctx.provider.name,
    model: room.recipe.model,
    tier: ctx.tier,
    recipeHash: room.hash,
    seed: room.seed,
    assets: stored,
    metricScaleFactor: assets.metricScaleFactor ?? null,
    groundPlaneOffset: assets.groundPlaneOffset ?? null,
    bounds: null,
    raw: null,
    ...(assets.caption ? { caption: assets.caption } : {}),
    ...(assets.worldUrl ? { worldUrl: assets.worldUrl } : {}),
    providerAssets: { spz: assets.spz ?? {}, collider: assets.collider ?? null, pano: assets.pano ?? null, thumbnail: assets.thumbnail ?? null, worldUrl: assets.worldUrl ?? null },
    // The mock spends nothing; a live generation costs the tier's published credits.
    ...(ctx.provider.name === 'marble' ? { credits: TIER_COST[ctx.tier].credits } : {}),
    seconds: Math.max(0, Math.round((ctx.now() - started) / 1000)),
    createdAt: new Date(ctx.now()).toISOString(),
  };
  return { world, colliderBytes };
}

/* ---------- repairing a reused world ---------- */

/** The provider URL a stored asset file name came from, out of one world record. */
function urlForStoredName(assets: ProviderAssets, name: string): string | undefined {
  if (name.startsWith('spz-')) {
    for (const [providerKey, url] of Object.entries(assets.spz ?? {})) if (url && spzAssetName(providerKey).name === name) return url;
    return undefined;
  }
  if (name.startsWith('collider.')) return assets.collider;
  if (name.startsWith('pano.')) return assets.pano;
  if (name.startsWith('thumb.')) return assets.thumbnail;
  return undefined;
}

/** The URLs a cached world recorded when it was generated. Provenance, and the fallback below. */
function storedProviderAssets(world: LocalWorld): ProviderAssets | null {
  const p = world.providerAssets;
  if (!p || typeof p !== 'object') return null;
  const raw = p as { spz?: unknown; collider?: unknown; pano?: unknown; thumbnail?: unknown };
  const spz: Record<string, string> = {};
  if (raw.spz && typeof raw.spz === 'object') for (const [k, v] of Object.entries(raw.spz as Record<string, unknown>)) if (typeof v === 'string' && v) spz[k] = v;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  return { worldId: world.worldId, spz, ...(str(raw.collider) ? { collider: str(raw.collider) } : {}), ...(str(raw.pano) ? { pano: str(raw.pano) } : {}), ...(str(raw.thumbnail) ? { thumbnail: str(raw.thumbnail) } : {}) };
}

/**
 * Put back asset files that have gone missing from the store, without generating anything.
 *
 * A world-cache hit means the recipe already has a world, so the run spends nothing — but if one of
 * its files has been deleted the unit still links it and the server answers 404, and there used to
 * be no way out but to delete the cache entry and pay for the world again. Re-fetching a file is a
 * plain CDN GET the world already paid for, so the run just does it.
 *
 * Never fatal, and never from the wrong provider: a simulated provider would happily invent bytes
 * for a world Marble made, and a fake splat silently replacing a real one is worse than a 404.
 */
async function repairAssets(ctx: RunContext, room: RoomPlan, world: LocalWorld, missing: readonly string[]): Promise<void> {
  if (world.provider !== ctx.provider.name) {
    ctx.io.log(`${room.scanned.id}: cannot put back ${missing.join(', ')} — this world came from the ${world.provider} provider and this run is using ${ctx.provider.name}`);
    return;
  }
  let assets: ProviderAssets | null = null;
  try {
    // The record first: a provider's URLs are signed and expire, so the stored ones are the fallback.
    assets = mergeAssets(await ctx.provider.world(world.worldId), storedProviderAssets(world));
  } catch (e) {
    assets = storedProviderAssets(world);
    ctx.io.log(`${room.scanned.id}: the world record ${world.worldId} could not be re-read (${firstLine(e instanceof Error ? e.message : String(e))}); trying the URLs the run recorded`);
  }
  if (!assets) {
    ctx.io.log(`${room.scanned.id}: nothing to re-download from — the cached world kept no provider URLs`);
    return;
  }
  let put = 0;
  for (const name of missing) {
    const url = urlForStoredName(assets, name);
    if (!url) {
      ctx.io.log(`${room.scanned.id}: ${name} is missing and the world record no longer offers it — ${describeAssets(assets)}`);
      continue;
    }
    ctx.io.progress(room.scanned.id, `${room.scanned.id}: putting back ${name}`);
    try {
      const fetched = await ctx.provider.fetchAsset(url);
      mkdirSync(path.dirname(localAssetFile(ctx.paths, world.worldId, name)), { recursive: true });
      writeFileSync(localAssetFile(ctx.paths, world.worldId, name), fetched.bytes);
      put += 1;
    } catch (e) {
      ctx.io.log(`${room.scanned.id}: ${name} could not be re-downloaded from ${shortUrl(url)} (${firstLine(e instanceof Error ? e.message : String(e))})`);
    }
  }
  if (put) ctx.io.log(`${room.scanned.id}: put back ${put} of ${missing.length} missing asset file(s); nothing was generated`);
}

/* ---------- measuring ---------- */

interface Measured {
  geometry: LocalRoom['geometry'];
  measurement: LocalRoom['measurement'];
  bounds: LocalWorld['bounds'];
  raw: LocalWorld['raw'];
}

/**
 * Step 6: measure the collider and fuse the scale. Never fatal — the assets are already paid for
 * and the capture is walkable — so a mesh this reader cannot parse is logged and left unmeasured,
 * exactly as `measureWorld` does in the worker.
 */
function measure(ctx: RunContext, room: RoomPlan, bounds: ReturnType<typeof measureColliderBytes> | null, world: LocalWorld): Measured {
  const empty: Measured = { geometry: null, measurement: null, bounds: world.bounds, raw: world.raw };
  if (!bounds) return empty;
  try {
    const primary = room.photos[0];
    const result = measureRoom({
      bounds,
      // The plan's printed numbers and the stated ceiling. The recipe's anchor is deliberately not
      // passed: it IS the ceiling (see `ceilingAnchor`), and passing it would enter the same
      // assertion twice and suppress the ceiling constraint that says it properly.
      planDims: room.planDims,
      anchor: null,
      metricScaleFactor: world.metricScaleFactor,
      photo: primary ? { exif: primary.exif, width: primary.width, height: primary.height } : null,
      worldId: world.worldId,
      now: ctx.now(),
    });
    result.measurement.recipeHash = room.hash;
    if (result.measurement.flags.length) for (const flag of result.measurement.flags) ctx.io.log(`${room.scanned.id}: ${flag}`);
    return { geometry: result.geometry, measurement: result.measurement, bounds: result.bounds, raw: result.raw };
  } catch (e) {
    ctx.io.log(`${room.scanned.id}: the collider could not be measured (${e instanceof Error ? e.message : String(e)}); the room is unmeasured`);
    return empty;
  }
}

/* ---------- the flow ---------- */

const money = (usd: number): string => `$${usd.toFixed(2)}`;

/**
 * The measurement to write, with the clock of the run that actually measured it.
 *
 * A second run over the same folder regenerates nothing: it re-fuses the same bounds with the same
 * constraints and gets the same numbers back. Stamping today's `measuredAt` on them would change
 * the unit file — and therefore its ETag, and therefore make the viewer re-import a tour that is
 * identical — to record a measurement that did not happen. So when every other field agrees, the
 * first run's timestamp stands, exactly as `createdAt` does.
 */
export function carryMeasuredAt(previous: LocalRoom['measurement'] | undefined, next: LocalRoom['measurement']): LocalRoom['measurement'] {
  if (!next || !previous?.measuredAt) return next;
  const same = JSON.stringify({ ...previous, measuredAt: '' }) === JSON.stringify({ ...next, measuredAt: '' });
  return same ? { ...next, measuredAt: previous.measuredAt } : next;
}

/**
 * Turn a folder of photographs into a unit in the local store, and answer with the URL that walks
 * it. Steps 1 to 7 of docs/CLI.md, in that order.
 */
export async function generateLocal(options: GenerateOptions): Promise<GenerateResult> {
  const env = options.env ?? {};
  const io = options.io;
  const tier: RecipeTier = options.tier ?? 'draft';
  const now = options.now ?? Date.now;
  const paths = ensureLocalPaths(options.paths);
  const provider = options.provider ?? selectProvider(env);
  const port = options.port ?? 5173;

  /* 1. the folder */
  const scan = scanPhotos(options.dir);
  for (const note of scan.notes) io.log(note);
  if (!scan.rooms.length) throw new Error(`No photographs in ${options.dir}. Accepted: ${Object.keys(IMAGE_TYPES).join(', ')}.`);

  const dims = resolveDims(options.dims ?? null, scan.rooms);
  const ceiling = typeof options.ceiling === 'number' && Number.isFinite(options.ceiling) && options.ceiling > 0 ? options.ceiling : null;
  const anchor = ceilingAnchor(ceiling);
  const city = cityFromAddress(options.address);

  /* 2. canonicalise, label, and build the recipes */
  const pipelineVersion = (env.PIPELINE_VERSION || '1').trim() || '1';
  const providerName = provider.name;
  const vision = visionPlan(options.ai, env, providerName);
  const models = { marbleDraft: env.MARBLE_DRAFT_MODEL, marbleFull: env.MARBLE_FULL_MODEL };
  const notes: string[] = [...scan.notes];
  const plans: RoomPlan[] = [];

  for (const scanned of scan.rooms) {
    const photos: PreparedPhoto[] = [];
    for (const photo of scanned.photos) {
      try {
        photos.push(await preparePhoto(photo));
      } catch (e) {
        // The first line only: sharp's decode failures are ten lines of its own seek log.
        const why = firstLine(e instanceof Error ? e.message : String(e));
        const note = `skipped ${photo.file}: ${why}`;
        notes.push(note);
        io.log(note);
      }
    }
    if (!photos.length) {
      const note = `skipped ${scanned.id}: none of its photos could be read`;
      notes.push(note);
      io.log(note);
      continue;
    }

    let type = scanned.type;
    if (type === 'other') {
      // `other` is the folder name's own answer, so a vision model that also says `other` has
      // changed nothing and is not worth a line that reads like a guess.
      const guessed = vision.ask ? await visionRoomType(photos[0], env, paths, io.log, scanned.id) : null;
      if (guessed && guessed !== 'other') {
        type = guessed;
        io.log(`${scanned.id}: the vision model calls this a ${guessed}`);
      } else if (!vision.ask) {
        io.log(`${scanned.id}: the folder name does not name a room type; ${vision.why}`);
      }
    }

    const planDim = dims?.[scanned.id] ?? null;
    const planDims: LocalPlanDims | null = planDim || ceiling ? { ...(planDim ? { width: planDim.width, depth: planDim.depth } : {}), ...(ceiling ? { height: ceiling } : {}) } : null;
    const context: RecipeContext = { ...(city ? { city } : {}) };
    const model =
      providerName === 'mock'
        ? `mock-${tier}-1`
        : modelForModelRoom({ name: scanned.name, type, planWidthM: planDim?.width, planDepthM: planDim?.depth }, tier, models).model;
    const recipe = buildRecipe({
      pipelineVersion,
      provider: providerName,
      model,
      tier,
      photos: photos.map((p, i) => ({ sha256: p.canonicalSha256, role: i === 0 ? 'primary' : 'extra', angle: p.angle })),
      roomType: type,
      anchor,
      planDims: planDim,
      ceilingHeight: ceiling,
      // No geocoding in the CLI (docs/CLI.md): the address reaches the prompt as a city and nothing
      // else, and the site — lat/lon and heading — stays null for the app to fill in.
      site: null,
      context,
    });
    const hash = recipeHash(recipe);
    plans.push({ scanned: { ...scanned, type }, type, photos, recipe, hash, seed: recipeSeed(recipe), planDims, cached: readCachedWorld(paths, hash) });
  }
  if (!plans.length) throw new Error(`No room in ${options.dir} could be prepared. See the notes above.`);

  /* 3. the cache */
  const toGenerate = plans.filter((p) => !p.cached);
  for (const plan of plans) {
    if (!plan.cached) continue;
    const missing = missingAssetFiles(paths, plan.cached);
    io.log(
      `${plan.scanned.id}: reusing world ${plan.cached.worldId} (recipe ${plan.hash.slice(0, 12)})` +
        (missing.length ? ` — ${missing.length} asset file(s) missing from the store; re-downloading them` : ''),
    );
  }

  // The unit id follows from the recipes, so it is known before anything is generated — which is
  // what lets this run read what the last one wrote and keep the parts of it that are still true
  // (`createdAt`, and a `measuredAt` for a measurement that has not changed).
  const id = unitIdFor(plans.map((p) => p.hash));
  const existing = readUnit(paths, id);

  /* 4. the cost, and the question */
  if (toGenerate.length) {
    const cost = TIER_COST[tier];
    const live = providerName === 'marble';
    const total = live ? cost.usd * toGenerate.length : 0;
    const cap = maxGenerations(env);
    if (live && toGenerate.length > cap) {
      throw new Error(
        `Credit guard: this run would start ${toGenerate.length} live Marble generations (cap ${cap}). ` +
          'Set MARBLE_MAX_GENERATIONS to raise it, or run with MARBLE_MOCK=1.',
      );
    }
    io.log('');
    io.log(`${toGenerate.length} room(s) to generate: ${toGenerate.map((p) => p.scanned.id).join(', ')}`);
    io.log(`Tier ${cost.label} · ${cost.about} · ${live ? `${money(cost.usd)} each, ${money(total)} in total (${cost.credits} credits each)` : 'simulated provider, nothing is spent'}`);
    if (plans.length - toGenerate.length > 0) io.log(`${plans.length - toGenerate.length} room(s) already generated and reused.`);
    if (!options.yes) {
      if (!io.confirm) {
        throw new Error(
          `Refusing to generate without a confirmation: there is no terminal to ask on. ` +
            `Re-run with --yes to generate ${toGenerate.length} room(s)${live ? ` for about ${money(total)}` : ''}.`,
        );
      }
      const ok = await io.confirm(`Generate ${toGenerate.length} room(s)${live ? ` for about ${money(total)}` : ''}? [y/N] `);
      if (!ok) throw new Error('Cancelled; nothing was generated.');
    }
  }

  /* 5 and 6. generate, download, measure */
  const ctx: RunContext = {
    provider,
    paths,
    io,
    now,
    sleep: options.sleep ?? wait,
    pollIntervalMs: options.pollIntervalMs ?? CLI_POLL_INTERVAL_MS,
    panoIntervalMs: options.panoIntervalMs ?? PANO_POLL_INTERVAL_MS,
    panoTimeoutMs: options.panoTimeoutMs ?? PANO_POLL_TIMEOUT_MS,
    timeoutMs: options.timeoutMs ?? GENERATE_TIMEOUT_MS,
    tier,
  };
  const cap = maxGenerations(env);
  let live = 0;
  const rooms: LocalRoom[] = [];
  let generated = 0;

  for (const plan of plans) {
    let world = plan.cached;
    let colliderBytes: Buffer | null = null;
    if (!world) {
      if (providerName === 'marble') {
        // The same guard the worker applies per submission, so a run that grows past the cap stops
        // at the cap rather than after it.
        if (live >= cap) {
          throw new Error(
            `Credit guard: this run has already started ${live} live Marble generations (cap ${cap}). ` +
              'Set MARBLE_MAX_GENERATIONS to raise it, or run with MARBLE_MOCK=1.',
          );
        }
        live += 1;
      }
      const run = await generateWorld(ctx, plan);
      world = run.world;
      colliderBytes = run.colliderBytes;
      generated += 1;
    } else {
      // A cache hit whose files are not all there: re-download the missing ones rather than leave
      // the unit linking a 404 (the world is already paid for; this costs nothing).
      const missing = missingAssetFiles(paths, world);
      if (missing.length) await repairAssets(ctx, plan, world, missing);
    }

    let bounds = null;
    if (colliderBytes) {
      try {
        bounds = measureColliderBytes(colliderBytes);
      } catch (e) {
        io.log(`${plan.scanned.id}: the collider could not be read (${e instanceof Error ? e.message : String(e)})`);
      }
    } else if (world.bounds) {
      // A reused world already knows what its mesh measures; the fusion below is pure and cheap, so
      // the room is re-fused rather than the stored answer copied.
      bounds = world.bounds;
    }
    const measured = measure(ctx, plan, bounds, world);
    world = { ...world, bounds: measured.bounds ?? world.bounds, raw: measured.raw ?? world.raw };
    if (!plan.cached) writeCachedWorld(paths, world);
    io.progress(plan.scanned.id, `${plan.scanned.id}: ready · world ${world.worldId}`);

    const photos: LocalPhoto[] = plan.photos.map((p, i) => ({
      file: p.file,
      sha256: p.sha256,
      canonicalSha256: p.canonicalSha256,
      angle: p.angle,
      azimuth: i === 0 ? null : (azimuthForAngle(p.angle) ?? null),
      width: p.width,
      height: p.height,
    }));
    rooms.push({
      id: plan.scanned.id,
      name: plan.scanned.name,
      type: plan.type,
      order: rooms.length,
      photos,
      recipeHash: plan.hash,
      seed: plan.seed,
      prompt: plan.recipe.prompt,
      model: plan.recipe.model,
      world,
      planDims: plan.planDims,
      anchor,
      geometry: measured.geometry,
      // Same recipe, same world, same numbers → the first run's measurement, timestamp and all, so
      // the file does not change and the viewer does not re-import (docs/CLI.md).
      measurement: carryMeasuredAt(
        existing?.rooms?.find((r) => r.recipeHash === plan.hash && r.world?.worldId === world.worldId)?.measurement ?? undefined,
        measured.measurement,
      ),
    });
  }

  /* 7. the unit file, and the URL */
  // The id is deterministic, so a second run rewrites the same file. "Created" is when this unit
  // was first made, not when it was last confirmed, so the existing timestamp is kept.
  const unit: LocalUnit = {
    id,
    name: (options.name || '').trim() || path.basename(path.resolve(options.dir)),
    createdAt: existing?.createdAt || new Date(now()).toISOString(),
    address: (options.address || '').trim() || null,
    tier,
    rooms,
    plan: null,
  };
  const file = writeUnit(paths, unit);
  return { unit, url: tourUrl(port, id), file, generated, reused: plans.length - generated, provider: providerName, notes };
}
