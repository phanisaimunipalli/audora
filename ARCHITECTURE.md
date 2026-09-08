# Audora — architecture brief

Audora is "Matterport, but AI generated": one photo per room → a walkable, honestly measured 3D tour of a listing that a buyer can test their own furniture inside. Read `../../../Downloads/audora-experience.md` is NOT available to you; the product doc is summarised here and the code is the contract.

## Product in one breath

- **Seller / agent** pastes a listing URL or uploads room photos, taps the door in each photo (the *scale anchor*), and hits Generate.
- **Generation takes minutes** (Marble draft ≈ 1 min, full ≈ 10 min). The UX is *deep-research style*: the job starts instantly, shows honest progress, the user can leave the page or the tab, and gets a browser notification + in-app toast + title badge when it's done. Jobs survive reloads (persisted store, runner resumes).
- **Buyer** opens a share link (`/t/:shareId`), lands *standing in the room at 1.60 m eye height*, walks it (WASD / touch), toggles staging off to see it bare, measures anything, and **tests their own furniture** ("sectional, 220 by 95" → "Your sectional fits. 0.83 m walkway remains to the window wall."). My Stuff remembers their furniture across listings.
- **Agent dashboard** closes the loop: visitors, walked, tested, most-tested pieces, fit failures per room.
- The **anchor is the moat**: every number in the UI is derived from one declared reference (door 2.03 m, outlet 0.30 m, typed wall, floor plan) with a stated ± uncertainty. It is displayed *permanently* wherever a number is shown (`<AnchorChip anchor={room.anchor} />`). Every artifact says "digitally staged".

## Stack

Vite 8 · React 19 · TypeScript · Tailwind v4 (`@theme` tokens in `src/index.css`) · react-three-fiber 9 / drei 10 / three 0.185 · zustand 5 (persisted to localStorage) · react-router 7 · framer-motion 13 (installed, optional) · `@sparkjsdev/spark` for real Marble splats · vitest.

