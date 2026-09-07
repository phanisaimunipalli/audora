/**
 * Builds the synthetic listing-style floor plans the parser is evaluated against.
 *
 * Every plan is laid out from a room table in real units (feet or metres), so the ground truth in
 * manifest.json is exact by construction: the same numbers that are printed on the drawing are the
 * ones the eval scores against. The drawing is an SVG in an HTML page; headless Chrome rasterises
 * it (no image dependency in the project).
 *
 *   node evals/plans/make-plans.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const OUT = path.resolve(process.cwd(), 'evals/plans');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FT = 0.3048;
const IN = 0.0254;

const m = (feet, inches = 0) => feet * FT + inches * IN;
const round2 = (v) => Math.round(v * 100) / 100;

/** 12, 4 → `12'-4"` (the form estate agents print). */
const ftText = (feet, inches) => `${feet}'-${inches}"`;
const mText = (v) => `${v.toFixed(2)} m`;

/**
 * A room in plan coordinates. `x, y, w, h` are in the plan's own unit (feet for a feet plan,
 * metres for a metric one); `w` is the printed width, `h` the printed depth.
 */
function rooms(list) {
  return list;
}

/* ---------- the plans ---------- */

const PLANS = [
  {
    file: 'apt-2bed-feet.png',
    title: 'Unit 4B · 1,180 sq ft',
    unit: 'feet',
    north: 'up',
    floors: [
      {
        label: 'Main floor',
        w: 34,
        h: 28,
        rooms: rooms([
          { name: 'Living Room', type: 'living', x: 0, y: 0, w: 16, wi: 0, h: 13, hi: 6 },
          { name: 'Kitchen', type: 'kitchen', x: 16, y: 0, w: 10, wi: 6, h: 9, hi: 0 },
          { name: 'Dining Area', type: 'dining', x: 26.5, y: 0, w: 7, wi: 6, h: 9, hi: 0 },
          { name: 'Primary Bedroom', type: 'bedroom', x: 0, y: 13.5, w: 13, wi: 0, h: 11, hi: 6 },
          { name: 'Bedroom 2', type: 'bedroom', x: 13, y: 15, w: 10, wi: 0, h: 10, hi: 0 },
          { name: 'Bathroom', type: 'bathroom', x: 23, y: 15, w: 8, wi: 0, h: 5, hi: 0 },
          { name: 'Hall', type: 'hallway', x: 16, y: 9, w: 12, wi: 0, h: 4, hi: 0 },
        ]),
      },
    ],
  },
  {
    file: 'apt-2bed-metres.png',
    title: 'Apartment 12 · 109 m²',
    unit: 'metres',
    north: 'right',
    floors: [
      {
        label: 'Apartment',
        w: 11.4,
        h: 9.6,
        rooms: rooms([
          { name: 'Living Room', type: 'living', x: 0, y: 0, w: 5.2, h: 4.35 },
          { name: 'Kitchen', type: 'kitchen', x: 5.4, y: 0, w: 3.15, h: 2.8 },
          { name: 'Dining Room', type: 'dining', x: 8.75, y: 0, w: 2.6, h: 2.8 },
          { name: 'Primary Bedroom', type: 'bedroom', x: 0, y: 4.6, w: 4.05, h: 3.6 },
          { name: 'Bedroom 2', type: 'bedroom', x: 4.25, y: 4.6, w: 3.2, h: 3.15 },
          { name: 'Bathroom', type: 'bathroom', x: 7.7, y: 4.6, w: 2.45, h: 1.7 },
          { name: 'Study', type: 'office', x: 5.4, y: 2.95, w: 3.0, h: 1.45 },
        ]),
      },
    ],
  },
  {
    file: 'studio-metres.png',
    title: 'Studio 3A · 41 m²',
    unit: 'metres',
    north: null,
    floors: [
      {
        label: 'Studio',
        w: 7.4,
        h: 6.2,
        rooms: rooms([
          { name: 'Studio', type: 'studio', x: 0, y: 0, w: 6.1, h: 4.2 },
          { name: 'Shower Room', type: 'bathroom', x: 0, y: 4.4, w: 2.4, h: 1.8 },
          { name: 'Entrance Hall', type: 'hallway', x: 2.6, y: 4.4, w: 2.6, h: 1.2 },
        ]),
      },
    ],
  },
  {
    file: 'townhouse-two-floors-feet.png',
    title: '221 Cedar Row · Townhouse',
    unit: 'feet',
    north: 'up',
    floors: [
      {
        label: 'Ground Floor',
        w: 24,
        h: 30,
        rooms: rooms([
          { name: 'Living Room', type: 'living', x: 0, y: 0, w: 14, wi: 0, h: 17, hi: 6 },
          { name: 'Kitchen', type: 'kitchen', x: 14.5, y: 0, w: 9, wi: 0, h: 12, hi: 0 },
          { name: 'Dining Room', type: 'dining', x: 0, y: 18, w: 12, wi: 6, h: 11, hi: 0 },
          { name: 'WC', type: 'bathroom', x: 14.5, y: 18, w: 6, wi: 0, h: 4, hi: 6 },
        ]),
      },
      {
        label: 'First Floor',
        w: 24,
        h: 30,
        rooms: rooms([
          { name: 'Bedroom 1', type: 'bedroom', x: 0, y: 0, w: 14, wi: 0, h: 12, hi: 0 },
          { name: 'Bedroom 2', type: 'bedroom', x: 14.5, y: 0, w: 9, wi: 6, h: 10, hi: 0 },
          { name: 'Bedroom 3', type: 'bedroom', x: 0, y: 13, w: 11, wi: 0, h: 9, hi: 6 },
          { name: 'Bathroom', type: 'bathroom', x: 12, y: 13, w: 8, wi: 0, h: 6, hi: 0 },
          { name: 'Landing', type: 'hallway', x: 0, y: 23, w: 15, wi: 0, h: 4, hi: 0 },
        ]),
      },
    ],
  },
  {
    file: 'bungalow-3bed-feet.png',
    title: '18 Willow Drive · Bungalow',
    unit: 'feet',
    north: 'left',
    floors: [
      {
        label: 'Bungalow',
        w: 42,
        h: 28,
        rooms: rooms([
          { name: 'Great Room', type: 'living', x: 0, y: 0, w: 18, wi: 0, h: 15, hi: 0 },
          { name: 'Kitchen', type: 'kitchen', x: 18.5, y: 0, w: 12, wi: 0, h: 11, hi: 0 },
          { name: 'Breakfast Nook', type: 'dining', x: 31, y: 0, w: 10, wi: 6, h: 8, hi: 0 },
          { name: 'Master Bedroom', type: 'bedroom', x: 0, y: 16, w: 15, wi: 0, h: 12, hi: 0 },
          { name: 'Bedroom 2', type: 'bedroom', x: 16, y: 16, w: 11, wi: 0, h: 10, hi: 6 },
          { name: 'Bedroom 3', type: 'bedroom', x: 28, y: 16, w: 10, wi: 0, h: 10, hi: 0 },
          { name: 'Master Bath', type: 'bathroom', x: 18.5, y: 11.5, w: 9, wi: 0, h: 4, hi: 0 },
          { name: 'Office', type: 'office', x: 28.5, y: 9, w: 9, wi: 0, h: 6, hi: 0 },
        ]),
      },
    ],
  },
  {
    file: 'loft-open-plan-metres.png',
    title: 'Warehouse Loft · 96 m²',
    unit: 'metres',
    north: 'up',
    floors: [
      {
        label: 'Loft',
        w: 13.0,
        h: 8.6,
        rooms: rooms([
          { name: 'Living / Dining', type: 'living', x: 0, y: 0, w: 7.85, h: 5.4 },
          { name: 'Kitchen', type: 'kitchen', x: 8.05, y: 0, w: 4.6, h: 3.05 },
          { name: 'Bedroom', type: 'bedroom', x: 8.05, y: 3.25, w: 4.6, h: 3.9 },
          { name: 'Bathroom', type: 'bathroom', x: 0, y: 5.6, w: 3.1, h: 2.4 },
          { name: 'Utility', type: 'other', x: 3.3, y: 5.6, w: 2.2, h: 1.9 },
        ]),
      },
    ],
  },
  {
    file: 'duplex-mixed-units.png',
    title: 'Duplex 7 · dimensions in feet and metres',
    unit: 'mixed',
    north: 'up',
    floors: [
      {
        label: 'Lower Level',
        w: 30,
        h: 24,
        rooms: rooms([
          { name: 'Family Room', type: 'living', x: 0, y: 0, w: 15, wi: 0, h: 12, hi: 0 },
          { name: 'Kitchen', type: 'kitchen', x: 16, y: 0, w: 11, wi: 0, h: 9, hi: 6 },
          { name: 'Powder Room', type: 'bathroom', x: 16, y: 10.5, w: 6, wi: 0, h: 4, hi: 0 },
          { name: 'Guest Bedroom', type: 'bedroom', x: 0, y: 13, w: 12, wi: 0, h: 10, hi: 0 },
        ]),
      },
    ],
  },
  {
    file: 'cottage-feet-no-arrow.png',
    title: 'Rose Cottage',
    unit: 'feet',
    north: null,
    floors: [
      {
        label: 'Cottage',
        w: 28,
        h: 22,
        rooms: rooms([
          { name: 'Sitting Room', type: 'living', x: 0, y: 0, w: 13, wi: 6, h: 12, hi: 0 },
          { name: 'Kitchen', type: 'kitchen', x: 14, y: 0, w: 10, wi: 0, h: 9, hi: 0 },
          { name: 'Bedroom', type: 'bedroom', x: 0, y: 13, w: 12, wi: 0, h: 8, hi: 6 },
          { name: 'Bathroom', type: 'bathroom', x: 13, y: 13, w: 7, wi: 0, h: 6, hi: 0 },
        ]),
      },
    ],
  },
];

