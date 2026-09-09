import type { AnchorSpec, PlacedPiece, ProceduralKind, RawGeometry, RoomGeometry, RoomType, WallSide } from '@/engine/types';
import type { StagingStyle } from '@/engine/autostage';
// Type-only: the parsed shape lives next to the parser (services/floorplan), and a tour stores it whole.
import type { FloorPlan } from '@/services/floorplan';
// Type-only: metric fusion is shared code (compiled into both the browser and the worker), and the
// worker writes exactly this record onto the room — see docs/ACCURACY.md section 2.
import type { RoomMeasurement } from '@shared/fusion';

export type Tier = 'draft' | 'full';
export type Provider = 'marble' | 'mock';

/**
 * Where an extra angle faces, relative to the room's primary photo. It becomes Marble's `azimuth`
 * hint in a multi-image prompt (`AZIMUTH_FOR_ANGLE` in services/marble); left unset, Marble works
 * the arrangement out for itself, which is better than a wrong hint.
 */
export type PhotoAngle = 'left' | 'centre' | 'right' | 'back';

export interface PhotoRecord {
  dataUrl: string;
  width: number;
  height: number;
  brightness: number;
  darkFraction: number;
  detail: number;
  /** Set only on extra angles the leasing team labelled. */
  angle?: PhotoAngle;
  /** Where the photo came from, when it was not a file the leasing team chose. */
  origin?: 'file' | 'url';
  /** The listing page the photo was fetched from, for the credit line. */
  sourceUrl?: string;
}

export interface PhotoAnalysis {
  roomType: RoomType;
  roomTypeConfidence: number;
  isEmpty: boolean;
  doorVisible: boolean;
  /** Normalised bounding box of a visible door, if any. */
  doorBox?: { x: number; y: number; w: number; h: number };
  quality: 'good' | 'ok' | 'poor';
  notes: string[];
  caption: string;
  source: 'nebius' | 'heuristic';
  model?: string;
  ms?: number;
  usd?: number | null;
}

/** An opening found in the collider's wall band — a window, or a doorway into the next room. */
export interface WorldWallOpening {
  /** The wall of Audora's metric room it falls on. */
  wall: WallSide;
  /** Distance along that wall from its start (west end for north/south, north end for east/west). */
  offset: number;
  width: number;
}

/**
 * The room's own walls, measured from the collider's wall band: raw units, relative to the capture
 * point, each extent named after the provider axis it is closer to. Read it through `roomRect`
 * (services/marble), which recovers `rotation` and hands back the room in Audora's own axes.
 */
export interface WorldWallRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Yaw of the fitted rectangle relative to the provider's own axes, radians in [0, π/2). */
  rotation: number;
  /** Fraction of the wall band that lies on this rectangle — how much of a room the mesh really is. */
  score?: number;
  openings?: WorldWallOpening[];
}

/**
 * Axis-aligned bounds of the collider mesh in the provider's raw frame (y up, camera at origin),
 * plus what the mesh says about the room inside them.
 *
 * `floorY` / `ceilingY` are the mesh's own floor and ceiling planes (the densest horizontal slab in
 * the bottom / top quarter); the floor is the plane the panorama's floor sits on, and what puts
 * Audora's y = 0 there. `walls` is the room measured to its walls rather than to the box, which on
 * a real capture also holds everything the model reconstructed through the windows; `method` says
 * which of the two the room's numbers actually came from.
 */
export interface WorldBoundsRecord {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  floorY?: number;
  ceilingY?: number;
  walls?: WorldWallRect;
  method?: 'walls' | 'aabb';
}

