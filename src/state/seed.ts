/** A finished demo tour so the dashboard, public tour and viewer have something to show on first run. */
import { anchorFromCeiling, anchorFromDoor, anchorFromMarble, anchorFromWall } from '@/engine/anchor';
import { clampToRoom, placeAgainstWall } from '@/engine/geometry';
import { catalogItem } from '@/engine/catalog';
import { extentMethodOf, fetchColliderGeometry, rawFromBounds, roomExtent, wallsOf } from '@/services/marble';
import { preparePhoto } from '@/lib/image';
import { autoStage, makePiece } from '@/engine/autostage';
import { mockRawGeometry, mockWorld } from '@/services/mockWorld';
import { uid } from '@/lib/ids';
import { defaultHeading, dominantWindowWall, facingToHeading } from '@/engine/siteSun';
import { useAudora } from './store';
import type { AnalyticsEvent, Room, RoomWorld, Tour, TourFloorPlan, TourSite } from './types';
import type { PlacedPiece, RawGeometry, RoomGeometry, RoomType, WallSide } from '@/engine/types';

export const DEMO_SHARE_ID = 'oak1247';

/**
 * A real World Labs Marble draft world generated from public/demo/empty-room-corner-windows.jpg
 * (230 credits, 35 seconds). Draft worlds carry no metric scale, so the room is anchored on an
 * assumed ceiling until someone types a wall length. Bounds come from the collider mesh.
 */
export const REAL_MARBLE_WORLD = {
  worldId: '24be684c-177e-49c2-a920-51dcf51e4c8b',
  marbleUrl: 'https://marble.worldlabs.ai/world/24be684c-177e-49c2-a920-51dcf51e4c8b',
  spzUrl: 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/fbabd791-dc74-4373-8d95-a08926570c67_sand_500k.spz',
  spzUrl100k: 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/82555d93-9c51-4722-91b3-30434886e586_sand_100k.spz',
  /** 2,276,736 splats, 23 MB — only ever loaded on a machine that has earned it (`splat/tiers`). */
  spzUrlFull: 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/8708139e-2578-4e82-baa7-294efcd6f2f3_sand.spz',
  colliderUrl: 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/16d54ea7.glb',
  thumbnailUrl: 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/919afb4a-3341-4269-8eec-fa9dec7f580b_sand_mpi/thumbnail.webp',
  /** Equirectangular panorama, 2304×1152. The photo view renders this. */
  panoUrl: 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/b1806895-7133-4163-b27c-73e792dc9e25_pano/rgb_0.png',
  caption:
    'An empty residential room with dark wood plank flooring, white baseboards and light neutral walls. A tall window on the left wall and a smaller one on the adjacent wall look onto a brick building; sunlight casts rectangular patterns on the floor. The doorway is behind the viewer.',
  /**
   * What the collider mesh says about this room, hard-coded from a real read of its 76k vertices so
   * the demo is right before the CDN answers (`fetchColliderGeometry`, services/marble).
   *
   * - `floorY` / `ceilingY`: the mesh's own floor and ceiling planes — the densest horizontal slab
   *   in the bottom and top quarter. The floor sits 6 cm above the lowest stray vertex and is the
   *   plane the panorama's floor lies on.
   * - `walls`: the room measured to its walls. The bounding box is 7.83 × 7.33 raw units because
   *   Marble reconstructed the building outside both windows; the walls are 4.37 × 5.91, which at
   *   the assumed-ceiling anchor is **3.00 × 4.06 m** instead of 5.38 × 5.03 m. Verified against
   *   the mesh's own wall planes (the two dominant peaks in a histogram of the wall band's
   *   projections are 4.40 and 5.87 raw units apart, so this is inside 1 %).
   * - `rotation` 0.82 rad: the room is at 47° to Marble's frame — the photographer faced a corner,
   *   which is exactly why the bounding box was 41 % too big.
   */
  bounds: {
    minX: -3.5989,
    maxX: 4.233,
    minY: -1.6597,
    maxY: 1.8928,
    minZ: -1.552,
    maxZ: 5.7774,
    floorY: -1.5953,
    ceilingY: 1.8239,
    method: 'walls' as const,
    walls: { minX: -0.85, maxX: 3.5236, minZ: -1.2867, maxZ: 4.6218, rotation: 0.8203, score: 0.8 },
  },
  photoUrl: '/demo/empty-room-corner-windows.jpg',
  note: 'real Marble draft',
};

