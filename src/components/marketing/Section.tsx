import type { ReactNode } from 'react';
import { cx } from '@/components/ui';

/** A landing-page band: generous vertical rhythm, one max-width column. */
export function Section({ id, children, className, inner, bleed }: { id?: string; children: ReactNode; className?: string; inner?: string; bleed?: boolean }) {
  return (
    <section id={id} className={cx('relative', className)}>
      <div className={cx(!bleed && 'mx-auto max-w-7xl px-4 md:px-6', 'py-20 md:py-28', inner)}>{children}</div>
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('micro', className)}>{children}</div>;
}

export function Hairline({ className }: { className?: string }) {
  return <div className={cx('mx-auto h-px max-w-7xl bg-line', className)} />;
}
