/**
 * Metric fusion — docs/ACCURACY.md section 2. One scale, its uncertainty, and what every source
 * had to say about it.
 *
 * A reconstruction has no size of its own: the collider measures a room in the provider's raw units
 * and something else has to say what a unit is worth in metres. Several things can, none of them
 * exactly, and they disagree — the plan is ±5 cm, a tapped door is ±4 cm on 2.03 m, an assumed
 * ceiling is ±12 cm, Marble's own `metric_scale_factor` is a provider estimate, a focal length is a
 * hint. This module takes every constraint that exists, weights each by its own uncertainty, and
 * returns the one scale that best explains all of them, the residual of each source against it, and
 * a confidence a room can print next to its numbers.
 *
 * Conventions:
 * - **Dependency-free, pure, deterministic.** No clock, no randomness, no I/O; the same constraints
 *   always give the same object, because a room's stated dimensions are hashed and shown.
 * - **Least squares in log space.** Every source constrains a *ratio* (metres per raw unit), and
 *   ratios are multiplicative: a 5 % error is the same size whether the room is big or small. So
 *   the fit averages `ln s` weighted by `1/σ²`, with σ the source's *relative* uncertainty, and the
 *   result is a proper weighted mean whose variance is `1/Σw`. Two sources that agree tighten the
 *   answer; one source returns itself, unchanged, with its own sigma.
 * - **Correlated constraints count once.** The plan's width and its depth are two numbers off *one
 *   drawing*, so their errors are the same error: a sheet printed at the wrong scale is wrong in
 *   both. Treating them as independent evidence would let one drawing tighten σ as if it were two
 *   measurements and corroborate itself. So constraints carry a {@link ConstraintGroup}, a group's
 *   weight is shared among its members, and corroboration counts groups (see `confidenceOf`).
 * - **A prior is not a measurement.** The standard 2.44 m ceiling and an EXIF field of view are
 *   things we supplied, not things this room told us. They still constrain the fit — a bad scale
 *   is worse than a loose one — but they do not corroborate anything, and when one disagrees the
 *   likely news is that the *assumption* is wrong, so it says so in those words and cannot take
 *   the confidence to zero on its own.
 * - **Disagreement is reported, never averaged away.** A source more than `FLAG_SIGMAS` σ from the
 *   fused answer gets a flag that names both numbers in metres ("plan says 3.75 m, model measures
 *   3.41 m"), because the usual cause is not a bad measurement but the wrong photo in the wrong
 *   room, and no amount of weighting fixes that. Where the sources scatter further than their own
 *   σ can explain, the reported σ is widened to match (the Birge ratio) rather than the fit
 *   claiming a precision its inputs do not support.
 * - **Nothing is invented.** A source that is absent contributes nothing; a source whose numbers
 *   are not finite and positive is skipped, not defaulted.
 *
 * The one import is a type, erased at build, so this module still adds nothing to either bundle.
 */
import type { ExtentMethod } from './collider.js';

/* ---------- what a source is ---------- */

/** Where a constraint on the scale came from. */
export type FusionSourceKind = 'plan-width' | 'plan-depth' | 'anchor' | 'ceiling' | 'marble' | 'exif';

/**
 * The independent thing a constraint's error comes from. Two constraints in the same group are two
 * readings of one artefact — the plan's width and depth are both the drawing — so they share one
 * error and must not be counted twice, either in the weighting or in the corroboration.
 */
export type ConstraintGroup = 'plan' | 'anchor' | 'ceiling' | 'marble' | 'exif';

/** What the quantity a residual compares is measured in. */
export type FusionUnit = 'm' | 'm/unit';