const FULL_BASE = 'https://cdn.marble.worldlabs.ai/1580f9a1-2b19-4746-ad56-7ce3d4e5be60';

/**
 * A real full-quality Marble world (marble-1.1, 1580 credits) of a furnished flat, from the
 * reference build. Unlike a draft it carries metric semantics — `metric_scale_factor` scales its
 * raw units to metres and `ground_plane_offset` says how far the capture point sat above the floor
 * — so the room is anchored on the model's own estimate rather than on an assumed ceiling.
 * Everything is on the public CDN with open CORS: it costs nothing to show.
 */
export const FULL_MARBLE_WORLD = {
  worldId: '1580f9a1-2b19-4746-ad56-7ce3d4e5be60',
  marbleUrl: 'https://marble.worldlabs.ai/world/1580f9a1-2b19-4746-ad56-7ce3d4e5be60',
  model: 'marble-1.1',
  panoUrl: `${FULL_BASE}/8c7108a9-fe54-4ad3-a61a-6d8c06fbd04c_panos/rgb_0.png`,
  colliderUrl: `${FULL_BASE}/21e5e17d.glb`,
  spzUrl: `${FULL_BASE}/e8599403-f224-4dd6-8c35-f7037fb3ddc6_ceramic_500k.spz`,
  spzUrl150k: `${FULL_BASE}/527cc6e9-0464-4f1b-9d0f-a0aadd55f719_ceramic_150k.spz`,
  spzUrl100k: `${FULL_BASE}/9701d43b-70c2-4901-b03f-537a45f4df50_dust_100k.spz`,
  thumbnailUrl: `${FULL_BASE}/b3cddc85-251a-4f57-a56a-96ca33b41cc1_sand_mpi/thumbnail.webp`,
  metricScaleFactor: 2.2239592,
  groundPlaneOffset: 1.3064681,
  credits: 1580,
  seconds: 612,
  caption:
    'A furnished flat with white panelled doors, a dining table and chairs, open shelving and daylight from the left.',
  note: 'real Marble · full quality',
  /**
   * Used when the collider mesh cannot be read in the browser (offline, or a CDN hiccup), and when
   * it can but describes more than a room: Marble's collider covers everything the model imagined
   * through the doors and windows, which here comes to 138 m². A flat's main room is not that.
   */
  fallbackMetres: { width: 5.5, depth: 4.0, height: 2.7 },
};

/** Raw (unscaled) geometry for a room whose metric size we know, in the world's own units. */
function rawFromMetres(m: { width: number; depth: number; height: number }, metresPerUnit: number): RawGeometry {
  const u = (metres: number) => metres / (metresPerUnit > 0 ? metresPerUnit : 1);
  return {
    width: u(m.width),
    depth: u(m.depth),
    height: u(m.height),
    door: { wall: 'south', offset: u(m.width * 0.5), width: u(0.86), height: u(2.03) },
    windows: [],
    doorHeightUnits: u(2.03),
    outletHeightUnits: u(0.3),
  };
}

/**
 * Staging for a room that is already furnished inside the reconstruction: one rug and one plant,
 * enough to prove that Audora's metric furniture stands on the real floor without pretending the
 * flat is empty.
 *
 * Both pieces go IN FRONT of the capture point (toward the north wall, which is what the photo view
 * faces). A rug centred on the origin would lie under the renter's own feet and a plant behind their
 * shoulder, so the one thing this staging exists to show — our furniture standing on the real floor
 * — would be out of frame the moment they arrive.
 */
export function sparseStaging(g: RoomGeometry): PlacedPiece[] {
  const out: PlacedPiece[] = [];
  const rug = catalogItem('rug-l');
  const plant = catalogItem('plant');
  if (rug) {
    const f = clampToRoom({ x: 0, z: -g.depth * 0.24, w: rug.w, d: rug.d, rot: 0 }, g);
    out.push(makePiece(rug, f.x, f.z, f.rot, 'seller', '#a8937a'));
  }
  if (plant) {
    const f = clampToRoom(placeAgainstWall(g, 'north', g.width * 0.76, plant.w, plant.d, 0.1), g);
    out.push(makePiece(plant, f.x, f.z, f.rot, 'seller'));
  }
  return out;
}

