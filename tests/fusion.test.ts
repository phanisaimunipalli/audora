/**
 * Metric fusion (`shared/fusion.ts`) — docs/ACCURACY.md section 2.
 *
 * The scale is the one number every dimension in the product is multiplied by, so this is a
 * contract test more than a behaviour test: one source must come back unchanged, agreeing sources
 * must tighten the answer, a disagreeing plan must say so in words that name both numbers, and the
 * same inputs must always give the same object — the room's dimensions are shown and hashed.
 */
import { describe, expect, it } from 'vitest';
import {
  CEILING_ASSUMED_SIGMA_M,
  CEILING_PRINTED_SIGMA_M,
  fuseScale,
  MARBLE_SIGMA_REL,
  PLAN_SIGMA_M,
  roomFromFusion,
  type ScaleConstraints,
} from '../shared/fusion';

/** A room the collider measured: 5.46 × 6.69 × 3.64 raw units, which at 0.6869 m/unit is 3.75 × 4.60 × 2.50. */
const RAW = { width: 5.4593, depth: 6.6968, height: 3.6396 };
/** The scale those raw units were built from. */
const TRUE_SCALE = 0.6869;

const nearly = (value: number, expected: number, tolerance = 1e-6) => expect(Math.abs(value - expected)).toBeLessThan(tolerance);

describe('fuseScale with one source', () => {
  it('returns that source, and its own uncertainty', () => {
    const plan: ScaleConstraints = { raw: RAW, plan: { width: 3.75 } };
    const f = fuseScale(plan);
    nearly(f.scale, 3.75 / RAW.width, 1e-5);
    // A ±5 cm plan on a 3.75 m wall is 1.33 %, and that is the whole uncertainty of the fit.
    nearly(f.sigmaRel, PLAN_SIGMA_M / 3.75, 1e-5);
    nearly(f.sigma, f.scale * f.sigmaRel, 1e-5);
    expect(f.flags).toEqual([]);
    expect(f.residuals).toHaveLength(1);
    // The model measures exactly what the only source said: there is nothing to disagree with.
    expect(f.residuals[0]).toMatchObject({ source: 'plan-width', unit: 'm', expected: 3.75, measured: 3.75, residual: 0, sigmas: 0 });
  });

  it("takes the anchor at its word, with the anchor's own ±", () => {
    const f = fuseScale({ raw: RAW, anchor: { metresPerUnit: TRUE_SCALE, uncertaintyM: 0.04, referenceMetres: 2.03 } });
    nearly(f.scale, TRUE_SCALE, 1e-6);
    nearly(f.sigmaRel, 0.04 / 2.03, 1e-5);
    expect(f.residuals[0]).toMatchObject({ source: 'anchor', unit: 'm/unit', expected: TRUE_SCALE, measured: TRUE_SCALE });
  });

  it('trusts a printed ceiling four times as far as an assumed one', () => {
    const printed = fuseScale({ raw: RAW, ceiling: { heightM: 2.5, printed: true } });
    const assumed = fuseScale({ raw: RAW, ceiling: { heightM: 2.5 } });
    nearly(printed.scale, assumed.scale, 1e-9); // same answer…
    nearly(printed.sigmaRel, CEILING_PRINTED_SIGMA_M / 2.5, 1e-5); // …stated with a quarter of the ±
    nearly(assumed.sigmaRel, CEILING_ASSUMED_SIGMA_M / 2.5, 1e-5);
    expect(printed.confidence).toBeGreaterThan(assumed.confidence);
    expect(printed.residuals[0].label).toBe('printed ceiling');
    expect(assumed.residuals[0].label).toBe('assumed ceiling');
  });

  it('says so, rather than guessing, when nothing constrains the scale', () => {
    const f = fuseScale({ raw: RAW });
    expect(f.scale).toBe(1);
    expect(f.confidence).toBe(0);
    expect(f.residuals).toEqual([]);
    expect(f.flags[0]).toMatch(/no metric source/i);
  });
});

