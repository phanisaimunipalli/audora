import { useState } from 'react';
import { Kbd, cx } from '@/components/ui';

const ROWS: { keys: string[]; what: string }[] = [
  { keys: ['drag'], what: 'move · snaps to walls within 12 cm' },
  { keys: ['⌥', 'drag'], what: 'move without snapping' },
  { keys: ['R'], what: 'rotate 90°' },
  { keys: ['[', ']'], what: 'rotate ±15°' },
  { keys: ['←→↑↓'], what: 'nudge 1 cm · ⇧ 10 cm' },
  { keys: ['⌘D'], what: 'duplicate' },
  { keys: ['⌫'], what: 'delete' },
  { keys: ['⌘Z', '⇧⌘Z'], what: 'undo · redo' },
  { keys: ['Esc'], what: 'deselect · cancel placing' },
];

/** Keyboard legend for the editor. Collapsed to a single "?" chip until opened. */
export function ShortcutLegend({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx('pointer-events-auto', className)}>
      {open ? (
        <div className="glass animate-rise flex w-64 flex-col gap-1.5 rounded-2xl p-3 text-[12px] text-ink-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.14em] text-ink-3">Shortcuts</span>
            <button type="button" onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink">
              close
            </button>
          </div>
          {ROWS.map((r) => (
            <div key={r.what} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1">
                {r.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
              <span className="text-right text-ink-3">{r.what}</span>
            </div>
          ))}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="glass flex h-8 items-center gap-2 rounded-full px-3 text-[12px] text-ink-2 transition-colors hover:text-ink" title="Keyboard shortcuts">
          <Kbd>?</Kbd> shortcuts
        </button>
      )}
    </div>
  );
}
