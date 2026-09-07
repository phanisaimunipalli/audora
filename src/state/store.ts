import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { AnchorSpec, PlacedPiece, RawGeometry, RoomType } from '@/engine/types';
import { anchorAssumed, anchorFromCeiling, anchorFromMarble, applyScale, clampFloorOffset } from '@/engine/anchor';
import type { StagingStyle } from '@/engine/autostage';
import { uid, shortId } from '@/lib/ids';
import { mockRawGeometry } from '@/services/mockWorld';
import { pickWorld } from './publish';
import type { AnalyticsEvent, AnalyticsType, Job, MyStuffItem, PhotoRecord, PlanDimensions, ProviderStatus, Room, RoomWorld, Settings, Tier, Toast, Tour, TourSite } from './types';

export interface CreateTourInput {
  title?: string;
  address: string;
  listingUrl?: string;
  listingSource?: string;
  price?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  summary?: string;
  quality?: Tier;
  notify?: { browser: boolean; email: string };
  /** Where it is on the planet, from the Site step. */
  site?: TourSite;
}

export interface AddRoomInput {
  name: string;
  type: RoomType;
  photo?: PhotoRecord;
  /** Extra angles of the same room; the primary `photo` is not repeated here. */
  photos?: PhotoRecord[];
  /** What the listing floor plan printed for this room (metres, ±5 cm). */
  planDims?: PlanDimensions;
  raw?: RawGeometry;
  anchor?: AnchorSpec;
}

interface AudoraState {
  version: number;
  /** Bumped by resetAll: a whole-state replacement that other tabs must adopt rather than merge. */
  generation: number;
  /** Ids removed on purpose (tours, rooms, jobs, My Stuff) with the time of removal, so a stale tab cannot resurrect them. */
  deleted: Record<string, number>;
  tours: Record<string, Tour>;
  rooms: Record<string, Room>;
  jobs: Record<string, Job>;
  myStuff: MyStuffItem[];
  events: AnalyticsEvent[];
  settings: Settings;
  providers: ProviderStatus;
  visitorId: string;
  seeded: boolean;
  /** Bumped when the demo seed changes so existing browsers refresh it. */
  seedVersion: number;
  setSeedVersion: (v: number) => void;

  createTour: (input: CreateTourInput) => Tour;
  updateTour: (id: string, patch: Partial<Tour>) => void;
  deleteTour: (id: string) => void;
  publishTour: (id: string, published?: boolean) => void;
  /** Set (or clear) the tour's geocoded site. Additive: everything else about the tour is left alone. */
  setSite: (tourId: string, site: TourSite | undefined) => void;
  /** Park the time-of-day control on an instant so the tour reopens on it. Debounce the caller. */
  setPreviewTime: (tourId: string, ms: number) => void;
  /** Per-room override of the building heading; `undefined` hands the room back to the building. */
  setRoomHeading: (roomId: string, headingDeg: number | undefined) => void;

  addRoom: (tourId: string, input: AddRoomInput) => Room;
  updateRoom: (id: string, patch: Partial<Room>) => void;
  removeRoom: (id: string) => void;
  setAnchor: (roomId: string, anchor: AnchorSpec) => void;
  setRaw: (roomId: string, raw: RawGeometry) => void;
  setStaging: (roomId: string, pieces: PlacedPiece[], style?: StagingStyle) => void;
  /** Nudge the reconstruction up or down (metres) until its floor meets Audora's floor. */
  setFloorOffset: (roomId: string, metres: number) => void;
  attachWorld: (roomId: string, world: RoomWorld) => void;

  enqueueJob: (job: Omit<Job, 'id' | 'createdAt' | 'status' | 'progress' | 'step' | 'seen'> & Partial<Job>) => Job;
  updateJob: (id: string, patch: Partial<Job>) => void;
  markJobsSeen: (ids?: string[]) => void;

  addMyStuff: (item: Omit<MyStuffItem, 'id' | 'createdAt'>) => MyStuffItem;
  updateMyStuff: (id: string, patch: Partial<MyStuffItem>) => void;
  removeMyStuff: (id: string) => void;