export interface RoomWorld {
  provider: Provider;
  tier: Tier;
  worldId: string;
  model: string;
  createdAt: number;
  /** Proportions of the reconstructed room, unscaled. */
  raw: RawGeometry;
  spzUrl?: string;
  colliderUrl?: string;
  meshUrl?: string;
  thumbnailUrl?: string;
  panoUrl?: string;
  caption?: string;
  marbleUrl?: string;
  metricScaleFactor?: number | null;
  groundPlaneOffset?: number | null;
  /** Every splat resolution Marble made of this world, keyed `100k` / `150k` / `500k` / `full_res`. */
  spzUrls?: Record<string, string> | null;
  /**
   * What the collider mesh knows about the room, in the provider's raw units with the capture point
   * at the origin. Measured by `fetchColliderGeometry` (services/marble), which is also where the
   * conventions are written down.
   */
  bounds?: WorldBoundsRecord;
  credits?: number;
  usd?: number;
  seconds?: number;
  /**
   * Provenance (docs/BACKEND.md section 2): the sha256 of the canonical recipe this world was asked
   * for with, the Marble seed derived from it (its first 32 bits), and the compiled text prompt
   * Marble was told to use verbatim. Set on real Marble worlds by `startGeneration`; a simulated
   * world has none.
   */
  recipeHash?: string;
  seed?: number;
  prompt?: string;
}

/**
 * A room's measurements as the unit's floor plan printed them. `text` is kept verbatim
 * (`12'-4" × 15'-2"`) so a leasing team can check the conversion against the drawing they uploaded.
 */
export interface PlanDimensions {
  /** Metres. */
  width: number;
  depth: number;
  /**
   * The ceiling height the plan **printed**, metres. Optional, and its absence is the point: a
   * printed height is a measurement of this room (±3 cm, `CEILING_PRINTED_SIGMA_M`), where the
   * standard 2.44 m is only our own prior (±12 cm, and flagged as an assumption when it disagrees).
   * This is the field `scaleConstraintsFor` on the server and `demoMeasurement` in the seed both
   * read to decide which of the two a room's ceiling is fused with; it mirrors the server's
   * `rooms.plan_dims.height`.
   */
  height?: number;
  /** Exactly what the plan printed. */
  text?: string;
  /** Exactly what the plan printed for the ceiling, when it printed one. */
  ceilingText?: string;
  /** The plan's own name for the room, and the floor it put it on. */
  planRoomName?: string;
  floor?: string;
}

/** The floor plan a unit was built from: the drawing itself plus what was read off it. */
export interface TourFloorPlan extends FloorPlan {
  /** The uploaded drawing, downscaled — shown beside the rooms it produced. */
  imageUrl?: string;
  fileName?: string;
}

export type RoomStatus = 'pending' | 'generating' | 'ready' | 'failed';

/**
 * How the demo stager should furnish a room. `sparse` rooms are already furnished inside the
 * reconstruction itself (a full-quality Marble world of a lived-in flat), so Audora only adds a
 * couple of pieces on top rather than a whole staging.
 */
export type StagingPreset = 'auto' | 'sparse';

export interface Room {
  id: string;
  tourId: string;
  name: string;
  type: RoomType;
  order: number;
  photo?: PhotoRecord;
  /**
   * Extra angles of the same room, in the order the leasing team added them — the primary `photo` is not
   * repeated here. Together they become one multi-image Marble prompt (`generationImages` in
   * services/marble), capped at `MAX_ROOM_PHOTOS` including the primary.
   */
  photos?: PhotoRecord[];
  /**
   * What the unit's floor plan says this room measures. Metres, ±5 cm — the plan is a drawing, not
   * a tape. When it is present the room's raw geometry is built from these numbers instead of the
   * photo's estimate, and the anchor is `anchorFromFloorplan` (chip: "floor plan · 3.75 m wall · ±5 cm").
   */
  planDims?: PlanDimensions;
  analysis?: PhotoAnalysis;
  /**
   * What the collider actually measured, fused with every other constraint — the room's scale, its
   * 1σ, a 0..1 confidence, one residual per source, a flag naming both numbers wherever a source
   * disagrees, and the "plan says / model measures" line per dimension (`shared/fusion.ts`).
   *
   * Written by the worker after `copy_assets` (docs/ACCURACY.md 3.2), served per room by the public
   * tour, and read by the hub's AccuracyCard. The type is the server's own `rooms.measurement`
   * shape, so what is stored, served and shown is one object and not three that agree by hand.
   * Absent on a room the worker has not reached. It is **not** a real-worlds-only field: the demo
   * seed writes one for its own simulated rooms from the same `shared/fusion` functions the worker
   * calls, so the hub has real "plan says / model measures" lines on a first run with no network.
   * It is a *report*, never an input: `geometry` stays the room's own numbers.
   */
  measurement?: RoomMeasurement;
  raw: RawGeometry;
  anchor: AnchorSpec;
  geometry: RoomGeometry;
  draft?: RoomWorld;
  full?: RoomWorld;
  staging: PlacedPiece[];
  stagingStyle: StagingStyle;
  stagingPreset?: StagingPreset;
  /**
   * Metres the reconstruction is raised so that its floor meets Audora's floor (y = 0).
   * `splatTransform` folds it into the Marble group's `position.y`; nothing else in the metric
   * frame moves, so furniture keeps standing on y = 0. Set by the "Floor height" nudge.
   */
  floorOffset?: number;
  /**
   * Per-room override of `Tour.site.heading`: the true-north bearing this room's north wall faces
   * outward. A flat's rooms look different ways; the sun has to follow the room, not the building.
   */
  northWallHeading?: number;
  /**
   * Provenance shown as a chip next to the room ("real Marble draft"). Kept out of `name` on
   * purpose: the name is renter-facing copy and must not carry pipeline qualifiers.
   */
  note?: string;
  status: RoomStatus;
  createdAt: number;
  updatedAt: number;
}