Run: `npm run dev` (http://localhost:5173). `npm run typecheck`, `npm test`, `npm run build` must all pass — run them before you finish.

Keys live in `.env` server-side only (`server/api.ts` mounts `/api/*` on the Vite dev/preview server). **Never** read `import.meta.env` for secrets; never add `VITE_` secrets.

## Design language (already in `src/index.css` and `src/components/ui.tsx`)

Light editorial, adopted from the deployed prototype (**`docs/DESIGN.md` is the contract**; the
prototype's own source is in `docs/reference/`). White page `bg` #ffffff, surfaces
`surface`/`surface-2`/`surface-3` (#f7f7f7 / #efefef / #e6e6e6), hairlines `line`/`line-2`, ink
`ink`/`ink-2`/`ink-3` (#0a0a0a / #454545 / #737373) with `dim`/`faint` as the prototype names them.
**The ink is the accent**: `accent` #0a0a0a, `accent-deep` #000000, `accent-soft` #f2f2f2, so
`accent-2` is emphasis ink and never a colour. `gold` #7a6a3f is the one warm accent (anchors,
"digitally staged"); `buyer` blue #1d63ff belongs to the buyer's furniture and buyer UI and nothing
else; `ok` #2f7a52 / `danger` #c0392b (+ `danger-soft`, `danger-line`) are the fit verdicts; `warn`
#8a6a2a is the ochre for a caution. Fonts: `.display` = Gilda Display for headlines, body Manrope,
`.mono` = system mono (`ui-monospace, SF Mono, Menlo`) for every number / anchor / dimension.
Utilities: `.micro` (the uppercase 0.16em micro-label used for every section, panel and field
heading), `.panel`, `.glass` (82% white + blur, for panels over the 3D), `.popover`, `.chip`,
`.skeleton`, `.grid-bg`, `.ring-accent`, `.animate-rise`, `.animate-fade`. Use `Button`,
`pillClass` (the same recipe for `<Link>`s that must look like buttons), `Card`, `Chip`, `Stat`,
`Field`, `Input`, `Select`, `Toggle`, `Progress`, `Segmented`, `SectionTitle`, `Callout`,
`EmptyState`, `StagedLabel`, `Kbd`, `IconButton` from `@/components/ui`, the HUD set (`Wordmark`,
`TopBar`, `HudPill`, `HudPanel`, `PanelLabel`, `MetricRow`, `RoomStrip`) from
`@/screens/viewer/hud`, and icons from `@/components/icons` (`Icon.Walk`, `Icon.Orbit`,
`Icon.Ruler`, `Icon.Door`, ...). Numbers are the product: show real dimensions in cm/m everywhere,
in mono. 3D canvases sit on `HOUSE_BG` #f4f4f4, never a dark void.

Feel: confident, quiet, precise. Generous whitespace, 10/14/18 px radii and 999px pills for every
action (primary = black fill / white text, secondary = white + `line-2` hairline, ghost = quiet
dim text), two shadows only (`shadow-sm`, `shadow-soft`), subtle motion on `ease-audora`
(`cubic-bezier(.33,1,.68,1)`), nothing louder than a hairline. Mobile must not break (buyer view is
opened from a phone).

## Coordinate frame (engine)

Metres, radians. Room centre at origin, floor y=0, **x east, z south**; north wall at `z = -depth/2` (the far wall when you stand in the south doorway). A piece's `rot` is rotation about +y; `rot=0` means its front faces south (+z) — i.e. a sofa with its back against the **north** wall has `rot 0`, south wall `π`, east wall `-π/2`, west wall `π/2`. `placeAgainstWall(room, wall, along, w, d)` does this for you. Footprint = oriented rectangle `{x,z,w,d,rot}`; rugs are `flat` and never collide.

## Files and ownership

```
src/engine/        pure metric engine (types, geometry, anchor, fit, catalog, autostage)   — DONE, tested (tests/)
src/state/         store.ts (zustand, persisted), types.ts, jobs.ts (runner), collab.ts, seed.ts — DONE
src/services/      marble.ts (World Labs), ai.ts (Nebius Token Factory), listing.ts, mockWorld.ts — DONE
server/api.ts      dev/preview API proxy                                                    — DONE
src/lib/           ids, image (preparePhoto, photoHints), format, notify (Notification API, chime, title badge) — DONE
src/components/    ui.tsx, icons.tsx, AnchorChip, Toaster, AppShell (+ModeBadge)          — DONE
src/three/         viewerStore, RoomShell (textured walls/floor, real openings, near-wall culling), OrbitRig, WalkControls (drag-look, click-to-glide, WASD, touch), SplatWorld (Spark), MeasureTool, Minimap, TouchJoystick, SceneCanvas, stills — IMPLEMENTED
src/three/furniture/ FurniturePiece (procedural, all 18 kinds), StagingLayer (drag/snap/rotate/delete/ghost) — IMPLEMENTED
src/screens/       TourViewer, StageEditor (+ editor/*), PublishPanel, TourInsights (+ insights/*), viewer/*, create/*, hub/* — IMPLEMENTED
src/routes/        Landing (+ components/marketing/*), NewTour, Tours, TourHub, PublicTour, Dashboard, Settings — IMPLEMENTED
src/components/    JobsTray, CatalogRail, FitReportPanel, MyStuffPanel, FurnitureTest — IMPLEMENTED
evals/             autostage.eval.ts, photo-analysis.eval.ts, photos/manifest.json (hand-labelled), results/*-latest.md — `npm run eval`
```

**Keep exported component names and documented props stable** (other modules import them); you may add optional props. During the fix phase you may edit any file under src/ and server/, but keep changes surgical. If you need something from another module that doesn't exist, build a local helper in your own folder instead of editing theirs.

## Store API (`@/state/store`)

`useAudora(selector)` — tours, rooms, jobs, myStuff, events, settings, providers. Actions: `createTour`, `updateTour`, `publishTour`, `addRoom`, `updateRoom`, `removeRoom`, `setAnchor(roomId, anchor)` (recomputes geometry), `setRaw`, `setStaging(roomId, pieces, style?)`, `attachWorld`, `enqueueJob`, `updateJob`, `markJobsSeen(ids?)`, `addMyStuff/updateMyStuff/removeMyStuff`, `track(tourId, type, {roomId, item})`, `setSettings`. Selectors: `selectTour`, `selectRoom`, `selectTourByShare`, `bestWorld(room)`. **For anything that returns an array use the shallow hooks** `useTourRooms(tourId)`, `useTourJobs(tourId)`, `useActiveJobs()`, `useUnseenDone()`, `useTourEvents(tourId)`, `useAllTours()`, `useAllJobs()`, `useMyStuff()` — or wrap your own selector in `useShallow` from `zustand/react/shallow`. A selector like `useAudora(s => Object.values(s.tours))` or `s.events.filter(...)` returns a new array each render and throws "Maximum update depth exceeded". Toasts: `toast({kind, title, body, action:{label,to}})`.

Jobs: `generateTour(tourId, tier?)` / `regenerateRoom(roomId, tier)` from `@/state/jobs` enqueue; the runner (mounted in App) does the rest. `JOB_STEPS`, `stepFor(progress)`, `REAL_ETA`. Job fields: `status queued|running|done|failed`, `progress 0-100`, `step`, `etaSeconds`, `startedAt`, `finishedAt`, `provider marble|mock`, `tier draft|full`, `seen`.

Room: `geometry: RoomGeometry` (metric, derived), `raw`, `anchor: AnchorSpec`, `photo?`, `analysis?`, `draft?/full?: RoomWorld` (`spzUrl` when real), `staging: PlacedPiece[]`, `stagingStyle`, `status pending|generating|ready|failed`.

Engine helpers you'll use: `fitReport(pieces, room)`, `pieceStatus(piece, others, room)`, `buyerVerdict(piece, staging, room)`, `clampToRoom`, `snapToWalls`, `snapRotation`, `autoStage(room, type, style)`, `makePiece(item, x, z, rot, owner)`, `catalogFor(type)`, `parseFurnitureText`, `plausibility(geometry)`, `anchorFromDoor/Outlet/Wall/Floorplan`, `applyScale`. AI (Nebius, with fallbacks): `analyzePhoto`, `aiAutoStage`, `parseFurniture`, `listingCopy`, `fitInsights` from `@/services/ai`. Photos: `preparePhoto(file)`, `photoHints(photo)` from `@/lib/image`. Notifications: `requestNotifications`, `sendNotification`, `setTitleBadge`, `chime` from `@/lib/notify`. Viewer state: `useViewer` from `@/three/viewerStore` (mode orbit|walk, tool select|measure, pose, showStaging, showSplat, selectedId, hoverId, measurement, locked).

## Routes

`/` landing · `/new` create wizard · `/tours` list · `/tours/:tourId` hub (progress while generating, then Tour / Stage / Publish / Insights) · `/tours/:tourId/stage/:roomId` full-bleed editor · `/t/:shareId[/:roomId]` public buyer view (no app chrome) · `/dashboard` · `/settings`.

## Demo data

`seedDemo()` creates "1247 Oak Street" (shareId `oak1247`) with four staged rooms and three days of buyer events (84 visitors, 31 walked, 12 tested, 4 fit failures in the small second bedroom). Use it to develop and to demo.

## Verification bar

- `npm run typecheck && npm test && npm run build` green.
- Open the page in the browser and actually use it (the reviewer will).
- No browser `alert/confirm/prompt` dialogs anywhere.
- Every screen that shows a dimension shows the `AnchorChip`. Every published artifact shows `StagedLabel`.

## Credits guard (read this)

A World Labs key is configured, so generation is LIVE by default and costs real credits (~230 per draft room). While developing or testing, **turn on "Prefer simulated reconstruction" in /settings first** (or set `useAudora.getState().setSettings({ preferMock: true })` in the console). The dev server also refuses more than `MARBLE_MAX_GENERATIONS` (default 3) live generations per process. `activeProvider()` from `@/state/jobs` tells you which one a new job would use; show it in the launch step.

## Real Marble worlds (verified live on 2026-09-05)

One live draft generation was run through the proxy (230 credits, 35 s). Facts the code now relies on:
- `POST worlds:generate` returns only `operation_id`; the `world_id` appears in `metadata.world_id` on the first poll. Progress is `metadata.progress: {status, description}` (no percentage) — the job runner shows the description as `job.detail`.
- Finished world assets: `splats.spz_urls` keyed `500k`, `100k`, `full_res` (CORS `*`, ~5 MB for 500k), `mesh.collider_mesh_url` (.glb, y-up, camera at the origin, room extending toward +z), `thumbnail_url`, `imagery.pano_url`, `caption`. Draft worlds have `semantics_metadata: null` (no metric scale), which is exactly why Audora's anchor exists.
- `fetchColliderBounds(url)` (services/marble.ts) reads the GLB bounds; `rawFromBounds(bounds)` estimates raw room geometry; `splatTransform(world, room.anchor.metresPerUnit)` gives `{scale, position, rotationY: π}` to place the splat / collider inside Audora's metric frame (floor y=0, centre at origin, door on the south wall). **SplatWorld must use `splatTransform`** and should also load `colliderUrl` (GLTFLoader, same transform) for walk-mode collisions when present.
- The demo tour now has a fifth room, "Corner room · real Marble draft", whose `draft` world is real (see `REAL_MARBLE_WORLD` in src/state/seed.ts, world JSON in public/demo/marble-world-corner-windows.json). Use it to test the splat viewer end-to-end. Its anchor is "assumed ceiling 2.44m ±12cm" until a wall length is typed; the seller flow's anchor step should offer that for real worlds.

### Splat / collider axis conventions (measured + from Marble docs)

- SPZ files are in Marble's `marble_raw_opencv` frame (x right, y DOWN, z forward). Marble's own web viewer applies a **180° rotation about X** to SPZ assets → y up, camera looks toward -z (three.js default).
- The collider `.glb` (made by trimesh) is already y-up (floor at y = -1.66 in the demo world) but its room extends toward **+z**, i.e. it is the OpenCV frame turned 180° about Z. A **180° rotation about Y** brings it into the same final frame as the rotated SPZ.
- Both therefore share one final frame after their own rotation; `splatTransform(world, metresPerUnit)` returns the `position` (centre → origin, floor → y=0) and uniform `scale` for that final frame. Implement SplatWorld as:

```tsx
const t = splatTransform(world, room.anchor.metresPerUnit);
<group position={t.position} scale={t.scale}>
  <primitive object={splatMesh} rotation={[Math.PI, 0, 0]} />          // SPZ: rotX(π)
  <primitive object={colliderScene} rotation={[0, Math.PI, 0]} visible={false} />  // GLB: rotY(π)
</group>
```
  Verify empirically with the demo's "Corner room · real Marble draft": standing at the south door looking north, the tall window must be on the LEFT wall and the small window on the FAR wall, as in public/demo/empty-room-corner-windows.jpg. If Spark already applies a conversion for .spz, drop the rotX(π) — the photo is the ground truth.
- Draft worlds have no `metric_scale_factor`; `metresPerUnit` comes from the room's anchor (assumed ceiling 2.44 m until a wall is typed). The demo world's ceiling is 3.55 raw units, so the initial scale is ≈ 0.69 m/unit.

## Merge brief: real rendering from the reference build (2026-09-06)

The teammate's build (clone at `/Users/chaitanyapinapaka/.claude/jobs/48c25776/tmp/audora-ref`, source https://github.com/phanisaimunipalli/audora) renders Marble worlds **photoreally** and that experience must be merged into this app. Only its rendering and geometry ideas move over; furniture, staging, engine, store, screens and design stay ours.

What the reference does (read `src/WorldView.jsx`, `src/world.js`, `src/App.jsx` there; the demo video showed exactly this):
- **Panorama sphere.** Marble returns an equirectangular panorama (`assets.imagery.pano_url`, e.g. `..._pano/rgb_0.png`, 2304×1152 for draft, ~10 MB PNG for full). The reference draws it on a `sphereGeometry(60, 96, 64)` with `scale=[-1,1,1]`, `meshBasicMaterial map side=BackSide toneMapped=false`, texture `colorSpace=SRGB`, camera at the sphere centre (`[0,0,0.01]`, fov 78), `OrbitControls` with `enablePan=false enableZoom=false rotateSpeed=-0.32 target=[0,0,0]`, and a slow auto-"Drift" of the look direction until the first pointer down. This is a look-around from the capture point; it looks like a real photo because it is one.
- **Geometry toggle.** The collider `.glb` drawn as a purple wireframe (`#7c6cf0`, opacity 0.3) with `scale=metricScaleFactor` and `position.y = -groundPlaneOffset`, **unrotated relative to the pano sphere**. In the video, toggling "Geometry" shows the wireframe hugging the pano's walls and furniture.
- **Floor.** Furniture stands on a floor plane at `floorY = -groundPlaneOffset` (metres, after scaling) with a drag plane and a faint grid; a **floor-height slider** in the furniture panel lets the user nudge the floor until pieces sit on the pano floor.
- **Draft pano lands late.** After a draft operation completes, `pano_url` can appear on the world record a few seconds later; the reference polls `/worlds/{id}` every 2.5 s up to ~60 s for it.
- **Full-quality worlds carry metric semantics.** Its demo world (marble-1.1, public CDN, open CORS): `worldId 1580f9a1-2b19-4746-ad56-7ce3d4e5be60`, pano `https://cdn.marble.worldlabs.ai/1580f9a1-2b19-4746-ad56-7ce3d4e5be60/8c7108a9-fe54-4ad3-a61a-6d8c06fbd04c_panos/rgb_0.png`, collider `.../21e5e17d.glb`, spz 100k `.../9701d43b-70c2-4901-b03f-537a45f4df50_dust_100k.spz`, 150k `.../527cc6e9-0464-4f1b-9d0f-a0aadd55f719_ceramic_150k.spz`, 500k `.../e8599403-f224-4dd6-8c35-f7037fb3ddc6_ceramic_500k.spz`, thumbnail `.../b3cddc85-251a-4f57-a56a-96ca33b41cc1_sand_mpi/thumbnail.webp`, `metricScaleFactor 2.2239592`, `groundPlaneOffset 1.3064681`. It is a furnished flat (white doors, dining table, shelves). Use it as a second real demo room — it costs nothing.

Our world for the demo corner room also has a pano: `https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/b1806895-7133-4163-b27c-73e792dc9e25_pano/rgb_0.png` (draft, no metric semantics; collider bounds in `REAL_MARBLE_WORLD`). Looking forward from the capture point you see the tall window on the LEFT wall and the small window on the FAR wall (photo: public/demo/empty-room-corner-windows.jpg). That is the alignment ground truth: the collider wireframe must hug those walls, and a sofa on our metric floor must look like it stands on the pano floor.

Frames: keep ONE Marble group placed by `splatTransform(world, room.anchor.metresPerUnit)` (position, uniform scale, rotationY π) so everything real lives in our metric room frame (floor y=0, centre at origin, south door). Inside it, the reference's relative conventions hold (pano sphere mirrored in X, collider unrotated, SPZ rotated π about X per Marble docs) — but VERIFY visually against the corner room and adjust the pano's yaw/mirror inside the group if the windows land on the wrong walls. When Marble supplies `metric_scale_factor`/`ground_plane_offset` (full model) prefer them: scale = metric_scale_factor, floor from ground_plane_offset; when it does not (draft) use the anchor's metresPerUnit and the collider's minY. A per-room `floorOffset` (metres, persisted) lets the user nudge the floor.

Photo view = the camera sits exactly at the Marble origin mapped into our frame (that is the group's `position`), looks around (drag), zooms with the wheel (fov 40–90), drifts slowly until touched, and cannot move. Furniture (our StagingLayer, procedural pieces, blue buyer pieces) renders on the metric floor in that view; the RoomShell is hidden there (keep an invisible floor plane for drag). Walk view uses the splat when present, else the shell; Dollhouse uses the shell + staging. Public tours of real worlds open in Photo view.

### Priority update (2026-09-06, from the product owner): "as real as possible" — splat first

The goal is the most realistic experience for the buyer, not the panorama specifically. Order of preference for a real Marble world:
1. **Gaussian splat (Spark, `spz_urls`)** — photoreal AND freely walkable, exactly like Marble's own viewer. This is the primary rendering. Load the best resolution the device can handle (`full_res` on desktop when it loads within a few seconds, else `500k`; `100k`/`150k` on phones), keep sorting responsive, splats not tone-mapped, aligned with the metric frame so our procedural furniture stands on the real floor, walk-mode collisions from the collider mesh, eye height 1.60 m.
2. **Panorama** — as the instant backdrop while the splat streams (progressive reveal), for the look-around "Photo" mode on weak devices, and as the fallback when a world has no splat.
3. **Procedural shell** — only for simulated worlds and as the last fallback.
Quality tier: draft for speed while staging; **full (`marble-1.1`) for the published tour** — Publish should offer/queue the full-quality upgrade (credits shown) and the buyer always gets the best world available. Walk mode is the default public experience when a splat exists.

## Product goals from the owner (2026-09-06)

1. **Portrait-mode layers.** Think like iOS portrait photos: the real capture (splat / panorama) is the photo layer; the furniture is a separate layer rendered with the same camera and the room's own light; the two are composited so realism stays intact. Concretely: the panorama as the environment map (PMREM) lighting the furniture; a sun direction estimated from the panorama's brightest region casting shadows onto an invisible shadow-catcher plane on the real floor; the collider mesh written to depth only so real walls occlude furniture behind them; contact shadows under pieces; for listing stills, the same composite captured, optionally harmonised by a Token Factory image model if image-to-image is available.
2. **Data sources for accuracy.** Use the listing floor plan (with dimensions), a group of photos of the unit (uploaded, or from Zillow / Redfin / Compass when obtainable), OpenStreetMap / street-level imagery and a sun map to generate the 3D rendering accurately. Concretely: a floor-plan parser (vision model → rooms with names and metric dimensions → floorplan anchors, ±5 cm); multi-image Marble prompts ("add another angle"); address → geocode (OpenStreetMap Nominatim) → building footprint orientation (Overpass) → solar position for a chosen date/time → a real sun through the windows with a time-of-day control; street-level imagery optional (needs a paid key).

### Sun map decision (owner pointer: shadowmap.org / shademap.app)

Use **ShadeMap's `leaflet-shadow-simulator`** (npm, MIT-style, depends on `suncalc`) in the Site step: a Leaflet map with OSM tiles, the ShadeMap layer with `terrainSource` = free AWS Terrarium DEM tiles (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, `getElevation: ({r,g,b}) => r*256 + g + b/256 - 32768`), `getFeatures` = GeoJSON building polygons from Overpass (`buildingFootprint` in src/services/geo.ts; heights from `height` / `building:levels` × 3 m, default 6 m), `setDate(date)` driven by the time-of-day control, and `isPositionInSun(lat, lng)` sampled at each window's position on the footprint edge to decide whether that window really gets sun at that hour (neighbours' shadows included). Key: `import.meta.env.VITE_SHADEMAP_KEY` (browser-side by design; the owner must obtain one at https://shademap.app/about/). Without a key: no shadow layer, the sun angle still comes from src/engine/sun.ts. Shadowmap.org's API is enterprise-priced; not used.

### Merged and measured (2026-09-06, integrator)

The merge above is in. Four conventions were settled empirically against the two real worlds; they
supersede the guesses earlier in this section.

- **The collider `.glb` is a reflection, not a rotation.** Drawn as delivered the room comes out
  mirrored. `COLLIDER_MIRROR = [-1,1,1]` inside the Marble group puts it back, and it then agrees
  exactly with the SPZ splat (a proper rotation, `rotX(π)`, no mirror). "GLB: rotY(π)" above is right
  about the turn and misses the mirror.
- **Panorama yaw.** three.js maps an equirect texel to `azimuth = 360u − 90°`; mirroring x makes it
  `90° − 360u`, so `PANO_YAW = +π/2` lands it on the `180° − 360u` the mirrored collider needs.
  Verified on both worlds: the wireframe hugs the panorama's walls, window reveals and door frame.
- **The floor is the mesh's floor.** `fetchColliderBounds` now also returns `bounds.floorY` — the
  densest horizontal slab in the bottom quarter of the collider — and `splatTransform` maps that
  plane to y = 0. It beats both alternatives: `bounds.minY` is a stray skirt 6 cm below the floor on
  the draft world, and `ground_plane_offset` is a different plane again, 15 cm above the floor on the
  full-quality one (which is why the reference build needed its floor slider to make furniture stand
  on the photograph). Order of preference: `floorY`, then `ground_plane_offset`, then `minY`.
  `Room.floorOffset` remains as the manual nudge on top.
- **Room extent is measured to the walls, not to the box** (see the next section). The bounding box
  is 7.83 × 7.33 raw units of a room whose walls are 4.37 × 5.91; `bounds.walls` records the fit and
  `bounds.method` says which of the two the room's numbers came from.
- **Walking is bounded by the mesh, not by that box** (`src/three/walkMask.ts`, 2026-09-06). The
  collider's wall band (0.3–1.7 m above our floor) is rasterised into a 12 cm occupancy grid, grown
  by the walker's radius and flood-filled from the capture point; `WalkControls` takes it as `mask`
  and `standable()` marches out from the walker so a click-to-glide stops at the last free point
  instead of sailing through the photographed wall. A mask whose flood escapes the grid, or that
  encloses less than 2 m², is discarded and the room rectangle is used, so the walker is never
  frozen. Measured on the demo corner room: 7.1 m² of standable floor, and the wall band turns out
  to be a **diamond** in our axes — the room really was at ~45° to the capture direction, which is
  exactly why its bounding box is 41% too big. (That turn is now folded into the frame, so the same
  mask comes out as an 8.1 m² rectangle filling 96% of its own bounding box.)
  `window.__audoraWalkMask` exposes it in dev.

Photo view is one shared surface: the same mode switch, the same layers panel and the same frame in
the public viewer, the hub's Tour tab and the staging editor. (That panel is now
`screens/viewer/LayersPanel` — the portrait stack, the sun readout, geometry and the floor nudge;
`components/WorldLayers` was its ancestor and is gone.)

**The measured shell is never drawn over a real capture.** Portrait-mode layering means the photo
layer wins: whenever the panorama or the splat is actually on screen, `RoomShell` is not rendered at
all (it used to fade to `opacity 0.15`, which read as a hard-edged milky box *inside* the
photograph, because its walls are a different size from the real ones). `StagingLayer` carries its
own invisible floor plane, so dragging and the ghost still work with the shell gone. The shell comes
back the moment the capture is switched off or fails to load.

### Room extent is measured to the walls, and the room's own yaw is in the frame (settled)

`fetchColliderGeometry` fits the wall band with a rotation-aware rectangle (`bounds.walls` =
`{minX, maxX, minZ, maxZ, rotation, score, openings}`, `bounds.method`). The demo corner room is
**3.00 × 4.06 m**, within 1 % of the mesh's own wall planes, and it sits at **47°** to Marble's
capture axes because the photographer faced a corner.

That 47° is now part of the frame. `roomRect(bounds)` (services/marble) returns the room **in
Audora's axes** — `{yaw, minX, maxX, minZ, maxZ}`, raw units, capture point at the origin — and it
is the single rule `rawFromBounds`, `splatTransform` and the window finder all share:

```
p_world = P + s · Ry(yaw) · Rx(π) · p_raw        group: position P, rotation [0, π + yaw, 0], scale s
```

- `splatTransform` returns `yaw` beside `rotationY = π + yaw`; `marbleFrame` (three/splat/frame) is
  now just a re-export of it, and `applyMarbleFrame` premultiplies the same yaw onto the SPZ's
  `rotX(π)`. Panorama, splat and collider all hang off that one turn, so the view **from** the
  capture point is unchanged — photo view looks identical before and after, because the camera
  turns with the room (`PhotoRig initialYaw`, walk spawn yaw = `frame.yaw`).
- The horizontal half of `Rx(π)` is `(x, z) → (x, −z)`, a reflection — because y flips too. So **raw
  +x is our east**, not our west. Two offsets were mirrored by the old "180° turn" reading and are
  fixed: the door now lands under the photographer (`-rect.minX` from the west end) and the room is
  centred on the rectangle it was measured with.
- Verified in the browser (headless Chrome + SwiftShader, /t/oak1247 → Corner room): the collider's
  34,948 wall-band vertices land on x = ±1.5 and z = ±2.0 — the 3.00 × 4.06 m room, centred; the
  walk mask is an 8.1 m² rectangle at 96% fill instead of a diamond; the camera spawns at the
  capture point (0.92, 1.60, 1.15) facing yaw 43° and the first frame is the photograph (tall window
  on the left wall, small window ahead, door to the right); and in the dollhouse the purple collider
  wireframe runs parallel to the RoomShell's walls and hugs them.
- Window detection is no longer suppressed: `openingsOf`, `wallAt` and `alongWall` work in Audora's
  axes on a world azimuth, so an opening run names a real wall whatever the room's yaw. The demo
  corner room still reports none — its window band never reaches 1.3× the fitted wall, because
  Marble rebuilt the building outside close behind the glass — which is the honest answer; the
  synthetic room in tests/collider.test.ts covers the path.

Still open: `roomExtent`'s one-room gate (area ≤ 60 m², no side over 9 m) rejects the full-quality
flat's genuine 77 m² open-plan measurement and falls back to the caller's estimate, so that room is
placed and walked as an `aabb` with a 5.5 × 4.0 m rectangle inside a 52.5 m² mask.

### Splat-first: what the buyer actually gets (integrator, 2026-09-06)

The priority update above is implemented. A real Marble room now opens **walking inside the Gaussian
splat**, and the three layers are stacked the way portrait mode stacks a photo:

- **Progressive splats.** `three/splat/tiers.ts` knows a world's whole ladder — `RoomWorld.spzUrls`
  carries every resolution Marble returned (`worldFromMarble`), with `KNOWN_SPZ_TIERS` as the bridge
  for the two demo worlds already sitting in someone's localStorage. `deviceCeiling` caps what a
  machine may load (150k on a small phone, 500k on a phone or a 4 GB / 2-core laptop, `full_res`
  otherwise); `planLadder` fetches the smallest file first and then the best tier ≤ 500k;
  `wantsUpgrade` allows `full_res` only when the previous tier landed in under 4 s *from request to
  on screen*, so a slow GPU disqualifies itself as well as a slow line. `SplatWorld` fetches the
  bytes (`loadSpz`, abortable, byte progress), cross-fades each tier over the last and disposes the
  replaced mesh, and never reloads on a floor nudge. Measured on the corner room here: panorama at
  ~1 s, 100k at ~3 s, 500k at ~6 s, `full_res` (2,276,736 splats, 23 MB) after that.
- **The panorama is the splat's backdrop**, in the viewer *and* the staging editor: it loads
  whenever the splat is wanted, stands behind it while it streams, fades out over 0.6 s once real
  splats are up, and stays mounted because it is also the room's light (PMREM environment + a sun
  estimated from it, `CaptureLight`). The buyer never sees a black frame.
- **An upgrade is not a wait.** While a better tier streams the splat layer keeps reporting `ready`
  with `upgrading` set, so the measured shell is never put back over a capture; the pill reads
  "real capture · 498k splats · full res loading…". `AdaptiveDpr` drops the canvas to 1.0 while the
  camera moves and restores it 320 ms after it stops.
- **Walking** spawns at the capture point facing `frame.yaw` (the photograph), is bounded by the
  walk mask, and falls back to `splat/colliderProbe` raycasts when a mesh does not enclose the
  capture point. `TourViewer` resets its layer status on a world change as well as a room change, so
  a full-quality world landing under an open viewer does not leave a stale "ready".
- **Publish offers the full-quality upgrade** (`state/publish.ts` holds the rules; 1,580 credits /
  $1.26 per full room against 230 / $0.18 per draft), arms before it spends, refuses duplicate jobs,
  and `bestWorld` gives the buyer the best world a room has — except that a *simulated* full never
  displaces a real capture. Tier chips (`hub/TierChip`) appear wherever a room is listed.

Verified end to end in headless Chrome (SwiftShader; judge correctness, not fps) with "Prefer
simulated reconstruction" ON: /t/oak1247 → Corner room walks the real capture with our bed, plant
and nightstand on the photographed floor; the ruler measures 2.25 m ± 12 cm across it; Photo and
Dollhouse switch cleanly; "Test my furniture" answers "Your sofa does not fit here. It overlaps the
queen bed and the nightstand." with the anchor chip; the Furnished flat streams 100k → 500k and
stands our plant on its floorboards with a contact shadow; the hub's Publish tab shows the disabled
toggle, the free rehearsal and the per-room tiers.

### The two goals, integrated (2026-09-06, integrator)

Both owner goals are in and wired into one product. Three seams were closed at merge time.

- **One layers panel, two screens.** `screens/viewer/LayersPanel` (Photo / Furniture / Shadows /
  Occluder, the exploded preview, the measured-light readout, Geometry with its wireframe/occluder
  view, and the floor nudge with its AnchorChip) is now mounted identically in the buyer's viewer
  **and** in the staging editor, with its own `usePortraitLayers` in each. `components/WorldLayers`
  was the editor's older, smaller copy and is deleted. Reaching for the catalogue turns the furniture
  layer back on, and dragging is off while the layer is in the air.
- **The Shadows switch reaches the shadows.** It used to gate only the contact discs, so the cast
  shadow stayed on the photographed floor. `CaptureLight` already had `catcher` for exactly this
  ("hides shadows without changing the light"); the viewer and the editor now pass the layer to
  `catcher` and to `SunLight`'s `shadows`, so switching it off removes the shadow and leaves the
  room's brightness alone.
- **The real sun is in the listing stills.** `StillsRenderer` takes an optional `sun` (`SunState`);
  `PublishPanel` computes it from `tour.site` at the hour the seller parked the time-of-day control
  on. Over a photograph the capture waits for `CaptureLight`'s budget before it fires, because
  `externalSunScale(null, …)` is 1 — a studio sun on a photograph, which is the thing the composite
  exists to avoid.

Two data facts, both settled empirically:

- **The demo tour has a real site.** `seed.ts` carries the Nominatim answer for 1247 Oak St and the
  Overpass building way nearest it (`way/513962743`, 25 corners, longest edge 171.4°, © OpenStreetMap
  contributors, ODbL, fetched 2026-09-06), so `/t/oak1247` opens with a time-of-day control and the
  hub shows a Site card on a first run with no network. `ensureSite` also upgrades a tour seeded
  before the Site step existed.
- **`TourSite.windowWall` is new, and it is the fix for a real bug.** The seller answers "which way
  do the windows face?" and the engine stores the bearing of the room's *north* wall;
  `facingToHeading` converts, using the wall the rooms' windows are dominantly on. The Site step is
  step 2 of six, so that room set always changes afterwards — the floor plan adds rooms, and so do
  photos. Re-deriving the wall at display time therefore renames a heading that never moved: a
  confirmed "264° · west" came back as "84° · east" on the hub as soon as a garage arrived off the
  plan. The site now records the wall its heading was expressed against, `SiteCard` prefers it, and
  `tests/siteheading.test.ts` pins the invariant. `RoomCard` keeps using each room's own wall, which
  is right — that control is per room.

Verified against the running dev server, in the foreground extension tab where the window allowed it
and in the headless SwiftShader Chrome on :9333 otherwise (`document.hidden` suspends r3f's loop and
the ResizeObserver an offscreen stills canvas needs, which is why the stills were checked there):
the corner room walks its real capture with our bed on the photographed floor; the Shadows switch
removes the cast shadow and nothing else; the exploded preview lifts the furniture 0.35 → 0.4 m and
settles; the hour slider moves the shadow across the floorboards (09:00 casts left, 19:00 barely at
all at 6° elevation); the four composite stills come out named Portrait / From the capture point /
Across the room / Looking back with the disclosure plate burned in, and the 09:00 and 17:00 renders
of the same angle differ; and the wizard runs listing → site → floor plan → photos → anchor → launch
end to end, reading 12 rooms off the demo townhouse plan and generating 16 simulated rooms.

## Backend and determinism (2026-09-08, integrator)

**`docs/BACKEND.md` is the contract** for everything in this section: what a unit needs as input
(§1), the determinism rules (§2), how the prompt is compiled (§3), the pipeline (§4), the schema
(§5), the route table (§6), the environment (§7) and how the store moves over (§8).
`supabase/migrations/0001_init.sql` + `0002_claim_jobs.sql` are the schema; `server/` is the
implementation. It is **opt-in**: with `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` unset,
`/api/status` reports `backend: false`, every `/api/v1/*` route answers 503, no worker starts, and
the app keeps its browser-local store — the demo and offline path is unchanged.

### Module map

```
server/prompt.ts      compileMarblePrompt(facts) → the text prompt, fixed order, fixed phrasing
server/recipe.ts      canonicalJson · buildRecipe · recipeHash · seedFromHash · marbleRequestFrom
server/photos.ts      canonicalizePhoto (EXIF read then stripped, 2048 px, JPEG q90) + hashes
server/db.ts          PostgREST over fetch: select/insert/update/del/rpc, DbError carries a status
server/storage.ts     Storage over fetch: upload/download/publicUrl/signedUrl/remove
server/auth.ts        GoTrue: bearerToken · verifyUser · memberOrg · authenticate · AUDORA_DEV_ORG
server/pipeline.ts    §4: createUnit · addPhoto · addFloorPlan · planRecipes · attachOrEnqueue ·
                      generateUnit · publishUnit · publicTour · events · visitor stuff
server/worker.ts      the provider port (marble | mock), claim_jobs, generate → poll → copy_assets
server/routes.ts      §6 exactly: handleV1(req, res, ctx), mounted first inside handleApi
server/api.ts         unchanged /api/* proxy + the v1 mount + startBackendWorker()
server/marbleRequest.ts  the browser flow's /api/marble/generate → worlds:generate mapping
server/mockAssets.ts  a real .glb of a real room, so the mock provider exercises the measurement
src/services/marblePrompt.ts  re-export of shared/marblePrompt.ts (see "shared/" below)
src/services/marble.ts        the browser recipe: PIPELINE_VERSION, browserRecipe, seed, tags
```

### Conventions

- **Determinism is the point.** Every photo is canonicalised and hashed; a room's request is a
  canonical JSON *recipe* (sorted keys, numbers to 5 decimals, no `-0`); `recipe_hash =
  sha256(recipe)`; Marble's `seed` is its first 32 bits; `disable_recaption: true` keeps the
  compiled prompt verbatim; and `worlds.recipe_hash` is unique among non-failed worlds, so the
  same inputs attach the world they already made instead of spending credits twice. Nothing that
  feeds a recipe, a prompt or a hash reads a clock or a random source — **time is an input**, and
  every function that writes a timestamp takes `now`.
- **Where the Marble fields sit** (settled at integration, because two modules had drifted):
  `seed` is a generation parameter beside `world_prompt`; `disable_recaption` sits **inside**
  `world_prompt`, next to the `text_prompt` it is about and beside `reconstruct_images` / `is_pano`.
  `server/recipe.ts` (the pipeline) and `server/marbleRequest.ts` (the browser flow) now agree
  field for field, and both shapes are pinned in tests, so they can only ever be wrong together.
- **`shared/` is the only code both sides import.** `server/` must not import `src/` and `src/` must
  not import `server/` (vite.config.ts type-imports `server/api.ts`, so an import the other way
  would pull the dev server into the bundle). Anything the worker and the viewer must agree on
  *exactly* therefore lives in `shared/`: the collider measurement, metric fusion, the unit graph,
  the prompt compiler, the recipe encoder and Marble's request limits. The browser reaches it as
  `@shared/*` (a Vite alias and a tsconfig path); the server reaches it as `../shared/*.js`, and
  `tsconfig.server.json` compiles both into `dist-server/server/` + `dist-server/shared/`.
  `server/prompt.ts` and `src/services/marblePrompt.ts` are now re-exports of
  `shared/marblePrompt.ts`, and `tests/prompt-parity.test.ts` asserts the two sides resolve to the
  *same function object* rather than to two copies that happen to match. Only the mapper differs:
  `roomPromptFacts` (a `Room` from the store) against `defaultRoomContext` + `buildRecipe` (rows).
- **server/ compiles twice.** `tsconfig.node.json` (bundler, type-check only, what the Vite plugin
  needs) and `tsconfig.server.json` (NodeNext, `rootDir: "."`, emits `dist-server/`), so every
  relative import inside `server/` and `shared/` carries the `.js` extension and every file that
  touches Node globals declares `/// <reference types="node" />`. The production entry point is
  therefore `dist-server/server/prod.js`, which is what `npm start` runs. Nothing in `server/`
  imports from `src/`; the few types and numbers that mirror the app (`AZIMUTH_FOR_ANGLE`,
  `RoomType`) are copied with a pointer to their source and pinned by a test.
- **Structural ports, not classes.** The pipeline and the worker are written against `PipelineDb` /
  `PipelineStorage` / `WorldProvider`, which `server/db.ts`, `server/storage.ts` and the Marble
  provider satisfy and the tests implement in memory (`tests/support/backend.ts`). That is why the
  whole backend is unit-tested without Supabase, without World Labs and without a network.
- **Errors carry their own status.** `PipelineError`, `AuthError`, `DbError` and `StorageError` all
  expose `status`, so `server/routes.ts` maps them with one line; an undecodable upload is a 415, a
  transport failure to Supabase is a 502, and anything without a status is a 500.
- **The mock provider is the end-to-end path.** `MARBLE_MOCK=1` (or no `WORLDLABS_API_KEY`) runs
  the queue, the asset copy, publication and the public tour with no key and no credits. Live
  generation stays behind the credit guard (`MARBLE_MAX_GENERATIONS`, default 3).

## Accuracy: shared metric code, fusion, unit assembly, tier policy, staging deferred (2026-09-08, integrator)

The contract is `docs/ACCURACY.md`. The product is the accurate 3D model of a unit built from its
real photos and its floor plan; staging waits. What that meant in code:

### `shared/` — the code the worker and the viewer must not disagree about

```
shared/collider.ts     a dependency-free .glb reader + the whole measurement: floor/ceiling slabs,
                       the wall-band rectangle with its openings, roomRect, rawFromBounds,
                       isOneRoom, COLLIDER_MIRROR. measureColliderGlb(bytes) is bytes → room.
shared/fusion.ts       fuseScale(constraints) → one scale, its σ, a 0..1 confidence, one residual
                       per source and a flag naming both numbers past 2σ. roomFromFusion gives the
                       "plan says 3.75 m · model measures 3.41 m (−0.34 m)" line per dimension.
                       orientPlan settles which printed dimension is the rectangle's width.
                       RoomMeasurement — the record a measured room stores — is defined here.
shared/unitGraph.ts    the plan as a graph: rooms, inferred adjacency, a deterministic layout, the
                       plan↔capture quarter turn, and matchPortals → the doorways you walk through.
shared/marblePrompt.ts the one prompt compiler. shared/canonical.ts the one recipe encoder.
shared/marbleLimits.ts Marble's image limits and the rule that decides reconstruction mode.
```

Both builds compile `shared/`; the browser imports `@shared/*`, the server `../shared/*.js`.

### The measurement happens on the server, once

After `copy_assets` the worker downloads the collider it just uploaded and calls `measureRoom`
(`server/pipeline.ts` §10) — `rawFromBounds` → constraints (plan width/depth ±5 cm, the anchor with
its own ±, a printed ceiling ±3 cm or the standard 2.44 m ±12 cm, Marble's `metric_scale_factor`
±5 %) → `fuseScale` → `roomFromFusion` → `isOneRoom`. It writes `worlds.bounds`, `worlds.raw`,
`rooms.geometry`, `rooms.raw`, `rooms.measurement` and `rooms.measured_at` (migration 0004), and
the public tour serves the measurement per room. A measurement failure is logged, never fatal: the
assets are already paid for. `PATCH /api/v1/units/:id/rooms/:roomId` re-fuses inline, so correcting
a plan dimension updates the room's numbers in the same request without regenerating anything.

Two passes, for the one case the wall fit gets wrong: when the metric result is not one room
(Marble reconstructed through an open door) the rectangle is set aside as `method: 'aabb'`, the
confidence goes to 0 and a flag says so — but **the scale is kept**, because the room's own walls
are still the best evidence for what a raw unit is worth.

### The unit as one model

`buildUnitGraph(plan)` turns the parsed plan into rooms, adjacency and doors. The parser returns no
positions and no adjacency, so both are derived and the graph says so (`positions: 'adjacency'`,
`adjacency: 'inferred'`): rooms open off the nearest hallway, or are chained in sheet order where
there is none. `matchPortals` pairs each plan door with the nearest measured opening on the same
wall within 0.5 m, recovering the quarter turn between the plan's frame and the capture's; a door
with no measured opening is still a portal, marked `source: 'plan'` and drawn dashed. `Portals.tsx`
draws them in 3D and `UnitMap.tsx` draws the storey with "you are here". The viewer only offers a
doorway into a room the tour actually has — a plan room nobody photographed appears on the map and
has no portal, which is the honest version of a room with no capture.

### Intake, tier policy and staging

`src/screens/create/intake.ts` holds the intake policy (the three-angle plan, the photo quality
gate, the plan/photo confirmation) and the tier rule: full quality routes a room over 30 m² or an
open plan to `marble-1.1-plus`. That choice is now real, not advisory — it goes into the recipe
*and* onto the request, and `modelFor` in `server/marbleRequest.ts` allowlists it against the
tier's own model and its `-plus` sibling. `reconstruct_images` is set from the second photo up
(`shared/marbleLimits.ts`), which is what makes a second angle buy accuracy.

`Settings.stagingEnabled` is **false by default**, and `src/state/staging.ts` is the single reader.
With it off the hub's room list leads with each room's measurements (`AccuracyCard`), the viewer's
`MeasuredPanel` carries the plan-vs-model lines, and the staging entry points — the editor, its
links, Auto-stage, the buyer's furniture test, the staged label and the staging layer itself — are
hidden rather than deleted. The hub's tab is called **Rooms** with staging off and **Stage** with it
on; it is never removed, because the accuracy cards live in it, and `?tab=stage` still resolves.

### What the eval says

`evals/reconstruction.eval.ts` measures six synthetic rooms whose ground truth is exact by
construction. It never generates and needs no keys. Median dimension error **0.12 %**, worst
0.42 %, orientation exact on all six, ceiling within 1.3 cm, determinism 6/6. Scaled from the
assumed ceiling alone the median is 5.97 % — the anchor, not the reconstruction, is the error
budget, which is the whole argument for the floor plan.


### Still to build (named so nobody looks for them)

From the accuracy pass: **the room world is not yawed onto plan north**. The quarter turn is
recovered (`matchPortals().quarters`, `UnitRoom.yawToNorth`) and the unit map applies it, so the
map is right today, but the rendered capture is still drawn in its own frame. Doing it properly
means threading one extra quarter turn through the single existing rotation path
(`roomRect` → `splatTransform` → `marbleFrame` → `MarbleWorld`) and folding `rooms.geometry`'s door
and window walls by the same turn — a second rotation path would be worse than the gap. Also:
`shared/fusion.ts` accepts an EXIF field-of-view prior but nothing converts focal length and sensor
size into one; adjacency is inferred because the plan parser returns no doors, so the "every plan
door leads to the right room" row of the contract is measured against our own inference.

From the backend run: the
`analyze`, `parse_plan` and `stage` job handlers (the queue, retries and backoff are generic over the kind — they are one `case` each
in `runJob`; until then `POST /api/v1/units/:id/floor-plan` enqueues `parse_plan` only when the
caller did **not** post an already-parsed plan, so the wizard's own browser-side reader never
leaves a doomed job in a seller's queue), `worlds.credits` / `worlds.usd` (the provider's cost is
not read back on completion), and `src/services/backend.ts`, the §8 adapter that would switch the
store over when `/api/status` reports `backend: true`. `ProviderStatus.backend` is already the flag
it will read, and `server/routes.ts` is the contract it will read it against.
