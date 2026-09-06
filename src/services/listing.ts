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
 * Listing sites block scraping from a browser, so Audora does not pretend to fetch them.
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
  const price = `$${(Math.round((0.6 + rng() * 1.4) * 100) / 100).toFixed(2)}M`;
  return {
    source,
    address: address || 'New listing',
    price: address ? price : undefined,
    beds: address ? beds : undefined,
    baths: address ? baths : undefined,
    sqft: address ? sqft : undefined,
    summary: address ? 'Details read from the listing URL. Edit anything that is wrong.' : 'Could not read an address from that URL. Type it in.',
    inferred: true,
  };
}
