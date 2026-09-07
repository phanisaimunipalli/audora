# Audora

**Matterport, but AI generated.** One photo of an empty room becomes a walkable, honestly measured 3D space that a buyer can test their own furniture inside.

- Seller or agent: paste a listing URL or upload room photos, tap the door in each photo (the *scale anchor*), hit Generate.
- Generation takes minutes (World Labs Marble draft ≈ 1 min, full ≈ 10 min). Audora treats it like a deep-research job: it starts instantly, shows honest progress, you can leave, and you get a browser notification, an in-app toast and a title badge when it is ready. Jobs survive reloads.
- Buyer: opens a share link, lands standing in the room at 1.60 m eye height, walks it, toggles staging off to see it bare, measures anything, and types "sectional, 220 by 95" to get a verdict: *Your sectional fits. 0.83 m walkway remains to the window wall.* My Stuff remembers their furniture across listings.
- Agent dashboard: visitors, walked, tested, most-tested pieces, fit failures per room.

Every number in the app is derived from one declared reference (door 2.03 m, outlet 0.30 m, a typed wall, a floor plan) with a stated ± uncertainty, shown permanently. Every artifact is labelled *digitally staged*.

## Run it

```bash
npm install
cp .env.example .env     # optional: add keys, see below
npm run dev              # http://localhost:5173
```

Without keys the app runs fully in **mock mode**: reconstruction is simulated with honest timing and cost numbers, and every AI step falls back to a deterministic rule-based version. A demo listing, *1247 Oak Street*, is seeded on first run (public link: `/t/oak1247`).

```bash
npm run typecheck   # tsc
npm test            # vitest: geometry, anchor, fit report, auto-stage
npm run build       # production bundle in dist/
npm run preview     # serves dist/ with the same /api proxy
```

## Deploy (Render, or any Node host)

`npm run build` produces `dist/` (the app) and `dist-server/` (the production server, compiled from
`server/prod.ts`). `npm start` runs it with nothing but Node: it serves `dist/` with gzip and
immutable caching for hashed bundles, answers client-side routes with the app shell, and mounts the
same `/api/*` handler the dev server uses so keys never reach the browser.

| Render setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Environment | `WORLDLABS_API_KEY`, `NEBIUS_API_KEY`, `VITE_SHADEMAP_KEY` (build-time: it is inlined into the bundle, so redeploy after changing it), optional `MARBLE_MAX_GENERATIONS` |

`PORT` and `HOST` are read from the environment (Render sets `PORT`). The AI cost log under
`.audora/` is written to the instance's disk and does not survive a redeploy; that is fine, it only
feeds the evaluation write-up.

## Keys (server-side only)

`.env` is read by the Vite dev/preview server (`server/api.ts`) and never shipped to the browser. Nothing prefixed `VITE_` is used for secrets.

| Variable | What it enables |
| --- | --- |
| `WORLDLABS_API_KEY` | Real reconstruction with World Labs Marble (`marble-1.0-draft` by default, `marble-1.1` for full quality). |
| `NEBIUS_API_KEY` | Photo analysis (vision), auto staging (structured JSON), furniture parsing, listing copy and fit insights on Nebius Token Factory open models. |
| `MARBLE_MAX_GENERATIONS` | Credit guard: live generations allowed per server process (default 3). |
| `NEBIUS_VISION_MODEL`, `NEBIUS_TEXT_MODEL`, `NEBIUS_FAST_MODEL` | Model overrides. |

With a Marble key present, generation is **live by default**. Turn on *Prefer simulated reconstruction* in `/settings` while developing.

## How it is built

