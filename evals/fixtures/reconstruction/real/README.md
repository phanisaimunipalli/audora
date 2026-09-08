# Real units for the reconstruction eval

`evals/reconstruction.eval.ts` measures every collider it finds here and reports the table in
docs/ACCURACY.md section 1. It **never downloads anything**: a collider is scored only when its
bytes are already on this disk. That is why this folder starts empty, and why the eval's dimension
numbers are, until someone fills it, a statement about the arithmetic rather than about Marble.

The synthetic corpus next door (`../synthetic/`) has exact ground truth but flat walls and square
corners. A real unit — a room somebody photographed, with the dimensions its floor plan prints — is
worth more than all six of them.

## Adding one

1. **Put the collider `.glb` in this folder.** From a world record, that is
   `assets.mesh.collider_mesh_url`:

   ```sh
   curl -sSL "$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).assets.mesh.collider_mesh_url' path/to/world.json)" \
     -o evals/fixtures/reconstruction/real/my-unit-living.glb
   ```

   Colliders are 5–30 MB, so they are not committed. Everyone who wants the numbers fetches them
   once; the manifest is what travels.

2. **Add an entry to `manifest.json`** with whatever ground truth you actually have. Every field
   except `id` and `collider` is optional, and anything missing is reported as `—` rather than
   guessed:

   ```json
   {
     "units": [
       {
         "id": "alder-ln-living",
         "title": "88 Alder Ln · living room",
         "collider": "alder-ln-living.glb",
         "plan": { "widthM": 4.32, "depthM": 5.18 },
         "ceiling": { "heightM": 2.7, "printed": true },
         "yawDeg": 47,
         "door": { "wall": "south", "offsetM": 1.2, "widthM": 0.86 },
         "metricScaleFactor": 2.2239592,
         "note": "marble-1.1, full quality. Plan dimensions from the listing sheet."
       }
     ]
   }
   ```

   | field | what it is | where it comes from |
   | --- | --- | --- |
   | `plan` | the room's printed dimensions, metres | the floor plan. This is the reference for dimension error, so give it exactly as printed (±5 cm is assumed). |
   | `ceiling.heightM` | floor to ceiling, metres | the plan (`printed: true`, ±3 cm) or a tape. Omit it and the room is scaled by the standard 2.44 m assumption and its ceiling is not scored. |
   | `yawDeg` | the room's yaw against the collider's raw axes, degrees | the plan's north arrow versus the direction the photographer faced. Only needed for the orientation row. |
   | `door` | the doorway in Audora's own convention | `wall` is `north`/`south`/`east`/`west` of the *metric* room (north is the low-z wall, the one facing the capture point); `offsetM` is measured along that wall from its west end (north/south walls) or its north end (east/west walls); `widthM` is the clear opening. |
   | `metricScaleFactor` | Marble's own estimate, metres per raw unit | `assets`/world record, full tier only. Draft worlds carry none. |

3. **Run `npm run eval`.** No dev server, no keys: the reconstruction eval is pure arithmetic over
   bytes. The new unit appears in every table in `evals/results/reconstruction-latest.md`.

## The demo world

`public/demo/marble-world-corner-windows.json` is picked up automatically when its collider is
cached here as `marble-world-corner-windows.glb` (the eval prints the exact `curl` line when it is
missing). It is a real Marble draft of a Wikimedia photograph and has no floor plan, so it is
measured and reported but not scored for dimension error.

What it should measure, from the read hard-coded in `src/state/seed.ts` (76k vertices, verified
against the mesh's own wall planes): a wall rectangle **4.3736 × 5.9085 raw units at 47.0°**, floor
plane −1.5953 and ceiling 1.8239, `score` 0.8 — 3.00 × 4.06 m at the assumed-ceiling anchor, against
a bounding box of 7.83 × 7.33 units that contains the building outside both windows. If a change to
`shared/collider.ts` moves those numbers, the demo tour ships different dimensions.
