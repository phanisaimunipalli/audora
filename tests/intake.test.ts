/**
 * Intake that earns accuracy — docs/ACCURACY.md sections 3.4, 3.5 and 3.7.
 *
 * Everything the create wizard and the hub decide about photographs, plan pairings, model choice and
 * the deferred staging surfaces lives in pure modules (`src/screens/create/intake.ts`,
 * `src/screens/hub/accuracy.ts`, `src/state/staging.ts`) precisely so it can be checked here without
 * a DOM, a store or a network. The components import these functions and draw the result.
 *
 * No fixtures on disk and no clock: every photo is a hand-made set of the numbers `preparePhoto`
 * measures, and every measurement is a hand-written `FusionResult`, so a failure names a rule rather
 * than a JPEG.
 */
import { describe, expect, it } from 'vitest';
import type { FusionResidual, FusionResult } from '../shared/fusion';
import { fuseScale } from '../shared/fusion';
import type { RoomWorld } from '../src/state/types';
import {
  ANGLE_PLAN,
  FULL_PLUS_MODEL,
  MIN_ANGLES,
  PLUS_AREA_M2,
  RECOMMENDED_ANGLES,
  angleState,
  blockedRooms,
  intakeSummary,
  isOpenPlan,
  modelForRoom,
  nameScore,
  photoVerdict,
  planPhotoRows,
  plusReason,
  reconstructionSummary,
  roomIntake,
  RECONSTRUCT_MIN_PHOTOS,
  RECONSTRUCT_PIPELINE_THRESHOLD,
  sendsReconstructImages,
  suggestPlanRoom,
  tierPlan,
  unconfirmedRows,
  unusedPlanRooms,
  wantsReconstruction,
} from '../src/screens/create/intake';
import { planRoomRef, rawFromMeasurements, withPlanRoom, withoutPhoto, type DraftPhoto, type DraftPlanRoomRef, type DraftRoom } from '../src/screens/create/types';
import type { FlatPlanRoom } from '../src/services/floorplan';
import { DRAFT_MODEL, FULL_MODEL } from '../src/state/publish';
import { STAGING_SURFACES, hiddenStagingSurfaces, resolveTab, showsStaging, stagingEnabled, visibleTabs } from '../src/state/staging';
import {
  CEILING_OK_M,
  DIMENSION_OK_PCT,
  confidenceLabel,
  CONFIDENCE_CHIP,
  gradeLine,
  median,
  roomAccuracy,
  roomLead,
  tourAccuracy,
  type MeasurableRoom,
} from '../src/screens/hub/accuracy';

/* ---------- fixtures ---------- */

/** A clean, wide, well-lit shot: the numbers `preparePhoto` would report for a good photo. */
const photo = (over: Partial<DraftPhoto> = {}): DraftPhoto => ({
  dataUrl: 'data:image/jpeg;base64,AAAA',
  width: 1280,
  height: 960,
  brightness: 0.52,
  darkFraction: 0.02,
  detail: 0.14,
  ...over,
});

const draft = (over: Partial<DraftRoom> = {}): DraftRoom => ({
  id: 'r1',
  name: 'Living room',
  type: 'living',
  source: 'photo',
  photo: photo(),
  hints: [],
  analysisState: 'done',
  raw: rawFromMeasurements({ width: 4, depth: 5, height: 2.5 }),
  ...over,
});

const planRoom = (over: Partial<FlatPlanRoom> = {}): FlatPlanRoom => ({
  key: '0:0',
  floor: 'Ground floor',
  name: 'Living room',
  type: 'living',
  width: 3.75,
  depth: 4.1,
  dimensionsText: '12\'-4" × 13\'-5"',
  ...over,
});

const ref = (over: Partial<DraftPlanRoomRef> = {}): DraftPlanRoomRef => ({ ...planRoomRef(planRoom()), ...over });

/* ---------- 3.4a: the quality gate ---------- */

