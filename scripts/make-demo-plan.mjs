/**
 * Draws the demo unit's floor plan — `public/demo/floorplan-oak-unit3.png`.
 *
 * The demo unit ("1247 Oak Street, Unit 3", shareId `oak1247`) is the one place the whole accuracy
 * argument can be seen without generating anything: a drawing that prints real dimensions, a model
 * measured against it, and the residual between them (docs/ACCURACY.md §1). So the drawing has to be
 * a real listing sheet — room rectangles laid out as a flat actually is, dimensions printed the way
 * a draughtsman prints them, door swings, a north arrow and a title block — and its numbers have to
 * be the ones `src/state/seed.ts` stores.
 *
 * Conventions, all of them borrowed from `evals/plans/make-plans.mjs` (read that first):
 *   - the sheet is laid out from a room table in **metres**, so the printed numbers are the table's
 *     numbers and nothing is measured off the picture;
 *   - the drawing is an SVG in an HTML page and headless Chrome rasterises it, so the project keeps
 *     its "no image dependency" rule;
 *   - nothing here reads a clock or a random source: the same table always draws the same PNG.
 *
 * `ROOMS` below is the authority for the *drawing*. `DEMO_PLAN_ROOMS` in `src/state/seed.ts` is the
 * authority for the *parsed plan* the store carries, and `tests/demo-plan.test.ts` pins the two
 * together the only way that matters: it re-reads each stored `dimensionsText` with the app's own
 * `metresFromDimensions` and requires the stored metres to come back. Change a dimension here and
 * you must change it there, or that test fails.
 *
 *   node scripts/make-demo-plan.mjs
 *
 * Writes public/demo/floorplan-oak-unit3.png and a copy at evals/plans/floorplan-oak-unit3.png (the
 * parser corpus; see evals/plans/manifest.json), then prints the manifest entry for that copy.
 */
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const PNG = path.resolve(ROOT, 'public/demo/floorplan-oak-unit3.png');
const EVAL_PNG = path.resolve(ROOT, 'evals/plans/floorplan-oak-unit3.png');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const INCH_M = 0.0254;

/** Metres per CSS pixel is the sheet's scale; 118 px/m puts the long edge near the 1600 px a vision model wants. */
const SCALE = 118;
/** Half the drawn wall thickness, metres. Rooms are tabled 2 × this apart, so their walls meet. */
const WALL = 0.1;
const PAD = 46;
const TITLE_H = 96;
const FOOT_H = 58;

const DOOR_W = 0.86;

/* ---------- the unit ----------
 *
 * x runs east, y runs south, both in metres; north is up the page, which is what the north arrow
 * says and what `buildUnitGraph` reads off it. Rooms are drawn to their inside faces and tabled
 * 0.20 m apart, so a 0.10 m half-wall each side meets in the middle of a 0.20 m partition.
 *
 * The layout is an SF top-floor Edwardian flat: living room and dining room across the front (the
 * living room's bay is the projecting corner), a corridor down the middle, and three rooms off the
 * back of it. Every room but the dining room opens off the hallway, which is what makes the graph
 * `inferAdjacency` builds (`shared/unitGraph.ts`) the one a renter would actually walk.
 */
const ROOMS = [
  { name: 'Living room', type: 'living', x: 0.0, y: 0.0, w: 5.3, h: 5.78 },
  { name: 'Dining room', type: 'dining', x: 5.5, y: 1.68, w: 3.3, h: 4.1 },
  { name: 'Hallway', type: 'hallway', x: 0.6, y: 5.98, w: 7.0, h: 1.2 },
  { name: 'Primary bedroom', type: 'bedroom', x: 0.0, y: 7.38, w: 3.3, h: 3.8 },
  { name: 'Second bedroom', type: 'bedroom', x: 3.5, y: 7.38, w: 2.8, h: 3.0 },
  { name: 'Corner room', type: 'bedroom', x: 6.5, y: 7.38, w: 3.0, h: 4.06 },
];

/**
 * A door between two rooms, on the partition they share.
 *
 * `axis` is the partition's own direction — `h` for a wall drawn horizontally (a constant y), `v`
 * for one drawn vertically. `at` is the wall's centre line, `pos` where the hinge-side jamb sits
 * along it, and `into` which side the leaf swings towards (+1 = east or south).
 */
