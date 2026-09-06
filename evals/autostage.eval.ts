/**
 * Auto-stage evaluation — the Nebius Token Factory task Audora depends on most.
 *
 * Task: given a metric room (dimensions, door, windows, type, style) propose a furniture arrangement
 * from the catalog. The geometry engine is the judge: a layout is VALID when every proposed piece
 * stays inside the walls, overlaps nothing, keeps the door swing clear, and the narrowest walkway is
 * at least 0.75 m. We also check that the room's essentials are present (a bed in a bedroom, ...).
 *
 * Systems compared: the rule-based stager (no model), the fast model, and the large model, both via
 * the same /api/ai/chat proxy the product uses (so latency and USD are what a user would pay).
 *
 * Run:  npm run dev   (in another terminal)   then   npm run eval
 * Env:  EVAL_REPEATS=3 to sample each room several times; EVAL_MODELS=fast,text to choose models.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyScale } from '@/engine/anchor';
import { autoStage, isEssentialKind, repairProposal, resolveSemanticProposal, validateProposal, type SemanticPiece, type StagingStyle } from '@/engine/autostage';
import { catalogItem } from '@/engine/catalog';
import { fitReport } from '@/engine/fit';
import type { PlacedPiece, RoomGeometry, RoomType } from '@/engine/types';
import { mockRawGeometry } from '@/services/mockWorld';
import { SEMANTIC_STAGE_SCHEMA, SEMANTIC_STAGE_SYSTEM, STAGE_SCHEMA, STAGE_SYSTEM, semanticStagePrompt, stagePrompt } from '@/services/ai';

const BASE = process.env.EVAL_BASE || 'http://localhost:5173';
const REPEATS = Number(process.env.EVAL_REPEATS || 1);
const MODELS = (process.env.EVAL_MODELS || 'fast,text').split(',').map((s) => s.trim()).filter(Boolean);
const MODES = (process.env.EVAL_MODES || 'coords,semantic').split(',').map((s) => s.trim()).filter(Boolean) as Mode[];

interface Case {
  id: string;
  type: RoomType;
  style: StagingStyle;
  geometry: RoomGeometry;
  note: string;
}

function fromSeed(id: string, type: RoomType, style: StagingStyle, note: string): Case {
  return { id, type, style, geometry: applyScale(mockRawGeometry(`eval:${id}`, type), 2.03), note };
}

const CASES: Case[] = [
  fromSeed('living-a', 'living', 'warm', 'typical living room'),
  fromSeed('living-b', 'living', 'minimal', 'typical living room, minimal'),
  fromSeed('living-c', 'living', 'family', 'typical living room, family'),
  {
    id: 'living-narrow',
    type: 'living',
    style: 'scandi',
    note: 'long and narrow (3.1 × 7.0): sofa must go on a long wall',
    geometry: { width: 3.1, depth: 7.0, height: 2.5, door: { wall: 'south', offset: 0.8, width: 0.86, height: 2.03 }, windows: [{ wall: 'north', offset: 1.55, width: 1.6, height: 1.3, sill: 0.9 }] },
  },
  fromSeed('bedroom-a', 'bedroom', 'warm', 'typical bedroom'),
  fromSeed('bedroom-b', 'bedroom', 'scandi', 'typical bedroom'),
  {
    id: 'bedroom-tiny',
    type: 'bedroom',
    style: 'minimal',
    note: 'tiny bedroom (2.6 × 2.9): only a double bed fits with a walkway',
    geometry: { width: 2.6, depth: 2.9, height: 2.4, door: { wall: 'south', offset: 0.6, width: 0.8, height: 2.03 }, windows: [{ wall: 'north', offset: 1.3, width: 1.2, height: 1.2, sill: 0.9 }] },
  },
  {
    id: 'bedroom-door-east',
    type: 'bedroom',
    style: 'warm',
    note: 'door on the east wall: the bed must not face away from the entry',
    geometry: { width: 3.6, depth: 4.0, height: 2.6, door: { wall: 'east', offset: 0.7, width: 0.86, height: 2.03 }, windows: [{ wall: 'west', offset: 2.0, width: 1.4, height: 1.3, sill: 0.9 }] },
  },
  fromSeed('dining-a', 'dining', 'warm', 'typical dining room'),
  {
    id: 'dining-small',
    type: 'dining',
    style: 'minimal',
    note: 'small dining (2.9 × 3.1): a table for six does not leave 0.75 m',
    geometry: { width: 2.9, depth: 3.1, height: 2.5, door: { wall: 'south', offset: 1.45, width: 0.86, height: 2.03 }, windows: [] },
  },
  fromSeed('office-a', 'office', 'minimal', 'typical office'),
  fromSeed('studio-a', 'studio', 'family', 'studio: bed and living zones in one room'),
];

const ESSENTIALS: Record<string, string[][]> = {
  living: [['sofa', 'sectional'], ['coffeeTable']],
  bedroom: [['bed']],
  dining: [['diningSet']],
  office: [['desk'], ['officeChair']],
  studio: [['bed'], ['sofa', 'sectional']],
};

interface Score {
  system: string;
  caseId: string;
  proposed: number;
  kept: number;
  dropped: { itemId: string; reason: string; optional?: boolean }[];
  droppedEssential: number;
  valid: boolean;
  essentials: boolean;
  walkway: number | null;
  walkable: boolean;
  parseError?: string;
  ms: number;
  usd: number;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
}

function score(system: string, c: Case, pieces: PlacedPiece[], dropped: Score['dropped'], proposed: number, ms: number, usd: number, extra?: Partial<Score>): Score {
  const rep = fitReport(pieces, c.geometry);
  const kinds = new Set(pieces.map((p) => p.kind));
  const essentials = (ESSENTIALS[c.type] || []).every((alts) => alts.some((k) => kinds.has(k as PlacedPiece['kind'])));
  const walkable = rep.narrowestWalkway == null || rep.narrowestWalkway >= 0.75;
  const droppedEssential = dropped.filter((d) => {
    if (typeof d.optional === 'boolean') return !d.optional;
    const it = catalogItem(d.itemId);
    return it ? isEssentialKind(it.kind) : true;
  }).length;
  return {
    system,
    caseId: c.id,
    proposed,
    kept: pieces.length,
    dropped,
    droppedEssential,
    valid: droppedEssential === 0 && rep.misfits.length === 0 && rep.blocksDoor.length === 0 && walkable && essentials,
    essentials,
    walkway: rep.narrowestWalkway,
    walkable,
    ms,
    usd,
    ...extra,
  };
}

type Mode = 'coords' | 'semantic';

/** One model call; returns the parsed proposal plus timing/cost. Coordinates mode is scored twice (strict and repaired). */
async function askModel(model: string, mode: Mode, c: Case): Promise<Score[]> {
  const t0 = Date.now();
  const semantic = mode === 'semantic';
  const r = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task: `eval_autostage_${mode}_${model}`,
      model,
      messages: [
        { role: 'system', content: semantic ? SEMANTIC_STAGE_SYSTEM : STAGE_SYSTEM },
        { role: 'user', content: semantic ? semanticStagePrompt(c.geometry, c.type, c.style) : stagePrompt(c.geometry, c.type, c.style) },
      ],
      schema: semantic ? SEMANTIC_STAGE_SCHEMA : STAGE_SCHEMA,
      schemaName: 'staging',
      temperature: 0.4,
      max_tokens: 900,
    }),
  });
  const body: any = await r.json();
  const ms = body.ms ?? Date.now() - t0;
  const label = `${model}:${mode}`;
  if (!r.ok) return [score(label, c, [], [], 0, ms, 0, { parseError: body.error || `${r.status}` })];
  let proposal: any[] = [];
  let parseError: string | undefined;
  try {
    const text = String(body.content || '').trim();
    const j = JSON.parse(text.startsWith('{') ? text : (/\{[\s\S]*\}/.exec(text)?.[0] ?? '{}'));
    proposal = Array.isArray(j.pieces) ? j.pieces : [];
  } catch (e: any) {
    parseError = e?.message;
  }
  const extra = { parseError, model: body.model, tokensIn: body.usage?.prompt_tokens, tokensOut: body.usage?.completion_tokens };
  const usd = body.usd ?? 0;
  if (semantic) {
    const { pieces, dropped } = resolveSemanticProposal(c.geometry, proposal as SemanticPiece[], c.style);
    return [score(label, c, pieces, dropped, proposal.length, ms, usd, extra)];
  }
  const strict = validateProposal(c.geometry, proposal, c.style);
  const repaired = repairProposal(c.geometry, proposal, c.style);
  return [
    score(label, c, strict.pieces, strict.dropped, proposal.length, ms, usd, extra),
    score(`${model}:coords+repair`, c, repaired.pieces, repaired.dropped, proposal.length, ms, usd, extra),
  ];
}

