/**
 * Determinism in the browser flow (docs/BACKEND.md section 2): the recipe, its hash, the seed
 * derived from it, the compiled prompt, what `startGeneration` sends, and how the server maps that
 * body onto Marble's request. No network: fetch is a fake, and the server mapping is the pure
 * helper in server/marbleRequest.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserRecipe,
  canonicalJson,
  dataUrlBytes,
  DEFAULT_MARBLE_MODEL,
  PIPELINE_VERSION,
  recipeForRoom,
  recipeHashBrowser,
  seedFromHash,
  sha256Hex,
  startGeneration,
  worldFromMarble,
} from '../src/services/marble';
import { compileRoomPrompt, MAX_ROOM_PHOTOS, PROMPT_CONSTRAINTS } from '../src/services/marblePrompt';
import { marbleGenerateRequest, MARBLE_MAX_TAGS, MARBLE_SEED_MAX, mergeTags, parseSeed } from '../server/marbleRequest';
import type { PhotoRecord, Room, TourSite } from '../src/state/types';
import type { AnchorSpec, RawGeometry } from '../src/engine/types';
import { applyScale } from '../src/engine/anchor';

/* ---------- fixtures ---------- */

function dataUrl(bytes: string, type = 'image/jpeg'): string {
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
}

function photo(bytes: string, angle?: PhotoRecord['angle']): PhotoRecord {
  return { dataUrl: dataUrl(bytes), width: 1600, height: 1200, brightness: 0.5, darkFraction: 0.1, detail: 0.2, ...(angle ? { angle } : {}) };
}

const RAW: RawGeometry = {
  width: 4,
  depth: 5,
  height: 2.6,
  door: { wall: 'south', offset: 1, width: 0.9, height: 2.1 },
  windows: [],
  doorHeightUnits: 2.1,
  outletHeightUnits: 0.3,
};

const DOOR_ANCHOR: AnchorSpec = { method: 'door', referenceMetres: 2.03, referenceUnits: 2.1, metresPerUnit: 2.03 / 2.1, uncertaintyM: 0.04, label: 'interior door · 2.03 m · ±4 cm' };

