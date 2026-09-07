import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { selectTourByShare, useAudora, useTourJobs, useTourRooms } from '@/state/store';
import { TourViewer } from '@/screens/TourViewer';
import { Progress, StagedLabel, Spinner, pillClass } from '@/components/ui';
import { Wordmark } from '@/screens/viewer/hud';
import { Icon } from '@/components/icons';
import { setTitleBadgeEnabled } from '@/lib/notify';

/**
 * The buyer's link: /t/:shareId[/:roomId]. No app chrome. They land standing in the room at eye height.
 * While the tour is still generating they see a public-safe progress page (no provider or cost detail).
 */
export default function PublicTour() {
  const { shareId, roomId } = useParams();
  const navigate = useNavigate();
  const tour = useAudora(selectTourByShare(shareId));
  const rooms = useTourRooms(tour?.id);
  const jobs = useTourJobs(tour?.id);
  /* Once the buyer is inside the tour they stay inside it. Swapping back to the progress page
     unmounts the whole canvas, and the splat, the panorama and the walker's position go with it —
     a room briefly flipping to `generating` (a job queued in the agent's tab, a cross-tab
     rehydrate) must not cost the buyer a fifteen-second reload of the room they are standing in. */
  const opened = useRef(false);

  /* This route has no app chrome, so the seller's unseen-job badge has no business in its title:
     a buyer must never see "(1) 1247 Oak Street · Audora tour". Switched off first, so the badge
     lets go of the title before we set our own. */
  useEffect(() => {
    setTitleBadgeEnabled(false);
    const prev = document.title;
    if (tour) document.title = `${tour.title} · Audora tour`;
    return () => {
      document.title = prev;
      setTitleBadgeEnabled(true);
    };
  }, [tour]);

  if (!tour) return <NotFound />;

  const ready = rooms.filter((r) => r.status === 'ready');
  if (ready.length) opened.current = true;
  if (ready.length === 0 && !opened.current)
    return <Building title={tour.title} address={tour.address} rooms={rooms.map((r) => ({ id: r.id, name: r.name, status: r.status, progress: jobs.filter((j) => j.roomId === r.id).pop()?.progress ?? 0 }))} />;

  const wanted = roomId && rooms.some((r) => r.id === roomId) ? roomId : undefined;
  return (
    <div className="relative h-dvh w-full bg-bg">
      <TourViewer
        tourId={tour.id}
        roomId={wanted}
        publicMode
        onRoomChange={(id) => navigate(`/t/${tour.shareId}/${id}`, { replace: true })}
        className="h-full w-full"
      />
      {!tour.published ? (
        <div className="pointer-events-none absolute left-1/2 top-[92px] z-40 -translate-x-1/2 sm:top-[56px]" title="Clear of the top bar, which wraps to two rows on a phone.">
          <span className="chip border-gold/40 bg-gold/8 text-gold backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Unpublished preview
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-12">
      <div className="mb-7"><Wordmark /></div>
      <div className="panel w-full max-w-lg animate-rise p-8 shadow-soft">{children}</div>
      <div className="mt-6 flex items-center gap-3 text-xs text-dim">
        <StagedLabel />
        <Link to="/" className="inline-flex items-center gap-1.5 no-underline hover:text-ink">
          <span className="text-gold"><Icon.Logo size={12} /></span> Made with Audora
        </Link>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <Frame>
      <div className="micro">Tour link</div>
      <h1 className="display mt-2 text-3xl leading-[1.08] text-ink">We could not find that tour.</h1>
      <p className="mt-3 text-sm text-dim">The link may have been mistyped, or the agent has not published this listing yet. Ask them for a fresh link, or try the demo below.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/t/oak1247" className={pillClass('primary', 'md', 'px-5')}>
          Walk the demo listing <Icon.ArrowRight size={16} />
        </Link>
        <Link to="/" className={pillClass('secondary', 'md', 'px-5')}>
          What is Audora?
        </Link>
      </div>
    </Frame>
  );
}

function Building({ title, address, rooms }: { title: string; address: string; rooms: { id: string; name: string; status: string; progress: number }[] }) {
  const done = rooms.filter((r) => r.status === 'ready').length;
  return (
    <Frame>
      <div className="micro flex items-center gap-2">
        <Spinner size={12} /> Building this tour
      </div>
      <h1 className="display mt-2 text-3xl leading-[1.08] text-ink">{title}</h1>
      <p className="mt-1 text-sm text-dim">{address}</p>
      <p className="mt-4 text-sm text-dim">The rooms are being reconstructed from the listing photos. This page updates on its own; the tour opens the moment the first room is ready.</p>
      <ul className="mt-6 flex flex-col gap-3">
        {rooms.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink">{r.name}</span>
              <span className="mono text-xs text-dim">{r.status === 'ready' ? 'ready' : r.status === 'failed' ? 'needs another photo' : r.status === 'generating' ? `${Math.round(r.progress)}%` : 'queued'}</span>
            </div>
            <Progress value={r.status === 'ready' ? 100 : r.progress} tone={r.status === 'ready' ? 'ok' : 'accent'} />
          </li>
        ))}
        {rooms.length === 0 ? <li className="text-sm text-dim">No rooms have been added yet.</li> : null}
      </ul>
      <div className="mono mt-5 text-xs text-dim">{done} of {rooms.length} rooms ready</div>
    </Frame>
  );
}