/** Plan dimensions are drawn, not taped: ±5 cm (docs/ACCURACY.md section 2). */
export const PLAN_SIGMA_M = 0.05;
/** A printed ceiling height, and one merely assumed (the standard 2.44 m). */
export const CEILING_PRINTED_SIGMA_M = 0.03;
export const CEILING_ASSUMED_SIGMA_M = 0.12;
/** Marble's own `metric_scale_factor`: the provider's estimate, good to a few per cent. */
export const MARBLE_SIGMA_REL = 0.05;
/** A field of view recovered from EXIF focal length and sensor size: a prior, not a measurement. */
export const EXIF_SIGMA_REL = 0.15;
/** The reference a door/outlet anchor is assumed to have measured, when it does not say. */
const ANCHOR_REFERENCE_M = 2.03;
/** Beyond this many sigmas, a source is not noise: it is a disagreement, and it is flagged. */
export const FLAG_SIGMAS = 2;
/** A relative sigma at or above this is no measurement at all: confidence 0. */
const CONFIDENCE_SIGMA_REL = 0.1;
/**
 * The most confidence an assumed prior can cost by disagreeing.
 *
 * A measurement 4σ out asks whether these numbers describe the same room, and takes the confidence
 * to zero. A *prior* 4σ out asks nothing of the kind: the standard ceiling is 2.44 m and this flat
 * has 3 m ceilings, which is news about the assumption, not about the reconstruction. It still
 * costs — the fit was pulled by a number that turned out to be wrong — but it cannot be the whole
 * verdict, so its agreement term is floored here.
 */
const ASSUMED_AGREEMENT_FLOOR = 0.6;

/** The room the collider measured, in the provider's raw units. */
export interface RawRoom {
  width: number;
  depth: number;
  height: number;
}

/** Everything that can say what a raw unit is worth. Every field is optional. */
export interface ScaleConstraints {
  raw: RawRoom;
  /** The plan's printed dimensions for this room, metres. */
  plan?: { width?: number; depth?: number; sigmaM?: number };
  /**
   * The room's scale anchor: metres per raw unit, with the ± the anchor itself states. The relative
   * uncertainty is `uncertaintyM / referenceMetres` — a ±4 cm door at 2.03 m is 2 %.
   */
  anchor?: { metresPerUnit: number; uncertaintyM?: number; referenceMetres?: number };
  /** The ceiling height, printed on the plan (±3 cm) or assumed (±12 cm). */
  ceiling?: { heightM: number; printed?: boolean; sigmaM?: number };
  /** Marble's `metric_scale_factor`, full tier only. */
  marble?: { metricScaleFactor: number; sigmaRel?: number };
  /**
   * A field-of-view prior from EXIF, already expressed as metres per raw unit.
   *
   * `group` is how the caller says what the prior was *closed on*. A field of view is scale-free —
   * doubling every distance in a room leaves every photograph of it unchanged — so a prior built
   * from one has to borrow a metric length from somewhere, and when that length is the same ceiling
   * height that feeds {@link ScaleConstraints.ceiling} the two constraints are one assumption
   * entered twice against two different raw quantities. Saying `group: 'ceiling'` puts them in one
   * group, which halves the weight each carries and stops the fit reporting a σ it has not earned.
   * Left out, the prior stands on its own ({@link ConstraintGroup} `'exif'`), which is right for a
   * prior closed on something the ceiling constraint does not already assert.
   */
  exif?: { metresPerUnit: number; sigmaRel?: number; group?: ConstraintGroup };
}

/** One source, against the fused answer. `expected` is what it said; `measured` is what the fit says. */
export interface FusionResidual {
  source: FusionSourceKind;
  /** A human label for the quantity, e.g. "plan width" or "assumed ceiling". */
  label: string;
  unit: FusionUnit;
  /** What this source asserts, in its own unit. */
  expected: number;
  /** The same quantity under the fused scale. */
  measured: number;
  /** `measured - expected`: positive means the model is bigger than the source says. */
  residual: number;
  /** The source's own 1σ, in its unit. */
  sigma: number;
  /** `|residual| / sigma`. Above {@link FLAG_SIGMAS} it is flagged. */
  sigmas: number;
  /** The scale this source alone would give. */
  scale: number;
  /**
   * True for a prior we supplied rather than something this room told us (the standard ceiling, an
   * EXIF field of view). Only set when true, so a measured source's JSON is unchanged.
   */
  assumed?: true;
}

