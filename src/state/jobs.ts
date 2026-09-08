/**
 * The generation job runner. Deep-research style: a job is created the instant the user hits go,
 * keeps running while they browse elsewhere (or close the tab and come back), and tells them
 * when it lands. State lives in the persisted store so a reload resumes polling.
 */
import { useEffect } from 'react';
import { mockWorld } from '@/services/mockWorld';
import {
  fetchColliderGeometry,
  fetchWorld,
  panoUrlOf,
  pollOperation,
  providerStatus,
  startGeneration,
  waitForPano,
  worldFromMarble,
  type MarbleOperation,
  type MarbleWorld,
  type WorldBounds,
} from '@/services/marble';
import { modelForModelRoom, modelRoomOf } from '@/screens/create/intake';
import { chime, sendNotification, setTitleBadge } from '@/lib/notify';
import { uid } from '@/lib/ids';
import { toast, useAudora } from './store';
import { FULL_READY_TITLE, hasPendingJob, needsFull, pickWorld, tierCost, upgradeTargets, type TierCost } from './publish';
import type { Job, JobStep, Provider, Room, Tier } from './types';

export const JOB_STEPS: JobStep[] = [
  { label: 'Reading the photo', at: 0 },
  { label: 'Anchoring the scale', at: 10 },
  { label: 'Generating geometry', at: 24 },
  { label: 'Painting surfaces and light', at: 62 },
  { label: 'Placing you at eye height', at: 90 },
  { label: 'Ready', at: 100 },
];

export function stepFor(progress: number): string {
  let label = JOB_STEPS[0].label;
  for (const s of JOB_STEPS) if (progress >= s.at) label = s.label;
  return label;
}

export const REAL_ETA: Record<Tier, number> = { draft: 75, full: 600 };

let ticking = false;

/* ---------- one runner per browser ----------
 * Every tab holds the same persisted jobs, so without a lease two tabs would both start the same queued
 * job (spending Marble credits twice) and both finish it. The lease lives in localStorage: a tab that
 * sees no lease, or a stale one, takes over; the holder renews it on every tick and releases it on unload. */
const RUNNER_KEY = 'audora-runner';
const RUNNER_TTL_MS = 3500;
const runnerId = uid('tab');

function claimRunner(): boolean {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(RUNNER_KEY);
    const cur = raw ? (JSON.parse(raw) as { id: string; at: number }) : null;
    if (cur && cur.id !== runnerId && now - cur.at < RUNNER_TTL_MS) return false;
    localStorage.setItem(RUNNER_KEY, JSON.stringify({ id: runnerId, at: now }));
    return true;
  } catch {
    return true; // no storage at all: nothing to coordinate with
  }
}

function releaseRunner() {
  try {
    const raw = localStorage.getItem(RUNNER_KEY);
    if (raw && (JSON.parse(raw) as { id: string }).id === runnerId) localStorage.removeItem(RUNNER_KEY);
  } catch {
    /* ignore */
  }
}

/** True when this tab is the runner right now (for UI that wants to know, e.g. tests). */
export function isRunnerTab(): boolean {
  try {
    const raw = localStorage.getItem(RUNNER_KEY);
    return !!raw && (JSON.parse(raw) as { id: string }).id === runnerId;
  } catch {
    return true;
  }
}

/**
 * A failed job only fails the *room* when the room has nothing to show. A full-quality upgrade that
 * fails leaves the draft standing: the renter keeps walking it, and only the job carries the error.
 */
function failRoom(roomId: string) {
  const s = useAudora.getState();
  const room = s.rooms[roomId];
  if (!room || room.draft || room.full) return;
  s.updateRoom(roomId, { status: 'failed' });
}

/**
 * The model id the server will really run for this tier, from `/api/status`.
 *
 * It is part of the recipe and therefore part of the hash, so guessing it is not a small thing: a
 * room started before the status check answered would hash differently from the same room started
 * after it did, and the recorded model would not be the one the server ran (`MARBLE_DRAFT_MODEL` /
 * `MARBLE_FULL_MODEL` override the defaults server-side). So it is resolved here, once, and a
 * generation that cannot learn it fails loudly instead of recording a model it invented.
 */
