/**
 * The one piece of maths that makes composited furniture belong in a photograph.
 *
 * Audora draws the real capture **without tone mapping** (`toneMapped={false}` on the panorama
 * sphere, and Spark's splats are raw too), because a photograph is already a photograph: a texel
 * that says 0.53 must leave the canvas as 0.53. Everything Audora draws itself — the furniture —
 * goes through the renderer's ACES filmic curve at exposure 1.05.
 *
 * So the two layers live in different exposure spaces, and a white sofa lit to exactly the room's
 * own irradiance comes out of the tone mapper about 13 % brighter than the wall it stands against
 * (ACES lifts mid-tones at this exposure), before you even count the fill lights. That reads as a
 * cut-out. The fix is not to guess a multiplier: it is to invert the curve. Given the linear
 * radiance the photograph would have shown, {@link inverseToneMap} says what radiance to feed the
 * tone mapper so the pixel lands in the same place.
 *
 * `acesToneMap` is three's `ACESFilmicToneMapping` restricted to the grey axis, which is exact:
 * both ACES matrices in that shader have rows summing to 1, so for r = g = b the whole thing
 * collapses to `RRTAndODTFit(x · exposure / 0.6)`.
 */

/** sRGB transfer function, display value → linear. */
export function srgbToLinear(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear → sRGB display value. */
export function linearToSrgb(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Rec. 709 luminance of a linear (or display) RGB triple. */
export function luminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** The rational fit at the heart of three's ACES filmic curve. */
function rrtAndOdtFit(v: number): number {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.432951) + 0.238081;
  return a / b;
}

/**
 * three's `ACESFilmicToneMapping` on the grey axis: linear scene radiance → linear display value.
 * Saturates just below 1, which is why {@link inverseToneMap} clamps its target.
 */
export function acesToneMap(x: number, exposure = 1): number {
  if (!(x > 0)) return 0;
  return Math.min(1, Math.max(0, rrtAndOdtFit((x * exposure) / 0.6)));
}

/** The largest display value the curve can actually reach; targets are clamped below it. */
export const TONE_CEILING = 0.965;

/**
 * The radiance that tone-maps to `display`. Bisection — the curve is monotonic and 40 halvings of
 * [0, 32] is far finer than a byte of output. Used once per panorama, never per frame.
 */
export function inverseToneMap(display: number, exposure = 1): number {
  const target = Math.min(TONE_CEILING, Math.max(0, display));
  let lo = 0;
  let hi = 32;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (acesToneMap(mid, exposure) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * How much to dim a layer that *is* tone-mapped so it lands where an untone-mapped layer of the
 * same radiance would. 1 when the renderer is not tone-mapping at all.
 */
export function exposureMatch(radiance: number, exposure = 1): number {
  if (!(radiance > 0)) return 1;
  return inverseToneMap(radiance, exposure) / radiance;
}
