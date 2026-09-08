/**
 * A tiny PostgREST client over fetch: the whole of Audora's database access on the server.
 *
 * No supabase-js, no express — plain `fetch` against `/rest/v1` with the service-role key, which
 * bypasses row-level security. That is deliberate: the server is the one party that may read and
 * write across organisations, and every route scopes its own queries with `org_id` (docs/BACKEND.md
 * §6). Nothing here ever runs in the browser.
 *
 * Conventions this module relies on:
 * - Filters are `{ column: value }` (equality; `null` becomes `is.null`) or
 *   `{ column: { op, value } }` with a PostgREST operator, and they are emitted in column order
 *   (sorted), so the same query always has the same URL — handy for logs and for the tests, which
 *   assert exact URLs.
 * - Every write asks for `Prefer: return=representation`, so callers get the rows PostgREST
 *   actually stored (server-side defaults, generated ids, timestamps) rather than what they sent.
 * - Errors are thrown as `DbError` carrying the HTTP status and PostgREST's own `message`, `code`,
 *   `details` and `hint`. A transport failure (Supabase unreachable) is a `DbError` too — status 502,
 *   `code: 'FETCH_FAILED'` — so a route has exactly one error type to map to a response.
 * - `fetch` is a constructor option so tests inject a fake and assert URLs, headers and bodies; the
 *   default is looked up on `globalThis` at call time, never captured at import.
 *
 * Compiles under tsconfig.node.json (bundler) and tsconfig.server.json (NodeNext): relative
 * imports inside server/ carry the `.js` extension.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DbConfig {
  /** `https://<ref>.supabase.co` or `http://127.0.0.1:54321`; a trailing slash is tolerated. */
  url: string;
  /** Service-role key: server only, never shipped. Sent as both `apikey` and the bearer token. */
  serviceKey: string;
  /** Anon key, when known: what `verifyUser` sends as `apikey` alongside a user's own token. */
  anonKey?: string;
  /** Injection point for tests. Defaults to the global fetch, resolved at call time. */
  fetch?: FetchLike;
}

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'like';

export type FilterValue = string | number | boolean | null | { op: FilterOp; value: unknown };

/** `{ column: value }` for equality (null → `is.null`), or `{ column: { op, value } }`. */
export type Filters = Record<string, FilterValue>;

export interface OrderSpec {
  column: string;
  /** Default ascending, as PostgREST's own default. */
  ascending?: boolean;
  nulls?: 'first' | 'last';
}

export interface SelectOptions {
  filters?: Filters;
  /** PostgREST `select=` list, e.g. `"id,name,rooms(*)"`. Defaults to `*`. */
  columns?: string;
  /** One or several columns to order by; a raw PostgREST string (`"created_at.desc"`) is passed through. */
  order?: string | OrderSpec | OrderSpec[];
  limit?: number;
  offset?: number;
  /**
   * Ask PostgREST for exactly one row (`Accept: application/vnd.pgrst.object+json`). Zero rows come
   * back as `null`; more than one is an error, because a query that expected one row and found two
   * is a bug worth hearing about.
   */
  single?: boolean;
}

export interface InsertOptions {
  /** `Prefer: resolution=merge-duplicates` — rows that hit a unique constraint are updated instead of rejected. */
  upsert?: boolean;
  /** The columns of the constraint an upsert merges on (`?on_conflict=`). */
  onConflict?: string;
}

/** What PostgREST puts in an error body: https://postgrest.org/en/stable/references/errors.html */
export interface PostgrestErrorBody {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export class DbError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string | null;
  readonly hint?: string | null;
  readonly method: string;
  readonly path: string;

  constructor(status: number, body: PostgrestErrorBody, method: string, path: string) {
    super(body.message || `${method} ${path} failed with ${status}`);
    this.name = 'DbError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.hint = body.hint;
    this.method = method;
    this.path = path;
  }
}

