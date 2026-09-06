/**
 * The publish flow's arithmetic and its guard rails. Credits are real money (1,580 per full room,
 * ≈ $1.26), so the two things that must never drift are the total on the button and the rule that
 * one room never gets two full-quality jobs.
 */
import { describe, expect, it } from 'vitest';
import {
  confirmLabel,
  credits,
  fullIsShadowed,
  hasPendingJob,
  needsFull,
  pickWorld,
  publishLabel,
  roomChip,
  shownTier,
  tierCost,
  tourQuality,
  upgradeJobs,
  upgradeLine,
  upgradeTargets,
  upgradingRooms,
  worldChip,
} from '@/state/publish';
import type { Job, Room, RoomWorld, Tier } from '@/state/types';

const world = (patch: Partial<RoomWorld> = {}): RoomWorld => ({
  provider: 'marble',
  tier: 'draft',
  worldId: 'w1',
  model: 'marble-1.0-draft',
  createdAt: 0,
  raw: {} as RoomWorld['raw'],
  ...patch,
});

const room = (id: string, patch: Partial<Room> = {}): Room =>
  ({
    id,
    tourId: 't1',
    name: id,
    type: 'living',
    order: 0,
    raw: {} as Room['raw'],
    anchor: {} as Room['anchor'],
    geometry: {} as Room['geometry'],
    staging: [],
    stagingStyle: 'warm',
    status: 'ready',
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }) as Room;

const job = (id: string, roomId: string, tier: Tier, status: Job['status']): Job => ({
  id,
  tourId: 't1',
  roomId,
  tier,
  provider: 'mock',
  status,
  progress: 0,
  step: 'Queued',
  etaSeconds: 600,
  createdAt: 0,
  seen: false,
});

describe('credit math', () => {
  it('charges 1,580 credits and $1.26 per full-quality room', () => {
    expect(tierCost(1)).toEqual({ rooms: 1, credits: 1580, usd: 1.26 });
    expect(tierCost(3)).toEqual({ rooms: 3, credits: 4740, usd: 3.78 });
  });

  it('charges 230 credits per draft room', () => {
    expect(tierCost(4, 'draft')).toEqual({ rooms: 4, credits: 920, usd: 0.72 });
  });

  it('is free on the simulated provider', () => {
    expect(tierCost(3, 'full', 'mock')).toEqual({ rooms: 3, credits: 0, usd: 0 });
  });

  it('never charges for a negative or fractional room count', () => {
    expect(tierCost(-2).credits).toBe(0);
    expect(tierCost(2.7).rooms).toBe(2);
  });

  it('groups thousands so a four-figure total is readable', () => {
    expect(credits(4740)).toBe('4,740');
    expect(credits(230)).toBe('230');
  });

  it('says on the button exactly what the click will spend', () => {
    expect(publishLabel({ published: false, rooms: 3, provider: 'marble', cost: tierCost(3) })).toBe(
      'Publish and generate full quality · 3 rooms · 4,740 credits',
    );
    expect(publishLabel({ published: false, rooms: 1, provider: 'marble', cost: tierCost(1) })).toBe(
      'Publish and generate full quality · 1 room · 1,580 credits',
    );
    expect(publishLabel({ published: true, rooms: 2, provider: 'marble', cost: tierCost(2) })).toBe('Generate full quality · 2 rooms · 3,160 credits');
    expect(publishLabel({ published: false, rooms: 2, provider: 'mock', cost: tierCost(2, 'full', 'mock') })).toBe(
      'Publish and generate full quality · 2 rooms · simulated · no credits',
    );
    expect(publishLabel({ published: false, rooms: 0, provider: 'marble', cost: tierCost(0) })).toBe('Publish');
    expect(publishLabel({ published: true, rooms: 0, provider: 'marble', cost: tierCost(0) })).toBe('Published');
  });

  it('repeats the money in the armed state', () => {
    expect(confirmLabel(tierCost(3))).toBe('Confirm · spend 4,740 credits ($3.78)');
  });
});

