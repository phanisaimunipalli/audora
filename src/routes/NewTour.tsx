/**
 * The seller's create flow. Four steps, all local state until "Generate":
 *   1 Listing  → address and facts (read from the URL, confirmed by the user)
 *   2 Rooms    → one photo per room, or typed measurements
 *   3 Anchor   → one real measurement per room (door / outlet / wall / floor plan)
 *   4 Launch   → quality, provider, notifications, go
 * On launch the tour and rooms are written to the store and the job runner takes over.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { RoomType } from '@/engine/types';
import { toast, useAudora } from '@/state/store';
import { activeProvider, generateTour } from '@/state/jobs';
import type { Tier } from '@/state/types';
import { preparePhoto } from '@/lib/image';
import { analyzePhoto } from '@/services/ai';
import { Button, Callout, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Stepper, WIZARD_STEPS } from '@/screens/create/Stepper';
import { StepListing } from '@/screens/create/StepListing';
import { StepRooms } from '@/screens/create/StepRooms';
import { StepAnchor } from '@/screens/create/StepAnchor';
import { StepLaunch, simulatedOnly } from '@/screens/create/StepLaunch';
import { DEMO_ANALYSIS, drawDemoRoomPhoto } from '@/screens/create/demoPhoto';
import {
  DEMO_LISTING,
  demoRooms,
  emptyListing,
  finalAnchor,
  isAnchored,
  newMeasuredRoom,
  newPhotoRoom,
  rawForPhoto,
  rawFromMeasurements,
  type AnchorRecipe,
  type DraftListing,
  type DraftRoom,
  type Measurements,
} from '@/screens/create/types';

const num = (s: string): number | undefined => {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
};

/* A best-effort snapshot of the draft so an accidental reload does not lose photos and taps.
   It never touches the store; it is cleared the moment the tour is launched. */
