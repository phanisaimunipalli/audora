/// <reference types="node" />
/**
 * A reader for the SPZ container — enough of it to prove that a file we stored or served really is
 * Gaussian splat data rather than "some bytes with the right extension".
 *
 * SPZ is Niantic's open Gaussian-splat format (github.com/nianticlabs/spz). A `.spz` file is a
 * **gzip stream**; inside it is a 16-byte little-endian header followed by the packed point data:
 *
 * ```
 * offset size field
 *      0    4 magic          0x5053474e — the ASCII bytes "NGSP" (Niantic gaussian splat)
 *      4    4 version        1 or 2
 *      8    4 numPoints
 *     12    1 shDegree       0..3 spherical-harmonic degree
 *     13    1 fractionalBits fixed-point bits of the 24-bit positions (12 in every file we have)
 *     14    1 flags          bit 0 = antialiased
 *     15    1 reserved
 * ```
 *
 * In version 2 every point costs a fixed number of bytes, so the payload length is a function of
 * the header alone — which is the strongest cheap check there is that the bytes are the splats the
 * header claims and not a truncated or re-encoded file. {@link spzPayloadBytes} is that function.
 *
 * Dependency-free apart from `node:zlib`; nothing here fetches anything.
 */
import { gunzipSync } from 'node:zlib';

/** `0x5053474e`, which is the bytes `N G S P` read little-endian. */
export const SPZ_MAGIC = 0x5053474e;
export const SPZ_MAGIC_ASCII = 'NGSP';
export const SPZ_HEADER_BYTES = 16;

export interface SpzHeader {
  magic: number;
  /** The magic as the four ASCII characters it is, for a readable failure message. */
  magicAscii: string;
  version: number;
  numPoints: number;
  shDegree: number;
  fractionalBits: number;
  flags: number;
  reserved: number;
}

/** Whether these bytes start a gzip stream — which every real `.spz` file does. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** The uncompressed container: gunzipped when it is gzipped, and taken as-is when it is not. */
export function spzPayload(bytes: Uint8Array): Buffer {
  return isGzip(bytes) ? gunzipSync(bytes) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** How many spherical-harmonic coefficients a degree carries (0, 3, 8 or 15 per colour channel). */
export function shDim(degree: number): number {
  return [0, 3, 8, 15][degree] ?? -1;
}

/**
 * The exact payload length a version-2 file with this header must have: the 16-byte header, then
 * per point 9 bytes of position, 1 of alpha, 3 of colour, 3 of scale, 3 of rotation, and three
 * bytes per spherical-harmonic coefficient.
 */
export function spzPayloadBytes(header: Pick<SpzHeader, 'numPoints' | 'shDegree'>): number {
  return SPZ_HEADER_BYTES + header.numPoints * (9 + 1 + 3 + 3 + 3 + shDim(header.shDegree) * 3);
}

/**
 * Read the header of an SPZ file. Takes the file exactly as it is stored or served (gzipped or
 * not) and throws when it is too short or does not carry the magic — a caller that wants to *test*
 * whether bytes are SPZ should use {@link looksLikeSpz}.
 */
export function readSpzHeader(file: Uint8Array): SpzHeader {
  const bytes = spzPayload(file);
  if (bytes.length < SPZ_HEADER_BYTES) throw new Error(`SPZ: ${bytes.length} bytes is shorter than the ${SPZ_HEADER_BYTES}-byte header`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const magicAscii = bytes.subarray(0, 4).toString('ascii');
  if (magic !== SPZ_MAGIC) throw new Error(`SPZ: magic is 0x${magic.toString(16)} (${JSON.stringify(magicAscii)}), not 0x${SPZ_MAGIC.toString(16)} ("NGSP")`);
  return {
    magic,
    magicAscii,
    version: view.getUint32(4, true),
    numPoints: view.getUint32(8, true),
    shDegree: bytes[12],
    fractionalBits: bytes[13],
    flags: bytes[14],
    reserved: bytes[15],
  };
}

/** The header, or null when these bytes are not an SPZ file at all. Never throws. */
export function looksLikeSpz(file: Uint8Array): SpzHeader | null {
  try {
    return readSpzHeader(file);
  } catch {
    return null;
  }
}

/** True when the bytes open with the four magic characters, gzip or no gzip. */
export function startsWithSpzMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && Buffer.from(bytes.buffer, bytes.byteOffset, 4).toString('ascii') === SPZ_MAGIC_ASCII;
}
