/**
 * Quality tiers and the publish flow, as pure functions.
 *
 * The product rule behind all of it: **the buyer always gets the best world**. A draft is what the
 * seller stages against (about a minute, 230 credits); a full `marble-1.1` reconstruction is what a
 * buyer should walk (about ten minutes, 1,580 credits ≈ $1.26). Publishing therefore offers to
 * regenerate every room that only has a draft — and it never spends a credit without saying so
 * first, which is why the button label carries the room count and the credit total.
 *
 * Everything here is pure so the credit arithmetic and the no-duplicate-job rule can be tested
 * without a store, a runner or a browser.
 */
import { TIER_INFO } from '@/services/mockWorld';
import { clock, eta } from '@/lib/format';
import type { Job, Provider, Room, RoomWorld, Tier } from './types';

export const DRAFT_MODEL = 'marble-1.0-draft';
export const FULL_MODEL = 'marble-1.1';

/** "4,740" — credit totals are money, so they get thousands separators (and the mono font in the UI). */
export const credits = (n: number) => n.toLocaleString('en-US');

export interface TierCost {
  rooms: number;
  credits: number;
  usd: number;
}

/** What `rooms` rooms of a tier cost at the published rate. Simulated rooms cost nothing. */
export function tierCost(rooms: number, tier: Tier = 'full', provider: Provider = 'marble'): TierCost {
  const n = Math.max(0, Math.floor(rooms));
  if (provider === 'mock') return { rooms: n, credits: 0, usd: 0 };
  const info = TIER_INFO[tier];
  return { rooms: n, credits: info.credits * n, usd: Number((info.usd * n).toFixed(2)) };
}

/** A capture with something real to render: a Marble world with a splat, a panorama or a collider. */
export const isRealWorld = (w: RoomWorld | undefined): boolean =>
  !!w && w.provider === 'marble' && Boolean(w.spzUrl || w.panoUrl || w.colliderUrl);

/**
 * The world the buyer gets. Full quality wins — that is the whole point of the upgrade — with one
 * exception: a *simulated* full world never displaces a real capture. Rehearsing the publish flow
 * with "Prefer simulated reconstruction" on must not replace a photoreal Marble draft with a
 * procedural stand-in; that would make the tour worse, not better.
 */
export function pickWorld(draft: RoomWorld | undefined, full: RoomWorld | undefined): RoomWorld | undefined {
  if (!full) return draft;
  if (!draft) return full;
  if (full.provider === 'mock' && isRealWorld(draft)) return draft;
  return full;
}

/** True when a room carries a full world that the buyer is not being shown (a simulated rehearsal). */
export function fullIsShadowed(room: Room): boolean {
  return Boolean(room.full) && pickWorld(room.draft, room.full) !== room.full;
}

/** The tier of the world the buyer is actually shown. */
export function shownTier(room: Room | undefined): Tier | undefined {
  return room ? pickWorld(room.draft, room.full)?.tier : undefined;
}

/**
 * The quality a tour is *shipping*, read off its rooms rather than off a field written at queue
 * time. `Tour.quality` says what the seller asked to generate; it was set optimistically by the
 * bulk upgrade and never by a single-room one, so as a label it contradicted itself in both
 * directions ("full quality" before any full world existed; "draft quality" after a room had been
 * upgraded). A tour is full quality when every ready room is showing a full world.
 */
export function tourQuality(rooms: Room[]): Tier {
  const ready = rooms.filter((r) => r.status === 'ready' || r.draft || r.full);
  if (!ready.length) return 'draft';
  return ready.every((r) => shownTier(r) === 'full') ? 'full' : 'draft';
}

/* ---------- what the publish flow would regenerate ---------- */

/**
 * A room the publish flow would take to full quality: it has a reconstruction, but not a full one
 * the current provider could improve on.
 *
 * A *simulated* full does not consume the room's one upgrade: rehearsing the publish flow for free
 * ("Prefer simulated reconstruction" on) must never lock the seller out of the real `marble-1.1`
 * pass the rehearsal was rehearsing. So a mock full still needs a full when the provider is Marble,
 * and nothing needs anything more when the provider is the simulator — which is also what stops the
 * free rehearsal from queueing itself again forever.
 */
export function needsFull(room: Room | undefined, provider: Provider = 'marble'): boolean {
  if (!room) return false;
  if (room.full) return provider === 'marble' && room.full.provider === 'mock';
  return Boolean(room.draft) || room.status === 'ready';
}

export const isActive = (j: Job) => j.status === 'queued' || j.status === 'running';

/** Is there already a queued or running job of this tier for the room? Guards against double spending. */
export function hasPendingJob(jobs: Job[], roomId: string, tier: Tier): boolean {
  return jobs.some((j) => j.roomId === roomId && j.tier === tier && isActive(j));
}

