/// <reference types="node" />
/**
 * In-memory doubles for the backend's two ports, shared by tests/pipeline.test.ts and
 * tests/routes.test.ts. Nothing here touches a network, a database or a provider.
 *
 * `FakeDb` implements the slice of `server/db.ts` the pipeline uses (`PipelineDb`) over plain
 * arrays, including the two things the pipeline actually leans on: the unique indexes from
 * supabase/migrations (`photos_unit_sha`, and `worlds_recipe` as 0003 scopes it) and the
 * `claim_jobs` function from 0002. `FakeStorage` is a Map of `<bucket>/<key>` to bytes. The clock is a mutable
 * object both share, because "time is an input" is the rule the worker's polling is built on and a
 * test has to be able to move it.
 *
 * This file is not a test (`tests/**\/*.test.ts` is the vitest include), it is what two of them import.
 */
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { Filters, SelectOptions } from '../../server/db';
import { uuidFromHash, type PipelineDb, type PipelineStorage, type Row } from '../../server/pipeline';

/* ---------- the clock ---------- */

export interface Clock {
  ms: number;
}

export const START = Date.parse('2026-09-08T09:00:00.000Z');

export function clock(ms: number = START): Clock {
  return { ms };
}

const iso = (ms: number) => new Date(ms).toISOString();

/* ---------- the database ---------- */

/** The unique indexes the pipeline relies on; null means "this row is not covered by the index". */
const UNIQUE: Record<string, (row: Row) => string | null> = {
  // create unique index photos_unit_sha on public.photos (unit_id, sha256)
  photos: (r) => `${String(r.unit_id)}|${String(r.sha256)}`,
  // create unique index worlds_recipe on public.worlds (org_id, recipe_hash) where status <> 'failed'
  // (0003_public_world_columns.sql: rule 5 holds inside an organisation, which owns the world.)
  worlds: (r) => (r.status === 'failed' ? null : `${String(r.org_id)}|${String(r.recipe_hash)}`),
  publications: (r) => String(r.unit_id),
};