/* ---------- drawing ---------- */

/** Metres of a room's printed width / depth, whatever unit the plan prints. */
function metresOf(plan, r) {
  if (plan.unit === 'metres') return { width: round2(r.w), depth: round2(r.h) };
  return { width: round2(m(r.w, r.wi || 0)), depth: round2(m(r.h, r.hi || 0)) };
}

function dimsText(plan, r) {
  if (plan.unit === 'metres') return `${r.w.toFixed(2)} × ${r.h.toFixed(2)} m`;
  const a = ftText(Math.floor(r.w), r.wi || 0);
  const b = ftText(Math.floor(r.h), r.hi || 0);
  if (plan.unit === 'mixed') {
    const mm = metresOf(plan, r);
    return `${a} × ${b}  (${mm.width.toFixed(2)} × ${mm.depth.toFixed(2)} m)`;
  }
  return `${a} × ${b}`;
}

const NORTH_ROT = { up: 0, right: 90, down: 180, left: 270 };

/** Page size in CSS pixels, so the screenshot is the drawing and not a sea of white. */
function size(plan) {
  const scale = plan.unit === 'metres' ? 62 : 19;
  const pad = 34;
  let w = 0;
  let h = 0;
  for (const f of plan.floors) {
    const ext = floorExtent(plan, f);
    w += ext.w * scale + pad * 2 + 26;
    h = Math.max(h, ext.h * scale + pad * 2 + 44);
  }
  return { w: Math.round(w + 30), h: Math.round(h + 74) };
}

