/**
 * The text prompt a room sends to Marble, compiled in the browser (docs/BACKEND.md section 3).
 *
 * This module is the browser half of one compiler. `server/prompt.ts` is the canonical copy; the
 * renderer between the markers below is byte-identical to it, and `tests/prompt-parity.test.ts`
 * compares the two regions character for character as well as compiling the same facts through
 * both. The duplication is deliberate and cannot be removed: `server/` must not import `src/`, and
 * `src/` must not import `server/` either, because `vite.config.ts` type-imports `server/api.ts`
 * and an import the other way would pull the dev server into the browser bundle.
 *
 * What is NOT shared is the small mapper at the bottom: `roomPromptFacts` turns a `Room` from the
 * store into the `PromptFacts` the renderer takes, which is the browser's equivalent of
 * `defaultRoomContext` + `buildRecipe` on the server.
 *
 * Conventions:
 * - Pure. No clock, no randomness, no store: a `Room` and a `TourSite` in, one string out.
 * - Unknown attributes are omitted, never guessed. In particular the ceiling height is NOT stated:
 *   before a world exists the room's height is an assumption (`anchorFromCeiling`, the mock raw
 *   geometry), and a prompt must never invent a dimension the data did not contain.
 * - The compiled text is hashed into the browser recipe (`browserRecipe` in services/marble) and
 *   `disable_recaption` keeps it verbatim on Marble's side, so changing a phrase here changes
 *   every browser recipe hash.
 */
import type { Room, TourSite } from '@/state/types';

/** What the room knows that the prompt can use. Every field is optional except the type. */
export type RoomPromptInput = Pick<Room, 'type'> & Partial<Pick<Room, 'photo' | 'photos' | 'planDims' | 'anchor' | 'analysis' | 'northWallHeading'>>;

/**
 * Marble's own cap in reconstruction mode, and therefore the cap on what the prompt may describe.
 * It lives here, in the leaf module, and `services/marble` re-exports it under the same name: the
 * prompt must count exactly the shots `roomPhotos` sends, or it announces photographs Marble never
 * receives — and that count is part of the recipe that is hashed for the seed.
 */
export const MAX_ROOM_PHOTOS = 6;

/* ===== shared renderer: server/prompt.ts ⟷ src/services/marblePrompt.ts =========
 * Everything from this marker to the end-marker is byte-identical in both files.
 * tests/prompt-parity.test.ts compares the two regions character for character and compiles
 * the same facts through both compilers, so an edit in one must be copied to the other verbatim.
 * ============================================================================== */

/** Mirrors `RoomType` in src/engine/types.ts. */
export type RoomType = 'living' | 'bedroom' | 'kitchen' | 'dining' | 'bathroom' | 'office' | 'hallway' | 'studio' | 'other';
/** Mirrors `WallSide` in src/engine/types.ts. */
export type WallSide = 'north' | 'south' | 'east' | 'west';
/** Where the photographer stood (docs/BACKEND.md section 1: "from a corner or the doorway"). */
export type CapturePosition = 'doorway' | 'corner';
export type DoorSwing = 'inward' | 'outward';

export interface PromptDoor {
  wall?: WallSide;
  /** Metres from the wall's start (west end for north/south walls, north end for east/west walls). */
  offset?: number;
  width?: number;
  height?: number;
  swing?: DoorSwing;
}

export interface PromptWindow {
  wall?: WallSide;
  offset?: number;
  width?: number;
  height?: number;
  sill?: number;
}

/**
 * Everything the prompt can say. Only `roomType` and `imageCount` are required; every other field
 * is rendered when present and valid, and silently omitted otherwise.
 */
export interface PromptFacts {
  roomType: RoomType;
  /** Photographs in the request, ≥ 1. */
  imageCount: number;
  /** From the photo analysis: `true` says "empty", `false` says "furnished", unset says neither. */
  empty?: boolean;
  capturedFrom?: CapturePosition;
  /** Plan dimensions, metres. Both are needed for the sentence to render. */
  widthM?: number;
  depthM?: number;
  ceilingHeightM?: number;
  doors?: PromptDoor[];
  windows?: PromptWindow[];
  /** How the vision model described the photograph ("White walls and an oak floor"). */
  photoCaption?: string;
  /** Finishes, as phrases: "oak", "white", "recessed lighting". */
  flooring?: string;
  walls?: string;
  trim?: string;
  fixtures?: string[];
  /** Listing notes worth telling the model ("renovated 2021"). */
  notes?: string[];
  /** 0 is the ground floor. */
  floorLevel?: number;
  buildingType?: string;
  buildingYear?: number;
  city?: string;
  /** True-north bearing the windows face, degrees. */
  windowFacing?: number;
  /** Local hour (0–23) the photos were taken, from EXIF. */
  captureHour?: number;
}

