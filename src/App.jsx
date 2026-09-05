import { useCallback, useEffect, useRef, useState } from 'react'
import WorldView from './WorldView.jsx'
import { DEMO_WORLD } from './world.js'
import { CATALOG, cm } from './data.js'

const DRAFT = 'marble-1.0-draft'
const FULL = 'marble-1.1'
const MAX_PHOTOS = 6

function downscale(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s)
      c.height = Math.round(img.height * s)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.9))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

const preload = (url) => new Promise((resolve) => {
  if (!url) return resolve()
  let done = false
  const fin = () => { if (!done) { done = true; resolve() } }
  const i = new Image()
  i.crossOrigin = 'anonymous'
  i.onload = fin; i.onerror = fin; i.src = url
  setTimeout(fin, 25000)
})

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

const worldFrom = (resp) => {
  const a = resp?.assets || {}
  return {
    worldId: resp.world_id,
    marbleUrl: resp.world_marble_url,
    pano: a.imagery?.pano_url,
    collider: a.mesh?.collider_mesh_url,
    caption: a.caption,
    thumbnail: a.thumbnail_url,
    model: resp.model,
    metricScaleFactor: a.splats?.semantics_metadata?.metric_scale_factor ?? 1,
    groundPlaneOffset: a.splats?.semantics_metadata?.ground_plane_offset ?? 1.3,
  }
}

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
  const [photos, setPhotos] = useState([])          // dataURLs
  const [srcB64, setSrcB64] = useState([])          // base64 payloads, reused for Full
  const [elapsed, setElapsed] = useState(0)
  const [status, setStatus] = useState('')
  const [world, setWorld] = useState(null)
  const [cost, setCost] = useState(null)
  const [error, setError] = useState(null)
  const [showMesh, setShowMesh] = useState(false)
  const [credits, setCredits] = useState(null)
  const [history, setHistory] = useState([])
  // staging
  const [staging, setStaging] = useState(false)
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [floorY, setFloorY] = useState(-1.3)
  const timer = useRef(null)

  const refreshCredits = () => fetch('/api/credits').then(r => r.json())
    .then(d => setCredits(d.remaining_credits)).catch(() => {})
  const refreshHistory = () => fetch('/api/worlds').then(r => r.json())
    .then(d => setHistory((d.worlds || []).filter(w => w?.assets?.imagery?.pano_url))).catch(() => {})

  useEffect(() => { refreshCredits(); refreshHistory() }, [])
  useEffect(() => () => clearInterval(timer.current), [])
  useEffect(() => { if (world) setFloorY(-(world.groundPlaneOffset || 1.3)) }, [world])

  const addPhotos = async (files) => {
    setError(null)
    const room = MAX_PHOTOS - photos.length
    const picked = Array.from(files).slice(0, Math.max(0, room))
    const urls = await Promise.all(picked.map(f => downscale(f)))
    setPhotos(p => [...p, ...urls])
  }

  const generate = useCallback(async (model, list) => {
    const started = Date.now()
    clearInterval(timer.current)
    setElapsed(0)
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
        clearInterval(timer.current)
        return { world: worldFrom(op.response), cost: op.cost?.total_credits ?? null }
      }
    }
  }, [])

  const run = useCallback(async () => {
    if (!photos.length) return
    setPhase('working'); setTier('draft'); setError(null); setStatus('Preparing photos')
    const list = photos.map(p => p.split(',')[1])
    setSrcB64(list)
    try {
      const { world: w, cost: c } = await generate(DRAFT, list)
      setStatus('Loading render'); await preload(w.pano)
      clearInterval(timer.current)
      setWorld(w); setCost(c); setPhase('done'); refreshCredits(); refreshHistory()
    } catch (e) {
      clearInterval(timer.current); setError(String(e.message || e)); setPhase('error')
    }
  }, [photos, generate])

  const goFull = useCallback(async () => {
    if (!srcB64.length) return
    setUpgrading(true); setError(null)
    try {
      const { world: w, cost: c } = await generate(FULL, srcB64)
      setStatus('Loading render'); await preload(w.pano)
      clearInterval(timer.current)
      setWorld(w); setCost(c); setTier('full'); refreshCredits(); refreshHistory()
    } catch (e) {
      clearInterval(timer.current); setError(String(e.message || e))
    } finally { setUpgrading(false) }
  }, [srcB64, generate])

  const pick = async (w) => {
    const mapped = worldFrom(w)
    setSwitching(true); await preload(mapped.pano)
    setWorld(mapped); setTier(w.model === 'marble-1.1' ? 'full' : 'draft')
    setCost(null); setElapsed(0); setError(null); setPhase('done'); setSwitching(false)
  }

  const reset = () => {
    clearInterval(timer.current)
    setPhase('idle'); setTier(null); setWorld(null); setPhotos([]); setSrcB64([])
    setError(null); setElapsed(0); setCost(null); setUpgrading(false)
    setItems([]); setSelected(null); setStaging(false)
  }

  const addItem = (c) => {
    const it = { ...c, uid: ++seq, rot: 0, x: (Math.random() - 0.5) * 1.2, z: -1.9 }
    setItems(s => [...s, it]); setSelected(it.uid)
  }
  const moveItem = (uid, x, z) => setItems(s => s.map(i => i.uid === uid ? { ...i, x, z } : i))
  const rotate = (uid) => setItems(s => s.map(i => i.uid === uid ? { ...i, rot: ((i.rot || 0) + 1) % 4 } : i))
  const removeItem = (uid) => { setItems(s => s.filter(i => i.uid !== uid)); setSelected(null) }
  const sel = items.find(i => i.uid === selected) || null

  if (phase === 'done' && world) {
    return (
      <div className="viewer">
        <WorldView
          world={world} showMesh={showMesh} metric
          items={items} floorY={floorY} selected={selected}
          onSelect={setSelected} onMove={moveItem} staging={staging}
        />
        <div className="topbar">
          <span className="brand">AUDORA</span>
          <span className="meta">
            {tier === 'full' ? 'Full quality' : 'Draft'}
            {!upgrading && elapsed > 0 && <> · {mmss(elapsed)}</>}
            {cost != null && <> · {cost} cr</>}
            {world.metricScaleFactor != null && <> · scale ×{Number(world.metricScaleFactor).toFixed(3)}</>}
          </span>
          <div className="right">
            <button className={staging ? 'on' : ''} onClick={() => setStaging(v => !v)}>Furniture</button>
            <button className={showMesh ? 'on' : ''} onClick={() => setShowMesh(v => !v)}>Geometry</button>
            {world.marbleUrl && <a href={world.marbleUrl} target="_blank" rel="noreferrer">Marble ↗</a>}
            <button onClick={reset}>New room</button>
          </div>
        </div>

        {staging && (
          <aside className="stage-panel">
            <div className="sp-h">Add furniture</div>
            <div className="sp-list">
              {CATALOG.map(c => (
                <button key={c.id} className="sp-item" onClick={() => addItem(c)}>
                  <span className="sw" style={{ background: c.color }} />
                  <span className="nm">{c.name}</span>
                  <span className="dm">{cm(c.w)}×{cm(c.d)}</span>
                </button>
              ))}
            </div>
            <div className="sp-h">Floor height</div>
            <input className="slider" type="range" min="-3" max="-0.4" step="0.01"
              value={floorY} onChange={e => setFloorY(Number(e.target.value))} />
            <div className="sp-note">{Math.abs(floorY).toFixed(2)}m below camera. Nudge until pieces sit on the real floor.</div>
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
            {!items.length && <div className="sp-note">Tap a piece to drop it in, then drag it along the floor.</div>}
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
            <div className="decide-s tiny">Keep looking around. The draft stays up until full is ready.</div>
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
            <div className="pgrid">
              {photos.map((p, i) => <img key={i} className="pthumb" src={p} alt="" />)}
            </div>
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
                {photos.length
                  ? `${photos.length} of ${MAX_PHOTOS} · more angles, better geometry`
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

            <button className="ghost" onClick={() => {
              setWorld(DEMO_WORLD); setCost(1580); setElapsed(658); setTier('full'); setPhase('done')
            }}>Skip the wait, open a world we already made →</button>
            {credits != null && <p className="tiny">{credits.toLocaleString()} credits remaining</p>}
            <Strip items={history} activeId={null} onPick={pick} />
          </>
        )}
      </div>
    </div>
  )
}
