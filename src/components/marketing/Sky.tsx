import { useMemo, useState } from 'react';
import { useAudora } from '@/state/store';
import { cx } from '@/components/ui';

/**
 * The ambient drift behind the hero, from the deployed prototype: faded thumbnail cards of rooms
 * Audora already generated, floating slowly at different depths behind a soft white veil.
 * Real images come from the demo tour (its room photos and Marble thumbnails); anything that fails
 * to load, and any slot left over, falls back to a soft gradient card labelled the same way.
 */

/** Fixed slots so the sky is stable across renders: left/top in %, width in px, drift in s, depth 0..1. */
const SLOTS = [
  { l: 3, t: 10, w: 220, d: 26, delay: 0, z: 0.35 },
  { l: 77, t: 6, w: 250, d: 30, delay: -4, z: 0.55 },
  { l: 10, t: 58, w: 190, d: 24, delay: -9, z: 0.25 },
  { l: 70, t: 60, w: 230, d: 28, delay: -6, z: 0.45 },
  { l: 40, t: 2, w: 160, d: 22, delay: -12, z: 0.15 },
  { l: 87, t: 34, w: 170, d: 25, delay: -2, z: 0.3 },
  { l: 24, t: 28, w: 140, d: 21, delay: -7, z: 0.1 },
  { l: 54, t: 74, w: 180, d: 27, delay: -10, z: 0.2 },
];

/** Two local stills ship with the app, so the sky looks the same offline as it does on the CDN. */
const LOCAL = ['/demo/empty-room-corner-windows.jpg', '/demo/empty-room-extension-cord.jpg'];

/** Every room still Audora can show, newest world first, without ever returning a new array identity. */
function useRoomStills(): string[] {
  const rooms = useAudora((s) => s.rooms);
  return useMemo(() => {
    const out: string[] = [...LOCAL];
    for (const room of Object.values(rooms)) {
      const url = room.full?.thumbnailUrl ?? room.draft?.thumbnailUrl ?? room.photo?.dataUrl;
      if (url && !out.includes(url)) out.push(url);
    }
    return out;
  }, [rooms]);
}

export function Sky({ className }: { className?: string }) {
  const stills = useRoomStills();
  const [failed, setFailed] = useState<string[]>([]);
  const usable = stills.filter((s) => !failed.includes(s));

  return (
    <div className={cx('pointer-events-none absolute inset-x-0 top-0 h-[min(100vh,780px)] overflow-hidden', className)} aria-hidden>
      <style>{`
        @keyframes audora-float {
          from { transform: translate3d(0, 0, 0) rotate(-1.2deg); }
          to   { transform: translate3d(0, -22px, 0) rotate(1.2deg); }
        }
        @media (prefers-reduced-motion: reduce) { .audora-scene { animation: none !important; } }
      `}</style>
      {SLOTS.map((s, i) => {
        // Only as many photo cards as there are distinct stills; the rest stay soft gradients, so a
        // demo with two rooms does not read as the same photograph printed eight times.
        const src = i < usable.length ? usable[i] : null;
        return (
          <div
            key={i}
            className={cx('audora-scene absolute overflow-hidden rounded-[8px] border border-line bg-bg shadow-sm', i >= 4 && 'hidden md:block')}
            style={{
              left: `${s.l}%`,
              top: `${s.t}%`,
              width: `${s.w}px`,
              opacity: 0.22 + s.z * 0.55,
              filter: `blur(${((1 - s.z) * 1.6).toFixed(2)}px)`,
              animation: `audora-float ${s.d}s cubic-bezier(0.33, 1, 0.68, 1) ${s.delay}s infinite alternate`,
              willChange: 'transform',
            }}
          >
            {src ? (
              <img src={src} alt="" loading="lazy" className="block aspect-[16/10] w-full object-cover" onError={() => setFailed((f) => (f.includes(src) ? f : [...f, src]))} />
            ) : (
              <div
                className="aspect-[16/10] w-full"
                style={{ background: `linear-gradient(${150 + i * 9}deg, #f4f4f4, #ffffff 58%, #ededed)` }}
              />
            )}
            <span className="block border-t border-line bg-bg px-2.5 py-[7px] text-[10.5px] font-bold tracking-[0.08em] text-dim uppercase">{src ? 'Generated room' : 'Your room, soon'}</span>
          </div>
        );
      })}
      {/* The veil that keeps the type legible and clears toward the edges. */}
      <div className="absolute inset-0 bg-[radial-gradient(760px_540px_at_50%_42%,rgba(255,255,255,0.94)_0%,rgba(255,255,255,0.6)_46%,rgba(255,255,255,0)_74%)]" />
    </div>
  );
}
