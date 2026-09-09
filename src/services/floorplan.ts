/**
 * Reading the unit's floor plan.
 *
 * A floor plan is the cheapest metric truth a unit has: the leasing plan prints the room names and,
 * usually, each room's dimensions. Audora's anchor exists because a reconstruction has no scale of its
 * own — so a plan that says `12'-4" × 15'-2"` is worth more than any tap on a door, and it costs one
 * vision call.
 *
 * The pass is deliberately two-layered:
 *   1. the vision model reads the drawing and returns each room's name, type, the dimension string
 *      **verbatim as printed**, and its own metric conversion;
 *   2. `metresFromDimensions` re-reads that printed string here, in code, and wins whenever it can.
 * Models are good at reading `13'-6"` off a drawing and careless about multiplying it by 0.3048; the
 * arithmetic is free and exact, so it should never be delegated. `evals/floorplan.eval.ts` scores
 * exactly this pipeline.
 *
 * With no model configured the parse returns an empty plan carrying one note. Nothing here throws.
 */
import type { RoomType } from '@/engine/types';
import { guessRoomType } from '@/services/ai';
import { useAudora } from '@/state/store';

export type PlanUnits = 'feet' | 'metres' | 'mixed' | 'unknown';

/** Which way the plan's north arrow points on the page, plus the bearing when the drawing states one. */
export interface PlanNorthArrow {
  present: boolean;
  /** Where the arrow head points on the sheet. */
  direction?: 'up' | 'right' | 'down' | 'left';
  /** Degrees clockwise from "up the page", when the drawing is explicit about it. */
  degrees?: number;
}

export interface PlanRoom {
  name: string;
  type: RoomType;
  /** Metres. Present **only** when the plan actually printed dimensions for this room. */
  width?: number;
  depth?: number;
  /** Exactly what the plan printed, e.g. `12'-4" × 15'-2"`. Kept so a human can check the conversion. */
  dimensionsText?: string;
  /** How the metres were arrived at: our own reading of the printed text, or the model's conversion. */
  dimensionsFrom?: 'text' | 'model';
  windows?: number;
  doors?: number;
}

export interface PlanFloor {
  label: string;
  rooms: PlanRoom[];
}

export interface FloorPlan {
  units: PlanUnits;
  floors: PlanFloor[];
  northArrow: PlanNorthArrow | null;
  notes: string[];
  source: 'nebius' | 'heuristic';
  model?: string;
  ms?: number;
  usd?: number | null;
  parsedAt: number;
}

/* ---------- feet, inches, millimetres ---------- */

export const FEET_M = 0.3048;
export const INCH_M = 0.0254;

/** Uncertainty a floor-plan dimension carries. Plans are drawn to the nearest inch and round. */
export const FLOORPLAN_UNCERTAINTY_M = 0.05;

/**
 * One printed length → metres. Understands every form a plan prints:
 * `12'`, `12'6"`, `12'-6"`, `12’6”`, `12 ft 6 in`, `3.80`, `3.80 m`, `3760 mm`.
 * `units` says what a bare number means on this plan; with `unknown` a bare number is read as metres
 * when it is small and has a decimal, and as feet otherwise (nobody prints a 16.00 m bedroom).
 */
