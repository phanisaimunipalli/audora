import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scroll-reveal wrapper: a quiet rise-and-fade the first time the block enters the viewport.
 * One IntersectionObserver flips a class; the transition itself is CSS, so it keeps running even
 * when the main thread is busy compiling shaders for the hero.
 */
export function Reveal({ children, delay = 0, className, y = 18 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(() => prefersReducedMotion() || typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px 12% 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  const style: CSSProperties = {
    opacity: shown ? 1 : 0,
    transform: shown ? 'translateY(0)' : `translateY(${y}px)`,
    transition: `opacity 0.45s ${EASE} ${Math.min(delay, 0.12)}s, transform 0.45s ${EASE} ${Math.min(delay, 0.12)}s`,
  };
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