function summarize(scores: Score[]) {
  const by = new Map<string, Score[]>();
  for (const s of scores) by.set(s.system, [...(by.get(s.system) || []), s]);
  const rows = [...by].map(([system, list]) => {
    const n = list.length;
    const pct = (f: (s: Score) => boolean) => Math.round((list.filter(f).length / n) * 100);
    const mean = (f: (s: Score) => number) => list.reduce((a, s) => a + f(s), 0) / n;
    const droppedTotal = list.reduce((a, s) => a + s.dropped.length, 0);
    const proposedTotal = list.reduce((a, s) => a + s.proposed, 0);
    return {
      system,
      runs: n,
      validPct: pct((s) => s.valid),
      essentialsPct: pct((s) => s.essentials),
      walkablePct: pct((s) => s.walkable),
      keptRatioPct: proposedTotal ? Math.round(((proposedTotal - droppedTotal) / proposedTotal) * 100) : 100,
      parseErrors: list.filter((s) => s.parseError).length,
      meanPieces: Number(mean((s) => s.kept).toFixed(1)),
      meanMs: Math.round(mean((s) => s.ms)),
      meanUsd: Number(mean((s) => s.usd).toFixed(5)),
      totalUsd: Number(list.reduce((a, s) => a + s.usd, 0).toFixed(4)),
    };
  });
  return rows;
}

