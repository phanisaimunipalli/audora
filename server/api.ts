/**
 * Audora dev/preview API — a Vite plugin that mounts /api/* on the dev and preview servers.
 *
 * All third-party keys are read here, on the server, from .env / process.env.
 * Nothing prefixed VITE_ is used for secrets, so nothing secret ever reaches the browser.
 *
 *   GET  /api/status                       → which providers are live vs mocked
 *   POST /api/ai/chat                      → Nebius Token Factory chat completions (OpenAI-compatible)
 *   GET  /api/ai/stats                     → cost / latency log for the evaluation write-up
 *   POST /api/marble/generate              → World Labs Marble worlds:generate (one image, or several)
 *   GET  /api/marble/operations/:id        → poll a generation
 *   GET  /api/marble/worlds/:id            → fetch a finished world
 *   GET  /api/fetch-image?url=             → fetch one https image for the seller (listing photo URLs)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';

type Env = Record<string, string>;
let ENV: Env = {};

const NEBIUS_BASE = 'https://api.tokenfactory.nebius.com/v1';

/**
 * Other OpenAI-compatible providers, used ONLY to serve fine-tuned checkpoints for A/B evaluation when
 * Token Factory cannot host them yet. A model id prefixed "together:", "fireworks:" or "openai:" routes
 * there; everything else (the product's main flow) stays on Nebius Token Factory.
 */