  track: (tourId: string, type: AnalyticsType, extra?: { roomId?: string; item?: string }) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setProviders: (status: ProviderStatus) => void;
  setSeeded: () => void;
  resetAll: () => void;
}

/** The slice of the state that is written to localStorage. */
interface Persisted {
  version: number;
  generation: number;
  deleted: Record<string, number>;
  tours: Record<string, Tour>;
  rooms: Record<string, Room>;
  jobs: Record<string, Job>;
  myStuff: MyStuffItem[];
  events: AnalyticsEvent[];
  settings: Settings;
  visitorId: string;
  seeded: boolean;
  seedVersion: number;
}

const DEFAULT_SETTINGS: Settings = {
  preferMock: false,
  mockDraftSeconds: 22,
  mockFullSeconds: 90,
  sound: true,
  agentName: 'Priya Natarajan',
  brandColor: '#e8734a',
};

export const STORE_KEY = 'audora-v1';
const MAX_EVENTS = 2000;
const TOMBSTONE_TTL = 7 * 86400e3;

const now = () => Date.now();

/* ------------------------------------------------------------------ cross-tab merge
 *
 * Every tab holds its own copy of the store and zustand writes the whole slice on every set(), so
 * two open tabs used to overwrite each other: the last writer won and a tour created in one tab could
 * vanish when the other tab ticked. Three things fix that:
 *   1. writes merge with what is already in storage (per record, newest updatedAt wins; deletions are
 *      tombstoned; events and My Stuff are unioned by id),
 *   2. every tab rehydrates when another tab writes (the `storage` event), keeping object identity for
 *      records that did not change so React trees and the editor's undo stack stay put,
 *   3. only one tab runs the job runner at a time (see state/jobs.ts).
 */

function pruneTombstones(d: Record<string, number> | undefined, at = now()): Record<string, number> {
  const out: Record<string, number> = {};
  if (!d) return out;
  for (const [id, t] of Object.entries(d)) if (at - t < TOMBSTONE_TTL) out[id] = t;
  return out;
}

function mergeRecords<T extends { updatedAt?: number }>(a: Record<string, T> | undefined, b: Record<string, T> | undefined, deleted: Record<string, number>): Record<string, T> {
  const out: Record<string, T> = {};
  const ids = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const id of ids) {
    if (deleted[id]) continue;
    const x = a?.[id];
    const y = b?.[id];
    if (!x) out[id] = y as T;
    else if (!y) out[id] = x;
    else out[id] = (y.updatedAt ?? 0) >= (x.updatedAt ?? 0) ? y : x;
  }
  return out;
}

function mergeEvents(a: AnalyticsEvent[] | undefined, b: AnalyticsEvent[] | undefined): AnalyticsEvent[] {
  const base = a ?? [];
  const extra = b ?? [];
  if (base === extra || !extra.length) return base.slice(-MAX_EVENTS);
  if (!base.length) return extra.slice(-MAX_EVENTS);
  const seen = new Set(base.map((e) => e.id));
  const out = [...base];
  for (const e of extra) if (!seen.has(e.id)) out.push(e);
  out.sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return out.slice(-MAX_EVENTS);
}

function mergeMyStuff(a: MyStuffItem[] | undefined, b: MyStuffItem[] | undefined, deleted: Record<string, number>): MyStuffItem[] {
  const byId = new Map<string, MyStuffItem>();
  for (const it of a ?? []) if (!deleted[it.id]) byId.set(it.id, it);
  for (const it of b ?? []) if (!deleted[it.id]) byId.set(it.id, it); // incoming wins: edits happen in one tab at a time
  return [...byId.values()].sort((x, y) => x.createdAt - y.createdAt);
}

