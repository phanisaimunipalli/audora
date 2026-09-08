import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAllTours, useAudora } from '@/state/store';
import { plural, timeAgo } from '@/lib/format';
import { Button, Card, Chip, EmptyState, SectionTitle, Stat, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Bars } from '@/screens/insights/Bars';
import { Sparkline } from '@/screens/insights/Sparkline';
import { pctOf, summarize, type Summary } from '@/screens/insights/stats';

/** Every unit at a glance: who opened it, who walked it, what they measured, and where. */
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
        (acc, { summary }) => ({
          visitors: acc.visitors + summary.visitors,
          walked: acc.walked + summary.walked,
          measures: acc.measures + summary.measures,
          shares: acc.shares + summary.shares,
        }),
        { visitors: 0, walked: 0, measures: 0, shares: 0 },
      ),
    [perTour],
  );
  /** Which rooms renters measured most, across every unit: the rooms whose size is in question. */
  const measuredRooms = useMemo(
    () =>
      perTour
        .flatMap(({ tour, summary }) => summary.rooms.map((r) => ({ ...r, key: `${tour.id}:${r.roomId}`, unit: tour.title })))
        .filter((r) => r.measures > 0)
        .sort((a, b) => b.measures - a.measures),
    [perTour],
  );

  if (!tours.length) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 md:px-6">
        <SectionTitle eyebrow="Insights" title="What renters do in your units" />
        <EmptyState
          title="No units yet."
          body="Add a unit from its photos and floor plan. Every visit, walk and measurement shows up here."
          action={
            <Link to="/new">
              <Button variant="primary">
                <Icon.Plus size={16} /> Add a unit
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:px-6">
      <SectionTitle
        eyebrow="Insights"
        title="What renters do in your units"
        body="Renters walk the rooms at eye height and measure the walls they care about. Where they measure is where the listing text is not answering the question."
      />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <Card className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Stat label="Renters" value={totals.visitors} hint={plural(tours.length, 'unit')} />
          <Stat label="Walked" value={totals.walked} hint={`${pctOf(totals.walked, totals.visitors)} of renters`} />
          <Stat label="Measurements" value={totals.measures} tone="accent" hint={totals.measures ? 'taken inside the models' : 'none yet'} />
          <Stat label="Shared the link" value={totals.shares} hint={totals.shares ? 'sent on to someone else' : 'not yet'} />
        </Card>
        <Card className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium text-ink">Most-measured rooms</div>
            <div className="mono text-[11px] text-ink-3">all units</div>
          </div>
          <Bars
            unit="measurements"
            rows={measuredRooms.slice(0, 5).map((r) => ({ key: r.key, label: r.name, value: r.measures, note: <span className="text-ink-3">{r.unit}</span> }))}
            empty="No measurements yet. They start as soon as a renter opens a link."
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
  const busiest = summary.rooms.reduce<Summary['rooms'][number] | null>((w, r) => (r.measures > (w?.measures ?? 0) ? r : w), null);
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
          {readyCount}/{roomCount} {roomCount === 1 ? 'room' : 'rooms'} ready · {tour.price ?? 'rent not set'} · updated {timeAgo(tour.updatedAt)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to={`/tours/${tour.id}?tab=insights`} className="ease-audora inline-flex h-8 items-center gap-1.5 rounded-full border border-line-2 bg-bg px-3.5 text-[12.5px] font-semibold text-ink transition-colors duration-200 hover:border-ink-2">
            <Icon.Chart size={14} /> Open insights
          </Link>
          <Link to={`/t/${tour.shareId}`} target="_blank" rel="noreferrer" className="ease-audora inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold text-dim transition-colors duration-200 hover:bg-surface hover:text-ink">
            <Icon.Walk size={14} /> Renter view
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Renters" value={summary.visitors} />
        <Stat label="Walked" value={summary.walked} hint={pctOf(summary.walked, summary.visitors)} />
        <Stat label="Measured" value={summary.measures} tone="accent" hint={busiest && busiest.measures ? busiest.name : undefined} />
        <Stat label="Shared" value={summary.shares} />
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
