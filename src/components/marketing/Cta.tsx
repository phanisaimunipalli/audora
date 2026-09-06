import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '@/components/ui';

type Variant = 'primary' | 'secondary' | 'ghost' | 'buyer';
type Size = 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-[#1a0f0a] hover:bg-accent-2 active:bg-accent-deep shadow-[0_8px_30px_-10px_rgba(232,115,74,0.6)]',
  secondary: 'bg-surface-2 text-ink border border-line-2 hover:bg-surface-3 hover:border-ink-3/50',
  ghost: 'bg-transparent text-ink-2 hover:text-ink hover:bg-surface-2',
  buyer: 'bg-buyer text-[#08131f] hover:brightness-110',
};
const SIZES: Record<Size, string> = {
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
};

/** A router link dressed exactly like `Button`, for calls to action that navigate. */
export function CtaLink({ to, variant = 'primary', size = 'lg', className, children }: { to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}
