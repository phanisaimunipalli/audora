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

/** What buyers did with this listing: visitors, walked, tested, fit failures per room, and three things to act on. */
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

  if (!tour) return <div className={cx('p-6 text-sm text-ink-3', className)}>Tour not found.</div>;

  if (events.length === 0) {
    return (
      <div className={className}>
        <EmptyState
          title="No buyer activity yet."
          body="Share the link in the listing. Every visit, walk, measurement and furniture test shows up here within seconds."
          action={
            <Button
              variant="primary"
              onClick={async () => {
                await copyText(publicUrl(tour.shareId));
              }}
            >
              <Icon.Copy size={16} /> Copy the buyer link
            </Button>
          }
        />
      </div>
    );
  }

  const worst = summary.rooms.reduce<typeof summary.rooms[number] | null>((w, r) => (r.nofits > (w?.nofits ?? 0) ? r : w), null);
  const totalVisits = summary.series.reduce((a, b) => a + b, 0);

  return (
    <div className={cx('flex flex-col gap-5', className)}>
      <Card className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="Visitors" value={summary.visitors} hint={summary.lastEventAt ? `last activity ${timeAgo(summary.lastEventAt)}` : undefined} />
        <Stat label="Walked the room" value={summary.walked} hint={`${pctOf(summary.walked, summary.visitors)} of visitors`} />
        <Stat label="Tested their own furniture" value={summary.tested} hint={`${pctOf(summary.tested, summary.visitors)} of visitors`} tone="accent" />
        <Stat label="Fit failures" value={summary.failures} hint={worst && worst.nofits ? `${worst.nofits} in ${worst.name}` : 'nothing failed to fit'} tone={summary.failures ? 'danger' : 'ok'} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium text-ink">Most-tested pieces</div>
            <div className="mono text-[11px] text-ink-3">{plural(summary.items.reduce((a, b) => a + b.tests, 0), 'test')}</div>
          </div>
          <Bars
            unit="tests"
            rows={summary.items.slice(0, 6).map((it) => ({
              key: it.item,
              label: it.label,
              value: it.tests,
              note: it.nofits ? <span className="text-danger">{it.nofits} did not fit</span> : it.fits ? <span className="text-ok">all fit</span> : null,
            }))}
            empty="No furniture tests yet."
          />
        </Card>

        <Card className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium text-ink">Fit failures per room</div>
            <div className="mono text-[11px] text-ink-3">{summary.failures} total</div>
          </div>
          <ul className="flex flex-col gap-3">
            {summary.rooms.map((rs) => {
              const room = rooms.find((r) => r.id === rs.roomId);
              const max = Math.max(1, ...summary.rooms.map((r) => r.nofits));
              return (
                <li key={rs.roomId} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex items-center gap-2 text-sm text-ink">
                      {rs.nofits ? <Icon.Warning size={14} className="text-danger" /> : <Icon.Check size={14} className="text-ok" />}
                      {rs.name}
                      {room ? <span className="mono text-[11px] text-ink-3">{room.geometry.width.toFixed(2)} × {room.geometry.depth.toFixed(2)} m</span> : null}
                    </div>
                    <div className="text-xs text-ink-3">
                      <span className={cx('mono text-sm', rs.nofits ? 'text-danger' : 'text-ink')}>{rs.nofits}</span> did not fit · <span className="mono text-ink">{rs.tests}</span> {rs.tests === 1 ? 'test' : 'tests'} · <span className="mono text-ink">{rs.walked}</span> walked
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                    <div className={cx('h-full rounded-full', rs.nofits ? 'bg-danger' : 'bg-ok/50')} style={{ width: `${rs.nofits ? Math.max(4, (rs.nofits / max) * 100) : 2}%` }} />
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
              <Icon.Sparkles size={16} className="text-accent-2" />
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
                  <span className="mono mt-0.5 shrink-0 text-accent-2">{i + 1}</span>
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
