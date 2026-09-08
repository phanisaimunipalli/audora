/**
 * Intake that earns accuracy — docs/ACCURACY.md section 3.4 and 3.5, as pure functions.
 *
 * The reconstruction can only be as true as what it was given. This module is the policy for what
 * "given enough" means, kept out of the components so it can be tested without a DOM:
 *
 * - **Angles.** Two to four shots per room (a corner, the doorway, the opposite corner). One photo
 *   is the floor of the product; the third is where a room stops guessing at its far wall.
 * - **A quality gate.** The numbers `preparePhoto` already measured (brightness, darkFraction,
 *   detail, aspect) plus the vision model's own `quality` become one verdict. A *poor* primary
 *   photo blocks the room until it is retaken or the seller explicitly says "use anyway" — an
 *   accepted bad photo is a decision on the record, not a silent downgrade.
 * - **Plan says / photo shows.** The mapping between the rooms the plan produced and the photos the
 *   seller uploaded, with the state of each pairing, so the confirmation row has nothing to decide.
 * - **Tier policy.** Which Marble model a room should be reconstructed with, and what it costs.
 *
 * Conventions: pure and deterministic (no clock, no randomness, no I/O), thresholds named as
 * constants with the reason beside them, and every verdict carries the sentence a seller reads.
 */
import type { RoomType } from '@/engine/types';
import { MARBLE_RECONSTRUCT_MIN_IMAGES, reconstructsImages } from '@shared/marbleLimits';
import type { PhotoAnalysis, PlanDimensions, Tier } from '@/state/types';
import type { FlatPlanRoom } from '@/services/floorplan';
import { TIER_INFO } from '@/services/mockWorld';
import { DRAFT_MODEL, FULL_MODEL } from '@/state/publish';
import { draftGeometry, draftPhotos, planDimensionsOf, type DraftPhoto, type DraftRoom } from './types';

/* ---------- 3.4a: two to four angles per room ---------- */

/** One of the shots a room is asked for, in the order they are asked for. */
export interface AngleSlot {
  key: 'corner' | 'doorway' | 'opposite' | 'extra';
  label: string;
  /** What to do, said as an instruction the seller can follow standing in the room. */
  hint: string;
}

/**
 * The shots a room wants, in order. The first three are the ones docs/ACCURACY.md names; the fourth
 * is a bonus, not a requirement, which is why the ask is "two to four" and not "four".
 */
export const ANGLE_PLAN: AngleSlot[] = [
  { key: 'corner', label: 'From a corner', hint: 'Stand in one corner, phone sideways, and get the opposite corner in shot.' },
  { key: 'doorway', label: 'From the doorway', hint: 'Back into the doorway and shoot straight down the room.' },
  { key: 'opposite', label: 'From the opposite corner', hint: 'Cross to the far corner and shoot back. This is the shot that fixes the far wall.' },
  { key: 'extra', label: 'One more angle', hint: 'Optional. A window wall or an alcove the other three missed.' },
];

/** Fewer than this and the room is reconstructed from a single view: no parallax, no depth. */
export const MIN_ANGLES = 2;
/** The three named shots. A room with these is what the accuracy targets were written against. */
export const RECOMMENDED_ANGLES = 3;
/** Past this the guidance stops asking; `MAX_ROOM_PHOTOS` is still the hard cap. */
export const GUIDED_ANGLES = ANGLE_PLAN.length;

export interface AngleState {
  have: number;
  /** The slots still unfilled, in order. Empty once `GUIDED_ANGLES` shots are in. */
  missing: AngleSlot[];
  /** At least `MIN_ANGLES`. */
  enough: boolean;
  /** At least `RECOMMENDED_ANGLES`. */
  recommended: boolean;
  /** The sentence the card shows under the thumbnails. */
  text: string;
}

