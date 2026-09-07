/**
 * The Site card: where this listing really is, which way the seller said its windows face, and how
 * long the sun is up there today. It is the provenance card for every sunbeam in the tour — the
 * viewer's time-of-day slider and `three/SunLight` read exactly these three numbers.
 *
 * The note at the bottom is the honest bit: the position and the outline are OpenStreetMap's, the
 * heading is a human's, and the card says so rather than implying Audora surveyed the building.
 */
import { useMemo } from 'react';
import type { Room, Tour } from '@/state/types';
import { sunTimes } from '@/engine/sun';
import { clockLabel, compassLabel, dominantWindowWall, headingToFacing, norm360, sunState } from '@/engine/siteSun';
import { osmTileUrl } from '@/services/geo';
import { Chip, cx } from '@/components/ui';
import { Icon } from '@/components/icons';

export function SiteCard({ tour, rooms = [], className }: { tour: Tour; rooms?: Room[]; className?: string }) {
  const site = tour.site;
  const now = useMemo(() => new Date(), []);
  const times = useMemo(() => (site ? sunTimes(now, site.lat, site.lon) : null), [site, now]);
  const sky = useMemo(() => (site ? sunState(new Date(site.previewTime ?? now.getTime()), site.lat, site.lon, site.heading) : null), [site, now]);
  if (!site) return null;

  const heading = norm360(site.heading);
  /* Said the way the seller said it: the direction the windows look, not the frame the engine keeps.
     Against the wall the answer was given on, which the site records — re-reading it from today's
     rooms would rename the same heading every time a room is added. */
  const windowWall = site.windowWall ?? dominantWindowWall(rooms.flatMap((r) => r.geometry.windows.map((w) => w.wall)));
  const facing = headingToFacing(heading, windowWall);
  /* `sunTimes` scans the local calendar day, so sunrise comes before sunset; the modulo is kept for
     the polar edge cases where one of them falls on the far side of midnight. */
  const dayMs = times?.sunrise && times.sunset ? (((times.sunset.getTime() - times.sunrise.getTime()) % 86400000) + 86400000) % 86400000 : null;
  const upFor = dayMs != null ? `${(dayMs / 3600000).toFixed(1)} h` : null;

  return (
    <div className={cx('panel flex flex-col gap-3 p-4 sm:flex-row sm:items-start', className)}>
      <div className="flex items-start gap-3">
        {/* One OSM raster tile, centred on the building. Attribution is under the text. */}
        <img
          src={osmTileUrl(site.lat, site.lon, 18)}
          alt={`Map of ${site.displayName}`}
          width={88}
          height={88}
          loading="lazy"
          className="h-[88px] w-[88px] shrink-0 rounded-xl border border-line object-cover opacity-90"
        />
        <Rose heading={facing} sunAzimuth={sky && sky.sun.elevation > 0 ? sky.sun.azimuth : null} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro">Site</span>
          <Chip mono className="!text-[10px]">
            {site.lat.toFixed(4)}, {site.lon.toFixed(4)}
          </Chip>
          {site.footprint ? (
            <Chip mono className="!text-[10px]">
              OSM footprint
            </Chip>
          ) : (
            <Chip mono tone="warn" className="!text-[10px]">
              no footprint
            </Chip>
          )}
        </div>
        <div className="truncate text-sm text-ink" title={site.displayName}>
          {site.displayName}
        </div>
        <div className="mono flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
          <span className="inline-flex items-center gap-1">
            <Icon.Cursor size={12} className="text-dim" /> windows face {Math.round(facing)}° · {compassLabel(facing)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon.Sun size={12} className="text-dim" />
            {times?.sunrise ? clockLabel(times.sunrise) : '—'} → {times?.sunset ? clockLabel(times.sunset) : '—'}
            {upFor ? ` · ${upFor}` : ''}
          </span>
        </div>
        {sky ? <div className="text-xs text-ink-3">{sky.readout}</div> : null}
        <p className="text-[11px] leading-relaxed text-ink-3">
          Sun direction from the address and building footprint on OpenStreetMap; the seller confirmed which way the windows face.{' '}
          <span className="mono">© OpenStreetMap contributors</span>
        </p>
      </div>
    </div>
  );
}

/** A 64 px compass: the confirmed window heading in accent, today's sun where it stands now. */
function Rose({ heading, sunAzimuth }: { heading: number; sunAzimuth: number | null }) {
  const size = 64;
  const c = size / 2;
  const r = c - 8;
  const at = (deg: number, radius: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return { x: c + Math.cos(a) * radius, y: c + Math.sin(a) * radius };
  };
  const tip = at(heading, r);
  const sun = sunAzimuth == null ? null : at(sunAzimuth, r - 3);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <circle cx={c} cy={c} r={r + 5} fill="var(--color-bg)" stroke="var(--color-line)" />
      <text x={c} y={10} textAnchor="middle" fontSize={8} fill="var(--color-faint)" className="mono">
        N
      </text>
      {sun ? <circle cx={sun.x} cy={sun.y} r={3} fill="var(--color-gold)" /> : null}
      <line x1={c} y1={c} x2={tip.x} y2={tip.y} stroke="var(--color-ink)" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={c} cy={c} r={2.5} fill="var(--color-bg)" />
    </svg>
  );
}
