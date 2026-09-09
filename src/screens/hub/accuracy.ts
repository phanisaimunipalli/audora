/**
 * What the model measured, against what the plan said — docs/ACCURACY.md sections 1 and 3.2, as
 * pure functions. `AccuracyCard.tsx` draws exactly this and computes nothing of its own.
 *
 * The numbers come from `Room.measurement`, the `RoomMeasurement` the worker writes after it has
 * measured the collider (`shared/fusion.ts`): one scale in metres per raw unit, its 1σ, a 0..1
 * confidence, one residual per source, a flag wherever a source disagrees by more than 2σ, and the
 * line a leasing team reads per dimension — "Plan says 3.75 m · model measures 3.41 m (−0.34 m)". This
 * module **grades** those lines against the targets in section 1; it recomputes them only for a
 * measurement that predates them, so the card shows the numbers the worker actually stored:
 *
 *   width / depth  median under 5 %, every room under 10 %
 *   ceiling        under 10 cm
 *
 * Nothing here invents a number. A room with no `measurement` reports `measured: false` and says so;
 * it never falls back to the anchored geometry and calls it a measurement.
 */
import type { FusionResidual, FusionResult, RoomDimensionLine, RoomMeasurement } from '@shared/fusion';
import { roomFromFusion } from '@shared/fusion';
import { pickWorld } from '@/state/publish';
import type { PlanDimensions, Provider, Room, RoomWorld, Tier } from '@/state/types';
import { printedDimensions } from '@/services/floorplan';

/* ---------- grading one dimension ---------- */

export type ToleranceLevel = 'ok' | 'warn' | 'bad' | 'unknown';

/** docs/ACCURACY.md section 1: median under 5 %, every room under 10 %. */
export const DIMENSION_OK_PCT = 5;
export const DIMENSION_WARN_PCT = 10;
/** Ceiling error is stated in centimetres, not per cent: under 10 cm. */
export const CEILING_OK_M = 0.1;
export const CEILING_WARN_M = 0.2;

export interface AccuracyLine extends RoomDimensionLine {
  /** How this dimension scores against the target. `unknown` when no source stated it. */
  level: ToleranceLevel;
  /** `|delta| / expected` as a percentage, when a source stated the dimension. */
  errorPct?: number;
  /**
   * The error in the unit this line is *graded* in — per cent for width and depth, centimetres for
   * the ceiling. A reader compares the badge against the target beside it, so a ceiling 11 cm out
   * must not print "4.6 %" next to a 5 % dimension target and read as comfortably inside it.
   */
  errorText?: string;
}

/** Grade one fused dimension line. Height is graded in metres, width and depth in per cent. */
export function gradeLine(line: RoomDimensionLine): AccuracyLine {
  if (line.expected == null || line.delta == null || !(line.expected > 0)) return { ...line, level: 'unknown' };
  const abs = Math.abs(line.delta);
  const errorPct = (abs / line.expected) * 100;
  if (line.dimension === 'height') {
    const errorText = `${Math.round(abs * 100)} cm`;
    return { ...line, errorPct, errorText, level: abs <= CEILING_OK_M ? 'ok' : abs <= CEILING_WARN_M ? 'warn' : 'bad' };
  }
  return { ...line, errorPct, errorText: `${errorPct.toFixed(1)}%`, level: errorPct <= DIMENSION_OK_PCT ? 'ok' : errorPct <= DIMENSION_WARN_PCT ? 'warn' : 'bad' };
}

/* ---------- confidence ---------- */

/**
 * `none` and `unmeasured` are different facts and must not share a word. *Unmeasured* means the
 * worker never measured this room — there are no dimensions, no residuals, nothing. *None* means it
 * was measured, in full, and the result cannot be trusted: the mesh was not one room, or a source
 * is 4σ out. Printing "unmeasured confidence" over three dimension lines, a σ and a flag says the
 * opposite of what the card is showing.
 */
export type ConfidenceLabel = 'high' | 'good' | 'low' | 'none' | 'unmeasured';

/** Where a `FusionResult.confidence` (0..1) sits. Thresholds are the ones the card prints beside. */
export function confidenceLabel(confidence: number | undefined): ConfidenceLabel {
  if (confidence == null) return 'unmeasured';
  if (!(confidence > 0)) return 'none';
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'good';
  return 'low';
}

