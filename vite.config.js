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
        if (!key) return send(500, { error: 'WORLDLABS_API_KEY missing from .env.local' })
        try {
          if (req.url.startsWith('/api/generate') && req.method === 'POST') {
            const { image_base64, model, text_prompt } = JSON.parse(await readBody(req))
            const r = await fetch(`${MARBLE}/worlds:generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'WLT-Api-Key': key },
              body: JSON.stringify({
                display_name: 'Audora room',
                model: model || 'marble-1.0-draft',
                world_prompt: {
                  type: 'image',
                  image_prompt: { source: 'data_base64', data_base64: image_base64 },
                  ...(text_prompt ? { text_prompt } : {}),
                },
              }),
            })
            return send(r.status, await r.json())
          }
          if (req.url.startsWith('/api/status')) {
            const id = new URL(req.url, 'http://x').searchParams.get('id')
            const r = await fetch(`${MARBLE}/operations/${id}`, { headers: { 'WLT-Api-Key': key } })
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
