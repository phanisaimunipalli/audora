/**
 * "Upgrading to full quality" — the deep-research banner for a running full-quality pass.
 *
 * The draft is still on screen while this runs, so the promise it makes is the important part: the
 * job survives leaving the page, and the browser will say when full quality is ready.
 */
import { useState } from 'react';
import { LEAVE_COPY, upgradeLine } from '@/state/publish';
import type { Job, Room } from '@/state/types';
import { notificationPermission, requestNotifications } from '@/lib/notify';
import { Button, Callout, Progress, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { jobRemaining } from './jobMeta';
import { useNow } from './useNow';

export interface UpgradeBannerProps {
  /** Queued or running full-quality jobs on rooms that already have a world. */
  jobs: Job[];
  rooms: Room[];
  /** One line and a bar, for the top of a tab. */
  compact?: boolean;
  className?: string;
}

export function UpgradeBanner({ jobs, rooms, compact, className }: UpgradeBannerProps) {
  const now = useNow(jobs.length > 0);
  const [perm, setPerm] = useState(notificationPermission());
  if (!jobs.length) return null;

  const started = Math.min(...jobs.map((j) => j.startedAt ?? j.createdAt));
  const elapsed = Math.max(0, (now - started) / 1000);
  const remaining = Math.max(...jobs.map((j) => (j.status === 'queued' ? j.etaSeconds : jobRemaining(j, now))));
  const allQueued = jobs.every((j) => j.status === 'queued');
  const progress = Math.round(jobs.reduce((a, j) => a + j.progress, 0) / jobs.length);
  const name = (j: Job) => rooms.find((r) => r.id === j.roomId)?.name ?? 'Room';

  if (compact) {
    return (
      <Callout tone="info" title={upgradeLine(elapsed, remaining, allQueued)}>
        <div className="flex flex-col gap-2">
          <span>
            {jobs.length} room{jobs.length === 1 ? '' : 's'} · buyers keep walking the draft until the full reconstruction lands. {LEAVE_COPY}
          </span>
          <Progress value={progress} />
        </div>
      </Callout>
    );
  }

  return (
    <div className={cx('panel flex flex-col gap-3 p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-ink">
          <span className="text-accent-2">
            <Icon.Zap size={16} />
          </span>
          <span className="mono">{upgradeLine(elapsed, remaining, allQueued)}</span>
        </div>
        <span className="mono text-[11px] text-ink-3">{progress}%</span>
      </div>
      <Progress value={progress} />
      <ul className="flex flex-col gap-1">
        {jobs.map((j) => (
          <li key={j.id} className="mono flex items-center justify-between gap-2 text-[11px] text-ink-3">
            <span className="truncate">{name(j)}</span>
            <span className="shrink-0">
              {j.status === 'queued' ? 'queued' : `${j.progress}% · ${j.step}`} · full · {j.provider === 'marble' ? 'marble-1.1' : 'simulated'}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-ink-3">
        <span className="flex-1">{LEAVE_COPY}</span>
        {perm !== 'granted' && perm !== 'unsupported' ? (
          <Button size="sm" variant="secondary" onClick={async () => setPerm(await requestNotifications())}>
            <Icon.Bell size={14} /> Notify me
          </Button>
        ) : (
          <span className="mono text-[11px] text-ok">{perm === 'granted' ? 'browser notifications on' : ''}</span>
        )}
      </div>
    </div>
  );
}
