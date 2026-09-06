import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import type { PlacedPiece, RoomGeometry, WallSide } from '@/engine/types';
import { corners, wallFeaturePosition } from '@/engine/geometry';
import { useViewer } from './viewerStore';

export interface MinimapProps {
  room: RoomGeometry;
  /** Seller staging: warm grey. */
  pieces: PlacedPiece[];
  /** Buyer's own pieces: always blue. */
  buyerPieces?: PlacedPiece[];
  className?: string;
  /** Inline size for the root (the SVG fills it and keeps the room's aspect). */
  style?: CSSProperties;
  /** Room metres of the clicked floor point (the viewer wires this to a teleport). */
  onClick?: (x: number, z: number) => void;
  /** ± of the room's anchor, drawn on the scale bar. */
  uncertaintyM?: number;
  /** Draw the viewer's position and view cone from useViewer.pose. */
  showViewer?: boolean;
  /** Hide seller pieces (buyer "see it bare"). */
  showSeller?: boolean;
  /** Highlight a piece. */
  selectedId?: string | null;
}

const PAD = 0.55;
const SELLER = '#8d7b6a';
const BUYER = '#62a0ff';
const INK = '#f4eee5';
const INK3 = '#7f7468';
const LINE2 = '#3d362f';
const ACCENT = '#e8734a';
const GLASS = '#9cc3e6';
const FLOOR = '#1b1816';
const WALL_W = 0.14;

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Top-down plan of the room as SVG: walls with the door and windows, furniture footprints,
 * the viewer with a view cone, and a scale bar carrying the anchor's uncertainty.
 * Click anywhere on the floor to teleport (via `onClick`).
 */