function hasWorld(worldId: string): Room | undefined {
  return Object.values(useAudora.getState().rooms).find((r) => r.draft?.worldId === worldId || r.full?.worldId === worldId);
}

/** The real Marble draft: an empty corner room, anchored on an assumed ceiling. */
function ensureDraftRoom(tourId: string) {
  const existing = hasWorld(REAL_MARBLE_WORLD.worldId);
  if (existing) {
    // Older seeds carried the provenance in the room name (it leaked into the renter's copy) and an
    // outdated panorama URL. Both move to where they belong without disturbing anything else.
    const patch: Partial<Room> = {};
    if (existing.name !== 'Corner room') patch.name = 'Corner room';
    if (existing.note !== REAL_MARBLE_WORLD.note) patch.note = REAL_MARBLE_WORLD.note;
    if (Object.keys(patch).length) useAudora.getState().updateRoom(existing.id, patch);
    // Seeds written before the wall band measured this room stored its bounding box as the room:
    // 5.38 × 5.03 m of a room that is 3.00 × 4.06 m. Re-attaching the world with the measured
    // bounds re-derives the raw geometry, the anchor and every number on screen; `restageDemo`
    // (via the SEED_VERSION bump) then re-stages it at its honest size.
    const stale = existing.draft && (existing.draft.panoUrl !== REAL_MARBLE_WORLD.panoUrl || wallsOf(existing.draft.bounds) == null);
    if (existing.draft && stale) {
      const bounds = REAL_MARBLE_WORLD.bounds;
      useAudora
        .getState()
        .attachWorld(existing.id, { ...existing.draft, panoUrl: REAL_MARBLE_WORLD.panoUrl, bounds, raw: rawFromBounds(bounds) });
    }
    return;
  }
  const raw = rawFromBounds(REAL_MARBLE_WORLD.bounds);
  const anchor = anchorFromCeiling(raw);
  const room = useAudora.getState().addRoom(tourId, { name: 'Corner room', type: 'bedroom', raw, anchor });
  useAudora.getState().updateRoom(room.id, { note: REAL_MARBLE_WORLD.note });
  useAudora.getState().attachWorld(room.id, {
    provider: 'marble',
    tier: 'draft',
    worldId: REAL_MARBLE_WORLD.worldId,
    model: 'marble-1.0-draft',
    createdAt: Date.now() - 60e3,
    raw,
    bounds: REAL_MARBLE_WORLD.bounds,
    spzUrl: REAL_MARBLE_WORLD.spzUrl,
    spzUrls: { '100k': REAL_MARBLE_WORLD.spzUrl100k, '500k': REAL_MARBLE_WORLD.spzUrl, full_res: REAL_MARBLE_WORLD.spzUrlFull },
    colliderUrl: REAL_MARBLE_WORLD.colliderUrl,
    thumbnailUrl: REAL_MARBLE_WORLD.thumbnailUrl,
    panoUrl: REAL_MARBLE_WORLD.panoUrl,
    caption: REAL_MARBLE_WORLD.caption,
    marbleUrl: REAL_MARBLE_WORLD.marbleUrl,
    metricScaleFactor: null,
    groundPlaneOffset: null,
    credits: 230,
    usd: 0.184,
    seconds: 35,
  });
  const fresh = useAudora.getState().rooms[room.id];
  useAudora.getState().setStaging(room.id, autoStage(fresh.geometry, fresh.type, 'scandi'), 'scandi');
  // Attach the source photo asynchronously (needs the DOM).
  if (typeof document !== 'undefined') {
    preparePhoto(REAL_MARBLE_WORLD.photoUrl)
      .then((photo) => useAudora.getState().updateRoom(room.id, { photo }))
      .catch(() => undefined);
  }
}

