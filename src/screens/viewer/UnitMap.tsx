/**
 * The whole unit on one plan — docs/ACCURACY.md section 3.3.
 *
 * `Minimap` draws the room the buyer is standing in, measured from its own collider. This draws the
 * *flat*: every room the listing plan names, at the size the plan printed, where `shared/unitGraph`
 * placed it, with the doorways between them, the plan's north, and the buyer standing in one of
 * them. It replaces the per-room minimap whenever the tour has a plan, because once there is a plan
 * "where am I in this flat" is a better question than "where am I in this room".
 *
 * Conventions:
 * - **Sheet metres, except for type.** The viewBox is the storey's own bounding box in metres, x
 *   right and z down, which is exactly the frame `unitGraph` lays rooms out in, and every wall and
 *   doorway is drawn in those metres. **Text is not**: a font size in metres is a font size that
 *   shrinks with the flat, and on a 19 m storey in a 176 px panel "Living room" rendered 2.8 px
 *   tall. So the panel measures itself, `pxPerM` converts, and every label, the compass and the
 *   scale bar are sized in screen pixels — a name that still cannot fit its room is shortened, and
 *   then dropped, rather than drawn illegibly.
 * - **One conversion, borrowed.** The buyer's pose is in the room's own frame; `toUnitPose` puts it
 *   on the sheet, and `toRoomPoint` brings a click back. Neither is re-derived here.
 * - **The drawing is the plan's, the position is the model's.** Room rectangles are what the plan
 *   printed (a drawing, ±5 cm); the dot is where the buyer actually is in the reconstruction. The
 *   two are not the same measurement and the map never pretends otherwise — the caption says which
 *   parts were laid out rather than drawn.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { floorBounds, toRoomPoint, toUnitPose, type UnitGraph, type UnitRoom } from '@shared/unitGraph';
import { isFirstPerson, useViewer } from '@/three/viewerStore';

const INK = '#0a0a0a';
const INK3 = '#737373';
const FAINT = '#a3a3a3';
const FLOOR = '#ffffff';
const SURFACE = '#f7f7f7';
const MONO = 'ui-monospace, SF Mono, Menlo, monospace';
/** Metres of margin round the storey, for the compass and the room names, before the panel is measured. */
const PAD = 0.9;
const WALL_W = 0.12;

/* ---------- type, in screen pixels ---------- */

/** Screen pixels. Below about 9 px a name is a smudge, so these are floors, not preferences. */
const NAME_PX = 10;
const DIM_PX = 9;
const MARK_PX = 9;
/** Pixels of margin the compass, the scale bar and an overhanging name need round the storey. */
const MARGIN_PX = 22;
/**
 * Advance width of one character as a fraction of the font size. Measured, not guessed: "Living
 * room" at 10 px lays out 46.8 px wide in the shipped face, which is 0.425 — rounded up a little so
 * a name of wide characters still clears the wall it is written between.
 */
const CHAR_W = 0.46;
/** The printed dimensions are mono, which is wider per character than the name's UI face. */
const MONO_W = 1.25;
/** A label with fewer than this many characters says nothing; it is dropped instead. */
const MIN_CHARS = 3;

/** How many characters of a label fit across `metres` at `pxPerM`, allowing a wall's worth of inset. */
function fits(text: string, metres: number, pxPerM: number, fontPx: number): string {
  const room = Math.floor(((metres - 0.2) * pxPerM) / (fontPx * CHAR_W));
  if (room < MIN_CHARS) return '';
  return text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text;
}

export interface UnitMapProps {
  graph: UnitGraph;
  /** The plan room the buyer is standing in, from `linkRooms`. */
  activeRoomRef?: string;
  /** The quarter turn between that room's frame and the plan's, from `matchPortals`. */
  quarters?: number;
  /** Clicking another room on the plan goes to it. */
  onPickRoom?: (roomRef: string) => void;
  /** Clicking the room you are in walks there — room metres, in that room's own frame. */
  onWalkTo?: (x: number, z: number) => void;
  className?: string;
  style?: CSSProperties;
}

const rectOf = (r: UnitRoom) => ({ x: r.position.x - r.width / 2, y: r.position.z - r.depth / 2, w: r.width, h: r.depth });

/** The two ends of a doorway on one wall of a room, in sheet metres. */
function doorSegment(room: UnitRoom, wall: string, offset: number, width: number) {
  const half = width / 2;
  const left = room.position.x - room.width / 2;
  const top = room.position.z - room.depth / 2;
  if (wall === 'north' || wall === 'south') {
    const z = wall === 'north' ? top : top + room.depth;
    return { x1: left + offset - half, z1: z, x2: left + offset + half, z2: z };
  }
  const x = wall === 'west' ? left : left + room.width;
  return { x1: x, z1: top + offset - half, x2: x, z2: top + offset + half };
}


/**
 * The unit's plan, with "you are here" on it. Draws one storey — the one the buyer is standing on —
 * and nothing at all when the plan produced no rooms for it.
 */
