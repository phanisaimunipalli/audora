import type { CatalogItem, Footprint, PlacedPiece, RoomGeometry, RoomType, WallSide } from './types';
import { CATALOG, catalogItem } from './catalog';
import { adjacentWalls, clampToRoom, oppositeWall, placeAgainstWall, wallLength, rotationFacingFromWall, wallGaps, wallFeaturePosition } from './geometry';
import { fitReport, pieceStatus } from './fit';
import { MIN_WALKWAY_M } from './anchor';

export type StagingStyle = 'warm' | 'minimal' | 'scandi' | 'family';

export const STYLE_LABELS: Record<StagingStyle, string> = {
  warm: 'Warm & layered',
  minimal: 'Minimal',
  scandi: 'Scandi',
  family: 'Family',
};

const STYLE_PALETTE: Record<StagingStyle, Record<string, string>> = {
  warm: { sofa: '#8d6e5a', armchair: '#a3684d', rug: '#b59a7a', bed: '#c9b9a0', wood: '#4c3b2f' },
  minimal: { sofa: '#8a8a8a', armchair: '#9b9b9b', rug: '#c9c4bb', bed: '#d9d6d0', wood: '#3b3b3b' },
  scandi: { sofa: '#9aa39b', armchair: '#c5b8a5', rug: '#d8cdbb', bed: '#e2dccf', wood: '#b48a5e' },
  family: { sofa: '#5f6f8f', armchair: '#8a6a7a', rug: '#a89b8a', bed: '#bfc7cc', wood: '#5a4636' },
};

