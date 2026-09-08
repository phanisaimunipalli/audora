/**
 * server/photos.ts: canonicalisation, hashing, EXIF reading and the storage/URL helpers.
 *
 * Nothing here touches a network or a provider. Fixtures are built in the test: a hand-made PNG (no
 * decoder needed, so the passthrough path is exercised on every machine), a hand-made EXIF/TIFF
 * payload in both byte orders, and — when sharp can be loaded — real PNG/JPEG images from a raw
 * pixel pattern. The sharp-dependent cases skip cleanly when the import fails.
 */
import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  AZIMUTH_FOR_ANGLE,
  CANONICAL_LONG_SIDE,
  UnreadablePhotoError,
  azimuthForAngle,
  canonicalizePassthrough,
  canonicalizePhoto,
  dataUrlToBytes,
  embeddedExif,
  extensionForMime,
  parseExif,
  photoStoragePaths,
  sha256Hex,
  sniffImage,
} from '../server/photos';

type SharpFactory = (typeof import('sharp'))['default'];
const sharp: SharpFactory | null = await import('sharp').then((m) => m.default).catch(() => null);
const withSharp = (): SharpFactory => {
  if (!sharp) throw new Error('sharp is not available');
  return sharp;
};

const HEX64 = /^[0-9a-f]{64}$/;

/* ---------- fixtures without a decoder ---------- */

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A valid 8-bit RGB PNG of one flat colour, built by hand. */
function tinyPng(width: number, height: number, rgb: [number, number, number] = [200, 40, 40]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Insert an eXIf chunk right after IHDR (8-byte signature + 25-byte IHDR chunk). */
function withPngExif(png: Buffer, tiff: Buffer): Buffer {
  const at = 8 + 25;
  return Buffer.concat([png.subarray(0, at), pngChunk('eXIf', tiff), png.subarray(at)]);
}

/** Insert an APP1 Exif segment right after SOI. */
function withJpegExif(jpg: Buffer, tiff: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = 0xe1;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpg.subarray(0, 2), head, payload, jpg.subarray(2)]);
}

/** A JPEG header only (SOI, SOF0 with the size, EOI): enough for the container readers, not decodable. */
function jpegHeader(width: number, height: number): Buffer {
  const sof = Buffer.alloc(4 + 15);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

interface ExifFields {
  make?: string;
  model?: string;
  orientation?: number;
  /** [numerator, denominator] */
  focal?: [number, number];
  focal35?: number;
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
}

/**
 * A TIFF/EXIF payload with IFD0 { Make, Model, Orientation, ExifIFD } and ExifIFD { DateTimeOriginal,
 * OffsetTimeOriginal, FocalLength, FocalLengthIn35mmFilm }, in either byte order.
 */
function tiffExif(f: ExifFields, order: 'II' | 'MM' = 'II'): Buffer {
  const le = order === 'II';
  const u16 = (v: number) => {
    const b = Buffer.alloc(2);
    le ? b.writeUInt16LE(v) : b.writeUInt16BE(v);
    return b;
  };
  const u32 = (v: number) => {
    const b = Buffer.alloc(4);
    le ? b.writeUInt32LE(v) : b.writeUInt32BE(v);
    return b;
  };
  const ascii = (s: string) => Buffer.from(s + '\0', 'latin1');

  type Entry = { tag: number; type: number; count: number; value: Buffer };
  const ifd0: Entry[] = [];
  const exif: Entry[] = [];
  if (f.make !== undefined) ifd0.push({ tag: 0x010f, type: 2, count: f.make.length + 1, value: ascii(f.make) });
  if (f.model !== undefined) ifd0.push({ tag: 0x0110, type: 2, count: f.model.length + 1, value: ascii(f.model) });
  if (f.orientation !== undefined) ifd0.push({ tag: 0x0112, type: 3, count: 1, value: u16(f.orientation) });
  if (f.dateTimeOriginal !== undefined) exif.push({ tag: 0x9003, type: 2, count: f.dateTimeOriginal.length + 1, value: ascii(f.dateTimeOriginal) });
  if (f.offsetTimeOriginal !== undefined) exif.push({ tag: 0x9011, type: 2, count: f.offsetTimeOriginal.length + 1, value: ascii(f.offsetTimeOriginal) });
  if (f.focal !== undefined) exif.push({ tag: 0x920a, type: 5, count: 1, value: Buffer.concat([u32(f.focal[0]), u32(f.focal[1])]) });
  if (f.focal35 !== undefined) exif.push({ tag: 0xa405, type: 3, count: 1, value: u16(f.focal35) });

  const ifd0Count = ifd0.length + (exif.length ? 1 : 0);
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + 12 * ifd0Count + 4;
  const dataAt = exif.length ? exifAt + 2 + 12 * exif.length + 4 : exifAt;
  const data: Buffer[] = [];
  let cursor = dataAt;
  const place = (value: Buffer): Buffer => {
    if (value.length <= 4) return Buffer.concat([value, Buffer.alloc(4 - value.length)]);
    const at = cursor;
    data.push(value);
    cursor += value.length;
    if (cursor % 2) {
      data.push(Buffer.alloc(1));
      cursor += 1;
    }
    return u32(at);
  };
  const encode = (entries: Entry[], pointer?: Entry): Buffer => {
    const all = pointer ? [...entries, pointer] : entries;
    const parts: Buffer[] = [u16(all.length)];
    for (const e of all) parts.push(u16(e.tag), u16(e.type), u32(e.count), place(e.value));
    parts.push(u32(0));
    return Buffer.concat(parts);
  };
  const ifd0Buf = encode(ifd0, exif.length ? { tag: 0x8769, type: 4, count: 1, value: u32(exifAt) } : undefined);
  const exifBuf = exif.length ? encode(exif) : Buffer.alloc(0);
  const header = Buffer.concat([Buffer.from(order, 'latin1'), u16(42), u32(ifd0At)]);
  return Buffer.concat([header, ifd0Buf, exifBuf, ...data]);
}

const CAMERA: ExifFields = { make: 'Audora', model: 'TestCam 1', orientation: 1, focal: [4199, 1000], focal35: 26, dateTimeOriginal: '2026:09:08 10:11:12', offsetTimeOriginal: '+02:00' };
const CAMERA_PARSED = { capturedAt: '2026-09-08T10:11:12+02:00', focalLength: 4.2, focalLength35: 26, make: 'Audora', model: 'TestCam 1', orientation: 1 };

/* ---------- fixtures that need a decoder ---------- */

/** An asymmetric RGB pattern: a gradient with a red block in the top-left corner, so a rotation is visible. */
function pattern(w: number, h: number): Buffer {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const inBlock = x < w / 4 && y < h / 4;
      raw[i] = inBlock ? 220 : Math.floor((x * 255) / w);
      raw[i + 1] = inBlock ? 30 : Math.floor((y * 255) / h);
      raw[i + 2] = inBlock ? 30 : 128;
    }
  }
  return raw;
}

