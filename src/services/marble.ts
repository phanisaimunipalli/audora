import type { ProviderStatus, Room, RoomWorld, Tier } from '@/state/types';
import type { RawGeometry } from '@/engine/types';
import { applyScale, plausibility } from '@/engine/anchor';
import { mockRawGeometry } from './mockWorld';

export type WorldBounds = NonNullable<RoomWorld['bounds']>;

/**
 * Read the axis-aligned bounds of a glTF-binary collider without loading three's GLTFLoader:
 * glTF accessors carry min/max for every POSITION attribute, so the JSON chunk is enough.
 */
export async function fetchColliderBounds(url: string): Promise<WorldBounds> {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const total = dv.getUint32(8, true);
  let off = 12;
  let json: any = null;
  let bin: { start: number; length: number } | null = null;
  while (off < total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    if (type === 0x004e4942) bin = { start: off + 8, length: len };
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  const b: WorldBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const acc = json.accessors?.[prim.attributes?.POSITION];
      if (!acc?.min || !acc?.max) continue;
      b.minX = Math.min(b.minX, acc.min[0]);
      b.minY = Math.min(b.minY, acc.min[1]);
      b.minZ = Math.min(b.minZ, acc.min[2]);
      b.maxX = Math.max(b.maxX, acc.max[0]);
      b.maxY = Math.max(b.maxY, acc.max[1]);
      b.maxZ = Math.max(b.maxZ, acc.max[2]);
    }
  }
  if (!Number.isFinite(b.minX)) throw new Error('Collider has no positions');
  const floorY = bin ? colliderFloorY(buf, json, bin, b) : undefined;
  return floorY == null ? b : { ...b, floorY };
}

/**
 * The reconstruction's own floor plane, in raw units: the densest horizontal slab in the bottom
 * quarter of the collider mesh.
 *
 * Neither of the two numbers Marble hands over is that plane. `minY` is the mesh's lowest stray
 * vertex — a skirt a few centimetres under the floor (6 cm on the demo draft world). And
 * `ground_plane_offset` is a *different* plane again: on the reference build's full-quality world it
 * sits 15 cm above the mesh's floor, which is exactly why that build needed a floor-height slider to
 * make furniture stand on the photograph. The panorama's floor is the mesh's floor, and the
 * photograph is the ground truth, so this is the plane Audora maps to y = 0.
 *
 * Measured on both demo worlds: floor −1.5975 vs minY −1.6597 (draft corner room) and −0.6535 vs
 * −0.7308 with `ground_plane_offset` 1.3065 (full-quality flat). Using it puts the reconstruction's
 * floor on y = 0 in both, instead of 4 cm under it and 15 cm over it.
 */
function colliderFloorY(buf: ArrayBuffer, json: any, bin: { start: number; length: number }, b: WorldBounds): number | undefined {
  const span = b.maxY - b.minY;
  if (!(span > 0)) return undefined;
  const BINS = 200;
  const counts = new Int32Array(BINS);
  // Only the bottom quarter can be floor; everything above is walls, sills and ceiling.
  const cut = b.minY + span * 0.25;
  const dv = new DataView(buf, bin.start, bin.length);
  let seen = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const acc = json.accessors?.[prim.attributes?.POSITION];
      if (!acc || acc.componentType !== 5126 || acc.type !== 'VEC3') continue;
      const view = json.bufferViews?.[acc.bufferView];
      if (!view) continue;
      const stride = view.byteStride || 12;
      const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
      for (let i = 0; i < acc.count; i++) {
        const at = base + i * stride + 4; // y is the second float
        if (at + 4 > bin.length) break;
        const y = dv.getFloat32(at, true);
        if (y > cut) continue;
        counts[Math.min(BINS - 1, Math.max(0, Math.floor(((y - b.minY) / span) * BINS)))]++;
        seen++;
      }
    }
  }
  if (seen < 64) return undefined;
  let best = 0;
  for (let i = 1; i < BINS; i++) if (counts[i] > counts[best]) best = i;
  return b.minY + ((best + 0.5) / BINS) * span;
}

/**
 * Raw (unscaled) room geometry from a world's collider bounds. Marble's frame is y-up with the
 * camera at the origin and the room extending toward +z; Audora's frame puts the photographer's
 * doorway on the south wall, so the door is placed where the camera stood. Bounds include whatever
 * is visible through windows, so this is an estimate until the seller confirms a wall length.
 */
export function rawFromBounds(b: WorldBounds, ceilingRatio = { door: 2.03 / 2.44, outlet: 0.3 / 2.44 }): RawGeometry {
  const width = Math.max(0.5, b.maxX - b.minX);
  const depth = Math.max(0.5, b.maxZ - b.minZ);
  const height = Math.max(0.5, b.maxY - b.minY);
  const cx = (b.minX + b.maxX) / 2;
  // After the 180° turn into Audora's frame the camera sits at x = cx (raw units) from the room centre.
  const doorOffset = Math.min(width - 0.3, Math.max(0.3, cx + width / 2));
  return {
    width,
    depth,
    height,
    door: { wall: 'south', offset: doorOffset, width: Math.min(0.45 * height, width * 0.3), height: height * ceilingRatio.door },
    windows: [],
    doorHeightUnits: height * ceilingRatio.door,
    outletHeightUnits: height * ceilingRatio.outlet,
  };
}

