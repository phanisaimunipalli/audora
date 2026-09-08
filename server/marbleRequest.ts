/**
 * The /api/marble/generate request body → the World Labs `worlds:generate` request, as a pure
 * function. server/api.ts owns the credit guard and the HTTP; this module owns the mapping, so a
 * unit test can check what would be sent to Marble without a server, a key, or a network.
 *
 * Conventions:
 * - It must compile under tsconfig.node.json, tsconfig.server.json (NodeNext) and the app config
 *   that type-checks tests/, so its one import is a sibling in server/ with the .js extension, and
 *   it is only for the provider's own limits (which must not be written down twice).
 * - Nothing here is random and nothing reads a clock: the same body always maps to the same
 *   request (docs/BACKEND.md section 2). The seed the browser derived from its recipe is passed
 *   through untouched, and `disable_recaption` goes on the world prompt so the compiled text is the
 *   text Marble uses.
 * - Validation answers with the status and sentence the route sends back; it never throws.
 */

import { MARBLE_MAX_IMAGES, MARBLE_PLAIN_IMAGES, SEED_MAX } from './recipe.js';

/**
 * Marble takes 4 images in a multi-image prompt, or 8 in reconstruction mode, and its seed is a
 * uint32. They are the provider's numbers, so they are written down once (server/recipe.ts) and
 * re-exported here under the names this module's callers already use.
 */
export { MARBLE_MAX_IMAGES, MARBLE_PLAIN_IMAGES };
export const MARBLE_SEED_MAX = SEED_MAX;
/** Tags: `audora` plus whatever the caller adds, capped so a tag list can never become a payload. */
export const MARBLE_MAX_TAGS = 10;
export const MARBLE_MAX_TAG_LENGTH = 64;
export const DEFAULT_TEXT_PROMPT = 'An empty residential room, photographed from the doorway. Keep the real geometry.';

export interface MarbleImageContent {
  source: 'data_base64';
  data_base64: string;
  extension: string;
}

export type MarbleWorldPrompt =
  | { type: 'image'; image_prompt: MarbleImageContent; text_prompt: string; disable_recaption?: boolean }
  | {
      type: 'multi-image';
      multi_image_prompt: { azimuth?: number; content: MarbleImageContent }[];
      reconstruct_images: boolean;
      text_prompt: string;
      disable_recaption?: boolean;
    };

/** Exactly what is POSTed to `worlds:generate`. */
export interface MarbleGenerateRequest {
  display_name: string;
  model: string;
  tags: string[];
  permission: { public: boolean; allow_id_access: boolean };
  seed?: number;
  world_prompt: MarbleWorldPrompt;
}

export type MarbleGenerateResult = { request: MarbleGenerateRequest } | { status: number; error: string };

export interface MarbleModelIds {
  draft: string;
  full: string;
}

/** Split a base64 image data URL into the bytes and the extension Marble wants (`jpg`, `png`, ...). */
export function dataUrlToBase64(dataUrl: string): { base64: string; extension: string } {
  const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Expected a base64 image data URL');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  return { base64: m[2], extension: ext };
}

/** A valid Marble seed (an integer in 0..2^32-1), or undefined when none was sent. Throws on a bad one. */
export function parseSeed(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MARBLE_SEED_MAX) {
    throw new Error(`seed must be an integer between 0 and ${MARBLE_SEED_MAX}`);
  }
  return n;
}

/** `audora` first, then the caller's tags: strings only, trimmed, deduplicated, capped. */
export function mergeTags(raw: unknown): string[] {
  const out = ['audora'];
  if (!Array.isArray(raw)) return out;
  for (const t of raw) {
    if (out.length >= MARBLE_MAX_TAGS) break;
    if (typeof t !== 'string') continue;
    const tag = t.trim();
    if (!tag || tag.length > MARBLE_MAX_TAG_LENGTH || out.includes(tag)) continue;
    out.push(tag);
  }
  return out;
}

/**
 * Build the Marble request from a /api/marble/generate body.
 *
 * `images` is the general form — `{ dataUrl, azimuth? }` per angle, in the order the seller shot
 * them — and `imageDataUrl` stays for the single-photo callers. An `azimuth` (degrees round the
 * capture point, 0 = the first shot) tells Marble where each angle faces instead of making it guess.
 * Shape per the World API's own schema: `multi_image_prompt: [{ azimuth?, content: { source,
 * data_base64, extension } }]`, with `reconstruct_images` once there are more than four.
 */
export function marbleGenerateRequest(body: any, models: MarbleModelIds): MarbleGenerateResult {
  const angles: { dataUrl: string; azimuth?: number }[] =
    Array.isArray(body?.images) && body.images.length ? body.images.filter((a: any) => typeof a?.dataUrl === 'string') : [{ dataUrl: body?.imageDataUrl }];
  if (!angles.length || typeof angles[0].dataUrl !== 'string') return { status: 400, error: 'No image supplied.' };

  let seed: number | undefined;
  try {
    seed = parseSeed(body?.seed);
  } catch (e: any) {
    return { status: 400, error: e?.message || 'Bad seed.' };
  }

  let shots: (ReturnType<typeof dataUrlToBase64> & { azimuth?: number })[];
  try {
    shots = angles.slice(0, MARBLE_MAX_IMAGES).map((a) => ({ ...dataUrlToBase64(a.dataUrl), azimuth: Number.isFinite(Number(a.azimuth)) ? Number(a.azimuth) : undefined }));
  } catch (e: any) {
    return { status: 400, error: e?.message || 'Bad image.' };
  }

  const textPrompt = typeof body?.textPrompt === 'string' && body.textPrompt.trim() ? body.textPrompt : DEFAULT_TEXT_PROMPT;
  // Only a boolean turns recaptioning off (or explicitly on); anything else leaves Marble's default.
  const recaption = typeof body?.disableRecaption === 'boolean' ? { disable_recaption: body.disableRecaption } : {};
  const world_prompt: MarbleWorldPrompt =
    shots.length === 1
      ? {
          type: 'image',
          image_prompt: { source: 'data_base64', data_base64: shots[0].base64, extension: shots[0].extension },
          text_prompt: textPrompt,
          ...recaption,
        }
      : {
          type: 'multi-image',
          multi_image_prompt: shots.map((s) => ({
            ...(s.azimuth == null ? {} : { azimuth: s.azimuth }),
            content: { source: 'data_base64', data_base64: s.base64, extension: s.extension },
          })),
          reconstruct_images: shots.length > MARBLE_PLAIN_IMAGES,
          text_prompt: textPrompt,
          ...recaption,
        };

  return {
    request: {
      display_name: String(body?.displayName || 'Audora room').slice(0, 64),
      model: body?.tier === 'full' ? models.full : models.draft,
      tags: mergeTags(body?.tags),
      permission: { public: false, allow_id_access: true },
      ...(seed === undefined ? {} : { seed }),
      world_prompt,
    },
  };
}