/** 90° anticlockwise, as pure pixel shuffling: dst(x, y) = src(w − 1 − y, x), giving an h × w image. */
function rotateCCW(raw: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < h; x++) {
      const s = ((x * w) + (w - 1 - y)) * 3;
      out.set(raw.subarray(s, s + 3), (y * h + x) * 3);
    }
  }
  return out;
}

const encodePng = (raw: Buffer, w: number, h: number) => withSharp()(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
const encodeJpeg = (raw: Buffer, w: number, h: number, quality = 92) => withSharp()(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality }).toBuffer();

/* ---------- pure helpers ---------- */

describe('azimuthForAngle', () => {
  it('carries the same four numbers as src/services/marble AZIMUTH_FOR_ANGLE', () => {
    expect(AZIMUTH_FOR_ANGLE).toEqual({ centre: 0, right: 90, back: 180, left: 270 });
    expect(azimuthForAngle('centre')).toBe(0);
    expect(azimuthForAngle('right')).toBe(90);
    expect(azimuthForAngle('back')).toBe(180);
    expect(azimuthForAngle('left')).toBe(270);
  });
  it('answers undefined for anything that is not a label', () => {
    expect(azimuthForAngle('front')).toBeUndefined();
    expect(azimuthForAngle('toString')).toBeUndefined();
    expect(azimuthForAngle(undefined)).toBeUndefined();
    expect(azimuthForAngle(null)).toBeUndefined();
  });
});

describe('dataUrlToBytes', () => {
  it('splits a base64 data URL into bytes and a lowercased media type', () => {
    const png = tinyPng(2, 2);
    const { bytes, mime } = dataUrlToBytes(`data:image/PNG;base64,${png.toString('base64')}`);
    expect(mime).toBe('image/png');
    expect(bytes.equals(png)).toBe(true);
  });
  it('tolerates whitespace in the payload and extra parameters', () => {
    const b64 = Buffer.from('hello').toString('base64');
    const { bytes, mime } = dataUrlToBytes(`data:image/jpeg;charset=binary;base64,${b64.slice(0, 3)}\n${b64.slice(3)}`);
    expect(mime).toBe('image/jpeg');
    expect(bytes.toString()).toBe('hello');
  });
  it('refuses what is not a base64 data URL', () => {
    expect(() => dataUrlToBytes('https://example.com/a.jpg')).toThrow(/data URL/);
    expect(() => dataUrlToBytes('data:image/png,%89PNG')).toThrow(/base64/);
    expect(() => dataUrlToBytes('data:image/png;base64,***')).toThrow(/base64/);
    expect(() => dataUrlToBytes('data:image/png;base64,')).toThrow(/no bytes/);
  });
});

