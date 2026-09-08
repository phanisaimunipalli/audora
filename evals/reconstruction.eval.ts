/**
 * Reconstruction accuracy evaluation — docs/ACCURACY.md section 3.6.
 *
 * This eval **never generates**. It calls no model, no World Labs endpoint and no network at all:
 * it takes collider meshes that already exist on disk, measures them with `shared/collider.ts`,
 * scales them with `shared/fusion.ts`, and reports the table in docs/ACCURACY.md section 1 —
 * dimension error, ceiling error, orientation error, opening error, adjacency, determinism. It is
 * the instrument that says whether the accuracy pass is working; it costs nothing to run and it is
 * the same code path the worker runs after `copy_assets`.
 *
 * ## The corpus
 *
 * 1. **Six synthetic box rooms** (`evals/fixtures/reconstruction/rooms.ts`), written as real .glb
 *    files by a 60-line GLB writer. Their ground truth is exact by construction: each is authored
 *    in metres, converted to raw units by its own `metresPerUnit` (0.31 to 2.22, including the
 *    demo full-quality world's real `metric_scale_factor`), turned by a known yaw of 0° to 80°,
 *    given one doorway that leaks into the room next door, and captured from an off-centre point at
 *    eye height. 2.4 × 3.0 m to 6.5 × 11.8 m.
 * 2. **The real corner-window world** in `public/demo/marble-world-corner-windows.json`, *if* its
 *    collider is cached on disk at `evals/fixtures/reconstruction/real/<world>.glb`. The eval never
 *    downloads it; when the file is absent the row is skipped with the exact command to fetch it.
 * 3. **Any unit a teammate adds** under `evals/fixtures/reconstruction/real/` — see the manifest and
 *    README there. That is the corpus that will eventually replace the synthetic one.
 *
 * ## The three systems
 *
 * One measurement, scaled three ways, so the table separates the reconstruction's error from the
 * anchor's:
 *
 * - **plan + assumed ceiling** — what ships: the plan's printed dimensions (±5 cm), the standard
 *   2.44 m ceiling (±12 cm), and Marble's own `metric_scale_factor` (±5 %) where the world carries
 *   one, fused.
 * - **assumed ceiling only** — the room with no plan at all. The gap to the first row is what the
 *   floor plan is worth in metres.
 * - **printed ceiling only** — the true ceiling (±3 cm) and nothing else. This is the honest measure
 *   of the *reconstruction*: the scale comes from a dimension that is not the one being scored, so
 *   a width error here is the collider's, not the anchor's.
 *
 * Run: `npm run eval` (no dev server, no keys needed), or
 *      `npx vitest run --config vitest.eval.config.ts evals/reconstruction.eval.ts`.
 * Writes: `evals/results/reconstruction-latest.md` and a timestamped JSON beside it.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CEILING_HEIGHT_M,
  extentWalls,
  isOneRoom,
  measureColliderGlb,
  roomRect,
  type WallOpening,
  type WallSide,
  type WorldBounds,
} from '@shared/collider';
import { fuseScale, orientPlan, roomFromFusion, type FusionResult, type OrientedPlan, type ScaleConstraints } from '@shared/fusion';
import { canonicalJson } from '@shared/canonical';
import { ensureSyntheticFixtures, type SyntheticRoom } from './fixtures/reconstruction/rooms';

/* ---------- the contract (docs/ACCURACY.md section 1) ---------- */

/** Median dimension error, and the worst single room. */
const TARGET_DIM_MEDIAN_PCT = 5;
const TARGET_DIM_MAX_PCT = 10;
const TARGET_CEILING_CM = 10;
const TARGET_ORIENTATION_DEG = 10;
const TARGET_OPENING_CM = 30;

/**
 * Rooms known to miss the dimension target today, with the reason. **Not a tolerance**: the eval
 * asserts that this set is exactly the set that fails, so fixing a defect makes the eval fail until
 * the id is deleted from here, and a new failure anywhere else fails it immediately.
 *
 * Empty, and it should stay that way. It held `studio-tall` and `open-plan-flat` until the opening
 * mask in `shared/collider.ts` `fitWallRect` was fixed: it compared the wall band against
 * `boxRadius(toRawBox(coarse), azimuth)`, an **axis-aligned** box made by relabelling the rotated
 * fit's extents onto the raw axes with the rotation dropped, so on a room far off the provider's
 * axes real wall directions were read as "beyond the wall", set aside as openings, and the
 * rectangle refitted on what was left — 138 of 360 bins discarded at 63°, a 5.00 m wall measured as
 * 2.43 m. Masking against the rotated rectangle (`fittedRadius(coarse, azimuth)`) drops 0 bins on
 * all six fixtures and brought the median dimension error from 0.24 % to 0.12 %.
 */
const KNOWN_DIMENSION_DEFECT = new Set<string>([]);

/* ---------- shapes ---------- */

type SystemName = 'plan + assumed ceiling' | 'assumed ceiling only' | 'printed ceiling only';

const SYSTEMS: SystemName[] = ['plan + assumed ceiling', 'assumed ceiling only', 'printed ceiling only'];

/** A door or window as the plan states it: which wall, how far along it, how wide. Metres. */
interface DoorTruth {
  wall: WallSide;
  offsetM: number;
  widthM: number;
}

/**
 * One thing to measure. `plan`, `ceilingM`, `yawDeg` and `door` are the ground truth; any of them
 * may be missing on a real unit, and what is missing is reported as "—" rather than guessed.
 */
