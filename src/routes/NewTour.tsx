/**
 * The leasing team's create flow. Six steps, all local state until "Generate":
 *   1 Unit       → address, rent, available date (read from the URL, confirmed by the user)
 *   2 Site       → the address on OpenStreetMap, the building footprint, and which way the windows
 *                  face — the unit's real sun (optional; skip it and the room keeps a studio light)
 *   3 Floor plan → the unit's plan read by a vision model: the room list, and metres where the
 *                  draughtsman printed them (optional; those rooms are anchored at ±5 cm)
 *   4 Rooms      → photos per room (up to six angles each), or typed measurements
 *   5 Anchor     → one real measurement per room (door / outlet / wall / floor plan)
 *   6 Launch     → quality, provider, notifications, go
 * On launch the unit and its rooms are written to the store and the job runner takes over.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { RoomType } from '@/engine/types';
import { toast, useAudora } from '@/state/store';
import { activeProvider, generateTour } from '@/state/jobs';
import type { PhotoAngle, Tier, TourSite } from '@/state/types';
import { fileToDataUrl, preparePhoto } from '@/lib/image';
import { analyzePhoto } from '@/services/ai';
import { parseFloorPlan, planRooms as flattenPlan, type PlanRoom } from '@/services/floorplan';
import { fetchPhotoUrl, parsePhotoUrls } from '@/services/listing';
import { Button, Callout, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Stepper, WIZARD_STEPS } from '@/screens/create/Stepper';
import { StepListing } from '@/screens/create/StepListing';
import { StepSite } from '@/screens/create/StepSite';
import { StepFloorPlan } from '@/screens/create/StepFloorPlan';
import { StepRooms, type UrlImportState } from '@/screens/create/StepRooms';
import { StepAnchor } from '@/screens/create/StepAnchor';
import { StepLaunch, simulatedOnly } from '@/screens/create/StepLaunch';
import { blockedRooms } from '@/screens/create/intake';
import { DEMO_ANALYSIS, drawDemoRoomPhoto } from '@/screens/create/demoPhoto';
import {
  DEMO_LISTING,
  demoRooms,
  emptyDraftPlan,
  emptyListing,
  finalAnchor,
  isAnchored,
  newMeasuredRoom,
  newPhotoRoom,
  newPlanRoom,
  planDimensionsOf,
  planRoomRef,
  rawForPhoto,
  rawFromMeasurements,
  roomNameFromFile,
  withPhoto,
  withPhotoAngle,
  withPlanRoom,
  withoutPhoto,
  type AnchorRecipe,
  type DraftListing,
  type DraftPhoto,
  type DraftPlan,
  type DraftRoom,
  type Measurements,
} from '@/screens/create/types';

/**
 * The plan the demo button loads: the demo unit's own sheet — 1247 Oak Street, Unit 3, six rooms,
 * every one of them with its dimensions printed in feet and inches with the draughtsman's metric
 * restatement in brackets. That is the point of it: the demo path through this step has to end with
 * rooms that actually carry a ±5 cm plan constraint, or it demonstrates the product without its
 * strongest source of truth. (`public/demo/floorplan-townhouse.webp` is still in the tree — it is
 * the dimensionless three-storey sheet the eval corpus keeps as a real-world case.)
 */
const DEMO_PLAN_URL = '/demo/floorplan-oak-unit3.png';
const DEMO_PLAN_FILE = 'floorplan-oak-unit3.png';

/** The plan is read from the original file and stored small: the unit keeps a copy to show. */
const PLAN_STORE_PX = 900;

const num = (s: string): number | undefined => {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
};

/* A best-effort snapshot of the draft so an accidental reload does not lose photos and taps.
   It never touches the store; it is cleared the moment the unit is launched. */
const DRAFT_KEY = 'audora-draft-v1';
interface DraftSnapshot {
  step: number;
  listing: DraftListing;
  site: TourSite | null;
  plan: DraftPlan;
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
  const updateTour = useAudora((s) => s.updateTour);
  const addRoom = useAudora((s) => s.addRoom);
  const updateRoom = useAudora((s) => s.updateRoom);