/** Merge what another tab left in storage (`theirs`) with what this tab is about to write (`mine`). */
export function mergePersisted(theirs: Partial<Persisted>, mine: Persisted): Persisted {
  const gt = theirs.generation ?? 0;
  const gm = mine.generation ?? 0;
  if (gt !== gm) return gt > gm ? { ...mine, ...(theirs as Persisted) } : mine;
  const deleted = pruneTombstones({ ...(theirs.deleted ?? {}), ...(mine.deleted ?? {}) });
  return {
    version: Math.max(theirs.version ?? 0, mine.version),
    generation: gm,
    deleted,
    tours: mergeRecords(theirs.tours, mine.tours, deleted),
    rooms: mergeRecords(theirs.rooms, mine.rooms, deleted),
    jobs: mergeRecords(theirs.jobs, mine.jobs, deleted),
    myStuff: mergeMyStuff(theirs.myStuff, mine.myStuff, deleted),
    events: mergeEvents(theirs.events, mine.events),
    settings: mine.settings,
    visitorId: theirs.visitorId ?? mine.visitorId,
    seeded: Boolean(theirs.seeded || mine.seeded),
    seedVersion: Math.max(theirs.seedVersion ?? 0, mine.seedVersion ?? 0),
  };
}

/* identity-preserving adoption on rehydrate: unchanged records keep their in-memory object */

const sameJob = (a: Job, b: Job) => a.updatedAt != null && a.updatedAt === b.updatedAt && a.status === b.status && a.progress === b.progress && a.seen === b.seen;
const sameStamp = (a: { updatedAt?: number }, b: { updatedAt?: number }) => a.updatedAt != null && a.updatedAt === b.updatedAt;

function adoptRecords<T>(next: Record<string, T> | undefined, cur: Record<string, T>, same: (a: T, b: T) => boolean): Record<string, T> {
  const n = next ?? {};
  const keys = Object.keys(n);
  if (keys.length === Object.keys(cur).length && keys.every((id) => cur[id] && same(cur[id], n[id]))) return cur;
  const out: Record<string, T> = {};
  for (const id of keys) out[id] = cur[id] && same(cur[id], n[id]) ? cur[id] : n[id];
  return out;
}

function adoptEvents(next: AnalyticsEvent[] | undefined, cur: AnalyticsEvent[]): AnalyticsEvent[] {
  const n = next ?? [];
  if (n.length === cur.length && (n.length === 0 || (n[0].id === cur[0].id && n[n.length - 1].id === cur[cur.length - 1].id))) return cur;
  return n;
}

function adoptJson<T>(next: T | undefined, cur: T): T {
  if (next === undefined) return cur;
  return JSON.stringify(next) === JSON.stringify(cur) ? cur : next;
}

/* the storage itself: localStorage with merge-on-write */

let lastSeen: string | null = null;
let resyncQueued = false;

function queueResync() {
  if (resyncQueued) return;
  resyncQueued = true;
  queueMicrotask(() => {
    resyncQueued = false;
    void useAudora.persist.rehydrate();
  });
}

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

const mergingStorage: PersistStorage<Persisted> = {
  getItem: (name) => {
    if (!canUseStorage()) return null;
    const raw = localStorage.getItem(name);
    lastSeen = raw;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StorageValue<Persisted>;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (!canUseStorage()) return;
    const existing = localStorage.getItem(name);
    let toWrite = value;
    let merged = false;
    if (existing && existing !== lastSeen) {
      // Another tab wrote since we last looked: merge instead of clobbering it.
      try {
        const theirs = JSON.parse(existing) as StorageValue<Persisted>;
        toWrite = { ...value, state: mergePersisted(theirs.state ?? {}, value.state) };
        merged = true;
      } catch {
        /* unreadable: our copy wins */
      }
    }
    const str = JSON.stringify(toWrite);
    if (str !== existing) {
      try {
        localStorage.setItem(name, str);
      } catch (e) {
        console.warn('[audora] could not persist state', e);
        return;
      }
    }
    lastSeen = str;
    if (merged) queueResync();
  },
  removeItem: (name) => {
    if (!canUseStorage()) return;
    localStorage.removeItem(name);
    lastSeen = null;
  },
};

