/**
 * Nebius Token Factory is the model provider for every AI step in Audora:
 *   - photo analysis (vision model)          → room type, empty?, door visible, quality
 *   - auto stage (structured JSON output)    → a catalog arrangement, validated by the engine
 *   - furniture parsing (fast model)         → "sectional 220 by 95" → dimensions
 *   - listing copy + renter insights (text)  → leasing-team-facing prose
 * Every call goes through /api/ai/chat so the key stays on the server, and every call has a
 * deterministic fallback so the product works with no key at all.
 */
import type { PlacedPiece, RoomType } from '@/engine/types';
import { CATALOG, catalogFor, parseFurnitureText, guessKind } from '@/engine/catalog';
import { autoStage, resolveSemanticProposal, validateProposal, type SemanticPiece, type StagingStyle } from '@/engine/autostage';
import { availableLabel } from '@/lib/format';
import { useAudora } from '@/state/store';
import { summarize } from '@/screens/insights/stats';
import type { AnalyticsEvent, PhotoAnalysis, PhotoRecord, Room, Tour } from '@/state/types';

export interface AiMeta {
  source: 'nebius' | 'heuristic';
  model?: string;
  ms: number;
  usd?: number | null;
  tokens?: { in: number; out: number };
}

interface ChatResult {
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  usd?: number | null;
  ms: number;
}

function live(): boolean {
  return useAudora.getState().providers.nebius;
}

async function chat(task: string, model: 'text' | 'fast' | 'vision' | 'stager', messages: any[], schema?: object, opts?: { temperature?: number; max_tokens?: number }): Promise<ChatResult> {
  const r = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task, model, messages, schema, schemaName: task, ...opts }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error || `AI call failed (${r.status})`);
  return body as ChatResult;
}

function extractJson(text: string): any {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = /\{[\s\S]*\}/.exec(t);
    if (m) return JSON.parse(m[0]);
    throw new Error('No JSON in model output');
  }
}

const ROOM_TYPES: RoomType[] = ['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'studio', 'other'];

export function guessRoomType(name: string): RoomType {
  const n = name.toLowerCase();
  if (/living|lounge|family|great/.test(n)) return 'living';
  if (/bed|master|primary|guest/.test(n)) return 'bedroom';
  if (/kitchen/.test(n)) return 'kitchen';
  if (/dining|breakfast/.test(n)) return 'dining';
  if (/bath|powder|wc|toilet/.test(n)) return 'bathroom';
  if (/office|study|den/.test(n)) return 'office';
  if (/hall|entry|foyer|corridor/.test(n)) return 'hallway';
  if (/studio|loft/.test(n)) return 'studio';
  return 'other';
}

function heuristicAnalysis(photo: PhotoRecord, nameHint?: string): PhotoAnalysis {
  const quality = photo.brightness < 0.22 ? 'poor' : photo.brightness < 0.32 || photo.detail < 0.04 ? 'ok' : 'good';
  const notes: string[] = [];
  if (photo.brightness < 0.22) notes.push('Very dark. Reconstruction will be soft.');
  if (photo.width / photo.height < 1.1) notes.push('Portrait frame. A landscape shot gets more of the room.');
  if (photo.detail < 0.04) notes.push('Blank walls give the model little to work with.');
  return {
    roomType: nameHint ? guessRoomType(nameHint) : 'living',
    roomTypeConfidence: nameHint ? 0.6 : 0.3,
    isEmpty: true,
    doorVisible: true,
    quality,
    notes,
    caption: 'An empty room.',
    source: 'heuristic',
  };
}

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    room_type: { type: 'string', enum: ROOM_TYPES },
    room_type_confidence: { type: 'number' },
    is_empty: { type: 'boolean' },
    door_visible: { type: 'boolean' },
    door_box: {
      type: ['object', 'null'],
      properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
      required: ['x', 'y', 'w', 'h'],
    },
    quality: { type: 'string', enum: ['good', 'ok', 'poor'] },
    notes: { type: 'array', items: { type: 'string' } },
    caption: { type: 'string' },
  },
  required: ['room_type', 'room_type_confidence', 'is_empty', 'door_visible', 'quality', 'notes', 'caption'],
};

