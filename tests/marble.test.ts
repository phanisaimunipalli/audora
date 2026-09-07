import { describe, expect, it, vi } from 'vitest';
import {
  panoUrlOf,
  rawFromBounds,
  rawFromBoundsOr,
  splatTransform,
  waitForPano,
  type MarbleWorld,
  type WorldBounds,
} from '../src/services/marble';
import { applyScale } from '../src/engine/anchor';
import type { RawGeometry } from '../src/engine/types';

/** The demo corner room: a real Marble draft, no metric semantics. Floor 1.66 units below the camera. */
const DRAFT_BOUNDS: WorldBounds = { minX: -3.599, maxX: 4.233, minY: -1.66, maxY: 1.893, minZ: -1.552, maxZ: 5.777 };
/** The reference build's full-quality world: measured by the model itself. */
const FULL = { metricScaleFactor: 2.2239592, groundPlaneOffset: 1.3064681 };
const FULL_BOUNDS: WorldBounds = { minX: -2.2447433, maxX: 2.5200922, minY: -0.7307867, maxY: 0.6124634, minZ: -3.1248181, maxZ: 2.7291245 };

describe('splatTransform', () => {
  it('scales a draft world by the anchor and stands its collider floor on y=0', () => {
    const mpu = 2.44 / (DRAFT_BOUNDS.maxY - DRAFT_BOUNDS.minY); // assumed ceiling anchor
    const t = splatTransform({ metricScaleFactor: null, groundPlaneOffset: null, bounds: DRAFT_BOUNDS }, mpu);
    expect(t.metric).toBe(false);
    expect(t.scale).toBeCloseTo(mpu, 6);
    expect(t.rotationY).toBeCloseTo(Math.PI, 6);
    // The capture point ends up exactly the collider's floor drop above our floor.
    expect(t.position[1]).toBeCloseTo(-DRAFT_BOUNDS.minY * mpu, 6);
    // ...and the room centre lands on the origin once the frame's `(x, z) → (x, −z)` is applied.
    const cx = ((DRAFT_BOUNDS.minX + DRAFT_BOUNDS.maxX) / 2) * mpu;
    const cz = ((DRAFT_BOUNDS.minZ + DRAFT_BOUNDS.maxZ) / 2) * mpu;
    expect(cx + t.position[0]).toBeCloseTo(0, 6);
    expect(-cz + t.position[2]).toBeCloseTo(0, 6);
  });

  it('prefers the model semantics over the anchor and over the collider bounds', () => {
    const t = splatTransform({ ...FULL, bounds: FULL_BOUNDS }, 0.6867);
    expect(t.metric).toBe(true);
    expect(t.scale).toBeCloseTo(FULL.metricScaleFactor, 6);
    // ground_plane_offset is already metric: the capture point sits that far above our floor,
    // which is NOT the same as the collider's lowest point (it dips below the ground plane).
    expect(t.position[1]).toBeCloseTo(FULL.groundPlaneOffset, 6);
    expect(t.position[1]).not.toBeCloseTo(-FULL_BOUNDS.minY * FULL.metricScaleFactor, 2);
  });

  it("stands a draft world's own mesh floor on y=0 when the collider has been read", () => {
    // `floorY` is the densest horizontal slab of the collider — 6 cm above minY on the draft world.
    // With no ground plane published it is the best floor there is, and it beats minY.
    const draft = splatTransform({ metricScaleFactor: null, groundPlaneOffset: null, bounds: { ...DRAFT_BOUNDS, floorY: -1.5975 } }, 0.6867);
    expect(draft.position[1]).toBeCloseTo(1.5975 * 0.6867, 6);
    expect(draft.position[1]).not.toBeCloseTo(-DRAFT_BOUNDS.minY * 0.6867, 3);
  });

  it("keeps the model's own ground plane over the collider's floor slab on a full-quality world", () => {
    /* Measured against the world's Gaussians rather than against its mesh (tests/tmp probe,
       2026-09-06): the flat's splat floor is at y_spz 0.581, so with `ground_plane_offset` it lands
       1.2 cm above y = 0 and with the collider's floor slab (−0.6544) 16 cm above it — which is what
       made the plant look sunk into the photographed floorboards. Where Marble publishes metric
       semantics they win. */
    const full = splatTransform({ ...FULL, bounds: { ...FULL_BOUNDS, floorY: -0.6544 } }, 1);
    expect(full.position[1]).toBeCloseTo(FULL.groundPlaneOffset, 6);
    expect(full.position[1]).not.toBeCloseTo(0.6544 * FULL.metricScaleFactor, 2);
    const SPLAT_FLOOR_SPZ_Y = 0.5809; // densest slab of the 500k SPZ, y-down frame
    expect(-SPLAT_FLOOR_SPZ_Y * FULL.metricScaleFactor + full.position[1]).toBeCloseTo(0, 1);
  });

  it('is consistent with and without bounds: same scale, same capture height, centre only from bounds', () => {
    const withB = splatTransform({ ...FULL, bounds: FULL_BOUNDS }, 1);
    const withoutB = splatTransform({ ...FULL }, 1);
    expect(withoutB.scale).toBeCloseTo(withB.scale, 6);
    expect(withoutB.position[1]).toBeCloseTo(withB.position[1], 6);
    expect(withoutB.position[0]).toBe(0);
    expect(withoutB.position[2]).toBe(0);
    expect(withB.position[0]).not.toBe(0);
  });

  it('falls back to the anchor scale and a floor at y=0 when the world knows nothing', () => {
    const t = splatTransform({ metricScaleFactor: null, groundPlaneOffset: null }, 0.7);
    expect(t.scale).toBeCloseTo(0.7, 6);
    expect(t.position).toEqual([0, 0, 0]);
    expect(t.metric).toBe(false);
  });

  it('raises the whole reconstruction by the room floor nudge', () => {
    const base = splatTransform({ ...FULL, bounds: FULL_BOUNDS }, 1);
    const nudged = splatTransform({ ...FULL, bounds: FULL_BOUNDS }, 1, 0.12);
    expect(nudged.position[1] - base.position[1]).toBeCloseTo(0.12, 6);
    expect(nudged.position[0]).toBeCloseTo(base.position[0], 6);
    expect(nudged.scale).toBeCloseTo(base.scale, 6);
  });
});

