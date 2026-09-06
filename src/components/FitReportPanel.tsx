import { useMemo } from 'react';
import type { AnchorSpec, FitReport, PlausibilityWarning, RoomGeometry, TightSpot } from '@/engine/types';
import { MIN_WALKWAY_M, plausibility } from '@/engine/anchor';
import { AnchorChip } from './AnchorChip';
import { cm, m } from '@/lib/format';
import { Icon } from './icons';
import { Callout, cx } from './ui';

export interface FitReportPanelProps {
  report: FitReport;
  /** Map piece ids to names for the tight-spot list. */
  names?: Record<string, string>;
  onFocusPiece?: (id: string) => void;
  /** Room geometry, for the engine's plausibility warnings (a mis-tapped anchor shows up here). */
  room?: RoomGeometry;
  /** Shown next to the numbers: every one of them is derived from this anchor. */
  anchor?: AnchorSpec;
  selectedId?: string | null;
  className?: string;
}

type Tone = 'ok' | 'warn' | 'danger' | 'neutral';
const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', neutral: 'text-ink' };

function Metric({ label, value, tone = 'neutral', hint }: { label: string; value: string; tone?: Tone; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-bg-2/60 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</div>
      <div className={cx('mono text-lg leading-tight', TONE_TEXT[tone])}>{value}</div>
      {hint ? <div className="text-[11px] text-ink-3">{hint}</div> : null}
    </div>
  );
}


/** "Coffee table" → "coffee table", but leave "TV console", "L-sectional" and "the window wall" alone. */
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function spotLabel(spot: TightSpot, names: Record<string, string> | undefined): { a: string; b: string } {
  const a = names?.[spot.a] ?? spot.aLabel;
  const b = spot.b.startsWith('wall:') ? spot.bLabel : names?.[spot.b] ?? spot.bLabel;
  return { a: lower(a), b: lower(b) };
}

function walkwayTone(gap: number | null): Tone {
  if (gap == null) return 'neutral';
  if (gap < 0.6) return 'danger';
  if (gap < MIN_WALKWAY_M) return 'warn';
  return 'ok';
}

function floorTone(pct: number): Tone {
  if (pct > 55) return 'danger';
  if (pct > 40) return 'warn';
  return pct > 0 ? 'ok' : 'neutral';
}

/**
 * Live fit report for the room. Always visible in the editor: headline numbers, the narrowest walkway
 * by name, pieces that do not fit (click to select), tight spots under 0.75 m, a door warning and the
 * engine's plausibility checks on the room itself. Every number is mono and toned.
 */