function fullWorldRecord(raw: RawGeometry, bounds?: RoomWorld['bounds']): RoomWorld {
  return {
    provider: 'marble',
    tier: 'full',
    worldId: FULL_MARBLE_WORLD.worldId,
    model: FULL_MARBLE_WORLD.model,
    createdAt: Date.now() - 2 * 86400e3,
    raw,
    bounds,
    spzUrl: FULL_MARBLE_WORLD.spzUrl,
    spzUrls: { '100k': FULL_MARBLE_WORLD.spzUrl100k, '150k': FULL_MARBLE_WORLD.spzUrl150k, '500k': FULL_MARBLE_WORLD.spzUrl },
    colliderUrl: FULL_MARBLE_WORLD.colliderUrl,
    thumbnailUrl: FULL_MARBLE_WORLD.thumbnailUrl,
    panoUrl: FULL_MARBLE_WORLD.panoUrl,
    caption: FULL_MARBLE_WORLD.caption,
    marbleUrl: FULL_MARBLE_WORLD.marbleUrl,
    metricScaleFactor: FULL_MARBLE_WORLD.metricScaleFactor,
    groundPlaneOffset: FULL_MARBLE_WORLD.groundPlaneOffset,
    credits: FULL_MARBLE_WORLD.credits,
    usd: FULL_MARBLE_WORLD.credits / 1250,
    seconds: FULL_MARBLE_WORLD.seconds,
  };
}

/** The real full-quality Marble world: a furnished flat that scales itself. */
function ensureFullRoom(tourId: string) {
  const existing = hasWorld(FULL_MARBLE_WORLD.worldId);
  if (existing) {
    // Re-read the collider when what is stored predates the floor plane (bounds without one put
    // this world's floor 15 cm under ours) or the wall band, and when
    // the extent was not settled the way this world settles it (its collider covers a whole flat,
    // so the estimate wins and the bounds are stored as `aabb` — see `roomExtent`). Once the record
    // says that, nothing is fetched again.
    const b = existing.full?.bounds;
    const stale = !!b && (b.floorY == null || wallsOf(b) == null || extentMethodOf(b) !== 'aabb');
    if (existing.full && stale && typeof fetch !== 'undefined') refreshFullBounds(existing.id);
    return;
  }
  const metresPerUnit = FULL_MARBLE_WORLD.metricScaleFactor;
  const raw = rawFromMetres(FULL_MARBLE_WORLD.fallbackMetres, metresPerUnit);
  const room = useAudora.getState().addRoom(tourId, { name: 'Furnished flat', type: 'living', raw, anchor: anchorFromMarble(metresPerUnit, raw.height) });
  useAudora.getState().updateRoom(room.id, { note: FULL_MARBLE_WORLD.note, stagingPreset: 'sparse' });
  useAudora.getState().attachWorld(room.id, fullWorldRecord(raw));
  const staged = useAudora.getState().rooms[room.id];
  useAudora.getState().setStaging(room.id, sparseStaging(staged.geometry), 'minimal');

  // Read the real collider when the browser can reach the CDN (async, like the photo above): it
  // centres the reconstruction on the room, carries its floor plane, and measures the walls. This
  // flat's wall band is a real measurement of a real open-plan space — 6.5 × 11.8 m — which is more
  // than one room, so `roomExtent` keeps the estimate above and only the floor plane improves.
  if (typeof fetch !== 'undefined') refreshFullBounds(room.id);
}

/** Re-read the full-quality collider and re-apply everything derived from it. Never throws. */
function refreshFullBounds(roomId: string) {
  const metresPerUnit = FULL_MARBLE_WORLD.metricScaleFactor;
  const fallback = rawFromMetres(FULL_MARBLE_WORLD.fallbackMetres, metresPerUnit);
  fetchColliderGeometry(FULL_MARBLE_WORLD.colliderUrl)
    .then((bounds) => {
      const cur = useAudora.getState().rooms[roomId];
      if (!cur?.full) return;
      const extent = roomExtent(bounds, metresPerUnit, fallback);
      useAudora.getState().attachWorld(roomId, { ...cur.full, bounds: extent.bounds, raw: extent.raw });
      const after = useAudora.getState().rooms[roomId];
      useAudora.getState().setStaging(roomId, sparseStaging(after.geometry), after.stagingStyle);
    })
    .catch(() => undefined);
}

/**
 * Where 1247 Oak Street really is, from OpenStreetMap.
 *
 * Not invented: the coordinates are Nominatim's answer for the demo address and the ring is the
 * building way Overpass returns nearest to it (`way/513962743`, tagged `building=yes`,
 * `addr:housenumber=1245` — one address plate for the pair, which is why the leasing team confirms the
 * heading rather than the map dictating it). Fetched 2026-09-06; data © OpenStreetMap contributors,
 * ODbL. The same two calls `StepSite` makes, run once and baked in so the demo has a real sun on a
 * first run with no network.
 *
 * `principalHeading` 171.4° is the bearing of the longest edge — the flat runs down the block — so
 * `defaultHeading` puts the window wall at 261°, facing west over the Panhandle. That is why the
 * demo's light comes in late in the afternoon.
 */