describe('photo quality gate', () => {
  it('passes a bright, wide, detailed photo with nothing to say', () => {
    const v = photoVerdict(photo());
    expect(v.level).toBe('good');
    expect(v.blocking).toBe(false);
    expect(v.reasons).toEqual([]);
  });

  it('blocks a photo that is too dark to reconstruct', () => {
    const v = photoVerdict(photo({ brightness: 0.15 }));
    expect(v.level).toBe('poor');
    expect(v.blocking).toBe(true);
    expect(v.reasons[0]).toMatch(/too dark/i);
  });

  it('blocks a frame that is mostly black — exposed for the window, not the room', () => {
    const v = photoVerdict(photo({ darkFraction: 0.5 }));
    expect(v.level).toBe('poor');
    expect(v.reasons.join(' ')).toMatch(/black/i);
  });

  it('blocks a frame with nothing in it', () => {
    expect(photoVerdict(photo({ detail: 0.01 })).level).toBe('poor');
  });

  it('warns without blocking on a portrait frame, a dim room and a soft one', () => {
    const portrait = photoVerdict(photo({ width: 960, height: 1280 }));
    expect(portrait.level).toBe('fair');
    expect(portrait.blocking).toBe(false);
    expect(portrait.reasons.join(' ')).toMatch(/sideways/i);
    expect(photoVerdict(photo({ brightness: 0.28 })).level).toBe('fair');
    expect(photoVerdict(photo({ detail: 0.04 })).level).toBe('fair');
    expect(photoVerdict(photo({ brightness: 0.95 })).level).toBe('fair');
    expect(photoVerdict(photo({ width: 320, height: 240 })).level).toBe('fair');
  });

  it('lets the vision model pull a clean photo down to fair, but never to poor', () => {
    const v = photoVerdict(photo(), { quality: 'poor' });
    expect(v.level).toBe('fair');
    expect(v.blocking).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/vision model/i);
    // A clean photo the model merely calls "ok" is fair too, and says why.
    expect(photoVerdict(photo(), { quality: 'ok' }).level).toBe('fair');
    // And a good rating never rescues a dark frame.
    expect(photoVerdict(photo({ brightness: 0.1 }), { quality: 'good' }).level).toBe('poor');
  });

  it('reports the numbers first and the model second', () => {
    const v = photoVerdict(photo({ brightness: 0.1, detail: 0.03 }), { quality: 'poor' });
    expect(v.reasons[0]).toMatch(/too dark/i);
    // The model's opinion is not repeated once the numbers already blocked the photo.
    expect(v.reasons.join(' ')).not.toMatch(/vision model/i);
  });

  it('calls a missing photo poor', () => {
    expect(photoVerdict(undefined).blocking).toBe(true);
  });
});

describe('the gate on a room', () => {
  it('blocks a room with a poor primary photo until it is accepted', () => {
    const bad = draft({ photo: photo({ brightness: 0.12 }) });
    expect(roomIntake(bad).blocked).toBe(true);
    expect(roomIntake(bad).blockReason).toMatch(/too dark/i);
    expect(blockedRooms([bad, draft({ id: 'r2' })]).map((r) => r.id)).toEqual(['r1']);

    const accepted = { ...bad, photoAccepted: true };
    expect(roomIntake(accepted).blocked).toBe(false);
    expect(roomIntake(accepted).accepted).toBe(true);
    expect(blockedRooms([accepted])).toEqual([]);
  });

  it('never blocks a room that has no photograph to retake', () => {
    const typed = draft({ source: 'measured', photo: undefined, measured: { width: 4, depth: 5, height: 2.5 } });
    expect(roomIntake(typed).blocked).toBe(false);
    expect(roomIntake(typed).verdict.headline).toMatch(/no photo needed/i);
    // A browser-drawn demo photo is not a photograph either.
    expect(roomIntake(draft({ synthetic: true, photo: photo({ brightness: 0.05 }) })).blocked).toBe(false);
  });

  it('drops "use anyway" when the primary photo it was about is replaced', () => {
    const room = draft({ photo: photo({ brightness: 0.12 }), photos: [photo()], photoAccepted: true });
    // Removing the primary promotes the second shot: a new photo, so a new decision.
    expect(withoutPhoto(room, 0).photoAccepted).toBeUndefined();
    // Removing an extra angle leaves the primary — and the decision about it — alone.
    expect(withoutPhoto(room, 1).photoAccepted).toBe(true);
  });
});

/* ---------- 3.4b: two to four angles ---------- */

