/**
 * The EXIF field-of-view prior (`shared/exifPrior.ts`) — docs/ACCURACY.md §2, source 5.
 *
 * The synthetic room below is built *from* a scale rather than measured at one: pick 0.655 m per
 * raw unit and a 2.44 m storey, and the collider's numbers follow by division. So every expectation
 * here is arithmetic on two facts, and the question the first test asks — "does the prior come back
 * with the scale the room was built from" — has an exact answer.
 *
 * The other three questions: does a photo with no readable lens produce nothing at all, do the two
 * routes to a field of view (a phone in the table against its true focal length, and the 35 mm
 * equivalent the same phone writes) agree, and does feeding the prior to fusion tighten the answer.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CEILING_M,
  FRAMING_TOLERANCE,
  cameraKey,
  ceilingUnitsOf,
  exifScalePrior,
  horizontalFov,
  sensorWidthMm,
  verticalFov,
  wallFacingCapture,
  type ExifCamera,
} from '../shared/exifPrior';
import { EXIF_SIGMA_REL, fuseScale } from '../shared/fusion';
import type { WorldBounds } from '../shared/collider';
import { measureRoom } from '../server/pipeline';

/* ---------- the synthetic room ---------- */

/** Metres per raw unit: the answer the prior has to find. */
const TRUE_SCALE = 0.655;
/** The storey the far wall runs to, and the metric length the prior is closed on. */
const CEILING_M = DEFAULT_CEILING_M;
/** Raw units from the capture point to the wall the photographer faced. */
const DISTANCE_RAW = 4;
/** The photo: a phone held sideways, 4:3. */
const PIXELS = { width: 4032, height: 3024 };

const CEILING_RAW = CEILING_M / TRUE_SCALE; // 3.7252
/** The lens that frames that wall floor to ceiling from `DISTANCE_RAW`, as a 35 mm equivalent. */
const TAN_V = CEILING_RAW / (2 * DISTANCE_RAW);
const TAN_H = TAN_V * (PIXELS.width / PIXELS.height);
/** Cameras write `FocalLengthIn35mmFilm` as a whole number of millimetres, so the fixture does too. */
const FOCAL_35 = Math.round(36 / (2 * TAN_H)); // 29 mm
/** The far wall, raw units: as wide as the frame that just contains it. */
const WALL_RAW = 2 * DISTANCE_RAW * TAN_H;
/** The photographer stands this far in front of the wall behind them. */
const BEHIND_RAW = 0.2;
/** Raw units from the capture point down to the floor: a phone held at chest height. */
const CAMERA_HEIGHT_RAW = 1.7;

const CAMERA: ExifCamera = { make: 'Apple', model: 'iPhone 13 Pro', focalLength35: FOCAL_35 };
const PHOTO = { exif: CAMERA, ...PIXELS };

/**
 * The collider of that room, in the frame `shared/collider.ts` reads: y up, capture point at the
 * origin, the room extending toward raw `+z` (which `roomRect` turns into Audora's north).
 */
function synthetic(over: Partial<WorldBounds> = {}): WorldBounds {
  const halfWidth = WALL_RAW / 2;
  const floorY = -CAMERA_HEIGHT_RAW;
  const ceilingY = floorY + CEILING_RAW;
  return {
    minX: -halfWidth,
    maxX: halfWidth,
    minY: floorY,
    maxY: ceilingY,
    minZ: -BEHIND_RAW,
    maxZ: DISTANCE_RAW,
    floorY,
    ceilingY,
    walls: { minX: -halfWidth, maxX: halfWidth, minZ: -BEHIND_RAW, maxZ: DISTANCE_RAW, rotation: 0, score: 0.95 },
    method: 'walls',
    ...over,
  };
}

const BOUNDS = synthetic();

/* ---------- 1. the prior is the scale the room was built from ---------- */

