import { useEffect, useMemo, useState } from 'react'
import { COMPASS, daylight, directSun, solarPosition } from './sun.js'

const time = (d) =>
  d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

const span = (runs) =>
  runs.length ? runs.map((r) => `${time(r.from)} to ${time(r.to)}`).join(' and ') : null

// Hours of direct sun, for the "how much" line rather than just "when".
const hours = (runs) =>
  runs.reduce((n, r) => n + (r.to - r.from) / 3600000, 0)

const solstice = (y, m, d) => new Date(y, m, d, 12, 0, 0)

// A compass rose with the sun's path drawn on it. Reading a diagram beats
// reading four timestamps when the question is "which way does this face".
function Rose({ lat, lon, facing, date }) {
  const path = useMemo(() => {
    const pts = []
    for (let m = 0; m < 1440; m += 10) {
      const t = new Date(date)
      t.setHours(0, m, 0, 0)
      const p = solarPosition(t, lat, lon)
      if (p.elevation <= 0) continue
      // Radius shrinks as the sun climbs: the centre is straight overhead.
      const r = 46 * (1 - p.elevation / 90)
      const a = ((p.azimuth - 90) * Math.PI) / 180
      pts.push([60 + r * Math.cos(a), 60 + r * Math.sin(a)])
    }
    return pts
  }, [lat, lon, date])

  const now = solarPosition(new Date(), lat, lon)
  const nowR = 46 * (1 - Math.max(0, now.elevation) / 90)
  const nowA = ((now.azimuth - 90) * Math.PI) / 180
  const fa = ((facing - 90) * Math.PI) / 180

  return (
    <svg className="rose" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="46" className="rose-ring" />
      <circle cx="60" cy="60" r="23" className="rose-ring faint" />
      {['N', 'E', 'S', 'W'].map((k, i) => {
        const a = ((i * 90 - 90) * Math.PI) / 180
        return (
          <text key={k} x={60 + 55 * Math.cos(a)} y={60 + 55 * Math.sin(a) + 3}
            className="rose-k" textAnchor="middle">{k}</text>
        )
      })}
      {/* the direction the window looks */}
      <path className="rose-facing"
        d={`M60 60 L${60 + 50 * Math.cos(fa - 0.42)} ${60 + 50 * Math.sin(fa - 0.42)}
            A50 50 0 0 1 ${60 + 50 * Math.cos(fa + 0.42)} ${60 + 50 * Math.sin(fa + 0.42)} Z`} />
      {path.length > 1 && (
        <polyline className="rose-path" points={path.map(([x, y]) => `${x},${y}`).join(' ')} />
      )}
      {now.elevation > -1 && (
        <circle className="rose-sun" cx={60 + nowR * Math.cos(nowA)} cy={60 + nowR * Math.sin(nowA)} r="4" />
      )}
    </svg>
  )
}
// localStorage throws, not just returns null, when a browser blocks site data.
const remember = {
  get(k, fallback) { try { return localStorage.getItem(k) ?? fallback } catch { return fallback } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* nothing to do */ } },
}

export default function SunPanel({ onClose }) {
  const [q, setQ] = useState(() => remember.get('audora-addr', ''))
  const [facing, setFacing] = useState(() => Number(remember.get('audora-facing', 180)))
  const [place, setPlace] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Re-resolve a remembered address on open so the panel is useful immediately.
  useEffect(() => {
    const saved = remember.get('audora-addr', '')
    if (saved) find(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const find = async (address) => {
    const a = (address ?? q).trim()
    if (a.length < 3) return setErr('Type a street address or a neighbourhood.')
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(a)}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'could not find that')
      setPlace(d)
      remember.set('audora-addr', a)
    } catch (e) {
      setPlace(null); setErr(String(e.message || e))
    } finally { setBusy(false) }
  }

  const pick = (deg) => { setFacing(deg); remember.set('audora-facing', String(deg)) }

  const report = useMemo(() => {
    if (!place) return null
    const y = new Date().getFullYear()
    const today = directSun(new Date(), place.lat, place.lon, facing)
    const dl = daylight(new Date(), place.lat, place.lon)
    return {
      today, dl,
      todayH: hours(today),
      jun: directSun(solstice(y, 5, 21), place.lat, place.lon, facing),
      dec: directSun(solstice(y, 11, 21), place.lat, place.lon, facing),
    }
  }, [place, facing])

  const name = COMPASS.reduce((a, c) =>
    Math.abs(c.deg - facing) < Math.abs(a.deg - facing) ? c : a, COMPASS[0]).name

  return (
    <aside className="sun-panel">
      <div className="sp-h">
        Sunlight
        <button className="sun-x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="sun-find">
        <input value={q} placeholder="Street address" spellCheck="false"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && find()} />
        <button onClick={() => find()} disabled={busy}>{busy ? '…' : 'Find'}</button>
      </div>
      {err && <p className="sun-err">{err}</p>}
      {place && <p className="sun-place">{place.label}</p>}

      <div className="sp-h">The window faces</div>
      <div className="sun-dirs">
        {COMPASS.map((c) => (
          <button key={c.k} className={'sun-d' + (c.deg === facing ? ' on' : '')}
            onClick={() => pick(c.deg)}>{c.k}</button>
        ))}
      </div>

      {report && (
        <>
          <Rose lat={place.lat} lon={place.lon} facing={facing} date={new Date()} />
          <div className="sun-head">
            {name} facing
            <span>{report.todayH < 0.25
              ? 'no direct sun today'
              : `${report.todayH.toFixed(1)} hours of direct sun today`}</span>
          </div>
          <table className="mp-t"><tbody>
            <tr><td>Today</td><td>{span(report.today) || <i>none</i>}</td></tr>
            <tr><td>Longest day</td><td>{span(report.jun) || <i>none</i>}</td></tr>
            <tr><td>Shortest day</td><td>{span(report.dec) || <i>none</i>}</td></tr>
            {report.dl && (
              <tr><td>Sun up</td><td>{time(report.dl.sunrise)} to {time(report.dl.sunset)}</td></tr>
            )}
          </tbody></table>
          <p className="sp-note">
            Computed from the sun's real position at this address. It does not know
            about the building next door, so treat it as the best case.
          </p>
        </>
      )}
    </aside>
  )
}
