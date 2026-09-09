/**
 * The EXIF field-of-view prior on the scale — docs/ACCURACY.md §2, source 5.
 *
 * `shared/fusion.ts` has always accepted an `exif` constraint (metres per raw unit, σ 15 %) and
 * nothing produced one. This module is the conversion: a photograph's optics and the collider's own
 * room, into one number fusion can weigh against the plan, the anchor, the ceiling and Marble.
 *
 * ## What a photograph can and cannot say
 *
 * A photograph fixes **angles, not lengths**. Double every distance in a room and every photograph
 * of it is pixel for pixel unchanged, so a field of view on its own can never scale a
 * reconstruction — and neither can a field of view plus a collider, because the collider is in raw
 * units too. One metric length has to close the system. The one this module closes on is the wall's
 * own storey height: **the wall the photograph faces runs floor to ceiling**, and a ceiling is
 * 2.44 m unless the plan printed one. That is an assumption about the room, not a measurement of
 * it, which is exactly why the result is a *prior* — `assumed` in the residual list, never
 * corroborating, floored so it cannot take a room's confidence to zero on its own.
 *
 * ## The derivation
 *
 * The camera is a pinhole at the capture point, which is the origin of the collider's frame. Its
 * frame, at a plane `d` away along the optical axis, is a rectangle:
 *
 * ```
 *   hfov = 2·atan(across / (2·f))     across = 36 mm on a landscape frame, 24 mm on a portrait one,
 *                                     when the camera wrote FocalLengthIn35mmFilm; the frame width
 *                                     from SENSOR_WIDTH_MM against the true focal length otherwise
 *   vfov = 2·atan(tan(hfov/2) · H/W)  H, W the photo's pixels: the frame's own aspect
 *
 *   d    = the optical axis, from the capture point to the wall it meets   (raw units, roomRect)
 *   w    = that wall's own width                                           (raw units)
 *   c    = the room's floor-to-ceiling height                              (raw units)
 *
 *   Fw   = 2·d·tan(hfov/2)            the photograph's frame at that wall  (raw units)
 *   Fh   = 2·d·tan(vfov/2)
 *
 *   s    = ceiling / Fh               metres per raw unit
 * ```
 *
 * `s` is the scale at which the frame is exactly one storey tall where it meets the wall. The
 * inequality is what is really known — a wall entirely inside the frame gives `Fh·s ≥ ceiling`, a
 * wall that overflows it gives `≤` — and the equality is the boundary between them, so the prior is
 * only worth anything when the photograph really did frame that wall. **That is what the collider's
 * `w` and `c` are for**: `Fw ≈ w` and `Fh ≈ c` (within {@link FRAMING_TOLERANCE}) say the photograph
 * and the reconstruction are describing the same view, and when they do not, this module returns
 * `null` and fusion is fed nothing. A loosely framed shot would otherwise read the room as smaller
 * than it is by the whole framing factor, which on a wide phone lens from a doorway is not a 15 %
 * prior but a 70 % error, and a prior that is wrong is worse than a prior that is absent.
 *
 * The same gate is what makes a wrong `SENSOR_WIDTH_MM` entry harmless: a field of view off by a
 * third puts `Fw` a third away from the wall the collider measured, and the prior is withheld.
 *
 * ## Conventions
 *
 * - **Dependency-free, pure, deterministic.** No clock, no randomness, no I/O, no locale; the same
 *   photo and the same collider always give the same object, to the same 6 decimals, because what
 *   comes out of it is shown on a published room.
 * - **Raw units in, metres per raw unit out.** Every length from the collider is the provider's own
 *   unit with the capture point at the origin ({@link roomRect}); only `ceilingM` is metric.
 * - **Missing is missing.** Any input this needs and does not have — no focal length, an unknown
 *   camera, no pixel size, no collider, a capture point outside its own room — returns `null`.
 *   Nothing is defaulted into existence.
 * - **The sizes are millimetres**, the angles radians, and `width`/`height` are the photo's pixels
 *   *as seen* (the canonical copy is oriented upright before it is measured, `server/photos.ts`).
 */
import { roomRect, type WallSide, type WorldBounds } from './collider.js';
import { EXIF_SIGMA_REL } from './fusion.js';

/* ---------- the camera ---------- */

/** The EXIF fields the prior reads. `PhotoExif` in server/photos.ts satisfies it structurally. */
export interface ExifCamera {
  make?: string;
  model?: string;
  /** The lens's true focal length, millimetres (EXIF `FocalLength`). */
  focalLength?: number;
  /** The 35 mm-equivalent focal length, millimetres (EXIF `FocalLengthIn35mmFilm`). */
  focalLength35?: number;
}

