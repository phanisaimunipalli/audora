/**
 * Downloading a `.spz` with byte progress and a way to cancel it.
 *
 * Spark's `SplatMesh({ url })` fetches the file itself, but that fetch cannot be aborted and reports
 * nothing until it is done — so a buyer who switches rooms mid-download keeps paying for 23 MB they
 * will never see, and the HUD has nothing to say meanwhile. Fetching the bytes ourselves and handing
 * them to `SplatMesh({ fileBytes })` gives us both, and costs nothing: Spark parses from memory.
 */

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
  return { bytes, ms: now() - started };
}
