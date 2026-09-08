/**
 * Local state for the create wizard. Nothing here touches the store until the user hits
 * "Generate": every room is a DraftRoom in React state, and the anchor is stored as a
 * *recipe* (what the user did) so it can be re-derived if the raw geometry changes.
 */
import type { AnchorSpec, RawGeometry, RoomGeometry, RoomType } from '@/engine/types';
import { anchorAssumed, anchorFromDoor, anchorFromFloorplan, anchorFromOutlet, anchorFromWall, applyScale, CEILING_HEIGHT_M } from '@/engine/anchor';
import { mockRawGeometry } from '@/services/mockWorld';
import { guessRoomType } from '@/services/ai';
import { planRoomType, type FloorPlan, type FlatPlanRoom } from '@/services/floorplan';
import { MAX_ROOM_PHOTOS } from '@/services/marble';
import { photoHints, type LoadedPhoto } from '@/lib/image';
import { uid } from '@/lib/ids';
import type { PhotoAngle, PhotoAnalysis, PlanDimensions } from '@/state/types';

export interface Tap {
  x: number;
  y: number;
}

export interface PhotoHint {
  level: 'ok' | 'warn' | 'bad';
  text: string;
}

export interface Measurements {
  width: number;
  depth: number;
  height: number;
  /** What the numbers were measured with. Tape is the honest default: nobody has a laser unless they say so. */
  tool?: MeasureTool;
}

export type MeasureTool = 'tape' | 'laser';

export const TOOL_OPTIONS: { value: MeasureTool; label: string }[] = [
  { value: 'tape', label: 'Tape · ±2 cm' },
  { value: 'laser', label: 'Laser · ±1 cm' },
];

export type AnchorRecipe =
  | { method: 'door'; taps: Tap[] }
  | { method: 'outlet'; taps: Tap[] }
  | { method: 'wall'; wall: 'width' | 'depth'; metres: number; tool: 'tape' | 'laser' }
  | { method: 'floorplan'; metres: number }
  | { method: 'skip' };

export type AnchorMethodChoice = AnchorRecipe['method'];

export interface DraftRoom {
  id: string;
  name: string;
  type: RoomType;
  source: 'photo' | 'measured';
  photo?: DraftPhoto;
  /** Extra angles of the same room; the primary `photo` is not repeated here. Six in all. */
  photos?: DraftPhoto[];
  /** The plan room this one was matched to, and the metres the plan printed for it. */
  planRoom?: DraftPlanRoomRef;
  fileName?: string;
  hints: PhotoHint[];
  analysis?: PhotoAnalysis;
  analysisState: 'idle' | 'running' | 'done';
  /** Unscaled proportions. For a photo room this is what the reconstruction will scale; for a typed room it is metres. */
  raw: RawGeometry;
  measured?: Measurements;
  recipe?: AnchorRecipe;
  /** A demo photo drawn in the browser. Never sent to a live reconstruction. */
  synthetic?: boolean;
  /**
   * The seller was told this room's primary photo is too poor to reconstruct and said "use anyway".
   * Cleared whenever the primary photo changes, so the decision is always about the photo on screen
   * (`intake.ts` is the gate; `roomIntake(room).blocked` is what it produces).
   */
  photoAccepted?: boolean;
  /**
   * The seller looked at "plan says 3.75 × 4.10 m / photo shows this room" and said yes. Cleared by
   * any re-map, because a confirmation is about one pairing and not about the room.
   */
  planConfirmed?: boolean;
}

export interface DraftListing {
  mode: 'url' | 'photos';
  url: string;
  source?: string;
  title: string;
  address: string;
  price: string;
  beds: string;
  baths: string;
  sqft: string;
  summary: string;
  /** True when the details were read from the URL and still need confirming. */
  inferred: boolean;
}

export const ROOM_TYPES: RoomType[] = ['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'studio', 'other'];

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  living: 'Living room',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  dining: 'Dining room',
  bathroom: 'Bathroom',
  office: 'Office',
  hallway: 'Hallway',
  studio: 'Studio',
  other: 'Other',
};

/* ---------- raw geometry ---------- */

/** The seed the reconstruction mock derives proportions from. Stable for a given photo + name. */
export function photoSeed(photo: LoadedPhoto, name: string): string {
  return `${photo.dataUrl.slice(0, 2000)}:${name}`;
}

