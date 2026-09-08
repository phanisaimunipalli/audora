import { Link } from 'react-router-dom';
import { useAllTours, useTourJobs, useTourRooms } from '@/state/store';
import type { Room, Tour } from '@/state/types';
import { timeAgo } from '@/lib/format';
import { Chip, EmptyState, Progress, SectionTitle, cx, pillClass } from '@/components/ui';
import { Icon } from '@/components/icons';
import { FloorPlanSvg } from '@/screens/hub/FloorPlanSvg';
import { tourStatus } from '@/screens/hub/jobMeta';
import { TierChip } from '@/screens/hub/TierChip';
import { useNow } from '@/screens/hub/useNow';

/**
 * When the unit was last modelled. Read off the worlds the rooms actually carry, so a unit
 * regenerated at turnover says so and a unit modelled a year ago cannot pretend otherwise.
 */
function modelDate(rooms: Room[]): number | undefined {
  let newest: number | undefined;
  for (const r of rooms) {
    for (const w of [r.full, r.draft]) {
      if (w?.createdAt && (!newest || w.createdAt > newest)) newest = w.createdAt;
    }
  }
  return newest;
}

/**
 * When the unit is available, as the leasing team wrote it in the summary ("Available 1 October").
 * There is no field for it on `Tour` yet, so the card reads it back rather than inventing one.
 */
function availableFrom(tour: Tour): string | null {
  const m = /\bavailable(?:\s+from)?\s+([^.,;]{3,24})/i.exec(tour.summary ?? '');
  return m ? m[1].trim() : null;
}

export default function Tours() {
  const tours = useAllTours();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:px-6">
      <SectionTitle
        eyebrow="Units"
        title="Your units"
        body="Every unit is a 3D model built from its photos and its floor plan, anchored to a real measurement, that a renter can walk and measure before they book a showing."
      />
      {tours.length === 0 ? (
        <EmptyState
          title="No units yet"
          body="Drop in a unit's make-ready photos and its floor plan, and Audora turns them into a walkable, measured model in about a minute per room."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link to="/new" className={pillClass('primary', 'md', 'px-5')}>
                <Icon.Plus size={16} /> Add a unit
              </Link>
              <Link to="/new?demo=1" className="text-sm text-dim hover:text-ink">
                or try the demo without photos →
              </Link>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tours.map((t) => (
            <TourCard key={t.id} tour={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TourCard({ tour }: { tour: Tour }) {
  const rooms = useTourRooms(tour.id);
  const jobs = useTourJobs(tour.id);
  const status = tourStatus(tour, rooms, jobs);
  const now = useNow(status.kind === 'generating', 5000);
  const cover = rooms.find((r) => r.photo);
  const first = rooms[0];
  const modelled = modelDate(rooms);
  const available = availableFrom(tour);
  /* Published is a state, not a verdict: green in Audora means "it fits" and nothing else. */
  const tone = status.kind === 'generating' ? 'accent' : status.kind === 'failed' ? 'danger' : status.kind === 'published' ? 'accent' : status.kind === 'ready' ? 'neutral' : 'warn';
  return (
    <div className={cx('panel animate-rise ease-audora flex flex-col overflow-hidden shadow-sm transition-shadow duration-300 hover:shadow-soft', status.kind === 'generating' && 'ring-accent')}>
      <Link to={`/tours/${tour.id}`} className="relative block aspect-[16/9] w-full overflow-hidden border-b border-line bg-surface-2">
        {cover?.photo ? (
          <img src={cover.photo.dataUrl} alt="" className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.02]" />
        ) : first ? (
          <div className="flex h-full items-center justify-center p-4">
            <FloorPlanSvg geometry={first.geometry} pieces={first.staging} className="max-h-full" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-ink-3">
            <Icon.Home size={28} />
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
          <Chip tone={tone} mono className="!bg-glass backdrop-blur-[10px]">
            {status.kind === 'generating' ? <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" /> : null}
            {status.label}
          </Chip>
          {first ? <TierChip room={cover ?? first} compact className="!bg-glass backdrop-blur-[10px]" /> : null}
        </div>
        {status.kind === 'generating' ? <Progress value={status.progress} className="absolute inset-x-0 bottom-0 h-1 rounded-none" /> : null}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <Link to={`/tours/${tour.id}`} className="display block truncate text-2xl text-ink hover:text-ink-2">
            {tour.title}
          </Link>
          <div className="truncate text-sm text-ink-2">{tour.address}</div>
        </div>
        <div className="mono flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-dim">
          <span className="text-[15px] text-ink">{tour.price ?? 'rent not set'}</span>
          {available ? (
            <>
              <span className="text-faint">·</span>
              <span>available {available.toLowerCase()}</span>
            </>
          ) : null}
        </div>
        <div className="mono grid grid-cols-3 gap-2 text-xs text-dim">
          <div>
            <div className="text-lg text-ink">{rooms.length}</div>
            room{rooms.length === 1 ? '' : 's'}
          </div>
          <div>
            <div className="text-lg text-ink">{status.ready}</div>
            ready
          </div>
          <div>
            <div className="text-lg text-ink">{tour.published ? 'yes' : 'no'}</div>
            published
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs">
          <span className="mono text-dim">{modelled ? `modelled ${timeAgo(modelled, now)}` : `added ${timeAgo(tour.createdAt, now)}`}</span>
          <div className="flex items-center gap-3">
            <Link to={`/tours/${tour.id}`} className="inline-flex items-center gap-1 font-semibold text-ink hover:text-ink-2">
              Open hub <Icon.ArrowRight size={13} />
            </Link>
            <Link to={`/t/${tour.shareId}`} target="_blank" className="inline-flex items-center gap-1 text-ink-2 hover:text-ink" title={`/t/${tour.shareId}`}>
              <Icon.Share size={13} /> Public
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
