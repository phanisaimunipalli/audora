import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from 'react';
import { Icon } from './icons';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'buyer';
type Size = 'sm' | 'md' | 'lg';

/* Actions are pills. Primary is a black fill; secondary is white with a hairline; ghost is quiet
   text that only earns a background on hover. The buyer's own actions are the one blue. */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white shadow-[0_6px_18px_rgba(10,10,10,0.18)] hover:bg-accent-deep hover:-translate-y-px active:translate-y-0',
  secondary: 'bg-bg text-ink border border-line-2 hover:border-ink-2 hover:bg-bg',
  ghost: 'bg-transparent text-dim hover:text-ink hover:bg-surface',
  danger: 'bg-danger-soft text-danger border border-danger-line hover:border-danger',
  buyer: 'bg-buyer text-white shadow-[0_6px_18px_rgba(29,99,255,0.22)] hover:brightness-105',
};
/**
 * A disabled fill is not a faded fill. `opacity-45` over the black or the buyer blue leaves white
 * text on a wash — the buyer's "Test" pill measured 1.9:1 and still looked pressable — so a filled
 * variant that is switched off becomes the prototype's own "not yet" control: white, `--line-2`
 * hairline, `--faint` label.
 */
const DISABLED_FILL = '!bg-bg !text-faint !border !border-line-2 !shadow-none hover:!bg-bg hover:!border-line-2';

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[12.5px] gap-1.5',
  md: 'h-10 px-4 text-[13.5px] gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

/**
 * The pill recipe as a class string. `Button` is built from it, and every `<Link>` that has to look
 * like a button uses it too, so a black pill is the same black pill everywhere.
 */
