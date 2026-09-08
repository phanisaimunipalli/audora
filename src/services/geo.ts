/**
 * Where the unit is on the planet, and which way its walls face.
 *
 * - Geocoding: OpenStreetMap Nominatim (free; identify yourself with a User-Agent; ≤1 req/s).
 * - Building footprint: OSM via Overpass (free, best effort). The footprint's longest edge gives the
 *   building's principal heading, which the leasing team confirms with a compass control.
 * Everything here is optional: a tour with no location simply has no real sun.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
  displayName: string;
  osmType?: string;
  osmId?: number;
}

export interface Footprint {
  /** [lat, lon] ring */
  ring: [number, number][];
  /** Compass bearing (deg, clockwise from north) of the longest wall, 0–180. */
  principalHeading: number;
  heightM?: number;
  levels?: number;
  tags: Record<string, string>;
}

const UA = 'Audora/0.1 (real-estate staging demo; contact via github.com/phanisaimunipalli/audora)';

export async function geocode(address: string, signal?: AbortSignal): Promise<GeoPoint | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`;
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal });
  if (!r.ok) return null;
  const data: any[] = await r.json();
  if (!data.length) return null;
  const d = data[0];
  return { lat: Number(d.lat), lon: Number(d.lon), displayName: String(d.display_name || address), osmType: d.osm_type, osmId: d.osm_id ? Number(d.osm_id) : undefined };
}

/** Bearing from a to b in degrees clockwise from north. */
export function bearing(a: [number, number], b: [number, number]): number {
  const [lat1, lon1] = a.map((v) => (v * Math.PI) / 180);
  const [lat2, lon2] = b.map((v) => (v * Math.PI) / 180);
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Metres between two points (haversine). */
export function distanceM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Principal heading of a footprint ring: the bearing (mod 180) of its longest edge. */
export function principalHeading(ring: [number, number][]): number {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < ring.length - 1; i++) {
    const len = distanceM(ring[i], ring[i + 1]);
    if (len > bestLen) {
      bestLen = len;
      best = bearing(ring[i], ring[i + 1]) % 180;
    }
  }
  return best;
}

export async function buildingFootprint(lat: number, lon: number, radiusM = 20, signal?: AbortSignal): Promise<Footprint | null> {
  const q = `[out:json][timeout:20];way(around:${radiusM},${lat},${lon})["building"];out geom 3;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`, signal });
  if (!r.ok) return null;
  const data: any = await r.json();
  const ways: any[] = (data.elements || []).filter((e: any) => Array.isArray(e.geometry) && e.geometry.length >= 4);
  if (!ways.length) return null;
  // Prefer the footprint that actually contains / is nearest to the point.
  const pick = ways
    .map((w) => {
      const ring: [number, number][] = w.geometry.map((g: any) => [Number(g.lat), Number(g.lon)]);
      const c = ring.reduce((acc, p) => [acc[0] + p[0] / ring.length, acc[1] + p[1] / ring.length], [0, 0]) as [number, number];
      return { w, ring, dist: distanceM(c, [lat, lon]) };
    })
    .sort((a, b) => a.dist - b.dist)[0];
  const tags = pick.w.tags || {};
  return {
    ring: pick.ring,
    principalHeading: principalHeading(pick.ring),
    heightM: tags.height ? Number(String(tags.height).replace(/[^\d.]/g, '')) || undefined : undefined,
    levels: tags['building:levels'] ? Number(tags['building:levels']) || undefined : undefined,
    tags,
  };
}

/** Static OSM tile URL for a small map thumbnail (attribution: © OpenStreetMap contributors). */
export function osmTileUrl(lat: number, lon: number, zoom = 18): string {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}
