# What is on phase2-furniture-staging, and what is worth taking

Chaitanya's rental product lives in full on `phase2-furniture-staging` (`fe17de6`).
Nothing there is lost. This file is the menu: what each piece does, what it costs
to bring across, and what it depends on.

The two codebases differ in kind. This branch is plain JavaScript, one page, no
router and no store. That one is TypeScript with Zustand, React Router and
Supabase. So the pure-maths modules port by copying; anything that reaches into
his state layer is a rewrite.

Line counts are from `fe17de6`.

---

## Measurement and accuracy

### Measure a room from the collider mesh — `shared/collider.ts`, 989 lines
Turns the collider mesh Marble already returns into real wall positions and room
dimensions. Pure functions, no state, no network. This is the piece that would
change this product most: it replaces the floor-height slider you drag by eye
with a measurement taken from the model's own geometry.

**Depends on:** nothing outside itself and a few types.
**Verdict:** the one to take first.

### EXIF scale prior — `shared/exifPrior.ts`, 352 lines
Reads the camera's field of view out of the photo's EXIF and uses it to constrain
scale (metres per raw unit, σ 15 %). Free accuracy from a file you already have.

**Depends on:** `shared/fusion.ts` for the constraint shape.
**Verdict:** cheap, take it with the collider work.

### Door-height anchor — `src/engine/anchor.ts`, 246 lines
Uses a standard 2.03 m door as the scale reference, so nobody has to type a
measurement. Also carries plausibility warnings for rooms that come back absurd.

**Depends on:** `engine/geometry.ts`.
**Verdict:** take, it removes the anchor step rather than adding one.

### Fit report — `src/engine/fit.ts`, 220 lines
Door swings, walkway clearance, overlaps, wall gaps, tight spots. Answers "does
it fit, and can you still open the door", which is the question a renter has.

**Depends on:** `engine/geometry.ts`, `engine/anchor.ts` for `MIN_WALKWAY_M`.
**Verdict:** take once the room is actually measured. Useless before that.

---

## Sun

### Solar position — `src/engine/sun.ts`, 124 lines
NOAA's algorithm, same as `src/sun.js` on this branch. **His also maps the sun
into the room's frame**, so light comes through the reconstructed windows rather
than only telling you the hours. That part this branch does not have.

**Verdict:** replace `sun.js` with his, or port just the room-frame mapping.

### Time-of-day slider — `src/screens/viewer/TimeOfDay.tsx`, 116 lines
Drag an hour, the real sun moves in the room.

**Depends on:** the tour's site and building heading, which is his state model.
Needs a small rewrite to read from this branch's world object instead.

---

## Furniture

### Auto-stage — `src/engine/autostage.ts`, 506 lines
Asks a model to arrange a room, then validates the arrangement against the
geometry engine so nothing lands inside a wall. The validation is the good part
and works without the model.

**Depends on:** `engine/catalog.ts`, `engine/geometry.ts`, and Nebius for the
arrangement itself.

### Catalog — `src/engine/catalog.ts`
Reference dimensions per category, same idea as `src/data.js` here, better typed.
**Verdict:** no reason to port; this branch already has one.

---

## Blocked without a Nebius key

### Photo analysis — `src/services/ai.ts`, 481 lines
Vision model reads room type, whether the room is empty, whether a door is
visible, and photo quality.

### Floor plan reader — `src/services/floorplan.ts`, 643 lines
Reads a plan image for room names and the metres the draughtsman printed.

**Verdict:** both are dead until `NEBIUS_API_KEY` exists.

---

## Viewer extras

### Share links — `src/screens/viewer/share.ts`, 61 lines
A public `/t/:shareId` URL for one room, plus the disclosure line.
**Verdict:** cheapest useful thing on this list, but needs a route, and this
branch has no router.

### Stills renderer — `src/screens/viewer/StillsRenderer.tsx`, 244 lines
Renders still images out of the 3D view, for listing photos.

---

## Leave behind

`server/pipeline.ts` (1,864), `server/worker.ts` (776), the Supabase schema,
auth, storage, and the tour / room / job / publish state model. That is the spine
of the rental product. Taking it means taking his architecture back, which is the
thing this branch deliberately moved away from.

---

## Suggested order

1. `shared/collider.ts` + `shared/exifPrior.ts` + `engine/anchor.ts` — makes the
   scale claim real instead of a slider.
2. `engine/fit.ts` — now that the room is measured, answer the renter's question.
3. The room-frame part of `engine/sun.ts` — light through the real windows.
4. Share links, if a router is worth adding.

Everything else waits on a Nebius key or is already here.
