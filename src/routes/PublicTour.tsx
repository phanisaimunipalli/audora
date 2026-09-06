import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { selectTourByShare, useAudora, useTourJobs, useTourRooms } from '@/state/store';
import { TourViewer } from '@/screens/TourViewer';
import { Progress, StagedLabel, Spinner } from '@/components/ui';
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
  if (ready.length === 0) return <Building title={tour.title} address={tour.address} rooms={rooms.map((r) => ({ id: r.id, name: r.name, status: r.status, progress: jobs.filter((j) => j.roomId === r.id).pop()?.progress ?? 0 }))} />;

  const wanted = roomId && ready.some((r) => r.id === roomId) ? roomId : undefined;
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
        <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2">
          <span className="chip !border-warn/40 !bg-warn/10 !text-warn backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-warn" /> Unpublished preview
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-bg flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-12">
      <div className="panel w-full max-w-lg animate-rise p-8">{children}</div>
      <div className="mt-6 flex items-center gap-3 text-xs text-ink-3">
        <StagedLabel />
        <Link to="/" className="inline-flex items-center gap-1.5 hover:text-ink">
          <span className="text-accent"><Icon.Logo size={12} /></span> Made with Audora
        </Link>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <Frame>
      <div className="text-[11px] uppercase tracking-[0.16em] text-accent-2">Tour link</div>
      <h1 className="display mt-2 text-3xl text-ink">We could not find that tour.</h1>
      <p className="mt-3 text-sm text-ink-2">The link may have been mistyped, or the agent has not published this listing yet. Ask them for a fresh link, or try the demo below.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/t/oak1247" className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-[#1a0f0a] hover:bg-accent-2">
          Walk the demo listing <Icon.ArrowRight size={16} />
        </Link>
        <Link to="/" className="inline-flex h-10 items-center rounded-xl border border-line-2 bg-surface-2 px-4 text-sm text-ink hover:bg-surface-3">
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
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-accent-2">
        <Spinner size={12} /> Building this tour
      </div>
      <h1 className="display mt-2 text-3xl text-ink">{title}</h1>
      <p className="mt-1 text-sm text-ink-3">{address}</p>
      <p className="mt-4 text-sm text-ink-2">The rooms are being reconstructed from the listing photos. This page updates on its own; the tour opens the moment the first room is ready.</p>
      <ul className="mt-6 flex flex-col gap-3">
        {rooms.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink">{r.name}</span>
              <span className="mono text-xs text-ink-3">{r.status === 'ready' ? 'ready' : r.status === 'failed' ? 'needs another photo' : r.status === 'generating' ? `${Math.round(r.progress)}%` : 'queued'}</span>
            </div>
            <Progress value={r.status === 'ready' ? 100 : r.progress} tone={r.status === 'ready' ? 'ok' : 'accent'} />
          </li>
        ))}
        {rooms.length === 0 ? <li className="text-sm text-ink-3">No rooms have been added yet.</li> : null}
      </ul>
      <div className="mono mt-5 text-xs text-ink-3">{done} of {rooms.length} rooms ready</div>
    </Frame>
  );
}
