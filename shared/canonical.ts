/**
 * The one serialisation that is ever hashed, and the seed that comes out of it — docs/BACKEND.md
 * section 2.
 *
 * The recipe hash is the identity of a generation request: the same photos, plan, dimensions and
 * address must produce the same bytes here or the pipeline generates twice. That is only true if
 * both sides of the app agree on what "the same" means down to the last decimal, so the encoder
 * lives in `shared/` and the browser (`src/services/marble.ts`) and the worker
 * (`server/recipe.ts`) both import it.
 *
 * What is NOT shared is the digest itself: the browser hashes through WebCrypto (async) and the
 * server through `node:crypto` (sync). Both hash the UTF-8 bytes of `canonicalJson`, so the hex
 * they produce is the same.
 *
 * Conventions:
 * - Pure. No clock, no randomness, no locale-dependent formatting.
 * - Keys sorted by UTF-16 code unit at every depth; arrays keep their order (photo order is part of
 *   the recipe).
 * - Numbers rounded to 5 decimals and printed by `String()`; no `-0`, `NaN`, `Infinity` or
 *   `undefined` survives. Anything else — a Date, a class instance, a bigint — throws rather than
 *   being guessed at, because a silent coercion is a silent hash change.
 */

/** Decimals every number is rounded to before it is hashed. */
export const NUMBER_DECIMALS = 5;
const NUMBER_SCALE = 10 ** NUMBER_DECIMALS;

/** Marble's seed is a uint32. */
export const SEED_MAX = 4294967295;

/** Round to `decimals` places and normalise `-0` to `0`. */
export function roundTo(x: number, decimals: number): number {
  const scale = 10 ** decimals;
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r;
}

function encodeNumber(n: number, path: string): string {
  if (!Number.isFinite(n)) throw new TypeError(`canonicalJson: ${String(n)} at ${path} is not a finite number`);
  const r = Math.round(n * NUMBER_SCALE) / NUMBER_SCALE;
  if (Math.abs(r) >= 1e21) throw new RangeError(`canonicalJson: ${String(n)} at ${path} is too large for fixed formatting`);
  // After rounding, the shortest round-trip form has at most 5 decimals and no exponent.
  return String(r === 0 ? 0 : r);
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return encodeNumber(value, path);
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      throw new TypeError(`canonicalJson: undefined at ${path}`);
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
    default:
      break;
  }
  if (Array.isArray(value)) return `[${value.map((item, i) => encode(item, `${path}[${i}]`)).join(',')}]`;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`canonicalJson: only plain objects and arrays at ${path}`);
  const obj = value as Record<string, unknown>;
  // Default sort compares UTF-16 code units: locale-independent, so the same keys always land in the same order.
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(obj[k], `${path}.${k}`)}`).join(',')}}`;
}

/**
 * The one serialisation that is hashed: sorted keys at every level, numbers rounded to 5 decimals,
 * no `-0`, `NaN`, `Infinity` or `undefined`. Throws rather than guess at anything else.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, '$');
}

/** The same value, rebuilt from its canonical JSON: sorted keys, rounded numbers, no undefineds. */
export function canonicalize<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

/** The first 32 bits of a sha256 hex digest as an unsigned integer in [0, SEED_MAX]. */
export function seedFromHash(hash: string): number {
  const head = hash.slice(0, 8);
  if (!/^[0-9a-f]{8}$/i.test(head)) throw new TypeError(`seedFromHash: expected a hex digest, got ${JSON.stringify(hash)}`);
  return Number.parseInt(head, 16);
}