/** Build a `Db` from the environment, or `null` when the backend is not configured (routes then answer 503). */
export function dbFromEnv(env: Record<string, string | undefined>, fetch?: FetchLike): Db | null {
  const url = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  const anonKey = env.SUPABASE_ANON_KEY?.trim() || undefined;
  return new Db({ url, serviceKey, anonKey, fetch });
}

/* ---------- query syntax ---------- */

/**
 * A single value the way PostgREST wants it inside an `in.(…)` list: quoted when it contains a
 * character that would otherwise split or close the list. Everything else is left bare so the URL
 * stays readable.
 */
function inListItem(v: unknown): string {
  const s = v === null ? 'null' : String(v);
  return /[,()"\s\\]/.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}

/** `column=op.value` pairs, in column order. */
export function filterParams(filters: Filters | undefined): [string, string][] {
  if (!filters) return [];
  const out: [string, string][] = [];
  for (const column of Object.keys(filters).sort()) {
    const f = filters[column];
    if (f !== null && typeof f === 'object') {
      const { op, value } = f;
      if (op === 'in') {
        const list = Array.isArray(value) ? value : [value];
        out.push([column, `in.(${list.map(inListItem).join(',')})`]);
      } else if (op === 'is') {
        out.push([column, `is.${value === null ? 'null' : String(value)}`]);
      } else {
        out.push([column, `${op}.${String(value)}`]);
      }
    } else if (f === null) {
      out.push([column, 'is.null']);
    } else {
      out.push([column, `eq.${String(f)}`]);
    }
  }
  return out;
}

function orderParam(order: SelectOptions['order']): string | undefined {
  if (order == null) return undefined;
  if (typeof order === 'string') return order;
  const specs = Array.isArray(order) ? order : [order];
  if (!specs.length) return undefined;
  return specs
    .map((o) => {
      let s = `${o.column}.${o.ascending === false ? 'desc' : 'asc'}`;
      if (o.nulls) s += `.nulls${o.nulls}`;
      return s;
    })
    .join(',');
}

/**
 * `?select=…&col=eq.…&order=…&limit=…&offset=…` — fixed key order, filters sorted by column.
 * Built with URLSearchParams so values are encoded exactly once.
 */
export function selectQuery(opts: SelectOptions): string {
  const q = new URLSearchParams();
  q.set('select', opts.columns || '*');
  for (const [k, v] of filterParams(opts.filters)) q.append(k, v);
  const order = orderParam(opts.order);
  if (order) q.set('order', order);
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.offset != null) q.set('offset', String(opts.offset));
  return q.toString();
}

/* ---------- the client ---------- */

interface RequestSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * A transport failure — Supabase unreachable, DNS, a dropped socket — as a `DbError` rather than the
 * raw `TypeError` fetch throws, so a route has one error type to map to a status. 502 is the honest
 * answer: the request never reached PostgREST, so nothing was written.
 */
function transportError(cause: unknown, method: string, path: string): DbError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const err = new DbError(502, { message: `${method} ${path}: ${reason}`, code: 'FETCH_FAILED' }, method, path);
  err.cause = cause;
  return err;
}