describe('angle guidance', () => {
  it('names the shot that is missing, in order', () => {
    expect(angleState(0).missing[0].key).toBe('corner');
    expect(angleState(1).missing[0].key).toBe('doorway');
    expect(angleState(2).missing[0].key).toBe('opposite');
    expect(angleState(0).text).toMatch(/no photo yet/i);
    expect(angleState(1).text).toMatch(/from the doorway/i);
  });

  it('holds the two-to-four contract', () => {
    expect(MIN_ANGLES).toBe(2);
    expect(RECOMMENDED_ANGLES).toBe(3);
    expect(ANGLE_PLAN).toHaveLength(4);
    expect(angleState(1).enough).toBe(false);
    expect(angleState(2).enough).toBe(true);
    expect(angleState(2).recommended).toBe(false);
    expect(angleState(3).recommended).toBe(true);
    expect(angleState(4).missing).toEqual([]);
    expect(angleState(9).missing).toEqual([]);
  });
});

describe('reconstruction mode', () => {
  it('wants reconstruction from the second photo, and sends it from the second photo', () => {
    expect(wantsReconstruction(1)).toBe(false);
    expect(wantsReconstruction(2)).toBe(true);
    // What the contract asks for and what the request carries are now one number
    // (`MARBLE_RECONSTRUCT_MIN_IMAGES`, shared/marbleLimits.ts), so the launch step cannot promise
    // the seller one thing while the pipeline does another.
    expect(sendsReconstructImages(1)).toBe(false);
    expect(sendsReconstructImages(2)).toBe(true);
    expect(sendsReconstructImages(5)).toBe(true);
    expect(RECONSTRUCT_PIPELINE_THRESHOLD).toBe(RECONSTRUCT_MIN_PHOTOS);
  });

  it('counts multi-angle rooms and says what will happen to them', () => {
    const rooms = [draft({ id: 'a' }), draft({ id: 'b', photos: [photo(), photo()] }), draft({ id: 'c', photos: [photo(), photo(), photo(), photo()] })];
    const s = reconstructionSummary(rooms);
    expect(s.multiAngle).toBe(2);
    // Every multi-angle room is reconstructed now, so none is left in plain multi-image mode.
    expect(s.reconstructed).toBe(2);
    expect(s.plainMultiImage).toBe(0);
    expect(s.text).toMatch(/reconstruct_images/);
    expect(reconstructionSummary([draft()]).text).toMatch(/single photo/i);
  });

  it('marks a room as multi-angle on the intake record', () => {
    expect(roomIntake(draft()).multiAngle).toBe(false);
    expect(roomIntake(draft({ photos: [photo()] })).multiAngle).toBe(true);
  });
});

/* ---------- 3.5a: plan says / photo shows ---------- */

