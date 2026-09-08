# Audora backend: inputs, determinism, pipeline, schema

The problem, as set on 2026-09-08: given the photos of an apartment unit or house, its layout with
dimensions, its address and other attributes, generate an interactive 3D tour with the World Labs
models, as deterministically as the models allow, and keep the app's metadata in a real backend
(Supabase). This document is the contract; `supabase/migrations/0001_init.sql` is the schema and
`server/` is the implementation.

## 1. What information we need

Everything below is per unit. "Required" means the pipeline refuses to run without it; "improves"
means the result gets more accurate or more deterministic when it is present.

| Input | Level | Why it matters | Where it lands |
|---|---|---|---|
| Address, unit number, floor level | required | Site, sun, freshness key, listing identity | `properties`, `units` |
| Photos, at least one per room, of the empty room from a corner or the doorway showing two walls, floor and ceiling edge; originals, no HDR merges, no fisheye | required | The reconstruction input; one photo makes a world, 2 to 4 angles make a better one, up to 8 in reconstruction mode | `photos` (original + canonical copy) |
| Room label per photo (or our vision model assigns one, and the leasing team confirms) | required | Rooms are the unit of generation | `photos.room_id`, `rooms.type` |
| Scale anchor per room: door height (2.03 m standard), outlet height, printed ceiling height, floor-plan dimension, or a known object | required, one of | Draft-tier worlds carry no metric scale; the anchor is what makes measurements honest | `rooms.anchor` |
| Floor plan image, ideally with printed dimensions and a north arrow | improves | Room list, metric dimensions (±5 cm), door and window positions, adjacency, orientation | `floor_plans.parsed`, `rooms.plan_dims` |
| Listed beds, baths, square feet, rent, availability | improves | Listing card, sanity check on the plan, marketplace feed | `units` |
| Ceiling height | improves | Anchor fallback (2.44 m ±12 cm assumed otherwise), prompt detail | `rooms.anchor`, prompt |
| Which way the windows face (compass, or from the footprint) | improves | Real sun through the real windows | `properties.site.heading`, `rooms.north_wall_heading` |
| Photo EXIF (focal length, sensor, capture time) | improves | Field-of-view prior for scale; capture time for lighting in the prompt | `photos.exif` |
| Extra angles with a left/centre/right/back label | improves | Azimuth hints for the multi-image prompt | `photos.angle`, `photos.azimuth` |
| Finishes and notes (flooring, paint, renovated year) | improves | Prompt detail; freshness reasons | `units.summary`, prompt |
| Listing URL (Zillow, Redfin, Compass, PMS feed) | improves | Photo import, attributes import, the marketplace link back | `units.listing_url` |
| Video walkthrough | later | Marble accepts video prompts; frames are more angles | `photos` (extracted frames) |

Derived, never asked for: lat/lon and building footprint (OpenStreetMap), sun times and window
sun strips, room adjacency from the plan, photo quality scores, room type from the vision model.

## 2. Determinism contract

Generative models are stochastic; the tour is made as repeatable as the models allow, and where
they allow nothing, repeatability is enforced by never asking twice.

1. **Canonical inputs.** Every photo is canonicalised (EXIF stripped, longest side 2048 px, JPEG
   quality 90, fixed encoder) and hashed. The plan, dimensions, anchor, address and attributes are
   normalised (units to metres, numbers rounded to fixed precision, keys sorted).
2. **The recipe.** A room's generation request is a canonical JSON document: pipeline version,
   provider and model id, tier, the ordered photo hashes with azimuths, the compiled text prompt,
   `reconstruct_images`, `is_pano`, the anchor, the plan dimensions, and the site (lat/lon rounded
   to 5 decimals, heading rounded to whole degrees). `recipe_hash = sha256(recipe)`.
3. **The seed.** Marble's `seed` (0 to 4294967295) is the first 32 bits of the recipe hash. The
   same recipe always asks Marble for the same seed.
4. **No recaptioning.** `disable_recaption: true`, so the prompt we compile is the prompt Marble
   uses; Marble's own captioner is a second stochastic model and it is switched off.
