import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { selectTourByShare, useAudora, useTourJobs, useTourRooms } from '@/state/store';
import type { Tour } from '@/state/types';
import { openLocalUnit } from '@/services/localUnit';
import { TourViewer } from '@/screens/TourViewer';
import { Progress, Spinner, pillClass } from '@/components/ui';
import { Wordmark } from '@/screens/viewer/hud';
import { Icon } from '@/components/icons';
import { setTitleBadgeEnabled } from '@/lib/notify';
import { SourceLabel } from '@/components/marketing/SourceLabel';

/**
 * The renter's link: /t/:shareId[/:roomId]. No app chrome. They land standing in the unit at eye
 * height. While the model is still generating they see a public-safe progress page (no provider or
 * cost detail).
 *
 * A share id the browser store has never seen may still be a unit this machine generated with
 * `npx audora generate` (docs/CLI.md), so the page asks the local server for it before it decides
 * the link is dead — that is the CLI's whole happy path, one URL that works.
 */
export default function PublicTour() {
  const { shareId, roomId } = useParams();
  const navigate = useNavigate();
  const tour = useAudora(selectTourByShare(shareId));
  const local = useLocalUnit(shareId, tour);
  const rooms = useTourRooms(tour?.id);
  const jobs = useTourJobs(tour?.id);
  /* Once the renter is inside the unit they stay inside it. Swapping back to the progress page
     unmounts the whole canvas, and the splat, the panorama and the walker's position go with it —
     a room briefly flipping to `generating` (a job queued in the leasing team's tab, a cross-tab
     rehydrate) must not cost the renter a fifteen-second reload of the room they are standing in. */
  const opened = useRef(false);

  /* This route has no app chrome, so the leasing team's unseen-job badge has no business in its
     title: a renter must never see "(1) 1247 Oak Street, Unit 3 · Audora". Switched off first, so
     the badge lets go of the title before we set our own. */
  useEffect(() => {
    setTitleBadgeEnabled(false);
    const prev = document.title;
    if (tour) document.title = `${tour.title} · Audora`;
    return () => {
      document.title = prev;
      setTitleBadgeEnabled(true);
    };
  }, [tour]);

  // Nothing in the store yet: the local server is still being asked, so the link is not dead until
  // it has answered. `NotFound` is the answer to "no such unit anywhere", never to "not yet".
  if (!tour) return local === 'missing' || local === 'failed' ? <NotFound /> : <Opening />;

  const ready = rooms.filter((r) => r.status === 'ready');
  if (ready.length) opened.current = true;
  if (ready.length === 0 && !opened.current)
    return <Building title={tour.title} address={tour.address} rooms={rooms.map((r) => ({ id: r.id, name: r.name, status: r.status, progress: jobs.filter((j) => j.roomId === r.id).pop()?.progress ?? 0 }))} />;

  const wanted = roomId && rooms.some((r) => r.id === roomId) ? roomId : undefined;
  const badges = Boolean(tour.localUnit) || !tour.published;
  return (
    <div className="relative h-dvh w-full bg-bg">
      <TourViewer
        tourId={tour.id}
        roomId={wanted}
        publicMode
        onRoomChange={(id) => navigate(`/t/${tour.shareId}/${id}`, { replace: true })}
        className="h-full w-full"
      />
      {badges ? (
        <div className="pointer-events-none absolute left-1/2 top-[92px] z-40 flex -translate-x-1/2 items-center gap-2 sm:top-[56px]" title="Clear of the top bar, which wraps to two rows on a phone.">
          {tour.localUnit ? (
            <span className="chip bg-bg/85 backdrop-blur-md" title={`Generated on this machine · .audora/local/units/${tour.localUnit.id}.json`}>
              <span className="h-1.5 w-1.5 rounded-full bg-dim" /> local
            </span>
          ) : null}
          {!tour.published ? (
            <span className="chip border-gold/40 bg-gold/8 text-gold backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Unpublished preview
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the local unit */

/**
 * Where the local import has got to. `idle` and `opening` both mean "still asking", which is why
 * the page shows {@link Opening} for either: the very first render happens before the effect runs,
 * and flashing "we could not find that unit" for one frame is the one thing this must not do.
 */
type LocalState = 'idle' | 'opening' | 'done' | 'missing' | 'failed';

/**
 * Ask the local server for this share id — `/api/local/units/:id`, imported into the store by
 * `openLocalUnit` (src/services/localUnit.ts).
 *
 * Two cases, one request. A share id the store does not have gets fetched, and so does one it has
 * **as a local unit**, because re-opening the link is how a regenerated unit reaches the viewer;
 * `openLocalUnit` compares the file's hash with the one the tour was imported at and does nothing
 * at all when they match. A tour the leasing team made in the app is never asked about.
 */
function useLocalUnit(shareId: string | undefined, tour: Tour | undefined): LocalState {
  const [state, setState] = useState<LocalState>('idle');
  // The id this mount has already asked about. The effect re-runs when the import lands (`tour`
  // becomes an object), and asking twice for the same file would import it twice.
  const asked = useRef<string | undefined>(undefined);
  const isLocal = Boolean(tour?.localUnit);
  useEffect(() => {
    if (!shareId || (tour && !isLocal) || asked.current === shareId) return;
    asked.current = shareId;
    if (!tour) setState('opening');
    /* The answer is kept if this ref still names the id it was asked for, and NOT if a cleanup has
       run. StrictMode mounts, cleans up and mounts again on the same component instance: a cleanup
       flag would be false by the time the one request in flight resolved, while the guard above
       makes the second run start nothing — so a dead link sat on "Opening local unit…" for ever on
       the dev server, which is the one place this has to be honest. The ref is the guard and the
       cancel, so they cannot disagree; a request for a share id nobody is looking at any more is
       dropped because `asked.current` has moved on, and a `setState` after a real unmount is a
       no-op in React 18+. */
    const keep = (next: LocalState) => {
      if (asked.current === shareId) setState(next);
    };
    void openLocalUnit(shareId)
      .then((outcome) => keep(outcome === 'not-found' ? 'missing' : 'done'))
      .catch((e) => {
        // The dev server may simply not be the one serving `/api/local` (a static preview, another
        // port). Say so in the console; the renter gets the not-found page, which is the truth.
        console.warn('[audora] could not open the local unit', e);
        keep('failed');
      });
  }, [shareId, tour, isLocal]);
  return state;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-12">
      <div className="mb-7"><Wordmark /></div>
      <div className="panel w-full max-w-lg animate-rise p-8 shadow-soft">{children}</div>
      <div className="mt-6 flex items-center gap-3 text-xs text-dim">
        <SourceLabel />
        <Link to="/" className="inline-flex items-center gap-1.5 no-underline hover:text-ink">
          <span className="text-gold"><Icon.Logo size={12} /></span> Made with Audora
        </Link>
      </div>
    </div>
  );
}

/** The moment between the link and the unit, while the local file is read off this machine. */
function Opening() {
  return (
    <Frame>
      <div className="micro flex items-center gap-2">
        <Spinner size={12} /> Unit link
      </div>
      <h1 className="display mt-2 text-3xl leading-[1.08] text-ink">Opening local unit…</h1>
      <p className="mt-3 text-sm text-dim">
        Reading the model on this machine. Units made with <span className="mono">npx audora generate</span> live in <span className="mono">.audora/local</span> and open straight from disk.
      </p>
    </Frame>
  );
}

function NotFound() {
  return (
    <Frame>
      <div className="micro">Unit link</div>
      <h1 className="display mt-2 text-3xl leading-[1.08] text-ink">We could not find that unit.</h1>
      <p className="mt-3 text-sm text-dim">The link may have been mistyped, or the leasing team has not published this unit yet. Ask them for a fresh link, or walk the demo unit below.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/t/oak1247" className={pillClass('primary', 'md', 'px-5')}>
          Walk the demo unit <Icon.ArrowRight size={16} />
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
        <Spinner size={12} /> Building this unit
      </div>
      <h1 className="display mt-2 text-3xl leading-[1.08] text-ink">{title}</h1>
      <p className="mt-1 text-sm text-dim">{address}</p>
      <p className="mt-4 text-sm text-dim">The rooms are being generated from the unit’s photos and its floor plan. This page updates on its own; the unit opens the moment the first room is ready.</p>
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