/** Read the body once, as JSON when there is any; an empty body (204, `return=minimal`) is `null`. */
async function readJson(r: Response): Promise<unknown> {
  const text = await r.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export class Db {
  readonly config: DbConfig;

  constructor(config: DbConfig) {
    this.config = { ...config, url: config.url.replace(/\/+$/, '') };
  }

  /** The base URL without a trailing slash. */
  get url(): string {
    return this.config.url;
  }

  /** The fetch in use — injected, or the global one at call time so a later stub still takes effect. */
  get fetch(): FetchLike {
    return this.config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** Headers every service-role request carries. */
  authHeaders(): Record<string, string> {
    return { apikey: this.config.serviceKey, Authorization: `Bearer ${this.config.serviceKey}` };
  }

  /** One request against `/rest/v1`. Errors become `DbError`; success returns the parsed body. */
  async request(spec: RequestSpec): Promise<unknown> {
    const path = `/rest/v1/${spec.path}`;
    const url = `${this.config.url}${path}${spec.query ? `?${spec.query}` : ''}`;
    const headers: Record<string, string> = { ...this.authHeaders(), Accept: 'application/json', ...(spec.headers || {}) };
    const init: RequestInit = { method: spec.method, headers };
    if (spec.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(spec.body);
    }
    let r: Response;
    try {
      r = await this.fetch(url, init);
    } catch (e) {
      throw transportError(e, spec.method, path);
    }
    const body = await readJson(r);
    if (!r.ok) {
      const err = body && typeof body === 'object' ? (body as PostgrestErrorBody) : { message: String(body ?? '') };
      throw new DbError(r.status, err, spec.method, path);
    }
    return body;
  }

  /** Rows matching the filters; with `single`, one row or `null`. */
  async select<T = Record<string, unknown>>(table: string, opts: SelectOptions & { single: true }): Promise<T | null>;
  async select<T = Record<string, unknown>>(table: string, opts?: SelectOptions): Promise<T[]>;
  async select<T = Record<string, unknown>>(table: string, opts: SelectOptions = {}): Promise<T[] | T | null> {
    const spec: RequestSpec = { method: 'GET', path: table, query: selectQuery(opts) };
    if (!opts.single) return (await this.request(spec)) as T[];
    spec.headers = { Accept: 'application/vnd.pgrst.object+json' };
    try {
      return (await this.request(spec)) as T;
    } catch (e) {
      // PGRST116 covers both "0 rows" and "N rows"; only the empty case is an answer rather than a
      // bug, and it is the details, not the status, that says which — PostgREST has answered 404 and
      // 406 for it across versions, so the wording is the more stable signal of the two.
      if (e instanceof DbError && (e.status === 406 || e.status === 404) && /\b0 rows\b/.test(e.details || '')) return null;
      throw e;
    }
  }

  /** Insert one row or several; always returns the stored rows as an array. */
  async insert<T = Record<string, unknown>>(table: string, rows: Record<string, unknown> | Record<string, unknown>[], opts: InsertOptions = {}): Promise<T[]> {
    const headers: Record<string, string> = { Prefer: opts.upsert ? 'return=representation,resolution=merge-duplicates' : 'return=representation' };
    const query = opts.onConflict ? new URLSearchParams({ on_conflict: opts.onConflict }).toString() : undefined;
    const out = await this.request({ method: 'POST', path: table, query, headers, body: Array.isArray(rows) ? rows : [rows] });
    return (out ?? []) as T[];
  }

  /** Patch every row matching the filters and return them. Refuses an empty filter: that would be the whole table. */
  async update<T = Record<string, unknown>>(table: string, filters: Filters, patch: Record<string, unknown>): Promise<T[]> {
    const params = filterParams(filters);
    if (!params.length) throw new DbError(400, { message: `update ${table}: refusing to run without a filter` }, 'PATCH', `/rest/v1/${table}`);
    const q = new URLSearchParams();
    for (const [k, v] of params) q.append(k, v);
    const out = await this.request({ method: 'PATCH', path: table, query: q.toString(), headers: { Prefer: 'return=representation' }, body: patch });
    return (out ?? []) as T[];
  }

  /** Delete every row matching the filters and return them. Same empty-filter refusal as `update`. */
  async del<T = Record<string, unknown>>(table: string, filters: Filters): Promise<T[]> {
    const params = filterParams(filters);
    if (!params.length) throw new DbError(400, { message: `delete ${table}: refusing to run without a filter` }, 'DELETE', `/rest/v1/${table}`);
    const q = new URLSearchParams();
    for (const [k, v] of params) q.append(k, v);
    const out = await this.request({ method: 'DELETE', path: table, query: q.toString(), headers: { Prefer: 'return=representation' } });
    return (out ?? []) as T[];
  }

  /** Call a Postgres function through `/rest/v1/rpc/<fn>`; returns whatever it returns (`null` for void). */
  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.request({ method: 'POST', path: `rpc/${fn}`, body: args })) as T;
  }
}