describe('photoStoragePaths', () => {
  it('keys both objects under photos/<org>/<unit>/<photoId>', () => {
    expect(photoStoragePaths('org1', 'unit2', 'photo3', 'jpg')).toEqual({
      original: 'photos/org1/unit2/photo3.jpg',
      canonical: 'photos/org1/unit2/photo3.canonical.jpg',
    });
  });
  it('normalises the extension and falls back to bin', () => {
    expect(photoStoragePaths('o', 'u', 'p', '.JPG').original).toBe('photos/o/u/p.jpg');
    expect(photoStoragePaths('o', 'u', 'p', 'we/../bp').original).toBe('photos/o/u/p.bin');
    expect(photoStoragePaths('o', 'u', 'p', '').original).toBe('photos/o/u/p.bin');
  });
  it('refuses ids that could escape the folder', () => {
    expect(() => photoStoragePaths('..', 'u', 'p', 'jpg')).toThrow(/orgId/);
    expect(() => photoStoragePaths('o', 'a/b', 'p', 'jpg')).toThrow(/unitId/);
    expect(() => photoStoragePaths('o', 'u', '', 'jpg')).toThrow(/photoId/);
  });
  it('maps media types to extensions', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('IMAGE/PNG; charset=binary')).toBe('png');
    expect(extensionForMime('image/heic')).toBe('heic');
    expect(extensionForMime('application/pdf')).toBe('bin');
  });
});