5. **Never generate twice.** `worlds.recipe_hash` is unique among non-failed worlds *of one
   organisation* (`worlds_recipe` is on `(org_id, recipe_hash)`). A request whose recipe already has
   a world in the caller's organisation attaches that world; regeneration happens only when an input
   changes (new photos at turnover, a corrected dimension) or the pipeline version is bumped. The
   organisation is the scope because a world is org-owned — its room, its storage objects, its cost —
   so another tenant that computes the same recipe gets its own world rather than a pointer into
   someone else's.
6. **Language models at zero temperature with a seed.** Photo analysis, floor-plan reading and
   staging run at temperature 0 with `seed` set from the input hash, on pinned model ids, and their
   outputs are cached by input hash (`ai_calls.input_hash`, `stagings.input_hash`).
7. **The engine is pure.** Geometry, anchors, fit verdicts, walkways and placement repair use no
   randomness. Room extent comes from the collider mesh, which is fixed once the world exists.
8. **Time is an input, not a clock.** The sun is computed for the stored `previewTime`, never for
   "now". Generated ids are hashes or database ids, not timestamps.
9. **Provenance.** Every world stores its recipe, seed, model, pipeline version, provider ids,
   cost and timing, so any tour can be explained and reproduced.

What this does not promise: two calls to Marble with the same seed are expected to match, but the
provider does not guarantee bit-identical output across model updates or infrastructure changes.
That is why rule 5 is the one that actually holds, and why the model id is part of the recipe.

## 3. Prompt compilation

Marble has fields for images, azimuths, a seed, panorama handling and a text prompt, and nothing
else. Every attribute Marble has no field for is compiled into the text prompt, as detailed as the
data allows, by a pure function (`server/prompt.ts`, `compileMarblePrompt(recipe)`), in a fixed
order so the same inputs always produce the same text:

1. What the images are: "N photographs of one real, empty <room type>, taken from the <angle>".
2. Geometry: width and depth from the plan (metres and feet), ceiling height, which walls carry
   the door and the windows and where along the wall (from the plan or the photo analysis).
3. Openings: door count and swing, window count, sizes when known.
4. Finishes from the photo analysis and the listing: flooring, wall colour, trim, fixtures.
5. Context: floor level, building type and age from the listing, city; which way the windows face
   and the time of day the photos were taken (lighting).
6. Constraints: "the same room in every image; keep the real geometry; do not add furniture,
   people or extra rooms; walls, floor and ceiling as photographed".

Unknown attributes are omitted rather than guessed, so the prompt never invents a dimension the
data did not contain. The compiled prompt is part of the recipe, and `disable_recaption` keeps it
verbatim.

## 4. Pipeline

All of it runs on the server; the browser only uploads, watches and walks.

1. **Intake.** Create the property and unit; upload photos and the plan to Storage (original and
   canonical copies); record hashes.
2. **Analyse.** Vision model labels each photo (room type, empty or not, door visible, quality);
   the plan reader extracts rooms, dimensions, doors and the north arrow; the leasing team confirms
   room assignment and anchors. Cached by input hash.
3. **Recipe.** For each room, build the recipe (section 2), compile the prompt (section 3), derive
   the seed, look up `worlds` by `recipe_hash`. Hit: attach. Miss: enqueue a `generate` job.
4. **Generate.** The worker submits `worlds:generate` (draft by default, full on request), stores
   the operation id, polls, and on completion enqueues `copy_assets`.
5. **Own the assets.** Splats at every resolution, the collider mesh, the panorama and the
   thumbnail are copied into the `worlds` bucket under the world id; provider URLs are kept only
   as provenance. The collider is then measured (floor, ceiling, wall rectangle, openings) and the
   metric room derived with the anchor — **not implemented on the server yet**: `worlds.bounds` and
   `rooms.geometry` stay null on a backend-generated world, and the measurement lives only in the
   browser (`colliderGeometry` / `rawFromBounds` in `src/services/marble.ts`, run by
   `src/state/jobs.ts` after a generation it started itself). A reader of the public tour has the
   collider URL and can measure it the same way; nothing on the server does it for them.
6. **Stage** (optional, later). Auto-stage at temperature 0 with a seed; cached by input hash.
7. **Publish.** Share id, model date (newest world), disclosures. The public tour endpoint reads
   only published rows.
