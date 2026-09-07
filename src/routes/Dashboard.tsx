import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAllTours, useAudora } from '@/state/store';
import { plural, timeAgo } from '@/lib/format';
import { Button, Card, Chip, EmptyState, SectionTitle, Stat, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Bars } from '@/screens/insights/Bars';
import { Sparkline } from '@/screens/insights/Sparkline';
import { mergeItems, pctOf, summarize, type Summary } from '@/screens/insights/stats';

/** Every listing at a glance: who visited, who walked, what they tested, where it did not fit. */
export default function Dashboard() {
  const tours = useAllTours();
  const rooms = useAudora((s) => s.rooms);
  const events = useAudora((s) => s.events);

  const perTour = useMemo(() => {
    const now = Date.now();
    return tours.map((t) => ({
      tour: t,
      rooms: t.roomIds.map((id) => rooms[id]).filter(Boolean),
      summary: summarize(
        events.filter((e) => e.tourId === t.id),
        t.roomIds.map((id) => rooms[id]).filter(Boolean),
        { now },
      ),
    }));
  }, [tours, rooms, events]);

  const totals = useMemo(
    () =>
      perTour.reduce(
        (acc, { summary }) => ({ visitors: acc.visitors + summary.visitors, walked: acc.walked + summary.walked, tested: acc.tested + summary.tested, failures: acc.failures + summary.failures }),
        { visitors: 0, walked: 0, tested: 0, failures: 0 },
      ),
    [perTour],
  );
  const topItems = useMemo(() => mergeItems(perTour.map((p) => p.summary.items)), [perTour]);

  if (!tours.length) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 md:px-6">
        <SectionTitle eyebrow="Insights" title="What buyers do in your listings" />
        <EmptyState
          title="No tours yet."
          body="Create a tour from one photo per room. Every visit, walk and furniture test shows up here."
          action={
            <Link to="/new">
              <Button variant="primary">
                <Icon.Plus size={16} /> New tour
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:px-6">
      <SectionTitle eyebrow="Insights" title="What buyers do in your listings" body="Visitors walk the rooms at eye height and test their own furniture. The failures are the leads: they tell you who is measuring, and what the copy should say." />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <Card className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Stat label="Visitors" value={totals.visitors} hint={plural(tours.length, 'tour')} />
          <Stat label="Walked" value={totals.walked} hint={`${pctOf(totals.walked, totals.visitors)} of visitors`} />
          <Stat label="Tested furniture" value={totals.tested} hint={`${pctOf(totals.tested, totals.visitors)} of visitors`} tone="accent" />
          <Stat label="Fit failures" value={totals.failures} tone={totals.failures ? 'danger' : 'ok'} hint={totals.failures ? 'rooms too small for what buyers own' : 'everything fit'} />
        </Card>
        <Card className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium text-ink">What buyers test most</div>
            <div className="mono text-[11px] text-ink-3">all tours</div>
          </div>
          <Bars
            unit="tests"
            rows={topItems.slice(0, 5).map((it) => ({ key: it.item, label: it.label, value: it.tests, note: it.nofits ? <span className="text-danger">{it.nofits} did not fit</span> : null }))}
            empty="No furniture tests yet. They start as soon as a buyer opens a link."
          />
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {perTour.map(({ tour, rooms: tourRooms, summary }) => (
          <TourRow key={tour.id} tour={tour} roomCount={tourRooms.length} readyCount={tourRooms.filter((r) => r.status === 'ready').length} summary={summary} />
        ))}
      </div>
    </div>
  );
}

function TourRow({ tour, roomCount, readyCount, summary }: { tour: ReturnType<typeof useAllTours>[number]; roomCount: number; readyCount: number; summary: Summary }) {
  const worst = summary.rooms.reduce<Summary['rooms'][number] | null>((w, r) => (r.nofits > (w?.nofits ?? 0) ? r : w), null);
  return (
    <Card className="grid gap-5 lg:grid-cols-[1.2fr_1.6fr_1fr] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/tours/${tour.id}`} className="display truncate text-2xl text-ink hover:text-ink-2">
            {tour.title}
          </Link>
          {tour.published ? <Chip tone="accent">Published</Chip> : <Chip>Draft</Chip>}
        </div>
        <div className="mt-0.5 truncate text-sm text-ink-3">{tour.address}</div>
        <div className="mono mt-2 text-[11px] text-ink-3">
          {readyCount}/{roomCount} {roomCount === 1 ? 'room' : 'rooms'} ready · {tour.price ?? '—'} · updated {timeAgo(tour.updatedAt)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to={`/tours/${tour.id}?tab=insights`} className="ease-audora inline-flex h-8 items-center gap-1.5 rounded-full border border-line-2 bg-bg px-3.5 text-[12.5px] font-semibold text-ink transition-colors duration-200 hover:border-ink-2">
            <Icon.Chart size={14} /> Open insights
          </Link>
          <Link to={`/t/${tour.shareId}`} target="_blank" rel="noreferrer" className="ease-audora inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold text-dim transition-colors duration-200 hover:bg-surface hover:text-ink">
            <Icon.Walk size={14} /> Buyer view
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Visitors" value={summary.visitors} />
        <Stat label="Walked" value={summary.walked} hint={pctOf(summary.walked, summary.visitors)} />
        <Stat label="Tested" value={summary.tested} hint={pctOf(summary.tested, summary.visitors)} tone="accent" />
        <Stat label="No fit" value={summary.failures} tone={summary.failures ? 'danger' : undefined} hint={worst && worst.nofits ? worst.name : undefined} />
      </div>

      <div className={cx('min-w-0')}>
        <div className="mb-1 flex items-baseline justify-between text-[11px] text-ink-3">
          <span>last {summary.windowDays} days</span>
          <span className="mono">{plural(summary.series.reduce((a, b) => a + b, 0), 'visit')}</span>
        </div>
        <Sparkline values={summary.series} labels={summary.labels} height={56} />
      </div>
    </Card>
  );
}
