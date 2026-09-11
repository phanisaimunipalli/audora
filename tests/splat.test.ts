import { describe, expect, it } from 'vitest';
import { deviceCeiling, planLadder, spzTiers, tierOfUrl, wantsUpgrade, withinCeiling, type SplatAsset } from '../src/three/splat/tiers';
import { marbleFrame } from '../src/three/splat/frame';
import { loadSpz } from '../src/three/splat/loadSpz';
import { allowedMode, captureLabel, defaultMode, loadPill, type MarbleStatusMap } from '../src/screens/viewer/marble';
import { splatTransform } from '../src/services/marble';

const CORNER_ID = '24be684c-177e-49c2-a920-51dcf51e4c8b';
const FLAT_ID = '1580f9a1-2b19-4746-ad56-7ce3d4e5be60';

describe('spz tiers', () => {
  it('reads the tier out of a Marble filename', () => {
    expect(tierOfUrl('https://cdn/x/abc_sand_100k.spz')).toBe('100k');
    expect(tierOfUrl('https://cdn/x/abc_ceramic_150k.spz')).toBe('150k');
    expect(tierOfUrl('https://cdn/x/abc_ceramic_500k.spz')).toBe('500k');
    expect(tierOfUrl('https://cdn/x/abc_sand_full_res.spz')).toBe('full_res');
    expect(tierOfUrl('https://cdn/x/abc_sand.spz')).toBe('unknown');
  });

  it('knows the whole ladder of both demo worlds, smallest first', () => {
    const corner = spzTiers({ worldId: CORNER_ID, spzUrl: `https://cdn.marble.worldlabs.ai/${CORNER_ID}/fbabd791-dc74-4373-8d95-a08926570c67_sand_500k.spz` });
    expect(corner.map((a) => a.tier)).toEqual(['100k', '500k', 'full_res']);
    const flat = spzTiers({ worldId: FLAT_ID, spzUrl: 'https://cdn/x/e8599403_ceramic_500k.spz' });
    // the record's own url is kept even when it is not one of the known files
    expect(flat.map((a) => a.tier)).toEqual(['100k', '150k', '500k', '500k']);
  });

  it('falls back to whatever single file a live world carries', () => {
    const live = spzTiers({ worldId: 'brand-new', spzUrl: 'https://cdn/x/zzz_ceramic_500k.spz' });
    expect(live).toEqual([{ tier: '500k', url: 'https://cdn/x/zzz_ceramic_500k.spz' }]);
    expect(spzTiers(undefined)).toEqual([]);
  });

  it('reads an spzUrls map off the world record when one is there', () => {
    const world = { worldId: 'later', spzUrl: 'https://cdn/x/a_500k.spz', spzUrls: { '100k': 'https://cdn/x/a_100k.spz', full_res: 'https://cdn/x/a.spz' } };
    expect(spzTiers(world as never).map((a) => a.tier)).toEqual(['100k', '500k', 'full_res']);
  });

  /**
   * The ladder of a world *we* copied. `spzName` (server/worker.ts) and `spzAssetName`
   * (server/localGenerate.ts) fold Marble's `full_res` key to `full` and store the object as
   * `spz-full.spz`; that rung is the same 23 MB file and has to reach the renter who earned it.
   */
  it('climbs the ladder of a world we copied ourselves, whose top rung is keyed `full`', () => {
    const base = 'https://db.audora.dev/storage/v1/object/public/worlds/w1';
    const world = { worldId: 'copied', spzUrl: `${base}/spz-500k.spz`, spzUrls: { '100k': `${base}/spz-100k.spz`, '500k': `${base}/spz-500k.spz`, full: `${base}/spz-full.spz` } };
    const ladder = spzTiers(world as never);
    expect(ladder.map((a) => a.tier)).toEqual(['100k', '500k', 'full_res']);
    // The renter still opens on the smallest file and climbs to 500k...
    expect(planLadder(ladder, 'full_res').map((a) => a.tier)).toEqual(['100k', '500k']);
    // ...and a desktop that earned the upgrade is offered the big one, where a phone is not.
    expect(wantsUpgrade(ladder, '500k', 1500, 'full_res')?.url).toBe(`${base}/spz-full.spz`);
    expect(wantsUpgrade(ladder, '500k', 1500, '500k')).toBeNull();
  });

  it('reads `spz-full.spz` as full res, and never "full" inside another word', () => {
    expect(tierOfUrl('https://cdn/x/spz-full.spz')).toBe('full_res');
    expect(tierOfUrl('https://cdn/x/abc_sand_full.spz')).toBe('full_res');
    expect(tierOfUrl('https://cdn/x/spz-full.spz?token=abc')).toBe('full_res');
    expect(tierOfUrl('https://cdn/x/spz-fullscreen.spz')).toBe('unknown');
    expect(tierOfUrl('https://cdn/x/9be4full.spz')).toBe('unknown');
  });
});

