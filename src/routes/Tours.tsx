import { Link } from 'react-router-dom';
import { useAllTours, useTourEvents, useTourJobs, useTourRooms } from '@/state/store';
import type { Tour } from '@/state/types';
import { timeAgo } from '@/lib/format';
import { Chip, EmptyState, Progress, SectionTitle, StagedLabel, cx, pillClass } from '@/components/ui';
import { Icon } from '@/components/icons';
import { FloorPlanSvg } from '@/screens/hub/FloorPlanSvg';
import { tourStatus } from '@/screens/hub/jobMeta';
import { TierChip } from '@/screens/hub/TierChip';
import { useNow } from '@/screens/hub/useNow';

export default function Tours() {
  const tours = useAllTours();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:px-6">
      <SectionTitle eyebrow="Tours" title="Your listings" body="Every tour is one photo per room, anchored to a real measurement, that a buyer can walk and test their furniture in." />
      {tours.length === 0 ? (
        <EmptyState
          title="No tours yet"
          body="Paste a listing URL or drop a few room photos and Audora turns them into a walkable, measured tour in about a minute per room."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link to="/new" className={pillClass('primary', 'md', 'px-5')}>
                <Icon.Plus size={16} /> Start a tour
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
  const events = useTourEvents(tour.id);
  const status = tourStatus(tour, rooms, jobs);
  const now = useNow(status.kind === 'generating', 5000);
  const visitors = new Set(events.filter((e) => e.type === 'visit').map((e) => e.visitor)).size;
  const cover = rooms.find((r) => r.photo);
  const first = rooms[0];
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
        <div className="absolute bottom-3 right-3">
          <StagedLabel className="!bg-glass backdrop-blur-[10px]" />
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
        <div className="mono grid grid-cols-3 gap-2 text-xs text-dim">
          <div>
            <div className="text-lg text-ink">{rooms.length}</div>
            room{rooms.length === 1 ? '' : 's'}
          </div>
          <div>
            <div className="text-lg text-ink">{visitors}</div>
            visitor{visitors === 1 ? '' : 's'}
          </div>
          <div>
            <div className="text-lg text-ink">{status.ready}</div>
            ready
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs">
          <span className="mono text-dim">created {timeAgo(tour.createdAt, now)}</span>
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
