/// <reference types="node" />
/**
 * The canonical recipe — docs/BACKEND.md section 2.
 *
 * A room's generation request is one JSON document: pipeline version, provider and model id, tier,
 * the ordered canonical photo hashes with their azimuths, the compiled text prompt,
 * `reconstruct_images`, `is_pano`, the anchor, the plan dimensions, the room type, the ceiling
 * height and the site. `recipe_hash = sha256(canonicalJson(recipe))`, Marble's seed is the first
 * 32 bits of that hash, and `worlds.recipe_hash` is unique among non-failed worlds — which is the
 * rule that actually makes a tour repeatable: the same inputs never generate twice.
 *
 * Conventions:
 * - Pure. Nothing here reads a clock, the environment or a random source; the pipeline version
 *   and the model ids are inputs.
 * - `canonicalJson` is the one serialisation that is ever hashed: keys sorted by UTF-16 code unit,
 *   numbers rounded to 5 decimals and printed by `String()`, no `-0`, no `NaN`, no `undefined`
 *   (object keys holding `undefined` are dropped, exactly as JSON.stringify does).
 * - `buildRecipe` returns the recipe already in canonical form (parsed back from `canonicalJson`),
 *   so the object stored in `worlds.recipe` is byte-for-byte the document that was hashed.
 * - Site lat/lon are rounded to 5 decimals (about a metre) and the heading to a whole degree; plan
 *   dimensions and the ceiling height to the centimetre — the plan is ±5 cm, so sub-centimetre
 *   noise must not make a new world.
 * - No imports from src/. The types and the four azimuth numbers that mirror the app are copied
 *   here with a pointer to their source; relative imports use the .js extension (NodeNext).
 */
import { createHash } from 'node:crypto';
import { compileMarblePrompt, type PromptFacts, type RoomType } from './prompt.js';

export type RecipeTier = 'draft' | 'full';
export type RecipeProvider = 'marble' | 'mock';
export type PhotoRole = 'primary' | 'extra';
/** Mirrors `PhotoAngle` in src/state/types.ts. */
export type PhotoAngle = 'left' | 'centre' | 'right' | 'back';
/** Mirrors `AnchorMethod` in src/engine/types.ts. */
export type AnchorMethod = 'door' | 'outlet' | 'wall' | 'floorplan' | 'ceiling' | 'marble' | 'assumed';

/**
 * Copied from `AZIMUTH_FOR_ANGLE` in src/services/marble.ts: degrees round the capture point with
 * the primary shot at 0, matching the Front / Left / Right the Marble UI offers. Keep the two in
 * step — a different number here would silently change every multi-image recipe hash.
 */
export const AZIMUTH_FOR_ANGLE: Record<PhotoAngle, number> = { centre: 0, right: 90, back: 180, left: 270 };

/**
 * Marble takes 4 images in a multi-image prompt, or 8 in reconstruction mode. These are the
 * provider's numbers and this is the one place they are written down: server/marbleRequest.ts (the
 * browser flow's mapping of the same call) imports them from here and re-exports them.
 */
export const MARBLE_PLAIN_IMAGES = 4;
export const MARBLE_MAX_IMAGES = 8;
/** Marble's seed is a uint32. */
export const SEED_MAX = 4294967295;
/** `tags: ['audora', 'recipe:<first 12 hex of the hash>']` — enough to find a world by its recipe in Marble's own UI. */
export const RECIPE_TAG_PREFIX = 'recipe:';
export const RECIPE_TAG_HASH_CHARS = 12;

/* ---------- the recipe ---------- */

export interface RecipePhoto {
  /** sha256 (hex, lowercase) of the canonical copy of the photo. */
  sha256: string;
  /** Degrees round the capture point, primary shot at 0. Absent when the angle was not labelled. */
  azimuth?: number;
  role: PhotoRole;
}

/** The numeric and semantic part of an `AnchorSpec` (src/engine/types.ts): the label, taps and detail are copy, not input. */
export interface RecipeAnchor {
  method: AnchorMethod;
  referenceMetres: number;
  referenceUnits: number;
  metresPerUnit: number;
  uncertaintyM: number;
  axis?: 'width' | 'depth';
}

export interface RecipePlanDims {
  /** Metres, to the centimetre. */
  width: number;
  depth: number;
}