export const useAudora = create<AudoraState>()(
  persist(
    (set, get) => ({
      version: 1,
      generation: 0,
      deleted: {},
      tours: {},
      rooms: {},
      jobs: {},
      myStuff: [],
      events: [],
      settings: DEFAULT_SETTINGS,
      providers: { nebius: false, marble: false, checkedAt: 0 },
      visitorId: uid('v'),
      seeded: false,
      seedVersion: 0,
      setSeedVersion: (seedVersion) => set({ seedVersion }),

      createTour: (input) => {
        const t = now();
        const tour: Tour = {
          id: uid('tour'),
          shareId: shortId(7),
          title: input.title || input.address,
          address: input.address,
          listingUrl: input.listingUrl,
          listingSource: input.listingSource,
          price: input.price,
          beds: input.beds,
          baths: input.baths,
          sqft: input.sqft,
          summary: input.summary,
          site: input.site,
          roomIds: [],
          quality: input.quality ?? 'draft',
          createdAt: t,
          updatedAt: t,
          published: false,
          notify: input.notify ?? { browser: true, email: '' },
          agent: { name: get().settings.agentName, brandColor: get().settings.brandColor },
        };
        set((s) => ({ tours: { ...s.tours, [tour.id]: tour } }));
        return tour;
      },
      updateTour: (id, patch) =>
        set((s) => (s.tours[id] ? { tours: { ...s.tours, [id]: { ...s.tours[id], ...patch, updatedAt: now() } } } : {})),
      deleteTour: (id) =>
        set((s) => {
          const tours = { ...s.tours };
          const rooms = { ...s.rooms };
          const jobs = { ...s.jobs };
          const deleted = { ...s.deleted };
          const t = now();
          const tour = tours[id];
          if (!tour) return {};
          tour.roomIds.forEach((r) => {
            delete rooms[r];
            deleted[r] = t;
          });
          Object.values(jobs).forEach((j) => {
            if (j.tourId !== id) return;
            delete jobs[j.id];
            deleted[j.id] = t;
          });
          delete tours[id];
          deleted[id] = t;
          return { tours, rooms, jobs, deleted };
        }),
      publishTour: (id, published = true) =>
        set((s) => (s.tours[id] ? { tours: { ...s.tours, [id]: { ...s.tours[id], published, publishedAt: published ? now() : s.tours[id].publishedAt, updatedAt: now() } } } : {})),
      setSite: (tourId, site) =>
        set((s) => (s.tours[tourId] ? { tours: { ...s.tours, [tourId]: { ...s.tours[tourId], site, updatedAt: now() } } } : {})),
      setPreviewTime: (tourId, ms) =>
        set((s) => {
          const tour = s.tours[tourId];
          if (!tour?.site || tour.site.previewTime === ms) return {};
          return { tours: { ...s.tours, [tourId]: { ...tour, site: { ...tour.site, previewTime: ms }, updatedAt: now() } } };
        }),
      setRoomHeading: (roomId, headingDeg) =>
        set((s) => {
          const room = s.rooms[roomId];
          if (!room) return {};
          const next = headingDeg == null || !Number.isFinite(headingDeg) ? undefined : ((headingDeg % 360) + 360) % 360;
          if ((room.northWallHeading ?? undefined) === next) return {};
          const patched = { ...room, northWallHeading: next, updatedAt: now() };
          if (next === undefined) delete patched.northWallHeading;
          return { rooms: { ...s.rooms, [roomId]: patched } };
        }),

      addRoom: (tourId, input) => {
        const t = now();
        const tour = get().tours[tourId];
        const raw = input.raw ?? mockRawGeometry(`${tourId}:${input.name}:${input.photo?.dataUrl.slice(0, 2000) ?? ''}`, input.type);
        const anchor = input.anchor ?? anchorAssumed(raw);
        const room: Room = {
          id: uid('room'),
          tourId,
          name: input.name,
          type: input.type,
          order: tour ? tour.roomIds.length : 0,
          photo: input.photo,
          photos: input.photos?.length ? input.photos : undefined,
          planDims: input.planDims,
          raw,
          anchor,
          geometry: applyScale(raw, anchor.metresPerUnit),
          staging: [],
          stagingStyle: 'warm',
          status: 'pending',
          createdAt: t,
          updatedAt: t,
        };
        set((s) => ({
          rooms: { ...s.rooms, [room.id]: room },
          tours: s.tours[tourId] ? { ...s.tours, [tourId]: { ...s.tours[tourId], roomIds: [...s.tours[tourId].roomIds, room.id], updatedAt: t } } : s.tours,
        }));
        return room;
      },
      updateRoom: (id, patch) =>
        set((s) => (s.rooms[id] ? { rooms: { ...s.rooms, [id]: { ...s.rooms[id], ...patch, updatedAt: now() } } } : {})),
      removeRoom: (id) =>
        set((s) => {
          const room = s.rooms[id];
          if (!room) return {};
          const rooms = { ...s.rooms };
          delete rooms[id];
          const tour = s.tours[room.tourId];
          const t = now();
          return {
            rooms,
            deleted: { ...s.deleted, [id]: t },
            tours: tour ? { ...s.tours, [tour.id]: { ...tour, roomIds: tour.roomIds.filter((r) => r !== id), updatedAt: t } } : s.tours,
          };
        }),
      setAnchor: (roomId, anchor) =>
        set((s) => {
          const room = s.rooms[roomId];
          if (!room) return {};
          return { rooms: { ...s.rooms, [roomId]: { ...room, anchor, geometry: applyScale(room.raw, anchor.metresPerUnit), updatedAt: now() } } };
        }),
      setRaw: (roomId, raw) =>
        set((s) => {
          const room = s.rooms[roomId];
          if (!room) return {};
          // Keep the same reference measurement; recompute metres-per-unit against the new raw units.
          const units = room.anchor.method === 'door' || room.anchor.method === 'assumed' ? raw.doorHeightUnits : room.anchor.method === 'outlet' ? raw.outletHeightUnits : room.anchor.referenceUnits;
          const metresPerUnit = room.anchor.referenceMetres / units;
          const anchor = { ...room.anchor, referenceUnits: units, metresPerUnit };
          return { rooms: { ...s.rooms, [roomId]: { ...room, raw, anchor, geometry: applyScale(raw, metresPerUnit), updatedAt: now() } } };
        }),
      setStaging: (roomId, pieces, style) =>
        set((s) => (s.rooms[roomId] ? { rooms: { ...s.rooms, [roomId]: { ...s.rooms[roomId], staging: pieces, stagingStyle: style ?? s.rooms[roomId].stagingStyle, updatedAt: now() } } } : {})),
      setFloorOffset: (roomId, metres) =>
        set((s) => {
          const room = s.rooms[roomId];
          if (!room) return {};
          const floorOffset = clampFloorOffset(metres);
          if ((room.floorOffset ?? 0) === floorOffset) return {};
          return { rooms: { ...s.rooms, [roomId]: { ...room, floorOffset, updatedAt: now() } } };
        }),
      attachWorld: (roomId, world) =>
        set((s) => {
          const room = s.rooms[roomId];
          if (!room) return {};
          const patch: Partial<Room> = world.tier === 'draft' ? { draft: world } : { full: world };
          // A real world (with collider bounds) redefines the raw proportions; a mock keeps the photo estimate.
          const first = !room.draft && !room.full;
          const takeRaw = world.provider === 'marble' ? Boolean(world.bounds) : first;
          const raw = takeRaw ? world.raw : room.raw;
          let anchor = room.anchor;
          if (takeRaw) {
            const a = room.anchor;
            if (a.method === 'wall' || a.method === 'floorplan') {
              const units = a.axis === 'depth' ? raw.depth : raw.width;
              anchor = { ...a, referenceUnits: units, metresPerUnit: a.referenceMetres / units };
            } else if (world.provider === 'marble' && world.metricScaleFactor) {
              // The model measured itself: quote its own ceiling height as the reference, so the
              // chip reads "model scale · ceiling 2.51 m · ±15 cm" rather than a bare uncertainty.
              anchor = anchorFromMarble(world.metricScaleFactor, raw.height);
            } else if (world.provider === 'marble' && (a.method === 'door' || a.method === 'outlet' || a.method === 'assumed')) {
              // Photo taps cannot be mapped onto the reconstruction's units yet; fall back to the ceiling assumption and keep the taps.
              anchor = { ...anchorFromCeiling(raw), taps: a.taps };
            } else {
              const units = a.method === 'outlet' ? raw.outletHeightUnits : a.method === 'ceiling' || a.method === 'marble' ? raw.height : raw.doorHeightUnits;
              anchor = { ...a, referenceUnits: units, metresPerUnit: a.referenceMetres / units };
            }
          }
          return {
            rooms: {
              ...s.rooms,
              [roomId]: { ...room, ...patch, raw, anchor, geometry: applyScale(raw, anchor.metresPerUnit), status: 'ready', updatedAt: now() },
            },
          };
        }),

      enqueueJob: (input) => {
        const t = now();
        const job: Job = {
          id: uid('job'),
          createdAt: t,
          updatedAt: t,
          status: 'queued',
          progress: 0,
          step: 'Queued',
          seen: false,
          ...input,
        } as Job;
        set((s) => {
          const room = s.rooms[job.roomId];
          // A room that already has a world stays `ready` while a better one is generated: the buyer
          // keeps walking the draft, the hub keeps its tabs, and only the job says "upgrading".
          const keepsWorld = Boolean(room && (room.draft || room.full));
          return {
            jobs: { ...s.jobs, [job.id]: job },
            rooms: room && !keepsWorld ? { ...s.rooms, [job.roomId]: { ...room, status: 'generating', updatedAt: t } } : s.rooms,
          };
        });
        return job;
      },
      updateJob: (id, patch) => set((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...patch, updatedAt: now() } } } : {})),
      markJobsSeen: (ids) =>
        set((s) => {
          const jobs = { ...s.jobs };
          const t = now();
          let changed = false;
          Object.values(jobs).forEach((j) => {
            if ((!ids || ids.includes(j.id)) && !j.seen) {
              jobs[j.id] = { ...j, seen: true, updatedAt: t };
              changed = true;
            }
          });
          return changed ? { jobs } : {};
        }),

      addMyStuff: (item) => {
        const it: MyStuffItem = { ...item, id: uid('stuff'), createdAt: now() };
        set((s) => ({ myStuff: [...s.myStuff, it] }));
        return it;
      },
      updateMyStuff: (id, patch) => set((s) => ({ myStuff: s.myStuff.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      removeMyStuff: (id) => set((s) => ({ myStuff: s.myStuff.filter((m) => m.id !== id), deleted: { ...s.deleted, [id]: now() } })),

      track: (tourId, type, extra) =>
        set((s) => ({
          events: [...s.events.slice(-(MAX_EVENTS - 1)), { id: uid('ev'), tourId, type, roomId: extra?.roomId, item: extra?.item, at: now(), visitor: s.visitorId }],
        })),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setProviders: (status) => set({ providers: status }),
      setSeeded: () => set({ seeded: true }),
      resetAll: () => set((s) => ({ tours: {}, rooms: {}, jobs: {}, events: [], seeded: false, deleted: {}, generation: (s.generation ?? 0) + 1 })),
    }),
    {
      name: STORE_KEY,
      storage: mergingStorage,
      merge: (persisted, current) => {
        const p = (persisted as Partial<Persisted>) || {};
        const gp = p.generation ?? 0;
        const gc = current.generation ?? 0;
        if (Object.keys(p).length === 0) return current;
        if (gp < gc) return current; // our reset has not reached storage yet (cannot normally happen: writes are synchronous)
        const adopt = gp === gc;
        return {
          ...current,
          version: p.version ?? current.version,
          generation: gp,
          deleted: pruneTombstones(p.deleted),
          tours: adopt ? adoptRecords(p.tours, current.tours, sameStamp) : (p.tours ?? {}),
          rooms: adopt ? adoptRecords(p.rooms, current.rooms, sameStamp) : (p.rooms ?? {}),
          jobs: adopt ? adoptRecords(p.jobs, current.jobs, sameJob) : (p.jobs ?? {}),
          myStuff: adopt ? adoptJson(p.myStuff, current.myStuff) : (p.myStuff ?? []),
          events: adopt ? adoptEvents(p.events, current.events) : (p.events ?? []),
          settings: adoptJson({ ...DEFAULT_SETTINGS, ...(p.settings || {}) }, current.settings),
          visitorId: p.visitorId ?? current.visitorId,
          seeded: p.seeded ?? current.seeded,
          seedVersion: p.seedVersion ?? current.seedVersion,
        };
      },
      partialize: (s): Persisted => ({
        version: s.version,
        generation: s.generation,
        deleted: s.deleted,
        tours: s.tours,
        rooms: s.rooms,
        jobs: s.jobs,
        myStuff: s.myStuff,
        events: s.events,
        settings: s.settings,
        visitorId: s.visitorId,
        seeded: s.seeded,
        seedVersion: s.seedVersion,
      }),
    },
  ),
);