/** The prompt is trimmed (context, then finishes, then openings) until it fits. */
export const PROMPT_MAX_CHARS = 1200;

/** Section 6 of docs/BACKEND.md, verbatim. Never trimmed. */
export const PROMPT_CONSTRAINTS =
  'The same room in every image; keep the real geometry; do not add furniture, people or extra rooms; walls, floor and ceiling as photographed.';

/** Longest free-text phrase kept, so one long listing note cannot crowd out the geometry. */
const FREE_TEXT_MAX = 80;
const MAX_FIXTURES = 6;
const MAX_NOTES = 4;
const METRES_PER_INCH = 0.0254;

const ROOM_LABEL: Record<RoomType, string> = {
  living: 'living room',
  bedroom: 'bedroom',
  kitchen: 'kitchen',
  dining: 'dining room',
  bathroom: 'bathroom',
  office: 'home office',
  hallway: 'hallway',
  studio: 'studio apartment',
  other: 'room',
};

const WALLS: ReadonlySet<string> = new Set<WallSide>(['north', 'south', 'east', 'west']);
const SWINGS: ReadonlySet<string> = new Set<DoorSwing>(['inward', 'outward']);
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

type SectionKey = 'images' | 'geometry' | 'openings' | 'finishes' | 'context' | 'constraints';
const SECTION_ORDER: readonly SectionKey[] = ['images', 'geometry', 'openings', 'finishes', 'context', 'constraints'];
/** Dropped in this order when the cap is hit; the rest are never dropped. */
const TRIM_ORDER: readonly SectionKey[] = ['context', 'finishes', 'openings'];

/* ---------- formatting ---------- */

const isFinite_ = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const positive = (x: unknown): x is number => isFinite_(x) && x > 0;
const nonNegative = (x: unknown): x is number => isFinite_(x) && x >= 0;

/** One decimal, no "-0". */
function metres(x: number): string {
  const r = Math.round(x * 10) / 10;
  return (r === 0 ? 0 : r).toFixed(1);
}

/** Feet and whole inches; "12 ft 4 in", or "8 ft" when the inches round away. */
function feetInches(x: number): string {
  const inches = Math.round(x / METRES_PER_INCH);
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return inch === 0 ? `${ft} ft` : `${ft} ft ${inch} in`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "an 1880s building", "an apartment", "a 1920s house". Deterministic, not perfect English. */
function article(phrase: string): string {
  return /^(?:[aeiou]|8|18\d)/i.test(phrase) ? 'an' : 'a';
}

function compass(bearing: number): string {
  const b = ((bearing % 360) + 360) % 360;
  return COMPASS[Math.round(b / 45) % 8];
}

/** Collapse whitespace, strip control characters and trailing punctuation, cap the length. */
function clean(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  let t = s
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;,:]+$/, '')
    .trim();
  if (!t) return undefined;
  if (t.length > FREE_TEXT_MAX) t = t.slice(0, FREE_TEXT_MAX).trimEnd();
  return t;
}

function cleanList(list: unknown, max: number): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const t = clean(item);
    if (t) out.push(t);
    if (out.length === max) break;
  }
  return out;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------- sections ---------- */

function imagesSentence(f: PromptFacts): string {
  const n = f.imageCount;
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`compileMarblePrompt: imageCount must be a positive integer, got ${String(n)}`);
  const room = ROOM_LABEL[f.roomType] ?? ROOM_LABEL.other;
  const state = f.empty === true ? ', empty' : f.empty === false ? ', furnished' : '';
  const from = f.capturedFrom === 'doorway' ? ', taken from the doorway' : f.capturedFrom === 'corner' ? ', taken from a corner' : '';
  return `${n} photograph${n === 1 ? '' : 's'} of one real${state} ${room}${from}.`;
}

/** "the south wall, 1.2 m from its west end" for every opening that names a wall. */
function placements(list: (PromptDoor | PromptWindow)[] | undefined): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const o of list) {
    if (!o || !WALLS.has(o.wall as string)) continue;
    const wall = o.wall as WallSide;
    const start = wall === 'north' || wall === 'south' ? 'west' : 'north';
    out.push(nonNegative(o.offset) ? `the ${wall} wall, ${metres(o.offset)} m from its ${start} end` : `the ${wall} wall`);
  }
  return out;
}