/** The 35 mm frame the "equivalent" focal length is quoted against: 36 × 24 mm. */
export const FRAME_LONG_MM = 36;
export const FRAME_SHORT_MM = 24;

/**
 * The frame width, in millimetres, of the cameras common enough to be worth naming — keyed by
 * `make model`, matched on whole words so `pixel 7a` never reads as `pixel 7`, longest key wins.
 *
 * Each value is the horizontal frame size that reproduces that camera's published 35 mm equivalent
 * (`36 · focal / equivalent`), not the physical die, so the two paths through {@link horizontalFov}
 * agree with each other by construction and in both orientations. Every mainstream phone writes
 * `FocalLengthIn35mmFilm` and never reaches this table; it exists for the ones that do not, and it
 * is a prior like everything else here — the framing gate is what catches an entry that is wrong.
 */
export const SENSOR_WIDTH_MM: ReadonlyMap<string, number> = new Map([
  // Apple: f/equivalent from the published lens specs of the main (wide) camera.
  ['apple iphone 11', 5.88], // 4.25 mm @ 26 mm
  ['apple iphone 12', 5.88], // 4.25 mm @ 26 mm
  ['apple iphone 12 pro max', 7.06], // 5.10 mm @ 26 mm
  ['apple iphone 13', 7.06], // 5.10 mm @ 26 mm
  ['apple iphone 13 pro', 7.89], // 5.70 mm @ 26 mm
  ['apple iphone 14', 7.89], // 5.70 mm @ 26 mm
  ['apple iphone 14 pro', 10.29], // 6.86 mm @ 24 mm
  ['apple iphone 15', 9.36], // 6.76 mm @ 26 mm
  ['apple iphone 15 pro', 10.29], // 6.86 mm @ 24 mm
  ['apple iphone 16', 9.36], // 6.76 mm @ 26 mm
  ['apple iphone 16 pro', 10.15], // 6.76 mm @ 24 mm
  // Google: the Pixel 6–9 main camera. The "a" models are a different sensor and are deliberately
  // absent — an unmatched camera is a null, which costs a prior; a wrong one costs a measurement.
  ['google pixel 6', 9.81], // 6.81 mm @ 25 mm
  ['google pixel 7', 9.81],
  ['google pixel 8', 9.94], // 6.90 mm @ 25 mm
  ['google pixel 9', 9.94],
  // Samsung writes the model code, not the name; the region letter is dropped by `cameraKey`.
  ['samsung sm-g991', 8.1], // Galaxy S21, 5.40 mm @ 24 mm
  ['samsung sm-s901', 8.45], // Galaxy S22, 5.40 mm @ 23 mm
  ['samsung sm-s911', 8.45], // Galaxy S23
  ['samsung sm-s921', 8.45], // Galaxy S24
]);

/** Nothing outside this is a photograph of a room: it is a garbage focal length or a fisheye rig. */
export const MIN_FOV = (10 * Math.PI) / 180;
export const MAX_FOV = (140 * Math.PI) / 180;

/**
 * How far the photograph's frame may be from the wall the collider measured and still count as
 * "this shot framed that wall". A quarter either way: past it the equality the prior rests on is
 * not the case, and the honest answer is no prior at all.
 */
export const FRAMING_TOLERANCE = 1.25;

/** Nothing below this is a length. */
const EPS = 1e-9;

const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** Round to `dp` decimals, normalising `-0`, so the same photo always reports the same numbers. */
function round(x: number, dp: number): number {
  const s = 10 ** dp;
  const r = Math.round(x * s) / s;
  return r === 0 ? 0 : r;
}

/**
 * `make model` as the table keys it: lower case, punctuation to spaces, and a Samsung model code's
 * trailing region letter dropped (`SM-S911B` and `SM-S911U` are one phone with one lens).
 */
