# Audora

Where this is going: `docs/PRODUCT.md` (an AI-generated Matterport for rentals: renters use it, leasing teams pay, marketplaces distribute it).

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

## CLI: photos in, a localhost URL out

The shortest path from a folder of photographs to a walkable room, with no browser wizard and no
Supabase. Full contract in **[docs/CLI.md](docs/CLI.md)**.

```bash
npm install && npm run build          # emits dist-server/ and puts `audora` on npx's path
npm run dev                           # in another terminal: the viewer, on 5173

npx audora generate ./photos --open   # from the repository root: one URL, and it opens
```

Run it **from the repository root** — that is where `npx` finds this checkout's own `audora`
(`node_modules/.bin/audora`, linked by `npm run build`); from anywhere else it would go looking on
the public registry instead.

A flat folder is one room. Subfolders are the rooms of one unit — the folder name becomes the room
name, so `photos/living/*.jpg` and `photos/bedroom/*.jpg` make a two-room unit you can walk between.
The tool canonicalises and hashes every photo, builds the same recipe the backend builds, generates
with World Labs Marble, downloads every asset into `.audora/local/`, measures the collider, and
prints `http://localhost:<port>/t/<unit-id>`. Opening it lands you in the room: walk, dollhouse,
measure, layers, and the unit map, with a small **local** badge saying where the model came from.

```bash
npx audora generate ./photos --dims living=5.3x5.8 --ceiling 2.6   # printed plan numbers, for scale
npx audora list                                                     # the units made so far, with URLs
npx audora open <id> --open                                         # print (and open) one again
npx audora serve                                                    # start the production server if nothing answers
```

**It never spends twice for the same photographs.** The unit id is a hash of the recipes, so the same
photos and options give the same URL every run, and a room whose recipe already has a world is
reused rather than regenerated — the second run of the same folder generates nothing. Before it does
spend anything it prints the cost and asks; `--yes` skips the question, and `MARBLE_MAX_GENERATIONS`
still caps it.

**Try it without spending a credit:**

```bash
MARBLE_MOCK=1 npx audora generate ./photos --yes
```

Everything runs — canonicalisation, recipe, seed, polling, asset download, collider measurement,
fusion — against a simulated provider, and nothing on the network is touched: not Marble, and not
the vision model either (`--ai`, which is off unless you ask for it). The room you walk is the
measured shell rather than a capture, because the simulated splat file is a stub rather than real
Gaussian splats.

## Deploy (Render, or any Node host)

`npm run build` produces `dist/` (the app) and `dist-server/` (the production server, compiled from
`server/prod.ts` and `shared/`, so the entry point is `dist-server/server/prod.js`). `npm start`
runs it with nothing but Node: it serves `dist/` with gzip and
immutable caching for hashed bundles, answers client-side routes with the app shell, and mounts the
same `/api/*` handler the dev server uses so keys never reach the browser.

| Render setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Environment | `WORLDLABS_API_KEY`, `NEBIUS_API_KEY`, `VITE_SHADEMAP_KEY` (build-time: it is inlined into the bundle, so redeploy after changing it), optional `MARBLE_MAX_GENERATIONS`, and — for the backend — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `PIPELINE_VERSION` |

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

## Backend (Supabase)

**`docs/BACKEND.md` is the contract** — what a unit needs as input, the determinism rules, the
prompt compilation, the pipeline, the schema and the route table. `supabase/migrations/` is the
schema and `server/` is the implementation (plain `node:http` and `fetch` against PostgREST,
Storage and Auth; no `express`, no `supabase-js`).

It is opt-in. With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unset, `/api/status` reports
`backend: false`, every `/api/v1/*` route answers `503 {"error":"backend not configured"}`, no job
worker starts, and the app keeps its browser-local store — which is the demo and offline path.