function geometrySentences(f: PromptFacts): string {
  const out: string[] = [];
  if (positive(f.widthM) && positive(f.depthM)) {
    out.push(`The room measures ${metres(f.widthM)} m by ${metres(f.depthM)} m (${feetInches(f.widthM)} by ${feetInches(f.depthM)}) on the floor plan.`);
  }
  if (positive(f.ceilingHeightM)) out.push(`Ceiling height ${metres(f.ceilingHeightM)} m (${feetInches(f.ceilingHeightM)}).`);
  const doors = placements(f.doors);
  if (doors.length) out.push(`${doors.length === 1 ? 'Door' : 'Doors'} on ${doors.join('; ')}.`);
  const windows = placements(f.windows);
  if (windows.length) out.push(`${windows.length === 1 ? 'Window' : 'Windows'} on ${windows.join('; ')}.`);
  return out.join(' ');
}

function sizePhrase(width: unknown, height: unknown): string | undefined {
  if (positive(width) && positive(height)) return `${metres(width)} m wide and ${metres(height)} m high`;
  if (positive(width)) return `${metres(width)} m wide`;
  if (positive(height)) return `${metres(height)} m high`;
  return undefined;
}

function doorDetail(d: PromptDoor): string {
  const parts: string[] = [];
  const size = sizePhrase(d.width, d.height);
  if (size) parts.push(size);
  if (SWINGS.has(d.swing as string)) parts.push(`swinging ${d.swing}`);
  return parts.join(', ');
}

function windowDetail(w: PromptWindow): string {
  const parts: string[] = [];
  const size = sizePhrase(w.width, w.height);
  if (size) parts.push(size);
  if (nonNegative(w.sill)) parts.push(`sill at ${metres(w.sill)} m`);
  return parts.join(', ');
}

/** "1 door, 0.9 m wide and 2.0 m high, swinging inward." / "2 windows: …; …." / "3 doors." */
function countSentence(n: number, noun: string, details: string[]): string {
  const head = `${n} ${noun}${n === 1 ? '' : 's'}`;
  const filled = details.filter(Boolean);
  if (!filled.length) return `${head}.`;
  if (n === 1) return `${head}, ${filled[0]}.`;
  return `${head}: ${filled.join('; ')}.`;
}

function openingsSentences(f: PromptFacts): string {
  const out: string[] = [];
  // An empty list is "none detected", which is not the same as "none": it is omitted, not stated.
  const doors = Array.isArray(f.doors) ? f.doors.filter(Boolean) : [];
  const windows = Array.isArray(f.windows) ? f.windows.filter(Boolean) : [];
  if (doors.length) out.push(countSentence(doors.length, 'door', doors.map(doorDetail)));
  if (windows.length) out.push(countSentence(windows.length, 'window', windows.map(windowDetail)));
  return out.join(' ');
}

function finishesSentences(f: PromptFacts): string {
  const out: string[] = [];
  // The model's own description of the photograph comes first: it is what the room looked like,
  // and the fields below are the listing's structured claims about it.
  const caption = clean(f.photoCaption);
  if (caption) out.push(`As photographed: ${caption}.`);
  const flooring = clean(f.flooring);
  const walls = clean(f.walls);
  const trim = clean(f.trim);
  const fixtures = cleanList(f.fixtures, MAX_FIXTURES);
  const notes = cleanList(f.notes, MAX_NOTES);
  if (flooring) out.push(`Flooring: ${flooring}.`);
  if (walls) out.push(`Walls: ${walls}.`);
  if (trim) out.push(`Trim: ${trim}.`);
  if (fixtures.length) out.push(`Fixtures: ${fixtures.join(', ')}.`);
  if (notes.length) out.push(`Listing notes: ${notes.join('; ')}.`);
  return out.join(' ');
}

function timeOfDay(hour: number): string {
  const h = Math.floor(hour);
  if (h >= 5 && h <= 10) return 'in the morning';
  if (h >= 11 && h <= 13) return 'at midday';
  if (h >= 14 && h <= 17) return 'in the afternoon';
  if (h >= 18 && h <= 20) return 'in the evening';
  return 'at night';
}

