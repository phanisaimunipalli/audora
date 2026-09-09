import type { RawGeometry, RoomType, WallSide } from '@/engine/types';
import { fnv1a, mulberry32 } from '@/lib/ids';
import type { Room, RoomWorld, Tier } from '@/state/types';

/** Plausible metric ranges per room type, used to shape a deterministic mock reconstruction. */
const RANGES: Record<RoomType, { w: [number, number]; d: [number, number] }> = {
  living: { w: [3.6, 5.6], d: [4.0, 6.2] },
  bedroom: { w: [3.0, 4.4], d: [3.2, 4.8] },
  kitchen: { w: [2.8, 4.2], d: [3.2, 5.0] },
  dining: { w: [3.2, 4.6], d: [3.4, 5.0] },
  bathroom: { w: [1.9, 2.8], d: [2.2, 3.2] },
  office: { w: [2.8, 3.8], d: [3.0, 4.2] },
  hallway: { w: [1.3, 2.0], d: [3.0, 5.0] },
  studio: { w: [4.4, 6.0], d: [5.0, 7.2] },
  other: { w: [3.0, 4.8], d: [3.2, 5.4] },
};

/**
 * A deterministic, unscaled room derived from a seed (normally the photo bytes).
 * Units are arbitrary: the door is exactly 1 unit tall, so a door anchor yields 2.03 m/unit.
 * Marble returns geometry "up to scale" too; this keeps the mock honest about that.
 *
 * `metres` overrides the size the ranges above would have drawn, for a room whose real dimensions
 * are already known and are outside them — the demo unit's 7.00 × 1.20 m corridor is not a shape
 * {@link RANGES} can produce for any seed. The random draws still happen in the same order, so
 * every other number a seed gives (the door's width and offset, the windows) is unchanged.
 */
export function mockRawGeometry(seed: string, type: RoomType, metres?: { width?: number; depth?: number; height?: number }): RawGeometry {
  const rng = mulberry32(fnv1a(seed));
  const r = RANGES[type] ?? RANGES.other;
  const doorM = 2.03;
  const drawnWidth = r.w[0] + rng() * (r.w[1] - r.w[0]);
  const drawnDepth = r.d[0] + rng() * (r.d[1] - r.d[0]);
  const drawnHeight = 2.4 + rng() * 0.5;
  const widthM = metres?.width && metres.width > 0 ? metres.width : drawnWidth;
  const depthM = metres?.depth && metres.depth > 0 ? metres.depth : drawnDepth;
  const heightM = metres?.height && metres.height > 0 ? metres.height : drawnHeight;
  const doorWidthM = 0.82 + rng() * 0.12;
  const u = (m: number) => m / doorM;
  const doorOffsetM = 0.6 + rng() * Math.max(0.2, widthM - 1.2);
  const windows: RawGeometry['windows'] = [];
  const winWalls: WallSide[] = ['north', 'east', 'west'];
  const count = type === 'hallway' ? 0 : 1 + (rng() > 0.55 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const wall = winWalls[Math.floor(rng() * winWalls.length)];
    const len = wall === 'north' ? widthM : depthM;
    const w = Math.min(len - 0.8, 1.2 + rng() * 1.2);
    windows.push({ wall, offset: u(0.4 + w / 2 + rng() * Math.max(0, len - w - 0.8)), width: u(w), height: u(1.1 + rng() * 0.5), sill: u(0.8 + rng() * 0.25) });
  }
  return {
    width: u(widthM),
    depth: u(depthM),
    height: u(heightM),
    door: { wall: 'south', offset: u(doorOffsetM), width: u(doorWidthM), height: 1 },
    windows,
    doorHeightUnits: 1,
    outletHeightUnits: u(0.3),
  };
}

const CAPTIONS: Record<RoomType, string[]> = {
  living: ['A bright, empty living room with pale walls and a large window.', 'An empty living space with wood floors and afternoon light.'],
  bedroom: ['An empty bedroom with a window on the far wall.', 'A quiet, unfurnished bedroom with soft light.'],
  kitchen: ['An open kitchen with an empty floor and counters along one wall.'],
  dining: ['An empty dining room with space for a table of six.'],
  bathroom: ['A compact bathroom.'],
  office: ['A small empty room that would suit a desk under the window.'],
  hallway: ['A narrow hallway.'],
  studio: ['An open studio with a sleeping nook and a living area.'],
  other: ['An empty room with neutral walls.'],
};

export const TIER_INFO: Record<Tier, { label: string; usd: number; credits: number; realSeconds: number; blurb: string }> = {
  draft: { label: 'Draft', usd: 0.18, credits: 230, realSeconds: 60, blurb: 'A first look in about a minute. Good enough to anchor and stage.' },
  full: { label: 'Full', usd: 1.26, credits: 1580, realSeconds: 600, blurb: 'Listing quality. Takes around ten minutes. We will tell you when it is done.' },
};

export function mockWorld(room: Room, tier: Tier, seconds: number): RoomWorld {
  const raw = room.raw ?? mockRawGeometry(room.id, room.type);
  const rng = mulberry32(fnv1a(room.id + tier));
  const caps = CAPTIONS[room.type] ?? CAPTIONS.other;
  return {
    provider: 'mock',
    tier,
    worldId: `mock_${tier}_${room.id.slice(-6)}`,
    model: tier === 'draft' ? 'mock-draft (simulated marble-1.0-draft)' : 'mock-full (simulated marble-1.1)',
    createdAt: Date.now(),
    raw,
    caption: caps[Math.floor(rng() * caps.length)],
    metricScaleFactor: 2.03 * (0.94 + rng() * 0.12),
    groundPlaneOffset: 0,
    credits: TIER_INFO[tier].credits,
    usd: TIER_INFO[tier].usd,
    seconds,
  };
}