/** Printed width / depth of a room in the plan's own unit (feet plans carry inches separately). */
const unitW = (plan, r) => (plan.unit === 'metres' ? r.w : r.w + (r.wi || 0) / 12);
const unitH = (plan, r) => (plan.unit === 'metres' ? r.h : r.h + (r.hi || 0) / 12);

/** The floor's own extent, from the rooms it holds plus a hairline of outer wall. */
function floorExtent(plan, floor) {
  const w = Math.max(...floor.rooms.map((r) => r.x + unitW(plan, r)));
  const h = Math.max(...floor.rooms.map((r) => r.y + unitH(plan, r)));
  const margin = plan.unit === 'metres' ? 0.25 : 0.8;
  return { w: w + margin, h: h + margin };
}

function svgFloor(plan, floor, scale, pad) {
  const px = (v) => pad + v * scale;
  const parts = [];
  const ext = floorExtent(plan, floor);
  parts.push(`<rect x="${pad - 6}" y="${pad - 6}" width="${ext.w * scale + 12}" height="${ext.h * scale + 12}" fill="none" stroke="#111" stroke-width="7"/>`);
  for (const r of floor.rooms) {
    const x = px(r.x);
    const y = px(r.y);
    const w = unitW(plan, r) * scale;
    const h = unitH(plan, r) * scale;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fbfbf9" stroke="#111" stroke-width="4"/>`);
    // A door gap on the bottom wall, and a window on the top wall.
    parts.push(`<line x1="${x + w * 0.3}" y1="${y + h}" x2="${x + w * 0.3 + Math.min(30, w * 0.28)}" y2="${y + h}" stroke="#fbfbf9" stroke-width="6"/>`);
    parts.push(`<line x1="${x + w * 0.35}" y1="${y}" x2="${x + w * 0.65}" y2="${y}" stroke="#7a7a7a" stroke-width="6"/>`);
    parts.push(
      `<text x="${x + w / 2}" y="${y + h / 2 - 4}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="600" fill="#111" letter-spacing="0.5">${r.name.toUpperCase()}</text>`,
    );
    parts.push(
      `<text x="${x + w / 2}" y="${y + h / 2 + 18}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#333">${dimsText(plan, r)}</text>`,
    );
  }
  return parts.join('\n');
}

