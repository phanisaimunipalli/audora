/**
 * The header bell. Deep-research style: a popover with every running generation (tour, room,
 * tier, progress, step, ETA, elapsed) and the recently finished ones. Opening it marks the
 * finished jobs as seen; the tab title badge follows the unseen count.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActiveJobs, useAllJobs, useAudora, useUnseenDone } from '@/state/store';
import type { Job } from '@/state/types';
import { fullIsShadowed, upgradeLine } from '@/state/publish';
import { setTitleBadge } from '@/lib/notify';
import { clock, eta, timeAgo } from '@/lib/format';
import { isActiveJob, jobElapsed, jobRemaining, providerName } from '@/screens/hub/jobMeta';
import { useNow } from '@/screens/hub/useNow';
import { Icon } from './icons';
import { Chip, Progress, cx } from './ui';

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
        className={cx('relative inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors duration-200 ease-audora', open ? 'border-accent bg-accent text-white' : 'border-line-2 bg-bg text-ink-2 hover:border-ink-2 hover:text-ink')}
      >
        {active.length > 0 ? <span className="absolute -inset-px animate-pulse-soft rounded-full ring-2 ring-ink/25" /> : null}
        <Icon.Bell size={17} />
        {badge > 0 ? (
          <span className={cx('mono absolute -right-1 -top-1 h-4 min-w-4 rounded-full px-1 text-[10px] font-semibold leading-4 text-white', active.length > 0 ? 'bg-accent' : 'bg-ink')}>{badge}</span>
        ) : null}
      </button>

      {open ? (
        <div className="popover animate-rise fixed inset-x-3 top-16 z-50 flex flex-col gap-3 rounded-2xl p-3.5 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[420px]">
          <div className="flex items-center justify-between px-1">
            <span className="micro">Generation</span>
            <span className="mono text-[11px] text-faint">
              {active.length} running · {recent.length} recent
            </span>
          </div>

          {active.length ? (
            <ul className="flex flex-col gap-2">
              {active.map((j) => {
                const n = name(j);
                const remaining = jobRemaining(j, now);
                return (
                  <li key={j.id} className="rounded-xl border border-line bg-bg p-3 shadow-sm">
                    <Link to={`/tours/${j.tourId}`} onClick={() => setOpen(false)} className="flex flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm text-ink">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate" title={n.room}>{n.room}</span>
                            {/* The tier is the money question, so it is a chip, not a footnote. */}
                            <Chip mono tone={j.tier === 'full' ? 'accent' : 'neutral'} className="!text-[10px] !px-2 !py-0.5">
                              {j.tier}
                            </Chip>
                          </span>
                          <span className="block truncate text-xs text-dim" title={n.tour}>{n.tour}</span>
                          {j.upgrade ? (
                            <span
                              className="block truncate text-xs text-gold"
                              title={upgradeLine(jobElapsed(j, now), remaining, j.status === 'queued')}
                            >
                              Upgrading to full quality
                            </span>
                          ) : null}
                        </span>
                        <span className="mono shrink-0 text-xs text-ink-2">{clock(jobElapsed(j, now))}</span>
                      </div>
                      <Progress value={j.progress} />
                      <div className="mono flex items-center justify-between gap-2 text-[11px] text-dim">
                        {/* The step is the long part and the only one worth eliding: "simulated" is
                            the line that says no credits are being spent, so it stays whole. */}
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="truncate">{j.status === 'queued' ? 'queued' : j.step}</span>
                          <span className="shrink-0 whitespace-nowrap">· {providerName(j.provider).toLowerCase()}</span>
                        </span>
                        <span className="shrink-0">{j.status === 'queued' ? 'starting' : remaining > 0 ? `${eta(remaining)} left` : 'any moment'}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-1 text-xs text-dim">Nothing is generating right now.</div>
          )}

          {recent.length ? (
            <>
              <div className="micro px-1">Recently finished</div>
              <ul className="flex flex-col gap-1">
                {recent.map((j) => {
                  const n = name(j);
                  const hot = highlight.includes(j.id);
                  return (
                    <li key={j.id}>
                      <Link
                        to={`/tours/${j.tourId}`}
                        onClick={() => setOpen(false)}
                        className={cx('flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-surface', hot && 'bg-surface-2')}
                      >
                        <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', j.status === 'done' ? 'bg-surface-2 text-ink' : 'bg-danger-soft text-danger')}>
                          {j.status === 'done' ? <Icon.Check size={12} /> : <Icon.Warning size={12} />}
                        </span>
                        <span className="min-w-0 flex-1 text-sm text-ink" title={`${n.room} · ${n.tour}`}>
                          <span className="block truncate">{n.room}</span>
                          <span className="block truncate text-[11px] text-dim">{n.tour}</span>
                        </span>
                        <span className="mono shrink-0 text-[11px] text-faint">
                          {/* Only "full quality ready" when the renter is actually getting it: a simulated full
                              never displaces a real capture, and the tray must not claim otherwise. */}
                          {j.status === 'done' && j.upgrade ? (fullIsShadowed(rooms[j.roomId]) ? 'simulated full attached' : 'full quality ready') : j.tier} ·{' '}
                          {j.status === 'done' ? clock(jobElapsed(j, j.finishedAt ?? now)) : 'failed'} · {timeAgo(j.finishedAt ?? j.createdAt, now)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          <Link to="/tours" onClick={() => setOpen(false)} className="px-1 text-xs font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
            All tours →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
