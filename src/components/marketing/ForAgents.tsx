import { useMemo } from 'react';
import { useAllTours, useAudora } from '@/state/store';
import { DEMO_SHARE_ID } from '@/state/seed';
import { plural } from '@/lib/format';
import { Icon } from '@/components/icons';
import { Stat, cx } from '@/components/ui';
import { pctOf, summarize, type Summary } from '@/screens/insights/stats';
import { Reveal } from './Reveal';
import { Eyebrow, Section } from './Section';

interface Piece {
  name: string;
  tests: number;
  failed: number;
  where: string;
}

interface Demo {
  title: string;
  published: boolean;
  summary: Summary;
  pieces: Piece[];
  worstRoom?: { name: string; nofits: number };
  bestPiece?: Piece;
}

/**
 * The numbers on this page are the demo listing's actual analytics, rolled up with the same
 * `summarize()` the agent dashboard uses. Hard-coded copy drifted out of step with the seed
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

    const roomName = (id?: string) => tourRooms.find((r) => r.id === id)?.name;
    const pieces: Piece[] = summary.items.slice(0, 3).map((it) => {
      const where = [
        ...new Set(
          mine
            .filter((e) => e.type === 'test' && e.item && e.item.trim().toLowerCase().replace(/s$/, '') === it.item.replace(/s$/, ''))
            .map((e) => roomName(e.roomId))
            .filter(Boolean) as string[],
        ),
      ];
      return { name: it.label, tests: it.tests, failed: it.nofits, where: where.join(', ').toLowerCase() || 'across the listing' };
    });
    const worst = summary.rooms.reduce<Summary['rooms'][number] | null>((w, r) => (r.nofits > (w?.nofits ?? 0) ? r : w), null);
    return {
      title: tour.title,
      published: tour.published,
      summary,
      pieces,
      worstRoom: worst && worst.nofits ? { name: worst.name, nofits: worst.nofits } : undefined,
      bestPiece: pieces.find((p) => p.tests > 0 && p.failed === 0),
    };
  }, [tours, rooms, events]);
}

function DashboardMock({ demo }: { demo: Demo }) {
  const { summary } = demo;
  const maxWalked = Math.max(1, ...summary.rooms.map((r) => r.walked));
  return (
    <div className="panel overflow-hidden">
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
        <Stat label="Visitors" value={summary.visitors} />
        <Stat label="Walked" value={summary.walked} hint={`${pctOf(summary.walked, summary.visitors)} of visitors`} />
        <Stat label="Tested furniture" value={summary.tested} hint={`${pctOf(summary.tested, summary.walked)} of walkers`} tone="accent" />
        <Stat
          label="Fit failures"
          value={summary.failures}
          hint={demo.worstRoom ? `all in the ${demo.worstRoom.name.toLowerCase()}` : 'everything fit'}
          tone={summary.failures ? 'danger' : 'ok'}
        />
      </div>
      <div className="border-t border-line px-5 py-5">
        <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-ink-3">Per room</div>
        <div className="flex flex-col gap-3">
          {summary.rooms.map((r) => (
            <div key={r.roomId} className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[150px_1fr_auto]">
              <div className="truncate text-sm text-ink" title={r.name}>
                {r.name}
              </div>
              <div className="col-span-2 flex h-2 overflow-hidden rounded-full bg-surface-3 sm:col-span-1">
                <div className="h-full bg-ink-3/70" style={{ width: `${(r.walked / maxWalked) * 100}%` }} />
              </div>
              <div className="mono flex items-center gap-3 text-xs sm:justify-self-end">
                <span className="text-ink-2">{r.walked} walked</span>
                <span className="text-ink-2">{r.tests} tested</span>
                <span className={cx(r.nofits ? 'text-danger' : 'text-ink-3')}>{r.nofits} failed</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {demo.pieces.length ? (
        <div className="border-t border-line px-5 py-5">
          <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-ink-3">Most tested pieces</div>
          <div className="flex flex-col gap-2">
            {demo.pieces.map((p) => (
              <div key={p.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="inline-flex h-2 w-2 rounded-full bg-buyer" />
                <span className="text-ink">{p.name}</span>
                <span className="mono ml-auto text-xs text-ink-2">
                  {plural(p.tests, 'test')} · <span className={cx(p.failed ? 'text-danger' : 'text-ok')}>{p.failed ? `${p.failed} did not fit` : 'all fit'}</span>
                </span>
                <span className="w-full text-[11px] text-ink-3 sm:w-auto">{p.where}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function changes(demo: Demo | null): { title: string; body: string }[] {
  const worst = demo?.worstRoom;
  const best = demo?.bestPiece;
  const failing = demo?.pieces.find((p) => p.failed > 0);
  return [
    {
      title: 'Copy',
      body:
        worst && failing
          ? `${plural(failing.failed, 'buyer')} tried a ${failing.name.toLowerCase()} in the ${worst.name.toLowerCase()} and it did not fit. Stop calling it a second bedroom. Say “study” or “fits a double”, and stop losing the viewing at the doorway.`
          : 'When a piece fails in the same room again and again, the room is not what the listing calls it. Change the word before you change the price.',
    },
    {
      title: 'Price',
      body: 'A two-bed that sleeps one couple is a different property. Better to know before the offers than after the inspection.',
    },
    {
      title: 'Which buyers to pursue',
      body: best
        ? `${plural(best.tests, 'person', 'people')} tested a ${best.name.toLowerCase()} in the ${best.where.split(',')[0]} and got “fits”. They are further along than anyone who only looked at the photos. Call them first.`
        : 'Anyone who tested their own furniture and got “fits” is further along than anyone who only looked at the photos. Call them first.',
    },
  ];
}

export function ForAgents() {
  const demo = useDemoStats();
  return (
    <Section id="agents">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <Reveal>
            <Eyebrow>For agents</Eyebrow>
            <h2 className="display mt-4 text-4xl leading-[1.02] text-ink md:text-5xl">The loop that closes.</h2>
            <p className="mt-6 text-[15px] leading-relaxed text-ink-2">
              Photos tell you who looked. Audora tells you who walked, who tested a piece, and where it failed. That is the difference between a listing and a conversation.
            </p>
          </Reveal>
          <div className="mt-8 flex flex-col gap-3">
            {changes(demo).map((c, i) => (
              <Reveal key={c.title} delay={0.06 * i}>
                <div className="flex gap-4 rounded-2xl border border-line bg-surface/60 p-4">
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/40 bg-accent/10 text-accent-2">
                    <Icon.Chart size={16} />
                  </span>
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