export interface RecipeSite {
  /** 5 decimals. */
  lat: number;
  lon: number;
  /** Whole degrees in [0, 360). */
  heading: number;
}

export interface Recipe {
  pipelineVersion: string;
  provider: RecipeProvider;
  model: string;
  tier: RecipeTier;
  /** Primary first, then the extra angles in the order the seller added them. */
  photos: RecipePhoto[];
  /** The compiled text prompt, verbatim what Marble receives (`disable_recaption`). */
  prompt: string;
  /** More than `MARBLE_PLAIN_IMAGES` images: Marble's reconstruction mode. */
  reconstructImages: boolean;
  /** The primary photo is an equirectangular panorama. */
  isPano: boolean;
  anchor: RecipeAnchor;
  planDims?: RecipePlanDims;
  site?: RecipeSite;
  roomType: RoomType;
  /** Metres, to the centimetre. */
  ceilingHeight?: number;
}

/* ---------- inputs ---------- */

export interface RecipePhotoInput {
  sha256: string;
  /** Defaults to `primary` for the first photo and `extra` for the rest. */
  role?: PhotoRole;
  /** A labelled angle becomes an azimuth through `AZIMUTH_FOR_ANGLE`; an explicit `azimuth` wins. */
  angle?: PhotoAngle | null;
  azimuth?: number | null;
}

/** An `AnchorSpec` is assignable here; the extra fields it carries are ignored. */
export interface RecipeAnchorInput {
  method: AnchorMethod;
  referenceMetres: number;
  referenceUnits: number;
  metresPerUnit: number;
  uncertaintyM: number;
  axis?: 'width' | 'depth';
}

/**
 * Everything the prompt says that the recipe does not already carry: finishes from the photo
 * analysis, listing notes, floor level, building, city, which way the windows face, the capture
 * hour, and the openings. Room type, image count, plan dimensions and ceiling height are derived
 * from the recipe inputs and cannot be overridden here.
 */
export type RecipeContext = Omit<PromptFacts, 'roomType' | 'imageCount' | 'widthM' | 'depthM' | 'ceilingHeightM'>;

export interface RecipeInput {
  /** `PIPELINE_VERSION` from the environment; bumping it invalidates every recipe on purpose. */
  pipelineVersion: string;
  provider: RecipeProvider;
  /** The model id the tier resolves to (`marble-1.0-draft`, `marble-1.1`, or the mock's). */
  model: string;
  tier: RecipeTier;
  photos: RecipePhotoInput[];
  isPano?: boolean | null;
  roomType: RoomType;
  anchor: RecipeAnchorInput;
  planDims?: { width: number; depth: number } | null;
  ceilingHeight?: number | null;
  site?: { lat: number; lon: number; heading: number } | null;
  context?: RecipeContext | null;
}

/* ---------- canonical JSON ---------- */

const NUMBER_DECIMALS = 5;
const NUMBER_SCALE = 10 ** NUMBER_DECIMALS;

/** Round to `decimals` places and normalise `-0` to `0`. */
function roundTo(x: number, decimals: number): number {
  const scale = 10 ** decimals;
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r;
}

function encodeNumber(n: number, path: string): string {
  if (!Number.isFinite(n)) throw new TypeError(`canonicalJson: ${String(n)} at ${path} is not a finite number`);
  const r = Math.round(n * NUMBER_SCALE) / NUMBER_SCALE;
  if (Math.abs(r) >= 1e21) throw new RangeError(`canonicalJson: ${String(n)} at ${path} is too large for fixed formatting`);
  // After rounding, the shortest round-trip form has at most 5 decimals and no exponent.
  return String(r === 0 ? 0 : r);
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return encodeNumber(value, path);
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      throw new TypeError(`canonicalJson: undefined at ${path}`);
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
    default:
      break;
  }
  if (Array.isArray(value)) return `[${value.map((item, i) => encode(item, `${path}[${i}]`)).join(',')}]`;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`canonicalJson: only plain objects and arrays at ${path}`);
  const obj = value as Record<string, unknown>;
  // Default sort compares UTF-16 code units: locale-independent, so the same keys always land in the same order.
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(obj[k], `${path}.${k}`)}`).join(',')}}`;
}

