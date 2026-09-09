# Demo assets

- `empty-room-corner-windows.jpg` — "Empty apartment room with corner windows" by Aismallard, Wikimedia Commons, CC BY-SA 3.0.
  https://commons.wikimedia.org/wiki/File:Empty_apartment_room_with_corner_windows.jpg
- `empty-room-extension-cord.jpg` — "Empty apartment room with extension cord" by Aismallard, Wikimedia Commons, CC BY-SA 3.0.
  https://commons.wikimedia.org/wiki/File:Empty_apartment_room_with_extension_cord.jpg
- `floorplan-townhouse.webp` — a listing floor plan used only to demonstrate the "import from floor plan" anchor.
- `floorplan-oak-unit3.png` — **synthetic**. Drawn by `scripts/make-demo-plan.mjs` from a room table in
  metres: nothing is traced, scanned or copied, and 1247 Oak Street, Unit 3 is a demonstration unit
  rather than a real property (the address geocodes to a real building only so the demo has a real
  sun; see `DEMO_SITE_RING` in `src/state/seed.ts`). It is the demo unit's own plan — the parsed form
  is stored in the seed, so the app never reads the picture at runtime — and a copy sits in
  `evals/plans/` as a labelled case for the floor-plan parser, where its ground truth is exact by
  construction: the numbers printed on the sheet are the numbers the generator laid it out from.
  Own work; no licence to observe.

Both photographs are genuinely empty rooms with blank walls: the hard case for any reconstruction method, which is exactly what Audora should be measured on.