```
src/engine/     pure metric engine: oriented-rectangle geometry, wall clamp/snap, anchor
                math with uncertainty, fit report (overlaps, bounds, door swing, walkways),
                catalog with real dimensions, rule-based auto-stage, buyer verdicts. Tested.
src/state/      zustand store persisted to localStorage; the job runner (deep-research UX);
                BroadcastChannel collaboration; demo seed.
src/services/   marble.ts (World Labs), ai.ts (Nebius Token Factory), listing.ts, mockWorld.ts
server/api.ts   /api/* proxy mounted on the Vite server; keys stay here.
src/three/      react-three-fiber room shell, walk/orbit controls, Spark splat layer,
                measure tool, minimap, listing stills.
src/screens/    tour viewer, stage editor, publish, insights.
src/routes/     landing, create wizard, tours, hub, public tour, dashboard, settings.
```

Coordinate frame: metres, room centre at the origin, floor at y=0, x east, z south. Furniture is procedural and metric, so the scale claim is provable by construction rather than asserted.

## Where the AI is

| Step | Model (Token Factory id) | Why |
| --- | --- | --- |
| Reconstruction | World Labs Marble `marble-1.0-draft` (default) / `marble-1.1` | Turns one photo into a navigable world in ~35 s (draft) or ~10 min (full). Draft worlds carry no metric scale; Audora's anchor supplies the truth about size. |
| Photo analysis | `openbmb/MiniCPM-V-4_5` (vision, structured outputs), fallbacks `zai-org/GLM-5.3-Flash`, `moonshotai/Kimi-K2.6` | Room type, empty or not, is a door visible (suggests the anchor), capture quality hints. ~2 s, ~$0.0005 per photo. |
| Auto stage | `Qwen/Qwen3-235B-A22B-Instruct-2507`, JSON schema output | Proposes a catalog arrangement; the geometry engine validates every piece (overlaps, bounds, door swing, 0.75 m walkways) and drops what fails. |
| Furniture parsing | Regex, then `Qwen/Qwen3-30B-A3B-Instruct-2507` | "sectional, 220 by 95" → metres. ~1 s. |
| Listing copy, fit insights | Qwen3 235B / 30B | Prose for the agent from real dimensions and buyer behaviour. |

The proxy reads the account's live price list from `GET /v1/models` so every logged call carries a real USD cost, and it walks a fallback chain for vision models when an endpoint is over capacity.

Every Token Factory call is logged with tokens, latency and estimated cost to `.audora/ai-log.jsonl` (`GET /api/ai/stats`) so accuracy, time and cost per task can be reported.

## Evaluation (Nebius track)

Three Token Factory tasks are measured end to end through the same proxy the product uses, so latency and cost are what a user pays. `npm run eval` (with `npm run dev` running) regenerates `evals/results/*-latest.md`.

**1. Auto-stage** — propose a furniture arrangement for a room. The geometry engine is the judge: a layout is valid when no essential piece had to be dropped, nothing overlaps or leaves the room, the door swing is clear, the narrowest walkway is ≥ 0.75 m, and the room's essentials are present. 12 representative rooms (typical, tiny, long-and-narrow, door on a side wall, small dining, studio).

| system | valid | essentials | latency | $ per room |
| --- | --- | --- | --- | --- |
| rule-based stager (no model) | 100% | 100% | 1 ms | 0 |
| Qwen3-235B, raw x/z coordinates | 17–33% | 58% | 2–11 s | 0.0003 |
| Qwen3-235B, raw coordinates + engine repair | 92% | 92% | 2–11 s | 0.0003 |
| **Qwen3-235B, semantic placement (production)** | **92%** | **100%** | 2–14 s (mean 2 s in the final run) | 0.0003–0.0004 |
| Qwen3-30B, semantic placement | 75% | 92% | 7–13 s | 0.0002 |

Ranges are across three runs on the same 12 rooms; the spread is endpoint latency and sampling at temperature 0.4, not prompt changes.

What we learned: language models pick the right pieces but cannot do the arithmetic. Asking for metres fails on almost every room; asking for *words* ("sofa against the north wall, coffee table in front of it") and letting the engine compute, clamp and repair positions gets the large model to 92% valid with every essential piece placed, for less than half a cent per room. The rule-based stager is the always-valid floor the product falls back to; the model adds taste and variety on top. Struggle case: small dining rooms, where the model still picks a table too big for a 0.75 m walkway.

