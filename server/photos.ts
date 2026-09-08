/**
 * Photo canonicalisation and hashing (docs/BACKEND.md, section 2, rule 1).
 *
 * Every uploaded photo becomes two objects: the original bytes, kept verbatim, and a canonical copy
 * that is what recipes hash and what Marble receives. The canonical copy is what makes "never
 * generate twice" hold across phones and re-uploads: EXIF stripped (it carries capture time and
 * serial numbers, which would change the hash of an otherwise identical shot), auto-oriented (so
 * the stored pixels are the pixels a viewer sees), longest side 2048 px (never upscaled), JPEG
 * quality 90 from a pinned encoder configuration.
 *
 * Conventions this module relies on:
 * - Everything is a pure function of its input bytes: no clock, no randomness, no environment. The
 *   same bytes in always give the same bytes and the same hashes out, which is what the tests check.
 * - `sharp` is optional. It is loaded with a dynamic import so the server starts without it (no
 *   prebuilt binary for the platform, `npm install --omit=optional`); the passthrough path then
 *   keeps the original bytes as the canonical copy and says so with `method: "passthrough"`.
 * - EXIF is read BEFORE it is stripped, by our own reader over the raw APP1 / eXIf payload, so the
 *   focal length, camera and capture time land in `photos.exif` while the canonical copy carries
 *   nothing. The reader never throws: garbage EXIF means `exif: null`, not a failed upload.
 * - server/ never imports src/. The azimuth table is copied from src/services/marble.ts.
 * - Relative imports inside server/ carry the .js extension (tsconfig.server.json is NodeNext).
 */
import { createHash } from 'node:crypto';
// Type-only, so it is erased from the emitted module and sharp stays a runtime option, not a runtime import.
import type { Metadata } from 'sharp';

/** Longest side of the canonical copy, in pixels. Part of the pipeline; changing it changes every hash. */
export const CANONICAL_LONG_SIDE = 2048;
/** JPEG quality of the canonical copy. Part of the pipeline; changing it changes every hash. */
export const CANONICAL_JPEG_QUALITY = 90;
/** The canonical copy's content type when sharp ran. */
export const CANONICAL_CONTENT_TYPE = 'image/jpeg';

/* ---------- azimuths ---------- */

/** Where an extra angle faces, relative to the room's primary photo (src/state/types.ts PhotoAngle). */
export type PhotoAngle = 'left' | 'centre' | 'right' | 'back';

/**
 * Marble's `azimuth` hint per labelled angle, degrees round the capture point with the primary shot
 * at 0. Copied from `AZIMUTH_FOR_ANGLE` in src/services/marble.ts (server/ must not import src/);
 * the two tables must stay identical or the browser flow and the backend would ask Marble for two
 * different worlds from the same photos.
 */
export const AZIMUTH_FOR_ANGLE: Readonly<Record<PhotoAngle, number>> = Object.freeze({ centre: 0, right: 90, back: 180, left: 270 });

/** The azimuth for a labelled angle; `undefined` for anything that is not one of the four labels. */
export function azimuthForAngle(angle: string | null | undefined): number | undefined {
  return angle != null && Object.prototype.hasOwnProperty.call(AZIMUTH_FOR_ANGLE, angle) ? AZIMUTH_FOR_ANGLE[angle as PhotoAngle] : undefined;
}

/* ---------- hashing ---------- */

/** Lowercase hex sha256 of the bytes, 64 characters. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/* ---------- data URLs ---------- */

/**
 * Split a base64 data URL into its bytes and its media type (lowercased, parameters dropped).
 * Only base64 payloads are accepted: that is the only form the browser produces for an image, and
 * refusing the percent-encoded form keeps "is this really an image?" a question for `sniffImage`.
 */
