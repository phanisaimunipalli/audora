import type { AnchorSpec, PlausibilityWarning, RawGeometry, RoomGeometry } from './types';
import { round } from './geometry';

export const DOOR_HEIGHT_M = 2.03;
export const OUTLET_HEIGHT_M = 0.3;
export const EYE_HEIGHT_M = 1.6;
export const MIN_WALKWAY_M = 0.75;

/** Uncertainty, always with a space before the unit: "±4 cm". Matches `uncertainty()` in lib/format. */
function fmtCm(m: number): string {
  return `±${Math.max(1, Math.round(m * 100))} cm`;
}

/**
 * Uncertainty on a ~2m measurement from tapping a reference of `pixelFraction` of the image height.
 * `base` is the intrinsic spread of the assumption (interior doors vary a couple of cm).
 */
function tapUncertainty(reference: number, pixelFraction: number, base: number, tapError = 0.006): number {
  const frac = Math.max(0.03, Math.min(1, pixelFraction));
  const rel = Math.sqrt(base * base + (tapError / frac) * (tapError / frac));
  return round(reference * rel, 2);
}

export function anchorFromDoor(raw: RawGeometry, pixelFraction: number, taps?: { x: number; y: number }[]): AnchorSpec {
  const metresPerUnit = DOOR_HEIGHT_M / raw.doorHeightUnits;
  const u = tapUncertainty(DOOR_HEIGHT_M, pixelFraction, 0.015);
  return {
    method: 'door',
    referenceMetres: DOOR_HEIGHT_M,
    referenceUnits: raw.doorHeightUnits,
    metresPerUnit,
    uncertaintyM: u,
    label: `interior door · ${DOOR_HEIGHT_M.toFixed(2)} m · ${fmtCm(u)}`,
    taps,
    detail: 'Assumes a standard interior door.',
  };
}

export function anchorFromOutlet(raw: RawGeometry, pixelFraction: number, taps?: { x: number; y: number }[]): AnchorSpec {
  const metresPerUnit = OUTLET_HEIGHT_M / raw.outletHeightUnits;
  // Outlets are a short reference, so the same tap error is a much larger relative error.
  const u = tapUncertainty(2.0, pixelFraction, 0.05, 0.004);
  return {
    method: 'outlet',
    referenceMetres: OUTLET_HEIGHT_M,
    referenceUnits: raw.outletHeightUnits,
    metresPerUnit,
    uncertaintyM: u,
    label: `power outlet · ${OUTLET_HEIGHT_M.toFixed(2)} m centre · ${fmtCm(u)}`,
    taps,
    detail: 'Assumes an outlet centred 30 cm above the floor.',
  };
}

export function anchorFromWall(
  raw: RawGeometry,
  wall: 'width' | 'depth',
  typedMetres: number,
  tool: 'tape' | 'laser' = 'tape',
): AnchorSpec {
  const units = wall === 'width' ? raw.width : raw.depth;
  const metresPerUnit = typedMetres / units;
  const u = tool === 'laser' ? 0.01 : 0.02;
  return {
    method: 'wall',
    referenceMetres: typedMetres,
    referenceUnits: units,
    metresPerUnit,
    uncertaintyM: u,
    label: `${tool === 'laser' ? 'laser' : 'tape'} · ${wall === 'width' ? 'far wall' : 'side wall'} ${typedMetres.toFixed(2)} m · ${fmtCm(u)}`,
    detail: tool === 'laser' ? 'Laser measurement.' : 'Tape measurement.',
    axis: wall,
  };
}

export function anchorFromFloorplan(raw: RawGeometry, widthMetres: number): AnchorSpec {
  const metresPerUnit = widthMetres / raw.width;
  const u = 0.05;
  return {
    method: 'floorplan',
    referenceMetres: widthMetres,
    referenceUnits: raw.width,
    metresPerUnit,
    uncertaintyM: u,
    label: `floor plan · ${widthMetres.toFixed(2)} m wall · ${fmtCm(u)}`,
    detail: 'From the listing floor plan.',
    axis: 'width',
  };
}

export const CEILING_HEIGHT_M = 2.44;

/**
 * For a reconstruction whose ceiling height is known in raw units (from the collider mesh),
 * assume a standard 2.44m (8ft) ceiling. Coarse, free, and always available.
 */
export function anchorFromCeiling(raw: RawGeometry): AnchorSpec {
  const metresPerUnit = CEILING_HEIGHT_M / raw.height;
  const u = 0.12;
  return {
    method: 'ceiling',
    referenceMetres: CEILING_HEIGHT_M,
    referenceUnits: raw.height,
    metresPerUnit,
    uncertaintyM: u,
    label: `assumed ceiling · ${CEILING_HEIGHT_M.toFixed(2)} m · ${fmtCm(u)}`,
    detail: 'Assumes a standard 2.44 m ceiling. Type a wall length to tighten it.',
  };
}

/* ---------- reading a room off a reconstruction ----------
 * Measuring a real reconstruction needs a few more everyday heights, and they belong next to the
 * door and the outlet: they are assumptions about how homes are built, not facts about a mesh.
 * `services/marble` turns them into raw reconstruction units with `ceilingUnits()` — the collider
 * has no scale of its own until an anchor gives it one, but the ratio of a height to the ceiling
 * is the same in both. */

/** Knees to shoulders: the slice of a room that is wall rather than floor or ceiling. */
export const WALL_BAND_MARGIN_M = 0.3;
/** A plausible window: sill 0.90 m, head 2.10 m. Used only where the reconstruction is silent. */
export const WINDOW_SILL_M = 0.9;
export const WINDOW_HEAD_M = 2.1;