async function marbleModels(tier: Tier): Promise<{ marbleDraft?: string; marbleFull?: string }> {
  const key = tier === 'full' ? 'marbleFull' : 'marbleDraft';
  const known = useAudora.getState().providers.models;
  if (known?.[key]) return known;
  const fresh = await providerStatus();
  useAudora.getState().setProviders(fresh);
  if (!fresh.models?.[key]) throw new Error('The server has not said which Marble model it runs. Check that it is reachable and try again.');
  return fresh.models;
}

/**
 * The model this room is reconstructed with: the tier's own, or `marble-1.1-plus` for an open plan
 * or a room the plan draws bigger than 30 m² (docs/ACCURACY.md 3.5).
 *
 * The choice goes into the recipe *and* onto the request, so the model the launch step showed the
 * leasing team is the model that runs and the model the recipe hash names. The server still allowlists it
 * (`modelFor`, server/marbleRequest.ts) — naming one here cannot make it run something arbitrary.
 */
async function marbleModelId(room: Room, tier: Tier): Promise<string> {
  return modelForModelRoom(modelRoomOf(room), tier, await marbleModels(tier)).model;
}

async function startJob(job: Job) {
  const { updateJob, rooms } = useAudora.getState();
  const room = rooms[job.roomId];
  if (!room) return updateJob(job.id, { status: 'failed', error: 'Room no longer exists', finishedAt: Date.now() });
  if (job.provider === 'marble') {
    // Mark it running before the request leaves so a tab that takes over the lease mid-request never starts it twice.
    updateJob(job.id, { status: 'running', startedAt: Date.now(), progress: 1, step: 'Starting the reconstruction', lastPollAt: Date.now() + 8000 });
    try {
      // The recipe names the model the server will actually run and the tour's site; the hash,
      // seed and prompt it was sent with ride on the job until the world lands (finaliseMarbleJob).
      const { tours } = useAudora.getState();
      const { operationId, worldId, recipeHash, seed, prompt } = await startGeneration(room, job.tier, {
        modelId: await marbleModelId(room, job.tier),
        site: tours[job.tourId]?.site,
      });
      updateJob(job.id, { status: 'running', operationId, worldId, recipeHash, seed, prompt, progress: 2, step: stepFor(2), lastPollAt: 0 });
    } catch (e: any) {
      const message: string = e?.message || 'Could not start generation';
      updateJob(job.id, { status: 'failed', error: message, finishedAt: Date.now() });
      failRoom(job.roomId);
      // The dev server's credit guard answers 429 with a sentence that explains itself; show it as
      // written rather than burying it under a generic failure.
      const guarded = /credit guard/i.test(message);
      toast({
        kind: guarded ? 'warn' : 'error',
        title: guarded ? 'Credit guard: generation blocked' : `${room.name}: generation failed`,
        body: guarded ? message : e?.message,
        action: guarded ? { label: 'Settings', to: '/settings' } : undefined,
      });
    }
  } else {
    updateJob(job.id, { status: 'running', startedAt: Date.now(), progress: 1, step: stepFor(1) });
  }
}