const DOORS = [
  // Living room ↔ hallway: the corridor starts under the living room's south wall.
  { axis: 'h', at: 5.88, pos: 3.5, into: -1, hinge: 1, label: null },
  // Living room ↔ dining room, on the partition between the two front rooms.
  { axis: 'v', at: 5.4, pos: 2.6, into: 1, hinge: 1 },
  // Off the corridor: primary, second, corner.
  { axis: 'h', at: 7.28, pos: 1.0, into: 1, hinge: 1 },
  { axis: 'h', at: 7.28, pos: 4.0, into: 1, hinge: -1 },
  { axis: 'h', at: 7.28, pos: 7.05, into: 1, hinge: 1 },
  // The flat's own front door, at the east end of the corridor.
  { axis: 'v', at: 7.7, pos: 6.58, into: -1, hinge: 1, label: 'ENTRY' },
];

/** Windows, as a run along one exterior wall. `axis`/`at` read exactly as they do for a door. */
const WINDOWS = [
  { axis: 'h', at: -0.1, from: 1.1, to: 3.6 }, // living room, north (the bay)
  { axis: 'v', at: -0.1, from: 1.4, to: 3.2 }, // living room, west
  { axis: 'h', at: 1.58, from: 6.1, to: 8.2 }, // dining room, north
  { axis: 'v', at: 8.9, from: 2.6, to: 4.6 }, // dining room, east
  { axis: 'v', at: -0.1, from: 8.4, to: 10.2 }, // primary bedroom, west
  { axis: 'h', at: 11.28, from: 0.8, to: 2.5 }, // primary bedroom, south
  { axis: 'h', at: 10.48, from: 4.1, to: 5.7 }, // second bedroom, south
  { axis: 'v', at: 9.6, from: 8.1, to: 10.6 }, // corner room, east (the tall one)
  { axis: 'h', at: 11.54, from: 7.3, to: 8.6 }, // corner room, south (the small one)
];

/* ---------- printed dimensions ----------
 *
 * A draughtsman prints feet and inches and restates them in metres. Both forms are on the sheet and
 * the metric one is in brackets, because that is the form `metresFromDimensions`
 * (src/services/floorplan.ts) prefers — "the parenthesised metric restatement on a mixed-unit plan
 * is preferred, because it is the draughtsman's own conversion". So what the store holds is our own
 * reading of what is drawn, and not a second number that happens to agree.
 */

/** Metres → the nearest inch, as `17'-5"`. */
function feetInches(metres) {
  const inches = Math.round(metres / INCH_M);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
}

const metresText = (r) => `${r.w.toFixed(2)} × ${r.h.toFixed(2)} m`;
const feetText = (r) => `${feetInches(r.w)} × ${feetInches(r.h)}`;
/** Exactly what is printed beside the room, on one line, which is what the store records verbatim. */
const dimensionsText = (r) => `${feetText(r)} (${metresText(r)})`;

/* ---------- the building envelope ----------
 *
 * The rooms do not tile a rectangle (a flat with a projecting bay never does), so the outer wall is
 * the outline of their union rather than a bounding box. Grow every room by the half-wall first and
 * the rooms touch; then each edge of each grown room is part of the outline except where another
 * grown room lies immediately on its far side. Axis-aligned, so this is exact — no rasterising.
 */
const EPS = 1e-6;

function grown() {
  return ROOMS.map((r) => ({ x0: r.x - WALL, x1: r.x + r.w + WALL, y0: r.y - WALL, y1: r.y + r.h + WALL }));
}

/** [a, b] minus every interval in `cuts`, as the runs that survive. */
function subtract(a, b, cuts) {
  let runs = [[a, b]];
  for (const [c, d] of cuts) {
    const next = [];
    for (const [s, e] of runs) {
      if (d <= s + EPS || c >= e - EPS) {
        next.push([s, e]);
        continue;
      }
      if (c > s + EPS) next.push([s, c]);
      if (d < e - EPS) next.push([d, e]);
    }
    runs = next;
  }
  return runs.filter(([s, e]) => e - s > 0.02);
}

/** The union outline, as segments `{axis, at, from, to}` (axis `h` = a constant y). */
function envelope() {
  const boxes = grown();
  const out = [];
  boxes.forEach((r, i) => {
    const others = boxes.filter((_, j) => j !== i);
    // north and south edges: covered where another box lies on the far side and overlaps in x
    for (const [at, side] of [[r.y0, -1], [r.y1, 1]]) {
      const cuts = others
        .filter((s) => (side < 0 ? s.y0 < at - EPS && s.y1 > at - EPS : s.y1 > at + EPS && s.y0 < at + EPS))
        .map((s) => [Math.max(r.x0, s.x0), Math.min(r.x1, s.x1)])
        .filter(([a, b]) => b > a);
      for (const [from, to] of subtract(r.x0, r.x1, cuts)) out.push({ axis: 'h', at, from, to });
    }
    // west and east edges
    for (const [at, side] of [[r.x0, -1], [r.x1, 1]]) {
      const cuts = others
        .filter((s) => (side < 0 ? s.x0 < at - EPS && s.x1 > at - EPS : s.x1 > at + EPS && s.x0 < at + EPS))
        .map((s) => [Math.max(r.y0, s.y0), Math.min(r.y1, s.y1)])
        .filter(([a, b]) => b > a);
      for (const [from, to] of subtract(r.y0, r.y1, cuts)) out.push({ axis: 'v', at, from, to });
    }
  });
  return out;
}

