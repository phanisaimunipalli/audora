import { useCallback, useEffect, useRef, useState } from 'react'
import WorldView from './WorldView.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { DEMO_WORLD } from './world.js'
import { SETS, SINGLES, byId, cm } from './data.js'

const DRAFT = 'marble-1.0-draft'
const FULL = 'marble-1.1'
const MAX_PHOTOS = 6

function downscale(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.9))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

const preload = (url) => new Promise((resolve) => {
  if (!url) return resolve(false)
  let done = false
  const fin = (ok) => { if (!done) { done = true; resolve(ok) } }
  const i = new Image()
  i.crossOrigin = 'anonymous'
  i.onload = () => fin(true); i.onerror = () => fin(false); i.src = url
  setTimeout(() => fin(false), 25000)
})

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

const worldFrom = (resp) => {
  const a = resp?.assets || {}
  const sm = a.splats?.semantics_metadata || {}
  return {
    worldId: resp?.world_id,
    marbleUrl: resp?.world_marble_url,
    pano: a.imagery?.pano_url,
    collider: a.mesh?.collider_mesh_url,
    thumbnail: a.thumbnail_url,
    caption: a.caption,
    model: resp?.model,
    spz: a.splats?.spz_urls || null,
    metricScaleFactor: sm.metric_scale_factor ?? null,
    groundPlaneOffset: sm.ground_plane_offset ?? null,
  }
}

const hasPano = (w) => Boolean(w?.assets?.imagery?.pano_url)

