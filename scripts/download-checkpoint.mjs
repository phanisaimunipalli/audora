#!/usr/bin/env node
/**
 * Download a finished Token Factory fine-tuning checkpoint (LoRA adapter) to evals/results/ft-<job>/adapter.
 *   node scripts/download-checkpoint.mjs <ftjob-id>
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const BASE = 'https://api.tokenfactory.nebius.com/v1';
const env = Object.fromEntries(
  fs.existsSync(path.join(ROOT, '.env'))
    ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    : [],
);
const KEY = process.env.NEBIUS_API_KEY || env.NEBIUS_API_KEY;
const job = process.argv[2];
if (!job) throw new Error('usage: node scripts/download-checkpoint.mjs <ftjob-id>');
const headers = { authorization: `Bearer ${KEY}` };

const list = await (await fetch(`${BASE}/fine_tuning/jobs/${job}/checkpoints`, { headers })).json();
console.log('checkpoints:', JSON.stringify(list).slice(0, 1200));
const cps = list.data || list.checkpoints || (Array.isArray(list) ? list : []);
if (!cps.length) throw new Error('no checkpoints yet');
const cp = cps[cps.length - 1];
const dir = path.join(ROOT, 'evals/results', `ft-${job}`, 'adapter');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, '..', 'checkpoint.json'), JSON.stringify(cp, null, 2));
// result_files are file ids; their names come from the files list and their bytes from /files/{id}/content.
const all = (await (await fetch(`${BASE}/files`, { headers })).json()).data || [];
const byId = new Map(all.map((f) => [f.id, f]));
for (const id of cp.result_files || []) {
  const meta = byId.get(id);
  const name = path.basename(meta?.filename || id);
  const r = await fetch(`${BASE}/files/${id}/content`, { headers });
  if (!r.ok) {
    console.warn('skip', name, r.status);
    continue;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(path.join(dir, name), buf);
  console.log('saved', name, buf.length, 'bytes');
}
console.log('adapter dir:', dir);
