/// <reference types="node" />
/**
 * The pipeline — docs/BACKEND.md §4, everything between "a seller has photos" and "a buyer opens a
 * share link". Intake (property, unit, rooms, photos), recipes (§2 and §3), the attach-or-enqueue
 * rule that makes "never generate twice" true, publication, and the public tour document.
 *
 * Conventions this module relies on:
 * - The database is reached through a structural `PipelineDb`, not the `Db` class: `server/db.ts`
 *   satisfies it, and the tests implement the same handful of methods over in-memory tables. Same
 *   for `PipelineStorage` and `server/storage.ts`.
 * - Storage paths are stored bucket-qualified (`photos/<org>/<unit>/<id>.jpg`,
 *   `worlds/<worldId>/spz-500k.spz`) because that is what `server/photos.ts` mints and what a
 *   `/storage/v1/object/...` URL takes; `splitStoragePath` is the one place that separates them
 *   again for a `Storage` call.
 * - Ids that must be stable are derived, never drawn: a photo's id is a uuid over
 *   (unit id, original hash), so re-uploading the same shot lands on the same row and the same
 *   object; a share id is derived from the unit id. Nothing here calls `Math.random()`.
 * - Time is an input. Every function that writes a timestamp takes `now` and defaults it at the
 *   edge, so a test pins the clock and nothing that feeds a recipe or a hash reads one at all.
 * - Failures a caller should turn into a status code are `PipelineError`; everything else is a
 *   `DbError` / `StorageError` from the layer below, which already carries a status.
 *
 * Compiles under tsconfig.node.json (bundler) and tsconfig.server.json (NodeNext): relative
 * imports inside server/ carry the `.js` extension.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { Filters, InsertOptions, SelectOptions } from './db.js';
import type { UploadResult } from './storage.js';
import { UnreadablePhotoError, azimuthForAngle, canonicalizePhoto, dataUrlToBytes, extensionForMime, photoStoragePaths, sniffImage } from './photos.js';
import type { PhotoExif } from './photos.js';
import {
  MARBLE_MAX_IMAGES,
  buildRecipe,
  recipeHash,
  seedFromHash,
  type Recipe,
  type RecipeContext,
  type RecipeAnchorInput,
  type RecipePhotoInput,
  type RecipeProvider,
  type RecipeTier,
} from './recipe.js';
import type { RoomType } from './prompt.js';
import {
  CEILING_HEIGHT_M,
  extentMethodOf,
  isOneRoom,
  measureColliderGlb,
  rawFromBounds,
  wallsOf,
  type DoorSpec,
  type RawRoomGeometry,
  type WindowSpec,
  type WorldBounds,
} from '../shared/collider.js';
import { exifScalePrior } from '../shared/exifPrior.js';
import { fuseScale, orientPlan, roomFromFusion, type RoomMeasurement, type ScaleConstraints } from '../shared/fusion.js';
import { modelForModelRoom, type ModelRoom } from '../shared/modelPolicy.js';

/* ---------- the two ports ---------- */

export type Row = Record<string, unknown>;

/** The part of `server/db.ts` the pipeline uses. `Db` satisfies it; so does the tests' fake. */
export interface PipelineDb {
  select<T = Row>(table: string, opts: SelectOptions & { single: true }): Promise<T | null>;
  select<T = Row>(table: string, opts?: SelectOptions): Promise<T[]>;
  insert<T = Row>(table: string, rows: Row | Row[], opts?: InsertOptions): Promise<T[]>;
  update<T = Row>(table: string, filters: Filters, patch: Row): Promise<T[]>;
  del<T = Row>(table: string, filters: Filters): Promise<T[]>;
  rpc<T = unknown>(fn: string, args?: Row): Promise<T>;
}

/** The part of `server/storage.ts` the pipeline and the worker use. */
export interface PipelineStorage {
  upload(bucket: string, path: string, bytes: Uint8Array | ArrayBuffer | string, contentType: string, opts?: { upsert?: boolean; cacheControl?: number }): Promise<UploadResult>;
  download(bucket: string, path: string): Promise<Buffer>;
  publicUrl(bucket: string, path: string): string;
}

/** A failure a route turns into a status code. Anything else already carries one (`DbError`). */
export class PipelineError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PipelineError';
    this.status = status;
  }
}

/* ---------- rows ---------- */

/** Columns are optional here because PostgREST returns what the migration defines, not what we ask for. */
export interface PropertyRow {
  id: string;
  org_id: string;
  name?: string;
  address: string;
  lat?: number | null;
  lon?: number | null;
  site?: SiteJson | null;
  external_ref?: string | null;
  created_at?: string;
}

export interface UnitRow {
  id: string;
  org_id: string;
  property_id: string;
  unit_type_id?: string | null;
  unit_number?: string | null;
  floor_level?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  rent_cents?: number | null;
  currency?: string | null;
  available_on?: string | null;
  listing_url?: string | null;
  listing_source?: string | null;
  summary?: string | null;
  external_ref?: string | null;
  status?: string;
  created_at?: string;
}

export interface RoomRow {
  id: string;
  org_id: string;
  unit_id: string;
  name: string;
  type: string;
  sort_order?: number;
  plan_dims?: PlanDimsJson | null;
  anchor?: AnchorJson | null;
  geometry?: Row | null;
  raw?: Row | null;
  /** How the geometry was arrived at: the fused scale, its residuals and its flags (0004). */
  measurement?: Row | null;
  measured_at?: string | null;
  floor_offset?: number | null;
  north_wall_heading?: number | null;
  status?: string;
  draft_world_id?: string | null;
  full_world_id?: string | null;
  created_at?: string;
}

export interface PhotoRow {
  id: string;
  org_id: string;
  unit_id: string;
  room_id?: string | null;
  storage_path: string;
  canonical_path?: string | null;
  sha256: string;
  canonical_sha256?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  role?: string;
  angle?: string | null;
  azimuth?: number | null;
  exif?: PhotoExif | null;
  analysis?: AnalysisJson | null;
  origin?: string;
  source_url?: string | null;
  created_at?: string;
}

export interface WorldRow {
  id: string;
  org_id: string;
  room_id: string;
  recipe_hash: string;
  recipe: Recipe;
  seed: number;
  pipeline_version: string;
  provider: string;
  model: string;
  tier: string;
  provider_world_id?: string | null;
  provider_operation_id?: string | null;
  status?: string;
  assets?: WorldAssets | null;
  provider_assets?: Row | null;
  metric_scale_factor?: number | null;
  ground_plane_offset?: number | null;
  bounds?: Row | null;
  raw?: Row | null;
  caption?: string | null;
  credits?: number | null;
  usd?: number | null;
  seconds?: number | null;
  error?: string | null;
  created_at?: string;
  finished_at?: string | null;
}