export const CONFIDENCE_COPY: Record<ConfidenceLabel, string> = {
  high: 'Several sources agree on this room’s scale.',
  good: 'The scale is constrained, but by fewer sources than we would like.',
  low: 'One weak source is holding this room’s scale. Type a wall length or add the plan’s dimensions.',
  none: 'This room was measured, but its sources contradict each other — read the numbers below as a question, not an answer.',
  unmeasured: 'This room has not been measured. Its numbers come from its anchor, not from the model.',
};

/** The phrase the chip prints. "none confidence" is not English; the label alone cannot be shown. */
export const CONFIDENCE_CHIP: Record<ConfidenceLabel, string> = {
  high: 'high confidence',
  good: 'good confidence',
  low: 'low confidence',
  none: 'no confidence',
  unmeasured: 'not measured',
};

/**
 * What to say when one thing is holding the room's scale up on its own — naming it, because there
 * is nothing to check it against and the fix differs by source.
 *
 * This is the case `shared/fusion.ts` cannot flag: a plan drawn 6 % small agrees with itself in
 * both dimensions and no residual exceeds 2σ, so the fit is precise, quiet and wrong. Saying which
 * single source it rests on is the honest form of that.
 */
function soleSourceText(sources: FusionResidual[]): string | undefined {
  const kinds = new Set(sources.filter((s) => !s.assumed).map((s) => s.source));
  if (kinds.has('plan-width') || kinds.has('plan-depth')) {
    return 'The plan is the only measurement of this room’s scale, so a drawing printed at the wrong scale would agree with itself and nothing would catch it. Tap a door or type a wall length to check it.';
  }
  if (kinds.has('anchor')) return 'One tapped anchor is the only measurement of this room’s scale. Add the plan’s printed dimensions to check it.';
  if (kinds.has('marble')) return 'Only the model’s own metric scale constrains this room. Add the plan’s dimensions or tap a door to check it.';
  return undefined;
}

/* ---------- one room ---------- */

export interface RoomAccuracy {
  roomId: string;
  name: string;
  /** True only when the worker has written a `measurement` onto the room. */
  measured: boolean;
  /** Metres per raw unit, and its fractional 1σ. */
  scale?: number;
  sigmaRel?: number;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  /** "high confidence" / "no confidence" / "not measured" — the phrase a chip prints. */
  confidenceChip: string;
  confidenceText: string;
  /** How many independent things measured the room. Absent on a measurement stored before it. */
  independentSources?: number;
  /** One line per dimension, graded. Empty when the room is unmeasured. */
  lines: AccuracyLine[];
  /**
   * The worst-scoring **width or depth** line that had a source to compare against — the measure
   * docs/ACCURACY.md §1 writes its 5 % / 10 % target against. The ceiling is graded in centimetres
   * and has its own target, so it has its own field below; folding it in here made a room that is
   * 0.4 % on both dimensions count as "over 10 %" on the strength of an assumed ceiling height.
   */
  worst?: AccuracyLine;
  /** The ceiling line, when a source stated a height. Graded in centimetres, never in per cent. */
  worstCeiling?: AccuracyLine;
  /** Disagreements past 2σ, each naming both numbers. */
  flags: string[];
  /** Every source that contributed, in fusion's own fixed order. */
  sources: FusionResidual[];
  /**
   * Which rectangle of the collider the room was measured from. `aabb` means the wall fit was set
   * aside because what it found was not one room, so these dimensions are of everything the model
   * built — the flags say so in words.
   */
  method?: 'walls' | 'aabb';
  /** False when the measured mesh was not one room. */
  oneRoom?: boolean;
  /** True when the plan's width and depth had to be exchanged to match the model's rectangle. */
  planSwapped?: boolean;
  /** ISO 8601, when the measurement was taken. */
  measuredAt?: string;
  /** Exactly what the plan printed for this room, when it printed anything. */
  planText?: string;
  /** The reconstruction the numbers belong to: what a room leads with once staging is off. */
  model?: string;
  tier?: Tier;
  provider?: Provider;
  /** Epoch ms the world was reconstructed — "the model date". */
  modelDate?: number;
}

/** The world the renter is being shown, which is the one the measurement describes. */
export function shownWorld(room: Pick<Room, 'draft' | 'full'>): RoomWorld | undefined {
  return pickWorld(room.draft, room.full);
}

