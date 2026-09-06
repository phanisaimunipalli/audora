import { useId } from 'react';
import { corners, extents, wallFeaturePosition } from '@/engine/geometry';
import type { PlacedPiece, RoomGeometry, Vec2 } from '@/engine/types';
import { cx } from '@/components/ui';

export interface RoomPlanProps {
  room: RoomGeometry;
  staging: PlacedPiece[];
  /** The buyer's piece, drawn in buyer blue. */
  buyer?: PlacedPiece | null;
  showSeller?: boolean;
  /** Nearest walkway to draw as a dimension line. */
  gap?: { a: Vec2; b: Vec2; metres: number } | null;
  /** Colours the buyer outline: blue when it fits, red when it does not. */
  fits?: boolean;
  labels?: boolean;
  className?: string;
}

const INK = '#f4eee5';
const INK3 = '#7f7468';
const FLOOR = '#1b1816';
const WALL = '#bfb3a3';
const BUYER = '#62a0ff';
const DANGER = '#e05d5d';
const ACCENT = '#e8734a';

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const pts = (p: PlacedPiece) =>
  corners(p)
    .map((c) => `${c.x.toFixed(3)},${c.z.toFixed(3)}`)
    .join(' ');

/** Rotate a label to run along the piece's long axis when it stands tall on the plan. */
function labelTransform(p: PlacedPiece): string | undefined {
  const { ex, ez } = extents(p);
  return ez > ex * 1.15 ? `rotate(-90 ${p.x.toFixed(3)} ${p.z.toFixed(3)})` : undefined;
}

function arcPoints(centre: Vec2, from: Vec2, to: Vec2, r: number): string {
  const a0 = Math.atan2(from.z - centre.z, from.x - centre.x);
  let a1 = Math.atan2(to.z - centre.z, to.x - centre.x);
  while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
  while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
  const out: string[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(`${(centre.x + Math.cos(a) * r).toFixed(3)},${(centre.z + Math.sin(a) * r).toFixed(3)}`);
  }
  return out.join(' ');
}

/**
 * Top-down plan of a room in metres. Seller staging is drawn in its own colours, the buyer's piece
 * in buyer blue, and the nearest walkway as a dimension line. Pure SVG: no WebGL needed.
 */