/** The exact messages the product sends for photo analysis (shared with the evaluation). */
export function analysisMessages(dataUrl: string, nameHint?: string) {
  return [
    {
      role: 'system',
      content:
        'You are a real-estate photo analyst. Look at one photo of a room and answer as JSON. room_type is one of: ' +
        ROOM_TYPES.join(', ') +
        '. is_empty: first list every piece of loose furniture you can see, even partially at the edge of the frame (a chair, a sofa arm, a bed, a table, a lamp); is_empty is true ONLY if that list is empty. Fitted units, appliances, bathroom fixtures, radiators, boxes and cushions on the floor do not count as furniture. door_visible is true when an interior door or door frame is in the frame. door_box is the normalised bounding box (0..1, x/y top-left, w/h) of a fully visible interior door, or null. quality reflects how well a 3D reconstruction would work: good, ok, poor (poor for very dark, blurry or cluttered frames). notes are short, plain, actionable.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: nameHint ? `The leasing team named this room "${nameHint}". Analyse the photo.` : 'Analyse the photo.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
}

/** Vision pass over the capture. Live: Nebius vision model with a JSON schema. Fallback: cheap image statistics. */
export async function analyzePhoto(photo: PhotoRecord, nameHint?: string): Promise<PhotoAnalysis> {
  const fallback = heuristicAnalysis(photo, nameHint);
  if (!live()) return fallback;
  try {
    const r = await chat('analyze_photo', 'vision', analysisMessages(photo.dataUrl, nameHint), ANALYSIS_SCHEMA, { temperature: 0.1, max_tokens: 500 });
    const j = extractJson(r.content);
    return {
      roomType: ROOM_TYPES.includes(j.room_type) ? j.room_type : fallback.roomType,
      roomTypeConfidence: Number(j.room_type_confidence ?? 0.5),
      isEmpty: Boolean(j.is_empty),
      doorVisible: Boolean(j.door_visible),
      doorBox: j.door_box && typeof j.door_box.w === 'number' ? j.door_box : undefined,
      quality: ['good', 'ok', 'poor'].includes(j.quality) ? j.quality : fallback.quality,
      notes: Array.isArray(j.notes) ? j.notes.slice(0, 4).map(String) : [],
      caption: String(j.caption || fallback.caption),
      source: 'nebius',
      model: r.model,
      ms: r.ms,
      usd: r.usd,
    };
  } catch (e) {
    console.warn('[audora] vision analysis fell back to heuristics:', e);
    return fallback;
  }
}

export const STAGE_SCHEMA = {
  type: 'object',
  properties: {
    pieces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          x: { type: 'number' },
          z: { type: 'number' },
          rot: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['itemId', 'x', 'z', 'rot'],
      },
    },
    rationale: { type: 'string' },
  },
  required: ['pieces'],
};

export interface AutoStageResult {
  pieces: PlacedPiece[];
  dropped: { itemId: string; reason: string }[];
  rationale?: string;
  meta: AiMeta;
}

function catalogLines(type: RoomType): string {
  return catalogFor(type).map((c) => `${c.id}: ${c.name}, ${Math.round(c.w * 100)}×${Math.round(c.d * 100)}cm${c.flat ? ' (rug, flat)' : ''}`).join('\n');
}

/* ---------- Baseline: the model returns raw coordinates (kept for the evaluation) ---------- */

export const STAGE_SYSTEM = 'You are an interior stager who thinks in metres. Output JSON only.';

