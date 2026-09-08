/**
 * The chrome that floats over the 3D view — shared by the renter's viewer and the staging editor.
 *
 * It is the deployed prototype's language, one for one (docs/reference/prototype-index.css):
 * a transparent top bar with the wordmark on the left and a black/white pill group on the right
 * (`.topbar`), 82% white glass panels with an uppercase micro-label heading (`.metrics-panel`,
 * `.stage-panel`), and a bottom strip of room tiles (`.strip`, `.tile`). Active is black; everything
 * else is white with a hairline. Every number is mono; anything the model did not report is
 * `--faint` "not reported" rather than a guess.
 */
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Room } from '@/state/types';
import { roomChip } from '@/state/publish';
import { RailArrow, useRail } from '@/components/Rail';
import { cx } from '@/components/ui';

/* ------------------------------------------------------------------ wordmark */

/** `AUDORA` in small caps, letterspaced — top-left of every screen over the 3D. */
export function Wordmark({ className, to = '/' }: { className?: string; to?: string | null }) {
  const mark = (
    <span className={cx('select-none text-[12px] font-semibold uppercase leading-none tracking-[0.34em] text-ink', className)}>Audora</span>
  );
  return to ? (
    <Link to={to} className="shrink-0 no-underline" title="Audora">
      {mark}
    </Link>
  ) : (
    mark
  );
}

/**
 * The quiet tier word beside the wordmark, and the badge on a room tile: one word, because that is
 * all the space there is — "Draft", "Full", "Simulated", "Generating".
 */
export function tierWord(room: Room | undefined): string | null {
  if (!room) return null;
  const head = roomChip(room).text;
  if (!head) return null;
  if (head.startsWith('simulated')) return 'Simulated';
  if (head.startsWith('generating')) return 'Generating';
  if (head.startsWith('not generated')) return 'Pending';
  const word = head.split(' · ')[0].split(' ')[0];
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : null;
}

export function TierTag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('shrink-0 text-[12.5px] font-medium text-dim', className)}>{children}</span>;
}

/* ------------------------------------------------------------------ top bar */

/**
 * The transparent top bar. A white veil that clears downward so the wordmark and the pills stay
 * legible over a bright photograph without drawing a box around them.
 */
