import { useEffect, useState } from 'react';

/** A clock that re-renders every `ms` while `active`. Used for elapsed timers on running jobs. */
export function useNow(active = true, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return now;
}
