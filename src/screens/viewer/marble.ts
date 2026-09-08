import type { Room, RoomWorld } from '@/state/types';
import type { ViewMode } from '@/three/viewerStore';
import type { MarbleLayer, MarbleWorldStatus } from '@/three/MarbleWorld';
import { TIER_LABEL, type SplatTier } from '@/three/splat/tiers';

/** A world we can render photoreally: it has at least a panorama or a splat. */
export function isReal(world: RoomWorld | undefined): world is RoomWorld {
  return Boolean(world && (world.panoUrl || world.spzUrl));
}

export function hasPano(world: RoomWorld | undefined): boolean {
  return Boolean(world?.panoUrl);
}

export function hasSplat(world: RoomWorld | undefined): boolean {
  return Boolean(world?.spzUrl);
}

/**
 * Where a room opens.
 *
 * ARCHITECTURE's 2026-09-06 priority update settles this: "Walk mode is the default public
 * experience when a splat exists", because a Gaussian splat is photoreal *and* walkable and that is
 * the most real thing Audora can show. The panorama is the instant backdrop while it streams (see
 * MarbleWorld), so opening in Walk no longer costs the renter the first eight seconds. A world with a
 * panorama but no splat still opens in Photo — it is the only photoreal thing it has — and a
 * simulated room opens walking.
 */
export function defaultMode(world: RoomWorld | undefined, publicMode: boolean): ViewMode {
  if (!publicMode) return 'orbit';
  if (hasSplat(world)) return 'walk';
  return hasPano(world) ? 'photo' : 'walk';
}

/** Keeps the current mode legal for a room: photo needs a panorama. */
export function allowedMode(mode: ViewMode, world: RoomWorld | undefined): ViewMode {
  return mode === 'photo' && !hasPano(world) ? 'walk' : mode;
}

/** Metres the reconstruction is nudged up so its floor meets ours. */
export function floorOffsetOf(room: Room | undefined): number {
  const v = room?.floorOffset;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Analytics label for a mode. */
export const MODE_LABEL: Record<ViewMode, string> = { photo: 'photo', walk: 'walk', orbit: 'dollhouse' };

export interface LoadPill {
  /** `info` is a settled statement about what is on screen, not a wait. */
  tone: 'loading' | 'error' | 'info';
  label: string;
  progress: number | null;
}

const LAYER_NAME = { pano: 'the panorama', collider: 'the geometry', splat: 'the real capture' } as const;

/** The last thing each layer of a reconstruction said about itself. */
export type MarbleStatusMap = Partial<Record<MarbleLayer, MarbleWorldStatus>>;

export const layerReady = (m: MarbleStatusMap, layer: MarbleLayer): boolean => m[layer]?.status === 'ready';
export const layerFailed = (m: MarbleStatusMap, layer: MarbleLayer): boolean => m[layer]?.status === 'error';
export const layerLoading = (m: MarbleStatusMap, layer: MarbleLayer): boolean => m[layer]?.status === 'loading';

/** The splat resolution on screen, if any. */
export const splatTier = (m: MarbleStatusMap): SplatTier | undefined => (layerReady(m, 'splat') ? m.splat?.tier : undefined);

/**
 * "real capture · 500k splats" — what the renter is actually looking at. The splat count wins over
 * the tier name because during an upgrade the tier being fetched is not the one on screen; the count
 * always is.
 */
export function captureLabel(m: MarbleStatusMap): string | null {
  const s = m.splat;
  if (!s || (s.status !== 'ready' && !s.splats)) return null;
  const tier = s.tier && s.tier !== 'unknown' && s.status === 'ready' && !s.upgrading ? TIER_LABEL[s.tier] : null;
  const counted = s.splats ? `${Math.round(s.splats / 1000)}k splats` : null;
  const detail = counted ?? tier;
  return detail ? `real capture · ${detail}` : 'real capture';
}

function pillFor(s: MarbleWorldStatus | undefined): LoadPill | null {
  if (!s || s.status === 'idle' || s.status === 'ready') return null;
  const what = LAYER_NAME[s.layer];
  if (s.status === 'error') {
    return { tone: 'error', label: s.layer === 'pano' ? 'The panorama could not load · showing the measured room' : `Could not load ${what}`, progress: null };
  }
  const pct = s.progress?.ratio;
  const tier = s.layer === 'splat' && s.tier && s.tier !== 'unknown' ? ` · ${TIER_LABEL[s.tier]}` : '';
  return { tone: 'loading', label: pct != null ? `Loading ${what}${tier} · ${Math.round(pct * 100)}%` : `Loading ${what}${tier}…`, progress: pct ?? null };
}

/**
 * The one line the viewer shows about a reconstruction.
 *
 * While something is still coming down it is a wait ("Loading the real capture · 100k splats ·
 * 62%"); the panorama speaks first, because it is what the renter is looking at. Once a tier is on
 * screen and a better one is streaming behind it the line becomes a statement — "real capture · 500k
 * splats · full res loading…" — which is the honest answer to "is this a photograph?" and the reason
 * a viewer waiting for full resolution never wonders whether anything is happening. Returns null
 * only when everything asked for has arrived; the collider is a background nicety and never owns the
 * line.
 */
export function loadPill(m: MarbleStatusMap): LoadPill | null {
  const splat = m.splat;
  // A better tier is streaming behind the one the renter is already standing in.
  if (splat?.upgrading && (splat.status === 'ready' || splat.splats)) {
    const to = splat.upgrading === 'unknown' ? 'a sharper capture' : TIER_LABEL[splat.upgrading];
    return { tone: 'info', label: `${captureLabel(m) ?? 'real capture'} · ${to} loading…`, progress: splat.progress?.ratio ?? null };
  }
  // A splat already on screen makes the panorama's own progress irrelevant: it is only the backdrop.
  if (splat?.status === 'ready') return null;
  return pillFor(m.pano) ?? pillFor(m.splat);
}