describe('plan / photo confirmation mapping', () => {
  it('maps every state a pairing can be in', () => {
    const rooms = [
      draft({ id: 'unmatched' }),
      draft({ id: 'nodims', planRoom: ref({ key: '0:1', name: 'Hall', width: undefined, depth: undefined, text: undefined }) }),
      draft({ id: 'pending', planRoom: ref() }),
      draft({ id: 'done', planRoom: ref({ key: '0:2' }), planConfirmed: true }),
    ];
    expect(planPhotoRows(rooms).map((r) => r.state)).toEqual(['unmatched', 'no-dimensions', 'unconfirmed', 'confirmed']);
    expect(unconfirmedRows(rooms).map((r) => r.roomId)).toEqual(['pending']);
  });

  it('carries the plan dimensions, the plan room name and the matched photo thumbnail', () => {
    const row = planPhotoRows([draft({ photos: [photo()], planRoom: ref() })])[0];
    expect(row.planRoomName).toBe('Living room');
    expect(row.planFloor).toBe('Ground floor');
    expect(row.planDims).toMatchObject({ width: 3.75, depth: 4.1, planRoomName: 'Living room', floor: 'Ground floor' });
    expect(row.thumbnail).toBe(photo().dataUrl);
    expect(row.planLine).toBe('Plan says 3.75 × 4.10 m (printed 12\'-4" × 13\'-5")');
    expect(row.photoLine).toBe('Photo shows Living room · 2 angles');
  });

  it('says so plainly when there is no plan room, no dimensions or no photo', () => {
    const [unmatched, nodims, typed] = planPhotoRows([
      draft({ id: 'a' }),
      draft({ id: 'b', planRoom: ref({ width: undefined, depth: undefined, text: undefined }) }),
      draft({ id: 'c', source: 'measured', photo: undefined, measured: { width: 2.5, depth: 3, height: 2.4 } }),
    ]);
    expect(unmatched.planLine).toMatch(/not on the floor plan/i);
    expect(nodims.planLine).toMatch(/printed no dimensions/i);
    expect(typed.photoLine).toBe('Typed 2.50 × 3.00 m');
  });

  it('lists the plan rooms nothing has been matched to', () => {
    const plan = [planRoom(), planRoom({ key: '0:1', name: 'Kitchen', type: 'kitchen' })];
    expect(unusedPlanRooms([draft({ planRoom: ref() })], plan).map((p) => p.name)).toEqual(['Kitchen']);
    expect(unusedPlanRooms([], plan)).toHaveLength(2);
  });

  it('asks the question again when the room is re-mapped, and not when it is not', () => {
    const confirmed = draft({ planRoom: ref(), planConfirmed: true });
    // Same plan room (a re-parse, a name edit): the answer still stands.
    expect(withPlanRoom(confirmed, ref()).planConfirmed).toBe(true);
    // A different plan room is a different pairing.
    expect(withPlanRoom(confirmed, ref({ key: '0:9', name: 'Kitchen' })).planConfirmed).toBeUndefined();
    // Unmatching drops it entirely.
    expect(withPlanRoom(confirmed, undefined).planConfirmed).toBeUndefined();
  });

  it('suggests the plan room a photo most looks like, and never a taken one', () => {
    const plan = [planRoom({ key: '0:0', name: 'Living room' }), planRoom({ key: '0:1', name: 'Kitchen', type: 'kitchen' })];
    expect(suggestPlanRoom(draft({ name: 'Living Room' }), plan)?.key).toBe('0:0');
    expect(suggestPlanRoom(draft({ name: 'Kitchen', type: 'kitchen' }), plan)?.key).toBe('0:1');
    expect(suggestPlanRoom(draft({ name: 'Living room' }), plan, new Set(['0:0']))?.key).not.toBe('0:0');
    expect(suggestPlanRoom(draft({ name: 'IMG 4471', type: 'other' }), plan)).toBeUndefined();
    expect(nameScore('Living room', 'living  ROOM')).toBe(1);
    expect(nameScore('Bedroom 2', 'Bedroom')).toBeGreaterThan(0.5);
    expect(nameScore('Kitchen', 'Bathroom')).toBe(0);
  });
});

/* ---------- 3.5b: tier and model policy ---------- */

