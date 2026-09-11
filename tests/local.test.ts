/**
 * server/local.ts: the CLI's local store — paths, the deterministic unit id, the unit document and
 * the world cache (docs/CLI.md, "The unit file" and step 7).
 *
 * Everything here runs against a temporary directory. Nothing touches a network, a provider or the
 * repository's own `.audora/`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LOCAL_ASSET_PREFIX,
  ensureLocalPaths,
  isSafeSegment,
  listUnits,
  localAssetFile,
  localAssetUrl,
  localPaths,
  localRoot,
  missingAssetFiles,
  readCachedWorld,
  readUnit,
  tourUrl,
  unitIdFor,
  worldCacheFile,
  writeCachedWorld,
  writeUnit,
  type LocalPaths,
  type LocalUnit,
  type LocalWorld,
} from '../server/local';

const roots: string[] = [];

function freshPaths(): LocalPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'audora-local-'));
  roots.push(root);
  return ensureLocalPaths(localPaths(root));
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function world(overrides: Partial<LocalWorld> = {}): LocalWorld {
  return {
    worldId: 'mock-world-1',
    provider: 'mock',
    model: 'mock-draft-1',
    tier: 'draft',
    recipeHash: HASH_A,
    seed: 42,
    assets: { spz: { '100k': localAssetUrl('mock-world-1', 'spz-100k.spz') }, collider: localAssetUrl('mock-world-1', 'collider.glb') },
    metricScaleFactor: null,
    groundPlaneOffset: null,
    bounds: null,
    raw: null,
    createdAt: '2026-09-10T12:00:00.000Z',
    ...overrides,
  };
}

function unit(overrides: Partial<LocalUnit> = {}): LocalUnit {
  return {
    id: unitIdFor([HASH_A]),
    name: 'Unit 3',
    createdAt: '2026-09-10T12:00:00.000Z',
    address: null,
    tier: 'draft',
    rooms: [],
    plan: null,
    ...overrides,
  };
}

describe('where the store lives', () => {
  it('sits under .audora/local of the repository root', () => {
    expect(localRoot('/repo')).toBe(path.join('/repo', '.audora', 'local'));
  });

  it('is moved wholesale by AUDORA_LOCAL_DIR, which is how a test gets a temp directory', () => {
    expect(localRoot('/repo', { AUDORA_LOCAL_DIR: '/tmp/elsewhere' })).toBe(path.resolve('/tmp/elsewhere'));
    expect(localRoot('/repo', { AUDORA_LOCAL_DIR: '  ' })).toBe(path.join('/repo', '.audora', 'local'));
  });

  it('has three subdirectories, created on demand', () => {
    const paths = freshPaths();
    expect(paths.units).toBe(path.join(paths.root, 'units'));
    expect(paths.worlds).toBe(path.join(paths.root, 'worlds'));
    expect(paths.assets).toBe(path.join(paths.root, 'assets'));
    // ensureLocalPaths already ran; calling it again must not throw.
    expect(() => ensureLocalPaths(paths)).not.toThrow();
  });
});

describe('the unit id', () => {
  it('is 8 hex characters of sha256 over the recipe hashes', () => {
    expect(unitIdFor([HASH_A])).toMatch(/^[0-9a-f]{8}$/);
  });

  it('does not depend on the order the rooms were scanned in', () => {
    expect(unitIdFor([HASH_A, HASH_B])).toBe(unitIdFor([HASH_B, HASH_A]));
  });

  it('changes when any recipe changes', () => {
    expect(unitIdFor([HASH_A])).not.toBe(unitIdFor([HASH_B]));
    expect(unitIdFor([HASH_A])).not.toBe(unitIdFor([HASH_A, HASH_B]));
  });

  it('is case-insensitive about the hashes it is given', () => {
    expect(unitIdFor([HASH_A.toUpperCase()])).toBe(unitIdFor([HASH_A]));
  });

  it('refuses a unit with no recipes', () => {
    expect(() => unitIdFor([])).toThrow(/at least one recipe/);
  });
});

describe('paths and urls', () => {
  it('serves an asset from /local-assets/<worldId>/<name>', () => {
    expect(localAssetUrl('mock-world-7', 'spz-100k.spz')).toBe(`${LOCAL_ASSET_PREFIX}/mock-world-7/spz-100k.spz`);
  });

  it('points the tour at the port that is answering', () => {
    expect(tourUrl(5173, '3f9a1c2e')).toBe('http://localhost:5173/t/3f9a1c2e');
    expect(tourUrl(10000, '3f9a1c2e')).toBe('http://localhost:10000/t/3f9a1c2e');
  });

  it('refuses anything that is not one safe path segment', () => {
    expect(isSafeSegment('mock-world-1')).toBe(true);
    expect(isSafeSegment('..')).toBe(false);
    expect(isSafeSegment('a/b')).toBe(false);
    expect(isSafeSegment('../etc/passwd')).toBe(false);
    expect(isSafeSegment('')).toBe(false);
    expect(() => localAssetUrl('../etc', 'passwd')).toThrow(/safe path segment/);
    expect(() => localAssetUrl('world', '../../x')).toThrow(/safe path segment/);
  });

  it('keeps an asset file inside the assets directory', () => {
    const paths = freshPaths();
    expect(localAssetFile(paths, 'w1', 'pano.jpg')).toBe(path.join(paths.assets, 'w1', 'pano.jpg'));
  });
});

describe('the unit document', () => {
  let paths: LocalPaths;
  beforeEach(() => {
    paths = freshPaths();
  });

  it('round-trips with exactly the keys docs/CLI.md lists', () => {
    const written = unit({ address: '1247 Oak St, San Francisco' });
    writeUnit(paths, written);
    const read = readUnit(paths, written.id);
    expect(read).toEqual(written);
    expect(Object.keys(read as LocalUnit).sort()).toEqual(['address', 'createdAt', 'id', 'name', 'plan', 'rooms', 'tier']);
  });

  it('answers null for a unit that is not there, and for an id that is not an id', () => {
    expect(readUnit(paths, 'deadbeef')).toBeNull();
    expect(readUnit(paths, '../../etc/passwd')).toBeNull();
  });

  it('lists units newest first and steps over anything unreadable', () => {
    writeUnit(paths, unit({ id: 'aaaaaaaa', createdAt: '2026-09-01T00:00:00.000Z' }));
    writeUnit(paths, unit({ id: 'bbbbbbbb', createdAt: '2026-09-09T00:00:00.000Z' }));
    writeFileSync(path.join(paths.units, 'cccccccc.json'), '{ not json', 'utf8');
    writeFileSync(path.join(paths.units, 'notes.txt'), 'ignored', 'utf8');
    expect(listUnits(paths).map((u) => u.id)).toEqual(['bbbbbbbb', 'aaaaaaaa']);
  });

  it('is written whole or not at all: a reader never sees a half-written file', () => {
    const written = unit();
    const file = writeUnit(paths, written);
    // The temp file the atomic write used must not be left behind to be listed as a unit.
    expect(listUnits(paths)).toHaveLength(1);
    expect(file.endsWith(`${written.id}.json`)).toBe(true);
  });
});

describe('the world cache', () => {
  let paths: LocalPaths;
  beforeEach(() => {
    paths = freshPaths();
  });

  it('is keyed by the recipe hash', () => {
    const w = world();
    const file = writeCachedWorld(paths, w);
    expect(file).toBe(worldCacheFile(paths, HASH_A));
    expect(readCachedWorld(paths, HASH_A)).toEqual(w);
  });

  it('misses for an unknown recipe, an unsafe key and a record that is not a world', () => {
    expect(readCachedWorld(paths, HASH_B)).toBeNull();
    expect(readCachedWorld(paths, '../escape')).toBeNull();
    writeFileSync(worldCacheFile(paths, HASH_B), JSON.stringify({ worldId: '' }), 'utf8');
    expect(readCachedWorld(paths, HASH_B)).toBeNull();
  });

  it('treats a corrupt cache file as a miss rather than a crash', () => {
    writeFileSync(worldCacheFile(paths, HASH_A), '{"worldId":', 'utf8');
    expect(readCachedWorld(paths, HASH_A)).toBeNull();
  });

  it('reports which of a cached world’s asset files are gone', () => {
    const w = world();
    expect(missingAssetFiles(paths, w).sort()).toEqual(['collider.glb', 'spz-100k.spz']);
    mkdirSync(path.join(paths.assets, w.worldId), { recursive: true });
    writeFileSync(localAssetFile(paths, w.worldId, 'spz-100k.spz'), 'x');
    expect(missingAssetFiles(paths, w)).toEqual(['collider.glb']);
    writeFileSync(localAssetFile(paths, w.worldId, 'collider.glb'), 'x');
    expect(missingAssetFiles(paths, w)).toEqual([]);
  });
});