export interface SplatTransform {
  /** Uniform scale from the provider's raw units to metres. */
  scale: number;
  /** Where the provider's origin — the capture point — lands in Audora's frame. */
  position: [number, number, number];
  rotationY: number;
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
 * The 180° turn about y is what makes the capture look the way Audora's rooms do (Marble's room
 * extends toward +z from the camera; ours extends toward -z from the south door). `position` is
 * also exactly where the capture point lands, so the photo view puts its camera there.
 *
 * The two ways a world knows its own size, handled the same way whether or not `bounds` are known:
 * - **Full quality** carries `metric_scale_factor` (raw units → metres) and `ground_plane_offset`
 *   (metres the capture point sits ABOVE the ground plane — already metric, so it is never
 *   multiplied by the scale). Verified against the reference build, which draws its collider at
 *   `position.y = -ground_plane_offset` with the camera left at the origin.
 * - **Draft** carries neither, so `metresPerUnit` comes from the room's anchor.
 *
 * The floor itself comes from `bounds.floorY` whenever the collider has been read — the mesh's own
 * floor plane, which is the one you can see in the panorama (see `fetchColliderBounds`). It beats
 * both `ground_plane_offset` (15 cm high on the full-quality demo world) and `bounds.minY` (4 cm low
 * on the draft one), which are the fallbacks in that order.
 *
 * `bounds`, when present, additionally centre the room on the origin in x/z. `floorOffset`
 * (`Room.floorOffset`, metres) raises the whole reconstruction so its floor meets ours; nothing in
 * the metric frame moves, so furniture keeps standing on y = 0.
 */
export function splatTransform(
  world: Pick<RoomWorld, 'metricScaleFactor' | 'groundPlaneOffset' | 'bounds'>,
  metresPerUnit: number,
  floorOffset = 0,
): SplatTransform {
  const msf = world.metricScaleFactor;
  const metric = msf != null && msf > 0;
  const s = metric ? (msf as number) : metresPerUnit > 0 ? metresPerUnit : 1;
  const b = world.bounds;
  // Height of the capture point above Audora's floor: the model's own estimate when it has one,
  // otherwise the drop from the camera to the lowest point of the collider.
  const captureY = b?.floorY != null ? -b.floorY * s : metric && world.groundPlaneOffset != null ? world.groundPlaneOffset : b ? -b.minY * s : 0;
  // p' = R(π)·(p − c)·s → x' = −(x − cx)s, z' = −(z − cz)s. A rotated group at `position` does this.
  const x = b ? ((b.minX + b.maxX) / 2) * s : 0;
  const z = b ? ((b.minZ + b.maxZ) / 2) * s : 0;
  return { scale: s, position: [x, captureY + floorOffset, z], rotationY: Math.PI, metric };
}

/**
 * `rawFromBounds`, unless the metric room that comes out of it is not a room at all. Marble's
 * collider includes whatever the model hallucinated through the windows, which for a full-quality
 * world of a flat can be twice the floor area; in that case the caller's estimate is the honest one.
 */
export function rawFromBoundsOr(bounds: WorldBounds | undefined, metresPerUnit: number, fallback: RawGeometry): RawGeometry {
  if (!bounds) return fallback;
  const raw = rawFromBounds(bounds);
  const g = applyScale(raw, metresPerUnit);
  const sane = plausibility(g).every((w) => w.severity !== 'error') && g.width * g.depth <= 80 && g.height >= 2.1 && g.height <= 3.6;
  return sane ? raw : fallback;
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
    const s = await api<{ nebius: boolean; marble: boolean; models: Record<string, string> }>('/api/status');
    return { ...s, checkedAt: Date.now() };
  } catch {
    return { nebius: false, marble: false, checkedAt: Date.now() };
  }
}

/** Kick off a Marble generation for a room photo. Returns immediately with the operation id. */
export async function startGeneration(room: Room, tier: Tier): Promise<{ operationId: string; worldId?: string }> {
  if (!room.photo) throw new Error('This room has no photo to reconstruct from.');
  const op = await api<MarbleOperation>('/api/marble/generate', {
    method: 'POST',
    body: JSON.stringify({ imageDataUrl: room.photo.dataUrl, tier, displayName: `Audora · ${room.name}` }),
  });
  return { operationId: op.operation_id, worldId: op.metadata?.world_id };
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

/** Convert a finished Marble world into Audora's RoomWorld. Pass collider bounds to derive raw room geometry from the world itself. */
export function worldFromMarble(room: Room, tier: Tier, w: MarbleWorld, credits?: number, seconds?: number, bounds?: WorldBounds): RoomWorld {
  const a = w.assets || {};
  const msf = a.splats?.semantics_metadata?.metric_scale_factor ?? null;
  const fallbackRaw = room.raw ?? mockRawGeometry(room.id, room.type);
  return {
    bounds,
    provider: 'marble',
    tier,
    worldId: w.world_id,
    model: w.model || (tier === 'draft' ? 'marble-1.0-draft' : 'marble-1.1'),
    createdAt: Date.now(),
    raw: rawFromBoundsOr(bounds, msf && msf > 0 ? msf : room.anchor?.metresPerUnit ?? 1, fallbackRaw),
    spzUrl: pickSpz(a.splats?.spz_urls),
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
  };
}
