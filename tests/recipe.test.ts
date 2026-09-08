/**
 * The canonical recipe (server/recipe.ts): the same inputs must give byte-identical JSON, the same
 * hash and the same Marble seed, whatever order the keys arrive in, and any input that matters must
 * change the hash. The pinned hash and seed at the bottom exist so a future change to the recipe
 * shape or to the prompt's phrasing is caught here, not discovered as every cached world regenerating.
 */
import { describe, expect, it } from 'vitest';
import {
  AZIMUTH_FOR_ANGLE,
  buildRecipe,
  canonicalJson,
  canonicalize,
  marbleRequestFrom,
  recipeHash,
  recipeSeed,
  recipeTag,
  seedFromHash,
  SEED_MAX,
  type Recipe,
  type RecipeInput,
} from '../server/recipe';
import { PROMPT_CONSTRAINTS } from '../server/prompt';

const sha = (c: string) => c.repeat(64);

/** An AnchorSpec as the app stores it: label, taps and detail included, which the recipe must drop. */
const ANCHOR_SPEC = {
  method: 'door' as const,
  referenceMetres: 2.03,
  referenceUnits: 1.42,
  metresPerUnit: 1.4295775,
  uncertaintyM: 0.04,
  label: 'interior door · 2.03m · ±4cm',
  taps: [
    { x: 0.31, y: 0.22 },
    { x: 0.31, y: 0.81 },
  ],
  detail: 'tapped on the primary photo',
};

function baseInput(): RecipeInput {
  return {
    pipelineVersion: '1',
    provider: 'marble',
    model: 'marble-1.0-draft',
    tier: 'draft',
    photos: [{ sha256: sha('a') }, { sha256: sha('b'), angle: 'left' }],
    roomType: 'bedroom',
    anchor: ANCHOR_SPEC,
    planDims: { width: 3.75, depth: 4.6 },
    ceilingHeight: 2.44,
    site: { lat: 42.3600825, lon: -71.0588801, heading: 261.4 },
    context: {
      empty: true,
      capturedFrom: 'doorway',
      doors: [{ wall: 'south', offset: 1.2, width: 0.9, height: 2.03, swing: 'inward' }],
      windows: [{ wall: 'north', offset: 0.9, width: 1.4, height: 1.2, sill: 0.9 }],
      flooring: 'oak',
      walls: 'white',
      trim: 'white',
      fixtures: ['radiator under the window'],
      notes: ['renovated 2021'],
      floorLevel: 3,
      buildingType: 'brick apartment building',
      buildingYear: 1925,
      city: 'Boston',
      windowFacing: 261.4,
      captureHour: 15,
    },
  };
}

/** The same value with every object's keys in reverse order, at every level. */
function reversedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reversedKeys) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).reverse()) out[k] = reversedKeys((value as Record<string, unknown>)[k]);
    return out as T;
  }
  return value;
}