export function Minimap({ room, pieces, buyerPieces = [], className, style, onClick, uncertaintyM, showViewer = true, showSeller = true, selectedId }: MinimapProps) {
  const pose = useViewer((s) => s.pose);
  const mode = useViewer((s) => s.mode);
  const viewerSelected = useViewer((s) => s.selectedId);
  const sel = selectedId === undefined ? viewerSelected : selectedId;
  const svgRef = useRef<SVGSVGElement>(null);
  const [pxPerM, setPxPerM] = useState(36);

  const W = room.width + PAD * 2;
  const H = room.depth + PAD * 2;
  const vb = `${-W / 2} ${-H / 2} ${W} ${H}`;

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setPxPerM(Math.min(r.width / W, r.height / H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  const handleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!onClick) return;
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    const x = Math.max(-room.width / 2 + 0.3, Math.min(room.width / 2 - 0.3, p.x));
    const z = Math.max(-room.depth / 2 + 0.3, Math.min(room.depth / 2 - 0.3, p.y));
    if (Math.abs(p.x) > room.width / 2 + 0.4 || Math.abs(p.y) > room.depth / 2 + 0.4) return;
    onClick(x, z);
  };

  // wall features as line segments in plan
  const features: { x1: number; z1: number; x2: number; z2: number; kind: 'door' | 'window' }[] = [];
  const seg = (wall: WallSide, offset: number, width: number, kind: 'door' | 'window') => {
    const p = wallFeaturePosition(room, wall, offset);
    const hw = width / 2;
    features.push({ x1: p.x - p.along.x * hw, z1: p.z - p.along.z * hw, x2: p.x + p.along.x * hw, z2: p.z + p.along.z * hw, kind });
  };
  seg(room.door.wall, room.door.offset, room.door.width, 'door');
  room.windows.forEach((w) => seg(w.wall, w.offset, w.width, 'window'));
  const door = wallFeaturePosition(room, room.door.wall, room.door.offset);
  const doorHinge = { x: door.x - door.along.x * (room.door.width / 2), z: door.z - door.along.z * (room.door.width / 2) };
  const doorTip = { x: doorHinge.x + door.inward.x * room.door.width, z: doorHinge.z + door.inward.z * room.door.width };
  const doorArcEnd = { x: door.x + door.along.x * (room.door.width / 2), z: door.z + door.along.z * (room.door.width / 2) };
  // sweep direction depends on the wall's handedness
  const cross = door.along.x * door.inward.z - door.along.z * door.inward.x;
  const sweep = cross > 0 ? 0 : 1;

  const fov = 0.55; // half-angle of the cone
  const coneLen = Math.min(1.8, Math.max(room.width, room.depth) * 0.35);
  const dir = { x: -Math.sin(pose.yaw), z: -Math.cos(pose.yaw) };
  const cone = [
    `${pose.x},${pose.z}`,
    `${pose.x + Math.cos(-fov) * dir.x * coneLen - Math.sin(-fov) * dir.z * coneLen},${pose.z + Math.sin(-fov) * dir.x * coneLen + Math.cos(-fov) * dir.z * coneLen}`,
    `${pose.x + Math.cos(fov) * dir.x * coneLen - Math.sin(fov) * dir.z * coneLen},${pose.z + Math.sin(fov) * dir.x * coneLen + Math.cos(fov) * dir.z * coneLen}`,
  ].join(' ');

  const barM = room.width < 3 ? 0.5 : 1;
  const barPx = barM * pxPerM;
  const uncPx = uncertaintyM ? Math.max(2, uncertaintyM * pxPerM) : 0;
  const walkable = mode === 'walk';

  const footprint = (p: PlacedPiece, owner: 'seller' | 'buyer') => {
    const pts = corners(p)
      .map((c) => `${c.x},${c.z}`)
      .join(' ');
    const isSel = sel === p.id;
    const fill = owner === 'buyer' ? BUYER : SELLER;
    // a short tick shows which way the piece faces (local +z = front)
    const fx = p.x + Math.sin(p.rot) * (p.d / 2);
    const fz = p.z + Math.cos(p.rot) * (p.d / 2);
    return (
      <g key={p.id}>
        <polygon points={pts} fill={fill} fillOpacity={p.flat ? 0.14 : owner === 'buyer' ? 0.5 : 0.55} stroke={isSel ? ACCENT : fill} strokeWidth={isSel ? 0.06 : 0.025} strokeDasharray={p.flat ? '0.12 0.08' : undefined} strokeLinejoin="round" />
        {!p.flat ? <circle cx={fx} cy={fz} r={0.045} fill={owner === 'buyer' ? '#dbeafe' : '#f4eee5'} fillOpacity={0.7} /> : null}
      </g>
    );
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
      <svg
        ref={svgRef}
        viewBox={vb}
        preserveAspectRatio="xMidYMid meet"
        onClick={handleClick}
        role={onClick ? 'button' : 'img'}
        aria-label="Room plan"
        style={{ width: '100%', height: '100%', flex: 1, minHeight: 0, cursor: onClick ? 'crosshair' : 'default', display: 'block' }}
      >
        {/* floor */}
        <rect x={-room.width / 2} y={-room.depth / 2} width={room.width} height={room.depth} fill={FLOOR} />
        {/* metre grid */}
        <g stroke={LINE2} strokeWidth={0.012} strokeOpacity={0.7}>
          {Array.from({ length: Math.floor(room.width) }, (_, i) => -room.width / 2 + i + 1).map((x) => (
            <line key={`gx${x}`} x1={x} y1={-room.depth / 2} x2={x} y2={room.depth / 2} />
          ))}
          {Array.from({ length: Math.floor(room.depth) }, (_, i) => -room.depth / 2 + i + 1).map((z) => (
            <line key={`gz${z}`} x1={-room.width / 2} y1={z} x2={room.width / 2} y2={z} />
          ))}
        </g>
        {/* furniture */}
        {showSeller ? pieces.filter((p) => p.flat).map((p) => footprint(p, 'seller')) : null}
        {buyerPieces.filter((p) => p.flat).map((p) => footprint(p, 'buyer'))}
        {showSeller ? pieces.filter((p) => !p.flat).map((p) => footprint(p, 'seller')) : null}
        {buyerPieces.filter((p) => !p.flat).map((p) => footprint(p, 'buyer'))}
        {/* walls */}
        <rect x={-room.width / 2 - WALL_W / 2} y={-room.depth / 2 - WALL_W / 2} width={room.width + WALL_W} height={room.depth + WALL_W} fill="none" stroke="#bfb3a3" strokeWidth={WALL_W} />
        {features.map((f, i) =>
          f.kind === 'door' ? (
            <line key={i} x1={f.x1} y1={f.z1} x2={f.x2} y2={f.z2} stroke={FLOOR} strokeWidth={WALL_W + 0.02} />
          ) : (
            <line key={i} x1={f.x1} y1={f.z1} x2={f.x2} y2={f.z2} stroke={GLASS} strokeWidth={WALL_W * 0.55} />
          ),
        )}
        {/* door swing */}
        <path d={`M ${doorHinge.x} ${doorHinge.z} L ${doorTip.x} ${doorTip.z} A ${room.door.width} ${room.door.width} 0 0 ${sweep} ${doorArcEnd.x} ${doorArcEnd.z}`} fill="none" stroke="#bfb3a3" strokeWidth={0.025} strokeDasharray="0.06 0.05" />
        {/* viewer */}
        {showViewer ? (
          <g opacity={walkable ? 1 : 0.45}>
            <polygon points={cone} fill={ACCENT} fillOpacity={0.2} stroke={ACCENT} strokeOpacity={0.35} strokeWidth={0.02} strokeLinejoin="round" />
            <circle cx={pose.x} cy={pose.z} r={0.17} fill={ACCENT} />
            <circle cx={pose.x} cy={pose.z} r={0.07} fill={INK} />
          </g>
        ) : null}
        {/* compass */}
        <text x={-W / 2 + 0.16} y={-H / 2 + 0.36} fontSize={0.3} fill={INK3} fontFamily="JetBrains Mono, ui-monospace, monospace">
          N
        </text>
        <text x={W / 2 - 0.16} y={H / 2 - 0.14} fontSize={0.24} fill={INK3} textAnchor="end" fontFamily="JetBrains Mono, ui-monospace, monospace">
          {fmt(Math.round(room.width * 100) / 100)} × {fmt(Math.round(room.depth * 100) / 100)} m
        </text>
      </svg>
      <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#bfb3a3', lineHeight: 1 }}>
        <div style={{ position: 'relative', height: 8, width: barPx, borderLeft: `1px solid ${INK}`, borderRight: `1px solid ${INK}`, borderBottom: `1px solid ${INK}` }} aria-hidden>
          {uncPx ? <div style={{ position: 'absolute', right: -uncPx / 2, top: -3, width: uncPx, height: 14, background: ACCENT, opacity: 0.35, borderRadius: 2 }} /> : null}
        </div>
        <span>
          {fmt(barM)} m{uncertaintyM ? <span style={{ color: INK3 }}> · ±{Math.max(1, Math.round(uncertaintyM * 100))} cm</span> : null}
        </span>
      </div>
    </div>
  );
}