export function rawForPhoto(photo: LoadedPhoto, name: string, type: RoomType): RawGeometry {
  return mockRawGeometry(photoSeed(photo, name), type);
}

/**
 * A typed room is already in metres, so its raw units *are* metres (metresPerUnit 1).
 * Door on the south wall, 2.03 m tall; outlet centre at 0.30 m.
 */
export function rawFromMeasurements(m: Measurements): RawGeometry {
  const width = Math.max(1, m.width);
  const depth = Math.max(1, m.depth);
  const height = Math.max(1.8, m.height);
  const doorWidth = Math.min(0.9, Math.max(0.6, width - 0.6));
  const offset = Math.min(Math.max(0.45 + doorWidth / 2, width * 0.3), width - doorWidth / 2 - 0.3);
  return {
    width,
    depth,
    height,
    door: { wall: 'south', offset, width: doorWidth, height: Math.min(2.03, height - 0.1) },
    windows: [],
    doorHeightUnits: 2.03,
    outletHeightUnits: 0.3,
  };
}

/* ---------- anchors ---------- */

export function tapFraction(taps: Tap[]): number | undefined {
  if (taps.length < 2) return undefined;
  return Math.abs(taps[1].y - taps[0].y);
}

export function anchorFromRecipe(raw: RawGeometry, recipe: AnchorRecipe): AnchorSpec | undefined {
  switch (recipe.method) {
    case 'door': {
      const f = tapFraction(recipe.taps);
      return f == null || f < 0.02 ? undefined : anchorFromDoor(raw, f, recipe.taps);
    }
    case 'outlet': {
      const f = tapFraction(recipe.taps);
      return f == null || f < 0.005 ? undefined : anchorFromOutlet(raw, f, recipe.taps);
    }
    case 'wall':
      return recipe.metres > 0 ? anchorFromWall(raw, recipe.wall, recipe.metres, recipe.tool) : undefined;
    case 'floorplan':
      return recipe.metres > 0 ? anchorFromFloorplan(raw, recipe.metres) : undefined;
    case 'skip':
      return anchorAssumed(raw);
  }
}

/**
 * A typed room anchors itself: its far wall was measured directly. The tool is what the user said they
 * used — never assume a laser (±1 cm) for numbers that were probably paced out with a tape.
 */
export function measuredAnchor(raw: RawGeometry, tool: MeasureTool = 'tape'): AnchorSpec {
  return anchorFromWall(raw, 'width', raw.width, tool);
}

/**
 * The anchor the room currently has, or undefined when the ritual has not been completed.
 * A declared recipe wins over the room's source: a room read off the floor plan is anchored by the
 * plan whether or not it also has a photo, and it must not claim to have been measured with a tape.
 */
export function draftAnchor(room: DraftRoom): AnchorSpec | undefined {
  if (room.recipe) return anchorFromRecipe(room.raw, room.recipe);
  if (room.source === 'measured' && room.measured) return measuredAnchor(room.raw, room.measured.tool ?? 'tape');
  return undefined;
}

/** What will be written to the store: the declared anchor, or an honest "assumed" one. */
export function finalAnchor(room: DraftRoom): AnchorSpec {
  return draftAnchor(room) ?? anchorAssumed(room.raw);
}

export function draftGeometry(room: DraftRoom): RoomGeometry {
  return applyScale(room.raw, finalAnchor(room).metresPerUnit);
}

export function isAnchored(room: DraftRoom): boolean {
  const a = draftAnchor(room);
  return !!a && a.method !== 'assumed';
}

/* ---------- constructors ---------- */

export function roomNameFromFile(fileName: string, index: number): string {
  const base = fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base || /^(img|dsc|dcim|image|photo|pxl|screenshot|scan)\b/i.test(base) || /^\d[\d\s]*$/.test(base)) return `Room ${index + 1}`;
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function newPhotoRoom(photo: LoadedPhoto, fileName: string, index: number): DraftRoom {
  const name = roomNameFromFile(fileName, index);
  const type = guessRoomType(name);
  return {
    id: uid('draft'),
    name,
    type,
    source: 'photo',
    photo,
    fileName,
    hints: photoHints(photo),
    analysisState: 'idle',
    raw: rawForPhoto(photo, name, type),
  };
}

