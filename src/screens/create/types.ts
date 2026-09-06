/**
 * Local state for the create wizard. Nothing here touches the store until the user hits
 * "Generate": every room is a DraftRoom in React state, and the anchor is stored as a
 * *recipe* (what the user did) so it can be re-derived if the raw geometry changes.
 */
import type { AnchorSpec, RawGeometry, RoomGeometry, RoomType } from '@/engine/types';
import { anchorAssumed, anchorFromDoor, anchorFromFloorplan, anchorFromOutlet, anchorFromWall, applyScale } from '@/engine/anchor';
import { mockRawGeometry } from '@/services/mockWorld';
import { guessRoomType } from '@/services/ai';
import { photoHints, type LoadedPhoto } from '@/lib/image';
import { uid } from '@/lib/ids';
import type { PhotoAnalysis } from '@/state/types';

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
  photo?: LoadedPhoto;
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

/** The anchor the room currently has, or undefined when the ritual has not been completed. */
export function draftAnchor(room: DraftRoom): AnchorSpec | undefined {
  if (room.source === 'measured') return measuredAnchor(room.raw, room.measured?.tool ?? 'tape');
  return room.recipe ? anchorFromRecipe(room.raw, room.recipe) : undefined;
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