/* Another tab wrote: adopt its state. Records this tab already has (same updatedAt) keep their identity. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage) return;
    if (e.key !== null && e.key !== STORE_KEY) return;
    if (e.key === STORE_KEY && e.newValue === lastSeen) return;
    void useAudora.persist.rehydrate();
  });
}

/* ---------- selectors ---------- */

export const selectTour = (id: string | undefined) => (s: AudoraState) => (id ? s.tours[id] : undefined);
export const selectRoom = (id: string | undefined) => (s: AudoraState) => (id ? s.rooms[id] : undefined);
export const selectTourRooms = (tourId: string | undefined) => (s: AudoraState) => {
  const t = tourId ? s.tours[tourId] : undefined;
  return t ? t.roomIds.map((r) => s.rooms[r]).filter(Boolean).sort((a, b) => a.order - b.order) : [];
};
export const selectTourByShare = (shareId: string | undefined) => (s: AudoraState) =>
  shareId ? Object.values(s.tours).find((t) => t.shareId === shareId) : undefined;
export const selectTourJobs = (tourId: string | undefined) => (s: AudoraState) =>
  Object.values(s.jobs).filter((j) => j.tourId === tourId).sort((a, b) => a.createdAt - b.createdAt);
export const selectActiveJobs = (s: AudoraState) => Object.values(s.jobs).filter((j) => j.status === 'queued' || j.status === 'running');
export const selectUnseenDone = (s: AudoraState) => Object.values(s.jobs).filter((j) => j.status === 'done' && !j.seen);
export const selectTourEvents = (tourId: string | undefined) => (s: AudoraState) => s.events.filter((e) => e.tourId === tourId);