export function RoomPlan({ room, staging, buyer, showSeller = true, gap, fits = true, labels = true, className }: RoomPlanProps) {
  const uid = useId();
  const W = room.width;
  const D = room.depth;
  const pad = labels ? 0.62 : 0.3;
  const vb = `${(-W / 2 - pad).toFixed(3)} ${(-D / 2 - pad).toFixed(3)} ${(W + pad * 2).toFixed(3)} ${(D + pad * 2).toFixed(3)}`;
  const door = room.door;
  const dp = wallFeaturePosition(room, door.wall, door.offset);
  const half = door.width / 2;
  const hinge: Vec2 = { x: dp.x - dp.along.x * half, z: dp.z - dp.along.z * half };
  const jamb: Vec2 = { x: dp.x + dp.along.x * half, z: dp.z + dp.along.z * half };
  const tip: Vec2 = { x: hinge.x + dp.inward.x * door.width, z: hinge.z + dp.inward.z * door.width };
  const gridX: number[] = [];
  for (let i = Math.ceil(-W / 2); i <= Math.floor(W / 2); i++) gridX.push(i);
  const gridZ: number[] = [];
  for (let i = Math.ceil(-D / 2); i <= Math.floor(D / 2); i++) gridZ.push(i);
  const buyerStroke = fits ? BUYER : DANGER;
  const mono = { fontFamily: 'var(--font-mono)' } as const;
  const sans = { fontFamily: 'var(--font-sans)' } as const;
  // A dark halo behind text keeps labels readable where pieces overlap or a big piece covers a dimension.
  const halo = { paintOrder: 'stroke', stroke: FLOOR, strokeWidth: 0.07, strokeLinejoin: 'round' } as const;

  return (
    <svg viewBox={vb} className={cx('block h-auto w-full', className)} role="img" aria-label={`Floor plan, ${W.toFixed(2)} by ${D.toFixed(2)} metres`}>
      <defs>
        <clipPath id={`${uid}-floor`}>
          <rect x={-W / 2} y={-D / 2} width={W} height={D} />
        </clipPath>
      </defs>
      <rect x={-W / 2} y={-D / 2} width={W} height={D} fill={FLOOR} />
      <g clipPath={`url(#${uid}-floor)`} stroke="rgba(244,238,229,0.06)" strokeWidth={0.015}>
        {gridX.map((x) => (
          <line key={`gx${x}`} x1={x} y1={-D / 2} x2={x} y2={D / 2} />
        ))}
        {gridZ.map((z) => (
          <line key={`gz${z}`} x1={-W / 2} y1={z} x2={W / 2} y2={z} />
        ))}
      </g>

      {/* seller staging: never blue */}
      {showSeller
        ? staging.map((p) => {
            const color = p.color ?? '#8d7b6a';
            const dark = luminance(color) < 0.42;
            const big = p.w * p.d >= 0.45 && !p.flat;
            return (
              <g key={p.id}>
                <polygon points={pts(p)} fill={color} fillOpacity={p.flat ? 0.28 : 0.92} stroke={p.flat ? color : '#0e0d0c'} strokeOpacity={p.flat ? 0.6 : 0.7} strokeWidth={p.flat ? 0.02 : 0.03} strokeDasharray={p.flat ? '0.08 0.06' : undefined} />
                {big && labels ? (
                  <text x={p.x} y={p.z + 0.06} textAnchor="middle" fontSize={0.16} fill={dark ? INK : '#1a1512'} fillOpacity={buyer && Math.hypot(buyer.x - p.x, buyer.z - p.z) < 0.6 ? 0.25 : 0.85} style={sans} transform={labelTransform(p)}>
                    {p.name}
                  </text>
                ) : null}
              </g>
            );
          })
        : null}

      {/* walls with the door cut out */}
      <rect x={-W / 2} y={-D / 2} width={W} height={D} fill="none" stroke={WALL} strokeWidth={0.1} />
      {room.windows.map((w, i) => {
        const p = wallFeaturePosition(room, w.wall, w.offset);
        const h = w.width / 2;
        return <line key={`win${i}`} x1={p.x - p.along.x * h} y1={p.z - p.along.z * h} x2={p.x + p.along.x * h} y2={p.z + p.along.z * h} stroke="#dfe9f2" strokeWidth={0.1} />;
      })}
      <line x1={hinge.x} y1={hinge.z} x2={jamb.x} y2={jamb.z} stroke={FLOOR} strokeWidth={0.14} />
      <line x1={hinge.x} y1={hinge.z} x2={tip.x} y2={tip.z} stroke={INK} strokeWidth={0.04} />
      <polyline points={arcPoints(hinge, tip, jamb, door.width)} fill="none" stroke={INK} strokeOpacity={0.5} strokeWidth={0.02} strokeDasharray="0.06 0.05" />

      {/* buyer piece: always blue */}
      {buyer ? (
        <g>
          <polygon points={pts(buyer)} fill={buyerStroke} fillOpacity={0.26} stroke={buyerStroke} strokeWidth={0.05} strokeLinejoin="round" />
          {labels ? (
            <g transform={labelTransform(buyer)}>
              <text x={buyer.x} y={buyer.z - 0.03} textAnchor="middle" fontSize={0.19} fontWeight={500} fill={buyerStroke} style={{ ...sans, ...halo }}>
                {buyer.name}
              </text>
              <text x={buyer.x} y={buyer.z + 0.2} textAnchor="middle" fontSize={0.15} fill={buyerStroke} style={{ ...mono, ...halo }}>
                {Math.round(buyer.w * 100)} × {Math.round(buyer.d * 100)}
              </text>
            </g>
          ) : null}
        </g>
      ) : null}

      {/* nearest walkway */}
      {gap && buyer ? (
        <g>
          <line x1={gap.a.x} y1={gap.a.z} x2={gap.b.x} y2={gap.b.z} stroke={ACCENT} strokeWidth={0.035} strokeDasharray="0.1 0.07" />
          <circle cx={gap.a.x} cy={gap.a.z} r={0.05} fill={ACCENT} />
          <circle cx={gap.b.x} cy={gap.b.z} r={0.05} fill={ACCENT} />
          {(() => {
            const mx = (gap.a.x + gap.b.x) / 2;
            const mz = (gap.a.z + gap.b.z) / 2;
            const text = `${gap.metres.toFixed(2)} m`;
            const w = text.length * 0.1 + 0.16;
            return (
              <g>
                <rect x={mx - w / 2} y={mz - 0.15} width={w} height={0.27} rx={0.06} fill="#0e0d0c" fillOpacity={0.9} stroke={ACCENT} strokeOpacity={0.5} strokeWidth={0.015} />
                <text x={mx} y={mz + 0.045} textAnchor="middle" fontSize={0.16} fill={ACCENT} style={mono}>
                  {text}
                </text>
              </g>
            );
          })()}
        </g>
      ) : null}

      {labels ? (
        <g fill={INK3} fontSize={0.19} style={{ ...mono, ...halo }}>
          <text x={0} y={-D / 2 - 0.24} textAnchor="middle">
            {W.toFixed(2)} m
          </text>
          <text x={-W / 2 - 0.24} y={0} textAnchor="middle" transform={`rotate(-90 ${-W / 2 - 0.24} 0)`}>
            {D.toFixed(2)} m
          </text>
          <text x={W / 2 + 0.22} y={-D / 2 - 0.16} fontSize={0.14} textAnchor="middle">
            N
          </text>
          <text x={dp.x + dp.inward.x * 0.32} y={dp.z + dp.inward.z * 0.32 + 0.05} textAnchor="middle" fontSize={0.13} fillOpacity={0.9}>
            door {door.width.toFixed(2)}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
