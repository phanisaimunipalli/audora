/**
 * The hour slider that moves the real sun.
 *
 * The room already knows where it is (`tour.site`) and which way it is turned (the seller's
 * compass), so the only thing left is *when*. Pick a date, drag the hour, and the light in the room
 * is the light that will be in the room at that moment: `three/SunLight` takes the same
 * `sunState` this panel prints.
 *
 * Sunrise and sunset are marked on the track (`sunTimes`), so the buyer can see at a glance how
 * much of the day this room actually gets. Times are the device's own clock — Audora does not
 * pretend to know the listing's time zone.
 */
import { useMemo } from 'react';
import { sunTimes } from '@/engine/sun';
import { clockLabel, dateFromInput, dateInputValue, minutesOfDay, sunState, withMinutes } from '@/engine/siteSun';
import { Icon } from '@/components/icons';
import { IconButton, cx } from '@/components/ui';

export interface TimeOfDayProps {
  lat: number;
  lon: number;
  /** True-north bearing the room's north wall faces outward. */
  heading: number;
  date: Date;
  onChange: (d: Date) => void;
  onClose?: () => void;
  /** Nominatim's name for the place, shown with its attribution. */
  place?: string;
  className?: string;
}

const pct = (minutes: number) => `${(minutes / 1440) * 100}%`;

export function TimeOfDay({ lat, lon, heading, date, onChange, onClose, place, className }: TimeOfDayProps) {
  const minutes = minutesOfDay(date);
  const dayKey = dateInputValue(date);
  const sky = useMemo(() => sunState(date, lat, lon, heading), [date, lat, lon, heading]);
  const times = useMemo(() => sunTimes(date, lat, lon), [dayKey, lat, lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const rise = times.sunrise ? minutesOfDay(times.sunrise) : null;
  const set = times.sunset ? minutesOfDay(times.sunset) : null;

  return (
    <div className={cx('glass animate-rise flex w-[330px] max-w-[90vw] flex-col gap-3 rounded-2xl p-3.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="micro">Time of day</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange(new Date())}
            className="chip !py-0.5 !text-[11px] transition-colors duration-200 ease-audora hover:border-ink-2 hover:text-ink"
          >
            <Icon.Clock size={11} /> Now
          </button>
          {onClose ? (
            <IconButton label="Close the time of day panel" onClick={onClose} className="!h-6 !w-6 !border-0 !bg-transparent">
              <Icon.X size={13} />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="date"
          value={dayKey}
          onChange={(e) => {
            const d = dateFromInput(e.target.value, date);
            if (d) onChange(d);
          }}
          className="mono h-8 flex-1 rounded-[10px] border border-line-2 bg-bg px-2 text-[12px] text-ink outline-none focus:border-ink focus:ring-[3px] focus:ring-accent-soft"
          aria-label="Date"
        />
        <span className="mono w-12 shrink-0 text-right text-sm text-ink">{clockLabel(date)}</span>
      </div>

      <div className="flex flex-col gap-1">
        <input
          type="range"
          min={0}
          max={1435}
          step={5}
          value={minutes}
          onChange={(e) => onChange(withMinutes(date, Number(e.target.value)))}
          className="h-5 w-full cursor-pointer accent-accent"
          aria-label="Hour of the day"
          aria-valuetext={clockLabel(date)}
        />
        {/* Sunrise and sunset, where they really fall on this day at this latitude. */}
        <div className="relative h-3.5">
          {rise != null ? <Mark at={rise} label={`↑ ${clockLabel(times.sunrise!)}`} /> : null}
          {set != null ? <Mark at={set} label={`${clockLabel(times.sunset!)} ↓`} align="end" /> : null}
        </div>
      </div>

      <div className="text-[12px] leading-[1.5] text-ink-2">{sky.readout}</div>

      {place ? (
        <div className="text-[10px] leading-snug text-faint">
          <span className="line-clamp-1">{place}</span>
          <span className="mono">© OpenStreetMap contributors</span>
        </div>
      ) : null}
    </div>
  );
}

function Mark({ at, label, align = 'start' }: { at: number; label: string; align?: 'start' | 'end' }) {
  return (
    <span
      className="mono absolute top-0 whitespace-nowrap text-[10px] text-faint"
      style={{ left: pct(at), transform: align === 'end' ? 'translateX(-100%)' : undefined }}
    >
      {label}
    </span>
  );
}
