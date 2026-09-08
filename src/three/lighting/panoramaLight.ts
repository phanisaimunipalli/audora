/**
 * Reading the room's light off the photograph.
 *
 * Portrait mode's whole trick is that the second layer is lit by the first. Marble hands us an
 * equirectangular panorama shot from the middle of the room, which is — literally — a measurement of
 * the light arriving at that point from every direction. One pass over a small copy of it gives
 * everything the furniture layer needs:
 *
 * - **irradiance**, per channel, for an up-facing and for a side-facing surface. These are in
 *   exactly the units three's diffuse IBL delivers (`getIBLIrradiance` returns `π · envMapColor ·
 *   envMapIntensity`, and `BRDF_Lambert` divides by π again), so a white Lambertian lit by this
 *   environment at intensity 1 renders at precisely `irradianceUp` — no fudge factor.
 * - **a sun**: the direction, colour and strength of the brightest region, which is the window.
 * - **the room level**: what the walls and floor of the photograph actually read as on screen, which
 *   is the number a white sofa has to match.
 *
 * From those, {@link lightBudget} divides one fixed amount of light between the environment map, a
 * shadow-casting key and a whisper of fill, and pre-compensates the renderer's tone curve so the
 * total lands where the photograph would have put it (see `./tone`).
 */
import * as THREE from 'three';
import { inverseToneMap, luminance, srgbToLinear } from './tone';

export interface SunEstimate {
  /** Unit vector from the room toward the light, in Audora's metric frame. */
  direction: THREE.Vector3;
  /** Colour of the bright region, normalised to full value. */
  color: THREE.Color;
  /** 0..1: how much brighter the brightest region is than the room average — an overcast room is ~0. */
  strength: number;
  /** Mean luminance 0..1, used to keep the fill in step with the photograph's exposure. */
  ambient: number;
}

/** The default when a panorama cannot be read: a soft key over the left shoulder. */
export const NEUTRAL_SUN: SunEstimate = {
  direction: new THREE.Vector3(-0.45, 0.78, 0.44).normalize(),
  color: new THREE.Color('#fff1de'),
  strength: 0.35,
  ambient: 0.5,
};

export type Rgb = [number, number, number];

export interface PanoramaLight {
  /** Mean display luminance of the whole sphere, 0..1. */
  mean: number;
  /** Brightest texel's display luminance. */
  peak: number;
  /**
   * Mean display luminance of everything that is *not* a light source — the room reflecting its own
   * light. This is the level a neutral surface standing in the room reads at, and the number the
   * furniture layer is matched to.
   */
  room: number;
  /** Linear irradiance (÷π) for a normal pointing up. A white Lambertian at envMapIntensity 1 renders at this. */
  irradianceUp: Rgb;
  /** The same for a vertical surface, averaged over four compass normals — a sofa's sides. */
  irradianceSide: Rgb;
  /** Share of the up-facing irradiance that comes from the bright region: 0 overcast, 1 one hard window. */
  directional: number;
  sun: SunEstimate;
}

/** A flat, mid-grey room, used when the panorama cannot be read (a tainted canvas, no CORS). */
export const NEUTRAL_LIGHT: PanoramaLight = {
  mean: 0.5,
  peak: 0.85,
  room: 0.46,
  irradianceUp: [0.18, 0.18, 0.18],
  irradianceSide: [0.15, 0.15, 0.15],
  directional: 0.3,
  sun: NEUTRAL_SUN,
};

export interface SampleOptions {
  /** `splatTransform().rotationY` — the turn the Marble group applies to the capture. */
  groupRotationY?: number;
  /** Sampling grid. 128×64 costs a fraction of a millisecond and is far finer than a direction needs. */
  width?: number;
  height?: number;
}

/**
 * One pass over the panorama.
 *
 * The mapping from texel to direction is the one PanoWorld documents, carried through the Marble
 * group: the sphere maps `u` to azimuth `360u − 90°`, the mesh's x-mirror flips that to `90° − 360u`,
 * its `+90°` yaw makes it `180° − 360u`, and the group's own `rotationY` adds the last turn. `v` is
 * plain elevation, and every texel is weighted by the solid angle it covers, so the poles — where an
 * equirectangular image spends most of its pixels on almost none of the sphere — stop shouting.
 *
 * Returns null rather than throwing when the canvas is tainted (a panorama served without CORS);
 * callers fall back to {@link NEUTRAL_LIGHT}.
 */
