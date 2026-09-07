/**
 * Demo rooms for the landing page, built with the real engine so that every number on the page
 * (dimensions, anchors, walkways, verdicts) is the product's own output rather than copy.
 */
import { anchorAssumed, anchorFromDoor, anchorFromMarble, anchorFromOutlet, anchorFromWall, applyScale, autoStage, fitReport, plausibility } from '@/engine';
import { round } from '@/engine/geometry';
import type { AnchorSpec, FitReport, PlacedPiece, PlausibilityWarning, RawGeometry, RoomGeometry, RoomType } from '@/engine/types';
import type { StagingStyle } from '@/engine/autostage';
import { mockRawGeometry } from '@/services/mockWorld';

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

/** Where the seller tapped the door in the photo (normalised image coordinates). */
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

/** The deliberately small second bedroom from the demo listing: the room buyers' beds fail in. */
export const SMALL_BEDROOM: DemoRoom = (() => {
  const base = mockRawGeometry('demo:Second bedroom', 'bedroom');
  const raw: RawGeometry = { ...base, width: 2.75 / 2.03, depth: 3.05 / 2.03 };
  return build('bed2', 'Second bedroom', 'bedroom', raw, anchorFromDoor(raw, 0.42, DOOR_TAPS), 'scandi');
})();

export const DEMO_ROOMS: DemoRoom[] = [HERO_ROOM, SMALL_BEDROOM];

export interface AnchorMethodCard {
  key: 'door' | 'outlet' | 'tape' | 'laser';
  title: string;
  how: string;
  why: string;
  anchor: AnchorSpec;
}

const heroWallM = round(HERO_ROOM.raw.width * 2.03, 2);

/** The four ways a seller can anchor a room, each with the engine's real uncertainty. */
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
    why: 'One trip with a tape measure buys every other number in the room. Recommended for listings.',
    anchor: anchorFromWall(HERO_ROOM.raw, 'width', heroWallM, 'tape'),
  },
  {
    key: 'laser',
    title: 'Type a laser measurement',
    how: 'Point a laser measure at the far wall, type the number.',
    why: 'The tightest anchor we accept. What an agent with a laser in the glovebox should use.',
    anchor: anchorFromWall(HERO_ROOM.raw, 'width', heroWallM, 'laser'),
  },
];

/** What the chip looks like when the seller skips the anchor step. */
export const FALLBACK_ANCHORS: { label: string; anchor: AnchorSpec }[] = [
  { label: 'The reconstruction model guesses', anchor: anchorFromMarble(2.03 * 1.03) },
  { label: 'Nobody measured anything', anchor: anchorAssumed(HERO_ROOM.raw) },
];

/** A mis-tapped anchor: the seller taps a 1.2 m cabinet door instead of the room door. */
export const MISTAP: { factor: number; geometry: RoomGeometry; warnings: PlausibilityWarning[] } = (() => {
  const factor = 1.2 / 2.03;
  const geometry = applyScale(HERO_ROOM.raw, 2.03 * factor);
  return { factor, geometry, warnings: plausibility(geometry) };
})();
