import type { PhotoAngle, PhotoRecord, ProviderStatus, Room, RoomWorld, Tier, TourSite, WorldBoundsRecord, WorldWallOpening, WorldWallRect } from '@/state/types';
import type { RawGeometry } from '@/engine/types';
import { applyScale, plausibility } from '@/engine/anchor';
import { canonicalJson, roundTo, seedFromHash } from '@shared/canonical';
import { reconstructsImages } from '@shared/marbleLimits';
import { isOneRoom, measureColliderGlb, rawFromBounds, roomRect } from '@shared/collider';
import { mockRawGeometry } from './mockWorld';
import { compileRoomPrompt, MAX_ROOM_PHOTOS } from './marblePrompt';

/**
 * The measurement itself lives in `shared/collider.ts` — ONE copy, compiled into both the browser
 * bundle and the worker (docs/ACCURACY.md section 3), so the room the pipeline stores and the room
 * the viewer draws come from the same function rather than from two that agree today. What stays
 * in this module is the browser's own fetch, the aliases that tie a measurement to the store's
 * record shape, and the two pieces that need the engine: `roomExtent`, which asks `plausibility`
 * whether the answer is a room at all, and `splatTransform`, which places it.
 */

/**
 * An opening found in the wall band — a window, or a doorway into the next room. Raw units, on a
 * wall of Audora's metric room (the shape lives in state/types so a stored world carries it).
 */
export type WallOpening = WorldWallOpening;

/**
 * The room's own walls, measured from the collider's wall band and expressed the same way the
 * bounding box is: raw units, **relative to the capture point**, which sits at the origin. So
 * `maxX` is how far the nearest wall is to one side of the photographer, and the capture point is
 * inside the rectangle by construction.
 *
 * `rotation` is the yaw of the fitted rectangle relative to the provider's axes, radians in
 * [0, π/2). Marble's frame is the camera's, not the room's: the demo corner room comes out at 47°
 * to it (the photographer faced a corner), which is exactly why its bounding box is 41 % too big.
 * The extents are the room's own, each named after the raw axis it is closer to — a labelling that
 * preserves sizes and capture-point distances but not the sense of the axes. **Read the rectangle
 * through {@link roomRect}** to get it in Audora's axes, with that turn recovered; nothing else
 * should interpret these four numbers directly.
 *
 * `score` is the fraction of the wall band (0..1) that lies on this rectangle — how much of a room
 * the mesh really is. 0.80 on the demo corner room, 0.72 on the full-quality flat; a mesh that
 * agrees with no rectangle at all never gets one.
 */
export type WallRect = WorldWallRect;

/** Which measurement the room extent came from. */
export type ExtentMethod = 'walls' | 'aabb';

/**
 * Everything the collider mesh knows about the room, in the provider's raw units with the capture
 * point at the origin. Exactly what a world stores (`RoomWorld['bounds']`), so a measurement can be
 * put on a record as it is and read back after a round trip through localStorage. Structurally the
 * same record `shared/collider.ts` measures and the server stores.
 */
export type WorldBounds = WorldBoundsRecord;

export type { RoomRect } from '@shared/collider';
/**
 * `COLLIDER_MIRROR` is the reflection that puts a delivered collider mesh back into the splat's
 * frame; `wallsOf` is the rectangle a stored world carries, and `extentWalls` the one it is both
 * measured and placed with — the rule `rawFromBounds` and `splatTransform` share, so a room can
 * never be sized from one rectangle and centred on another.
 */
export { COLLIDER_MIRROR, extentMethodOf, extentWalls, fitWallRect, measureCollider as colliderGeometry, rawFromBounds, roomRect, wallBandProfile, wallsOf } from '@shared/collider';

/**
 * Read the collider mesh and measure the room in it: the bounding box, the floor and ceiling
 * planes, and the wall band that says where the real walls are.
 *
 * The bounding box alone is not the room — Marble reconstructs what it saw *through* the windows —
 * so `shared/collider` reads the POSITION data, not just the accessor min/max the JSON chunk
 * carries. This function is only the download — the worker fetches its own bytes from storage —
 * and both sides then call the same `measureCollider` underneath.
 */
