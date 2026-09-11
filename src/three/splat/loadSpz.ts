/**
 * Downloading a `.spz` with byte progress and a way to cancel it.
 *
 * Spark's `SplatMesh({ url })` fetches the file itself, but that fetch cannot be aborted and reports
 * nothing until it is done — so a renter who switches rooms mid-download keeps paying for 23 MB they
 * will never see, and the HUD has nothing to say meanwhile. Fetching the bytes ourselves and handing
 * them to `SplatMesh({ fileBytes })` gives us both, and costs nothing: Spark parses from memory.
 */

/* ---------- the container, checked before Spark is handed it ----------
 * A `.spz` is a 16-byte little-endian header — magic `NGSP`, version, numPoints, shDegree — in
 * front of a fixed number of bytes per point (tests/support/spz.ts documents the format and pins
 * this arithmetic against a real Marble file). Real files arrive GZIPPED, and Spark inflates them
 * itself; those we cannot check cheaply, and a corrupt one fails inside the inflater, which is a
 * thrown error the caller already handles.
 *
 * An UNCOMPRESSED file we can check, and must: `SplatMesh` trusts `numPoints` and allocates for it
 * before it ever looks at how many bytes there are. A 200-byte file whose header happens to read
 * 4,029,657,789 points — which is exactly what a stub or a truncated download looks like — asks for
 * about 60 GB and takes the tab with it. Refusing it here turns a frozen browser into an error the
 * layer reports and recovers from, with the measured room still on screen. */

const SPZ_HEADER_BYTES = 16;
/** Bytes every point costs at shDegree 0: position 9, alpha 1, colour 3, scale 3, rotation 3. */
const MIN_BYTES_PER_SPLAT = 19;

function isUncompressedSpz(b: Uint8Array): boolean {
  // 'N' 'G' 'S' 'P'. A gzip stream starts 0x1f 0x8b and is left to Spark.
  return b.length >= SPZ_HEADER_BYTES && b[0] === 0x4e && b[1] === 0x47 && b[2] === 0x53 && b[3] === 0x50;
}

/** Throw when the header promises more points than the file could possibly hold. */
function assertPlausible(url: string, bytes: Uint8Array): void {
  if (!isUncompressedSpz(bytes)) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numPoints = view.getUint32(8, true);
  const smallest = SPZ_HEADER_BYTES + numPoints * MIN_BYTES_PER_SPLAT;
  if (smallest > bytes.byteLength) {
    const name = url.split('?')[0].split('/').pop() || url;
    throw new Error(`${name} is not a usable splat file: its header claims ${numPoints.toLocaleString('en-US')} splats, which cannot fit in ${bytes.byteLength} bytes`);
  }
}

export interface SpzProgress {
  loaded: number;
  /** 0 when the server sends no content-length. */
  total: number;
  /** 0..1, or null when the length is unknown. */
  ratio: number | null;
}

export interface SpzFile {
  bytes: Uint8Array;
  /** Wall-clock milliseconds the download took — what decides whether full res is worth fetching. */
  ms: number;
}

export interface LoadSpzOptions {
  signal?: AbortSignal;
  onProgress?: (p: SpzProgress) => void;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Fetch one splat file. Reports whole-percent progress only — a 23 MB file arrives in thousands of
 * chunks and re-rendering the HUD on each of them is how a loading indicator ends up costing more
 * than the load.
 */
export async function loadSpz(url: string, opts: LoadSpzOptions = {}): Promise<SpzFile> {
  const { signal, onProgress, fetchImpl = fetch, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = opts;
  const started = now();
  const res = await fetchImpl(url, { mode: 'cors', signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'could not fetch the capture'}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let bytes: Uint8Array;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let lastPct = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      loaded += value.byteLength;
      const pct = total ? Math.floor((loaded / total) * 100) : -1;
      if (pct !== lastPct) {
        lastPct = pct;
        onProgress?.({ loaded, total, ratio: total ? Math.min(1, loaded / total) : null });
      }
    }
    bytes = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
    onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength, ratio: 1 });
  }
  assertPlausible(url, bytes);
  return { bytes, ms: now() - started };
}