export function stagePrompt(g: Room['geometry'], type: RoomType, style: StagingStyle): string {
  return `Room: ${type}, ${g.width.toFixed(2)}m wide (x) by ${g.depth.toFixed(2)}m deep (z), ceiling ${g.height.toFixed(2)}m.
Coordinate frame: origin at the room centre, x from ${(-g.width / 2).toFixed(2)} (west wall) to ${(g.width / 2).toFixed(2)} (east wall), z from ${(-g.depth / 2).toFixed(2)} (north wall) to ${(g.depth / 2).toFixed(2)} (south wall).
Door: on the ${g.door.wall} wall, ${g.door.offset.toFixed(2)}m from that wall's start, ${g.door.width.toFixed(2)}m wide. Keep a ${g.door.width.toFixed(2)}m square inside the door clear.
Windows: ${g.windows.map((w) => `${w.wall} wall at ${w.offset.toFixed(2)}m`).join('; ') || 'none'}.
Style: ${style}.
A piece's rot is radians about the vertical axis; rot 0 means its front faces south (+z), so a sofa with its back on the north wall has rot 0, on the south wall rot 3.1416, on the east wall rot -1.5708, on the west wall rot 1.5708.
Pieces sit flush to walls when their back is against them (centre = wall ± depth/2). Never overlap solids, leave 0.75m walkways, keep 0.45m between a sofa and coffee table.
Catalog (use these ids only):
${catalogLines(type)}
Return 4 to 8 pieces that make this room feel lived in for a renter.`;
}

/* ---------- Production: semantic placements resolved by the engine ---------- */

/**
 * The model says what goes where in a stager's words; the engine does the arithmetic. Placements:
 * wall (which wall, where along it), infront / beside / opposite / under (relative to an earlier piece
 * by ref), corner, centre. Every piece is resolved, clamped, repaired and validated by the engine.
 */
export const SEMANTIC_STAGE_SCHEMA = {
  type: 'object',
  properties: {
    pieces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          ref: { type: 'string' },
          optional: { type: 'boolean' },
          placement: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['wall', 'infront', 'beside', 'opposite', 'corner', 'centre', 'under'] },
              wall: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
              along: { type: 'string', enum: ['start', 'centre', 'end'] },
              of: { type: 'string' },
              side: { type: 'string', enum: ['left', 'right'] },
              gap: { type: 'number' },
              corner: { type: 'string', enum: ['nw', 'ne', 'sw', 'se', 'farFromDoor'] },
            },
            required: ['kind'],
          },
        },
        required: ['itemId', 'placement'],
      },
    },
    rationale: { type: 'string' },
  },
  required: ['pieces'],
};

export const SEMANTIC_STAGE_SYSTEM =
  'You are an interior stager. You choose which catalog pieces to use and describe where each goes in plain spatial terms; a geometry engine computes exact positions and rejects anything that overlaps or blocks the door. Output JSON only.';

export function semanticStagePrompt(g: Room['geometry'], type: RoomType, style: StagingStyle): string {
  const horizontal = g.door.wall === 'north' || g.door.wall === 'south';
  return `Room: ${type}, ${g.width.toFixed(2)}m wide (west-east) by ${g.depth.toFixed(2)}m deep (north-south), ceiling ${g.height.toFixed(2)}m. Floor area ${(g.width * g.depth).toFixed(1)}m².
Door: on the ${g.door.wall} wall, ${g.door.offset.toFixed(2)}m from that wall's ${horizontal ? 'west' : 'north'} end (wall length ${(horizontal ? g.width : g.depth).toFixed(2)}m). Keep the door clear.
Windows: ${g.windows.map((w) => `${w.wall} wall`).join('; ') || 'none'}.
Style: ${style}.
Placement vocabulary (one per piece, in order; later pieces may refer to earlier ones by ref):
- {"kind":"wall","wall":"north|south|east|west","along":"start|centre|end"}  back against that wall
- {"kind":"infront","of":"<ref>","gap":0.45}  centred in front of an earlier piece
- {"kind":"beside","of":"<ref>","side":"left|right","gap":0.1}  next to it, same facing
- {"kind":"opposite","of":"<ref>"}  against the wall facing an earlier piece (TV opposite the sofa)
- {"kind":"under","of":"<ref>"}  a rug under / in front of a piece
- {"kind":"corner","corner":"nw|ne|sw|se|farFromDoor"}
- {"kind":"centre"}
Mark decor as "optional": true so it is dropped before an essential piece is.
Catalog (use these ids only):
${catalogLines(type)}
Return 4 to 8 pieces that make this ${type} feel lived in for a renter, essentials first.`;
}