```bash
supabase start                                   # local Postgres, PostgREST, Storage, Auth
supabase db reset                                # applies supabase/migrations/0001 and 0002
# copy the printed URL and keys into .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
MARBLE_MOCK=1 npm run dev                        # the whole pipeline, no World Labs key, no credits
curl -s localhost:5173/api/status | jq .backend  # true once the keys are set
```

`supabase/migrations/0002_claim_jobs.sql` must be applied before the worker can claim anything —
without it every tick fails on `rpc/claim_jobs` and no job ever starts. Hosted: `supabase link
--project-ref <ref>` then `supabase db push`, and set the three keys on the host.

To act on the API without signing in, mint an organisation (`createOrgWithOwner` in
`server/auth.ts`) and put its id in `AUDORA_DEV_ORG`; it is ignored when `NODE_ENV=production`, and
a real `Authorization: Bearer <supabase access token>` always wins over it.

| Variable | What it does |
| --- | --- |
| `SUPABASE_URL` | `https://<ref>.supabase.co`, or `http://127.0.0.1:54321` locally. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only; it bypasses row-level security and is never shipped. |
| `SUPABASE_ANON_KEY` | For the browser client (auth + realtime); public by design. |
| `PIPELINE_VERSION` | Bump to invalidate every recipe on purpose (default `1`). Every room regenerates. |
| `MARBLE_MOCK` | `1` runs the worker against the built-in mock provider: no key, no credits. |
| `AUDORA_DEV_ORG` | Local only: act as this organisation's owner when no token is sent. |

Determinism is the point (`docs/BACKEND.md` §2): every photo is canonicalised and hashed, a room's
request is a canonical JSON **recipe**, `recipe_hash = sha256(recipe)` and Marble's seed is its
first 32 bits, `disable_recaption` keeps the compiled prompt verbatim, and `worlds.recipe_hash` is
unique among non-failed worlds — so the same inputs attach the world they already made instead of
spending credits again.

## How it is built

