import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { bestWorld } from '@/state/store';
import { credits as fmtCredits, tourQuality } from '@/state/publish';
import type { Job, Room, Tour } from '@/state/types';
import { plural, usd as fmtUsd } from '@/lib/format';
import { Chip, StagedLabel, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { latestJobFor, isActiveJob, providerName, type TourStatus } from './jobMeta';
import { TierChip } from './TierChip';

const SOURCE_LABEL: Record<string, string> = { zillow: 'Zillow', redfin: 'Redfin', realtor: 'Realtor.com', rightmove: 'Rightmove' };

export function HubHeader({
  tour,
  rooms,
  jobs,
  status,
  selectedRoomId,
  onSelectRoom,
}: {
  tour: Tour;
  rooms: Room[];
  jobs: Job[];
  status: TourStatus;
  selectedRoomId?: string;
  onSelectRoom: (id: string) => void;
}) {
  const facts = [tour.price, tour.beds != null && `${tour.beds} bd`, tour.baths != null && `${tour.baths} ba`, tour.sqft != null && `${tour.sqft.toLocaleString()} sqft`].filter(Boolean) as string[];
  const worlds = rooms.map(bestWorld).filter(Boolean) as NonNullable<ReturnType<typeof bestWorld>>[];
  const providerChips = [...new Map(worlds.map((w) => [`${w.provider}:${w.model}`, w])).values()];
  const credits = worlds.reduce((a, w) => a + (w.provider === 'marble' ? w.credits ?? 0 : 0), 0);
  const spent = worlds.reduce((a, w) => a + (w.provider === 'marble' ? w.usd ?? 0 : 0), 0);
  const tone = status.kind === 'generating' ? 'accent' : status.kind === 'failed' ? 'danger' : status.kind === 'published' ? 'ok' : 'neutral';
  /* Read off the rooms, never off the field the bulk upgrade writes at queue time: the header used
     to say "full quality" the moment five jobs were queued (before a single full world existed) and
     "draft quality" forever after a room was upgraded one at a time. */
  const quality = tourQuality(rooms);

  /* The room rail scrolls sideways, and a mouse has no sideways. Without this the wheel does
     nothing at all over the rail — not the page, not the rail — and the last room sits clipped at
     the right edge with no way to reach it. Vertical wheel scrolls the rail while it has somewhere
     to go, and hands the gesture back to the page at either end. */
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      const next = Math.max(0, Math.min(max, el.scrollLeft + delta));
      if (next === el.scrollLeft) return; // at the end: let the page take the gesture
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <header className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* "published" beside a bare "draft" read as a contradiction; the chip carries both facts at once. */}
            <Chip tone={tone} mono>
              {status.kind === 'generating' ? <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" /> : null}
              {status.label}
              {status.upgrading ? ' quality' : ` · ${quality} quality`}
            </Chip>
            <span className="mono text-[11px] text-ink-3">{plural(rooms.length, 'room')}</span>
          </div>
          <h1 className="display mt-2 text-3xl leading-tight text-ink md:text-4xl">{tour.title}</h1>
          <div className="mt-1 text-sm text-ink-2">{tour.address}</div>
          <div className="mono mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
            {facts.length ? facts.join(' · ') : <span className="text-ink-3">no listing facts</span>}
            {tour.listingUrl ? (
              <a href={tour.listingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-sans text-xs text-accent-2 hover:text-accent">
                <Icon.Link size={12} /> {SOURCE_LABEL[tour.listingSource ?? ''] ?? 'Listing'} ↗
              </a>
            ) : null}
          </div>
          {tour.summary ? <p className="mt-2 max-w-2xl text-sm text-ink-3">{tour.summary}</p> : null}
        </div>
        <div className="flex flex-col items-start gap-2 md:max-w-[42%] md:items-end">
          <div className="flex flex-wrap gap-1.5 md:justify-end">
            {providerChips.map((w) => (
              <Chip key={`${w.provider}:${w.model}`} mono tone={w.provider === 'marble' ? 'ok' : 'neutral'} className="!text-[11px]">
                {w.provider === 'marble' ? `${providerName('marble')} · ${w.model}` : `Simulated · ${w.tier}`}
              </Chip>
            ))}
            {credits > 0 ? (
              <Chip mono className="!text-[11px]">
                {/* Credit totals are money, so they get thousands separators — everywhere. */}
                {fmtCredits(credits)} credits · {fmtUsd(spent)}
              </Chip>
            ) : null}
            <StagedLabel />
          </div>
          <Link to={`/t/${tour.shareId}`} target="_blank" className="inline-flex items-center gap-1.5 text-sm text-accent-2 hover:text-accent">
            <Icon.Share size={14} /> Public link <span className="mono text-xs text-ink-3">/t/{tour.shareId}</span>
          </Link>
        </div>
      </div>

      {/* The faded right edge is the affordance that says there is more room to the right. */}
      <div
        ref={railRef}
        className="no-scrollbar flex gap-2 overflow-x-auto py-0.5 [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]"
      >
        {rooms.map((r, i) => {
          const job = latestJobFor(jobs, r.id);
          const dot = r.status === 'ready' ? 'bg-ok' : r.status === 'generating' ? 'bg-accent animate-pulse-soft' : r.status === 'failed' ? 'bg-danger' : 'bg-ink-3';
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelectRoom(r.id)}
              className={cx(
                'flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                selectedRoomId === r.id ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface hover:bg-surface-2',
              )}
            >
              <span className={cx('h-2 w-2 shrink-0 rounded-full', dot)} />
              <span className="min-w-0">
                <span className="block max-w-40 truncate text-sm text-ink">
                  <span className="mono text-ink-3">{i + 1} </span>
                  {r.name}
                </span>
                <span className="mono flex items-center gap-1.5 text-[11px] text-ink-3">
                  <span className="truncate">
                    {r.status === 'generating' && job ? `${job.progress}% · ${job.step}` : `${r.geometry.width.toFixed(1)} × ${r.geometry.depth.toFixed(1)} m`}
                  </span>
                  {/* Which reconstruction this room is on, everywhere a room is listed. */}
                  <TierChip room={r} compact generating={job ? isActiveJob(job) : false} />
                  {job && isActiveJob(job) && job.tier === 'full' && job.upgrade ? <span className="shrink-0 text-accent-2">↑ full</span> : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </header>
  );
}