describe('exifScalePrior on a room whose scale is known', () => {
  it('recovers it to well inside 2 %', () => {
    const prior = exifScalePrior({ ...PHOTO, bounds: BOUNDS, ceilingM: CEILING_M });
    expect(prior).not.toBeNull();
    expect(Math.abs(prior!.metresPerUnit / TRUE_SCALE - 1)).toBeLessThan(0.02);
    // The only gap is the whole millimetre the camera rounded its 35 mm equivalent to.
    expect(Math.abs(prior!.metresPerUnit / TRUE_SCALE - 1)).toBeLessThan(0.001);
  });

  it('names the wall it measured and shows its work', () => {
    const prior = exifScalePrior({ ...PHOTO, bounds: BOUNDS })!;
    expect(prior.wall).toBe('north');
    expect(prior.distance).toBeCloseTo(DISTANCE_RAW, 6);
    expect(prior.wallWidth).toBeCloseTo(WALL_RAW, 3);
    expect(prior.ceilingUnits).toBeCloseTo(CEILING_RAW, 3);
    expect(prior.ceilingM).toBe(CEILING_M);
    expect(prior.sigmaRel).toBe(EXIF_SIGMA_REL);
    // The frame at that wall is the wall: that is the equality the prior rests on.
    expect(prior.framing.width).toBeCloseTo(1, 2);
    expect(prior.framing.height).toBeCloseTo(1, 2);
    expect(prior.frameHeight).toBeCloseTo(prior.ceilingUnits, 2);
  });

  it('is a pure function of its inputs', () => {
    expect(exifScalePrior({ ...PHOTO, bounds: BOUNDS })).toEqual(exifScalePrior({ ...PHOTO, bounds: synthetic() }));
  });

  it('scales with the ceiling it is closed on, because that is the metric length it uses', () => {
    const standard = exifScalePrior({ ...PHOTO, bounds: BOUNDS, ceilingM: 2.44 })!;
    const tall = exifScalePrior({ ...PHOTO, bounds: BOUNDS, ceilingM: 3.05 })!;
    expect(tall.metresPerUnit / standard.metresPerUnit).toBeCloseTo(3.05 / 2.44, 5);
  });
});

/* ---------- 2. missing inputs produce nothing at all ---------- */

describe('exifScalePrior with something missing', () => {
  it('returns null when there is no EXIF', () => {
    expect(exifScalePrior({ exif: null, ...PIXELS, bounds: BOUNDS })).toBeNull();
    expect(exifScalePrior({ ...PIXELS, bounds: BOUNDS })).toBeNull();
  });

  it('returns null when the EXIF says nothing about the lens', () => {
    expect(exifScalePrior({ exif: { make: 'Apple', model: 'iPhone 13 Pro' }, ...PIXELS, bounds: BOUNDS })).toBeNull();
  });

  it('returns null for a camera the table does not know, rather than guessing a sensor', () => {
    expect(exifScalePrior({ exif: { make: 'Acme', model: 'Cam 1', focalLength: 4.2 }, ...PIXELS, bounds: BOUNDS })).toBeNull();
    // A Pixel 7a is a different sensor from a Pixel 7 and must not borrow its frame.
    expect(sensorWidthMm({ make: 'Google', model: 'Pixel 7a' })).toBeNull();
  });

  it('returns null without the photo’s pixel size', () => {
    expect(exifScalePrior({ exif: CAMERA, height: PIXELS.height, bounds: BOUNDS })).toBeNull();
    expect(exifScalePrior({ exif: CAMERA, width: 0, height: PIXELS.height, bounds: BOUNDS })).toBeNull();
  });

  it('returns null without a collider', () => {
    expect(exifScalePrior({ ...PHOTO })).toBeNull();
    expect(exifScalePrior({ ...PHOTO, bounds: null })).toBeNull();
  });

  it('returns null when the photograph did not frame the wall the collider measured', () => {
    // A wide lens from the same spot: the frame at that wall is half as big again as the wall, so
    // the equality the prior rests on is not the case and there is no prior.
    const wide = exifScalePrior({ exif: { focalLength35: 18 }, ...PIXELS, bounds: BOUNDS });
    expect(wide).toBeNull();
    // ... and a lens narrow enough to see only part of it is refused the same way.
    expect(exifScalePrior({ exif: { focalLength35: 50 }, ...PIXELS, bounds: BOUNDS })).toBeNull();
    // The edge of the tolerance is where it turns over.
    const inside = exifScalePrior({ ...PHOTO, bounds: synthetic({ walls: { ...synthetic().walls!, minX: -WALL_RAW / 2 / 1.2, maxX: WALL_RAW / 2 / 1.2 } }) });
    expect(inside).not.toBeNull();
    expect(inside!.framing.width).toBeLessThan(FRAMING_TOLERANCE);
  });

  it('returns null when the capture point is not inside the room the fit found', () => {
    const outside = synthetic({ walls: { minX: 1, maxX: 5, minZ: -BEHIND_RAW, maxZ: DISTANCE_RAW, rotation: 0 } });
    expect(exifScalePrior({ ...PHOTO, bounds: outside })).toBeNull();
  });
});

