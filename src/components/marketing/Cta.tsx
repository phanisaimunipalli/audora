import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '@/components/ui';

type Variant = 'primary' | 'secondary' | 'ghost' | 'buyer';
type Size = 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white shadow-[0_6px_18px_rgba(10,10,10,0.18)] hover:bg-accent-deep hover:-translate-y-px',
  secondary: 'bg-bg text-ink border border-line-2 hover:border-ink-2',
  ghost: 'bg-transparent text-dim hover:text-ink hover:bg-surface',
  buyer: 'bg-buyer text-white shadow-[0_6px_18px_rgba(29,99,255,0.22)] hover:brightness-105',
};
const SIZES: Record<Size, string> = {
  md: 'h-10 px-4 text-[13.5px] gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

/** A router link dressed exactly like `Button`, for calls to action that navigate. */
export function CtaLink({ to, variant = 'primary', size = 'lg', className, children }: { to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cx(
        'ease-audora inline-flex items-center justify-center rounded-full font-semibold whitespace-nowrap select-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ink-2/50 focus-visible:outline-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}
