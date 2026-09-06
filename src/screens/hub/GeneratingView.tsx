/**
 * The tour while it generates. Deep-research style: honest per-room progress, an overall bar,
 * a clear "you can leave" promise, and any room that lands early is walkable immediately.
 */
import { useState } from 'react';
import type { Job, Room, Tier, Tour } from '@/state/types';
import { regenerateRoom } from '@/state/jobs';
import { toast } from '@/state/store';
import { notificationPermission, requestNotifications } from '@/lib/notify';
import { clock, eta } from '@/lib/format';
import { Button, Callout, Progress } from '@/components/ui';
import { Icon } from '@/components/icons';
import { JobCard } from './JobCard';
import { isActiveJob, jobRemaining, latestJobFor, type TourStatus } from './jobMeta';
import { useNow } from './useNow';

export function GeneratingView({
  tour,
  rooms,
  jobs,
  status,
  onPeek,
  onShowTour,
}: {
  tour: Tour;
  rooms: Room[];
  jobs: Job[];
  status: TourStatus;
  onPeek: (roomId: string) => void;
  onShowTour: () => void;
}) {
  const now = useNow(true);
  const [perm, setPerm] = useState(notificationPermission());
  const latest = rooms.map((r) => latestJobFor(jobs, r.id));
  const active = latest.filter((j): j is Job => !!j && isActiveJob(j));
  const running = active.filter((j) => j.status === 'running');
  const queued = active.filter((j) => j.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
  // The runner starts at most 3 jobs at once, so queued rooms wait for a slot: simulate the slots.
  const slots = running.map((j) => jobRemaining(j, now));
  while (slots.length < 3) slots.push(0);
  for (const j of queued) {
    const i = slots.indexOf(Math.min(...slots));
    slots[i] += j.etaSeconds;
  }
  const longest = Math.max(0, ...slots);
  const started = active.reduce((m, j) => Math.min(m, j.startedAt ?? j.createdAt), Number.POSITIVE_INFINITY);
  const elapsed = Number.isFinite(started) ? (now - started) / 1000 : 0;
  const generate = (room: Room, tier: Tier) => {
    regenerateRoom(room.id, tier);
    toast({ kind: 'info', title: `${room.name}: generating again`, body: `${tier} tier` });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="panel flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-accent-2">Generating</div>
            <div className="display mt-1 text-2xl text-ink md:text-3xl">
              {status.ready} of {status.total} room{status.total === 1 ? '' : 's'} ready
            </div>
            <div className="mt-1 text-sm text-ink-3">
              {active.length
                ? `${running.length} running${queued.length ? ` · ${queued.length} queued` : ''} · ${longest > 0 ? `${eta(longest)} to go` : 'finishing up'}`
                : 'Wrapping up'}
              {status.ready > 0 ? ' · finished rooms are walkable now' : ''}
            </div>
          </div>
          <div className="text-right">
            <div className="mono text-3xl leading-none text-ink">{status.progress}%</div>
            <div className="mono mt-1 text-[11px] text-ink-3">elapsed {clock(elapsed)}</div>
          </div>
        </div>
        <Progress value={status.progress} className="h-2" />
        <Callout tone="info" title="You can leave this page. We will notify you when it is ready.">
          <div className="flex flex-col gap-2">
            <span>The jobs keep running while you browse other tours, switch tabs, or close this one and come back. The bell in the header and the tab title keep count.</span>
            {perm !== 'granted' && perm !== 'unsupported' ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" onClick={async () => setPerm(await requestNotifications())}>
                  <Icon.Bell size={14} /> Allow browser notifications
                </Button>
                <span className="mono text-[11px] text-ink-3">status: {perm}</span>
              </div>
            ) : perm === 'granted' ? (
              <span className="mono text-[11px] text-ok">browser notifications on{tour.notify.email ? ` · email ${tour.notify.email}` : ''}</span>
            ) : null}
          </div>
        </Callout>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {rooms.map((room, i) => (
          <JobCard key={room.id} room={room} job={latest[i]} now={now} onPeek={onPeek} onGenerate={generate} />
        ))}
      </div>

      {status.ready > 0 ? (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={onShowTour}>
            Open the tour with the rooms that are ready <Icon.ArrowRight size={16} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
