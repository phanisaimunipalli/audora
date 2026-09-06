/**
 * The header bell. Deep-research style: a popover with every running generation (tour, room,
 * tier, progress, step, ETA, elapsed) and the recently finished ones. Opening it marks the
 * finished jobs as seen; the tab title badge follows the unseen count.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActiveJobs, useAllJobs, useAudora, useUnseenDone } from '@/state/store';
import type { Job } from '@/state/types';
import { setTitleBadge } from '@/lib/notify';
import { clock, eta, timeAgo } from '@/lib/format';
import { isActiveJob, jobElapsed, jobRemaining, providerName } from '@/screens/hub/jobMeta';
import { useNow } from '@/screens/hub/useNow';
import { Icon } from './icons';
import { Progress, cx } from './ui';

export function JobsTray() {
  const active = useActiveJobs();
  const unseen = useUnseenDone();
  const all = useAllJobs();
  const tours = useAudora((s) => s.tours);
  const rooms = useAudora((s) => s.rooms);
  const markJobsSeen = useAudora((s) => s.markJobsSeen);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(open && active.length > 0);

  useEffect(() => setTitleBadge(unseen.length), [unseen.length]);

  // Opening the tray is "seeing" the finished jobs; keep them highlighted until it closes.
  const unseenKey = unseen.map((j) => j.id).join(',');
  useEffect(() => {
    if (!open || !unseenKey) return;
    const ids = unseenKey.split(',');
    setHighlight((h) => [...new Set([...h, ...ids])]);
    markJobsSeen(ids);
  }, [open, unseenKey, markJobsSeen]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) setHighlight([]);
    setOpen((v) => !v);
  };

  const recent = all.filter((j) => !isActiveJob(j)).sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt)).slice(0, 6);
  const badge = active.length > 0 ? active.length : unseen.length;
  const name = (j: Job) => ({ tour: tours[j.tourId]?.title ?? 'Deleted tour', room: rooms[j.roomId]?.name ?? 'Deleted room' });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Generation jobs"
        aria-expanded={open}
        title={active.length ? `${active.length} generating` : unseen.length ? `${unseen.length} finished` : 'Generation jobs'}
        className={cx('relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors', open ? 'border-accent/50 bg-accent/10 text-accent-2' : 'border-line-2 bg-surface-2 text-ink-2 hover:text-ink')}
      >
        {active.length > 0 ? <span className="absolute inset-0 animate-pulse-soft rounded-lg ring-2 ring-accent/50" /> : null}
        <Icon.Bell size={17} />
        {badge > 0 ? (
          <span className={cx('mono absolute -right-1 -top-1 h-4 min-w-4 rounded-full px-1 text-[10px] font-semibold leading-4', active.length > 0 ? 'bg-accent text-[#1a0f0a]' : 'bg-ok text-[#08131f]')}>{badge}</span>
        ) : null}
      </button>

      {open ? (
        <div className="popover animate-rise fixed inset-x-3 top-16 z-50 flex flex-col gap-3 rounded-2xl p-3 shadow-soft sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[420px]">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-medium text-ink">Generation</span>
            <span className="mono text-[11px] text-ink-3">
              {active.length} running · {recent.length} recent
            </span>
          </div>

          {active.length ? (
            <ul className="flex flex-col gap-2">
              {active.map((j) => {
                const n = name(j);
                const remaining = jobRemaining(j, now);
                return (
                  <li key={j.id} className="rounded-xl border border-line bg-surface p-3">
                    <Link to={`/tours/${j.tourId}`} onClick={() => setOpen(false)} className="flex flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm text-ink">
                          <span className="block truncate" title={n.room}>{n.room}</span>
                          <span className="block truncate text-xs text-ink-3" title={n.tour}>{n.tour}</span>
                        </span>
                        <span className="mono shrink-0 text-xs text-ink-2">{clock(jobElapsed(j, now))}</span>
                      </div>
                      <Progress value={j.progress} />
                      <div className="mono flex items-center justify-between text-[11px] text-ink-3">
                        <span className="truncate">
                          {j.status === 'queued' ? 'queued' : j.step} · {j.tier} · {providerName(j.provider).toLowerCase()}
                        </span>
                        <span className="shrink-0">{j.status === 'queued' ? 'starting' : remaining > 0 ? `${eta(remaining)} left` : 'any moment'}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-1 text-xs text-ink-3">Nothing is generating right now.</div>
          )}

          {recent.length ? (
            <>
              <div className="px-1 text-[11px] uppercase tracking-[0.12em] text-ink-3">Recently finished</div>
              <ul className="flex flex-col gap-1">
                {recent.map((j) => {
                  const n = name(j);
                  const hot = highlight.includes(j.id);
                  return (
                    <li key={j.id}>
                      <Link
                        to={`/tours/${j.tourId}`}
                        onClick={() => setOpen(false)}
                        className={cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2', hot && 'bg-ok/10')}
                      >
                        <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', j.status === 'done' ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger')}>
                          {j.status === 'done' ? <Icon.Check size={12} /> : <Icon.Warning size={12} />}
                        </span>
                        <span className="min-w-0 flex-1 text-sm text-ink" title={`${n.room} · ${n.tour}`}>
                          <span className="block truncate">{n.room}</span>
                          <span className="block truncate text-[11px] text-ink-3">{n.tour}</span>
                        </span>
                        <span className="mono shrink-0 text-[11px] text-ink-3">
                          {j.tier} · {j.status === 'done' ? clock(jobElapsed(j, j.finishedAt ?? now)) : 'failed'} · {timeAgo(j.finishedAt ?? j.createdAt, now)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          <Link to="/tours" onClick={() => setOpen(false)} className="px-1 text-xs text-accent-2 hover:text-accent">
            All tours →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
