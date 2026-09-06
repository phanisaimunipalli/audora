/**
 * The layer panel for a room backed by a real Marble reconstruction: which parts of the capture are
 * drawn (the photograph, the splat, the measured mesh) and the floor nudge that lines the capture up
 * with Audora's metric floor.
 *
 * One panel, mounted identically in the buyer's viewer and in the staging editor, so a seller who
 * nudges the floor while staging sees exactly what the buyer will see. Numbers are mono and the
 * room's anchor travels with them (FloorOffset draws the AnchorChip itself).
 */
import type { RoomWorld } from '@/state/types';
import { FloorOffset } from './FloorOffset';
import { Icon } from './icons';
import { Chip, IconButton, Toggle, cx } from './ui';

export interface WorldLayersProps {
  roomId: string;
  world?: RoomWorld;
  showGeometry: boolean;
  onGeometry: (v: boolean) => void;
  /** Omitted where the splat cannot be drawn (photo view, dollhouse). */
  showSplat?: boolean;
  onSplat?: (v: boolean) => void;
  /** Explains why the splat row is inert — "walk to see it" rather than a missing row. */
  splatHint?: string;
  onClose?: () => void;
  className?: string;
}

export function WorldLayers({ roomId, world, showGeometry, onGeometry, showSplat, onSplat, splatHint, onClose, className }: WorldLayersProps) {
  const hasCollider = Boolean(world?.colliderUrl);
  const hasSplat = Boolean(world?.spzUrl);
  return (
    <div className={cx('glass animate-rise flex w-[290px] max-w-[86vw] flex-col gap-3 rounded-2xl p-3.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Real capture</span>
        {onClose ? (
          <IconButton label="Close the layers panel" onClick={onClose} className="!h-6 !w-6 !border-0 !bg-transparent">
            <Icon.X size={13} />
          </IconButton>
        ) : null}
      </div>

      {hasCollider ? (
        <LayerRow
          checked={showGeometry}
          onChange={onGeometry}
          title="Geometry"
          body="The mesh Marble measured, drawn over the photograph."
        />
      ) : null}

      {hasSplat && onSplat ? (
        <LayerRow
          checked={Boolean(showSplat)}
          onChange={onSplat}
          title="Real capture"
          body={splatHint ?? 'The Gaussian splat instead of the measured shell.'}
        />
      ) : null}

      {hasCollider || hasSplat ? <div className="h-px w-full bg-line" /> : null}

      <FloorOffset roomId={roomId} />

      {world?.metricScaleFactor || world?.groundPlaneOffset != null ? (
        <div className="flex flex-wrap gap-1">
          {world.metricScaleFactor ? (
            <Chip mono tone="ok" className="!text-[10px]">
              metric scale {world.metricScaleFactor.toFixed(3)} m/unit
            </Chip>
          ) : null}
          {world.groundPlaneOffset != null ? <Chip mono className="!text-[10px]">ground {world.groundPlaneOffset.toFixed(2)} m</Chip> : null}
        </div>
      ) : null}
    </div>
  );
}

function LayerRow({ checked, onChange, title, body }: { checked: boolean; onChange: (v: boolean) => void; title: string; body: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] text-ink">{title}</div>
        <p className="text-[11px] leading-snug text-ink-3">{body}</p>
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}
