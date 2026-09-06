import type { AnchorSpec } from '@/engine/types';
import { Icon } from './icons';
import { cx } from './ui';

const METHOD_LABEL: Record<AnchorSpec['method'], string> = {
  door: 'Door anchor',
  outlet: 'Outlet anchor',
  wall: 'Measured wall',
  floorplan: 'Floor plan',
  ceiling: 'Assumed ceiling',
  marble: 'Model estimate',
  assumed: 'Unanchored',
};

/**
 * Anchors created before units carried a space still say "2.03m · ±4cm" in the store (the label is a
 * saved string, not a formula). Normalise on the way to the screen so every chip reads the same.
 */
export function spacedUnits(label: string): string {
  return label.replace(/(\d)\s*(cm|mm|m²|m)\b/g, '$1 $2');
}

/**
 * The anchor is shown permanently wherever a number is shown. It is the product's honesty device:
 * every metre in the room is derived from this one reference and carries this uncertainty.
 */
export function AnchorChip({ anchor, className, size = 'md', showDetail }: { anchor: AnchorSpec; className?: string; size?: 'sm' | 'md'; showDetail?: boolean }) {
  const tone = anchor.method === 'assumed' ? 'text-warn border-warn/40 bg-warn/10' : anchor.method === 'marble' || anchor.method === 'ceiling' ? 'text-ink-2 border-line-2 bg-surface-2' : 'text-accent-2 border-accent/40 bg-accent/10';
  const I = anchor.method === 'door' ? Icon.Door : anchor.method === 'wall' || anchor.method === 'floorplan' ? Icon.Ruler : anchor.method === 'outlet' ? Icon.Zap : Icon.Info;
  return (
    <span className={cx('inline-flex max-w-full items-center gap-2 overflow-hidden rounded-full border px-2.5 py-1 mono', size === 'sm' ? 'text-[11px]' : 'text-xs', tone, className)} title={`${METHOD_LABEL[anchor.method]}. ${spacedUnits(anchor.label)}. ${anchor.detail ?? ''}`}>
      <I size={size === 'sm' ? 12 : 14} className="shrink-0" />
      <span className="shrink-0 text-ink-3">anchor:</span>
      <span className="min-w-0 truncate">{spacedUnits(anchor.label)}</span>
      {showDetail && anchor.detail ? <span className="shrink-0 font-sans text-ink-3">· {anchor.detail}</span> : null}
    </span>
  );
}

export function anchorMethodLabel(m: AnchorSpec['method']) {
  return METHOD_LABEL[m];
}