describe('what a device may load', () => {
  it('caps phones and small machines', () => {
    expect(deviceCeiling({ coarsePointer: true, deviceMemory: 4 })).toBe('150k');
    expect(deviceCeiling({ coarsePointer: true, deviceMemory: 8 })).toBe('500k');
    expect(deviceCeiling({ coarsePointer: false, deviceMemory: 4 })).toBe('500k');
    expect(deviceCeiling({ coarsePointer: false, cores: 2 })).toBe('500k');
    expect(deviceCeiling({ coarsePointer: false, deviceMemory: 8, cores: 10 })).toBe('full_res');
    expect(deviceCeiling({})).toBe('full_res');
  });

  it('never returns nothing to render, even when everything is above the cap', () => {
    const only: SplatAsset[] = [{ tier: 'full_res', url: 'u' }];
    expect(withinCeiling(only, '150k')).toEqual(only);
  });
});

describe('the progressive ladder', () => {
  const corner = spzTiers({ worldId: CORNER_ID, spzUrl: `https://cdn.marble.worldlabs.ai/${CORNER_ID}/fbabd791_sand_500k.spz` });

  it('starts small and stops at 500k — full res is earned, never planned', () => {
    expect(planLadder(corner, 'full_res').map((a) => a.tier)).toEqual(['100k', '500k']);
    expect(planLadder(corner, '500k').map((a) => a.tier)).toEqual(['100k', '500k']);
    expect(planLadder(corner, '150k').map((a) => a.tier)).toEqual(['100k']);
  });

  it('upgrades to full res only on a machine that has earned it', () => {
    expect(wantsUpgrade(corner, '500k', 1800, 'full_res')?.tier).toBe('full_res');
    expect(wantsUpgrade(corner, '500k', 9000, 'full_res')).toBeNull();
    expect(wantsUpgrade(corner, '500k', 1800, '500k')).toBeNull();
    expect(wantsUpgrade(corner, 'full_res', 100, 'full_res')).toBeNull();
  });
});

