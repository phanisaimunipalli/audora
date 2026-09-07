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
 * Split a label into what it was measured from and the uncertainty it carries:
 * "interior door · 2.03 m · ±4 cm" → `{ head: 'interior door · 2.03 m', tolerance: '±4 cm' }`.
 * The ± is the whole point of the chip, so it is pulled out and pinned; only the head truncates.
 */
export function splitTolerance(label: string): { head: string; tolerance: string | null } {
  const m = label.match(/^(.*?)\s*·?\s*(±\s*[\d.]+\s*(?:cm|mm|m))\s*$/);
  return m && m[1].trim() ? { head: m[1].trim(), tolerance: m[2] } : { head: label, tolerance: null };
}

/**
 * The anchor is shown permanently wherever a number is shown. It is the product's honesty device:
 * every metre in the room is derived from this one reference and carries this uncertainty.
 *
 * In a narrow slot the chip has to give something up. It gives up the middle of the reference
 * ("interior door · 2.0…") and never the ±: an anchor without its uncertainty is exactly the claim
 * Audora refuses to make.
 */
export function AnchorChip({ anchor, className, size = 'md', showDetail }: { anchor: AnchorSpec; className?: string; size?: 'sm' | 'md'; showDetail?: boolean }) {
  // Gold is the anchor's colour: the one warm accent in an otherwise black-and-white app.
  // Gold on white, opaque: the chip also rides over the 3D view, where a tinted background would
  // pick up whatever is behind it and the gold would go dark.
  const tone = anchor.method === 'assumed' ? 'text-warn border-warn/45 bg-bg' : anchor.method === 'marble' || anchor.method === 'ceiling' ? 'text-ink-2 border-line-2 bg-bg' : 'text-gold border-gold/45 bg-bg';
  const I = anchor.method === 'door' ? Icon.Door : anchor.method === 'wall' || anchor.method === 'floorplan' ? Icon.Ruler : anchor.method === 'outlet' ? Icon.Zap : Icon.Info;
  const { head, tolerance } = splitTolerance(spacedUnits(anchor.label));
  return (
    /* In a 260 px glass panel a single truncating line lost the reference's second word — "anchor:
       interior do… · ±4 cm" — and the reference is half the claim. The chip wraps instead: it may
       take two lines in a narrow slot, and it never gives a word up. The prefix and the separator
       carry full colour too; at 0.6 opacity the gold measured 2.43:1. */
    <span
      className={cx('inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border px-2.5 py-1 mono leading-snug', size === 'sm' ? 'text-[11px]' : 'text-xs', tone, className)}
      title={`${METHOD_LABEL[anchor.method]}. ${spacedUnits(anchor.label)}. ${anchor.detail ?? ''}`}
    >
      <I size={size === 'sm' ? 12 : 14} className="shrink-0" />
      <span className="shrink-0">anchor:</span>
      <span className="min-w-0 break-words">{head}</span>
      {tolerance ? <span className="shrink-0 whitespace-nowrap">· {tolerance}</span> : null}
      {showDetail && anchor.detail ? <span className="shrink-0 font-sans text-dim">· {anchor.detail}</span> : null}
    </span>
  );
}

export function anchorMethodLabel(m: AnchorSpec['method']) {
  return METHOD_LABEL[m];
}