export interface FusionResult {
  /** Metres per raw unit. */
  scale: number;
  /** 1σ on `scale`, in the same unit (metres per raw unit). */
  sigma: number;
  /** `sigma / scale`: the fractional uncertainty, which is what the fit actually estimates. */
  sigmaRel: number;
  /** 0..1. High needs a tight fit, more than one source, and no source in disagreement. */
  confidence: number;
  /**
   * How many independent things actually measured this room — correlated constraints counted once
   * (the plan is one, however many dimensions it printed) and priors not counted at all. This is
   * the number `confidence` corroborates against, and the one a reader needs to know whether
   * anything could have caught a systematically wrong source: at 1, nothing could.
   */
  independentSources: number;
  /** Every source that contributed, in a fixed order, with its residual against the fused scale. */
  residuals: FusionResidual[];
  /** One line per disagreement, naming both numbers. Empty when everything agrees. */
  flags: string[];
}

/* ---------- formatting (fixed, locale-independent) ---------- */

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const positive = (x: unknown): x is number => finite(x) && x > 0;

/** Round to `dp` decimals, normalising `-0`, so two equal fits print and hash identically. */
function round(x: number, dp: number): number {
  const s = 10 ** dp;
  const r = Math.round(x * s) / s;
  return r === 0 ? 0 : r;
}