function markdown(rows: ReturnType<typeof summarize>, scores: Score[], startedAt: string) {
  const lines: string[] = [];
  lines.push(`# Auto-stage evaluation — ${startedAt}`);
  lines.push('');
  lines.push(`${CASES.length} rooms × ${REPEATS} repeat(s). A layout is valid when no essential piece had to be dropped (decor may be), every piece is inside the walls, overlaps nothing, keeps the door swing clear, the narrowest walkway between corridor-defining pieces is ≥ 0.75 m, and the room's essentials are present (sofa + coffee table for living, bed for bedroom, dining set for dining, desk + chair for office).`);
  lines.push('');
  lines.push('Systems: **heuristic** = rule-based stager (no model). **model:coords** = the model returns x/z/rot in metres and the engine keeps or drops each piece. **model:coords+repair** = same proposal, but the engine searches nearby for a valid spot before dropping. **model:semantic** = the model describes placements in words (wall / in front of / beside / opposite / corner) and the engine computes and repairs positions.');
  lines.push('');
  lines.push('| system | runs | valid | essentials | walkable | pieces kept / proposed | parse errors | mean pieces | mean ms | mean $ | total $ |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) lines.push(`| ${r.system} | ${r.runs} | ${r.validPct}% | ${r.essentialsPct}% | ${r.walkablePct}% | ${r.keptRatioPct}% | ${r.parseErrors} | ${r.meanPieces} | ${r.meanMs} | ${r.meanUsd} | ${r.totalUsd} |`);
  lines.push('');
  lines.push('## Per room');
  lines.push('');
  lines.push('| room | system | proposed | kept | valid | essentials | walkway | dropped (reason) | ms | $ |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of scores) {
    lines.push(`| ${s.caseId} | ${s.system} | ${s.proposed} | ${s.kept} | ${s.valid ? '✓' : '✗'} | ${s.essentials ? '✓' : '✗'} | ${s.walkway == null ? '—' : s.walkway.toFixed(2) + ' m'} | ${s.dropped.map((d) => `${d.itemId} (${d.reason})`).join(', ') || (s.parseError ? `parse: ${s.parseError}` : '')} | ${s.ms} | ${s.usd.toFixed(5)} |`);
  }
  lines.push('');
  // Show the struggle for the production system (large model, semantic placement) first, then the rest.
  const production = scores.filter((s) => s.system === 'text:semantic' && !s.valid);
  const pool = production.length ? production : scores.filter((s) => s.system !== 'heuristic');
  const worst = [...pool].sort((a, b) => b.droppedEssential - a.droppedEssential || b.dropped.length - a.dropped.length || (a.valid ? 1 : 0) - (b.valid ? 1 : 0))[0];
  if (worst) {
    const c = CASES.find((x) => x.id === worst.caseId)!;
    lines.push('## Struggle case');
    lines.push('');
    lines.push(`**${c.id}** (${c.note}) with ${worst.system}: ${worst.proposed} proposed, ${worst.dropped.length} dropped — ${worst.dropped.map((d) => `${d.itemId}: ${d.reason}`).join('; ') || 'none'}. Walkway ${worst.walkway == null ? 'n/a' : worst.walkway.toFixed(2) + ' m'}.`);
    lines.push('');
    lines.push('The engine drops invalid pieces rather than showing them, so a buyer never sees an overlapping sofa; the cost of a bad proposal is a sparser room, not a wrong one.');
  }
  return lines.join('\n');
}

describe('auto-stage evaluation', () => {
  it('scores the rule-based stager and the live models', async () => {
    const startedAt = new Date().toISOString();
    const scores: Score[] = [];

    for (const c of CASES) {
      const t0 = performance.now();
      const pieces = autoStage(c.geometry, c.type, c.style);
      scores.push(score('heuristic', c, pieces, [], pieces.length, Math.round(performance.now() - t0), 0));
    }

    let live = false;
    try {
      const st: any = await (await fetch(`${BASE}/api/status`)).json();
      live = Boolean(st.nebius);
    } catch {
      live = false;
    }
    if (live) {
      for (const model of MODELS) {
        for (const mode of MODES) {
          for (let r = 0; r < REPEATS; r++) {
            for (const c of CASES) scores.push(...(await askModel(model, mode, c)));
          }
        }
      }
    } else {
      console.warn('Dev server not reachable or NEBIUS_API_KEY missing: only the rule-based stager was scored.');
    }

    const rows = summarize(scores);
    console.table(rows);
    const outDir = path.resolve(process.cwd(), 'evals/results');
    mkdirSync(outDir, { recursive: true });
    const stamp = startedAt.replace(/[:.]/g, '-');
    writeFileSync(path.join(outDir, `autostage-${stamp}.json`), JSON.stringify({ startedAt, base: BASE, repeats: REPEATS, models: MODELS, cases: CASES.map((c) => ({ id: c.id, type: c.type, style: c.style, note: c.note, geometry: c.geometry })), rows, scores }, null, 2));
    writeFileSync(path.join(outDir, process.env.EVAL_TAG ? `autostage-${process.env.EVAL_TAG}.md` : 'autostage-latest.md'), markdown(rows, scores, startedAt));

    // The rule-based stager is the floor: it must always be valid on these rooms.
    const heuristic = rows.find((r) => r.system === 'heuristic')!;
    expect(heuristic.validPct).toBeGreaterThanOrEqual(90);
  });
});
