import type { BuyerVerdict, FitReport, Footprint, PlacedPiece, RoomGeometry, TightSpot, WallSide } from './types';
import { area, doorSwing, insideRoom, overlaps, separation, wallGaps, wallLabel, round } from './geometry';
import { MIN_WALKWAY_M } from './anchor';

/** Gaps smaller than this are read as "pushed against", not as a walkway. */
export const AGAINST_M = 0.15;

function solid(p: PlacedPiece): boolean {
  return !p.flat;
}

/** Pieces too small to define a corridor: gaps beside them are not walkways. */
function small(p: PlacedPiece): boolean {
  return Math.max(p.w, p.d) < 0.7;
}

/** Companion arrangements whose gap is legroom, not a walkway (sofa ↔ coffee table, bed ↔ nightstand...). */
const COMPANIONS: Partial<Record<PlacedPiece['kind'], PlacedPiece['kind'][]>> = {
  coffeeTable: ['sofa', 'sectional', 'armchair'],
  sideTable: ['sofa', 'sectional', 'armchair', 'bed'],
  nightstand: ['bed'],
  officeChair: ['desk'],
  armchair: ['sofa', 'sectional', 'coffeeTable'],
  floorLamp: ['sofa', 'sectional', 'armchair', 'bed', 'desk'],
  tvUnit: [],
};

export function companions(a: PlacedPiece, b: PlacedPiece): boolean {
  return Boolean(COMPANIONS[a.kind]?.includes(b.kind) || COMPANIONS[b.kind]?.includes(a.kind));
}

export function fitReport(pieces: PlacedPiece[], room: RoomGeometry): FitReport {
  const floorArea = room.width * room.depth;
  const solids = pieces.filter(solid);
  const overlapsFound: [string, string][] = [];
  const outOfBounds: string[] = [];
  const blocksDoor: string[] = [];
  const swing = doorSwing(room);

  for (const p of pieces) {
    if (!insideRoom(p, room)) outOfBounds.push(p.id);
  }
  for (const p of solids) {
    if (overlaps(p, swing)) blocksDoor.push(p.id);
  }
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      if (overlaps(solids[i], solids[j])) overlapsFound.push([solids[i].id, solids[j].id]);
    }
  }

  const misfitSet = new Set<string>(outOfBounds);
  for (const [a, b] of overlapsFound) {
    misfitSet.add(a);
    misfitSet.add(b);
  }

  const tight: TightSpot[] = [];
  let narrowest: TightSpot | undefined;
  const consider = (spot: TightSpot) => {
    if (spot.gap < AGAINST_M) return;
    if (!narrowest || spot.gap < narrowest.gap) narrowest = spot;
    if (spot.gap < MIN_WALKWAY_M) tight.push(spot);
  };
  // Walkways are the corridors between corridor-defining pieces (and between them and the walls).
  const corridorPieces = solids.filter((p) => !small(p));
  for (let i = 0; i < corridorPieces.length; i++) {
    for (let j = i + 1; j < corridorPieces.length; j++) {
      if (companions(corridorPieces[i], corridorPieces[j])) continue;
      const gap = separation(corridorPieces[i], corridorPieces[j]);
      consider({ a: corridorPieces[i].id, b: corridorPieces[j].id, aLabel: corridorPieces[i].name, bLabel: corridorPieces[j].name, gap: round(gap, 3) });
    }
    const gaps = wallGaps(corridorPieces[i], room);
    (Object.keys(gaps) as WallSide[]).forEach((wall) => {
      consider({
        a: corridorPieces[i].id,
        b: `wall:${wall}`,
        aLabel: corridorPieces[i].name,
        bLabel: wallLabel(room, wall),
        gap: round(gaps[wall], 3),
      });
    });
  }

  const used = solids.reduce((acc, p) => acc + area(p), 0);
  tight.sort((a, b) => a.gap - b.gap);
  return {
    pieces: pieces.length,
    floorArea: round(floorArea, 2),
    floorUsedPct: floorArea > 0 ? Math.round((used / floorArea) * 100) : 0,
    overlaps: overlapsFound,
    outOfBounds,
    blocksDoor,
    misfits: [...misfitSet],
    narrowestWalkway: narrowest ? narrowest.gap : null,
    narrowestBetween: narrowest,
    tightSpots: tight,
  };
}