/** "3.75 m" / "0.6869 m/unit": the residual's own unit, at a fixed precision. */
function quantity(value: number, unit: FusionUnit): string {
  return unit === 'm' ? `${value.toFixed(2)} m` : `${value.toFixed(4)} m/unit`;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/* ---------- the fit ---------- */

interface Constraint {
  source: FusionSourceKind;
  /** The independent artefact this constraint reads. Members of a group share one error. */
  group: ConstraintGroup;
  label: string;
  unit: FusionUnit;
  /** What the source asserts, in `unit`. */
  expected: number;
  /** 1σ on `expected`, in `unit`. */
  sigma: number;
  /** Raw units the assertion is about: the room dimension for a length, 1 for a scale. */
  rawUnits: number;
  /**
   * Present when this is a prior we supplied rather than a measurement of this room: what was
   * assumed, and what the seller can do about it. It is also what the flag says when a prior is
   * the thing that disagrees — blaming the reconstruction for our own default reads as a defect
   * in the model when the model is right.
   */
  assumption?: { thing: string; fix: string };
}

/**
 * Every constraint the inputs support, in a fixed order (plan width, plan depth, anchor, ceiling,
 * Marble, EXIF) so the residual list is stable. A constraint whose numbers are not finite and
 * positive is left out rather than repaired.
 */
function constraintsOf(c: ScaleConstraints): Constraint[] {
  const out: Constraint[] = [];
  const raw = c.raw;
  const planSigma = positive(c.plan?.sigmaM) ? (c.plan?.sigmaM as number) : PLAN_SIGMA_M;
  if (positive(c.plan?.width) && positive(raw?.width)) {
    out.push({ source: 'plan-width', group: 'plan', label: 'plan width', unit: 'm', expected: c.plan!.width as number, sigma: planSigma, rawUnits: raw.width });
  }
  if (positive(c.plan?.depth) && positive(raw?.depth)) {
    out.push({ source: 'plan-depth', group: 'plan', label: 'plan depth', unit: 'm', expected: c.plan!.depth as number, sigma: planSigma, rawUnits: raw.depth });
  }
  if (positive(c.anchor?.metresPerUnit)) {
    const a = c.anchor as NonNullable<ScaleConstraints['anchor']>;
    const reference = positive(a.referenceMetres) ? a.referenceMetres : ANCHOR_REFERENCE_M;
    // The anchor's ± is stated on its reference length, and a ratio inherits the relative error.
    const sigmaRel = positive(a.uncertaintyM) ? (a.uncertaintyM as number) / reference : 0.02;
    out.push({ source: 'anchor', group: 'anchor', label: 'anchor', unit: 'm/unit', expected: a.metresPerUnit, sigma: a.metresPerUnit * sigmaRel, rawUnits: 1 });
  }
  if (positive(c.ceiling?.heightM) && positive(raw?.height)) {
    const ceiling = c.ceiling as NonNullable<ScaleConstraints['ceiling']>;
    const sigma = positive(ceiling.sigmaM) ? (ceiling.sigmaM as number) : ceiling.printed ? CEILING_PRINTED_SIGMA_M : CEILING_ASSUMED_SIGMA_M;
    out.push({
      source: 'ceiling',
      group: 'ceiling',
      label: ceiling.printed ? 'printed ceiling' : 'assumed ceiling',
      unit: 'm',
      expected: ceiling.heightM,
      sigma,
      rawUnits: raw.height,
      ...(ceiling.printed ? {} : { assumption: { thing: 'a standard ceiling', fix: 'Type the room’s real ceiling height and the room re-measures.' } }),
    });
  }
  if (positive(c.marble?.metricScaleFactor)) {
    const m = c.marble as NonNullable<ScaleConstraints['marble']>;
    const sigmaRel = positive(m.sigmaRel) ? (m.sigmaRel as number) : MARBLE_SIGMA_REL;
    out.push({ source: 'marble', group: 'marble', label: 'Marble metric scale', unit: 'm/unit', expected: m.metricScaleFactor, sigma: m.metricScaleFactor * sigmaRel, rawUnits: 1 });
  }
  if (positive(c.exif?.metresPerUnit)) {
    const e = c.exif as NonNullable<ScaleConstraints['exif']>;
    const sigmaRel = positive(e.sigmaRel) ? (e.sigmaRel as number) : EXIF_SIGMA_REL;
    out.push({
      source: 'exif',
      // The caller's own reading of what the prior borrowed its metre from; see `ScaleConstraints.exif`.
      group: e.group ?? 'exif',
      label: 'EXIF field of view',
      unit: 'm/unit',
      expected: e.metresPerUnit,
      sigma: e.metresPerUnit * sigmaRel,
      rawUnits: 1,
      assumption: { thing: 'a field of view from the photo’s EXIF', fix: 'Tap a door or a wall to measure the room instead.' },
    });
  }
  return out;
}

/**
 * The scale, from every constraint at once.
 *
 * Weighted least squares on `ln s`: each constraint says the room's raw extent `r` is really
 * `e ± σ` metres, i.e. `s_i = e / r` with relative uncertainty `σ / e`; the fit is
 * `ln ŝ = Σ (ln s_i / σ_i²) / Σ (1 / σ_i²)` and `σ(ln ŝ) = 1 / √Σ (1 / σ_i²)`. Log space is what
 * makes a metres-per-unit constraint (the anchor, Marble) and a length constraint (the plan, the
 * ceiling) the same kind of statement, and what keeps the answer independent of which dimension a
 * plan happened to print.
 *
 * With no usable constraint at all the scale is 1 with confidence 0 and a flag saying so — a room
 * with no anchor is unmeasured, and saying "1 raw unit is 1 metre" out loud is better than
 * pretending some default was a measurement.
 */
export function fuseScale(constraints: ScaleConstraints): FusionResult {
  const list = constraintsOf(constraints);
  if (!list.length) {
    return { scale: 1, sigma: 0, sigmaRel: 0, confidence: 0, independentSources: 0, residuals: [], flags: ['No metric source: the room has no scale, so every dimension is in raw units.'] };
  }

  // One drawing that printed two dimensions is one source of error, not two: the members of a group
  // divide a single unit of weight between them, so the plan can no longer corroborate itself into
  // a σ it has not earned. Counting alone is enough — the members are near-identical statements
  // about the same ratio, so how the unit is split barely moves the fit.
  const members = new Map<ConstraintGroup, number>();
  for (const c of list) members.set(c.group, (members.get(c.group) ?? 0) + 1);

  let sumWeight = 0;
  let sumWeightedLog = 0;
  const scales: number[] = [];
  const weights: number[] = [];
  for (const c of list) {
    const scale = c.expected / c.rawUnits;
    const sigmaRel = c.sigma / c.expected;
    const weight = 1 / (sigmaRel * sigmaRel) / (members.get(c.group) ?? 1);
    scales.push(scale);
    weights.push(weight);
    sumWeight += weight;
    sumWeightedLog += weight * Math.log(scale);
  }
  const logScale = sumWeightedLog / sumWeight;
  const scale = Math.exp(logScale);

  /* The Birge ratio. `1/√Σw` is what the σ would be if every source were as good as it claims; the
     weighted scatter of the sources says whether they are. Where they scatter further than that
     (χ² per degree of freedom above 1), the σ is widened to match, because a fit whose inputs
     contradict each other is not precise, whatever its inputs said about themselves. Below 1 it is
     left alone: sources that happen to agree closely are luck, not extra precision. */
  let chi2 = 0;
  for (let i = 0; i < list.length; i++) {
    const d = Math.log(scales[i]) - logScale;
    chi2 += weights[i] * d * d;
  }
  const dof = members.size - 1;
  const birge = dof > 0 && chi2 > dof ? Math.sqrt(chi2 / dof) : 1;
  const sigmaRel = birge / Math.sqrt(sumWeight);

  const residuals: FusionResidual[] = [];
  const flags: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const measured = c.rawUnits * scale;
    const residual = measured - c.expected;
    const sigmas = c.sigma > 0 ? Math.abs(residual) / c.sigma : 0;
    residuals.push({
      source: c.source,
      label: c.label,
      unit: c.unit,
      expected: round(c.expected, 4),
      measured: round(measured, 4),
      residual: round(residual, 4),
      sigma: round(c.sigma, 4),
      sigmas: round(sigmas, 2),
      scale: round(scales[i], 6),
      ...(c.assumption ? { assumed: true as const } : {}),
    });
    if (sigmas > FLAG_SIGMAS) {
      flags.push(
        c.assumption
          ? `We assumed ${c.assumption.thing} of ${quantity(c.expected, c.unit)}; the model measures ${quantity(measured, c.unit)} (${sigmas.toFixed(1)}σ). ${c.assumption.fix}`
          : `${c.label} says ${quantity(c.expected, c.unit)}, model measures ${quantity(measured, c.unit)} (${sigmas.toFixed(1)}σ).`,
      );
    }
  }

  // Priors do not corroborate: they are ours, not the room's.
  const measuredGroups = new Set<ConstraintGroup>();
  for (const c of list) if (!c.assumption) measuredGroups.add(c.group);

  return {
    scale: round(scale, 6),
    sigma: round(scale * sigmaRel, 6),
    sigmaRel: round(sigmaRel, 6),
    confidence: confidenceOf(sigmaRel, residuals, measuredGroups.size),
    independentSources: measuredGroups.size,
    residuals,
    flags,
  };
}