/**
 * Propose a complete arrangement. Live: the text model returns a semantic proposal (which pieces,
 * where in words) that the geometry engine resolves, repairs and validates. Fallback: the rule-based stager.
 */
export async function aiAutoStage(room: Room, style: StagingStyle): Promise<AutoStageResult> {
  const started = Date.now();
  const heuristic = () => ({ pieces: autoStage(room.geometry, room.type, style), dropped: [], meta: { source: 'heuristic' as const, ms: Date.now() - started } });
  if (!live()) {
    await new Promise((r) => setTimeout(r, 700));
    return heuristic();
  }
  try {
    const r = await chat(
      'auto_stage',
      'stager',
      [
        { role: 'system', content: SEMANTIC_STAGE_SYSTEM },
        { role: 'user', content: semanticStagePrompt(room.geometry, room.type, style) },
      ],
      SEMANTIC_STAGE_SCHEMA,
      { temperature: 0.4, max_tokens: 900 },
    );
    const j = extractJson(r.content);
    const proposal: SemanticPiece[] = Array.isArray(j.pieces) ? j.pieces : [];
    const { pieces, dropped } = resolveSemanticProposal(room.geometry, proposal, style);
    if (pieces.length < 2) {
      const h = heuristic();
      return { ...h, dropped, rationale: 'Model proposal failed validation; used the rule-based stager.', meta: { ...h.meta, source: 'heuristic', model: r.model, usd: r.usd } };
    }
    return {
      pieces,
      dropped,
      rationale: typeof j.rationale === 'string' ? j.rationale : undefined,
      meta: { source: 'nebius', model: r.model, ms: r.ms, usd: r.usd, tokens: { in: r.usage?.prompt_tokens ?? 0, out: r.usage?.completion_tokens ?? 0 } },
    };
  } catch (e) {
    console.warn('[audora] auto-stage fell back to heuristics:', e);
    return heuristic();
  }
}

/** Raw-coordinate validation re-exported for the evaluation baseline. */
export { validateProposal };

export interface ParsedFurniture {
  name: string;
  w: number;
  d: number;
  h: number;
  kind: PlacedPiece['kind'];
  flat: boolean;
  meta: AiMeta;
}

/** "sectional, 220 by 95" → metres. Regex first; the fast model only for text the regex cannot read. */
export async function parseFurniture(text: string): Promise<ParsedFurniture | null> {
  const started = Date.now();
  const local = parseFurnitureText(text);
  if (local) return { ...local, meta: { source: 'heuristic', ms: Date.now() - started } };
  if (!live()) return null;
  try {
    const r = await chat(
      'parse_furniture',
      'fast',
      [
        { role: 'system', content: 'Extract a furniture item and its footprint. Return JSON {"name": string, "w_cm": number, "d_cm": number, "h_cm": number|null}. w is the longest floor dimension. If the text has no dimensions, use typical dimensions for that item.' },
        { role: 'user', content: text },
      ],
      { type: 'object', properties: { name: { type: 'string' }, w_cm: { type: 'number' }, d_cm: { type: 'number' }, h_cm: { type: ['number', 'null'] } }, required: ['name', 'w_cm', 'd_cm'] },
      { temperature: 0, max_tokens: 120 },
    );
    const j = extractJson(r.content);
    const kind = guessKind(String(j.name || text));
    return {
      name: String(j.name || text),
      w: Number(j.w_cm) / 100,
      d: Number(j.d_cm) / 100,
      h: j.h_cm ? Number(j.h_cm) / 100 : 0.8,
      kind,
      flat: kind === 'rug',
      meta: { source: 'nebius', model: r.model, ms: r.ms, usd: r.usd },
    };
  } catch {
    return null;
  }
}

