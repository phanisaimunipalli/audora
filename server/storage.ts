/**
 * Supabase Storage over fetch: the photos, plans, worlds and stills buckets (docs/BACKEND.md §5).
 *
 * Same shape as server/db.ts — service-role key, injectable fetch, no SDK — and the same reason:
 * the server owns the bytes (canonical photo copies, the Marble assets we copy into `worlds`), and
 * the browser only ever sees a public or signed URL.
 *
 * Conventions:
 * - Object paths are `<org_id>/<unit_id>/...` for the private buckets; the first folder is what the
 *   storage policy checks. Each path segment is URI-encoded on the way out, slashes are kept.
 * - `upload` is a POST with `x-upsert`; without `upsert` an existing object is a `StorageError`,
 *   not a silent overwrite — hashed bundles must never change under their name.
 * - `publicUrl` is a pure function of the config and never touches the network; it is what the
 *   public tour document carries for `worlds` and `stills`.
 * - Errors are `StorageError` with the HTTP status, including a transport failure (status 502,
 *   `code: 'FETCH_FAILED'`), which mirrors `DbError` so routes map both the same way.
 *
 * Compiles under tsconfig.node.json (bundler) and tsconfig.server.json (NodeNext): relative
 * imports inside server/ carry the `.js` extension. The `reference types` line below is for the
 * third program that sees this file: tests/db.test.ts is checked by tsconfig.app.json, whose
 * `types` list does not include node, and `Buffer` has to come from somewhere.
 */
/// <reference types="node" />
import { Buffer } from 'node:buffer';
import type { Db, DbConfig, FetchLike } from './db.js';

export interface UploadOptions {
  /** Overwrite an existing object (`x-upsert: true`). Off by default. */
  upsert?: boolean;
  /** `Cache-Control` max-age in seconds stored with the object; hashed bundles want a long one. */
  cacheControl?: number;
}

export interface UploadResult {
  /** `<bucket>/<path>` as Storage reports it. */
  key: string;
  /** The object id, when the API returned one. */
  id?: string;
  path: string;
}

/** What Storage puts in an error body: `{ statusCode, error, message }`. */
export interface StorageErrorBody {
  statusCode?: string | number;
  error?: string;
  message?: string;
}

export class StorageError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly method: string;
  readonly path: string;

  constructor(status: number, body: StorageErrorBody, method: string, path: string) {
    super(body.message || body.error || `${method} ${path} failed with ${status}`);
    this.name = 'StorageError';
    this.status = status;
    this.code = body.statusCode != null ? String(body.statusCode) : body.error;
    this.method = method;
    this.path = path;
  }
}

/** Encode each segment of an object path, keeping the slashes that make it a path. */
export function encodeObjectPath(path: string): string {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

export class Storage {
  readonly config: DbConfig;

  constructor(config: DbConfig) {
    this.config = { ...config, url: config.url.replace(/\/+$/, '') };
  }

  /** The storage client that shares a `Db`'s URL, key and fetch. */
  static from(db: Db): Storage {
    return new Storage(db.config);
  }

  get fetch(): FetchLike {
    return this.config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  private authHeaders(): Record<string, string> {
    return { apikey: this.config.serviceKey, Authorization: `Bearer ${this.config.serviceKey}` };
  }

  private objectUrl(bucket: string, path: string): string {
    return `${this.config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(path)}`;
  }

  /**
   * A transport failure as a `StorageError`, matching `db.ts`: a route then has one error shape to
   * map to a status whether the database or the object store is the one that is unreachable.
   */
  private transport(cause: unknown, method: string, path: string): StorageError {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const err = new StorageError(502, { message: `${method} ${path}: ${reason}`, error: 'FETCH_FAILED' }, method, path);
    err.cause = cause;
    return err;
  }

  /** One request, with transport failures folded into `StorageError`. */
  private async send(url: string, init: RequestInit, method: string, path: string): Promise<Response> {
    try {
      return await this.fetch(url, init);
    } catch (e) {
      throw this.transport(e, method, path);
    }
  }

  private async fail(r: Response, method: string, path: string): Promise<never> {
    const text = await r.text();
    let body: StorageErrorBody = { message: text };
    try {
      if (text) body = JSON.parse(text) as StorageErrorBody;
    } catch {
      /* keep the text */
    }
    throw new StorageError(r.status, body, method, path);
  }

  /** Store bytes under `bucket/path`. */
  async upload(bucket: string, path: string, bytes: Uint8Array | ArrayBuffer | string, contentType: string, opts: UploadOptions = {}): Promise<UploadResult> {
    const headers: Record<string, string> = {
      ...this.authHeaders(),
      'Content-Type': contentType,
      'x-upsert': opts.upsert ? 'true' : 'false',
    };
    if (opts.cacheControl != null) headers['Cache-Control'] = `max-age=${opts.cacheControl}`;
    const body = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    const r = await this.send(this.objectUrl(bucket, path), { method: 'POST', headers, body: body as RequestInit['body'] }, 'POST', `${bucket}/${path}`);
    if (!r.ok) return this.fail(r, 'POST', `${bucket}/${path}`);
    const text = await r.text();
    let data: { Key?: string; Id?: string } = {};
    try {
      if (text) data = JSON.parse(text) as typeof data;
    } catch {
      /* an empty or non-JSON 200 still means stored */
    }
    return { key: data.Key || `${bucket}/${path}`, id: data.Id, path };
  }

  /** The object's bytes, through the authenticated route so private buckets work too. */
  async download(bucket: string, path: string): Promise<Buffer> {
    const r = await this.send(this.objectUrl(bucket, path), { method: 'GET', headers: this.authHeaders() }, 'GET', `${bucket}/${path}`);
    if (!r.ok) return this.fail(r, 'GET', `${bucket}/${path}`);
    return Buffer.from(await r.arrayBuffer());
  }

  /** `{url}/storage/v1/object/public/{bucket}/{path}` — only meaningful for the public buckets. */
  publicUrl(bucket: string, path: string): string {
    return `${this.config.url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeObjectPath(path)}`;
  }

  /** A time-limited URL for a private object (`expiresIn` seconds). */
  async signedUrl(bucket: string, path: string, expiresIn: number): Promise<string> {
    const url = `${this.config.url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeObjectPath(path)}`;
    const r = await this.send(
      url,
      { method: 'POST', headers: { ...this.authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn }) },
      'POST',
      `sign/${bucket}/${path}`,
    );
    if (!r.ok) return this.fail(r, 'POST', `sign/${bucket}/${path}`);
    const data = (await r.json()) as { signedURL?: string; signedUrl?: string };
    const signed = data.signedURL || data.signedUrl;
    if (!signed) throw new StorageError(r.status, { message: 'sign: no signedURL in the response' }, 'POST', `sign/${bucket}/${path}`);
    // Storage answers with a path relative to /storage/v1 (`/object/sign/...?token=...`).
    return /^https?:\/\//.test(signed) ? signed : `${this.config.url}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
  }

  /** Delete objects; returns the paths Storage confirmed. */
  async remove(bucket: string, paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    const url = `${this.config.url}/storage/v1/object/${encodeURIComponent(bucket)}`;
    const r = await this.send(
      url,
      { method: 'DELETE', headers: { ...this.authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) },
      'DELETE',
      bucket,
    );
    if (!r.ok) return this.fail(r, 'DELETE', bucket);
    const text = await r.text();
    try {
      const rows = text ? (JSON.parse(text) as { name?: string }[]) : [];
      return Array.isArray(rows) ? rows.map((o) => o.name).filter((n): n is string => typeof n === 'string') : paths;
    } catch {
      return paths;
    }
  }
}