interface Fixture {
  id: string;
  kind: 'synthetic' | 'real';
  title: string;
  /** Absolute path of the collider .glb. */
  file: string;
  /** The plan's printed dimensions, metres — the reference for dimension error. */
  plan: { widthM: number; depthM: number } | null;
  /** The true floor-to-ceiling height, metres, when it is known. */
  ceilingM: number | null;
  /** True room yaw relative to the collider's raw axes, degrees. */
  yawDeg: number | null;
  /** The door, in Audora's wall convention — resolved against the measured rectangle's fold. */
  door: ((turned: boolean) => DoorTruth) | null;
  /** Marble's own `metric_scale_factor`, when the world carries one (full tier). */
  metricScaleFactor?: number;
  note: string;
}

/** What the collider says, before anything metric touches it. */
interface Measurement {
  bounds: WorldBounds;
  /** Raw units, Audora's axes, capture point at the origin. */
  raw: { width: number; depth: number; height: number };
  /** Yaw of the fitted rectangle relative to the raw axes, degrees in [0, 90). */
  rotationDeg: number;
  /** True when the fit named the room's long axis "width" the other way round (rotation > 45°). */
  turned: boolean;
  method: string;
  score: number;
  openings: WallOpening[];
  /** Area of the bounding box the wall rectangle replaced, raw units². */
  bboxArea: number;
  wallArea: number;
}

interface Row {
  id: string;
  kind: Fixture['kind'];
  system: SystemName;
  scale: number;
  sigmaRel: number;
  confidence: number;
  widthM: number;
  depthM: number;
  heightM: number;
  /** Per-dimension error against the plan, per cent. Null when there is no plan. */
  widthErrPct: number | null;
  depthErrPct: number | null;
  ceilingErrCm: number | null;
  orientationErrDeg: number | null;
  openingErrCm: number | null;
  openingWidthErrCm: number | null;
  openingWallOk: boolean | null;
  planSwapped: boolean;
  oneRoom: boolean;
  flags: string[];
  lines: string[];
}

/* ---------- small helpers ---------- */

const RAD = Math.PI / 180;

