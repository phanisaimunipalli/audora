import { fnv1a, mulberry32 } from '@/lib/ids';

export interface ListingMeta {
  source: 'zillow' | 'redfin' | 'realtor' | 'rightmove' | 'other';
  address: string;
  price?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  summary?: string;
  /** True when the details are inferred from the URL, not scraped. */
  inferred: boolean;
}

export function detectSource(url: string): ListingMeta['source'] {
  const u = url.toLowerCase();
  if (u.includes('zillow.')) return 'zillow';
  if (u.includes('redfin.')) return 'redfin';
  if (u.includes('realtor.')) return 'realtor';
  if (u.includes('rightmove.')) return 'rightmove';
  return 'other';
}

const STREET_SUFFIX = /^(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pl|place|ter|terrace|cir|circle|pkwy|parkway|hwy|highway|sq|square|trl|trail|aly|alley|loop|row|walk)$/i;

/** "1247 Oak St San Francisco" → "1247 Oak St, San Francisco": the URL path has no comma, so put one after the street suffix. */
function streetComma(s: string): string {
  const words = s.split(' ');
  const i = words.findIndex((w, k) => k > 0 && k < words.length - 1 && STREET_SUFFIX.test(w));
  if (i < 0) return s;
  return `${words.slice(0, i + 1).join(' ')}, ${words.slice(i + 1).join(' ')}`;
}

/** Zillow and Redfin URLs carry the address in the path, e.g. /homedetails/1247-Oak-St-San-Francisco-CA-94117/12345_zpid/ */
export function addressFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const cand = segs.find((s) => /^\d+-[A-Za-z0-9-]+-[A-Z]{2}-\d{5}/.test(s)) || segs.find((s) => /^\d+-[A-Za-z]/.test(s));
    if (!cand) return undefined;
    const m = /^(.*)-([A-Z]{2})-(\d{5})/.exec(cand);
    if (m) return `${streetComma(m[1].replace(/-/g, ' '))}, ${m[2]} ${m[3]}`.replace(/\b([a-z])/g, (c) => c.toUpperCase());
    return cand.replace(/-/g, ' ');
  } catch {
    return undefined;
  }
}

/**
 * Marketplaces block scraping from a browser, so Audora does not pretend to fetch them.
 * It reads what the URL itself says and lets the user confirm the rest. A server-side
 * enrichment step (LinkUp, an MLS feed) can replace this without touching the UI.
 */
export function listingFromUrl(url: string): ListingMeta {
  const source = detectSource(url);
  const address = addressFromUrl(url);
  const rng = mulberry32(fnv1a(url));
  const beds = 2 + Math.floor(rng() * 3);
  const baths = 1 + Math.floor(rng() * 2);
  const sqft = 850 + Math.floor(rng() * 1400);
  /* Rent per month, not a sale price: this is a rental product (docs/COPY.md). */
  const price = `$${(2000 + Math.round((rng() * 3600) / 50) * 50).toLocaleString('en-US')}/mo`;
  return {
    source,
    address: address || 'New unit',
    price: address ? price : undefined,
    beds: address ? beds : undefined,
    baths: address ? baths : undefined,
    sqft: address ? sqft : undefined,
    summary: address ? 'Details read from the listing page URL. Edit anything that is wrong.' : 'Could not read an address from that URL. Type it in.',
    inferred: true,
  };
}

/* ---------- photos the leasing team copies out of its own listing page ----------
 *
 * Marketplaces do not let a browser read their photos (no CORS header) and Audora does not scrape
 * listing pages. What a leasing team *can* do is right-click the photos on its own listing and copy
 * the image addresses; those URLs come back through the dev server's `/api/fetch-image` proxy, one
 * at a time, with an 8 MB cap and a content-type check. It is the difference between a model built
 * from three phone photos and one built from the twenty a photographer was already paid for. */

export interface PhotoUrlResult {
  url: string;
  dataUrl?: string;
  bytes?: number;
  contentType?: string;
  error?: string;
}

/**
 * One URL per line, as pasted. Lines are split first and only split again on whitespace when a line
 * carries more than one URL, so a single address is never torn in half by a stray space.
 * Anything that is not an http(s) URL is dropped; duplicates are dropped too.
 */
export function parsePhotoUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/[\r\n,]+/)) {
    const parts = (line.match(/https?:\/\//gi)?.length ?? 0) > 1 ? line.split(/\s+/) : [line];
    for (const raw of parts) {
      const s = raw.trim().replace(/\s+/g, '').replace(/[),.;]+$/, '');
      if (!/^https?:\/\//i.test(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** True when a URL looks like the photo itself rather than the listing page around it. */
export function looksLikeImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (/\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(`${u.pathname}${u.search}`)) return true;
    return /(zillowstatic|cdn-redfin|rdcpix|compass|rightmove|zoocdn|sparkplatform|cloudfront)\./i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Fetch one photo through the server proxy. Never throws; the error is on the result. */
export async function fetchPhotoUrl(url: string, signal?: AbortSignal): Promise<PhotoUrlResult> {
  try {
    const r = await fetch(`/api/fetch-image?url=${encodeURIComponent(url)}`, { signal });
    const body = await r.json();
    if (!r.ok) return { url, error: body?.error || `Could not fetch that photo (${r.status})` };
    return { url, dataUrl: body.dataUrl, bytes: body.bytes, contentType: body.contentType };
  } catch (e: any) {
    return { url, error: e?.name === 'AbortError' ? 'Cancelled' : e?.message || 'Could not fetch that photo' };
  }
}

/** Fetch a batch, in order, reporting each as it lands. */
export async function fetchPhotoUrls(urls: string[], onEach?: (r: PhotoUrlResult, i: number) => void): Promise<PhotoUrlResult[]> {
  const out: PhotoUrlResult[] = [];
  for (const [i, url] of urls.entries()) {
    const r = await fetchPhotoUrl(url);
    out.push(r);
    onEach?.(r, i);
  }
  return out;
}