export async function fetchColliderGeometry(url: string): Promise<WorldBounds> {
  return measureColliderGlb(await (await fetch(url)).arrayBuffer());
}

/** @deprecated Use {@link fetchColliderGeometry}: same result, plus the wall rectangle. */
export const fetchColliderBounds = fetchColliderGeometry;

export interface SplatTransform {
  /** Uniform scale from the provider's raw units to metres. */
  scale: number;
  /** Where the provider's origin — the capture point — lands in Audora's frame. */
  position: [number, number, number];
  /** The Marble group's turn about y: `π + yaw`. */
  rotationY: number;
  /**
   * The room's own turn (see {@link RoomRect}), radians. Also the direction the capture looked in
   * Audora's frame, so walk mode spawns at `position` facing `yaw` and the first frame is the
   * photograph. 0 when the collider gave no wall rectangle.
   */
  yaw: number;
  /** True when the world carried Marble's own metric semantics (full quality), false when the anchor supplied the scale. */
  metric: boolean;
}

/**
 * Where a provider's world sits inside Audora's metric room frame (floor y = 0, centre at the
 * origin, door on the south wall). Everything real — panorama sphere, SPZ splat, collider mesh —
 * hangs off ONE group carrying this transform:
 *
 * ```tsx
 * const t = splatTransform(world, room.anchor.metresPerUnit, room.floorOffset);
 * <group position={t.position} rotation={[0, t.rotationY, 0]} scale={t.scale}>…</group>
 * ```
 *
 * `rotationY` is `π + rect.yaw`. The 180° is what makes the capture look the way Audora's rooms do
 * (Marble's room extends toward +z from the camera; ours extends toward −z from the south door);
 * the rest is the room's own turn, because Marble's frame is the camera's and the photographer may
 * have faced a corner (see {@link RoomRect}). `position` is exactly where the capture point lands,
 * so the photo view puts its camera there — facing `yaw`, which is where the camera looked.
 *
 * The two ways a world knows its own size, handled the same way whether or not `bounds` are known:
 * - **Full quality** carries `metric_scale_factor` (raw units → metres) and `ground_plane_offset`
 *   (metres the capture point sits ABOVE the ground plane — already metric, so it is never
 *   multiplied by the scale). Verified against the reference build, which draws its collider at
 *   `position.y = -ground_plane_offset` with the camera left at the origin.
 * - **Draft** carries neither, so `metresPerUnit` comes from the room's anchor.
 *
 * **The floor, in order of preference: `ground_plane_offset`, then `bounds.floorY`, then
 * `bounds.minY`.** Marble publishes `ground_plane_offset` only with a full-quality world's metric
 * semantics, and where it publishes one it is right: measured against the world's own Gaussians —
 * the thing the renter actually sees — the flat's splat floor lands 1.2 cm above y = 0 with the
 * ground plane and 16 cm above it with the collider's floor slab, which is what made furniture look
 * sunk into the photographed floorboards. (The earlier reading, that the ground plane sat 15 cm
 * *above* the floor, compared it with the collider mesh rather than with the splat; the collider is
 * the one that is 15 cm out.) A draft world publishes no ground plane, so there `bounds.floorY` —
 * the densest horizontal slab in the mesh — still stands, with `bounds.minY` behind it.
 *
 * `bounds`, when present, additionally turn and centre the room on the origin — around the **same**
 * rectangle `rawFromBounds` measured the room with (`bounds.walls` when the wall band produced one,
 * the bounding box otherwise), so the reconstruction's own walls land ON the room's walls instead of
 * at an angle inside them. `floorOffset` (`Room.floorOffset`, metres) raises the whole
 * reconstruction so its floor meets ours; nothing in the metric frame moves, so furniture keeps
 * standing on y = 0.
 *
 * Measuring the room more honestly does not move the reconstruction relative to itself: the scale
 * and the floor plane are untouched and the capture point stays exactly where it is relative to
 * everything Marble reconstructed — it is the room rectangle drawn around it that shrinks onto the
 * real walls and turns onto them, so `position` (which IS the capture point) reports new
 * coordinates in a frame whose origin and axes moved. Every distance the renter can see is
 * unchanged, and so is the view from the capture point, which is why photo view looks identical
 * before and after: the camera turns with the room.
 */