export function pillClass(variant: Variant = 'secondary', size: Size = 'md', className?: string): string {
  return cx(
    'inline-flex items-center justify-center rounded-full font-semibold whitespace-nowrap no-underline select-none transition-all duration-200 ease-audora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-2/50',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const off = Boolean(rest.disabled || loading);
  const filled = variant === 'primary' || variant === 'buyer';
  return (
    <button
      {...rest}
      disabled={off}
      className={cx(
        pillClass(variant, size, cx('disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0', !filled && 'disabled:opacity-45', className)),
        off && filled && DISABLED_FILL,
      )}
    >
      {loading ? <Spinner size={14} /> : null}
      {children}
    </button>
  );
}

/** Round, white, hairline. Turned on it goes black — the same on/off language as the pill group. */
export function IconButton({ label, className, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors duration-200 ease-audora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-2/50',
        active ? 'border-accent bg-accent text-white' : 'bg-bg border-line-2 text-ink-2 hover:border-ink-2 hover:text-ink',
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
  return <div className={cx('panel p-5 shadow-soft', glow && 'ring-accent', className)}>{children}</div>;
}

export function Chip({
  children,
  tone = 'neutral',
  className,
  mono,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'gold' | 'ok' | 'warn' | 'danger' | 'buyer';
  className?: string;
  mono?: boolean;
}) {
  const tones = {
    neutral: '',
    accent: 'border-ink/20 bg-surface text-ink',
    gold: 'border-gold/40 bg-gold/8 text-gold',
    ok: 'border-ok/40 bg-ok/8 text-ok',
    /* Caution is ink on a hairline — never a wash, and never the gold that means "anchor". */
    warn: 'border-line-2 bg-bg text-ink-2',
    danger: 'border-danger/40 bg-danger-soft text-danger',
    buyer: 'border-buyer-line bg-buyer-soft text-buyer',
  };
  return <span className={cx('chip', tones[tone], mono && 'mono', className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mono inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-2 bg-bg px-1 text-[11px] text-ink-2 shadow-[0_1px_0_var(--color-line-2)]">{children}</kbd>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'accent' }) {
  const t = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink';
  return (
    <div className="flex flex-col gap-1">
      <div className="micro">{label}</div>
      <div className={cx('mono text-xl leading-tight', t)}>{value}</div>
      {hint ? <div className="text-xs text-dim">{hint}</div> : null}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      {label ? <span className="micro">{label}</span> : null}
      {children}
      {hint ? <span className="text-xs text-dim">{hint}</span> : null}
    </label>
  );
}

const CONTROL = 'h-10 w-full rounded-[10px] border border-line-2 bg-bg px-3 text-sm text-ink outline-none transition-colors duration-200 ease-audora focus:border-ink focus:ring-[3px] focus:ring-accent-soft';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(CONTROL, 'placeholder:text-faint', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(CONTROL, 'appearance-none pr-8', className)}>
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
      className={cx('group flex items-center gap-3 text-left', disabled && 'cursor-not-allowed opacity-60')}
      role="switch"
      aria-checked={checked}
    >
      <span className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ease-audora', checked ? 'border-accent bg-accent' : 'border-line-2 bg-surface-2')}>
        <span className={cx('absolute h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-audora', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </span>
      {label ? <span className="text-sm text-ink-2 group-hover:text-ink">{label}</span> : null}
    </button>
  );
}

export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'ok' | 'buyer' }) {
  const c = tone === 'ok' ? 'bg-ok' : tone === 'buyer' ? 'bg-buyer' : 'bg-accent';
  return (
    <div className={cx('h-1 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div className={cx('h-full rounded-full transition-[width] duration-700 ease-out', c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'gold' | 'buyer' }) {
  return <Chip tone={tone}>{children}</Chip>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px w-full bg-line', className)} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-3 bg-surface px-6 py-14 text-center">
      <div className="display text-2xl text-ink">{title}</div>
      {body ? <p className="max-w-md text-sm text-dim">{body}</p> : null}
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
    <div className={cx('inline-flex max-w-full rounded-full border border-line-2 bg-bg p-1', size === 'sm' ? 'h-8' : 'h-10', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors duration-200 ease-audora',
            size === 'sm' && 'px-3 text-[12.5px]',
            value === o.value ? 'bg-accent text-white' : 'text-dim hover:text-ink',
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
    <div className={cx('flex flex-col gap-2.5', className)}>
      {eyebrow ? <div className="micro">{eyebrow}</div> : null}
      <h2 className="display text-3xl leading-[1.08] text-ink md:text-4xl">{title}</h2>
      {body ? <p className="max-w-2xl text-[15px] leading-[1.62] text-dim">{body}</p> : null}
    </div>
  );
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: string; children: ReactNode }) {
  /* The tone lives in the icon and the headline; the body stays ink so a callout never becomes a
     block of coloured prose. Colour is a signal here, not a surface. */
  const t = {
    info: 'border-line-2 bg-surface',
    /* No gold wash: the Warning glyph in ink carries the caution, so `--gold` can go on meaning
       "this is the scale reference" and nothing else. */
    warn: 'border-line-2 bg-bg',
    danger: 'border-danger-line bg-danger-soft',
    ok: 'border-ok/35 bg-ok/6',
  }[tone];
  const mark = { info: 'text-ink-2', warn: 'text-ink', danger: 'text-danger', ok: 'text-ok' }[tone];
  const I = tone === 'warn' || tone === 'danger' ? Icon.Warning : tone === 'ok' ? Icon.Check : Icon.Info;
  return (
    <div className={cx('flex gap-3 rounded-xl border px-4 py-3 text-[13.5px] leading-[1.55] text-ink-2', t)}>
      <I size={18} className={cx('mt-0.5 shrink-0', mark)} />
      <div>
        {title ? <div className={cx('font-semibold', mark)}>{title}</div> : null}
        <div className={cx(title && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  );
}

/** Gold dot: the one warm accent, and it means "not a photograph of what is there". */
export function StagedLabel({ className }: { className?: string }) {
  return (
    <span className={cx('chip !text-[10.5px] font-semibold tracking-[0.14em] uppercase', className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-gold" /> digitally staged
    </span>
  );
}
