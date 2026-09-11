/**
 * Marble ships every world as a ladder of Gaussian-splat files — the same room at 100k, 150k, 500k
 * or full resolution splats — and the renter should not have to wait for the big one to see the room.
 *
 * This module is the pure half of progressive loading: which files a world has, which of them this
 * device should ever load, and in what order. `SplatWorld` does the fetching and the cross-fade.
 *
 * Measured sizes (2026-09-06, `cdn.marble.worldlabs.ai`, CORS `*`):
 * corner room 100k 1.08 MB · 500k 5.10 MB · full_res 23.45 MB;
 * furnished flat 100k 1.16 MB · 150k 2.25 MB · 500k 7.46 MB.
 */
import type { RoomWorld } from '@/state/types';

/** Marble's own keys in `assets.splats.spz_urls`, plus `unknown` for a url we cannot classify. */
export type SplatTier = '100k' | '150k' | '500k' | '1m' | 'full_res' | 'unknown';

/** Smallest first. `unknown` sorts last: an unlabelled file is assumed to be the best one there is. */
export const TIER_ORDER: SplatTier[] = ['100k', '150k', '500k', '1m', 'full_res', 'unknown'];

/** Roughly how many splats each tier holds, for the "500k splats" chip before the file is decoded. */
export const TIER_SPLATS: Record<SplatTier, number> = { '100k': 100_000, '150k': 150_000, '500k': 500_000, '1m': 1_000_000, full_res: 2_000_000, unknown: 0 };

/** Renter-facing name of a tier. Numbers stay mono in the UI that renders them. */
export const TIER_LABEL: Record<SplatTier, string> = {
  '100k': '100k splats',
  '150k': '150k splats',
  '500k': '500k splats',
  '1m': '1m splats',
  full_res: 'full res',
  unknown: 'real capture',
};

export interface SplatAsset {
  tier: SplatTier;
  url: string;
  /** Content length in bytes when we know it up front (the demo worlds are measured). */
  bytes?: number;
}

export const tierRank = (t: SplatTier): number => TIER_ORDER.indexOf(t);

/**
 * The tier a key in `spz_urls` names.
 *
 * Two vocabularies reach this map. Marble's own is `100k` / `500k` / `full_res`, and a world read
 * straight off its CDN keeps it. But every world *we* copy — the backend worker (`spzName`,
 * server/worker.ts) and `npx audora generate` (`spzAssetName`, server/localGenerate.ts) — folds
 * `full_res` to **`full`** so the stored file can be called `spz-full.spz`. Without this alias that
 * rung classified as `unknown`, and `withinCeiling` drops `unknown`: the full-resolution splat was
 * downloaded, stored and served, and no device could ever load it.
 */
export function tierOfKey(key: string): SplatTier | null {
  const k = key.trim().toLowerCase();
  if (k === 'full' || k === 'fullres' || k === 'full-res') return 'full_res';
  return TIER_ORDER.includes(k as SplatTier) && k !== 'unknown' ? (k as SplatTier) : null;
}

/**
 * The tier a filename declares: Marble's `…_sand_100k.spz`, `…_ceramic_500k.spz`, `…_sand.spz`,
 * and our own `spz-100k.spz` / `spz-full.spz` — hence `[_-]`, since our copies join with a hyphen.
 */
export function tierOfUrl(url: string): SplatTier {
  const name = url.split('?')[0].toLowerCase();
  if (/[_-]full(?:[_-]?res)?\b/.test(name)) return 'full_res';
  if (/[_-]1m\b/.test(name)) return '1m';
  if (/[_-]500k\b/.test(name)) return '500k';
  if (/[_-]150k\b/.test(name)) return '150k';
  if (/[_-]100k\b/.test(name)) return '100k';
  return 'unknown';
}

const CORNER = 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b';
const FLAT = 'https://cdn.marble.worldlabs.ai/1580f9a1-2b19-4746-ad56-7ce3d4e5be60';

/**
 * The demo worlds' full ladders.
 *
 * A world generated today carries `spzUrls` — every resolution Marble made — and that map is what
 * this module reads. These two are the demo worlds, whose records predate the field and live in
 * localStorage on machines that have already seen them; listing them by `worldId` means an existing
 * browser climbs the same ladder as a fresh one. A world with neither still renders: its single
 * `spzUrl` is always in the ladder.
 */
export const KNOWN_SPZ_TIERS: Record<string, SplatAsset[]> = {
  '24be684c-177e-49c2-a920-51dcf51e4c8b': [
    { tier: '100k', url: `${CORNER}/82555d93-9c51-4722-91b3-30434886e586_sand_100k.spz`, bytes: 1_080_141 },
    { tier: '500k', url: `${CORNER}/fbabd791-dc74-4373-8d95-a08926570c67_sand_500k.spz`, bytes: 5_097_867 },
    { tier: 'full_res', url: `${CORNER}/8708139e-2578-4e82-baa7-294efcd6f2f3_sand.spz`, bytes: 23_451_874 },
  ],
  '1580f9a1-2b19-4746-ad56-7ce3d4e5be60': [
    { tier: '100k', url: `${FLAT}/9701d43b-70c2-4901-b03f-537a45f4df50_dust_100k.spz`, bytes: 1_164_018 },
    { tier: '150k', url: `${FLAT}/527cc6e9-0464-4f1b-9d0f-a0aadd55f719_ceramic_150k.spz`, bytes: 2_249_279 },
    { tier: '500k', url: `${FLAT}/e8599403-f224-4dd6-8c35-f7037fb3ddc6_ceramic_500k.spz`, bytes: 7_458_898 },
  ],
};