export function splatTransform(world: WorldPlacement, metresPerUnit: number, floorOffset = 0): SplatTransform {
  const msf = world.metricScaleFactor;
  const metric = msf != null && msf > 0;
  const s = metric ? (msf as number) : metresPerUnit > 0 ? metresPerUnit : 1;
  const b = world.bounds;
  // Height of the capture point above Audora's floor. Marble's own ground plane when the world
  // carries metric semantics (measured against its splat: 1.2 cm), else the collider's floor plane,
  // else the drop from the camera to the lowest point of the mesh.
  const captureY =
    metric && world.groundPlaneOffset != null
      ? world.groundPlaneOffset
      : b?.floorY != null
        ? -b.floorY * s
        : b
          ? -b.minY * s
          : 0;
  // The same rectangle the room is measured with, in the same axes (see `roomRect`). The capture
  // point sits at its origin, so putting the room centre on ours is one subtraction.
  const rect = roomRect(b);
  const x = rect ? -((rect.minX + rect.maxX) / 2) * s : 0;
  const z = rect ? -((rect.minZ + rect.maxZ) / 2) * s : 0;
  const yaw = rect?.yaw ?? 0;
  return { scale: s, position: [x, captureY + floorOffset, z], rotationY: Math.PI + yaw, yaw, metric };
}

/** What `splatTransform` needs of a world; every `RoomWorld` satisfies it. */
export interface WorldPlacement {
  metricScaleFactor?: number | null;
  groundPlaneOffset?: number | null;
  bounds?: WorldBounds;
}

export interface RoomExtent {
  raw: RawGeometry;
  /** The bounds to store: the same object, with `method` set to what the extent actually came from. */
  bounds?: WorldBounds;
  method: ExtentMethod | 'estimate';
}

/**
 * The room a world should report, and the bounds to store beside it.
 *
 * `rawFromBounds`, unless the metric room that comes out of it is not a room at all: Marble's
 * collider includes whatever the model hallucinated through the windows and the open doors, which
 * for a full-quality world of a flat is the whole floor plan. Measured: the demo flat's bounding
 * box is 138 m², and even its wall band — a real measurement of a real open-plan space — comes to
 * 6.5 × 11.8 m. That is a flat, not a living room, so the caller's estimate stands and the bounds
 * are stored as `aabb`, which keeps the wall rectangle on the record without letting
 * `splatTransform` centre the room on a rectangle the room is not.
 */
export function roomExtent(bounds: WorldBounds | undefined, metresPerUnit: number, fallback: RawGeometry): RoomExtent {
  if (!bounds) return { raw: fallback, method: 'estimate' };
  const raw = rawFromBounds(bounds);
  const g = applyScale(raw, metresPerUnit);
  // "Is this one room?" is `isOneRoom` in shared/collider, so the worker rejects exactly what the
  // browser rejects; `plausibility` is the engine's extra opinion, which only the browser has.
  const sane = plausibility(g).every((w) => w.severity !== 'error') && isOneRoom(g);
  if (sane) return { raw, bounds, method: bounds.walls ? 'walls' : 'aabb' };
  return { raw: fallback, bounds: { ...bounds, method: 'aabb' }, method: 'estimate' };
}

/** `roomExtent`, for callers that only want the geometry. */
export function rawFromBoundsOr(bounds: WorldBounds | undefined, metresPerUnit: number, fallback: RawGeometry): RawGeometry {
  return roomExtent(bounds, metresPerUnit, fallback).raw;
}

export interface MarbleOperation {
  operation_id: string;
  done: boolean;
  metadata?: {
    progress_percent?: number;
    /** What the API actually returns today: a status object, no percentage. */
    progress?: { status?: string; description?: string };
    world_id?: string;
    operation_type?: string;
    public_model_name?: string;
  } | null;
  response?: MarbleWorld | null;
  error?: { code?: string; message?: string } | null;
  cost?: { total_credits?: number } | null;
  created_at?: string;
  updated_at?: string;
}