/** The raw room the fused scale multiplies: the collider's own proportions when there is a world. */
function rawOf(room: Pick<Room, 'draft' | 'full' | 'raw'>) {
  const world = shownWorld(room);
  const raw = world?.raw ?? room.raw;
  return { width: raw.width, depth: raw.depth, height: raw.height };
}

/**
 * What this module needs off a room.
 *
 * `measurement` is widened to a bare {@link FusionResult} as well as the stored
 * {@link RoomMeasurement}, because the two callers differ: the hub reads what the worker stored
 * (lines, method, provenance and all), while a browser that has just fused a room itself has only
 * the fit. Both are gradeable; the difference is whether the lines are read or re-derived.
 */
export type MeasurableRoom = Pick<Room, 'id' | 'name' | 'draft' | 'full' | 'raw' | 'planDims'> & {
  measurement?: RoomMeasurement | FusionResult;
};

/** The provenance a stored measurement carries and a bare fit does not. */
function storedOnly(m: RoomMeasurement | FusionResult): Partial<RoomMeasurement> {
  return 'method' in m ? m : {};
}

/**
 * The accuracy report for one room. Everything the card shows, and nothing it has to work out.
 *
 * An unmeasured room is not an error and is not blank: it reports `measured: false`, keeps the
 * world's model and date (which are still facts) and says why there are no residuals.
 */
export function roomAccuracy(room: MeasurableRoom): RoomAccuracy {
  const world = shownWorld(room);
  const base = {
    roomId: room.id,
    name: room.name,
    planText: room.planDims?.text,
    model: world?.model,
    tier: world?.tier,
    provider: world?.provider,
    modelDate: world?.createdAt,
  };
  const m = room.measurement;
  if (!m) {
    return {
      ...base,
      measured: false,
      confidence: 0,
      confidenceLabel: 'unmeasured',
      confidenceChip: CONFIDENCE_CHIP.unmeasured,
      confidenceText: CONFIDENCE_COPY.unmeasured,
      lines: [],
      flags: [],
      sources: [],
    };
  }
  // The worker already rendered these against the raw room it measured; recomputing them here from
  // whatever raw the browser happens to hold would quietly restate a different room's numbers. Only
  // a measurement stored without lines is re-derived.
  const stored = storedOnly(m);
  const lines = (stored.lines?.length ? stored.lines : roomFromFusion(rawOf(room), m).lines).map(gradeLine);
  // The 5 % / 10 % target is written against width and depth; the ceiling is centimetres and has
  // its own row. Grading them on one scale is comparing a per cent with a length.
  const compared = lines.filter((l) => l.level !== 'unknown' && l.dimension !== 'height');
  const worst = compared.length ? compared.reduce((a, b) => ((b.errorPct ?? 0) > (a.errorPct ?? 0) ? b : a)) : undefined;
  const label = confidenceLabel(m.confidence);
  const sole = m.independentSources != null && m.independentSources <= 1 ? soleSourceText(m.residuals) : undefined;
  return {
    ...base,
    measured: true,
    scale: m.scale,
    sigmaRel: m.sigmaRel,
    confidence: m.confidence,
    confidenceLabel: label,
    confidenceChip: CONFIDENCE_CHIP[label],
    confidenceText: sole ?? CONFIDENCE_COPY[label],
    independentSources: m.independentSources,
    lines,
    worst,
    worstCeiling: lines.find((l) => l.dimension === 'height' && l.level !== 'unknown'),
    flags: m.flags,
    sources: m.residuals,
    method: stored.method,
    oneRoom: stored.oneRoom,
    planSwapped: stored.planSwapped,
    measuredAt: stored.measuredAt,
  };
}

/* ---------- the unit ---------- */

export interface TourAccuracy {
  rooms: number;
  measured: number;
  /** Rooms whose worst width or depth is inside 5 %, inside 10 %, and beyond it. */
  withinTarget: number;
  withinLimit: number;
  overLimit: number;
  /**
   * Rooms whose ceiling is further than {@link CEILING_OK_M} from what was stated. Counted on its
   * own, in its own unit, rather than being folded into `overLimit` — where it used to convert a
   * 55 cm ceiling gap into a fake "22 % dimension error" against a room measured to 0.4 %.
   */
  ceilingOff: number;
  /** Median of every graded width/depth error in the unit, per cent. Undefined with nothing to compare. */
  medianErrorPct?: number;
  worstErrorPct?: number;
  /** Rooms carrying at least one 2σ disagreement. */
  flagged: number;
  /** The one line the hub header shows. */
  text: string;
}