export function angleState(have: number): AngleState {
  const n = Math.max(0, Math.floor(have));
  const missing = ANGLE_PLAN.slice(Math.min(n, GUIDED_ANGLES));
  const enough = n >= MIN_ANGLES;
  const recommended = n >= RECOMMENDED_ANGLES;
  const text =
    n === 0
      ? `No photo yet. ${ANGLE_PLAN[0].hint}`
      : recommended
        ? `${n} angles. Enough for the model to triangulate the room.`
        : `${n} angle${n === 1 ? '' : 's'}. Next: ${missing[0].label.toLowerCase()} — ${missing[0].hint}`;
  return { have: n, missing, enough, recommended, text };
}

/* ---------- 3.4b: the quality gate ---------- */

/**
 * Thresholds. `brightness`, `darkFraction` and `detail` are the 0..1 signals `preparePhoto`
 * computes off a 96 px copy of the image (src/lib/image.ts), so they are comparable between photos
 * and independent of the file's size.
 */
export const QUALITY = {
  /** Below this the frame is night, not a room; Marble reconstructs noise. */
  darkBrightness: 0.22,
  /** Below this it is merely dim: the room comes back, muddier. */
  dimBrightness: 0.32,
  /** Above this the frame is blown out and the walls have no texture to match. */
  blownBrightness: 0.9,
  /** More of the frame than this is near black: a lit window with a black room around it. */
  darkFraction: 0.35,
  /** Edge density. Below this there is nothing in shot to reconstruct from. */
  flatDetail: 0.025,
  /** Below this the frame is thin — a blank wall, or motion blur. */
  softDetail: 0.05,
  /** A portrait frame cannot hold the far corner; the ask is the phone turned sideways. */
  minAspect: 1.1,
  /** Below this many pixels on the short edge the upload was a thumbnail, not a photograph. */
  minShortEdge: 480,
} as const;

export type QualityLevel = 'good' | 'fair' | 'poor';

export interface PhotoVerdict {
  level: QualityLevel;
  /** One line, shown on the chip. */
  headline: string;
  /** Every reason that fired, worst first. Empty for a clean photo. */
  reasons: string[];
  /** True when this photo must be retaken or explicitly accepted before the room can be generated. */
  blocking: boolean;
}

/** The numbers the gate reads. Both `PhotoRecord` and `LoadedPhoto` satisfy it. */
export interface PhotoNumbers {
  width: number;
  height: number;
  brightness: number;
  darkFraction: number;
  detail: number;
}

const HEADLINE: Record<QualityLevel, string> = {
  good: 'Good photo',
  fair: 'Usable, not ideal',
  poor: 'Too poor to reconstruct',
};

/**
 * The verdict on one photo. Deterministic in its inputs and ordered worst-reason-first, so the chip
 * and the retake prompt always name the same problem.
 *
 * The vision model's own `quality` is folded in but never on its own: it can call a perfectly bright
 * room "poor" because it is cluttered, which is a staging problem and not a reconstruction one. It
 * can only pull the verdict down one step, never past what the numbers say.
 */