export interface MarbleWorld {
  world_id: string;
  display_name?: string;
  world_marble_url?: string;
  model?: string;
  assets?: {
    thumbnail_url?: string;
    caption?: string;
    imagery?: { pano_url?: string };
    mesh?: { full_res_mesh_url?: string; hq_mesh_url?: string; collider_mesh_url?: string };
    splats?: { spz_urls?: Record<string, string>; semantics_metadata?: { metric_scale_factor?: number | null; ground_plane_offset?: number | null } };
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const text = await r.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!r.ok) throw new Error(body?.error?.message || body?.error || body?.detail || `${r.status} ${path}`);
  return body as T;
}

export async function providerStatus(): Promise<ProviderStatus> {
  try {
    // `backend` says whether /api/v1 is live (docs/BACKEND.md §8); an older server that does not
    // report it is the same as false, which is what the local store already assumes.
    const s = await api<{ nebius: boolean; marble: boolean; backend?: boolean; models: Record<string, string> }>('/api/status');
    return { ...s, backend: s.backend === true, checkedAt: Date.now() };
  } catch {
    // No `models`: an unreachable server has not told us which Marble model it runs, and the model
    // id is part of the recipe hash. Callers must treat a missing one as "not known yet" rather than
    // falling back to a default that may not be what the server would have run (`src/state/jobs.ts`).
    return { nebius: false, marble: false, backend: false, checkedAt: Date.now() };
  }
}

/** Kick off a Marble generation for a room photo. Returns immediately with the operation id. */
/* ---------- what a room sends to Marble ----------
 * One photo is the floor of the product; more angles are the ceiling. `room.photo` is the primary
 * shot (the one the anchor was tapped on) and `room.photos` holds the extra angles in the order the
 * leasing team added them, up to `MAX_ROOM_PHOTOS` between them.
 *
 * When the leasing team says which way an angle faces, that becomes Marble's `azimuth`: degrees round the
 * capture point with the primary shot at 0, matching the Front / Left / Right the Marble UI offers.
 * An unlabelled angle sends no azimuth at all, which is the documented "work it out yourself" mode —
 * a wrong hint is worse than none. */

/**
 * Marble's own cap in reconstruction mode; the create flow stops the leasing team at six. Defined in
 * `./marblePrompt` (the leaf) and re-exported here, so the sentence the prompt opens with counts
 * exactly the shots this module sends.
 */
export { MAX_ROOM_PHOTOS };

/** Where an angle faces, relative to the room's primary photo (declared on the stored photo record). */
export type { PhotoAngle };

export const AZIMUTH_FOR_ANGLE: Record<PhotoAngle, number> = { centre: 0, right: 90, back: 180, left: 270 };

export const ANGLE_LABELS: Record<PhotoAngle, string> = {
  centre: 'Straight ahead',
  left: 'Turned left',
  right: 'Turned right',
  back: 'From the far side',
};

/** Every photo a room will send, primary first. */
export function roomPhotos(room: Pick<Room, 'photo' | 'photos'>): PhotoRecord[] {
  return [...(room.photo ? [room.photo] : []), ...(room.photos ?? [])].slice(0, MAX_ROOM_PHOTOS);
}

/** The images and azimuth hints a room's generation request carries. */
export function generationImages(room: Pick<Room, 'photo' | 'photos'>): { dataUrl: string; azimuth?: number }[] {
  return roomPhotos(room).map((p, i) => {
    const angle = p.angle;
    // The primary shot defines 0°, so it never needs a hint of its own.
    if (i === 0 || !angle) return { dataUrl: p.dataUrl };
    return { dataUrl: p.dataUrl, azimuth: AZIMUTH_FOR_ANGLE[angle] };
  });
}