/* ---------- drawing ---------- */

const INK = '#111111';
const PAPER = '#ffffff';
const FLOOR = '#fbfbf9';
const GLASS = '#6f6f6f';
const SANS = 'Helvetica, Arial, sans-serif';

const bounds = () => {
  const b = grown();
  return {
    x0: Math.min(...b.map((r) => r.x0)),
    x1: Math.max(...b.map((r) => r.x1)),
    y0: Math.min(...b.map((r) => r.y0)),
    y1: Math.max(...b.map((r) => r.y1)),
  };
};

const B = bounds();
const px = (v) => PAD + (v - B.x0) * SCALE;
const py = (v) => PAD + TITLE_H + (v - B.y0) * SCALE;
const len = (v) => v * SCALE;

const SHEET_W = Math.round(PAD * 2 + (B.x1 - B.x0) * SCALE);
const SHEET_H = Math.round(PAD * 2 + TITLE_H + FOOT_H + (B.y1 - B.y0) * SCALE);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function text(x, y, s, { size = 15, weight = 400, fill = INK, anchor = 'middle', track = 0 } = {}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${SANS}" font-size="${size}" font-weight="${weight}" fill="${fill}" letter-spacing="${track}">${esc(s)}</text>`;
}

/** The room boxes: floor fill and the inside face of every wall. */
function rooms() {
  return ROOMS.map((r) => {
    const x = px(r.x);
    const y = py(r.y);
    const w = len(r.w);
    const h = len(r.h);
    const cx = x + w / 2;
    const cy = y + h / 2;
    return [
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${FLOOR}" stroke="${INK}" stroke-width="3.5"/>`,
      text(cx, cy - 8, r.name.toUpperCase(), { size: 20, weight: 600, track: 1.1 }),
      text(cx, cy + 17, feetText(r), { size: 17 }),
      text(cx, cy + 38, `(${metresText(r)})`, { size: 15, fill: '#3c3c3c' }),
    ].join('\n');
  }).join('\n');
}

/** The outer wall, heavier than the partitions. */
function outerWall() {
  return envelope()
    .map((s) =>
      s.axis === 'h'
        ? `<line x1="${px(s.from)}" y1="${py(s.at)}" x2="${px(s.to)}" y2="${py(s.at)}" stroke="${INK}" stroke-width="8" stroke-linecap="square"/>`
        : `<line x1="${px(s.at)}" y1="${py(s.from)}" x2="${px(s.at)}" y2="${py(s.to)}" stroke="${INK}" stroke-width="8" stroke-linecap="square"/>`,
    )
    .join('\n');
}

/**
 * A door: the wall cleared over the opening, two jambs, the leaf and its swing.
 *
 * The leaf is drawn from the hinge jamb into `into`, and the arc runs from the far jamb round to the
 * leaf's tip — the quarter circle an estate agent's plan draws so a reader can see which way a door
 * opens and how much floor it takes.
 */