const PROVIDERS: Record<string, { base: string; keyEnv: string; baseEnv?: string }> = {
  together: { base: 'https://api.together.xyz/v1', keyEnv: 'TOGETHER_API_KEY' },
  fireworks: { base: 'https://api.fireworks.ai/inference/v1', keyEnv: 'FIREWORKS_API_KEY' },
  openai: { base: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  // A self-hosted vLLM (e.g. scripts/serve-lora-modal.py): MODAL_BASE_URL=https://.../v1, MODAL_API_KEY=<bearer>
  modal: { base: '', keyEnv: 'MODAL_API_KEY', baseEnv: 'MODAL_BASE_URL' },
};
function resolveProvider(modelId: string): { name: string; base: string; key: string; model: string } | { error: string } {
  const m = /^(together|fireworks|openai|modal):(.+)$/.exec(modelId);
  if (!m) return { name: 'nebius', base: NEBIUS_BASE, key: ENV.NEBIUS_API_KEY || '', model: modelId };
  const p = PROVIDERS[m[1]];
  const key = ENV[p.keyEnv] || '';
  const base = p.baseEnv ? ENV[p.baseEnv] || '' : p.base;
  if (!key || !base) return { error: `${p.keyEnv}${p.baseEnv ? ` / ${p.baseEnv}` : ''} is not set on the server` };
  return { name: m[1], base: base.replace(/\/$/, ''), key, model: m[2] };
}
// Credit guard: live Marble generations per server process. Raise MARBLE_MAX_GENERATIONS in .env when you mean it.
let liveGenerations = 0;
const maxGenerations = () => Number(ENV.MARBLE_MAX_GENERATIONS || 3);
const MARBLE_BASE = 'https://api.worldlabs.ai/marble/v1';
/** Marble takes 4 images in a multi-image prompt, or 8 in reconstruction mode. */
const MARBLE_PLAIN_IMAGES = 4;
const MARBLE_MAX_IMAGES = 8;

// Prices (USD per 1M tokens). Filled from GET /v1/models?verbose=true on first use so the
// cost-per-task log reflects the account's real list prices; the static rows are a fallback.
const PRICE_PER_M: Record<string, { in: number; out: number }> = {
  'Qwen/Qwen3-235B-A22B-Instruct-2507': { in: 0.2, out: 0.6 },
  'Qwen/Qwen3-30B-A3B-Instruct-2507': { in: 0.1, out: 0.3 },
  'openbmb/MiniCPM-V-4_5': { in: 0.658, out: 1.11 },
  'zai-org/GLM-5.3-Flash': { in: 0.15, out: 0.5 },
  'moonshotai/Kimi-K2.6': { in: 0.95, out: 4 },
  'openai/gpt-oss-120b': { in: 0.15, out: 0.6 },
};
let pricesLoaded = false;
const MODEL_FEATURES: Record<string, string[]> = {};
async function loadPrices(key: string) {
  if (pricesLoaded) return;
  pricesLoaded = true;
  try {
    const r = await fetch(`${NEBIUS_BASE}/models?verbose=true`, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) return;
    const data: any = await r.json();
    for (const m of data.data || []) {
      const p = m.pricing || {};
      const inp = Number(p.prompt);
      const out = Number(p.completion);
      if (m.id && Number.isFinite(inp) && Number.isFinite(out)) PRICE_PER_M[m.id] = { in: inp * 1e6, out: out * 1e6 };
      if (m.id && Array.isArray(m.supported_features)) MODEL_FEATURES[m.id] = m.supported_features;
    }
  } catch {
    /* keep the static table */
  }
}

// Verified against this account's /v1/models on 2026-09-05. Override in .env.
const DEFAULT_TEXT = 'Qwen/Qwen3-235B-A22B-Instruct-2507';
const DEFAULT_FAST = 'Qwen/Qwen3-30B-A3B-Instruct-2507';
const DEFAULT_VISION = 'openbmb/MiniCPM-V-4_5';
/** Vision models tried in order when one fails (capacity errors are common on multimodal endpoints). */
const VISION_FALLBACKS = ['openbmb/MiniCPM-V-4_5', 'zai-org/GLM-5.3-Flash', 'moonshotai/Kimi-K2.6'];

function models() {
  return {
    text: ENV.NEBIUS_TEXT_MODEL || DEFAULT_TEXT,
    fast: ENV.NEBIUS_FAST_MODEL || DEFAULT_FAST,
    vision: ENV.NEBIUS_VISION_MODEL || DEFAULT_VISION,
    // Product decision 2026-09-06: staging runs on the hosted 235B on Token Factory. STAGER_MODEL can point
    // at the fine-tuned 8B (e.g. "modal:stager") when a host for it exists; same accuracy, ~10× cheaper.
    stager: ENV.STAGER_MODEL || ENV.NEBIUS_TEXT_MODEL || DEFAULT_TEXT,
    marbleDraft: ENV.MARBLE_DRAFT_MODEL || 'marble-1.0-draft',
    marbleFull: ENV.MARBLE_FULL_MODEL || 'marble-1.1',
  };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const LOG_DIR = path.resolve(process.cwd(), '.audora');
const LOG_FILE = path.join(LOG_DIR, 'ai-log.jsonl');
const stats: { calls: number; usd: number; ms: number; byTask: Record<string, { calls: number; usd: number; ms: number; inTok: number; outTok: number }> } = {
  calls: 0,
  usd: 0,
  ms: 0,
  byTask: {},
};

async function logCall(entry: Record<string, unknown>) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    /* logging is best effort */
  }
}