export function dataUrlToBytes(dataUrl: string): { bytes: Buffer; mime: string } {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/.exec(String(dataUrl).trim());
  if (!m) throw new Error('Expected a data URL (data:<type>;base64,<data>)');
  const params = m[2].toLowerCase().split(';').filter(Boolean);
  if (!params.includes('base64')) throw new Error('Expected a base64 data URL');
  const payload = m[3].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) throw new Error('Data URL payload is not valid base64');
  const bytes = Buffer.from(payload, 'base64');
  if (!bytes.length) throw new Error('Data URL carries no bytes');
  return { bytes, mime: (m[1] || 'text/plain').toLowerCase() };
}

/* ---------- storage paths ---------- */

/** The file extension we store an original under, from its media type. */
export function extensionForMime(mime: string): string {
  const table: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/pjpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/avif': 'avif',
    'image/tiff': 'tif',
    'image/bmp': 'bmp',
  };
  return table[String(mime).toLowerCase().split(';')[0].trim()] ?? 'bin';
}

/** One path segment of a storage key: ids are uuids, but the check is what keeps `..` out of a key. */
function segment(name: string, value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === '.' || value === '..') throw new Error(`${name} is not a valid storage path segment`);
  return value;
}

/**
 * Where a photo's two objects live: `photos/<org>/<unit>/<photoId>.<ext>` for the original and
 * `photos/<org>/<unit>/<photoId>.canonical.jpg` for the canonical copy.
 *
 * The first segment is the Storage bucket and the rest is the object key, which is exactly the
 * `<bucket>/<key>` a `/storage/v1/object/...` URL takes. The key starts with the org id because the
 * storage policy in supabase/migrations/0001_init.sql reads the org out of the first folder.
 */
export function photoStoragePaths(orgId: string, unitId: string, photoId: string, ext: string): { original: string; canonical: string } {
  const dir = `photos/${segment('orgId', orgId)}/${segment('unitId', unitId)}`;
  const id = segment('photoId', photoId);
  const clean = String(ext).replace(/^\.+/, '').toLowerCase();
  const suffix = /^[a-z0-9]+$/.test(clean) ? clean : 'bin';
  return { original: `${dir}/${id}.${suffix}`, canonical: `${dir}/${id}.canonical.jpg` };
}

/* ---------- EXIF ---------- */

/** What we keep of a photo's EXIF: the scale prior, the camera, and when it was taken. */
export interface PhotoExif {
  /** Focal length in millimetres. */
  focalLength?: number;
  /** 35 mm-equivalent focal length in millimetres. */
  focalLength35?: number;
  make?: string;
  model?: string;
  /** DateTimeOriginal as `YYYY-MM-DDTHH:MM:SS`, with the camera's UTC offset appended when it recorded one. */
  capturedAt?: string;
  /** EXIF orientation 1..8 of the ORIGINAL bytes; the canonical copy is always upright. */
  orientation?: number;
}

// TIFF field types and their byte sizes (TIFF 6.0, section 2).
const TIFF_TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_FOCAL_LENGTH_35 = 0xa405;

interface TiffEntry {
  type: number;
  count: number;
  /** Absolute offset of the value inside the TIFF buffer (inline in the entry, or pointed to). */
  at: number;
}