export function lengthToMetres(raw: string, units: PlanUnits = 'unknown'): number | undefined {
  const s = raw.trim().replace(/[’‘]/g, "'").replace(/[”“]/g, '"').replace(/\s+/g, ' ');
  if (!s) return undefined;

  const mm = /^(\d+(?:[.,]\d+)?)\s*mm$/i.exec(s);
  if (mm) return num(mm[1]) / 1000;
  const cm = /^(\d+(?:[.,]\d+)?)\s*cm$/i.exec(s);
  if (cm) return num(cm[1]) / 100;

  // 12'6" · 12'-6" · 12 ft 6 in · 12' · 12 ft
  const ft = /^(\d+(?:[.,]\d+)?)\s*(?:'|ft\.?|feet)\s*(?:-|–)?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|''|in\.?|inches)?)?$/i.exec(s);
  if (ft) {
    const feet = num(ft[1]);
    const inches = ft[2] ? num(ft[2]) : 0;
    if (!Number.isFinite(feet) || inches >= 12.5) return undefined;
    return feet * FEET_M + inches * INCH_M;
  }
  // 6" on its own
  const inch = /^(\d+(?:[.,]\d+)?)\s*(?:"|in\.?|inches)$/i.exec(s);
  if (inch) return num(inch[1]) * INCH_M;

  const metre = /^(\d+(?:[.,]\d+)?)\s*(?:m|metres?|meters?)$/i.exec(s);
  if (metre) return num(metre[1]);

  const bare = /^(\d+(?:[.,]\d+)?)$/.exec(s);
  if (bare) {
    const v = num(bare[1]);
    if (!Number.isFinite(v) || v <= 0) return undefined;
    if (units === 'metres') return v;
    if (units === 'feet') return v * FEET_M;
    if (v >= 500) return v / 1000; // 3760 → mm
    if (v <= 20 && /[.,]/.test(bare[1])) return v; // 3.80 → metres
    return v * FEET_M;
  }
  return undefined;
}

function num(s: string): number {
  return Number(s.replace(',', '.'));
}

/**
 * A whole printed dimension pair → metres. `12'-4" × 15'-2"`, `3.80 x 4.42`, `3.25 × 4.00 m`,
 * `12'0" (3.66 m)` — the parenthesised metric restatement on a mixed-unit plan is preferred, because
 * it is the draughtsman's own conversion.
 */
export function metresFromDimensions(text: string, units: PlanUnits = 'unknown'): { width: number; depth: number } | undefined {
  if (!text) return undefined;
  const clean = text.replace(/[’‘]/g, "'").replace(/[”“]/g, '"').replace(/[\u00a0\u2007\u202f]/g, ' ').trim();

  // Prefer an explicit metric restatement in brackets.
  const bracket = /\(([^)]*)\)/.exec(clean);
  if (bracket) {
    const inner = pair(bracket[1], 'metres');
    if (inner) return inner;
  }
  return pair(clean.replace(/\([^)]*\)/g, ' '), units);
}

