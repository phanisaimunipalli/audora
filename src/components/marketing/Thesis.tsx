import { Reveal } from './Reveal';
import { Eyebrow, Section } from './Section';
import { cx } from '@/components/ui';

interface Row {
  label: string;
  scan: string;
  audora: string;
  mono?: boolean;
}

/* No dollar figures anywhere on this page: what separates the two is the visit, the freshness and
   what happens to the measurements, not the invoice (docs/COPY.md). */
const ROWS: Row[] = [
  { label: 'Capture visit', scan: 'needed. Somebody drives out and walks the unit.', audora: 'none' },
  { label: 'Equipment', scan: 'a capture device, or a phone on a tripod rig', audora: 'the phone photos you already take at make-ready' },
  { label: 'Freshness', scan: 'one scan that ages. It shows the last tenant’s finishes.', audora: 'regenerated at every turnover, from this turnover’s photos' },
  { label: 'Measurements', scan: 'as scanned. One number, no ±.', audora: 'measured against the floor plan, with the uncertainty shown' },
  { label: 'Where it lives', scan: 'a viewer you send people to', audora: 'the link in the listing feed, beside the photos' },
  { label: 'Labelled', scan: 'nothing to label: it is a capture of the unit', audora: 'always. AI-generated from photos, on every frame' },
];

export function Thesis() {
  return (
    <Section id="why">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-5">
          <Reveal>
            <Eyebrow>The problem</Eyebrow>
            <h2 className="display mt-4 text-4xl leading-[1.02] text-ink md:text-5xl">A scan is a visit. A unit turns over.</h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-6 text-[15px] leading-relaxed text-ink-2">
              The 3D tour a renter wants exists already — for the handful of units somebody drove out to scan. Every scan is a scheduled visit with a device, and the day the tenant moves out it starts describing a unit that no longer exists.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
              A leasing team photographs every vacant unit at make-ready anyway, and the floor plan is already on the listing. Audora makes the model out of those two things, checks it against the plan, and makes it again the next time the unit turns.
            </p>
          </Reveal>
        </div>
        <div className="lg:col-span-7">
          <Reveal delay={0.12}>
            <div className="panel overflow-hidden shadow-sm">
              <div className="hidden grid-cols-[1.1fr_1.4fr_1.6fr] gap-4 border-b border-line px-5 py-3 micro md:grid">
                <div />
                <div>A scan of the unit</div>
                <div className="font-semibold text-ink">Audora</div>
              </div>
              {ROWS.map((r, i) => (
                <div key={r.label} className={cx('grid gap-2 px-5 py-4 md:grid-cols-[1.1fr_1.4fr_1.6fr] md:gap-4', i < ROWS.length - 1 && 'border-b border-line')}>
                  <div className="text-sm font-medium text-ink">{r.label}</div>
                  <div className="grid grid-cols-2 gap-3 md:contents">
                    <div className={cx('text-sm text-ink-3', r.mono && 'mono')}>
                      <span className="mb-1 block micro md:hidden">A scan</span>
                      {r.scan}
                    </div>
                    <div className={cx('text-sm text-ink', r.mono && 'mono')}>
                      <span className="mb-1 block micro md:hidden">Audora</span>
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