/** A bounds-checked view of a TIFF structure; every read that would fall off the end yields `undefined`. */
class Tiff {
  constructor(
    private readonly buf: Buffer,
    private readonly le: boolean,
  ) {}
  u16(at: number): number | undefined {
    return at >= 0 && at + 2 <= this.buf.length ? (this.le ? this.buf.readUInt16LE(at) : this.buf.readUInt16BE(at)) : undefined;
  }
  u32(at: number): number | undefined {
    return at >= 0 && at + 4 <= this.buf.length ? (this.le ? this.buf.readUInt32LE(at) : this.buf.readUInt32BE(at)) : undefined;
  }
  /** The entries of the IFD at `offset`, keyed by tag. At most 512 entries are read, which is far beyond any real IFD. */
  ifd(offset: number): Map<number, TiffEntry> {
    const out = new Map<number, TiffEntry>();
    const n = this.u16(offset);
    if (n === undefined) return out;
    for (let i = 0; i < Math.min(n, 512); i++) {
      const e = offset + 2 + i * 12;
      const tag = this.u16(e);
      const type = this.u16(e + 2);
      const count = this.u32(e + 4);
      if (tag === undefined || type === undefined || count === undefined) break;
      const size = (TIFF_TYPE_SIZE[type] ?? 0) * count;
      if (!size) continue;
      const at = size <= 4 ? e + 8 : this.u32(e + 8);
      if (at === undefined || at + size > this.buf.length) continue;
      out.set(tag, { type, count, at });
    }
    return out;
  }
  ascii(e: TiffEntry | undefined): string | undefined {
    if (!e || e.type !== 2) return undefined;
    // Trailing NULs are the terminator; anything else below 0x20 is a camera writing garbage.
    const s = this.buf.subarray(e.at, e.at + e.count).toString('latin1').replace(/\0+$/, '').replace(/[\x00-\x1f\x7f]/g, '').trim();
    return s || undefined;
  }
  short(e: TiffEntry | undefined): number | undefined {
    if (!e) return undefined;
    if (e.type === 3) return this.u16(e.at);
    if (e.type === 4) return this.u32(e.at);
    return undefined;
  }
  rational(e: TiffEntry | undefined): number | undefined {
    if (!e || e.type !== 5) return undefined;
    const num = this.u32(e.at);
    const den = this.u32(e.at + 4);
    return num === undefined || den === undefined || den === 0 ? undefined : num / den;
  }
}

