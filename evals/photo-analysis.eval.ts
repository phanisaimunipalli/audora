/**
 * Photo-analysis evaluation — the vision step that greets every upload.
 *
 * Task: from one photo, say what room it is, whether it is empty (loose furniture), whether a door is
 * visible (it becomes the scale anchor), and how well it will reconstruct. Ground truth was labelled
 * by hand in evals/photos/manifest.json; empty rooms are ambiguous, so each photo lists the set of
 * acceptable room types. Accuracy, latency and cost are measured through the same /api/ai/chat proxy
 * the product uses. Baseline: what the product does with no model at all.
 *
 * Run:  npm run dev   then   npm run eval
 * Env:  EVAL_VISION_MODELS=vision,zai-org/GLM-5.3-Flash to compare models.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ANALYSIS_SCHEMA, analysisMessages } from '@/services/ai';

const BASE = process.env.EVAL_BASE || 'http://localhost:5173';
const MODELS = (process.env.EVAL_VISION_MODELS || 'vision').split(',').map((s) => s.trim()).filter(Boolean);

interface Labelled {
  file: string;
  types: string[];
  empty: boolean;
  door: boolean | null;
  quality: 'good' | 'ok' | 'poor';
  source: string;
  license: string;
  note: string;
}

interface Result {
  system: string;
  file: string;
  roomType?: string;
  typeOk: boolean;
  isEmpty?: boolean;
  emptyOk: boolean;
  doorVisible?: boolean;
  doorOk: boolean | null;
  quality?: string;
  qualityOk: boolean;
  caption?: string;
  ms: number;
  usd: number;
  model?: string;
  error?: string;
  fallback?: boolean;
}

function extract(text: string): any {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = /\{[\s\S]*\}/.exec(t);
    return m ? JSON.parse(m[0]) : {};
  }
}

async function analyse(model: string, p: Labelled, dataUrl: string): Promise<Result> {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: `eval_photo_${model}`, model, messages: analysisMessages(dataUrl), schema: ANALYSIS_SCHEMA, schemaName: 'analysis', temperature: 0.1, max_tokens: 500 }),
  });
  const body: any = await r.json();
  const ms = body.ms ?? Date.now() - t0;
  if (!r.ok) return { system: model, file: p.file, typeOk: false, emptyOk: false, doorOk: p.door == null ? null : false, qualityOk: false, ms, usd: 0, error: body.error };
  let j: any = {};
  try {
    j = extract(body.content || '');
  } catch (e: any) {
    return { system: model, file: p.file, typeOk: false, emptyOk: false, doorOk: p.door == null ? null : false, qualityOk: false, ms, usd: body.usd ?? 0, error: `parse: ${e?.message}` };
  }
  const roomType = String(j.room_type ?? '');
  const isEmpty = typeof j.is_empty === 'boolean' ? j.is_empty : undefined;
  const doorVisible = typeof j.door_visible === 'boolean' ? j.door_visible : undefined;
  const quality = String(j.quality ?? '');
  return {
    system: model,
    file: p.file,
    roomType,
    typeOk: p.types.includes(roomType),
    isEmpty,
    emptyOk: isEmpty === p.empty,
    doorVisible,
    doorOk: p.door == null ? null : doorVisible === p.door,
    quality,
    // quality is scored leniently: poor must be caught, good/ok are interchangeable
    qualityOk: p.quality === 'poor' ? quality === 'poor' : quality === 'good' || quality === 'ok',
    caption: typeof j.caption === 'string' ? j.caption : undefined,
    ms,
    usd: body.usd ?? 0,
    model: body.model,
    fallback: body.fallback,
  };
}

function baseline(p: Labelled): Result {
  // With no model the product assumes: living room, empty, door visible, quality from brightness (unknown here → ok).
  return { system: 'no-model baseline', file: p.file, roomType: 'living', typeOk: p.types.includes('living'), isEmpty: true, emptyOk: p.empty === true, doorVisible: true, doorOk: p.door == null ? null : p.door === true, quality: 'ok', qualityOk: p.quality !== 'poor', ms: 0, usd: 0 };
}

function summarize(results: Result[]) {
  const by = new Map<string, Result[]>();
  for (const r of results) by.set(r.system, [...(by.get(r.system) || []), r]);
  return [...by].map(([system, list]) => {
    const n = list.length;
    const pct = (f: (r: Result) => boolean) => Math.round((list.filter(f).length / n) * 100);
    const doorScored = list.filter((r) => r.doorOk != null);
    return {
      system,
      photos: n,
      roomTypePct: pct((r) => r.typeOk),
      emptyPct: pct((r) => r.emptyOk),
      doorPct: doorScored.length ? Math.round((doorScored.filter((r) => r.doorOk).length / doorScored.length) * 100) : null,
      qualityPct: pct((r) => r.qualityOk),
      errors: list.filter((r) => r.error).length,
      meanMs: Math.round(list.reduce((a, r) => a + r.ms, 0) / n),
      meanUsd: Number((list.reduce((a, r) => a + r.usd, 0) / n).toFixed(5)),
      totalUsd: Number(list.reduce((a, r) => a + r.usd, 0).toFixed(4)),
    };
  });
}

describe('photo-analysis evaluation', () => {
  it('scores the vision model against hand-labelled photos', async () => {
    const startedAt = new Date().toISOString();
    const dir = path.resolve(process.cwd(), 'evals/photos');
    const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { photos: Labelled[] };
    const results: Result[] = manifest.photos.map(baseline);

    let live = false;
    try {
      const st: any = await (await fetch(`${BASE}/api/status`)).json();
      live = Boolean(st.nebius);
    } catch {
      live = false;
    }
    if (live) {
      for (const model of MODELS) {
        for (const p of manifest.photos) {
          const dataUrl = `data:image/jpeg;base64,${readFileSync(path.join(dir, p.file)).toString('base64')}`;
          results.push(await analyse(model, p, dataUrl));
        }
      }
    } else {
      console.warn('Dev server not reachable or NEBIUS_API_KEY missing: only the baseline was scored.');
    }

    const rows = summarize(results);
    console.table(rows);
    const outDir = path.resolve(process.cwd(), 'evals/results');
    mkdirSync(outDir, { recursive: true });
    const stamp = startedAt.replace(/[:.]/g, '-');
    writeFileSync(path.join(outDir, `photo-analysis-${stamp}.json`), JSON.stringify({ startedAt, base: BASE, models: MODELS, rows, results }, null, 2));

    const lines: string[] = [];
    lines.push(`# Photo-analysis evaluation — ${startedAt}`);
    lines.push('');
    lines.push(`${manifest.photos.length} hand-labelled Wikimedia Commons photos (see evals/photos/manifest.json). Room type counts as correct when it is in the photo's acceptable set (an empty room can honestly be a bedroom or an office). Door accuracy is scored only where a human could label it. Quality is scored on catching the genuinely poor frame.`);
    lines.push('');
    lines.push('| system | photos | room type | empty? | door visible | quality | errors | mean ms | mean $ | total $ |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) lines.push(`| ${r.system} | ${r.photos} | ${r.roomTypePct}% | ${r.emptyPct}% | ${r.doorPct == null ? '—' : r.doorPct + '%'} | ${r.qualityPct}% | ${r.errors} | ${r.meanMs} | ${r.meanUsd} | ${r.totalUsd} |`);
    lines.push('');
    lines.push('## Per photo');
    lines.push('');
    lines.push('| photo | system | room type (ok?) | empty (ok?) | door (ok?) | quality | ms | $ | note |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of results.filter((x) => x.system !== 'no-model baseline')) {
      const p = manifest.photos.find((x) => x.file === r.file)!;
      lines.push(`| ${r.file} | ${r.system} | ${r.roomType ?? '—'} (${r.typeOk ? '✓' : '✗'} of ${p.types.join('/')}) | ${r.isEmpty} (${r.emptyOk ? '✓' : '✗'}) | ${r.doorVisible} (${r.doorOk == null ? 'n/a' : r.doorOk ? '✓' : '✗'}) | ${r.quality} | ${r.ms} | ${r.usd.toFixed(5)} | ${r.error ?? p.note} |`);
    }
    const misses = results.filter((x) => x.system !== 'no-model baseline' && (!x.typeOk || !x.emptyOk));
    if (misses.length) {
      lines.push('');
      lines.push('## Struggle cases');
      lines.push('');
      for (const m of misses) {
        const p = manifest.photos.find((x) => x.file === m.file)!;
        lines.push(`- **${m.file}** (${p.note}): ${m.system} said ${m.roomType}, empty=${m.isEmpty}; truth ${p.types.join('/')}, empty=${p.empty}.`);
      }
    }
    writeFileSync(path.join(outDir, 'photo-analysis-latest.md'), lines.join('\n'));

    expect(rows.length).toBeGreaterThan(0);
  });
});
