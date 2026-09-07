/**
 * The floor-height nudge, shared by every surface that shows a room's world details: the viewer's
 * geometry panel, the create wizard's anchor step and the hub's room card.
 *
 * A reconstruction is only as well placed as its scale: a draft world anchored on an assumed
 * ceiling can land a few centimetres out, and staged furniture then floats above the real floor or
 * sinks into it. `Room.floorOffset` raises or lowers the reconstruction until the two floors meet —
 * the metric frame never moves, so every dimension in the UI stays true (hence the AnchorChip).
 */
import type { ReactNode } from 'react';
import { FLOOR_NUDGE_RANGE_M, FLOOR_NUDGE_STEP_M, clampFloorOffset, formatFloorOffset } from '@/engine/anchor';
import { bestWorld, useAudora } from '@/state/store';
import type { Room } from '@/state/types';
import { AnchorChip } from './AnchorChip';
import { Button, cx } from './ui';
import { Icon } from './icons';

/** The nudge currently applied to a room's reconstruction, in metres. */
export function floorOffsetOf(room: Room | undefined): number {
  return clampFloorOffset(room?.floorOffset ?? 0);
}

export interface FloorOffsetProps {
  roomId: string;
  className?: string;
  /** One tight row for a canvas overlay; the default is a labelled block. */
  compact?: boolean;
  /** The room's anchor travels with every number Audora shows. Turn it off only where one is already visible. */
  showAnchor?: boolean;
  /** Replaces the default explanation under the slider. */
  hint?: ReactNode;
}

export function FloorOffset({ roomId, className, compact, showAnchor = true, hint }: FloorOffsetProps) {
  const room = useAudora((s) => s.rooms[roomId]);
  const setFloorOffset = useAudora((s) => s.setFloorOffset);
  if (!room) return null;
  const value = floorOffsetOf(room);
  const world = bestWorld(room);
  const set = (m: number) => setFloorOffset(room.id, m);

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className={cx('micro', compact && '!text-[10px] !tracking-[0.14em]')}>Floor height</span>
        <span className="flex items-center gap-2">
          <span className={cx('mono tabular-nums', value === 0 ? 'text-ink-3' : 'text-ink', compact ? 'text-[12px]' : 'text-[13px]')}>{formatFloorOffset(value)}</span>
          {value !== 0 ? (
            <button type="button" onClick={() => set(0)} className="mono text-[10px] text-ink-3 underline-offset-4 hover:text-ink hover:underline" aria-label="Reset the floor height">
              reset
            </button>
          ) : null}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <NudgeButton label="Lower the floor by one centimetre" onClick={() => set(value - FLOOR_NUDGE_STEP_M)}>
          −
        </NudgeButton>
        <input
          type="range"
          min={-FLOOR_NUDGE_RANGE_M}
          max={FLOOR_NUDGE_RANGE_M}
          step={FLOOR_NUDGE_STEP_M}
          value={value}
          onChange={(e) => set(Number(e.target.value))}
          className="w-full accent-accent"
          aria-label="Floor height in metres"
        />
        <NudgeButton label="Raise the floor by one centimetre" onClick={() => set(value + FLOOR_NUDGE_STEP_M)}>
          +
        </NudgeButton>
      </div>

      {compact ? null : (
        <p className="text-[11px] leading-snug text-ink-3">
          {hint ?? (
            <>
              Nudge the reconstruction until furniture sits on the real floor.{' '}
              {world?.metricScaleFactor ? 'The model measured itself, so this should stay near zero.' : 'Draft worlds carry no metric scale, so a centimetre or two is normal.'}
            </>
          )}
        </p>
      )}
      {showAnchor ? <AnchorChip anchor={room.anchor} size="sm" className="self-start" /> : null}
    </div>
  );
}

function NudgeButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line-2 bg-surface-2 text-[13px] text-ink-2 transition-colors hover:text-ink"
    >
      {children}
    </button>
  );
}

/**
 * The same control with a heading, for a panel of its own (hub, anchor step). `Button` and `Icon`
 * are imported here so the two layouts share one import surface.
 */
export function FloorOffsetPanel({ roomId, title = 'Floor height', className, showAnchor, onDone }: { roomId: string; title?: string; className?: string; showAnchor?: boolean; onDone?: () => void }) {
  return (
    <div className={cx('flex flex-col gap-2 rounded-xl border border-line bg-surface p-3', className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-ink-2">
        <Icon.Ruler size={14} /> {title}
      </div>
      <FloorOffset roomId={roomId} showAnchor={showAnchor} />
      {onDone ? (
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      ) : null}
    </div>
  );
}