function finishJob(job: Job, worldBuilder: () => ReturnType<typeof mockWorld>) {
  const s = useAudora.getState();
  const room = s.rooms[job.roomId];
  const tour = s.tours[job.tourId];
  if (!room) return;
  // Read before attaching: a full job on a room that already has a draft is an upgrade, and the
  // whole story the user is told about it ("upgrading", "full quality is ready") hangs off that.
  const isUpgradeJob = job.tier === 'full' && (job.upgrade || Boolean(room.draft));
  const world = worldBuilder();
  s.attachWorld(job.roomId, world);
  s.updateJob(job.id, { status: 'done', progress: 100, step: 'Ready', finishedAt: Date.now(), worldId: world.worldId });

  // Is the whole tour done?
  const after = useAudora.getState();
  /* "Full quality is ready — renters get the best world every room has" is only true if the world
     that just landed is the world the renter gets. A *simulated* full never displaces a real Marble
     capture (pickWorld), so a free rehearsal on the real corner room finishes with the renter still
     walking the draft — and saying otherwise, in the toast, the browser notification and the tray,
     was the app contradicting its own publish panel one screen down. */
  const roomAfter = after.rooms[job.roomId];
  const delivered = !roomAfter || pickWorld(roomAfter.draft, roomAfter.full) === (world.tier === 'full' ? roomAfter.full : roomAfter.draft);
  const upgraded = isUpgradeJob && delivered;
  const shadowed = isUpgradeJob && !delivered;
  const remaining = Object.values(after.jobs).filter((j) => j.tourId === job.tourId && (j.status === 'queued' || j.status === 'running'));
  const tourTitle = tour?.title || 'Your tour';
  const to = `/tours/${job.tourId}`;
  const shadowBody = `A simulated full world is attached, but ${room.name} keeps its real Marble capture — that is the better world, so that is what renters walk.`;
  if (remaining.length === 0) {
    const title = shadowed ? `${room.name}: simulated full attached` : upgraded ? FULL_READY_TITLE : `${tourTitle} is ready to walk`;
    const body = shadowed ? shadowBody : upgraded ? `${room.name} is full quality now. Renters get the best world every room has.` : 'Every room has finished generating.';
    toast({ kind: shadowed ? 'info' : 'success', title, body, action: { label: 'Open unit', to } });
    if (tour?.notify.browser && !shadowed) {
      sendNotification(
        upgraded ? `Audora: ${FULL_READY_TITLE.toLowerCase()}` : 'Audora: your unit is ready',
        upgraded ? `${tourTitle} — ${room.name} finished its full-quality reconstruction.` : `${tourTitle} finished generating. Tap to walk it.`,
        () => (window.location.hash = ''),
      );
    }
    if (after.settings.sound && !shadowed) chime();
  } else {
    const still = `${remaining.length} room${remaining.length === 1 ? '' : 's'} still ${isUpgradeJob ? 'upgrading' : 'generating'}.`;
    toast({
      kind: upgraded ? 'success' : 'info',
      title: shadowed ? `${room.name}: simulated full attached` : upgraded ? `${room.name}: ${FULL_READY_TITLE.toLowerCase()}` : `${room.name} is ready`,
      body: shadowed ? `${shadowBody} ${still}` : still,
      action: { label: 'Peek', to },
    });
  }
  setTitleBadge(Object.values(after.jobs).filter((j) => j.status === 'done' && !j.seen).length);
}

/* ---------- finishing a Marble job ----------
 * Reading the collider mesh and waiting for the panorama both take seconds, and the panorama can
 * take a minute. That work runs detached from the tick loop so the other rooms keep polling; the
 * job stays `running` with an honest step, and these ids are skipped until it lands. */
const finalising = new Set<string>();

/** Fetch the world record, wait for its panorama, read its collider bounds, then attach it. */
async function finaliseMarbleJob(job: Job, op: MarbleOperation, elapsed: number) {
  const s = () => useAudora.getState();
  const worldId = op.response?.world_id || op.metadata?.world_id || job.worldId;
  let world: MarbleWorld | undefined = op.response || undefined;
  // The operation often answers with metadata only, or with a record written before the assets were.
  if (worldId && (!world?.assets || !world.assets.splats || !panoUrlOf(world))) {
    try {
      const fetched = await fetchWorld(worldId);
      if (fetched?.assets || !world) world = fetched;
    } catch {
      /* keep whatever the operation returned */
    }
  }
  if (!world) {
    s().updateJob(job.id, { status: 'failed', error: 'Finished without a world', finishedAt: Date.now() });
    failRoom(job.roomId);
    return;
  }
  // Draft panoramas land a few seconds after the operation completes.
  if (!panoUrlOf(world) && worldId) {
    s().updateJob(job.id, { step: 'Finishing the panorama', detail: 'Marble is still writing the panorama', progress: 99 });
    world =
      (await waitForPano(worldId, world, {
        onAttempt: (_n, ms) => s().updateJob(job.id, { step: 'Finishing the panorama', detail: `Waiting for the panorama · ${Math.round(ms / 1000)}s` }),
      })) ?? world;
  }
  let bounds: WorldBounds | undefined;
  const colliderUrl = world.assets?.mesh?.collider_mesh_url;
  if (colliderUrl) {
    s().updateJob(job.id, { step: 'Measuring the room', detail: 'Finding the walls in the collider mesh', progress: 99 });
    try {
      // Not just the bounding box: `fetchColliderGeometry` reads the vertices and measures the room
      // to its walls, so the numbers the renter reads are not inflated by what the model saw through
      // the windows (see `fitWallRect` in services/marble).
      bounds = await fetchColliderGeometry(colliderUrl);
    } catch (e) {
      console.warn('[audora] collider geometry unavailable, keeping photo estimate', e);
    }
  }
  const room = s().rooms[job.roomId];
  if (!room) {
    s().updateJob(job.id, { status: 'failed', error: 'Room was deleted', finishedAt: Date.now() });
    return;
  }
  const w = world;
  // Provenance travels from the job (set when the generation started) onto the world it produced.
  const provenance = { recipeHash: job.recipeHash, seed: job.seed, prompt: job.prompt };
  finishJob(job, () => worldFromMarble(room, job.tier, w, op.cost?.total_credits ?? undefined, Math.round(elapsed), bounds, provenance));
}