/* Array-returning selectors MUST be read through these shallow-compared hooks (or useShallow),
   otherwise React sees a new array every render and loops. */
export const useTourRooms = (tourId: string | undefined) => useAudora(useShallow(selectTourRooms(tourId)));
export const useTourJobs = (tourId: string | undefined) => useAudora(useShallow(selectTourJobs(tourId)));
export const useActiveJobs = () => useAudora(useShallow(selectActiveJobs));
export const useUnseenDone = () => useAudora(useShallow(selectUnseenDone));
export const useTourEvents = (tourId: string | undefined) => useAudora(useShallow(selectTourEvents(tourId)));
export const useAllTours = () => useAudora(useShallow((s: AudoraState) => Object.values(s.tours).sort((a, b) => b.updatedAt - a.updatedAt)));
export const useAllJobs = () => useAudora(useShallow((s: AudoraState) => Object.values(s.jobs).sort((a, b) => b.createdAt - a.createdAt)));
export const useMyStuff = () => useAudora((s) => s.myStuff);

/**
 * Best available world for a room: full when it exists, else draft — with the one exception in
 * `pickWorld`, that a simulated full never displaces a real capture. The buyer always gets the
 * most realistic world the room has.
 */
export function bestWorld(room: Room | undefined): RoomWorld | undefined {
  return pickWorld(room?.draft, room?.full);
}

/* ---------- transient UI store (not persisted) ---------- */

interface UiState {
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id' | 'createdAt'>) => string;
  dismissToast: (id: string) => void;
}

/** Two toasts that say exactly the same thing are one piece of news; the second is a bug in disguise. */
const sameToast = (a: Toast, b: Omit<Toast, 'id' | 'createdAt'>) => a.kind === b.kind && a.title === b.title && a.body === b.body;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  pushToast: (t) => {
    const dup = get().toasts.find((x) => sameToast(x, t));
    if (dup) return dup.id;
    const id = uid('toast');
    set((s) => ({ toasts: [...s.toasts, { ...t, id, createdAt: Date.now() }] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (t: Omit<Toast, 'id' | 'createdAt'>) => useUi.getState().pushToast(t);