/** Two lengths agree if they round to the same centimetre — the precision a plan is printed to. */
const sameLength = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * What the plan printed, *minus* anything the metres beside it already say.
 *
 * A draughtsman's mixed-unit sheet prints `17'-5" × 19'-0" (5.30 × 5.78 m)`, and those bracketed
 * metres are exactly the numbers `metresFromDimensions` prefers and stores — so a UI that shows
 * "5.30 × 5.78 m" and then the printed string in brackets says the same pair three times. This
 * drops a restatement that agrees with the stored metres and returns `undefined` when nothing the
 * reader has not already been told is left, so the feet and inches survive and the echo does not.
 *
 * Pure, and it never *corrects* the printed string: a restatement that disagrees with the stored
 * metres is kept, because that disagreement is the thing a human is checking the conversion for.
 */
export function printedDimensions(text: string | undefined, width: number, depth: number): string | undefined {
  if (!text) return undefined;
  const stripped = text
    .replace(/\(([^)]*)\)/g, (whole, inner: string) => {
      const p = metresFromDimensions(inner, 'metres');
      return p && sameLength(p.width, width) && sameLength(p.depth, depth) ? ' ' : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return undefined;
  // What is left may itself be the metres (a purely metric sheet), in which case it is an echo too.
  const rest = metresFromDimensions(stripped, 'metres');
  if (rest && sameLength(rest.width, width) && sameLength(rest.depth, depth) && !/['"]/.test(stripped)) return undefined;
  return stripped;
}

const TIMES = /\s*(?:[×x✕*]|by)\s*/i;

/** Nothing anyone lives in is narrower than this, in metres. Used to catch a misread unit. */
const MIN_ROOM_M = 1.6;
const MAX_ROOM_M = 15;

function pair(text: string, units: PlanUnits): { width: number; depth: number } | undefined {
  const parts = text.split(TIMES);
  if (parts.length < 2) return undefined;
  const trailing = /\b(mm|cm|m|ft|feet|metres?|meters?)\b\s*$/i.exec(parts[1].trim());
  // `3.25 × 4.00 m`: the unit at the end governs both halves.
  const suffix = trailing ? trailing[1] : '';
  const left = withUnit(parts[0], suffix);
  const right = parts[1].trim();
  const read = (u: PlanUnits) => {
    const a = lengthToMetres(left, u);
    const b = lengthToMetres(right, u);
    return a != null && b != null && a > 0.3 && b > 0.3 && a < 60 && b < 60 ? { width: round2(a), depth: round2(b) } : undefined;
  };
  const first = read(units);
  /*
   * The declared unit is the model's claim about the whole sheet and it is sometimes wrong: the 1911
   * Paris plans print `3.74 x 4.70` in metres and get labelled "feet", which turns a bedroom into a
   * 1.14 m cupboard. Bare numbers carry no unit of their own, so when the declared reading produces a
   * room nobody could stand in and the metric reading produces an ordinary room, the room wins.
   * Only for numbers written with a decimal: `5 x 4` on a feet plan is a real 5 ft cupboard.
   */
  const decimal = /\d[.,]\d/.test(left) || /\d[.,]\d/.test(right);
  if (decimal && units !== 'metres' && (!first || Math.min(first.width, first.depth) < MIN_ROOM_M)) {
    const metric = read('metres');
    if (metric && metric.width >= MIN_ROOM_M && metric.depth >= MIN_ROOM_M && metric.width <= MAX_ROOM_M && metric.depth <= MAX_ROOM_M) return metric;
  }
  return first;
}

function withUnit(part: string, suffix: string): string {
  const t = part.trim();
  if (!suffix) return t;
  return /[a-z'"]$/i.test(t) ? t : `${t} ${suffix}`;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/* ---------- room names ---------- */

/**
 * Plans do not speak Audora's nine room types, and a 1911 Paris plan does not speak English.
 * `guessRoomType` handles the English rental vocabulary; this adds what plans actually print
 * (French, plus the abbreviations estate agents use).
 */
export function planRoomType(name: string, hint?: string): RoomType {
  const n = `${name} ${hint ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/\bw\.?\s?c\b|toilet|salle de bain|\bbains?\b|\bbath\b|powder|shower|ensuite|en-suite/.test(n)) return 'bathroom';
  if (/cuisine|kitchen|kitchenette|pantry|utility|laundry|scullery/.test(n)) return 'kitchen';
  if (/salle a manger|salle-a-manger|manger|dining|breakfast|nook/.test(n)) return 'dining';
  if (/\bsalon\b|salle de sejour|sejour|living|lounge|family|great room|sitting|reception/.test(n)) return 'living';
  // `antichambre` is tested before `chambre`: a Paris plan's antechamber is a hall, not a bedroom.
  if (/antichambre|entree|entry|hall|landing|corridor|couloir|escalier|stair|foyer|vestibule|passage|galerie|gallery|degagement/.test(n)) return 'hallway';
  if (/chambre|bedroom|\bbed\s?\d?\b|master|primary|guest room/.test(n)) return 'bedroom';
  if (/bureau|office|study|\bden\b|library/.test(n)) return 'office';
  if (/studio|loft|open plan/.test(n)) return 'studio';
  if (/garage|closet|w\.?i\.?c|wardrobe|store|storage|cellar|balcony|terrace|deck|patio|porch|garden/.test(n)) return 'other';
  return guessRoomType(name);
}

/* ---------- preparing the drawing ----------
 * A floor plan is often a thumbnail: the app's own demo plan is 600 px wide and its room labels
 * are six pixels tall. Measured on that plan, sending it as it comes back one room from one sheet;
 * the same drawing resampled to a 1600 px long edge comes back with twelve rooms across all three
 * sheets. No information is added — a vision model simply gets far more image tokens per glyph.
 *
 * Which is also why the original file goes in here, not a re-encoded copy: a JPEG pass at 600 px
 * turns those six-pixel letters to mush, and enlarging mush stays mush. Only an oversized plan is
 * resampled down, and a plan that is already a sensible size is passed through untouched. */

