/**
 * server/cli.ts and server/localGenerate.ts: the command line tool — folder scanning, option
 * parsing, and the whole generate flow (docs/CLI.md).
 *
 * **Nothing here touches a network or a live API.** The provider is `mockProvider()` from
 * server/worker.ts — the same port the worker uses — wrapped in a counter, so "the second run calls
 * the provider zero times" is a fact rather than a hope. Photographs are hand-made PNGs (no decoder
 * needed to build them, and sharp canonicalises them if it is installed), and the store is a
 * temporary directory.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCeiling, parseDims, parseTier, UsageError } from '../server/cli';
import { ensureLocalPaths, localPaths, readUnit, worldCacheFile, type LocalPaths, type LocalUnit } from '../server/local';
import {
  ONLY_ROOM,
  TIER_COST,
  angleFromName,
  carryMeasuredAt,
  ceilingAnchor,
  cityFromAddress,
  compareNames,
  describeAssets,
  firstLine,
  generateLocal,
  mergeAssets,
  namedForType,
  resolveDims,
  roomNameFromFolder,
  roomTypeFromName,
  scanPhotos,
  slug,
  spzAssetName,
  visionPlan,
  type GenerateIo,
  type GenerateOptions,
} from '../server/localGenerate';
import { mockProvider, type ProviderAssets, type ProviderSubmission, type WorldProvider } from '../server/worker';

/* ---------- fixtures ---------- */

const temps: string[] = [];

function temp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `audora-${prefix}-`));
  temps.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A valid 8-bit RGB PNG of one flat colour; the colour is what makes two photos different. */
function tinyPng(rgb: [number, number, number], width = 64, height = 48): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

let colour = 0;
/** Write a photograph nobody else has: every call picks a new flat colour, so every hash differs. */
function photo(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  colour = (colour + 37) % 200;
  writeFileSync(file, tinyPng([20 + colour, 90, 200 - colour]));
}

/* ---------- the provider double ---------- */

interface Counted {
  provider: WorldProvider;
  calls: { generate: number; poll: number; world: number; fetchAsset: number };
}

/** `mockProvider()` with a call counter round it. Still no network, still no credits. */
function counted(): Counted {
  const inner = mockProvider();
  const calls = { generate: 0, poll: 0, world: 0, fetchAsset: 0 };
  const provider: WorldProvider = {
    name: 'mock',
    async generate(request): Promise<ProviderSubmission> {
      calls.generate += 1;
      return inner.generate(request);
    },
    async poll(operationId) {
      calls.poll += 1;
      return inner.poll(operationId);
    },
    async world(worldId) {
      calls.world += 1;
      return inner.world(worldId);
    },
    async fetchAsset(url) {
      calls.fetchAsset += 1;
      return inner.fetchAsset(url);
    },
  };
  return { provider, calls };
}

/* ---------- the flow, with everything injected ---------- */

const NOW = Date.parse('2026-09-10T12:00:00.000Z');

interface Run {
  logs: string[];
  progress: string[];
  io: GenerateIo;
}

function recorder(withConfirm: boolean | ((q: string) => Promise<boolean>) = true): Run {
  const logs: string[] = [];
  const progress: string[] = [];
  const io: GenerateIo = {
    log: (line) => logs.push(line),
    progress: (_roomId, line) => progress.push(line),
    ...(withConfirm === false ? {} : { confirm: typeof withConfirm === 'function' ? withConfirm : async () => true }),
  };
  return { logs, progress, io };
}

function options(dir: string, paths: LocalPaths, run: Run, extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    dir,
    paths,
    io: run.io,
    env: { MARBLE_MOCK: '1' },
    yes: true,
    now: () => NOW,
    sleep: async () => {},
    pollIntervalMs: 0,
    panoIntervalMs: 0,
    panoTimeoutMs: 0,
    provider: counted().provider,
    ...extra,
  };
}

function store(): LocalPaths {
  return ensureLocalPaths(localPaths(temp('store')));
}

/** A one-room folder called `living`, ready to generate. */
function livingUnit(): string {
  const dir = temp('photos');
  photo(path.join(dir, 'living', 'IMG_1.png'));
  return dir;
}

/* ---------- names, angles, sorting ---------- */