/**
 * How much to trust the fused scale, 0..1 — three independent things, multiplied:
 *
 * - **precision**: 1 at σ = 0, 0 at {@link CONFIDENCE_SIGMA_REL} (10 %, which is a guess).
 * - **corroboration**: counted over *independent* sources, not residuals. One source cannot be
 *   checked against anything, so it is capped below a second and a third that agree — and a plan
 *   that printed both a width and a depth is still one source, because a sheet drawn at the wrong
 *   scale is wrong in both. A fit held up by priors alone is capped lower still.
 * - **agreement**: a source at 2σ costs nothing (that is the flag threshold, not a failure); one at
 *   4σ takes the confidence to zero on its own, because at that point the question is not how
 *   precise the fit is but whether these numbers describe the same room. A prior that disagrees is
 *   floored at {@link ASSUMED_AGREEMENT_FLOOR}: it is our assumption that is wrong, not the room.
 */
function confidenceOf(sigmaRel: number, residuals: FusionResidual[], independentSources: number): number {
  const precision = clamp01(1 - sigmaRel / CONFIDENCE_SIGMA_REL);
  const corroboration = independentSources >= 3 ? 1 : independentSources === 2 ? 0.95 : independentSources === 1 ? 0.85 : 0.7;
  let agreement = 1;
  for (const r of residuals) {
    const term = clamp01(1 - Math.max(0, r.sigmas - FLAG_SIGMAS) / FLAG_SIGMAS);
    agreement *= r.assumed ? Math.max(ASSUMED_AGREEMENT_FLOOR, term) : term;
  }
  return round(clamp01(precision * corroboration * agreement), 3);
}