let counter = 0;
export function pieceId(prefix = 'p'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function makePiece(item: CatalogItem, x: number, z: number, rot: number, owner: PlacedPiece['owner'] = 'seller', color?: string): PlacedPiece {
  return {
    id: pieceId(owner === 'buyer' ? 'b' : 'p'),
    itemId: item.id,
    name: item.name,
    kind: item.kind,
    x,
    z,
    rot,
    w: item.w,
    d: item.d,
    h: item.h,
    owner,
    flat: item.flat,
    color: color ?? item.color,
    verified: item.verified,
  };
}

function colorKeyFor(item: CatalogItem): string | undefined {
  switch (item.kind) {
    case 'sofa':
    case 'sectional':
      return 'sofa';
    case 'armchair':
      return 'armchair';
    case 'rug':
      return 'rug';
    case 'bed':
      return 'bed';
    case 'coffeeTable':
    case 'sideTable':
    case 'tvUnit':
    case 'bookshelf':
    case 'diningSet':
    case 'nightstand':
    case 'dresser':
    case 'desk':
      return 'wood';
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Semantic placements: what a stager says out loud ("sofa against the north wall, coffee table in
 * front of it") resolved into metric footprints by the engine. Both the rule-based stager and the
 * language model speak this language; only the engine does arithmetic.
 * ---------------------------------------------------------------------------------------------- */

export type Corner = 'nw' | 'ne' | 'sw' | 'se' | 'farFromDoor';

export type Placement =
  | { kind: 'wall'; wall: WallSide; along?: number | 'start' | 'centre' | 'end'; inset?: number }
  | { kind: 'infront'; of: string; gap?: number }
  | { kind: 'beside'; of: string; side: 'left' | 'right'; gap?: number }
  | { kind: 'opposite'; of: string; inset?: number }
  | { kind: 'corner'; corner: Corner }
  | { kind: 'centre'; rot?: number }
  | { kind: 'under'; of: string }
  | { kind: 'coords'; x: number; z: number; rot: number };

export interface SemanticPiece {
  itemId: string;
  /** Name other pieces can refer to (defaults to itemId). */
  ref?: string;
  placement: Placement;
  optional?: boolean;
}

export interface ResolveResult {
  pieces: PlacedPiece[];
  dropped: { itemId: string; reason: string; optional: boolean }[];
}

/** Kinds that are decor unless the proposal says otherwise: dropped before a walkway is squeezed. */
export const DEFAULT_OPTIONAL_KINDS: ReadonlySet<CatalogItem['kind']> = new Set(['rug', 'floorLamp', 'plant', 'sideTable', 'bookshelf', 'armchair', 'nightstand', 'tvUnit', 'dresser', 'wardrobe']);

export function isEssentialKind(kind: CatalogItem['kind']): boolean {
  return !DEFAULT_OPTIONAL_KINDS.has(kind);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Find the piece a model is talking about. Accepts the ref it declared, a catalog id, a kind, a
 * loose phrase containing any of those, or the wall words "door"/"window" (returns undefined so the
 * caller can fall back to a wall placement).
 */
export function lookupRef(refs: Map<string, PlacedPiece>, placed: PlacedPiece[], of: string | undefined): PlacedPiece | undefined {
  if (!of) return undefined;
  const direct = refs.get(of);
  if (direct) return direct;
  const key = norm(of);
  if (!key) return undefined;
  for (const [k, v] of refs) if (norm(k) === key) return v;
  for (const p of [...placed].reverse()) if (norm(p.itemId) === key || norm(p.kind) === key || norm(p.name) === key) return p;
  for (const [k, v] of refs) if (key.includes(norm(k)) || norm(k).includes(key)) return v;
  for (const p of [...placed].reverse()) if (key.includes(norm(p.itemId)) || key.includes(norm(p.kind)) || key.includes(norm(p.name))) return p;
  // "the sofa" → any seating; "the bed" → any bed
  const kindWords: [string, CatalogItem['kind'][]][] = [
    ['sofa', ['sofa', 'sectional']],
    ['couch', ['sofa', 'sectional']],
    ['bed', ['bed']],
    ['table', ['coffeeTable', 'diningSet', 'desk', 'sideTable']],
    ['desk', ['desk']],
  ];
  for (const [word, kinds] of kindWords) if (key.includes(word)) {
    const hit = [...placed].reverse().find((p) => kinds.includes(p.kind));
    if (hit) return hit;
  }
  return undefined;
}

function frontVector(rot: number) {
  return { x: Math.sin(rot), z: Math.cos(rot) };
}
function rightVector(rot: number) {
  return { x: Math.cos(rot), z: -Math.sin(rot) };
}

/** The wall a piece is pushed against (gap under 20cm), if any. */
function wallOf(p: Footprint, room: RoomGeometry): WallSide | undefined {
  const g = wallGaps(p, room);
  const best = (Object.keys(g) as WallSide[]).sort((a, b) => g[a] - g[b])[0];
  return g[best] < 0.2 ? best : undefined;
}

function wallFacing(rot: number): WallSide {
  const f = frontVector(rot);
  if (Math.abs(f.z) >= Math.abs(f.x)) return f.z < 0 ? 'north' : 'south';
  return f.x < 0 ? 'west' : 'east';
}

/** Position along a wall (metres from its start) for a piece of width w, avoiding the door opening. */
type Along = number | 'start' | 'centre' | 'end' | undefined;

function alongOnWall(room: RoomGeometry, wall: WallSide, along: Along, w: number): number {
  const L = wallLength(room, wall);
  const half = w / 2;
  let a: number;
  if (along === 'start') a = half + 0.1;
  else if (along === 'end') a = L - half - 0.1;
  else if (typeof along === 'number') a = Math.max(half, Math.min(L - half, along * L));
  else a = L / 2;
  if (room.door.wall === wall) {
    const dLo = room.door.offset - room.door.width / 2 - 0.15;
    const dHi = room.door.offset + room.door.width / 2 + 0.15;
    if (a + half > dLo && a - half < dHi) {
      // slide to whichever side of the door has more room
      const leftRoom = dLo;
      const rightRoom = L - dHi;
      a = rightRoom >= leftRoom ? Math.min(L - half, dHi + half) : Math.max(half, dLo - half);
    }
  }
  return a;
}

function cornerPosition(room: RoomGeometry, corner: Corner, w: number, d: number): Footprint {
  let c = corner;
  if (c === 'farFromDoor') {
    const dp = wallFeaturePosition(room, room.door.wall, room.door.offset);
    const candidates: Corner[] = ['nw', 'ne', 'sw', 'se'];
    let best: Corner = 'nw';
    let bestDist = -1;
    for (const k of candidates) {
      const cx = k.includes('w') ? -room.width / 2 : room.width / 2;
      const cz = k.includes('n') ? -room.depth / 2 : room.depth / 2;
      const dist = Math.hypot(cx - dp.x, cz - dp.z);
      if (dist > bestDist) {
        bestDist = dist;
        best = k;
      }
    }
    c = best;
  }
  const x = (c.includes('w') ? -room.width / 2 + w / 2 : room.width / 2 - w / 2) + (c.includes('w') ? 0.05 : -0.05);
  const z = (c.includes('n') ? -room.depth / 2 + d / 2 : room.depth / 2 - d / 2) + (c.includes('n') ? 0.05 : -0.05);
  return { x, z, w, d, rot: 0 };
}

function fallbackWall(room: RoomGeometry, w: number, d: number): Footprint {
  const wall = oppositeWall(room.door.wall);
  return placeAgainstWall(room, wall, alongOnWall(room, wall, 'centre', w), w, d, 0.02);
}

/** First guess for a placement, before any validation. Unresolvable references fall back to the wall opposite the door. */
export function resolvePlacement(item: CatalogItem, placement: Placement, room: RoomGeometry, refs: Map<string, PlacedPiece>, placed: PlacedPiece[] = []): Footprint | null {
  const { w, d } = item;
  switch (placement.kind) {
    case 'wall': {
      const wall = (['north', 'south', 'east', 'west'] as WallSide[]).includes(placement.wall) ? placement.wall : oppositeWall(room.door.wall);
      const along = alongOnWall(room, wall, placement.along, w);
      return placeAgainstWall(room, wall, along, w, d, placement.inset ?? 0.02);
    }
    case 'infront': {
      const of = lookupRef(refs, placed, placement.of);
      if (!of) return fallbackWall(room, w, d);
      const f = frontVector(of.rot);
      const dist = of.d / 2 + (placement.gap ?? 0.45) + d / 2;
      return { x: of.x + f.x * dist, z: of.z + f.z * dist, w, d, rot: of.rot };
    }
    case 'beside': {
      const of = lookupRef(refs, placed, placement.of);
      if (!of) return fallbackWall(room, w, d);
      const r = rightVector(of.rot);
      const sign = placement.side === 'right' ? 1 : -1;
      const dist = of.w / 2 + (placement.gap ?? 0.1) + w / 2;
      return { x: of.x + r.x * dist * sign, z: of.z + r.z * dist * sign, w, d, rot: of.rot };
    }
    case 'opposite': {
      const of = lookupRef(refs, placed, placement.of);
      if (!of) return fallbackWall(room, w, d);
      const wall = wallOf(of, room) ? oppositeWall(wallOf(of, room)!) : wallFacing(of.rot);
      const base = wallFeaturePosition(room, wall, 0);
      // project the reference piece onto this wall's axis
      const along = base.along.x !== 0 ? of.x - base.x : of.z - base.z;
      return placeAgainstWall(room, wall, alongOnWall(room, wall, Math.max(0, Math.min(1, along / wallLength(room, wall))), w), w, d, placement.inset ?? 0.02);
    }
    case 'corner':
      return cornerPosition(room, placement.corner, w, d);
    case 'centre':
      return { x: 0, z: 0, w, d, rot: placement.rot ?? (room.width >= room.depth ? 0 : Math.PI / 2) };
    case 'under': {
      const of = lookupRef(refs, placed, placement.of);
      if (!of) return { x: 0, z: 0, w, d, rot: 0 };
      const f = frontVector(of.rot);
      const rot = Math.abs(Math.sin(of.rot)) > 0.5 ? Math.PI / 2 : 0;
      const shift = Math.min(0.5, of.d * 0.35);
      return { x: of.x + f.x * (of.d / 2 + shift), z: of.z + f.z * (of.d / 2 + shift), w, d, rot };
    }
    case 'coords':
      return { x: placement.x, z: placement.z, w, d, rot: placement.rot };
  }
}

type Verdict = 'ok' | 'overlap' | 'outside' | 'door';

function verdictFor(fp: Footprint, item: CatalogItem, placed: PlacedPiece[], room: RoomGeometry): Verdict {
  const probe: PlacedPiece = { ...makePiece(item, fp.x, fp.z, fp.rot), id: '__probe' };
  return pieceStatus(probe, placed, room);
}

function squeezes(fp: Footprint, item: CatalogItem, placed: PlacedPiece[], room: RoomGeometry): boolean {
  if (item.flat) return false;
  const probe: PlacedPiece = { ...makePiece(item, fp.x, fp.z, fp.rot), id: '__probe' };
  const report = fitReport([...placed, probe], room);
  return report.tightSpots.some((t) => (t.a === probe.id || t.b === probe.id) && t.gap < MIN_WALKWAY_M);
}

/**
 * Search near the requested spot for a footprint that is inside the room, overlaps nothing and keeps
 * the door clear. Slides along the piece's width axis first (this keeps wall pieces on their wall),
 * then its depth axis, then tries the other walls. Prefers spots that do not squeeze a walkway.
 */
export function findValidSpot(fp: Footprint, item: CatalogItem, room: RoomGeometry, placed: PlacedPiece[], opts?: { allowSqueeze?: boolean; tryOtherWalls?: boolean }): Footprint | null {
  const allowSqueeze = opts?.allowSqueeze ?? true;
  const candidates: Footprint[] = [];
  const push = (f: Footprint) => candidates.push(clampToRoom(f, room));
  push(fp);
  const r = rightVector(fp.rot);
  const f = frontVector(fp.rot);
  const steps = [0.15, 0.3, 0.45, 0.6, 0.8, 1.0, 1.25, 1.5, 2.0, 2.5];
  for (const s of steps) {
    push({ ...fp, x: fp.x + r.x * s, z: fp.z + r.z * s });
    push({ ...fp, x: fp.x - r.x * s, z: fp.z - r.z * s });
  }
  for (const s of steps.slice(0, 6)) {
    push({ ...fp, x: fp.x + f.x * s, z: fp.z + f.z * s });
    push({ ...fp, x: fp.x - f.x * s, z: fp.z - f.z * s });
  }
  if (opts?.tryOtherWalls) {
    const current = wallOf(fp, room);
    const order: WallSide[] = current ? [...adjacentWalls(current), oppositeWall(current)] : ['north', 'east', 'west', 'south'];
    for (const wall of order) {
      for (const along of ['centre', 'start', 'end'] as const) {
        push(placeAgainstWall(room, wall, alongOnWall(room, wall, along, item.w), item.w, item.d, 0.02));
      }
    }
  }
  let fallback: Footprint | null = null;
  for (const c of candidates) {
    if (verdictFor(c, item, placed, room) !== 'ok') continue;
    if (!squeezes(c, item, placed, room)) return c;
    if (allowSqueeze && !fallback) fallback = c;
  }
  return fallback;
}

/** Resolve a semantic proposal (from the rule-based stager or a language model) into validated pieces. */
export function resolveSemanticProposal(room: RoomGeometry, proposal: SemanticPiece[], style: StagingStyle = 'warm', owner: PlacedPiece['owner'] = 'seller'): ResolveResult {
  const palette = STYLE_PALETTE[style];
  const placed: PlacedPiece[] = [];
  const refs = new Map<string, PlacedPiece>();
  const dropped: ResolveResult['dropped'] = [];
  for (const sp of proposal) {
    if (!sp || typeof sp !== 'object' || !sp.placement || typeof sp.placement !== 'object') continue;
    const item = catalogItem(String(sp.itemId)) ?? CATALOG.find((c) => c.kind === (sp.itemId as CatalogItem['kind'])) ?? CATALOG.find((c) => norm(c.name) === norm(String(sp.itemId)));
    if (!item) {
      dropped.push({ itemId: String(sp.itemId), reason: 'unknown catalog item', optional: Boolean(sp.optional) });
      continue;
    }
    const optional = typeof sp.optional === 'boolean' ? sp.optional : DEFAULT_OPTIONAL_KINDS.has(item.kind);
    // Alternatives to try when the requested spot has no room: the other side, other corners.
    const placements: Placement[] = [sp.placement];
    if (sp.placement.kind === 'beside') placements.push({ ...sp.placement, side: sp.placement.side === 'left' ? 'right' : 'left' });
    if (sp.placement.kind === 'corner') for (const c of ['farFromDoor', 'nw', 'ne', 'sw', 'se'] as Corner[]) if (c !== sp.placement.corner) placements.push({ kind: 'corner', corner: c });
    if (sp.placement.kind === 'infront' && !item.flat) placements.push({ kind: 'centre' });
    let spot: Footprint | null = null;
    for (const pl of placements) {
      const guess = resolvePlacement(item, pl, room, refs, placed);
      if (!guess) continue;
      if (item.flat) {
        spot = clampToRoom(guess, room);
        break;
      }
      spot = findValidSpot(guess, item, room, placed, { allowSqueeze: !optional, tryOtherWalls: pl.kind === 'wall' || pl.kind === 'opposite' || (!optional && pl.kind !== 'centre') });
      if (spot) break;
    }
    if (!spot) {
      dropped.push({ itemId: item.id, reason: optional ? 'no room without squeezing a walkway' : 'no valid position found', optional });
      continue;
    }
    const key = colorKeyFor(item);
    const piece = makePiece(item, spot.x, spot.z, spot.rot, owner, key ? palette[key] : item.color);
    placed.push(piece);
    if (sp.ref) refs.set(String(sp.ref), piece);
    refs.set(item.id, piece);
    if (!refs.has(item.kind)) refs.set(item.kind, piece);
  }
  return { pieces: placed, dropped };
}

/* ------------------------------------------------------------------------------------------------
 * Rule-based stager: a semantic proposal per room type, resolved by the same engine.
 * ---------------------------------------------------------------------------------------------- */

function sofaWall(room: RoomGeometry, sofaW: number): WallSide {
  const opp = oppositeWall(room.door.wall);
  if (wallLength(room, opp) >= sofaW + 0.6) return opp;
  const [a, b] = adjacentWalls(room.door.wall);
  return wallLength(room, a) >= wallLength(room, b) ? a : b;
}

function proposeLiving(room: RoomGeometry, style: StagingStyle): SemanticPiece[] {
  const area = room.width * room.depth;
  const sofaId = area > 20 && style !== 'minimal' ? 'sectional' : 'sofa-3';
  const sofa = catalogItem(sofaId)!;
  const wall = sofaWall(room, sofa.w);
  const out: SemanticPiece[] = [{ itemId: sofaId, ref: 'sofa', placement: { kind: 'wall', wall, along: 'centre', inset: 0.05 } }];
  if (style !== 'minimal') out.push({ itemId: area > 16 ? 'rug-l' : 'rug-m', placement: { kind: 'under', of: 'sofa' }, optional: true });
  out.push({ itemId: 'coffee', placement: { kind: 'infront', of: 'sofa', gap: 0.45 } });
  out.push({ itemId: 'tv', placement: { kind: 'opposite', of: 'sofa' }, optional: true });
  out.push({ itemId: 'armchair', placement: { kind: 'beside', of: 'sofa', side: 'right', gap: 0.25 }, optional: true });
  out.push({ itemId: 'lamp', placement: { kind: 'beside', of: 'sofa', side: 'left', gap: 0.15 }, optional: true });
  if (style !== 'minimal') out.push({ itemId: 'plant', placement: { kind: 'corner', corner: 'farFromDoor' }, optional: true });
  if (style === 'family' || style === 'warm') out.push({ itemId: 'shelf', placement: { kind: 'wall', wall: adjacentWalls(wall)[0], along: 'end' }, optional: true });
  return out;
}

function proposeBedroom(room: RoomGeometry, style: StagingStyle): SemanticPiece[] {
  const area = room.width * room.depth;
  const bedId = area > 14 ? 'bed-king' : area > 10 ? 'bed-queen' : 'bed-double';
  const bed = catalogItem(bedId)!;
  const wall = sofaWall(room, bed.w + 1.0);
  const out: SemanticPiece[] = [{ itemId: bedId, ref: 'bed', placement: { kind: 'wall', wall, along: 'centre' } }];
  out.push({ itemId: 'nightstand', ref: 'ns-left', placement: { kind: 'beside', of: 'bed', side: 'left', gap: 0.08 }, optional: true });
  out.push({ itemId: 'nightstand', ref: 'ns-right', placement: { kind: 'beside', of: 'bed', side: 'right', gap: 0.08 }, optional: true });
  const [a, b] = adjacentWalls(wall);
  const dresserWall = a === room.door.wall ? b : a;
  out.push({ itemId: 'dresser', placement: { kind: 'wall', wall: dresserWall, along: 'end' }, optional: true });
  if (style !== 'minimal') {
    out.push({ itemId: 'rug-m', placement: { kind: 'under', of: 'bed' }, optional: true });
    out.push({ itemId: 'plant', placement: { kind: 'corner', corner: 'farFromDoor' }, optional: true });
  }
  if (style === 'family' && area > 14) out.push({ itemId: 'armchair', placement: { kind: 'opposite', of: 'bed' }, optional: true });
  return out;
}

function proposeDining(room: RoomGeometry, style: StagingStyle): SemanticPiece[] {
  const area = room.width * room.depth;
  const out: SemanticPiece[] = [{ itemId: area > 12 ? 'dining-6' : area > 9.5 ? 'dining-4' : 'dining-2', ref: 'table', placement: { kind: 'centre' } }];
  out.push({ itemId: 'dresser', placement: { kind: 'wall', wall: sofaWall(room, 1.5), along: 'centre' }, optional: true });
  if (style !== 'minimal') out.push({ itemId: 'plant', placement: { kind: 'corner', corner: 'farFromDoor' }, optional: true });
  return out;
}

function proposeOffice(room: RoomGeometry, style: StagingStyle): SemanticPiece[] {
  const win = room.windows.find((w) => w.wall !== room.door.wall);
  const wall = win ? win.wall : sofaWall(room, 1.4);
  const out: SemanticPiece[] = [
    { itemId: 'desk', ref: 'desk', placement: { kind: 'wall', wall, along: 'centre', inset: 0.05 } },
    { itemId: 'office-chair', placement: { kind: 'infront', of: 'desk', gap: 0.15 } },
  ];
  const [a, b] = adjacentWalls(wall);
  out.push({ itemId: 'shelf', placement: { kind: 'wall', wall: a === room.door.wall ? b : a, along: 'start' }, optional: true });
  if (style !== 'minimal') out.push({ itemId: 'plant', placement: { kind: 'corner', corner: 'farFromDoor' }, optional: true });
  return out;
}

export function proposeFor(room: RoomGeometry, type: RoomType, style: StagingStyle): SemanticPiece[] {
  switch (type) {
    case 'bedroom':
      return proposeBedroom(room, style);
    case 'dining':
    case 'kitchen':
      return proposeDining(room, style);
    case 'office':
      return proposeOffice(room, style);
    case 'studio': {
      const bed = proposeBedroom(room, style).slice(0, 3);
      const living = proposeLiving(room, style).filter((p) => ['sofa-3', 'sectional', 'coffee', 'tv'].includes(p.itemId));
      // The sofa goes on the wall opposite the bed rather than the same one.
      const bedWall = (bed[0].placement as { wall: WallSide }).wall;
      living[0] = { ...living[0], placement: { kind: 'wall', wall: oppositeWall(bedWall) === room.door.wall ? adjacentWalls(bedWall)[0] : oppositeWall(bedWall), along: 'centre', inset: 0.05 } };
      return [...bed, ...living];
    }
    case 'bathroom':
    case 'hallway':
      return [{ itemId: 'plant', placement: { kind: 'corner', corner: 'farFromDoor' }, optional: true }];
    default:
      return proposeLiving(room, style);
  }
}

/**
 * Deterministic, rule-based arrangement. Every piece goes through the same resolver and repair
 * search the language model's proposals use, so nothing overlaps, leaves the room or blocks the door.
 */
export function autoStage(room: RoomGeometry, type: RoomType, style: StagingStyle = 'warm'): PlacedPiece[] {
  return resolveSemanticProposal(room, proposeFor(room, type, style), style).pieces;
}

/** Validate a raw-coordinate proposal (the baseline the eval compares against): clamp, then keep or drop. */
export function validateProposal(
  room: RoomGeometry,
  proposal: { itemId: string; x: number; z: number; rot: number }[],
  style: StagingStyle = 'warm',
): ResolveResult {
  const palette = STYLE_PALETTE[style];
  const pieces: PlacedPiece[] = [];
  const dropped: ResolveResult['dropped'] = [];
  for (const p of proposal) {
    const item = catalogItem(p.itemId) ?? CATALOG.find((c) => c.kind === (p.itemId as CatalogItem['kind']));
    if (!item) {
      dropped.push({ itemId: p.itemId, reason: 'unknown catalog item', optional: false });
      continue;
    }
    const clamped = clampToRoom({ x: p.x, z: p.z, w: item.w, d: item.d, rot: p.rot }, room);
    const key = colorKeyFor(item);
    const piece = makePiece(item, clamped.x, clamped.z, clamped.rot, 'seller', key ? palette[key] : item.color);
    const status = pieceStatus(piece, pieces, room);
    if (status !== 'ok') {
      dropped.push({ itemId: p.itemId, reason: status === 'overlap' ? 'overlaps another piece' : status === 'door' ? 'blocks the door' : 'outside the room', optional: DEFAULT_OPTIONAL_KINDS.has(item.kind) });
      continue;
    }
    pieces.push(piece);
  }
  return { pieces, dropped };
}

/** Raw-coordinate proposal with the repair search applied (a middle ground the eval also measures). */
export function repairProposal(
  room: RoomGeometry,
  proposal: { itemId: string; x: number; z: number; rot: number }[],
  style: StagingStyle = 'warm',
): ResolveResult {
  return resolveSemanticProposal(
    room,
    proposal.map((p) => ({ itemId: p.itemId, placement: { kind: 'coords', x: p.x, z: p.z, rot: p.rot } as Placement })),
    style,
  );
}

export const WALLS: WallSide[] = ['north', 'south', 'east', 'west'];
export const rotationForWall = rotationFacingFromWall;
