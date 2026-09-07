/** Small pure helpers for reading jobs, rooms and tours together. */
import { EYE_HEIGHT_M } from '@/engine/anchor';
import { TIER_INFO } from '@/services/mockWorld';
import { upgradeJobs } from '@/state/publish';
import type { Job, ProviderStatus, Room, RoomWorld, Tier, Tour } from '@/state/types';

export const isActiveJob = (j: Job) => j.status === 'queued' || j.status === 'running';

/** The most recent job for a room (jobs are sorted by createdAt ascending from useTourJobs). */
export function latestJobFor(jobs: Job[], roomId: string): Job | undefined {
  let out: Job | undefined;
  for (const j of jobs) if (j.roomId === roomId && (!out || j.createdAt >= out.createdAt)) out = j;
  return out;
}

export function providerName(provider: 'marble' | 'mock'): string {
  return provider === 'marble' ? 'World Labs Marble' : 'Simulated';
}

export function modelName(provider: 'marble' | 'mock', tier: Tier, providers?: ProviderStatus): string {
  if (provider === 'marble') return tier === 'draft' ? providers?.models?.marbleDraft ?? 'marble-1.0-draft' : providers?.models?.marbleFull ?? 'marble-1.1';
  return tier === 'draft' ? 'mock-draft' : 'mock-full';
}

/** Credits and USD for a job: the real figure once a world landed, otherwise the tier estimate. */
export function jobCost(job: Job, world?: RoomWorld): { credits: number; usd: number; estimate: boolean; free: boolean } {
  const info = TIER_INFO[job.tier];
  if (world && world.provider === job.provider && world.tier === job.tier && world.credits != null) {
    return { credits: world.credits, usd: world.usd ?? info.usd, estimate: false, free: job.provider === 'mock' };
  }
  return { credits: info.credits, usd: info.usd, estimate: true, free: job.provider === 'mock' };
}

/** Elapsed seconds for a job, frozen once it finished. */
export function jobElapsed(job: Job, now: number): number {
  const start = job.startedAt ?? job.createdAt;
  const end = job.finishedAt ?? now;
  return Math.max(0, (end - start) / 1000);
}

export function jobRemaining(job: Job, now: number): number {
  return Math.max(0, job.etaSeconds - jobElapsed(job, now));
}

/** A one-line annotation for a pipeline step, e.g. the anchor label or the eye height. */
export function stepDetail(label: string, room: Room | undefined): string | undefined {
  if (!room) return undefined;
  if (label.startsWith('Reading')) return room.photo ? `${room.photo.width} × ${room.photo.height} px` : 'typed measurements';
  if (label.startsWith('Anchoring')) return room.anchor.label;
  if (label.startsWith('Generating')) return `${room.geometry.width.toFixed(2)} × ${room.geometry.depth.toFixed(2)} × ${room.geometry.height.toFixed(2)} m`;
  if (label.startsWith('Placing')) return `${EYE_HEIGHT_M.toFixed(2)}m`;
  return undefined;
}

export interface TourStatus {
  kind: 'empty' | 'pending' | 'generating' | 'failed' | 'ready' | 'published';
  label: string;
  ready: number;
  total: number;
  progress: number;
  /**
   * Every job in flight is a full-quality upgrade of a room that already has a world. The tour is
   * walkable the whole time, so the hub keeps its tabs instead of taking over with the progress view.
   */
  upgrading: boolean;
  /** Those upgrade jobs, for the banner. */
  upgrades: Job[];
}

export function tourStatus(tour: Tour, rooms: Room[], jobs: Job[]): TourStatus {
  const total = rooms.length;
  const ready = rooms.filter((r) => r.status === 'ready').length;
  const active = jobs.filter(isActiveJob);
  const upgrades = upgradeJobs(rooms, jobs);
  const base = { ready, total, upgrading: false, upgrades };
  if (!total) return { ...base, kind: 'empty', label: 'no rooms', progress: 0 };
  if (active.length || rooms.some((r) => r.status === 'generating')) {
    const upgrading = upgrades.length === active.length && rooms.every((r) => r.status !== 'generating' && r.status !== 'pending');
    if (upgrading) {
      const progress = Math.round(upgrades.reduce((a, j) => a + j.progress, 0) / upgrades.length);
      return { ...base, upgrading: true, kind: 'generating', label: `upgrading ${upgrades.length} to full`, progress };
    }
    const latest = rooms.map((r) => latestJobFor(jobs, r.id));
    const sum = latest.reduce((acc, j, i) => acc + (rooms[i].status === 'ready' ? 100 : j ? (j.status === 'done' ? 100 : j.progress) : 0), 0);
    return { ...base, kind: 'generating', label: `generating ${ready} of ${total}`, progress: Math.round(sum / total) };
  }
  if (rooms.some((r) => r.status === 'failed')) return { ...base, kind: 'failed', label: `${rooms.filter((r) => r.status === 'failed').length} failed`, progress: Math.round((ready / total) * 100) };
  if (ready < total) return { ...base, kind: 'pending', label: `${total - ready} not generated`, progress: Math.round((ready / total) * 100) };
  if (tour.published) return { ...base, kind: 'published', label: 'published', progress: 100 };
  return { ...base, kind: 'ready', label: 'ready', progress: 100 };
}
