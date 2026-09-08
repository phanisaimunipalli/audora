/**
 * Audora production server. Serves the built app from dist/ and mounts the same /api/* handler the
 * Vite dev server uses, with nothing but Node at runtime.
 *
 *   npm run build   → dist/ (vite) and dist-server/ (this file, compiled by tsc -p tsconfig.server.json)
 *   npm start       → node dist-server/prod.js
 *
 * PORT and HOST come from the environment (Render sets PORT). Keys come from process.env, which wins
 * over a local .env file, and nothing secret is ever sent to the browser: the API routes call the
 * providers from here.
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { configureEnv, handleApi, startBackendWorker } from './api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets') + path.sep;
const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || '0.0.0.0';

function loadDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}
configureEnv({ ...loadDotEnv(path.join(ROOT, '.env')), ...(process.env as Record<string, string>) });

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.spz': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.md']);

interface Served {
  body: Buffer;
  gz?: Buffer;
  type: string;
  etag: string;
  immutable: boolean;
}
// dist/ is a few megabytes and never changes while the process lives, so every file (and its gzip) is
// read once and kept in memory: the 5.7 MB splat renderer chunk is compressed exactly once per deploy.
const cache = new Map<string, Served>();

function resolveFile(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const abs = path.normalize(path.join(DIST, decoded));
  if (abs !== DIST && !abs.startsWith(DIST + path.sep)) return null;
  try {
    return statSync(abs).isFile() ? abs : null;
  } catch {
    return null;
  }
}

function load(abs: string): Served {
  const hit = cache.get(abs);
  if (hit) return hit;
  const body = readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const st = statSync(abs);
  const served: Served = {
    body,
    type: TYPES[ext] || 'application/octet-stream',
    etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
    immutable: abs.startsWith(ASSETS),
    gz: COMPRESSIBLE.has(ext) && body.length > 1024 ? gzipSync(body, { level: 6 }) : undefined,
  };
  cache.set(abs, served);
  return served;
}

function serveFile(req: IncomingMessage, res: ServerResponse, abs: string, status = 200) {
  const f = load(abs);
  if (status === 200 && req.headers['if-none-match'] === f.etag) {
    res.writeHead(304, { ETag: f.etag });
    res.end();
    return;
  }
  const gzip = Boolean(f.gz) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const body = gzip ? f.gz! : f.body;
  const headers: Record<string, string> = {
    'Content-Type': f.type,
    'Content-Length': String(body.length),
    ETag: f.etag,
    // Hashed bundles under /assets never change; everything else (index.html, demo files) revalidates.
    'Cache-Control': f.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  if (f.gz) headers.Vary = 'Accept-Encoding';
  if (gzip) headers['Content-Encoding'] = 'gzip';
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function text(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res)
      .then((handled) => {
        if (!handled && !res.headersSent) text(res, 404, 'not found');
      })
      .catch((err: unknown) => {
        console.error('api error', err);
        if (!res.headersSent) text(res, 500, 'api error');
        else res.end();
      });
    return;
  }
  if (url.pathname === '/healthz') return text(res, 200, 'ok');
  if (method !== 'GET' && method !== 'HEAD') return text(res, 405, 'method not allowed');
  const abs = resolveFile(url.pathname);
  if (abs) return serveFile(req, res, abs);
  // Client-side routes (/t/:share, /tours/:id/...) get the app shell. Anything that looks like a file
  // is a real 404, so a stale hashed bundle is never answered with HTML and a 200.
  if (url.pathname.startsWith('/assets/') || path.extname(url.pathname)) return text(res, 404, 'not found');
  const index = path.join(DIST, 'index.html');
  if (!existsSync(index)) return text(res, 503, 'dist/index.html is missing: run npm run build first');
  serveFile(req, res, index);
});

// The job queue only moves while something claims from it. In production that is this process, so
// the worker starts once the port is open (a claim before then would race the deploy's health
// check) and is stopped on the way out, before the process exits, so a job it is holding is left
// with a lease that expires rather than a lock nobody will ever release.
let worker: ReturnType<typeof startBackendWorker> = null;

server.listen(PORT, HOST, () => {
  console.log(`audora listening on http://${HOST}:${PORT}  (serving ${DIST})`);
  worker = startBackendWorker();
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    worker?.stop();
    worker = null;
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
