/**
 * The generation job runner. Deep-research style: a job is created the instant the user hits go,
 * keeps running while they browse elsewhere (or close the tab and come back), and tells them
 * when it lands. State lives in the persisted store so a reload resumes polling.
 */
import { useEffect } from 'react';
import { mockWorld } from '@/services/mockWorld';
import {
  fetchColliderBounds,
  fetchWorld,
  panoUrlOf,
  pollOperation,
  startGeneration,
  waitForPano,
  worldFromMarble,
  type MarbleOperation,
  type MarbleWorld,
  type WorldBounds,
} from '@/services/marble';
import { chime, sendNotification, setTitleBadge } from '@/lib/notify';
import { uid } from '@/lib/ids';
import { toast, useAudora } from './store';
import type { Job, JobStep, Tier } from './types';

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

async function startJob(job: Job) {
  const { updateJob, rooms } = useAudora.getState();
  const room = rooms[job.roomId];
  if (!room) return updateJob(job.id, { status: 'failed', error: 'Room no longer exists', finishedAt: Date.now() });
  if (job.provider === 'marble') {
    // Mark it running before the request leaves so a tab that takes over the lease mid-request never starts it twice.
    updateJob(job.id, { status: 'running', startedAt: Date.now(), progress: 1, step: 'Starting the reconstruction', lastPollAt: Date.now() + 8000 });
    try {
      const { operationId, worldId } = await startGeneration(room, job.tier);
      updateJob(job.id, { status: 'running', operationId, worldId, progress: 2, step: stepFor(2), lastPollAt: 0 });
    } catch (e: any) {
      updateJob(job.id, { status: 'failed', error: e?.message || 'Could not start generation', finishedAt: Date.now() });
      useAudora.getState().updateRoom(job.roomId, { status: 'failed' });
      toast({ kind: 'error', title: `${room.name}: generation failed`, body: e?.message });
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
  const world = worldBuilder();
  s.attachWorld(job.roomId, world);
  s.updateJob(job.id, { status: 'done', progress: 100, step: 'Ready', finishedAt: Date.now(), worldId: world.worldId });

  // Is the whole tour done?
  const after = useAudora.getState();
  const remaining = Object.values(after.jobs).filter((j) => j.tourId === job.tourId && (j.status === 'queued' || j.status === 'running'));
  const tourTitle = tour?.title || 'Your tour';
  const to = `/tours/${job.tourId}`;
  if (remaining.length === 0) {
    toast({ kind: 'success', title: `${tourTitle} is ready to walk`, body: 'Every room has finished generating.', action: { label: 'Open tour', to } });
    if (tour?.notify.browser) sendNotification('Audora: your tour is ready', `${tourTitle} finished generating. Tap to walk it.`, () => (window.location.hash = ''), );
    if (after.settings.sound) chime();
  } else {
    toast({ kind: 'info', title: `${room.name} is ready`, body: `${remaining.length} room${remaining.length === 1 ? '' : 's'} still generating.`, action: { label: 'Peek', to } });
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
    s().updateRoom(job.roomId, { status: 'failed' });
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
    s().updateJob(job.id, { step: 'Measuring the room', detail: 'Reading the collider mesh', progress: 99 });
    try {
      bounds = await fetchColliderBounds(colliderUrl);
    } catch (e) {
      console.warn('[audora] collider bounds unavailable, keeping photo estimate', e);
    }
  }
  const room = s().rooms[job.roomId];
  if (!room) {
    s().updateJob(job.id, { status: 'failed', error: 'Room was deleted', finishedAt: Date.now() });
    return;
  }
  const w = world;
  finishJob(job, () => worldFromMarble(room, job.tier, w, op.cost?.total_credits ?? undefined, Math.round(elapsed), bounds));
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
              s.updateRoom(job.roomId, { status: 'failed' });
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
                useAudora.getState().updateRoom(job.roomId, { status: 'failed' });
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
            s.updateRoom(job.roomId, { status: 'failed' });
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

/** Queue generation for every pending room in a tour. */
export function generateTour(tourId: string, tier?: Tier) {
  const s = useAudora.getState();
  const tour = s.tours[tourId];
  if (!tour) return [];
  const t = tier ?? tour.quality;
  const provider = activeProvider();
  const eta = provider === 'marble' ? REAL_ETA[t] : t === 'draft' ? s.settings.mockDraftSeconds : s.settings.mockFullSeconds;
  return tour.roomIds
    .map((rid) => s.rooms[rid])
    .filter((r) => r && (r.status === 'pending' || r.status === 'failed' || (t === 'full' && !r.full)))
    .map((room) => s.enqueueJob({ tourId, roomId: room.id, tier: t, provider, etaSeconds: eta }));
}

export function regenerateRoom(roomId: string, tier: Tier) {
  const s = useAudora.getState();
  const room = s.rooms[roomId];
  if (!room) return undefined;
  const provider = activeProvider();
  const eta = provider === 'marble' ? REAL_ETA[tier] : tier === 'draft' ? s.settings.mockDraftSeconds : s.settings.mockFullSeconds;
  return s.enqueueJob({ tourId: room.tourId, roomId, tier, provider, etaSeconds: eta });
}