/** Long edge, in pixels, a small plan is enlarged to before the model reads it. */
export const PLAN_MIN_LONG_EDGE = 1600;
/** Long edge above which a plan is resampled down, to keep the request a sane size. */
export const PLAN_MAX_LONG_EDGE = 2400;

/**
 * The image actually sent to the vision model: the original bytes when they are a workable size,
 * enlarged when the plan is a thumbnail, reduced when it is a scan. Never throws — a failure here
 * hands back what it was given.
 */
export function preparePlanImage(dataUrl: string, min = PLAN_MIN_LONG_EDGE, max = PLAN_MAX_LONG_EDGE): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const long = Math.max(img.width, img.height);
      if (!long || (long >= min && long <= max)) return resolve(dataUrl);
      try {
        const scale = long < min ? Math.min(4, min / long) : max / long;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ---------- the model call ---------- */

const ROOM_TYPES: RoomType[] = ['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'studio', 'other'];

export const FLOORPLAN_SCHEMA = {
  type: 'object',
  properties: {
    units: { type: 'string', enum: ['feet', 'metres', 'mixed', 'unknown'] },
    north_arrow: {
      type: ['object', 'null'],
      properties: {
        present: { type: 'boolean' },
        direction: { type: ['string', 'null'], enum: ['up', 'right', 'down', 'left', null] },
        degrees: { type: ['number', 'null'] },
      },
      required: ['present'],
    },
    floors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          rooms: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ROOM_TYPES },
                dimensions_text: { type: ['string', 'null'] },
                width_m: { type: ['number', 'null'] },
                depth_m: { type: ['number', 'null'] },
                windows: { type: ['integer', 'null'] },
                doors: { type: ['integer', 'null'] },
              },
              required: ['name', 'type'],
            },
          },
        },
        required: ['label', 'rooms'],
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['units', 'floors', 'notes'],
};

export const FLOORPLAN_SYSTEM = `You read architectural floor plans for a real-estate product. Return JSON only.

Report every labelled room, on every floor the sheet shows. One entry per room: if the drawing shows two bedrooms, return two entries. Use the plan's own label as "name", verbatim and in its own language, without the dimensions.

"type" is one of: ${ROOM_TYPES.join(', ')}. Garages, closets, decks, balconies and stores are "other"; stairs, halls, landings and corridors are "hallway".

"dimensions_text" is the dimension string EXACTLY as printed next to that room — same digits, same feet and inch marks, same separator ("12'-4\\" x 15'-2\\"", "3.80 x 4.42"). Never invent, round, reformat or convert it. Omit it when no dimensions are printed for that room; do not measure the drawing yourself and do not copy another room's numbers.

"width_m" and "depth_m" are that same pair converted to metres (1 foot = 0.3048 m), or null when nothing is printed.

"units" describes what the plan prints: feet (with inches), metres, mixed, or unknown when no dimensions appear anywhere.

"floors" groups rooms by sheet. A plan often draws two or three sheets side by side on one page — read EVERY sheet, left to right, and return one "floors" entry per sheet. "label" names the STOREY that sheet draws, taken from its own title ("Ground Floor", "First Floor", "Basement"); never a room label, never the drawing's title caption. When a sheet carries no storey title, use "Ground Floor", "First Floor", "Second Floor" in sheet order. One unlabelled sheet on its own is "Floor plan".

"north_arrow" describes the compass arrow if the page has one. It is usually small: an arrow with a letter N beside or below it, often in a corner of a sheet. Report which way its head points on the page. Omit it (null) only when there is genuinely none.

"notes" are short, plain observations a leasing team should know: no dimensions printed, part of the sheet is unreadable, the plan covers more than one unit.`;

/**
 * The exact messages the product sends to read a plan (shared with the evaluation).
 *
 * The user turn is four words on purpose. Naming the listing in it ("Listing: 88 Alder Ln, Portland,
 * OR 97214. Read this floor plan.") was tried and measured on the demo townhouse plan: with the
 * address the model returned one room from one sheet, without it twelve rooms from three, twice each,
 * deterministically. The drawing is the whole task; anything else in the turn competes with it.
 */