/** Median of a numeric list, the even case averaging the middle pair. Pure, and stable in its input. */
export function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The unit's own row of the table in docs/ACCURACY.md section 1. Only width and depth feed the
 * median, because that is the measure the target is written against; the ceiling has its own.
 */
export function tourAccuracy(rooms: MeasurableRoom[]): TourAccuracy {
  const reports = rooms.map(roomAccuracy);
  const measured = reports.filter((r) => r.measured);
  const errors = measured.flatMap((r) => r.lines.filter((l) => l.dimension !== 'height' && l.errorPct != null).map((l) => l.errorPct as number));
  const worsts = measured.map((r) => r.worst?.errorPct).filter((x): x is number => x != null);
  const withinTarget = worsts.filter((e) => e <= DIMENSION_OK_PCT).length;
  const withinLimit = worsts.filter((e) => e > DIMENSION_OK_PCT && e <= DIMENSION_WARN_PCT).length;
  const overLimit = worsts.filter((e) => e > DIMENSION_WARN_PCT).length;
  const med = median(errors);
  const ceilingOff = measured.filter((r) => (r.worstCeiling?.delta != null ? Math.abs(r.worstCeiling.delta) > CEILING_OK_M : false)).length;
  const flagged = measured.filter((r) => r.flags.length).length;
  const text = !rooms.length
    ? 'No rooms yet.'
    : !measured.length
      ? `${rooms.length} room${rooms.length === 1 ? '' : 's'} · not measured yet`
      : `${measured.length} of ${rooms.length} room${rooms.length === 1 ? '' : 's'} measured` +
        (med != null ? ` · median ${med.toFixed(1)}% against the plan` : '') +
        (overLimit ? ` · ${overLimit} over ${DIMENSION_WARN_PCT}%` : '') +
        (ceilingOff ? ` · ${ceilingOff} ceiling${ceilingOff === 1 ? '' : 's'} over ${CEILING_OK_M * 100} cm` : '');
  return {
    rooms: rooms.length,
    measured: measured.length,
    withinTarget,
    withinLimit,
    overLimit,
    ceilingOff,
    medianErrorPct: med,
    worstErrorPct: worsts.length ? Math.max(...worsts) : undefined,
    flagged,
    text,
  };
}

/* ---------- what a room leads with when staging is off ---------- */

export interface RoomLead {
  /** "3.41 × 4.08 × 2.44 m". */
  dimensions: string;
  /** "13.9 m²". */
  area: string;
  /** What the plan printed, when it printed anything. */
  plan?: string;
  /** "marble-1.1 · full", or "simulated draft". */
  model?: string;
  /** Epoch ms; the caller formats it (`timeAgo` / a date), because time is an input. */
  modelDate?: number;
  /** "measured · high confidence" / "not measured". */
  measurement: string;
}

/**
 * "5.30 × 5.78 m (17'-5\" × 19'-0\")" — the stored metres, and the printed string only where it
 * still says something. A listing sheet that prints feet with the draughtsman's own metric
 * restatement in brackets is exactly where `metresFromDimensions` took those metres from, so
 * appending the whole string verbatim would print the same pair twice; `printedDimensions` is the
 * one rule that trims the echo and keeps the feet.
 */
export function planLine(dims: PlanDimensions): string {
  const printed = printedDimensions(dims.text, dims.width, dims.depth);
  return `${dims.width.toFixed(2)} × ${dims.depth.toFixed(2)} m${printed ? ` (${printed})` : ''}`;
}

/**
 * The three facts a room leads with once staging is deferred: what it measures, what the plan said,
 * and which model measured it and when (docs/ACCURACY.md section 3.7).
 */
export function roomLead(room: MeasurableRoom & Pick<Room, 'geometry'>): RoomLead {
  const g = room.geometry;
  const a = roomAccuracy(room);
  const world = shownWorld(room);
  return {
    dimensions: `${g.width.toFixed(2)} × ${g.depth.toFixed(2)} × ${g.height.toFixed(2)} m`,
    area: `${(g.width * g.depth).toFixed(1)} m²`,
    plan: room.planDims ? planLine(room.planDims) : undefined,
    model: world ? (world.provider === 'mock' ? `simulated ${world.tier}` : `${world.model} · ${world.tier}`) : undefined,
    modelDate: world?.createdAt,
    measurement: a.measured ? `measured · ${a.confidenceChip}` : 'not measured',
  };
}
