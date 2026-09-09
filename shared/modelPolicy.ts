/**
 * Which Marble model reconstructs a room — one rule, four callers.
 *
 * docs/ACCURACY.md 3.5: draft is one model for every room (it is the instant preview and carries no
 * metric scale, so there is nothing for a bigger model to be better at); full quality routes a room
 * the plan draws over {@link PLUS_AREA_M2} m², or one the plan calls open plan, to
 * {@link FULL_PLUS_MODEL}, which does not lose the far end of a large volume.
 *
 * The rule lives here rather than in `src/screens/create/intake.ts` because four places have to
 * reach the same answer and two of them are on the server:
 *
 * 1. the wizard's launch step, which *shows* the leasing team which model each room will use;
 * 2. `src/state/jobs.ts`, which puts that model into the browser recipe and onto the request;
 * 3. `server/pipeline.ts` `planRecipes`, which builds the same recipe from the stored rows;
 * 4. `server/marbleRequest.ts`, which decides whether a requested model may be run at all.
 *
 * The model id is hashed into the recipe (docs/BACKEND.md §2), so a disagreement between any two of
 * them is not a cosmetic drift: it is a recipe hash naming a world that was never generated, and a
 * room regenerated at full price because the cache key moved. `shared/` is the only code both
 * builds import, so this is the only place the rule can live once.
 *
 * Pure and dependency-free: no clock, no randomness, no I/O, const thresholds with their reason
 * beside them.
 */

import type { RoomType } from './marblePrompt.js';

/** Mirrors `Tier` in src/state/types.ts and `RecipeTier` in server/recipe.ts — the same two words. */
export type ModelTier = 'draft' | 'full';

/* ---------- the model ids ---------- */

/**
 * What each tier runs when nothing overrides it. `MARBLE_DRAFT_MODEL` / `MARBLE_FULL_MODEL` in the
 * environment replace them per deployment (`models()` in server/api.ts), and the browser learns the
 * real ids from `/api/status` — these are the fallback, and the ids the tests and the copy name.
 */
export const DEFAULT_DRAFT_MODEL = 'marble-1.0-draft';
export const DEFAULT_FULL_MODEL = 'marble-1.1';

/** How a model's larger sibling is named. The suffix is the whole rule, so a rename keeps it. */
export const MARBLE_PLUS_SUFFIX = '-plus';

/** The larger model a big or open-plan room goes to. Same tier, same price band, more capacity. */
export const FULL_PLUS_MODEL = `${DEFAULT_FULL_MODEL}${MARBLE_PLUS_SUFFIX}`;

/** The `-plus` sibling of a model id, for a deployment that renamed its models. */
export function plusModelOf(model: string): string {
  return model.endsWith(MARBLE_PLUS_SUFFIX) ? model : `${model}${MARBLE_PLUS_SUFFIX}`;
}

/** The model ids a server resolves each tier to (`models()` in server/api.ts, `/api/status`). */
export interface ModelIds {
  draft: string;
  full: string;
}

/** The same pair as the browser store holds it (`ProviderStatus.models`), where either may be unknown. */
export interface TierModels {
  marbleDraft?: string;
  marbleFull?: string;
}

/** The tier's own model: what a room uses unless it is large or open plan. */
export function baseModelFor(tier: ModelTier, models?: TierModels): string {
  return tier === 'full' ? models?.marbleFull || DEFAULT_FULL_MODEL : models?.marbleDraft || DEFAULT_DRAFT_MODEL;
}

/* ---------- the rule ---------- */

/** Past this much printed floor a single `marble-1.1` reconstruction starts losing the far end. */
export const PLUS_AREA_M2 = 30;

/** A room type that is one open volume rather than a box with a door. */
export const OPEN_PLAN_TYPES: readonly RoomType[] = ['studio'];

/** Names a draughtsman gives to one room that is really two or three. */
const OPEN_PLAN_NAME = /open[\s-]?plan|open[\s-]?concept|great\s?room|living[\s/-]*(?:and\s+)?(?:dining|kitchen)|kitchen[\s/-]*(?:and\s+)?(?:dining|living)|dining[\s/-]*(?:and\s+)?living|kitchen\s*diner|l-?shaped/i;