const DRAFT_KEY = 'audora-draft-v1';
interface DraftSnapshot {
  step: number;
  listing: DraftListing;
  rooms: DraftRoom[];
  quality: Tier;
  email: string;
  demo: boolean;
  savedAt: number;
}
function loadDraft(demo: boolean): DraftSnapshot | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftSnapshot;
    if (!d || !Array.isArray(d.rooms) || !d.listing || d.demo !== demo) return null;
    return d;
  } catch {
    return null;
  }
}
function saveDraft(d: DraftSnapshot) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* quota exceeded: the draft simply will not survive a reload */
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export default function NewTour() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const demo = params.get('demo') === '1';
  const createTour = useAudora((s) => s.createTour);
  const addRoom = useAudora((s) => s.addRoom);
  const updateRoom = useAudora((s) => s.updateRoom);

  const [restored] = useState(() => loadDraft(demo));
  const [step, setStep] = useState(restored?.step ?? 0);
  const [listing, setListing] = useState<DraftListing>(() => restored?.listing ?? (demo ? { ...DEMO_LISTING } : emptyListing()));
  const [rooms, setRooms] = useState<DraftRoom[]>(() => restored?.rooms ?? (demo ? demoRooms() : []));
  const [loading, setLoading] = useState(0);
  const [activeAnchor, setActiveAnchor] = useState<string | undefined>();
  const [quality, setQuality] = useState<Tier>(restored?.quality ?? 'draft');
  const [email, setEmail] = useState(restored?.email ?? '');
  const [launching, setLaunching] = useState(false);
  const [demoTick, setDemoTick] = useState(0);
  const demoLoaded = useRef(!!restored);
  const analysedOnRestore = useRef(false);

  const patchRoom = useCallback((id: string, patch: Partial<DraftRoom>) => {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        // The mock proportions depend on the room type; keep raw in step with it for photo rooms.
        if (r.source === 'photo' && r.photo && patch.type && patch.type !== r.type) next.raw = rawForPhoto(r.photo, next.name, patch.type);
        return next;
      }),
    );
  }, []);

  const analyse = useCallback(
    async (room: DraftRoom) => {
      if (!room.photo) return;
      patchRoom(room.id, { analysisState: 'running' });
      try {
        const analysis = await analyzePhoto(room.photo, room.name);
        patchRoom(room.id, { analysis, analysisState: 'done' });
      } catch {
        patchRoom(room.id, { analysisState: 'done' });
      }
    },
    [patchRoom],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      setLoading((n) => n + files.length);
      for (const [i, f] of files.entries()) {
        try {
          const photo = await preparePhoto(f);
          const room = newPhotoRoom(photo, f.name, rooms.length + i);
          setRooms((prev) => [...prev, room]);
          void analyse(room);
        } catch (e: any) {
          toast({ kind: 'error', title: `Could not read ${f.name}`, body: e?.message });
        } finally {
          setLoading((n) => Math.max(0, n - 1));
        }
      }
    },
    [analyse, rooms.length],
  );

  // Snapshot the draft (debounced: photos make it a few hundred KB) so a reload does not lose it.
  useEffect(() => {
    if (launching) return;
    const id = window.setTimeout(() => saveDraft({ step, listing, rooms, quality, email, demo, savedAt: Date.now() }), 400);
    return () => window.clearTimeout(id);
  }, [step, listing, rooms, quality, email, demo, launching]);

  // A restored draft may have photos whose analysis never finished.
  useEffect(() => {
    if (!restored || analysedOnRestore.current) return;
    analysedOnRestore.current = true;
    restored.rooms.filter((r) => r.photo && !r.analysis).forEach((r) => void analyse(r));
  }, [restored, analyse]);

  const startOver = () => {
    clearDraft();
    setStep(0);
    setListing(demo ? { ...DEMO_LISTING } : emptyListing());
    setRooms(demo ? demoRooms() : []);
    setQuality('draft');
    setEmail('');
    setActiveAnchor(undefined);
    demoLoaded.current = false;
    setDemoTick((t) => t + 1);
  };

  // ?demo=1: three typed rooms plus one drawn "photo" so the door-tap ritual can be tried without files.
  useEffect(() => {
    if (!demo || demoLoaded.current) return;
    demoLoaded.current = true;
    // No cancellation on cleanup: StrictMode runs effects twice and the ref already guards the second run.
    (async () => {
      try {
        const photo = await preparePhoto(drawDemoRoomPhoto());
        const room: DraftRoom = { ...newPhotoRoom(photo, 'living-room.jpg', 0), name: 'Living room', type: 'living', analysis: DEMO_ANALYSIS, analysisState: 'done', synthetic: true };
        room.raw = rawForPhoto(photo, room.name, room.type);
        setRooms((prev) => (prev.some((r) => r.synthetic) ? prev : [room, ...prev]));
      } catch {
        /* the typed rooms still make a complete demo */
      }
    })();
  }, [demo, demoTick]);

  const addMeasured = (name: string, type: RoomType, m: Measurements) => setRooms((prev) => [...prev, newMeasuredRoom(name, type, m)]);
  const removeRoom = (id: string) => setRooms((prev) => prev.filter((r) => r.id !== id));
  const moveRoom = (id: string, to: number) =>
    setRooms((prev) => {
      const from = prev.findIndex((r) => r.id === id);
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  const setRecipe = (id: string, recipe: AnchorRecipe | undefined) => patchRoom(id, { recipe });
  const setMeasured = (id: string, m: Measurements) => patchRoom(id, { measured: m, raw: rawFromMeasurements(m) });

  const done = [listing.address.trim().length > 0, rooms.length > 0, rooms.length > 0 && rooms.every((r) => isAnchored(r) || r.recipe?.method === 'skip'), false];
  const canContinue = step === 0 ? done[0] : step === 1 ? done[1] : true;

  const launch = async () => {
    if (launching || !rooms.length) return;
    setLaunching(true);
    try {
      const tour = createTour({
        title: listing.title.trim() || undefined,
        address: listing.address.trim(),
        listingUrl: listing.mode === 'url' && listing.url ? listing.url : undefined,
        listingSource: listing.mode === 'url' ? listing.source : undefined,
        price: listing.price.trim() || undefined,
        beds: num(listing.beds),
        baths: num(listing.baths),
        sqft: num(listing.sqft),
        summary: listing.summary.trim() || undefined,
        quality,
        notify: { browser: true, email: email.trim() },
      });
      const simulate: string[] = [];
      for (const r of rooms) {
        const room = addRoom(tour.id, { name: r.name.trim() || 'Room', type: r.type, photo: r.photo, raw: r.raw, anchor: finalAnchor(r) });
        if (r.analysis) updateRoom(room.id, { analysis: r.analysis });
        if (simulatedOnly(r)) simulate.push(room.id);
      }
      // Rooms with nothing to reconstruct from are simulated even when Marble is live; the rest go through generateTour.
      const s = useAudora.getState();
      if (activeProvider() === 'marble') {
        const etaSeconds = quality === 'draft' ? s.settings.mockDraftSeconds : s.settings.mockFullSeconds;
        for (const roomId of simulate) s.enqueueJob({ tourId: tour.id, roomId, tier: quality, provider: 'mock', etaSeconds });
      }
      const jobs = generateTour(tour.id, quality);
      const total = jobs.length + (activeProvider() === 'marble' ? simulate.length : 0);
      clearDraft();
      toast({
        kind: 'info',
        title: `Generating ${total} room${total === 1 ? '' : 's'}`,
        body: 'You can leave this page. We will tell you when it is ready.',
        action: { label: 'Watch progress', to: `/tours/${tour.id}` },
      });
      nav(`/tours/${tour.id}`);
    } catch (e: any) {
      toast({ kind: 'error', title: 'Could not start the tour', body: e?.message });
      setLaunching(false);
    }
  };

  const current = WIZARD_STEPS[step];

  // Each step opens at its heading, not wherever the previous step was scrolled to.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-accent-2">New tour{demo ? ' · demo' : ''}</div>
          <h1 className="display mt-1 text-3xl text-ink md:text-4xl">
            {step === 0 ? 'Where is the listing?' : step === 1 ? 'One photo per room' : step === 2 ? 'Give each room one real measurement' : 'Ready to generate'}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {!demo && step === 0 && rooms.length === 0 ? (
            <Link to="/new?demo=1" className="text-ink-3 hover:text-ink">
              No photos handy? <span className="text-accent-2">Try the demo →</span>
            </Link>
          ) : null}
          {restored || step > 0 || rooms.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={startOver}>
              <Icon.Rotate size={14} style={{ transform: 'scaleX(-1)' }} /> Start over
            </Button>
          ) : null}
        </div>
      </div>
      {restored ? (
        <Callout tone="info">
          Picked up where you left off: your draft survived a reload. Nothing has been generated yet.
        </Callout>
      ) : null}

      <Stepper step={step} done={done} onJump={setStep} />

      {demo && step === 0 ? (
        <Callout tone="info" title="Demo listing">
          Three rooms were typed in from a tape measure and one has a drawn photo, so every step works without a file. Nothing here reaches a live reconstruction; typed and demo rooms are always simulated.
        </Callout>
      ) : null}

      <div key={current.key} className="animate-fade">
        {step === 0 ? <StepListing listing={listing} onChange={(p) => setListing((l) => ({ ...l, ...p }))} /> : null}
        {step === 1 ? <StepRooms rooms={rooms} loading={loading} onAddFiles={addFiles} onAddMeasured={addMeasured} onUpdate={patchRoom} onRemove={removeRoom} onMove={moveRoom} /> : null}
        {step === 2 ? <StepAnchor rooms={rooms} activeId={activeAnchor} onActive={setActiveAnchor} onRecipe={setRecipe} onMeasured={setMeasured} /> : null}
        {step === 3 ? <StepLaunch listing={listing} rooms={rooms} quality={quality} onQuality={setQuality} email={email} onEmail={setEmail} launching={launching} onLaunch={launch} /> : null}
      </div>

      {step < 3 ? (
        <div className={cx('flex items-center justify-between border-t border-line pt-5')}>
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            <Icon.ArrowLeft size={16} /> Back
          </Button>
          <div className="flex items-center gap-3">
            {step === 1 && loading > 0 ? <span className="text-xs text-ink-3">Reading photos…</span> : null}
            {step === 2 && !done[2] ? <span className="hidden text-xs text-ink-3 sm:block">{rooms.filter((r) => !isAnchored(r) && r.recipe?.method !== 'skip').length} room(s) still need an anchor or a skip</span> : null}
            <Button variant="primary" disabled={!canContinue || (step === 1 && loading > 0)} onClick={() => setStep((s) => Math.min(3, s + 1))}>
              {step === 2 && !done[2] ? 'Continue anyway' : 'Continue'} <Icon.ArrowRight size={16} />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-start border-t border-line pt-5">
          <Button variant="ghost" onClick={() => setStep(2)}>
            <Icon.ArrowLeft size={16} /> Back to anchors
          </Button>
        </div>
      )}
    </div>
  );
}
