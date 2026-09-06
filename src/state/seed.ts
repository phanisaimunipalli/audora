/** A finished demo tour so the dashboard, public tour and viewer have something to show on first run. */
import { anchorFromCeiling, anchorFromDoor, anchorFromMarble, anchorFromWall } from '@/engine/anchor';
import { clampToRoom, placeAgainstWall } from '@/engine/geometry';
import { catalogItem } from '@/engine/catalog';
import { fetchColliderBounds, rawFromBounds, rawFromBoundsOr } from '@/services/marble';
import { preparePhoto } from '@/lib/image';
import { autoStage, makePiece } from '@/engine/autostage';
import { mockRawGeometry, mockWorld } from '@/services/mockWorld';
import { uid } from '@/lib/ids';
import { useAudora } from './store';
import type { AnalyticsEvent, Room, RoomWorld } from './types';
import type { PlacedPiece, RawGeometry, RoomGeometry, RoomType } from '@/engine/types';

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
  colliderUrl: 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/16d54ea7.glb',
  thumbnailUrl: 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/919afb4a-3341-4269-8eec-fa9dec7f580b_sand_mpi/thumbnail.webp',
  /** Equirectangular panorama, 2304×1152. The photo view renders this. */
  panoUrl: 'https://cdn.marble.worldlabs.ai/24be684c-177e-49c2-a920-51dcf51e4c8b/b1806895-7133-4163-b27c-73e792dc9e25_pano/rgb_0.png',
  caption:
    'An empty residential room with dark wood plank flooring, white baseboards and light neutral walls. A tall window on the left wall and a smaller one on the adjacent wall look onto a brick building; sunlight casts rectangular patterns on the floor. The doorway is behind the viewer.',
  /**
   * Collider bounds, and the mesh's own floor plane (`floorY`, see `colliderFloorY` in
   * services/marble): the densest horizontal slab sits 6 cm above the lowest stray vertex, and it is
   * the plane the panorama's floor lies on. Hard-coded so the demo is right before the CDN answers.
   */
  bounds: { minX: -3.599, maxX: 4.233, minY: -1.66, maxY: 1.893, minZ: -1.552, maxZ: 5.777, floorY: -1.5975 },
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
    'A furnished flat with white panelled doors, a dining table and chairs, open shelving and daylight from the left. Digitally staged furniture stands on the same floor as the real one.',
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
 * faces). A rug centred on the origin would lie under the buyer's own feet and a plant behind their
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
    // Older seeds carried the provenance in the room name (it leaked into buyer copy) and an
    // outdated panorama URL. Both move to where they belong without disturbing anything else.
    const patch: Partial<Room> = {};
    if (existing.name !== 'Corner room') patch.name = 'Corner room';
    if (existing.note !== REAL_MARBLE_WORLD.note) patch.note = REAL_MARBLE_WORLD.note;
    if (existing.draft && (existing.draft.panoUrl !== REAL_MARBLE_WORLD.panoUrl || existing.draft.bounds?.floorY == null)) {
      patch.draft = { ...existing.draft, panoUrl: REAL_MARBLE_WORLD.panoUrl, bounds: REAL_MARBLE_WORLD.bounds };
    }
    if (Object.keys(patch).length) useAudora.getState().updateRoom(existing.id, patch);
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
    // Bounds stored before the floor plane was detected put this world's floor 15 cm under ours
    // (Marble's ground_plane_offset is not the mesh's floor). One re-read of the collider fixes it.
    if (existing.full && existing.full.bounds && existing.full.bounds.floorY == null && typeof fetch !== 'undefined') {
      refreshFullBounds(existing.id);
    }
    return;
  }
  const metresPerUnit = FULL_MARBLE_WORLD.metricScaleFactor;
  const raw = rawFromMetres(FULL_MARBLE_WORLD.fallbackMetres, metresPerUnit);
  const room = useAudora.getState().addRoom(tourId, { name: 'Furnished flat', type: 'living', raw, anchor: anchorFromMarble(metresPerUnit) });
  useAudora.getState().updateRoom(room.id, { note: FULL_MARBLE_WORLD.note, stagingPreset: 'sparse' });
  useAudora.getState().attachWorld(room.id, fullWorldRecord(raw));
  const staged = useAudora.getState().rooms[room.id];
  useAudora.getState().setStaging(room.id, sparseStaging(staged.geometry), 'minimal');

  // Read the real collider bounds when the browser can reach the CDN (async, like the photo above):
  // they centre the reconstruction on the room, carry its floor plane, and are what the geometry
  // wireframe is measured from.
  if (typeof fetch !== 'undefined') refreshFullBounds(room.id);
}