export function newMeasuredRoom(name: string, type: RoomType, m: Measurements): DraftRoom {
  return {
    id: uid('draft'),
    name,
    type,
    source: 'measured',
    hints: [],
    analysisState: 'done',
    raw: rawFromMeasurements(m),
    measured: { tool: 'tape', ...m },
  };
}

export function emptyListing(): DraftListing {
  return { mode: 'url', url: '', title: '', address: '', price: '', beds: '', baths: '', sqft: '', summary: '', inferred: false };
}

/* ---------- demo (?demo=1) ---------- */

export const DEMO_LISTING: DraftListing = {
  mode: 'url',
  url: 'https://www.redfin.com/OR/Portland/88-Alder-Ln-97214/home/2210077',
  source: 'redfin',
  title: '88 Alder Lane',
  address: '88 Alder Ln, Portland, OR 97214',
  price: '$715,000',
  beds: '3',
  baths: '2',
  sqft: '1460',
  summary: 'Nineteen-twenties bungalow, empty since spring. Demo listing: the rooms below were typed in from a tape measure.',
  inferred: true,
};

export function demoRooms(): DraftRoom[] {
  return [
    newMeasuredRoom('Primary bedroom', 'bedroom', { width: 3.6, depth: 4.2, height: 2.6 }),
    newMeasuredRoom('Second bedroom', 'bedroom', { width: 2.75, depth: 3.05, height: 2.5 }),
    newMeasuredRoom('Dining room', 'dining', { width: 3.4, depth: 4.0, height: 2.6 }),
  ];
}

/* ---------- photos: one primary, up to five more angles ---------- */

export { MAX_ROOM_PHOTOS };

/**
 * A photo in the create flow. `angle` is set only when the seller says which way it faces; it becomes
 * Marble's azimuth hint in the multi-image prompt.
 */
export interface DraftPhoto extends LoadedPhoto {
  angle?: PhotoAngle;
  origin?: 'file' | 'url';
  sourceUrl?: string;
}

/** Every photo a draft room will send, primary first. */
export function draftPhotos(room: DraftRoom): DraftPhoto[] {
  return [...(room.photo ? [room.photo] : []), ...(room.photos ?? [])];
}

export function photoCount(room: DraftRoom): number {
  return draftPhotos(room).length;
}

export function canAddPhoto(room: DraftRoom): boolean {
  return photoCount(room) < MAX_ROOM_PHOTOS;
}

/**
 * Add an angle. The first photo on a room without one becomes the primary — the shot the anchor is
 * tapped on and the one that defines azimuth 0 — and everything after it is an extra angle.
 */
export function withPhoto(room: DraftRoom, photo: DraftPhoto): DraftRoom {
  if (!canAddPhoto(room)) return room;
  // A new primary photo is a new decision: "use anyway" was about the shot that has just been replaced.
  if (!room.photo) return { ...room, source: 'photo', photo, hints: photoHints(photo), photoAccepted: undefined };
  return { ...room, photos: [...(room.photos ?? []), photo] };
}

/** Drop one angle by index into `draftPhotos` (0 is the primary; the next angle is promoted). */
export function withoutPhoto(room: DraftRoom, index: number): DraftRoom {
  const all = draftPhotos(room);
  if (index < 0 || index >= all.length) return room;
  const rest = all.filter((_, i) => i !== index);
  const [primary, ...extra] = rest;
  return {
    ...room,
    photo: primary,
    photos: extra.length ? extra : undefined,
    hints: primary ? photoHints(primary) : [],
    // A room with no photo left is measurements only: the anchor step has no image to tap on.
    source: primary ? 'photo' : 'measured',
    // Dropping the primary shot promotes a different one, so its quality has not been accepted yet.
    photoAccepted: index === 0 ? undefined : room.photoAccepted,
  };
}

export function withPhotoAngle(room: DraftRoom, index: number, angle: PhotoAngle | undefined): DraftRoom {
  const all = draftPhotos(room).map((p, i) => (i === index ? { ...p, angle } : p));
  const [primary, ...extra] = all;
  return { ...room, photo: primary, photos: extra.length ? extra : undefined };
}

/* ---------- the listing floor plan ---------- */