/** A building footprint from OpenStreetMap, as drawn on the site map. */
export interface SiteFootprint {
  /** Closed [lat, lon] ring. */
  ring: [number, number][];
  /** Bearing (deg from true north, mod 180) of its longest edge — the building's own axis. */
  principalHeading: number;
  heightM?: number;
  levels?: number;
}

/**
 * Where the unit actually is. Geocoded from the address (OpenStreetMap Nominatim), with the
 * building footprint from Overpass and the heading the leasing team confirmed on the compass. It is what
 * turns "a sun" into *this* listing's sun: `sunPosition(date, lat, lon)` through walls turned by
 * `heading`. Optional everywhere — a tour with no site simply has no real sun.
 */
export interface TourSite {
  lat: number;
  lon: number;
  /** Nominatim's own name for the place; shown with "© OpenStreetMap contributors". */
  displayName: string;
  footprint?: SiteFootprint;
  /** True-north bearing the room's north wall (the window wall) faces outward. */
  heading: number;
  /**
   * The wall `heading` was expressed against when the leasing team confirmed it — the wall the rooms'
   * windows were dominantly on at that moment.
   *
   * The leasing team answers one question ("which way do the windows face?") and the engine stores a
   * different number (the bearing of the room's *north* wall); `facingToHeading` converts, and the
   * conversion needs to know which wall the windows are on. That wall is read off the rooms, and the
   * rooms change after the Site step — the floor plan adds more, and the leasing team adds photos — so
   * reading it again later can turn the leasing team's "west" into "east" without anything having moved.
   * Recording it here keeps the answer the one they gave. Optional: a site saved before this field
   * existed falls back to reading the rooms.
   */
  windowWall?: WallSide;
  /** The instant the time-of-day control is parked on (epoch ms), so the tour reopens on it. */
  previewTime?: number;
  /** ShadeMap said whether each window is in sun, hour by hour, on `previewTime`'s date. */
  windowSun?: WindowSunStrip[];
  /** When the address was resolved. */
  resolvedAt?: number;
}

/** "Does this window get sun at this hour?" for one window, 24 hours of one day. */
export interface WindowSunStrip {
  roomName: string;
  wall: WallSide;
  /** Bearing the window faces, deg from true north. */
  bearing: number;
  /** 24 booleans, local hours 0-23 at half past. */
  hours: boolean[];
  /** `shademap` includes the neighbours' shadows; `model` is Audora's own solar geometry only. */
  source: 'shademap' | 'model';
}