/* ---------- what the room reports ---------- */

/** A dimension the room shows, with what the plan said about it. */
export interface RoomDimensionLine {
  dimension: 'width' | 'depth' | 'height';
  /** Metres, from the fused scale. */
  measured: number;
  /** Metres, from the source that constrains this dimension, when there is one. */
  expected?: number;
  /** `measured - expected`, metres. */
  delta?: number;
  /** "Plan says 3.75 m · model measures 3.41 m (−0.34 m)" — the line docs/ACCURACY.md asks for. */
  text: string;
}

export interface FusedRoom {
  /** Metres. */
  width: number;
  depth: number;
  height: number;
  lines: RoomDimensionLine[];
}

/** Which constraint speaks for each dimension, and what to call it in the line. */
const LINE_SOURCE: Record<RoomDimensionLine['dimension'], { source: FusionSourceKind; says: string }> = {
  width: { source: 'plan-width', says: 'Plan says' },
  depth: { source: 'plan-depth', says: 'Plan says' },
  height: { source: 'ceiling', says: 'Ceiling stated' },
};

/** A plan's two printed dimensions, oriented onto the fitted rectangle's axes. */
export interface OrientedPlan {
  width: number;
  depth: number;
  /** True when the plan's width describes the collider's depth, and the two were exchanged. */
  swapped: boolean;
}

/**
 * Which of the plan's two printed dimensions belongs to the fitted rectangle's x axis.
 *
 * {@link fuseScale} pairs `plan.width` with `raw.width` exactly as it is handed them, and that is
 * deliberate — a plan that disagrees with the model is a real "is this the right room" signal and
 * must not be silently reordered away. But a collider cannot state which way round it is: the wall
 * fit's rotation is only defined modulo 90°, so past 45° the fitted rectangle names the room's
 * depth "width" (`toRawBox` in shared/collider.ts). Pairing on *that* is not a disagreement about
 * the room, it is a disagreement about labels, and it makes both dimensions flag against a
 * perfectly good room.
 *
 * So the caller orients first, on the one thing a rectangle does state unambiguously: its aspect
 * ratio, compared in log space so the two orderings are judged symmetrically. A room close to
 * square can still be matched the wrong way round — but on a square room it barely matters, because
 * the two orderings then give almost the same scale. Where the plan's north arrow and the room
 * graph are known they settle it properly; this is the fallback that needs neither.
 */
export function orientPlan(raw: Pick<RawRoom, 'width' | 'depth'>, plan: { width: number; depth: number }): OrientedPlan {
  if (!(raw.width > 0) || !(raw.depth > 0) || !(plan.width > 0) || !(plan.depth > 0)) {
    return { width: plan.width, depth: plan.depth, swapped: false };
  }
  const aspect = Math.log(raw.width / raw.depth);
  const asDrawn = Math.abs(aspect - Math.log(plan.width / plan.depth));
  const exchanged = Math.abs(aspect - Math.log(plan.depth / plan.width));
  return exchanged < asDrawn
    ? { width: plan.depth, depth: plan.width, swapped: true }
    : { width: plan.width, depth: plan.depth, swapped: false };
}

/**
 * The room in metres, plus the "plan says / model measures" line per dimension.
 *
 * The scale is uniform, so this is one multiplication — the point of the function is the lines: a
 * published room states what the drawing said, what the reconstruction measures, and the gap,
 * rather than quietly showing whichever of the two is prettier.
 */