export function cameraKey(make: string | undefined, model: string | undefined): string {
  const tokens = `${make ?? ''} ${model ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => (/^[a-z]\d{3}[a-z]$/.test(t) ? t.slice(0, -1) : t));
  return tokens.join(' ');
}

/** The table's keys, pre-tokenised once, longest first so the most specific entry wins. */
const TABLE: ReadonlyArray<{ tokens: string[]; mm: number }> = [...SENSOR_WIDTH_MM]
  .map(([key, mm]) => ({ tokens: cameraKey(key, '').split(' ').filter(Boolean), mm }))
  .sort((a, b) => b.tokens.length - a.tokens.length);

/**
 * The frame width of this camera in millimetres, or `null` when it is not one we know. Matching is
 * on whole words from the start, so `iPhone 13 Pro Max` finds `iphone 13 pro` and `Pixel 7a` finds
 * nothing at all.
 */
export function sensorWidthMm(camera: Pick<ExifCamera, 'make' | 'model'> | null | undefined): number | null {
  if (!camera) return null;
  const tokens = cameraKey(camera.make, camera.model).split(' ').filter(Boolean);
  if (!tokens.length) return null;
  for (const entry of TABLE) {
    if (entry.tokens.length > tokens.length) continue;
    if (entry.tokens.every((t, i) => tokens[i] === t)) return entry.mm;
  }
  return null;
}

/**
 * The photograph's horizontal field of view, radians — the 35 mm equivalent when the camera wrote
 * one, the table against the true focal length otherwise, and `null` when neither is available or
 * the answer is not a plausible field of view.
 *
 * The frame is oriented by the photo itself: 36 mm across a landscape frame, 24 mm across a
 * portrait one. `width` and `height` are the pixels of the image *as seen*, which is what
 * `canonicalizePhoto` stores (it orients before it measures).
 */
export function horizontalFov(camera: ExifCamera | null | undefined, width: number | null | undefined, height: number | null | undefined): number | null {
  if (!camera || !positive(width) || !positive(height)) return null;
  const landscape = width >= height;
  if (positive(camera.focalLength35)) {
    return plausibleFov(2 * Math.atan((landscape ? FRAME_LONG_MM : FRAME_SHORT_MM) / (2 * camera.focalLength35)));
  }
  const frame = sensorWidthMm(camera);
  if (frame === null || !positive(camera.focalLength)) return null;
  const across = landscape ? frame : frame * (FRAME_SHORT_MM / FRAME_LONG_MM);
  return plausibleFov(2 * Math.atan(across / (2 * camera.focalLength)));
}

function plausibleFov(fov: number): number | null {
  return Number.isFinite(fov) && fov >= MIN_FOV && fov <= MAX_FOV ? fov : null;
}

/** The vertical field of view of a frame `width × height` pixels wide, radians. */
export function verticalFov(hfov: number, width: number, height: number): number {
  return 2 * Math.atan(Math.tan(hfov / 2) * (height / width));
}

/* ---------- the wall the photograph faces ---------- */

/** The wall the optical axis meets, measured from the capture point in raw units. */
export interface FacingWall {
  /** Which wall of Audora's metric room it is. */
  wall: WallSide;
  /** Raw units from the capture point to that wall, along the optical axis. */
  distance: number;
  /** That wall's own width, raw units. */
  width: number;
  /** The room's turn, `roomRect().yaw` — radians, and what points the optical axis. */
  yaw: number;
}

/**
 * The wall the primary photograph faces, from the collider alone.
 *
 * The capture point is the origin of {@link roomRect}'s rectangle and the photographer faced the
 * provider's `+z`, which the raw → world map (`(x, y, z) → (x, −y, −z)`, then the room's own yaw)
 * turns into `(−sin yaw, 0, −cos yaw)` in Audora's axes. Marching that direction out of the origin
 * to the first side of the rectangle names the wall and measures the distance along the optical
 * axis — which is the distance the frame's width is computed at, not the perpendicular one.
 *
 * `null` when there is no rectangle, or when the capture point is not inside it: a photographer
 * standing outside their own room is a wall fit that failed, not a view to reason about.
 */
export function wallFacingCapture(bounds: WorldBounds | null | undefined): FacingWall | null {
  const rect = bounds ? roomRect(bounds) : undefined;
  if (!rect) return null;
  const { minX, maxX, minZ, maxZ } = rect;
  // `roomRect` negates the fit's rotation, so a room square on to the capture comes back as `-0`.
  const yaw = rect.yaw === 0 ? 0 : rect.yaw;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (!positive(width) || !positive(depth)) return null;
  if (!(minX <= 0 && maxX >= 0 && minZ <= 0 && maxZ >= 0)) return null;
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  const tx = dx > EPS ? maxX / dx : dx < -EPS ? minX / dx : Infinity;
  const tz = dz > EPS ? maxZ / dz : dz < -EPS ? minZ / dz : Infinity;
  const t = Math.min(tx, tz);
  if (!positive(t)) return null;
  return tx < tz
    ? { wall: dx > 0 ? 'east' : 'west', distance: tx, width: depth, yaw }
    : { wall: dz < 0 ? 'north' : 'south', distance: tz, width, yaw };
}

/** The room's floor-to-ceiling height in raw units: the mesh's own slabs when it found them. */
export function ceilingUnitsOf(bounds: WorldBounds): number {
  const slabs = bounds.ceilingY != null && bounds.floorY != null ? bounds.ceilingY - bounds.floorY : NaN;
  return positive(slabs) ? slabs : bounds.maxY - bounds.minY;
}

/* ---------- the prior ---------- */

/** The standard storey the wall is assumed to run to when no ceiling height is known. */
export const DEFAULT_CEILING_M = 2.44;

export interface ExifPriorInput {
  /** The primary photo's EXIF, as `server/photos.ts` read it before stripping it. */
  exif?: ExifCamera | null;
  /** The photo's pixels, as seen (upright). */
  width?: number | null;
  height?: number | null;
  /** What the collider measured: raw units, capture point at the origin. */
  bounds?: WorldBounds | null;
  /** The storey the wall is assumed to run to, metres. The plan's printed height, when it has one. */
  ceilingM?: number;
}

/** The prior, and every number behind it, so a caller can show its work. */
export interface ExifScalePrior {
  /** Metres per raw unit — what {@link ExifPriorInput} says a raw unit is worth. */
  metresPerUnit: number;
  /** Its relative 1σ: `EXIF_SIGMA_REL`, because this is a prior and not a measurement. */
  sigmaRel: number;
  /** Radians. */
  hfov: number;
  vfov: number;
  /** The wall the photograph faces, and the room the collider measured, in raw units. */
  wall: WallSide;
  distance: number;
  wallWidth: number;
  ceilingUnits: number;
  /** The photograph's frame where it meets that wall, raw units. */
  frameWidth: number;
  frameHeight: number;
  /** `frameWidth / wallWidth` and `frameHeight / ceilingUnits`: both inside {@link FRAMING_TOLERANCE}. */
  framing: { width: number; height: number };
  /** The metric length the prior is closed on. */
  ceilingM: number;
}

/**
 * The scale a photograph's field of view implies, metres per raw unit — or `null`.
 *
 * The formula and the assumption it rests on are at the top of this file. `null` means one of:
 * the EXIF says nothing about the lens, the camera is not one the table knows and wrote no 35 mm
 * equivalent, the photo's pixel size is missing, the collider has no room, or the photograph did
 * not frame the wall the collider measured. In every one of those cases the caller feeds fusion
 * nothing at all, which is the difference between a room with no field-of-view prior and a room
 * with a wrong one.
 */
export function exifScalePrior(input: ExifPriorInput): ExifScalePrior | null {
  const { width, height } = input;
  const hfov = horizontalFov(input.exif, width, height);
  if (hfov === null || !positive(width) || !positive(height)) return null;

  const facing = wallFacingCapture(input.bounds);
  if (!facing || !input.bounds) return null;
  const ceilingUnits = ceilingUnitsOf(input.bounds);
  if (!positive(ceilingUnits)) return null;

  const ceilingM = positive(input.ceilingM) ? input.ceilingM : DEFAULT_CEILING_M;
  const vfov = verticalFov(hfov, width, height);
  const frameWidth = 2 * facing.distance * Math.tan(hfov / 2);
  const frameHeight = 2 * facing.distance * Math.tan(vfov / 2);
  if (!positive(frameWidth) || !positive(frameHeight)) return null;

  // The equality the prior rests on: this photograph framed this wall, across and up and down.
  const framing = { width: frameWidth / facing.width, height: frameHeight / ceilingUnits };
  if (!framed(framing.width) || !framed(framing.height)) return null;

  return {
    metresPerUnit: round(ceilingM / frameHeight, 6),
    sigmaRel: EXIF_SIGMA_REL,
    hfov: round(hfov, 6),
    vfov: round(vfov, 6),
    wall: facing.wall,
    distance: round(facing.distance, 4),
    wallWidth: round(facing.width, 4),
    ceilingUnits: round(ceilingUnits, 4),
    frameWidth: round(frameWidth, 4),
    frameHeight: round(frameHeight, 4),
    framing: { width: round(framing.width, 4), height: round(framing.height, 4) },
    ceilingM: round(ceilingM, 4),
  };
}

/** Inside the tolerance either way, judged symmetrically: 1.25× and 0.8× are the same disagreement. */
function framed(ratio: number): boolean {
  return positive(ratio) && ratio <= FRAMING_TOLERANCE && ratio >= 1 / FRAMING_TOLERANCE;
}
