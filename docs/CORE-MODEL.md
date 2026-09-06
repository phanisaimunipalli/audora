# Audora core model — architecture for the full-scale product

_Working document, 2026-09-06. How Audora turns photos, a floor plan, the address and a sun map into a metric, photoreal, walkable listing — and which parts we train ourselves._

## The shape of it

Audora is not one model. It is a **fusion system** around a generative world model, with our own small models where the world model is blind, and a deterministic geometry engine as the verifier in the middle.

```
inputs                                  models                                   outputs
──────                                  ──────                                   ───────
photos (1–6 per room, EXIF time) ──┐
floor plan (names + dimensions) ───┤    ┌─ World Labs Marble (API today)         splat + collider + pano
address → OSM footprint, heights ──┼──▶ │   Atlas (early access, next)     ──▶   in an unknown scale
sun map (ShadeMap / solar model) ──┤    └─ our text prompt from the plan
anchor taps (door / outlet / wall) ┘
        │                               ┌─ Photo analyst  (VLM, fine-tuned)      room type · empty? · door/window boxes · quality
        ├─────────────────────────────▶ ├─ Plan reader    (VLM, fine-tuned)      rooms · metric dimensions · north arrow
        │                               └─ Stager         (LLM, fine-tuned)      semantic placements (words, not metres)
        ▼
  METRIC FUSION (deterministic, tested)                                         one metric frame per room:
  collider bounds + plan dims + anchors + footprint + sun-as-compass ──▶        scale · floor · yaw · compass heading · ± uncertainty
        ▼
  GEOMETRY ENGINE (the verifier)                                                validated staging · fit report · buyer verdicts
        ▼
  RENDER STACK (layers)                                                         splat / pano photo layer + furniture layer lit by the
                                                                                room (PMREM from the pano) + shadow catcher + occluder
```

Three principles hold the design together:

1. **The world model draws; we measure.** Marble (and Atlas) recover geometry only up to scale and invent detail. Every metre Audora shows is derived from an explicit, displayed anchor with an uncertainty. We never let a generative model assert a number.
2. **Models speak in words; the engine does arithmetic.** Our auto-stage evaluation showed language models placing furniture by raw coordinates fail on almost every room (17–33 % valid) while the same models describing placements semantically, resolved by the engine, reach 92 % with every essential piece placed. That interface is the pattern for every model in the stack.
3. **The verifier is the labeler.** The engine accepts or rejects proposals for free, which turns every run into training data. Fine-tuning does not need humans in the loop for the stager, and needs only light labeling for the perception models.

## Backbone: Marble now, Atlas next

- **Marble** (`marble-1.0-draft`, `marble-1.1`, `marble-1.1-plus`): single-, multi-image and video prompts; returns Gaussian splats (100k / 500k / full-res), a collider mesh, an equirectangular panorama, a caption, and — for the full models — a `metric_scale_factor` and `ground_plane_offset`. Draft takes ~35 s and 230 credits; full ~10 min and 1,580 credits. Verified live on 2026-09-05.
- **Atlas** (announced 2026-09-01): World Labs' multimodal world model over text, images, video and 3D, camera-controlled generation, native depth, point clouds and splats. Early access only, pricing undisclosed. Audora's service layer isolates the backbone (`services/marble.ts`, `RoomWorld`), so Atlas drops in behind the same `RoomWorld` contract: spz / collider / pano URLs plus scale semantics. Request early access; do not block the product on it.
- **What we control at the backbone:** the inputs. Multi-image prompts with azimuth hints from the seller ("left / centre / right"), a text prompt generated from the floor plan ("an empty 3.75 × 4.60 m bedroom, ceiling 2.6 m, one window on the north wall, door on the south wall"), and the choice of tier (draft while staging, full at publish).

## Our models (fine-tuned on Nebius Token Factory)