export function photoVerdict(photo: PhotoNumbers | undefined, analysis?: Pick<PhotoAnalysis, 'quality'> | undefined): PhotoVerdict {
  if (!photo) return { level: 'poor', headline: 'No photo', reasons: ['This room has no photograph, so it can only be simulated.'], blocking: true };
  const bad: string[] = [];
  const meh: string[] = [];

  if (photo.brightness < QUALITY.darkBrightness) bad.push('Too dark to reconstruct. Open the blinds or turn the lights on.');
  else if (photo.brightness < QUALITY.dimBrightness) meh.push('A little dark. More light gives cleaner walls.');
  if (photo.brightness > QUALITY.blownBrightness) meh.push('Blown out. The walls have no texture left to match between shots.');
  if (photo.darkFraction > QUALITY.darkFraction) bad.push('More than a third of the frame is black. Expose for the room, not for the window.');
  if (photo.detail < QUALITY.flatDetail) bad.push('Almost nothing in frame. Step back so two walls and the floor are in shot.');
  else if (photo.detail < QUALITY.softDetail) meh.push('Very little detail. Blank walls give the model less to work with.');
  const aspect = photo.height > 0 ? photo.width / photo.height : 0;
  if (aspect < QUALITY.minAspect) meh.push('Turn the phone sideways. A wide frame gets the far corner in shot.');
  if (Math.min(photo.width, photo.height) < QUALITY.minShortEdge) meh.push('Small image. A full-size photo carries more for the model to match.');

  // The model gets a vote, and only a vote: it can make a clean photo "fair", never "poor".
  if (analysis?.quality === 'poor' && !bad.length) meh.push('The vision model rated this photo poor for reconstruction.');
  else if (analysis?.quality === 'ok' && !bad.length && !meh.length) meh.push('The vision model rated this photo usable rather than good.');

  const level: QualityLevel = bad.length ? 'poor' : meh.length ? 'fair' : 'good';
  const reasons = [...bad, ...meh];
  return {
    level,
    headline: HEADLINE[level],
    reasons: level === 'good' ? [] : reasons,
    blocking: level === 'poor',
  };
}

/* ---------- the room's intake state ---------- */

export interface RoomIntake {
  id: string;
  name: string;
  photos: number;
  /** The verdict on the *primary* photo — the one the anchor is tapped on. */
  verdict: PhotoVerdict;
  angles: AngleState;
  /** The seller pressed "use anyway"; the room may be generated with a poor photo. */
  accepted: boolean;
  /** Blocks Continue: a poor primary photo that has not been accepted. */
  blocked: boolean;
  /** Why it is blocked, or undefined. */
  blockReason?: string;
  /** More than one photo, so the room wants Marble's reconstruction mode. */
  multiAngle: boolean;
}

/**
 * A room read off by the gate. Rooms with no photograph at all (typed from a tape, or read straight
 * off the plan) are never blocked: they are metric by construction and always simulated, so there is
 * no photo to retake.
 */
export function roomIntake(room: DraftRoom): RoomIntake {
  const photos = draftPhotos(room);
  const typed = !room.photo;
  const verdict = typed
    ? { level: 'good' as const, headline: 'No photo needed', reasons: [], blocking: false }
    : room.synthetic
      ? { level: 'good' as const, headline: 'Demo photo', reasons: [], blocking: false }
      : photoVerdict(room.photo, room.analysis);
  const accepted = room.photoAccepted === true;
  const blocked = verdict.blocking && !accepted;
  return {
    id: room.id,
    name: room.name,
    photos: photos.length,
    verdict,
    angles: angleState(photos.length),
    accepted,
    blocked,
    blockReason: blocked ? verdict.reasons[0] : undefined,
    multiAngle: photos.length > 1,
  };
}

/** Every room the gate is holding back. Empty means the Rooms step can continue. */
export function blockedRooms(rooms: DraftRoom[]): RoomIntake[] {
  return rooms.map(roomIntake).filter((r) => r.blocked);
}

/** Rooms with a photo that is usable but not good, and that the seller has not already accepted. */
export function warnedRooms(rooms: DraftRoom[]): RoomIntake[] {
  return rooms.map(roomIntake).filter((r) => !r.blocked && r.verdict.level === 'fair');
}

/** Rooms that have fewer than the two angles docs/ACCURACY.md asks for. */
export function thinRooms(rooms: DraftRoom[]): RoomIntake[] {
  return rooms.map(roomIntake).filter((r) => r.photos > 0 && !r.angles.enough);
}

/* ---------- 3.4c: reconstruction mode ---------- */

/**
 * The contract (docs/ACCURACY.md 3.4): a room with more than one photo should be reconstructed from
 * its photos rather than generated from one of them.
 */
export const RECONSTRUCT_MIN_PHOTOS = 2;