export interface Tour {
  id: string;
  shareId: string;
  title: string;
  address: string;
  listingUrl?: string;
  listingSource?: string;
  /** The real place on the planet, once the leasing team has confirmed it in the Site step. */
  site?: TourSite;
  /** The unit's floor plan and every room read off it, once the leasing team has uploaded one. */
  floorPlan?: TourFloorPlan;
  /** Rent per month, as the leasing team writes it on the listing ("$4,250/mo"). */
  price?: string;
  /**
   * The date the unit is available, ISO `YYYY-MM-DD`. A real field rather than a sentence in
   * `summary`: the units list and the hub header both show it, and a renter deciding whether to
   * book a showing is deciding against a date. Optional — an old store, or a unit whose turnover
   * date is not settled, simply has none.
   */
  availableFrom?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  summary?: string;
  roomIds: string[];
  quality: Tier;
  createdAt: number;
  updatedAt: number;
  published: boolean;
  publishedAt?: number;
  notify: { browser: boolean; email: string };
  agent: { name: string; brandColor: string };
  copy?: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobStep {
  label: string;
  at: number; // progress percent at which this step begins
}

export interface Job {
  id: string;
  tourId: string;
  roomId: string;
  tier: Tier;
  provider: Provider;
  status: JobStatus;
  progress: number;
  step: string;
  /** Provider's own status line, when it has one (e.g. Marble's "World generation in progress"). */
  detail?: string;
  etaSeconds: number;
  createdAt: number;
  /** Last change to this job; the cross-tab merge keeps the newer copy. */
  updatedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  lastPollAt?: number;
  operationId?: string;
  worldId?: string;
  error?: string;
  /**
   * This job improves a room that already has a world (a full-quality upgrade of a draft) rather
   * than building its first one. A renter keeps walking the draft while it runs, and the copy
   * says "Upgrading to full quality" / "Full quality is ready" instead of "generating".
   */
  upgrade?: boolean;
  /**
   * What the generation was actually asked for (`startGeneration`): the model id, recipe hash, seed
   * and compiled prompt. Carried on the job so a reload between start and finish still lands them on
   * the world. The model is here for the same reason the hash is — it is part of the recipe, so the
   * world has to be able to say which one it asked for even if the provider's record omits it.
   */
  recipeHash?: string;
  seed?: number;
  prompt?: string;
  model?: string;
  /** Set when the completion has been shown to the user (badge / notification). */
  seen: boolean;
}

export interface MyStuffItem {
  id: string;
  name: string;
  w: number;
  d: number;
  h: number;
  kind: ProceduralKind;
  color: string;
  flat?: boolean;
  createdAt: number;
}

export type AnalyticsType = 'visit' | 'walk' | 'test' | 'fit' | 'nofit' | 'share' | 'toggle' | 'measure';

export interface AnalyticsEvent {
  id: string;
  tourId: string;
  roomId?: string;
  type: AnalyticsType;
  item?: string;
  at: number;
  visitor: string;
}

export interface Settings {
  /** Use simulated reconstruction even when a Marble key is present (saves credits while developing). */
  preferMock: boolean;
  mockDraftSeconds: number;
  mockFullSeconds: number;
  sound: boolean;
  agentName: string;
  brandColor: string;
  /**
   * Staging and furniture layering — the Stage tab, auto-stage, the staging editor and the renter's
   * furniture test. **Off by default** (docs/ACCURACY.md section 3.7): the product is the accurate
   * model of the unit, so the hub, the wizard and the viewer lead with measurements, the plan and
   * the model date. Every code path stays in place behind this flag; read it through
   * `stagingEnabled(settings)` in `@/state/staging`, which is where "undefined means off" lives, and
   * never as a bare boolean.
   */
  stagingEnabled?: boolean;
}

export interface ProviderStatus {
  nebius: boolean;
  marble: boolean;
  /**
   * Whether the Supabase backend is configured on the server (`/api/status`, docs/BACKEND.md §8).
   * False means every `/api/v1` route answers 503 and the app keeps this browser-local store, which
   * is the offline and demo path; the adapter switches over on this one flag.
   */
  backend?: boolean;
  models?: Record<string, string>;
  liveGenerations?: number;
  maxGenerations?: number;
  checkedAt: number;
}

export interface Toast {
  id: string;
  title: string;
  body?: string;
  kind: 'info' | 'success' | 'warn' | 'error';
  action?: { label: string; to: string };
  createdAt: number;
  ttl?: number;
}