describe('model choice', () => {
  it('sends every room to the draft model at draft quality', () => {
    const huge = draft({ planRoom: ref({ width: 8, depth: 9 }) });
    expect(modelForRoom(huge, 'draft').model).toBe(DRAFT_MODEL);
    expect(modelForRoom(huge, 'draft').reason).toBeUndefined();
    expect(modelForRoom(huge, 'draft').text).toMatch(/no metric scale/i);
  });

  it('uses the standard full model for an ordinary room', () => {
    const room = draft({ planRoom: ref({ width: 3.75, depth: 4.1 }) }); // 15.4 m²
    expect(modelForRoom(room, 'full').model).toBe(FULL_MODEL);
    expect(plusReason(room)).toBeUndefined();
  });

  it('sends a room over 30 m² of printed floor to marble-1.1-plus', () => {
    const big = draft({ planRoom: ref({ width: 6, depth: 6 }) }); // 36 m²
    expect(plusReason(big)).toBe('area');
    const choice = modelForRoom(big, 'full');
    expect(choice.model).toBe(FULL_PLUS_MODEL);
    expect(choice.text).toContain(`${PLUS_AREA_M2} m²`);
    // Exactly at the threshold is not over it.
    expect(plusReason(draft({ planRoom: ref({ width: 5, depth: 6 }) }))).toBeUndefined();
    expect(plusReason(draft({ planRoom: ref({ width: 5, depth: 6.1 }) }))).toBe('area');
  });

  it('sends an open-plan room to marble-1.1-plus however small the plan says it is', () => {
    const studio = draft({ type: 'studio', planRoom: ref({ width: 3, depth: 3 }) });
    expect(isOpenPlan(studio)).toBe(true);
    expect(modelForRoom(studio, 'full')).toMatchObject({ model: FULL_PLUS_MODEL, reason: 'open-plan' });

    for (const name of ['Open plan kitchen', 'Kitchen / dining', 'Great room', 'Living and dining', 'open-concept lounge']) {
      expect(isOpenPlan(draft({ name }))).toBe(true);
    }
    expect(isOpenPlan(draft({ name: 'Bedroom 2', type: 'bedroom' }))).toBe(false);
  });

  it('reads the area off the plan, never off the room’s own guess', () => {
    // A 36 m² *reconstruction estimate* with no plan dimensions must not pick the bigger model:
    // the estimate is exactly what we have not measured yet.
    const guessed = draft({ raw: rawFromMeasurements({ width: 6, depth: 6, height: 2.5 }) });
    expect(plusReason(guessed)).toBeUndefined();
    expect(modelForRoom(guessed, 'full').model).toBe(FULL_MODEL);
  });

  it('prefers the model ids the server reported over the defaults', () => {
    const models = { marbleDraft: 'marble-1.0-draft-next', marbleFull: 'marble-1.2' };
    expect(modelForRoom(draft(), 'draft', models).model).toBe('marble-1.0-draft-next');
    expect(modelForRoom(draft(), 'full', models).model).toBe('marble-1.2');
    // The plus model is our routing decision, so a server default does not override it.
    expect(modelForRoom(draft({ type: 'studio' }), 'full', models).model).toBe(FULL_PLUS_MODEL);
  });
});

describe('tier plan and cost', () => {
  const rooms = [
    draft({ id: 'a' }),
    draft({ id: 'b', type: 'studio' }),
    draft({ id: 'c', source: 'measured', photo: undefined, measured: { width: 3, depth: 3, height: 2.4 } }),
    draft({ id: 'd', synthetic: true }),
  ];

  it('costs only the rooms that can really reach Marble, and names every model', () => {
    const full = tierPlan(rooms, 'full');
    expect(full.liveRooms).toBe(2);
    expect(full.simulatedRooms).toBe(2);
    expect(full.plusRooms).toBe(1);
    expect(full.models).toEqual([FULL_MODEL, FULL_PLUS_MODEL]);
    expect(full.credits).toBe(1580 * 2);
    expect(full.usd).toBeCloseTo(2.52, 2);
  });

  it('charges nothing when the whole run is simulated', () => {
    const sim = tierPlan(rooms, 'full', { live: false });
    expect(sim.liveRooms).toBe(0);
    expect(sim.credits).toBe(0);
    expect(sim.usd).toBe(0);
    expect(sim.models).toEqual([]);
    // Every room still gets a row, so the launch list can show what each one would be.
    expect(sim.rows).toHaveLength(4);
    expect(sim.rows.every((r) => r.choice.model.length > 0)).toBe(true);
  });

  it('prices a draft run at the draft rate with one model', () => {
    const d = tierPlan(rooms, 'draft');
    expect(d.credits).toBe(230 * 2);
    expect(d.models).toEqual([DRAFT_MODEL]);
    expect(d.plusRooms).toBe(0);
  });
});

describe('the launch summary', () => {
  it('adds up what the wizard still owes the model', () => {
    const s = intakeSummary([
      draft({ id: 'ok', photos: [photo(), photo()] }),
      draft({ id: 'dark', photo: photo({ brightness: 0.1 }) }),
      draft({ id: 'accepted', photo: photo({ brightness: 0.1 }), photoAccepted: true }),
      draft({ id: 'pending', planRoom: ref() }),
    ]);
    expect(s.rooms).toBe(4);
    expect(s.photoRooms).toBe(4);
    expect(s.blocked.map((r) => r.id)).toEqual(['dark']);
    expect(s.accepted.map((r) => r.id)).toEqual(['accepted']);
    expect(s.thin.map((r) => r.id)).toEqual(['dark', 'accepted', 'pending']);
    expect(s.unconfirmed.map((r) => r.roomId)).toEqual(['pending']);
    expect(s.reconstruction.multiAngle).toBe(1);
  });
});

