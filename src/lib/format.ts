/**
 * One place for units. A number and its unit are separated by a space everywhere ("0.78 m", "±4 cm"):
 * mixing "0.78m" and "0.78 m" across screens made the numbers look like different kinds of fact.
 */
export const m = (v: number, dp = 2) => `${v.toFixed(dp)} m`;
export const cm = (v: number) => `${Math.round(v * 100)} cm`;
export const m2 = (v: number) => `${v.toFixed(1)} m²`;
/** "±4 cm" under a metre, "±0.35 m" above it. */
export const uncertainty = (v: number) => (v < 1 ? `±${Math.max(1, Math.round(v * 100))} cm` : `±${v.toFixed(2)} m`);
export const pct = (v: number) => `${Math.round(v)}%`;
export const usd = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}
export function eta(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  const mins = Math.round(seconds / 60);
  return `about ${mins} minute${mins === 1 ? '' : 's'}`;
}
export function dimsLabel(w: number, d: number, h?: number): string {
  const a = `${Math.round(w * 100)} × ${Math.round(d * 100)}`;
  return h && h > 0.05 ? `${a} × ${Math.round(h * 100)} cm` : `${a} cm`;
}
export const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
/** "1 test", "2 tests"; pass an explicit plural for irregular words. */
export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

/**
 * `Tour.availableFrom` ("2026-10-01") as a renter reads it: "1 October 2026", or "1 October" when
 * the date is inside the next eleven months, where the year adds nothing. Parsed by hand rather
 * than with `new Date(iso)` so it is the calendar date and not the browser's timezone shifted off
 * it. Anything that is not an ISO date comes back verbatim — an older store may hold "1 October".
 */
export function availableLabel(iso: string | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso.trim() || null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (Number.isNaN(date.getTime())) return iso;
  const withinTheYear = date.getTime() - now.getTime() < 330 * 86400e3 && date.getFullYear() >= now.getFullYear();
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(withinTheYear ? {} : { year: 'numeric' }) });
}
