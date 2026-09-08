/**
 * Saying out loud where the room's light comes from.
 *
 * The sun is estimated from the photograph, so the renter is entitled to know what was estimated —
 * "light from the left window · 62% directional" is the same kind of honesty as the anchor chip. The
 * bearing is relative to the way the viewer is facing, because that is the only frame a person
 * standing in a room actually has; the percentage is the share of the light the key carries, which
 * is exactly what decides how deep the shadow on the floor is.
 */
import type { RoomGeometry } from '@/engine/types';
import { wallFeaturePosition } from '@/engine/geometry';
import type { SunEstimate } from './panoramaLight';

export interface SunDescriptionOptions {
  /** Where the viewer is looking, radians (0 = north, −z). Omit for a description in room terms. */
  facing?: number;
  /**
   * Windows in the room, as world positions. When the light lands within 45° of one, it is named as
   * a window rather than as a bearing.
   */
  windows?: { x: number; z: number }[];
  /** `LightBudget.directionalShare` — the share of the light the key carries, 0..1. */
  directionalShare?: number;
}

export interface SunDescription {
  /** "Light from the left window". Sentence case, no trailing punctuation. */
  phrase: string;
  /** "62% directional". */
  directional: string;
  /** The two joined with a separator, ready for the panel. */
  label: string;
  directionalPercent: number;
  /** Degrees from the viewer's facing; positive is to the right. */
  bearingDeg: number;
  /** Degrees above the horizon. */
  elevationDeg: number;
  /** True when the light was matched to one of the room's windows. */
  throughWindow: boolean;
}

const TAU = Math.PI * 2;

function wrap(a: number): number {
  let r = a;
  while (r > Math.PI) r -= TAU;
  while (r <= -Math.PI) r += TAU;
  return r;
}

/** Bearing of a horizontal direction as an azimuth `atan2(x, z)`, the convention the frame uses. */
export function azimuthOf(x: number, z: number): number {
  return Math.atan2(x, z);
}

/**
 * Where the light is, as a phrase that reads after "Light from ": "ahead", "the left",
 * "behind you on the right". Keeping it a noun phrase is what lets a window be slotted into it
 * without the sentence falling over.
 */
function bearingWord(deg: number): string {
  const a = Math.abs(deg);
  const side = deg >= 0 ? 'right' : 'left';
  if (a <= 22) return 'ahead';
  if (a <= 68) return `ahead on the ${side}`;
  if (a <= 115) return `the ${side}`;
  if (a <= 158) return `behind you on the ${side}`;
  return 'behind you';
}

/**
 * Describe an estimated sun. With `facing` the bearing is relative to the viewer; without it the
 * light is placed on the compass instead ("from the north-west"), which is what a panel with no
 * camera to speak of should say.
 */
export function describeSun(sun: SunEstimate, opts: SunDescriptionOptions = {}): SunDescription {
  const dir = sun.direction;
  const horizontal = Math.hypot(dir.x, dir.z);
  const elevationDeg = (Math.atan2(dir.y, horizontal) * 180) / Math.PI;
  const sunAz = azimuthOf(dir.x, dir.z);

  let bearingDeg = 0;
  let where: string;
  if (opts.facing != null) {
    // The viewer looks along (−sin yaw, −cos yaw); "right" is that turned a quarter turn.
    const lx = -Math.sin(opts.facing);
    const lz = -Math.cos(opts.facing);
    const forward = dir.x * lx + dir.z * lz;
    const right = dir.x * lz * -1 + dir.z * lx;
    bearingDeg = (Math.atan2(right, forward) * 180) / Math.PI;
    where = bearingWord(bearingDeg);
  } else {
    /* Audora's frame is x east, z south, and the azimuth is `atan2(x, z)` — so 0 points south and
       the angle runs south → east → north → west. */
    const compass = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
    const idx = Math.round((((sunAz % TAU) + TAU) % TAU) / (TAU / 8)) % 8;
    where = `the ${compass[idx]}`;
    bearingDeg = (wrap(sunAz) * 180) / Math.PI;
  }

  // Overhead light has no useful bearing; say so instead of pointing at a wall.
  const overhead = elevationDeg > 62;
  let throughWindow = false;
  if (!overhead && opts.windows?.length) {
    for (const w of opts.windows) {
      const az = azimuthOf(w.x, w.z);
      if (Math.abs(wrap(az - sunAz)) < Math.PI / 4) {
        throughWindow = true;
        break;
      }
    }
  }

  // "the left" + a window is "the left window"; "ahead" + a window is "the window ahead".
  const placed = throughWindow ? (where.startsWith('the ') ? `${where} window` : `the window ${where}`) : where;
  const phrase = overhead ? 'Light from overhead' : `Light from ${placed}`;
  const percent = Math.round(Math.min(1, Math.max(0, opts.directionalShare ?? sun.strength)) * 100);
  const directional = `${percent}% directional`;
  return {
    phrase,
    directional,
    label: `${phrase} · ${directional}`,
    directionalPercent: percent,
    bearingDeg,
    elevationDeg,
    throughWindow,
  };
}

/** World positions of a room's windows, for {@link describeSun}. Metres, room centred on the origin. */
export function windowPositions(room: RoomGeometry): { x: number; z: number }[] {
  return room.windows.map((w) => {
    const p = wallFeaturePosition(room, w.wall, w.offset + w.width / 2);
    return { x: p.x, z: p.z };
  });
}