describe('fuseScale with sources that agree', () => {
  const plan = fuseScale({ raw: RAW, plan: { width: 3.75 } });
  const both = fuseScale({ raw: RAW, plan: { width: 3.75, depth: 4.6 } });
  const all = fuseScale({
    raw: RAW,
    plan: { width: 3.75, depth: 4.6 },
    anchor: { metresPerUnit: TRUE_SCALE, uncertaintyM: 0.04, referenceMetres: 2.03 },
    ceiling: { heightM: 2.5, printed: true },
    marble: { metricScaleFactor: TRUE_SCALE },
  });

  it('tightens the sigma with every source that corroborates', () => {
    expect(both.sigmaRel).toBeLessThan(plan.sigmaRel);
    expect(all.sigmaRel).toBeLessThan(both.sigmaRel);
    // …and every one of them lands on the same scale, because they were all built from it.
    for (const f of [plan, both, all]) nearly(f.scale, TRUE_SCALE, 5e-4);
  });

  it('raises the confidence and raises no flags', () => {
    expect(plan.confidence).toBeLessThan(both.confidence);
    expect(both.confidence).toBeLessThan(all.confidence);
    expect(all.confidence).toBeGreaterThan(0.9);
    expect(all.flags).toEqual([]);
    expect(all.residuals.map((r) => r.source)).toEqual(['plan-width', 'plan-depth', 'anchor', 'ceiling', 'marble']);
    for (const r of all.residuals) expect(r.sigmas).toBeLessThanOrEqual(2);
  });

  it('weights a loose source less than a tight one', () => {
    // A ±15 % EXIF prior that is 20 % out barely moves a fit the plan already pinned to 1.3 %.
    const withExif = fuseScale({ raw: RAW, plan: { width: 3.75 }, exif: { metresPerUnit: TRUE_SCALE * 1.2 } });
    expect(Math.abs(withExif.scale - plan.scale) / plan.scale).toBeLessThan(0.02);
    expect(withExif.residuals[1].source).toBe('exif');
  });
});

describe('fuseScale when a source disagrees', () => {
  // The classic failure: the photo in front of us is not the room the plan is printing.
  const f = fuseScale({
    raw: RAW,
    plan: { width: 3.75 },
    anchor: { metresPerUnit: TRUE_SCALE * (3.41 / 3.75), uncertaintyM: 0.04, referenceMetres: 2.03 },
  });

  it('flags it in words that name both numbers', () => {
    expect(f.flags).toHaveLength(2);
    const planFlag = f.flags.find((s) => s.startsWith('plan width'));
    expect(planFlag).toBeDefined();
    expect(planFlag).toMatch(/plan width says 3\.75 m, model measures 3\.\d\d m \(\d+\.\dσ\)\./);
    const plan = f.residuals.find((r) => r.source === 'plan-width')!;
    expect(plan.sigmas).toBeGreaterThan(2);
    expect(plan.measured).toBeLessThan(plan.expected);
    expect(plan.residual).toBeLessThan(0);
  });

  it('costs confidence without throwing the fit away', () => {
    // 9 % apart is not imprecision, it is a question about which room this is: 0.23, not 0.85.
    expect(f.confidence).toBeLessThan(0.3);
    // The answer still lies between the two sources, weighted by how sure each of them is.
    expect(f.scale).toBeGreaterThan(TRUE_SCALE * (3.41 / 3.75));
    expect(f.scale).toBeLessThan(TRUE_SCALE);
  });

  it('leaves an agreement inside 2σ unflagged', () => {
    // 3 cm apart on a ±5 cm plan and a ±4 cm anchor is not a disagreement, it is measurement.
    const close = fuseScale({
      raw: RAW,
      plan: { width: 3.75 },
      anchor: { metresPerUnit: TRUE_SCALE * (3.78 / 3.75), uncertaintyM: 0.04, referenceMetres: 2.03 },
    });
    expect(close.flags).toEqual([]);
    expect(close.confidence).toBeGreaterThan(0.7);
  });
});

describe('one drawing is one source, however many dimensions it printed', () => {
  /* The failure this guards: a plan is the *only* thing that measured the room, and both its numbers
     carry the same error, so a sheet drawn 6 % small agrees with itself, no residual passes 2σ and
     the fit reports high confidence for a room that is 6 % wrong. Correlated sources must not
     corroborate each other. */
  const planOnly = { raw: { width: 3.5, depth: 4.2, height: 2.44 }, plan: { width: 3.5, depth: 4.2 }, ceiling: { heightM: 2.44 } } satisfies ScaleConstraints;

  it('counts the plan once, whether it printed one dimension or two', () => {
    const f = fuseScale(planOnly);
    // Three residual rows in the table, but only one independent measurement behind them.
    expect(f.residuals).toHaveLength(3);
    expect(f.independentSources).toBe(1);
    // …and the assumed ceiling is not the second: it is ours, not the room's.
    expect(f.residuals.find((r) => r.source === 'ceiling')?.assumed).toBe(true);
    expect(f.residuals.find((r) => r.source === 'plan-width')?.assumed).toBeUndefined();
  });

  it('does not claim "several sources agree" for one drawing and one assumption', () => {
    const f = fuseScale(planOnly);
    // 0.91 before this rule, which the hub printed as "high confidence · several sources agree".
    expect(f.confidence).toBeLessThan(0.8);
    expect(f.confidence).toBeGreaterThan(0.5);
  });

  it('shares one unit of weight between the plan’s two dimensions', () => {
    const one = fuseScale({ raw: RAW, plan: { width: 3.75 } });
    const two = fuseScale({ raw: RAW, plan: { width: 3.75, depth: 4.6 } });
    // A second dimension off the same sheet still helps — a longer wall is a smaller relative ± —
    // but nothing like the √2 two independent measurements would buy.
    expect(two.sigmaRel).toBeLessThan(one.sigmaRel);
    expect(two.sigmaRel).toBeGreaterThan(one.sigmaRel / Math.SQRT2);
    expect(two.independentSources).toBe(1);
  });

  it('widens sigma when the sources scatter further than they claim they can', () => {
    const agree = fuseScale({ raw: RAW, plan: { width: 3.75 }, anchor: { metresPerUnit: TRUE_SCALE, uncertaintyM: 0.04, referenceMetres: 2.03 } });
    const argue = fuseScale({ raw: RAW, plan: { width: 3.75 }, anchor: { metresPerUnit: TRUE_SCALE * (3.41 / 3.75), uncertaintyM: 0.04, referenceMetres: 2.03 } });
    // Same two sources, same stated ±, but one pair contradicts itself: the fit says so in its σ
    // rather than reporting the precision it would have had if they had agreed.
    expect(argue.sigmaRel).toBeGreaterThan(3 * agree.sigmaRel);
  });
});

