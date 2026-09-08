/**
 * Demo rooms for the landing page, built with the real engine so that every number on the page
 * (dimensions, anchors, walkways, verdicts) is the product's own output rather than copy.
 */
import { anchorAssumed, anchorFromDoor, anchorFromMarble, anchorFromOutlet, anchorFromWall, applyScale, autoStage, fitReport, plausibility } from '@/engine';
import { round } from '@/engine/geometry';
import type { AnchorSpec, FitReport, PlacedPiece, PlausibilityWarning, RawGeometry, RoomGeometry, RoomType } from '@/engine/types';
import type { StagingStyle } from '@/engine/autostage';
import { mockRawGeometry } from '@/services/mockWorld';
import { fuseScale, roomFromFusion, type FusedRoom, type FusionResult } from '@shared/fusion';

export interface DemoRoom {
  id: string;
  name: string;
  type: RoomType;
  raw: RawGeometry;
  anchor: AnchorSpec;
  geometry: RoomGeometry;
  staging: PlacedPiece[];
  report: FitReport;
}

/** Where the leasing team tapped the door in the photo (normalised image coordinates). */
const DOOR_TAPS = [
  { x: 0.18, y: 0.28 },
  { x: 0.18, y: 0.71 },
];

function build(id: string, name: string, type: RoomType, raw: RawGeometry, anchor: AnchorSpec, style: StagingStyle): DemoRoom {
  const geometry = applyScale(raw, anchor.metresPerUnit);
  const staging = autoStage(geometry, type, style);
  return { id, name, type, raw, anchor, geometry, staging, report: fitReport(staging, geometry) };
}

/** The hero living room: mock reconstruction, door anchor at 2.03 m, warm auto-staging. */
export const HERO_ROOM: DemoRoom = (() => {
  const raw = mockRawGeometry('hero', 'living');
  return build('hero', 'Living room', 'living', raw, anchorFromDoor(raw, 0.42, DOOR_TAPS), 'warm');
})();

/** The deliberately small second bedroom from the demo unit: the room a renter's bed does not fit in. */
export const SMALL_BEDROOM: DemoRoom = (() => {
  const base = mockRawGeometry('demo:Second bedroom', 'bedroom');
  const raw: RawGeometry = { ...base, width: 2.75 / 2.03, depth: 3.05 / 2.03 };
  return build('bed2', 'Second bedroom', 'bedroom', raw, anchorFromDoor(raw, 0.42, DOOR_TAPS), 'scandi');
})();

export const DEMO_ROOMS: DemoRoom[] = [HERO_ROOM, SMALL_BEDROOM];

/**
 * The demo unit's model date. Fixed relative to load so the page never claims a model is newer than
 * it is; `timeAgo` renders it as "6 days ago", which is the only claim freshness needs to make.
 */
export const MODEL_DATE = Date.now() - 6 * 86400e3;

/** A drawing prints to the nearest 5 cm, so the plan dimensions on this page are rounded that way. */
const toPlan = (metres: number) => round(Math.round(metres * 20) / 20, 2);

/**
 * What the floor plan prints for the hero room, and what the reconstruction measures against it.
 *
 * The plan is the source of truth for width and depth (±5 cm), the door anchor scales the
 * reconstruction (±4 cm on 2.03 m), and `fuseScale` weights both — so the "plan says / model
 * measures" lines below are the real metric fusion from `shared/fusion.ts`, not copy. The printed
 * dimensions are the anchored room rounded like a drawing, offset by the couple of per cent a
 * reconstruction really is out by; everything after that is arithmetic.
 */
export const HERO_PLAN = {
  width: toPlan(HERO_ROOM.geometry.width * 0.972),
  depth: toPlan(HERO_ROOM.geometry.depth * 1.016),
};

export const HERO_FUSION: FusionResult = fuseScale({
  raw: { width: HERO_ROOM.raw.width, depth: HERO_ROOM.raw.depth, height: HERO_ROOM.raw.height },
  plan: HERO_PLAN,
  anchor: {
    metresPerUnit: HERO_ROOM.anchor.metresPerUnit,
    uncertaintyM: HERO_ROOM.anchor.uncertaintyM,
    referenceMetres: HERO_ROOM.anchor.referenceMetres,
  },
});

/** The hero room measured against its plan: width, depth, height, each with its own line. */
export const HERO_MEASURED: FusedRoom = roomFromFusion(
  { width: HERO_ROOM.raw.width, depth: HERO_ROOM.raw.depth, height: HERO_ROOM.raw.height },
  HERO_FUSION,
);

export interface AnchorMethodCard {
  key: 'door' | 'outlet' | 'tape' | 'laser';
  title: string;
  how: string;
  why: string;
  anchor: AnchorSpec;
}

const heroWallM = round(HERO_ROOM.raw.width * 2.03, 2);

/** The four ways a leasing team can anchor a room, each with the engine's real uncertainty. */
export const ANCHOR_METHODS: AnchorMethodCard[] = [
  {
    key: 'door',
    title: 'Tap the door',
    how: 'Two taps: top of the frame, bottom of the frame.',
    why: 'Interior doors are 2.03 m almost everywhere, give or take a couple of centimetres. The default, and enough for furniture.',
    anchor: anchorFromDoor(HERO_ROOM.raw, 0.42, DOOR_TAPS),
  },
  {
    key: 'outlet',
    title: 'Tap an outlet',
    how: 'Two taps on a power outlet, 30 cm off the floor.',
    why: 'A short reference, so the same thumb wobble is a bigger relative error. Use it when no door is in the frame.',
    anchor: anchorFromOutlet(HERO_ROOM.raw, 0.42, DOOR_TAPS),
  },
  {
    key: 'tape',
    title: 'Type a tape measurement',
    how: 'Measure one wall, type the number.',
    why: 'One trip with a tape measure buys every other number in the room. Recommended for a unit you are about to publish.',
    anchor: anchorFromWall(HERO_ROOM.raw, 'width', heroWallM, 'tape'),
  },
  {
    key: 'laser',
    title: 'Type a laser measurement',
    how: 'Point a laser measure at the far wall, type the number.',
    why: 'The tightest anchor we accept. What a leasing team with a laser in the van should use.',
    anchor: anchorFromWall(HERO_ROOM.raw, 'width', heroWallM, 'laser'),
  },
];

/** What the chip looks like when nobody anchors the unit. */
export const FALLBACK_ANCHORS: { label: string; anchor: AnchorSpec }[] = [
  { label: 'The reconstruction model guesses', anchor: anchorFromMarble(2.03 * 1.03) },
  { label: 'Nobody measured anything', anchor: anchorAssumed(HERO_ROOM.raw) },
];

/** A mis-tapped anchor: a 1.2 m cabinet door tapped instead of the room door. */
export const MISTAP: { factor: number; geometry: RoomGeometry; warnings: PlausibilityWarning[] } = (() => {
  const factor = 1.2 / 2.03;
  const geometry = applyScale(HERO_ROOM.raw, 2.03 * factor);
  return { factor, geometry, warnings: plausibility(geometry) };
})();