| model | base (LoRA) | input → output | training data | metric | why fine-tune |
| --- | --- | --- | --- | --- | --- |
| **Stager** — **done, first pass** | Qwen3-8B LoRA (r=16, all projections), trained on Token Factory in 8.7 min | room geometry + catalog → semantic placements JSON | 170 engine-validated proposals: 117 distilled from Qwen3-235B (of 120 asked) + 53 rule-based (`evals/distill-stager.eval.ts`), $0.04 to generate | valid-layout rate, essentials, walkway, $/room | **A/B on the 12-room eval: student 92 % valid / 100 % essentials / 95 % pieces kept = the teacher, room for room** (validation loss 0.435 → 0.144). Served locally for the A/B because no provider serves adapters per token today; hosted 8B pricing is ~10× cheaper than the 235B teacher |
| **Photo analyst** | Qwen2.5-VL 7B / MiniCPM-V | listing photo → room type, empty?, door & window boxes, quality | hand-labelled Commons photos (18 today; the create flow's confirmations grow it: every room the seller names and every door tap is a label) | accuracy vs labels (94 % / 94 % / 100 % today with MiniCPM zero-shot) | door/window boxes drive the anchor and the pano alignment; zero-shot boxes are unreliable |
| **Plan reader** | Qwen2.5-VL 7B | floor plan image → rooms, dimensions, north arrow, adjacency | unlimited synthetic plans (SVG → PNG with known dimensions, feet-inches and metres, varied styles) + real plans labelled by hand | room recall, dimension accuracy within 5 % | dimension strings on real plans are small, rotated and abbreviated; synthetic data covers the long tail cheaply |

Token Factory specifics: JSONL in conversational format (`messages`, last turn assistant), `POST /v1/files` (purpose `fine-tune`), `POST /v1/fine_tuning/jobs` with `hyperparameters.lora: true`, `lora_r`, `lora_alpha`, `n_epochs` (statuses: validating_files → queued → running → succeeded/failed). First job launched 2026-09-06: `ftjob-49718f4839c04dd89ab749632021f946` on `Qwen/Qwen3-8B`. **Serving** a fine-tuned checkpoint needs a dedicated endpoint with custom weights (`POST /v0/dedicated_endpoints`, per-GPU-hour), which is in beta and enabled by Nebius support on request — ask for it as a hackathon participant. Until then the A/B runs on validation loss and, if needed, on a downloaded checkpoint served locally. Every inference call is already logged with tokens, latency and USD (`.audora/ai-log.jsonl`), so before/after cost per task is measured, not estimated.

## Metric fusion: the geometry we own

Inputs, each with an uncertainty, solved into one frame per room (scale `s`, floor `y0`, yaw `θ`, compass heading `h`):

| source | gives | ± |
| --- | --- | --- |
| collider mesh bounds | proportions, floor height, camera position | proportions good, extents include what is seen through windows |
| Marble `metric_scale_factor` (full tier) | scale | ~15 cm on 2 m |
| door tap (2.03 m) / outlet (0.30 m) / typed wall (tape 2 cm, laser 1 cm) | scale | 1–6 cm |
| floor plan dimensions | scale and room rectangle | ~5 cm |
| OSM footprint | building axis, outer dimensions bound the rooms | orientation to a few degrees |
| **sun as a compass** | heading: the pano's brightest direction and the photo's EXIF timestamp + geocoded location give the sun's azimuth; matching them yields the wall heading with no user input | ~10° |
| ShadeMap / solar model | per-window sun hours, neighbours' shadows | — |

Weighted least squares over these with outlier rejection (a mis-tapped door disagrees with the plan) produces the frame and a combined uncertainty that the AnchorChip displays. The floor-height nudge is the user's override on `y0`. This is deterministic, unit-tested code (`src/engine/anchor.ts`, `src/services/marble.ts`, `src/engine/sun.ts`), not a model, on purpose: the numbers must be explainable.

## Data flywheel

Every tour produces labels without asking anyone to label:

- seller confirms room names and types → photo-analyst labels
- door / outlet taps → door boxes; typed walls and plan dimensions → scale ground truth against Marble's raw geometry → train a **scale prior** (predict metres-per-unit from the world itself, so drafts without semantics start closer)
- seller edits after auto-stage (move, delete, add) → preference data for the stager (kept vs changed pieces)
- buyer tests → which pieces matter per room type → catalog priorities and the stager's essentials
- engine verdicts on every proposal → the stager's SFT set grows on its own

## Evaluation is part of the product

`npm run eval` scores the stager (12 rooms, validity by the engine) and the photo analyst (18 labelled photos), each with latency and USD per task, and writes `evals/results/*-latest.md`. The plan reader gets the same treatment with synthetic plans. Each fine-tune is judged against the same harnesses before it replaces a hosted model; the README's evaluation section is generated from these files.

## Sequencing

1. Ship: Marble backbone, splat-first rendering, anchor + collider fusion, rule-based stager as the floor, big-model semantic stager on top (done / in progress).
2. This week: layers realism, plan reader v0 (zero-shot VLM + eval), site step with ShadeMap. Stager distillation and the first 8B LoRA are done and A/B'd (ties the teacher); **product decision 2026-09-06: staging stays on the hosted 235B on Token Factory**, the fine-tune is the cost path behind `STAGER_MODEL`.
3. Next: photo-analyst fine-tune from confirmed labels, scale prior, sun-as-compass, Atlas early access behind the same `RoomWorld` contract.