export function UnitMap({ graph, activeRoomRef, quarters = 0, onPickRoom, onWalkTo, className, style }: UnitMapProps) {
  /* The pose is read here rather than passed in, as in `three/Minimap`: the buyer's dot moves every
     frame they walk, and the HUD around this panel must not re-render with it. */
  const pose = useViewer((s) => s.pose);
  const walkable = isFirstPerson(useViewer((s) => s.mode));
  const clipId = `unitmap-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  /* The panel's own CSS size. The viewBox is then chosen to match it exactly, so one viewBox unit
     is `pxPerM` screen pixels with no letterboxing left over and a label can be sized in pixels. */
  const [px, setPx] = useState<{ w: number; h: number } | null>(null);
  const active = graph.rooms.find((r) => r.roomRef === activeRoomRef);
  const floorIndex = active?.floorIndex ?? graph.rooms[0]?.floorIndex ?? 0;
  const rooms = useMemo(() => graph.rooms.filter((r) => r.floorIndex === floorIndex), [graph, floorIndex]);
  const box = useMemo(() => floorBounds(graph, floorIndex), [graph, floorIndex]);

  const here = useMemo(() => (active ? toUnitPose(active, pose, quarters) : null), [active, pose, quarters]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setPx((prev) => (prev && Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5 ? prev : { w: r.width, h: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!rooms.length || !box) return null;

  const contentW = box.maxX - box.minX;
  const contentH = box.maxZ - box.minZ;
  /* Fit the storey inside the panel less a pixel margin, then let the viewBox cover the whole panel
     at that scale. Before the first measurement, fall back to the old metres-only frame; it lasts
     one frame and keeps this component drawable in a test that has no layout. */
  const pxPerM = px ? Math.max(1, Math.min((px.w - MARGIN_PX * 2) / contentW, (px.h - MARGIN_PX * 2) / contentH)) : 0;
  const vw = px && pxPerM > 0 ? px.w / pxPerM : contentW + PAD * 2;
  const vh = px && pxPerM > 0 ? px.h / pxPerM : contentH + PAD * 2;
  const vx = (box.minX + box.maxX) / 2 - vw / 2;
  const vz = (box.minZ + box.maxZ) / 2 - vh / 2;
  /** One screen pixel, in viewBox units: what turns a px size into something the SVG can draw. */
  const u = pxPerM > 0 ? 1 / pxPerM : (contentW + PAD * 2) / 178;

  /* The compass sits in the top-left margin and points where the plan's arrow points: degrees
     clockwise from up the page, which on the sheet is the direction (sin a, −cos a). */
  const a = (graph.northArrowDeg * Math.PI) / 180;
  const nr = 5 * u;
  const nx = vx + nr + 3 * u;
  const nz = vz + nr + 4 * u;
  const tip = { x: nx + Math.sin(a) * nr, z: nz - Math.cos(a) * nr };
  const tail = { x: nx - Math.sin(a) * nr, z: nz + Math.cos(a) * nr };

  const cone = (() => {
    if (!here) return null;
    const len = 1.1;
    const half = 0.5;
    const dir = { x: -Math.sin(here.yaw), z: -Math.cos(here.yaw) };
    const arm = (t: number) => `${here.x + (Math.cos(t) * dir.x - Math.sin(t) * dir.z) * len},${here.z + (Math.sin(t) * dir.x + Math.cos(t) * dir.z) * len}`;
    return `${here.x},${here.z} ${arm(-half)} ${arm(half)}`;
  })();

  const click = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!onPickRoom && !onWalkTo) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    const hit = rooms.find((r) => Math.abs(p.x - r.position.x) <= r.width / 2 && Math.abs(p.y - r.position.z) <= r.depth / 2);
    if (!hit) return;
    if (hit.roomRef !== activeRoomRef) {
      onPickRoom?.(hit.roomRef);
      return;
    }
    if (!onWalkTo) return;
    // Inside the room you are already in: walk to that spot, in the room's own frame.
    const local = toRoomPoint(hit, { x: p.x, z: p.y }, quarters);
    onWalkTo(local.x, local.z);
  };

  const laidOut = graph.positions === 'adjacency';

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
      <svg
        ref={svgRef}
        viewBox={`${vx} ${vz} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        onClick={click}
        role={onPickRoom || onWalkTo ? 'button' : 'img'}
        aria-label={`Plan of ${rooms.length} rooms${active ? `, standing in the ${active.name.toLowerCase()}` : ''}`}
        style={{ width: '100%', height: '100%', flex: 1, minHeight: 0, display: 'block', cursor: onPickRoom || onWalkTo ? 'crosshair' : 'default' }}
      >
        <defs>
          <clipPath id={clipId}>
            {rooms.map((r) => {
              const k = rectOf(r);
              return <rect key={r.roomRef} x={k.x} y={k.y} width={k.w} height={k.h} />;
            })}
          </clipPath>
        </defs>

        {/* floors, the room you are in a shade darker so it reads at a glance */}
        {rooms.map((r) => {
          const k = rectOf(r);
          return <rect key={`f${r.roomRef}`} x={k.x} y={k.y} width={k.w} height={k.h} fill={r.roomRef === activeRoomRef ? SURFACE : FLOOR} />;
        })}

        {/* walls, then the doorways cut back out of them — the same trick the room minimap uses */}
        {rooms.map((r) => {
          const k = rectOf(r);
          return <rect key={`w${r.roomRef}`} x={k.x} y={k.y} width={k.w} height={k.h} fill="none" stroke={INK} strokeWidth={WALL_W} strokeLinejoin="round" />;
        })}
        {rooms.map((r) =>
          r.doors.map((d) => {
            const s = doorSegment(r, d.wall, d.offset, d.width);
            return (
              <line
                key={`d${r.roomRef}-${d.toRoomRef}`}
                x1={s.x1}
                y1={s.z1}
                x2={s.x2}
                y2={s.z2}
                stroke={r.roomRef === activeRoomRef ? SURFACE : FLOOR}
                strokeWidth={WALL_W + 0.03}
                strokeDasharray={d.nominal ? '0.12 0.08' : undefined}
              />
            );
          }),
        )}

        {/* names, and the plan's own dimensions under them — sized in screen pixels, not metres, and
            shortened or dropped when the room is too narrow to carry them at a readable size */}
        {rooms.map((r) => {
          const dims = r.planDims ? `${r.planDims.width.toFixed(2)} × ${r.planDims.depth.toFixed(2)}` : '';
          // The dimensions are mono, which is wider per character than the name's UI face.
          const shownDims = dims && r.depth * pxPerM > NAME_PX + DIM_PX + 6 ? fits(dims, r.width, pxPerM, DIM_PX * MONO_W) : '';
          const name = fits(r.name, r.width, pxPerM, NAME_PX);
          if (!name && !shownDims) return null;
          return (
            <g key={`t${r.roomRef}`} pointerEvents="none">
              {/* The full name is always available on hover, however little of it the room can show. */}
              <title>{r.planDims ? `${r.name} · ${dims} m` : r.name}</title>
              {name ? (
                <text
                  x={r.position.x}
                  y={r.position.z + (shownDims ? -2 : 3.5) * u}
                  fontSize={NAME_PX * u}
                  fill={r.roomRef === activeRoomRef ? INK : INK3}
                  textAnchor="middle"
                >
                  {name}
                </text>
              ) : null}
              {shownDims ? (
                <text x={r.position.x} y={r.position.z + (name ? 9 : 3.5) * u} fontSize={DIM_PX * u} fill={FAINT} textAnchor="middle" fontFamily={MONO}>
                  {shownDims}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* you are here — clipped to the rooms so a cone never spills onto the margin */}
        {here ? (
          <g clipPath={`url(#${clipId})`} pointerEvents="none" opacity={walkable ? 1 : 0.45}>
            {cone ? <polygon points={cone} fill={INK} fillOpacity={0.12} stroke={INK} strokeOpacity={0.28} strokeWidth={0.02} strokeLinejoin="round" /> : null}
            <circle cx={here.x} cy={here.z} r={0.17} fill={INK} />
            <circle cx={here.x} cy={here.z} r={0.07} fill={FLOOR} />
          </g>
        ) : null}

        {/* the plan's north */}
        <g pointerEvents="none">
          <line x1={tail.x} y1={tail.z} x2={tip.x} y2={tip.z} stroke={INK3} strokeWidth={u} />
          <circle cx={tip.x} cy={tip.z} r={1.2 * u} fill={INK3} />
          <text x={nx + nr + 3 * u} y={nz + MARK_PX * 0.36 * u} fontSize={MARK_PX * u} fill={INK3} fontFamily={MONO}>
            N
          </text>
        </g>
        {/* One metre, so the drawing can be read as a measurement rather than a diagram. */}
        <g pointerEvents="none">
          <path d={`M ${vx + 5 * u} ${vz + vh - 12 * u} v ${5 * u} h 1 v ${-5 * u}`} fill="none" stroke={INK3} strokeWidth={u} />
          <text x={vx + 5 * u + 1 + 4 * u} y={vz + vh - 5 * u} fontSize={MARK_PX * u} fill={FAINT} fontFamily={MONO}>
            1 m
          </text>
        </g>
      </svg>
      {/* Two lines, not one: in the viewer's corner panel this is about 145 px wide, and a single
          nowrap row cut the storey down to "Thir…" — the half that actually locates the buyer. The
          provenance line matters too (these sizes are the plan's; on an inferred layout the
          arrangement is ours), so each gets its own line and its own ellipsis. */}
      <div className="mono" style={{ fontSize: 10.5, color: INK3, lineHeight: 1.3, overflow: 'hidden' }}>
        <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{active?.floor ?? rooms[0].floor}</div>
        <div style={{ color: FAINT, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
          {laidOut ? 'plan sizes · layout inferred' : 'from the plan'}
        </div>
      </div>
    </div>
  );
}