/* ---------- the recipe: determinism in the browser ----------
 * docs/BACKEND.md section 2, applied to the flow that still runs in the browser. A room's request
 * is written down as a canonical JSON document — pipeline version, provider and model id, tier, the
 * photo hashes with their azimuths, the compiled text prompt, the anchor, the plan dimensions and
 * the site — and hashed. The Marble seed is the first 32 bits of that hash, so the same room asks
 * Marble for the same seed every time, and `disable_recaption` keeps the compiled prompt verbatim.
 *
 * Everything here is pure in the inputs: sorted keys, fixed rounding (metres to 2 decimals,
 * anchor references to 3, lat/lon to 5, bearings and azimuths to whole degrees), no clock, no
 * randomness. `server/recipe.ts` is the canonical version for the backend; this one mirrors it. */

/** Bump to invalidate every browser recipe on purpose (mirrors PIPELINE_VERSION on the server). */
export const PIPELINE_VERSION = '1';

/** The model id a tier maps to when the server has not told us otherwise (matches server/api.ts defaults). */
export const DEFAULT_MARBLE_MODEL: Record<Tier, string> = { draft: 'marble-1.0-draft', full: 'marble-1.1' };

export interface BrowserRecipe {
  anchor: { method: string; referenceMetres: number } | null;
  isPano: false;
  model: string;
  photos: { azimuth?: number; sha256: string }[];
  pipelineVersion: string;
  planDims: { depth: number; width: number } | null;
  prompt: string;
  provider: 'marble';
  reconstructImages: boolean;
  site: { heading: number; lat: number; lon: number } | null;
  tier: Tier;
}

/**
 * The canonical serialisation and the seed are `shared/canonical.ts`: sorted keys at every depth,
 * numbers rounded to five decimals, no `undefined`, and the first 32 bits of the digest as the
 * seed. The browser and the worker hash the same bytes, so a room generated from the wizard and the
 * same room generated by the backend land on the same recipe hash. Only the digest differs
 * (WebCrypto here, `node:crypto` there), which is `sha256Hex` below.
 */
export { canonicalJson, roundTo, seedFromHash } from '@shared/canonical';

/** Lower-case hex of a sha256, via WebCrypto, or node:crypto where `crypto.subtle` is missing (tests). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes as BufferSource);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // A variable specifier keeps Vite from trying to bundle a Node built-in for the browser.
  const mod = 'node:crypto';
  const nodeCrypto: { createHash: (alg: string) => { update: (d: Uint8Array) => { digest: (enc: string) => string } } } = await import(/* @vite-ignore */ mod);
  return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}

/** The bytes a base64 image data URL carries. Only the image bytes are hashed, never the URL text. */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The canonical recipe for a room's generation request. Async only because the photos are hashed.
 * The compiled prompt is part of it, so anything the prompt states (plan dims, anchor, heading)
 * changes the hash through the prompt as well as through its own field.
 */
export async function browserRecipe(room: Room, tier: Tier, modelId: string, pipelineVersion: string = PIPELINE_VERSION, site?: TourSite | null): Promise<BrowserRecipe> {
  const images = generationImages(room);
  const photos = await Promise.all(
    images.map(async (img) => {
      const sha256 = await sha256Hex(dataUrlBytes(img.dataUrl));
      return img.azimuth == null ? { sha256 } : { azimuth: Math.round(img.azimuth), sha256 };
    }),
  );
  const dims = room.planDims;
  return {
    anchor: room.anchor ? { method: room.anchor.method, referenceMetres: roundTo(room.anchor.referenceMetres, 3) } : null,
    isPano: false,
    model: modelId,
    photos,
    pipelineVersion,
    planDims: dims && dims.width > 0 && dims.depth > 0 ? { depth: roundTo(dims.depth, 2), width: roundTo(dims.width, 2) } : null,
    prompt: compileRoomPrompt(room, site),
    provider: 'marble',
    reconstructImages: reconstructsImages(photos.length),
    site: site && Number.isFinite(site.lat) && Number.isFinite(site.lon) ? { heading: Math.round(site.heading), lat: roundTo(site.lat, 5), lon: roundTo(site.lon, 5) } : null,
    tier,
  };
}