describe('the metric frame of a real capture', () => {
  // The demo corner room's collider, as measured from the .glb (raw units, y up in the delivered
  // frame). scale ≈ 0.687 m/unit from the room's assumed-ceiling anchor.
  const bounds = { minX: -0.85, maxX: 3.5236, minY: -1.66, maxY: 1.8928, minZ: -1.2867, maxZ: 4.6218, floorY: -1.5953 };
  const mpu = 0.6868;

  /**
   * The composed map every real layer obeys: the group turns π about y and the collider is mirrored
   * back in x, which comes to `p_world = position + scale · (x, y, −z)` on a delivered collider
   * point. The room's own centre must land on Audora's origin, or our furniture stands off the wall
   * it was placed against.
   */
  const toWorld = (t: ReturnType<typeof marbleFrame>, x: number, y: number, z: number) => [t.position[0] + t.scale * x, t.position[1] + t.scale * y, t.position[2] - t.scale * z];

  it('centres the photographed room on the metric room', () => {
    const t = marbleFrame({ metricScaleFactor: null, groundPlaneOffset: null, bounds }, mpu);
    const [cx, , cz] = toWorld(t, (bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    expect(cx).toBeCloseTo(0, 6);
    expect(cz).toBeCloseTo(0, 6);
  });

  it('puts the reconstruction floor on y = 0, and the nudge above it', () => {
    const t = marbleFrame({ metricScaleFactor: null, groundPlaneOffset: null, bounds }, mpu);
    expect(toWorld(t, 0, bounds.floorY, 0)[1]).toBeCloseTo(0, 6);
    const nudged = marbleFrame({ metricScaleFactor: null, groundPlaneOffset: null, bounds }, mpu, 0.05);
    expect(toWorld(nudged, 0, bounds.floorY, 0)[1]).toBeCloseTo(0.05, 6);
  });

  it('is the service transform: one frame, one place it is derived', () => {
    const t = marbleFrame({ metricScaleFactor: null, groundPlaneOffset: null, bounds }, mpu);
    const s = splatTransform({ metricScaleFactor: null, groundPlaneOffset: null, bounds }, mpu);
    expect(t).toEqual(s);
  });

  it('turns the capture by the room\'s own yaw when the walls were measured', () => {
    const walls = { minX: -0.85, maxX: 3.5236, minZ: -1.2867, maxZ: 4.6218, rotation: 0.8203, score: 0.8 };
    const t = marbleFrame({ metricScaleFactor: null, groundPlaneOffset: null, bounds: { ...bounds, walls, method: 'walls' as const } }, mpu);
    // 47° off Marble's axes, so the room is turned 43° the other way and the group carries π + 43°.
    expect((t.yaw * 180) / Math.PI).toBeCloseTo(43, 1);
    expect(t.rotationY).toBeCloseTo(Math.PI + t.yaw, 12);
    // The capture point ends up inside the 3.00 × 4.06 m room, near the wall it came through.
    expect(Math.abs(t.position[0])).toBeLessThan(1.51);
    expect(Math.abs(t.position[2])).toBeLessThan(2.04);
  });

  it('keeps the capture point at the world origin of the capture', () => {
    // A full-quality world scales itself; the capture point is still where the camera stood.
    const t = marbleFrame({ metricScaleFactor: 2.2239592, groundPlaneOffset: 1.3064681, bounds: undefined }, 1);
    expect(t.scale).toBeCloseTo(2.2239592, 6);
    expect(t.position[0]).toBeCloseTo(0, 9);
    expect(t.position[1]).toBeCloseTo(1.3064681, 9);
    expect(t.position[2]).toBeCloseTo(0, 9);
  });
});

describe('what the viewer says about a capture', () => {
  it('waits on the panorama first, then names the tier it is streaming', () => {
    expect(loadPill({ pano: { layer: 'pano', status: 'loading', progress: { loaded: 1, total: 2, ratio: 0.5 } } })?.label).toBe('Loading the panorama · 50%');
    expect(loadPill({ splat: { layer: 'splat', status: 'loading', tier: '100k', progress: { loaded: 1, total: 4, ratio: 0.25 } } })?.label).toBe('Loading the real capture · 100k splats · 25%');
  });

  it('turns into a statement once the buyer is standing in it', () => {
    const m: MarbleStatusMap = { splat: { layer: 'splat', status: 'ready', tier: '500k', splats: 497664, upgrading: 'full_res' } };
    expect(captureLabel(m)).toBe('real capture · 498k splats');
    expect(loadPill(m)).toEqual({ tone: 'info', label: 'real capture · 498k splats · full res loading…', progress: null });
    // ...and during the upgrade's own download, the line still names what is on screen
    const during: MarbleStatusMap = { splat: { layer: 'splat', status: 'loading', tier: 'full_res', splats: 497664, upgrading: 'full_res', progress: { loaded: 1, total: 2, ratio: 0.5 } } };
    expect(loadPill(during)).toEqual({ tone: 'info', label: 'real capture · 498k splats · full res loading…', progress: 0.5 });
  });

  it('says nothing once everything asked for is on screen', () => {
    expect(loadPill({ splat: { layer: 'splat', status: 'ready', tier: '500k', splats: 497664, upgrading: null }, pano: { layer: 'pano', status: 'loading' } })).toBeNull();
    expect(loadPill({})).toBeNull();
  });

  it('falls back to the measured room when the panorama fails', () => {
    const pill = loadPill({ pano: { layer: 'pano', status: 'error', detail: '404' } });
    expect(pill?.tone).toBe('error');
    expect(pill?.label).toMatch(/showing the measured room/);
  });

  it('opens a splat world walking and a panorama-only world in the photograph', () => {
    const splat = { spzUrl: 'https://cdn/x_500k.spz' } as never;
    const pano = { panoUrl: 'https://cdn/x/rgb_0.png' } as never;
    expect(defaultMode(splat, true)).toBe('walk');
    expect(defaultMode(pano, true)).toBe('photo');
    expect(defaultMode(undefined, true)).toBe('walk');
    expect(defaultMode(splat, false)).toBe('orbit');
    expect(allowedMode('photo', splat)).toBe('walk');
    expect(allowedMode('photo', pano)).toBe('photo');
  });
});

describe('loading a splat file', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  it('reports byte progress and returns the file', async () => {
    const seen: number[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 4));
        c.enqueue(bytes.slice(4));
        c.close();
      },
    });
    const res = { ok: true, headers: new Headers({ 'content-length': '8' }), body: stream } as unknown as Response;
    const file = await loadSpz('https://cdn/x.spz', { fetchImpl: async () => res, onProgress: (p) => seen.push(p.ratio ?? -1) });
    expect(Array.from(file.bytes)).toEqual(Array.from(bytes));
    expect(seen).toEqual([0.5, 1]);
    expect(file.ms).toBeGreaterThanOrEqual(0);
  });

  it('throws with the status when the CDN says no', async () => {
    const res = { ok: false, status: 404, statusText: 'Not Found', headers: new Headers() } as unknown as Response;
    await expect(loadSpz('https://cdn/x.spz', { fetchImpl: async () => res })).rejects.toThrow('404');
  });

  /**
   * An uncompressed `.spz` whose header promises more points than the file can hold is a stub or a
   * truncated download. Spark allocates for `numPoints` before it counts the bytes, so handing one
   * over freezes the tab — the mock provider's 200-byte file reads as 4,029,657,789 splats, about
   * 60 GB. `loadSpz` refuses it, which turns a hang into an error the splat layer recovers from
   * with the measured room still on screen.
   */
  const spzBytes = (numPoints: number, total: number): Uint8Array => {
    const b = new Uint8Array(Math.max(16, total));
    b.set([0x4e, 0x47, 0x53, 0x50], 0); // 'NGSP'
    new DataView(b.buffer).setUint32(4, 2, true); // version 2
    new DataView(b.buffer).setUint32(8, numPoints, true);
    return b;
  };
  const served = (body: Uint8Array) =>
    ({ ok: true, headers: new Headers({ 'content-length': String(body.byteLength) }), arrayBuffer: async () => body.buffer }) as unknown as Response;

  it('refuses an uncompressed spz whose header cannot fit in the file', async () => {
    const stub = spzBytes(4_029_657_789, 200);
    await expect(loadSpz('https://cdn/spz-100k.spz', { fetchImpl: async () => served(stub) })).rejects.toThrow(/spz-100k\.spz is not a usable splat file/);
    await expect(loadSpz('https://cdn/spz-100k.spz', { fetchImpl: async () => served(stub) })).rejects.toThrow(/4,029,657,789 splats/);
  });

  it('accepts a small file whose header is honest about it', async () => {
    // 4 points × 19 bytes + the 16-byte header = 92, so 128 bytes is comfortably enough.
    const ok = spzBytes(4, 128);
    const file = await loadSpz('https://cdn/tiny.spz', { fetchImpl: async () => served(ok) });
    expect(file.bytes.byteLength).toBe(128);
  });

  it('leaves a gzipped file to Spark: the header is behind the deflate stream', async () => {
    const gz = new Uint8Array(64);
    gz.set([0x1f, 0x8b, 0x08, 0x00], 0);
    const file = await loadSpz('https://cdn/real.spz', { fetchImpl: async () => served(gz) });
    expect(file.bytes.byteLength).toBe(64);
  });
});