function Strip({ items, activeId, onPick }) {
  if (!items.length) return null
  return (
    <div className="strip">
      <div className="strip-l">{items.length} generated</div>
      <div className="strip-scroll">
        {items.map((w) => (
          <button key={w.world_id}
            className={'tile' + (w.world_id === activeId ? ' on' : '')}
            onClick={() => onPick(w)} title={`${w.model} · ${w.created_at}`}>
            <img src={w.assets.thumbnail_url} alt="" loading="lazy" />
            <span className="tile-b">{w.model === 'marble-1.1' ? 'Full' : 'Draft'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

let seq = 0

export default function App() {
  const [phase, setPhase] = useState('idle')
  const [tier, setTier] = useState(null)
  const [upgrading, setUpgrading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [photos, setPhotos] = useState([])
  const [srcB64, setSrcB64] = useState([])
  const [elapsed, setElapsed] = useState(0)
  const [status, setStatus] = useState('')
  const [world, setWorld] = useState(null)
  const [cost, setCost] = useState(null)
  const [genSecs, setGenSecs] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [showMesh, setShowMesh] = useState(false)
  const [showMetrics, setShowMetrics] = useState(true)
  const [panoDims, setPanoDims] = useState(null)
  const [credits, setCredits] = useState(null)
  const [history, setHistory] = useState([])
  const [staging, setStaging] = useState(false)
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [floorY, setFloorY] = useState(-1.3)
  const timer = useRef(null)
  const lastGood = useRef(null)

  const refreshCredits = () => fetch('/api/credits').then(r => r.json())
    .then(d => setCredits(d.remaining_credits)).catch(() => {})
  const loadHistory = () => fetch('/api/worlds').then(r => r.json())
    .then(d => { const ws = (d.worlds || []).filter(hasPano); setHistory(ws); return ws })
    .catch(() => [])

  useEffect(() => { refreshCredits(); loadHistory() }, [])
  useEffect(() => () => clearInterval(timer.current), [])
  useEffect(() => { if (world) { setFloorY(-(world.groundPlaneOffset || 1.3)); setPanoDims(null) } }, [world])

  const openWorld = useCallback(async (w, t) => {
    await preload(w.pano)
    lastGood.current = w
    setWorld(w); setTier(t); setPhase('done')
  }, [])

  const generate = useCallback(async (model, list) => {
    const started = Date.now()
    clearInterval(timer.current); setElapsed(0)
    timer.current = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    setStatus(list.length > 1 ? `Sending ${list.length} angles to Marble` : 'Sending to Marble')
    const gen = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: list, model }),
    }).then(r => r.json())
    if (!gen.operation_id) throw new Error(gen.detail ? JSON.stringify(gen.detail) : (gen.error || gen.message || 'generate failed'))
    setStatus('Generating geometry')
    for (;;) {
      await new Promise(r => setTimeout(r, 5000))
      const op = await fetch(`/api/status?id=${gen.operation_id}`).then(r => r.json())
      if (op?.metadata?.progress?.description) setStatus(op.metadata.progress.description)
      if (op.error) throw new Error(JSON.stringify(op.error))
      if (op.done) {
        let w = worldFrom(op.response)
        const wid = w.worldId || op?.metadata?.world_id
        // Drafts finish before the panorama is attached; it lands on the world
        // record a few seconds later.
        if (!w.pano && wid) {
          setStatus('Finishing the panorama')
          for (let i = 0; i < 24 && !w.pano; i++) {
            await new Promise(r => setTimeout(r, 2500))
            try {
              const rec = await fetch(`/api/world?id=${wid}`).then(r => r.json())
              if (rec?.assets?.imagery?.pano_url) w = worldFrom(rec)
            } catch { /* keep waiting */ }
          }
        }
        clearInterval(timer.current)
        const secs = Math.round((Date.now() - started) / 1000)
        return { world: w, cost: op.cost?.total_credits ?? null, secs }
      }
    }
  }, [])

  // If a generation somehow yields no panorama, fall back to the newest world
  // that has one rather than dropping the viewer onto a black canvas.
  const recover = useCallback(async (why) => {
    const ws = await loadHistory()
    const best = ws[0]
    if (best) {
      setNotice(why)
      await openWorld(worldFrom(best), best.model === FULL ? 'full' : 'draft')
      return true
    }
    return false
  }, [openWorld])

  const run = useCallback(async () => {
    if (!photos.length) return
    setPhase('working'); setTier('draft'); setError(null); setNotice(null); setStatus('Preparing photos')
    const list = photos.map(p => p.split(',')[1])
    setSrcB64(list)
    try {
      const { world: w, cost: c, secs } = await generate(DRAFT, list)
      setCost(c); setGenSecs(secs)
      if (!w.pano) {
        const ok = await recover('That render finished without a panorama. Showing your most recent room instead.')
        if (!ok) throw new Error('the world generated but no panorama was returned')
      } else {
        setStatus('Loading render')
        await openWorld(w, 'draft')
      }
      refreshCredits(); loadHistory()
    } catch (e) {
      clearInterval(timer.current); setError(String(e.message || e)); setPhase('error')
    }
  }, [photos, generate, openWorld, recover])

  const goFull = useCallback(async () => {
    if (!srcB64.length) return
    setUpgrading(true); setError(null)
    try {
      const { world: w, cost: c, secs } = await generate(FULL, srcB64)
      setCost(c); setGenSecs(secs)
      if (w.pano) { setStatus('Loading render'); await openWorld(w, 'full') }
      else await recover('Full quality finished without a panorama. Keeping the draft.')
      refreshCredits(); loadHistory()
    } catch (e) {
      clearInterval(timer.current); setError(String(e.message || e))
    } finally { setUpgrading(false) }
  }, [srcB64, generate, openWorld, recover])

  const pick = async (w) => {
    setSwitching(true); setNotice(null)
    await openWorld(worldFrom(w), w.model === FULL ? 'full' : 'draft')
    setCost(null); setGenSecs(null); setError(null); setSwitching(false)
  }

  const goHome = () => {
    clearInterval(timer.current)
    setPhase('idle'); setTier(null); setWorld(null); setPhotos([]); setSrcB64([])
    setError(null); setNotice(null); setElapsed(0); setCost(null); setGenSecs(null)
    setUpgrading(false); setItems([]); setSelected(null); setStaging(false)
  }

  const addPhotos = async (files) => {
    setError(null)
    const picked = Array.from(files).slice(0, Math.max(0, MAX_PHOTOS - photos.length))
    const urls = await Promise.all(picked.map(f => downscale(f)))
    setPhotos(p => [...p, ...urls])
  }

  const addPiece = (id, at) => {
    const c = byId(id); if (!c) return
    const it = { ...c, uid: ++seq, rot: at?.rot ?? 0, x: at?.x ?? (Math.random() - 0.5) * 1.2, z: at?.z ?? -1.9 }
    setItems(s => [...s, it]); setSelected(it.uid); return it
  }
  const applySet = (set) => {
    setItems([])
    const made = set.pieces.map(p => { const c = byId(p.id); return c && { ...c, uid: ++seq, rot: p.rot, x: p.x, z: p.z } }).filter(Boolean)
    setItems(made); setSelected(made[0]?.uid ?? null)
  }
  const moveItem = (uid, x, z) => setItems(s => s.map(i => i.uid === uid ? { ...i, x, z } : i))
  const rotate = (uid) => setItems(s => s.map(i => i.uid === uid ? { ...i, rot: ((i.rot || 0) + 1) % 4 } : i))
  const removeItem = (uid) => { setItems(s => s.filter(i => i.uid !== uid)); setSelected(null) }
  const sel = items.find(i => i.uid === selected) || null
  const footprint = items.reduce((n, i) => n + (i.id === 'rug' ? 0 : i.w * i.d), 0)

  if (phase === 'done' && world) {
    return (
      <div className="viewer">
        <ErrorBoundary
          onRecover={() => recover('Recovered after a display error.')}
          onHome={goHome}
        >
          <WorldView
            world={world} showMesh={showMesh} metric
            items={items} floorY={floorY} selected={selected}
            onSelect={setSelected} onMove={moveItem} staging={staging}
            onMeasured={setPanoDims}
          />
        </ErrorBoundary>

        <div className="topbar">
          <span className="brand">AUDORA</span>
          <span className="meta">
            {tier === 'full' ? 'Full quality' : 'Draft'}
            {genSecs != null && <> · {mmss(genSecs)}</>}
            {cost != null && <> · {cost} cr</>}
          </span>
          <div className="right">
            <button className={staging ? 'on' : ''} onClick={() => setStaging(v => !v)}>Furniture</button>
            <button className={showMetrics ? 'on' : ''} onClick={() => setShowMetrics(v => !v)}>Measurements</button>
            <button className={showMesh ? 'on' : ''} onClick={() => setShowMesh(v => !v)}>Geometry</button>
            <button onClick={goHome}>Home</button>
          </div>
        </div>

        {notice && <div className="notice">{notice}<button onClick={() => setNotice(null)}>×</button></div>}

        {showMetrics && (
          <aside className="metrics-panel">
            <div className="mp-h">What the model measured</div>
            <table className="mp-t"><tbody>
              <tr><td>Model</td><td>{world.model || (tier === 'full' ? FULL : DRAFT)}</td></tr>
              <tr><td>Metric scale</td><td>{world.metricScaleFactor
                ? <b>×{Number(world.metricScaleFactor).toFixed(4)}</b>
                : <i>not reported</i>}</td></tr>
              <tr><td>Ground plane</td><td>{world.groundPlaneOffset
                ? `${Number(world.groundPlaneOffset).toFixed(3)} m` : <i>not reported</i>}</td></tr>
              <tr><td>Panorama</td><td>{panoDims ? `${panoDims.w}×${panoDims.h}` : 'measuring…'}</td></tr>
              <tr><td>Splat LODs</td><td>{world.spz ? Object.keys(world.spz).join(' · ') : '—'}</td></tr>
              <tr><td>Collider</td><td>{world.collider ? 'mesh returned' : '—'}</td></tr>
              <tr><td>Eye height</td><td>1.600 m</td></tr>
              <tr><td>Floor set to</td><td><b>{Math.abs(floorY).toFixed(3)} m</b></td></tr>
            </tbody></table>
            {items.length > 0 && (
              <>
                <div className="mp-h">Placed</div>
                <table className="mp-t"><tbody>
                  <tr><td>Pieces</td><td>{items.length}</td></tr>
                  <tr><td>Footprint</td><td><b>{footprint.toFixed(2)} m²</b></td></tr>
                  {sel && <tr><td>Selected</td><td>{cm(sel.w)}×{cm(sel.d)}×{cm(sel.h)} cm</td></tr>}
                </tbody></table>
              </>
            )}
            <p className="mp-n">
              {world.metricScaleFactor
                ? 'Scale reported by the model. Verify it against a known reference before trusting a fit.'
                : 'Draft renders return no metric scale. The floor is set by hand, so treat fit as indicative.'}
            </p>
          </aside>
        )}

        {staging && (
          <aside className="stage-panel">
            <div className="sp-h">Stage a room</div>
            <div className="sp-sets">
              {SETS.map(s => (
                <button key={s.id} className="sp-set" onClick={() => applySet(s)}>
                  {s.name}<span>{s.pieces.length} pieces</span>
                </button>
              ))}
            </div>
            <div className="sp-h">Or add one</div>
            <div className="sp-singles">
              {SINGLES.map(id => {
                const c = byId(id); if (!c) return null
                return (
                  <button key={id} className="sp-one" onClick={() => addPiece(id)}>
                    <span className="sw" style={{ background: c.color }} />
                    {c.name}<span className="dm">{cm(c.w)}×{cm(c.d)}</span>
                  </button>
                )
              })}
            </div>
            <div className="sp-h">Floor height</div>
            <input className="slider" type="range" min="-3" max="-0.4" step="0.01"
              value={floorY} onChange={e => setFloorY(Number(e.target.value))} />
            <div className="sp-note">{Math.abs(floorY).toFixed(2)} m below camera. Nudge until pieces sit on the real floor.</div>
            {sel && (
              <div className="sp-sel">
                <div className="sp-sn">{sel.name}</div>
                <div className="sp-sd">{cm(sel.w)} × {cm(sel.d)} × {cm(sel.h)} cm</div>
                <div className="sp-acts">
                  <button onClick={() => rotate(sel.uid)}>Rotate</button>
                  <button onClick={() => removeItem(sel.uid)}>Remove</button>
                </div>
              </div>
            )}
            {items.length > 0 && (
              <button className="sp-clear" onClick={() => { setItems([]); setSelected(null) }}>Clear the room</button>
            )}
          </aside>
        )}

        {tier === 'draft' && srcB64.length > 0 && !upgrading && (
          <div className={'decide' + (history.length ? ' lifted' : '')}>
            <div className="decide-t">Happy with this draft?</div>
            <div className="decide-s">Full quality re-renders the same {srcB64.length > 1 ? `${srcB64.length} photos` : 'photo'}. 1500 credits, up to ~11 min.</div>
            <button className="go" onClick={goFull}>Continue to full quality →</button>
          </div>
        )}
        {upgrading && (
          <div className={'decide working' + (history.length ? ' lifted' : '')}>
            <div className="clock sm">{mmss(elapsed)}</div>
            <div className="decide-s">{status}…</div>
            <div className="bar"><i /></div>
          </div>
        )}
        {error && <div className="err floating">{error}</div>}
        {switching && <div className="switching">Loading render…</div>}
        <Strip items={history} activeId={world.worldId} onPick={pick} />
      </div>
    )
  }

  return (
    <div className="up">
      <div className="up-inner">
        <div className="brand big">AUDORA</div>
        <h1>Live it before buying or selling.</h1>
        <p className="sub">Upload photos of a room and get back a real 3D world you can walk through and stage with furniture at true dimensions.</p>

        {phase === 'working' ? (
          <div className="progress">
            <div className="pgrid">{photos.map((p, i) => <img key={i} className="pthumb" src={p} alt="" />)}</div>
            <div className="clock">{mmss(elapsed)}</div>
            <div className="stat-line">{status}…</div>
            <div className="bar"><i /></div>
            <p className="tiny">Draft pass. Full quality only runs if you ask for it.</p>
          </div>
        ) : (
          <>
            {photos.length > 0 && (
              <div className="pgrid picked">
                {photos.map((p, i) => (
                  <div key={i} className="pcell">
                    <img src={p} alt="" />
                    <button className="px" onClick={() => setPhotos(s => s.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
              </div>
            )}
            <label className={'drop' + (photos.length ? ' small' : '')}>
              <input type="file" accept="image/*" multiple
                onChange={e => { addPhotos(e.target.files); e.target.value = '' }} />
              <span className="drop-i">＋</span>
              <span className="drop-t">{photos.length ? 'Add another angle' : 'Choose photos'}</span>
              <span className="drop-s">
                {photos.length ? `${photos.length} of ${MAX_PHOTOS} · more angles, better geometry`
                               : 'One works. Several from different angles works better.'}
              </span>
            </label>
            {photos.length > 0 && (
              <button className="go wide" onClick={run}>
                Generate draft from {photos.length} {photos.length === 1 ? 'photo' : 'photos'} →
              </button>
            )}
            <p className="tiny">Draft first, always. You decide whether it goes to full quality.</p>
            {error && <div className="err">{error}</div>}
            {notice && <div className="err notice-inline">{notice}</div>}
            <button className="ghost" onClick={() => openWorld(DEMO_WORLD, 'full')}>
              Skip the wait, open a world we already made →
            </button>
            {credits != null && <p className="tiny">{credits.toLocaleString()} credits remaining</p>}
            <Strip items={history} activeId={null} onPick={pick} />
          </>
        )}
      </div>
    </div>
  )
}