```
src/engine/     pure metric engine: oriented-rectangle geometry, wall clamp/snap, anchor
                math with uncertainty, fit report (overlaps, bounds, door swing, walkways),
                catalog with real dimensions, rule-based auto-stage, buyer verdicts. Tested.
src/state/      zustand store persisted to localStorage; the job runner (deep-research UX);
                BroadcastChannel collaboration; demo seed.
src/services/   marble.ts (World Labs), ai.ts (Nebius Token Factory), listing.ts, mockWorld.ts
server/api.ts   /api/* proxy mounted on the Vite server; keys stay here.
server/         the Supabase backend (docs/BACKEND.md): recipe.ts + prompt.ts (the hash and the
                compiled prompt), photos.ts (canonical copies), db/storage/auth.ts (PostgREST,
                Storage, GoTrue over fetch), pipeline.ts, worker.ts (the job queue), routes.ts.
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

**6. Reconstruction accuracy** — how close the 3D model of a room is to the room. This one is not a model evaluation at all: it **never generates**, calls nothing, costs nothing and needs no keys or dev server. It reads collider meshes that already exist on disk, measures them with `shared/collider.ts` and scales them with `shared/fusion.ts` — the same code the worker runs after `copy_assets` — and reports the contract in docs/ACCURACY.md section 1: dimension error, ceiling error, orientation error, opening error, adjacency and determinism.

Corpus: six synthetic box rooms written as real `.glb` files by `evals/fixtures/reconstruction/rooms.ts`, whose ground truth is exact by construction — authored in metres from 2.4 × 3.0 m to 6.5 × 11.8 m, converted to raw units by a per-room scale (0.31 to 2.22 m per unit, including the demo full-quality world's real `metric_scale_factor`), turned by a known yaw of 0° to 80°, captured from an off-centre point at eye height, and given one doorway that leaks into the room next door the way Marble's does, so every fixture's bounding box is 7× to 23× its room. Plus any real unit a teammate drops into `evals/fixtures/reconstruction/real/` with the dimensions its plan prints (the README there is the one-page how-to), and the app's own demo corner-window world when its collider has been cached locally once.

One measurement, three scales, so the reconstruction's error is separated from the anchor's:

| system | median dimension error | worst | rooms within 10% | worst ceiling | worst door | mean confidence |
| --- | --- | --- | --- | --- | --- | --- |
| **plan + assumed ceiling (production)** | **0.12%** | 0.42% | 6/6 | 1.3 cm | 2.0 cm | 0.61 |
| assumed 2.44 m ceiling only (no plan) | 5.97% | 18.7% | 4/6 | 56 cm | 72 cm | 0.43 |
| printed ceiling only (the collider alone) | 0.06% | 0.17% | 6/6 | 0 cm | 1.4 cm | 0.75 |

Orientation is exact on all six (0.00°), and all six are byte-identical over two runs through `canonicalJson`, which is what lets a recipe hash mean anything.

What this says: **the reconstruction is not the error budget, the anchor is.** Scaled by a ceiling it actually knows, the collider's own rectangle lands within 0.06% of the plan; scaled by the standard 2.44 m assumption a draft world starts with, the median error is 5.97%, entirely because a 2.70 m or 3.00 m room is scaled as though it were 2.44 m. A floor plan closes that, which is the same finding evaluation 5 reaches from the other end.

It also found and fixed a real defect, which is what an eval is for. Two of the six rooms — at 63° and 80° off the provider's axes — measured 30–49% small, because `fitWallRect` masked its wall band against an **axis-aligned** box built by relabelling the rotated fit's extents onto the raw axes (`boxRadius(toRawBox(coarse), ...)`, rotation dropped). At 63° that discarded 138 of 360 azimuth bins as "beyond the wall" and refitted the room on what was left, turning a 5.00 m wall into 2.43 m. Masking against the rotated rectangle instead (`fittedRadius`, already in that file) discards nothing on all six and brought the median from 0.24% to 0.12%. The eval was written to fail once the fix landed — it asserts the set of failing rooms *exactly*, so the fix could not land quietly — and the set is now empty.

Run it with `npm run eval` (this one alone: `npx vitest run --config vitest.eval.config.ts evals/reconstruction.eval.ts`, about 200 ms). It writes `evals/results/reconstruction-latest.md`.

Honest limits, stated in the report itself: **the ground truth is synthetic** — six rooms with flat walls and square corners, so these numbers are a floor on the error, not an estimate of it; **no real unit with a floor plan is in the corpus yet**, so the dimension row is a statement about the arithmetic rather than about Marble until someone adds one; **adjacency is not measured**, because one collider has no neighbouring room to lead to (it needs the unit graph from docs/ACCURACY.md section 3.3); and the plan's axis order is resolved by aspect ratio (`orientPlan` in `shared/fusion.ts`, which the worker now applies before fusing), where a plan with a north arrow could settle it outright.

## Honest limits

- Generative reconstruction invents detail. Fine for spatial judgement, wrong for anything structural.
- The anchor carries all the risk: a mis-tapped door makes every number wrong by the same factor, so derived dimensions are sanity-checked and implausible ceilings are flagged.
- Room bounds for a real Marble world come from a rectangle fitted to the collider's wall band, not from its bounding box — the box holds everything the model reconstructed through the windows and open doors, which on the demo corner room is 27 m² against a 12.2 m² room. When the fitted rectangle is not one room at all the measurement says so (`method: 'aabb'`, confidence 0, a flag in words) rather than publishing the wrong number. Draft worlds carry no metric scale of their own; the plan's printed dimensions, the anchor and — on full quality — Marble's `metric_scale_factor` are fused into one scale with a stated ±, and every room shows what each source said against it.
- Catalog dimensions are reference figures, labelled as such, until verified against a SKU.
- Empty rooms with blank walls are the hard case for any reconstruction method. Measure quality there, not on furnished rooms that flatter the demo.

Demo photographs in `public/demo` are CC BY-SA 3.0 from Wikimedia Commons (see `public/demo/ATTRIBUTION.md`).