async function tick() {
  if (ticking) return;
  if (!claimRunner()) return;
  ticking = true;
  try {
    const s = useAudora.getState();
    const jobs = Object.values(s.jobs);
    const now = Date.now();
    // Start queued jobs, a few at a time.
    const running = jobs.filter((j) => j.status === 'running').length;
    const queued = jobs.filter((j) => j.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    for (const j of queued.slice(0, Math.max(0, 3 - running))) {
      if (!claimRunner()) return; // another tab took over while we were starting jobs
      await startJob(j);
    }

    for (const job of Object.values(useAudora.getState().jobs)) {
      if (job.status !== 'running' || !job.startedAt) continue;
      if (finalising.has(job.id)) continue; // its world is being collected right now
      if (!claimRunner()) return;
      const room = useAudora.getState().rooms[job.roomId];
      if (!room) {
        s.updateJob(job.id, { status: 'failed', error: 'Room was deleted', finishedAt: now });
        continue;
      }
      if (job.provider === 'mock') {
        const elapsed = (now - job.startedAt) / 1000;
        const p = Math.min(100, (elapsed / Math.max(1, job.etaSeconds)) * 100);
        if (p >= 100) finishJob(job, () => mockWorld(room, job.tier, Math.round(elapsed)));
        else s.updateJob(job.id, { progress: Math.round(p), step: stepFor(p) });
      } else {
        if (now - (job.lastPollAt || 0) < 4000) continue;
        if (!job.operationId) continue; // still starting
        s.updateJob(job.id, { lastPollAt: now });
        try {
          const op = await pollOperation(job.operationId);
          const elapsed = (now - job.startedAt) / 1000;
          if (op.done) {
            if (op.error) {
              s.updateJob(job.id, { status: 'failed', error: op.error.message || op.error.code || 'Generation failed', finishedAt: now });
              failRoom(job.roomId);
              toast({ kind: 'error', title: `${room.name}: generation failed`, body: op.error.message });
              continue;
            }
            // Assets, panorama and collider are collected off the tick loop (this can take a minute).
            const worldId = op.response?.world_id || op.metadata?.world_id || job.worldId;
            finalising.add(job.id);
            s.updateJob(job.id, { progress: 99, step: 'Measuring the room', detail: 'Collecting the world assets', worldId });
            void finaliseMarbleJob(job, op, elapsed)
              .catch((e: any) => {
                useAudora.getState().updateJob(job.id, { status: 'failed', error: e?.message || 'Could not collect the finished world', finishedAt: Date.now() });
                failRoom(job.roomId);
              })
              .finally(() => finalising.delete(job.id));
          } else {
            const reported = op.metadata?.progress_percent;
            // Marble reports a status line rather than a percentage; blend with elapsed time so the bar never stalls.
            const byTime = Math.min(96, (elapsed / job.etaSeconds) * 100);
            const p = Math.max(job.progress, Math.round(reported != null ? Math.max(reported, byTime * 0.9) : byTime));
            const detail = op.metadata?.progress?.description || (op.metadata?.public_model_name ? `${op.metadata.public_model_name} running` : undefined);
            const worldId = job.worldId || op.metadata?.world_id;
            s.updateJob(job.id, { progress: Math.min(99, p), step: stepFor(p), detail, worldId });
          }
        } catch (e: any) {
          // transient network errors: keep polling, but surface repeated ones
          const stale = now - job.startedAt > job.etaSeconds * 3000;
          if (stale) {
            s.updateJob(job.id, { status: 'failed', error: e?.message || 'Lost contact with the generation service', finishedAt: now });
            failRoom(job.roomId);
          }
        }
      }
    }
  } finally {
    ticking = false;
  }
}

/** Mount once at the app root. Only one tab per browser actually runs jobs; the others follow through storage. */
export function useJobRunner() {
  useEffect(() => {
    const id = window.setInterval(() => void tick(), 1000);
    void tick();
    window.addEventListener('pagehide', releaseRunner);
    window.addEventListener('beforeunload', releaseRunner);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pagehide', releaseRunner);
      window.removeEventListener('beforeunload', releaseRunner);
      releaseRunner();
    };
  }, []);
}

