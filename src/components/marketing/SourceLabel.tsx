import { cx } from '@/components/ui';

/**
 * The permanent provenance label on every model of a unit: it was generated from photographs, not
 * captured by a scanner. `StagedLabel` ("digitally staged") comes back when staging does; until
 * then this is the only claim the pictures make about themselves (docs/COPY.md).
 */
export function SourceLabel({ className }: { className?: string }) {
  return (
    <span className={cx('chip !text-[10.5px] font-semibold tracking-[0.14em] uppercase', className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-gold" /> AI-generated from photos
    </span>
  );
}
