# Reconstruction accuracy — 2026-09-09T00:26:36.244Z

6 colliders measured (6 synthetic, 0 real), each scaled three ways. **This eval never generates**: no model, no World Labs call, no network. It reads .glb bytes that already exist, measures them with `shared/collider.ts` and scales them with `shared/fusion.ts` — the same code the worker runs after `copy_assets`.

## The contract (docs/ACCURACY.md section 1)

Measured on the production system: the plan's printed dimensions (±5 cm) fused with an assumed 2.44 m ceiling (±12 cm).

| Measure | Target | Result | |
| --- | --- | --- | --- |
| Dimension error | median < 5 %, every room < 10 % | median 0.21 %, worst 0.81 % (6/6 rooms inside) | ✓ |
| Ceiling error | < 10 cm | worst 2.5 cm | ✓ |
| Orientation error | < 10° | worst 0° | ✓ |
| Opening error | < 30 cm | worst 2.4 cm, 6/6 on the right wall | ✓ |
| Adjacency | 100 % | not measured — needs the unit graph (docs/ACCURACY.md section 3.3); one collider has no neighbours to lead to | — |
| Determinism | always | 6/6 fixtures byte-identical over two runs from a fresh read | ✓ |

## Systems

One measurement, three scales. **plan + assumed ceiling** is what ships (plus Marble's own `metric_scale_factor` where a full-tier world carries one). **assumed ceiling only** is the same room with no plan — the difference is what a floor plan is worth. **printed ceiling only** takes its scale from the true ceiling and nothing else, so a width error in that row is the reconstruction's own, not the anchor's.

| system | rooms | median dim err | worst dim err | rooms within 10% | worst ceiling | worst door | mean confidence | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plan + assumed ceiling | 6 | 0.21 % | 0.81 % | 6/6 | 2.5 cm | 2.4 cm | 0.592 | 3 |
| assumed ceiling only | 6 | 5.97 % | 18.65 % | 4/6 | 56 cm | 71.8 cm | 0.356 | 0 |
| printed ceiling only | 6 | 0.06 % | 0.17 % | 6/6 | 0 cm | 1.4 cm | 0.754 | 0 |

## Per room (plan + assumed ceiling)

The plan is shown in the order it was fused in. "axes" is `swapped` where the fitted rectangle names the room’s depth "width" — past 45° it always does, and the plan has to be matched to the rectangle before fusion or both dimensions flag against a perfectly good room.

| room | plan m | measured m | width err | depth err | ceiling | yaw err | door | axes | one room? | m/unit | σ | conf |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bedroom-small | 2.4 × 3 | 2.4 × 3.001 | 0 % | 0.03 % | 2.44 m (-0.3 cm) | 0° | +0.6 cm ✓ (width -4.7 cm) | as drawn | ✓ | 0.68684 | 1.72 % | 0.703 |
| living-corner | 3 × 4.06 | 2.993 × 4.054 | -0.23 % | -0.15 % | 2.49 m (-0.7 cm) | 0° | +0.2 cm ✓ (width -6.3 cm) | as drawn | ✓ | 0.44909 | 1.35 % | 0.735 |
| kitchen-wide | 4.2 × 3.6 | 4.173 × 3.578 | -0.64 % | -0.61 % | 2.68 m (-1.9 cm) | 0° | -0.3 cm ✓ (width +0.9 cm) | as drawn | ✓ | 0.99416 | 2.45 % | 0.639 |
| bedroom-turned | 5.2 × 3.1 | 5.2 × 3.1 | 0 % | 0 % | 2.44 m (-0.2 cm) | 0° | -0.2 cm ✓ (width -0.3 cm) | swapped | ✓ | 2.22514 | 1.14 % | 0.753 |
| studio-tall | 5.2 × 5 | 5.158 × 4.962 | -0.81 % | -0.76 % | 2.98 m (-2.5 cm) | 0° | -2.2 cm ✓ (width -2 cm) | swapped | ✓ | 0.30782 | 3.95 % | 0.308 |
| open-plan-flat | 11.8 × 6.5 | 11.779 × 6.483 | -0.18 % | -0.26 % | 2.89 m (-0.6 cm) | 0° | -2.4 cm ✓ (width -15.9 cm) | swapped | ✗ | 0.74929 | 1.82 % | 0.417 |

## What the collider gave, before any scale

`method: walls` means the wall band found a rectangular room; `score` is the fraction of that band the rectangle explains. The last column is why the wall rectangle exists at all: a Marble collider reconstructs the room next door through an open doorway, so its bounding box is not the room.

| room | method | score | rotation | wall rect m² | bounding box m² | box ÷ room | openings |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bedroom-small | walls | 1 | 0° | 7.2 | 52.9 | 7.3× | west 0.81 m |
| living-corner | walls | 1 | 12° | 12.1 | 276 | 22.7× | north 0.84 m |
| kitchen-wide | walls | 1 | 30° | 14.9 | 169.4 | 11.3× | east 0.96 m |
| bedroom-turned | walls | 1 | 52° | 16.1 | 362.7 | 22.5× | east 1.1 m |
| studio-tall | walls | 1 | 63° | 25.6 | 242.6 | 9.5× | south 0.9 m |
| open-plan-flat | walls | 1 | 80° | 76.4 | 298.2 | 3.9× | west 1.64 m |

## What this says

**The reconstruction is not the error budget; the anchor is.** Scaled by a known ceiling alone — a dimension that is not one of the ones being scored — the collider's own rectangle is within 0.06 % of the plan at the median. Swap that for the standard 2.44 m assumption every draft world starts with and the median error becomes 5.97 %, entirely because a room with a 2.70 m or 3.00 m ceiling is scaled as though it had a 2.44 m one. The plan puts it back: 0.21 %.

**Confidence tracks that.** 0.592 with the plan against 0.356 without it — the fit is tighter, corroborated by a second source, and it is that number a room prints beside its dimensions.

**The wall rectangle is the whole reason a room can be measured at all.** Every fixture leaks through its doorway the way a Marble collider does, and the bounding box that follows is 3.9× to 22.7× the room. The table above is what the two-pass wall fit recovers from it.

## What a buyer would read

`roomFromFusion` writes one line per dimension, so nothing is shown as more certain than its residual:

- **bedroom-small** — Plan says 2.40 m · model measures 2.40 m (±0.00 m) · Plan says 3.00 m · model measures 3.00 m (+0.00 m) · Ceiling stated 2.44 m · model measures 2.44 m (−0.00 m)
- **living-corner** — Plan says 3.00 m · model measures 2.99 m (−0.01 m) · Plan says 4.06 m · model measures 4.05 m (−0.01 m) · Ceiling stated 2.44 m · model measures 2.49 m (+0.05 m)
- **kitchen-wide** — Plan says 4.20 m · model measures 4.17 m (−0.03 m) · Plan says 3.60 m · model measures 3.58 m (−0.02 m) · Ceiling stated 2.44 m · model measures 2.68 m (+0.24 m)

Rooms where a source disagreed by more than 2σ (the flag a seller sees):

- **kitchen-wide** — We assumed a standard ceiling of 2.44 m; the model measures 2.68 m (2.0σ). Type the room’s real ceiling height and the room re-measures.
- **studio-tall** — We assumed a standard ceiling of 2.44 m; the model measures 2.98 m (4.5σ). Type the room’s real ceiling height and the room re-measures.
- **open-plan-flat** — We assumed a standard ceiling of 2.44 m; the model measures 2.89 m (3.8σ). Type the room’s real ceiling height and the room re-measures.

## Determinism

Each fixture is read from disk, measured and fused twice, and the whole result — bounds, wall rectangle, openings, every fused number — is encoded with `canonicalJson` (the encoder that decides a recipe hash). 6 of 6 produced identical strings. Nothing in the path reads a clock or a random number, so this is the property that lets the pipeline cache a world by its recipe.

## Honest limits

- **The ground truth is synthetic.** Six rooms authored in metres and meshed here; their walls are flat, their corners square and their only clutter is the room next door leaking through the doorway. A real collider is noisy, has furniture, curtains, radiators and a bay window. These numbers are a floor on the error, not an estimate of it.
- **No real unit with a plan is in the corpus yet.** The demo corner-window world is a Wikimedia photograph with no floor plan, so it can be measured but not scored; everything in `evals/fixtures/reconstruction/real/` is scored the moment a teammate adds a collider and the dimensions its plan prints (see the README there). Until then the dimension row of the contract table is a statement about the arithmetic, not about Marble.
- **Adjacency is not measured.** One collider has no neighbouring room to lead to; that row needs the unit graph from docs/ACCURACY.md section 3.3.
- **The plan's axis order is resolved by aspect ratio here.** A collider cannot know which of its two axes the plan calls "width" (the fit is only defined modulo 90°), so this eval picks the assignment whose aspect ratio matches and reports it. In production that comes from the plan's north arrow; a nearly square room can still be matched the wrong way round, and the eval would not notice.
- **Openings are located to about 2 %, not 1 %**: the wall band is binned at one degree of azimuth, so a doorway a metre away can only be placed to a centimetre or two, and a wide one to more.

## Not scored in this run

- `marble-world-corner-windows.json`: its collider is not on disk, and this eval never fetches. Run `curl -sSL "https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/16d54ea7.glb" -o evals/fixtures/reconstruction/real/marble-world-corner-windows.glb` once to score it; `evals/fixtures/reconstruction/real/README.md` lists the numbers it should reproduce.

## Adding a real unit

Put the collider `.glb` in `evals/fixtures/reconstruction/real/` and add an entry to the manifest there with the dimensions its plan prints. Nothing else: the eval measures every collider it finds. `evals/fixtures/reconstruction/real/README.md` has the field list and a worked example.

## Corpus

| room | kind | what it is | why it is in here |
| --- | --- | --- | --- |
| bedroom-small | synthetic | Small bedroom, square to the capture | The easy case: no rotation, a standard ceiling, a standard door 1.5 m away. |
| living-corner | synthetic | Living room at 12°, the demo corner room’s own size | The size the real corner-window world measures to, at a small yaw. |
| kitchen-wide | synthetic | Wide kitchen at 30° | Raw units are metres here, so a scale error shows up as a scale error and nothing else. |
| bedroom-turned | synthetic | Long bedroom at 52°, past the 45° fold | Past 45° the fitted rectangle names the room’s depth "width"; the plan has to be matched to it. Scale is the demo full-quality world’s real metric_scale_factor. |
| studio-tall | synthetic | Studio at 63°, 3.00 m ceiling | A ceiling 56 cm above the assumed 2.44 m: the case where an assumed anchor alone is wrong by 19 %. |
| open-plan-flat | synthetic | Open-plan flat at 80°, 6.5 × 11.8 m | The demo flat’s wall-band size. 76.7 m² is not one room: isOneRoom must reject it so the pipeline keeps the caller’s estimate. |

Ground truth for the synthetic rooms is `evals/fixtures/reconstruction/synthetic/manifest.json`, regenerated from `evals/fixtures/reconstruction/rooms.ts` whenever the spec changes; real units live in `evals/fixtures/reconstruction/real/`.
