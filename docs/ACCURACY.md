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
5. **Photo EXIF** (focal length, sensor): a weak field-of-view prior, ±15 %. `shared/exifPrior.ts`
   reads the 35 mm equivalent the camera wrote (else a make/model sensor table), turns it into the
   horizontal field of view, and asks the collider which wall the capture faced and how far away it
   is. A field of view is scale-free — doubling every distance in a room leaves every photograph of
   it unchanged — so the prior has to borrow one metric length, and it borrows the wall's storey
   height. It is therefore **not independent of the ceiling constraint**, and says so
   (`group: 'ceiling'`), so the fit weights the two as one assumption. It returns nothing at all
   unless the photograph really framed that wall floor to ceiling, which is what keeps a wrong
   sensor-table entry from becoming a wrong number.

   *How often that is, measured (2026-09-08).* Rarely, so far: **never** on either real world in the
   repository. A phone shot from across a room frames well over one storey at the far wall — the
   corner room's draft comes out at 1.57 storeys with a 26 mm-equivalent lens and the furnished flat
   at 2.28 — and both are refused. That is the gate doing its job: the equality the prior rests on
   ("this photograph frames this wall, floor to ceiling") is a doorway shot, not a room shot, and a
   prior that is wrong is worse than a prior that is absent. It is kept because it costs nothing
   when it is silent, it is the one constraint that arrives free with the photograph, and the
   intake's own guidance (a shot from the doorway, `screens/create/intake.ts`) is the shot it fires
   on. Read this row as "available, and currently contributing to no real room" rather than as a
   source the published numbers rest on. Closing the gap needs a second metric length that does not
   assume the framing — the camera height above the floor is the obvious one — and that is a change
   to the derivation, not to the tolerance.

Metric fusion (`shared/fusion.ts`): weighted least squares over every available constraint gives
one scale, the residual of each source, and a confidence. Constraints carry a group, and a group's
weight is shared among its members, so one drawing that printed two dimensions — or one ceiling
height entered twice — is one source of error and not two. Disagreements above tolerance become
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
   door openings in the collider matched to plan doors become portals, so walking to a doorway moves
   you into the next room's world; a unit minimap drawn from the plan with "you are here"; and
   **one answer per room**, in `src/screens/viewer/unit.ts`, that the viewer, the staging editor,
   the hub and the publish panel all read rather than each deriving their own. That module owns
   three things: the room's doorways (the shell cuts every one of them, the lit markers stand in the
   subset that leads somewhere — the same objects, so a pane is always the size of its hole), the
   room's turn, and the bearing the sun is computed against.

   *On "oriented to plan north":* the plan's turn has two terms and Audora carries **neither as a
   world rotation**, deliberately. The quarter turn between the drawing's frame and the capture's is
   already absorbed where it crosses — `matchPortals` folds every plan door onto the room's own
   walls, `toUnitPose` undoes the same turn on the sheet — so rotating the world as well would move
   the room's stored numbers and its staging coordinates for nothing anyone can see. The north arrow
   is a bearing, not a rotation: its one observable consumer is the sun, which takes it through
   `headingAfterYaw`. Turning the whole scene (shell, markers, furniture, walk bounds, minimap *and*
   camera) by it is the identity. `roomTurn`'s `TurnPolicy` is the one switch if that ever changes,
   and every consumer already reads its answer.
4. **Intake that earns accuracy.** Two to four angles per room (corner and doorway), a quality gate
   (blur, exposure, occupied room, HDR merge) that asks for a retake, a per-room "plan says /
   photo shows" confirmation, and reconstruction mode (`reconstruct_images`) whenever a room has
   more than one photo — one threshold, in `shared/marbleLimits.ts`, read by the browser recipe,
   the server recipe and the Marble request, so the launch step cannot promise the leasing team one
   thing while the request carries another.
5. **Tier policy.** Draft for the instant preview; full quality (`marble-1.1`, `marble-1.1-plus`
   for large or open-plan rooms) for the published model, because only full returns metric scale.
   The rule is `shared/modelPolicy.ts` and four callers share it — the wizard's launch step, the
   browser recipe, the server's `planRecipes`, and `modelFor` on the generate route, which refuses
   an unrecognised id with a 400 rather than quietly substituting the tier default (a substitution
   would record a recipe hash describing a request that was never sent, and the next identical run
   would miss the cache and spend the credits again). Both are part of the recipe; cost is shown
   before generating, naming the model **that room** will get.
6. **Reconstruction eval.** `evals/reconstruction.eval.ts` runs the measurement and fusion over
   every stored world with known dimensions (the real corner room and flat, the simulated rooms,
   and any unit the team adds with its plan) and reports the table in section 1. It never
   generates: it measures what exists.