export function samplePanoramaLight(image: TexImageSource, opts: SampleOptions = {}): PanoramaLight | null {
  const w = opts.width ?? 128;
  const h = opts.height ?? 64;
  const groupRotationY = opts.groupRotationY ?? Math.PI;
  let data: ImageData;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image as CanvasImageSource, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  const px = data.data;
  const n = w * h;
  const lum = new Float32Array(n);
  let mean = 0;
  let peak = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const l = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
    lum[i] = l;
    mean += l;
    if (l > peak) peak = l;
  }
  mean /= n;
  if (!(peak > 0)) return null;

  // Only the top of the range is "the light"; everything below it is the room reflecting it.
  const cut = mean + (peak - mean) * 0.55;

  const dPhi = (2 * Math.PI) / w;
  const dTheta = Math.PI / h;
  const up: Rgb = [0, 0, 0];
  const upBright: Rgb = [0, 0, 0];
  // Four horizontal normals (±x, ±z); their mean is what a box-shaped piece's sides receive.
  const sides: Rgb[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const sunDir = new THREE.Vector3();
  const sunRgb = new THREE.Vector3();
  let sunWeight = 0;
  let roomLum = 0;
  let roomSolid = 0;

  for (let y = 0; y < h; y++) {
    // Row 0 is the top of the image, which is straight up.
    const v = 1 - (y + 0.5) / h;
    const elevation = (v - 0.5) * Math.PI;
    const ce = Math.cos(elevation);
    const se = Math.sin(elevation);
    const solid = dPhi * dTheta * ce;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = lum[i];
      const p = i * 4;
      const u = (x + 0.5) / w;
      const azimuth = Math.PI - 2 * Math.PI * u + groupRotationY;
      const wx = ce * Math.sin(azimuth);
      const wy = se;
      const wz = ce * Math.cos(azimuth);

      const lr = srgbToLinear(px[p] / 255);
      const lg = srgbToLinear(px[p + 1] / 255);
      const lb = srgbToLinear(px[p + 2] / 255);

      const cUp = wy > 0 ? wy * solid : 0;
      if (cUp > 0) {
        up[0] += lr * cUp;
        up[1] += lg * cUp;
        up[2] += lb * cUp;
        if (l >= cut) {
          upBright[0] += lr * cUp;
          upBright[1] += lg * cUp;
          upBright[2] += lb * cUp;
        }
      }
      const horiz: readonly number[] = [wx, -wx, wz, -wz];
      for (let k = 0; k < 4; k++) {
        const c = horiz[k];
        if (c <= 0) continue;
        const wgt = c * solid;
        sides[k][0] += lr * wgt;
        sides[k][1] += lg * wgt;
        sides[k][2] += lb * wgt;
      }

      if (l >= cut) {
        // Luminance⁴ so one window wins over a bright wall.
        const wq = Math.pow(l, 4) * ce;
        sunDir.x += wx * wq;
        sunDir.y += wy * wq;
        sunDir.z += wz * wq;
        sunRgb.x += px[p] * wq;
        sunRgb.y += px[p + 1] * wq;
        sunRgb.z += px[p + 2] * wq;
        sunWeight += wq;
      } else {
        roomLum += l * solid;
        roomSolid += solid;
      }
    }
  }

  const norm = (rgb: Rgb): Rgb => [rgb[0] / Math.PI, rgb[1] / Math.PI, rgb[2] / Math.PI];
  const irradianceUp = norm(up);
  const side: Rgb = [0, 0, 0];
  for (const s of sides) {
    side[0] += s[0] / 4;
    side[1] += s[1] / 4;
    side[2] += s[2] / 4;
  }
  const irradianceSide = norm(side);
  const upLum = luminance(irradianceUp);
  const directional = upLum > 0 ? Math.min(1, luminance(norm(upBright)) / upLum) : 0;

  let sun: SunEstimate;
  if (sunWeight > 0 && sunDir.lengthSq() > 1e-9) {
    sunDir.normalize();
    /* Daylight arrives from above even when the brightest texel is a window at eye height. A key
       light near the horizon would light our furniture from underneath and rake its shadows right
       out of the room, so the estimate is lifted to about 20° — the elevation the light actually
       reaches the floor at once it has bounced off the ceiling. */
    if (sunDir.y < 0.34) {
      sunDir.y = 0.34;
      sunDir.normalize();
    }
    sunRgb.divideScalar(sunWeight);
    const top = Math.max(sunRgb.x, sunRgb.y, sunRgb.z, 1);
    sun = {
      direction: sunDir.clone(),
      color: new THREE.Color(sunRgb.x / top, sunRgb.y / top, sunRgb.z / top).convertSRGBToLinear(),
      // Flat light → the mean is close to the peak → almost no sun, which is the honest answer.
      strength: THREE.MathUtils.clamp((peak - mean) / Math.max(0.08, peak), 0, 1),
      ambient: mean,
    };
  } else {
    sun = { ...NEUTRAL_SUN, direction: NEUTRAL_SUN.direction.clone(), color: NEUTRAL_SUN.color.clone(), ambient: mean };
  }

  return {
    mean,
    peak,
    room: roomSolid > 0 ? roomLum / roomSolid : mean,
    irradianceUp,
    irradianceSide,
    directional,
    sun,
  };
}

