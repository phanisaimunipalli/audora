/**
 * Distillation dataset for the staging model.
 *
 * The large model has taste but only 92% of its semantic proposals are valid; the rule-based stager is
 * always valid but has no taste. The geometry engine is a free verifier: every proposal it accepts is a
 * gold example. This script asks the large model for proposals on many synthetic rooms, keeps only the
 * engine-validated ones (plus rule-based proposals for coverage), and writes a chat-format JSONL that a
 * small open model can be fine-tuned on with Nebius Token Factory.
 *
 * Run:   EVAL_DISTILL=1 EVAL_DISTILL_N=120 npm run eval -- evals/distill-stager.eval.ts
 * Out:   evals/results/stager-distill.jsonl (+ .summary.json)
 */
import { describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyScale } from '@/engine/anchor';
import { isEssentialKind, proposeFor, resolveSemanticProposal, type SemanticPiece, type StagingStyle } from '@/engine/autostage';
import { catalogItem } from '@/engine/catalog';
import { fitReport } from '@/engine/fit';
import type { RoomGeometry, RoomType, WallSide } from '@/engine/types';
import { mockRawGeometry } from '@/services/mockWorld';
import { SEMANTIC_STAGE_SCHEMA, SEMANTIC_STAGE_SYSTEM, semanticStagePrompt } from '@/services/ai';
import { fnv1a, mulberry32 } from '@/lib/ids';

const BASE = process.env.EVAL_BASE || 'http://localhost:5173';
const ENABLED = process.env.EVAL_DISTILL === '1';
const N = Number(process.env.EVAL_DISTILL_N || 120);
const MODEL = process.env.EVAL_DISTILL_MODEL || 'text';
const CONCURRENCY = Number(process.env.EVAL_DISTILL_CONCURRENCY || 4);

const TYPES: RoomType[] = ['living', 'living', 'bedroom', 'bedroom', 'dining', 'office', 'studio'];
const STYLES: StagingStyle[] = ['warm', 'minimal', 'scandi', 'family'];
const WALLS: WallSide[] = ['north', 'south', 'east', 'west'];

const ESSENTIALS: Record<string, string[][]> = {
  living: [['sofa', 'sectional'], ['coffeeTable']],
  bedroom: [['bed']],
  dining: [['diningSet']],
  office: [['desk'], ['officeChair']],
  studio: [['bed'], ['sofa', 'sectional']],
};

/** Synthetic room i: seeded proportions, then a random door wall/offset and window walls for variety. */
function roomFor(i: number): { geometry: RoomGeometry; type: RoomType; style: StagingStyle } {
  const rng = mulberry32(fnv1a(`distill:${i}`));
  const type = TYPES[i % TYPES.length];
  const style = STYLES[Math.floor(rng() * STYLES.length)];
  const g = applyScale(mockRawGeometry(`distill:${i}`, type), 2.03);
  const doorWall = WALLS[Math.floor(rng() * WALLS.length)];
  const doorLen = doorWall === 'north' || doorWall === 'south' ? g.width : g.depth;
  const door = { ...g.door, wall: doorWall, offset: Math.min(doorLen - 0.6, Math.max(0.6, 0.5 + rng() * (doorLen - 1))) };
  const windows = g.windows.filter((w) => w.wall !== doorWall);
  return { geometry: { ...g, door, windows }, type, style };
}

function valid(pieces: ReturnType<typeof resolveSemanticProposal>['pieces'], dropped: ReturnType<typeof resolveSemanticProposal>['dropped'], g: RoomGeometry, type: RoomType): boolean {
  const rep = fitReport(pieces, g);
  const kinds = new Set(pieces.map((p) => p.kind));
  const essentials = (ESSENTIALS[type] || []).every((alts) => alts.some((k) => kinds.has(k as never)));
  const droppedEssential = dropped.some((d) => (typeof d.optional === 'boolean' ? !d.optional : isEssentialKind(catalogItem(d.itemId)?.kind ?? 'box')));
  const walkable = rep.narrowestWalkway == null || rep.narrowestWalkway >= 0.75;
  return !droppedEssential && rep.misfits.length === 0 && rep.blocksDoor.length === 0 && walkable && essentials && pieces.length >= 3;
}