7. **Staging deferred.** The staging editor, auto-stage and the furniture test stay in the code
   behind a setting that is off by default; the hub, wizard and viewer lead with measurements,
   the plan and the model date.

## 4. Order of work

The backend run (recipes, prompt compiler, database, storage, canonical photos, routes, worker) is
in. The accuracy pass followed it, because it builds on the worker and moves the prompt compiler
into `shared/`. Then the demo: one real unit, its plan with dimensions, photos of every room,
generated at full quality, walked room to room, every dimension shown against the plan.

## 5. Where section 3 stands

**Done.** 1 (shared metric code — plus `shared/modelPolicy.ts` and `shared/exifPrior.ts`), 2
(server-side measurement, with the room's primary photo fed to it by the worker *and* by the PATCH
that re-fuses), 4 (intake), 5 (tier policy, real on both paths), 6 (the eval: median dimension
error 0.21 %, 6/6 rooms within 10 %, ceiling within 2.5 cm, orientation exact) and 7 (staging
deferred). 3 is done except for the caveat in its own paragraph above.

The demo unit carries it end to end: `public/demo/floorplan-oak-unit3.png` prints all six rooms'
dimensions in feet and inches with the draughtsman's metric restatement, the seed re-reads that
printed string with `metresFromDimensions` and measures every room against it with the same
`shared/fusion` functions the worker calls, and the hub leads with *6 of 7 rooms measured · median
0.5% against the plan* (the seventh is the furnished flat, a showcase world from another building
with no sheet to compare against). The viewer's measured panel carries the same lines per room.

**And it is walkable** (2026-09-08). The demo's corridor is photographed like every other room —
`ensureHallwayRoom` in `src/state/seed.ts`, simulated from the same `mockRawGeometry` at the size
the drawing prints — so all five of the rooms that open off it have a doorway that leads somewhere
a renter can stand, and the corridor has five markers, one per room. Until it did, every doorway in
the unit led to the one room nobody photographed: the shell cut the hole the plan says is there,
no marker stood in it, and walking into it did nothing. Two rules made that a hole to nowhere
rather than a plain wall, and both are fixed with it: `layoutFloor` now tries a parent's long walls
first for **every** child (a corridor is flanked, not capped) and can pack a room flush against a
sibling, so five rooms off a 7.00 × 1.20 m hallway get five distinct doorways instead of two
stacked on a 1.20 m end; and `doorBetween` marks a door `nominal` unless the two rooms actually
touch across the wall, so a room the layout could not place says so instead of claiming a wall it
never reached. `tests/demo-plan.test.ts` walks it, and pins that no two doorways of one room are
the same hole.

**Measuring twice gives the same answer** (2026-09-08). `measureRoom` always fits the scale from
the room's own wall rectangle when the mesh found one, whatever `method` the stored bounds carry:
`method` is pass two's answer about which rectangle to *draw*, and `writeMeasurement` persists it,
so taking it as an input to pass one meant every later re-fusion measured a different room from the
one the world was measured with. A no-op `PATCH` — the same plan dimensions the room already held —
moved a real room's published scale by 48 % and dropped its EXIF residual, because the wall the
photograph faces had moved to the far side of the bounding box. Only rooms whose collider ran
through a doorway were affected (they carry `confidence: 0` already, but their published width,
depth and "plan says / model measures" lines moved by half). `tests/worker-measure.test.ts` pins
both the arithmetic and the `PATCH`.

**What remains, named.**

- *The room's geometry is not folded onto the plan's frame*, by the decision recorded in item 3.
  `TurnPolicy.foldedQuarters` is the one place it would go. Nothing in the tree has a non-zero
  quarter turn today: it is recovered from measured collider openings, and neither demo world
  reports any.
- *Adjacency is inferred* (the caveat in section 1): the plan parser returns door counts, never
  which two rooms a door joins, so that row of the contract measures our own inference.
- *Auto-stage still places against `room.geometry.door`.* The fit report, the drag status and the
  renter's verdict now judge the swing against the doorways the shell actually cut (`doorSwings`
  takes them; `fitReport`, `pieceStatus` and `buyerVerdict` take them last and optional), so a piece
  across the drawn doorway is named rather than passed as "everything fits". `autoStage`'s own
  placement heuristics — `farFromDoor`, the wall it keeps clear — still read the room's door spec,
  so on the demo's living room it still parks the TV console in the drawn doorway; the difference is
  that the report says so. Staging is deferred and off by default; threading the doorways through
  `proposeFor` and the repair search is the other half.
- *`roomExtent`'s one-room gate* still rejects the full-quality flat's genuine 77 m² open-plan
  measurement, so that room is placed and walked as an `aabb`.
