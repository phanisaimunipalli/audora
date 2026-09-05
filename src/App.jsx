import { useCallback, useEffect, useRef, useState } from 'react'
import WorldView from './WorldView.jsx'
import { DEMO_WORLD } from './world.js'

const DRAFT = 'marble-1.0-draft'
const FULL = 'marble-1.1'

// Phone photos are huge. Downscale before base64 so the payload stays sane.
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

// Pull the pano into the browser cache before switching views, so the world
// is on screen the instant the viewer mounts instead of fading in from black.
const preload = (url) => new Promise((resolve) => {
  if (!url) return resolve()
  let settled = false
  const done = () => { if (!settled) { settled = true; resolve() } }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = done
  img.onerror = done
  img.src = url
  setTimeout(done, 25000)
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
    createdAt: resp.created_at,
    metricScaleFactor: a.splats?.semantics_metadata?.metric_scale_factor ?? 1,
    groundPlaneOffset: a.splats?.semantics_metadata?.ground_plane_offset ?? 0,
  }
}

function Strip({ items, activeId, onPick }) {
  if (!items.length) return null
  return (
    <div className="strip">
      <div className="strip-l">{items.length} generated</div>
      <div className="strip-scroll">
        {items.map((w) => (
          <button
            key={w.world_id}
            className={'tile' + (w.world_id === activeId ? ' on' : '')}
            onClick={() => onPick(w)}
            title={`${w.model} · ${w.created_at}`}
          >
            <img src={w.assets.thumbnail_url} alt="" loading="lazy" />
            <span className="tile-b">{w.model === 'marble-1.1' ? 'Full' : 'Draft'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [phase, setPhase] = useState('idle')     // idle | working | done | error
  const [tier, setTier] = useState(null)         // 'draft' | 'full'
  const [upgrading, setUpgrading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [srcB64, setSrcB64] = useState(null)     // kept so Full can reuse the same photo
  const [elapsed, setElapsed] = useState(0)
  const [status, setStatus] = useState('')
  const [world, setWorld] = useState(null)
  const [cost, setCost] = useState(null)
  const [error, setError] = useState(null)
  const [showMesh, setShowMesh] = useState(false)
  const [credits, setCredits] = useState(null)
  const [history, setHistory] = useState([])
  const [switching, setSwitching] = useState(false)
  const timer = useRef(null)

  const refreshCredits = () =>
    fetch('/api/credits').then((r) => r.json())
      .then((d) => setCredits(d.remaining_credits)).catch(() => {})

  const refreshHistory = () =>
    fetch('/api/worlds').then((r) => r.json())
      .then((d) => setHistory((d.worlds || []).filter((w) => w?.assets?.imagery?.pano_url)))
      .catch(() => {})

  useEffect(() => { refreshCredits(); refreshHistory() }, [])
  useEffect(() => () => clearInterval(timer.current), [])

  // Shared generate + poll. Used for both the draft pass and the full upgrade.
  const generate = useCallback(async (model, b64) => {
    const started = Date.now()
    clearInterval(timer.current)
    setElapsed(0)
    timer.current = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    setStatus('Sending to Marble')
    const gen = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: b64, model }),
    }).then((r) => r.json())
    if (!gen.operation_id) {
      throw new Error(gen.detail ? JSON.stringify(gen.detail) : (gen.error || 'generate failed'))
    }
    setStatus('Generating geometry')
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000))
      const op = await fetch(`/api/status?id=${gen.operation_id}`).then((r) => r.json())
      if (op?.metadata?.progress?.description) setStatus(op.metadata.progress.description)
      if (op.error) throw new Error(JSON.stringify(op.error))
      if (op.done) {
        clearInterval(timer.current)
        return { world: worldFrom(op.response), cost: op.cost?.total_credits ?? null }
      }
    }
  }, [])

  // Stage 1 — always draft.
  const onFile = useCallback(async (file) => {
    setPhase('working'); setTier('draft'); setError(null); setStatus('Preparing photo')
    try {
      const dataUrl = await downscale(file)
      setPreview(dataUrl)
      const b64 = dataUrl.split(',')[1]
      setSrcB64(b64)
      const { world: w, cost: c } = await generate(DRAFT, b64)
      setStatus('Loading render')
      await preload(w.pano)
      clearInterval(timer.current)
      setWorld(w); setCost(c); setPhase('done'); refreshCredits(); refreshHistory()
    } catch (e) {
      clearInterval(timer.current)
      setError(String(e.message || e)); setPhase('error')
    }
  }, [generate])

  // Stage 2 — only on your say so.
  const goFull = useCallback(async () => {
    if (!srcB64) return
    setUpgrading(true); setError(null)
    try {
      const { world: w, cost: c } = await generate(FULL, srcB64)
      setStatus('Loading render')
      await preload(w.pano)
      clearInterval(timer.current)
      setWorld(w); setCost(c); setTier('full'); refreshCredits(); refreshHistory()
    } catch (e) {
      clearInterval(timer.current)
      setError(String(e.message || e))
    } finally {
      setUpgrading(false)
    }
  }, [srcB64, generate])

  const pick = async (w) => {
    const mapped = worldFrom(w)
    setSwitching(true)
    await preload(mapped.pano)
    setWorld(mapped)
    setTier(w.model === 'marble-1.1' ? 'full' : 'draft')
    setCost(null); setElapsed(0); setError(null); setPhase('done'); setSwitching(false)
  }

  const reset = () => {
    clearInterval(timer.current)
    setPhase('idle'); setTier(null); setWorld(null); setPreview(null); setSrcB64(null)
    setError(null); setElapsed(0); setCost(null); setUpgrading(false)
  }

  if (phase === 'done' && world) {
    return (
      <div className="viewer">
        <WorldView world={world} showMesh={showMesh} metric />
        <div className="topbar">
          <span className="brand">AUDORA</span>
          <span className="meta">
            {tier === 'full' ? 'Full quality' : 'Draft'}
            {!upgrading && <> · {mmss(elapsed)}</>}
            {cost != null && <> · {cost} cr</>}
            {world.metricScaleFactor != null && <> · scale ×{Number(world.metricScaleFactor).toFixed(3)}</>}
          </span>
          <div className="right">
            <button className={showMesh ? 'on' : ''} onClick={() => setShowMesh((v) => !v)}>Geometry</button>
            {world.marbleUrl && <a href={world.marbleUrl} target="_blank" rel="noreferrer">Marble ↗</a>}
            <button onClick={reset}>New room</button>
          </div>
        </div>

        {tier === 'draft' && srcB64 && !upgrading && (
          <div className={"decide" + (history.length ? " lifted" : "")}>
            <div className="decide-t">Happy with this draft?</div>
            <div className="decide-s">Full quality re-renders the same photo. 1500 credits, up to ~11 min.</div>
            <button className="go" onClick={goFull}>Continue to full quality →</button>
          </div>
        )}

        {upgrading && (
          <div className={"decide working" + (history.length ? " lifted" : "")}>
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
        <h1>Upload a photo of your room.</h1>
        <p className="sub">Get back a real 3D world you can look around.</p>

        {phase === 'working' ? (
          <div className="progress">
            {preview && <img className="thumb" src={preview} alt="" />}
            <div className="clock">{mmss(elapsed)}</div>
            <div className="stat-line">{status}…</div>
            <div className="bar"><i /></div>
            <p className="tiny">Draft pass. Full quality only runs if you ask for it.</p>
          </div>
        ) : (
          <>
            <label className="drop">
              <input type="file" accept="image/*"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <span className="drop-i">＋</span>
              <span className="drop-t">Choose a photo</span>
              <span className="drop-s">One photo is enough</span>
            </label>
            <p className="tiny">Draft first, always. You decide whether it goes to full quality.</p>

            {error && <div className="err">{error}</div>}

            <button className="ghost" onClick={() => {
              setWorld(DEMO_WORLD); setCost(1580); setElapsed(658); setTier('full'); setPhase('done')
            }}>
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