export const DEMO_SITE_RING: [number, number][] = [
  [37.7727316, -122.4398978],
  [37.7727352, -122.4398688],
  [37.772742, -122.4398628],
  [37.7727465, -122.4398268],
  [37.7727409, -122.4398218],
  [37.7727419, -122.4398128],
  [37.772739, -122.4398128],
  [37.7726671, -122.4397988],
  [37.7726649, -122.4398168],
  [37.7726574, -122.4398158],
  [37.7726597, -122.4397968],
  [37.7726125, -122.4397878],
  [37.7726104, -122.4398058],
  [37.7725739, -122.4397978],
  [37.772576, -122.4397808],
  [37.7725066, -122.4397678],
  [37.7725055, -122.4397778],
  [37.7724988, -122.4397868],
  [37.772495, -122.4398188],
  [37.7724997, -122.4398258],
  [37.7724965, -122.4398528],
  [37.7725685, -122.4398668],
  [37.7725709, -122.4398458],
  [37.7726601, -122.4398628],
  [37.7726577, -122.4398828],
  [37.7727316, -122.4398978],
];

/**
 * The demo's site. `previewTime` is late afternoon **on the day the demo is first opened**, because
 * that is when a west-facing flat is worth showing — the renter can drag the hour anywhere from the
 * Time of day panel and the tour reopens on wherever they left it.
 */
export function demoSite(windowWall: WallSide): TourSite {
  const preview = new Date();
  preview.setHours(16, 20, 0, 0);
  return {
    lat: 37.7727412,
    lon: -122.4398545,
    displayName: '1247, Oak Street, Panhandle, San Francisco, California, 94117, United States',
    footprint: { ring: DEMO_SITE_RING, principalHeading: 171.4, levels: undefined },
    /* `heading` is the engine's frame — the bearing the room's NORTH wall faces — while 261° is the
       façade, i.e. what the leasing team answers on the compass ("the windows face west"). `StepSite`
       stores exactly this conversion; storing the façade bearing raw turns the sun by however far
       the window wall is from north, which on these rooms is a whole 90°. */
    heading: facingToHeading(defaultHeading(171.4), windowWall),
    windowWall,
    previewTime: preview.getTime(),
    resolvedAt: Date.now(),
  };
}

/**
 * Give the demo tour its site if it has none (this also upgrades a tour seeded before the Site step
 * existed). Call it once the rooms are in: the heading is stored relative to the wall the windows
 * are actually on, so it needs to know which wall that is.
 */
export function ensureSite(tourId: string) {
  const s = useAudora.getState();
  const tour = s.tours[tourId];
  if (!tour || tour.site) return;
  const walls = tour.roomIds.flatMap((id) => s.rooms[id]?.geometry.windows.map((w) => w.wall) ?? []);
  s.setSite(tourId, demoSite(dominantWindowWall(walls)));
}

/** Adds the real-world rooms to the demo tour if they are not there yet (also migrates older seeds). */
export function ensureRealRoom(tourId: string) {
  const tour = useAudora.getState().tours[tourId];
  if (!tour) return;
  ensureDraftRoom(tourId);
  ensureFullRoom(tourId);
  ensureDemoPlan(tourId);
}


/* ------------------------------------------------------------------ the demo unit's floor plan
 *
 * The listing's own drawing, as the parser would have returned it (docs/ACCURACY.md 2: a plan is
 * the cheapest metric truth a listing has). It is what makes the demo a *unit* rather than six
 * unrelated rooms: `buildUnitGraph` reads it into a room graph, `UnitMap` draws the storey with
 * "you are here", and each plan door that lands on a measured opening becomes a portal you can walk
 * through (`shared/unitGraph.ts`).
 *
 * Every printed dimension is the room's real size rounded to the nearest inch, which is what a
 * draughtsman does — so the "plan says / model measures" line shows a genuine one-centimetre
 * residual rather than a suspicious exact match. `metres` is our own reading of `text`, not a
 * second number: 17'-5" is 17 × 0.3048 + 5 × 0.0254.
 *
 * The sheet order matters. With no hallway on the plan, `inferAdjacency` chains rooms in the order
 * they are drawn, so the four rooms that have a capture are listed contiguously and you can walk
 * living → dining → primary → second. The kitchen is drawn last: it is on the plan, it appears on
 * the unit map, and it has no photograph — so the viewer shows it and offers no doorway into it,
 * which is the honest version of a room nobody shot.
 */