8. **Freshness.** New photos at turnover change the recipe and trigger regeneration of exactly the
   rooms whose inputs changed. Unit types share worlds across identical units *of one organisation*
   until a unit gets its own photos — so a room reaches its world either by `worlds.room_id` or by
   the `rooms.draft_world_id` / `full_world_id` pointer it was given, and every reader (and the
   `worlds` public-tour policy) has to follow both.

## 5. Schema (Supabase)

`supabase/migrations/0001_init.sql`. Organisation-scoped tables all carry `org_id`, so row-level
security is one predicate (`is_org_member`). JSON columns hold the shapes the app already uses.

| Table | Holds |
|---|---|
| `organizations`, `org_members` | Leasing teams and who belongs to them (Supabase Auth users) |
| `properties` | Address, lat/lon, site (footprint, heading, sun strips) |
| `unit_types` | Floor-plan families; worlds are shared across identical units |
| `units` | The listing: number, floor, beds/baths/sqft, rent, availability, status |
| `floor_plans` | The drawing (Storage path + hash) and what the reader parsed |
| `rooms` | Type, order, plan dims, anchor, metric geometry, draft and full world pointers |
| `photos` | Original and canonical Storage paths, hashes, role/angle/azimuth, EXIF, analysis |
| `worlds` | Recipe, hash, seed, model, provider ids, our asset paths, bounds, cost. Unique per recipe |
| `jobs` | Queue with kinds analyze / parse_plan / generate / copy_assets / stage / publish, locking and retries |
| `stagings` | Placed pieces per room, cached by input hash |
| `publications` | Share id, published flag, model date, disclosures |
| `visitor_stuff` | Renters' saved furniture by visitor id (through the server only) |
| `analytics_events` | Visits, walks, fit tests, per unit |
| `ai_calls` | Cost and cache log for every model call |

Storage buckets: `photos` and `plans` (private, keyed `<org_id>/<unit_id>/...`), `worlds` and
`stills` (public read; hashed bundles are safe to cache forever). Realtime is enabled on `jobs`
and `rooms` so the app can show progress without polling.

## 6. Server API

Served by `server/prod.ts` in production and the Vite plugin in development. Authenticated routes
take a Supabase access token as `Authorization: Bearer` and act inside the caller's organisation;
public routes need nothing. When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are not set the
routes answer 503 and the app keeps its browser-local store, so nothing existing breaks.

| Route | Purpose |
|---|---|
| `POST /api/v1/units` | Create property (if new) + unit + rooms |
| `GET /api/v1/units/:id` | Unit with rooms, photos, worlds, jobs, publication |
| `POST /api/v1/units/:id/photos` | Upload one photo (original + canonical), returns hashes |
| `POST /api/v1/units/:id/floor-plan` | Upload the plan; enqueues `parse_plan` |
| `POST /api/v1/units/:id/generate` | Build recipes; attach cached worlds; enqueue `generate` for the rest |
| `GET /api/v1/units/:id/jobs` | Job list (Realtime carries the live updates) |
| `POST /api/v1/units/:id/publish` | Publish / unpublish; sets the model date |
| `GET /api/v1/public/:shareId` | The public tour document (rooms, worlds with our asset URLs, stagings, site, disclosures) |
| `POST /api/v1/public/:shareId/events` | Analytics from the public page |
| `GET/POST /api/v1/stuff` | Renter's saved furniture by visitor id |

The existing `/api/marble/generate` route also accepts `seed` and `disableRecaption` now, so the
current browser flow gets the same determinism before the store moves.

## 7. Environment

```
SUPABASE_URL=                 # https://<ref>.supabase.co, or http://127.0.0.1:54321 locally
SUPABASE_SERVICE_ROLE_KEY=    # server only, never shipped
SUPABASE_ANON_KEY=            # for the browser client (auth + realtime); public by design
PIPELINE_VERSION=1            # bump to invalidate every recipe on purpose
```

Local: `supabase start`, then `supabase db reset` applies the migration. Hosted: create a project,
`supabase link --project-ref <ref>`, `supabase db push`, set the three keys in Render.

## 8. From the browser store to the backend

The app's store stays as the offline and demo path. The migration is one adapter
(`src/services/backend.ts`): when `/api/status` reports `backend: true`, the wizard creates units
through the API, photos upload instead of living as data URLs, jobs come from Realtime, and the
public tour page reads `/api/v1/public/:shareId`. Shapes are unchanged, which is why the JSON
columns mirror `src/state/types.ts`.