export function TopBar({ left, right, className }: { left: ReactNode; right: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  /* Below `sm` the pill group is a scrolling rail, and a scrollbar-less rail with a hard edge is
     indistinguishable from "that is all there is": Share, Fullscreen and Layers simply did not
     exist on a phone. The fade and the arrow say otherwise. */
  const railRef = useRef<HTMLDivElement>(null);
  const rail = useRail(railRef);
  /* The bar wraps to two rows on a narrow window (and on a phone), so the panels under it cannot be
     pinned to a guessed 52 px — they read `--hud-top`, which is this bar's real measured height. */
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const set = () => host.style.setProperty('--hud-top', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      host.style.removeProperty('--hud-top');
    };
  }, []);
  return (
    <div
      ref={ref}
      className={cx('pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 md:px-3.5', className)}
      style={{ background: 'linear-gradient(rgba(255,255,255,.96), rgba(255,255,255,.72) 70%, rgba(255,255,255,0))' }}
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-3">{left}</div>
      <div className="pointer-events-none relative ml-auto flex min-w-0 max-w-full sm:contents">
        <RailArrow dir={-1} show={rail.canLeft} onClick={() => rail.nudge(-1)} label="More controls" className="left-0 sm:hidden" />
        <RailArrow dir={1} show={rail.canRight} onClick={() => rail.nudge(1)} label="More controls" className="right-0 sm:hidden" />
        <div
          ref={railRef}
          className={cx(
            'no-scrollbar pointer-events-auto ml-auto flex max-w-full items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:justify-end sm:overflow-visible sm:[mask-image:none]',
            rail.canRight && '[mask-image:linear-gradient(to_right,black_calc(100%-26px),transparent)]',
          )}
        >
          {right}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pills */

export interface HudPillProps {
  children?: ReactNode;
  icon?: ReactNode;
  /** On = black fill, white text. */
  active?: boolean;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  /** Round icon-only pill (share, fullscreen, the quiet toggles). */
  square?: boolean;
  /** The renter's own action: blue instead of black when it is on. */
  buyer?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * One pill in the top-right group. White glass with a hairline; black when it is on. This is the
 * prototype's `.topbar .right button` — the single on/off language the whole HUD speaks.
 */
export function HudPill({ children, icon, active, onClick, title, disabled, square, buyer, className, ...rest }: HudPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      {...rest}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border text-[12.5px] font-semibold whitespace-nowrap backdrop-blur-md transition-colors duration-200 ease-audora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-2/50 disabled:opacity-45',
        square ? 'h-[30px] w-[30px] p-0' : 'h-[30px] px-3.5',
        active
          ? buyer
            ? 'border-buyer bg-buyer text-white'
            : 'border-accent bg-accent text-white'
          : 'border-[color:var(--glass-line)] bg-[color:var(--color-glass)] text-ink-2 hover:border-ink-2 hover:text-ink',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** A pill that navigates. Same look, an anchor's semantics. */
export function HudPillLink({ to, children, icon, title, external, className }: { to: string; children?: ReactNode; icon?: ReactNode; title?: string; external?: boolean; className?: string }) {
  const cls = cx(
    'inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-full border border-[color:var(--glass-line)] bg-[color:var(--color-glass)] px-3.5 text-[12.5px] font-semibold whitespace-nowrap text-ink-2 no-underline backdrop-blur-md transition-colors duration-200 ease-audora hover:border-ink-2 hover:text-ink',
    className,
  );
  return external ? (
    <a href={to} target="_blank" rel="noreferrer" title={title} className={cls}>
      {icon}
      {children}
    </a>
  ) : (
    <Link to={to} title={title} className={cls}>
      {icon}
      {children}
    </Link>
  );
}

/** A hairline gap in the pill row, so the modes read as one group and the tools as another. */
export function PillDivider() {
  return <span className="mx-0.5 hidden h-4 w-px shrink-0 bg-line-2 sm:block" aria-hidden />;
}

/* ------------------------------------------------------------------ panels */

export interface HudPanelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** A glass panel over the 3D: 82% white, blurred, hairline, soft shadow, 16px radius. */
export function HudPanel({ children, className, style }: HudPanelProps) {
  return (
    <div className={cx('glass pointer-events-auto flex flex-col overflow-hidden rounded-2xl', className)} style={style}>
      {children}
    </div>
  );
}

/** The uppercase letterspaced heading every panel section carries. */
export function PanelLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('micro', className)}>{children}</div>;
}

/* ------------------------------------------------------------------ metric rows */

export interface MetricRowProps {
  label: ReactNode;
  /** Null / undefined prints the prototype's faint "not reported". */
  value?: ReactNode;
  /** Bold the value: the number the leasing team is actually steering (the floor nudge). */
  strong?: boolean;
  missing?: string;
  title?: string;
}

/**
 * One `label → value` line. The label is dim sans, the value is mono ink, right-aligned; a value the
 * model never reported is `--faint` and says so, because a blank would read as zero.
 */
export function MetricRow({ label, value, strong, missing = 'not reported', title }: MetricRowProps) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="flex items-start justify-between gap-3 py-[3.5px] text-[12.5px]" title={title}>
      <span className="shrink-0 text-dim">{label}</span>
      {/* Long values wrap rather than run over the label — "500k · 100k · full_res" is two lines. */}
      <span className={cx('mono min-w-0 break-words text-right text-[12px]', empty ? 'text-faint' : strong ? 'font-semibold text-accent-deep' : 'text-ink')}>{empty ? missing : value}</span>
    </div>
  );
}

/** The `--dim` footnote under a panel's numbers. */
export function PanelNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('mt-2.5 text-[11px] leading-[1.45] text-dim', className)}>{children}</p>;
}

/* ------------------------------------------------------------------ room strip */

export interface RoomStripProps {
  rooms: Room[];
  activeId?: string;
  onPick: (id: string) => void;
  /** "Rooms in this unit". */
  label?: string;
  /** A generation in flight, per room id: shows its percentage on the tile. */
  progressFor?: (room: Room) => number | null;
  className?: string;
}

/** The tier badge that rides in the corner of a tile. */
function TileBadge({ children }: { children: ReactNode }) {
  return (
    <span className="absolute bottom-[5px] left-[6px] rounded-full border border-[color:var(--glass-line)] bg-[color:var(--color-glass)] px-[7px] py-[2px] text-[9.5px] font-bold tracking-[0.06em] text-ink backdrop-blur-sm">
      {children}
    </span>
  );
}

/**
 * A little plan of the room, drawn when there is no still to show: the rectangle it measures with
 * the door gap in its wall. Honest, cheap, and it still says which room this is.
 */