/* ---------- 3.7: staging deferred ---------- */

describe('stagingEnabled hides the entry points', () => {
  it('is off unless a setting says otherwise', () => {
    expect(stagingEnabled(undefined)).toBe(false);
    expect(stagingEnabled(null)).toBe(false);
    expect(stagingEnabled({})).toBe(false);
    expect(stagingEnabled({ stagingEnabled: false })).toBe(false);
    expect(stagingEnabled({ stagingEnabled: true })).toBe(true);
  });

  it('hides every named surface while it is off, and none of them while it is on', () => {
    expect(hiddenStagingSurfaces()).toEqual(STAGING_SURFACES);
    expect(hiddenStagingSurfaces({ stagingEnabled: true })).toEqual([]);
    for (const surface of STAGING_SURFACES) {
      expect(showsStaging({ stagingEnabled: false }, surface)).toBe(false);
      expect(showsStaging({ stagingEnabled: true }, surface)).toBe(true);
    }
    // The list is the contract: the Stage tab, auto-stage, the editor, the buyer's furniture test
    // and the staging layer in the scene.
    expect(STAGING_SURFACES).toEqual(['stage-tab', 'auto-stage', 'editor', 'furniture-test', 'staging-layer']);
  });

  it('drops the Stage tab from the hub and never leaves the user on it', () => {
    const tabs = ['tour', 'stage', 'publish', 'insights'] as const;
    expect(visibleTabs(tabs)).toEqual(['tour', 'publish', 'insights']);
    expect(visibleTabs(tabs, { stagingEnabled: true })).toEqual([...tabs]);
    // A link straight to ?tab=stage lands on the first visible tab instead of a blank one.
    expect(resolveTab('stage', tabs)).toBe('tour');
    expect(resolveTab('stage', tabs, { stagingEnabled: true })).toBe('stage');
    expect(resolveTab('publish', tabs)).toBe('publish');
    expect(resolveTab(null, tabs)).toBe('tour');
  });
});

/* ---------- the hub's accuracy card ---------- */

const residual = (source: FusionResidual['source'], expected: number, measured: number, sigma = 0.05): FusionResidual => ({
  source,
  label: source,
  unit: 'm',
  expected,
  measured,
  residual: measured - expected,
  sigma,
  sigmas: Math.abs(measured - expected) / sigma,
  scale: 1,
});

/** Scale 1 so the raw room *is* the measured room: the grading is what is under test here. */
const measurement = (over: Partial<FusionResult> = {}): FusionResult => ({
  scale: 1,
  sigma: 0.01,
  sigmaRel: 0.01,
  confidence: 0.86,
  // A plan, an anchor and a ceiling would be three; this fixture stands in for a corroborated room.
  independentSources: 3,
  residuals: [residual('plan-width', 3.75, 3.6), residual('plan-depth', 4.0, 4.5), residual('ceiling', 2.44, 2.6)],
  flags: [],
  ...over,
});

const measured = (over: Partial<MeasurableRoom> = {}): MeasurableRoom => ({
  id: 'room',
  name: 'Living room',
  raw: rawFromMeasurements({ width: 3.6, depth: 4.5, height: 2.6 }),
  planDims: { width: 3.75, depth: 4.0, text: '12\'-4" × 13\'-1"' },
  measurement: measurement(),
  ...over,
});

