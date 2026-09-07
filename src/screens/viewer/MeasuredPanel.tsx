/**
 * "WHAT THE MODEL MEASURED" — the left glass panel over the 3D.
 *
 * It is the prototype's `.metrics-panel`, and it is Audora's honesty device made literal: the model
 * id, the metric scale (or `not reported`), the panorama's pixels, the splat ladder, whether a
 * collider came back, the eye height, where the floor was put, the room's own size and the anchor
 * every one of those numbers is derived from. Anything the reconstruction did not report is printed
 * faint and named, never guessed at and never left blank.
 */
import type { Room, RoomWorld } from '@/state/types';
import { AnchorChip } from '@/components/AnchorChip';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { HudPanel, MetricRow, PanelLabel, PanelNote } from './hud';
import { layerReady, type MarbleStatusMap } from './marble';

export interface MeasuredPanelProps {
  room: Room;
  world?: RoomWorld;
  /** Metres the capture point sits above our floor — the prototype's "Floor set to". */
  cameraHeight?: number | null;
  /** The panorama's pixel size, once its texture is on screen. */
  pano?: { w: number; h: number } | null;
  status?: MarbleStatusMap;
  onClose?: () => void;
  className?: string;
}

/** "500k · 100k · full_res" — every resolution Marble made of this world. */
function splatLods(world: RoomWorld | undefined): string | undefined {
  if (!world) return undefined;
  const keys = world.spzUrls ? Object.keys(world.spzUrls) : [];
  if (keys.length) return keys.join(' · ');
  return world.spzUrl ? 'one resolution' : undefined;
}

function footnote(world: RoomWorld | undefined, real: boolean): string {
  if (!real) return 'This room is a simulated reconstruction. Every number on it is derived from the anchor, not from a capture.';
  if (world?.metricScaleFactor) return 'Full quality reports its own metric scale. The anchor still carries the ± on every measurement.';
  return 'Draft renders return no metric scale. The floor is set by hand, so treat fit as indicative.';
}

export function MeasuredPanel({ room, world, cameraHeight, pano, status, onClose, className }: MeasuredPanelProps) {
  const real = world?.provider === 'marble' && Boolean(world.panoUrl || world.spzUrl || world.colliderUrl);
  const panoLabel = pano ? `${pano.w}×${pano.h}` : world?.panoUrl ? (status && layerReady(status, 'pano') ? 'loaded' : 'loading…') : undefined;
  const g = room.geometry;
  // A card on a laptop, the full width of the sheet on a phone.
  return (
    <HudPanel className={cx('w-full max-w-[calc(100vw-24px)] sm:w-[262px]', className)}>
      <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <PanelLabel>What the model measured</PanelLabel>
          {onClose ? (
            <button type="button" onClick={onClose} aria-label="Hide the measurements" className="-mr-1 flex h-5 w-5 items-center justify-center rounded-full text-faint transition-colors hover:text-ink">
              <Icon.X size={12} />
            </button>
          ) : null}
        </div>

        <div className="mt-2">
          <MetricRow label="Model" value={world?.model} />
          <MetricRow label="Metric scale" value={world?.metricScaleFactor ? `${world.metricScaleFactor.toFixed(4)}` : undefined} title="Metres per raw unit, when the model reports one." />
          <MetricRow label="Ground plane" value={world?.groundPlaneOffset != null ? `${world.groundPlaneOffset.toFixed(3)} m` : undefined} />
          <MetricRow label="Panorama" value={panoLabel} />
          <MetricRow label="Splat LODs" value={splatLods(world)} />
          <MetricRow label="Collider" value={world?.colliderUrl ? 'mesh returned' : undefined} />
          <MetricRow label="Eye height" value="1.600 m" />
          <MetricRow label="Floor set to" value={cameraHeight != null && Number.isFinite(cameraHeight) ? `${cameraHeight.toFixed(3)} m` : undefined} strong title="How far the floor sits below the capture point." />
          <MetricRow label="Room" value={`${g.width.toFixed(2)} × ${g.depth.toFixed(2)} m`} />
          <MetricRow label="Ceiling" value={`${g.height.toFixed(2)} m`} />
        </div>

        <div className="mt-2.5 border-t border-line pt-2.5">
          <AnchorChip anchor={room.anchor} size="sm" className="max-w-full" />
        </div>

        <PanelNote>{footnote(world, real)}</PanelNote>
      </div>
    </HudPanel>
  );
}