describe('sha256Hex', () => {
  it('is the lowercase hex sha256', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('sniffImage', () => {
  it('reads PNG, JPEG and GIF sizes off the container', () => {
    expect(sniffImage(tinyPng(3, 2))).toEqual({ mime: 'image/png', ext: 'png', width: 3, height: 2 });
    expect(sniffImage(jpegHeader(640, 480))).toEqual({ mime: 'image/jpeg', ext: 'jpg', width: 640, height: 480 });
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([10, 0, 7, 0, 0, 0, 0])]);
    expect(sniffImage(gif)).toEqual({ mime: 'image/gif', ext: 'gif', width: 10, height: 7 });
  });
  it('reads a WebP VP8X canvas size', () => {
    const vp8x = Buffer.alloc(10);
    vp8x.writeUIntLE(1023, 4, 3); // width − 1
    vp8x.writeUIntLE(767, 7, 3); // height − 1
    const chunk = Buffer.concat([Buffer.from('VP8X', 'latin1'), Buffer.from([10, 0, 0, 0]), vp8x]);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(4 + chunk.length);
    const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), size, Buffer.from('WEBP', 'latin1'), chunk]);
    expect(sniffImage(webp)).toEqual({ mime: 'image/webp', ext: 'webp', width: 1024, height: 768 });
  });
  it('is null for anything else', () => {
    expect(sniffImage(Buffer.from('%PDF-1.4 not an image'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('parseExif', () => {
  it('reads the fields we keep, in a fixed key order, from either byte order', () => {
    for (const order of ['II', 'MM'] as const) {
      const parsed = parseExif(tiffExif(CAMERA, order));
      expect(parsed).toEqual(CAMERA_PARSED);
      expect(Object.keys(parsed!)).toEqual(['capturedAt', 'focalLength', 'focalLength35', 'make', 'model', 'orientation']);
    }
  });
  it('accepts the Exif\\0\\0 prefix sharp and JPEG APP1 carry', () => {
    const prefixed = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffExif(CAMERA)]);
    expect(parseExif(prefixed)).toEqual(CAMERA_PARSED);
  });
  it('omits what is missing or nonsense and answers null when nothing is left', () => {
    expect(parseExif(tiffExif({ orientation: 6 }))).toEqual({ orientation: 6 });
    expect(parseExif(tiffExif({ orientation: 9, focal: [0, 0], dateTimeOriginal: '0000:00:00 00:00:00', make: '   ' }))).toBeNull();
    expect(parseExif(tiffExif({ dateTimeOriginal: '2026:09:08 10:11:12', offsetTimeOriginal: 'garbage' }))).toEqual({ capturedAt: '2026-09-08T10:11:12' });
    expect(parseExif(tiffExif({ focal: [1, 3] }))).toEqual({ focalLength: 0.33 });
  });
  it('never throws on garbage or truncation', () => {
    expect(parseExif(null)).toBeNull();
    expect(parseExif(Buffer.from('not exif at all'))).toBeNull();
    expect(parseExif(Buffer.from('II*\0\xff\xff\xff\xff', 'latin1'))).toBeNull();
    const whole = tiffExif(CAMERA);
    for (const cut of [8, 20, 40, 60, whole.length - 3]) expect(() => parseExif(whole.subarray(0, cut))).not.toThrow();
  });
  it('finds the payload inside a JPEG APP1 or a PNG eXIf chunk', () => {
    const tiff = tiffExif(CAMERA);
    expect(embeddedExif(withJpegExif(jpegHeader(8, 8), tiff))?.subarray(6).equals(tiff)).toBe(true);
    expect(embeddedExif(withPngExif(tinyPng(2, 2), tiff))?.equals(tiff)).toBe(true);
    expect(embeddedExif(tinyPng(2, 2))).toBeNull();
    expect(embeddedExif(jpegHeader(8, 8))).toBeNull();
  });
});

/* ---------- passthrough: always tested ---------- */

describe('canonicalizePhoto without sharp', () => {
  it('keeps the original bytes, hashes them once, and reads the size and EXIF off the container', async () => {
    const png = withPngExif(tinyPng(5, 3), tiffExif({ ...CAMERA, orientation: 6 }));
    const r = await canonicalizePhoto(png, 'application/octet-stream', { useSharp: false });
    expect(r.method).toBe('passthrough');
    expect(r.canonical.equals(png)).toBe(true);
    expect(r.contentType).toBe('image/png');
    expect(r.width).toBe(5);
    expect(r.height).toBe(3);
    expect(r.sha256Original).toMatch(HEX64);
    expect(r.sha256Canonical).toBe(r.sha256Original);
    expect(r.sha256Original).toBe(sha256Hex(png));
    expect(r.exif).toEqual({ ...CAMERA_PARSED, orientation: 6 });
  });
  it('is deterministic', async () => {
    const png = tinyPng(4, 4);
    const a = canonicalizePassthrough(Buffer.from(png), 'image/png');
    const b = canonicalizePassthrough(Buffer.from(png), 'image/png');
    expect(a.canonical.equals(b.canonical)).toBe(true);
    expect(a.sha256Canonical).toBe(b.sha256Canonical);
    expect(a.exif).toBeNull();
  });
  it('takes a plain Uint8Array as readily as a Buffer', async () => {
    const png = tinyPng(4, 4);
    const view = new Uint8Array(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength));
    const r = await canonicalizePhoto(view, 'image/png', { useSharp: false });
    expect(r.sha256Original).toBe(sha256Hex(png));
    expect(r.canonical.equals(png)).toBe(true);
    expect([r.width, r.height]).toEqual([4, 4]);
  });
  it('reads a JPEG APP1 segment too', () => {
    const r = canonicalizePassthrough(withJpegExif(jpegHeader(320, 240), tiffExif(CAMERA, 'MM')), 'image/jpeg');
    expect(r.contentType).toBe('image/jpeg');
    expect([r.width, r.height]).toEqual([320, 240]);
    expect(r.exif).toEqual(CAMERA_PARSED);
  });
  it('falls back to the declared type and an unknown size for a container it cannot read', () => {
    const r = canonicalizePassthrough(Buffer.from('\0\0\0\x20ftypheic', 'latin1'), 'Image/HEIC; x=y');
    expect(r.contentType).toBe('image/heic');
    expect([r.width, r.height]).toEqual([0, 0]);
    expect(r.exif).toBeNull();
  });
  it('refuses empty input', async () => {
    await expect(canonicalizePhoto(Buffer.alloc(0), 'image/png', { useSharp: false })).rejects.toThrow(/No image bytes/);
  });
});

/* ---------- the real pipeline: needs sharp ---------- */

describe.skipIf(!sharp)('canonicalizePhoto with sharp', () => {
  const W = 400;
  const H = 300;

  it('is byte-identical across two runs of the same input', async () => {
    const png = await encodePng(pattern(W, H), W, H);
    const a = await canonicalizePhoto(png, 'image/png');
    const b = await canonicalizePhoto(Buffer.from(png), 'image/png');
    expect(a.method).toBe('sharp');
    expect(a.contentType).toBe('image/jpeg');
    expect(a.canonical.equals(b.canonical)).toBe(true);
    expect(a.sha256Canonical).toBe(b.sha256Canonical);
    expect(a.sha256Original).toBe(b.sha256Original);
    expect(a.sha256Canonical).toMatch(HEX64);
    expect(a.sha256Original).toMatch(HEX64);
    expect(a.sha256Original).toBe(sha256Hex(png));
    expect(a.sha256Canonical).toBe(sha256Hex(a.canonical));
    expect(a.sha256Canonical).not.toBe(a.sha256Original);
    expect([a.width, a.height]).toEqual([W, H]);
  });

  it('gives a rotated-by-EXIF input the same canonical bytes as its pre-rotated twin', async () => {
    const raw = pattern(W, H);
    const upright = await encodePng(raw, W, H);
    // Stored turned 90° anticlockwise, with orientation 6 ("rotate 90° clockwise to view").
    const turned = withPngExif(await encodePng(rotateCCW(raw, W, H), H, W), tiffExif({ orientation: 6 }));
    expect(sniffImage(turned)).toMatchObject({ width: H, height: W });

    const a = await canonicalizePhoto(upright, 'image/png');
    const b = await canonicalizePhoto(turned, 'image/png');
    expect([b.width, b.height]).toEqual([W, H]);
    expect(b.canonical.equals(a.canonical)).toBe(true);
    expect(b.sha256Canonical).toBe(a.sha256Canonical);
    // The originals still differ, and the EXIF says why.
    expect(b.sha256Original).not.toBe(a.sha256Original);
    expect(a.exif).toBeNull();
    expect(b.exif).toEqual({ orientation: 6 });
  });

  it('canonicalises a JPEG and a lossless copy of its decoded pixels to the same bytes', async () => {
    const jpeg = await encodeJpeg(pattern(W, H), W, H);
    const decoded = await withSharp()(jpeg).raw().toBuffer();
    const lossless = await encodePng(decoded, W, H);
    const a = await canonicalizePhoto(jpeg, 'image/jpeg');
    const b = await canonicalizePhoto(lossless, 'image/png');
    expect(b.canonical.equals(a.canonical)).toBe(true);
  });

  it('strips every metadata block and encodes baseline 4:2:0', async () => {
    const tagged = withJpegExif(await encodeJpeg(pattern(W, H), W, H), tiffExif(CAMERA));
    const r = await canonicalizePhoto(tagged, 'image/jpeg');
    const meta = await withSharp()(r.canonical).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.isProgressive).toBe(false);
    expect(meta.chromaSubsampling).toBe('4:2:0');
    expect(embeddedExif(r.canonical)).toBeNull();
  });

  it('reads the EXIF before stripping it', async () => {
    const tagged = withJpegExif(await encodeJpeg(pattern(W, H), W, H), tiffExif(CAMERA, 'MM'));
    const r = await canonicalizePhoto(tagged, 'image/jpeg');
    expect(r.exif).toEqual(CAMERA_PARSED);
    expect(Object.keys(r.exif!)).toEqual(['capturedAt', 'focalLength', 'focalLength35', 'make', 'model', 'orientation']);
  });

  it('fits a 4000 px input inside 2048 and never upscales a 1000 px one', async () => {
    const big = await canonicalizePhoto(await encodeJpeg(pattern(4000, 3000), 4000, 3000, 80), 'image/jpeg');
    expect([big.width, big.height]).toEqual([CANONICAL_LONG_SIDE, 1536]);
    const tall = await canonicalizePhoto(await encodeJpeg(pattern(1500, 3000), 1500, 3000, 80), 'image/jpeg');
    expect([tall.width, tall.height]).toEqual([1024, CANONICAL_LONG_SIDE]);
    const small = await canonicalizePhoto(await encodePng(pattern(1000, 700), 1000, 700), 'image/png');
    expect([small.width, small.height]).toEqual([1000, 700]);
    expect(sniffImage(small.canonical)).toMatchObject({ mime: 'image/jpeg', width: 1000, height: 700 });
  }, 30_000);

  it('rejects bytes it cannot decode rather than passing them through', async () => {
    await expect(canonicalizePhoto(Buffer.from('definitely not an image'), 'image/jpeg')).rejects.toBeInstanceOf(UnreadablePhotoError);
    const truncated = (await encodeJpeg(pattern(W, H), W, H)).subarray(0, 400);
    await expect(canonicalizePhoto(truncated, 'image/jpeg')).rejects.toBeInstanceOf(UnreadablePhotoError);
  });

  it('still takes the passthrough path on request', async () => {
    const png = await encodePng(pattern(W, H), W, H);
    const r = await canonicalizePhoto(png, 'image/png', { useSharp: false });
    expect(r.method).toBe('passthrough');
    expect(r.canonical.equals(png)).toBe(true);
  });
});