/**
 * The pipeline's own threshold, which is now the same number: `shared/marbleLimits.ts` is the one
 * copy the browser recipe, the server recipe and the Marble request all read, so what the launch
 * step promises and what the request carries cannot disagree.
 */
export const RECONSTRUCT_PIPELINE_THRESHOLD = MARBLE_RECONSTRUCT_MIN_IMAGES;

/** The room has more than one angle, so it *should* be reconstructed rather than generated. */
export const wantsReconstruction = (photos: number): boolean => photos >= RECONSTRUCT_MIN_PHOTOS;

/** The request this room will actually carry `reconstruct_images: true` on. Now the same rule. */
export const sendsReconstructImages = (photos: number): boolean => reconstructsImages(photos);

export interface ReconstructionSummary {
  /** Rooms with two or more angles. */
  multiAngle: number;
  /** Of those, the ones whose request really sets `reconstruct_images`. */
  reconstructed: number;
  /** Rooms with two to four angles: more than one view, but generated in plain multi-image mode. */
  plainMultiImage: number;
  text: string;
}

export function reconstructionSummary(rooms: DraftRoom[]): ReconstructionSummary {
  const counts = rooms.map((r) => draftPhotos(r).length);
  const multiAngle = counts.filter(wantsReconstruction).length;
  const reconstructed = counts.filter(sendsReconstructImages).length;
  const plainMultiImage = multiAngle - reconstructed;
  const text = !multiAngle
    ? 'Every room has a single photo, so every room is generated from one view. A second angle is the cheapest accuracy you can buy.'
    : `${reconstructed} room${reconstructed === 1 ? '' : 's'} go up in reconstruction mode (reconstruct_images), which uses the angles as views of one room rather than as prompts.`;
  return { multiAngle, reconstructed, plainMultiImage, text };
}

/* ---------- 3.5: tier policy ---------- */

/** The model a large or open-plan room needs: more capacity, same tier, same price band. */
export const FULL_PLUS_MODEL = 'marble-1.1-plus';

/** Past this much floor a single `marble-1.1` reconstruction starts losing the far end of the room. */
export const PLUS_AREA_M2 = 30;

/** A room type that is one open volume rather than a box with a door. */
export const OPEN_PLAN_TYPES: RoomType[] = ['studio'];

/** Names a draughtsman gives to one room that is really two or three. */
const OPEN_PLAN_NAME = /open[\s-]?plan|open[\s-]?concept|great\s?room|living[\s/-]*(?:and\s+)?(?:dining|kitchen)|kitchen[\s/-]*(?:and\s+)?(?:dining|living)|dining[\s/-]*(?:and\s+)?living|kitchen\s*diner|l-?shaped/i;

/** Floor area in m², from the plan when it printed dimensions and from the room's own numbers otherwise. */
export function roomArea(room: DraftRoom): number {
  const plan = planDimensionsOf(room.planRoom);
  if (plan) return plan.width * plan.depth;
  const g = draftGeometry(room);
  return g.width * g.depth;
}

/** The area the *plan* asserts, or undefined when the plan printed none. Only this drives the tier. */
export function planArea(room: DraftRoom): number | undefined {
  const plan = planDimensionsOf(room.planRoom);
  return plan ? plan.width * plan.depth : undefined;
}

export function isOpenPlan(room: DraftRoom): boolean {
  return isOpenPlanRoom({ name: room.name, type: room.type, planRoomName: room.planRoom?.name });
}

export type PlusReason = 'area' | 'open-plan';

/**
 * The only facts the tier rule reads.
 *
 * Stated structurally because the rule has two callers with different room shapes: the wizard's
 * `DraftRoom` (which carries a whole parsed `planRoom`) and the persisted `Room` the job runner
 * enqueues (which carries `planDims`). One rule, two adapters, so the model the launch step *shows*
 * is provably the model the generation *asks for*.
 */
export interface ModelRoom {
  name: string;
  type: RoomType;
  /** The plan's own name for this room, when it was matched to one. */
  planRoomName?: string;
  /** The plan's printed dimensions in metres, when it printed any. */
  planWidthM?: number;
  planDepthM?: number;
}