/** The plan room a draft room was matched to, flattened onto the draft so it survives a reload. */
export interface DraftPlanRoomRef {
  /** `FlatPlanRoom.key` — which floor, which room. */
  key: string;
  name: string;
  floor: string;
  /** Metres, when the plan printed dimensions for this room. */
  width?: number;
  depth?: number;
  /** Exactly what the plan printed. */
  text?: string;
}

/** The floor-plan step's own state. Held in the wizard, written to the tour on launch. */
export interface DraftPlan {
  image?: LoadedPhoto;
  fileName?: string;
  state: 'idle' | 'parsing' | 'done' | 'failed';
  plan?: FloorPlan;
  /** Keys of the rooms the seller kept. Empty means "none chosen yet". */
  chosen: string[];
}

export function emptyDraftPlan(): DraftPlan {
  return { state: 'idle', chosen: [] };
}

/** A plan's ceiling is never printed, so the rooms it produces stand under the standard 2.44 m. */
export const PLAN_CEILING_M = CEILING_HEIGHT_M;

export function planRoomRef(r: FlatPlanRoom): DraftPlanRoomRef {
  return { key: r.key, name: r.name, floor: r.floor, width: r.width, depth: r.depth, text: r.dimensionsText };
}

/** What goes on the room record: the plan's metres, or nothing when it printed none. */
export function planDimensionsOf(ref: DraftPlanRoomRef | undefined): PlanDimensions | undefined {
  if (!ref || ref.width == null || ref.depth == null) return undefined;
  return { width: ref.width, depth: ref.depth, text: ref.text, planRoomName: ref.name, floor: ref.floor };
}

/**
 * Attach a plan room to a draft room. **The plan wins**: when it printed dimensions, the room's raw
 * geometry is rebuilt from them (metres, so one raw unit is one metre) and its anchor becomes
 * `floorplan` — "floor plan · 3.75 m wall · ±5 cm" — over any estimate the photo produced. A plan
 * room with no printed dimensions contributes only its name, its type and its floor.
 */
export function withPlanRoom(room: DraftRoom, ref: DraftPlanRoomRef | undefined): DraftRoom {
  if (!ref) {
    // Unmatching a room drops the plan's numbers; a photo room falls back to the photo's proportions.
    const raw = room.photo ? rawForPhoto(room.photo, room.name, room.type) : room.measured ? rawFromMeasurements(room.measured) : room.raw;
    return { ...room, planRoom: undefined, raw, recipe: room.recipe?.method === 'floorplan' ? undefined : room.recipe, planConfirmed: undefined };
  }
  const type = planRoomType(ref.name);
  // A confirmation is about one pairing: re-mapping to a different plan room asks the question again.
  const next: DraftRoom = { ...room, planRoom: ref, name: ref.name, type, planConfirmed: ref.key === room.planRoom?.key ? room.planConfirmed : undefined };
  if (ref.width == null || ref.depth == null) return next;
  const measured: Measurements = { width: ref.width, depth: ref.depth, height: PLAN_CEILING_M };
  return { ...next, raw: rawFromMeasurements(measured), recipe: { method: 'floorplan', metres: ref.width } };
}

/** True when this room's numbers come from the plan rather than from a photo or a tape. */
export function isFromPlan(room: DraftRoom): boolean {
  return room.recipe?.method === 'floorplan' && !!room.planRoom;
}

/**
 * A room read straight off the plan, with no photo. With dimensions it is real by construction and
 * anchored by the plan; without them it is a name and a floor, and its numbers stay an honest guess
 * until the seller adds a photo or types a wall.
 */
export function newPlanRoom(ref: DraftPlanRoomRef, index: number): DraftRoom {
  const type = planRoomType(ref.name);
  const base: DraftRoom = {
    id: uid('draft'),
    name: ref.name,
    type,
    source: 'measured',
    planRoom: ref,
    hints: [],
    analysisState: 'done',
    raw: mockRawGeometry(`plan:${ref.key}:${ref.name}:${index}`, type),
  };
  if (ref.width == null || ref.depth == null) return base;
  const measured: Measurements = { width: ref.width, depth: ref.depth, height: PLAN_CEILING_M };
  return { ...base, raw: rawFromMeasurements(measured), measured: undefined, recipe: { method: 'floorplan', metres: ref.width } };
}