function room(over: Partial<Room> = {}): Room {
  return {
    id: 'room_a',
    tourId: 'tour_a',
    name: 'Bedroom',
    type: 'bedroom',
    order: 0,
    photo: photo('photo-a'),
    raw: RAW,
    anchor: DOOR_ANCHOR,
    geometry: applyScale(RAW, DOOR_ANCHOR.metresPerUnit),
    staging: [],
    stagingStyle: 'modern' as Room['stagingStyle'],
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const SITE: TourSite = { lat: 37.87159, lon: -122.27279, displayName: '1247 Oak St', heading: 264.4 };

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------- hashing primitives ---------- */

describe('sha256Hex', () => {
  it('matches the known digest of "abc" through WebCrypto', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('falls back to node:crypto when crypto.subtle is missing and gets the same digest', async () => {
    vi.stubGlobal('crypto', { subtle: undefined });
    expect(globalThis.crypto?.subtle).toBeUndefined();
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('dataUrlBytes', () => {
  it('decodes the image bytes, not the URL text', () => {
    expect(Buffer.from(dataUrlBytes(dataUrl('photo-a'))).toString()).toBe('photo-a');
    // The same bytes under a different mime type are the same photo.
    expect(dataUrlBytes(dataUrl('photo-a', 'image/png'))).toEqual(dataUrlBytes(dataUrl('photo-a')));
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { z: undefined, y: [{ d: 1, c: 2 }] } })).toBe('{"a":{"y":[{"c":2,"d":1}]},"b":1}');
  });
});

describe('seedFromHash', () => {
  it('is the first 32 bits, unsigned, so it spans exactly Marble\'s seed range', () => {
    expect(seedFromHash('00000000ffffffff')).toBe(0);
    expect(seedFromHash('ffffffff00000000')).toBe(4294967295);
    expect(seedFromHash('80000000')).toBe(2147483648);
    expect(seedFromHash('ba7816bf8f01cfea')).toBe(0xba7816bf);
  });
});

/* ---------- the recipe ---------- */

describe('browserRecipe', () => {
  it('gives the same room the same hash and seed every time', async () => {
    const a = await recipeForRoom(room(), 'draft', { site: SITE });
    const b = await recipeForRoom(room(), 'draft', { site: SITE });
    expect(a.recipeHash).toBe(b.recipeHash);
    expect(a.seed).toBe(b.seed);
    expect(a.recipeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.seed).toBe(seedFromHash(a.recipeHash));
    expect(canonicalJson(a.recipe)).toBe(canonicalJson(b.recipe));
  });

  it('keeps the seed inside 0..4294967295 as an integer', async () => {
    for (const bytes of ['photo-a', 'photo-b', 'photo-c', 'photo-d', 'photo-e']) {
      const { seed } = await recipeForRoom(room({ photo: photo(bytes) }), 'draft');
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(MARBLE_SEED_MAX);
    }
  });

  it('changes with a different photo, tier or model', async () => {
    const base = await recipeForRoom(room(), 'draft', { site: SITE });
    const otherPhoto = await recipeForRoom(room({ photo: photo('photo-b') }), 'draft', { site: SITE });
    const otherTier = await recipeForRoom(room(), 'full', { site: SITE });
    const otherModel = await recipeForRoom(room(), 'draft', { site: SITE, modelId: 'marble-1.0-draft-next' });
    const otherVersion = await recipeForRoom(room(), 'draft', { site: SITE, pipelineVersion: '2' });
    const hashes = [base, otherPhoto, otherTier, otherModel, otherVersion].map((r) => r.recipeHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('names the default model for the tier and the pipeline version', async () => {
    const r = await browserRecipe(room(), 'full', DEFAULT_MARBLE_MODEL.full);
    expect(r.model).toBe('marble-1.1');
    expect(r.pipelineVersion).toBe(PIPELINE_VERSION);
    expect(r.provider).toBe('marble');
    expect(r.tier).toBe('full');
    expect(r.isPano).toBe(false);
    expect(r.site).toBeNull();
    expect(r.planDims).toBeNull();
  });

  it('records the photo hashes in order with their azimuths, and reconstruct mode past four', async () => {
    const extras = [photo('photo-l', 'left'), photo('photo-r', 'right'), photo('photo-x'), photo('photo-b', 'back')];
    const r = await browserRecipe(room({ photos: extras }), 'draft', 'marble-1.0-draft');
    expect(r.photos).toHaveLength(5);
    expect(r.photos[0]).toEqual({ sha256: await sha256Hex(new TextEncoder().encode('photo-a')) });
    expect(r.photos[1].azimuth).toBe(270);
    expect(r.photos[2].azimuth).toBe(90);
    expect(r.photos[3].azimuth).toBeUndefined();
    expect(r.photos[4].azimuth).toBe(180);
    expect(r.reconstructImages).toBe(true);
    // Swapping the order is a different request.
    const swapped = await browserRecipe(room({ photos: [extras[1], extras[0], extras[2], extras[3]] }), 'draft', 'marble-1.0-draft');
    expect(await recipeHashBrowser(swapped)).not.toBe(await recipeHashBrowser(r));
  });

  it('rounds the site, the plan and the anchor to fixed precision and sorts its keys', async () => {
    const r = await browserRecipe(room({ planDims: { width: 3.7512, depth: 4.2049 } }), 'draft', 'marble-1.0-draft', '1', { ...SITE, lat: 37.871591234, lon: -122.272794321 });
    expect(r.site).toEqual({ heading: 264, lat: 37.87159, lon: -122.27279 });
    expect(r.planDims).toEqual({ depth: 4.2, width: 3.75 });
    expect(r.anchor).toEqual({ method: 'door', referenceMetres: 2.03 });
    const json = canonicalJson(r);
    const keys = Object.keys(JSON.parse(json));
    expect(keys).toEqual([...keys].sort());
    // A lat/lon change below the fifth decimal is the same recipe.
    const nudged = await browserRecipe(room({ planDims: { width: 3.7512, depth: 4.2049 } }), 'draft', 'marble-1.0-draft', '1', { ...SITE, lat: 37.871592, lon: -122.272791 });
    expect(await recipeHashBrowser(nudged)).toBe(await recipeHashBrowser(r));
  });
});

/* ---------- the prompt ----------
 * The wording is the shared compiler's, pinned verbatim in tests/prompt.test.ts and held identical
 * to server/prompt.ts by tests/prompt-parity.test.ts. What belongs here is the browser flow's own
 * half of the contract: the prompt is pure, it says only what the room knows, it counts exactly the
 * photographs the request carries, and it is the string the recipe hashes. */

describe('compileRoomPrompt', () => {
  it('is pure and states only what the room knows', () => {
    const p = compileRoomPrompt(room());
    expect(p).toBe(compileRoomPrompt(room()));
    expect(p).toBe(`1 photograph of one real bedroom, taken from the doorway. 1 door, 2.0 m high. ${PROMPT_CONSTRAINTS}`);
    // Before a world exists the room's height is an assumption (2.44 m), so no height is stated,
    // and "empty" is the vision model's answer, not a default.
    expect(p).not.toMatch(/Ceiling height/);
    expect(p).not.toContain('empty');
  });

  it('adds the plan dimensions, the door, the caption and the window heading, in the fixed order', () => {
    const r = room({
      planDims: { width: 3.75, depth: 4.2 },
      analysis: { roomType: 'bedroom', roomTypeConfidence: 0.9, isEmpty: true, doorVisible: true, quality: 'good', notes: [], caption: 'White walls and an oak floor.  ', source: 'nebius' },
    });
    const p = compileRoomPrompt(r, SITE);
    const order = [
      '1 photograph of one real, empty bedroom, taken from the doorway.',
      'The room measures 3.8 m by 4.2 m (12 ft 4 in by 13 ft 9 in) on the floor plan.',
      '1 door, 2.0 m high.',
      'As photographed: White walls and an oak floor.',
      'The windows face west.',
      PROMPT_CONSTRAINTS,
    ];
    let at = -1;
    for (const sentence of order) {
      const i = p.indexOf(sentence);
      expect(i, sentence).toBeGreaterThan(at);
      at = i;
    }
  });

  it('ignores the heuristic placeholder caption and prefers the room\'s own heading over the site', () => {
    const r = room({
      northWallHeading: 90,
      analysis: { roomType: 'bedroom', roomTypeConfidence: 0.5, isEmpty: true, doorVisible: false, quality: 'ok', notes: [], caption: 'An empty room.', source: 'heuristic' },
    });
    const p = compileRoomPrompt(r, SITE);
    expect(p).not.toContain('As photographed');
    expect(p).toContain('The windows face east.');
  });

  it('counts the extra angles without naming them: the azimuths carry where they face', () => {
    const p = compileRoomPrompt(room({ type: 'living', photos: [photo('l', 'left'), photo('x'), photo('b', 'back')] }));
    expect(p.startsWith('4 photographs of one real living room, taken from the doorway.')).toBe(true);
    expect(p).not.toContain('turned left');
  });

  it('says a room the model saw furnished is furnished', () => {
    const furnished = room({ analysis: { roomType: 'bedroom', roomTypeConfidence: 0.9, isEmpty: false, doorVisible: false, quality: 'good', notes: [], caption: '', source: 'nebius' } });
    expect(compileRoomPrompt(furnished)).toContain('one real, furnished bedroom');
  });

  it('counts only the photographs Marble is actually sent', async () => {
    // Seven angles, six of which fit in a reconstruction request: the prompt must not announce the
    // seventh, because the recipe hashes both the prompt and the (capped) photo list.
    const extras = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => photo(s));
    const r = room({ photos: extras });
    expect(compileRoomPrompt(r).startsWith(`${MAX_ROOM_PHOTOS} photographs of`)).toBe(true);
    expect((await browserRecipe(r, 'draft', 'marble-1.0-draft')).photos).toHaveLength(MAX_ROOM_PHOTOS);
  });
});

/* ---------- what leaves the browser ---------- */

describe('startGeneration', () => {
  it('sends the seed, disableRecaption, the recipe tag and the compiled prompt, and returns the provenance', async () => {
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ operation_id: 'op_1', done: false, metadata: { world_id: 'w_1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const r = room({ photos: [photo('photo-l', 'left')] });
    const expected = await recipeForRoom(r, 'draft', { site: SITE });
    const started = await startGeneration(r, 'draft', { site: SITE });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/marble/generate');
    const sent = calls[0].body;
    expect(sent.seed).toBe(expected.seed);
    expect(sent.disableRecaption).toBe(true);
    expect(sent.tags).toEqual([`recipe:${expected.recipeHash.slice(0, 12)}`]);
    expect(sent.textPrompt).toBe(expected.prompt);
    expect(sent.tier).toBe('draft');
    expect(sent.images).toHaveLength(2);
    expect(sent.images[1].azimuth).toBe(270);
    expect(sent.imageDataUrl).toBe(r.photo!.dataUrl);

    // `model` rides back with the provenance so the world records the model that was requested,
    // not the tier default (`worldFromMarble`); nothing was named here, so it is the draft default.
    expect(started).toEqual({ operationId: 'op_1', worldId: 'w_1', recipeHash: expected.recipeHash, seed: expected.seed, prompt: expected.prompt, model: DEFAULT_MARBLE_MODEL.draft });

    // ...and the server turns exactly that body into a Marble request with the seed and no recaptioning.
    const mapped = marbleGenerateRequest(sent, { draft: 'marble-1.0-draft', full: 'marble-1.1' });
    expect('request' in mapped).toBe(true);
    if (!('request' in mapped)) return;
    expect(mapped.request.seed).toBe(expected.seed);
    expect(mapped.request.world_prompt.disable_recaption).toBe(true);
    expect(mapped.request.world_prompt.text_prompt).toBe(expected.prompt);
    expect(mapped.request.tags).toEqual(['audora', `recipe:${expected.recipeHash.slice(0, 12)}`]);
    expect(mapped.request.model).toBe('marble-1.0-draft');
  });

  it('never calls Marble for a room without a photo', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(startGeneration(room({ photo: undefined }), 'draft')).rejects.toThrow(/no photo/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('worldFromMarble', () => {
  it('records the provenance on the world', () => {
    const w = worldFromMarble(room(), 'draft', { world_id: 'w_1', model: 'marble-1.0-draft' }, 230, 35, undefined, { recipeHash: 'ab'.repeat(32), seed: 7, prompt: 'p' });
    expect(w.recipeHash).toBe('ab'.repeat(32));
    expect(w.seed).toBe(7);
    expect(w.prompt).toBe('p');
    const bare = worldFromMarble(room(), 'draft', { world_id: 'w_1' });
    expect(bare.recipeHash).toBeUndefined();
    expect(bare.seed).toBeUndefined();
  });
});

/* ---------- the server mapping ---------- */

describe('marbleGenerateRequest', () => {
  const models = { draft: 'marble-1.0-draft', full: 'marble-1.1' };
  const one = dataUrl('photo-a');

  it('keeps the single-image shape and the defaults when nothing new is sent', () => {
    const r = marbleGenerateRequest({ imageDataUrl: one, tier: 'draft', displayName: 'Audora · Bedroom' }, models);
    if (!('request' in r)) throw new Error(r.error);
    expect(r.request).toEqual({
      display_name: 'Audora · Bedroom',
      model: 'marble-1.0-draft',
      tags: ['audora'],
      permission: { public: false, allow_id_access: true },
      world_prompt: {
        type: 'image',
        image_prompt: { source: 'data_base64', data_base64: Buffer.from('photo-a').toString('base64'), extension: 'jpg' },
        text_prompt: 'An empty residential room, photographed from the doorway. Keep the real geometry.',
      },
    });
    expect('seed' in r.request).toBe(false);
    expect('disable_recaption' in r.request.world_prompt).toBe(false);
  });

  it('passes the seed through and puts disable_recaption on the world prompt, for one image or several', () => {
    const single = marbleGenerateRequest({ imageDataUrl: one, seed: 4294967295, disableRecaption: true }, models);
    if (!('request' in single)) throw new Error(single.error);
    expect(single.request.seed).toBe(4294967295);
    expect(single.request.world_prompt.disable_recaption).toBe(true);

    const images = ['a', 'b', 'c', 'd', 'e'].map((s, i) => ({ dataUrl: dataUrl(s, 'image/png'), ...(i ? { azimuth: i * 90 } : {}) }));
    const multi = marbleGenerateRequest({ images, seed: 0, disableRecaption: false, tier: 'full', textPrompt: 'the prompt' }, models);
    if (!('request' in multi)) throw new Error(multi.error);
    expect(multi.request.seed).toBe(0);
    expect(multi.request.model).toBe('marble-1.1');
    expect(multi.request.world_prompt.type).toBe('multi-image');
    if (multi.request.world_prompt.type !== 'multi-image') return;
    expect(multi.request.world_prompt.disable_recaption).toBe(false);
    expect(multi.request.world_prompt.reconstruct_images).toBe(true);
    expect(multi.request.world_prompt.text_prompt).toBe('the prompt');
    expect(multi.request.world_prompt.multi_image_prompt[0]).toEqual({ content: { source: 'data_base64', data_base64: Buffer.from('a').toString('base64'), extension: 'png' } });
    expect(multi.request.world_prompt.multi_image_prompt[2].azimuth).toBe(180);
  });

  it('leaves recaptioning at Marble\'s default unless a boolean was sent', () => {
    const r = marbleGenerateRequest({ imageDataUrl: one, disableRecaption: 'yes' }, models);
    if (!('request' in r)) throw new Error(r.error);
    expect('disable_recaption' in r.request.world_prompt).toBe(false);
  });

  it('refuses a seed outside 0..4294967295 or a non-integer with a 400', () => {
    for (const seed of [-1, 4294967296, 1.5, 'abc', NaN]) {
      const r = marbleGenerateRequest({ imageDataUrl: one, seed }, models);
      expect('error' in r && r.status, String(seed)).toBe(400);
    }
    expect(parseSeed(undefined)).toBeUndefined();
    expect(parseSeed('42')).toBe(42);
  });

  it('merges tags with audora, deduplicates, and caps them', () => {
    expect(mergeTags(undefined)).toEqual(['audora']);
    expect(mergeTags(['recipe:abc', 'audora', ' recipe:abc ', 7, '', 'x'.repeat(65)])).toEqual(['audora', 'recipe:abc']);
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    // MARBLE_MAX_TAGS is the cap on the list, `audora` included: a tag list can never become a payload.
    expect(mergeTags(many)).toHaveLength(MARBLE_MAX_TAGS);
    expect(mergeTags(many)[0]).toBe('audora');
    const r = marbleGenerateRequest({ imageDataUrl: one, tags: ['recipe:0123456789ab'] }, models);
    if (!('request' in r)) throw new Error(r.error);
    expect(r.request.tags).toEqual(['audora', 'recipe:0123456789ab']);
  });

  it('answers 400 for a missing or malformed image instead of throwing', () => {
    expect(marbleGenerateRequest({}, models)).toEqual({ status: 400, error: 'No image supplied.' });
    expect(marbleGenerateRequest({ images: [] , imageDataUrl: undefined }, models)).toEqual({ status: 400, error: 'No image supplied.' });
    const bad = marbleGenerateRequest({ imageDataUrl: 'https://example.com/photo.jpg' }, models);
    expect('error' in bad && bad.status).toBe(400);
  });

  it('is deterministic: the same body maps to the same bytes', () => {
    const body = { images: [{ dataUrl: one }, { dataUrl: dataUrl('b'), azimuth: 90 }], seed: 123, disableRecaption: true, tags: ['recipe:abc'], textPrompt: 'p', tier: 'draft', displayName: 'x' };
    expect(JSON.stringify(marbleGenerateRequest(body, models))).toBe(JSON.stringify(marbleGenerateRequest(JSON.parse(JSON.stringify(body)), models)));
  });
});
