import { Reveal } from './Reveal';
import { Eyebrow, Section } from './Section';
import { TIER_INFO } from '@/services/mockWorld';
import { cx } from '@/components/ui';

interface Row {
  label: string;
  staging: string;
  audora: string;
  mono?: boolean;
}

const ROWS: Row[] = [
  { label: 'Cost', staging: '$50–100 per photo', audora: `$${TIER_INFO.draft.usd.toFixed(2)} draft · $${TIER_INFO.full.usd.toFixed(2)} full, to make`, mono: true },
  { label: 'Turnaround', staging: 'about a day', audora: 'draft ≈ 1 min · full ≈ 10 min', mono: true },
  { label: 'Scale', staging: 'implied by the render. Nobody measured.', audora: 'anchored to one real measurement, ± shown next to every number' },
  { label: 'Walk it', staging: 'no, it is a photo', audora: 'yes. WASD or touch, at 1.60 m eye height' },
  { label: 'Test your furniture', staging: 'no', audora: 'type it: "sectional, 220 by 95". The engine answers.' },
  { label: 'Who judges the fit', staging: 'the stylist', audora: 'the person deciding' },
  { label: 'Labelled', staging: 'sometimes', audora: 'always. digitally staged, on every frame' },
];

export function Thesis() {
  return (
    <Section id="why">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-5">
          <Reveal>
            <Eyebrow>The problem</Eyebrow>
            <h2 className="display mt-4 text-4xl leading-[1.02] text-ink md:text-5xl">An empty room photograph is a dead end.</h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-6 text-[15px] leading-relaxed text-ink-2">
              A buyer looks at the listing and cannot tell whether the living room takes their sofa. So sellers pay for virtual staging: a stylist drops rendered furniture into the photo. It costs $50 to $100 per photo, takes about a day, and lies a little about scale, because nobody measured anything. It answers none of the questions the buyer actually has.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
              Audora makes the room itself. Walkable, measurable, and testable by the person deciding.
            </p>
          </Reveal>
        </div>
        <div className="lg:col-span-7">
          <Reveal delay={0.12}>
            <div className="panel overflow-hidden">
              <div className="hidden grid-cols-[1.1fr_1.4fr_1.6fr] gap-4 border-b border-line px-5 py-3 text-[11px] uppercase tracking-[0.14em] text-ink-3 md:grid">
                <div />
                <div>Virtual staging</div>
                <div className="text-accent-2">Audora</div>
              </div>
              {ROWS.map((r, i) => (
                <div key={r.label} className={cx('grid gap-2 px-5 py-4 md:grid-cols-[1.1fr_1.4fr_1.6fr] md:gap-4', i < ROWS.length - 1 && 'border-b border-line')}>
                  <div className="text-sm font-medium text-ink">{r.label}</div>
                  <div className="grid grid-cols-2 gap-3 md:contents">
                    <div className={cx('text-sm text-ink-3', r.mono && 'mono')}>
                      <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-ink-3 md:hidden">Virtual staging</span>
                      {r.staging}
                    </div>
                    <div className={cx('text-sm text-ink', r.mono && 'mono')}>
                      <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-accent-2 md:hidden">Audora</span>
                      {r.audora}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
