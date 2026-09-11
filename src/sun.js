// Solar geometry. Closed form, no API and no model: given a place, a date and
// a time, where the sun is in the sky is arithmetic. NOAA's algorithm, which is
// accurate to well under a degree for any year we care about.

const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

// Days since the J2000.0 epoch, fractional.
function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5
}

function solarPosition(date, lat, lon) {
  const jd = julianDay(date)
  const n = jd - 2451545.0
  const T = n / 36525

  // Geometric mean longitude and anomaly of the sun.
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
  // Equation of centre.
  const C =
    Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) +
    Math.sin(rad(3 * M)) * 0.000289
  const trueLong = L0 + C
  const omega = 125.04 - 1934.136 * T
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega))

  // Obliquity of the ecliptic, with the nutation correction.
  const e0 =
    23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
  const eps = e0 + 0.00256 * Math.cos(rad(omega))

  const declination = deg(
    Math.asin(Math.sin(rad(eps)) * Math.sin(rad(appLong)))
  )

  // Equation of time, in minutes.
  const y = Math.tan(rad(eps / 2)) ** 2
  const eot =
    4 *
    deg(
      y * Math.sin(2 * rad(L0)) -
        2 * 0.016708634 * Math.sin(rad(M)) +
        4 * 0.016708634 * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) -
        0.5 * y * y * Math.sin(4 * rad(L0)) -
        1.25 * 0.016708634 ** 2 * Math.sin(2 * rad(M))
    )

  // True solar time, then the hour angle.
  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  const trueSolarTime = (utcMinutes + eot + 4 * lon + 1440) % 1440
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180

  const zenith = deg(
    Math.acos(
      Math.sin(rad(lat)) * Math.sin(rad(declination)) +
        Math.cos(rad(lat)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle))
    )
  )
  const elevation = 90 - zenith

  // Azimuth measured clockwise from true north. The 180 minus acos, negated
  // after solar noon, is what puts the morning sun in the east; taking acos
  // directly mirrors the whole day around the meridian.
  let azimuth
  const denom = Math.cos(rad(lat)) * Math.sin(rad(zenith))
  if (Math.abs(denom) > 1e-6) {
    let c =
      (Math.sin(rad(lat)) * Math.cos(rad(zenith)) - Math.sin(rad(declination))) / denom
    c = Math.min(1, Math.max(-1, c))
    azimuth = 180 - deg(Math.acos(c))
    if (hourAngle > 0) azimuth = -azimuth
    azimuth = (azimuth + 360) % 360
  } else {
    azimuth = lat > 0 ? 180 : 0
  }

  return { elevation, azimuth, declination }
}

// Sun is "up" a little before its centre clears the horizon, because the disc
// has width and the atmosphere bends the light. -0.833 is the usual figure.
const HORIZON = -0.833

// Walks the day in one minute steps. Slower than solving for the crossings, but
// exact for our purposes and immune to the edge cases near the poles.
function scanDay(date, lat, lon, keep) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const out = []
  let run = null
  for (let m = 0; m <= 1440; m++) {
    const t = new Date(start.getTime() + m * 60000)
    const pos = solarPosition(t, lat, lon)
    const ok = m < 1440 && keep(pos)
    if (ok && !run) run = { from: t, fromPos: pos }
    if (!ok && run) {
      run.to = t
      out.push(run)
      run = null
    }
  }
  return out
}

export function daylight(date, lat, lon) {
  const runs = scanDay(date, lat, lon, (p) => p.elevation > HORIZON)
  if (!runs.length) return null
  return { sunrise: runs[0].from, sunset: runs[runs.length - 1].to }
}

// Compass names, and the reverse.
export const COMPASS = [
  { k: 'N', name: 'North', deg: 0 },
  { k: 'NE', name: 'North east', deg: 45 },
  { k: 'E', name: 'East', deg: 90 },
  { k: 'SE', name: 'South east', deg: 135 },
  { k: 'S', name: 'South', deg: 180 },
  { k: 'SW', name: 'South west', deg: 225 },
  { k: 'W', name: 'West', deg: 270 },
  { k: 'NW', name: 'North west', deg: 315 },
]

// Shortest angular distance between two bearings, 0 to 180.
export function bearingDelta(a, b) {
  const d = Math.abs(((a - b + 540) % 360) - 180)
  return d
}

// A window admits direct sun when the sun is above the horizon and within the
// opening's field of view. 90 degrees either side of the normal is the physical
// limit for a flat opening; past that the sun is behind the wall.
export function directSun(date, lat, lon, facingDeg, halfAngle = 85) {
  const runs = scanDay(
    date,
    lat,
    lon,
    (p) => p.elevation > 3 && bearingDelta(p.azimuth, facingDeg) <= halfAngle
  )
  return runs.map((r) => ({ from: r.from, to: r.to }))
}

export { solarPosition }
