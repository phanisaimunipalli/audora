/**
 * A synthetic "photo" of an empty room, drawn on a canvas, so the anchor ritual can be
 * exercised in ?demo=1 without uploading a file. Rooms built from it are flagged
 * `synthetic` and are always simulated: they never reach a live reconstruction.
 */
import type { PhotoAnalysis } from '@/state/types';

/** Normalised bounding box of the door drawn on the left wall (matches drawDemoRoomPhoto). */
export const DEMO_DOOR_BOX = { x: 0.09, y: 0.277, w: 0.1, h: 0.615 };

export const DEMO_ANALYSIS: PhotoAnalysis = {
  roomType: 'living',
  roomTypeConfidence: 0.91,
  isEmpty: true,
  doorVisible: true,
  doorBox: DEMO_DOOR_BOX,
  quality: 'good',
  notes: ['Demo photo drawn in the browser. A real photo goes through the vision model.'],
  caption: 'A drawn, empty living room with a door on the left wall and a window ahead.',
  source: 'heuristic',
  model: 'demo',
  ms: 0,
};

type Pt = [number, number];

export function drawDemoRoomPhoto(w = 1280, h = 853): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const X = (f: number) => f * w;
  const Y = (f: number) => f * h;
  const poly = (pts: Pt[], fill: string, stroke?: string, lw = 2) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  };
  const line = (a: Pt, b: Pt, stroke: string, lw = 2) => {
    ctx.beginPath();
    ctx.moveTo(X(a[0]), Y(a[1]));
    ctx.lineTo(X(b[0]), Y(b[1]));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  };

  // One-point perspective. Far wall is the rectangle (0.25,0.2)-(0.75,0.7); vanishing point (0.5,0.45).
  const fx0 = 0.25, fx1 = 0.75, fy0 = 0.2, fy1 = 0.7;
  const vp: Pt = [0.5, 0.45];

  ctx.fillStyle = '#eee9e1';
  ctx.fillRect(0, 0, w, h);
  poly([[0, 0], [1, 0], [fx1, fy0], [fx0, fy0]], '#f3efe8'); // ceiling
  poly([[0, 1], [fx0, fy1], [fx1, fy1], [1, 1]], '#b58c60'); // floor
  // Plank lines converging on the vanishing point, clipped to the floor.
  ctx.save();
  ctx.beginPath();
  [[0, 1], [fx0, fy1], [fx1, fy1], [1, 1]].forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.closePath();
  ctx.clip();
  for (let i = -10; i <= 22; i++) line([i / 16, 1], vp, 'rgba(60,32,14,0.62)', 3);
  for (let k = 0; k < 14; k++) {
    // Board ends get closer together towards the far wall.
    const t = 1 - 0.3 * (1 - Math.pow(0.8, k));
    line([0, t], [1, t], 'rgba(60,32,14,0.5)', 2.5);
  }
  // Wood grain: faint streaks so the floor is not a flat fill.
  for (let i = 0; i < 260; i++) {
    const x = (i * 0.618) % 1;
    const y = fy1 + ((i * 0.377) % 1) * (1 - fy1);
    line([x, y], [x + 0.03, y + 0.004], `rgba(90,55,25,${0.12 + ((i * 7) % 5) * 0.03})`, 1);
  }
  ctx.restore();
  poly([[0, 0], [fx0, fy0], [fx0, fy1], [0, 1]], '#e6dfd2'); // left wall
  poly([[1, 0], [fx1, fy0], [fx1, fy1], [1, 1]], '#d9d1c3'); // right wall
  poly([[fx0, fy0], [fx1, fy0], [fx1, fy1], [fx0, fy1]], '#ede7dd'); // far wall
  // Cornice and wall panelling lines give the model edges to hold on to.
  line([0, 0], [fx0, fy0], '#d6cec0', 3);
  line([1, 0], [fx1, fy0], '#cbc2b3', 3);
  line([fx0, fy0], [fx1, fy0], '#dcd5c8', 3);
  line([0, 0.3], [fx0, 0.33], 'rgba(110,95,75,0.5)', 2.5);
  line([1, 0.3], [fx1, 0.33], 'rgba(110,95,75,0.5)', 2.5);
  line([fx0, 0.33], [fx1, 0.33], 'rgba(110,95,75,0.45)', 2.5);
  // Ceiling rose and a pendant flex.
  ctx.beginPath();
  ctx.arc(X(0.5), Y(0.06), 14, 0, Math.PI * 2);
  ctx.fillStyle = '#ddd6c9';
  ctx.fill();
  line([0.5, 0.06], [0.5, 0.15], '#8a7f70', 2);
  ctx.beginPath();
  ctx.arc(X(0.5), Y(0.165), 9, 0, Math.PI * 2);
  ctx.fillStyle = '#f0e6cf';
  ctx.fill();
  // Skirting boards.
  line([0, 1], [fx0, fy1], '#cfc4b3', 6);
  line([fx0, fy1], [fx1, fy1], '#cfc4b3', 6);
  line([fx1, fy1], [1, 1], '#cfc4b3', 6);
  // Window on the far wall with a soft light spill.
  const grad = ctx.createLinearGradient(X(0.42), 0, X(0.66), 0);
  grad.addColorStop(0, '#d8e8f4');
  grad.addColorStop(1, '#eef5fa');
  ctx.fillStyle = grad;
  ctx.fillRect(X(0.42), Y(0.3), X(0.24), Y(0.25));
  ctx.strokeStyle = '#f7f4ee';
  ctx.lineWidth = 8;
  ctx.strokeRect(X(0.42), Y(0.3), X(0.24), Y(0.25));
  line([0.54, 0.3], [0.54, 0.55], '#f7f4ee', 5);
  line([0.42, 0.425], [0.66, 0.425], '#f7f4ee', 5);
  // Door on the left wall, in perspective: top at 0.277/0.307, bottom at 0.892/0.772.
  const door: Pt[] = [[0.09, 0.277], [0.19, 0.307], [0.19, 0.772], [0.09, 0.892]];
  poly(door, '#cdbfad', '#bfae98', 6);
  poly([[0.105, 0.31], [0.175, 0.335], [0.175, 0.53], [0.105, 0.53]], '#c3b3a0');
  poly([[0.105, 0.56], [0.175, 0.56], [0.175, 0.745], [0.105, 0.845]], '#c3b3a0');
  ctx.beginPath();
  ctx.arc(X(0.178), Y(0.56), 7, 0, Math.PI * 2);
  ctx.fillStyle = '#8f7a5a';
  ctx.fill();
  // Power outlet low on the far wall.
  ctx.fillStyle = '#f6f3ee';
  ctx.fillRect(X(0.62), Y(0.655), X(0.018), Y(0.024));
  ctx.strokeStyle = '#cfc6b8';
  ctx.lineWidth = 2;
  ctx.strokeRect(X(0.62), Y(0.655), X(0.018), Y(0.024));
  // Gentle vignette so the frame reads as a photo.
  const v = ctx.createRadialGradient(X(0.5), Y(0.5), X(0.2), X(0.5), Y(0.5), X(0.75));
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(40,25,10,0.28)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.86);
}
