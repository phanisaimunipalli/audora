/**
 * Solar position (NOAA's simplified algorithm, accurate to ~0.01° for 1900–2100) and its mapping
 * into a room's frame so a real sun can shine through the reconstructed windows.
 * No dependencies; pure functions; angles in degrees unless noted.
 */

export interface SunPosition {
  /** Degrees clockwise from true north (0 = north, 90 = east). */
  azimuth: number;
  /** Degrees above the horizon; negative at night. */
  elevation: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Days since J2000.0 (2000-01-01 12:00 UTC) for a UTC date. */
function julianDay(date: Date): number {
  return date.getTime() / 86400000 - 0.5 + 2440587.5;
}

/** Sun azimuth/elevation for a UTC instant at a latitude/longitude. */
export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = julianDay(date);
  const t = (jd - 2451545) / 36525; // Julian centuries since J2000
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
  const minutesUtc = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (minutesUtc + eqTime + 4 * lon + 1440) % 1440;
  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  const cosZenith = Math.sin(rad(lat)) * Math.sin(rad(decl)) + Math.cos(rad(lat)) * Math.cos(rad(decl)) * Math.cos(rad(hourAngle));
  const zenith = deg(Math.acos(Math.max(-1, Math.min(1, cosZenith))));
  let azimuth: number;
  const denom = Math.cos(rad(lat)) * Math.sin(rad(zenith));
  if (Math.abs(denom) < 1e-9) azimuth = 180;
  else {
    const cosAz = (Math.sin(rad(lat)) * Math.cos(rad(zenith)) - Math.sin(rad(decl))) / denom;
    azimuth = deg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
    azimuth = hourAngle > 0 ? (azimuth + 180) % 360 : (540 - azimuth) % 360;
  }
  // Atmospheric refraction near the horizon.
  let elevation = 90 - zenith;
  if (elevation > -0.575) {
    const te = Math.tan(rad(elevation));
    let refr: number;
    if (elevation > 85) refr = 0;
    else if (elevation > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elevation > -0.575) refr = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
    else refr = -20.774 / te;
    elevation += refr / 3600;
  }
  return { azimuth: (azimuth + 360) % 360, elevation };
}

/** Sunrise/sunset (UTC) by scanning the day at 2-minute steps; good enough for a slider. */
export function sunTimes(dayUtc: Date, lat: number, lon: number): { sunrise: Date | null; sunset: Date | null } {
  const start = new Date(Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth(), dayUtc.getUTCDate(), 0, 0, 0));
  let prev = sunPosition(start, lat, lon).elevation > 0;
  let sunrise: Date | null = null;
  let sunset: Date | null = null;
  for (let m = 2; m <= 1440; m += 2) {
    const d = new Date(start.getTime() + m * 60000);
    const up = sunPosition(d, lat, lon).elevation > 0;
    if (up && !prev) sunrise = d;
    if (!up && prev) sunset = d;
    prev = up;
  }
  return { sunrise, sunset };
}

/**
 * Direction vector pointing FROM the room TOWARD the sun, in the room frame
 * (x east-in-room, y up, z south-in-room), given the compass heading of the room's north wall's
 * outward normal (`northWallHeadingDeg`: the true-north bearing you face when looking out through
 * the north wall; 0 means the room's north wall really faces north).
 */
export function sunDirectionInRoom(sun: SunPosition, northWallHeadingDeg = 0): { x: number; y: number; z: number } {
  const el = rad(sun.elevation);
  const az = rad(sun.azimuth - northWallHeadingDeg);
  // In the room frame the north wall is at -z. Compass north (az 0) → -z; east (az 90) → +x.
  const horiz = Math.cos(el);
  return { x: Math.sin(az) * horiz, y: Math.sin(el), z: -Math.cos(az) * horiz };
}

/** Which walls the sun shines through (the sun is on the wall's outward side) for a room heading. */
export function sunlitWalls(sun: SunPosition, northWallHeadingDeg = 0): ('north' | 'south' | 'east' | 'west')[] {
  if (sun.elevation <= 0) return [];
  const d = sunDirectionInRoom(sun, northWallHeadingDeg);
  const out: ('north' | 'south' | 'east' | 'west')[] = [];
  if (d.z < -0.15) out.push('north');
  if (d.z > 0.15) out.push('south');
  if (d.x > 0.15) out.push('east');
  if (d.x < -0.15) out.push('west');
  return out;
}

/** Warm at the horizon, neutral at noon. */
export function sunColor(elevationDeg: number): string {
  const t = Math.max(0, Math.min(1, elevationDeg / 40));
  const r = 255;
  const g = Math.round(170 + 70 * t);
  const b = Math.round(110 + 130 * t);
  return `#${r.toString(16)}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
