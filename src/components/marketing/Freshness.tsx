import { Icon } from '@/components/icons';
import { SectionTitle, cx } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { MODEL_DATE } from './demoRoom';
import { Reveal } from './Reveal';
import { Section } from './Section';

/** What a model is worth over a tenancy: made at make-ready, stale by the time the unit turns again. */
const LIFE = [
  { at: 'Make-ready', body: 'The unit is empty, painted and photographed. The best input a reconstruction ever gets.', fresh: true },
  { at: 'Listed', body: 'The model goes in the feed with the photos. Renters walk it before they book a showing.', fresh: true },
  { at: 'Leased', body: 'Somebody moves in. The model keeps describing the unit they moved into.', fresh: true },
  { at: '18 months on', body: 'New floors, a new kitchen, a wall colour nobody scanned. The old capture is now a claim about a unit that no longer exists.', fresh: false },
  { at: 'Turnover', body: 'The unit is empty and photographed again — and the model is made again, from this turnover’s photos, with today’s model date on it.', fresh: true },
];

export function Freshness() {
  return (
    <Section id="fresh">
      <Reveal>
        <SectionTitle
          eyebrow="Fresh at every turnover"
          title="A scan ages. A model made this week does not."
          body="Rental units turn over every twelve to twenty-four months, and every turnover produces a fresh set of make-ready photos. That is the moment the model is worth the most, and the moment Audora makes it again."
        />
      </Reveal>

      <div className="mt-10 grid gap-4 md:grid-cols-5">
        {LIFE.map((s, i) => (
          <Reveal key={s.at} delay={i * 0.05} className="h-full">
            <div className={cx('flex h-full flex-col gap-3 border-t pt-4', s.fresh ? 'border-ink' : 'border-line-2')}>
              <div className="flex items-center justify-between gap-2">
                <span className={cx('text-sm font-semibold', s.fresh ? 'text-ink' : 'text-dim')}>{s.at}</span>
                <span className={cx('mono text-[11px]', s.fresh ? 'text-ok' : 'text-warn')}>{s.fresh ? 'fresh' : 'stale'}</span>
              </div>
              <p className="text-sm leading-[1.62] text-dim">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1}>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            {
              title: 'Every unit carries its model date',
              body: `The public page prints it, so a renter can see how old the model is before they trust it. The demo unit reads "generated ${timeAgo(MODEL_DATE)}".`,
              icon: <Icon.Clock />,
            },
            {
              title: 'Regeneration is one action',
              body: 'Drop in the new make-ready photos and the unit is modelled again. The link in the feed does not change, so nothing has to be re-syndicated.',
              icon: <Icon.Rotate />,
            },
            {
              title: 'The plan usually does not change',
              body: 'A unit keeps its layout across tenancies, so the dimensions carry forward and only the finishes are made again. That is what keeps a re-model cheap.',
              icon: <Icon.Ruler />,
            },
          ].map((c) => (
            <div key={c.title} className="panel flex gap-4 p-5">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-bg text-ink shadow-sm">{c.icon}</span>
              <div>
                <div className="text-sm font-medium text-ink">{c.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