/* ---------- 3. the two routes to a field of view agree ---------- */

describe('horizontalFov', () => {
  const PHONES: Array<{ camera: ExifCamera; equivalent: number }> = [
    { camera: { make: 'Apple', model: 'iPhone 13 Pro', focalLength: 5.7 }, equivalent: 26 },
    { camera: { make: 'Apple', model: 'iPhone 13 Pro Max', focalLength: 5.7 }, equivalent: 26 },
    { camera: { make: 'Apple', model: 'iPhone 14 Pro', focalLength: 6.86 }, equivalent: 24 },
    { camera: { make: 'Google', model: 'Pixel 7 Pro', focalLength: 6.81 }, equivalent: 25 },
    { camera: { make: 'samsung', model: 'SM-S911B', focalLength: 5.4 }, equivalent: 23 },
  ];

  it('gives the same angle from the table and from the 35 mm equivalent', () => {
    for (const { camera, equivalent } of PHONES) {
      const fromTable = horizontalFov(camera, PIXELS.width, PIXELS.height);
      const fromEquivalent = horizontalFov({ focalLength35: equivalent }, PIXELS.width, PIXELS.height);
      expect(fromTable).not.toBeNull();
      expect(Math.abs(fromTable! / fromEquivalent! - 1)).toBeLessThan(0.01);
    }
  });

  it('agrees in portrait too, where the frame is 24 mm across and not 36', () => {
    const { camera, equivalent } = PHONES[0];
    const table = horizontalFov(camera, PIXELS.height, PIXELS.width)!;
    const equiv = horizontalFov({ focalLength35: equivalent }, PIXELS.height, PIXELS.width)!;
    expect(Math.abs(table / equiv - 1)).toBeLessThan(0.01);
    // A portrait frame is narrower than the same lens turned sideways.
    expect(table).toBeLessThan(horizontalFov(camera, PIXELS.width, PIXELS.height)!);
  });

  it('prefers what the camera wrote over what the table guessed', () => {
    const both = horizontalFov({ make: 'Apple', model: 'iPhone 13 Pro', focalLength: 5.7, focalLength35: 40 }, PIXELS.width, PIXELS.height)!;
    expect(both).toBeCloseTo(2 * Math.atan(36 / 80), 9);
  });

  it('refuses an angle no photograph of a room has', () => {
    expect(horizontalFov({ focalLength35: 400 }, PIXELS.width, PIXELS.height)).toBeNull();
    expect(horizontalFov({ focalLength35: 3 }, PIXELS.width, PIXELS.height)).toBeNull();
  });

  it('keys the table on whole words, with the Samsung region letter dropped', () => {
    expect(cameraKey('samsung', 'SM-S911B')).toBe('samsung sm s911');
    expect(cameraKey('Apple', 'iPhone 15 Pro Max')).toBe('apple iphone 15 pro max');
    expect(sensorWidthMm({ make: 'Apple', model: 'iPhone 15 Pro Max' })).toBe(sensorWidthMm({ make: 'Apple', model: 'iPhone 15 Pro' }));
    expect(sensorWidthMm({ make: 'Apple', model: 'iPhone 15' })).not.toBe(sensorWidthMm({ make: 'Apple', model: 'iPhone 15 Pro' }));
    expect(sensorWidthMm({})).toBeNull();
  });

  it('derives the vertical angle from the frame’s own aspect', () => {
    const h = horizontalFov({ focalLength35: 26 }, PIXELS.width, PIXELS.height)!;
    expect(Math.tan(verticalFov(h, PIXELS.width, PIXELS.height) / 2)).toBeCloseTo(Math.tan(h / 2) * (3 / 4), 9);
  });
});

/* ---------- the wall the optical axis meets ---------- */