**2. Photo analysis** — from one upload: room type, is it empty, is a door visible (it becomes the scale anchor), and reconstruction quality. 18 hand-labelled Wikimedia Commons photos (`evals/photos/manifest.json`), including furnished rooms, a near-black frame and an institutional kitchen.

| system | room type | empty? | door visible | poor-quality caught | mean ms | $ per photo |
| --- | --- | --- | --- | --- | --- | --- |
| no model (product fallback) | 56% | 61% | 89% | — | 0 | 0 |
| **MiniCPM-V-4.5 (production)** | **94%** | **94%** | **100%** | yes | 1.3 s | 0.0005 |

One measured prompt iteration ("list every loose piece first; empty only if the list is empty") lifted empty-room detection from 78% to 94%. Struggle case: a commercial kitchen with fixed equipment is called empty; an open-plan office is called a living room.

**3. Reconstruction** — one live World Labs Marble draft from the demo photo: 35 s, 230 credits (≈ $0.18), three splat resolutions, a collider mesh, and no metric scale (which is why the anchor exists).

**4. Fine-tuning the stager** — the engine is a free verifier, so every accepted proposal is a gold example. `evals/distill-stager.eval.ts` asked Qwen3-235B for semantic proposals on 120 synthetic rooms (117 passed the engine at temperature 0.7) and added 53 rule-based proposals: 170 conversational examples for $0.043. `scripts/finetune-stager.mjs` uploads them and runs a LoRA job on Token Factory (`Qwen/Qwen3-8B`, r=16, 3 epochs, ~300k trained tokens; job `ftjob-49718f4839c04dd89ab749632021f946`). The job finished in 8.7 minutes on 370,833 trained tokens; validation loss fell 0.435 → 0.182 → 0.144 over the three epochs (train loss 1.01 → 0.73). Serving a custom checkpoint on Token Factory is a beta feature enabled by their support team, and Together and Fireworks also serve fine-tuned adapters only on dedicated hourly endpoints now, so the adapter (87 MB LoRA, r=16) is downloaded to `evals/results/ft-<job>/adapter` and can be served for the A/B with `scripts/serve-lora-modal.py` (vLLM on Modal, scale-to-zero) or any vLLM host; the proxy routes `modal:`, `together:`, `fireworks:` and `openai:` prefixed model ids there so `EVAL_MODELS=modal:stager npm run eval` scores it with the same harness. **Product decision (2026-09-06):** staging runs on the hosted Qwen3-235B on Token Factory (`STAGER_MODEL` unset). The fine-tune is the documented cost path: same accuracy, about a tenth of the price, servable with `scripts/serve-lora-modal.py` or any vLLM host and switched on with `STAGER_MODEL=modal:stager`.

**Result of the A/B** (same 12 rooms, semantic placement, engine as judge; the fine-tune served locally on an M5 Pro in bf16, so its latency is not a hosted number):

| system | valid | essentials | walkable | pieces kept | $ per room |
| --- | --- | --- | --- | --- | --- |
| Qwen3-235B-A22B-Instruct (teacher, hosted) | 92% | 100% | 92% | 94% | 0.0003–0.0004 |
| **Qwen3-8B + Audora LoRA (student)** | **92%** | **100%** | **92%** | **95%** | ~0.00003 hosted (8B list price) |
| Qwen3-8B un-tuned (same local serving) | 0% | 0% | — | 0% | — |

The student matches the teacher room for room (the one shared miss is the small dining room, where both pick a table too large for a 0.75 m walkway) after 8.7 minutes of training on 170 engine-validated examples that cost 4 cents to generate. The un-tuned 8B, served the same way (no constrained decoding), ignored the output schema in all 12 rooms and produced no usable placement, so the fine-tune buys both format compliance and layout quality. That is the flywheel the core-model doc describes: the verifier labels, the big model teaches, the small model ships.