function isOpenPlanRoom(room: ModelRoom): boolean {
  if (OPEN_PLAN_TYPES.includes(room.type)) return true;
  return OPEN_PLAN_NAME.test(room.name) || OPEN_PLAN_NAME.test(room.planRoomName ?? '');
}

/**
 * Why this room needs `marble-1.1-plus`, or undefined when plain full quality is enough.
 *
 * The area test reads the **plan's** dimensions, not the room's own: a room's own numbers come from
 * the reconstruction we have not run yet, so using them would let a bad guess pick the model. With
 * no plan dimensions the type and the name still decide.
 */
export function plusReasonOf(room: ModelRoom): PlusReason | undefined {
  if (isOpenPlanRoom(room)) return 'open-plan';
  const area = room.planWidthM != null && room.planDepthM != null ? room.planWidthM * room.planDepthM : undefined;
  return area != null && area > PLUS_AREA_M2 ? 'area' : undefined;
}

export function plusReason(room: DraftRoom): PlusReason | undefined {
  return plusReasonOf(modelRoomOfDraft(room));
}

/** The wizard's room, as the tier rule sees it. */
function modelRoomOfDraft(room: DraftRoom): ModelRoom {
  const plan = planDimensionsOf(room.planRoom);
  return { name: room.name, type: room.type, planRoomName: room.planRoom?.name, planWidthM: plan?.width, planDepthM: plan?.depth };
}

/**
 * A persisted room, as the tier rule sees it — the adapter `src/state/jobs.ts` uses so a queued
 * generation asks for the same model the launch step priced and named.
 */
export function modelRoomOf(room: { name: string; type: RoomType; planDims?: { width: number; depth: number; planRoomName?: string } }): ModelRoom {
  return { name: room.name, type: room.type, planRoomName: room.planDims?.planRoomName, planWidthM: room.planDims?.width, planDepthM: room.planDims?.depth };
}

export interface ModelChoice {
  model: string;
  /** Set only when the choice is `marble-1.1-plus`. */
  reason?: PlusReason;
  /** The sentence next to the room in the launch list. */
  text: string;
}

/** Model ids the server reported for each tier (`/api/status`), when it has told us. */
export interface TierModels {
  marbleDraft?: string;
  marbleFull?: string;
}

/**
 * The model id a room should be reconstructed with.
 *
 * Draft is one model for every room: it is the instant preview and it carries no metric scale, so
 * there is nothing for a bigger model to be better at. Full quality is where the room's size starts
 * to matter, and where `marble-1.1-plus` earns its place.
 */
export function modelForRoom(room: DraftRoom, tier: Tier, models?: TierModels): ModelChoice {
  return modelForModelRoom(modelRoomOfDraft(room), tier, models);
}

/** The same choice from the structural shape — what a caller holding a persisted `Room` calls. */
export function modelForModelRoom(room: ModelRoom, tier: Tier, models?: TierModels): ModelChoice {
  if (tier === 'draft') {
    const model = models?.marbleDraft || DRAFT_MODEL;
    return { model, text: 'Instant preview · no metric scale' };
  }
  const reason = plusReasonOf(room);
  if (!reason) return { model: models?.marbleFull || FULL_MODEL, text: 'Full quality · returns metric scale' };
  const area = room.planWidthM != null && room.planDepthM != null ? room.planWidthM * room.planDepthM : undefined;
  return {
    model: FULL_PLUS_MODEL,
    reason,
    text:
      reason === 'open-plan'
        ? 'Open plan, so it goes to the larger model'
        : `${area!.toFixed(1)} m² of floor is over ${PLUS_AREA_M2} m², so it goes to the larger model`,
  };
}

export interface TierPlanRow {
  id: string;
  name: string;
  choice: ModelChoice;
  /** No photo, or a browser-drawn demo photo: this room is simulated whatever the tier says. */
  simulated: boolean;
}