/**
 * The copy for the unit's listing page. Rental vocabulary throughout (docs/COPY.md): a leasing team
 * writes it, a renter reads it, and it never claims the rooms are "digitally staged" — staging is
 * deferred, and the only claim the model makes about itself is that it is AI-generated from photos.
 */
export async function listingCopy(tour: Tour, rooms: Room[]): Promise<{ text: string; meta: AiMeta }> {
  const started = Date.now();
  const facts = rooms
    .map((r) => `${r.name}: ${r.geometry.width.toFixed(1)} × ${r.geometry.depth.toFixed(1)}m, ceiling ${r.geometry.height.toFixed(2)}m. Anchor: ${r.anchor.label}.`)
    .join('\n');
  const rent = tour.price ? `${tour.price}. ` : '';
  const fallback = `${tour.address}. ${rent}${rooms.length} room${rooms.length === 1 ? '' : 's'} a renter can walk at eye height and measure before they visit. ${rooms
    .map((r) => `${r.name} is ${r.geometry.width.toFixed(1)} by ${r.geometry.depth.toFixed(1)} metres`)
    .join(', ')}. The 3D model is AI-generated from photos of the unit and checked against its floor plan; every dimension carries its measurement anchor.`;
  if (!live()) return { text: fallback, meta: { source: 'heuristic', ms: Date.now() - started } };
  try {
    const r = await chat(
      'listing_copy',
      'text',
      [
        {
          role: 'system',
          content:
            'Write the listing copy a leasing team puts on a rental unit. 70 to 110 words, plain and specific, no superlatives, no emojis. ' +
            'Say "renter", never "buyer"; say "rent per month" and "available from", never a sale price. Mention real room dimensions in metres. ' +
            'End with a sentence saying the 3D model of the unit is AI-generated from photos and can be walked and measured before a viewing. ' +
            'Never claim the rooms are staged or furnished.',
        },
        {
          role: 'user',
          content: `Address: ${tour.address}. ${tour.price ? `Rent ${tour.price}. ` : ''}${availableLabel(tour.availableFrom) ? `Available from ${availableLabel(tour.availableFrom)}. ` : ''}${tour.beds ? `${tour.beds} bed, ` : ''}${tour.baths ? `${tour.baths} bath, ` : ''}${tour.sqft ? `${tour.sqft} sqft. ` : ''}\nRooms:\n${facts}`,
        },
      ],
      undefined,
      { temperature: 0.5, max_tokens: 260 },
    );
    return { text: r.content.trim(), meta: { source: 'nebius', model: r.model, ms: r.ms, usd: r.usd } };
  } catch {
    return { text: fallback, meta: { source: 'heuristic', ms: Date.now() - started } };
  }
}

/**
 * Turn renter activity into three things a leasing team can act on.
 *
 * The activity that exists while staging is deferred is walking, measuring, lingering in a room and
 * sharing the link — so that is what these sentences are about (docs/COPY.md). Furniture fit tests
 * are still counted, because the events are still recorded when someone turns staging on, but they
 * never lead: a room measured over and over is the signal the listing is not describing it.
 */