describe('no duplicate full-quality jobs', () => {
  const a = room('a', { draft: world() });
  const b = room('b', { draft: world() });
  const c = room('c', { draft: world(), full: world({ tier: 'full', model: 'marble-1.1' }) });

  it('targets every room that has only a draft', () => {
    expect(upgradeTargets([a, b, c], []).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('skips a room whose full job is already queued or running', () => {
    const queued = [job('j1', 'a', 'full', 'queued')];
    expect(upgradeTargets([a, b, c], queued).map((r) => r.id)).toEqual(['b']);
    const runningJobs = [job('j2', 'a', 'full', 'running')];
    expect(upgradeTargets([a, b, c], runningJobs).map((r) => r.id)).toEqual(['b']);
    expect(upgradingRooms([a, b, c], queued).map((r) => r.id)).toEqual(['a']);
  });

  it('queueing twice in a row adds nothing the second time', () => {
    const rooms = [a, b];
    const first = upgradeTargets(rooms, []);
    const jobs = first.map((r, i) => job(`j${i}`, r.id, 'full', 'queued'));
    expect(first).toHaveLength(2);
    expect(upgradeTargets(rooms, jobs)).toHaveLength(0);
  });

  it('a finished or failed job does not block a new one', () => {
    expect(hasPendingJob([job('j1', 'a', 'full', 'done')], 'a', 'full')).toBe(false);
    expect(hasPendingJob([job('j1', 'a', 'full', 'failed')], 'a', 'full')).toBe(false);
    expect(hasPendingJob([job('j1', 'a', 'full', 'running')], 'a', 'full')).toBe(true);
  });

  it('a queued draft does not count as a queued full', () => {
    expect(hasPendingJob([job('j1', 'a', 'draft', 'queued')], 'a', 'full')).toBe(false);
    expect(upgradeTargets([a], [job('j1', 'a', 'draft', 'running')]).map((r) => r.id)).toEqual(['a']);
  });

  it('a free simulated rehearsal does not spend the room\'s upgrade', () => {
    const rehearsed = room('r', { draft: world(), full: world({ provider: 'mock', tier: 'full', model: 'mock-full' }) });
    // Live provider: the real marble-1.1 pass the rehearsal was rehearsing is still on offer.
    expect(needsFull(rehearsed, 'marble')).toBe(true);
    expect(upgradeTargets([rehearsed], [], 'marble').map((r) => r.id)).toEqual(['r']);
    // Simulated provider: nothing to add, so "Rehearse" cannot queue itself again forever.
    expect(needsFull(rehearsed, 'mock')).toBe(false);
    expect(upgradeTargets([rehearsed], [], 'mock')).toHaveLength(0);
    // A real full world is the end of the line either way.
    const done = room('d', { draft: world(), full: world({ tier: 'full', model: 'marble-1.1' }) });
    expect(needsFull(done, 'marble')).toBe(false);
  });

  it('a room with no reconstruction at all is not an upgrade target', () => {
    const pending = room('p', { status: 'pending' });
    expect(needsFull(pending)).toBe(false);
    expect(upgradeTargets([pending], [])).toHaveLength(0);
  });

  it('reads the active full jobs as upgrades of rooms that already have a world', () => {
    const jobs = [job('j1', 'a', 'full', 'running'), job('j2', 'a', 'draft', 'running')];
    expect(upgradeJobs([a], jobs).map((j) => j.id)).toEqual(['j1']);
  });
});

describe('the buyer always gets the best world', () => {
  const realDraft = world({ spzUrl: 'https://cdn/x.spz', panoUrl: 'https://cdn/p.png' });
  const mockFull = world({ provider: 'mock', tier: 'full', model: 'mock-full' });
  const realFull = world({ tier: 'full', model: 'marble-1.1', spzUrl: 'https://cdn/f.spz' });

  it('prefers full over draft', () => {
    expect(pickWorld(world(), realFull)).toBe(realFull);
    expect(pickWorld(world(), undefined)?.tier).toBe('draft');
    expect(pickWorld(undefined, realFull)).toBe(realFull);
    expect(pickWorld(undefined, undefined)).toBeUndefined();
  });

  it('never lets a simulated full displace a real capture', () => {
    expect(pickWorld(realDraft, mockFull)).toBe(realDraft);
    expect(fullIsShadowed(room('a', { draft: realDraft, full: mockFull }))).toBe(true);
    expect(fullIsShadowed(room('b', { draft: world(), full: mockFull }))).toBe(false);
  });

  it('a simulated full still wins over a simulated draft', () => {
    const mockDraft = world({ provider: 'mock', model: 'mock-draft' });
    expect(pickWorld(mockDraft, mockFull)).toBe(mockFull);
  });
});

describe('tier chips', () => {
  it('reads "full · marble-1.1 · 1,580 credits"', () => {
    expect(worldChip(world({ tier: 'full', model: 'marble-1.1', credits: 1580 })).text).toBe('full · marble-1.1 · 1,580 credits');
  });

  it('reads "draft · 35 s · 230 credits"', () => {
    expect(worldChip(world({ seconds: 35, credits: 230 })).text).toBe('draft · 35 s · 230 credits');
  });

  it('names the tier of a simulated world in one segment, so the compact chip keeps it', () => {
    // The compact chip in the room rail shows only the text before the first "·"; "simulated"
    // alone could not tell a seller whether a landed upgrade is the world on screen.
    expect(worldChip(world({ provider: 'mock', model: 'mock-draft' })).text).toBe('simulated draft');
    expect(worldChip(world({ provider: 'mock', tier: 'full', model: 'mock-full' })).text).toBe('simulated full');
    expect(worldChip(world({ provider: 'mock', tier: 'full', model: 'mock-full' })).text.split(' · ')[0]).toBe('simulated full');
  });

  it('describes a room by the world the buyer is shown', () => {
    const r = room('a', { draft: world({ spzUrl: 'https://cdn/x.spz', seconds: 35, credits: 230 }), full: world({ provider: 'mock', tier: 'full', model: 'mock-full' }) });
    expect(roomChip(r).text).toBe('draft · 35 s · 230 credits');
  });

  it('says when there is nothing yet', () => {
    expect(worldChip(undefined).text).toBe('not generated');
    expect(worldChip(undefined, { generating: true }).text).toBe('generating');
  });
});

describe('a tour is as good as the worlds its rooms show', () => {
  const realDraft = world({ spzUrl: 'https://cdn/x.spz' });
  const realFull = world({ tier: 'full', model: 'marble-1.1' });
  const mockFull = world({ provider: 'mock', tier: 'full', model: 'mock-full' });

  it('is full only when every room is showing a full world', () => {
    expect(tourQuality([room('a', { draft: realDraft }), room('b', { full: realFull })])).toBe('draft');
    expect(tourQuality([room('a', { full: realFull }), room('b', { draft: world(), full: realFull })])).toBe('full');
  });

  it('does not count a simulated full the buyer is not being shown', () => {
    expect(tourQuality([room('a', { draft: realDraft, full: mockFull })])).toBe('draft');
    expect(shownTier(room('a', { draft: realDraft, full: mockFull }))).toBe('draft');
  });

  it('an empty tour is a draft, never a full-quality claim', () => {
    expect(tourQuality([])).toBe('draft');
  });
});

describe('upgrade line', () => {
  it('is the deep-research line: elapsed and what is left', () => {
    expect(upgradeLine(372, 240)).toBe('Upgrading to full quality · 06:12 elapsed · about 4 minutes');
    expect(upgradeLine(0, 600, true)).toBe('Upgrading to full quality · 00:00 elapsed · queued');
    expect(upgradeLine(605, 0)).toBe('Upgrading to full quality · 10:05 elapsed · any moment now');
  });
});