/** sha256 hex of a recipe's canonical JSON. */
export async function recipeHashBrowser(recipe: BrowserRecipe): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalJson(recipe)));
}

export interface RecipeResult {
  recipe: BrowserRecipe;
  recipeHash: string;
  seed: number;
  prompt: string;
}

/** Recipe, hash, seed and prompt for a room in one go — what `startGeneration` sends and what the world records. */
export async function recipeForRoom(room: Room, tier: Tier, opts: { modelId?: string; site?: TourSite | null; pipelineVersion?: string } = {}): Promise<RecipeResult> {
  const recipe = await browserRecipe(room, tier, opts.modelId || DEFAULT_MARBLE_MODEL[tier], opts.pipelineVersion ?? PIPELINE_VERSION, opts.site);
  const recipeHash = await recipeHashBrowser(recipe);
  return { recipe, recipeHash, seed: seedFromHash(recipeHash), prompt: recipe.prompt };
}

export interface StartGenerationOptions {
  /** The model id the server will run for this tier (from /api/status), so the recipe names the real model. */
  modelId?: string;
  /** The tour's site: its heading goes into the prompt and its position into the recipe. */
  site?: TourSite | null;
  pipelineVersion?: string;
}

export interface StartedGeneration {
  operationId: string;
  worldId?: string;
  recipeHash: string;
  seed: number;
  prompt: string;
}

/**
 * Kick off a Marble generation for a room. Returns immediately with the operation id, plus the
 * recipe hash, seed and prompt it was asked for with, so the finished world can record them.
 */
export async function startGeneration(room: Room, tier: Tier, opts: StartGenerationOptions = {}): Promise<StartedGeneration> {
  const images = generationImages(room);
  if (!images.length) throw new Error('This room has no photo to reconstruct from.');
  const { recipeHash, seed, prompt } = await recipeForRoom(room, tier, opts);
  const op = await api<MarbleOperation>('/api/marble/generate', {
    method: 'POST',
    body: JSON.stringify({
      images,
      // Kept so an older server (or a replay of a stored request) still gets the primary shot.
      imageDataUrl: images[0].dataUrl,
      tier,
      /* The model the recipe names, so the world that comes back is the one that was hashed. The
         server allowlists it against the tier's own model and its `-plus` sibling (`modelFor` in
         server/marbleRequest.ts) — naming a model here cannot make it run anything else. */
      ...(opts.modelId ? { model: opts.modelId } : {}),
      displayName: `Audora · ${room.name}`,
      textPrompt: prompt,
      seed,
      // The prompt above is the prompt Marble uses; its own captioner is a second stochastic model.
      disableRecaption: true,
      tags: [`recipe:${recipeHash.slice(0, 12)}`],
    }),
  });
  return { operationId: op.operation_id, worldId: op.metadata?.world_id, recipeHash, seed, prompt };
}

export async function pollOperation(operationId: string): Promise<MarbleOperation> {
  return api<MarbleOperation>(`/api/marble/operations/${operationId}`);
}

export async function fetchWorld(worldId: string): Promise<MarbleWorld> {
  return api<MarbleWorld>(`/api/marble/worlds/${worldId}`);
}

/* ---------- the panorama lands late ----------
 * A draft operation reports `done` before Marble has finished writing the equirectangular
 * panorama, so `assets.imagery.pano_url` is often missing for a few seconds — and the panorama is
 * what the photo view renders. The reference build polls the world record every 2.5 s for about a
 * minute; so do we, and we attach the world either way when the time is up (the viewer falls back
 * to the room shell, and a later regeneration picks the panorama up). */

export const PANO_POLL_INTERVAL_MS = 2500;
export const PANO_POLL_TIMEOUT_MS = 60_000;

export function panoUrlOf(world: MarbleWorld | undefined | null): string | undefined {
  return world?.assets?.imagery?.pano_url || undefined;
}

export interface PanoWaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  getWorld?: (worldId: string) => Promise<MarbleWorld>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called before every poll with the attempt number (1-based) and how long we have waited, in ms. */
  onAttempt?: (attempt: number, elapsedMs: number) => void;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll a world until its panorama appears. Never throws and never returns nothing useful: the
 * freshest world record seen comes back, panorama or not, so the caller can attach it anyway.
 */
