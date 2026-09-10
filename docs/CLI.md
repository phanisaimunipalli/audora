# audora CLI: photos in, a localhost URL out

A small command-line tool on top of the existing pipeline. Give it a folder of photos of a room or
a unit, it generates the 3D model with World Labs Marble (deterministically, with a cost
confirmation), stores the result locally, and prints a localhost URL where the existing viewer
lets you walk, orbit and measure it. No Supabase, no browser store required to get there.

## Usage

```
npx audora generate <photos-dir> [options]
    --tier draft|full        draft (default, ~35 s, no metric scale) or full (~10 min, metric scale)
    --name "Unit 3"          unit name shown in the viewer (default: folder name)
    --plan <image>           a floor plan image; parsed for room dims if the AI key is set
    --dims living=5.3x5.8,bedroom=3.3x3.8   printed plan dims per room, metres (width x depth)
    --ceiling 2.6            printed or known ceiling height in metres (default: assumed 2.44 ±0.12)
    --address "1247 Oak St, San Francisco"   for the site and the sun (optional)
    --yes                    do not ask before spending credits
    --open                   open the URL in the default browser when done
    --port 5173              which local server the URL points at (default: the dev server; 10000 for npm start)
npx audora list              units generated so far, with their URLs
npx audora open <id>         print (and --open) the URL of a unit
npx audora serve             start the production server (npm start) if nothing answers on the port
```

Environment: `WORLDLABS_API_KEY` from `.env` (or the shell). `MARBLE_MOCK=1` runs the whole flow
with the mock provider and spends nothing. `NEBIUS_API_KEY` is optional: with it, photos get a
room-type label and the plan is read; without it, room names come from folder names.

## Input layout

- A flat folder is **one room**: every image is an angle of the same room, sorted by file name;
  the first is the primary shot (or the one whose name contains `primary`). A name ending in
  `-left`, `-right`, `-back` (before the extension) gives the azimuth hint. Up to 8 images; more
  than one switches Marble to reconstruction mode.
- Subfolders are **rooms of one unit**: the folder name is the room name (`living`, `bedroom-1`,
  `kitchen`), the room type is inferred from the name (living, bedroom, kitchen, bathroom,
  dining, office, hallway, other) or from the vision model when a key is present.
- Accepted: jpg, jpeg, png, webp, heic (heic only when sharp can decode it). Everything is
  canonicalised exactly as the backend does (EXIF read then stripped, longest side 2048, JPEG q90).

## What it does, in order

1. Canonicalise and hash every photo (`server/photos.ts`).
2. Build the recipe per room (`server/recipe.ts`): photos, azimuths, compiled prompt, tier, model,
   dims, ceiling, address. `recipe_hash` and the Marble `seed` follow from it.
3. **Cache**: `.audora/local/worlds/<recipe_hash>.json` already exists → reuse that world, spend
   nothing. Same photos, same options, same URL, every time.
4. Otherwise show the cost (draft $0.18 or full $1.26 per room, from the live price when known)
   and ask; `--yes` skips the question. Submit with `seed` and `disable_recaption`, poll, wait for
   the panorama, fetch the world (the same provider code the worker uses).
5. Download the assets into `.audora/local/assets/<world_id>/` (spz 100k/500k/full, collider,
   pano, thumbnail) so the model opens offline and outlives the provider's URLs.
6. Measure the collider (`shared/collider.ts`) and fuse the scale (`shared/fusion.ts`) with the
   dims, ceiling and Marble's metric scale; keep residuals and confidence.
7. Write `.audora/local/units/<unit_id>.json` (`unit_id` = first 8 hex of sha256 over the sorted
   recipe hashes, so the URL is deterministic) and print
   `http://localhost:<port>/t/<unit_id>`.

## The unit file

```json
{
  "id": "3f9a1c2e", "name": "Unit 3", "createdAt": "…", "address": "…", "tier": "draft",
  "rooms": [{
    "id": "living", "name": "Living room", "type": "living", "order": 0,
    "photos": [{ "file": "IMG_1.jpg", "sha256": "…", "canonicalSha256": "…", "angle": null, "azimuth": null, "width": 4032, "height": 3024 }],
    "recipeHash": "…", "seed": 123, "prompt": "…", "model": "marble-1.0-draft",
    "world": { "worldId": "…", "assets": { "spz": { "100k": "/local-assets/<id>/spz-100k.spz", … }, "collider": "…", "pano": "…", "thumbnail": "…" },
               "metricScaleFactor": null, "groundPlaneOffset": null, "bounds": { … }, "raw": { … }, "credits": 230, "seconds": 38 },
    "planDims": { "width": 5.3, "depth": 5.8 }, "anchor": { … }, "measurement": { … }
  }],
  "plan": null
}
```

## Server and app

- Server (dev plugin and production server): `GET /api/local/units`, `GET /api/local/units/:id`,
  and `/local-assets/<world_id>/<file>` served from `.audora/local/assets` (immutable caching,
  correct content types for .spz, .glb, .png, .webp). Read-only; nothing under `/api/local`
  writes.
- App: `/t/:id` first looks in the browser store; when nothing matches it fetches
  `/api/local/units/:id`, imports the unit as a tour (rooms with their worlds, anchors, geometry
  from the file's measurement, plan dims, the unit graph when a plan exists), and renders the
  same viewer: walk, photo, dollhouse, measure, layers, unit map and portals. A small "local"
  badge says where it came from. Re-opening the URL re-imports only if the file changed.

## Determinism and safety

Same photos and options → same recipe hashes → same unit id → same URL, no regeneration. The
CLI never generates without a confirmation or `--yes`, honours `MARBLE_MAX_GENERATIONS`, and
runs end to end with `MARBLE_MOCK=1` for tests and dry runs.
