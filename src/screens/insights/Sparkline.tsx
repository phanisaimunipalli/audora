import { useId, useState } from 'react';
import { cx } from '@/components/ui';

export interface SparklineProps {
  values: number[];
  labels?: string[];
  width?: number;
  height?: number;
  className?: string;
  /** What one value is, for the hover readout. */
  unit?: string;
  color?: string;
}

/**
 * A single-series area sparkline with a hover crosshair. The plot stretches to the container
 * (`preserveAspectRatio="none"`), so no text lives inside the SVG: the day labels and the y-scale hint are
 * HTML, positioned in percent, and keep their real letterforms at any width.
 */
export function Sparkline({ values, labels = [], width = 320, height = 72, className, unit = 'visits', color = 'var(--color-ink)' }: SparklineProps) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const padX = 4;
  const padTop = 8;
  const padBottom = 4;
  const max = Math.max(1, ...values);
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const x = (i: number) => padX + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH - (v / max) * innerH;
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)} ${(padTop + innerH).toFixed(1)} L${x(0).toFixed(1)} ${(padTop + innerH).toFixed(1)} Z`;
  const total = values.reduce((a, b) => a + b, 0);
  const hasLabels = labels.some(Boolean);
  /** Percent across the plot area, matching the SVG's own x(). */
  const pct = (i: number) => ((x(i) / width) * 100).toFixed(2);

  return (
    <div className={cx('relative', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="block overflow-visible"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * width;
          const i = Math.round(((px - padX) / innerW) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${total} ${unit} over the period, peaking at ${max} per bin`}
      >
        <defs>
          <linearGradient id={`${id}-g`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.14} />
            <stop offset="1" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <line x1={padX} x2={width - padX} y1={padTop + innerH} y2={padTop + innerH} stroke="var(--color-line)" strokeWidth={1} />
        {n > 1 ? <path d={area} fill={`url(#${id}-g)`} /> : null}
        {n > 1 ? <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padTop} y2={padTop + innerH} stroke="var(--color-line-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(values[hover])} r={4} fill={color} stroke="var(--color-bg)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </g>
        ) : null}
      </svg>

      {/* Day labels and the y-scale hint live in HTML: inside a `preserveAspectRatio="none"` SVG they stretch. */}
      <div className="relative mt-1 h-3.5">
        {hasLabels
          ? labels.map((l, i) =>
              l ? (
                <span
                  key={i}
                  className="mono pointer-events-none absolute top-0 text-[10px] leading-none whitespace-nowrap text-ink-3"
                  style={{ left: `${pct(i)}%`, transform: i === 0 ? 'none' : 'translateX(-50%)' }}
                >
                  {l}
                </span>
              ) : null,
            )
          : null}
        <span className="mono pointer-events-none absolute right-0 top-0 text-[10px] leading-none text-ink-3" title={`The plot is drawn against a peak of ${max} ${unit} per bin.`}>
          peak {max}
        </span>
      </div>

      {hover !== null ? (
        <div className="pointer-events-none absolute -top-1 right-0 rounded-md border border-line-2 bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">
          <span className="mono text-ink">{values[hover]}</span> {unit}
        </div>
      ) : null}
    </div>
  );
}
