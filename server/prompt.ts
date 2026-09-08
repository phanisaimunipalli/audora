/**
 * The Marble prompt compiler, as the server sees it — docs/BACKEND.md section 3.
 *
 * The compiler itself is `shared/marblePrompt.ts`, compiled into both builds; this module is the
 * server's name for it and nothing else. Until the accuracy pass there were two byte-identical
 * copies of the renderer — one here, one in `src/services/marblePrompt.ts` — held together by
 * `tests/prompt-parity.test.ts`. There is now one function, imported by both, so the pipeline and
 * the wizard cannot drift apart in the first place.
 *
 * Kept as a module rather than deleted because `server/recipe.ts` and `server/pipeline.ts` name it,
 * and because "where does the server's prompt come from" should have an answer inside `server/`.
 * Relative imports carry the .js extension: server code emits under NodeNext.
 */
export * from '../shared/marblePrompt.js';
