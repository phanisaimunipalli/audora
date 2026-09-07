/**
 * Portrait-mode lighting: the arithmetic that decides whether a white sofa belongs in a photograph.
 *
 * The photo layer is drawn without tone mapping and the furniture layer through ACES, so "lit
 * correctly" is not a matter of taste — it is a number, and these tests hold it. The panorama
 * sampler itself needs a canvas and so lives in the browser; everything downstream of it is pure.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { acesToneMap, inverseToneMap, linearToSrgb, luminance, srgbToLinear } from '@/three/lighting/tone';
import { NEUTRAL_SUN, lightBudget, type PanoramaLight, type Rgb } from '@/three/lighting/panoramaLight';
import { describeSun, windowPositions } from '@/three/lighting/describe';
import type { RoomGeometry } from '@/engine/types';

const EXPOSURE = 1.05;

/** A room whose surfaces read at `display` on screen, lit by an environment of that same radiance. */
function room(display: number, opts: Partial<PanoramaLight> = {}): PanoramaLight {
  const linear = srgbToLinear(display);
  const rgb: Rgb = [linear, linear, linear];
  return {
    mean: display,
    peak: Math.min(1, display * 1.6),
    room: display,
    irradianceUp: rgb,
    irradianceSide: rgb,
    directional: 0.5,
    sun: { ...NEUTRAL_SUN, direction: NEUTRAL_SUN.direction.clone(), color: NEUTRAL_SUN.color.clone(), ambient: display },
    ...opts,
  };
}