/** Is this one piece acceptable given the other pieces? Used for continuous red/green feedback while dragging. */
export function pieceStatus(piece: PlacedPiece, others: PlacedPiece[], room: RoomGeometry): 'ok' | 'overlap' | 'outside' | 'door' {
  if (!insideRoom(piece, room)) return 'outside';
  if (!piece.flat) {
    for (const o of others) {
      if (o.id === piece.id || o.flat) continue;
      if (overlaps(piece, o)) return 'overlap';
    }
    if (overlaps(piece, doorSwing(room))) return 'door';
  }
  return 'ok';
}

/** Verdict for a buyer's own piece dropped into the seller's staged room. */
export function buyerVerdict(piece: PlacedPiece, staging: PlacedPiece[], room: RoomGeometry): BuyerVerdict {
  const reasons: string[] = [];
  const name = piece.name;
  if (!insideRoom(piece, room)) {
    const g = wallGaps(piece, room);
    const worst = (Object.keys(g) as WallSide[]).sort((a, b) => g[a] - g[b])[0];
    const over = Math.abs(Math.min(0, g[worst]));
    reasons.push(`It crosses ${wallLabel(room, worst)} by ${Math.round(over * 100)} cm.`);
  }
  // Rugs lie flat and never collide; everything else must clear the staging.
  const collisions = piece.flat ? [] : staging.filter((s) => !s.flat && s.owner !== 'buyer' && overlaps(piece, s));
  if (collisions.length) reasons.push(`It overlaps ${listNames(collisions.map((c) => c.name))}.`);
  if (!piece.flat && overlaps(piece, doorSwing(room))) reasons.push('It blocks the door from opening.');

  if (reasons.length) {
    return {
      fits: false,
      headline: `Your ${name.toLowerCase()} does not fit here.`,
      detail: reasons.join(' '),
      reasons,
    };
  }

  if (piece.flat) {
    return {
      fits: true,
      headline: `Your ${name.toLowerCase()} fits.`,
      detail: 'It lies flat, so nothing has to walk around it.',
      reasons: [],
    };
  }

  // Nearest gap to anything, ignoring "against" contacts.
  let best: { metres: number; toward: string } | undefined;
  const gaps = wallGaps(piece, room);
  (Object.keys(gaps) as WallSide[]).forEach((wall) => {
    const m = gaps[wall];
    if (m >= AGAINST_M && (!best || m < best.metres)) best = { metres: round(m, 2), toward: wallLabel(room, wall) };
  });
  for (const s of staging) {
    if (s.flat || s.owner === 'buyer' || small(s)) continue;
    const m = separation(piece, s);
    if (m >= AGAINST_M && (!best || m < best.metres)) best = { metres: round(m, 2), toward: `the ${s.name.toLowerCase()}` };
  }
  const tight = best && best.metres < MIN_WALKWAY_M;
  return {
    fits: true,
    headline: `Your ${name.toLowerCase()} fits.`,
    detail: best
      ? `${best.metres.toFixed(2)} m walkway remains to ${best.toward}.${tight ? ` That is tighter than the ${MIN_WALKWAY_M.toFixed(2)} m most people want.` : ''}`
      : 'Plenty of room around it.',
    reasons: [],
    clearance: best,
  };
}

/** "the double bed and both nightstands": each blocker named once, counted when it repeats. */
export function listNames(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const k = n.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const parts = [...counts].map(([n, c]) => (c === 1 ? `the ${n}` : c === 2 ? `both ${pluralName(n)}` : `${c} ${pluralName(n)}`));
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function pluralName(n: string): string {
  if (/(s|x|z|ch|sh)$/.test(n)) return `${n}es`;
  if (/[^aeiou]y$/.test(n)) return `${n.slice(0, -1)}ies`;
  return `${n}s`;
}

export function footprintOf(p: PlacedPiece): Footprint {
  return { x: p.x, z: p.z, w: p.w, d: p.d, rot: p.rot };
}