describe('an assumed prior is not blamed on the model', () => {
  /* A 3 m ceiling with a plan that agrees to 0.4 %: the reconstruction is right and the standard
     2.44 m we supplied is wrong, so the flag must say that, and it must not be the whole verdict. */
  const tall = fuseScale({ raw: { width: 5.2, depth: 5.0, height: 3.0 }, plan: { width: 5.2, depth: 5.0 }, ceiling: { heightM: 2.44 } });

  it('phrases the disagreement as the assumption failing', () => {
    expect(tall.flags).toHaveLength(1);
    expect(tall.flags[0]).toMatch(/^We assumed a standard ceiling of 2\.44 m; the model measures 2\.9\d m \(\d\.\dσ\)\./);
    expect(tall.flags[0]).toMatch(/ceiling height/);
  });

  it('costs confidence without taking it to zero', () => {
    // 0 before this rule, on a room whose width and depth are inside half a per cent.
    expect(tall.confidence).toBeGreaterThan(0.2);
    expect(tall.confidence).toBeLessThan(0.5);
  });

  it('still lets a real measurement zero it', () => {
    const wrongRoom = fuseScale({
      raw: RAW,
      plan: { width: 3.75 },
      anchor: { metresPerUnit: TRUE_SCALE * 0.7, uncertaintyM: 0.04, referenceMetres: 2.03 },
    });
    expect(wrongRoom.confidence).toBe(0);
  });
});

describe('fuseScale is a pure function', () => {
  const input = (): ScaleConstraints => ({
    raw: RAW,
    plan: { width: 3.75, depth: 4.6 },
    anchor: { metresPerUnit: TRUE_SCALE, uncertaintyM: 0.04, referenceMetres: 2.03 },
    marble: { metricScaleFactor: TRUE_SCALE * 1.01, sigmaRel: MARBLE_SIGMA_REL },
  });

  it('gives identical output for identical input, whatever the key order', () => {
    expect(fuseScale(input())).toEqual(fuseScale(input()));
    expect(JSON.stringify(fuseScale(input()))).toBe(JSON.stringify(fuseScale(input())));
    const reordered: ScaleConstraints = { marble: input().marble, anchor: input().anchor, plan: { depth: 4.6, width: 3.75 }, raw: RAW };
    expect(fuseScale(reordered)).toEqual(fuseScale(input()));
  });

  it('does not mutate what it was given', () => {
    const given = input();
    const before = JSON.stringify(given);
    fuseScale(given);
    expect(JSON.stringify(given)).toBe(before);
  });
});

describe('roomFromFusion', () => {
  const fusion = fuseScale({ raw: RAW, plan: { width: 3.75, depth: 4.6 }, ceiling: { heightM: 2.5, printed: true } });

  it('scales the raw room into metres', () => {
    const room = roomFromFusion(RAW, fusion);
    expect(room.width).toBeCloseTo(3.75, 2);
    expect(room.depth).toBeCloseTo(4.6, 2);
    expect(room.height).toBeCloseTo(2.5, 2);
  });

  it('writes the "plan says / model measures" line for every dimension', () => {
    const { lines } = roomFromFusion(RAW, fusion);
    expect(lines.map((l) => l.dimension)).toEqual(['width', 'depth', 'height']);
    expect(lines[0].text).toMatch(/^Plan says 3\.75 m · model measures 3\.\d\d m \([+−±]0\.\d\d m\)$/);
    expect(lines[2].text).toMatch(/^Ceiling stated 2\.50 m/);
    expect(lines[0].expected).toBe(3.75);
    expect(lines[0].delta).toBeDefined();
  });

  it('says only what it measured when the plan printed nothing', () => {
    const bare = fuseScale({ raw: RAW, anchor: { metresPerUnit: TRUE_SCALE, uncertaintyM: 0.04, referenceMetres: 2.03 } });
    const { lines, width } = roomFromFusion(RAW, bare);
    expect(width).toBeCloseTo(3.75, 2);
    for (const line of lines) {
      expect(line.expected).toBeUndefined();
      expect(line.text).toMatch(/^Model measures \d+\.\d\d m$/);
    }
  });
});