/** What PostgREST hands back for a unique violation, in the shape `server/db.ts` would raise. */
function uniqueViolation(table: string): Error {
  return Object.assign(new Error(`duplicate key value violates a unique constraint on ${table}`), { code: '23505', status: 409, name: 'DbError' });
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** The filter operators `server/pipeline.ts` and `server/worker.ts` actually send. */
function matches(row: Row, filters: Filters | undefined): boolean {
  for (const [column, f] of Object.entries(filters ?? {})) {
    const v = row[column];
    if (f !== null && typeof f === 'object') {
      const { op, value } = f;
      if (op === 'in') {
        const list = (Array.isArray(value) ? value : [value]).map((x) => String(x));
        if (!list.includes(String(v))) return false;
      } else if (op === 'is') {
        if (value === null ? v != null : v !== value) return false;
      } else if (op === 'neq') {
        if (String(v) === String(value)) return false;
      } else if (op === 'eq') {
        if (String(v) !== String(value)) return false;
      } else if (op === 'lte') {
        if (compare(v, value) > 0) return false;
      } else if (op === 'gte') {
        if (compare(v, value) < 0) return false;
      } else if (op === 'lt') {
        if (compare(v, value) >= 0) return false;
      } else if (op === 'gt') {
        if (compare(v, value) <= 0) return false;
      } else {
        throw new Error(`FakeDb: unsupported operator ${op}`);
      }
    } else if (f === null) {
      if (v != null) return false;
    } else if (String(v) !== String(f)) {
      return false;
    }
  }
  return true;
}

function sortRows(rows: Row[], order: SelectOptions['order']): Row[] {
  if (!order) return rows;
  if (typeof order === 'string') throw new Error('FakeDb: raw order strings are not used by the pipeline');
  const specs = Array.isArray(order) ? order : [order];
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const d = compare(a[spec.column], b[spec.column]) * (spec.ascending === false ? -1 : 1);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/** Claim lease, mirroring supabase/migrations/0002_claim_jobs.sql. */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

export class FakeDb implements PipelineDb {
  readonly tables = new Map<string, Row[]>();
  readonly clock: Clock;
  private seq = 0;
  private lastRowTime = 0;

  constructor(c: Clock = clock()) {
    this.clock = c;
  }

  now(): number {
    return this.clock.ms;
  }

  /** The stored rows of a table, as copies. */
  rows<T = Row>(table: string): T[] {
    return clone(this.tables.get(table) ?? []) as T[];
  }

  /** One stored row, as a copy. */
  row<T = Row>(table: string, id: string): T | undefined {
    return clone((this.tables.get(table) ?? []).find((r) => r.id === id)) as T | undefined;
  }

  /** Put rows in without going through `insert` (fixtures that do not need defaults). */
  seed(table: string, rows: Row[]): void {
    const store = this.store(table);
    for (const r of rows) store.push(clone(r));
  }

  private store(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  private nextId(table: string): string {
    this.seq += 1;
    return uuidFromHash(createHash('sha256').update(`${table}:${this.seq}`).digest('hex'));
  }

  /** Strictly increasing, so `created_at` orders rows the way Postgres would. */
  private nextTime(): string {
    this.lastRowTime = Math.max(this.clock.ms, this.lastRowTime + 1);
    return iso(this.lastRowTime);
  }

  private checkUnique(table: string, row: Row): void {
    const key = UNIQUE[table];
    if (!key) return;
    const k = key(row);
    if (k === null) return;
    for (const other of this.store(table)) {
      if (other.id === row.id) continue;
      if (key(other) === k) throw uniqueViolation(table);
    }
  }

  async select<T = Row>(table: string, opts: SelectOptions & { single: true }): Promise<T | null>;
  async select<T = Row>(table: string, opts?: SelectOptions): Promise<T[]>;
  async select<T = Row>(table: string, opts: SelectOptions = {}): Promise<T[] | T | null> {
    let rows = this.store(table).filter((r) => matches(r, opts.filters));
    rows = sortRows(rows, opts.order);
    if (opts.offset != null) rows = rows.slice(opts.offset);
    if (opts.limit != null) rows = rows.slice(0, opts.limit);
    if (opts.single) {
      if (rows.length > 1) throw Object.assign(new Error(`${table}: expected one row, found ${rows.length}`), { status: 406 });
      return (clone(rows[0]) as T) ?? null;
    }
    return clone(rows) as T[];
  }

  async insert<T = Row>(table: string, rows: Row | Row[]): Promise<T[]> {
    const list = Array.isArray(rows) ? rows : [rows];
    const stored: Row[] = [];
    for (const raw of list) {
      const row: Row = { id: raw.id ?? this.nextId(table), created_at: this.nextTime(), ...clone(raw) };
      if (table === 'jobs') {
        row.status ??= 'queued';
        row.progress ??= 0;
        row.attempts ??= 0;
        row.run_after ??= iso(this.clock.ms);
      }
      if (table === 'units') row.status ??= 'draft';
      if (table === 'rooms') row.status ??= 'pending';
      if (table === 'worlds') row.status ??= 'queued';
      if (table === 'publications') row.published ??= false;
      this.checkUnique(table, row);
      this.store(table).push(row);
      stored.push(row);
    }
    return clone(stored) as T[];
  }

  async update<T = Row>(table: string, filters: Filters, patch: Row): Promise<T[]> {
    if (!Object.keys(filters).length) throw new Error(`FakeDb: refusing to update all of ${table}`);
    const hit = this.store(table).filter((r) => matches(r, filters));
    for (const row of hit) {
      Object.assign(row, clone(patch));
      this.checkUnique(table, row);
    }
    return clone(hit) as T[];
  }

  async del<T = Row>(table: string, filters: Filters): Promise<T[]> {
    if (!Object.keys(filters).length) throw new Error(`FakeDb: refusing to delete all of ${table}`);
    const rows = this.store(table);
    const gone = rows.filter((r) => matches(r, filters));
    this.tables.set(
      table,
      rows.filter((r) => !gone.includes(r)),
    );
    return clone(gone) as T[];
  }

  /** Only `claim_jobs` — the one function the server calls. */
  async rpc<T = unknown>(fn: string, args: Row = {}): Promise<T> {
    if (fn !== 'claim_jobs') throw new Error(`FakeDb: no function ${fn}`);
    const worker = String(args.worker ?? 'worker');
    const n = Math.max(0, Number(args.n ?? 0));
    const now = this.clock.ms;
    const due = this.store('jobs')
      .filter((j) => (j.status === 'queued' || j.status === 'running') && Date.parse(String(j.run_after)) <= now)
      .sort((a, b) => compare(a.run_after, b.run_after) || compare(a.created_at, b.created_at))
      .slice(0, n);
    for (const job of due) {
      const wasQueued = job.status === 'queued';
      job.status = 'running';
      job.locked_by = worker;
      job.locked_at = iso(now);
      job.started_at = job.started_at ?? iso(now);
      job.attempts = Number(job.attempts ?? 0) + (wasQueued ? 1 : 0);
      job.run_after = iso(now + CLAIM_LEASE_MS);
    }
    return clone(due) as T;
  }
}

/* ---------- storage ---------- */

const asBuffer = (bytes: Uint8Array | ArrayBuffer | string): Buffer =>
  typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes instanceof ArrayBuffer ? Buffer.from(new Uint8Array(bytes)) : Buffer.from(bytes);

export class FakeStorage implements PipelineStorage {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();

  async upload(bucket: string, path: string, bytes: Uint8Array | ArrayBuffer | string, contentType: string) {
    const key = `${bucket}/${path}`;
    this.objects.set(key, { bytes: asBuffer(bytes), contentType });
    return { key, path };
  }

  async download(bucket: string, path: string): Promise<Buffer> {
    const hit = this.objects.get(`${bucket}/${path}`);
    if (!hit) throw Object.assign(new Error(`FakeStorage: no object ${bucket}/${path}`), { status: 404 });
    return hit.bytes;
  }

  publicUrl(bucket: string, path: string): string {
    return `https://ref.supabase.co/storage/v1/object/public/${bucket}/${path}`;
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

/* ---------- a real image, built here ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/**
 * A real 8-bit RGB PNG, built by hand so the fixture needs neither sharp nor a file on disk: the
 * canonicalisation path in server/photos.ts decodes it whether sharp is installed or not.
 */
export function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      // A gradient, so two different sizes never deflate to the same bytes.
      raw[at] = (rgb[0] + x) & 0xff;
      raw[at + 1] = (rgb[1] + y) & 0xff;
      raw[at + 2] = rgb[2] & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The same image as the data URL the browser sends. */
export function pngDataUrl(width: number, height: number, rgb: [number, number, number]): string {
  return `data:image/png;base64,${png(width, height, rgb).toString('base64')}`;
}

/** A plausible scale anchor: the interior door, 2.03 m, tapped at 2.9 raw units. */
export const DOOR_ANCHOR = {
  method: 'door',
  referenceMetres: 2.03,
  referenceUnits: 2.9,
  metresPerUnit: 0.7,
  uncertaintyM: 0.04,
  label: 'interior door · 2.03m · ±4cm',
};
