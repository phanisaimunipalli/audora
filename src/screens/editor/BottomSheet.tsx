import { useEffect, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Sheet height as a viewport fraction. */
  height?: 'half' | 'tall';
}

/** Mobile rail: slides up from the bottom over the canvas, with a scrim and a drag-handle look. */
export function BottomSheet({ open, onClose, title, children, height = 'half' }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  return (
    <>
      <div className={cx('fixed inset-0 z-40 bg-black/50 transition-opacity', open ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={onClose} aria-hidden />
      <section
        role="dialog"
        aria-hidden={!open}
        className={cx(
          'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-3xl border-t border-line-2 bg-surface shadow-soft transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
          height === 'tall' ? 'h-[78dvh]' : 'h-[58dvh]',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="flex items-center gap-3 px-4 pt-2 pb-1">
          <span className="mx-auto h-1 w-10 rounded-full bg-line-2" />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <div className="text-sm font-medium text-ink">{title}</div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <Icon.X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </>
  );
}