const DEMO_PLAN_ROOMS: { name: string; type: RoomType; width: number; depth: number; text: string; windows: number; doors: number }[] = [
  { name: 'Living room', type: 'living', width: 5.3086, depth: 5.7912, text: `17'-5" × 19'-0"`, windows: 2, doors: 1 },
  { name: 'Dining room', type: 'dining', width: 3.302, depth: 4.0894, text: `10'-10" × 13'-5"`, windows: 1, doors: 2 },
  { name: 'Primary bedroom', type: 'bedroom', width: 3.3274, depth: 3.7846, text: `10'-11" × 12'-5"`, windows: 1, doors: 1 },
  { name: 'Second bedroom', type: 'bedroom', width: 2.7432, depth: 3.048, text: `9'-0" × 10'-0"`, windows: 1, doors: 1 },
  { name: 'Kitchen', type: 'kitchen', width: 2.5908, depth: 3.4036, text: `8'-6" × 11'-2"`, windows: 1, doors: 1 },
];

const DEMO_PLAN_FLOOR = 'Third floor';

/** The parsed plan the demo tour carries. Fixed, so the demo is the same unit in every browser. */
function demoFloorPlan(): TourFloorPlan {
  return {
    units: 'feet',
    floors: [
      {
        label: DEMO_PLAN_FLOOR,
        rooms: DEMO_PLAN_ROOMS.map((r) => ({
          name: r.name,
          type: r.type,
          width: r.width,
          depth: r.depth,
          dimensionsText: r.text,
          dimensionsFrom: 'text',
          windows: r.windows,
          doors: r.doors,
        })),
      },
    ],
    // Up the page is north, so a room's `yawToNorth` is zero and the map's arrow points straight up.
    northArrow: { present: true, direction: 'up' },
    notes: ['Dimensions are printed to the nearest inch, as drawn.'],
    source: 'heuristic',
    // Time is an input: the plan was read when the demo unit was created, three days ago.
    parsedAt: Date.now() - 3 * 86400e3,
  };
}

/**
 * Attach the plan to the tour and its printed dimensions to the rooms it names.
 *
 * Only `planDims` is written: the rooms keep the geometry their reconstruction gave them, so the
 * plan stays a *source to compare against* rather than an answer that overwrites the model. That is
 * what makes the AccuracyCard's "plan says 5.31 m · model measures 5.30 m" a measurement and not a
 * tautology. Idempotent, so re-seeding an existing browser fills it in without disturbing anything.
 */
function ensureDemoPlan(tourId: string) {
  const st = useAudora.getState();
  const tour = st.tours[tourId];
  if (!tour) return;
  if (!tour.floorPlan) st.updateTour(tourId, { floorPlan: demoFloorPlan() });
  for (const id of st.tours[tourId]?.roomIds ?? []) {
    const room = useAudora.getState().rooms[id];
    if (!room || room.planDims) continue;
    const plan = DEMO_PLAN_ROOMS.find((r) => r.name === room.name);
    if (!plan) continue; // the two showcase worlds are not rooms of this flat
    useAudora.getState().updateRoom(id, {
      planDims: { width: plan.width, depth: plan.depth, text: plan.text, planRoomName: plan.name, floor: DEMO_PLAN_FLOOR },
    });
  }
}

/**
 * The demo unit, as a rental. The address, the `shareId` and the rooms are fixed (other code and
 * tests depend on them); the title, rent, availability and summary are what a renter reads.
 */
export const DEMO_UNIT = {
  title: '1247 Oak Street, Unit 3',
  address: '1247 Oak St, San Francisco, CA 94117',
  /** Rent per month. A string, because that is what goes on the listing. */
  rent: '$4,250/mo',
  availableFrom: '1 October',
  listingUrl: 'https://www.zillow.com/apartments/san-francisco-ca/1247-oak-st/unit-3/',
  summary:
    'Top-floor Edwardian flat, vacant and freshly painted. Two bedrooms, a long living room and a dining room off the kitchen. Available 1 October, unfurnished. Walk it before you book a showing.',
};

