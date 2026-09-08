import { useMemo, type ReactNode } from 'react';
import { useAllTours, useAudora } from '@/state/store';
import { DEMO_SHARE_ID } from '@/state/seed';
import { plural } from '@/lib/format';
import { Icon } from '@/components/icons';
import { Stat, cx } from '@/components/ui';
import { pctOf, summarize, type Summary } from '@/screens/insights/stats';
import { Reveal } from './Reveal';
import { Eyebrow, Section } from './Section';

interface Demo {
  title: string;
  published: boolean;
  summary: Summary;
  busiest?: { name: string; walked: number };
}

/**
 * The numbers on this page are the demo unit's actual analytics, rolled up with the same
 * `summarize()` the leasing dashboard uses. Hard-coded copy drifted out of step with the seed
 * (a room that "walked 14" while the events said 8), which is the one thing this section cannot afford.
 */
function useDemoStats(): Demo | null {
  const tours = useAllTours();
  const rooms = useAudora((s) => s.rooms);
  const events = useAudora((s) => s.events);
  return useMemo(() => {
    const tour = tours.find((t) => t.shareId === DEMO_SHARE_ID);
    if (!tour) return null;
    const tourRooms = tour.roomIds.map((id) => rooms[id]).filter(Boolean);
    const mine = events.filter((e) => e.tourId === tour.id);
    if (!tourRooms.length || !mine.length) return null;
    const summary = summarize(mine, tourRooms);
    const busiest = summary.rooms.reduce<Summary['rooms'][number] | null>((w, r) => (r.walked > (w?.walked ?? 0) ? r : w), null);
    return {
      title: tour.title,
      published: tour.published,
      summary,
      busiest: busiest && busiest.walked ? { name: busiest.name, walked: busiest.walked } : undefined,
    };
  }, [tours, rooms, events]);
}

function DashboardMock({ demo }: { demo: Demo }) {
  const { summary } = demo;
  const maxWalked = Math.max(1, ...summary.rooms.map((r) => r.walked));
  return (
    <div className="panel overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="text-sm font-medium text-ink">{demo.title}</div>
          <div className="mono text-[11px] text-ink-3">
            last {summary.windowDays} days · {plural(summary.rooms.length, 'room')} · {demo.published ? 'published' : 'draft'}
          </div>
        </div>
        <span className="chip mono !text-[11px]">demo data</span>
      </div>
      <div className="grid grid-cols-2 gap-5 px-5 py-5 sm:grid-cols-4">
        <Stat label="Renters" value={summary.visitors} />
        <Stat label="Walked the unit" value={summary.walked} hint={`${pctOf(summary.walked, summary.visitors)} of renters`} />
        <Stat label="Measurements" value={summary.measures} tone="accent" hint={summary.measures ? 'taken inside the model' : 'none yet'} />
        <Stat label="Shared the link" value={summary.shares} hint={demo.busiest ? `busiest: ${demo.busiest.name.toLowerCase()}` : undefined} />
      </div>
      <div className="border-t border-line px-5 py-5">
        <div className="mb-3 micro">Per room</div>
        <div className="flex flex-col gap-3">
          {summary.rooms.map((r) => (
            <div key={r.roomId} className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[150px_1fr_auto]">
              <div className="truncate text-sm text-ink" title={r.name}>
                {r.name}
              </div>
              <div className="col-span-2 flex h-2 overflow-hidden rounded-full bg-surface-2 sm:col-span-1">
                <div className="h-full bg-ink-3/70" style={{ width: `${(r.walked / maxWalked) * 100}%` }} />
              </div>
              <div className="mono flex items-center gap-3 text-xs sm:justify-self-end">
                <span className="text-ink-2">{r.walked} walked</span>
                <span className={cx(r.measures ? 'text-ink-2' : 'text-ink-3')}>{r.measures} measured</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const BENEFITS: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: 'Fewer wasted showings',
    body: 'A renter who has already walked the unit and measured the bedroom wall does not need an afternoon to find out it is too small. The showings that remain are with people who know what they are coming to see.',
    icon: <Icon.Walk />,
  },
  {
    title: 'One link, in the feed you already syndicate',
    body: 'Each unit gets a hosted URL for the virtual-tour field, an embed for your own site and a QR for the signage. Nothing new to log into, and nothing for the marketplaces to install.',
    icon: <Icon.Link />,
  },
  {
    title: 'Every vacant unit modelled in a week',
    body: 'The inputs are the make-ready photos and the floor plans you already hold. Start the whole vacancy list on Monday and walk it on Friday — no capture visits to schedule.',
    icon: <Icon.Home />,
  },
  {
    title: 'Regenerate when the unit turns',
    body: 'New tenant, new paint, new photos: run it again and the same link serves the unit as it is now, with a model date that proves it.',
    icon: <Icon.Rotate />,
  },
];

export function ForAgents() {
  const demo = useDemoStats();
  return (
    <Section id="teams">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <Reveal>
            <Eyebrow>For leasing teams</Eyebrow>
            <h2 className="display mt-4 text-4xl leading-[1.02] text-ink md:text-5xl">The work is already done. This is what it is worth.</h2>
            <p className="mt-6 text-[15px] leading-relaxed text-ink-2">
              You photograph every unit at make-ready and you hold every floor plan. Audora turns that into something a renter can walk, and tells you which rooms they walked and what they measured.
            </p>
          </Reveal>
          <div className="mt-8 flex flex-col gap-3">
            {BENEFITS.map((c, i) => (
              <Reveal key={c.title} delay={0.06 * i}>
                <div className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-bg text-ink shadow-sm">{c.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-ink">{c.title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">{c.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
        <div className="lg:col-span-7">{demo ? <Reveal delay={0.1} y={24}><DashboardMock demo={demo} /></Reveal> : null}</div>
      </div>
    </Section>
  );
}