export async function waitForPano(worldId: string, initial?: MarbleWorld | null, opts: PanoWaitOptions = {}): Promise<MarbleWorld | undefined> {
  const { intervalMs = PANO_POLL_INTERVAL_MS, timeoutMs = PANO_POLL_TIMEOUT_MS, getWorld = fetchWorld, sleep = wait, now = Date.now, onAttempt } = opts;
  let best = initial ?? undefined;
  if (panoUrlOf(best)) return best;
  const started = now();
  let attempt = 0;
  while (now() - started < timeoutMs) {
    await sleep(intervalMs);
    attempt += 1;
    onAttempt?.(attempt, now() - started);
    try {
      const w = await getWorld(worldId);
      // A record that carries assets is always the better one to keep.
      if (w?.assets || !best) best = w;
      if (panoUrlOf(best)) return best;
    } catch {
      /* transient: keep polling until the timeout */
    }
  }
  return best;
}

/** Pick the smallest / most web-friendly SPZ url from the map Marble returns. */
export function pickSpz(urls?: Record<string, string>): string | undefined {
  if (!urls) return undefined;
  const entries = Object.entries(urls);
  if (!entries.length) return undefined;
  const pref = ['500k', '1m', 'low', 'medium', 'preview', 'default', 'full_res', 'high'];
  for (const p of pref) {
    const hit = entries.find(([k]) => k.toLowerCase().includes(p));
    if (hit) return hit[1];
  }
  return entries[0][1];
}

/** What a generation was asked for with (from `startGeneration`), recorded on the world it made. */
export type WorldProvenance = Partial<Pick<RoomWorld, 'recipeHash' | 'seed' | 'prompt'>>;

/**
 * Convert a finished Marble world into Audora's RoomWorld. Pass collider bounds to derive raw room
 * geometry from the world itself, and the provenance so the world says which recipe and seed made it.
 */
export function worldFromMarble(room: Room, tier: Tier, w: MarbleWorld, credits?: number, seconds?: number, bounds?: WorldBounds, provenance?: WorldProvenance): RoomWorld {
  const a = w.assets || {};
  const msf = a.splats?.semantics_metadata?.metric_scale_factor ?? null;
  const fallbackRaw = room.raw ?? mockRawGeometry(room.id, room.type);
  const extent = roomExtent(bounds, msf && msf > 0 ? msf : (room.anchor?.metresPerUnit ?? 1), fallbackRaw);
  return {
    bounds: extent.bounds,
    provider: 'marble',
    tier,
    worldId: w.world_id,
    model: w.model || (tier === 'draft' ? 'marble-1.0-draft' : 'marble-1.1'),
    createdAt: Date.now(),
    raw: extent.raw,
    spzUrl: pickSpz(a.splats?.spz_urls),
    // The whole ladder, not just the tier the viewer starts on: `SplatWorld` streams the smallest
    // file first and climbs (three/splat/tiers), which it can only do if the urls survive the trip
    // into the store.
    spzUrls: a.splats?.spz_urls ?? null,
    colliderUrl: a.mesh?.collider_mesh_url,
    meshUrl: a.mesh?.hq_mesh_url || a.mesh?.full_res_mesh_url,
    thumbnailUrl: a.thumbnail_url,
    panoUrl: a.imagery?.pano_url,
    caption: a.caption,
    marbleUrl: w.world_marble_url,
    metricScaleFactor: a.splats?.semantics_metadata?.metric_scale_factor ?? null,
    groundPlaneOffset: a.splats?.semantics_metadata?.ground_plane_offset ?? null,
    credits,
    usd: credits ? credits / 1250 : undefined,
    seconds,
    ...(provenance?.recipeHash ? { recipeHash: provenance.recipeHash } : {}),
    ...(provenance?.seed != null ? { seed: provenance.seed } : {}),
    ...(provenance?.prompt ? { prompt: provenance.prompt } : {}),
  };
}
