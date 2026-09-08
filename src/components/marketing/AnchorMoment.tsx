import { AnchorChip } from '@/components/AnchorChip';
import { Icon } from '@/components/icons';
import { Callout, cx } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { ANCHOR_METHODS, FALLBACK_ANCHORS, HERO_FUSION, HERO_MEASURED, HERO_ROOM, MISTAP, MODEL_DATE } from './demoRoom';
import { Reveal } from './Reveal';
import { Eyebrow, Section } from './Section';

const PX_PER_M = 40;
const PERSON_M = 1.7;

/** The same room at three scales next to a person who is always 1.70 m: only one of them is a home. */
function ScaleFigure() {
  const g = HERO_ROOM.geometry;
  const scales = [
    { s: 0.45, caption: 'doll house' },
    { s: 1, caption: 'a home' },
    { s: 1.8, caption: 'cathedral' },
  ];
  const base = 214;
  const gap = 34;
  const person = PERSON_M * PX_PER_M;
  let x = 12;
  const items = scales.map((sc) => {
    const w = g.width * sc.s * PX_PER_M;
    const h = g.height * sc.s * PX_PER_M;
    const doorH = g.door.height * sc.s * PX_PER_M;
    const doorW = g.door.width * sc.s * PX_PER_M;
    const item = { ...sc, x, w, h, doorH, doorW, px: x + w + 14 };
    x += w + 28 + gap;
    return item;
  });
  const total = x - gap + 12;
  return (
    <svg viewBox={`0 0 ${total} 262`} className="block h-auto w-full" role="img" aria-label="The same room drawn at three scales next to a person of fixed height">
      <line x1={0} y1={base + 0.5} x2={total} y2={base + 0.5} stroke="var(--color-line-2)" strokeWidth={1} />
      {items.map((it) => {
        const px = it.px;
        const head = base - person + 5;
        const label = (it.x + it.w + 28) / 2 + it.x / 2;
        return (
          <g key={it.caption}>
            <rect x={it.x} y={base - it.h} width={it.w} height={it.h} fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth={1.2} />
            <rect x={it.x + Math.max(4, it.w * 0.12)} y={base - it.doorH} width={it.doorW} height={it.doorH} fill="rgba(122,106,63,0.14)" stroke="var(--color-gold)" strokeWidth={1.2} />
            <g stroke="var(--color-ink)" strokeWidth={1.6} strokeLinecap="round" fill="none">
              <circle cx={px} cy={head} r={5} fill="var(--color-ink)" stroke="none" />
              <line x1={px} y1={head + 6} x2={px} y2={base - person * 0.42} />
              <line x1={px - 9} y1={head + 22} x2={px + 9} y2={head + 22} />
              <line x1={px} y1={base - person * 0.42} x2={px - 7} y2={base} />
              <line x1={px} y1={base - person * 0.42} x2={px + 7} y2={base} />
            </g>
            <text x={label} y={base + 18} textAnchor="middle" fontSize={11} fill="var(--color-dim)" style={{ fontFamily: 'var(--font-sans)' }}>
              {it.caption}
            </text>
            <text x={label} y={base + 32} textAnchor="middle" fontSize={10} fill={it.s === 1 ? 'var(--color-gold)' : 'var(--color-faint)'} style={{ fontFamily: 'var(--font-mono)' }}>
              door {(g.door.height * it.s).toFixed(2)} m
            </text>
            <text x={label} y={base + 45} textAnchor="middle" fontSize={10} fill={it.s === 1 ? 'var(--color-gold)' : 'var(--color-faint)'} style={{ fontFamily: 'var(--font-mono)' }}>
              ceiling {(g.height * it.s).toFixed(2)} m
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The measured panel, rendered from the real metric fusion (`shared/fusion.ts`) over the demo room:
 * what the plan printed, what the model measures, the gap, and the confidence the fit earned.
 */
function MeasuredPanel() {
  const lines = HERO_MEASURED.lines;
  const pct = Math.round(HERO_FUSION.confidence * 100);
  return (
    <div className="panel p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="micro">Plan says / model measures</div>
        <div className="mono text-[11px] text-dim">{HERO_ROOM.name} · demo unit</div>
      </div>
      <dl className="mt-3 flex flex-col">
        {lines.map((l, i) => (
          <div key={l.dimension} className={cx('flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5', i < lines.length - 1 && 'border-b border-line')}>
            <dt className="text-sm text-ink capitalize">{l.dimension}</dt>
            <dd className="mono text-[12.5px] text-ink-2">
              {l.expected != null ? (
                <>
                  plan {l.expected.toFixed(2)} m <span className="text-faint">·</span> model {l.measured.toFixed(2)} m{' '}
                  <span className={cx(Math.abs(l.delta ?? 0) > 0.15 ? 'text-warn' : 'text-dim')}>
                    ({(l.delta ?? 0) >= 0 ? '+' : '−'}
                    {Math.abs(l.delta ?? 0).toFixed(2)} m)
                  </span>
                </>
              ) : (
                <>
                  model {l.measured.toFixed(2)} m <span className="text-faint">· not on the plan</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <AnchorChip anchor={HERO_ROOM.anchor} size="sm" />
        <span className="mono text-[11px] text-dim">
          scale ±{(HERO_FUSION.sigmaRel * 100).toFixed(1)} % · confidence {pct}% · model {timeAgo(MODEL_DATE)}
        </span>
      </div>
    </div>
  );
}

export function AnchorMoment() {
  const g = HERO_ROOM.geometry;
  const worst = MISTAP.warnings.find((w) => w.field === 'height') ?? MISTAP.warnings[0];
  return (
    <Section id="anchor" className="border-y border-line bg-surface">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <Reveal>
            <Eyebrow>Measured, honestly</Eyebrow>
            <h2 className="display mt-4 text-4xl leading-[1.02] text-ink md:text-5xl">Photos have no scale.</h2>
            <p className="mt-6 text-[17px] leading-relaxed text-ink-2">
              A unit reconstructed from pictures could be a doll house or a cathedral. One real measurement gives every other number a size, and the floor plan says whether that size is right.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-8">
            <div className="panel p-4 md:p-5">
              <div className="overflow-x-auto">
                <div className="min-w-[480px]">
                  <ScaleFigure />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
                <span>Same photos. Same proportions. The person is always 1.70 m.</span>
                <span className="mono">
                  {g.width.toFixed(2)} × {g.depth.toFixed(2)} m when anchored
                </span>
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.15} className="mt-10">
            <h3 className="display text-2xl text-ink md:text-3xl">Why the ± is on the screen</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              A renter measuring a wall is about to decide whether their bed goes there. A number with no uncertainty invites them to trust it exactly, and a wrong anchor makes every number in the room wrong by the same factor. So Audora shows the anchor next to every dimension, permanently, and shows what the plan said beside what the model measured — including when the two disagree.
            </p>
            <div className="mt-5">
              <Callout tone="danger" title="Tap a 1.20 m cabinet door by mistake, and the engine says so:">
                <span className="mono">{worst?.message}</span>
              </Callout>
            </div>
          </Reveal>
        </div>

        <div className="lg:col-span-7">
          <div className="grid gap-4 sm:grid-cols-2">
            {ANCHOR_METHODS.map((m, i) => (
              <Reveal key={m.key} delay={i * 0.06} className="h-full">
                <div className="panel flex h-full flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-medium text-ink">{m.title}</div>
                      <div className="mt-0.5 text-xs text-ink-3">{m.how}</div>
                    </div>
                    <div className="mono text-2xl leading-none text-gold">±{Math.round(m.anchor.uncertaintyM * 100)}<span className="text-sm text-ink-3">cm</span></div>
                  </div>
                  <AnchorChip anchor={m.anchor} size="sm" className="self-start" />
                  <p className="text-sm leading-relaxed text-ink-2">{m.why}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.2} className="mt-6">
            <div className="rounded-2xl border border-dashed border-line-2 p-5">
              <div className="flex items-center gap-2 text-sm text-ink">
                <Icon.Warning size={16} className="text-warn" /> And when nobody anchors the unit, the chip says so.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {FALLBACK_ANCHORS.map((f) => (
                  <div key={f.anchor.method} className="flex flex-col gap-1.5">
                    <AnchorChip anchor={f.anchor} size="sm" />
                    <span className="text-[11px] text-ink-3">{f.label}</span>
                  </div>
                ))}
              </div>
              <p className={cx('mt-4 text-xs text-ink-3')}>Every screen that shows a dimension shows the chip. A 0.83 m gap from a door anchor is 0.83 ± 0.04. From nothing at all it is 0.83 ± 0.30, and the chip turns amber until someone measures.</p>
            </div>
          </Reveal>
          <Reveal delay={0.25} className="mt-6">
            <MeasuredPanel />
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