export interface JobRow {
  id: string;
  org_id: string;
  unit_id: string;
  room_id?: string | null;
  world_id?: string | null;
  kind: string;
  status: string;
  progress?: number;
  step?: string | null;
  detail?: string | null;
  error?: string | null;
  attempts?: number;
  run_after?: string;
  locked_by?: string | null;
  locked_at?: string | null;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface PublicationRow {
  id: string;
  org_id: string;
  unit_id: string;
  share_id: string;
  published: boolean;
  published_at?: string | null;
  model_date?: string | null;
  disclosures?: Row | null;
  created_at?: string;
}

export interface StagingRow {
  id: string;
  org_id: string;
  room_id: string;
  style?: string | null;
  preset?: string | null;
  pieces: unknown[];
  source?: string | null;
  input_hash?: string | null;
  created_at?: string;
}

/** Our own copies in the `worlds` bucket: bucket-qualified paths, never provider URLs. */
export interface WorldAssets {
  /** Keyed the way Marble keys its ladder (`100k`, `500k`, `full`), each a `worlds/<id>/...` path. */
  spz?: Record<string, string>;
  collider?: string;
  pano?: string;
  thumbnail?: string;
}

/** `properties.site` — a `TourSite` (src/state/types.ts). Only the fields the recipe reads are typed. */
export interface SiteJson {
  lat?: number;
  lon?: number;
  heading?: number;
  displayName?: string;
  [key: string]: unknown;
}

/** `rooms.plan_dims` — `PlanDimensions` plus the ceiling height when the drawing printed one. */
export interface PlanDimsJson {
  width?: number;
  depth?: number;
  height?: number;
  text?: string;
  [key: string]: unknown;
}

/** `rooms.anchor` — the numeric part of an `AnchorSpec` (src/engine/types.ts). */
export interface AnchorJson {
  method?: string;
  referenceMetres?: number;
  referenceUnits?: number;
  metresPerUnit?: number;
  uncertaintyM?: number;
  axis?: string;
  [key: string]: unknown;
}

/** `photos.analysis` — a `PhotoAnalysis` (src/state/types.ts). */
export interface AnalysisJson {
  roomType?: string;
  isEmpty?: boolean;
  notes?: string[];
  /** How the vision model described the photograph; mirrors `PhotoAnalysis` in src/state/types.ts. */
  caption?: string;
  /** `nebius` when a model wrote the caption, `heuristic` when the fallback did. */
  source?: string;
  [key: string]: unknown;
}

/* ---------- small pure helpers ---------- */

export const ROOM_TYPES: ReadonlySet<string> = new Set<RoomType>(['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'studio', 'other']);
export const PHOTO_ROLES: ReadonlySet<string> = new Set(['primary', 'extra']);
export const PHOTO_ANGLES: ReadonlySet<string> = new Set(['left', 'centre', 'right', 'back']);
export const PHOTO_ORIGINS: ReadonlySet<string> = new Set(['file', 'url', 'feed']);
export const EVENT_TYPES: ReadonlySet<string> = new Set(['visit', 'walk', 'test', 'fit', 'nofit', 'share', 'toggle', 'measure']);
export const TIERS: ReadonlySet<string> = new Set<RecipeTier>(['draft', 'full']);

/** The buckets a stored path can name. Anything else is a bug in whoever minted the path. */
const BUCKETS: ReadonlySet<string> = new Set(['photos', 'plans', 'worlds', 'stills']);

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A stored `<bucket>/<key>` path split for a `Storage` call. */
export function splitStoragePath(qualified: string): { bucket: string; key: string } {
  const slash = qualified.indexOf('/');
  const bucket = slash > 0 ? qualified.slice(0, slash) : '';
  const key = slash > 0 ? qualified.slice(slash + 1) : '';
  if (!BUCKETS.has(bucket) || !key) throw new PipelineError(500, `${JSON.stringify(qualified)} is not a <bucket>/<key> storage path`);
  return { bucket, key };
}

/** Where one of a world's own assets lives: `worlds/<worldId>/<name>`, public-read forever. */
export function worldAssetPath(worldId: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(worldId)) throw new PipelineError(500, `world id ${JSON.stringify(worldId)} is not a storage path segment`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new PipelineError(500, `asset name ${JSON.stringify(name)} is not a storage path segment`);
  return `worlds/${worldId}/${name}`;
}

/** The public URL of a stored `<bucket>/<key>` path. Pure; the `worlds` and `stills` buckets are public-read. */
export function publicAssetUrl(storage: PipelineStorage, qualified: string | undefined | null): string | undefined {
  if (!qualified) return undefined;
  const { bucket, key } = splitStoragePath(qualified);
  return storage.publicUrl(bucket, key);
}

const hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * A uuid built out of a hash rather than drawn at random, so the same input always names the same
 * row. Version and variant bits are set so Postgres accepts it as a uuid; it is not a real v4 and
 * does not pretend to be (v5 would need a namespace we have no use for).
 */
export function uuidFromHash(digest: string): string {
  const b = Buffer.from(digest.slice(0, 32), 'hex');
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * A photo's id: a uuid over (unit id, the ORIGINAL bytes' hash) — which is exactly the unique index
 * `photos_unit_sha`. Re-uploading the same shot therefore lands on the same row id and the same
 * storage objects instead of leaving an orphan copy behind.
 */
export function photoIdFor(unitId: string, sha256: string): string {
  return uuidFromHash(hex(`photo:${unitId}:${sha256}`));
}

/**
 * The share id in a `/t/:shareId` link: the first 40 bits of sha256(unit id) in base 36, eight
 * characters. Derived rather than drawn so re-publishing a unit never changes its link, and so a
 * link can be recomputed from the unit id alone when a publication row is lost.
 */
export function shareIdForUnit(unitId: string): string {
  return BigInt(`0x${hex(`share:${unitId}`).slice(0, 10)}`).toString(36).padStart(8, '0');
}

/**
 * The key two addresses are the same property under: lower case, every run of anything that is not
 * a letter or a digit collapsed to one space. "1247 Oak St." and "1247 oak st" are one property;
 * "1247 Oak St" and "1247 Oak Street" are two, because guessing at abbreviations would silently
 * merge two buildings.
 */
export function addressKey(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The room type a stored string names, or `other` — a room is never dropped over a bad label. */
export function roomTypeOf(type: unknown): RoomType {
  return typeof type === 'string' && ROOM_TYPES.has(type) ? (type as RoomType) : 'other';
}

const iso = (now: number) => new Date(now).toISOString();

/* ---------- 1. intake: property, unit, rooms ---------- */

export interface CreateRoomInput {
  name?: string;
  type?: string;
  order?: number;
  planDims?: PlanDimsJson | null;
  anchor?: AnchorJson | null;
  geometry?: Row | null;
  raw?: Row | null;
  northWallHeading?: number | null;
  floorOffset?: number | null;
}

export interface CreateUnitInput {
  address: string;
  /** The property's display name; the address when the caller has nothing better. */
  propertyName?: string;
  lat?: number | null;
  lon?: number | null;
  site?: SiteJson | null;
  unitNumber?: string | null;
  floorLevel?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  rentCents?: number | null;
  currency?: string | null;
  availableOn?: string | null;
  listingUrl?: string | null;
  listingSource?: string | null;
  summary?: string | null;
  externalRef?: string | null;
  rooms?: CreateRoomInput[];
}

export interface CreatedUnit {
  property: PropertyRow;
  unit: UnitRow;
  rooms: RoomRow[];
}

/** Every property of an organisation, for the address match. Small by nature: a leasing team's buildings. */
const PROPERTY_SCAN_LIMIT = 500;

/**
 * Create the unit, and the property it belongs to when the organisation has not got one at that
 * address yet (docs/BACKEND.md §6, `POST /api/v1/units`). The address match is done here rather
 * than with a PostgREST `ilike` so the comparison is `addressKey`'s — one rule, testable, and no
 * question of escaping a `%` a seller typed.
 */
export async function createUnit(db: PipelineDb, org: string, input: CreateUnitInput): Promise<CreatedUnit> {
  const address = String(input.address ?? '').trim().replace(/\s+/g, ' ');
  if (!address) throw new PipelineError(400, 'An address is required.');
  const key = addressKey(address);
  if (!key) throw new PipelineError(400, 'That address has nothing in it but punctuation.');

  const existing = await db.select<PropertyRow>('properties', { filters: { org_id: org }, limit: PROPERTY_SCAN_LIMIT });
  let property = existing.find((p) => addressKey(String(p.address ?? '')) === key);
  if (!property) {
    const rows = await db.insert<PropertyRow>('properties', {
      org_id: org,
      name: String(input.propertyName ?? address).trim() || address,
      address,
      lat: isFiniteNumber(input.lat) ? input.lat : null,
      lon: isFiniteNumber(input.lon) ? input.lon : null,
      site: input.site ?? null,
    });
    property = rows[0];
    if (!property) throw new PipelineError(502, 'The property could not be created.');
  } else if (input.site && !property.site) {
    // A site resolved after the property existed is worth keeping; one already stored is not overwritten.
    const [updated] = await db.update<PropertyRow>('properties', { id: property.id }, {
      site: input.site,
      ...(isFiniteNumber(input.lat) ? { lat: input.lat } : {}),
      ...(isFiniteNumber(input.lon) ? { lon: input.lon } : {}),
    });
    if (updated) property = updated;
  }

  const [unit] = await db.insert<UnitRow>('units', {
    org_id: org,
    property_id: property.id,
    unit_number: input.unitNumber ?? null,
    floor_level: isFiniteNumber(input.floorLevel) ? Math.trunc(input.floorLevel) : null,
    beds: isFiniteNumber(input.beds) ? input.beds : null,
    baths: isFiniteNumber(input.baths) ? input.baths : null,
    sqft: isFiniteNumber(input.sqft) ? Math.trunc(input.sqft) : null,
    rent_cents: isFiniteNumber(input.rentCents) ? Math.trunc(input.rentCents) : null,
    ...(input.currency ? { currency: input.currency } : {}),
    available_on: input.availableOn ?? null,
    listing_url: input.listingUrl ?? null,
    listing_source: input.listingSource ?? null,
    summary: input.summary ?? null,
    external_ref: input.externalRef ?? null,
  });
  if (!unit) throw new PipelineError(502, 'The unit could not be created.');

  const wanted = Array.isArray(input.rooms) ? input.rooms : [];
  const rooms = wanted.length
    ? await db.insert<RoomRow>(
        'rooms',
        wanted.map((r, i) => ({
          org_id: org,
          unit_id: unit.id,
          name: String(r.name ?? '').trim() || `Room ${i + 1}`,
          type: roomTypeOf(r.type),
          sort_order: isFiniteNumber(r.order) ? Math.trunc(r.order) : i,
          plan_dims: r.planDims ?? null,
          anchor: r.anchor ?? null,
          geometry: r.geometry ?? null,
          raw: r.raw ?? null,
          north_wall_heading: isFiniteNumber(r.northWallHeading) ? r.northWallHeading : null,
          floor_offset: isFiniteNumber(r.floorOffset) ? r.floorOffset : null,
        })),
      )
    : [];

  return { property, unit, rooms };
}

/* ---------- the two lookups every scoped read and write goes through ---------- */

/**
 * The unit, inside the caller's organisation, or 404. A unit id in a path is the caller's claim,
 * not a fact: without the `org_id` predicate a member of any other organisation can write rows into
 * someone else's unit, and the row lands with the attacker's `org_id` and storage folder on it.
 * Every route that touches a unit — read or write — resolves it through here first.
 */
export async function unitInOrg(db: PipelineDb, org: string, unitId: string): Promise<UnitRow> {
  const unit = await db.select<UnitRow>('units', { filters: { id: unitId, org_id: org }, single: true });
  if (!unit) throw new PipelineError(404, 'No such unit.');
  return unit;
}

/**
 * The worlds a set of rooms shows, by BOTH routes a room can reach one: `worlds.room_id` (the world
 * this room's own generation made) and `rooms.draft_world_id` / `full_world_id` (the world the room
 * was pointed at). The second is not redundant — docs/BACKEND.md §4.8, "unit types share worlds
 * across identical units", means an attached world's `room_id` can belong to a different room of the
 * same organisation. Reading by `room_id` alone loses exactly the shared ones, which is how a room
 * ends up marked `ready` with nothing in it.
 *
 * `filters` is the caller's own scope (`org_id`, `status`) and is applied to both queries, so this
 * never widens what the caller is allowed to see.
 */
export async function worldsOfRooms(db: PipelineDb, rooms: Pick<RoomRow, 'id' | 'draft_world_id' | 'full_world_id'>[], filters: Filters = {}): Promise<WorldRow[]> {
  const byId = new Map<string, WorldRow>();
  const roomIds = rooms.map((r) => r.id);
  if (roomIds.length) {
    for (const w of await db.select<WorldRow>('worlds', { filters: { ...filters, room_id: { op: 'in', value: roomIds } } })) byId.set(w.id, w);
  }
  const pointed = [...new Set(rooms.flatMap((r) => [r.draft_world_id, r.full_world_id]).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const missing = pointed.filter((id) => !byId.has(id));
  if (missing.length) {
    for (const w of await db.select<WorldRow>('worlds', { filters: { ...filters, id: { op: 'in', value: missing } } })) byId.set(w.id, w);
  }
  // Sorted by id so a document never depends on the order two queries came back in.
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* ---------- 2. intake: photos ---------- */

export interface AddPhotoInput {
  roomId?: string | null;
  role?: string;
  angle?: string | null;
  /** A base64 image data URL (what the browser has today), or raw bytes plus their media type. */
  dataUrl?: string;
  bytes?: Uint8Array;
  mime?: string;
  fileName?: string | null;
  origin?: string;
  sourceUrl?: string | null;
}

export interface AddedPhoto {
  photo: PhotoRow;
  /** True when this unit already had these bytes: the existing row comes back and nothing is written. */
  duplicate: boolean;
}

/**
 * One photo into the unit: canonicalise, store both copies, record the row
 * (docs/BACKEND.md §2 rule 1). The unique index is on (unit_id, the ORIGINAL hash), so a second
 * upload of the same file returns the row that is already there rather than a second world's worth
 * of input; two different files of the same shot still converge later, because it is the CANONICAL
 * hash that goes into the recipe.
 */
export async function addPhoto(db: PipelineDb, storage: PipelineStorage, org: string, unitId: string, input: AddPhotoInput): Promise<AddedPhoto> {
  // Before anything is decoded or stored: the unit has to be one of the caller's own.
  await unitInOrg(db, org, unitId);
  let bytes: Uint8Array;
  let mime: string;
  if (typeof input.dataUrl === 'string' && input.dataUrl) {
    try {
      const parsed = dataUrlToBytes(input.dataUrl);
      bytes = parsed.bytes;
      mime = parsed.mime;
    } catch (e) {
      throw new PipelineError(400, e instanceof Error ? e.message : 'That is not a base64 image data URL.');
    }
  } else if (input.bytes && input.bytes.byteLength) {
    bytes = input.bytes;
    mime = String(input.mime || 'application/octet-stream').toLowerCase();
  } else {
    throw new PipelineError(400, 'No image bytes: send `dataUrl` or `bytes`.');
  }

  const role = input.role != null && PHOTO_ROLES.has(String(input.role)) ? String(input.role) : 'extra';
  const angle = input.angle != null && PHOTO_ANGLES.has(String(input.angle)) ? String(input.angle) : null;
  const origin = input.origin != null && PHOTO_ORIGINS.has(String(input.origin)) ? String(input.origin) : 'file';

  let canonical: Awaited<ReturnType<typeof canonicalizePhoto>>;
  try {
    canonical = await canonicalizePhoto(bytes, mime);
  } catch (e) {
    // The upload was not a decodable image: the client's problem, not a 500. `server/photos.ts`
    // throws this for a truncated file too, which is exactly the case a retry can fix.
    if (e instanceof UnreadablePhotoError) throw new PipelineError(415, e.message);
    throw e;
  }
  // Scoped by org as well as by unit: `photos_unit_sha` is (unit_id, sha256) alone, so an unscoped
  // lookup would hand the caller back a row that belongs to another organisation.
  const existing = await db.select<PhotoRow>('photos', { filters: { org_id: org, unit_id: unitId, sha256: canonical.sha256Original }, single: true });
  if (existing) return { photo: existing, duplicate: true };

  const id = photoIdFor(unitId, canonical.sha256Original);
  // The extension and the content type of the ORIGINAL come from the bytes, never from the media
  // type the client declared: a WebP posted as `data:image/jpeg` must not be stored as `.jpg`.
  const originalMime = sniffImage(bytes)?.mime ?? mime;
  const paths = photoStoragePaths(org, unitId, id, extensionForMime(canonical.method === 'sharp' ? originalMime : canonical.contentType));
  const original = splitStoragePath(paths.original);
  const canonicalPath = splitStoragePath(paths.canonical);
  // Upsert: a retry after a failed insert must not trip over the object it already wrote.
  await storage.upload(original.bucket, original.key, bytes, originalMime, { upsert: true });
  await storage.upload(canonicalPath.bucket, canonicalPath.key, canonical.canonical, canonical.contentType, { upsert: true });

  const row: Row = {
    id,
    org_id: org,
    unit_id: unitId,
    room_id: input.roomId ?? null,
    storage_path: paths.original,
    canonical_path: paths.canonical,
    sha256: canonical.sha256Original,
    canonical_sha256: canonical.sha256Canonical,
    width: canonical.width || null,
    height: canonical.height || null,
    bytes: bytes.byteLength,
    role,
    angle,
    azimuth: azimuthForAngle(angle) ?? null,
    exif: canonical.exif,
    origin,
    source_url: input.sourceUrl ?? null,
  };
  try {
    const [photo] = await db.insert<PhotoRow>('photos', row);
    if (!photo) throw new PipelineError(502, 'The photo row could not be created.');
    return { photo, duplicate: false };
  } catch (e) {
    // Two uploads of one file at once: the loser reads the winner's row instead of failing.
    const conflict = await db.select<PhotoRow>('photos', { filters: { org_id: org, unit_id: unitId, sha256: canonical.sha256Original }, single: true });
    if (conflict) return { photo: conflict, duplicate: true };
    throw e;
  }
}

/* ---------- 3. the recipes ---------- */

export interface PlanContext {
  /** `PIPELINE_VERSION`; bumping it invalidates every recipe on purpose. */
  pipelineVersion: string;
  provider: RecipeProvider;
  /**
   * The tier's own model id (`marble-1.0-draft`, `marble-1.1`, or the mock's). It is the *base*: a
   * room the plan draws over 30 m² or calls open plan is routed to full quality's larger sibling by
   * `modelForRoomRow`, so one unit can plan several models.
   */
  model: string;
  /** Prompt facts per room id, merged over what the stored rows already say. */
  context?: Record<string, RecipeContext>;
}

export interface PlannedRecipe {
  tier: RecipeTier;
  recipe: Recipe;
  hash: string;
  seed: number;
}

export interface PlannedRoom extends PlannedRecipe {
  room: RoomRow;
  /** The photos the recipe hashed, in recipe order. */
  photos: PhotoRow[];
}

export interface SkippedRoom {
  roomId: string;
  name: string;
  reason: string;
}

export interface PlanResult {
  unit: UnitRow;
  property: PropertyRow | null;
  planned: PlannedRoom[];
  skipped: SkippedRoom[];
}

/** Primary first, then oldest first; the id breaks a tie so the order never depends on the query plan. */
export function orderPhotos(photos: PhotoRow[]): PhotoRow[] {
  return [...photos].sort((a, b) => {
    const ra = a.role === 'primary' ? 0 : 1;
    const rb = b.role === 'primary' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    const ta = String(a.created_at ?? '');
    const tb = String(b.created_at ?? '');
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The anchor a room can be generated with, or null when it has none: the anchor is required
 * (docs/BACKEND.md §1). `buildRecipe` is what finally judges the method name, so an unknown one
 * surfaces as a skipped room with its reason rather than as a silent default.
 */
function anchorOf(room: RoomRow): RecipeAnchorInput | null {
  const a = room.anchor;
  if (!a || typeof a !== 'object') return null;
  if (typeof a.method !== 'string') return null;
  if (!isFiniteNumber(a.referenceMetres) || !isFiniteNumber(a.referenceUnits) || !isFiniteNumber(a.metresPerUnit) || !isFiniteNumber(a.uncertaintyM)) return null;
  const axis = a.axis === 'width' || a.axis === 'depth' ? a.axis : undefined;
  return {
    method: a.method as RecipeAnchorInput['method'],
    referenceMetres: a.referenceMetres,
    referenceUnits: a.referenceUnits,
    metresPerUnit: a.metresPerUnit,
    uncertaintyM: a.uncertaintyM,
    ...(axis ? { axis } : {}),
  };
}

function planDimsOf(room: RoomRow): { width: number; depth: number } | null {
  const p = room.plan_dims;
  if (!p || !isFiniteNumber(p.width) || !isFiniteNumber(p.depth) || p.width <= 0 || p.depth <= 0) return null;
  return { width: p.width, depth: p.depth };
}

/** The ceiling height the DRAWING printed. Never the one derived from the anchor: that would move under the hash. */
function ceilingOf(room: RoomRow): number | null {
  const h = room.plan_dims?.height;
  return isFiniteNumber(h) && h > 0 ? h : null;
}

/**
 * The prompt facts the stored rows already know: whether the room was photographed empty, the
 * notes the vision model left, the floor the unit is on, which way the windows face and the hour
 * the primary shot was taken. Everything else is left out rather than guessed (docs/BACKEND.md §3).
 */
export function defaultRoomContext(room: RoomRow, unit: UnitRow, property: PropertyRow | null, photos: PhotoRow[]): RecipeContext {
  const primary = photos[0];
  const facts: RecipeContext = {};
  const analysis = primary?.analysis;
  if (analysis && typeof analysis.isEmpty === 'boolean') facts.empty = analysis.isEmpty;
  // Only the vision model's caption is a description of the photograph; the heuristic fallback's is
  // a placeholder ("An empty room."), and the browser's `roomPromptFacts` draws the same line.
  if (analysis && analysis.source === 'nebius' && typeof analysis.caption === 'string' && analysis.caption.trim()) {
    facts.photoCaption = analysis.caption.trim();
  }
  if (analysis && Array.isArray(analysis.notes)) {
    const notes = analysis.notes.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    if (notes.length) facts.notes = notes;
  }
  if (isFiniteNumber(unit.floor_level)) facts.floorLevel = unit.floor_level;
  const heading = isFiniteNumber(room.north_wall_heading) ? room.north_wall_heading : property?.site?.heading;
  if (isFiniteNumber(heading)) facts.windowFacing = heading;
  const captured = primary?.exif?.capturedAt;
  if (typeof captured === 'string') {
    const hour = Number(captured.slice(11, 13));
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) facts.captureHour = hour;
  }
  return facts;
}

/** What a recipe needs that the room's own rows do not carry: the version, the provider and the tier. */
export interface RoomRecipeContext {
  /** `PIPELINE_VERSION`; bumping it invalidates every recipe on purpose. */
  pipelineVersion: string;
  provider: RecipeProvider;
  model: string;
  tier: RecipeTier;
  /** Prompt facts merged over what the stored rows already say (`defaultRoomContext`). */
  context?: RecipeContext;
}

/**
 * One room's canonical recipe, from the stored rows (docs/BACKEND.md §2). Throws when the room
 * cannot be generated — no photo, no anchor, an anchor `buildRecipe` refuses — because a recipe
 * that quietly defaulted a missing input would hash to something no seller asked for.
 *
 * This is the single place a room's inputs become a recipe: `planRecipes` calls it for the rooms of
 * a unit, and `roomRecipeState` calls it again after an edit to ask whether the world a room is
 * pointed at is still the world its inputs would make. Two copies of this mapping would be two
 * different answers to "did the recipe change".
 */
export function roomRecipe(room: RoomRow, unit: UnitRow, property: PropertyRow | null, photos: PhotoRow[], ctx: RoomRecipeContext): Recipe {
  if (!photos.length) throw new PipelineError(400, 'no photo');
  const anchor = anchorOf(room);
  if (!anchor) throw new PipelineError(400, 'no scale anchor');
  const recipePhotos: RecipePhotoInput[] = photos.map((p, i) => ({
    // The recipe hashes the CANONICAL copy: two uploads of one shot from two phones are one world.
    sha256: String(p.canonical_sha256 || p.sha256),
    role: i === 0 ? 'primary' : 'extra',
    angle: (p.angle ?? null) as RecipePhotoInput['angle'],
    azimuth: isFiniteNumber(p.azimuth) ? p.azimuth : null,
  }));
  const site = property && isFiniteNumber(property.lat) && isFiniteNumber(property.lon) ? { lat: property.lat, lon: property.lon } : null;
  const heading = isFiniteNumber(room.north_wall_heading) ? room.north_wall_heading : property?.site?.heading;
  return buildRecipe({
    pipelineVersion: ctx.pipelineVersion,
    provider: ctx.provider,
    model: ctx.model,
    tier: ctx.tier,
    photos: recipePhotos,
    roomType: roomTypeOf(room.type),
    anchor,
    planDims: planDimsOf(room),
    ceilingHeight: ceilingOf(room),
    site: site && isFiniteNumber(heading) ? { lat: site.lat, lon: site.lon, heading } : null,
    context: { ...defaultRoomContext(room, unit, property, photos), ...(ctx.context ?? {}) },
  });
}

/** A stored room, as the model rule sees it (`shared/modelPolicy.ts`). */
function modelRoomOfRow(room: RoomRow): ModelRoom {
  const plan = planDimsOf(room);
  const planRoomName = typeof room.plan_dims?.planRoomName === 'string' ? room.plan_dims.planRoomName : undefined;
  return { name: room.name, type: roomTypeOf(room.type), planRoomName, planWidthM: plan?.width, planDepthM: plan?.depth };
}

/**
 * The model id THIS room's recipe names: the tier's own model, or full quality's larger sibling for
 * a room the plan draws over 30 m² or calls open plan.
 *
 * It is the same function the wizard's launch step calls (`modelForModelRoom`), not a second reading
 * of the same rule, because the model is hashed into the recipe: a browser-started room and a
 * backend-started room that disagreed here would generate twice and attach neither. `ctx.model` is
 * the tier's base id, which is what `PlanContext` carries. The mock provider is left alone — its two
 * ids are the only ones it has, and a `-plus` sibling of them does not exist.
 */
export function modelForRoomRow(room: RoomRow, tier: RecipeTier, ctx: { provider: RecipeProvider; model: string }): string {
  if (ctx.provider !== 'marble') return ctx.model;
  const models = tier === 'full' ? { marbleFull: ctx.model } : { marbleDraft: ctx.model };
  return modelForModelRoom(modelRoomOfRow(room), tier, models).model;
}

/**
 * Build a recipe for every room of the unit that has a photo (docs/BACKEND.md §4 step 3). Rooms
 * that cannot be generated yet come back in `skipped` with the reason, because "nothing happened"
 * is the one answer a seller must never get without one.
 *
 * Each room chooses its own model (`modelForRoomRow`), so a 35 m² living room and a 12 m² bedroom in
 * the same unit go to different Marble models and carry different recipe hashes — which is the point
 * of the tier policy, and the reason the model id is in the recipe at all.
 */
export async function planRecipes(db: PipelineDb, org: string, unitId: string, tier: RecipeTier, ctx: PlanContext): Promise<PlanResult> {
  if (!TIERS.has(tier)) throw new PipelineError(400, `tier must be draft or full, got ${JSON.stringify(tier)}`);
  const unit = await unitInOrg(db, org, unitId);
  const property = await db.select<PropertyRow>('properties', { filters: { id: unit.property_id, org_id: org }, single: true });
  const rooms = await db.select<RoomRow>('rooms', { filters: { unit_id: unitId, org_id: org }, order: { column: 'sort_order', ascending: true } });
  const photos = await db.select<PhotoRow>('photos', { filters: { unit_id: unitId, org_id: org } });

  const byRoom = new Map<string, PhotoRow[]>();
  for (const p of photos) {
    if (!p.room_id) continue;
    const list = byRoom.get(p.room_id);
    if (list) list.push(p);
    else byRoom.set(p.room_id, [p]);
  }

  const planned: PlannedRoom[] = [];
  const skipped: SkippedRoom[] = [];
  for (const room of rooms) {
    const roomPhotos = orderPhotos(byRoom.get(room.id) ?? []).slice(0, MARBLE_MAX_IMAGES);
    if (!roomPhotos.length) {
      skipped.push({ roomId: room.id, name: room.name, reason: 'no photo' });
      continue;
    }
    const anchor = anchorOf(room);
    if (!anchor) {
      skipped.push({ roomId: room.id, name: room.name, reason: 'no scale anchor' });
      continue;
    }
    let recipe: Recipe;
    try {
      recipe = roomRecipe(room, unit, property, roomPhotos, {
        pipelineVersion: ctx.pipelineVersion,
        provider: ctx.provider,
        model: modelForRoomRow(room, tier, ctx),
        tier,
        context: ctx.context?.[room.id],
      });
    } catch (e) {
      skipped.push({ roomId: room.id, name: room.name, reason: e instanceof Error ? e.message : 'the recipe could not be built' });
      continue;
    }
    const hash = recipeHash(recipe);
    planned.push({ room, photos: roomPhotos, tier, recipe, hash, seed: seedFromHash(hash) });
  }
  return { unit, property, planned, skipped };
}

/* ---------- 4. attach or enqueue ---------- */

export interface AttachResult {
  attached: boolean;
  worldId: string;
  jobId?: string;
  /** The world's status at the moment it was attached or created. */
  status: string;
}

const isUniqueViolation = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  const status = (e as { status?: unknown } | null)?.status;
  return code === '23505' || status === 409;
};

/**
 * Rule 5, "never generate twice": a recipe whose hash already has a world (any status but failed)
 * attaches that world to the room and stops. Otherwise a `queued` world and its `generate` job are
 * created together, and the room starts generating.
 *
 * `worlds_recipe` is unique on (org_id, recipe_hash) among non-failed worlds, so two callers of one
 * organisation racing on one recipe end with one world: the loser's insert is a unique violation and
 * it re-reads the winner's row. Everything here is scoped to that organisation — a world carries an
 * org_id, a room and storage objects that organisation owns, so another tenant's world with the same
 * hash is not a cache hit, it is someone else's property.
 */
export async function attachOrEnqueue(
  db: PipelineDb,
  org: string,
  unit: { id: string },
  room: { id: string },
  planned: PlannedRecipe,
  now: number = Date.now(),
): Promise<AttachResult> {
  // Scoped to the caller's organisation: an unscoped lookup attaches another tenant's world — their
  // room, their org_id, their assets — to this room, which is both a leak and a pointer the readers
  // cannot resolve. Within the organisation the lookup is deliberately NOT scoped to this unit, so
  // identical units share a world (docs/BACKEND.md §4.8).
  const found = await db.select<WorldRow>('worlds', {
    filters: { org_id: org, recipe_hash: planned.hash, status: { op: 'neq', value: 'failed' } },
    order: { column: 'created_at', ascending: true },
    limit: 1,
  });
  const hit = found[0];
  if (hit) {
    await pointRoomAtWorld(db, room.id, planned.tier, hit.id, hit.status === 'done' ? 'ready' : 'generating');
    return { attached: true, worldId: hit.id, status: String(hit.status ?? 'queued') };
  }

  let world: WorldRow | undefined;
  try {
    [world] = await db.insert<WorldRow>('worlds', {
      org_id: org,
      room_id: room.id,
      recipe_hash: planned.hash,
      recipe: planned.recipe as unknown as Row,
      seed: planned.seed,
      pipeline_version: planned.recipe.pipelineVersion,
      provider: planned.recipe.provider,
      model: planned.recipe.model,
      tier: planned.tier,
      status: 'queued',
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const [raced] = await db.select<WorldRow>('worlds', { filters: { org_id: org, recipe_hash: planned.hash, status: { op: 'neq', value: 'failed' } }, limit: 1 });
    // A hash held by another organisation's world is a unique violation this organisation cannot
    // resolve by attaching: the recipe collides across tenants but the world is not ours to use.
    if (!raced) throw e;
    await pointRoomAtWorld(db, room.id, planned.tier, raced.id, raced.status === 'done' ? 'ready' : 'generating');
    return { attached: true, worldId: raced.id, status: String(raced.status ?? 'queued') };
  }
  if (!world) throw new PipelineError(502, 'The world row could not be created.');

  const [job] = await db.insert<JobRow>('jobs', {
    org_id: org,
    unit_id: unit.id,
    room_id: room.id,
    world_id: world.id,
    kind: 'generate',
    status: 'queued',
    progress: 0,
    step: 'Queued',
    run_after: iso(now),
  });
  await pointRoomAtWorld(db, room.id, planned.tier, world.id, 'generating');
  return { attached: false, worldId: world.id, jobId: job?.id, status: 'queued' };
}

/** Point a room's draft or full slot at a world and set its status. Idempotent. */
export async function pointRoomAtWorld(db: PipelineDb, roomId: string, tier: RecipeTier, worldId: string, status: 'generating' | 'ready'): Promise<void> {
  await db.update('rooms', { id: roomId }, { [tier === 'full' ? 'full_world_id' : 'draft_world_id']: worldId, status });
}

export interface GenerateSummary {
  tier: RecipeTier;
  attached: number;
  enqueued: number;
  rooms: { roomId: string; name: string; worldId: string; jobId?: string; attached: boolean }[];
  skipped: SkippedRoom[];
}

/** `POST /api/v1/units/:id/generate`: plan every room, attach what exists, enqueue the rest. */
export async function generateUnit(db: PipelineDb, org: string, unitId: string, tier: RecipeTier, ctx: PlanContext, now: number = Date.now()): Promise<GenerateSummary> {
  const plan = await planRecipes(db, org, unitId, tier, ctx);
  const rooms: GenerateSummary['rooms'] = [];
  let attached = 0;
  let enqueued = 0;
  for (const p of plan.planned) {
    const r = await attachOrEnqueue(db, org, plan.unit, p.room, p, now);
    if (r.attached) attached += 1;
    else enqueued += 1;
    rooms.push({ roomId: p.room.id, name: p.room.name, worldId: r.worldId, jobId: r.jobId, attached: r.attached });
  }
  if (enqueued) await db.update('units', { id: unitId, org_id: org }, { status: 'generating' });
  return { tier, attached, enqueued, rooms, skipped: plan.skipped };
}

/* ---------- 5. the floor plan ---------- */

export interface AddFloorPlanInput {
  dataUrl?: string;
  bytes?: Uint8Array;
  mime?: string;
  fileName?: string | null;
  parsed?: Row | null;
}

export interface AddedFloorPlan {
  plan: Row;
  jobId?: string;
}

/**
 * Store the drawing and enqueue the read (`parse_plan`). The plan is not canonicalised the way a
 * photo is — it is a document, and its own hash is what makes the parse cacheable.
 */
export async function addFloorPlan(db: PipelineDb, storage: PipelineStorage, org: string, unitId: string, input: AddFloorPlanInput, now: number = Date.now()): Promise<AddedFloorPlan> {
  // Before anything is decoded or stored: the unit has to be one of the caller's own.
  await unitInOrg(db, org, unitId);
  let bytes: Uint8Array;
  let mime: string;
  if (typeof input.dataUrl === 'string' && input.dataUrl) {
    try {
      const parsed = dataUrlToBytes(input.dataUrl);
      bytes = parsed.bytes;
      mime = parsed.mime;
    } catch (e) {
      throw new PipelineError(400, e instanceof Error ? e.message : 'That is not a base64 image data URL.');
    }
  } else if (input.bytes && input.bytes.byteLength) {
    bytes = input.bytes;
    mime = String(input.mime || 'application/octet-stream').toLowerCase();
  } else {
    throw new PipelineError(400, 'No plan bytes: send `dataUrl` or `bytes`.');
  }
  const sha = createHash('sha256').update(bytes).digest('hex');
  const id = uuidFromHash(hex(`plan:${unitId}:${sha}`));
  // The id is derived from (unit, bytes), so re-posting the same drawing is the same row. Reading it
  // back rather than inserting over it is what makes the route idempotent: a seller whose parse
  // failed re-uploads the plan, and must get their plan back, not `floor_plans_pkey`.
  const already = await db.select<Row>('floor_plans', { filters: { id, org_id: org, unit_id: unitId }, single: true });
  if (already) return { plan: already };
  const key = `${org}/${unitId}/${id}.${extensionForMime(sniffImage(bytes)?.mime ?? mime)}`;
  await storage.upload('plans', key, bytes, mime, { upsert: true });
  let plan: Row | undefined;
  try {
    [plan] = await db.insert<Row>('floor_plans', {
      id,
      org_id: org,
      unit_id: unitId,
      storage_path: `plans/${key}`,
      sha256: sha,
      file_name: input.fileName ?? null,
      parsed: input.parsed ?? null,
    });
  } catch (e) {
    // Two uploads of one drawing at once: the loser reads the winner's row instead of failing.
    if (!isUniqueViolation(e)) throw e;
    const raced = await db.select<Row>('floor_plans', { filters: { id, org_id: org, unit_id: unitId }, single: true });
    if (!raced) throw e;
    return { plan: raced };
  }
  // The parse is only enqueued when there is something left to parse. A caller that already read
  // the drawing (the wizard's own floor-plan step does, in the browser) posts `parsed` and gets no
  // job, because a `parse_plan` job has no worker in this build and a job that will never run must
  // not sit in a seller's queue looking like progress. When the handler lands, drop this condition.
  if (input.parsed != null) return { plan: plan ?? { id } };
  const [job] = await db.insert<JobRow>('jobs', {
    org_id: org,
    unit_id: unitId,
    kind: 'parse_plan',
    status: 'queued',
    progress: 0,
    step: 'Queued',
    run_after: iso(now),
  });
  return { plan: plan ?? { id }, jobId: job?.id };
}

/* ---------- 6. the unit document ---------- */

export interface UnitDocument {
  unit: UnitRow;
  property: PropertyRow | null;
  rooms: RoomRow[];
  photos: PhotoRow[];
  worlds: WorldRow[];
  jobs: JobRow[];
  publication: PublicationRow | null;
}

/** `GET /api/v1/units/:id` — everything the seller's screens need, inside the caller's organisation. */
export async function unitDocument(db: PipelineDb, org: string, unitId: string): Promise<UnitDocument> {
  const unit = await unitInOrg(db, org, unitId);
  const property = await db.select<PropertyRow>('properties', { filters: { id: unit.property_id, org_id: org }, single: true });
  const rooms = await db.select<RoomRow>('rooms', { filters: { unit_id: unitId, org_id: org }, order: { column: 'sort_order', ascending: true } });
  const photos = await db.select<PhotoRow>('photos', { filters: { unit_id: unitId, org_id: org } });
  const worlds = await worldsOfRooms(db, rooms, { org_id: org });
  const jobs = await db.select<JobRow>('jobs', { filters: { unit_id: unitId, org_id: org }, order: { column: 'created_at', ascending: false } });
  const publication = await db.select<PublicationRow>('publications', { filters: { unit_id: unitId, org_id: org }, single: true });
  return { unit, property, rooms, photos: orderPhotos(photos), worlds, jobs, publication };
}

/** `GET /api/v1/units/:id/jobs` — Realtime carries the live updates; this is the list on load. */
export async function unitJobs(db: PipelineDb, org: string, unitId: string): Promise<JobRow[]> {
  await unitInOrg(db, org, unitId);
  return db.select<JobRow>('jobs', { filters: { unit_id: unitId, org_id: org }, order: { column: 'created_at', ascending: false } });
}

/* ---------- 7. publish ---------- */

export interface PublishOptions {
  disclosures?: Row | null;
  now?: number;
}

/**
 * Publish or unpublish (docs/BACKEND.md §4 step 7). The share id is derived from the unit id, so a
 * link is stable across republishing; `model_date` is the newest finished world, which is the
 * freshness badge the buyer sees.
 */
export async function publishUnit(db: PipelineDb, org: string, unitId: string, published: boolean, opts: PublishOptions = {}): Promise<PublicationRow> {
  const now = opts.now ?? Date.now();
  await unitInOrg(db, org, unitId);
  const rooms = await db.select<RoomRow>('rooms', { filters: { unit_id: unitId, org_id: org }, columns: 'id,draft_world_id,full_world_id' });
  // Through the room pointers as well as `room_id`, so an attached (shared) world still dates the
  // publication; ordering here rather than in the query, because this is two queries merged.
  const finished = await worldsOfRooms(db, rooms, { org_id: org, status: 'done' });
  const modelDate = finished.reduce<string | null>((newest, w) => {
    const at = typeof w.finished_at === 'string' ? w.finished_at : null;
    return at && (!newest || at > newest) ? at : newest;
  }, null);

  const existing = await db.select<PublicationRow>('publications', { filters: { unit_id: unitId, org_id: org }, single: true });
  const patch: Row = {
    published,
    model_date: modelDate,
    ...(published ? { published_at: existing?.published_at ?? iso(now) } : {}),
    ...(opts.disclosures !== undefined ? { disclosures: opts.disclosures } : {}),
  };
  const row = existing
    ? (await db.update<PublicationRow>('publications', { id: existing.id }, patch))[0]
    : (await db.insert<PublicationRow>('publications', { org_id: org, unit_id: unitId, share_id: shareIdForUnit(unitId), ...patch }))[0];
  if (!row) throw new PipelineError(502, 'The publication could not be written.');
  await db.update('units', { id: unitId, org_id: org }, { status: published ? 'published' : 'ready' });
  return row;
}

/* ---------- 8. the public tour ---------- */

/** Which of our own splat copies the viewer should open on; it climbs the rest itself. */
const SPZ_PREFERENCE = ['500k', '150k', '100k', 'full', 'full_res'];

export interface PublicWorld {
  worldId: string;
  provider: string;
  tier: string;
  model: string;
  createdAt: number;
  spzUrl?: string;
  spzUrls?: Record<string, string>;
  colliderUrl?: string;
  panoUrl?: string;
  thumbnailUrl?: string;
  caption?: string;
  metricScaleFactor?: number | null;
  groundPlaneOffset?: number | null;
  bounds?: Row | null;
  raw?: Row | null;
  seconds?: number | null;
}

export interface PublicRoom {
  id: string;
  name: string;
  type: string;
  order: number;
  planDims?: PlanDimsJson | null;
  anchor?: AnchorJson | null;
  geometry?: Row | null;
  raw?: Row | null;
  /**
   * How this room's numbers were arrived at (docs/ACCURACY.md §1: "every published room shows its
   * own numbers"). Null on a room measured before the accuracy pass, or one whose world has no
   * collider — the page then has the anchor and nothing to say beyond it.
   */
  measurement?: Row | null;
  measuredAt?: string | null;
  floorOffset?: number | null;
  northWallHeading?: number | null;
  status: string;
  draft: PublicWorld | null;
  full: PublicWorld | null;
  staging: unknown[];
  stagingStyle?: string | null;
}

export interface PublicTour {
  shareId: string;
  publishedAt?: string | null;
  modelDate?: string | null;
  disclosures?: Row | null;
  unit: {
    id: string;
    address: string;
    propertyName?: string;
    unitNumber?: string | null;
    floorLevel?: number | null;
    beds?: number | null;
    baths?: number | null;
    sqft?: number | null;
    rentCents?: number | null;
    currency?: string | null;
    availableOn?: string | null;
    summary?: string | null;
    listingUrl?: string | null;
  };
  site: SiteJson | null;
  rooms: PublicRoom[];
}

/**
 * A room's measurement as the buyer's page sees it: every number, and none of our recipe.
 *
 * `recipeHash` and `stale` answer "would this room generate a new world", which is a question the
 * seller's hub asks and a buyer has no business seeing — the hash is derived from the prompt, the
 * photo set and the tier, so publishing it publishes a fingerprint of our inputs. The rest of the
 * object is exactly what docs/ACCURACY.md §1 says every published room must show.
 */
function publicMeasurement(measurement: Row | null | undefined): Row | null {
  if (!measurement || typeof measurement !== 'object') return null;
  const { recipeHash: _hash, stale: _stale, ...rest } = measurement as Row & { recipeHash?: unknown; stale?: unknown };
  return rest;
}

/** One world as the buyer's page sees it: our own asset URLs, nothing of the provider's. */
function publicWorld(world: WorldRow, storage: PipelineStorage): PublicWorld | null {
  if (world.status !== 'done') return null;
  const assets = world.assets ?? {};
  const spzUrls: Record<string, string> = {};
  for (const [key, path] of Object.entries(assets.spz ?? {})) {
    const url = publicAssetUrl(storage, path);
    if (url) spzUrls[key] = url;
  }
  const spzUrl = SPZ_PREFERENCE.map((k) => spzUrls[k]).find(Boolean) ?? Object.values(spzUrls)[0];
  return {
    // Our own row id, never `provider_world_id`: the public document carries no provider reference.
    worldId: world.id,
    provider: String(world.provider ?? 'marble'),
    tier: String(world.tier ?? 'draft'),
    model: String(world.model ?? ''),
    createdAt: Date.parse(String(world.finished_at ?? world.created_at ?? '')) || 0,
    ...(spzUrl ? { spzUrl } : {}),
    ...(Object.keys(spzUrls).length ? { spzUrls } : {}),
    ...(publicAssetUrl(storage, assets.collider) ? { colliderUrl: publicAssetUrl(storage, assets.collider) } : {}),
    ...(publicAssetUrl(storage, assets.pano) ? { panoUrl: publicAssetUrl(storage, assets.pano) } : {}),
    ...(publicAssetUrl(storage, assets.thumbnail) ? { thumbnailUrl: publicAssetUrl(storage, assets.thumbnail) } : {}),
    ...(world.caption ? { caption: world.caption } : {}),
    metricScaleFactor: world.metric_scale_factor ?? null,
    groundPlaneOffset: world.ground_plane_offset ?? null,
    bounds: world.bounds ?? null,
    raw: world.raw ?? null,
    seconds: world.seconds ?? null,
  };
}

/**
 * `GET /api/v1/public/:shareId` — the buyer's whole document, and nothing else: no photos, no
 * provider ids, no provider URLs, no recipe, no cost. Every asset is ours, in the public `worlds`
 * bucket, so a share link keeps working after the provider's signed URLs expire.
 */
export async function publicTour(db: PipelineDb, storage: PipelineStorage, shareId: string): Promise<PublicTour> {
  const publication = await db.select<PublicationRow>('publications', { filters: { share_id: shareId }, single: true });
  if (!publication || !publication.published) throw new PipelineError(404, 'No such tour.');
  const unit = await db.select<UnitRow>('units', { filters: { id: publication.unit_id }, single: true });
  if (!unit) throw new PipelineError(404, 'No such tour.');
  const property = await db.select<PropertyRow>('properties', { filters: { id: unit.property_id }, single: true });
  const rooms = await db.select<RoomRow>('rooms', { filters: { unit_id: unit.id }, order: { column: 'sort_order', ascending: true } });
  const roomIds = rooms.map((r) => r.id);
  // Scoped to the unit's own organisation as well as to `done`: a room pointer is data, and a tour
  // must never serve a world some other tenant owns even if one were ever written.
  const worlds = await worldsOfRooms(db, rooms, { org_id: unit.org_id, status: 'done' });
  const stagings = roomIds.length
    ? await db.select<StagingRow>('stagings', { filters: { room_id: { op: 'in', value: roomIds } }, order: { column: 'created_at', ascending: false } })
    : [];
  const worldById = new Map(worlds.map((w) => [w.id, w]));
  const stagingByRoom = new Map<string, StagingRow>();
  for (const s of stagings) if (!stagingByRoom.has(s.room_id)) stagingByRoom.set(s.room_id, s);

  const site: SiteJson | null =
    property && (property.site || isFiniteNumber(property.lat))
      ? {
          ...(property.site ?? {}),
          ...(isFiniteNumber(property.lat) ? { lat: property.lat } : {}),
          ...(isFiniteNumber(property.lon) ? { lon: property.lon } : {}),
        }
      : null;

  return {
    shareId: publication.share_id,
    publishedAt: publication.published_at ?? null,
    modelDate: publication.model_date ?? null,
    disclosures: publication.disclosures ?? null,
    unit: {
      id: unit.id,
      address: String(property?.address ?? ''),
      ...(property?.name ? { propertyName: property.name } : {}),
      unitNumber: unit.unit_number ?? null,
      floorLevel: unit.floor_level ?? null,
      beds: unit.beds ?? null,
      baths: unit.baths ?? null,
      sqft: unit.sqft ?? null,
      rentCents: unit.rent_cents ?? null,
      currency: unit.currency ?? null,
      availableOn: unit.available_on ?? null,
      summary: unit.summary ?? null,
      listingUrl: unit.listing_url ?? null,
    },
    site,
    rooms: rooms.map((room, i) => {
      const draft = room.draft_world_id ? worldById.get(room.draft_world_id) : undefined;
      const full = room.full_world_id ? worldById.get(room.full_world_id) : undefined;
      const staging = stagingByRoom.get(room.id);
      return {
        id: room.id,
        name: room.name,
        type: room.type,
        order: isFiniteNumber(room.sort_order) ? room.sort_order : i,
        planDims: room.plan_dims ?? null,
        anchor: room.anchor ?? null,
        geometry: room.geometry ?? null,
        raw: room.raw ?? null,
        measurement: publicMeasurement(room.measurement),
        measuredAt: room.measured_at ?? null,
        floorOffset: room.floor_offset ?? null,
        northWallHeading: room.north_wall_heading ?? null,
        status: String(room.status ?? 'pending'),
        draft: draft ? publicWorld(draft, storage) : null,
        full: full ? publicWorld(full, storage) : null,
        staging: Array.isArray(staging?.pieces) ? staging.pieces : [],
        stagingStyle: staging?.style ?? null,
      };
    }),
  };
}

/* ---------- 9. analytics and the renter's furniture ---------- */

export interface EventInput {
  type: string;
  roomId?: string | null;
  item?: string | null;
  visitorId?: string | null;
  at?: string | null;
}

/** `POST /api/v1/public/:shareId/events` — only for a published share, and only the eight known types. */
export async function recordEvent(db: PipelineDb, shareId: string, event: EventInput): Promise<{ ok: true }> {
  const type = String(event?.type ?? '');
  if (!EVENT_TYPES.has(type)) throw new PipelineError(400, `Unknown event type ${JSON.stringify(type)}.`);
  const publication = await db.select<PublicationRow>('publications', { filters: { share_id: shareId }, single: true });
  if (!publication || !publication.published) throw new PipelineError(404, 'No such tour.');
  await db.insert('analytics_events', {
    unit_id: publication.unit_id,
    room_id: event.roomId ?? null,
    type,
    item: event.item ?? null,
    visitor_id: event.visitorId ?? null,
    ...(event.at ? { at: event.at } : {}),
  });
  return { ok: true };
}

/** A renter's saved furniture: `MyStuffItem`s, kept per visitor id and reached only through the server. */
export interface StuffItem {
  id?: string;
  [key: string]: unknown;
}

export async function getStuff(db: PipelineDb, visitorId: string): Promise<StuffItem[]> {
  if (!visitorId) throw new PipelineError(400, 'A visitor id is required.');
  const rows = await db.select<{ item: StuffItem }>('visitor_stuff', { filters: { visitor_id: visitorId }, order: { column: 'created_at', ascending: true } });
  return rows.map((r) => r.item).filter((i): i is StuffItem => Boolean(i && typeof i === 'object'));
}

/**
 * Replace the visitor's list (`items`), or add / replace one piece in it (`item`). The list is the
 * renter's own copy of My Stuff, so the client owning it whole is the simplest thing that is right.
 */
export async function putStuff(db: PipelineDb, visitorId: string, input: { items?: unknown; item?: unknown }): Promise<StuffItem[]> {
  if (!visitorId) throw new PipelineError(400, 'A visitor id is required.');
  let next: StuffItem[];
  if (Array.isArray(input.items)) {
    next = input.items.filter((i): i is StuffItem => Boolean(i && typeof i === 'object'));
  } else if (input.item && typeof input.item === 'object') {
    const piece = input.item as StuffItem;
    const current = await getStuff(db, visitorId);
    const at = current.findIndex((i) => i.id != null && i.id === piece.id);
    next = at >= 0 ? current.map((i, k) => (k === at ? piece : i)) : [...current, piece];
  } else {
    throw new PipelineError(400, 'Send `items` (the whole list) or `item` (one piece).');
  }
  if (next.length > 200) throw new PipelineError(400, 'That is more furniture than one visitor can save.');
  // Insert first, then drop exactly the rows that were there before. There is no transaction over
  // PostgREST, so the order is the guarantee: a read in between sees the old list and the new one
  // rather than an empty one, and a failure between them leaves the renter's list intact.
  const before = await db.select<{ id: string }>('visitor_stuff', { filters: { visitor_id: visitorId }, columns: 'id' });
  if (next.length) await db.insert('visitor_stuff', next.map((item) => ({ visitor_id: visitorId, item })));
  if (before.length) await db.del('visitor_stuff', { id: { op: 'in', value: before.map((r) => r.id) } });
  return next;
}

/* ---------- 10. measurement (docs/ACCURACY.md §3.2) ---------- */

/**
 * `rooms.geometry` — the metric room, in metres: `RoomGeometry` in src/engine/types.ts, which is
 * what the viewer, the fit report and the measuring tool all read.
 */
export interface RoomGeometryJson {
  width: number;
  depth: number;
  height: number;
  door: DoorSpec;
  windows: WindowSpec[];
}

/**
 * `rooms.measurement` — how this room's numbers were arrived at.
 *
 * **Defined in `shared/fusion.ts` and re-exported here**, because the same object is written to
 * `rooms.measurement`, served by the public tour and read by the browser's `Room.measurement`. One
 * definition is what keeps those three from drifting; see the shape's own doc for what it holds.
 */
export type { RoomMeasurement } from '../shared/fusion.js';

export interface MeasureRoomInput {
  /** What `measureColliderGlb` read off the world's collider. */
  bounds: WorldBounds;
  planDims?: PlanDimsJson | null;
  anchor?: AnchorJson | null;
  /** `worlds.metric_scale_factor`: the provider's own estimate, full tier only. */
  metricScaleFactor?: number | null;
  /**
   * The room's **primary** photo — the shot the reconstruction is of — for the field-of-view prior
   * (`shared/exifPrior.ts`). A `PhotoRow` satisfies it; `orderPhotos(...)[0]` is the one to pass.
   * Absent, or carrying no lens the prior can read, it contributes nothing.
   */
  photo?: Pick<PhotoRow, 'exif' | 'width' | 'height'> | null;
  worldId?: string;
  now: number;
}

export interface RoomMeasurementResult {
  /** The bounds to store: the same measurement, with `method` set to the rectangle actually used. */
  bounds: WorldBounds;
  /** Raw units: what the collider says, before any scale. */
  raw: RawRoomGeometry;
  /** Metres. */
  geometry: RoomGeometryJson;
  measurement: RoomMeasurement;
}

/** Anchors that ARE the assumed ceiling: adding a ceiling constraint beside them counts it twice. */
const CEILING_ANCHORS: ReadonlySet<string> = new Set(['ceiling', 'assumed']);

/**
 * Every constraint on the scale the stored rows support (docs/ACCURACY.md §2). Absent sources
 * contribute nothing; `shared/fusion.ts` weights the rest by their own uncertainty.
 *
 * The ceiling is the one judgement call. A height printed on the drawing is a measurement (±3 cm).
 * With none printed, the standard 2.44 m ±12 cm is still a real prior — but only when the anchor is
 * not itself a ceiling anchor, because then the two would be the same assertion entered twice and
 * the fit would report a confidence it has not earned.
 *
 * The EXIF field of view is the last constraint and the weakest. It is computed from `bounds` — the
 * rectangle the fit was given (`measureRoom`'s own: the room's own walls whenever the mesh found
 * them), never from `input.bounds`, which on a re-measurement is the record the `aabb` fallback
 * already wrote. Reading the stored record instead moved the wall the capture faces to the far side
 * of the bounding box, took its framing outside the gate, and withheld the prior on the second
 * measurement of a room that had it on the first. It is closed on the same ceiling height that fed
 * `c.ceiling`, printed or standard, rather than a second opinion about it.
 */
function scaleConstraintsFor(raw: RawRoomGeometry, input: MeasureRoomInput, bounds: WorldBounds): { constraints: ScaleConstraints; planSwapped: boolean } {
  const { planDims, anchor, metricScaleFactor } = input;
  const c: ScaleConstraints = { raw: { width: raw.width, depth: raw.depth, height: raw.height } };
  let planSwapped = false;
  if (planDims && (isFiniteNumber(planDims.width) || isFiniteNumber(planDims.depth))) {
    const w = isFiniteNumber(planDims.width) && planDims.width > 0 ? planDims.width : null;
    const d = isFiniteNumber(planDims.depth) && planDims.depth > 0 ? planDims.depth : null;
    // With both printed, orient them onto the fitted rectangle's axes before pairing: the wall fit's
    // rotation is only defined modulo 90°, so past 45° it names the room's depth "width" and pairing
    // as drawn would flag both dimensions against a room that is perfectly correct. `orientPlan` is
    // the shared rule (shared/fusion.ts); with only one dimension printed there is nothing to swap.
    const oriented = w != null && d != null ? orientPlan(raw, { width: w, depth: d }) : null;
    // Read the answer off `orientPlan`, never off comparing the two numbers afterwards: on a square
    // room the exchanged pair is identical to the drawn one, so a value comparison silently loses a
    // swap on exactly the rooms where the aspect-ratio rule is least sure of itself.
    planSwapped = oriented?.swapped ?? false;
    c.plan = oriented
      ? { width: oriented.width, depth: oriented.depth }
      : { ...(w != null ? { width: w } : {}), ...(d != null ? { depth: d } : {}) };
  }
  if (anchor && isFiniteNumber(anchor.metresPerUnit) && anchor.metresPerUnit > 0) {
    c.anchor = {
      metresPerUnit: anchor.metresPerUnit,
      ...(isFiniteNumber(anchor.uncertaintyM) ? { uncertaintyM: anchor.uncertaintyM } : {}),
      ...(isFiniteNumber(anchor.referenceMetres) ? { referenceMetres: anchor.referenceMetres } : {}),
    };
  }
  const printed = planDims?.height;
  if (isFiniteNumber(printed) && printed > 0) c.ceiling = { heightM: printed, printed: true };
  else if (!(typeof anchor?.method === 'string' && CEILING_ANCHORS.has(anchor.method))) c.ceiling = { heightM: CEILING_HEIGHT_M, printed: false };
  if (isFiniteNumber(metricScaleFactor) && metricScaleFactor > 0) c.marble = { metricScaleFactor };
  const exif = exifScalePrior({
    exif: input.photo?.exif,
    width: input.photo?.width,
    height: input.photo?.height,
    bounds,
    ceilingM: c.ceiling?.heightM ?? CEILING_HEIGHT_M,
  });
  /* `group: 'ceiling'` whenever there IS a ceiling constraint, because the prior is closed on that
     very height (see the paragraph above): the two are one metric assumption read against two
     different raw quantities, and fusion must weight them as one source rather than two. Without a
     ceiling constraint — a ceiling anchor supplied it instead — the prior stands on the standard
     height on its own and keeps its own group. */
  if (exif) c.exif = { metresPerUnit: exif.metresPerUnit, sigmaRel: exif.sigmaRel, ...(c.ceiling ? { group: 'ceiling' as const } : {}) };
  return { constraints: c, planSwapped };
}

const round3 = (x: number): number => {
  const r = Math.round(x * 1000) / 1000;
  return r === 0 ? 0 : r;
};

/** The raw room in metres. Mirrors `applyScale` in src/engine/anchor.ts, to the same 3 decimals. */
function scaleGeometry(raw: RawRoomGeometry, scale: number, dims: { width: number; depth: number; height: number }): RoomGeometryJson {
  return {
    width: dims.width,
    depth: dims.depth,
    height: dims.height,
    door: { wall: raw.door.wall, offset: round3(raw.door.offset * scale), width: round3(raw.door.width * scale), height: round3(raw.door.height * scale) },
    windows: raw.windows.map((w) => ({
      wall: w.wall,
      offset: round3(w.offset * scale),
      width: round3(w.width * scale),
      height: round3(w.height * scale),
      sill: round3(w.sill * scale),
    })),
  };
}

/**
 * The room a measured collider reports, in metres — docs/ACCURACY.md §3.2, and the one arithmetic
 * the worker and the room editor share.
 *
 * Two passes, for the one case the wall rectangle gets wrong. Marble's collider includes whatever
 * the model reconstructed through an open door, so a "room" can come back as the whole flat; when
 * the metric result is not a room at all (`isOneRoom`) the wall rectangle is set aside — recorded
 * as `method: 'aabb'`, which is what tells every reader, here and in the viewer, to place and size
 * the capture from the bounding box instead. **The scale is kept from the first pass**: the sources
 * (a plan, a tapped door, a printed ceiling) describe the room, so the room's own walls are the
 * best evidence for what a raw unit is worth even when they are not the extent to draw. The second
 * pass only changes which rectangle the extent comes from, and the "plan says / model measures"
 * lines then state the gap in metres instead of hiding it.
 *
 * **Measuring twice gives the same answer.** The fit always starts from the room's own walls when
 * the mesh found any, whatever `method` the bounds handed in carry — because the bounds handed in
 * are, on every measurement after the first, the record pass two wrote and `writeMeasurement`
 * stored. Taking the stored `method` as the fit's rectangle meant a re-fusion measured a different
 * room from the one the world was measured with: on a real local run a no-op `PATCH` (the same plan
 * dimensions the room already had) moved the published scale by 48 % and dropped the EXIF residual,
 * because the wall rectangle it had been fitted with was no longer being read. So `method` is
 * pass two's answer about the *extent*, and never an input to pass one.
 *
 * Pure: no clock (the caller passes `now`), no I/O, no randomness.
 */
export function measureRoom(input: MeasureRoomInput): RoomMeasurementResult {
  // The rectangle the scale is fitted from: the walls, whenever the mesh has them.
  const walls = Boolean(wallsOf(input.bounds));
  const fitBounds: WorldBounds = walls ? { ...input.bounds, method: 'walls' } : input.bounds;
  let bounds = fitBounds;
  let raw = rawFromBounds(bounds);
  // Whether the plan had to be read the other way round is a property of the fit that was used, so
  // it is read off the constraints the fit was given rather than recomputed against a later pass.
  const fitted = scaleConstraintsFor(raw, input, fitBounds);
  const planSwapped = fitted.planSwapped;
  const fusion = fuseScale(fitted.constraints);
  let room = roomFromFusion(raw, fusion);
  if (!isOneRoom(room) && walls) {
    bounds = { ...input.bounds, method: 'aabb' };
    raw = rawFromBounds(bounds);
    room = roomFromFusion(raw, fusion);
  }
  const oneRoom = isOneRoom(room);
  const flags = oneRoom
    ? fusion.flags
    : [
        ...fusion.flags,
        `The collider measures ${room.width.toFixed(2)} × ${room.depth.toFixed(2)} m by ${room.height.toFixed(2)} m high, which is not one room: the model reconstructed through an open door or window, so these dimensions are the whole of what it built.`,
      ];
  return {
    bounds,
    raw,
    geometry: scaleGeometry(raw, fusion.scale, room),
    measurement: {
      scale: fusion.scale,
      sigma: fusion.sigma,
      sigmaRel: fusion.sigmaRel,
      // A mesh that is not one room may still have a tight, well-corroborated scale — and the room
      // it describes is still the wrong room, so nothing about it may be published as confident.
      confidence: oneRoom ? fusion.confidence : 0,
      independentSources: fusion.independentSources,
      residuals: fusion.residuals,
      flags,
      lines: room.lines,
      method: extentMethodOf(bounds) ?? 'aabb',
      oneRoom,
      ...(planSwapped ? { planSwapped: true } : {}),
      ...(input.worldId ? { worldId: input.worldId } : {}),
      measuredAt: iso(input.now),
    },
  };
}

/**
 * Measure a collider's bytes. `Buffer` is a view on a pooled ArrayBuffer, so the window has to be
 * cut out before it is handed to a reader that trusts byte 0 to be the `glTF` magic.
 */
export function measureColliderBytes(bytes: Uint8Array): WorldBounds {
  return measureColliderGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/**
 * Write a measurement where the two readers look for it: the world carries what its own mesh says
 * (`bounds`, `raw`), the room carries what the unit shows (`geometry` in metres, `raw`,
 * `measurement`, `measured_at`).
 */
export async function writeMeasurement(db: PipelineDb, worldId: string | null | undefined, roomId: string | null | undefined, result: RoomMeasurementResult): Promise<void> {
  if (worldId) {
    await db.update('worlds', { id: worldId }, { bounds: result.bounds as unknown as Row, raw: result.raw as unknown as Row });
  }
  if (roomId) {
    await db.update('rooms', { id: roomId }, {
      geometry: result.geometry as unknown as Row,
      raw: result.raw as unknown as Row,
      measurement: result.measurement as unknown as Row,
      measured_at: result.measurement.measuredAt,
    });
  }
}

/**
 * The world a room's measurement should come from: the full-quality one when it has finished, else
 * the draft — the same preference the buyer's viewer applies, so the numbers on the page belong to
 * the capture on the page. `bounds` is required, because a world generated before the measurement
 * existed (or whose measurement failed) has nothing to re-fuse from.
 */
export async function measuredWorldOf(db: PipelineDb, org: string, room: Pick<RoomRow, 'id' | 'draft_world_id' | 'full_world_id'>): Promise<WorldRow | null> {
  for (const id of [room.full_world_id, room.draft_world_id]) {
    if (!id) continue;
    const world = await db.select<WorldRow>('worlds', { filters: { id, org_id: org }, single: true });
    if (world && world.status === 'done' && world.bounds) return world;
  }
  // A regeneration in flight moves the room's pointer to a world that has not been built yet, and
  // the seller correcting a dimension while it runs must not lose the numbers they already have:
  // the newest finished world of this room still measures it.
  const own = await db.select<WorldRow>('worlds', { filters: { room_id: room.id, org_id: org, status: 'done' }, order: { column: 'created_at', ascending: false } });
  return own.find((w) => w.bounds) ?? null;
}

/* ---------- the room edits that change a measurement ---------- */

/** Only what a seller can correct after the fact; everything else about a room is derived. */
export interface UpdateRoomInput {
  name?: string;
  type?: string;
  sortOrder?: number;
  planDims?: PlanDimsJson | null;
  anchor?: AnchorJson | null;
  northWallHeading?: number | null;
}

/** Whether the world a room is pointed at is still the world the room's inputs would generate. */
export interface RoomRecipeState {
  /** The hash the room's inputs make now, absent when they no longer make a recipe at all. */
  hash?: string;
  worldId: string;
  worldRecipeHash: string;
  stale: boolean;
  /** Why the recipe cannot be built, when it cannot ("no photo", "no scale anchor"). */
  reason?: string;
}

export interface UpdatedRoom {
  room: RoomRow;
  /** The columns this call actually changed. */
  changed: string[];
  measurement: RoomMeasurement | null;
  recipe: RoomRecipeState | null;
}

/**
 * The recipe state of a room against one world: rebuild the recipe from the room's rows with the
 * world's OWN generator settings (its pipeline version, provider, model and tier, all on the row),
 * so the only thing that can differ is the room's inputs. Anything else would compare two recipes
 * that were never meant to match.
 *
 * This is what "the recipe is stale" means, and it is why nothing has to be marked: the next
 * `generate` recomputes the same hash, and rule 5 (`worlds_recipe`) then either attaches the world
 * that is already there or makes a new one. A stale flag is a message to the seller, not a lock.
 */
export async function roomRecipeState(db: PipelineDb, org: string, unit: UnitRow, room: RoomRow, world: WorldRow): Promise<RoomRecipeState> {
  const property = await db.select<PropertyRow>('properties', { filters: { id: unit.property_id, org_id: org }, single: true });
  const photos = orderPhotos(await db.select<PhotoRow>('photos', { filters: { room_id: room.id, org_id: org } })).slice(0, MARBLE_MAX_IMAGES);
  const worldRecipeHash = String(world.recipe_hash ?? '');
  try {
    const recipe = roomRecipe(room, unit, property, photos, {
      pipelineVersion: String(world.pipeline_version ?? '1'),
      provider: (world.provider === 'mock' ? 'mock' : 'marble') as RecipeProvider,
      model: String(world.model ?? ''),
      tier: (world.tier === 'full' ? 'full' : 'draft') as RecipeTier,
    });
    const hash = recipeHash(recipe);
    return { hash, worldId: world.id, worldRecipeHash, stale: hash !== worldRecipeHash };
  } catch (e) {
    // The room can no longer be generated at all (its anchor was cleared, its photos are gone).
    // That is as stale as it gets: the world in hand is certainly not what these inputs would make.
    return { worldId: world.id, worldRecipeHash, stale: true, reason: e instanceof Error ? e.message : 'the recipe could not be built' };
  }
}

/**
 * `PATCH /api/v1/units/:id/rooms/:roomId` — the corrections a seller makes after the plan was read
 * and the world was built: a dimension off the drawing, a re-tapped anchor, a renamed room.
 *
 * Two things follow, and only two. **Fusion is re-run immediately** when the room has a measured
 * world, because it is arithmetic over numbers already in hand — no provider, no credits, no queue —
 * so a corrected plan dimension changes what the room reports in the same request that corrected
 * it. And the **recipe is compared, not invalidated**: nothing is deleted or regenerated here, the
 * answer just says whether the next `generate` would build a new world (docs/BACKEND.md §2 rule 5).
 */
export async function updateRoom(db: PipelineDb, org: string, unitId: string, roomId: string, input: UpdateRoomInput, now: number = Date.now()): Promise<UpdatedRoom> {
  const unit = await unitInOrg(db, org, unitId);
  const room = await db.select<RoomRow>('rooms', { filters: { id: roomId, unit_id: unitId, org_id: org }, single: true });
  if (!room) throw new PipelineError(404, 'No such room.');

  const patch: Row = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new PipelineError(400, 'A room needs a name.');
    if (name !== room.name) patch.name = name;
  }
  if (input.type !== undefined) {
    const type = roomTypeOf(input.type);
    if (type !== room.type) patch.type = type;
  }
  if (input.sortOrder !== undefined) {
    if (!isFiniteNumber(input.sortOrder)) throw new PipelineError(400, 'sortOrder must be a number.');
    const order = Math.trunc(input.sortOrder);
    if (order !== room.sort_order) patch.sort_order = order;
  }
  if (input.planDims !== undefined) {
    const dims = normalisePlanDims(input.planDims);
    if (JSON.stringify(dims) !== JSON.stringify(room.plan_dims ?? null)) patch.plan_dims = dims;
  }
  if (input.anchor !== undefined) {
    const anchor = input.anchor === null ? null : normaliseAnchorJson(input.anchor);
    if (JSON.stringify(anchor) !== JSON.stringify(room.anchor ?? null)) patch.anchor = anchor;
  }
  if (input.northWallHeading !== undefined) {
    const heading = input.northWallHeading === null ? null : normaliseHeading(input.northWallHeading);
    if (heading !== (room.north_wall_heading ?? null)) patch.north_wall_heading = heading;
  }

  const changed = Object.keys(patch);
  const updated = changed.length ? (await db.update<RoomRow>('rooms', { id: room.id }, patch))[0] ?? { ...room, ...patch } : room;

  // Re-fuse from the bounds the world already carries. Measuring is a download and a mesh walk;
  // fusion is a weighted mean over six numbers, which is why an edit can afford to do it inline.
  const world = await measuredWorldOf(db, org, updated);
  if (!world || !world.bounds) return { room: updated, changed, measurement: null, recipe: null };
  const recipe = await roomRecipeState(db, org, unit, updated, world);
  /* The room's primary photo, for the field-of-view prior. Without it a plan correction would
     silently re-measure the room with one fewer constraint than the world was measured with, so the
     residual line the seller was shown would disappear on the request that was meant to improve it. */
  const primaryPhoto = orderPhotos(await db.select<PhotoRow>('photos', { filters: { room_id: updated.id, org_id: org } }))[0] ?? null;
  const result = measureRoom({
    bounds: world.bounds as unknown as WorldBounds,
    planDims: updated.plan_dims,
    anchor: updated.anchor,
    metricScaleFactor: world.metric_scale_factor,
    photo: primaryPhoto,
    worldId: world.id,
    now,
  });
  result.measurement.recipeHash = recipe.worldRecipeHash;
  result.measurement.stale = recipe.stale;
  await writeMeasurement(db, world.id, updated.id, result);
  // The row as it now stands, so a caller that renders the answer and a caller that re-reads the
  // room see the same numbers.
  const room2: RoomRow = {
    ...updated,
    geometry: result.geometry as unknown as Row,
    raw: result.raw as unknown as Row,
    measurement: result.measurement as unknown as Row,
    measured_at: result.measurement.measuredAt,
  };
  return { room: room2, changed, measurement: result.measurement, recipe };
}

/** Plan dimensions as the recipe rounds them: metres to the centimetre, or null. */
function normalisePlanDims(input: PlanDimsJson | null): PlanDimsJson | null {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new PipelineError(400, 'planDims must be an object with width, depth and an optional height in metres.');
  const out: PlanDimsJson = {};
  for (const key of ['width', 'depth', 'height'] as const) {
    const v = input[key];
    if (v === undefined || v === null) continue;
    if (!isFiniteNumber(v) || v <= 0 || v > 100) throw new PipelineError(400, `planDims.${key} must be a positive number of metres.`);
    // The plan is ±5 cm, so sub-centimetre noise must not make a new recipe (server/recipe.ts).
    out[key] = Math.round(v * 100) / 100;
  }
  if (typeof input.text === 'string' && input.text.trim()) out.text = input.text.trim();
  return Object.keys(out).length ? out : null;
}

/** The numeric part of an `AnchorSpec`, plus whatever copy the caller sent with it. */
function normaliseAnchorJson(input: AnchorJson): AnchorJson {
  if (typeof input !== 'object' || Array.isArray(input)) throw new PipelineError(400, 'anchor must be an object.');
  if (typeof input.method !== 'string') throw new PipelineError(400, 'anchor.method is required.');
  for (const key of ['referenceMetres', 'referenceUnits', 'metresPerUnit', 'uncertaintyM'] as const) {
    if (!isFiniteNumber(input[key])) throw new PipelineError(400, `anchor.${key} must be a finite number.`);
  }
  if ((input.metresPerUnit as number) <= 0) throw new PipelineError(400, 'anchor.metresPerUnit must be positive.');
  return input;
}

function normaliseHeading(value: number): number {
  if (!isFiniteNumber(value)) throw new PipelineError(400, 'northWallHeading must be a number of degrees.');
  return ((value % 360) + 360) % 360;
}