/**
 * A height in metres expressed in the raw units of a reconstruction whose floor-to-ceiling
 * distance is `ceilingUnits`, assuming a standard 2.44 m ceiling — the same assumption
 * `anchorFromCeiling` makes, so the two agree to the centimetre.
 */
export function unitsFromMetres(metres: number, ceilingUnits: number): number {
  if (!(ceilingUnits > 0)) return 0;
  return (metres / CEILING_HEIGHT_M) * ceilingUnits;
}

/**
 * Marble's own metric estimate. Honest but coarse, so the UI should push for a real anchor.
 *
 * The chip has to name the quantity the ± is attached to — "±15 cm" of *what* is not a measurement,
 * it is a shrug. Given the reconstruction's ceiling in raw units, the reference is stated the way
 * every other anchor states its own: as the room height the model believes in, which a seller can
 * sanity-check against the building.
 */
export function anchorFromMarble(metricScaleFactor: number, ceilingUnits?: number): AnchorSpec {
  const u = 0.15;
  const ceiling = ceilingUnits && ceilingUnits > 0 ? ceilingUnits * metricScaleFactor : null;
  return {
    method: 'marble',
    referenceMetres: ceiling ?? metricScaleFactor,
    referenceUnits: ceiling ? (ceilingUnits as number) : 1,
    metresPerUnit: metricScaleFactor,
    uncertaintyM: u,
    label: ceiling ? `model scale · ceiling ${ceiling.toFixed(2)} m · ${fmtCm(u)}` : `model scale · ${metricScaleFactor.toFixed(2)} m per unit · ${fmtCm(u)}`,
    detail: 'Scale measured by the reconstruction model itself. Type a wall length to tighten it.',
  };
}

export function anchorAssumed(raw: RawGeometry): AnchorSpec {
  const metresPerUnit = DOOR_HEIGHT_M / raw.doorHeightUnits;
  const u = 0.3;
  return {
    method: 'assumed',
    referenceMetres: DOOR_HEIGHT_M,
    referenceUnits: raw.doorHeightUnits,
    metresPerUnit,
    uncertaintyM: u,
    label: `no anchor yet · ${fmtCm(u)}`,
    detail: 'Nothing has been measured. Numbers are a guess until you anchor.',
  };
}

/* ---------- floor nudge ----------
 * A reconstruction's floor is only as good as its scale: a draft world anchored on an assumed
 * ceiling can land a few centimetres out, and furniture then floats or sinks. `Room.floorOffset`
 * is the correction, in metres, applied to the reconstruction (never to the metric frame): see
 * `splatTransform` in services/marble. Half a metre either way is plenty for that error. */

export const FLOOR_NUDGE_RANGE_M = 0.5;
export const FLOOR_NUDGE_STEP_M = 0.01;

/** Clamp a floor nudge to ±0.5 m and round it to the centimetre the UI shows. */
export function clampFloorOffset(metres: number): number {
  if (!Number.isFinite(metres)) return 0;
  const clamped = Math.max(-FLOOR_NUDGE_RANGE_M, Math.min(FLOOR_NUDGE_RANGE_M, metres));
  return Math.round(clamped / FLOOR_NUDGE_STEP_M) * FLOOR_NUDGE_STEP_M;
}

/** "+12 cm" / "0 cm": a signed nudge, in the unit the slider steps in. */
export function formatFloorOffset(metres: number): string {
  const cm = Math.round(clampFloorOffset(metres) * 100);
  return `${cm > 0 ? '+' : ''}${cm} cm`;
}

export function applyScale(raw: RawGeometry, metresPerUnit: number): RoomGeometry {
  const s = metresPerUnit;
  return {
    width: round(raw.width * s, 3),
    depth: round(raw.depth * s, 3),
    height: round(raw.height * s, 3),
    door: {
      wall: raw.door.wall,
      offset: round(raw.door.offset * s, 3),
      width: round(raw.door.width * s, 3),
      height: round(raw.door.height * s, 3),
    },
    windows: raw.windows.map((w) => ({
      wall: w.wall,
      offset: round(w.offset * s, 3),
      width: round(w.width * s, 3),
      height: round(w.height * s, 3),
      sill: round(w.sill * s, 3),
    })),
  };
}

/** Sanity checks on derived dimensions. A mis-tapped anchor makes every number wrong by the same factor. */
export function plausibility(g: RoomGeometry): PlausibilityWarning[] {
  const out: PlausibilityWarning[] = [];
  if (g.height < 2.2 || g.height > 3.4) {
    out.push({
      field: 'height',
      severity: g.height < 1.9 || g.height > 4.0 ? 'error' : 'warn',
      message: `Ceiling comes out at ${g.height.toFixed(2)} m. Most homes are 2.4 to 3.0 m. Check the anchor.`,
    });
  }
  if (g.width < 1.8 || g.width > 12) {
    out.push({ field: 'width', severity: 'warn', message: `Room width of ${g.width.toFixed(1)} m is unusual.` });
  }
  if (g.depth < 1.8 || g.depth > 12) {
    out.push({ field: 'depth', severity: 'warn', message: `Room depth of ${g.depth.toFixed(1)} m is unusual.` });
  }
  if (g.door.width < 0.6 || g.door.width > 1.2) {
    out.push({ field: 'door', severity: 'warn', message: `Door width of ${(g.door.width * 100).toFixed(0)} cm is unusual.` });
  }
  const a = g.width * g.depth;
  if (a > 80) {
    out.push({ field: 'area', severity: 'warn', message: `${a.toFixed(0)} m² is very large for one room.` });
  }
  return out;
}

export function formatMetres(m: number, dp = 2): string {
  return `${m.toFixed(dp)} m`;
}

export function formatCm(m: number): string {
  return `${Math.round(m * 100)} cm`;
}
