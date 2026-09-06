// Shared metric types. Everything spatial in Audora is in METRES, rotation in RADIANS.
// Room coordinate frame: origin at the room centre, floor at y=0.
//   x grows east, z grows south. north wall is at z = -depth/2 (the far wall when you
//   stand in the doorway on the south wall and look in).

export type WallSide = 'north' | 'south' | 'east' | 'west';

export type RoomType =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'dining'
  | 'bathroom'
  | 'office'
  | 'hallway'
  | 'studio'
  | 'other';

export interface Vec2 {
  x: number;
  z: number;
}

/** Oriented rectangle on the floor: centre (x,z), size (w along local x, d along local z), rot about Y. */
export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
}

export interface DoorSpec {
  wall: WallSide;
  /** Distance from the wall's start (west end for north/south walls, north end for east/west walls) to the door centre. */
  offset: number;
  width: number;
  height: number;
}

export interface WindowSpec {
  wall: WallSide;
  offset: number;
  width: number;
  height: number;
  sill: number;
}

export interface RoomGeometry {
  width: number;
  depth: number;
  height: number;
  door: DoorSpec;
  windows: WindowSpec[];
}

/** Geometry as it comes back from a reconstruction: correct proportions, unknown scale. */
export interface RawGeometry {
  width: number;
  depth: number;
  height: number;
  door: DoorSpec;
  windows: WindowSpec[];
  /** Height of the tapped door in raw units (what makes the door a scale anchor). */
  doorHeightUnits: number;
  /** Height of an outlet centre in raw units. */
  outletHeightUnits: number;
}

export type AnchorMethod = 'door' | 'outlet' | 'wall' | 'floorplan' | 'ceiling' | 'marble' | 'assumed';

export interface AnchorSpec {
  method: AnchorMethod;
  /** The real-world reference in metres (2.03 for a door, 0.30 for an outlet, the typed wall length...). */
  referenceMetres: number;
  /** The same reference measured in raw reconstruction units. */
  referenceUnits: number;
  metresPerUnit: number;
  /** ± uncertainty, in metres, on a ~2m measurement. */
  uncertaintyM: number;
  /** Human label, e.g. "interior door · 2.03m · ±4cm". */
  label: string;
  /** Normalised image coordinates of the taps that produced this anchor (0..1). */
  taps?: { x: number; y: number }[];
  /** Optional detail: which wall was typed, which tool measured it. */
  detail?: string;
  /** For wall / floor-plan anchors: which raw dimension the typed length refers to. */
  axis?: 'width' | 'depth';
}

export type ProceduralKind =
  | 'sofa'
  | 'sectional'
  | 'armchair'
  | 'coffeeTable'
  | 'sideTable'
  | 'tvUnit'
  | 'rug'
  | 'floorLamp'
  | 'plant'
  | 'bookshelf'
  | 'diningSet'
  | 'bed'
  | 'nightstand'
  | 'dresser'
  | 'wardrobe'
  | 'desk'
  | 'officeChair'
  | 'box';

export type CatalogCategory = 'seating' | 'tables' | 'storage' | 'bedroom' | 'office' | 'decor';

export interface CatalogItem {
  id: string;
  name: string;
  category: CatalogCategory;
  kind: ProceduralKind;
  /** metres */
  w: number;
  d: number;
  h: number;
  roomTypes: RoomType[];
  /** Flat pieces (rugs) never collide and do not count towards floor use. */
  flat?: boolean;
  /** Reference dimension vs a verified retail SKU. Unverified pieces are labelled as such in the UI. */
  verified: boolean;
  source: string;
  color?: string;
}

export type PieceOwner = 'seller' | 'buyer';

export interface PlacedPiece extends Footprint {
  id: string;
  /** Catalog id, or 'custom' for buyer-entered furniture. */
  itemId: string;
  name: string;
  kind: ProceduralKind;
  h: number;
  owner: PieceOwner;
  flat?: boolean;
  color?: string;
  verified: boolean;
}

export interface TightSpot {
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  gap: number;
}

export interface FitReport {
  pieces: number;
  floorArea: number;
  floorUsedPct: number;
  overlaps: [string, string][];
  outOfBounds: string[];
  blocksDoor: string[];
  /** Ids of every piece that does not fit for any reason. */
  misfits: string[];
  /** Narrowest walkway in metres, or null when there is nothing to walk between. */
  narrowestWalkway: number | null;
  narrowestBetween?: TightSpot;
  tightSpots: TightSpot[];
}

export interface PlausibilityWarning {
  field: 'height' | 'width' | 'depth' | 'door' | 'area';
  message: string;
  severity: 'warn' | 'error';
}

export interface BuyerVerdict {
  fits: boolean;
  headline: string;
  detail: string;
  reasons: string[];
  /** Remaining walkway to the nearest obstacle, in metres, when the piece fits. */
  clearance?: { metres: number; toward: string };
}
