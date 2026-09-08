# Accuracy plan: the 3D model of the unit, from real photos and the layout

Priority set on 2026-09-08: staging and furniture layering are deferred. The product is the
accurate, interactive 3D model of a unit generated from its real photos and its layout with
dimensions (plus the address). This plan says what "accurate" means, where truth comes from, and
what gets built. `docs/BACKEND.md` is the pipeline contract underneath it.

## 1. What accurate means (the numbers we report)

| Measure | Definition | Target |
|---|---|---|
| Dimension error | Reconstructed room width and depth (wall to wall, from the collider) versus the plan's printed dimensions | median under 5 %, every room under 10 % |
| Ceiling error | Reconstructed ceiling height versus the printed or anchored height | under 10 cm |
| Orientation error | Room yaw in the unit frame versus the plan's north arrow | under 10° |
| Opening error | Door and window positions along the wall versus the plan | under 30 cm |
| Adjacency | Every plan door leads to the right neighbouring room | 100 % of the adjacency we have |
| Determinism | Same photos, plan, dimensions and address give the same recipe hash and the same attached world | always |

Every published room shows its own numbers: the anchor with its ±, and a "plan says / model
measures" line per dimension. Nothing is presented as more certain than its residual.

One caveat on the adjacency row, so it is not read as more than it is: the plan parser returns room
names, types, printed dimensions and door *counts* — it does not say which rooms a door joins. So
adjacency is **inferred** (`shared/unitGraph.ts`: rooms open off the nearest hallway, or are chained
in the order the sheet draws them) and the graph says so in `UnitGraph.adjacency`. Until the vision
schema gains a doors field naming both rooms, this row measures our inference, not the drawing.

## 2. Sources of truth and their uncertainty

1. **Plan dimensions**: ±5 cm (a drawing, not a tape). Strongest constraint on width and depth.
2. **Anchor**: door 2.03 m ±4 cm, outlet height ±3 cm, ceiling 2.44 m ±12 cm if assumed.
3. **Marble metric scale** (`metric_scale_factor`, full tier only): provider's own estimate; used as
   a constraint, never alone. Draft tier returns none.
4. **Collider wall rectangle**: the model's own room, in raw units; the thing being scaled.
5. **Photo EXIF** (focal length, sensor): a weak field-of-view prior.

Metric fusion (`shared/fusion.ts`): weighted least squares over every available constraint gives
one scale, the residual of each source, and a confidence. Disagreements above tolerance become
flags on the room ("plan says 3.75 m, model measures 3.41 m; check that the photo is this room").
Deterministic, pure, unit-tested.

## 3. What gets built (the accuracy pass)

1. **Shared metric code.** A `shared/` folder compiled into both the browser and the server so the
   worker and the viewer measure the same way: collider measurement (floor and ceiling slabs, wall
   band rectangle, openings), fusion, the recipe rounding and the prompt compiler (one copy, not two).
2. **Server-side measurement.** After `copy_assets`, the worker measures the collider, runs fusion
   with the room's plan dims and anchor, and stores geometry, residuals and confidence on the room.
   The public tour serves measured rooms; the browser no longer has to derive them.
3. **The unit as one model.** From the parsed plan: room graph (doors, adjacency, north arrow);
   each room world oriented to plan north and placed on the plan; door openings in the collider
   matched to plan doors become portals, so walking to a doorway moves you into the next room's
   world; a unit minimap drawn from the plan with "you are here".
4. **Intake that earns accuracy.** Two to four angles per room (corner and doorway), a quality gate
   (blur, exposure, occupied room, HDR merge) that asks for a retake, a per-room "plan says /
   photo shows" confirmation, and reconstruction mode (`reconstruct_images`) whenever a room has
   more than one photo — one threshold, in `shared/marbleLimits.ts`, read by the browser recipe,
   the server recipe and the Marble request, so the launch step cannot promise the seller one
   thing while the request carries another.
5. **Tier policy.** Draft for the instant preview; full quality (`marble-1.1`, `marble-1.1-plus`
   for large or open-plan rooms) for the published model, because only full returns metric scale.
   Both are part of the recipe; cost is shown before generating.
6. **Reconstruction eval.** `evals/reconstruction.eval.ts` runs the measurement and fusion over
   every stored world with known dimensions (the real corner room and flat, the simulated rooms,
   and any unit the team adds with its plan) and reports the table in section 1. It never
   generates: it measures what exists.
7. **Staging deferred.** The staging editor, auto-stage and the furniture test stay in the code
   behind a setting that is off by default; the hub, wizard and viewer lead with measurements,
   the plan and the model date.

## 4. Order of work

The backend run (recipes, prompt compiler, database, storage, canonical photos, routes, worker) is
in progress. The accuracy pass follows it, because it builds on the worker and moves the prompt
compiler into `shared/`. Then the demo: one real unit, its plan with dimensions, photos of every
room, generated at full quality, walked room to room, every dimension shown against the plan.
