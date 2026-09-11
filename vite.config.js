import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'

const MARBLE = 'https://api.worldlabs.ai/marble/v1'

function readKey() {
  if (process.env.WORLDLABS_API_KEY) return process.env.WORLDLABS_API_KEY
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/WORLDLABS_API_KEY=(.+)/)
    return m ? m[1].trim() : ''
  } catch { return '' }
}

const geoCache = new Map()
let lastGeocode = 0

const readBody = (req) => new Promise((ok, no) => {
  const c = []
  req.on('data', (d) => c.push(d))
  req.on('end', () => ok(Buffer.concat(c).toString('utf8')))
  req.on('error', no)
})

// Dev-only proxy. The API key never reaches the browser.
// Maps 1:1 onto Vercel serverless functions for deploy.
function marbleDevApi() {
  return {
    name: 'marble-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        const key = readKey()
        const send = (code, obj) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(obj))
        }
        // Views. Same shape as production, so the UI needs no dev special case.
        if (req.url.startsWith('/api/views')) {
          const dir = process.env.DATA_DIR || '.data'
          const f = `${dir}/views.json`
          let n = 0
          try { n = JSON.parse(fs.readFileSync(f, 'utf8')).views || 0 } catch { n = 0 }
          if (req.method === 'POST') {
            n += 1
            try {
              fs.mkdirSync(dir, { recursive: true })
              fs.writeFileSync(f, JSON.stringify({ views: n }))
            } catch { /* dev only, a failed write is not worth breaking on */ }
          }
          return send(200, { views: n })
        }
  // Address to coordinates. OpenStreetMap's Nominatim: no key, but their policy
  // requires an identifying User-Agent and at most one call a second, so it is
  // proxied here and cached rather than called from the browser.
  if (req.url.startsWith('/api/geocode')) {
    const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim()
    if (q.length < 3) return send(400, { error: 'address too short' })
    const hit = geoCache.get(q.toLowerCase())
    if (hit) return send(200, { ...hit, cached: true })
    const now = Date.now()
    if (now - lastGeocode < 1100) await new Promise(r => setTimeout(r, 1100 - (now - lastGeocode)))
    lastGeocode = Date.now()
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`
    const r = await fetch(u, { headers: { 'User-Agent': 'Audora/1.0 (https://audora-workflow.onrender.com)' } })
    if (!r.ok) return send(r.status, { error: 'geocoder unavailable' })
    const j = await r.json()
    if (!j.length) return send(404, { error: 'no match for that address' })
    const out = { lat: Number(j[0].lat), lon: Number(j[0].lon), label: j[0].display_name }
    geoCache.set(q.toLowerCase(), out)
    return send(200, out)
  }
        if (!key) return send(500, { error: 'WORLDLABS_API_KEY missing from .env.local' })
        try {
          if (req.url.startsWith('/api/generate') && req.method === 'POST') {
            const { images, model, text_prompt } = JSON.parse(await readBody(req))
            const list = (images || []).filter(Boolean)
            if (!list.length) return send(400, { error: 'no images supplied' })
            // One photo uses `image`; several use `multi-image` so Marble gets
            // more angles to reconstruct from.
            const world_prompt = list.length === 1
              ? {
                  type: 'image',
                  image_prompt: { source: 'data_base64', data_base64: list[0] },
                  ...(text_prompt ? { text_prompt } : {}),
                }
              : {
                  type: 'multi-image',
                  multi_image_prompt: list.map((b64) => ({ source: 'data_base64', data_base64: b64 })),
                  ...(text_prompt ? { text_prompt } : {}),
                }
            const r = await fetch(`${MARBLE}/worlds:generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'WLT-Api-Key': key },
              body: JSON.stringify({
                display_name: 'Audora room',
                model: model || 'marble-1.0-draft',
                world_prompt,
              }),
            })
            return send(r.status, await r.json())
          }
          if (req.url.startsWith('/api/status')) {
            const id = new URL(req.url, 'http://x').searchParams.get('id')
            const r = await fetch(`${MARBLE}/operations/${id}`, { headers: { 'WLT-Api-Key': key } })
            return send(r.status, await r.json())
          }
          if (req.url.startsWith('/api/world?') || req.url.startsWith('/api/world&')) {
            const id = new URL(req.url, 'http://x').searchParams.get('id')
            const r = await fetch(`${MARBLE}/worlds/${id}`, { headers: { 'WLT-Api-Key': key } })
            return send(r.status, await r.json())
          }
          if (req.url.startsWith('/api/worlds')) {
            const r = await fetch(`${MARBLE}/worlds:list`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'WLT-Api-Key': key },
              body: '{}',
            })
            return send(r.status, await r.json())
          }
          if (req.url.startsWith('/api/credits')) {
            const r = await fetch(`${MARBLE}/credits`, { headers: { 'WLT-Api-Key': key } })
            return send(r.status, await r.json())
          }
          return next()
        } catch (e) {
          return send(500, { error: String(e?.message || e) })
        }
      })
    },
  }
}

export default defineConfig({ plugins: [react(), marbleDevApi()] })