function PlanTile({ room }: { room: Room }) {
  const g = room.geometry;
  /* It used to draw a ~45 x 52 white rectangle in the middle of a 104 x 62 tile on `--surface-2`,
     under a white name gradient and a badge — four of six tiles read as empty next to two
     photographs. Now the plan fills the tile, sits on `--surface`, and carries the door gap in its
     south wall that makes it read as a plan rather than as a box. */
  const pad = 0.16;
  const w = g.width + pad * 2;
  const h = g.depth + pad * 2;
  const stroke = Math.max(w, h) / 42;
  // The doorway sits right of centre so the tier badge (bottom left) never lands on it.
  const door = Math.min(0.9, g.width * 0.28);
  const doorStart = g.width * 0.52;
  const x0 = -g.width / 2;
  const y0 = -g.depth / 2;
  const x1 = g.width / 2;
  const y1 = g.depth / 2;
  return (
    <svg viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" aria-hidden>
      <rect x={x0} y={y0} width={g.width} height={g.depth} fill="#ffffff" />
      {/* three walls and the doorway, so the tile says "this is the plan of a room" at 100 px */}
      <path
        d={`M ${x0 + doorStart} ${y1} L ${x0} ${y1} L ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0 + doorStart + door} ${y1}`}
        fill="none"
        stroke="#0a0a0a"
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
      <line x1={x0 + doorStart} y1={y1} x2={x0 + doorStart + door} y2={y1} stroke="#d4d4d4" strokeWidth={stroke} />
    </svg>
  );
}

/**
 * The bottom strip: "Rooms in this unit · 5" and a scrolling row of tiles. It replaces the old room
 * chips card — a renter who cannot see that the photoreal rooms exist will never open one.
 */
export function RoomStrip({ rooms, activeId, onPick, label = 'Rooms in this unit', progressFor, className }: RoomStripProps) {
  /* The reference pairs its scrolling thumbnails with rail arrows; without them the fifth room sits
     clipped at the viewport edge and nothing says it is there. Hooks run before the early return. */
  const railRef = useRef<HTMLDivElement>(null);
  const rail = useRail(railRef);
  if (rooms.length < 1) return null;
  return (
    <div
      className={cx('pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex items-center gap-3 px-3 py-2 backdrop-blur-md md:px-3.5', className)}
      style={{ background: 'linear-gradient(rgba(255,255,255,0), var(--color-glass) 42%)' }}
    >
      <div className="hidden shrink-0 items-baseline gap-2 text-[12px] font-extrabold tracking-[0.02em] text-ink sm:flex">
        {label} <span className="mono text-[11px] font-semibold text-dim">{rooms.length}</span>
      </div>
      <div className="relative min-w-0 flex-1">
      <RailArrow dir={-1} show={rail.canLeft} onClick={() => rail.nudge(-1)} label="Earlier rooms" />
      <RailArrow dir={1} show={rail.canRight} onClick={() => rail.nudge(1)} label="More rooms" />
      <div
        ref={railRef}
        className={cx('no-scrollbar flex gap-2 overflow-x-auto py-1.5', rail.canRight && '[mask-image:linear-gradient(to_right,black_calc(100%-30px),transparent)]')}
        style={{ scrollSnapType: 'x proximity' }}
      >
        {rooms.map((r) => {
          const active = r.id === activeId;
          const ready = r.status === 'ready';
          const shot = r.full?.thumbnailUrl || r.draft?.thumbnailUrl || r.photo?.dataUrl;
          const pct = progressFor?.(r) ?? null;
          const tier = tierWord(r);
          return (
            <button
              key={r.id}
              type="button"
              data-active={active}
              disabled={!ready}
              onClick={() => onPick(r.id)}
              title={ready ? `${r.name} · ${r.geometry.width.toFixed(2)} × ${r.geometry.depth.toFixed(2)} m` : `${r.name} · ${pct != null ? `${Math.round(pct)}%` : r.status}`}
              style={{ scrollSnapAlign: 'start' }}
              className={cx(
                'relative h-[62px] w-[104px] shrink-0 overflow-hidden rounded-[10px] border-[1.5px] bg-surface p-0 transition-[transform,box-shadow,border-color] duration-200 ease-audora',
                active ? 'border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]' : 'border-line hover:z-[1] hover:scale-[1.06] hover:border-accent hover:shadow-soft',
                !ready && 'cursor-not-allowed opacity-60',
              )}
            >
              {shot ? <img src={shot} alt="" className="h-full w-full object-cover" loading="lazy" /> : <PlanTile room={r} />}
              {/* The name is what the leasing team navigates by; the still is what a renter recognises. */}
              <span className="absolute inset-x-0 top-0 truncate bg-gradient-to-b from-white/95 via-white/80 to-transparent px-1.5 pb-1.5 pt-1 text-left text-[10px] font-semibold leading-none text-ink">
                {r.name}
              </span>
              {tier ? <TileBadge>{pct != null ? `${Math.round(pct)}%` : tier}</TileBadge> : null}
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