describe('tone', () => {
  it('sRGB round-trips', () => {
    for (const v of [0, 0.02, 0.18, 0.5, 0.82, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });

  it('the ACES curve is monotonic and lifts mid-tones at exposure 1.05', () => {
    let last = -1;
    for (let x = 0; x <= 1.5; x += 0.05) {
      const y = acesToneMap(x, EXPOSURE);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
    // This is the whole problem: identical radiance in the two layers is not identical brightness.
    expect(acesToneMap(0.25, EXPOSURE)).toBeGreaterThan(0.25 * 1.1);
  });

  it('inverts itself, which is what the furniture layer is dimmed by', () => {
    for (const display of [0.05, 0.12, 0.25, 0.4, 0.6]) {
      const radiance = inverseToneMap(display, EXPOSURE);
      expect(acesToneMap(radiance, EXPOSURE)).toBeCloseTo(display, 4);
    }
    // Across the range a room is actually photographed at, the curve lifts, so the compensation
    // darkens. (Deep in the toe it does the opposite, which is why this is solved and not assumed.)
    for (const display of [0.12, 0.25, 0.4, 0.6]) expect(inverseToneMap(display, EXPOSURE)).toBeLessThan(display);
  });
});

describe('lightBudget', () => {
  it('lands a white up-facing surface on the photograph’s own level', () => {
    for (const display of [0.18, 0.35, 0.55]) {
      const light = room(display);
      const b = lightBudget(light, { exposure: EXPOSURE, toneMapped: true });
      // What the renderer will actually compute for a white Lambertian facing up:
      //   env · irradiance + hemisphere(sky, N up) + ambient + key · dot(N, L) / π
      const total =
        b.envMapIntensity * luminance(light.irradianceUp) +
        b.hemisphere +
        b.ambient +
        (b.key * Math.max(0, light.sun.direction.y)) / Math.PI;
      expect(acesToneMap(total, EXPOSURE)).toBeCloseTo(srgbToLinear(b.roomDisplay), 3);
    }
  });

  it('dims the environment far below 1 — the double-count that made furniture look pasted on', () => {
    const b = lightBudget(room(0.5), { exposure: EXPOSURE, toneMapped: true });
    expect(b.envMapIntensity).toBeLessThan(0.85);
    expect(b.envMapIntensity).toBeGreaterThan(0.2);
  });

  it('scales with the room: a dim flat gets less light than a bright one', () => {
    const dim = lightBudget(room(0.2), { exposure: EXPOSURE, toneMapped: true });
    const bright = lightBudget(room(0.7), { exposure: EXPOSURE, toneMapped: true });
    expect(bright.key).toBeGreaterThan(dim.key);
    // Both are matched to their own room, so the *intensity* need not differ — the level does.
    expect(bright.roomDisplay).toBeGreaterThan(dim.roomDisplay);
  });

  it('gives a hard-window room a deeper shadow than an overcast one', () => {
    const flat = lightBudget(room(0.45, { sun: { ...NEUTRAL_SUN, strength: 0.02 }, directional: 0.05 }), { exposure: EXPOSURE });
    const hard = lightBudget(room(0.45, { sun: { ...NEUTRAL_SUN, strength: 0.85 }, directional: 0.9 }), { exposure: EXPOSURE });
    expect(hard.directionalShare).toBeGreaterThan(flat.directionalShare * 2);
    expect(hard.shadowOpacity).toBeGreaterThan(flat.shadowOpacity);
    expect(hard.shadowOpacity).toBeLessThanOrEqual(0.44);
  });

  it('never asks for a negative or absurd environment', () => {
    for (const display of [0.01, 0.99]) {
      const b = lightBudget(room(display), { exposure: EXPOSURE });
      expect(b.envMapIntensity).toBeGreaterThan(0);
      expect(Number.isFinite(b.key)).toBe(true);
      expect(b.key).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('describeSun', () => {
  const sun = (x: number, y: number, z: number) => ({ ...NEUTRAL_SUN, direction: new THREE.Vector3(x, y, z).normalize() });

  it('places the light relative to the way the buyer is facing', () => {
    // Facing north (yaw 0) is looking along −z, so light from −x is on the left.
    expect(describeSun(sun(-1, 0.5, -0.2), { facing: 0 }).phrase).toBe('Light from the left');
    expect(describeSun(sun(1, 0.5, -0.2), { facing: 0 }).phrase).toBe('Light from the right');
    expect(describeSun(sun(0, 0.5, -1), { facing: 0 }).phrase).toBe('Light from ahead');
    expect(describeSun(sun(0, 0.5, 1), { facing: 0 }).phrase).toBe('Light from behind you');
    // Turn the buyer around and the same light is on the other side.
    expect(describeSun(sun(-1, 0.5, -0.2), { facing: Math.PI }).phrase).toBe('Light from the right');
  });

  it('names a window when the light comes through one', () => {
    const r: RoomGeometry = {
      width: 4,
      depth: 5,
      height: 2.5,
      door: { wall: 'south', offset: 2, width: 0.9, height: 2.03 },
      windows: [{ wall: 'north', offset: 4 / 2 - 0.6, width: 1.2, height: 1.4, sill: 0.9 }],
    };
    const windows = windowPositions(r);
    expect(windows[0].z).toBeCloseTo(-r.depth / 2, 6);
    const d = describeSun(sun(0, 0.5, -1), { facing: 0, windows });
    expect(d.throughWindow).toBe(true);
    expect(d.phrase).toBe('Light from the window ahead');
    // A light from the other side is not that window.
    expect(describeSun(sun(0, 0.5, 1), { facing: 0, windows }).throughWindow).toBe(false);
  });

  it('reports the directional share the shadows are actually drawn with', () => {
    const d = describeSun(sun(-0.5, 0.8, -0.3), { facing: 0, directionalShare: 0.62 });
    expect(d.directional).toBe('62% directional');
    expect(d.label).toContain('62% directional');
    expect(d.directionalPercent).toBe(62);
  });

  it('does not point at a wall when the light is overhead', () => {
    expect(describeSun(sun(0.05, 1, 0.05), { facing: 0 }).phrase).toBe('Light from overhead');
  });

  it('falls back to the compass without a viewer', () => {
    // Audora's frame is x east, z south.
    expect(describeSun(sun(0, 0.4, -1), {}).phrase).toBe('Light from the north');
    expect(describeSun(sun(1, 0.4, 0), {}).phrase).toBe('Light from the east');
    expect(describeSun(sun(-1, 0.4, 0), {}).phrase).toBe('Light from the west');
  });
});