/**
 * The one serialisation that is hashed: sorted keys at every level, numbers rounded to 5 decimals,
 * no `-0`, `NaN`, `Infinity` or `undefined`. Throws rather than guess at anything else.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, '$');
}

/** The same value, rebuilt from its canonical JSON: sorted keys, rounded numbers, no undefineds. */
export function canonicalize<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

/* ---------- hash and seed ---------- */

export function recipeHash(recipe: Recipe): string {
  return createHash('sha256').update(canonicalJson(recipe), 'utf8').digest('hex');
}

/** The first 32 bits of a sha256 hex digest as an unsigned integer in [0, SEED_MAX]. */
export function seedFromHash(hash: string): number {
  const head = hash.slice(0, 8);
  if (!/^[0-9a-f]{8}$/i.test(head)) throw new TypeError(`seedFromHash: expected a hex digest, got ${JSON.stringify(hash)}`);
  return Number.parseInt(head, 16);
}

export function recipeSeed(recipe: Recipe): number {
  return seedFromHash(recipeHash(recipe));
}

export function recipeTag(hash: string): string {
  return `${RECIPE_TAG_PREFIX}${hash.slice(0, RECIPE_TAG_HASH_CHARS)}`;
}

/* ---------- building ---------- */

const TIERS: ReadonlySet<string> = new Set<RecipeTier>(['draft', 'full']);
const PROVIDERS: ReadonlySet<string> = new Set<RecipeProvider>(['marble', 'mock']);
const ROLES: ReadonlySet<string> = new Set<PhotoRole>(['primary', 'extra']);
const ANGLES: ReadonlySet<string> = new Set<PhotoAngle>(['left', 'centre', 'right', 'back']);
const METHODS: ReadonlySet<string> = new Set<AnchorMethod>(['door', 'outlet', 'wall', 'floorplan', 'ceiling', 'marble', 'assumed']);
const AXES: ReadonlySet<string> = new Set(['width', 'depth']);
const ROOM_TYPES: ReadonlySet<string> = new Set<RoomType>(['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'studio', 'other']);
const SHA256_HEX = /^[0-9a-f]{64}$/;

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function requireEnum<T extends string>(value: unknown, allowed: ReadonlySet<string>, what: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) throw new TypeError(`buildRecipe: ${what} must be one of ${[...allowed].join(', ')}, got ${JSON.stringify(value)}`);
  return value as T;
}

function requireFinite(value: unknown, what: string): number {
  if (!isFiniteNumber(value)) throw new TypeError(`buildRecipe: ${what} must be a finite number, got ${String(value)}`);
  return value;
}

function normalisePhotos(input: RecipePhotoInput[]): RecipePhoto[] {
  if (!Array.isArray(input) || input.length === 0) throw new RangeError('buildRecipe: a recipe needs at least one photo');
  if (input.length > MARBLE_MAX_IMAGES) throw new RangeError(`buildRecipe: Marble takes at most ${MARBLE_MAX_IMAGES} images, got ${input.length}`);
  return input.map((p, i) => {
    const sha256 = typeof p?.sha256 === 'string' ? p.sha256.trim().toLowerCase() : '';
    if (!SHA256_HEX.test(sha256)) throw new TypeError(`buildRecipe: photos[${i}].sha256 must be 64 hex characters`);
    const role = p.role == null ? (i === 0 ? 'primary' : 'extra') : requireEnum<PhotoRole>(p.role, ROLES, `photos[${i}].role`);
    const photo: RecipePhoto = { sha256, role };
    // The primary shot defines 0°, so it never carries a hint (mirrors `generationImages` in src/services/marble.ts).
    if (i > 0) {
      if (isFiniteNumber(p.azimuth)) photo.azimuth = norm360(p.azimuth);
      else if (typeof p.angle === 'string' && ANGLES.has(p.angle)) photo.azimuth = AZIMUTH_FOR_ANGLE[p.angle];
    }
    return photo;
  });
}

function normaliseAnchor(a: RecipeAnchorInput): RecipeAnchor {
  if (!a || typeof a !== 'object') throw new TypeError('buildRecipe: anchor is required');
  const anchor: RecipeAnchor = {
    method: requireEnum<AnchorMethod>(a.method, METHODS, 'anchor.method'),
    referenceMetres: requireFinite(a.referenceMetres, 'anchor.referenceMetres'),
    referenceUnits: requireFinite(a.referenceUnits, 'anchor.referenceUnits'),
    metresPerUnit: requireFinite(a.metresPerUnit, 'anchor.metresPerUnit'),
    uncertaintyM: requireFinite(a.uncertaintyM, 'anchor.uncertaintyM'),
  };
  if (a.axis != null) anchor.axis = requireEnum<'width' | 'depth'>(a.axis, AXES, 'anchor.axis');
  return anchor;
}

function normalisePlan(p: RecipeInput['planDims']): RecipePlanDims | undefined {
  if (p == null) return undefined;
  const width = requireFinite(p.width, 'planDims.width');
  const depth = requireFinite(p.depth, 'planDims.depth');
  if (width <= 0 || depth <= 0) throw new RangeError('buildRecipe: planDims must be positive');
  return { width: roundTo(width, 2), depth: roundTo(depth, 2) };
}

function normaliseSite(s: RecipeInput['site']): RecipeSite | undefined {
  if (s == null) return undefined;
  const lat = requireFinite(s.lat, 'site.lat');
  const lon = requireFinite(s.lon, 'site.lon');
  const heading = requireFinite(s.heading, 'site.heading');
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new RangeError('buildRecipe: site lat/lon out of range');
  // 360 rounds back to 0 so "359.7°" and "0°" are the same recipe.
  return { lat: roundTo(lat, 5), lon: roundTo(lon, 5), heading: Math.round(norm360(heading)) % 360 };
}

/**
 * Build the canonical recipe for one room: validate and normalise the inputs, compile the prompt
 * from them plus the listing context, and return the document already in canonical form.
 */
export function buildRecipe(input: RecipeInput): Recipe {
  if (typeof input.pipelineVersion !== 'string' || !input.pipelineVersion.trim()) throw new TypeError('buildRecipe: pipelineVersion is required');
  if (typeof input.model !== 'string' || !input.model.trim()) throw new TypeError('buildRecipe: model is required');
  const provider = requireEnum<RecipeProvider>(input.provider, PROVIDERS, 'provider');
  const tier = requireEnum<RecipeTier>(input.tier, TIERS, 'tier');
  const roomType = requireEnum<RoomType>(input.roomType, ROOM_TYPES, 'roomType');
  const photos = normalisePhotos(input.photos);
  const anchor = normaliseAnchor(input.anchor);
  const planDims = normalisePlan(input.planDims);
  const site = normaliseSite(input.site);
  const ceilingHeight = input.ceilingHeight == null ? undefined : roundTo(requireFinite(input.ceilingHeight, 'ceilingHeight'), 2);
  if (ceilingHeight !== undefined && ceilingHeight <= 0) throw new RangeError('buildRecipe: ceilingHeight must be positive');

  const facts: PromptFacts = {
    ...(input.context ?? {}),
    roomType,
    imageCount: photos.length,
    widthM: planDims?.width,
    depthM: planDims?.depth,
    ceilingHeightM: ceilingHeight,
  };

  const recipe: Recipe = {
    pipelineVersion: input.pipelineVersion.trim(),
    provider,
    model: input.model.trim(),
    tier,
    photos,
    prompt: compileMarblePrompt(facts),
    reconstructImages: photos.length > MARBLE_PLAIN_IMAGES,
    isPano: input.isPano === true,
    anchor,
    roomType,
  };
  if (planDims) recipe.planDims = planDims;
  if (site) recipe.site = site;
  if (ceilingHeight !== undefined) recipe.ceilingHeight = ceilingHeight;
  return canonicalize(recipe);
}

/* ---------- the Marble request ---------- */

/** One canonical image, in recipe order: the bytes Marble receives, base64, plus the file extension. */
export interface MarbleImageInput {
  base64: string;
  /** `jpg`, `png`, ... (`jpeg` is normalised to `jpg`). Canonical copies are always JPEG. */
  extension?: string;
}

export interface MarbleImageContent {
  source: 'data_base64';
  data_base64: string;
  extension: string;
}

export type MarbleWorldPromptBody =
  | { type: 'image'; image_prompt: MarbleImageContent; text_prompt: string; is_pano: boolean; disable_recaption: true }
  | {
      type: 'multi-image';
      multi_image_prompt: { azimuth?: number; content: MarbleImageContent }[];
      reconstruct_images: boolean;
      text_prompt: string;
      disable_recaption: true;
    };

/** Exactly what is POSTed to `/marble/v1/worlds:generate` for a recipe. */
export interface MarbleRequestBody {
  display_name: string;
  model: string;
  tags: string[];
  permission: { public: boolean; allow_id_access: boolean };
  seed: number;
  world_prompt: MarbleWorldPromptBody;
}

export interface MarbleRequestOptions {
  /** Shown in Marble's own UI; not part of the recipe. Cut to 64 characters like the existing route. */
  displayName?: string;
}

const DEFAULT_DISPLAY_NAME = 'Audora room';
const DISPLAY_NAME_MAX = 64;

function content(image: MarbleImageInput, i: number): MarbleImageContent {
  if (!image || typeof image.base64 !== 'string' || !image.base64) throw new TypeError(`marbleRequestFrom: images[${i}].base64 is required`);
  const raw = (image.extension ?? 'jpg').trim().toLowerCase().replace(/^\./, '');
  const extension = raw === 'jpeg' ? 'jpg' : raw;
  if (!/^[a-z0-9]+$/.test(extension)) throw new TypeError(`marbleRequestFrom: images[${i}].extension ${JSON.stringify(image.extension)} is not a file extension`);
  return { source: 'data_base64', data_base64: image.base64, extension };
}

/**
 * The request Marble gets for a recipe: its seed from the hash, `disable_recaption` so the compiled
 * prompt is used verbatim, the `recipe:` tag, and the world prompt in single-image or multi-image
 * form with the recipe's azimuths. `images` are the canonical photos' bytes in recipe order; their
 * count must match, because the recipe was hashed over exactly those photos.
 *
 * Where the fields sit (settled at integration, 2026-09-08, because server/marbleRequest.ts and
 * this module had drifted apart): `seed` is a generation parameter and sits beside `world_prompt`,
 * while `disable_recaption` sits INSIDE `world_prompt`, next to the `text_prompt` it is about and
 * beside the prompt's other knobs (`reconstruct_images`, `is_pano`). server/marbleRequest.ts — the
 * browser flow's mapping of the same call — now agrees field for field, and tests/marble-seed.test.ts
 * and tests/recipe.test.ts both pin it, so the two can only be wrong together. `is_pano` belongs to
 * the image prompt, so it appears only in the single-image form — a panorama is one photograph —
 * while the recipe records the flag either way, because it is an input to the hash.
 */
export function marbleRequestFrom(recipe: Recipe, images: MarbleImageInput[], options: MarbleRequestOptions = {}): MarbleRequestBody {
  if (!Array.isArray(images) || images.length !== recipe.photos.length) {
    throw new RangeError(`marbleRequestFrom: recipe has ${recipe.photos.length} photos but ${Array.isArray(images) ? images.length : 0} images were given`);
  }
  if (images.length === 0 || images.length > MARBLE_MAX_IMAGES) throw new RangeError(`marbleRequestFrom: Marble takes 1 to ${MARBLE_MAX_IMAGES} images`);
  const hash = recipeHash(recipe);
  const shots = images.map(content);
  const world_prompt: MarbleWorldPromptBody =
    shots.length === 1
      ? { type: 'image', image_prompt: shots[0], text_prompt: recipe.prompt, is_pano: recipe.isPano, disable_recaption: true }
      : {
          type: 'multi-image',
          multi_image_prompt: shots.map((shot, i) => {
            const azimuth = recipe.photos[i].azimuth;
            return { ...(azimuth === undefined ? {} : { azimuth }), content: shot };
          }),
          reconstruct_images: recipe.reconstructImages,
          text_prompt: recipe.prompt,
          disable_recaption: true,
        };
  return {
    display_name: String(options.displayName || DEFAULT_DISPLAY_NAME).slice(0, DISPLAY_NAME_MAX),
    model: recipe.model,
    tags: ['audora', recipeTag(hash)],
    permission: { public: false, allow_id_access: true },
    seed: seedFromHash(hash),
    world_prompt,
  };
}
