/**
 * Marble's request limits, and the one rule that decides reconstruction mode.
 *
 * These numbers are part of the **recipe**, so the browser and the server have to agree on them
 * exactly: a recipe hash computed with a different threshold names a different world, and the
 * pipeline would regenerate a room it already has (or worse, attach one it did not ask for). They
 * lived as the literal `4` in three files — `server/recipe.ts`, `server/marbleRequest.ts` and
 * `src/services/marble.ts` — which is three chances to drift; this is the single copy both sides
 * import.
 *
 * Dependency-free and const-only: nothing here reads a clock, a network or an environment.
 */

/**
 * How many images Marble accepts in a plain multi-image prompt, and in reconstruction mode. The
 * provider's own numbers, and the reason {@link MARBLE_MAX_IMAGES} is the cap on any request.
 */
export const MARBLE_PLAIN_IMAGES = 4;
export const MARBLE_MAX_IMAGES = 8;

/**
 * The number of angles at which a room stops being a *prompt* and becomes a *reconstruction*.
 *
 * docs/ACCURACY.md 3.4: "reconstruction mode (`reconstruct_images`) whenever a room has more than
 * one photo". Two shots of one room are two views of one geometry, and telling Marble so is what
 * makes the second angle buy accuracy rather than just variety — without it the extra images are
 * read as further description of what to imagine, which is the opposite of what a measured room
 * wants. It is deliberately *not* {@link MARBLE_PLAIN_IMAGES}: that number is how many pictures fit
 * in a request, not what they mean.
 */
export const MARBLE_RECONSTRUCT_MIN_IMAGES = 2;

/** Whether a request carrying this many images asks Marble to reconstruct rather than generate. */
export function reconstructsImages(count: number): boolean {
  return count >= MARBLE_RECONSTRUCT_MIN_IMAGES;
}
