import type { ReactNode } from 'react';
import { cx } from '@/components/ui';

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** Secondary readout to the right of the count, e.g. "2 did not fit". */
  note?: ReactNode;
  tone?: 'accent' | 'buyer' | 'danger' | 'neutral';
}

const TONES = { accent: 'bg-accent', buyer: 'bg-buyer', danger: 'bg-danger', neutral: 'bg-ink-3' };

/** Horizontal bar list: thin rounded marks, direct mono labels, one hue per job. */
export function Bars({ rows, max, unit, className, empty = 'Nothing yet.' }: { rows: BarRow[]; max?: number; unit?: string; className?: string; empty?: string }) {
  const top = Math.max(1, max ?? Math.max(0, ...rows.map((r) => r.value)));
  if (!rows.length) return <div className={cx('text-sm text-ink-3', className)}>{empty}</div>;
  return (
    <ul className={cx('flex flex-col gap-2.5', className)}>
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{r.label}</span>
            <span className="shrink-0 text-xs text-ink-3">
              <span className="mono text-sm text-ink">{r.value}</span>
              {unit ? ` ${r.value === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit}` : ''}
              {r.note ? <span className="ml-2">{r.note}</span> : null}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div className={cx('h-full rounded-full transition-[width] duration-500', TONES[r.tone ?? 'accent'])} style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