export interface TierPlan {
  tier: Tier;
  rows: TierPlanRow[];
  /** Rooms that will really reach Marble. */
  liveRooms: number;
  simulatedRooms: number;
  /** Rooms routed to `marble-1.1-plus`. */
  plusRooms: number;
  credits: number;
  usd: number;
  /** Every distinct model id this launch would use, in the order the rooms use them. */
  models: string[];
}

/** Rooms that can never go to a live reconstruction: no photo, or a browser-drawn demo photo. */
export const simulatedRoom = (r: DraftRoom): boolean => !r.photo || !!r.synthetic;

/**
 * What one tier would cost and which model each room would use. `live` is false when the whole run
 * is simulated (no key, or "prefer simulated"), and then nothing is charged for anything.
 *
 * `marble-1.1-plus` is billed at the full-quality rate here because that is the only rate World Labs
 * publishes; if the plus model ever prices separately this is the one place to change.
 */
export function tierPlan(rooms: DraftRoom[], tier: Tier, opts: { live?: boolean; models?: TierModels } = {}): TierPlan {
  const live = opts.live !== false;
  const rows: TierPlanRow[] = rooms.map((r) => ({ id: r.id, name: r.name, choice: modelForRoom(r, tier, opts.models), simulated: simulatedRoom(r) }));
  const liveRows = live ? rows.filter((r) => !r.simulated) : [];
  const info = TIER_INFO[tier];
  return {
    tier,
    rows,
    liveRooms: liveRows.length,
    simulatedRooms: rows.length - liveRows.length,
    plusRooms: liveRows.filter((r) => r.choice.model === FULL_PLUS_MODEL).length,
    credits: info.credits * liveRows.length,
    usd: Number((info.usd * liveRows.length).toFixed(2)),
    models: [...new Set(liveRows.map((r) => r.choice.model))],
  };
}

/** The one-sentence difference between the tiers, said at the point the seller chooses. */
export const TIER_COPY: Record<Tier, { headline: string; body: string }> = {
  draft: {
    headline: 'Instant preview, no metric scale',
    body: 'About a minute a room. Marble returns geometry up to scale only, so every dimension comes from your anchor and the plan. Good enough to look at and to stage against; not what a buyer should measure.',
  },
  full: {
    headline: 'The published model, with metric scale',
    body: 'About ten minutes a room. Full quality is the only tier that returns Marble’s own metric_scale_factor, which fusion weighs against the plan and the anchor. This is the model a buyer walks and measures.',
  },
};

/** The published model is full quality by default: only full comes back metric. */
export const DEFAULT_PUBLISH_TIER: Tier = 'full';

/* ---------- 3.5b: plan says / photo shows ---------- */

export type PlanRowState =
  /** Matched to a plan room with printed dimensions, and confirmed by the seller. */
  | 'confirmed'
  /** Matched with dimensions, waiting for the seller to say yes. */
  | 'unconfirmed'
  /** Matched, but the plan printed no dimensions for that room. */
  | 'no-dimensions'
  /** Not matched to any plan room. */
  | 'unmatched';

export interface PlanPhotoRow {
  roomId: string;
  roomName: string;
  /** The photo the seller matched, for the thumbnail. Undefined for a typed or plan-only room. */
  thumbnail?: string;
  planKey?: string;
  planRoomName?: string;
  planFloor?: string;
  /** Metres, when the plan printed them. */
  planDims?: PlanDimensions;
  state: PlanRowState;
  /** "Plan says 3.75 × 4.10 m" / "The plan printed no dimensions". */
  planLine: string;
  /** "Photo shows Living room · 3 angles". */
  photoLine: string;
}

const dims = (w: number, d: number) => `${w.toFixed(2)} × ${d.toFixed(2)} m`;

/**
 * One row per room: what the plan says, what the photo shows, and whether the pairing has been
 * confirmed. The row is the whole confirmation UI's state; the component only draws it.
 */