/**
 * The rooms one "generate full quality" would actually queue: every room that needs a full world
 * and does not already have one on the way. Queueing twice would spend 1,580 credits for nothing.
 */
export function upgradeTargets(rooms: Room[], jobs: Job[], provider: Provider = 'marble'): Room[] {
  return rooms.filter((r) => needsFull(r, provider) && !hasPendingJob(jobs, r.id, 'full'));
}

/** Rooms whose full-quality job is already queued or running (shown as state, not as a button). */
export function upgradingRooms(rooms: Room[], jobs: Job[]): Room[] {
  return rooms.filter((r) => hasPendingJob(jobs, r.id, 'full'));
}

/** Active full-quality jobs on rooms that already had a world: an upgrade, not a first generation. */
export function upgradeJobs(rooms: Room[], jobs: Job[]): Job[] {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  return jobs.filter((j) => isActive(j) && j.tier === 'full' && (j.upgrade || Boolean(byId.get(j.roomId)?.draft)));
}

/* ---------- labels ---------- */

export interface PublishLabelInput {
  published: boolean;
  /** How many rooms the click would send to full quality (0 = publish only). */
  rooms: number;
  provider: Provider;
  cost: TierCost;
}

/**
 * The primary button's label. It always says what the click will do and what it will spend:
 * "Publish and generate full quality · 3 rooms · 4,740 credits".
 */
export function publishLabel({ published, rooms, provider, cost }: PublishLabelInput): string {
  if (rooms <= 0) return published ? 'Published' : 'Publish';
  const tail = ` · ${rooms} room${rooms === 1 ? '' : 's'} · ${provider === 'marble' ? `${credits(cost.credits)} credits` : 'simulated · no credits'}`;
  return `${published ? 'Generate full quality' : 'Publish and generate full quality'}${tail}`;
}

/** The armed state of that button: the last thing between the seller and real money. */
export function confirmLabel(cost: TierCost): string {
  return `Confirm · spend ${credits(cost.credits)} credits ($${cost.usd.toFixed(2)})`;
}

export interface TierChipInfo {
  text: string;
  tone: 'ok' | 'accent' | 'neutral' | 'warn';
  /** The long version, for the title attribute. */
  title: string;
}

/**
 * The tier chip shown wherever a room is listed:
 * "draft · 35 s · 230 credits", "full · marble-1.1 · 1,580 credits", "simulated".
 */
export function worldChip(world: RoomWorld | undefined, opts: { generating?: boolean } = {}): TierChipInfo {
  if (!world) {
    return opts.generating
      ? { text: 'generating', tone: 'accent', title: 'A reconstruction is on its way' }
      : { text: 'not generated', tone: 'warn', title: 'This room has no reconstruction yet' };
  }
  if (world.provider === 'mock') {
    /* One segment, tier included: the compact chip in the room rail keeps only the text before the
       first "·", and "simulated" alone cannot tell a seller whether the upgrade they just watched
       land is on screen. The chip's whole job is which reconstruction the buyer is walking. */
    return {
      text: `simulated ${world.tier}`,
      tone: 'neutral',
      title: `Simulated ${world.tier} reconstruction · ${world.model} · no credits spent`,
    };
  }
  const parts: string[] = [world.tier];
  if (world.tier === 'full') parts.push(world.model || FULL_MODEL);
  else if (world.seconds) parts.push(`${Math.round(world.seconds)} s`);
  else parts.push(world.model || DRAFT_MODEL);
  if (world.credits != null) parts.push(`${credits(world.credits)} credits`);
  return {
    text: parts.join(' · '),
    tone: world.tier === 'full' ? 'ok' : 'accent',
    title: `${world.model} · ${world.worldId}${world.seconds ? ` · ${Math.round(world.seconds)} s` : ''}${world.credits != null ? ` · ${credits(world.credits)} credits` : ''}`,
  };
}

/** The tier chip for a room: whatever the buyer is actually being shown. */
export function roomChip(room: Room, opts: { generating?: boolean } = {}): TierChipInfo {
  return worldChip(pickWorld(room.draft, room.full), { generating: opts.generating || room.status === 'generating' });
}

/**
 * The deep-research line for a running upgrade:
 * "Upgrading to full quality · 06:12 elapsed · about 4 minutes".
 */
export function upgradeLine(elapsedSeconds: number, remainingSeconds: number, queued = false): string {
  const tail = queued ? 'queued' : remainingSeconds > 0 ? eta(remainingSeconds) : 'any moment now';
  return `Upgrading to full quality · ${clock(elapsedSeconds)} elapsed · ${tail}`;
}

/** The promise that makes leaving safe. One sentence, used in the tray, the hub and the publish tab. */
export const LEAVE_COPY =
  'You can leave this page. The upgrade keeps running while you browse elsewhere or close the tab, and we will notify you when full quality is ready.';

export const FULL_READY_TITLE = 'Full quality is ready';
