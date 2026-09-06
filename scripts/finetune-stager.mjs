#!/usr/bin/env node
/**
 * Fine-tune the staging model on Nebius Token Factory from the engine-validated distillation set.
 *
 *   node scripts/finetune-stager.mjs --dry-run                 # validate + token estimate, no upload
 *   node scripts/finetune-stager.mjs                           # upload, create a LoRA job, poll to completion
 *   node scripts/finetune-stager.mjs --status <job_id>         # poll an existing job
 *   node scripts/finetune-stager.mjs --base Qwen/Qwen3-8B --epochs 3 --lora-r 16
 *   node scripts/finetune-stager.mjs --provider together --base meta-llama/Meta-Llama-3.1-8B-Instruct-Reference
 *
 * Reads NEBIUS_API_KEY from .env (never from the browser). Dataset: evals/results/stager-distill.jsonl
 * (conversational JSONL; the `meta` field is stripped before upload). 10% held out as validation.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const BASE = 'https://api.tokenfactory.nebius.com/v1';

function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const env = { ...loadEnv(), ...process.env };
const PROVIDER = flag('--provider', 'nebius'); // nebius | together
const PROVIDER_BASE = PROVIDER === 'together' ? 'https://api.together.xyz/v1' : BASE;
const KEY = PROVIDER === 'together' ? env.TOGETHER_API_KEY : env.NEBIUS_API_KEY;
const DATASET = flag('--dataset', path.join(ROOT, 'evals/results/stager-distill.jsonl'));
const BASE_MODEL = flag('--base', 'Qwen/Qwen3-8B');
const EPOCHS = Number(flag('--epochs', 3));
const LORA_R = Number(flag('--lora-r', 16));
const LORA_ALPHA = Number(flag('--lora-alpha', 32));
const LR = Number(flag('--lr', 0.0001));
const SUFFIX = flag('--suffix', 'audora-stager');
const OUT_DIR = path.join(ROOT, 'evals/results');

const headers = (extra = {}) => ({ authorization: `Bearer ${KEY}`, ...extra });

function readDataset() {
  if (!fs.existsSync(DATASET)) throw new Error(`Dataset not found: ${DATASET}. Run EVAL_DISTILL=1 npm run eval -- evals/distill-stager.eval.ts first.`);
  const rows = fs
    .readFileSync(DATASET, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map(({ messages }) => ({ messages }));
  for (const r of rows) {
    if (!Array.isArray(r.messages) || r.messages[r.messages.length - 1].role !== 'assistant') throw new Error('Every example must end with an assistant message');
  }
  return rows;
}

function split(rows, holdout = 0.1) {
  // deterministic split by index so re-runs are comparable
  const val = rows.filter((_, i) => i % Math.round(1 / holdout) === 0);
  const train = rows.filter((_, i) => i % Math.round(1 / holdout) !== 0);
  return { train, val };
}

function estimateTokens(rows) {
  // ~4 chars per token; good enough for a cost ceiling
  return rows.reduce((a, r) => a + r.messages.reduce((b, m) => b + Math.ceil(String(m.content).length / 4), 0), 0);
}

async function upload(rows, name) {
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const form = new FormData();
  form.append('purpose', 'fine-tune');
  form.append('file', new Blob([body], { type: 'application/jsonl' }), name);
  const r = await fetch(`${PROVIDER_BASE}/files`, { method: 'POST', headers: headers(), body: form });
  const j = await r.json();
  if (!r.ok) throw new Error(`upload failed ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

async function createJob(trainingFileId, validationFileId) {
  if (PROVIDER === 'together') {
    const body = {
      model: BASE_MODEL,
      training_file: trainingFileId,
      validation_file: validationFileId,
      n_epochs: EPOCHS,
      learning_rate: LR,
      suffix: SUFFIX,
      training_type: { type: 'Lora', lora_r: LORA_R, lora_alpha: LORA_ALPHA },
    };
    const r = await fetch(`${PROVIDER_BASE}/fine-tunes`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(`create job failed ${r.status}: ${JSON.stringify(j).slice(0, 600)}`);
    return j;
  }
  const body = {
    model: BASE_MODEL,
    training_file: trainingFileId,
    validation_file: validationFileId,
    suffix: SUFFIX,
    seed: 42,
    hyperparameters: {
      n_epochs: EPOCHS,
      batch_size: 8,
      learning_rate: LR,
      lora: true,
      lora_r: LORA_R,
      lora_alpha: LORA_ALPHA,
      lora_dropout: 0.05,
      context_length: 8192,
      packing: true,
    },
  };
  const r = await fetch(`${BASE}/fine_tuning/jobs`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`create job failed ${r.status}: ${JSON.stringify(j).slice(0, 600)}`);
  return j;
}

async function getJob(id) {
  const r = await fetch(PROVIDER === 'together' ? `${PROVIDER_BASE}/fine-tunes/${id}` : `${BASE}/fine_tuning/jobs/${id}`, { headers: headers() });
  const j = await r.json();
  if (!r.ok) throw new Error(`status failed ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

async function listCheckpoints(id) {
  const r = await fetch(`${BASE}/fine_tuning/jobs/${id}/checkpoints`, { headers: headers() });
  return r.ok ? r.json() : null;
}

async function poll(id) {
  const started = Date.now();
  for (;;) {
    const j = await getJob(id);
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`[${mins} min] ${j.status}${j.trained_tokens ? ` · ${j.trained_tokens} tokens` : ''}${j.error ? ` · error: ${JSON.stringify(j.error).slice(0, 300)}` : ''}`);
    if (['succeeded', 'completed', 'failed', 'error', 'cancelled'].includes(String(j.status).toLowerCase())) {
      fs.writeFileSync(path.join(OUT_DIR, `finetune-${id}.json`), JSON.stringify(j, null, 2));
      if (j.model_output_name) console.log('fine-tuned model:', j.model_output_name, '(deploy it as a dedicated endpoint on Together, then use EVAL_MODELS=together:' + j.model_output_name + ')');
      if (String(j.status).toLowerCase() === 'succeeded') {
        const cps = await listCheckpoints(id);
        if (cps) fs.writeFileSync(path.join(OUT_DIR, `finetune-${id}.checkpoints.json`), JSON.stringify(cps, null, 2));
        console.log('checkpoints:', JSON.stringify(cps).slice(0, 800));
      }
      return j;
    }
    await new Promise((res) => setTimeout(res, 30000));
  }
}

async function main() {
  if (has('--status')) {
    if (!KEY) throw new Error('NEBIUS_API_KEY missing');
    await poll(flag('--status'));
    return;
  }
  const rows = readDataset();
  const { train, val } = split(rows);
  const tokens = estimateTokens(rows);
  console.log(`dataset: ${rows.length} examples (${train.length} train / ${val.length} val), ~${tokens.toLocaleString()} tokens per epoch, ${EPOCHS} epochs → ~${(tokens * EPOCHS).toLocaleString()} trained tokens`);
  console.log(`base: ${BASE_MODEL} · LoRA r=${LORA_R} α=${LORA_ALPHA} · lr ${LR}`);
  if (has('--dry-run')) return;
  if (!KEY) throw new Error(`${PROVIDER === 'together' ? 'TOGETHER_API_KEY' : 'NEBIUS_API_KEY'} missing in .env`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tf = await upload(train, 'stager-train.jsonl');
  const vf = await upload(val, 'stager-val.jsonl');
  console.log('uploaded', tf.id, vf.id);
  const job = await createJob(tf.id, vf.id);
  console.log('job created', job.id, job.status);
  fs.writeFileSync(path.join(OUT_DIR, `finetune-${job.id}.created.json`), JSON.stringify({ job, base: BASE_MODEL, train: train.length, val: val.length, tokens }, null, 2));
  await poll(job.id);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