async function nebiusChat(body: any, res: ServerResponse) {
  const key = ENV.NEBIUS_API_KEY;
  if (!key) return json(res, 503, { error: 'NEBIUS_API_KEY is not set on the server. Running in mock mode.' });
  await loadPrices(key);
  const m = models();
  const alias: Record<string, string> = { text: m.text, fast: m.fast, vision: m.vision, stager: m.stager };
  const requested = alias[body.model] || body.model || m.text;
  const task = String(body.task || 'chat');
  // For vision requests, try alternates when an endpoint is down or out of memory.
  const candidates = body.model === 'vision' ? [requested, ...VISION_FALLBACKS.filter((v) => v !== requested)] : [requested];
  const started = Date.now();
  let lastErr: any = null;
  for (const candidate of candidates) {
  const prov = resolveProvider(candidate);
  if ('error' in prov) return json(res, 503, { error: prov.error });
  const model = prov.model;
  const base = {
    model,
    messages: body.messages,
    temperature: body.temperature ?? 0.2,
    max_tokens: body.max_tokens ?? 1200,
  };

  // Structured output: try OpenAI-style {name, schema}, then the bare schema Token Factory documents,
  // then json_object with the schema pasted into the prompt. Whatever the engine accepts.
  const attempts: any[] = [];
  const structured = !MODEL_FEATURES[model] || MODEL_FEATURES[model].includes('structured_outputs');
  if (body.schema) {
    if (structured) {
      attempts.push({ ...base, response_format: { type: 'json_schema', json_schema: { name: body.schemaName || 'output', schema: body.schema } } });
      attempts.push({ ...base, response_format: { type: 'json_schema', json_schema: body.schema } });
    }
    attempts.push({
      ...base,
      ...(MODEL_FEATURES[model]?.includes('json_mode') || structured ? { response_format: { type: 'json_object' } } : {}),
      messages: [...body.messages, { role: 'system', content: `Respond with JSON only, matching this JSON Schema: ${JSON.stringify(body.schema)}` }],
    });
  } else {
    attempts.push(base);
  }

  for (const payload of attempts) {
    try {
      const r = await fetch(`${prov.base}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${prov.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      if (!r.ok) {
        lastErr = { status: r.status, model, body: text.slice(0, 500) };
        if (r.status === 400 || r.status === 422) continue; // try the next response_format shape
        break; // 5xx / 429: try the next candidate model, if any
      }
      const data = JSON.parse(text);
      const content: string = data.choices?.[0]?.message?.content ?? '';
      const usage = data.usage || {};
      const price = PRICE_PER_M[model];
      const usd = price ? ((usage.prompt_tokens || 0) * price.in + (usage.completion_tokens || 0) * price.out) / 1e6 : null;
      const ms = Date.now() - started;
      stats.calls += 1;
      stats.ms += ms;
      if (usd) stats.usd += usd;
      const t = (stats.byTask[task] ||= { calls: 0, usd: 0, ms: 0, inTok: 0, outTok: 0 });
      t.calls += 1;
      t.ms += ms;
      t.usd += usd || 0;
      t.inTok += usage.prompt_tokens || 0;
      t.outTok += usage.completion_tokens || 0;
      void logCall({ task, model, provider: prov.name, ms, usage, usd, fallback: candidate !== requested });
      return json(res, 200, { content, model: prov.name === 'nebius' ? model : `${prov.name}:${model}`, provider: prov.name, usage, usd, ms, fallback: candidate !== requested });
    } catch (e: any) {
      lastErr = { message: e?.message, model };
    }
  }
  }
  return json(res, 502, { error: 'Token Factory request failed', detail: lastErr });
}

function dataUrlToBase64(dataUrl: string): { base64: string; extension: string } {
  const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Expected a base64 image data URL');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  return { base64: m[2], extension: ext };
}

/* ---------- listing photo proxy ----------
 * The seller copies photo URLs out of the listing they are already looking at (Zillow, Redfin,
 * Compass, an MLS CDN) and pastes them in. The browser cannot read those bytes — the CDNs send no
 * CORS header — so the dev server fetches them instead and hands back a data URL.
 *
 * Deliberate limits: https only, one image at a time, 8 MB, and the response must actually BE an
 * image — a login wall or an HTML error page is refused rather than turned into a "photo". Redirects
 * are followed by fetch, and the final response's content-type is what is checked, so a redirect
 * into a sign-in page ends as a 415 and never as a data URL. This is not a scraper: it fetches a URL
 * the user pasted, never a listing page, and never follows links found in one. */

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Hosts a seller's listing photos actually come from. Any other https image host is allowed too. */
const LISTING_IMAGE_HOSTS = [
  'photos.zillowstatic.com',
  'maps.zillowstatic.com',
  'ssl.cdn-redfin.com',
  'photos.redfin.com',
  'ap.rdcpix.com',
  'ar.rdcpix.com',
  'p.rdcpix.com',
  'images.compass.com',
  'd1qfrurkpx5f0p.cloudfront.net',
  'media.crmls.org',
  'cdn.resize.sparkplatform.com',
  'media-cdn.rightmove.co.uk',
  'lc.zoocdn.com',
  'upload.wikimedia.org',
];

function imageHostAllowed(u: URL): boolean {
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (LISTING_IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  // Any other https host is allowed, but only when the URL is plausibly an image file: a listing
  // page URL pasted by mistake must not be fetched.
  return /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(`${u.pathname}${u.search}`);
}

const EXT_FOR_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

async function fetchImage(raw: string, res: ServerResponse) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return json(res, 400, { error: 'That is not a URL.' });
  }
  if (u.protocol !== 'https:') return json(res, 400, { error: 'Only https image URLs can be fetched.' });
  if (!imageHostAllowed(u)) {
    return json(res, 400, { error: `${u.hostname} is not a known listing image host and that URL does not look like an image file. Paste the URL of the photo itself (right-click → Copy image address).` });
  }
  let r: Response;
  try {
    r = await fetch(u, {
      redirect: 'follow',
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8', 'user-agent': 'Audora/0.1 (listing photo import)' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    return json(res, 502, { error: `Could not reach ${u.hostname} (${e?.message || 'network error'}).` });
  }
  if (!r.ok) return json(res, r.status === 404 ? 404 : 502, { error: `${u.hostname} answered ${r.status}. The photo may need a signed URL.` });

  const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/') || !EXT_FOR_TYPE[type]) {
    return json(res, 415, { error: `That URL returned ${type || 'no content type'}, not an image. Copy the image address, not the listing page.` });
  }
  const declared = Number(r.headers.get('content-length') || 0);
  if (declared > IMAGE_MAX_BYTES) return json(res, 413, { error: `That image is ${(declared / 1e6).toFixed(1)} MB; the limit is 8 MB.` });

  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > IMAGE_MAX_BYTES) return json(res, 413, { error: `That image is ${(buf.byteLength / 1e6).toFixed(1)} MB; the limit is 8 MB.` });
  if (buf.byteLength < 512) return json(res, 415, { error: 'That URL returned an empty or placeholder image.' });

  return json(res, 200, {
    dataUrl: `data:${type};base64,${buf.toString('base64')}`,
    contentType: type,
    bytes: buf.byteLength,
    url: r.url || u.toString(),
  });
}

async function marble(pathname: string, init: RequestInit, res: ServerResponse) {
  const key = ENV.WORLDLABS_API_KEY;
  if (!key) return json(res, 503, { error: 'WORLDLABS_API_KEY is not set on the server. Running in mock mode.' });
  const r = await fetch(`${MARBLE_BASE}${pathname}`, {
    ...init,
    headers: { 'WLT-Api-Key': key, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  res.statusCode = r.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(text);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;
  if (!p.startsWith('/api/')) return false;
  try {
    if (p === '/api/status' && req.method === 'GET') {
      json(res, 200, {
        nebius: Boolean(ENV.NEBIUS_API_KEY),
        marble: Boolean(ENV.WORLDLABS_API_KEY),
        models: models(),
        liveGenerations,
        maxGenerations: maxGenerations(),
        evalProviders: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, Boolean(ENV[v.keyEnv]) && (!v.baseEnv || Boolean(ENV[v.baseEnv]))])),
      });
      return true;
    }
    if (p === '/api/ai/chat' && req.method === 'POST') {
      await nebiusChat(await readBody(req), res);
      return true;
    }
    if (p === '/api/ai/stats' && req.method === 'GET') {
      json(res, 200, stats);
      return true;
    }
    if (p === '/api/marble/generate' && req.method === 'POST') {
      const body = await readBody(req);
      const m = models();
      if (liveGenerations >= maxGenerations()) {
        json(res, 429, { error: `Credit guard: this server has already started ${liveGenerations} live Marble generations (cap ${maxGenerations()}). Set MARBLE_MAX_GENERATIONS in .env to raise it, or use simulated reconstruction.` });
        return true;
      }
      liveGenerations += 1;
      /* One angle or several. `images` is the general form — `{ dataUrl, azimuth? }` per angle, in
         the order the seller shot them — and `imageDataUrl` stays for the single-photo callers.
         Marble's multi-image prompt takes up to 4 images, or 8 with `reconstruct_images`; an
         `azimuth` (degrees round the capture point, 0 = the first shot) tells it where each angle
         faces instead of making it guess. Shape per the World API's own schema:
         multi_image_prompt: [{ azimuth?, content: { source, data_base64, extension } }]. */
      const angles: { dataUrl: string; azimuth?: number }[] = Array.isArray(body.images) && body.images.length
        ? body.images.filter((a: any) => typeof a?.dataUrl === 'string')
        : [{ dataUrl: body.imageDataUrl }];
      if (!angles.length) {
        json(res, 400, { error: 'No image supplied.' });
        return true;
      }
      const shots = angles.slice(0, MARBLE_MAX_IMAGES).map((a) => ({ ...dataUrlToBase64(a.dataUrl), azimuth: Number.isFinite(Number(a.azimuth)) ? Number(a.azimuth) : undefined }));
      const textPrompt = body.textPrompt || 'An empty residential room, photographed from the doorway. Keep the real geometry.';
      const world_prompt =
        shots.length === 1
          ? {
              type: 'image',
              image_prompt: { source: 'data_base64', data_base64: shots[0].base64, extension: shots[0].extension },
              text_prompt: textPrompt,
            }
          : {
              type: 'multi-image',
              multi_image_prompt: shots.map((s) => ({
                ...(s.azimuth == null ? {} : { azimuth: s.azimuth }),
                content: { source: 'data_base64', data_base64: s.base64, extension: s.extension },
              })),
              reconstruct_images: shots.length > MARBLE_PLAIN_IMAGES,
              text_prompt: textPrompt,
            };
      await marble(
        '/worlds:generate',
        {
          method: 'POST',
          body: JSON.stringify({
            display_name: String(body.displayName || 'Audora room').slice(0, 64),
            model: body.tier === 'full' ? m.marbleFull : m.marbleDraft,
            tags: ['audora'],
            permission: { public: false, allow_id_access: true },
            world_prompt,
          }),
        },
        res,
      );
      return true;
    }
    if (p === '/api/fetch-image' && req.method === 'GET') {
      await fetchImage(url.searchParams.get('url') || '', res);
      return true;
    }
    let m = /^\/api\/marble\/operations\/([\w-]+)$/.exec(p);
    if (m && req.method === 'GET') {
      await marble(`/operations/${m[1]}`, { method: 'GET' }, res);
      return true;
    }
    m = /^\/api\/marble\/worlds\/([\w-]+)$/.exec(p);
    if (m && req.method === 'GET') {
      await marble(`/worlds/${m[1]}`, { method: 'GET' }, res);
      return true;
    }
    json(res, 404, { error: `No route for ${req.method} ${p}` });
    return true;
  } catch (e: any) {
    json(res, 500, { error: e?.message || 'server error' });
    return true;
  }
}

export function audoraApi(): Plugin {
  const mount = (middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) => {
    middlewares.use((req, res, next) => {
      handle(req, res).then((handled) => {
        if (!handled) next();
      });
    });
  };
  return {
    name: 'audora-api',
    // The cost log lives inside the project so the evaluation write-up can read it, but it must never count
    // as a source change: Tailwind registers every watched file as a class-scan source and full-reloads the
    // page when one changes, which used to reload every open tab on every AI call.
    config: () => ({ server: { watch: { ignored: ['**/.audora/**'] } } }),
    configResolved(config) {
      ENV = { ...loadEnv(config.mode, config.root, ''), ...(process.env as Env) };
    },
    configureServer(server) {
      server.watcher.unwatch(LOG_DIR);
      mount(server.middlewares);
    },
    configurePreviewServer(server) {
      mount(server.middlewares);
    },
  };
}
