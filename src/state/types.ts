import type { AnchorSpec, PlacedPiece, ProceduralKind, RawGeometry, RoomGeometry, RoomType, WallSide } from '@/engine/types';
import type { StagingStyle } from '@/engine/autostage';

export type Tier = 'draft' | 'full';
export type Provider = 'marble' | 'mock';

export interface PhotoRecord {
  dataUrl: string;
  width: number;
  height: number;
  brightness: number;
  darkFraction: number;
  detail: number;
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
  analysis?: PhotoAnalysis;
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
   * Provenance shown as a chip next to the room ("real Marble draft"). Kept out of `name` on
   * purpose: the name is buyer-facing copy and must not carry pipeline qualifiers.
   */
  note?: string;
  status: RoomStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Tour {
  id: string;
  shareId: string;
  title: string;
  address: string;
  listingUrl?: string;
  listingSource?: string;
  price?: string;
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
   * than building its first one. The buyer keeps walking the draft while it runs, and the copy
   * says "Upgrading to full quality" / "Full quality is ready" instead of "generating".
   */
  upgrade?: boolean;
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
}

export interface ProviderStatus {
  nebius: boolean;
  marble: boolean;
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
