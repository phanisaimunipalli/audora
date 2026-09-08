/**
 * The tier chip. Wherever a room is listed the leasing team should be able to see, without clicking,
 * which reconstruction the renter is actually walking and what it cost:
 * "draft · 35 s · 230 credits" · "full · marble-1.1 · 1,580 credits" · "simulated".
 */
import { fullIsShadowed, roomChip, worldChip } from '@/state/publish';
import type { Room, RoomWorld } from '@/state/types';
import { Chip, cx } from '@/components/ui';

export interface TierChipProps {
  /** The room whose *shown* world is described (full unless a simulated full would replace a real draft). */
  room?: Room;
  /** Or a specific world, when the caller already picked one. */
  world?: RoomWorld;
  /** A generation is on its way and the room has nothing yet. */
  generating?: boolean;
  /** Just the tier word ("full", "draft", "simulated") for tight rows; the rest lives in the tooltip. */
  compact?: boolean;
  className?: string;
}

export function TierChip({ room, world, generating, compact, className }: TierChipProps) {
  const info = room ? roomChip(room, { generating }) : worldChip(world, { generating });
  const text = compact ? info.text.split(' · ')[0] : info.text;
  return (
    <span title={compact ? `${info.text} — ${info.title}` : info.title} className="inline-flex">
      <Chip mono tone={info.tone} className={cx('!text-[10px]', className)}>
        {text}
      </Chip>
    </span>
  );
}

/**
 * The honest footnote for a room that carries a simulated full world the renter is not being shown.
 * It only happens while rehearsing the publish flow with "Prefer simulated reconstruction" on.
 */
export function ShadowedFullNote({ room, className }: { room: Room; className?: string }) {
  if (!fullIsShadowed(room)) return null;
  return (
    <div className={cx('text-[11px] text-ink-3', className)}>
      A simulated full-quality world is attached, but the real Marble capture is the better world, so that is what renters get.
    </div>
  );
}
