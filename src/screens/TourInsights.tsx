import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudora, useTourEvents, useTourRooms } from '@/state/store';
import { fitInsights, type AiMeta } from '@/services/ai';
import { plural, timeAgo, usd } from '@/lib/format';
import { AnchorChip } from '@/components/AnchorChip';
import { Button, Card, Chip, EmptyState, Stat, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Bars } from './insights/Bars';
import { Sparkline } from './insights/Sparkline';
import { pctOf, summarize } from './insights/stats';
import { copyText, publicUrl } from './viewer/share';

export interface TourInsightsProps {
  tourId: string;
  className?: string;
}

/** What renters did in this unit: who opened it, who walked it, which rooms they measured, and what to do about it. */
export function TourInsights({ tourId, className }: TourInsightsProps) {
  const tour = useAudora((s) => s.tours[tourId]);
  const rooms = useTourRooms(tourId);
  const events = useTourEvents(tourId);
  const summary = useMemo(() => summarize(events, rooms), [events, rooms]);

  const [ai, setAi] = useState<{ insights: string[]; meta: AiMeta } | null>(null);
  const [thinking, setThinking] = useState(false);
  const ran = useRef(false);
  const refresh = useCallback(async () => {
    if (!tour) return;
    setThinking(true);
    try {
      setAi(await fitInsights(tour, rooms, events));
    } finally {
      setThinking(false);
    }
  }, [tour, rooms, events]);
  useEffect(() => {
    if (ran.current || !tour) return;
    ran.current = true;
    void refresh();
  }, [tour, refresh]);

  if (!tour) return <div className={cx('p-6 text-sm text-ink-3', className)}>Unit not found.</div>;

  if (events.length === 0) {
    return (
      <div className={className}>
        <EmptyState
          title="No renter activity yet."
          body="Put the link in the listing feed. Every visit, walk and measurement shows up here within seconds."
          action={
            <Button
              variant="primary"
              onClick={async () => {
                await copyText(publicUrl(tour.shareId));
              }}
            >
              <Icon.Copy size={16} /> Copy the link for the listing
            </Button>
          }
        />
      </div>
    );
  }

  const busiest = summary.rooms.reduce<typeof summary.rooms[number] | null>((w, r) => (r.measures > (w?.measures ?? 0) ? r : w), null);
  const totalVisits = summary.series.reduce((a, b) => a + b, 0);

  return (
    <div className={cx('flex flex-col gap-5', className)}>
      <Card className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="Renters" value={summary.visitors} hint={summary.lastEventAt ? `last activity ${timeAgo(summary.lastEventAt)}` : undefined} />
        <Stat label="Walked the unit" value={summary.walked} hint={`${pctOf(summary.walked, summary.visitors)} of renters`} />
        <Stat label="Measurements taken" value={summary.measures} hint={busiest && busiest.measures ? `most in the ${busiest.name.toLowerCase()}` : 'none yet'} tone="accent" />
        <Stat label="Shared the link" value={summary.shares} hint={summary.shares ? 'sent on to someone else' : 'not yet'} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium text-ink">Where renters measured</div>
            <div className="mono text-[11px] text-ink-3">{plural(summary.measures, 'measurement')}</div>
          </div>
          <Bars
            unit="measurements"
            rows={summary.rooms
              .filter((r) => r.measures > 0)
              .sort((a, b) => b.measures - a.measures)
              .map((r) => ({ key: r.roomId, label: r.name, value: r.measures, note: <span className="text-ink-3">{r.walked} walked</span> }))}
            empty="No measurements yet."
          />
          <p className="text-xs text-ink-3">
            A room measured again and again is a room the listing has not described. It is usually the smallest bedroom, and usually the word for it that is wrong.
          </p>
        </Card>

        <Card className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium text-ink">Room by room</div>
            <div className="mono text-[11px] text-ink-3">{plural(summary.rooms.length, 'room')}</div>
          </div>
          <ul className="flex flex-col gap-3">
            {summary.rooms.map((rs) => {
              const room = rooms.find((r) => r.id === rs.roomId);
              const max = Math.max(1, ...summary.rooms.map((r) => r.walked));
              return (
                <li key={rs.roomId} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex items-center gap-2 text-sm text-ink">
                      {rs.name}
                      {room ? <span className="mono text-[11px] text-ink-3">{room.geometry.width.toFixed(2)} × {room.geometry.depth.toFixed(2)} m</span> : null}
                    </div>
                    <div className="text-xs text-ink-3">
                      <span className="mono text-sm text-ink">{rs.walked}</span> walked · <span className="mono text-ink">{rs.measures}</span>{' '}
                      {rs.measures === 1 ? 'measurement' : 'measurements'}
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-ink-3/70" style={{ width: `${Math.max(2, (rs.walked / max) * 100)}%` }} />
                  </div>
                  {room ? <AnchorChip anchor={room.anchor} size="sm" className="self-start" /> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium text-ink">Visits, last {summary.windowDays} days</div>
            <div className="mono text-[11px] text-ink-3">{plural(totalVisits, 'visit')} · {plural(summary.measures, 'measurement')} · {plural(summary.shares, 'share')}</div>
          </div>
          <Sparkline values={summary.series} labels={summary.labels} unit="visits" />
        </Card>

        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon.Sparkles size={16} className="text-ink" />
              <div className="text-sm font-medium text-ink">What to do about it</div>
            </div>
            <div className="flex items-center gap-2">
              {ai ? (
                <Chip tone={ai.meta.source === 'nebius' ? 'accent' : 'neutral'} mono>
                  {ai.meta.source === 'nebius' ? `nebius · ${ai.meta.model ?? 'fast'}` : 'rule-based'}
                  {ai.meta.usd != null ? ` · ${usd(ai.meta.usd)}` : ''}
                </Chip>
              ) : null}
              <Button size="sm" variant="ghost" onClick={refresh} loading={thinking}>
                <Icon.Rotate size={14} /> Refresh
              </Button>
            </div>
          </div>
          {ai ? (
            <ol className="flex flex-col gap-2.5">
              {ai.insights.map((line, i) => (
                <li key={i} className="flex gap-3 text-sm text-ink-2">
                  <span className="mono mt-0.5 shrink-0 text-dim">{i + 1}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="skeleton h-4 w-11/12 rounded" />
              <div className="skeleton h-4 w-3/4 rounded" />
              <div className="skeleton h-4 w-5/6 rounded" />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