describe('rawFromBoundsOr', () => {
  const fallback: RawGeometry = {
    width: 2.473,
    depth: 1.798,
    height: 1.214,
    door: { wall: 'south', offset: 1.236, width: 0.387, height: 0.913 },
    windows: [],
    doorHeightUnits: 0.913,
    outletHeightUnits: 0.135,
  };

  it('keeps a plausible room from the collider', () => {
    const mpu = 2.44 / (DRAFT_BOUNDS.maxY - DRAFT_BOUNDS.minY);
    const raw = rawFromBoundsOr(DRAFT_BOUNDS, mpu, fallback);
    expect(raw).toEqual(rawFromBounds(DRAFT_BOUNDS));
    const g = applyScale(raw, mpu);
    expect(g.height).toBeCloseTo(2.44, 2);
  });

  it('rejects a collider that describes more than a room', () => {
    // The full-quality collider covers 138 m² — everything the model imagined through the doors.
    const raw = rawFromBoundsOr(FULL_BOUNDS, FULL.metricScaleFactor, fallback);
    expect(raw).toBe(fallback);
    const g = applyScale(raw, FULL.metricScaleFactor);
    expect(g.width).toBeCloseTo(5.5, 2);
    expect(g.depth).toBeCloseTo(4.0, 2);
    expect(g.height).toBeCloseTo(2.7, 2);
  });

  it('falls back when there are no bounds at all', () => {
    expect(rawFromBoundsOr(undefined, 2, fallback)).toBe(fallback);
  });
});

describe('waitForPano', () => {
  const world = (pano?: string): MarbleWorld => ({ world_id: 'w1', assets: pano ? { imagery: { pano_url: pano } } : { splats: {} } });

  /** A clock that only moves when something sleeps, so the poll loop is deterministic. */
  function fakeClock() {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  }

  it('returns immediately when the panorama is already there', async () => {
    const getWorld = vi.fn();
    const w = await waitForPano('w1', world('https://cdn/pano.png'), { getWorld });
    expect(panoUrlOf(w)).toBe('https://cdn/pano.png');
    expect(getWorld).not.toHaveBeenCalled();
  });

  it('polls every 2.5s until the panorama lands', async () => {
    const clock = fakeClock();
    const getWorld = vi
      .fn()
      .mockResolvedValueOnce(world())
      .mockResolvedValueOnce(world())
      .mockResolvedValueOnce(world('https://cdn/late.png'));
    const onAttempt = vi.fn();
    const w = await waitForPano('w1', world(), { ...clock, getWorld, onAttempt });
    expect(panoUrlOf(w)).toBe('https://cdn/late.png');
    expect(getWorld).toHaveBeenCalledTimes(3);
    expect(onAttempt).toHaveBeenLastCalledWith(3, 7500); // 3 × 2.5 s
  });

  it('gives up after a minute and hands back the last world it saw', async () => {
    const clock = fakeClock();
    const getWorld = vi.fn().mockResolvedValue(world());
    const w = await waitForPano('w1', undefined, { ...clock, getWorld });
    expect(panoUrlOf(w)).toBeUndefined();
    expect(w?.world_id).toBe('w1');
    expect(getWorld).toHaveBeenCalledTimes(24); // 60 s / 2.5 s
    expect(clock.now()).toBe(60_000);
  });

  it('survives a failing poll and keeps trying', async () => {
    const clock = fakeClock();
    const getWorld = vi.fn().mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce(world('https://cdn/after-error.png'));
    const w = await waitForPano('w1', world(), { ...clock, getWorld });
    expect(panoUrlOf(w)).toBe('https://cdn/after-error.png');
    expect(getWorld).toHaveBeenCalledTimes(2);
  });
});