function door(d) {
  const half = DOOR_W / 2;
  const a = d.pos - half;
  const b = d.pos + half;
  const hingeAt = d.hinge > 0 ? a : b;
  const freeAt = d.hinge > 0 ? b : a;
  const parts = [];
  if (d.axis === 'h') {
    // clear the partition, both room strokes included
    parts.push(`<rect x="${px(a)}" y="${py(d.at) - len(WALL) - 2}" width="${len(DOOR_W)}" height="${2 * len(WALL) + 4}" fill="${PAPER}"/>`);
    parts.push(`<line x1="${px(a)}" y1="${py(d.at) - len(WALL)}" x2="${px(a)}" y2="${py(d.at) + len(WALL)}" stroke="${INK}" stroke-width="2.5"/>`);
    parts.push(`<line x1="${px(b)}" y1="${py(d.at) - len(WALL)}" x2="${px(b)}" y2="${py(d.at) + len(WALL)}" stroke="${INK}" stroke-width="2.5"/>`);
    const tipY = d.at + d.into * DOOR_W;
    parts.push(`<line x1="${px(hingeAt)}" y1="${py(d.at)}" x2="${px(hingeAt)}" y2="${py(tipY)}" stroke="${INK}" stroke-width="3"/>`);
    parts.push(
      `<path d="M ${px(freeAt)} ${py(d.at)} A ${len(DOOR_W)} ${len(DOOR_W)} 0 0 ${sweep(d)} ${px(hingeAt)} ${py(tipY)}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-dasharray="5 4"/>`,
    );
    if (d.label) parts.push(text(px(d.pos), py(d.at + d.into * 0.42) + 5, d.label, { size: 12, track: 1.4, fill: '#3c3c3c' }));
  } else {
    parts.push(`<rect x="${px(d.at) - len(WALL) - 2}" y="${py(a)}" width="${2 * len(WALL) + 4}" height="${len(DOOR_W)}" fill="${PAPER}"/>`);
    parts.push(`<line x1="${px(d.at) - len(WALL)}" y1="${py(a)}" x2="${px(d.at) + len(WALL)}" y2="${py(a)}" stroke="${INK}" stroke-width="2.5"/>`);
    parts.push(`<line x1="${px(d.at) - len(WALL)}" y1="${py(b)}" x2="${px(d.at) + len(WALL)}" y2="${py(b)}" stroke="${INK}" stroke-width="2.5"/>`);
    const tipX = d.at + d.into * DOOR_W;
    parts.push(`<line x1="${px(d.at)}" y1="${py(hingeAt)}" x2="${px(tipX)}" y2="${py(hingeAt)}" stroke="${INK}" stroke-width="3"/>`);
    parts.push(
      `<path d="M ${px(d.at)} ${py(freeAt)} A ${len(DOOR_W)} ${len(DOOR_W)} 0 0 ${sweep(d)} ${px(tipX)} ${py(hingeAt)}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-dasharray="5 4"/>`,
    );
    // The label goes on the far side of the wall from the swing, so it never lands under the arc.
    if (d.label) parts.push(text(px(d.at - d.into * 0.8), py(d.pos) + 5, d.label, { size: 12, track: 1.4, fill: '#3c3c3c' }));
  }
  return parts.join('\n');
}

/** Which way round the swing arc goes, in SVG's screen coordinates (y down). */
function sweep(d) {
  const clockwise = d.axis === 'h' ? d.into * d.hinge > 0 : d.into * d.hinge < 0;
  return clockwise ? 1 : 0;
}

/** A window: the wall cleared, then the glass line the plan symbol draws. */
function windowRun(w) {
  if (w.axis === 'h') {
    const y = py(w.at);
    return [
      `<rect x="${px(w.from)}" y="${y - 6}" width="${len(w.to - w.from)}" height="12" fill="${PAPER}"/>`,
      `<line x1="${px(w.from)}" y1="${y - 4}" x2="${px(w.to)}" y2="${y - 4}" stroke="${INK}" stroke-width="2"/>`,
      `<line x1="${px(w.from)}" y1="${y + 4}" x2="${px(w.to)}" y2="${y + 4}" stroke="${INK}" stroke-width="2"/>`,
      `<line x1="${px(w.from)}" y1="${y}" x2="${px(w.to)}" y2="${y}" stroke="${GLASS}" stroke-width="2"/>`,
    ].join('\n');
  }
  const x = px(w.at);
  return [
    `<rect x="${x - 6}" y="${py(w.from)}" width="12" height="${len(w.to - w.from)}" fill="${PAPER}"/>`,
    `<line x1="${x - 4}" y1="${py(w.from)}" x2="${x - 4}" y2="${py(w.to)}" stroke="${INK}" stroke-width="2"/>`,
    `<line x1="${x + 4}" y1="${py(w.from)}" x2="${x + 4}" y2="${py(w.to)}" stroke="${INK}" stroke-width="2"/>`,
    `<line x1="${x}" y1="${py(w.from)}" x2="${x}" y2="${py(w.to)}" stroke="${GLASS}" stroke-width="2"/>`,
  ].join('\n');
}

/** North up the page, drawn where a sheet draws it: the top right corner, clear of the plan. */
function northArrow() {
  const x = SHEET_W - PAD - 22;
  const y = PAD + 40;
  return `<g transform="translate(${x} ${y})">
    <circle cx="0" cy="0" r="25" fill="none" stroke="${INK}" stroke-width="1.4"/>
    <line x1="0" y1="15" x2="0" y2="-9" stroke="${INK}" stroke-width="2.6"/>
    <polygon points="0,-20 -7,-6 7,-6" fill="${INK}"/>
    ${text(0, 30, 'N', { size: 14, weight: 700 })}
  </g>`;
}