**5. Floor-plan reading** — turn the listing's floor plan into rooms with names, types and metric dimensions. This is the accuracy step: a plan that prints `12'-4" × 15'-2"` anchors that room at **±5 cm**, better than a tapped door (±4 cm at best, and only when a door is in shot) and far better than the ±30 cm a room carries with nothing at all. Corpus (`evals/plans/manifest.json`): 11 plans, 77 labelled rooms, 56 with printed dimensions — eight synthetic listing-style sheets generated from a room table by `evals/plans/make-plans.mjs` (so their ground truth is exact: feet-and-inches, metres, one mixed-unit sheet, one two-storey sheet), the app's own demo townhouse plan, and two public-domain 1911 Hector Guimard apartment plans from Wikimedia Commons as hard cases, labelled by what a human can read.

| system | room recall | room type | dims returned | dims within 5% | phantom rooms | floors | mean ms | $ per plan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no model (product fallback) | 0% | — | 0% | 0% | 0 | 0% | 0 | 0 |
| MiniCPM-V-4.5, model's own metres | 86% | 100% | 91% | 84% | 121 | 100% | 6.0 s | 0.0014 |
| **MiniCPM-V-4.5 + our conversion (production)** | **86%** | **100%** | **91%** | **91%** | **27** | **100%** | 6.0 s | 0.0014 |

On the eight synthetic listing plans it is exact: 47 of 47 rooms found, every room type right, every dimension within 5%, both floors of the two-storey sheet. All the loss is in the two 1911 photostats (8 of 19 hand-lettered French rooms found).

Three measured findings, each of which changed the product:

- **Never delegate the arithmetic.** The model returns each dimension string *verbatim* (`dimensions_text`) and `metresFromDimensions` converts it in code. Same responses, scored both ways: 84% → 91% within 5%, free. It also declared the metric 1911 plans "feet", which would have turned a 3.74 × 4.70 m bedroom into a 1.14 m cupboard, so the converter refuses a reading that makes a room too small to stand in.
- **Enlarge a small plan before reading it.** The demo townhouse plan is 600 px wide as the listing serves it, and its labels are six pixels tall: at native size the model returned one room from one sheet; resampled to a 1600 px long edge (`preparePlanImage`) it returned twelve rooms across all three. The original file goes in, not a re-encoded copy — a JPEG pass at 600 px destroys exactly those letters.
- **Say nothing but "Read this floor plan."** Naming the listing in the user turn ("Listing: 88 Alder Ln, Portland, OR 97214…") cut the same plan from twelve rooms to one, twice each, deterministically. The drawing is the whole task.

Struggle cases: a 1911 photostat can run the model into a loop that repeats one room a hundred times (`planFromJson` caps identical rooms and the report counts the rest as phantom rooms), and the north arrow is found only 40% of the time. Neither costs the seller a number: an unread room simply is not there, and every dimension that does arrive is shown next to what the plan printed and the anchor it produces.

## Honest limits

- Generative reconstruction invents detail. Fine for spatial judgement, wrong for anything structural.
- The anchor carries all the risk: a mis-tapped door makes every number wrong by the same factor, so derived dimensions are sanity-checked and implausible ceilings are flagged.
- Room bounds for a real Marble world come from the collider mesh's bounding box, which includes whatever is visible through windows, so they are an estimate until the seller confirms a wall length. Draft worlds carry no metric scale at all; the anchor (assumed ceiling, then a typed wall) supplies it.
- Catalog dimensions are reference figures, labelled as such, until verified against a SKU.
- Empty rooms with blank walls are the hard case for any reconstruction method. Measure quality there, not on furnished rooms that flatter the demo.

Demo photographs in `public/demo` are CC BY-SA 3.0 from Wikimedia Commons (see `public/demo/ATTRIBUTION.md`).
