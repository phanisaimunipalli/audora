/**
 * Step 2 of the create flow: where on the planet this listing is, and which way its windows face.
 *
 * Everything here is free and public: the address is geocoded with OpenStreetMap **Nominatim**
 * (throttled to one request a second, as their policy asks), the building outline comes from OSM
 * via **Overpass**, and the map is OSM raster tiles — "© OpenStreetMap contributors" wherever any of
 * it is shown. When a ShadeMap key is configured (`VITE_SHADEMAP_KEY`) the map also draws real
 * terrain and building shadows, so "does this window get afternoon sun?" is answered with the
 * neighbours' rooftops in it rather than with an open-field model.
 *
 * The one thing a map cannot know is which way the *room* is turned. The footprint's longest wall
 * gives a first guess (`defaultHeading`), snapped to the building's own axes; the seller drags the
 * needle to confirm it. That heading is the whole contract with `three/SunLight`: turn the room by
 * it and the sun in the scene is the sun that will be in the room.
 */
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { WallSide } from '@/engine/types';
import { sunPosition, sunlitWalls } from '@/engine/sun';
import { clockLabel, compassAbbr, compassLabel, dateFromInput, dateInputValue, defaultHeading, dominantWindowWall, facingToHeading, headingToFacing, minutesOfDay, norm360, snapHeading, sunState, wallBearing, withMinutes } from '@/engine/siteSun';
import { buildingFootprint, geocode, type Footprint } from '@/services/geo';
import type { TourSite, WindowSunStrip } from '@/state/types';
import { Button, Callout, Card, Chip, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { AnchorChip } from '@/components/AnchorChip';
import { anchorAssumed } from '@/engine/anchor';
import type { DraftListing, DraftRoom } from './types';

const SHADEMAP_KEY = (import.meta.env.VITE_SHADEMAP_KEY as string | undefined) || '';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
/** Free AWS Terrarium DEM, the terrain source ShadeMap's own examples use. */
const TERRAIN = {
  maxZoom: 15,
  tileSize: 256,
  getSourceUrl: ({ x, y, z }: { x: number; y: number; z: number }) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  getElevation: ({ r, g, b }: { r: number; g: number; b: number }) => r * 256 + g + b / 256 - 32768,
};

/* Nominatim asks for at most one request a second. One module-level gate, shared by every mount. */
let nominatimGate = 0;
async function politePause(): Promise<void> {
  const wait = Math.max(0, nominatimGate + 1100 - Date.now());
  nominatimGate = Date.now() + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/* ------------------------------------------------------------------ geometry on the ground */

type LatLon = { lat: number; lon: number };

function centroid(ring: [number, number][]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const p of ring) {
    lat += p[0];
    lon += p[1];
  }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

/**
 * Where a ray leaves the footprint: from the centre of the building, out along a compass bearing,
 * to the wall. That is the point a window on that wall actually stands at, which is the point
 * ShadeMap has to be asked about.
 */
export function edgePoint(ring: [number, number][], from: LatLon, bearingDeg: number, outsetM = 1): LatLon {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((from.lat * Math.PI) / 180);
  const a = (bearingDeg * Math.PI) / 180;
  const ux = Math.sin(a); // east
  const uy = Math.cos(a); // north
  let best = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p = { x: (ring[i][1] - from.lon) * mLon, y: (ring[i][0] - from.lat) * mLat };
    const q = { x: (ring[i + 1][1] - from.lon) * mLon, y: (ring[i + 1][0] - from.lat) * mLat };
    const sx = q.x - p.x;
    const sy = q.y - p.y;
    const den = ux * sy - uy * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = (p.x * sy - p.y * sx) / den; // along the ray
    const u = (p.x * uy - p.y * ux) / den; // along the segment, 0..1
    if (t > 0 && u >= 0 && u <= 1 && t > best) best = t;
  }
  const d = (best || 4) + outsetM;
  return { lat: from.lat + (uy * d) / mLat, lon: from.lon + (ux * d) / mLon };
}

/** Metres a building of these tags stands: an explicit height, else levels × 3 m, else 6 m. */
function buildingHeight(tags: Record<string, string> | undefined): number {
  const h = Number(String(tags?.height ?? '').replace(/[^\d.]/g, ''));
  if (Number.isFinite(h) && h > 0) return h;
  const levels = Number(tags?.['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return levels * 3;
  return 6;
}

type GeoFeature = { type: 'Feature'; geometry: { type: 'Polygon'; coordinates: number[][][] }; properties: Record<string, unknown> };

/**
 * Every building around the listing, as GeoJSON with heights — what ShadeMap casts shadows from.
 * `services/geo.buildingFootprint` answers "which building is this?"; this answers "what else is
 * standing near it?", which is the difference between a sun model and a shade map.
 */
async function neighbourFootprints(lat: number, lon: number, radiusM = 180, signal?: AbortSignal): Promise<GeoFeature[]> {
  const q = `[out:json][timeout:25];way(around:${radiusM},${lat},${lon})["building"];out geom;`;
  const r = await fetch(OVERPASS, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`, signal });
  if (!r.ok) return [];
  const data: any = await r.json();
  const out: GeoFeature[] = [];
  for (const el of data.elements || []) {
    if (!Array.isArray(el.geometry) || el.geometry.length < 4) continue;
    const coords = el.geometry.map((g: any) => [Number(g.lon), Number(g.lat)]);
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) coords.push(coords[0]);
    const height = buildingHeight(el.tags);
    out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: { height, render_height: height, min_height: 0, levels: el.tags?.['building:levels'] } });
  }
  return out;
}

/* ------------------------------------------------------------------ windows to sample */

interface WindowSample {
  key: string;
  roomName: string;
  wall: WallSide;
  bearing: number;
  lat: number;
  lon: number;
  /** The room has no detected windows yet; this is the wall the seller pointed the compass at. */
  assumed: boolean;
}

/** The windows to ask about, on the footprint edge, capped so a big listing does not melt the map. */
export function windowSamples(rooms: DraftRoom[], heading: number, site: LatLon, ring?: [number, number][], max = 6): WindowSample[] {
  const from = ring && ring.length > 3 ? centroid(ring) : site;
  const out: WindowSample[] = [];
  for (const room of rooms) {
    const windows = room.raw.windows ?? [];
    const walls: { wall: WallSide; assumed: boolean }[] = windows.length
      ? [...new Set(windows.map((w) => w.wall))].map((wall) => ({ wall, assumed: false }))
      : [{ wall: 'north' as WallSide, assumed: true }];
    for (const { wall, assumed } of walls) {
      if (out.length >= max) return out;
      const bearing = wallBearing(wall, heading);
      const p = ring && ring.length > 3 ? edgePoint(ring, from, bearing) : { lat: site.lat + Math.cos((bearing * Math.PI) / 180) * 0.00005, lon: site.lon + Math.sin((bearing * Math.PI) / 180) * 0.00005 };
      out.push({ key: `${room.id}:${wall}`, roomName: room.name, wall, bearing, lat: p.lat, lon: p.lon, assumed });
    }
  }
  return out;
}

/** Audora's own answer: the wall faces the sun and the sun is up. No neighbours in it. */
function modelStrip(sample: WindowSample, day: Date, site: LatLon, heading: number): boolean[] {
  return Array.from({ length: 24 }, (_, h) => {
    const at = withMinutes(day, h * 60 + 30);
    return sunlitWalls(sunPosition(at, site.lat, site.lon), heading).includes(sample.wall);
  });
}

/** "sun 09:30–15:30 · 6 h" — the honest summary of a strip. */
export function stripSummary(hours: boolean[]): string {
  const on = hours.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (!on.length) return 'no direct sun';
  return `${String(on[0]).padStart(2, '0')}:30–${String(on[on.length - 1]).padStart(2, '0')}:30 · ${on.length} h`;
}

/* ------------------------------------------------------------------ the step */

export interface StepSiteProps {
  listing: DraftListing;
  rooms: DraftRoom[];
  site: TourSite | null;
  onChange: (site: TourSite | null) => void;
}

type Busy = 'idle' | 'geocode' | 'footprint' | 'shade';

export function StepSite({ listing, rooms, site, onChange }: StepSiteProps) {
  const [address, setAddress] = useState(site?.displayName || listing.address);
  const [point, setPoint] = useState<{ lat: number; lon: number; displayName: string } | null>(site ? { lat: site.lat, lon: site.lon, displayName: site.displayName } : null);
  const [footprint, setFootprint] = useState<Footprint | null>(
    site?.footprint ? { ring: site.footprint.ring, principalHeading: site.footprint.principalHeading, heightM: site.footprint.heightM, levels: site.footprint.levels, tags: {} } : null,
  );
  const [heading, setHeading] = useState<number>(site?.heading ?? 0);
  const [date, setDate] = useState<Date>(() => new Date(site?.previewTime ?? Date.now()));
  const [strip, setStrip] = useState<WindowSunStrip[] | null>(site?.windowSun ?? null);
  const [busy, setBusy] = useState<Busy>('idle');
  const [shadeProgress, setShadeProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [shade, setShade] = useState<'off' | 'loading' | 'on' | 'failed'>(SHADEMAP_KEY ? 'loading' : 'off');

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const shadeRef = useRef<any>(null);
  const featuresRef = useRef<GeoFeature[]>([]);
  const abort = useRef<AbortController | null>(null);
  const searched = useRef(false);
  /** The window wall as it stands when a lookup lands; `find` must not be re-made for it. */
  const wallRef = useRef<WallSide>('north');

  const sky = useMemo(() => (point ? sunState(date, point.lat, point.lon, heading) : null), [point, date, heading]);
  /* The seller answers "which way do the windows face?"; the engine wants the room's north-wall
     bearing. The rooms say which wall the windows are on, and `facingToHeading` turns one into the
     other — without it a room whose windows are on its west wall ends up lit through its north one. */
  const windowWall = useMemo(() => dominantWindowWall(rooms.flatMap((r) => (r.raw.windows ?? []).map((w) => w.wall))), [rooms]);
  const facing = headingToFacing(heading, windowWall);
  const setFacing = useCallback((f: number) => setHeading(facingToHeading(f, windowWall)), [windowWall]);
  const samples = useMemo(() => (point ? windowSamples(rooms, heading, point, footprint?.ring) : []), [rooms, heading, point, footprint]);
  wallRef.current = windowWall;

  /* ---------- the address ---------- */

  const find = useCallback(
    async (q: string) => {
      const query = q.trim();
      if (!query) return;
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setError(null);
      setBusy('geocode');
      try {
        await politePause();
        if (ac.signal.aborted) return;
        const p = await geocode(query, ac.signal);
        if (ac.signal.aborted) return;
        if (!p) {
          setError('OpenStreetMap has no match for that address. Try the street and city on their own.');
          setBusy('idle');
          return;
        }
        setPoint({ lat: p.lat, lon: p.lon, displayName: p.displayName });
        setStrip(null);
        setBusy('footprint');
        const f = await buildingFootprint(p.lat, p.lon, 30, ac.signal).catch(() => null);
        if (ac.signal.aborted) return;
        setFootprint(f);
        setHeading((h) => (site?.heading != null && p.lat === site.lat ? h : facingToHeading(defaultHeading(f?.principalHeading), wallRef.current)));
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(e?.message || 'Could not reach OpenStreetMap.');
      } finally {
        setBusy('idle');
      }
    },
    [site?.heading, site?.lat],
  );

  // Look the listing's own address up once, so the step opens with the map already on the building.
  useEffect(() => {
    if (searched.current || site || !address.trim()) return;
    searched.current = true;
    void find(address);
  }, [address, site, find]);

  /* Abort an in-flight lookup when the step goes away — and hand the "already looked up" guard back,
     because in StrictMode the first mount's cleanup runs before the second mount's effect and would
     otherwise cancel the only lookup that was ever going to happen. */
  useEffect(
    () => () => {
      abort.current?.abort();
      searched.current = false;
    },
    [],
  );

  /* ---------- the map ---------- */

  useEffect(() => {
    if (!point || !mapDiv.current || mapRef.current) return;
    const map = L.map(mapDiv.current, { center: [point.lat, point.lon], zoom: 18, zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // The panel animates in and the card grows with the column beside it; Leaflet only ever measures
    // when it is told to, so it is told whenever the box changes size.
    const t = window.setTimeout(() => map.invalidateSize(), 120);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    if (mapDiv.current) ro?.observe(mapDiv.current);
    return () => {
      window.clearTimeout(t);
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      shadeRef.current = null;
    };
  }, [point]);

  // The point and the outline.
  useEffect(() => {
    const map = mapRef.current;
    const group = layersRef.current;
    if (!map || !group || !point) return;
    group.clearLayers();
    L.circleMarker([point.lat, point.lon], { radius: 5, color: '#0a0a0a', weight: 2, fillColor: '#0a0a0a', fillOpacity: 0.9 }).addTo(group);
    if (footprint?.ring?.length) {
      const poly = L.polygon(footprint.ring as [number, number][], { color: '#0a0a0a', weight: 2, fillColor: '#0a0a0a', fillOpacity: 0.1 }).addTo(group);
      map.fitBounds(poly.getBounds().pad(0.6), { animate: false });
    } else {
      map.setView([point.lat, point.lon], 18, { animate: false });
    }
  }, [point, footprint]);

  // Where each window sits on the footprint, and which way it looks.
  useEffect(() => {
    const group = layersRef.current;
    if (!group || !samples.length) return;
    const marks = samples.map((s) =>
      L.circleMarker([s.lat, s.lon], { radius: 4, color: '#1d63ff', weight: 2, fillColor: '#1d63ff', fillOpacity: 0.85 })
        .bindTooltip(`${s.roomName} · ${s.wall} wall · faces ${compassLabel(s.bearing)}`)
        .addTo(group),
    );
    return () => marks.forEach((m) => group.removeLayer(m));
  }, [samples]);

  /* ---------- ShadeMap ---------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !SHADEMAP_KEY || !point) return;
    let dead = false;
    let inst: any = null;
    (async () => {
      try {
        const ac = new AbortController();
        featuresRef.current = await neighbourFootprints(point.lat, point.lon, 180, ac.signal).catch(() => []);
        const mod = await import('leaflet-shadow-simulator');
        if (dead) return;
        const ShadeMap: any = (mod as any).default ?? mod;
        inst = new ShadeMap({
          apiKey: SHADEMAP_KEY,
          date,
          color: '#062035',
          opacity: 0.66,
          terrainSource: TERRAIN,
          getFeatures: async () => featuresRef.current as any,
        }).addTo(map);
        shadeRef.current = inst;
        setShade('on');
      } catch {
        if (!dead) setShade('failed');
      }
    })();
    return () => {
      dead = true;
      try {
        inst?.onRemove?.();
      } catch {
        /* the layer is going away with the map anyway */
      }
      shadeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point]);

  // The shadow layer follows the hour slider.
  useEffect(() => {
    try {
      shadeRef.current?.setDate(date);
    } catch {
      /* the layer reports its own failures through `shade` */
    }
  }, [date]);

  /* ---------- the hourly strip ---------- */

  const runStrip = useCallback(
    async (withShade: boolean) => {
      if (!point || !samples.length) return;
      setBusy('shade');
      setShadeProgress(0);
      const rows: WindowSunStrip[] = samples.map((s) => ({ roomName: s.roomName, wall: s.wall, bearing: s.bearing, hours: modelStrip(s, date, point, heading), source: 'model' }));
      const layer = withShade ? shadeRef.current : null;
      if (layer) {
        try {
          for (let h = 0; h < 24; h++) {
            const at = withMinutes(date, h * 60 + 30);
            layer.setDate(at);
            await settled(layer);
            for (let i = 0; i < samples.length; i++) {
              if (!rows[i].hours[h]) continue; // the wall is not facing the sun: no shadow can change that
              const inSun = await layer.isPositionInSun(samples[i].lat, samples[i].lon).catch(() => true);
              rows[i].hours[h] = Boolean(inSun);
            }
            setShadeProgress(Math.round(((h + 1) / 24) * 100));
          }
          // The whole day went through the shadow layer, so every row is now a shade map — including
          // the rows it darkened all the way to nothing.
          for (const row of rows) row.source = 'shademap';
        } catch {
          /* keep whatever hours we did resolve; the source says which model they came from */
        } finally {
          try {
            layer.setDate(date);
          } catch {
            /* nothing to restore */
          }
        }
      }
      setStrip(rows);
      setBusy('idle');
      setShadeProgress(0);
    },
    [point, samples, date, heading],
  );

  // Audora's own strip is instant, so it is always on screen; ShadeMap refines it on request.
  useEffect(() => {
    if (!point || !samples.length) return;
    setStrip((prev) => (prev && prev.length === samples.length && prev.every((r, i) => r.wall === samples[i].wall) && prev.some((r) => r.source === 'shademap') ? prev : samples.map((s) => ({ roomName: s.roomName, wall: s.wall, bearing: s.bearing, hours: modelStrip(s, date, point, heading), source: 'model' as const }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point, samples, heading, dateInputValue(date)]);

  /* ---------- push the site up ---------- */

  const value: TourSite | null = useMemo(
    () =>
      point
        ? {
            lat: point.lat,
            lon: point.lon,
            displayName: point.displayName,
            heading: norm360(heading),
            /* The wall the seller's answer was expressed against. Without it the hub re-reads the
               wall off a room list that has grown since (the floor plan adds rooms, so do photos)
               and can report "east" for the west the seller confirmed here. */
            windowWall,
            previewTime: date.getTime(),
            resolvedAt: Date.now(),
            ...(footprint ? { footprint: { ring: footprint.ring, principalHeading: footprint.principalHeading, heightM: footprint.heightM, levels: footprint.levels } } : {}),
            ...(strip ? { windowSun: strip } : {}),
          }
        : null,
    [point, heading, windowWall, date, footprint, strip],
  );
  const push = useRef(onChange);
  push.current = onChange;
  const key = useMemo(() => JSON.stringify(value && { ...value, resolvedAt: 0 }), [value]);
  useEffect(() => {
    push.current(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /* ---------- render ---------- */

  const minutes = minutesOfDay(date);
  const busyLabel = busy === 'geocode' ? 'Looking the address up on OpenStreetMap…' : busy === 'footprint' ? 'Reading the building outline from Overpass…' : busy === 'shade' ? `Walking the day through ShadeMap… ${shadeProgress}%` : null;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-2">Address</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void find(address);
                  }
                }}
                placeholder="1247 Oak St, San Francisco, CA 94117"
                className="h-10 w-full rounded-[10px] border border-line-2 bg-bg px-3 text-sm text-ink placeholder:text-faint outline-none transition-colors focus:border-ink focus:ring-[3px] focus:ring-accent-soft"
              />
              <Button variant="secondary" onClick={() => void find(address)} loading={busy === 'geocode' || busy === 'footprint'} className="shrink-0">
                <Icon.Home size={15} /> Find on the map
              </Button>
            </div>
            <span className="text-xs text-ink-3">
              Geocoded with OpenStreetMap Nominatim, one request a second. <span className="mono">{OSM_ATTRIBUTION}</span>
            </span>
          </div>

          {busyLabel ? (
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <Icon.Clock size={13} /> {busyLabel}
            </div>
          ) : null}
          {error ? <Callout tone="warn">{error}</Callout> : null}

          {point ? (
            <div className="flex flex-wrap items-center gap-2">
              <Chip mono className="!text-[11px]">
                {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
              </Chip>
              {footprint ? (
                <Chip mono className="!text-[11px]">
                  footprint · {footprint.ring.length - 1} corners · axis {Math.round(footprint.principalHeading)}°
                </Chip>
              ) : (
                <Chip mono tone="warn" className="!text-[11px]">
                  no building outline in OSM here
                </Chip>
              )}
              {footprint?.heightM ? <Chip mono className="!text-[11px]">{footprint.heightM.toFixed(1)} m tall</Chip> : footprint?.levels ? <Chip mono className="!text-[11px]">{footprint.levels} levels</Chip> : null}
              <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{point.displayName}</span>
            </div>
          ) : null}
        </div>
      </Card>

      {point ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card className="!p-0 overflow-hidden">
            {/* The map fills its column: the compass and the hour stack beside it and are taller. */}
            <div ref={mapDiv} className="h-full min-h-[340px] w-full rounded-[18px] bg-surface" />
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <div className="flex flex-col gap-3">
                <div className="micro">Which way do the windows face?</div>
                <Compass heading={facing} principal={footprint?.principalHeading} onChange={setFacing} sunAzimuth={sky && sky.sun.elevation > 0 ? sky.sun.azimuth : null} />
                <div className="flex flex-wrap items-center gap-2">
                  <Chip mono tone="accent" className="!text-[11px]">
                    {Math.round(facing)}° · {compassLabel(facing)}
                  </Chip>
                  <Chip mono className="!text-[11px]">
                    {windowWall} wall
                  </Chip>
                  {footprint ? (
                    <button type="button" className="chip !py-0.5 !text-[11px] hover:!border-ink-2 hover:!text-ink" onClick={() => setFacing(defaultHeading(footprint.principalHeading))}>
                      <Icon.Rotate size={11} /> Use the building
                    </button>
                  ) : null}
                </div>
                <p className="text-xs leading-relaxed text-ink-3">
                  Drag the needle to the direction you look when you stand at the window wall and look out. Audora turns the rest of the room from it. The guess comes from the building's longest wall on OpenStreetMap; you are the one who knows.
                </p>
              </div>
            </Card>

            <Card>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="micro">Time of day</span>
                  <button type="button" className="chip !py-0.5 !text-[11px] hover:!border-ink-2 hover:!text-ink" onClick={() => setDate(new Date())}>
                    <Icon.Clock size={11} /> Now
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={dateInputValue(date)}
                    onChange={(e) => {
                      const d = dateFromInput(e.target.value, date);
                      if (d) setDate(d);
                    }}
                    className="mono h-9 flex-1 rounded-[10px] border border-line-2 bg-bg px-2 text-[12px] text-ink outline-none focus:border-ink"
                    aria-label="Date"
                  />
                  <span className="mono w-12 shrink-0 text-right text-sm text-ink">{clockLabel(date)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1435}
                  step={5}
                  value={minutes}
                  onChange={(e) => setDate(withMinutes(date, Number(e.target.value)))}
                  className="h-5 w-full cursor-pointer accent-accent"
                  aria-label="Hour of the day"
                />
                {sky ? <div className="text-[12px] leading-snug text-ink-2">{sky.readout}</div> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Chip mono className={cx('!text-[10px]', shade === 'on' && '!border-ink/30 !text-ink')}>
                    {shade === 'on' ? 'ShadeMap layer on' : shade === 'loading' ? 'ShadeMap loading…' : shade === 'failed' ? 'ShadeMap unavailable' : 'no ShadeMap key'}
                  </Chip>
                  {shade === 'off' ? <span className="text-[11px] text-ink-3">Sun angles still come from Audora's own solar model.</span> : null}
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {point && strip?.length ? (
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="micro">Sun on the windows</div>
                <div className="text-xs text-ink-3">
                  {dateInputValue(date)} · hour by hour, at the window's own place on the building.
                </div>
              </div>
              <div className="flex items-center gap-2">
                {SHADEMAP_KEY ? (
                  <Button size="sm" variant="secondary" loading={busy === 'shade'} disabled={shade !== 'on'} onClick={() => void runStrip(true)}>
                    <Icon.Sun size={14} /> {busy === 'shade' ? `${shadeProgress}%` : 'Add the neighbours’ shadows'}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => void runStrip(false)}>
                  <Icon.Rotate size={14} /> Recompute
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {strip.map((row, i) => (
                <SunStrip key={`${row.roomName}:${row.wall}:${i}`} row={row} assumed={samples[i]?.assumed} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* The window offsets these samples stand on are metric, so the anchor travels with them. */}
              {rooms[0] ? <AnchorChip anchor={anchorAssumed(rooms[0].raw)} size="sm" /> : null}
              <span className="text-[11px] text-ink-3">
                Window positions are the room's own openings placed on the OSM footprint; the hour is the sun's real position for this date and place.
              </span>
            </div>
          </div>
        </Card>
      ) : null}

      {!point && busy === 'idle' ? (
        <Callout tone="info" title="The site is optional">
          Without an address the tour still works — it simply has a studio light instead of the sun that will actually be in the room. You can come back and add it later.
        </Callout>
      ) : null}
    </div>
  );
}

/** Wait for the shadow layer to finish drawing the date it was just given. */
function settled(layer: any, timeoutMs = 700): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(t);
      resolve();
    };
    const t = window.setTimeout(finish, timeoutMs);
    try {
      layer.once('idle', finish);
    } catch {
      finish();
    }
  });
}

/* ------------------------------------------------------------------ compass */

function Compass({ heading, principal, onChange, sunAzimuth }: { heading: number; principal?: number; onChange: (h: number) => void; sunAzimuth: number | null }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef(false);
  const size = 168;
  const c = size / 2;
  const r = c - 18;

  const point = (deg: number, radius: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return { x: c + Math.cos(a) * radius, y: c + Math.sin(a) * radius };
  };

  const fromEvent = (e: { clientX: number; clientY: number }) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    if (Math.hypot(dx, dy) < 6) return null;
    return snapHeading(norm360((Math.atan2(dx, -dy) * 180) / Math.PI), principal);
  };

  const tip = point(heading, r);
  const sunTip = sunAzimuth == null ? null : point(sunAzimuth, r - 6);
  const axes = principal == null ? [] : [0, 90, 180, 270].map((d) => norm360(principal + d));

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="slider"
      tabIndex={0}
      aria-label="Direction the window wall faces"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(norm360(heading))}
      aria-valuetext={`${Math.round(norm360(heading))} degrees, ${compassLabel(heading)}`}
      className="mx-auto touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink-2/50"
      onPointerDown={(e) => {
        drag.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        const h = fromEvent(e);
        if (h != null) onChange(h);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const h = fromEvent(e);
        if (h != null) onChange(h);
      }}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 15 : 5;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(norm360(heading - step));
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onChange(norm360(heading + step));
        }
      }}
    >
      <circle cx={c} cy={c} r={r + 10} fill="var(--color-bg)" stroke="var(--color-line)" />
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-line-2)" strokeDasharray="2 5" />
      {/* the building's own axes, which the needle snaps to */}
      {axes.map((a) => {
        const p = point(a, r);
        return <line key={a} x1={c} y1={c} x2={p.x} y2={p.y} stroke="var(--color-line-2)" strokeWidth={1} />;
      })}
      {(['N', 'E', 'S', 'W'] as const).map((label, i) => {
        const p = point(i * 90, r + 10);
        return (
          <text key={label} x={p.x} y={p.y + 4} textAnchor="middle" className="mono" fontSize={11} fill={i === 0 ? 'var(--color-ink)' : 'var(--color-faint)'}>
            {label}
          </text>
        );
      })}
      {sunTip ? (
        <>
          <line x1={c} y1={c} x2={sunTip.x} y2={sunTip.y} stroke="var(--color-gold)" strokeWidth={1.5} strokeDasharray="3 3" />
          <circle cx={sunTip.x} cy={sunTip.y} r={4} fill="var(--color-gold)" />
        </>
      ) : null}
      <line x1={c} y1={c} x2={tip.x} y2={tip.y} stroke="var(--color-ink)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={tip.x} cy={tip.y} r={7} fill="var(--color-ink)" />
      <circle cx={c} cy={c} r={4} fill="var(--color-bg)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ strip */

function SunStrip({ row, assumed }: { row: WindowSunStrip; assumed?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm text-ink">{row.roomName}</span>
        <span className="mono text-[11px] text-ink-3">
          {row.wall} wall · faces {compassAbbr(row.bearing)} {Math.round(row.bearing)}°
        </span>
        <span className="mono text-[11px] text-ink">{stripSummary(row.hours)}</span>
        <Chip mono tone={row.source === 'shademap' ? 'ok' : 'neutral'} className="!text-[10px]">
          {row.source === 'shademap' ? 'with neighbours’ shadows' : 'solar model'}
        </Chip>
        {assumed ? <Chip mono tone="warn" className="!text-[10px]">wall assumed</Chip> : null}
      </div>
      <div className="flex gap-[2px]">
        {row.hours.map((on, h) => (
          <div
            key={h}
            title={`${String(h).padStart(2, '0')}:30 — ${on ? 'sun on this window' : 'no direct sun'}`}
            className={cx('h-4 flex-1 rounded-[2px]', on ? 'bg-accent' : 'bg-surface-2')}
          />
        ))}
      </div>
      <div className="mono flex justify-between text-[10px] text-ink-3">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}