describe('roomAccuracy', () => {
  it('grades each dimension against the targets in docs/ACCURACY.md section 1', () => {
    const a = roomAccuracy(measured());
    expect(a.measured).toBe(true);
    expect(a.lines.map((l) => [l.dimension, l.level])).toEqual([
      ['width', 'ok'], // 0.15 m on 3.75 m = 4.0 %, inside 5 %
      ['depth', 'bad'], // 0.50 m on 4.00 m = 12.5 %, outside 10 %
      ['height', 'warn'], // 16 cm, outside the 10 cm ceiling target
    ]);
    expect(a.lines[0].errorPct).toBeCloseTo(4, 5);
    expect(a.worst?.dimension).toBe('depth');
    expect(a.lines[0].text).toBe('Plan says 3.75 m · model measures 3.60 m (−0.15 m)');
    expect(a.confidenceLabel).toBe('high');
  });

  it('says a room is unmeasured rather than showing its anchored numbers as a measurement', () => {
    const a = roomAccuracy(measured({ measurement: undefined }));
    expect(a.measured).toBe(false);
    expect(a.lines).toEqual([]);
    expect(a.confidence).toBe(0);
    expect(a.confidenceLabel).toBe('unmeasured');
    expect(a.confidenceText).toMatch(/not been measured/i);
  });

  it('passes fusion’s own flags through untouched', () => {
    const a = roomAccuracy(measured({ measurement: measurement({ flags: ['plan width says 3.75 m, the model measures 3.41 m'] }) }));
    expect(a.flags).toEqual(['plan width says 3.75 m, the model measures 3.41 m']);
  });

  it('measures against the collider’s own raw room when the room has a world', () => {
    const world: RoomWorld = {
      provider: 'marble',
      tier: 'full',
      worldId: 'w1',
      model: 'marble-1.1',
      createdAt: 1_700_000_000_000,
      raw: rawFromMeasurements({ width: 7.5, depth: 8, height: 5 }),
    };
    // Scale 0.5 m/unit over a 7.5-unit wall lands exactly on the plan's 3.75 m.
    const a = roomAccuracy(measured({ full: world, measurement: measurement({ scale: 0.5, residuals: [residual('plan-width', 3.75, 3.75)] }) }));
    expect(a.lines[0].measured).toBe(3.75);
    expect(a.lines[0].level).toBe('ok');
    expect(a.model).toBe('marble-1.1');
    expect(a.tier).toBe('full');
    expect(a.modelDate).toBe(1_700_000_000_000);
    // Depth had no source, so it is reported without a verdict rather than graded against nothing.
    expect(a.lines[1].level).toBe('unknown');
    expect(a.lines[1].text).toBe('Model measures 4.00 m');
  });

  it('grades a real fusion result end to end', () => {
    // A 5 × 6 × 3.5 raw room whose plan says 3.75 × 4.50 m: both sources agree on 0.75 m/unit.
    const f = fuseScale({ raw: { width: 5, depth: 6, height: 3.5 }, plan: { width: 3.75, depth: 4.5 } });
    expect(f.scale).toBeCloseTo(0.75, 6);
    expect(f.flags).toEqual([]);
    const a = roomAccuracy(measured({ raw: rawFromMeasurements({ width: 5, depth: 6, height: 3.5 }), measurement: f }));
    expect(a.lines[0].measured).toBeCloseTo(3.75, 2);
    expect(a.lines.slice(0, 2).every((l) => l.level === 'ok')).toBe(true);
    expect(a.worst?.errorPct).toBeLessThan(DIMENSION_OK_PCT);
  });
});

