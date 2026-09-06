import type { AnchorSpec, PlacedPiece, ProceduralKind, RawGeometry, RoomGeometry, RoomType } from '@/engine/types';
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
  /**
   * Axis-aligned bounds of the collider mesh in the provider's raw frame (y up, camera at origin).
   * `floorY` is the mesh's own floor plane — see `fetchColliderBounds`; it is the plane the
   * panorama's floor sits on, and what puts Audora's y = 0 there.
   */
  bounds?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; floorY?: number };
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
