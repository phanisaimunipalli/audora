/**
 * "STAGE A ROOM" — the editor's right-hand glass panel, the prototype's `.stage-panel`.
 *
 * Three moves, in the order a seller makes them: pick a whole look (the 2×2 preset grid, which runs
 * our auto-stager in that style), add one piece at a time from the catalogue (a coloured dot, the
 * name and the real footprint in mono), then nudge the floor until the furniture stands on the
 * photographed one. Clearing the room is the quiet button at the bottom, and it is undoable.
 */
import { STYLE_LABELS, type StagingStyle } from '@/engine/autostage';
import type { CatalogItem } from '@/engine/types';
import type { Room } from '@/state/types';
import { CatalogRail } from '@/components/CatalogRail';
import { FloorOffset } from '@/components/FloorOffset';
import { Spinner, cx } from '@/components/ui';
import { HudPanel, PanelLabel } from '@/screens/viewer/hud';

export interface StagePanelProps {
  room: Room;
  /** The style the room was last staged in. */
  style: StagingStyle;
  autoStaging: boolean;
  onAutoStage: (style: StagingStyle) => void;
  onAdd: (item: CatalogItem) => void;
  onDragStart?: (item: CatalogItem) => void;
  /** The catalogue item currently being placed. */
  activeId?: string | null;
  onClear: () => void;
  /** This room has a real reconstruction, so its floor can be nudged onto the photograph. */
  showFloorHeight?: boolean;
  /** Pieces currently staged, for the clear button's count. */
  pieces: number;
  /** The bottom sheet already says "Stage a room" in its own header. */
  hideLabel?: boolean;
  className?: string;
}

/** One line each, because a preset is a promise about what the room will look like. */
const STYLE_HINT: Record<StagingStyle, string> = {
  warm: 'Layered, a rug, plants',
  minimal: 'Fewer pieces, clear floor',
  scandi: 'Light woods, pale fabrics',
  family: 'Seats everyone, storage',
};

const STYLES = Object.keys(STYLE_LABELS) as StagingStyle[];

export function StagePanel({ room, style, autoStaging, onAutoStage, onAdd, onDragStart, activeId, onClear, showFloorHeight, pieces, hideLabel, className }: StagePanelProps) {
  return (
    <HudPanel className={cx('min-h-0', className)}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-3.5 pb-2 pt-3">
          {hideLabel ? null : <PanelLabel>Stage a room</PanelLabel>}
          <div className={cx('grid grid-cols-2 gap-1.5', !hideLabel && 'mt-2')}>
            {STYLES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={autoStaging}
                onClick={() => onAutoStage(s)}
                title={`Auto-stage ${room.name} · ${STYLE_LABELS[s]}. Replaces the current staging; undo brings it back.`}
                className={cx(
                  'flex flex-col items-start gap-0.5 rounded-[10px] border px-2.5 py-2 text-left transition-colors duration-200 ease-audora disabled:opacity-50',
                  s === style ? 'border-ink-2 bg-accent-soft' : 'border-line bg-surface hover:border-accent hover:bg-accent-soft',
                )}
              >
                <span className="flex w-full items-center gap-1.5 text-[12.5px] font-bold leading-tight text-ink">
                  {autoStaging && s === style ? <Spinner size={11} /> : null}
                  <span className="min-w-0 truncate">{STYLE_LABELS[s]}</span>
                </span>
                <span className="w-full truncate text-[10.5px] font-medium text-dim">{STYLE_HINT[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* the single-piece list: a dot, a name, a footprint */}
        <div className="min-h-0 flex-1">
          <CatalogRail roomType={room.type} onAdd={onAdd} onDragStart={onDragStart} activeId={activeId} label="Or add one" className="h-full" />
        </div>

        {showFloorHeight ? (
          <div className="border-t border-line px-3.5 py-3">
            <FloorOffset roomId={room.id} compact showAnchor={false} />
          </div>
        ) : null}

        <div className="border-t border-line px-3.5 py-2.5">
          <button
            type="button"
            onClick={onClear}
            disabled={pieces === 0}
            className="w-full rounded-lg border border-line-2 bg-bg px-3 py-2 text-[12px] font-semibold text-dim transition-colors duration-200 ease-audora hover:border-danger hover:text-danger disabled:opacity-40 disabled:hover:border-line-2 disabled:hover:text-dim"
          >
            Clear the room{pieces ? ` · ${pieces}` : ''}
          </button>
        </div>
      </div>
    </HudPanel>
  );
}