function readArrayBuffer(file: string): ArrayBuffer {
  const b = readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const round = (x: number, dp: number) => {
  const s = 10 ** dp;
  const r = Math.round(x * s) / s;
  return r === 0 ? 0 : r;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const maxOf = (values: number[]): number | null => (values.length ? Math.max(...values) : null);

/** A rectangle is 90°-symmetric as far as axis alignment goes, so the error folds into ±45°. */
function yawErrorDeg(measuredDeg: number, truthDeg: number): number {
  const d = (((measuredDeg - truthDeg) % 90) + 135) % 90;
  return Math.abs(d - 45);
}

const cell = (x: number | null | undefined, dp = 2, suffix = '') => (x == null ? '—' : `${round(x, dp)}${suffix}`);
const tick = (ok: boolean | null) => (ok == null ? '—' : ok ? '✓' : '✗');

/* ---------- measuring ---------- */

function measure(file: string): Measurement {
  const bounds = measureColliderGlb(readArrayBuffer(file));
  const rect = roomRect(bounds)!;
  const walls = extentWalls(bounds);
  const rotation = walls?.rotation ?? 0;
  const rotationDeg = ((rotation / RAD) % 90 + 90) % 90;
  // The floor and ceiling slabs are the room's own height; the bounding box's y span includes
  // whatever the model reconstructed above the ceiling or below the floor.
  const height = bounds.ceilingY != null && bounds.floorY != null ? bounds.ceilingY - bounds.floorY : bounds.maxY - bounds.minY;
  return {
    bounds,
    raw: { width: rect.maxX - rect.minX, depth: rect.maxZ - rect.minZ, height },
    rotationDeg,
    turned: rotationDeg > 45,
    method: bounds.method ?? 'aabb',
    score: walls?.score ?? 0,
    openings: walls?.openings ?? [],
    bboxArea: (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ),
    wallArea: (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ),
  };
}

/**
 * Which of the plan's two dimensions belongs to the fitted rectangle's x axis, in this eval's units.
 *
 * A collider alone cannot know: the fitted rectangle's rotation is only defined modulo 90°, so past
 * 45° the fit names the room's depth "width" (`toRawBox`). The rule itself is `orientPlan` in
 * `shared/fusion.ts` — the same one `server/pipeline.ts` applies before fusing, so this eval scores
 * the ordering production actually feeds `fuseScale` rather than one of its own.
 */
function planFor(raw: Measurement['raw'], plan: { widthM: number; depthM: number }): OrientedPlan {
  return orientPlan(raw, { width: plan.widthM, depth: plan.depthM });
}

function constraintsFor(system: SystemName, fixture: Fixture, m: Measurement): { constraints: ScaleConstraints; swapped: boolean } | null {
  const base: ScaleConstraints = { raw: m.raw };
  if (system === 'printed ceiling only') {
    if (fixture.ceilingM == null) return null;
    return { constraints: { ...base, ceiling: { heightM: fixture.ceilingM, printed: true } }, swapped: false };
  }
  const assumed = { heightM: CEILING_HEIGHT_M, printed: false };
  if (system === 'assumed ceiling only') return { constraints: { ...base, ceiling: assumed }, swapped: false };
  if (!fixture.plan) return null;
  const plan = planFor(m.raw, fixture.plan);
  // A full-tier world also states its own `metric_scale_factor`; docs/ACCURACY.md section 2 says to
  // use it as a constraint and never alone, which is exactly what handing it to `fuseScale` does.
  const marble = fixture.metricScaleFactor ? { marble: { metricScaleFactor: fixture.metricScaleFactor } } : {};
  return { constraints: { ...base, plan: { width: plan.width, depth: plan.depth }, ceiling: assumed, ...marble }, swapped: plan.swapped };
}

/** Where the measured opening sits, in metres along its wall, and how wide it is. */
function measuredDoor(m: Measurement, scale: number): { wall: WallSide; offsetM: number; widthM: number } | null {
  if (!m.openings.length) return null;
  // The widest opening is the doorway: a collider's other openings are windows, which are narrower.
  const door = [...m.openings].sort((a, b) => b.width - a.width)[0];
  return { wall: door.wall, offsetM: door.offset * scale, widthM: door.width * scale };
}

/* ---------- scoring one fixture under one system ---------- */

function score(fixture: Fixture, m: Measurement, system: SystemName): { row: Row; fusion: FusionResult } | null {
  const prepared = constraintsFor(system, fixture, m);
  if (!prepared) return null;
  const fusion = fuseScale(prepared.constraints);
  const room = roomFromFusion(m.raw, fusion);
  const plan = fixture.plan ? planFor(m.raw, fixture.plan) : null;
  const truthDoor = fixture.door?.(m.turned) ?? null;
  const got = measuredDoor(m, fusion.scale);
  return {
    fusion,
    row: {
      id: fixture.id,
      kind: fixture.kind,
      system,
      scale: round(fusion.scale, 5),
      sigmaRel: round(fusion.sigmaRel * 100, 2),
      confidence: fusion.confidence,
      widthM: round(room.width, 3),
      depthM: round(room.depth, 3),
      heightM: round(room.height, 3),
      widthErrPct: plan ? round((100 * (room.width - plan.width)) / plan.width, 2) : null,
      depthErrPct: plan ? round((100 * (room.depth - plan.depth)) / plan.depth, 2) : null,
      ceilingErrCm: fixture.ceilingM == null ? null : round(100 * (room.height - fixture.ceilingM), 1),
      orientationErrDeg: fixture.yawDeg == null ? null : round(yawErrorDeg(m.rotationDeg, fixture.yawDeg), 2),
      openingErrCm: truthDoor && got ? round(100 * (got.offsetM - truthDoor.offsetM), 1) : null,
      openingWidthErrCm: truthDoor && got ? round(100 * (got.widthM - truthDoor.widthM), 1) : null,
      openingWallOk: truthDoor && got ? got.wall === truthDoor.wall : null,
      planSwapped: prepared.swapped,
      oneRoom: isOneRoom(room),
      flags: fusion.flags,
      lines: room.lines.map((l) => l.text),
    },
  };
}

/* ---------- the synthetic corpus ---------- */

/**
 * The doorway a synthetic room was authored with, expressed the way the measurement expresses it.
 *
 * The room's own frame is `(u, v)`; the measured rectangle (`roomRect`) is that frame seen through
 * `(x, z)_raw → (x, −z)` after the room's yaw is turned out, which makes it a rotation by a
 * multiple of 90° plus a reflection. Two cases, and which one applies is decided by the *measured*
 * fold rather than the authored yaw, because the fold at exactly 45° is a labelling choice and not
 * an accuracy claim (the orientation column is what catches a real rotation error):
 *
 *     rotation ≤ 45°:  rect x =  u − cu,      rect z = −(v − cv)
 *     rotation > 45°:  rect x = −(v − cv),    rect z = −(u − cu)
 *
 * Verified against the measurement on four fixtures with three different folds, and against
 * `tests/shared-collider.test.ts`, which asserts the same mapping on its own box room.
 */
function syntheticDoor(spec: SyntheticRoom, turned: boolean): DoorTruth {
  const { u: cu, v: cv } = spec.cameraM;
  const u2 = spec.widthM / 2;
  const v2 = spec.depthM / 2;
  const d = spec.door;
  const mid = d.wall === 'u-' ? { u: -u2, v: d.centreM } : d.wall === 'u+' ? { u: u2, v: d.centreM } : { u: d.centreM, v: d.wall === 'v-' ? -v2 : v2 };
  const rect = turned
    ? { x: -(mid.v - cv), z: -(mid.u - cu), minX: cv - v2, maxX: cv + v2, minZ: cu - u2, maxZ: cu + u2 }
    : { x: mid.u - cu, z: -(mid.v - cv), minX: -u2 - cu, maxX: u2 - cu, minZ: cv - v2, maxZ: cv + v2 };
  const eps = 1e-6;
  const wall: WallSide =
    Math.abs(rect.x - rect.minX) < eps ? 'west' : Math.abs(rect.x - rect.maxX) < eps ? 'east' : Math.abs(rect.z - rect.minZ) < eps ? 'north' : 'south';
  const offsetM = wall === 'north' || wall === 'south' ? rect.x - rect.minX : rect.z - rect.minZ;
  return { wall, offsetM, widthM: d.widthM };
}

function syntheticFixtures(dir: string): Fixture[] {
  return ensureSyntheticFixtures(dir).map(({ spec, file }) => ({
    id: spec.id,
    kind: 'synthetic' as const,
    title: spec.title,
    file,
    // A synthetic room's plan is exact: it is the drawing the room was built from.
    plan: { widthM: spec.widthM, depthM: spec.depthM },
    ceilingM: spec.ceilingM,
    yawDeg: spec.yawDeg,
    door: (turned: boolean) => syntheticDoor(spec, turned),
    note: spec.note,
  }));
}

/* ---------- the real corpus ---------- */

/** What `evals/fixtures/reconstruction/real/manifest.json` holds. See the README beside it. */
interface RealUnit {
  id: string;
  title?: string;
  collider: string;
  plan?: { widthM: number; depthM: number };
  ceiling?: { heightM: number; printed?: boolean };
  yawDeg?: number;
  door?: DoorTruth;
  metricScaleFactor?: number;
  note?: string;
}

/** The demo corner-window world, when someone has cached its collider next to the manifest. */
const DEMO_WORLD = 'marble-world-corner-windows.json';

/**
 * What `src/state/seed.ts` hard-codes for that world, from a real read of its 76k vertices: the
 * wall rectangle is 4.3736 × 5.9085 raw units at 47.0°. Reported as a regression check when the
 * collider is on disk — the demo ships these numbers, so the measurement has to keep producing them.
 */
const DEMO_REFERENCE = { widthUnits: 4.3736, depthUnits: 5.9085, rotationDeg: 47.0 };

function realFixtures(dir: string, skips: string[]): Fixture[] {
  const out: Fixture[] = [];
  const on = (file: string) => {
    try {
      return readFileSync(path.join(dir, file)).byteLength > 0;
    } catch {
      return false;
    }
  };

  // (b) the app's own demo world, from its stored world JSON. Its collider lives on the CDN; the
  // eval never fetches it, so it is scored only when someone has put the bytes here once.
  const worldPath = path.resolve(process.cwd(), 'public/demo', DEMO_WORLD);
  try {
    const world = JSON.parse(readFileSync(worldPath, 'utf8')) as { display_name?: string; assets?: { mesh?: { collider_mesh_url?: string } } };
    const url = world.assets?.mesh?.collider_mesh_url;
    const cached = `${path.basename(DEMO_WORLD, '.json')}.glb`;
    if (on(cached)) {
      out.push({
        id: 'demo-corner-windows',
        kind: 'real',
        title: world.display_name || 'Demo corner-window room',
        file: path.join(dir, cached),
        // No floor plan was ever drawn for this room: it is a Wikimedia photograph. Reported, not
        // scored for dimension error — which is exactly the state of the real corpus today.
        plan: null,
        ceilingM: null,
        yawDeg: null,
        door: null,
        note: 'Real Marble draft (230 credits). No plan, so its dimensions are reported, not scored.',
      });
    } else if (url) {
      skips.push(
        `\`${DEMO_WORLD}\`: its collider is not on disk, and this eval never fetches. Run \`curl -sSL "${url}" -o evals/fixtures/reconstruction/real/${cached}\` once to score it; \`evals/fixtures/reconstruction/real/README.md\` lists the numbers it should reproduce.`,
      );
    }
  } catch {
    skips.push(`\`public/demo/${DEMO_WORLD}\` could not be read; the demo world was not scored.`);
  }

  // (c) whatever a teammate has added.
  let manifest: { units?: RealUnit[] } = {};
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { units?: RealUnit[] };
  } catch {
    return out;
  }
  for (const unit of manifest.units ?? []) {
    if (!on(unit.collider)) {
      skips.push(`\`${unit.id}\`: \`${unit.collider}\` is not in evals/fixtures/reconstruction/real/, so it was not scored.`);
      continue;
    }
    out.push({
      id: unit.id,
      kind: 'real',
      title: unit.title || unit.id,
      file: path.join(dir, unit.collider),
      plan: unit.plan ?? null,
      ceilingM: unit.ceiling?.heightM ?? null,
      yawDeg: unit.yawDeg ?? null,
      door: unit.door ? () => unit.door as DoorTruth : null,
      metricScaleFactor: unit.metricScaleFactor,
      note: unit.note || 'Added by a teammate (evals/fixtures/reconstruction/real/manifest.json).',
    });
  }
  return out;
}

/* ---------- determinism ---------- */

/**
 * The whole measurement and fusion, canonically encoded — the same encoder that decides a recipe
 * hash. Run twice from a fresh read of the bytes, this string has to be identical, or "same photos
 * give the same world" is not true and nothing downstream of it can be cached.
 */
function fingerprint(fixture: Fixture): string {
  const m = measure(fixture.file);
  const runs = SYSTEMS.map((system) => {
    const scored = score(fixture, m, system);
    return scored ? { system, row: { ...scored.row, flags: scored.row.flags, lines: scored.row.lines } } : { system, row: null };
  });
  return canonicalJson({ bounds: m.bounds, raw: m.raw, rotationDeg: m.rotationDeg, openings: m.openings, runs });
}

/* ---------- aggregate ---------- */

interface Summary {
  system: SystemName;
  rooms: number;
  dimMedianPct: number | null;
  dimMaxPct: number | null;
  within10: string;
  ceilingMaxCm: number | null;
  openingMaxCm: number | null;
  meanConfidence: number;
  flags: number;
}

function summarize(rows: Row[]): Summary[] {
  return SYSTEMS.map((system) => {
    const list = rows.filter((r) => r.system === system);
    const errs = list.flatMap((r) => [r.widthErrPct, r.depthErrPct].filter((x): x is number => x != null).map(Math.abs));
    const perRoom = list.map((r) => maxOf([r.widthErrPct, r.depthErrPct].filter((x): x is number => x != null).map(Math.abs))).filter((x): x is number => x != null);
    return {
      system,
      rooms: list.length,
      dimMedianPct: errs.length ? round(median(errs)!, 2) : null,
      dimMaxPct: errs.length ? round(maxOf(errs)!, 2) : null,
      within10: perRoom.length ? `${perRoom.filter((e) => e <= TARGET_DIM_MAX_PCT).length}/${perRoom.length}` : '—',
      ceilingMaxCm: maxOf(list.map((r) => r.ceilingErrCm).filter((x): x is number => x != null).map(Math.abs)),
      openingMaxCm: maxOf(list.map((r) => r.openingErrCm).filter((x): x is number => x != null).map(Math.abs)),
      meanConfidence: list.length ? round(list.reduce((a, r) => a + r.confidence, 0) / list.length, 3) : 0,
      flags: list.reduce((a, r) => a + r.flags.length, 0),
    };
  }).filter((s) => s.rooms > 0);
}

/* ---------- the run ---------- */

describe('reconstruction accuracy evaluation', () => {
  it('measures every collider on disk and reports the accuracy contract', () => {
    const startedAt = new Date().toISOString();
    const root = process.cwd();
    const syntheticDir = path.resolve(root, 'evals/fixtures/reconstruction/synthetic');
    const realDir = path.resolve(root, 'evals/fixtures/reconstruction/real');
    const skips: string[] = [];
    const fixtures = [...syntheticFixtures(syntheticDir), ...realFixtures(realDir, skips)];

    const measurements = new Map<string, Measurement>();
    const rows: Row[] = [];
    for (const fixture of fixtures) {
      const m = measure(fixture.file);
      measurements.set(fixture.id, m);
      for (const system of SYSTEMS) {
        const scored = score(fixture, m, system);
        if (scored) rows.push(scored.row);
      }
    }

    // Determinism: the same bytes, read and measured again, canonically encode to the same string.
    const determinism = fixtures.map((f) => ({ id: f.id, stable: fingerprint(f) === fingerprint(f) }));
    const stable = determinism.filter((d) => d.stable).length;

    const production = rows.filter((r) => r.system === 'plan + assumed ceiling');
    const summaries = summarize(rows);
    console.table(summaries);
    console.table(
      production.map((r) => ({
        room: r.id,
        'width m': r.widthM,
        'depth m': r.depthM,
        'dim err %': maxOf([r.widthErrPct, r.depthErrPct].filter((x): x is number => x != null).map(Math.abs)),
        'ceiling cm': r.ceilingErrCm,
        'yaw °': r.orientationErrDeg,
        'door cm': r.openingErrCm,
        'one room': r.oneRoom,
      })),
    );

    /* ----- the contract table ----- */
    const dimErrs = production.flatMap((r) => [r.widthErrPct, r.depthErrPct].filter((x): x is number => x != null).map(Math.abs));
    const perRoomErr = new Map<string, number>();
    for (const r of production) {
      const e = maxOf([r.widthErrPct, r.depthErrPct].filter((x): x is number => x != null).map(Math.abs));
      if (e != null) perRoomErr.set(r.id, e);
    }
    const failing = [...perRoomErr.entries()].filter(([, e]) => e > TARGET_DIM_MAX_PCT).map(([id]) => id);
    const dimMedian = median(dimErrs);
    const dimMax = maxOf(dimErrs);
    const yawMax = maxOf(production.map((r) => r.orientationErrDeg).filter((x): x is number => x != null));
    // A room whose rectangle was mis-measured has one wrong scale, so its ceiling and its doorway
    // are wrong by that same factor. Both numbers are reported whole and again over the rooms whose
    // rectangle stands, because averaging one defect into four good rooms hides which is which.
    const sound = production.filter((r) => !failing.includes(r.id));
    const abs = (list: Row[], pick: (r: Row) => number | null) => list.map(pick).filter((x): x is number => x != null).map(Math.abs);
    const ceilingMax = maxOf(abs(production, (r) => r.ceilingErrCm));
    const ceilingMaxSound = maxOf(abs(sound, (r) => r.ceilingErrCm));
    const openingMax = maxOf(abs(production, (r) => r.openingErrCm));
    const openingMaxSound = maxOf(abs(sound, (r) => r.openingErrCm));
    const openingWalls = production.filter((r) => r.openingWallOk != null);
    /** "worst 142.6 cm (0.4 cm over the rooms whose rectangle was measured)". */
    const withSound = (whole: number | null, soundOnly: number | null, dp: number, unit: string) =>
      whole == null
        ? '—'
        : `worst ${round(whole, dp)}${unit}${soundOnly != null && failing.length && soundOnly !== whole ? ` (${round(soundOnly, dp)}${unit} over the rooms whose rectangle was measured)` : ''}`;

    const contract = [
      {
        measure: 'Dimension error',
        target: `median < ${TARGET_DIM_MEDIAN_PCT} %, every room < ${TARGET_DIM_MAX_PCT} %`,
        result: dimMedian == null ? '—' : `median ${round(dimMedian, 2)} %, worst ${round(dimMax!, 2)} % (${perRoomErr.size - failing.length}/${perRoomErr.size} rooms inside)`,
        pass: dimMedian == null ? null : dimMedian < TARGET_DIM_MEDIAN_PCT && failing.length === 0,
      },
      {
        measure: 'Ceiling error',
        target: `< ${TARGET_CEILING_CM} cm`,
        result: withSound(ceilingMax, ceilingMaxSound, 1, ' cm'),
        pass: ceilingMax == null ? null : ceilingMax < TARGET_CEILING_CM,
      },
      {
        measure: 'Orientation error',
        target: `< ${TARGET_ORIENTATION_DEG}°`,
        result: yawMax == null ? '—' : `worst ${round(yawMax, 2)}°`,
        pass: yawMax == null ? null : yawMax < TARGET_ORIENTATION_DEG,
      },
      {
        measure: 'Opening error',
        target: `< ${TARGET_OPENING_CM} cm`,
        result:
          openingMax == null
            ? '—'
            : `${withSound(openingMax, openingMaxSound, 1, ' cm')}, ${openingWalls.filter((r) => r.openingWallOk).length}/${openingWalls.length} on the right wall`,
        pass: openingMax == null ? null : openingMax < TARGET_OPENING_CM && openingWalls.every((r) => r.openingWallOk),
      },
      {
        measure: 'Adjacency',
        target: '100 %',
        result: 'not measured — needs the unit graph (docs/ACCURACY.md section 3.3); one collider has no neighbours to lead to',
        pass: null,
      },
      {
        measure: 'Determinism',
        target: 'always',
        result: `${stable}/${determinism.length} fixtures byte-identical over two runs from a fresh read`,
        pass: stable === determinism.length,
      },
    ];

    /* ----- the report ----- */
    const out: string[] = [];
    out.push(`# Reconstruction accuracy — ${startedAt}`);
    out.push('');
    out.push(
      `${fixtures.length} colliders measured (${fixtures.filter((f) => f.kind === 'synthetic').length} synthetic, ${fixtures.filter((f) => f.kind === 'real').length} real), each scaled three ways. **This eval never generates**: no model, no World Labs call, no network. It reads .glb bytes that already exist, measures them with \`shared/collider.ts\` and scales them with \`shared/fusion.ts\` — the same code the worker runs after \`copy_assets\`.`,
    );
    out.push('');
    out.push('## The contract (docs/ACCURACY.md section 1)');
    out.push('');
    out.push('Measured on the production system: the plan\'s printed dimensions (±5 cm) fused with an assumed 2.44 m ceiling (±12 cm).');
    out.push('');
    out.push('| Measure | Target | Result | |');
    out.push('| --- | --- | --- | --- |');
    for (const c of contract) out.push(`| ${c.measure} | ${c.target} | ${c.result} | ${tick(c.pass)} |`);
    out.push('');

    out.push('## Systems');
    out.push('');
    out.push(
      'One measurement, three scales. **plan + assumed ceiling** is what ships (plus Marble\'s own `metric_scale_factor` where a full-tier world carries one). **assumed ceiling only** is the same room with no plan — the difference is what a floor plan is worth. **printed ceiling only** takes its scale from the true ceiling and nothing else, so a width error in that row is the reconstruction\'s own, not the anchor\'s.',
    );
    out.push('');
    out.push('| system | rooms | median dim err | worst dim err | rooms within 10% | worst ceiling | worst door | mean confidence | flags |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const s of summaries) {
      out.push(
        `| ${s.system} | ${s.rooms} | ${cell(s.dimMedianPct, 2, ' %')} | ${cell(s.dimMaxPct, 2, ' %')} | ${s.within10} | ${cell(s.ceilingMaxCm, 1, ' cm')} | ${cell(s.openingMaxCm, 1, ' cm')} | ${s.meanConfidence} | ${s.flags} |`,
      );
    }
    out.push('');

    out.push('## Per room (plan + assumed ceiling)');
    out.push('');
    out.push(
      'The plan is shown in the order it was fused in. "axes" is `swapped` where the fitted rectangle names the room’s depth "width" — past 45° it always does, and the plan has to be matched to the rectangle before fusion or both dimensions flag against a perfectly good room.',
    );
    out.push('');
    out.push('| room | plan m | measured m | width err | depth err | ceiling | yaw err | door | axes | one room? | m/unit | σ | conf |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of production) {
      const f = fixtures.find((x) => x.id === r.id)!;
      const oriented = f.plan ? planFor(measurements.get(r.id)!.raw, f.plan) : null;
      const plan = oriented ? `${round(oriented.width, 2)} × ${round(oriented.depth, 2)}` : '—';
      const door =
        r.openingErrCm == null
          ? '—'
          : `${r.openingErrCm > 0 ? '+' : ''}${r.openingErrCm} cm ${tick(r.openingWallOk)}${r.openingWidthErrCm == null ? '' : ` (width ${r.openingWidthErrCm > 0 ? '+' : ''}${r.openingWidthErrCm} cm)`}`;
      const ceiling = r.ceilingErrCm == null ? `${round(r.heightM, 2)} m` : `${round(r.heightM, 2)} m (${r.ceilingErrCm > 0 ? '+' : ''}${r.ceilingErrCm} cm)`;
      out.push(
        `| ${r.id} | ${plan} | ${r.widthM} × ${r.depthM} | ${cell(r.widthErrPct, 2, ' %')} | ${cell(r.depthErrPct, 2, ' %')} | ${ceiling} | ${cell(r.orientationErrDeg, 2, '°')} | ${door} | ${r.planSwapped ? 'swapped' : 'as drawn'} | ${tick(r.oneRoom)} | ${r.scale} | ${r.sigmaRel} % | ${r.confidence} |`,
      );
    }
    out.push('');

    // A real unit with no floor plan cannot be scored for dimension error — there is nothing to
    // score it against — but it is still measured, and what it measures is worth printing.
    const unscored = fixtures.filter((f) => !production.some((r) => r.id === f.id));
    if (unscored.length) {
      out.push('## Measured, not scored');
      out.push('');
      out.push('No printed plan, so there is no reference for dimension error. Scaled by the assumed 2.44 m ceiling, which is what the product does with such a room.');
      out.push('');
      out.push('| room | measured m | ceiling | rotation | one room? | openings | note |');
      out.push('| --- | --- | --- | --- | --- | --- | --- |');
      for (const f of unscored) {
        const r = rows.find((x) => x.id === f.id && x.system === 'assumed ceiling only');
        const m = measurements.get(f.id)!;
        const openings = m.openings.map((o) => `${o.wall} ${round(o.width * (r?.scale ?? 1), 2)} m`).join(', ') || '—';
        out.push(
          `| ${f.id} | ${r ? `${r.widthM} × ${r.depthM}` : '—'} | ${r ? `${round(r.heightM, 2)} m` : '—'} | ${round(m.rotationDeg, 1)}° | ${r ? tick(r.oneRoom) : '—'} | ${openings} | ${f.note} |`,
        );
      }
      out.push('');
    }

    out.push('## What the collider gave, before any scale');
    out.push('');
    out.push('`method: walls` means the wall band found a rectangular room; `score` is the fraction of that band the rectangle explains. The last column is why the wall rectangle exists at all: a Marble collider reconstructs the room next door through an open doorway, so its bounding box is not the room.');
    out.push('');
    out.push('| room | method | score | rotation | wall rect m² | bounding box m² | box ÷ room | openings |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const f of fixtures) {
      const m = measurements.get(f.id)!;
      const scale = production.find((r) => r.id === f.id)?.scale ?? rows.find((r) => r.id === f.id)?.scale ?? 1;
      const wall = m.wallArea * scale * scale;
      const box = m.bboxArea * scale * scale;
      out.push(
        `| ${f.id} | ${m.method} | ${round(m.score, 2)} | ${round(m.rotationDeg, 1)}° | ${round(wall, 1)} | ${round(box, 1)} | ${round(box / wall, 1)}× | ${m.openings.map((o) => `${o.wall} ${round(o.width * scale, 2)} m`).join(', ') || '—'} |`,
      );
    }
    out.push('');

    const withPlan = summaries.find((s) => s.system === 'plan + assumed ceiling');
    const noPlan = summaries.find((s) => s.system === 'assumed ceiling only');
    const printed = summaries.find((s) => s.system === 'printed ceiling only');
    if (withPlan && noPlan && printed) {
      out.push('## What this says');
      out.push('');
      out.push(
        `**The reconstruction is not the error budget; the anchor is.** Scaled by a known ceiling alone — a dimension that is not one of the ones being scored — the collider's own rectangle is within ${cell(printed.dimMedianPct, 2, ' %')} of the plan at the median. Swap that for the standard 2.44 m assumption every draft world starts with and the median error becomes ${cell(noPlan.dimMedianPct, 2, ' %')}, entirely because a room with a 2.70 m or 3.00 m ceiling is scaled as though it had a 2.44 m one. The plan puts it back: ${cell(withPlan.dimMedianPct, 2, ' %')}.`,
      );
      out.push('');
      out.push(
        `**Confidence tracks that.** ${withPlan.meanConfidence} with the plan against ${noPlan.meanConfidence} without it — the fit is tighter, corroborated by a second source, and it is that number a room prints beside its dimensions.`,
      );
      out.push('');
      const ratios = fixtures.map((f) => measurements.get(f.id)!).map((m) => m.bboxArea / m.wallArea);
      out.push(
        `**The wall rectangle is the whole reason a room can be measured at all.** Every fixture leaks through its doorway the way a Marble collider does, and the bounding box that follows is ${round(Math.min(...ratios), 1)}× to ${round(Math.max(...ratios), 1)}× the room. The table above is what the two-pass wall fit recovers from it.`,
      );
      out.push('');
    }

    out.push('## What a buyer would read');
    out.push('');
    out.push('`roomFromFusion` writes one line per dimension, so nothing is shown as more certain than its residual:');
    out.push('');
    for (const r of production.slice(0, 3)) {
      out.push(`- **${r.id}** — ${r.lines.join(' · ')}`);
    }
    const flagged = production.filter((r) => r.flags.length);
    if (flagged.length) {
      out.push('');
      out.push('Rooms where a source disagreed by more than 2σ (the flag a seller sees):');
      out.push('');
      for (const r of flagged) for (const flag of r.flags) out.push(`- **${r.id}** — ${flag}`);
    }
    out.push('');

    out.push('## Determinism');
    out.push('');
    out.push(
      `Each fixture is read from disk, measured and fused twice, and the whole result — bounds, wall rectangle, openings, every fused number — is encoded with \`canonicalJson\` (the encoder that decides a recipe hash). ${stable} of ${determinism.length} produced identical strings. Nothing in the path reads a clock or a random number, so this is the property that lets the pipeline cache a world by its recipe.`,
    );
    out.push('');

    if (failing.length) {
      out.push('## Open defect');
      out.push('');
      out.push(
        `${failing.length} of ${perRoomErr.size} rooms miss the dimension target: **${failing.join(', ')}**. The cause is one line in \`shared/collider.ts\`. \`fitWallRect\` masks the wall band against \`boxRadius(toRawBox(coarse), azimuth)\` — an *axis-aligned* box built by relabelling the rotated fit's extents onto the raw axes, with the rotation thrown away. For a room far off the provider's axes that box is the wrong shape at most azimuths, so real wall directions are read as "beyond the wall", set aside as openings, and the rectangle is refitted on what is left of the room. At 63° it drops 138 of the 360 azimuth bins and measures a 5.00 m wall as 2.43 m; at 80° it turns 11.8 m into 7.0 m. The fix is to mask against the *rotated* rectangle — \`fittedRadius(coarse, azimuth)\`, already in that file and already used by \`refineRect\` and \`wallScore\` — with which the mask drops 0 bins on all six fixtures. Nothing else about the fit is wrong: the rotation is recovered exactly (0.00° on every room, including these two), and the coarse supports are right to the centimetre *before* the mask is applied — 1.60 / 3.40 / 4.00 / 1.20 m on \`studio-tall\`, which is where its four walls are.`,
      );
      out.push('');
      out.push(
        'It is at least loud rather than silent: both rooms come out with a scale that contradicts the plan by 28σ to 64σ, both are flagged, both land at confidence 0, and `isOneRoom` rejects both (one on area, one on an impossible 4.27 m ceiling), so the pipeline would keep the caller’s estimate rather than publish the wrong number. Nobody would be told a 5.0 m wall is 3.5 m — but nobody would be told anything, either.',
      );
      out.push('');
    }

    out.push('## Honest limits');
    out.push('');
    out.push(
      '- **The ground truth is synthetic.** Six rooms authored in metres and meshed here; their walls are flat, their corners square and their only clutter is the room next door leaking through the doorway. A real collider is noisy, has furniture, curtains, radiators and a bay window. These numbers are a floor on the error, not an estimate of it.',
    );
    out.push(
      '- **No real unit with a plan is in the corpus yet.** The demo corner-window world is a Wikimedia photograph with no floor plan, so it can be measured but not scored; everything in `evals/fixtures/reconstruction/real/` is scored the moment a teammate adds a collider and the dimensions its plan prints (see the README there). Until then the dimension row of the contract table is a statement about the arithmetic, not about Marble.',
    );
    out.push(
      '- **Adjacency is not measured.** One collider has no neighbouring room to lead to; that row needs the unit graph from docs/ACCURACY.md section 3.3.',
    );
    out.push(
      '- **The plan\'s axis order is resolved by aspect ratio here.** A collider cannot know which of its two axes the plan calls "width" (the fit is only defined modulo 90°), so this eval picks the assignment whose aspect ratio matches and reports it. In production that comes from the plan\'s north arrow; a nearly square room can still be matched the wrong way round, and the eval would not notice.',
    );
    out.push('- **Openings are located to about 2 %, not 1 %**: the wall band is binned at one degree of azimuth, so a doorway a metre away can only be placed to a centimetre or two, and a wide one to more.');
    if (skips.length) {
      out.push('');
      out.push('## Not scored in this run');
      out.push('');
      for (const s of skips) out.push(`- ${s}`);
    }
    out.push('');
    out.push('## Adding a real unit');
    out.push('');
    out.push(
      'Put the collider `.glb` in `evals/fixtures/reconstruction/real/` and add an entry to the manifest there with the dimensions its plan prints. Nothing else: the eval measures every collider it finds. `evals/fixtures/reconstruction/real/README.md` has the field list and a worked example.',
    );
    out.push('');
    out.push('## Corpus');
    out.push('');
    out.push('| room | kind | what it is | why it is in here |');
    out.push('| --- | --- | --- | --- |');
    for (const f of fixtures) out.push(`| ${f.id} | ${f.kind} | ${f.title} | ${f.note} |`);
    out.push('');
    out.push(
      'Ground truth for the synthetic rooms is `evals/fixtures/reconstruction/synthetic/manifest.json`, regenerated from `evals/fixtures/reconstruction/rooms.ts` whenever the spec changes; real units live in `evals/fixtures/reconstruction/real/`.',
    );

    const outDir = path.resolve(root, 'evals/results');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'reconstruction-latest.md'), out.join('\n') + '\n');
    writeFileSync(
      path.join(outDir, `reconstruction-${startedAt.replace(/[:.]/g, '-')}.json`),
      JSON.stringify({ startedAt, contract, summaries, rows, determinism, skips }, null, 2),
    );

    /* ----- assertions -----
     * The eval is an instrument first: its output is the report above. What it asserts is the part
     * of the contract that holds today, so that a regression fails the run rather than quietly
     * changing a number in a markdown file nobody reads. The two rooms in KNOWN_DIMENSION_DEFECT
     * are exempted from the measures that the same defect drags down with it — a mis-measured
     * rectangle gives a wrong scale, and a wrong scale makes that room's ceiling and doorway wrong
     * by the same factor. It is one defect, asserted once, in one place.
     *
     * Only the synthetic rooms are held to the contract, because only their ground truth is exact.
     * A real unit that misses a target is data about Marble (or about the plan it was given), not a
     * regression in this repo, so it is reported and left to the report. */
    const syntheticIds = new Set(fixtures.filter((f) => f.kind === 'synthetic').map((f) => f.id));
    // Every synthetic fixture is a rectangular room and the fitter has to say so. (A real collider
    // may legitimately come back `aabb`: Marble's covers everything it imagined through the doors.)
    for (const id of syntheticIds) expect(measurements.get(id)!.method, `${id} should measure to its walls`).toBe('walls');
    // Determinism is not negotiable, for any fixture: it is what makes a recipe hash mean anything.
    expect(determinism.filter((d) => !d.stable).map((d) => d.id)).toEqual([]);
    // Orientation holds for every synthetic room, including the two the mask defect mis-sizes: the
    // rotation is recovered exactly and only the extents along it are wrong.
    for (const r of production) {
      if (r.orientationErrDeg != null && syntheticIds.has(r.id)) expect(r.orientationErrDeg, `${r.id} orientation`).toBeLessThan(TARGET_ORIENTATION_DEG);
    }
    // Dimensions: the set that misses the target must be exactly the known defect — no more (a
    // regression), and no fewer (the fix landed: delete the id from KNOWN_DIMENSION_DEFECT and the
    // eval starts holding that room to the contract).
    expect(new Set(failing.filter((id) => syntheticIds.has(id))), 'synthetic rooms missing the dimension target').toEqual(KNOWN_DIMENSION_DEFECT);
    for (const r of sound.filter((x) => syntheticIds.has(x.id))) {
      if (r.ceilingErrCm != null) expect(Math.abs(r.ceilingErrCm), `${r.id} ceiling`).toBeLessThan(TARGET_CEILING_CM);
      if (r.openingErrCm == null) continue;
      expect(r.openingWallOk, `${r.id} door wall`).toBe(true);
      expect(Math.abs(r.openingErrCm), `${r.id} door offset`).toBeLessThan(TARGET_OPENING_CM);
    }
    // The report is the deliverable.
    expect(readdirSync(outDir)).toContain('reconstruction-latest.md');
  });
});