/** Which provider a new job would use right now. */
export function activeProvider(): 'marble' | 'mock' {
  const s = useAudora.getState();
  return s.providers.marble && !s.settings.preferMock ? 'marble' : 'mock';
}

/** How long a job of this tier takes on this provider: the measured Marble figure, or the mock's. */
export function etaFor(tier: Tier, provider: Provider = activeProvider()): number {
  const s = useAudora.getState().settings;
  return provider === 'marble' ? REAL_ETA[tier] : tier === 'draft' ? s.mockDraftSeconds : s.mockFullSeconds;
}

/** Enqueue one job, tagging it as an upgrade when the room already has a world to fall back on. */
function queueJob(room: Room, tier: Tier, provider: Provider): Job {
  return useAudora.getState().enqueueJob({
    tourId: room.tourId,
    roomId: room.id,
    tier,
    provider,
    etaSeconds: etaFor(tier, provider),
    upgrade: tier === 'full' && Boolean(room.draft || room.full),
  });
}

/** Queue generation for every pending room in a tour. */
export function generateTour(tourId: string, tier?: Tier) {
  const s = useAudora.getState();
  const tour = s.tours[tourId];
  if (!tour) return [];
  const t = tier ?? tour.quality;
  const provider = activeProvider();
  const jobs = Object.values(s.jobs).filter((j) => j.tourId === tourId);
  return tour.roomIds
    .map((rid) => s.rooms[rid])
    .filter((r) => r && (r.status === 'pending' || r.status === 'failed' || (t === 'full' && !r.full)))
    // Never queue a second job of the same tier for a room: two Marble generations, one world, double the credits.
    .filter((r) => !hasPendingJob(jobs, r.id, t))
    .map((room) => queueJob(room, t, provider));
}

export function regenerateRoom(roomId: string, tier: Tier) {
  const s = useAudora.getState();
  const room = s.rooms[roomId];
  if (!room) return undefined;
  if (hasPendingJob(Object.values(s.jobs), roomId, tier)) return undefined; // already on its way
  return queueJob(room, tier, activeProvider());
}

export interface UpgradeResult {
  /** Jobs actually queued by this call. */
  jobs: Job[];
  /** Rooms that needed the upgrade and already had one on the way. */
  skipped: Room[];
  provider: Provider;
  /** What the queued jobs will cost (zero on the simulated provider). */
  cost: TierCost;
}

/**
 * Take a whole tour to full quality: one `marble-1.1` job per room that only has a draft, skipping
 * any room whose upgrade is already queued or running. This is what Publish calls — the renter
 * should walk the full reconstruction, and the draft stays on screen until it lands.
 */
export function upgradeTourToFull(tourId: string): UpgradeResult {
  const s = useAudora.getState();
  const provider = activeProvider();
  const tour = s.tours[tourId];
  if (!tour) return { jobs: [], skipped: [], provider, cost: tierCost(0, 'full', provider) };
  const rooms = tour.roomIds.map((rid) => s.rooms[rid]).filter(Boolean) as Room[];
  const jobs = Object.values(s.jobs).filter((j) => j.tourId === tourId);
  const targets = upgradeTargets(rooms, jobs, provider);
  const skipped = rooms.filter((r) => needsFull(r, provider) && hasPendingJob(jobs, r.id, 'full'));
  const queued = targets.map((room) => queueJob(room, 'full', provider));
  return { jobs: queued, skipped, provider, cost: tierCost(queued.length, 'full', provider) };
}