function contextSentences(f: PromptFacts): string {
  const out: string[] = [];
  const parts: string[] = [];
  let floor: string | undefined;
  if (Number.isInteger(f.floorLevel)) {
    const level = f.floorLevel as number;
    floor = level === 0 ? 'on the ground floor' : level > 0 ? `on the ${ordinal(level)} floor` : 'below ground';
    parts.push(floor);
  }
  const type = clean(f.buildingType);
  const year = f.buildingYear;
  const decade = Number.isInteger(year) && (year as number) >= 1500 && (year as number) <= 2100 ? `${Math.floor((year as number) / 10) * 10}s` : undefined;
  if (type || decade) {
    const phrase = [decade, type ?? 'building'].filter(Boolean).join(' ');
    parts.push(`${floor ? 'of' : 'in'} ${article(phrase)} ${phrase}`);
  }
  const city = clean(f.city);
  if (city) parts.push(`in ${city}`);
  if (parts.length) out.push(`${capitalise(parts.join(' '))}.`);
  if (isFinite_(f.windowFacing)) out.push(`The windows face ${compass(f.windowFacing)}.`);
  if (isFinite_(f.captureHour) && f.captureHour >= 0 && f.captureHour < 24) out.push(`Photographed ${timeOfDay(f.captureHour)}.`);
  return out.join(' ');
}

/* ---------- the compiler ---------- */

/**
 * Render the facts into Marble's text prompt. Pure: the same facts give the same string, whatever
 * the key order of the object they arrive in. Throws only when `imageCount` is not a positive
 * integer; every other invalid value is treated as unknown and omitted.
 */
export function compileMarblePrompt(facts: PromptFacts): string {
  const sections: Record<SectionKey, string> = {
    images: imagesSentence(facts),
    geometry: geometrySentences(facts),
    openings: openingsSentences(facts),
    finishes: finishesSentences(facts),
    context: contextSentences(facts),
    constraints: PROMPT_CONSTRAINTS,
  };
  const kept = new Set<SectionKey>(SECTION_ORDER);
  const assemble = () =>
    SECTION_ORDER.filter((k) => kept.has(k))
      .map((k) => sections[k])
      .filter(Boolean)
      .join(' ');
  let text = assemble();
  for (const key of TRIM_ORDER) {
    if (text.length <= PROMPT_MAX_CHARS) break;
    kept.delete(key);
    text = assemble();
  }
  return text;
}

/* ===== end of the shared renderer ============================================== */

/* ---------- the browser's facts: a Room, as the renderer above wants it ---------- */

/**
 * The door the prompt can state: the anchor's own door (the seller tapped it and declared its
 * height, which is a fact the data contains), or else the door the vision model saw. Only one,
 * because one is all either source knows about.
 */
function doorFact(room: RoomPromptInput): PromptDoor | undefined {
  const anchor = room.anchor;
  if (anchor && anchor.method === 'door' && anchor.referenceMetres > 0) return { height: anchor.referenceMetres };
  return room.analysis?.doorVisible ? {} : undefined;
}

/**
 * Everything a `Room` in the store knows that the prompt can say. The server's equivalent is
 * `defaultRoomContext` (server/pipeline.ts) reading the same facts off the stored rows; both feed
 * the same renderer, so the browser flow and the pipeline describe a room in the same words.
 */
export function roomPromptFacts(room: RoomPromptInput, site?: Pick<TourSite, 'heading'> | null): PromptFacts {
  const shots = [...(room.photo ? [room.photo] : []), ...(room.photos ?? [])].slice(0, MAX_ROOM_PHOTOS);
  const facts: PromptFacts = {
    roomType: room.type,
    // Exactly the shots `generationImages` sends: the prompt must never announce a photograph
    // Marble is not given, and the count is hashed into the recipe.
    imageCount: Math.max(1, shots.length),
    // The create flow asks for the primary photo from the doorway, which is where the anchor is tapped.
    capturedFrom: 'doorway',
  };
  const analysis = room.analysis;
  if (analysis && typeof analysis.isEmpty === 'boolean') facts.empty = analysis.isEmpty;
  const dims = room.planDims;
  if (dims && dims.width > 0 && dims.depth > 0) {
    facts.widthM = dims.width;
    facts.depthM = dims.depth;
  }
  const door = doorFact(room);
  if (door) facts.doors = [door];
  // The heuristic fallback's caption is a placeholder ("An empty room."), not a description.
  if (analysis?.source === 'nebius') {
    const caption = analysis.caption?.trim();
    if (caption) facts.photoCaption = caption;
  }
  if (analysis && Array.isArray(analysis.notes)) {
    const notes = analysis.notes.filter((n) => typeof n === 'string' && n.trim().length > 0);
    if (notes.length) facts.notes = notes;
  }
  const heading = room.northWallHeading ?? site?.heading;
  if (typeof heading === 'number' && Number.isFinite(heading)) facts.windowFacing = heading;
  return facts;
}

/** Compile the prompt for a room: the facts it knows, rendered by the shared compiler above. */
export function compileRoomPrompt(room: RoomPromptInput, site?: Pick<TourSite, 'heading'> | null): string {
  return compileMarblePrompt(roomPromptFacts(room, site));
}