export function FitReportPanel({ report, names, onFocusPiece, room, anchor, selectedId, className }: FitReportPanelProps) {
  const warnings: PlausibilityWarning[] = useMemo(() => (room ? plausibility(room) : []), [room]);
  const name = (id: string) => names?.[id] ?? id;
  const reasonsFor = (id: string): string[] => {
    const out: string[] = [];
    if (report.outOfBounds.includes(id)) out.push('outside the room');
    for (const [a, b] of report.overlaps) {
      if (a === id) out.push(`overlaps the ${lower(name(b))}`);
      else if (b === id) out.push(`overlaps the ${lower(name(a))}`);
    }
    return out;
  };
  const clean = report.misfits.length === 0 && report.blocksDoor.length === 0 && report.tightSpots.length === 0;
  const narrowest = report.narrowestBetween ? spotLabel(report.narrowestBetween, names) : null;
  const focusable = (id: string) => Boolean(onFocusPiece) && !id.startsWith('wall:');

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Fit report</div>
        {anchor ? <AnchorChip anchor={anchor} size="sm" /> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Pieces placed" value={String(report.pieces)} />
        <Metric label="Floor used" value={`${report.floorUsedPct}%`} tone={floorTone(report.floorUsedPct)} hint={`of ${report.floorArea.toFixed(1)}m²`} />
        <Metric label="Do not fit" value={String(report.misfits.length)} tone={report.misfits.length ? 'danger' : report.pieces ? 'ok' : 'neutral'} />
        <Metric label="Walkway" value={report.narrowestWalkway == null ? '—' : m(report.narrowestWalkway)} tone={walkwayTone(report.narrowestWalkway)} hint={report.narrowestWalkway == null ? 'nothing to walk between' : 'narrowest'} />
      </div>

      {narrowest && report.narrowestWalkway != null ? (
        <p className="text-[13px] leading-snug text-ink-2">
          <span className={cx('mono', TONE_TEXT[walkwayTone(report.narrowestWalkway)])}>{m(report.narrowestWalkway)}</span> between the {narrowest.a} and {narrowest.b}.
          {report.narrowestWalkway < MIN_WALKWAY_M ? <span className="text-ink-3"> Most people want {m(MIN_WALKWAY_M)}.</span> : null}
        </p>
      ) : null}

      {report.misfits.length ? (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-danger">
            <Icon.Warning size={13} /> Does not fit
          </div>
          <ul className="flex flex-col gap-1">
            {report.misfits.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onFocusPiece?.(id)}
                  disabled={!focusable(id)}
                  className={cx('flex w-full flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors', selectedId === id ? 'border-danger/60 bg-danger/15' : 'border-danger/25 bg-danger/5 hover:bg-danger/10')}
                >
                  <span className="text-[13px] text-ink">{name(id)}</span>
                  <span className="text-[11px] text-danger/90">{reasonsFor(id).join(' · ') || 'does not fit'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.blocksDoor.length ? (
        <Callout tone="warn" title="Door blocked">
          {report.blocksDoor.map((id, i) => (
            <span key={id}>
              {i > 0 ? ', ' : ''}
              <button type="button" className="underline decoration-warn/50 underline-offset-2 hover:decoration-warn" onClick={() => onFocusPiece?.(id)} disabled={!focusable(id)}>
                {name(id)}
              </button>
            </span>
          ))}{' '}
          {report.blocksDoor.length === 1 ? 'sits' : 'sit'} in the door swing. Keep a <span className="mono">{room ? cm(room.door.width) : 'door-width'}</span> square inside the door clear.
        </Callout>
      ) : null}

      {report.tightSpots.length ? (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-warn">
            <Icon.Ruler size={13} /> Tight spots · under <span className="mono">{m(MIN_WALKWAY_M)}</span>
          </div>
          <ul className="flex flex-col gap-1">
            {report.tightSpots.slice(0, 6).map((s) => {
              const l = spotLabel(s, names);
              const active = selectedId === s.a || selectedId === s.b;
              return (
                <li key={`${s.a}:${s.b}`}>
                  <button
                    type="button"
                    onClick={() => onFocusPiece?.(s.a)}
                    disabled={!focusable(s.a)}
                    className={cx('flex w-full items-baseline gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors', active ? 'border-warn/50 bg-warn/10' : 'border-line hover:bg-surface-2')}
                  >
                    <span className={cx('mono text-[13px]', walkwayTone(s.gap) === 'danger' ? 'text-danger' : 'text-warn')}>{m(s.gap)}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                      {l.a} <span className="text-ink-3">↔</span> {l.b}
                    </span>
                  </button>
                </li>
              );
            })}
            {report.tightSpots.length > 6 ? <li className="px-1 text-[11px] text-ink-3">+{report.tightSpots.length - 6} more</li> : null}
          </ul>
        </section>
      ) : null}

      {clean && report.pieces > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-2.5 py-2 text-[12px] text-ok">
          <Icon.Check size={14} /> Everything fits. Walkways are clear.
        </div>
      ) : null}
      {report.pieces === 0 ? <div className="text-[12px] text-ink-3">Nothing placed yet. Pick a piece from the catalog or auto-stage the room.</div> : null}

      {warnings.length ? (
        <section className="flex flex-col gap-1.5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Room plausibility</div>
          {warnings.map((w) => (
            <Callout key={w.field} tone={w.severity === 'error' ? 'danger' : 'warn'}>
              {w.message}
            </Callout>
          ))}
        </section>
      ) : null}
    </div>
  );
}