/** A 5 m bar, so the sheet says what it is drawn at as well as printing each room. */
function scaleBar() {
  const x = PAD;
  const y = SHEET_H - PAD + 6;
  const w = len(5);
  return `<g>
    <line x1="${x}" y1="${y}" x2="${x + w}" y2="${y}" stroke="${INK}" stroke-width="2"/>
    <line x1="${x}" y1="${y - 6}" x2="${x}" y2="${y + 6}" stroke="${INK}" stroke-width="2"/>
    <line x1="${x + w / 2}" y1="${y - 4}" x2="${x + w / 2}" y2="${y + 4}" stroke="${INK}" stroke-width="2"/>
    <line x1="${x + w}" y1="${y - 6}" x2="${x + w}" y2="${y + 6}" stroke="${INK}" stroke-width="2"/>
    ${text(x, y + 24, '0', { size: 12, anchor: 'middle' })}
    ${text(x + w, y + 24, '5 m', { size: 12, anchor: 'middle' })}
  </g>`;
}

const TITLE = '1247 Oak Street, Unit 3, third floor';
const FLOOR_LABEL = 'Third floor';

function svg() {
  return `<svg width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${SHEET_W}" height="${SHEET_H}" fill="${PAPER}"/>
  ${text(PAD, PAD + 22, TITLE, { size: 25, weight: 700, anchor: 'start', track: 0.3 })}
  ${text(PAD, PAD + 46, 'Two bedrooms and a corner room · approx. 1,180 sq ft · dimensions to the nearest inch, metric in brackets', { size: 13, anchor: 'start', fill: '#4a4a4a' })}
  ${text(PAD, PAD + 76, FLOOR_LABEL.toUpperCase(), { size: 15, weight: 700, anchor: 'start', track: 2 })}
  <line x1="${PAD}" y1="${PAD + 86}" x2="${SHEET_W - PAD - 70}" y2="${PAD + 86}" stroke="${INK}" stroke-width="1"/>
  ${outerWall()}
  ${rooms()}
  ${WINDOWS.map(windowRun).join('\n')}
  ${DOORS.map(door).join('\n')}
  ${northArrow()}
  ${scaleBar()}
  <line x1="${PAD}" y1="${SHEET_H - PAD - 30}" x2="${SHEET_W - PAD}" y2="${SHEET_H - PAD - 30}" stroke="${INK}" stroke-width="1"/>
  ${text(SHEET_W - PAD, SHEET_H - PAD - 6, 'Synthetic drawing · Audora demo unit · not a real property', { size: 12, anchor: 'end', fill: '#4a4a4a' })}
</svg>`;
}

/* ---------- run ---------- */

const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${PAPER}}</style>${svg()}`;

const tmp = path.join(os.tmpdir(), 'audora-demo-plan');
mkdirSync(tmp, { recursive: true });
const page = path.join(tmp, 'plan.html');
writeFileSync(page, html);
mkdirSync(path.dirname(PNG), { recursive: true });
execFileSync(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=ffffffff',
    '--virtual-time-budget=1500',
    `--screenshot=${PNG}`,
    `--window-size=${SHEET_W},${SHEET_H}`,
    `file://${page}`,
  ],
  { stdio: 'ignore' },
);
rmSync(tmp, { recursive: true, force: true });
copyFileSync(PNG, EVAL_PNG);
console.log(`wrote ${PNG} (${SHEET_W}×${SHEET_H}) and ${EVAL_PNG}`);

/* The ground truth for the parser corpus, exact by construction: the metres below are the same
   numbers the sheet prints. Paste into the synthetic half of evals/plans/manifest.json. */
console.log(
  '\nevals/plans/manifest.json entry:\n' +
    JSON.stringify(
      {
        file: 'floorplan-oak-unit3.png',
        kind: 'synthetic',
        title: TITLE,
        source: 'Generated by scripts/make-demo-plan.mjs (the app own demo unit floor plan)',
        license: 'own work',
        units: 'mixed',
        northArrow: true,
        dimensioned: true,
        floors: [{ label: FLOOR_LABEL, rooms: ROOMS.map((r) => ({ name: r.name, type: r.type, width: r.w, depth: r.h })) }],
        note: `${ROOMS.length} rooms, feet and inches with the metric restatement in brackets; the demo unit src/state/seed.ts carries as its parsed plan`,
      },
      null,
      2,
    ),
);

/* What src/state/seed.ts must hold, so a change here is easy to carry across. */
console.log('\nDEMO_PLAN_ROOMS:\n' + ROOMS.map((r) => `  ${r.name}: ${r.w.toFixed(2)} × ${r.h.toFixed(2)} m  "${dimensionsText(r)}"`).join('\n'));