describe('reading a folder name', () => {
  it('slugs anything into a room id', () => {
    expect(slug('Bedroom 1')).toBe('bedroom-1');
    expect(slug('  Living Room  ')).toBe('living-room');
    expect(slug('!!!')).toBe('room');
  });

  it('infers the room type from the name, and says `other` rather than guessing', () => {
    expect(roomTypeFromName('living')).toBe('living');
    expect(roomTypeFromName('bedroom-1')).toBe('bedroom');
    expect(roomTypeFromName('master-bed')).toBe('bedroom');
    expect(roomTypeFromName('kitchen')).toBe('kitchen');
    expect(roomTypeFromName('ensuite')).toBe('bathroom');
    expect(roomTypeFromName('home-office')).toBe('office');
    expect(roomTypeFromName('entry-hall')).toBe('hallway');
    expect(roomTypeFromName('studio')).toBe('studio');
    expect(roomTypeFromName('photos')).toBe('other');
  });

  it('names a room the way docs/CLI.md prints it', () => {
    expect(roomNameFromFolder('living')).toBe('Living room');
    expect(roomNameFromFolder('bedroom-1')).toBe('Bedroom 1');
    expect(roomNameFromFolder('kitchen')).toBe('Kitchen');
    expect(roomNameFromFolder('my-photos')).toBe('My photos');
  });

  it('sorts file names the way a person reads them, without a locale', () => {
    expect(['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg'].sort(compareNames)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  });

  it('reads the angle off the file name and nothing else', () => {
    expect(angleFromName('shot-left.jpg')).toBe('left');
    expect(angleFromName('shot-RIGHT.PNG')).toBe('right');
    expect(angleFromName('shot_back.webp')).toBe('back');
    expect(angleFromName('shot-center.jpg')).toBe('centre');
    expect(angleFromName('leftovers.jpg')).toBeNull();
    expect(angleFromName('IMG_1.jpg')).toBeNull();
  });
});

/* ---------- scanning ---------- */

describe('scanning the photos folder', () => {
  it('reads a flat folder as one room, sorted, first photo primary', () => {
    const dir = temp('flat');
    photo(path.join(dir, 'IMG_10.png'));
    photo(path.join(dir, 'IMG_2.png'));
    const scan = scanPhotos(dir);
    expect(scan.perRoomFolders).toBe(false);
    expect(scan.rooms).toHaveLength(1);
    expect(scan.rooms[0].photos.map((p) => p.file)).toEqual(['IMG_2.png', 'IMG_10.png']);
  });

  it('reads subfolders as the rooms of one unit', () => {
    const dir = temp('unit');
    photo(path.join(dir, 'living', 'a.png'));
    photo(path.join(dir, 'bedroom-1', 'a.png'));
    photo(path.join(dir, 'kitchen', 'a.png'));
    const scan = scanPhotos(dir);
    expect(scan.perRoomFolders).toBe(true);
    expect(scan.rooms.map((r) => [r.id, r.name, r.type, r.order])).toEqual([
      ['bedroom-1', 'Bedroom 1', 'bedroom', 0],
      ['kitchen', 'Kitchen', 'kitchen', 1],
      ['living', 'Living room', 'living', 2],
    ]);
    expect(scan.rooms[0].photos[0].file).toBe('bedroom-1/a.png');
  });

  it('puts the photo whose name says primary first, whatever it sorts as', () => {
    const dir = temp('primary');
    photo(path.join(dir, 'a.png'));
    photo(path.join(dir, 'b-primary.png'));
    photo(path.join(dir, 'c-left.png'));
    const room = scanPhotos(dir).rooms[0];
    expect(room.photos.map((p) => p.file)).toEqual(['b-primary.png', 'a.png', 'c-left.png']);
    expect(room.photos.map((p) => p.angle)).toEqual([null, null, 'left']);
  });

  it('skips what it cannot use and says so', () => {
    const dir = temp('mixed');
    photo(path.join(dir, 'good.png'));
    writeFileSync(path.join(dir, 'notes.txt'), 'hello');
    writeFileSync(path.join(dir, 'clip.mov'), 'x');
    writeFileSync(path.join(dir, '.DS_Store'), 'x');
    const scan = scanPhotos(dir);
    expect(scan.rooms[0].photos.map((p) => p.file)).toEqual(['good.png']);
    expect(scan.notes.some((n) => n.includes('notes.txt') && n.includes('.txt is not an accepted image'))).toBe(true);
    expect(scan.notes.some((n) => n.includes('clip.mov'))).toBe(true);
    // Dotfiles are noise, not a decision the seller made.
    expect(scan.notes.some((n) => n.includes('DS_Store'))).toBe(false);
  });

  it('keeps at most the 8 images Marble takes, and says which it kept', () => {
    const dir = temp('many');
    for (let i = 1; i <= 10; i += 1) photo(path.join(dir, `p${i}.png`));
    const scan = scanPhotos(dir);
    expect(scan.rooms[0].photos).toHaveLength(8);
    expect(scan.notes.some((n) => n.includes('kept the first 8 photos'))).toBe(true);
  });

  it('prefers room subfolders and says it ignored the loose photos', () => {
    const dir = temp('both');
    photo(path.join(dir, 'loose.png'));
    photo(path.join(dir, 'living', 'a.png'));
    const scan = scanPhotos(dir);
    expect(scan.rooms.map((r) => r.id)).toEqual(['living']);
    expect(scan.notes.some((n) => n.includes('ignored 1 photo(s) at the top level'))).toBe(true);
  });

  it('refuses a folder that is not there, or is a file', () => {
    expect(() => scanPhotos(path.join(temp('none'), 'nope'))).toThrow(/No such folder/);
    const dir = temp('file');
    const file = path.join(dir, 'x.png');
    photo(file);
    expect(() => scanPhotos(file)).toThrow(/is not a folder/);
  });

  it('finds no rooms in an empty folder', () => {
    expect(scanPhotos(temp('empty')).rooms).toHaveLength(0);
  });
});

/* ---------- the options ---------- */

describe('the command line options', () => {
  it('defaults the tier to draft and refuses anything but the two words', () => {
    expect(parseTier(undefined)).toBe('draft');
    expect(parseTier('full')).toBe('full');
    expect(() => parseTier('Full')).toThrow(UsageError);
  });

  it('parses --dims per room, in metres, width first', () => {
    expect(parseDims('living=5.3x5.8,bedroom=3.3x3.8')).toEqual({
      living: { width: 5.3, depth: 5.8 },
      bedroom: { width: 3.3, depth: 3.8 },
    });
    expect(parseDims('5.3×5.8')).toEqual({ [ONLY_ROOM]: { width: 5.3, depth: 5.8 } });
    expect(parseDims(undefined)).toBeNull();
    expect(() => parseDims('living=5.3')).toThrow(UsageError);
    expect(() => parseDims('living=5.3x5.8,living=1x1')).toThrow(/twice/);
    expect(() => parseDims('living=530x580')).toThrow(/outside/);
  });

  it('parses --ceiling as metres in a plausible range', () => {
    expect(parseCeiling('2.6')).toBe(2.6);
    expect(parseCeiling(undefined)).toBeNull();
    expect(() => parseCeiling('260')).toThrow(/outside/);
    expect(() => parseCeiling('tall')).toThrow(UsageError);
  });

  it('puts a bare --dims on the only room, and refuses to guess between several', () => {
    const one = [{ id: 'living', name: 'Living room', type: 'living' as const, order: 0, photos: [] }];
    const two = [...one, { id: 'kitchen', name: 'Kitchen', type: 'kitchen' as const, order: 1, photos: [] }];
    expect(resolveDims({ [ONLY_ROOM]: { width: 5, depth: 6 } }, one)).toEqual({ living: { width: 5, depth: 6 } });
    expect(() => resolveDims({ [ONLY_ROOM]: { width: 5, depth: 6 } }, two)).toThrow(/needs a room name/);
    expect(() => resolveDims({ livingroom: { width: 5, depth: 6 } }, one)).toThrow(/not one of the rooms/);
  });

  it('takes the city out of an address without geocoding it', () => {
    expect(cityFromAddress('1247 Oak St, San Francisco')).toBe('San Francisco');
    expect(cityFromAddress('1247 Oak St, San Francisco, CA 94110')).toBe('San Francisco');
    expect(cityFromAddress('1247 Oak St, San Francisco, CA')).toBe('San Francisco');
    expect(cityFromAddress('Apt 3, 1247 Oak St, Berlin')).toBe('Berlin');
    expect(cityFromAddress('1247 Oak St')).toBeUndefined();
    expect(cityFromAddress(null)).toBeUndefined();
  });
});

/* ---------- naming what we downloaded ---------- */

describe('asset names', () => {
  it('gives every splat the name docs/CLI.md prints', () => {
    expect(spzAssetName('100k')).toEqual({ key: '100k', name: 'spz-100k.spz' });
    expect(spzAssetName('500k')).toEqual({ key: '500k', name: 'spz-500k.spz' });
    expect(spzAssetName('full_res')).toEqual({ key: 'full', name: 'spz-full.spz' });
  });

  it('names the panorama after what it really is', () => {
    expect(namedForType('pano', 'image/jpeg', 'jpg')).toBe('pano.jpg');
    expect(namedForType('pano', 'image/png', 'jpg')).toBe('pano.png');
    expect(namedForType('pano', 'application/octet-stream', 'jpg')).toBe('pano.jpg');
  });
});

/* ---------- the anchor ---------- */

describe('the recipe’s anchor', () => {
  it('is the assumed ceiling with no --ceiling, and the stated one with it', () => {
    expect(ceilingAnchor(null)).toEqual({ method: 'assumed', referenceMetres: 2.44, referenceUnits: 1, metresPerUnit: 2.44, uncertaintyM: 0.12 });
    expect(ceilingAnchor(2.6)).toEqual({ method: 'ceiling', referenceMetres: 2.6, referenceUnits: 1, metresPerUnit: 2.6, uncertaintyM: 0.03 });
  });
});

/* ---------- diagnosing a live failure ---------- */

describe('describing what the provider answered', () => {
  it('names Marble’s own fields and never prints a signed URL whole', () => {
    const line = describeAssets({
      worldId: 'w1',
      spz: { '100k': 'https://cdn.example.com/a/b/spz.spz?sig=SECRET' },
      collider: 'https://cdn.example.com/a/b/collider.glb?sig=SECRET',
      metricScaleFactor: null,
      groundPlaneOffset: null,
    });
    expect(line).toContain('spz_urls=[100k]');
    expect(line).toContain('collider_mesh_url=https://cdn.example.com/…/collider.glb');
    expect(line).toContain('pano_url=—');
    expect(line).not.toContain('SECRET');
    expect(describeAssets(null)).toBe('no world record');
  });
});

/* ---------- the whole flow ---------- */

describe('generate, end to end against the mock provider', () => {
  it('turns a folder of rooms into a unit file, assets and a URL', async () => {
    const dir = temp('photos');
    photo(path.join(dir, 'living', 'IMG_1.png'));
    photo(path.join(dir, 'living', 'IMG_2-left.png'));
    photo(path.join(dir, 'kitchen', 'IMG_1.png'));
    const paths = store();
    const run = recorder();
    const { provider, calls } = counted();

    const result = await generateLocal(options(dir, paths, run, { provider, name: 'Unit 3', address: '1247 Oak St, San Francisco', port: 5173 }));

    expect(result.generated).toBe(2);
    expect(result.reused).toBe(0);
    expect(calls.generate).toBe(2);
    expect(result.url).toBe(`http://localhost:5173/t/${result.unit.id}`);
    expect(result.unit.id).toMatch(/^[0-9a-f]{8}$/);

    // The unit document is exactly what docs/CLI.md describes.
    const unit = readUnit(paths, result.unit.id) as LocalUnit;
    expect(unit).toEqual(result.unit);
    expect(Object.keys(unit).sort()).toEqual(['address', 'createdAt', 'id', 'name', 'plan', 'rooms', 'tier']);
    expect(unit.name).toBe('Unit 3');
    expect(unit.address).toBe('1247 Oak St, San Francisco');
    expect(unit.tier).toBe('draft');
    expect(unit.plan).toBeNull();
    expect(unit.createdAt).toBe(new Date(NOW).toISOString());
    expect(unit.rooms.map((r) => r.id)).toEqual(['kitchen', 'living']);

    const living = unit.rooms.find((r) => r.id === 'living')!;
    expect(Object.keys(living).sort()).toEqual([
      'anchor',
      'geometry',
      'id',
      'measurement',
      'model',
      'name',
      'order',
      'photos',
      'planDims',
      'prompt',
      'recipeHash',
      'seed',
      'type',
      'world',
    ]);
    expect(living.name).toBe('Living room');
    expect(living.type).toBe('living');
    expect(living.recipeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(living.seed).toBeGreaterThanOrEqual(0);
    expect(living.prompt).toContain('living room');
    expect(living.model).toBe('mock-draft-1');

    // Two photos: the primary carries no azimuth, the labelled angle does.
    expect(living.photos.map((p) => [p.file, p.angle, p.azimuth])).toEqual([
      ['living/IMG_1.png', null, null],
      ['living/IMG_2-left.png', 'left', 270],
    ]);
    for (const p of living.photos) {
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
    }

    // The world, and its assets under the world id with the documented names.
    const world = living.world!;
    expect(world.provider).toBe('mock');
    expect(world.tier).toBe('draft');
    expect(world.recipeHash).toBe(living.recipeHash);
    expect(Object.keys(world.assets.spz).sort()).toEqual(['100k', '500k', 'full']);
    expect(world.assets.spz['100k']).toBe(`/local-assets/${world.worldId}/spz-100k.spz`);
    expect(world.assets.collider).toBe(`/local-assets/${world.worldId}/collider.glb`);
    expect(world.assets.pano).toBe(`/local-assets/${world.worldId}/pano.jpg`);
    expect(world.assets.thumbnail).toBe(`/local-assets/${world.worldId}/thumb.jpg`);
    for (const name of ['spz-100k.spz', 'spz-500k.spz', 'spz-full.spz', 'collider.glb', 'pano.jpg', 'thumb.jpg']) {
      expect(existsSync(path.join(paths.assets, world.worldId, name)), name).toBe(true);
    }
    // The mock spends nothing, so it never quotes a price.
    expect(world.credits).toBeUndefined();

    // The collider was measured and the scale fused (docs/CLI.md step 6).
    expect(world.bounds).not.toBeNull();
    expect(living.geometry!.width).toBeGreaterThan(0);
    expect(living.measurement!.scale).toBeGreaterThan(0);
    expect(living.measurement!.measuredAt).toBe(new Date(NOW).toISOString());
    expect(living.measurement!.recipeHash).toBe(living.recipeHash);

    // One progress line per room, in the shape docs/CLI.md prints.
    expect(run.progress.some((l) => /^living: generating \d+%/.test(l))).toBe(true);
    expect(run.progress.some((l) => l.startsWith('kitchen: '))).toBe(true);
  });

  it('gives the same folder the same unit id, and the second run calls the provider zero times', async () => {
    const dir = livingUnit();
    const paths = store();
    const first = counted();
    const one = await generateLocal(options(dir, paths, recorder(), { provider: first.provider }));
    expect(first.calls.generate).toBe(1);

    const second = counted();
    // No --yes and nothing to confirm with: a run that spends nothing must not ask.
    const two = await generateLocal(options(dir, paths, recorder(false), { provider: second.provider, yes: false }));

    expect(two.unit.id).toBe(one.unit.id);
    expect(two.url).toBe(one.url);
    expect(two.generated).toBe(0);
    expect(two.reused).toBe(1);
    expect(second.calls).toEqual({ generate: 0, poll: 0, world: 0, fetchAsset: 0 });
    // The room comes back identical, world and measurement included.
    expect(two.unit.rooms[0].world!.worldId).toBe(one.unit.rooms[0].world!.worldId);
    expect(two.unit.rooms[0].measurement).toEqual(one.unit.rooms[0].measurement);
    expect(two.unit.rooms[0].recipeHash).toBe(one.unit.rooms[0].recipeHash);
  });

  it('keeps the first run’s createdAt: the id is stable, so “created” must be too', async () => {
    const dir = livingUnit();
    const paths = store();
    const first = await generateLocal(options(dir, paths, recorder()));
    const later = await generateLocal(options(dir, paths, recorder(), { now: () => NOW + 86_400_000 }));
    expect(later.unit.id).toBe(first.unit.id);
    expect(later.unit.createdAt).toBe(first.unit.createdAt);
  });

  it('changes the unit id when a photo changes', async () => {
    const dir = livingUnit();
    const paths = store();
    const one = await generateLocal(options(dir, paths, recorder()));
    photo(path.join(dir, 'living', 'IMG_2.png'));
    const two = await generateLocal(options(dir, paths, recorder()));
    expect(two.unit.id).not.toBe(one.unit.id);
    expect(two.generated).toBe(1);
  });

  it('changes the unit id when the tier changes', async () => {
    const dir = livingUnit();
    const paths = store();
    const draft = await generateLocal(options(dir, paths, recorder(), { tier: 'draft' }));
    const full = await generateLocal(options(dir, paths, recorder(), { tier: 'full' }));
    expect(full.unit.id).not.toBe(draft.unit.id);
    expect(full.unit.tier).toBe('full');
    expect(full.unit.rooms[0].model).toBe('mock-full-1');
  });

  it('changes the unit id when the plan dimensions or the ceiling change', async () => {
    const dir = livingUnit();
    const paths = store();
    const plain = await generateLocal(options(dir, paths, recorder()));
    const measured = await generateLocal(options(dir, paths, recorder(), { dims: { living: { width: 5.3, depth: 5.8 } }, ceiling: 2.6 }));
    expect(measured.unit.id).not.toBe(plain.unit.id);
    expect(measured.unit.rooms[0].planDims).toEqual({ width: 5.3, depth: 5.8, height: 2.6 });
    expect(measured.unit.rooms[0].anchor!.method).toBe('ceiling');
    // The plan is now one of the sources the scale was fused from.
    expect(measured.unit.rooms[0].measurement!.residuals.some((r) => r.source.startsWith('plan-'))).toBe(true);
  });

  it('refuses, before any provider call, when there is nothing to confirm on', async () => {
    const dir = livingUnit();
    const paths = store();
    const run = recorder(false);
    const { provider, calls } = counted();
    await expect(generateLocal(options(dir, paths, run, { provider, yes: false }))).rejects.toThrow(/no terminal to ask on/);
    expect(calls).toEqual({ generate: 0, poll: 0, world: 0, fetchAsset: 0 });
    expect(readdirSync(paths.units)).toEqual([]);
  });

  it('stops when the answer to the question is no', async () => {
    const dir = livingUnit();
    const paths = store();
    const { provider, calls } = counted();
    const run = recorder(async () => false);
    await expect(generateLocal(options(dir, paths, run, { provider, yes: false }))).rejects.toThrow(/Cancelled/);
    expect(calls.generate).toBe(0);
  });

  it('quotes the tier’s price before it asks, and says when nothing is spent', async () => {
    const dir = livingUnit();
    const paths = store();
    const run = recorder();
    await generateLocal(options(dir, paths, run, { yes: false }));
    expect(run.logs.some((l) => l.includes('1 room(s) to generate: living'))).toBe(true);
    expect(run.logs.some((l) => l.includes('simulated provider, nothing is spent'))).toBe(true);
    // The published prices the browser shows (src/services/mockWorld.ts).
    expect(TIER_COST.draft.usd).toBe(0.18);
    expect(TIER_COST.full.usd).toBe(1.26);
  });

  it('skips a photo it cannot read, whatever the extension claimed, and says so', async () => {
    const dir = temp('heic');
    photo(path.join(dir, 'living', 'good.png'));
    // A .heic that is not a HEIC: sharp refuses to decode it, and without sharp it has no
    // dimensions. Either way it is skipped with a note rather than sent to Marble as a JPEG.
    writeFileSync(path.join(dir, 'living', 'phone.heic'), Buffer.from('not really a heic file'));
    const result = await generateLocal(options(dir, store(), recorder()));
    expect(result.unit.rooms[0].photos.map((p) => p.file)).toEqual(['living/good.png']);
    expect(result.notes.some((n) => n.includes('phone.heic'))).toBe(true);
  });

  it('skips a room whose every photo is unreadable, and refuses a folder where that is all of them', async () => {
    const dir = temp('allbad');
    writeFileSync(path.join(dir, 'broken.png'), Buffer.from('nope'));
    await expect(generateLocal(options(dir, store(), recorder()))).rejects.toThrow(/could be prepared/);
  });

  it('honours MARBLE_MAX_GENERATIONS the way the worker does, before anything is spent', async () => {
    const dir = temp('capped');
    photo(path.join(dir, 'living', 'a.png'));
    photo(path.join(dir, 'kitchen', 'a.png'));
    const { provider, calls } = counted();
    // A provider that calls itself Marble, so the live-generation guard applies; its insides are
    // still the mock, so no request could reach a network even if the guard let one through.
    const live: WorldProvider = { ...provider, name: 'marble' };
    await expect(
      generateLocal(options(dir, store(), recorder(), { provider: live, env: { WORLDLABS_API_KEY: 'test', MARBLE_MAX_GENERATIONS: '1' } })),
    ).rejects.toThrow(/Credit guard: this run would start 2 live Marble generations \(cap 1\)/);
    expect(calls.generate).toBe(0);
  });

  it('refuses a folder with no photographs', async () => {
    const paths = store();
    await expect(generateLocal(options(temp('empty'), paths, recorder()))).rejects.toThrow(/No photographs/);
  });

  it('carries the scan notes out to the caller', async () => {
    const dir = temp('noted');
    photo(path.join(dir, 'living', 'a.png'));
    writeFileSync(path.join(dir, 'living', 'notes.txt'), 'x');
    const result = await generateLocal(options(dir, store(), recorder()));
    expect(result.notes.some((n) => n.includes('notes.txt'))).toBe(true);
  });
});

/* ---------- nothing on the network without being asked ---------- */

describe('the only paid calls are the ones that were asked for', () => {
  /**
   * A `fetch` that counts and refuses. The count is the assertion: `visionRoomType` catches its own
   * network failures, so a request that went out and failed would otherwise look exactly like one
   * that was never made — which is the whole of the bug this guards.
   */
  function forbidFetch(): { restore: () => void; tried: () => number } {
    const before = globalThis.fetch;
    let tried = 0;
    globalThis.fetch = (async (url: unknown) => {
      tried += 1;
      throw new Error(`the CLI made a network call it was not asked for: ${String(url)}`);
    }) as typeof globalThis.fetch;
    return {
      restore: () => {
        globalThis.fetch = before;
      },
      tried: () => tried,
    };
  }

  /** A folder whose name names no room type, which is the only case the vision model is for. */
  function unnamedRoom(): string {
    const dir = temp('unnamed');
    photo(path.join(dir, 'IMG_1.png'));
    return dir;
  }

  it('says when it may ask the vision model, and why not when it may not', () => {
    const key = { NEBIUS_API_KEY: 'k' };
    expect(visionPlan(undefined, key, 'marble').ask).toBe(false);
    expect(visionPlan(undefined, key, 'marble').why).toContain('--ai');
    // MARBLE_MOCK=1 promises the run spends nothing: that includes the second vendor.
    expect(visionPlan(true, { ...key, MARBLE_MOCK: '1' }, 'mock').ask).toBe(false);
    expect(visionPlan(true, key, 'mock').why).toContain('simulated');
    expect(visionPlan(true, {}, 'marble').ask).toBe(false);
    expect(visionPlan(true, key, 'marble').ask).toBe(true);
  });

  it('makes no vision call on a run that was not given --ai, key or no key', async () => {
    const net = forbidFetch();
    try {
      const run = recorder();
      const result = await generateLocal(options(unnamedRoom(), store(), run, { env: { MARBLE_MOCK: '1', NEBIUS_API_KEY: 'k' } }));
      expect(net.tried()).toBe(0);
      expect(result.unit.rooms[0].type).toBe('other');
      expect(run.logs.some((l) => l.includes('pass --ai'))).toBe(true);
      expect(run.logs.some((l) => l.includes('vision model calls this'))).toBe(false);
    } finally {
      net.restore();
    }
  });

  it('makes no vision call on a simulated run even with --ai', async () => {
    const net = forbidFetch();
    try {
      const run = recorder();
      const result = await generateLocal(options(unnamedRoom(), store(), run, { ai: true, env: { MARBLE_MOCK: '1', NEBIUS_API_KEY: 'k' } }));
      expect(net.tried()).toBe(0);
      expect(result.unit.rooms[0].type).toBe('other');
      expect(run.logs.some((l) => l.includes('simulated run'))).toBe(true);
    } finally {
      net.restore();
    }
  });

  it('never asks before the folder name has failed to answer', async () => {
    // A named folder is answered by its own name, so `--ai` costs nothing on the happy path.
    const net = forbidFetch();
    try {
      const result = await generateLocal(options(livingUnit(), store(), recorder(), { ai: true, env: { NEBIUS_API_KEY: 'k' } }));
      expect(net.tried()).toBe(0);
      expect(result.unit.rooms[0].type).toBe('living');
    } finally {
      net.restore();
    }
  });
});

/* ---------- a world record that arrives in pieces ---------- */

describe('the pano wait never loses assets it already has', () => {
  it('keeps every URL a later, emptier answer does not carry', () => {
    const held: ProviderAssets = { worldId: 'w', spz: { '100k': 'a', '500k': 'b' }, collider: 'c', thumbnail: 't', metricScaleFactor: 1.2 };
    const merged = mergeAssets(held, { worldId: 'w', spz: {} });
    expect(merged.spz).toEqual({ '100k': 'a', '500k': 'b' });
    expect(merged.collider).toBe('c');
    expect(merged.thumbnail).toBe('t');
    expect(merged.metricScaleFactor).toBe(1.2);
    // And the panorama, when it finally lands, is taken.
    expect(mergeAssets(merged, { worldId: 'w', spz: { full_res: 'f' }, pano: 'p' })).toMatchObject({ pano: 'p', spz: { '100k': 'a', '500k': 'b', full_res: 'f' } });
  });

  it('finishes a generation whose world record keeps filling in after the panorama poll starts', async () => {
    // The live shape this exists for: the first world() has the splats and the collider but no
    // panorama, and the polls after it come back still filling in. Replacing the record with those
    // would leave the run with nothing to download and throw "has no assets" on a paid world.
    const inner = mockProvider();
    let worldCalls = 0;
    const provider: WorldProvider = {
      name: 'mock',
      generate: (r) => inner.generate(r),
      poll: (id) => inner.poll(id),
      async world(worldId) {
        worldCalls += 1;
        const full = await inner.world(worldId);
        if (worldCalls === 1) {
          const { pano: _pano, ...withoutPano } = full;
          return withoutPano as ProviderAssets;
        }
        return { worldId, spz: {} };
      },
      fetchAsset: (u) => inner.fetchAsset(u),
    };
    // A clock that moves, so the pano wait can time out instead of spinning.
    let t = NOW;
    const run = recorder();
    const result = await generateLocal(options(livingUnit(), store(), run, { provider, now: () => (t += 1_000), panoIntervalMs: 0, panoTimeoutMs: 5_000 }));
    expect(worldCalls).toBeGreaterThan(1);
    const world = result.unit.rooms[0].world!;
    expect(Object.keys(world.assets.spz).sort()).toEqual(['100k', '500k', 'full']);
    expect(world.assets.collider).toBe(`/local-assets/${world.worldId}/collider.glb`);
    expect(world.assets.thumbnail).toBe(`/local-assets/${world.worldId}/thumb.jpg`);
    // No panorama ever came, which is said plainly and is not fatal.
    expect(world.assets.pano).toBeUndefined();
    expect(run.logs.some((l) => l.includes('no panorama after'))).toBe(true);
  });
});

/* ---------- a second run changes nothing ---------- */

describe('re-running over the same folder', () => {
  it('writes the same bytes, so the viewer has nothing to re-import', async () => {
    const dir = livingUnit();
    const paths = store();
    const dims = { living: { width: 5.3, depth: 5.8 } };
    const first = await generateLocal(options(dir, paths, recorder(), { dims, ceiling: 2.6 }));
    const before = readFileSync(first.file, 'utf8');
    const second = await generateLocal(options(dir, paths, recorder(), { dims, ceiling: 2.6, now: () => NOW + 86_400_000 }));
    expect(second.file).toBe(first.file);
    expect(readFileSync(second.file, 'utf8')).toBe(before);
    expect(second.unit.rooms[0].measurement!.measuredAt).toBe(first.unit.rooms[0].measurement!.measuredAt);
  });

  it('stamps a new measuredAt when the measurement itself changed', () => {
    const measured = { scale: 0.7, sigma: 0.01, sigmaRel: 0.014, confidence: 0.6, residuals: [], flags: [], lines: [], method: 'walls' as const, oneRoom: true, measuredAt: 'now' };
    expect(carryMeasuredAt({ ...measured, measuredAt: 'then' }, measured)!.measuredAt).toBe('then');
    expect(carryMeasuredAt({ ...measured, scale: 0.8, measuredAt: 'then' }, measured)!.measuredAt).toBe('now');
    expect(carryMeasuredAt(undefined, measured)!.measuredAt).toBe('now');
  });

  it('puts back an asset file that has gone missing, without generating anything', async () => {
    const dir = livingUnit();
    const paths = store();
    const first = await generateLocal(options(dir, paths, recorder()));
    const worldId = first.unit.rooms[0].world!.worldId;
    const gone = path.join(paths.assets, worldId, 'spz-100k.spz');
    unlinkSync(gone);
    expect(existsSync(gone)).toBe(false);

    const { provider, calls } = counted();
    const run = recorder();
    const again = await generateLocal(options(dir, paths, run, { provider }));
    expect(again.generated).toBe(0);
    expect(calls.generate).toBe(0);
    expect(existsSync(gone)).toBe(true);
    expect(run.logs.some((l) => l.includes('put back 1 of 1'))).toBe(true);
  });

  it('refuses to repair a world the other provider made, rather than invent bytes for it', async () => {
    const dir = livingUnit();
    const paths = store();
    const first = await generateLocal(options(dir, paths, recorder()));
    const worldId = first.unit.rooms[0].world!.worldId;
    // The cached world now claims Marble made it; this run is simulated, and a simulated splat
    // quietly replacing a real one is worse than the 404.
    const cache = worldCacheFile(paths, first.unit.rooms[0].recipeHash);
    writeFileSync(cache, JSON.stringify({ ...JSON.parse(readFileSync(cache, 'utf8')), provider: 'marble' }, null, 2));
    const gone = path.join(paths.assets, worldId, 'spz-100k.spz');
    unlinkSync(gone);

    const run = recorder();
    await generateLocal(options(dir, paths, run));
    expect(existsSync(gone)).toBe(false);
    expect(run.logs.some((l) => l.includes('came from the marble provider'))).toBe(true);
  });
});

/* ---------- someone else's error ---------- */

describe('a decoder failure is one line, not ten', () => {
  it('keeps the first line and says there was more', () => {
    expect(firstLine('Cannot decode this image: Input buffer has corrupt header\nsource: bad seek to 1024\nsource: bad seek to 512')).toBe(
      'Cannot decode this image: Input buffer has corrupt header …',
    );
    expect(firstLine('one line only')).toBe('one line only');
    expect(firstLine('trailing newline\n')).toBe('trailing newline');
  });

  it('does not paste a decoder seek log into the progress output', async () => {
    const dir = temp('wall');
    photo(path.join(dir, 'living', 'good.png'));
    writeFileSync(path.join(dir, 'living', 'fake.heic'), Buffer.from('    ftypheic and then some rubbish'));
    const run = recorder();
    const result = await generateLocal(options(dir, store(), run, {}));
    const note = result.notes.find((n) => n.includes('fake.heic'));
    expect(note).toBeDefined();
    expect(String(note).includes('\n')).toBe(false);
    expect(String(note).length).toBeLessThan(160);
  });
});
