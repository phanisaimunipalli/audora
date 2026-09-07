/**
 * The horizontal rail affordance the prototype's bottom strip has and ours did not: a fade at the
 * live edge **and** a pair of arrows, so a buyer on a phone can see that Fullscreen, Share and
 * Layers exist at all rather than discovering them by accident.
 *
 * `useRail` watches one scroller and says which way it can still go; `RailArrow` is the button.
 * Both are deliberately dumb about layout — the caller positions the arrows over its own rail.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { Icon } from './icons';
import { cx } from './ui';

export interface RailState {
  /** The content is wider than the rail. */
  overflowing: boolean;
  /** There is content off the left edge / off the right edge. */
  canLeft: boolean;
  canRight: boolean;
  /** Scroll by ~80% of a screenful in that direction. */
  nudge: (dir: -1 | 1) => void;
}

export function useRail(ref: RefObject<HTMLElement | null>): RailState {
  const [state, setState] = useState({ overflowing: false, canLeft: false, canRight: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const max = el.scrollWidth - el.clientWidth;
      setState((prev) => {
        const next = { overflowing: max > 4, canLeft: el.scrollLeft > 4, canRight: el.scrollLeft < max - 4 };
        return prev.overflowing === next.overflowing && prev.canLeft === next.canLeft && prev.canRight === next.canRight ? prev : next;
      });
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    return () => {
      el.removeEventListener('scroll', read);
      ro?.disconnect();
    };
  }, [ref]);

  const nudge = useCallback(
    (dir: -1 | 1) => {
      const el = ref.current;
      if (!el) return;
      el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: 'smooth' });
    },
    [ref],
  );

  return { ...state, nudge };
}

/** A round white hairline arrow that sits over the rail's edge. Hidden when there is nothing that way. */
export function RailArrow({ dir, show, onClick, className, label }: { dir: -1 | 1; show: boolean; onClick: () => void; className?: string; label?: string }) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? (dir < 0 ? 'Scroll left' : 'Scroll right')}
      title={label ?? (dir < 0 ? 'Scroll left' : 'Scroll right')}
      className={cx(
        'pointer-events-auto absolute top-1/2 z-[2] inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-line-2 bg-bg/95 text-ink-2 shadow-sm backdrop-blur-sm transition-colors duration-200 ease-audora hover:border-ink-2 hover:text-ink',
        dir < 0 ? 'left-0' : 'right-0',
        className,
      )}
    >
      <Icon.ChevronRight size={15} className={dir < 0 ? 'rotate-180' : undefined} />
    </button>
  );
}
