/**
 * "Plan says / model measures" for one room — docs/ACCURACY.md sections 1 and 3.6.
 *
 * Every published room shows its own numbers: the fused scale with its ±, one line per dimension
 * against the source that constrains it, and every 2σ disagreement named in full. Nothing is
 * presented as more certain than its residual, so an unmeasured room says *unmeasured* rather than
 * quietly showing its anchored geometry as if the model had measured it.
 *
 * All of the arithmetic is in `./accuracy` (pure, tested); this file is layout.
 */
import { useState } from 'react';
import type { Room } from '@/state/types';
import { timeAgo } from '@/lib/format';
import { Chip, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { roomAccuracy, tourAccuracy, type AccuracyLine, type ConfidenceLabel, type MeasurableRoom, type RoomAccuracy, type ToleranceLevel } from './accuracy';

/* Green means "inside the target" and red means "outside the limit"; a warn sits in between and
   stays ink, because the design language keeps colour for verdicts only. */
const LEVEL_TEXT: Record<ToleranceLevel, string> = { ok: 'text-ok', warn: 'text-ink', bad: 'text-danger', unknown: 'text-ink-3' };
/* `none` is the one that earns danger: the room was measured and the answer contradicts itself.
   `unmeasured` is neutral, because nothing has gone wrong — nothing has happened yet. */
const CONFIDENCE_TONE: Record<ConfidenceLabel, 'ok' | 'accent' | 'warn' | 'danger' | 'neutral'> = { high: 'ok', good: 'accent', low: 'warn', none: 'danger', unmeasured: 'neutral' };
const DIMENSION_LABEL: Record<AccuracyLine['dimension'], string> = { width: 'Width', depth: 'Depth', height: 'Ceiling' };

export interface AccuracyCardProps {
  room: MeasurableRoom;
  /** Header row and dimension lines only — for a room card that already names the room. */
  compact?: boolean;
  className?: string;
  /** `Date.now()` is an input, never read inside a render that feeds a measurement. */
  now?: number;
}

export function AccuracyCard({ room, compact, className, now }: AccuracyCardProps) {
  const a = roomAccuracy(room);
  const [open, setOpen] = useState(false);
  return (
    <div className={cx('flex flex-col gap-3 rounded-xl border border-line bg-surface p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="micro">What the model measured</div>
        <Chip tone={CONFIDENCE_TONE[a.confidenceLabel]} mono className="!text-[10px]">
          {a.confidenceChip}
          {a.measured && a.sigmaRel != null ? ` · ±${(a.sigmaRel * 100).toFixed(1)}%` : ''}
        </Chip>
      </div>

      {a.measured ? (
        <ul className="flex flex-col gap-1.5">
          {a.lines.map((line) => (
            <LineRow key={line.dimension} line={line} />
          ))}
        </ul>
      ) : null}

      {/* Why the chip says what it says. Shown for a measured room too, because "no confidence" and
          "the plan is the only source" are the two states a leasing team can actually act on. */}
      {!a.measured || a.confidenceLabel === 'none' || (a.independentSources != null && a.independentSources <= 1) ? (
        <p className="text-xs text-ink-3">{a.confidenceText}</p>
      ) : null}

      {a.flags.length ? (
        <ul className="flex flex-col gap-1 rounded-lg border border-line-2 bg-bg px-3 py-2">
          {a.flags.map((f, i) => (
            <li key={i} className="flex gap-2 text-[12px] leading-snug text-ink-2">
              <span className="mt-0.5 shrink-0 text-ink">
                <Icon.Warning size={13} />
              </span>
              {f}
            </li>
          ))}
        </ul>
      ) : null}

      {!compact ? <Provenance a={a} now={now} /> : null}

      {!compact && a.sources.length ? (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 self-start text-[11px] text-ink-3 hover:text-ink">
            <Icon.ChevronDown size={13} className={cx('transition-transform', open && 'rotate-180')} />
            {open ? 'Hide' : 'Show'} the {a.sources.length} source{a.sources.length === 1 ? '' : 's'} behind the scale
          </button>
          {open ? (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="micro">
                  <th className="pb-1 font-normal">source</th>
                  <th className="pb-1 text-right font-normal">says</th>
                  <th className="pb-1 text-right font-normal">measures</th>
                  <th className="pb-1 text-right font-normal">σ</th>
                </tr>
              </thead>
              <tbody className="mono text-[11px] text-ink-2">
                {a.sources.map((s) => (
                  <tr key={s.source} className="border-t border-line">
                    <td className="py-1 pr-2 font-sans text-ink-2">{s.label}</td>
                    <td className="py-1 text-right">{fmt(s.expected, s.unit)}</td>
                    <td className="py-1 text-right text-ink">{fmt(s.measured, s.unit)}</td>
                    <td className={cx('py-1 text-right', s.sigmas > 2 ? 'text-danger' : 'text-ink-3')}>{s.sigmas.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const fmt = (v: number, unit: 'm' | 'm/unit') => (unit === 'm' ? `${v.toFixed(2)} m` : `${v.toFixed(4)}`);

function LineRow({ line }: { line: AccuracyLine }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="text-[12px] text-ink-2">
        <span className="text-ink-3">{DIMENSION_LABEL[line.dimension]} · </span>
        {line.text}
      </span>
      {line.errorText ? (
        <span className={cx('mono shrink-0 text-[11px]', LEVEL_TEXT[line.level])}>
          {line.errorText}
          {line.level === 'bad' ? ' over' : ''}
        </span>
      ) : (
        <span className="mono shrink-0 text-[11px] text-faint">no source</span>
      )}
    </li>
  );
}

/** The model that measured it and when: the second and third things a room leads with. */
function Provenance({ a, now }: { a: RoomAccuracy; now?: number }) {
  if (!a.model && !a.planText) return null;
  return (
    <div className="mono flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2 text-[11px] text-ink-3">
      {a.model ? (
        <span title={a.provider === 'mock' ? 'Simulated reconstruction' : 'World Labs Marble'}>
          {a.provider === 'mock' ? 'simulated' : a.model}
          {a.tier ? ` · ${a.tier}` : ''}
        </span>
      ) : null}
      {a.modelDate ? <span>· generated {timeAgo(a.modelDate, now)}</span> : null}
      {a.planText ? <span>· plan printed {a.planText}</span> : null}
      {a.scale != null ? <span>· {a.scale.toFixed(4)} m/unit</span> : null}
    </div>
  );
}

/* ---------- the whole unit ---------- */

/**
 * One line for the hub header: how many rooms have been measured, the median error against the plan
 * and how many are outside the 10 % limit. Silent when there is nothing to say.
 */
export function AccuracySummary({ rooms, className }: { rooms: Room[]; className?: string }) {
  const t = tourAccuracy(rooms);
  if (!t.rooms) return null;
  /* Only a width or depth outside the 10 % limit is a red verdict. A ceiling off its stated height
     is reported in the sentence and stays ink: it is usually the assumed 2.44 m that is wrong. */
  const tone = t.overLimit ? 'danger' : t.measured ? 'ok' : 'neutral';
  return (
    <span className={cx('flex flex-wrap items-center gap-2', className)}>
      <Chip tone={tone} mono className="!text-[10px]">
        <Icon.Ruler size={11} /> {t.text}
      </Chip>
      {t.flagged ? (
        <span className="mono text-[11px] text-ink-2">
          {t.flagged} room{t.flagged === 1 ? '' : 's'} disagree with the plan
        </span>
      ) : null}
    </span>
  );
}
