import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from 'react';
import { Icon } from './icons';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'buyer';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-[#1a0f0a] hover:bg-accent-2 active:bg-accent-deep shadow-[0_8px_30px_-10px_rgba(232,115,74,0.6)]',
  secondary: 'bg-surface-2 text-ink border border-line-2 hover:bg-surface-3 hover:border-ink-3/50',
  ghost: 'bg-transparent text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
  buyer: 'bg-buyer text-[#08131f] hover:brightness-110',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Spinner size={14} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, className, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
        active ? 'bg-accent/15 border-accent/50 text-accent-2' : 'bg-surface-2 border-line-2 text-ink-2 hover:text-ink hover:bg-surface-3',
        className,
      )}
    />
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx('animate-spin', className)} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className, children, glow }: { className?: string; children: ReactNode; glow?: boolean }) {
  return <div className={cx('panel p-5', glow && 'ring-accent', className)}>{children}</div>;
}

export function Chip({ children, tone = 'neutral', className, mono }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'buyer'; className?: string; mono?: boolean }) {
  const tones = {
    neutral: '',
    accent: 'border-accent/40 text-accent-2 bg-accent/10',
    ok: 'border-ok/40 text-ok bg-ok/10',
    warn: 'border-warn/40 text-warn bg-warn/10',
    danger: 'border-danger/40 text-danger bg-danger/10',
    buyer: 'border-buyer/40 text-buyer bg-buyer/10',
  };
  return <span className={cx('chip', tones[tone], mono && 'mono', className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mono inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-2 bg-surface-2 px-1 text-[11px] text-ink-2">{children}</kbd>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'accent' }) {
  const t = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent-2' : 'text-ink';
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[11px] uppercase tracking-[0.12em] text-ink-3">{label}</div>
      <div className={cx('mono text-xl leading-tight', t)}>{value}</div>
      {hint ? <div className="text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      {label ? <span className="text-xs font-medium text-ink-2">{label}</span> : null}
      {children}
      {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'h-10 w-full rounded-xl border border-line-2 bg-bg-2 px-3 text-sm text-ink placeholder:text-ink-3 outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/20',
        className,
      )}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx('h-10 w-full appearance-none rounded-xl border border-line-2 bg-bg-2 px-3 text-sm text-ink outline-none focus:border-accent/60', className)}
    >
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cx('flex items-center gap-3 text-left', disabled && 'cursor-not-allowed opacity-60')}
      role="switch"
      aria-checked={checked}
    >
      <span className={cx('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-3 border border-line-2')}>
        <span className={cx('absolute h-5 w-5 rounded-full bg-white transition-transform', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
      </span>
      {label ? <span className="text-sm text-ink-2">{label}</span> : null}
    </button>
  );
}

export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'ok' | 'buyer' }) {
  const c = tone === 'ok' ? 'bg-ok' : tone === 'buyer' ? 'bg-buyer' : 'bg-accent';
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div className={cx('h-full rounded-full transition-[width] duration-700 ease-out', c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'buyer' }) {
  return <Chip tone={tone}>{children}</Chip>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px w-full bg-line', className)} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="display text-2xl text-ink">{title}</div>
      {body ? <p className="max-w-md text-sm text-ink-3">{body}</p> : null}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  size?: 'sm' | 'md';
  /** e.g. `w-full` so the control fills a narrow column instead of overflowing it. */
  className?: string;
}) {
  return (
    <div className={cx('inline-flex max-w-full rounded-xl border border-line-2 bg-bg-2 p-1', size === 'sm' ? 'h-8' : 'h-10', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-3 text-sm whitespace-nowrap transition-colors',
            size === 'sm' && 'text-[13px] px-2.5',
            value === o.value ? 'bg-surface-3 text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, body, className }: { eyebrow?: string; title: ReactNode; body?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {eyebrow ? <div className="text-[11px] uppercase tracking-[0.16em] text-accent-2">{eyebrow}</div> : null}
      <h2 className="display text-3xl leading-tight text-ink md:text-4xl">{title}</h2>
      {body ? <p className="max-w-2xl text-[15px] text-ink-2">{body}</p> : null}
    </div>
  );
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: string; children: ReactNode }) {
  const t = { info: 'border-line-2 bg-surface-2 text-ink-2', warn: 'border-warn/40 bg-warn/10 text-warn', danger: 'border-danger/40 bg-danger/10 text-danger', ok: 'border-ok/40 bg-ok/10 text-ok' }[tone];
  const I = tone === 'warn' || tone === 'danger' ? Icon.Warning : tone === 'ok' ? Icon.Check : Icon.Info;
  return (
    <div className={cx('flex gap-3 rounded-xl border px-4 py-3 text-sm', t)}>
      <I size={18} className="mt-0.5 shrink-0" />
      <div>
        {title ? <div className="font-medium">{title}</div> : null}
        <div className={cx(title && 'mt-0.5 opacity-90')}>{children}</div>
      </div>
    </div>
  );
}

export function StagedLabel({ className }: { className?: string }) {
  return (
    <span className={cx('chip mono !text-[11px] uppercase tracking-wider', className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-accent" /> digitally staged
    </span>
  );
}
