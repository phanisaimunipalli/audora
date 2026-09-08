/**
 * From the address to one honest sentence about the sun.
 *
 * `sun.ts` answers where the sun is; this answers what to *say* and which way the room is turned:
 * the compass heading the leasing team confirms (snapped to the building's own axes, as read off the
 * OpenStreetMap footprint) and the readout the time-of-day control prints. Pure, no DOM, no store —
 * the browser is not needed to check that "14:20 · sun 61° high, from the south-west" is right.
 */
import type { WallSide } from './types';
import { sunColor, sunDirectionInRoom, sunPosition, sunlitWalls, type SunPosition } from './sun';

export const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** Smallest signed turn from a to b, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** "south-west" for 225°. Eight points: nobody says "south-south-west" about a window. */
export function compassLabel(azimuth: number): string {
  return POINTS[Math.round(norm360(azimuth) / 45) % 8];
}

/** Short form for a chip: "SW". */
export function compassAbbr(azimuth: number): string {
  return compassLabel(azimuth)
    .split('-')
    .map((w) => w[0].toUpperCase())
    .join('');
}

/**
 * The four directions a wall of this building can face. The footprint's `principalHeading` is the
 * bearing of its longest edge (mod 180); walls run along it or square to it, so their outward
 * normals are that bearing every 90°.
 */
export function footprintAxes(principalHeading: number): number[] {
  const base = norm360(principalHeading);
  return [0, 90, 180, 270].map((d) => norm360(base + d)).sort((a, b) => a - b);
}

/** The building axis nearest a heading, and how far off it is. */
export function nearestAxis(heading: number, principalHeading: number): { axis: number; offBy: number } {
  let axis = norm360(heading);
  let offBy = Infinity;
  for (const a of footprintAxes(principalHeading)) {
    const d = Math.abs(angleDelta(norm360(heading), a));
    if (d < offBy) {
      offBy = d;
      axis = a;
    }
  }
  return { axis, offBy };
}

/**
 * Snap a dragged compass needle onto the building's own axes when it is close to one. Buildings are
 * rectangles; a window wall that reads 88° is a 90° wall the leasing team's thumb missed. Outside the
 * tolerance the leasing team means what they say and the heading is left alone.
 */
export function snapHeading(heading: number, principalHeading?: number, toleranceDeg = 12): number {
  const h = norm360(heading);
  if (principalHeading == null || !Number.isFinite(principalHeading)) return h;
  const { axis, offBy } = nearestAxis(h, principalHeading);
  return offBy <= toleranceDeg ? axis : h;
}

/**
 * What to prefill the compass with: the outward normal of the building's longest wall — the façade
 * that usually carries the windows. It is a guess, which is exactly why the leasing team confirms it.
 */
export function defaultHeading(principalHeading?: number): number {
  return principalHeading == null || !Number.isFinite(principalHeading) ? 0 : norm360(principalHeading + 90);
}

/** The room heading actually in force: the room's own override, else the building's, else north. */
export function effectiveHeading(siteHeading?: number, roomOverride?: number): number {
  return norm360(roomOverride ?? siteHeading ?? 0);
}

/** Compass bearing a room wall's outward normal points at, given the room's north-wall heading. */
export const WALL_BEARING: Record<WallSide, number> = { north: 0, east: 90, south: 180, west: 270 };

export function wallBearing(wall: WallSide, headingDeg: number): number {
  return norm360(headingDeg + WALL_BEARING[wall]);
}

const WALL_ORDER: WallSide[] = ['north', 'east', 'south', 'west'];

/**
 * The wall most of these windows are on — the room's "window wall". Ties break in `WALL_ORDER`, and
 * a room with no windows at all answers `north`, which is the wall the stored heading names.
 */
export function dominantWindowWall(walls: WallSide[]): WallSide {
  let best: WallSide = 'north';
  let bestN = 0;
  for (const w of WALL_ORDER) {
    const n = walls.filter((x) => x === w).length;
    if (n > bestN) {
      bestN = n;
      best = w;
    }
  }
  return best;
}

/**
 * The leasing team answers an easy question — "which way do the windows face?" — and the engine needs a
 * harder one: the bearing of the room's *north* wall, the frame every other wall is turned from.
 * These two convert between them. For a room whose windows are on its north wall they are the same
 * function, which is why a room with no windows loses nothing.
 */
export function facingToHeading(windowFacing: number, windowWall: WallSide): number {
  return norm360(windowFacing - WALL_BEARING[windowWall]);
}

export function headingToFacing(headingDeg: number, windowWall: WallSide): number {
  return norm360(headingDeg + WALL_BEARING[windowWall]);
}

/** "the south wall" · "the south and west walls" · "the north, east and south walls". */
export function wallsPhrase(walls: WallSide[]): string {
  const list = WALL_ORDER.filter((w) => walls.includes(w));
  if (!list.length) return '';
  if (list.length === 1) return `the ${list[0]} wall`;
  return `the ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]} walls`;
}

/** 24-hour clock in the device's own time zone: "14:20". */
export function clockLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** The same calendar day at a different minute (local). */
export function withMinutes(date: Date, minutes: number): Date {
  const d = new Date(date);
  d.setHours(Math.floor(minutes / 60), Math.round(minutes % 60), 0, 0);
  return d;
}

/** yyyy-mm-dd in local time, for `<input type="date">`. */
export function dateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Read `<input type="date">` back as a local date, keeping the time of day. */
export function dateFromInput(value: string, keepTimeFrom: Date): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(keepTimeFrom);
  d.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d;
}

/**
 * One line the leasing team and the renter both read:
 * "14:20 · sun 61° high, from the south-west · lights the south wall".
 */
export function sunReadout(date: Date, sun: SunPosition, walls: WallSide[]): string {
  const t = clockLabel(date);
  if (sun.elevation <= 0) return `${t} · the sun is below the horizon`;
  const head = `${t} · sun ${Math.round(sun.elevation)}° high, from the ${compassLabel(sun.azimuth)}`;
  const phrase = wallsPhrase(walls);
  return phrase ? `${head} · lights ${phrase}` : `${head} · no wall catches it`;
}

/** 1 in full sun, fading to 0 at the horizon so dusk does not switch off like a lamp. */
export function sunIntensity(elevationDeg: number): number {
  const t = Math.max(0, Math.min(1, elevationDeg / 6));
  return t * t * (3 - 2 * t);
}

export interface SunState {
  sun: SunPosition;
  /** Unit vector from the room toward the sun, in Audora's metric frame. */
  direction: { x: number; y: number; z: number };
  walls: WallSide[];
  color: string;
  /** 0 below the horizon, 1 in full sun. */
  intensity: number;
  readout: string;
}

/** Everything the light and the copy need for one instant at one address. */
export function sunState(date: Date, lat: number, lon: number, headingDeg = 0): SunState {
  const sun = sunPosition(date, lat, lon);
  const walls = sunlitWalls(sun, headingDeg);
  return {
    sun,
    direction: sunDirectionInRoom(sun, headingDeg),
    walls,
    color: sunColor(sun.elevation),
    intensity: sunIntensity(sun.elevation),
    readout: sunReadout(date, sun, walls),
  };
}
