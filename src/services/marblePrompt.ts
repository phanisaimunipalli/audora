/**
 * The text prompt a room sends to Marble, compiled in the browser (docs/BACKEND.md section 3).
 *
 * The renderer itself is `shared/marblePrompt.ts`, which both builds compile, and this module
 * re-exports it unchanged: `server/prompt.ts` does the same on the other side, so the wizard and
 * the pipeline describe a room in the same words because they call the same function. (This file
 * used to carry a byte-identical copy of it, kept in step by a parity test; the copy is gone.)
 *
 * What lives here is the browser's own mapper: `roomPromptFacts` turns a `Room` from the store into
 * the `PromptFacts` the renderer takes, which is the browser's equivalent of `defaultRoomContext` +
 * `buildRecipe` on the server.
 *
 * Conventions:
 * - Pure. No clock, no randomness, no store: a `Room` and a `TourSite` in, one string out.
 * - Unknown attributes are omitted, never guessed. In particular the ceiling height is NOT stated:
 *   before a world exists the room's height is an assumption (`anchorFromCeiling`, the mock raw
 *   geometry), and a prompt must never invent a dimension the data did not contain.
 * - The compiled text is hashed into the browser recipe (`browserRecipe` in services/marble) and
 *   `disable_recaption` keeps it verbatim on Marble's side, so changing a phrase in the shared
 *   renderer changes every browser recipe hash.
 */
import type { Room, TourSite } from '@/state/types';
import { compileMarblePrompt, type PromptDoor, type PromptFacts } from '@shared/marblePrompt';

export * from '@shared/marblePrompt';

/** What the room knows that the prompt can use. Every field is optional except the type. */
export type RoomPromptInput = Pick<Room, 'type'> & Partial<Pick<Room, 'photo' | 'photos' | 'planDims' | 'anchor' | 'analysis' | 'northWallHeading'>>;

/**
 * Marble's own cap in reconstruction mode, and therefore the cap on what the prompt may describe.
 * It lives here, in the leaf module, and `services/marble` re-exports it under the same name: the
 * prompt must count exactly the shots `roomPhotos` sends, or it announces photographs Marble never
 * receives — and that count is part of the recipe that is hashed for the seed.
 */
export const MAX_ROOM_PHOTOS = 6;

/* ---------- the browser's facts: a Room, as the renderer above wants it ---------- */

/**
 * The door the prompt can state: the anchor's own door (the leasing team tapped it and declared its
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
