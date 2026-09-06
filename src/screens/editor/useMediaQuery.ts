import { useEffect, useState } from 'react';

/** True when the media query matches; updates live on resize / orientation change. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Coarse pointer (touch-first) device. */
export function useTouchDevice(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
