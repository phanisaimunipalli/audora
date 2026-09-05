// Production server for Audora.
// Serves the built Vite app and proxies Marble so the API key stays here and
// never reaches the browser. Zero dependencies on purpose: nothing to install,
// nothing to fail at build time.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const MARBLE = 'https://api.worldlabs.ai/marble/v1'
const KEY = process.env.WORLDLABS_API_KEY || ''
const PORT = process.env.PORT || 10000

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

const readBody = (req) => new Promise((ok, no) => {
  const c = []
  req.on('data', (d) => c.push(d))
  req.on('end', () => ok(Buffer.concat(c).toString('utf8')))
  req.on('error', no)
})

const marbleHeaders = () => ({ 'Content-Type': 'application/json', 'WLT-Api-Key': KEY })

async function api(req, res, url) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  if (!KEY) return send(500, { error: 'WORLDLABS_API_KEY not configured on the server' })
  try {
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const { images, model, text_prompt } = JSON.parse(await readBody(req))
      const list = (images || []).filter(Boolean)
      if (!list.length) return send(400, { error: 'no images supplied' })
      const world_prompt = list.length === 1
        ? { type: 'image', image_prompt: { source: 'data_base64', data_base64: list[0] },
            ...(text_prompt ? { text_prompt } : {}) }
        : { type: 'multi-image',
            multi_image_prompt: list.map((b64) => ({ source: 'data_base64', data_base64: b64 })),
            ...(text_prompt ? { text_prompt } : {}) }
      const r = await fetch(`${MARBLE}/worlds:generate`, {
        method: 'POST', headers: marbleHeaders(),
        body: JSON.stringify({ display_name: 'Audora room', model: model || 'marble-1.0-draft', world_prompt }),
      })
      return send(r.status, await r.json())
    }
    if (url.pathname === '/api/status') {
      const r = await fetch(`${MARBLE}/operations/${url.searchParams.get('id')}`, { headers: marbleHeaders() })
      return send(r.status, await r.json())
    }
    if (url.pathname === '/api/worlds') {
      const r = await fetch(`${MARBLE}/worlds:list`, { method: 'POST', headers: marbleHeaders(), body: '{}' })
      return send(r.status, await r.json())
    }
    if (url.pathname === '/api/credits') {
      const r = await fetch(`${MARBLE}/credits`, { headers: marbleHeaders() })
      return send(r.status, await r.json())
    }
    if (url.pathname === '/api/health') return send(200, { ok: true, keyConfigured: Boolean(KEY) })
    return send(404, { error: 'not found' })
  } catch (e) {
    return send(500, { error: String(e?.message || e) })
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname.startsWith('/api/')) return api(req, res, url)

  // Static, with SPA fallback to index.html.
  let file = path.join(DIST, decodeURIComponent(url.pathname))
  if (!file.startsWith(DIST)) file = path.join(DIST, 'index.html')
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  if (!fs.existsSync(file)) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    return res.end('build missing: run npm run build')
  }
  const ext = path.extname(file)
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  fs.createReadStream(file).pipe(res)
}).listen(PORT, '0.0.0.0', () => console.log(`audora listening on ${PORT}`))
