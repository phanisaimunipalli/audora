import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUi } from '@/state/store';
import { Icon } from './icons';
import { cx } from './ui';

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  useEffect(() => {
    const timers = toasts.map((t) => window.setTimeout(() => dismiss(t.id), t.ttl ?? (t.action ? 12000 : 6000)));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, dismiss]);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto popover animate-rise flex items-start gap-3 rounded-xl p-4', t.kind === 'success' && '!border-ink-2/30', t.kind === 'error' && '!border-danger/40', t.kind === 'warn' && '!border-ink-2/35')}>
          <div className={cx('mt-0.5', t.kind === 'error' ? 'text-danger' : 'text-ink')}>
            {t.kind === 'success' ? <Icon.Check /> : t.kind === 'error' || t.kind === 'warn' ? <Icon.Warning /> : <Icon.Bell />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">{t.title}</div>
            {t.body ? <div className="mt-0.5 text-xs text-dim">{t.body}</div> : null}
            {t.action ? (
              <Link to={t.action.to} onClick={() => dismiss(t.id)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
                {t.action.label} <Icon.ArrowRight size={14} />
              </Link>
            ) : null}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-faint transition-colors hover:text-ink" aria-label="Dismiss">
            <Icon.X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