/** Bump when the staging engine, the demo rooms or the demo unit's own copy change; existing browsers re-seed on next load. */
export const SEED_VERSION = 8;

/** Re-run the current stager over the demo rooms (keeps rooms, anchors, worlds and analytics). */
export function restageDemo(tourId: string) {
  const s = useAudora.getState();
  const tour = s.tours[tourId];
  if (!tour) return;
  tour.roomIds.forEach((id, i) => {
    const room = useAudora.getState().rooms[id];
    if (!room) return;
    /* An anchor saved before the model estimate carried its reference reads "model estimate ·
       ±15 cm" — an uncertainty with nothing attached to it. Re-derive it from the same scale so
       the chip states the ceiling the model measured. */
    if (room.anchor.method === 'marble' && room.anchor.referenceUnits <= 1 && room.raw.height > 0) {
      useAudora.getState().setAnchor(id, anchorFromMarble(room.anchor.metresPerUnit, room.raw.height));
    }
    if (room.stagingPreset === 'sparse') {
      useAudora.getState().setStaging(id, sparseStaging(room.geometry), room.stagingStyle);
      return;
    }
    const style = room.stagingStyle || (i % 2 ? 'scandi' : 'warm');
    useAudora.getState().setStaging(id, autoStage(room.geometry, room.type, style), style);
  });
}

/**
 * Bring a demo tour seeded as a sale ("1247 Oak Street", "$1.49M") over to the rental it is now.
 * Only the fields the demo owns are touched: a leasing team that edited the title keeps it, because
 * a browser that has been used is not a fixture. Runs once per `SEED_VERSION` bump.
 */
export function relabelDemo(tourId: string) {
  const tour = useAudora.getState().tours[tourId];
  if (!tour) return;
  const patch: Partial<Tour> = {};
  if (tour.title === '1247 Oak Street') patch.title = DEMO_UNIT.title;
  if (tour.price === '$1.49M') patch.price = DEMO_UNIT.rent;
  if (!tour.summary || tour.summary.startsWith('Top-floor Edwardian flat, empty since June')) patch.summary = DEMO_UNIT.summary;
  if (tour.listingUrl?.includes('/homedetails/')) patch.listingUrl = DEMO_UNIT.listingUrl;
  /* Copy written for a sale ("offers", "the seller") reads wrong on a rental; drop it and let the
     publish panel write it again from the unit as it is now. */
  if (tour.copy) patch.copy = undefined;
  if (Object.keys(patch).length) useAudora.getState().updateTour(tourId, patch);
}