/** EXIF `YYYY:MM:DD HH:MM:SS` (+ an optional `±HH:MM` offset) as an ISO-8601-shaped string; anything else is dropped. */
function isoCapture(dateTime: string | undefined, offset: string | undefined): string | undefined {
  const m = dateTime && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(dateTime);
  if (!m || m[1] === '0000') return undefined;
  const zone = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`;
}

/**
 * Read the fields we keep out of an EXIF payload: the TIFF structure of a JPEG APP1 segment (with
 * or without its `Exif\0\0` prefix), a PNG eXIf chunk, or what sharp's `metadata().exif` returns.
 * Pure, and it never throws: an unreadable payload is `null`. Keys come out in a fixed order and
 * undefined fields are omitted, so the object is safe to hash or store as it is.
 */
export function parseExif(payload: Uint8Array | null | undefined): PhotoExif | null {
  if (!payload || payload.length < 8) return null;
  let buf = asBuffer(payload);
  if (buf.length >= 6 && buf.toString('latin1', 0, 4) === 'Exif') buf = buf.subarray(6);
  const order = buf.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const t = new Tiff(buf, order === 'II');
  if (t.u16(2) !== 42) return null;
  const ifd0At = t.u32(4);
  if (ifd0At === undefined) return null;
  const ifd0 = t.ifd(ifd0At);
  const exifAt = t.short(ifd0.get(TAG_EXIF_IFD));
  const exif = exifAt === undefined ? new Map<number, TiffEntry>() : t.ifd(exifAt);

  const focal = t.rational(exif.get(TAG_FOCAL_LENGTH));
  const focal35 = t.short(exif.get(TAG_FOCAL_LENGTH_35));
  const orientation = t.short(ifd0.get(TAG_ORIENTATION));
  const out: PhotoExif = {};
  // Alphabetical, so a stored `photos.exif` reads the same whichever path produced it.
  const capturedAt = isoCapture(t.ascii(exif.get(TAG_DATETIME_ORIGINAL)), t.ascii(exif.get(TAG_OFFSET_TIME_ORIGINAL)));
  if (capturedAt) out.capturedAt = capturedAt;
  // Two decimals: a rational like 4199/1000 is 4.2 mm, not 4.199 mm of false precision.
  if (focal !== undefined && Number.isFinite(focal) && focal > 0) out.focalLength = Math.round(focal * 100) / 100;
  if (focal35 !== undefined && focal35 > 0) out.focalLength35 = focal35;
  const make = t.ascii(ifd0.get(TAG_MAKE));
  if (make) out.make = make;
  const model = t.ascii(ifd0.get(TAG_MODEL));
  if (model) out.model = model;
  if (orientation !== undefined && orientation >= 1 && orientation <= 8) out.orientation = orientation;
  return Object.keys(out).length ? out : null;
}

/* ---------- containers: what we can read without a decoder ---------- */

/** What the first bytes of a file say about it. */
export interface SniffedImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  ext: 'jpg' | 'png' | 'webp' | 'gif';
  /** Stored pixel size, before any EXIF orientation. */
  width: number;
  height: number;
}

/** A Buffer over the same memory, so the container readers can use Buffer's readers on any Uint8Array. */
function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Walk a JPEG's marker segments up to the scan. `visit` gets each marker and its payload and the
 * walk ends with the first value it returns, so a caller reads what it wants and stops.
 */
function jpegSegments<R>(buf: Buffer, visit: (marker: number, payload: Buffer) => R | undefined): R | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) return undefined;
    const marker = buf[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined; // EOI / SOS: the entropy-coded data follows
    if (marker >= 0xd0 && marker <= 0xd7) {
      at += 2; // RSTn carries no length
      continue;
    }
    const len = buf.readUInt16BE(at + 2);
    if (len < 2 || at + 2 + len > buf.length) return undefined;
    const hit = visit(marker, buf.subarray(at + 4, at + 2 + len));
    if (hit !== undefined) return hit;
    at += 2 + len;
  }
  return undefined;
}

/** Walk a PNG's chunks the same way; `visit` gets each chunk type and its data. */
function pngChunks<R>(buf: Buffer, visit: (type: string, data: Buffer) => R | undefined): R | undefined {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  let at = 8;
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    if (at + 12 + len > buf.length) return undefined;
    const hit = visit(type, buf.subarray(at + 8, at + 8 + len));
    if (hit !== undefined) return hit;
    if (type === 'IEND') return undefined;
    at += 12 + len;
  }
  return undefined;
}

/** Walk a WebP's RIFF chunks the same way; `visit` gets each fourcc and its data. */
function webpChunks<R>(buf: Buffer, visit: (fourcc: string, data: Buffer) => R | undefined): R | undefined {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return undefined;
  let at = 12;
  while (at + 8 <= buf.length) {
    const fourcc = buf.toString('latin1', at, at + 4);
    const len = buf.readUInt32LE(at + 4);
    if (at + 8 + len > buf.length) return undefined;
    const hit = visit(fourcc, buf.subarray(at + 8, at + 8 + len));
    if (hit !== undefined) return hit;
    at += 8 + len + (len & 1); // chunks are padded to even sizes
  }
  return undefined;
}

/**
 * Container, media type and stored pixel size from the bytes alone, for JPEG, PNG, WebP and GIF.
 * `null` for anything else. This is what the passthrough path has instead of a decoder, and what
 * says whether an upload is an image at all before anything is stored.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  const buf = asBuffer(bytes);
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    const dims = jpegSegments(buf, (marker, payload) => {
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC): precision, height, width.
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      return sof && payload.length >= 5 ? { width: payload.readUInt16BE(3), height: payload.readUInt16BE(1) } : undefined;
    });
    return { mime: 'image/jpeg', ext: 'jpg', width: dims?.width ?? 0, height: dims?.height ?? 0 };
  }
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE) && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { mime: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const dims = webpChunks(buf, (fourcc, data) => {
      if (fourcc === 'VP8X' && data.length >= 10) return { width: 1 + data.readUIntLE(4, 3), height: 1 + data.readUIntLE(7, 3) };
      if (fourcc === 'VP8 ' && data.length >= 10) return { width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff };
      if (fourcc === 'VP8L' && data.length >= 5) {
        const bits = data.readUInt32LE(1);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
      }
      return undefined;
    });
    return { mime: 'image/webp', ext: 'webp', width: dims?.width ?? 0, height: dims?.height ?? 0 };
  }
  if (buf.length >= 10 && (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a')) {
    return { mime: 'image/gif', ext: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  return null;
}

/**
 * The raw EXIF payload embedded in a JPEG (APP1 `Exif\0\0`), PNG (eXIf chunk) or WebP (EXIF chunk),
 * or `null`. The passthrough path reads EXIF through this; the sharp path gets the same bytes from
 * `metadata().exif`.
 */
export function embeddedExif(bytes: Uint8Array): Buffer | null {
  const buf = asBuffer(bytes);
  return (
    jpegSegments(buf, (marker, payload) => (marker === 0xe1 && payload.length > 6 && payload.toString('latin1', 0, 6) === 'Exif\0\0' ? payload : undefined)) ??
    pngChunks(buf, (type, data) => (type === 'eXIf' ? data : undefined)) ??
    webpChunks(buf, (fourcc, data) => (fourcc === 'EXIF' ? data : undefined)) ??
    null
  );
}

/* ---------- canonicalisation ---------- */

interface CanonicalBase {
  /** The bytes to store as the canonical copy and to hash into recipes. */
  canonical: Buffer;
  /** Pixel size of the canonical copy. 0 × 0 only on a passthrough of a container `sniffImage` cannot read. */
  width: number;
  height: number;
  /** sha256 of the bytes as uploaded, lowercase hex. `photos.sha256`. */
  sha256Original: string;
  /** sha256 of `canonical`, lowercase hex. `photos.canonical_sha256`; equal to the original on passthrough. */
  sha256Canonical: string;
  /** What the original's EXIF said, read before it was stripped. `null` when there was none worth keeping. */
  exif: PhotoExif | null;
}

/**
 * A canonicalised photo. `method: "sharp"` is the real pipeline and always yields a JPEG;
 * `method: "passthrough"` means sharp was not available, the canonical copy IS the original, and
 * `contentType` is whatever the original was.
 */
export type CanonicalPhoto =
  | (CanonicalBase & { method: 'sharp'; contentType: typeof CANONICAL_CONTENT_TYPE })
  | (CanonicalBase & { method: 'passthrough'; contentType: string });

/** Thrown when sharp is present but cannot decode the bytes: not an image, a format it has no codec for (HEIC), or a truncated file. */
export class UnreadablePhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadablePhotoError';
  }
}

type SharpModule = typeof import('sharp');
type SharpFactory = SharpModule['default'];

let sharpLoad: Promise<SharpFactory | null> | null = null;

/**
 * sharp, or `null` when it cannot be loaded. The import is attempted once per process: a missing
 * binary does not become a failed import on every upload.
 */
function loadSharp(): Promise<SharpFactory | null> {
  if (!sharpLoad) {
    sharpLoad = import('sharp').then(
      (m) => m.default,
      () => null,
    );
  }
  return sharpLoad;
}

/**
 * The canonical copy without a decoder: the original bytes, unchanged, with the hashes, the
 * dimensions and the EXIF read straight off the container. Exported so the fallback is tested on
 * every machine, whether or not sharp is installed there.
 */
export function canonicalizePassthrough(input: Buffer | Uint8Array, mime: string): CanonicalPhoto {
  const bytes = asBuffer(input);
  const sniffed = sniffImage(bytes);
  const hash = sha256Hex(bytes);
  return {
    canonical: bytes,
    contentType: sniffed?.mime ?? String(mime || 'application/octet-stream').toLowerCase().split(';')[0].trim(),
    width: sniffed?.width ?? 0,
    height: sniffed?.height ?? 0,
    sha256Original: hash,
    sha256Canonical: hash,
    exif: parseExif(embeddedExif(bytes)),
    method: 'passthrough',
  };
}

async function canonicalizeWithSharp(sharp: SharpFactory, bytes: Buffer): Promise<CanonicalPhoto> {
  // Pinned rather than left to sharp's defaults so an upgrade of sharp that changes a default is a
  // deliberate pipeline change, not a silent one. `failOn: 'warning'` refuses truncated files: a
  // photo with a grey bottom third would otherwise become a "canonical" input to Marble.
  const options = { failOn: 'warning' as const, animated: false };
  let meta: Metadata;
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    meta = await sharp(bytes, options).metadata();
    out = await sharp(bytes, options)
      // Orientation is applied before the resize, so "longest side" is the longest side as seen.
      .autoOrient()
      .resize({
        width: CANONICAL_LONG_SIDE,
        height: CANONICAL_LONG_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: 'lanczos3',
        // JPEG shrink-on-load lets libjpeg scale during decode; off, so a JPEG and a lossless copy of
        // the same pixels canonicalise to the same bytes.
        fastShrinkOnLoad: false,
      })
      // sharp's default output strips every metadata block (EXIF, XMP, IPTC, ICC) and, when the
      // input carries an ICC profile (Display P3 on an iPhone), converts the pixels to sRGB first
      // (pipeline.cc, "Convert to sRGB/P3 using embedded profile"). That is exactly the canonical
      // form: sRGB pixels, nothing else.
      .jpeg({ quality: CANONICAL_JPEG_QUALITY, progressive: false, chromaSubsampling: '4:2:0', mozjpeg: false })
      .toBuffer({ resolveWithObject: true });
  } catch (e) {
    throw new UnreadablePhotoError(`Cannot decode this image: ${e instanceof Error ? e.message : String(e)}`);
  }
  // EXIF from the input, before the pipeline stripped it. sharp's own orientation reading covers a
  // container whose EXIF our reader cannot follow (it is the one field sharp parses for us).
  const exif = parseExif(meta.exif ?? embeddedExif(bytes)) ?? {};
  if (exif.orientation === undefined && meta.orientation !== undefined && meta.orientation >= 1 && meta.orientation <= 8) exif.orientation = meta.orientation;
  return {
    canonical: out.data,
    contentType: CANONICAL_CONTENT_TYPE,
    width: out.info.width,
    height: out.info.height,
    sha256Original: sha256Hex(bytes),
    sha256Canonical: sha256Hex(out.data),
    exif: Object.keys(exif).length ? sortedExif(exif) : null,
    method: 'sharp',
  };
}

/** The same object with its keys in the order `parseExif` emits them, whichever path filled it. */
function sortedExif(exif: PhotoExif): PhotoExif {
  const out: PhotoExif = {};
  if (exif.capturedAt !== undefined) out.capturedAt = exif.capturedAt;
  if (exif.focalLength !== undefined) out.focalLength = exif.focalLength;
  if (exif.focalLength35 !== undefined) out.focalLength35 = exif.focalLength35;
  if (exif.make !== undefined) out.make = exif.make;
  if (exif.model !== undefined) out.model = exif.model;
  if (exif.orientation !== undefined) out.orientation = exif.orientation;
  return out;
}

/**
 * Canonicalise one uploaded photo: auto-orient, strip metadata, fit inside 2048 × 2048 without
 * enlarging, encode JPEG q90 (4:2:0, baseline, libjpeg defaults), and hash both the original and
 * the result. `mime` is what the upload claimed; sharp reads the real format off the bytes and the
 * passthrough path sniffs it, so a mislabelled upload is not a problem.
 *
 * With sharp missing the result is `method: "passthrough"` (see `canonicalizePassthrough`). With
 * sharp present but unable to decode the bytes it rejects with `UnreadablePhotoError`, because a
 * silent passthrough of a HEIC or a truncated file would hand Marble something it cannot use.
 *
 * `options.useSharp: false` forces the passthrough path; it exists for the tests, which must cover
 * the fallback on a machine where sharp is installed.
 *
 * A plain `Uint8Array` is accepted as well as a `Buffer`, and viewed rather than copied: a route
 * that assembled the body itself should not have to know which of the two it is holding.
 */
export async function canonicalizePhoto(input: Buffer | Uint8Array, mime: string, options: { useSharp?: boolean } = {}): Promise<CanonicalPhoto> {
  if (!(input instanceof Uint8Array) || !input.length) throw new Error('No image bytes');
  const bytes = asBuffer(input);
  const sharp = options.useSharp === false ? null : await loadSharp();
  if (!sharp) return canonicalizePassthrough(bytes, mime);
  return canonicalizeWithSharp(sharp, bytes);
}