export function planPhotoRows(rooms: DraftRoom[]): PlanPhotoRow[] {
  return rooms.map((room) => {
    const photos = draftPhotos(room);
    const planDims = planDimensionsOf(room.planRoom);
    const ref = room.planRoom;
    const state: PlanRowState = !ref ? 'unmatched' : !planDims ? 'no-dimensions' : room.planConfirmed ? 'confirmed' : 'unconfirmed';
    return {
      roomId: room.id,
      roomName: room.name,
      thumbnail: photos[0]?.dataUrl,
      planKey: ref?.key,
      planRoomName: ref?.name,
      planFloor: ref?.floor,
      planDims,
      state,
      planLine: planDims
        ? `Plan says ${dims(planDims.width, planDims.depth)}${planDims.text ? ` (printed ${planDims.text})` : ''}`
        : ref
          ? 'The plan printed no dimensions for this room'
          : 'Not on the floor plan',
      photoLine: photos.length
        ? `Photo shows ${room.name}${photos.length > 1 ? ` · ${photos.length} angles` : ''}`
        : room.measured
          ? `Typed ${dims(room.measured.width, room.measured.depth)}`
          : 'No photo',
    };
  });
}

/** Rows still waiting on the seller. Empty means every matched room has been confirmed. */
export function unconfirmedRows(rooms: DraftRoom[]): PlanPhotoRow[] {
  return planPhotoRows(rooms).filter((r) => r.state === 'unconfirmed');
}

/** Plan rooms nothing has been matched to yet. */
export function unusedPlanRooms(rooms: DraftRoom[], planRooms: FlatPlanRoom[]): FlatPlanRoom[] {
  const taken = new Set(rooms.map((r) => r.planRoom?.key).filter(Boolean) as string[]);
  return planRooms.filter((p) => !taken.has(p.key));
}

/* ---------- re-mapping: which plan room is this photo? ---------- */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** 0..1. Exact name, then containment, then shared words — enough to offer a suggestion, never to decide. */
export function nameScore(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  const xs = new Set(x.split(' '));
  const ys = y.split(' ');
  const shared = ys.filter((w) => xs.has(w)).length;
  return shared ? (0.6 * shared) / Math.max(xs.size, ys.length) : 0;
}

/** The plan room this one most likely is, ignoring rooms already taken. Undefined when nothing scores. */
export function suggestPlanRoom(room: DraftRoom, planRooms: FlatPlanRoom[], taken: Set<string> = new Set()): FlatPlanRoom | undefined {
  let best: FlatPlanRoom | undefined;
  let bestScore = 0;
  for (const p of planRooms) {
    if (taken.has(p.key) && p.key !== room.planRoom?.key) continue;
    const score = nameScore(room.name, p.name) + (p.type === room.type ? 0.15 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 0.5 ? best : undefined;
}

/* ---------- what the launch step totals ---------- */

export interface IntakeSummary {
  rooms: number;
  photoRooms: number;
  blocked: RoomIntake[];
  accepted: RoomIntake[];
  thin: RoomIntake[];
  unconfirmed: PlanPhotoRow[];
  reconstruction: ReconstructionSummary;
}

export function intakeSummary(rooms: DraftRoom[]): IntakeSummary {
  const intakes = rooms.map(roomIntake);
  return {
    rooms: rooms.length,
    photoRooms: rooms.filter((r) => !!r.photo).length,
    blocked: intakes.filter((r) => r.blocked),
    accepted: intakes.filter((r) => r.accepted),
    thin: intakes.filter((r) => r.photos > 0 && !r.angles.enough),
    unconfirmed: unconfirmedRows(rooms),
    reconstruction: reconstructionSummary(rooms),
  };
}

/** Typed helper for the photos the gate reads, so a component can pass either shape. */
export type GatedPhoto = DraftPhoto | PhotoNumbers;