export interface BudgetOptions {
  /** The renderer's `toneMappingExposure`. */
  exposure?: number;
  /** The renderer is ACES tone-mapping (SceneCanvas always is). False skips the compensation. */
  toneMapped?: boolean;
  /** Overall multiplier the caller can dial, for a room the leasing team wants brighter. */
  intensity?: number;
}

/**
 * How one room's worth of light is divided between the layers that produce it.
 *
 * Every number is derived, not chosen: {@link lightBudget} works out the total a white up-facing
 * Lambertian must reach and then splits it.
 */
export interface LightBudget {
  /** `envMapIntensity` on the furniture's own materials — the environment carries most of the light. */
  envMapIntensity: number;
  /** Intensity of the shadow-casting directional light. */
  key: number;
  /** Its colour, linear. */
  keyColor: THREE.Color;
  /** Hemisphere fill, so a piece's shadowed side is never a silhouette. */
  hemisphere: number;
  /** The last, tiny lift off pure black. */
  ambient: number;
  /** Opacity of the shadow catcher on the real floor. */
  shadowOpacity: number;
  /** Share of the up-facing light the key is responsible for — how deep a shadow reads. */
  directionalShare: number;
  /** What a white up-facing Lambertian will actually display at, 0..1 sRGB. For the readout and the tests. */
  whiteDisplay: number;
  /** What the photograph's own surfaces display at. `whiteDisplay` is matched to this. */
  roomDisplay: number;
}

/**
 * Split one room's light between the environment map, the key and the fill.
 *
 * The target is the whole point: a white Lambertian surface facing up should leave the tone mapper
 * at the same display luminance the *photograph's own* surfaces have. That is what "the sofa is in
 * the room" means, measured. `inverseToneMap` turns that display target back into the radiance the
 * renderer has to be fed, and the rest is division:
 *
 * - the **key** takes a share proportional to how directional the room actually is, so a flat
 *   overcast flat gets a whisper of a shadow and a room with one hard window gets a real one;
 * - a little goes to **hemisphere fill** and a crumb to **ambient**, so nothing is ever a silhouette;
 * - the **environment** takes the remainder — which is most of it, and it is the part that carries
 *   the room's colour and its direction, because it *is* the room.
 *
 * The environment's own contribution is divided by the irradiance the panorama actually measured, so
 * a dim flat and a sunlit corner room end up with different `envMapIntensity` and the same answer to
 * "does this belong here".
 */
export function lightBudget(light: PanoramaLight, opts: BudgetOptions = {}): LightBudget {
  const exposure = opts.exposure ?? 1;
  const gain = Math.max(0.05, opts.intensity ?? 1);
  const upLum = Math.max(1e-4, luminance(light.irradianceUp));

  /* The photograph's own level. `room` is the mean of everything that is not a light source, which
     for a painted interior is the walls; a white piece of furniture is a little more reflective than
     a painted wall, so it is allowed to sit slightly above it. */
  const roomDisplay = THREE.MathUtils.clamp(light.room * 1.06, 0.04, 0.92);
  const target = (opts.toneMapped === false ? srgbToLinear(roomDisplay) : inverseToneMap(srgbToLinear(roomDisplay), exposure)) * gain;

  // How much of it the key carries. A flat room gets almost none; one hard window gets a third.
  const share = THREE.MathUtils.clamp(0.1 + 0.42 * light.sun.strength * (0.4 + 0.6 * light.directional), 0.08, 0.46);
  const hemiShare = 0.1;
  const ambientShare = 0.04;

  const ny = Math.max(0.2, light.sun.direction.y);
  // A directional light's diffuse term is `intensity · dot(N, L) / π`; the up-facing surface we are
  // calibrating on sees `dot = direction.y`.
  const key = (Math.PI * share * target) / ny;
  const hemisphere = hemiShare * target;
  const ambient = ambientShare * target;
  const envMapIntensity = THREE.MathUtils.clamp(((1 - share - hemiShare - ambientShare) * target) / upLum, 0.02, 8);

  return {
    envMapIntensity,
    key,
    keyColor: light.sun.color.clone(),
    hemisphere,
    ambient,
    // The catcher darkens the real floor by this much where a piece shades it. Deeper in a room the
    // panorama says has one strong window, softer in one it says is overcast.
    shadowOpacity: THREE.MathUtils.clamp(0.2 + 0.4 * light.sun.strength * (0.35 + 0.65 * light.directional), 0.14, 0.44),
    directionalShare: share,
    whiteDisplay: roomDisplay,
    roomDisplay,
  };
}