export function seedDemo() {
  const s = useAudora.getState();
  const existing = Object.values(s.tours).find((t) => t.shareId === DEMO_SHARE_ID);
  if (existing) {
    ensureSite(existing.id);
    ensureRealRoom(existing.id);
    if (s.seedVersion < SEED_VERSION) {
      restageDemo(existing.id);
      relabelDemo(existing.id);
      useAudora.getState().setSeedVersion(SEED_VERSION);
    }
    return;
  }
  if (s.seeded) return;
  const tour = s.createTour({
    title: DEMO_UNIT.title,
    address: DEMO_UNIT.address,
    listingUrl: DEMO_UNIT.listingUrl,
    listingSource: 'zillow',
    price: DEMO_UNIT.rent,
    beds: 2,
    baths: 1,
    sqft: 1180,
    summary: DEMO_UNIT.summary,
    quality: 'draft',
  });
  s.updateTour(tour.id, { shareId: DEMO_SHARE_ID, createdAt: Date.now() - 3 * 86400e3, published: true, publishedAt: Date.now() - 3 * 86400e3 });

  const rooms: { name: string; type: RoomType; anchor: 'door' | 'laser' }[] = [
    { name: 'Living room', type: 'living', anchor: 'door' },
    { name: 'Primary bedroom', type: 'bedroom', anchor: 'laser' },
    { name: 'Second bedroom', type: 'bedroom', anchor: 'door' },
    { name: 'Dining room', type: 'dining', anchor: 'door' },
  ];
  const ids: string[] = [];
  rooms.forEach((r, i) => {
    const raw = mockRawGeometry(`demo:${r.name}`, r.type);
    const anchor = r.anchor === 'laser' ? anchorFromWall(raw, 'width', Math.round(raw.width * 2.03 * 100) / 100, 'laser') : anchorFromDoor(raw, 0.42, [{ x: 0.18, y: 0.28 }, { x: 0.18, y: 0.71 }]);
    const room = s.addRoom(tour.id, { name: r.name, type: r.type, raw, anchor });
    // Make the second bedroom deliberately small: it is the room a renter's bed does not fit in.
    if (i === 2) {
      const small = { ...raw, width: 2.75 / 2.03, depth: 3.05 / 2.03 };
      useAudora.getState().setRaw(room.id, small);
    }
    const st = useAudora.getState();
    const fresh = st.rooms[room.id];
    st.attachWorld(room.id, { ...mockWorld(fresh, 'draft', 24), createdAt: Date.now() - 3 * 86400e3 });
    const staged = useAudora.getState().rooms[room.id];
    st.setStaging(room.id, autoStage(staged.geometry, staged.type, i % 2 ? 'scandi' : 'warm'), i % 2 ? 'scandi' : 'warm');
    ids.push(room.id);
  });

  // Three days of renter activity: 84 visitors, 31 walked the unit, 26 measurements, 12 furniture
  // tests, 4 of which did not fit in the second bedroom.
  const events: AnalyticsEvent[] = [];
  const base = Date.now() - 3 * 86400e3;
  const push = (type: AnalyticsEvent['type'], visitor: string, at: number, roomId?: string, item?: string) =>
    events.push({ id: uid('ev'), tourId: tour.id, type, visitor, at, roomId, item });
  const tests: [string, string, boolean][] = [
    ['3-seat sofa', ids[0], true],
    ['3-seat sofa', ids[0], true],
    ['3-seat sofa', ids[0], true],
    ['3-seat sofa', ids[0], true],
    ['3-seat sofa', ids[0], true],
    ['3-seat sofa', ids[3], true],
    ['3-seat sofa', ids[0], true],
    ['Queen bed', ids[2], false],
    ['Queen bed', ids[2], false],
    ['Queen bed', ids[1], true],
    ['Queen bed', ids[2], false],
    ['Queen bed', ids[2], false],
    ['Dining table for 6', ids[3], true],
    ['Dining table for 6', ids[3], true],
    ['Dining table for 6', ids[3], true],
  ];
  for (let v = 0; v < 84; v++) {
    const visitor = `seed_${v}`;
    const at = base + Math.floor((v / 84) * 3 * 86400e3) + (v * 977) % 3600e3;
    push('visit', visitor, at);
    if (v < 31) push('walk', visitor, at + 20e3, ids[v % ids.length]);
  }
  tests.slice(0, 12).forEach(([item, roomId, fits], i) => {
    const visitor = `seed_${i}`;
    const at = base + i * 5.5 * 3600e3;
    push('test', visitor, at, roomId, item);
    push(fits ? 'fit' : 'nofit', visitor, at + 5e3, roomId, item);
  });
  /* Measurements are the thing a renter actually does before a showing — how wide is that wall,
     does the wardrobe wall take a 120 — so the demo has them, weighted toward the rooms whose size
     is in question: the small second bedroom first, then the living room. */
  const measuresPerRoom = [7, 4, 11, 4];
  measuresPerRoom.forEach((n, r) => {
    for (let k = 0; k < n; k++) {
      const visitor = `seed_${(r * 7 + k * 3) % 31}`;
      push('measure', visitor, base + ((r * 11 + k * 5) % 68) * 3600e3 + k * 97e3, ids[r]);
    }
  });
  // A handful of renters sent the link on to whoever they are moving in with.
  [2, 9, 14, 22, 27].forEach((v, i) => push('share', `seed_${v}`, base + (6 + i * 12) * 3600e3));
  useAudora.setState((st) => ({ events: [...st.events, ...events] }));
  ensureSite(tour.id);
  ensureRealRoom(tour.id);
  ensureDemoPlan(tour.id);
  useAudora.getState().setSeeded();
  useAudora.getState().setSeedVersion(SEED_VERSION);
}