/** Keep only the proposal entries the engine placed (by itemId count), preserving order. */
function keptProposal(proposal: SemanticPiece[], pieces: { itemId: string }[]): SemanticPiece[] {
  const budget = new Map<string, number>();
  for (const p of pieces) budget.set(p.itemId, (budget.get(p.itemId) || 0) + 1);
  const out: SemanticPiece[] = [];
  for (const sp of proposal) {
    const id = catalogItem(String(sp.itemId))?.id ?? String(sp.itemId);
    const left = budget.get(id) || 0;
    if (left > 0) {
      budget.set(id, left - 1);
      out.push({ ...sp, itemId: id });
    }
  }
  return out;
}

async function askModel(g: RoomGeometry, type: RoomType, style: StagingStyle): Promise<{ proposal: SemanticPiece[]; rationale?: string; usd: number; ms: number } | null> {
  const r = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task: 'distill_stager',
      model: MODEL,
      messages: [
        { role: 'system', content: SEMANTIC_STAGE_SYSTEM },
        { role: 'user', content: semanticStagePrompt(g, type, style) },
      ],
      schema: SEMANTIC_STAGE_SCHEMA,
      schemaName: 'staging',
      temperature: 0.7,
      max_tokens: 900,
    }),
  });
  const body: any = await r.json();
  if (!r.ok) return null;
  try {
    const text = String(body.content || '').trim();
    const j = JSON.parse(text.startsWith('{') ? text : (/\{[\s\S]*\}/.exec(text)?.[0] ?? '{}'));
    return { proposal: Array.isArray(j.pieces) ? j.pieces : [], rationale: typeof j.rationale === 'string' ? j.rationale : undefined, usd: body.usd ?? 0, ms: body.ms ?? 0 };
  } catch {
    return null;
  }
}

describe('stager distillation', () => {
  const run = ENABLED ? it : it.skip;
  run('writes an engine-validated JSONL dataset', async () => {
    const outDir = path.resolve(process.cwd(), 'evals/results');
    mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, 'stager-distill.jsonl');
    if (existsSync(out)) unlinkSync(out);
    const stats = { rooms: N, modelCalls: 0, modelValid: 0, heuristicAdded: 0, usd: 0, ms: 0, examples: 0 };

    let live = false;
    try {
      const st: any = await (await fetch(`${BASE}/api/status`)).json();
      live = Boolean(st.nebius);
    } catch {
      live = false;
    }

    const write = (g: RoomGeometry, type: RoomType, style: StagingStyle, proposal: SemanticPiece[], rationale: string | undefined, source: string) => {
      const line = {
        messages: [
          { role: 'system', content: SEMANTIC_STAGE_SYSTEM },
          { role: 'user', content: semanticStagePrompt(g, type, style) },
          { role: 'assistant', content: JSON.stringify({ pieces: proposal, ...(rationale ? { rationale } : {}) }) },
        ],
        meta: { source, type, style, width: g.width, depth: g.depth },
      };
      appendFileSync(out, JSON.stringify(line) + '\n');
      stats.examples += 1;
    };

    const indices = Array.from({ length: N }, (_, i) => i);
    let cursor = 0;
    const worker = async () => {
      while (cursor < indices.length) {
        const i = indices[cursor++];
        const { geometry, type, style } = roomFor(i);
        // Rule-based coverage example for half the rooms (always valid).
        if (i % 2 === 0) {
          const hp = proposeFor(geometry, type, style);
          const { pieces, dropped } = resolveSemanticProposal(geometry, hp, style);
          if (valid(pieces, dropped, geometry, type)) {
            write(geometry, type, style, keptProposal(hp, pieces), undefined, 'heuristic');
            stats.heuristicAdded += 1;
          }
        }
        if (!live) continue;
        const res = await askModel(geometry, type, style);
        stats.modelCalls += 1;
        if (!res) continue;
        stats.usd += res.usd;
        stats.ms += res.ms;
        const { pieces, dropped } = resolveSemanticProposal(geometry, res.proposal, style);
        if (valid(pieces, dropped, geometry, type)) {
          stats.modelValid += 1;
          write(geometry, type, style, keptProposal(res.proposal, pieces), res.rationale, MODEL);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    writeFileSync(path.join(outDir, 'stager-distill.summary.json'), JSON.stringify({ ...stats, live, at: new Date().toISOString(), out }, null, 2));
    console.table([{ ...stats, usd: Number(stats.usd.toFixed(4)), meanMs: stats.modelCalls ? Math.round(stats.ms / stats.modelCalls) : 0 }]);
    expect(stats.examples).toBeGreaterThan(0);
  });
});