/** Every splat file this world has, smallest first, de-duplicated by url. */
export function spzTiers(world: Pick<RoomWorld, 'spzUrl' | 'spzUrls' | 'worldId'> | undefined): SplatAsset[] {
  if (!world?.spzUrl && !world?.worldId) return [];
  const out: SplatAsset[] = [];
  const seen = new Set<string>();
  const add = (a: SplatAsset) => {
    if (!a.url || seen.has(a.url)) return;
    seen.add(a.url);
    out.push(a);
  };
  const map = world.spzUrls;
  if (map) for (const [key, url] of Object.entries(map)) if (url) add({ tier: tierOfKey(key) ?? tierOfUrl(url), url });
  for (const known of KNOWN_SPZ_TIERS[world.worldId ?? ''] ?? []) add(known);
  if (world.spzUrl) add({ tier: tierOfUrl(world.spzUrl), url: world.spzUrl });
  return out.sort((a, b) => tierRank(a.tier) - tierRank(b.tier));
}

export interface DeviceHints {
  /** `navigator.deviceMemory` in GB, undefined outside Chromium. */
  deviceMemory?: number;
  /** `matchMedia('(pointer: coarse)')` — a phone or a tablet. */
  coarsePointer?: boolean;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
}

/** What this browser can tell us about the machine. Safe on a server and in tests. */
export function deviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  let coarse = false;
  try {
    coarse = typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia('(pointer: coarse)').matches : false;
  } catch {
    coarse = false;
  }
  return { deviceMemory: nav.deviceMemory, coarsePointer: coarse, cores: nav.hardwareConcurrency };
}

/**
 * The biggest tier this device is allowed to load.
 *
 * A phone has neither the memory for a 23 MB splat file nor the fill rate to sort it, and a laptop
 * with 4 GB reported is not far behind — both are capped at 500k. A small phone (coarse pointer and
 * ≤ 4 GB) stops at 150k, which is the tier Marble's own viewer serves handhelds. Everything else may
 * reach `full_res`, though only if it earns it (see {@link wantsUpgrade}).
 */
export function deviceCeiling(hints: DeviceHints = deviceHints()): SplatTier {
  const mem = hints.deviceMemory;
  if (hints.coarsePointer) return mem != null && mem <= 4 ? '150k' : '500k';
  if (mem != null && mem <= 4) return '500k';
  if (hints.cores != null && hints.cores <= 2) return '500k';
  return 'full_res';
}

/** Drop everything above the ceiling; keep the ceiling tier itself. */
export function withinCeiling(assets: SplatAsset[], ceiling: SplatTier): SplatAsset[] {
  const cap = tierRank(ceiling);
  const kept = assets.filter((a) => a.tier !== 'unknown' && tierRank(a.tier) <= cap);
  // A world whose only file is unlabelled (or is all above the cap) still has to render *something*.
  return kept.length ? kept : assets.slice(0, 1);
}

/** How long the previous tier may take before `full_res` is considered too expensive, in ms. */
export const UPGRADE_BUDGET_MS = 4000;

/**
 * The ladder the renter climbs: the smallest file first so the room appears within a second, then the
 * best tier at or below 500k. `full_res` is deliberately *not* in here — it is offered afterwards by
 * {@link wantsUpgrade}, once we have watched how fast this connection actually is.
 */
export function planLadder(assets: SplatAsset[], ceiling: SplatTier = deviceCeiling()): SplatAsset[] {
  const usable = withinCeiling(assets, ceiling);
  if (usable.length <= 1) return usable;
  const first = usable[0];
  const capped = tierRank(ceiling) < tierRank('500k') ? ceiling : '500k';
  const mid = [...usable].reverse().find((a) => tierRank(a.tier) <= tierRank(capped));
  return mid && mid.url !== first.url ? [first, mid] : [first];
}

/**
 * Whether to fetch the next tier up after `msSoFar` spent on the one that just landed. Full
 * resolution is a 23 MB download: worth it on a desktop that pulled 5 MB in under four seconds,
 * never worth it on a phone or a slow line, where it would cost the renter the walk they came for.
 */
export function wantsUpgrade(assets: SplatAsset[], current: SplatTier, msSoFar: number, ceiling: SplatTier = deviceCeiling(), budgetMs = UPGRADE_BUDGET_MS): SplatAsset | null {
  if (tierRank(ceiling) <= tierRank(current)) return null;
  if (msSoFar > budgetMs) return null;
  const next = withinCeiling(assets, ceiling).filter((a) => tierRank(a.tier) > tierRank(current));
  return next.length ? next[next.length - 1] : null;
}

/** "5.1 MB" for a chip. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1_000_000;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}