export function floorPlanMessages(dataUrl: string) {
  return [
    { role: 'system', content: FLOORPLAN_SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Read this floor plan.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
}

export function emptyPlan(note: string, source: FloorPlan['source'] = 'heuristic'): FloorPlan {
  return { units: 'unknown', floors: [], northArrow: null, notes: [note], source, parsedAt: Date.now() };
}

/* ---------- floor labels ---------- */

/** Storey names, in sheet order. Past the fourth a plan is a tower and "Level 5" is the honest name. */
const STOREY_LABELS = ['Ground floor', 'First floor', 'Second floor', 'Third floor'];

export function storeyLabel(index: number): string {
  return STOREY_LABELS[index] ?? `Level ${index + 1}`;
}

/** Words that make a label a *storey* rather than a room. Multilingual to the extent plans are. */
const STOREY_WORDS =
  /\b(floor|storey|story|level|ground|basement|cellar|lower|upper|main|attic|loft|mezzanine|first|second|third|fourth|rez|rez-de-chauss|etage|plan|sheet)\b/i;

/** A label that is only the drawing's own title tells two sheets apart from each other not at all. */
const GENERIC_LABEL = /^(the\s+)?(floor\s*plan|plan|plans|floorplan|sheet|drawing|layout)$/i;

/**
 * The name a floor group gets.
 *
 * The vision model is asked for the storey each sheet draws, and on a plan whose sheets are not
 * titled it answers with whatever large caption it can see — which on the demo townhouse is
 * "2 CAR GARAGE", "DECK" and "FLOOR PLAN": two room labels and the drawing's own title. Those
 * names do not stay on the sheet; they end up on the rooms ("Deck · LIVING — 5.00 × 4.00 m") and on
 * the tour, telling the leasing team their living room is on a floor called Deck.
 *
 * So a label is kept only when it reads as a storey and is not simply the plan's title or one of
 * the rooms drawn on it; otherwise the sheet is named by its position, which is the one thing the
 * order of the sheets does tell us. `single` keeps the honest "Floor plan" for a one-sheet drawing,
 * where there is no storey to number.
 */
export function floorLabel(raw: unknown, index: number, rooms: PlanRoom[], opts: { single?: boolean; taken?: Set<string> } = {}): string {
  const label = String(raw ?? '').trim().replace(/\s+/g, ' ');
  const fallback = opts.single ? 'Floor plan' : storeyLabel(index);
  const isRoomName = rooms.some((r) => r.name.toLowerCase() === label.toLowerCase());
  const generic = GENERIC_LABEL.test(label);
  const usable =
    label.length > 0 &&
    label.length <= 40 &&
    !isRoomName &&
    STOREY_WORDS.test(label) &&
    // "Floor plan" on one sheet is a name; on three it is the title repeated.
    (!generic || Boolean(opts.single));
  const chosen = usable ? label : fallback;
  // Two sheets that came back with the same name are not one storey; number the second.
  return opts.taken && opts.taken.has(chosen.toLowerCase()) ? storeyLabel(index) : chosen;
}

/**
 * Model JSON → a `FloorPlan`, with the printed dimension text re-read here rather than trusted.
 * Exported so the evaluation scores the same normalisation the product ships.
 */
export function planFromJson(j: any): Omit<FloorPlan, 'source' | 'parsedAt'> {
  const units: PlanUnits = (['feet', 'metres', 'mixed', 'unknown'] as PlanUnits[]).includes(j?.units) ? j.units : 'unknown';
  const floorsIn: any[] = Array.isArray(j?.floors) ? j.floors : [];
  const withRooms = floorsIn
    .map((f) => ({
      raw: f?.label,
      rooms: dedupe((Array.isArray(f?.rooms) ? f.rooms : []).map((r: any) => roomFromJson(r, units)).filter((r: PlanRoom | null): r is PlanRoom => !!r)),
    }))
    .filter((f) => f.rooms.length > 0);
  const taken = new Set<string>();
  const floors: PlanFloor[] = withRooms.map((f, i) => {
    const label = floorLabel(f.raw, i, f.rooms, { single: withRooms.length === 1, taken });
    taken.add(label.toLowerCase());
    return { label, rooms: f.rooms };
  });

  const na = j?.north_arrow;
  const northArrow: PlanNorthArrow | null =
    na && (na.present === true || na.direction)
      ? {
          present: true,
          direction: ['up', 'right', 'down', 'left'].includes(na.direction) ? na.direction : undefined,
          degrees: Number.isFinite(Number(na.degrees)) ? Number(na.degrees) : undefined,
        }
      : null;

  const notes = (Array.isArray(j?.notes) ? j.notes : []).map(String).filter(Boolean).slice(0, 6);
  return { units, floors, northArrow, notes };
}

/** A floor plan drawn by a human has at most a couple of identically-labelled rooms on one storey. */
const MAX_IDENTICAL = 3;
const MAX_ROOMS_PER_FLOOR = 40;

/**
 * A vision model reading a soft, hand-lettered drawing can fall into a loop and emit the same room a
 * hundred times. Two identical "Chambre 3.74 × 4.70" entries are a real plan; a hundred are a stuck
 * decoder, and they would each become a room in the leasing team's tour.
 */
function dedupe(rooms: PlanRoom[]): PlanRoom[] {
  const seen = new Map<string, number>();
  const out: PlanRoom[] = [];
  for (const r of rooms) {
    const key = `${r.name.toLowerCase()}|${r.type}|${r.dimensionsText ?? ''}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > MAX_IDENTICAL) continue;
    out.push(r);
    if (out.length >= MAX_ROOMS_PER_FLOOR) break;
  }
  return out;
}

function roomFromJson(r: any, units: PlanUnits): PlanRoom | null {
  const name = String(r?.name ?? '').trim();
  if (!name) return null;
  const type: RoomType = ROOM_TYPES.includes(r?.type) ? r.type : planRoomType(name);
  const dimensionsText = typeof r?.dimensions_text === 'string' && r.dimensions_text.trim() ? r.dimensions_text.trim() : undefined;

  // Our own reading of the printed string beats the model's arithmetic; the model's numbers are the
  // fallback for a plan whose dimensions are printed in a form the regexes do not know.
  const read = dimensionsText ? metresFromDimensions(dimensionsText, units) : undefined;
  const mw = Number(r?.width_m);
  const md = Number(r?.depth_m);
  const modelDims = plausible(mw) && plausible(md) ? { width: round2(mw), depth: round2(md) } : undefined;
  const dims = read ?? modelDims;

  return {
    name,
    type,
    width: dims?.width,
    depth: dims?.depth,
    dimensionsText,
    dimensionsFrom: dims ? (read ? 'text' : 'model') : undefined,
    windows: Number.isFinite(Number(r?.windows)) ? Math.max(0, Math.round(Number(r.windows))) : undefined,
    doors: Number.isFinite(Number(r?.doors)) ? Math.max(0, Math.round(Number(r.doors))) : undefined,
  };
}

const plausible = (v: number) => Number.isFinite(v) && v > 0.3 && v < 60;

/**
 * Close whatever brackets a truncated JSON document left open, ignoring brackets inside strings.
 * Returns undefined when the text ends inside a string, where guessing would corrupt a value.
 */
function closeBrackets(text: string): string | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) return undefined;
  return text + stack.reverse().join('');
}

/**
 * A hand-lettered plan with thirty rooms can run the model out of output tokens mid-array. Rather
 * than lose the whole read, cut back to the last complete object and close the brackets: nine rooms
 * of a Paris plan beat none. The salvaged rooms are exactly the ones the model finished writing.
 */
export function salvageJson(text: string): any | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  const body = text.slice(start);
  for (let end = body.length; end > 0; ) {
    const cut = body.lastIndexOf('}', end - 1);
    if (cut < 0) return undefined;
    const closed = closeBrackets(body.slice(0, cut + 1));
    if (closed) {
      try {
        return JSON.parse(closed);
      } catch {
        /* keep cutting back */
      }
    }
    end = cut;
  }
  return undefined;
}

export function extractJson(text: string): any {
  const t = (text || '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = /\{[\s\S]*\}/.exec(t);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through to salvage */
      }
    }
    const salvaged = salvageJson(t);
    if (salvaged) return salvaged;
    throw new Error('No JSON in model output');
  }
}

/**
 * Read a unit's floor plan. Live: the vision model behind /api/ai/chat with a JSON schema.
 * No model: an empty plan carrying one note, so the create flow degrades to typed measurements.
 */
export async function parseFloorPlan(dataUrl: string): Promise<FloorPlan> {
  if (!useAudora.getState().providers.nebius) {
    return emptyPlan('No vision model is configured on the server, so the plan could not be read. Type each room in instead, or anchor from a photo.');
  }
  try {
    const image = await preparePlanImage(dataUrl);
    const r = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task: 'parse_floorplan',
        model: 'vision',
        messages: floorPlanMessages(image),
        schema: FLOORPLAN_SCHEMA,
        schemaName: 'floorplan',
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body?.error || `Floor-plan read failed (${r.status})`);
    const raw: string = body.content || '';
    const parsed = planFromJson(extractJson(raw));
    const notes = [...parsed.notes];
    // A very long answer can be cut off mid-array; `extractJson` salvages the rooms that landed.
    if (raw.trim().length && !raw.trim().endsWith('}')) notes.push('The model ran out of room mid-answer, so the last rooms on the plan may be missing. Add them by hand if you need them.');
    if (!parsed.floors.length) notes.unshift('No rooms could be read from this plan. A sharper or larger image usually fixes it.');
    else if (!planRooms(parsed).some((p) => p.width)) notes.unshift('This plan prints no dimensions, so the rooms carry names only. Anchor each room from its photo or a tape measure.');
    return { ...parsed, notes: notes.slice(0, 6), source: 'nebius', model: body.model, ms: body.ms, usd: body.usd, parsedAt: Date.now() };
  } catch (e: any) {
    console.warn('[audora] floor-plan parse failed:', e);
    return emptyPlan(`The floor plan could not be read (${e?.message || 'model error'}). You can still add rooms from photos or measurements.`);
  }
}

/* ---------- reading a parsed plan ---------- */

export interface FlatPlanRoom extends PlanRoom {
  floor: string;
  /** Stable key for a room inside one plan: floor index and room index. */
  key: string;
}

/** Every room on every floor, in sheet order, each carrying its floor label. */
export function planRooms(plan: Pick<FloorPlan, 'floors'>): FlatPlanRoom[] {
  const out: FlatPlanRoom[] = [];
  plan.floors.forEach((f, fi) => f.rooms.forEach((r, ri) => out.push({ ...r, floor: f.label, key: `${fi}:${ri}` })));
  return out;
}

/** How many of the plan's rooms actually came with printed dimensions. */
export function dimensionedRooms(plan: Pick<FloorPlan, 'floors'>): FlatPlanRoom[] {
  return planRooms(plan).filter((r) => r.width != null && r.depth != null);
}

/** "3 floors · 11 rooms · 8 with dimensions" — the one line the create step shows. */
export function planSummary(plan: Pick<FloorPlan, 'floors'>): string {
  const rooms = planRooms(plan);
  const dims = rooms.filter((r) => r.width != null).length;
  const floors = plan.floors.length;
  return `${floors} floor${floors === 1 ? '' : 's'} · ${rooms.length} room${rooms.length === 1 ? '' : 's'} · ${dims} with dimensions`;
}

/** `3.76 × 4.62 m`, from the metres we derived — never from the model's own restatement. */
export function metricText(room: Pick<PlanRoom, 'width' | 'depth'>): string | undefined {
  return room.width != null && room.depth != null ? `${room.width.toFixed(2)} × ${room.depth.toFixed(2)} m` : undefined;
}