  const [restored] = useState(() => loadDraft(demo));
  const [step, setStep] = useState(restored?.step ?? 0);
  /* How far the leasing team has actually got. `done` cannot answer that: the Site and the Floor plan
     steps are optional and offer "Skip the site", but skipping leaves their `done` false forever, so
     a stepper gated on `done` alone disables every later entry for the rest of the flow — the team
     steps back and can never jump forward again. Reachability is about where you have been;
     completeness is about whether the step was answered, and the two are different questions. */
  const [furthest, setFurthest] = useState(restored?.step ?? 0);
  useEffect(() => setFurthest((f) => Math.max(f, step)), [step]);
  const [listing, setListing] = useState<DraftListing>(() => restored?.listing ?? (demo ? { ...DEMO_LISTING } : emptyListing()));
  const [site, setSite] = useState<TourSite | null>(restored?.site ?? null);
  const [plan, setPlan] = useState<DraftPlan>(() => restored?.plan ?? emptyDraftPlan());
  const [rooms, setRooms] = useState<DraftRoom[]>(() => restored?.rooms ?? (demo ? demoRooms() : []));
  const [loading, setLoading] = useState(0);
  const [urlImport, setUrlImport] = useState<UrlImportState | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<string | undefined>();
  const [quality, setQuality] = useState<Tier>(restored?.quality ?? 'draft');
  const [email, setEmail] = useState(restored?.email ?? '');
  const [launching, setLaunching] = useState(false);
  const [demoTick, setDemoTick] = useState(0);
  const demoLoaded = useRef(!!restored);
  const analysedOnRestore = useRef(false);

  /** Replace one draft room with the result of `fn`. Every room edit goes through here. */
  const mapRoom = useCallback((id: string, fn: (r: DraftRoom) => DraftRoom) => {
    setRooms((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
  }, []);

  const patchRoom = useCallback(
    (id: string, patch: Partial<DraftRoom>) => {
      mapRoom(id, (r) => {
        const next = { ...r, ...patch };
        // The mock proportions depend on the room type; keep raw in step with it for photo rooms.
        // A room measured by the floor plan keeps the plan's rectangle: the plan outranks the guess.
        if (r.source === 'photo' && r.photo && patch.type && patch.type !== r.type && r.recipe?.method !== 'floorplan') {
          next.raw = rawForPhoto(r.photo, next.name, patch.type);
        }
        return next;
      });
    },
    [mapRoom],
  );

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
    const id = window.setTimeout(() => saveDraft({ step, listing, site, plan, rooms, quality, email, demo, savedAt: Date.now() }), 400);
    return () => window.clearTimeout(id);
  }, [step, listing, site, plan, rooms, quality, email, demo, launching]);

  // A restored draft may have photos whose analysis never finished.
  useEffect(() => {
    if (!restored || analysedOnRestore.current) return;
    analysedOnRestore.current = true;
    restored.rooms.filter((r) => r.photo && !r.analysis).forEach((r) => void analyse(r));
  }, [restored, analyse]);

