import type { AnalyticsEvent, Room } from '@/state/types';

export interface ItemStat {
  /** Normalised grouping key, e.g. "3-seat sofa". */
  item: string;
  /** What to show: title-cased from `item`. */
  label: string;
  tests: number;
  fits: number;
  nofits: number;
}

export interface RoomStat {
  roomId: string;
  name: string;
  tests: number;
  fits: number;
  nofits: number;
  walked: number;
  /** Measurements a renter took in this room. */
  measures: number;
}

export interface Summary {
  visitors: number;
  walked: number;
  tested: number;
  failures: number;
  shares: number;
  measures: number;
  /** Most-tested pieces, descending. */
  items: ItemStat[];
  /** Per room, in room order. */
  rooms: RoomStat[];
  /** Visits per bin over the window, oldest first. */
  series: number[];
  /** Bin labels aligned with `series` (only the first bin of each day carries a label). */
  labels: string[];
  windowDays: number;
  lastEventAt?: number;
}

const DAY = 86400e3;

/**
 * Renters type their furniture, so the same piece arrives as "Sofa", "sofa " and "sofas". Group on a
 * normalised key (trimmed, lower case, collapsed spaces, naive singular) and show it title-cased.
 */
export function itemKey(name: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!n) return 'unnamed piece';
  return n
    .split(' ')
    .map((w, i, all) => (i === all.length - 1 ? singular(w) : w))
    .join(' ');
}

function singular(w: string): string {
  if (w.length < 4 || /(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ch|sh|x|z|s)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

const MINOR = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/** Title case for display: "3-seat sofa" → "3-Seat Sofa", "dining table for 6" → "Dining Table for 6". */
export function itemLabel(key: string): string {
  return key
    .split(' ')
    .map((w, i) => (i > 0 && MINOR.has(w) ? w : w.replace(/^[a-z]|-[a-z]/g, (c) => c.toUpperCase())))
    .join(' ');
}

function unique(events: AnalyticsEvent[], type: AnalyticsEvent['type']): number {
  const set = new Set<string>();
  for (const e of events) if (e.type === type) set.add(e.visitor);
  return set.size;
}

/** Roll a unit's events into what a leasing team wants to know. Pure, so the dashboard can call it for every unit. */
export function summarize(events: AnalyticsEvent[], rooms: Room[], opts?: { days?: number; binsPerDay?: number; now?: number }): Summary {
  const days = opts?.days ?? 3;
  const binsPerDay = opts?.binsPerDay ?? 4;
  const now = opts?.now ?? Date.now();

  const byItem = new Map<string, ItemStat>();
  const byRoom = new Map<string, RoomStat>();
  for (const r of rooms) byRoom.set(r.id, { roomId: r.id, name: r.name, tests: 0, fits: 0, nofits: 0, walked: 0, measures: 0 });
  const walkedByRoom = new Map<string, Set<string>>();

  for (const e of events) {
    if (e.type === 'test' || e.type === 'fit' || e.type === 'nofit') {
      const key = itemKey(e.item || 'unnamed piece');
      const it = byItem.get(key) || { item: key, label: itemLabel(key), tests: 0, fits: 0, nofits: 0 };
      if (e.type === 'test') it.tests++;
      else if (e.type === 'fit') it.fits++;
      else it.nofits++;
      byItem.set(key, it);
      if (e.roomId) {
        const rs = byRoom.get(e.roomId) || { roomId: e.roomId, name: 'Removed room', tests: 0, fits: 0, nofits: 0, walked: 0, measures: 0 };
        if (e.type === 'test') rs.tests++;
        else if (e.type === 'fit') rs.fits++;
        else rs.nofits++;
        byRoom.set(e.roomId, rs);
      }
    }
    if (e.type === 'walk' && e.roomId) {
      const s = walkedByRoom.get(e.roomId) || new Set<string>();
      s.add(e.visitor);
      walkedByRoom.set(e.roomId, s);
    }
    if (e.type === 'measure' && e.roomId) {
      const rs = byRoom.get(e.roomId) || { roomId: e.roomId, name: 'Removed room', tests: 0, fits: 0, nofits: 0, walked: 0, measures: 0 };
      rs.measures++;
      byRoom.set(e.roomId, rs);
    }
  }
  for (const [id, s] of walkedByRoom) {
    const rs = byRoom.get(id);
    if (rs) rs.walked = s.size;
  }

  const bins = days * binsPerDay;
  const binMs = DAY / binsPerDay;
  const start = now - days * DAY;
  const series = new Array<number>(bins).fill(0);
  for (const e of events) {
    if (e.type !== 'visit') continue;
    const i = Math.floor((e.at - start) / binMs);
    if (i >= 0 && i < bins) series[i]++;
  }
  const labels = series.map((_, i) => {
    if (i % binsPerDay !== 0) return '';
    const d = new Date(start + i * binMs);
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  });

  let lastEventAt: number | undefined;
  for (const e of events) if (!lastEventAt || e.at > lastEventAt) lastEventAt = e.at;

  return {
    visitors: unique(events, 'visit'),
    walked: unique(events, 'walk'),
    tested: unique(events, 'test'),
    failures: events.filter((e) => e.type === 'nofit').length,
    shares: events.filter((e) => e.type === 'share').length,
    measures: events.filter((e) => e.type === 'measure').length,
    items: [...byItem.values()].sort((a, b) => b.tests - a.tests || b.nofits - a.nofits),
    rooms: [...byRoom.values()],
    series,
    labels,
    windowDays: days,
    lastEventAt,
  };
}

/** Merge item stats from several units into one ranking. */
export function mergeItems(lists: ItemStat[][]): ItemStat[] {
  const m = new Map<string, ItemStat>();
  for (const list of lists) {
    for (const it of list) {
      const cur = m.get(it.item) || { item: it.item, label: it.label ?? itemLabel(it.item), tests: 0, fits: 0, nofits: 0 };
      cur.tests += it.tests;
      cur.fits += it.fits;
      cur.nofits += it.nofits;
      m.set(it.item, cur);
    }
  }
  return [...m.values()].sort((a, b) => b.tests - a.tests || b.nofits - a.nofits);
}

export function pctOf(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}