describe('canonicalJson', () => {
  it('sorts keys at every level and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 3 } })).toBe('{"a":{"c":3,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('formats numbers to at most 5 decimals with no -0 and no exponent', () => {
    expect(canonicalJson([0.1 + 0.2, -0, 1.234567, 1.234564, 42, 1e-7, -1.5, 100000.000001])).toBe('[0.3,0,1.23457,1.23456,42,0,-1.5,100000]');
  });

  it('drops undefined object values and keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null, c: '' })).toBe('{"b":null,"c":""}');
  });

  it('escapes strings exactly as JSON does', () => {
    expect(canonicalJson({ s: 'a "quoted" line\nand ünïcode' })).toBe('{"s":"a \\"quoted\\" line\\nand ünïcode"}');
  });

  it('refuses anything that would not round-trip', () => {
    expect(() => canonicalJson({ n: NaN })).toThrow(/finite/);
    expect(() => canonicalJson({ n: Infinity })).toThrow(/finite/);
    expect(() => canonicalJson([1, undefined])).toThrow(/undefined/);
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/function/);
    expect(() => canonicalJson({ d: new Date(0) })).toThrow(/plain objects/);
    expect(() => canonicalJson({ b: 1n })).toThrow(/bigint/);
  });

  it('is independent of key order', () => {
    const a = { x: 1, y: { p: [1, 2], q: 'q' }, z: [{ m: 1, n: 2 }] };
    expect(canonicalJson(reversedKeys(a))).toBe(canonicalJson(a));
  });
});

describe('buildRecipe', () => {
  it('gives byte-identical JSON, the same hash and the same seed for the same input', () => {
    const r1 = buildRecipe(baseInput());
    const r2 = buildRecipe(baseInput());
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(canonicalJson(r1)).toBe(canonicalJson(r2));
    expect(recipeHash(r1)).toBe(recipeHash(r2));
    expect(recipeSeed(r1)).toBe(recipeSeed(r2));
  });

  it('returns the recipe already in canonical form', () => {
    const r = buildRecipe(baseInput());
    expect(JSON.stringify(r)).toBe(canonicalJson(r));
    expect(Object.keys(r)).toEqual([...Object.keys(r)].sort());
  });

  it('does not care about the key order of the input', () => {
    const a = buildRecipe(baseInput());
    const b = buildRecipe(reversedKeys(baseInput()));
    expect(recipeHash(b)).toBe(recipeHash(a));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('changes the hash when a photo, a dimension, the model or the pipeline version changes', () => {
    const base = recipeHash(buildRecipe(baseInput()));
    const photo = buildRecipe({ ...baseInput(), photos: [{ sha256: sha('a') }, { sha256: sha('c'), angle: 'left' }] });
    const dims = buildRecipe({ ...baseInput(), planDims: { width: 3.85, depth: 4.6 } });
    const model = buildRecipe({ ...baseInput(), model: 'marble-1.1', tier: 'full' });
    const version = buildRecipe({ ...baseInput(), pipelineVersion: '2' });
    const angle = buildRecipe({ ...baseInput(), photos: [{ sha256: sha('a') }, { sha256: sha('b'), angle: 'right' }] });
    const hashes = [base, recipeHash(photo), recipeHash(dims), recipeHash(model), recipeHash(version), recipeHash(angle)];
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('does not change the hash for noise below the recipe precision', () => {
    const base = recipeHash(buildRecipe(baseInput()));
    const noisy = buildRecipe({
      ...baseInput(),
      planDims: { width: 3.751, depth: 4.6 },
      ceilingHeight: 2.4449,
      site: { lat: 42.36008251, lon: -71.05888009, heading: 261.44 },
      photos: [{ sha256: sha('A') }, { sha256: sha('b').toUpperCase(), angle: 'left' }],
    });
    expect(recipeHash(noisy)).toBe(base);
  });

  it('rounds the site to 5 decimals and whole degrees, wrapping the heading', () => {
    expect(buildRecipe(baseInput()).site).toEqual({ lat: 42.36008, lon: -71.05888, heading: 261 });
    expect(buildRecipe({ ...baseInput(), site: { lat: 0, lon: 0, heading: 359.7 } }).site).toEqual({ lat: 0, lon: 0, heading: 0 });
    expect(buildRecipe({ ...baseInput(), site: { lat: 0, lon: 0, heading: -90 } }).site).toEqual({ lat: 0, lon: 0, heading: 270 });
    expect(buildRecipe({ ...baseInput(), site: null }).site).toBeUndefined();
  });

  it('rounds plan dimensions and the ceiling height to the centimetre', () => {
    const r = buildRecipe({ ...baseInput(), planDims: { width: 3.754, depth: 4.596 }, ceilingHeight: 2.4449 });
    expect(r.planDims).toEqual({ width: 3.75, depth: 4.6 });
    expect(r.ceilingHeight).toBe(2.44);
    const bare = buildRecipe({ ...baseInput(), planDims: null, ceilingHeight: null });
    expect(bare.planDims).toBeUndefined();
    expect(bare.ceilingHeight).toBeUndefined();
    expect('planDims' in bare).toBe(false);
  });

  it('keeps the photos in order, primary first and without an azimuth, extras with their hints', () => {
    const r = buildRecipe({
      ...baseInput(),
      photos: [
        { sha256: sha('a'), angle: 'back' }, // a label on the primary is ignored: it defines 0°
        { sha256: sha('b'), angle: 'left' },
        { sha256: sha('c'), azimuth: 45, angle: 'right' }, // an explicit azimuth wins
        { sha256: sha('d') },
        { sha256: sha('e'), azimuth: -90 },
      ],
    });
    expect(r.photos).toEqual([
      { role: 'primary', sha256: sha('a') },
      { azimuth: AZIMUTH_FOR_ANGLE.left, role: 'extra', sha256: sha('b') },
      { azimuth: 45, role: 'extra', sha256: sha('c') },
      { role: 'extra', sha256: sha('d') },
      { azimuth: 270, role: 'extra', sha256: sha('e') },
    ]);
    expect(AZIMUTH_FOR_ANGLE).toEqual({ centre: 0, right: 90, back: 180, left: 270 });
  });

  it('sets reconstructImages only past four images, and isPano only when asked', () => {
    const two = buildRecipe(baseInput());
    expect(two.reconstructImages).toBe(false);
    expect(two.isPano).toBe(false);
    const five = buildRecipe({ ...baseInput(), photos: ['a', 'b', 'c', 'd', 'e'].map((c) => ({ sha256: sha(c) })), isPano: true });
    expect(five.reconstructImages).toBe(true);
    expect(five.isPano).toBe(true);
    expect(five.prompt.startsWith('5 photographs ')).toBe(true);
  });

  it('keeps only the numeric and semantic part of the anchor', () => {
    expect(buildRecipe(baseInput()).anchor).toEqual({ method: 'door', metresPerUnit: 1.42958, referenceMetres: 2.03, referenceUnits: 1.42, uncertaintyM: 0.04 });
    const withAxis = buildRecipe({ ...baseInput(), anchor: { ...ANCHOR_SPEC, method: 'floorplan', axis: 'width' } });
    expect(withAxis.anchor.axis).toBe('width');
  });

  it('compiles the prompt from the recipe inputs plus the listing context', () => {
    const r = buildRecipe(baseInput());
    expect(r.prompt.startsWith('2 photographs of one real, empty bedroom, taken from the doorway. The room measures 3.8 m by 4.6 m (12 ft 4 in by 15 ft 1 in) on the floor plan. Ceiling height 2.4 m (8 ft).')).toBe(true);
    expect(r.prompt).toContain('Flooring: oak.');
    expect(r.prompt).toContain('On the 3rd floor of a 1920s brick apartment building in Boston.');
    expect(r.prompt.endsWith(PROMPT_CONSTRAINTS)).toBe(true);
    // The plan dimensions in the prompt are the rounded ones, so the prompt and the recipe agree.
    const noisy = buildRecipe({ ...baseInput(), planDims: { width: 3.751, depth: 4.6 } });
    expect(noisy.prompt).toBe(r.prompt);
  });

  it('refuses inputs the pipeline cannot run with', () => {
    expect(() => buildRecipe({ ...baseInput(), photos: [] })).toThrow(/at least one photo/);
    expect(() => buildRecipe({ ...baseInput(), photos: 'abcdefghi'.split('').map((c) => ({ sha256: sha(c) })) })).toThrow(/at most 8/);
    expect(() => buildRecipe({ ...baseInput(), photos: [{ sha256: 'not-a-hash' }] })).toThrow(/64 hex/);
    expect(() => buildRecipe({ ...baseInput(), tier: 'best' as never })).toThrow(/tier/);
    expect(() => buildRecipe({ ...baseInput(), provider: 'openai' as never })).toThrow(/provider/);
    expect(() => buildRecipe({ ...baseInput(), roomType: 'garage' as never })).toThrow(/roomType/);
    expect(() => buildRecipe({ ...baseInput(), model: '' })).toThrow(/model/);
    expect(() => buildRecipe({ ...baseInput(), pipelineVersion: ' ' })).toThrow(/pipelineVersion/);
    expect(() => buildRecipe({ ...baseInput(), planDims: { width: 0, depth: 4 } })).toThrow(/positive/);
    expect(() => buildRecipe({ ...baseInput(), site: { lat: 91, lon: 0, heading: 0 } })).toThrow(/out of range/);
    expect(() => buildRecipe({ ...baseInput(), anchor: { ...ANCHOR_SPEC, metresPerUnit: NaN } })).toThrow(/metresPerUnit/);
  });
});

describe('seed', () => {
  it('is the first 32 bits of the hash, unsigned, in [0, 4294967295]', () => {
    expect(seedFromHash('ffffffff' + '0'.repeat(56))).toBe(SEED_MAX);
    expect(SEED_MAX).toBe(4294967295);
    expect(seedFromHash('0'.repeat(64))).toBe(0);
    expect(seedFromHash('80000000' + 'f'.repeat(56))).toBe(2147483648);
    expect(seedFromHash('0000000a' + '0'.repeat(56))).toBe(10);
    expect(() => seedFromHash('xyz')).toThrow(/hex/);
  });

  it('is stable for a fixed recipe (pinned: a change here means every cached world regenerates)', () => {
    const recipe = buildRecipe(baseInput());
    const hash = recipeHash(recipe);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(PINNED_HASH);
    const seed = recipeSeed(recipe);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(SEED_MAX);
    expect(seed).toBe(Number.parseInt(hash.slice(0, 8), 16));
    expect(seed).toBe(PINNED_SEED);
    expect(recipeTag(hash)).toBe(`recipe:${PINNED_HASH.slice(0, 12)}`);
  });

  it('hashes the canonical form, so a recipe rebuilt from stored JSON hashes the same', () => {
    const recipe = buildRecipe(baseInput());
    const stored = JSON.parse(JSON.stringify(reversedKeys(recipe))) as Recipe;
    expect(recipeHash(stored)).toBe(recipeHash(recipe));
    expect(canonicalize(stored)).toEqual(recipe);
  });
});

describe('marbleRequestFrom', () => {
  const img = (c: string, extension?: string) => ({ base64: c.repeat(16), ...(extension === undefined ? {} : { extension }) });

  it('shapes a single-image request with the seed, no recaptioning and the recipe tag', () => {
    const recipe = buildRecipe({ ...baseInput(), photos: [{ sha256: sha('a') }] });
    const req = marbleRequestFrom(recipe, [img('A')]);
    const hash = recipeHash(recipe);
    expect(req).toEqual({
      display_name: 'Audora room',
      model: 'marble-1.0-draft',
      tags: ['audora', `recipe:${hash.slice(0, 12)}`],
      permission: { public: false, allow_id_access: true },
      seed: seedFromHash(hash),
      world_prompt: {
        type: 'image',
        image_prompt: { source: 'data_base64', data_base64: 'A'.repeat(16), extension: 'jpg' },
        text_prompt: recipe.prompt,
        is_pano: false,
        // Beside the text_prompt it is about, which is where server/marbleRequest.ts puts it too.
        disable_recaption: true,
      },
    });
    expect(req.seed).toBe(recipeSeed(recipe));
    // Nothing undefined leaks into the wire body.
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it('carries is_pano for a panorama and the display name, cut to 64 characters', () => {
    const recipe = buildRecipe({ ...baseInput(), photos: [{ sha256: sha('a') }], isPano: true });
    const req = marbleRequestFrom(recipe, [img('A')], { displayName: 'x'.repeat(100) });
    expect(req.world_prompt).toMatchObject({ type: 'image', is_pano: true });
    expect(req.display_name).toBe('x'.repeat(64));
  });

  it('shapes a multi-image request with azimuths on the labelled extras only', () => {
    const recipe = buildRecipe({ ...baseInput(), photos: [{ sha256: sha('a') }, { sha256: sha('b'), angle: 'left' }, { sha256: sha('c') }] });
    const req = marbleRequestFrom(recipe, [img('A'), img('B', 'jpeg'), img('C', '.PNG')]);
    expect(req.world_prompt.disable_recaption).toBe(true);
    expect(req.seed).toBe(recipeSeed(recipe));
    expect(req.world_prompt).toEqual({
      type: 'multi-image',
      multi_image_prompt: [
        { content: { source: 'data_base64', data_base64: 'A'.repeat(16), extension: 'jpg' } },
        { azimuth: 270, content: { source: 'data_base64', data_base64: 'B'.repeat(16), extension: 'jpg' } },
        { content: { source: 'data_base64', data_base64: 'C'.repeat(16), extension: 'png' } },
      ],
      reconstruct_images: false,
      text_prompt: recipe.prompt,
      disable_recaption: true,
    });
    const wp = req.world_prompt;
    if (wp.type !== 'multi-image') throw new Error('expected a multi-image prompt');
    expect('azimuth' in wp.multi_image_prompt[0]).toBe(false);
    expect('is_pano' in wp).toBe(false);
  });

  it('asks for reconstruction past four images', () => {
    const photos = ['a', 'b', 'c', 'd', 'e'].map((c) => ({ sha256: sha(c) }));
    const recipe = buildRecipe({ ...baseInput(), photos });
    const req = marbleRequestFrom(recipe, photos.map((p) => img(p.sha256[0])));
    expect(req.world_prompt).toMatchObject({ type: 'multi-image', reconstruct_images: true });
    expect(req.world_prompt.type === 'multi-image' && req.world_prompt.multi_image_prompt.length).toBe(5);
  });

  it('is a pure function of the recipe and the images', () => {
    const recipe = buildRecipe(baseInput());
    const a = marbleRequestFrom(recipe, [img('A'), img('B')]);
    const b = marbleRequestFrom(canonicalize(reversedKeys(recipe)), [img('A'), img('B')]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('refuses an image count that does not match the recipe, and empty images', () => {
    const recipe = buildRecipe(baseInput());
    expect(() => marbleRequestFrom(recipe, [img('A')])).toThrow(/2 photos but 1 images/);
    expect(() => marbleRequestFrom(recipe, [img('A'), img('B'), img('C')])).toThrow(/2 photos but 3 images/);
    expect(() => marbleRequestFrom(recipe, [img('A'), { base64: '' }])).toThrow(/base64/);
    expect(() => marbleRequestFrom(recipe, [img('A'), img('B', 'not/an ext')])).toThrow(/extension/);
  });
});

/*
 * Pinned for the `baseInput()` recipe above. If these change, the recipe shape or the prompt's
 * phrasing changed, and every cached world will regenerate on the next pipeline run. Bump
 * PIPELINE_VERSION deliberately in that case and update the pins here.
 */
const PINNED_HASH = '075e0263c76562cd7db77d3cb3b5986c3c288ecc2eaff46cfb1db220588da432';
const PINNED_SEED = 123601507; // 0x075e0263