export async function fitInsights(tour: Tour, rooms: Room[], events: AnalyticsEvent[]): Promise<{ insights: string[]; meta: AiMeta }> {
  const started = Date.now();
  const s = summarize(events, rooms);
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name || 'a room';
  const dims = (id: string) => {
    const g = rooms.find((r) => r.id === id)?.geometry;
    return g ? `${g.width.toFixed(1)} × ${g.depth.toFixed(1)} m` : undefined;
  };

  const fallback: string[] = [];
  const measured = [...s.rooms].filter((r) => r.measures > 0).sort((a, b) => b.measures - a.measures);
  const top = measured[0];
  if (top) {
    const size = dims(top.roomId);
    fallback.push(
      `${top.name} was measured ${top.measures} time${top.measures === 1 ? '' : 's'} — more than any other room. Put its dimensions${size ? ` (${size})` : ''} in the listing text so a renter does not have to go looking.`,
    );
  }
  const unwalked = s.rooms.filter((r) => r.walked === 0);
  if (s.visitors > 0 && s.walked < s.visitors) {
    fallback.push(`${s.walked} of ${s.visitors} renter${s.visitors === 1 ? '' : 's'} walked past the first room. Lead the listing with the link, not with a photo carousel, so the walk is the first thing they meet.`);
  } else if (unwalked.length && s.visitors > 0) {
    fallback.push(`Nobody has walked ${listNamesOf(unwalked.map((r) => r.name))} yet. Check the room order: a renter walks them in the order the unit lists them.`);
  }
  if (s.shares > 0) {
    fallback.push(`The link has been shared ${s.shares} time${s.shares === 1 ? '' : 's'} — renters are sending this unit on to someone else. Keep it on every marketplace listing for this unit, not just the property's own site.`);
  } else if (s.visitors > 0) {
    fallback.push('Nobody has passed the link on yet. It is the cheapest reach this unit has; make sure it is in the feed and not only in the email.');
  }
  const failing = s.rooms.filter((r) => r.nofits >= 2).sort((a, b) => b.nofits - a.nofits)[0];
  if (failing) fallback.push(`${failing.nofits} of ${failing.tests} furniture tests did not fit ${roomName(failing.roomId)}. Say what does fit — a renter who finds out at the viewing does not come back.`);
  if (!fallback.length) fallback.push('Not enough renter activity yet. Put the link on the unit\u2019s listing page to start the loop.');

  if (!live()) return { insights: fallback.slice(0, 3), meta: { source: 'heuristic', ms: Date.now() - started } };
  try {
    const summary = s.rooms
      .map((r) => `${r.name}${dims(r.roomId) ? ` (${dims(r.roomId)})` : ''}: ${r.walked} walked, ${r.measures} measurements${r.tests ? `, ${r.tests} furniture tests of which ${r.nofits} did not fit` : ''}`)
      .join('\n');
    const r = await chat(
      'renter_insights',
      'fast',
      [
        {
          role: 'system',
          content:
            'You advise a leasing team on one rental unit. Given what renters did in its 3D model — visits, walks, measurements per room, shares — return JSON ' +
            '{"insights": [three short, concrete sentences]}: what to change in the listing text, the room order, or where the link is published. ' +
            'Say "renter" and "unit", never "buyer", "seller" or "sale". Do not recommend staging or furniture; the product is the measured model.',
        },
        {
          role: 'user',
          content: `Unit ${tour.address}. ${s.visitors} renters, ${s.walked} walked, ${s.measures} measurements, ${s.shares} shares over the last ${s.windowDays} days.\n${summary || 'No room activity yet.'}`,
        },
      ],
      { type: 'object', properties: { insights: { type: 'array', items: { type: 'string' } } }, required: ['insights'] },
      { temperature: 0.3, max_tokens: 220 },
    );
    const j = extractJson(r.content);
    const insights = Array.isArray(j.insights) ? j.insights.map(String).slice(0, 3) : fallback;
    return { insights, meta: { source: 'nebius', model: r.model, ms: r.ms, usd: r.usd } };
  } catch {
    return { insights: fallback.slice(0, 3), meta: { source: 'heuristic', ms: Date.now() - started } };
  }
}

/** "the kitchen", "the kitchen and the hall", "the kitchen, the hall and the office". */
function listNamesOf(names: string[]): string {
  const lower = names.map((n) => `the ${n.toLowerCase()}`);
  if (lower.length <= 1) return lower[0] ?? '';
  return `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
}

export const CATALOG_SIZE = CATALOG.length;
