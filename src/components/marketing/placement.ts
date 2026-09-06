/**
 * Local helpers for the landing page's "test your own furniture" demo. They only use the public
 * engine API; the viewer has its own placement UX, this just finds a sensible spot automatically.
 */
import { buyerVerdict, clampToRoom, makePiece, parseFurnitureText, placeAgainstWall, wallLength } from '@/engine';
import { aabb, corners, round, separation, wallGaps, wallLabel } from '@/engine/geometry';
import { lowerName, smallPiece } from '@/engine/fit';
import type { BuyerVerdict, CatalogCategory, CatalogItem, PlacedPiece, ProceduralKind, RoomGeometry, Vec2, WallSide } from '@/engine/types';

export interface BuyerSpec {
  name: string;
  w: number;
  d: number;
  h: number;
  kind: ProceduralKind;
  flat: boolean;
}

const FILLER = /^(by|x|and|of|my|our|a|an|the|is|it|it's|its|about|roughly|around|approx)$/i;

/** The name as the buyer typed it, minus the numbers and the connectors between them. */
function cleanName(text: string): string {
  const stripped = text.replace(/\d+(?:[.,]\d+)?\s*(m|cm|mm|in|ft|")?/gi, ' ');
  const words = stripped
    .replace(/[×,;:()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.test(w));
  const n = words.join(' ').trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
}

/** parseFurnitureText with a tidier name ("sectional, 220 by 95" → "Sectional"). */
export function parseBuyerText(text: string): BuyerSpec | null {
  const parsed = parseFurnitureText(text);
  if (!parsed) return null;
  if (!(parsed.w > 0.05 && parsed.d > 0.05 && parsed.w < 15 && parsed.d < 15)) return null;
  return { ...parsed, name: cleanName(text) || parsed.name };
}

const CATEGORY_FOR: Partial<Record<ProceduralKind, CatalogCategory>> = {
  sofa: 'seating',
  sectional: 'seating',
  armchair: 'seating',
  coffeeTable: 'tables',
  sideTable: 'tables',
  diningSet: 'tables',
  desk: 'office',
  officeChair: 'office',
  bed: 'bedroom',
  nightstand: 'bedroom',
  dresser: 'bedroom',
  wardrobe: 'storage',
  bookshelf: 'storage',
  tvUnit: 'storage',
};

export function customItem(spec: BuyerSpec): CatalogItem {
  return {
    id: 'custom',
    name: spec.name,
    category: CATEGORY_FOR[spec.kind] ?? 'decor',
    kind: spec.kind,
    w: spec.w,
    d: spec.d,
    h: spec.h,
    roomTypes: [],
    flat: spec.flat,
    verified: false,
    source: 'Typed by the buyer.',
    color: '#62a0ff',
  };
}

/** Pieces that belong against a wall; everything else may float in the room. */
const WALL_KINDS = new Set<ProceduralKind>(['sofa', 'sectional', 'bed', 'bookshelf', 'dresser', 'wardrobe', 'tvUnit', 'desk', 'nightstand', 'sideTable']);

export interface Placement {
  piece: PlacedPiece;
  verdict: BuyerVerdict;
}

/**
 * Drop the buyer's piece where it has the most room: against a wall for sofas and beds, in the open
 * for tables. When nothing fits anywhere the least-bad spot is returned with its honest verdict.
 */
export function findPlacement(spec: BuyerSpec, room: RoomGeometry, staging: PlacedPiece[]): Placement {
  const item = customItem(spec);
  const walls: WallSide[] = ['north', 'east', 'west', 'south'];
  const againstWalls: PlacedPiece[] = [];
  for (const wall of walls) {
    const L = wallLength(room, wall);
    for (let along = spec.w / 2 + 0.05; along <= L - spec.w / 2 - 0.05 + 1e-6; along += 0.2) {
      const f = placeAgainstWall(room, wall, along, spec.w, spec.d, 0.03);
      againstWalls.push(makePiece(item, f.x, f.z, f.rot, 'buyer'));
    }
  }
  const interior: PlacedPiece[] = [];
  for (let x = -room.width / 2 + 0.3; x <= room.width / 2 - 0.3 + 1e-6; x += 0.3) {
    for (let z = -room.depth / 2 + 0.3; z <= room.depth / 2 - 0.3 + 1e-6; z += 0.3) {
      for (const rot of [0, Math.PI / 2]) {
        const f = clampToRoom({ x, z, w: spec.w, d: spec.d, rot }, room);
        interior.push(makePiece(item, f.x, f.z, f.rot, 'buyer'));
      }
    }
  }
  // Sofas and beds prefer a wall, tables the open floor, but a proper walkway beats either preference:
  // a spot that leaves 0.75 m wins over a preferred spot that leaves 0.35 m.
  const wallFirst = WALL_KINDS.has(spec.kind);
  const groups: [PlacedPiece[], number][] = [
    [againstWalls, wallFirst ? 0.4 : 0],
    [interior, wallFirst ? 0 : 0.4],
  ];
  let best: (Placement & { score: number }) | null = null;
  let leastBad: Placement | null = null;
  for (const [group, bonus] of groups) {
    for (const piece of group) {
      const verdict = buyerVerdict(piece, staging, room);
      if (verdict.fits) {
        const clearance = verdict.clearance?.metres ?? 1.5;
        const score = (clearance >= 0.75 ? 2 : 0) + Math.min(clearance, 1.5) + bonus;
        if (!best || score > best.score) best = { piece, verdict, score };
      } else if (!leastBad || verdict.reasons.length < leastBad.verdict.reasons.length) {
        leastBad = { piece, verdict };
      }
    }
  }
  if (best) return { piece: best.piece, verdict: best.verdict };
  if (leastBad) return leastBad;
  const f = clampToRoom({ x: 0, z: 0, w: spec.w, d: spec.d, rot: 0 }, room);
  const piece = makePiece(item, f.x, f.z, f.rot, 'buyer');
  return { piece, verdict: buyerVerdict(piece, staging, room) };
}

export interface Gap {
  a: Vec2;
  b: Vec2;
  metres: number;
  toward: string;
}

const AGAINST = 0.15;

function perimeter(p: PlacedPiece, n = 10): Vec2[] {
  const c = corners(p);
  const out: Vec2[] = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/**
 * The nearest walkway around a piece, as a drawable segment. It has to pick exactly the neighbour
 * `buyerVerdict` quotes — same `AGAINST` floor, same `smallPiece` filter, same 2-decimal rounding —
 * or the plan draws one number while the verdict sentence says another.
 */
export function nearestGap(piece: PlacedPiece, staging: PlacedPiece[], room: RoomGeometry): Gap | null {
  if (piece.flat) return null; // rugs never define a walkway
  let best: Gap | null = null;
  const gaps = wallGaps(piece, room);
  const box = aabb(piece);
  (Object.keys(gaps) as WallSide[]).forEach((wall) => {
    const m = gaps[wall];
    if (m < AGAINST || (best && m >= best.metres)) return;
    const a: Vec2 =
      wall === 'north' ? { x: piece.x, z: box.minZ } : wall === 'south' ? { x: piece.x, z: box.maxZ } : wall === 'west' ? { x: box.minX, z: piece.z } : { x: box.maxX, z: piece.z };
    const b: Vec2 =
      wall === 'north' ? { x: piece.x, z: -room.depth / 2 } : wall === 'south' ? { x: piece.x, z: room.depth / 2 } : wall === 'west' ? { x: -room.width / 2, z: piece.z } : { x: room.width / 2, z: piece.z };
    best = { a, b, metres: round(m, 2), toward: wallLabel(room, wall) };
  });
  const mine = perimeter(piece);
  for (const s of staging) {
    // A nightstand is too small to define a corridor, so the gap beside it is not a walkway —
    // exactly the rule buyerVerdict applies when it picks the clearance it reports.
    if (s.flat || s.owner === 'buyer' || smallPiece(s)) continue;
    const m = separation(piece, s);
    if (m < AGAINST || (best && m >= best.metres)) continue;
    const theirs = perimeter(s);
    let pa = mine[0];
    let pb = theirs[0];
    let d = Infinity;
    for (const p of mine) {
      for (const q of theirs) {
        const dd = Math.hypot(p.x - q.x, p.z - q.z);
        if (dd < d) {
          d = dd;
          pa = p;
          pb = q;
        }
      }
    }
    best = { a: pa, b: pb, metres: round(m, 2), toward: `the ${lowerName(s.name)}` };
  }
  return best;
}

export const cmDims = (w: number, d: number) => `${Math.round(w * 100)} × ${Math.round(d * 100)} cm`;