describe('wallFacingCapture', () => {
  it('is the north wall of a room that was photographed square on', () => {
    const facing = wallFacingCapture(BOUNDS)!;
    expect(facing.wall).toBe('north');
    expect(facing.yaw).toBe(0);
    expect(facing.distance).toBeCloseTo(DISTANCE_RAW, 9);
    expect(facing.width).toBeCloseTo(WALL_RAW, 9);
  });

  it('follows the room’s own turn, so a photographer facing a side wall gets that wall', () => {
    // A quarter turn puts the optical axis along +x: the east wall, and its width is the room's depth.
    const turned: WorldBounds = { ...BOUNDS, walls: { minX: -1, maxX: 3, minZ: -0.5, maxZ: 2.5, rotation: Math.PI / 2 } };
    const facing = wallFacingCapture(turned)!;
    expect(facing.wall).toBe('east');
    expect(facing.distance).toBeCloseTo(3, 9);
    expect(facing.width).toBeCloseTo(3, 9);
  });

  it('falls back to the bounding box when there is no wall rectangle', () => {
    const box: WorldBounds = { ...BOUNDS, walls: undefined, method: 'aabb' };
    expect(wallFacingCapture(box)!.wall).toBe('north');
    expect(wallFacingCapture(undefined)).toBeNull();
  });

  it('reads the ceiling off the mesh’s slabs, and the box only when it has none', () => {
    expect(ceilingUnitsOf(BOUNDS)).toBeCloseTo(CEILING_RAW, 9);
    expect(ceilingUnitsOf({ ...BOUNDS, floorY: undefined, ceilingY: undefined, minY: -2, maxY: 2 })).toBe(4);
  });
});

/* ---------- 4. what the prior does to the fit ---------- */

describe('fusion with the prior', () => {
  const raw = { width: WALL_RAW, depth: DISTANCE_RAW + BEHIND_RAW, height: CEILING_RAW };
  const prior = exifScalePrior({ ...PHOTO, bounds: BOUNDS })!;

  it('is tighter than the same fit without it', () => {
    const without = fuseScale({ raw, ceiling: { heightM: CEILING_M } });
    const with_ = fuseScale({ raw, ceiling: { heightM: CEILING_M }, exif: { metresPerUnit: prior.metresPerUnit, sigmaRel: prior.sigmaRel } });
    expect(with_.sigmaRel).toBeLessThan(without.sigmaRel);
    expect(with_.scale).toBeCloseTo(TRUE_SCALE, 3);
  });

  it('is a prior: it corroborates nothing and it says so', () => {
    const fused = fuseScale({ raw, plan: { width: WALL_RAW * TRUE_SCALE }, exif: { metresPerUnit: prior.metresPerUnit } });
    const row = fused.residuals.find((r) => r.source === 'exif')!;
    expect(row.label).toBe('EXIF field of view');
    expect(row.assumed).toBe(true);
    expect(fused.independentSources).toBe(1); // the plan; the field of view is ours, not the room's
  });
});

/* ---------- the wiring: measureRoom shows the residual line ---------- */

describe('measureRoom with the room’s primary photo', () => {
  const NOW = Date.parse('2026-09-08T12:00:00Z');

  it('adds the EXIF field of view to the residuals', () => {
    const measured = measureRoom({ bounds: BOUNDS, photo: PHOTO, now: NOW });
    const row = measured.measurement.residuals.find((r) => r.source === 'exif');
    expect(row?.label).toBe('EXIF field of view');
    expect(row?.assumed).toBe(true);
    expect(measured.measurement.scale).toBeCloseTo(TRUE_SCALE, 2);
    expect(measured.geometry.width).toBeCloseTo(WALL_RAW * TRUE_SCALE, 1);
  });

  it('leaves it out entirely when the room has no photo to read', () => {
    const measured = measureRoom({ bounds: BOUNDS, now: NOW });
    expect(measured.measurement.residuals.some((r) => r.source === 'exif')).toBe(false);
    expect(measureRoom({ bounds: BOUNDS, photo: { exif: null, width: null, height: null }, now: NOW }).measurement.residuals.some((r) => r.source === 'exif')).toBe(false);
  });

  it('closes the prior on the printed ceiling when the plan printed one', () => {
    const printed = measureRoom({ bounds: BOUNDS, planDims: { height: 3.05 }, photo: PHOTO, now: NOW });
    const row = printed.measurement.residuals.find((r) => r.source === 'exif')!;
    expect(row.expected).toBeCloseTo(3.05 / (2 * DISTANCE_RAW * Math.tan(verticalFov(horizontalFov(CAMERA, PIXELS.width, PIXELS.height)!, PIXELS.width, PIXELS.height) / 2)), 4);
  });

  it('is deterministic', () => {
    expect(measureRoom({ bounds: BOUNDS, photo: PHOTO, now: NOW })).toEqual(measureRoom({ bounds: synthetic(), photo: { exif: { ...CAMERA }, ...PIXELS }, now: NOW }));
  });
});