function html(plan) {
  const scale = plan.unit === 'metres' ? 62 : 19;
  const pad = 34;
  const floors = plan.floors
    .map((f) => {
      const ext = floorExtent(plan, f);
      const w = ext.w * scale + pad * 2;
      const h = ext.h * scale + pad * 2 + 44;
      const arrow =
        plan.north != null
          ? `<g transform="translate(${w - 46} 40) rotate(${NORTH_ROT[plan.north]})"><line x1="0" y1="16" x2="0" y2="-16" stroke="#111" stroke-width="3"/><polygon points="0,-22 -7,-8 7,-8" fill="#111"/><text x="0" y="30" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#111">N</text></g>`
          : '';
      return `<div class="sheet"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <rect width="${w}" height="${h}" fill="#ffffff"/>
        <text x="${pad}" y="${h - 14}" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="700" fill="#111">${f.label.toUpperCase()}</text>
        <g transform="translate(0 24)">${svgFloor(plan, f, scale, pad)}</g>
        ${arrow}
      </svg></div>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#fff;font-family:Helvetica,Arial,sans-serif;color:#111}
    .page{display:inline-block;padding:22px 26px}
    h1{font-size:19px;margin:0 0 4px;letter-spacing:0.4px}
    .sub{font-size:12px;color:#555;margin:0 0 14px}
    .sheets{display:flex;gap:26px;align-items:flex-start}
  </style><div class="page"><h1>${plan.title}</h1><p class="sub">Floor plan · not to scale · all dimensions approximate</p><div class="sheets">${floors}</div></div>`;
}

/* ---------- run ---------- */

mkdirSync(OUT, { recursive: true });
const tmp = path.join(os.tmpdir(), `audora-plans-${Date.now()}`);
mkdirSync(tmp, { recursive: true });

const manifestPlans = [];
for (const plan of PLANS) {
  const file = path.join(tmp, plan.file.replace('.png', '.html'));
  writeFileSync(file, html(plan));
  const out = path.join(OUT, plan.file);
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=ffffffff',
      '--virtual-time-budget=1500',
      `--screenshot=${out}`,
      `--window-size=${size(plan).w},${size(plan).h}`,
      `file://${file}`,
    ],
    { stdio: 'ignore' },
  );
  manifestPlans.push({
    file: plan.file,
    kind: 'synthetic',
    title: plan.title,
    source: 'Generated by evals/plans/make-plans.mjs',
    license: 'own work',
    units: plan.unit === 'mixed' ? 'mixed' : plan.unit,
    northArrow: plan.north != null,
    dimensioned: true,
    floors: plan.floors.map((f) => ({
      label: f.label,
      rooms: f.rooms.map((r) => ({ name: r.name, type: r.type, ...metresOf(plan, r) })),
    })),
    note: `${plan.floors.reduce((a, f) => a + f.rooms.length, 0)} rooms, dimensions printed in ${plan.unit}`,
  });
  console.log('wrote', out);
}

/* The ground truth for these eight plans is written beside them; the three real plans in
   manifest.json are hand-labelled and must not be overwritten, so this writes a separate file to
   merge rather than the manifest itself. */
writeFileSync(path.join(OUT, 'synthetic.json'), JSON.stringify({ plans: manifestPlans }, null, 2));
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${manifestPlans.length} plans → evals/plans/synthetic.json. Merge its "plans" into the synthetic half of manifest.json (the three real plans there are hand-labelled), then delete it.`);
