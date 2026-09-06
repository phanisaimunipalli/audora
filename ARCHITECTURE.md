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

Dark, warm, editorial. Background `bg` #0e0d0c, surfaces `surface`/`surface-2`/`surface-3`, hairlines `line`/`line-2`, ink `ink`/`ink-2`/`ink-3`, accent terracotta `accent` #e8734a (+ `accent-2`, `accent-deep`), `ok` green, `warn` amber, `danger` red, `buyer` blue #62a0ff (**buyer furniture is always blue**, seller staging is never blue). Fonts: `.display` = Instrument Serif for headlines, body Inter, `.mono` = JetBrains Mono for every number / anchor / dimension. Utilities: `.panel`, `.glass`, `.chip`, `.skeleton`, `.grid-bg`, `.animate-rise`, `.animate-fade`. Use `Button`, `Card`, `Chip`, `Stat`, `Field`, `Input`, `Select`, `Toggle`, `Progress`, `Segmented`, `SectionTitle`, `Callout`, `EmptyState`, `StagedLabel`, `Kbd`, `IconButton` from `@/components/ui` and icons from `@/components/icons` (`Icon.Walk`, `Icon.Orbit`, `Icon.Ruler`, `Icon.Door`, ...). Numbers are the product: show real dimensions in cm/m everywhere, in mono.

Feel: confident, quiet, precise. Generous whitespace, 18–26 px radii, soft shadows, subtle motion (rise/fade), no gradients louder than a faint accent glow. Mobile must not break (buyer view is opened from a phone).

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