/**
 * The only facts the rule reads.
 *
 * Stated structurally because it has callers holding four different room shapes: the wizard's
 * `DraftRoom`, the persisted `Room`, a `RoomRow` from the database and a test's literal. One rule,
 * one adapter each, so the model the launch step *shows* is provably the model the generation
 * *asks for*.
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

export type PlusReason = 'area' | 'open-plan';

export function isOpenPlanRoom(room: ModelRoom): boolean {
  if (OPEN_PLAN_TYPES.includes(room.type)) return true;
  return OPEN_PLAN_NAME.test(room.name) || OPEN_PLAN_NAME.test(room.planRoomName ?? '');
}

/** The floor area the *plan* asserts, or undefined when it printed none. Only this drives the tier. */
export function planAreaOf(room: ModelRoom): number | undefined {
  const { planWidthM: w, planDepthM: d } = room;
  return typeof w === 'number' && typeof d === 'number' && Number.isFinite(w) && Number.isFinite(d) ? w * d : undefined;
}

/**
 * Why this room needs {@link FULL_PLUS_MODEL}, or undefined when plain full quality is enough.
 *
 * The area test reads the **plan's** dimensions, not the room's own: a room's own numbers come from
 * the reconstruction we have not run yet, so using them would let a bad guess pick the model. With
 * no plan dimensions the type and the name still decide.
 */
export function plusReasonOf(room: ModelRoom): PlusReason | undefined {
  if (isOpenPlanRoom(room)) return 'open-plan';
  const area = planAreaOf(room);
  return area != null && area > PLUS_AREA_M2 ? 'area' : undefined;
}

export interface ModelChoice {
  model: string;
  /** Set only when the choice is the larger model. */
  reason?: PlusReason;
  /** The sentence next to the room in the launch list. */
  text: string;
}

/**
 * The model id a room should be reconstructed with, from the structural shape.
 *
 * `models` is what the server said it runs (`/api/status`); the `-plus` choice is Audora's own
 * routing decision and keeps its canonical id, which is why a server default does not override it.
 */
export function modelForModelRoom(room: ModelRoom, tier: ModelTier, models?: TierModels): ModelChoice {
  if (tier === 'draft') return { model: baseModelFor('draft', models), text: 'Instant preview · no metric scale' };
  const reason = plusReasonOf(room);
  if (!reason) return { model: baseModelFor('full', models), text: 'Full quality · returns metric scale' };
  const area = planAreaOf(room);
  return {
    model: FULL_PLUS_MODEL,
    reason,
    text:
      reason === 'open-plan'
        ? 'Open plan, so it goes to the larger model'
        : `${area!.toFixed(1)} m² of floor is over ${PLUS_AREA_M2} m², so it goes to the larger model`,
  };
}

/* ---------- the allowlist ---------- */

/**
 * Every model id this server will run for a tier — the set `modelForModelRoom` can return for it,
 * plus the tier model's own `-plus` sibling so a deployment that renamed its models still routes
 * large rooms. Draft has one: there is no draft-plus, and a draft request naming the full model is
 * a request for a tier it did not pay for.
 */
export function knownModels(tier: ModelTier, models: ModelIds): string[] {
  const base = tier === 'full' ? models.full : models.draft;
  if (tier !== 'full') return [base];
  return [...new Set([base, plusModelOf(base), FULL_PLUS_MODEL])];
}

export type ModelResolution = { model: string } | { error: string };

/**
 * The model a request may run: the tier's default when none was named, the named one when it is a
 * model this tier knows, and an error otherwise.
 *
 * An unknown id is refused rather than quietly replaced with the default, because the caller's
 * recipe hash names the model it asked for. Substituting one would spend credits on a world whose
 * recorded hash describes a request that was never made — the exact failure `recipe_hash` exists to
 * prevent — so the honest answer is 400 and no generation.
 */
export function resolveModel(tier: ModelTier, requested: unknown, models: ModelIds): ModelResolution {
  const allowed = knownModels(tier, models);
  if (requested === undefined || requested === null || requested === '') return { model: allowed[0] };
  if (typeof requested !== 'string') return { error: `model must be a string, got ${typeof requested}` };
  const name = requested.trim();
  if (!name) return { model: allowed[0] };
  if (allowed.includes(name)) return { model: name };
  return { error: `Unknown Marble model ${JSON.stringify(name)} for the ${tier} tier. This server runs ${allowed.join(' or ')}.` };
}
