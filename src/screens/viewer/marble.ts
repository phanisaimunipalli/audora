import type { Room, RoomWorld } from '@/state/types';
import type { ViewMode } from '@/three/viewerStore';
import type { MarbleLayer, MarbleWorldStatus } from '@/three/MarbleWorld';

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
 * TourViewer), so opening in Walk no longer costs the buyer the first eight seconds. A world with a
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
  tone: 'loading' | 'error';
  label: string;
  progress: number | null;
}

const LAYER_NAME = { pano: 'the panorama', collider: 'the geometry', splat: 'the real capture' } as const;

/** The last thing each layer of a reconstruction said about itself. */
export type MarbleStatusMap = Partial<Record<MarbleLayer, MarbleWorldStatus>>;

export const layerReady = (m: MarbleStatusMap, layer: MarbleLayer): boolean => m[layer]?.status === 'ready';
export const layerFailed = (m: MarbleStatusMap, layer: MarbleLayer): boolean => m[layer]?.status === 'error';
export const layerLoading = (m: MarbleStatusMap, layer: MarbleLayer): boolean => m[layer]?.status === 'loading';

function pillFor(s: MarbleWorldStatus | undefined): LoadPill | null {
  if (!s || s.status === 'idle' || s.status === 'ready') return null;
  const what = LAYER_NAME[s.layer];
  if (s.status === 'error') {
    return { tone: 'error', label: s.layer === 'pano' ? 'The panorama could not load · showing the measured room' : `Could not load ${what}`, progress: null };
  }
  const pct = s.progress?.ratio;
  return { tone: 'loading', label: pct != null ? `Loading ${what} · ${Math.round(pct * 100)}%` : `Loading ${what}…`, progress: pct ?? null };
}

/**
 * The one line the viewer shows about a still-loading reconstruction. The panorama speaks first
 * (it is what the buyer is looking at), then the splat; the collider is a background nicety and
 * never owns the status line. Returns null once everything asked for is on screen — a black canvas
 * with no explanation is the bug this exists to prevent.
 */
export function loadPill(m: MarbleStatusMap): LoadPill | null {
  return pillFor(m.pano) ?? pillFor(m.splat);
}