export function roomFromFusion(raw: RawRoom, fusion: Pick<FusionResult, 'scale' | 'residuals'>): FusedRoom {
  const s = fusion.scale;
  const dims = { width: round(raw.width * s, 3), depth: round(raw.depth * s, 3), height: round(raw.height * s, 3) };
  const lines: RoomDimensionLine[] = (['width', 'depth', 'height'] as const).map((dimension) => {
    const measured = dims[dimension];
    const { source, says } = LINE_SOURCE[dimension];
    const row = fusion.residuals.find((r) => r.source === source && r.unit === 'm');
    if (!row) return { dimension, measured, text: `Model measures ${measured.toFixed(2)} m` };
    const delta = round(measured - row.expected, 3);
    /* The line is printed in centimetres, so it takes its sign from the centimetres it prints. A
       residual under half a centimetre reads "±0.00 m" — agreement to the precision shown — rather
       than the "−0.00 m" a signed millimetre puts on a room whose model matches the drawing. `delta`
       itself keeps the millimetre, because a caller grading the line is not reading the sign. */
    const shown = Math.abs(round(delta, 2));
    const sign = shown === 0 ? '±' : delta > 0 ? '+' : '−';
    return {
      dimension,
      measured,
      expected: row.expected,
      delta,
      text: `${says} ${row.expected.toFixed(2)} m · model measures ${measured.toFixed(2)} m (${sign}${shown.toFixed(2)} m)`,
    };
  });
  return { ...dims, lines };
}

/* ---------- the record a measured room stores ---------- */

/**
 * How a published room's numbers were arrived at — `rooms.measurement` on the server, and
 * `Room.measurement` in the browser store. **One shape, defined once here**, so what the worker
 * writes after `copy_assets`, what the public tour serves and what the hub's AccuracyCard reads can
 * never drift apart.
 *
 * It is a {@link FusionResult} plus the provenance a reader needs and cannot recompute: the lines
 * already rendered, which rectangle of the collider the room came from, whether the mesh was one
 * room at all, and which world was measured. Stored rather than derived because docs/ACCURACY.md §1
 * says every published room shows its own numbers, and a buyer's browser has neither the collider
 * to re-measure nor the plan to compare against.
 *
 * It is a *report*, never an input: a room's `geometry` stays the room's own numbers.
 */
export interface RoomMeasurement {
  /** Metres per raw unit, and its 1σ in the same unit. */
  scale: number;
  sigma: number;
  sigmaRel: number;
  /** 0..1: tight fit, more than one source, and no source in disagreement. */
  confidence: number;
  /**
   * How many independent things measured this room ({@link FusionResult.independentSources}).
   * Optional because a measurement stored before this field existed does not carry it.
   */
  independentSources?: number;
  /**
   * Every source, against the fit. These are always the *wall* measurement — the room the sources
   * describe — even in the `aabb` case below, where `lines` state the bounding box the capture is
   * placed from instead. Residuals are about the scale; the lines are about the room.
   */
  residuals: FusionResidual[];
  /** One line per disagreement past 2σ, naming both numbers. Empty when every source agrees. */
  flags: string[];
  /** "Plan says 3.75 m · model measures 3.41 m (−0.34 m)", per dimension. */
  lines: RoomDimensionLine[];
  /** Which rectangle of the collider the room was measured from (`shared/collider.ts`). */
  method: ExtentMethod;
  /** False when the measured room is too big, too small or too tall to be one room. */
  oneRoom: boolean;
  /**
   * True when the plan's printed width describes the collider's depth and the two were exchanged
   * before fusing ({@link orientPlan}). Not an error — the wall fit's rotation is only defined
   * modulo 90° — but worth showing beside a room whose plan and model look transposed.
   */
  planSwapped?: boolean;
  /** The world that was measured. */
  worldId?: string;
  /** Mirrors `rooms.measured_at`, so the JSON is self-contained. ISO 8601. */
  measuredAt: string;
  /** The recipe hash of the measured world, and whether the room's inputs still produce it. */
  recipeHash?: string;
  stale?: boolean;
}