/** Re-read the full-quality collider and re-apply everything derived from it. Never throws. */
function refreshFullBounds(roomId: string) {
  const metresPerUnit = FULL_MARBLE_WORLD.metricScaleFactor;
  const fallback = rawFromMetres(FULL_MARBLE_WORLD.fallbackMetres, metresPerUnit);
  fetchColliderBounds(FULL_MARBLE_WORLD.colliderUrl)
    .then((bounds) => {
      const cur = useAudora.getState().rooms[roomId];
      if (!cur?.full) return;
      const nextRaw = rawFromBoundsOr(bounds, metresPerUnit, fallback);
      useAudora.getState().attachWorld(roomId, { ...cur.full, bounds, raw: nextRaw });
      const after = useAudora.getState().rooms[roomId];
      useAudora.getState().setStaging(roomId, sparseStaging(after.geometry), after.stagingStyle);
    })
    .catch(() => undefined);
}

/** Adds the real-world rooms to the demo tour if they are not there yet (also migrates older seeds). */
export function ensureRealRoom(tourId: string) {
  const tour = useAudora.getState().tours[tourId];
  if (!tour) return;
  ensureDraftRoom(tourId);
  ensureFullRoom(tourId);
}

/** Bump when the staging engine or demo rooms change; existing browsers re-stage the demo on next load. */
export const SEED_VERSION = 4;

/** Re-run the current stager over the demo rooms (keeps rooms, anchors, worlds and analytics). */
export function restageDemo(tourId: string) {
  const s = useAudora.getState();
  const tour = s.tours[tourId];
  if (!tour) return;
  tour.roomIds.forEach((id, i) => {
    const room = useAudora.getState().rooms[id];
    if (!room) return;
    if (room.stagingPreset === 'sparse') {
      useAudora.getState().setStaging(id, sparseStaging(room.geometry), room.stagingStyle);
      return;
    }
    const style = room.stagingStyle || (i % 2 ? 'scandi' : 'warm');
    useAudora.getState().setStaging(id, autoStage(room.geometry, room.type, style), style);
  });
}

export function seedDemo() {
  const s = useAudora.getState();
  const existing = Object.values(s.tours).find((t) => t.shareId === DEMO_SHARE_ID);
  if (existing) {
    ensureRealRoom(existing.id);
    if (s.seedVersion < SEED_VERSION) {
      restageDemo(existing.id);
      useAudora.getState().setSeedVersion(SEED_VERSION);
    }
    return;
  }
  if (s.seeded) return;
  const tour = s.createTour({
    title: '1247 Oak Street',
    address: '1247 Oak St, San Francisco, CA 94117',
    listingUrl: 'https://www.zillow.com/homedetails/1247-Oak-St-San-Francisco-CA-94117/15080123_zpid/',
    listingSource: 'zillow',
    price: '$1.49M',
    beds: 2,
    baths: 1,
    sqft: 1180,
    summary: 'Top-floor Edwardian flat, empty since June. Two bedrooms, a long living room and a dining room off the kitchen.',
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
    // Make the second bedroom deliberately small: it is the room buyers' beds fail in.
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

  // Three days of buyer activity: 84 visitors, 31 walked, 12 tested furniture, 4 failures in the second bedroom.
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
  useAudora.setState((st) => ({ events: [...st.events, ...events] }));
  ensureRealRoom(tour.id);
  useAudora.getState().setSeeded();
  useAudora.getState().setSeedVersion(SEED_VERSION);
}