  const startOver = () => {
    clearDraft();
    setStep(0);
    setFurthest(0);
    setListing(demo ? { ...DEMO_LISTING } : emptyListing());
    setSite(null);
    setPlan(emptyDraftPlan());
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

  /* ---------- the unit's floor plan ----------
   * One vision call turns the drawing into a room list. The plan's dimensions, where it printed any,
   * become each room's geometry AND its anchor (±5 cm) — better than anything anyone can tap on a
   * photo — so the step runs before photos and the rooms it makes are already metric. */

  const readPlan = useCallback(
    async (file: File | Blob, fileName: string) => {
      setPlan((p) => ({ ...p, state: 'parsing', fileName, plan: undefined, chosen: [] }));
      try {
        /* The model reads the ORIGINAL file. A plan's room labels are often only a few pixels tall,
           and a JPEG pass at the plan's own small size destroys exactly them — `parseFloorPlan`
           resizes for legibility itself. The small copy is only what the screen and the unit show. */
        const [raw, small] = await Promise.all([fileToDataUrl(file as File), preparePhoto(file as File, PLAN_STORE_PX, 0.72)]);
        setPlan((p) => ({ ...p, image: small, fileName }));
        const parsed = await parseFloorPlan(raw);
        const keys = flattenPlan(parsed).map((r) => r.key);
        setPlan((p) => ({ ...p, state: parsed.floors.length ? 'done' : 'failed', plan: parsed, chosen: keys }));
        if (parsed.floors.length) {
          const dims = flattenPlan(parsed).filter((r) => r.width != null).length;
          toast({
            kind: 'success',
            title: `Read ${keys.length} room${keys.length === 1 ? '' : 's'} off the plan`,
            body: dims ? `${dims} came with printed dimensions, so they are anchored at ±5 cm.` : 'No dimensions were printed, so the rooms carry names only.',
          });
        }
      } catch (e: any) {
        setPlan((p) => ({ ...p, state: 'failed' }));
        toast({ kind: 'error', title: 'Could not read that floor plan', body: e?.message });
      }
    },
    [],
  );

  const loadDemoPlan = useCallback(async () => {
    try {
      const blob = await (await fetch(DEMO_PLAN_URL)).blob();
      await readPlan(new File([blob], DEMO_PLAN_FILE, { type: blob.type || 'image/png' }), DEMO_PLAN_FILE);
    } catch (e: any) {
      toast({ kind: 'error', title: 'Could not load the demo plan', body: e?.message });
    }
  }, [readPlan]);

  const togglePlanRoom = (key: string, on: boolean) =>
    setPlan((p) => ({ ...p, chosen: on ? [...new Set([...p.chosen, key])] : p.chosen.filter((k) => k !== key) }));

  const toggleAllPlanRooms = (on: boolean) => setPlan((p) => ({ ...p, chosen: on && p.plan ? flattenPlan(p.plan).map((r) => r.key) : [] }));

  /** Correct a number the model misread, before it becomes a room. */
  const editPlanRoom = (key: string, patch: Partial<PlanRoom>) =>
    setPlan((p) => {
      if (!p.plan) return p;
      const [fi, ri] = key.split(':').map(Number);
      const floors = p.plan.floors.map((f, i) =>
        i !== fi ? f : { ...f, rooms: f.rooms.map((r, j) => (j !== ri ? r : { ...r, ...patch, dimensionsFrom: 'text' as const })) },
      );
      return { ...p, plan: { ...p.plan, floors } };
    });

  const clearPlan = () => setPlan(emptyDraftPlan());

  /** A plan room that is in the wizard only because the plan put it there — no photo of its own. */
  const planOnly = (r: DraftRoom) => !!r.planRoom && !r.photo;
  const planOnlyCount = rooms.filter(planOnly).length;

  /**
   * Turn the ticked plan rooms into draft rooms. Rooms already photographed keep their
   * photo and are simply refreshed with the plan's (possibly corrected) numbers; plan-only rooms that
   * have been unticked go away.
   */
  const usePlanRooms = () => {
    const parsed = plan.plan;
    if (!parsed) return;
    const chosen = new Set(plan.chosen);
    const all = flattenPlan(parsed);
    setRooms((prev) => {
      const kept = prev.filter((r) => !(planOnly(r) && (!r.planRoom || !chosen.has(r.planRoom.key))));
      const refreshed = kept.map((r) => {
        const match = r.planRoom && chosen.has(r.planRoom.key) ? all.find((a) => a.key === r.planRoom!.key) : undefined;
        return match ? withPlanRoom(r, planRoomRef(match)) : r;
      });
      const taken = new Set(refreshed.map((r) => r.planRoom?.key).filter(Boolean));
      const added = all.filter((r) => chosen.has(r.key) && !taken.has(r.key)).map((r, i) => newPlanRoom(planRoomRef(r), refreshed.length + i));
      return [...refreshed, ...added];
    });
    setStep(3);
  };

  /** Match a photographed room to a room on the plan — the plan then supplies its metres. */
  const matchPlanRoom = (id: string, key: string | undefined) => {
    const match = key && plan.plan ? flattenPlan(plan.plan).find((r) => r.key === key) : undefined;
    mapRoom(id, (r) => withPlanRoom(r, match ? planRoomRef(match) : undefined));
  };

  /* ---------- more angles, and photos pasted from the listing page ---------- */

  const addAngles = useCallback(
    async (id: string, files: File[]) => {
      setLoading((n) => n + files.length);
      for (const f of files) {
        try {
          const photo = await preparePhoto(f);
          mapRoom(id, (r) => withPhoto(r, { ...photo, origin: 'file' }));
        } catch (e: any) {
          toast({ kind: 'error', title: `Could not read ${f.name}`, body: e?.message });
        } finally {
          setLoading((n) => Math.max(0, n - 1));
        }
      }
    },
    [mapRoom],
  );

  const removePhoto = (id: string, index: number) => mapRoom(id, (r) => withoutPhoto(r, index));
  const setPhotoAngle = (id: string, index: number, angle: PhotoAngle | undefined) => mapRoom(id, (r) => withPhotoAngle(r, index, angle));

  /** Photo URLs copied off the listing page. The server fetches them; the browser cannot (no CORS). */
  const addPhotoUrls = useCallback(
    async (text: string) => {
      const urls = parsePhotoUrls(text);
      if (!urls.length) return;
      setUrlImport({ running: true, done: 0, total: urls.length, errors: [] });
      const errors: { url: string; error: string }[] = [];
      let added = 0;
      for (const [i, url] of urls.entries()) {
        const res = await fetchPhotoUrl(url);
        if (res.dataUrl) {
          try {
            const photo = await preparePhoto(res.dataUrl);
            const name = roomNameFromFile(new URL(url).pathname.split('/').pop() || '', rooms.length + i);
            const room: DraftRoom = { ...newPhotoRoom(photo, name, rooms.length + i), photo: { ...photo, origin: 'url', sourceUrl: url } as DraftPhoto };
            setRooms((prev) => [...prev, room]);
            void analyse(room);
            added += 1;
          } catch (e: any) {
            errors.push({ url, error: `${url.slice(-40)}: ${e?.message || 'could not decode'}` });
          }
        } else {
          errors.push({ url, error: res.error || 'Could not fetch that photo' });
        }
        setUrlImport({ running: i < urls.length - 1, done: i + 1, total: urls.length, errors: [...errors] });
      }
      setUrlImport({ running: false, done: urls.length, total: urls.length, errors });
      toast({
        kind: errors.length && !added ? 'error' : 'info',
        title: `${added} of ${urls.length} photo${urls.length === 1 ? '' : 's'} imported`,
        body: errors.length ? errors[0].error : 'Each photo became a room. Match them to the floor plan below.',
      });
    },
    [analyse, rooms.length],
  );

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
  /**
   * Typing width, depth and height over a room the plan produced means someone measured it
   * themselves, so the floor-plan recipe steps aside: the anchor becomes their tape (±2 cm) rather
   * than the drawing (±5 cm), and it tracks the number they typed instead of the one that was
   * printed. The plan room stays attached for its name and its floor.
   */
  const setMeasured = (id: string, m: Measurements) =>
    mapRoom(id, (r) => ({ ...r, measured: m, raw: rawFromMeasurements(m), recipe: r.recipe?.method === 'floorplan' ? undefined : r.recipe }));

  // The site and the floor plan are both optional: a unit with no address simply has no real sun, and
  // a unit with no plan anchors each room from its photo. Neither step blocks Continue.
  const done = [
    listing.address.trim().length > 0,
    Boolean(site),
    Boolean(plan.plan?.floors.length),
    /* A room whose primary photo the quality gate rejected does not go past this step until the
       leasing team retakes it or accepts it deliberately (docs/ACCURACY.md 3.4). The same rule disables
       Generate on the launch step; blocking here is what stops them from finding out at the
       end. `blockedRooms` is the single reader — StepRooms names which rooms and why. */
    rooms.length > 0 && blockedRooms(rooms).length === 0,
    rooms.length > 0 && rooms.every((r) => isAnchored(r) || r.recipe?.method === 'skip'),
    false,
  ];
  const canContinue = step === 0 ? done[0] : step === 3 ? done[3] : true;

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
        availableFrom: listing.availableFrom.trim() || undefined,
        beds: num(listing.beds),
        baths: num(listing.baths),
        sqft: num(listing.sqft),
        summary: listing.summary.trim() || undefined,
        quality,
        notify: { browser: true, email: email.trim() },
        site: site ?? undefined,
      });
      if (plan.plan?.floors.length) {
        updateTour(tour.id, { floorPlan: { ...plan.plan, imageUrl: plan.image?.dataUrl, fileName: plan.fileName } });
      }
      const simulate: string[] = [];
      for (const r of rooms) {
        const room = addRoom(tour.id, {
          name: r.name.trim() || 'Room',
          type: r.type,
          photo: r.photo,
          photos: r.photos,
          planDims: planDimensionsOf(r.planRoom),
          raw: r.raw,
          anchor: finalAnchor(r),
        });
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
      toast({ kind: 'error', title: 'Could not start the model', body: e?.message });
      setLaunching(false);
    }
  };

  const current = WIZARD_STEPS[step];

  // Each step opens at its heading, not wherever the previous step was scrolled to. Instant, not
  // smooth: a smooth scroll is abandoned the moment the new step's layout lands (and never starts at
  // all in a background tab), which is how a step used to open half way down its own list. Re-applied
  // on the next frame because the browser's scroll anchoring pulls the position back once the taller
  // step is swapped for the shorter one.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const top = () => window.scrollTo({ top: 0, behavior: 'auto' });
    top();
    const frame = window.requestAnimationFrame(top);
    const settle = window.setTimeout(top, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [step]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="micro">New unit{demo ? ' · demo' : ''}</div>
          <h1 className="display mt-1 text-3xl text-ink md:text-4xl">
            {step === 0
              ? 'Where is the unit?'
              : step === 1
                ? 'Where does the sun come from?'
                : step === 2
                  ? 'Does the unit have a floor plan?'
                  : step === 3
                    ? 'Photos of each room'
                    : step === 4
                      ? 'Give each room one real measurement'
                      : 'Ready to generate'}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {!demo && step === 0 && rooms.length === 0 ? (
            <Link to="/new?demo=1" className="text-ink-3 hover:text-ink">
              No photos handy? <span className="font-semibold text-ink">Try the demo →</span>
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

      <Stepper step={step} done={done} furthest={furthest} onJump={setStep} />

      {demo && step === 0 ? (
        <Callout tone="info" title="Demo unit">
          Three rooms were typed in from a tape measure and one has a drawn photo, so every step works without a file. Nothing here reaches a live reconstruction; typed and demo rooms are always simulated.
        </Callout>
      ) : null}

      {/* Scroll anchoring would otherwise keep the old step's position when the new one is shorter. */}
      <div key={current.key} className="animate-fade" style={{ overflowAnchor: 'none' }}>
        {step === 0 ? <StepListing listing={listing} onChange={(p) => setListing((l) => ({ ...l, ...p }))} /> : null}
        {step === 1 ? <StepSite listing={listing} rooms={rooms} site={site} onChange={setSite} /> : null}
        {step === 2 ? (
          <StepFloorPlan
            plan={plan}
            roomCount={rooms.length}
            planRoomCount={planOnlyCount}
            onFile={(f) => void readPlan(f, f.name)}
            onDemo={() => void loadDemoPlan()}
            onClear={clearPlan}
            onToggle={togglePlanRoom}
            onToggleAll={toggleAllPlanRooms}
            onEditRoom={editPlanRoom}
            onUseRooms={usePlanRooms}
          />
        ) : null}
        {step === 3 ? (
          <StepRooms
            rooms={rooms}
            loading={loading}
            onAddFiles={addFiles}
            onAddMeasured={addMeasured}
            onUpdate={patchRoom}
            onRemove={removeRoom}
            onMove={moveRoom}
            planRooms={plan.plan ? flattenPlan(plan.plan) : undefined}
            onMatchPlan={matchPlanRoom}
            onAddAngle={(id, files) => void addAngles(id, files)}
            onRemovePhoto={removePhoto}
            onPhotoAngle={setPhotoAngle}
            onAddUrls={(t) => void addPhotoUrls(t)}
            urlImport={urlImport}
          />
        ) : null}
        {step === 4 ? <StepAnchor rooms={rooms} activeId={activeAnchor} onActive={setActiveAnchor} onRecipe={setRecipe} onMeasured={setMeasured} /> : null}
        {step === 5 ? <StepLaunch listing={listing} rooms={rooms} quality={quality} onQuality={setQuality} email={email} onEmail={setEmail} launching={launching} onLaunch={launch} /> : null}
      </div>

      {step < 5 ? (
        <div className={cx('flex items-center justify-between border-t border-line pt-5')}>
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            <Icon.ArrowLeft size={16} /> Back
          </Button>
          <div className="flex items-center gap-3">
            {step === 3 && loading > 0 ? <span className="text-xs text-ink-3">Reading photos…</span> : null}
            {step === 4 && !done[4] ? <span className="hidden text-xs text-ink-3 sm:block">{rooms.filter((r) => !isAnchored(r) && r.recipe?.method !== 'skip').length} room(s) still need an anchor or a skip</span> : null}
            <Button variant="primary" disabled={!canContinue || ((step === 2 || step === 3) && loading > 0) || plan.state === 'parsing'} onClick={() => setStep((s) => Math.min(5, s + 1))}>
              {step === 1 && !site ? 'Skip the site' : step === 2 && !plan.plan ? 'Skip the floor plan' : step === 4 && !done[4] ? 'Continue anyway' : 'Continue'} <Icon.ArrowRight size={16} />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-start border-t border-line pt-5">
          <Button variant="ghost" onClick={() => setStep(4)}>
            <Icon.ArrowLeft size={16} /> Back to anchors
          </Button>
        </div>
      )}
    </div>
  );
}