describe('confidence, tolerance and the unit’s row', () => {
  it('labels a confidence the way the card prints it', () => {
    // Never measured and measured-but-contradicted are different facts, so they are different words:
    // "unmeasured confidence · ±0.6%" over three dimension lines said the opposite of what it showed.
    expect(confidenceLabel(undefined)).toBe('unmeasured');
    expect(confidenceLabel(0)).toBe('none');
    expect(confidenceLabel(0.2)).toBe('low');
    expect(confidenceLabel(0.5)).toBe('good');
    expect(confidenceLabel(0.95)).toBe('high');
    expect(CONFIDENCE_CHIP.none).toBe('no confidence');
    expect(CONFIDENCE_CHIP.unmeasured).toBe('not measured');
  });

  it('calls a measured room with confidence 0 contradicted, not unmeasured', () => {
    // The common case: `measureRoom` forces confidence 0 whenever the collider is not one room, and
    // the card still has a full set of dimensions to show beside the chip.
    const a = roomAccuracy(measured({ measurement: measurement({ confidence: 0 }) }));
    expect(a.measured).toBe(true);
    expect(a.confidenceLabel).toBe('none');
    expect(a.confidenceChip).toBe('no confidence');
    expect(a.lines).toHaveLength(3);
  });

  it('names the one source holding a room up when nothing can check it', () => {
    const a = roomAccuracy(measured({ measurement: measurement({ independentSources: 1 }) }));
    expect(a.independentSources).toBe(1);
    expect(a.confidenceText).toMatch(/plan is the only measurement/i);
  });

  it('grades the ceiling in centimetres, not per cent', () => {
    const line = (delta: number) => gradeLine({ dimension: 'height', measured: 2.44 + delta, expected: 2.44, delta, text: '' });
    expect(line(CEILING_OK_M).level).toBe('ok');
    expect(line(0.11).level).toBe('warn');
    expect(line(-0.25).level).toBe('bad');
    // …and prints them that way, so the badge cannot be read against the 5 % dimension target.
    expect(line(0.11).errorText).toBe('11 cm');
    expect(gradeLine({ dimension: 'width', measured: 3.6, expected: 3.75, delta: -0.15, text: '' }).errorText).toBe('4.0%');
    // A dimension nothing constrains has no verdict at all.
    expect(gradeLine({ dimension: 'width', measured: 3.6, text: '' }).level).toBe('unknown');
  });

  it('keeps the ceiling out of the room’s worst-dimension verdict', () => {
    // 0.4 % on width and depth, with a real 3.0 m ceiling read against the assumed 2.44 m. The
    // ceiling is 23 % in per cent terms and used to make this room "over 10 %" on its own.
    const lines = [
      residual('plan-width', 5.0, 5.02),
      residual('plan-depth', 4.0, 4.03),
      residual('ceiling', 2.44, 3.0),
    ];
    const room = measured({
      planDims: { width: 5.0, depth: 4.0 },
      raw: rawFromMeasurements({ width: 5.02, depth: 4.03, height: 3.0 }),
      measurement: measurement({ residuals: lines }),
    });
    const a = roomAccuracy(room);
    expect(a.worst?.dimension).toBe('depth');
    expect(a.worst?.errorPct).toBeLessThan(DIMENSION_OK_PCT);
    expect(a.worstCeiling?.level).toBe('bad');
    const t = tourAccuracy([room]);
    expect(t.overLimit).toBe(0);
    expect(t.withinTarget).toBe(1);
    // It is not silent about the ceiling, it just counts it in centimetres and in its own column.
    expect(t.ceilingOff).toBe(1);
    expect(t.text).toMatch(/1 ceiling over 10 cm/);
  });

  it('sums the unit the way docs/ACCURACY.md section 1 asks for', () => {
    const t = tourAccuracy([measured({ id: 'a' }), measured({ id: 'b', measurement: undefined })]);
    expect(t.rooms).toBe(2);
    expect(t.measured).toBe(1);
    expect(t.medianErrorPct).toBeCloseTo(8.25, 5); // median of 4.0 % and 12.5 %
    expect(t.worstErrorPct).toBeCloseTo(12.5, 5);
    expect(t.overLimit).toBe(1);
    expect(t.text).toMatch(/1 of 2 rooms measured/);
    expect(tourAccuracy([]).text).toBe('No rooms yet.');
  });

  it('has a median that does not mutate its input', () => {
    const xs = [3, 1, 2];
    expect(median(xs)).toBe(2);
    expect(xs).toEqual([3, 1, 2]);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });

  it('leads a room with its measurements, its plan and its model date', () => {
    const world: RoomWorld = { provider: 'marble', tier: 'full', worldId: 'w', model: 'marble-1.1', createdAt: 42, raw: rawFromMeasurements({ width: 3.6, depth: 4.5, height: 2.6 }) };
    const lead = roomLead({
      ...measured({ full: world }),
      geometry: { width: 3.6, depth: 4.5, height: 2.6, door: { wall: 'south', offset: 1, width: 0.9, height: 2.03 }, windows: [] },
    });
    expect(lead.dimensions).toBe('3.60 × 4.50 × 2.60 m');
    expect(lead.area).toBe('16.2 m²');
    expect(lead.plan).toBe('3.75 × 4.00 m (12\'-4" × 13\'-1")');
    expect(lead.model).toBe('marble-1.1 · full');
    expect(lead.modelDate).toBe(42);
    expect(lead.measurement).toBe('measured · high confidence');
  });
});
