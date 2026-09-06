/**
 * A small top-down plan of a room and its staging. Metric, honest: the room outline is the
 * derived geometry, door and windows sit where the reconstruction put them, and every piece
 * is its real footprint. Seller staging keeps its catalogue colour; buyer pieces are blue.
 */
import type { PlacedPiece, RoomGeometry } from '@/engine/types';
import { corners, wallFeaturePosition } from '@/engine/geometry';
import { cx } from '@/components/ui';

export function FloorPlanSvg({
  geometry: g,
  pieces = [],
  className,
  showDims = true,
  showNames = false,
}: {
  geometry: RoomGeometry;
  pieces?: PlacedPiece[];
  className?: string;
  showDims?: boolean;
  showNames?: boolean;
}) {
  const S = 100; // 1 m = 100 units
  const pad = showDims ? 0.7 : 0.3;
  const W = (g.width + pad * 2) * S;
  const H = (g.depth + pad * 2) * S;
  const ox = pad * S + (g.width / 2) * S;
  const oz = pad * S + (g.depth / 2) * S;
  const px = (x: number) => ox + x * S;
  const pz = (z: number) => oz + z * S;
  const wallW = 8;

  const door = wallFeaturePosition(g, g.door.wall, g.door.offset);
  const half = g.door.width / 2;
  const dA = { x: door.x - door.along.x * half, z: door.z - door.along.z * half };
  const dB = { x: door.x + door.along.x * half, z: door.z + door.along.z * half };
  // Door leaf hinged at dA, swinging into the room.
  const leafEnd = { x: dA.x + door.inward.x * g.door.width, z: dA.z + door.inward.z * g.door.width };
  const sweep = door.along.x * door.inward.z - door.along.z * door.inward.x > 0 ? 0 : 1;

  const flats = pieces.filter((p) => p.flat);
  const solids = pieces.filter((p) => !p.flat);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cx('block h-auto w-full', className)} role="img" aria-label={`Floor plan, ${g.width.toFixed(2)} by ${g.depth.toFixed(2)} metres`}>
      <rect x={px(-g.width / 2)} y={pz(-g.depth / 2)} width={g.width * S} height={g.depth * S} fill="var(--color-bg-2)" stroke="var(--color-line-2)" strokeWidth={wallW} />
      {g.windows.map((wn, i) => {
        const p = wallFeaturePosition(g, wn.wall, wn.offset);
        const h = wn.width / 2;
        return (
          <line
            key={i}
            x1={px(p.x - p.along.x * h)}
            y1={pz(p.z - p.along.z * h)}
            x2={px(p.x + p.along.x * h)}
            y2={pz(p.z + p.along.z * h)}
            stroke="var(--color-ink-2)"
            strokeOpacity={0.6}
            strokeWidth={wallW}
          />
        );
      })}
      {/* door gap, leaf and swing */}
      <line x1={px(dA.x)} y1={pz(dA.z)} x2={px(dB.x)} y2={pz(dB.z)} stroke="var(--color-bg-2)" strokeWidth={wallW + 2} />
      <path
        d={`M ${px(leafEnd.x)} ${pz(leafEnd.z)} A ${g.door.width * S} ${g.door.width * S} 0 0 ${sweep} ${px(dB.x)} ${pz(dB.z)}`}
        fill="none"
        stroke="var(--color-accent)"
        strokeOpacity={0.5}
        strokeWidth={2}
        strokeDasharray="6 5"
      />
      <line x1={px(dA.x)} y1={pz(dA.z)} x2={px(leafEnd.x)} y2={pz(leafEnd.z)} stroke="var(--color-accent)" strokeWidth={4} />
      {[...flats, ...solids].map((p) => {
        const pts = corners(p)
          .map((c) => `${px(c.x)},${pz(c.z)}`)
          .join(' ');
        const buyer = p.owner === 'buyer';
        const fill = buyer ? 'var(--color-buyer)' : p.color || 'var(--color-ink-3)';
        return (
          <g key={p.id}>
            <polygon points={pts} fill={fill} fillOpacity={p.flat ? 0.3 : 0.85} stroke={buyer ? 'var(--color-buyer)' : 'rgba(0,0,0,0.35)'} strokeWidth={2} />
            {showNames && !p.flat ? (
              <text x={px(p.x)} y={pz(p.z)} textAnchor="middle" dominantBaseline="middle" fontSize={14} fill="#0e0d0c" fontFamily="var(--font-mono)">
                {p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name}
              </text>
            ) : null}
          </g>
        );
      })}
      {showDims ? (
        <g fontFamily="var(--font-mono)" fontSize={26} fill="var(--color-ink-3)">
          <text x={px(0)} y={pz(-g.depth / 2) - 24} textAnchor="middle">
            {g.width.toFixed(2)} m
          </text>
          <text x={px(-g.width / 2) - 22} y={pz(0)} textAnchor="middle" transform={`rotate(-90 ${px(-g.width / 2) - 22} ${pz(0)})`}>
            {g.depth.toFixed(2)} m
          </text>
        </g>
      ) : null}
    </svg>
  );
}
