/**
 * The Layers panel: portrait mode, taken apart.
 *
 * A real Marble room is a stack — the photograph, the real geometry that hides things, the furniture,
 * the shadow it drops back onto the photographed floor — and this is where a buyer (or a reviewer)
 * switches each one off and sees that it really is a separate layer. It also says out loud what the
 * photograph was measured to be lighting the room with, because an estimate the product acts on is
 * an estimate the product should admit to: "Light ahead on the left · 62% directional".
 *
 * It replaces the old `WorldLayers` and keeps everything that panel carried — the Geometry layer
 * and the floor nudge (with its anchor chip) — and it is mounted identically in the buyer's viewer
 * and in the staging editor, so a seller stages against the layers the buyer will be looking at.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomWorld } from '@/state/types';
import type { GeometryView } from '@/three/MarbleWorld';
import type { SunDescription } from '@/three/lighting/describe';
import { FloorOffset } from '@/components/FloorOffset';
import { Icon } from '@/components/icons';
import { Chip, IconButton, Segmented, Toggle, cx } from '@/components/ui';
import type { PortraitLayers } from './layers';

export interface LayersPanelProps {
  roomId: string;
  world?: RoomWorld;
  layers: PortraitLayers;
  onLayer: (key: keyof PortraitLayers, value: boolean) => void;
  /** The furniture layer is currently lifted off the photograph. */
  exploded: boolean;
  onExplode: () => void;
  showGeometry: boolean;
  onGeometry: (v: boolean) => void;
  geometryView: GeometryView;
  onGeometryView: (v: GeometryView) => void;
  /** What the panorama says about the room's light. Null while it is still loading. */
  sun?: SunDescription | null;
  /** The calibrated `envMapIntensity` the furniture is being lit at. */
  envIntensity?: number | null;
  /** A photograph is on screen; without one only the floor nudge is worth showing. */
  hasCapture: boolean;
  /** Why the photo layer row is inert here — "walk to see the splat", say. */
  photoHint?: string;
  onClose?: () => void;
  className?: string;
}

export function LayersPanel({
  roomId,
  world,
  layers,
  onLayer,
  exploded,
  onExplode,
  showGeometry,
  onGeometry,
  geometryView,
  onGeometryView,
  sun,
  envIntensity,
  hasCapture,
  photoHint,
  onClose,
  className,
}: LayersPanelProps) {
  const hasCollider = Boolean(world?.colliderUrl);
  /* Every row below the Photo switch describes the *composite*. With the photograph off there is no
     composite: the furniture is lit by the measured room's own studio light, the shadow falls on the
     shell's floor, and the panorama's measured sun is not lighting anything. Saying "Lit by the
     photograph" over a room with no photograph in it is the panel describing a state it is not in. */
  const composited = hasCapture && layers.photo;
  const { ref: scroller, more, scrollDown } = useMoreBelow();
  return (
    /* Ten rows is taller than the space between the bottom bar and the top of a phone screen, so the
       panel scrolls inside itself rather than pushing the mode switch off the viewport — and says so
       (`useMoreBelow`), because Geometry and the floor nudge live under the fold on a laptop and an
       overlay scrollbar that only appears once you are already scrolling is not an affordance. */
    <div className={cx('glass animate-rise relative flex max-h-[46vh] w-[300px] max-w-[86vw] flex-col rounded-2xl sm:max-h-[min(58vh,560px)]', className)}>
      <div ref={scroller} className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain p-3.5" style={more ? { paddingBottom: 30 } : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="micro">Layers</span>
        {onClose ? (
          <IconButton label="Close the layers panel" onClick={onClose} className="!h-6 !w-6 !border-0 !bg-transparent">
            <Icon.X size={13} />
          </IconButton>
        ) : null}
      </div>

      {hasCapture ? (
        <>
          <LayerRow
            checked={layers.photo}
            onChange={(v) => onLayer('photo', v)}
            title="Photo"
            body={photoHint ?? 'The real capture. Off falls back to the measured room.'}
          />
          <LayerRow
            checked={layers.furniture}
            onChange={(v) => onLayer('furniture', v)}
            title="Furniture"
            body={composited ? 'Lit by the photograph, not by a studio.' : 'Lit by the measured room while the photo is off.'}
          />
          <LayerRow
            checked={layers.shadows}
            onChange={(v) => onLayer('shadows', v)}
            title="Shadows"
            body={composited ? 'Onto the real floor, and under each piece.' : 'Onto the measured floor, and under each piece.'}
          />
          {hasCollider ? (
            <LayerRow
              checked={layers.occluder}
              onChange={(v) => onLayer('occluder', v)}
              title="Occluder"
              body={composited ? 'Real walls hide furniture behind them.' : 'Nothing to hide behind while the photo is off.'}
              disabled={!composited}
            />
          ) : null}

          <button
            type="button"
            onClick={onExplode}
            className={cx(
              'flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-[13px] transition-colors duration-200 ease-audora',
              exploded ? 'border-accent bg-accent text-white' : 'border-line-2 bg-bg text-ink-2 hover:border-ink-2 hover:text-ink',
            )}
            disabled={!layers.furniture}
          >
            <span>
              Exploded preview
              <span className="block text-[11px] leading-snug opacity-70">Lift the furniture off the photograph for a moment.</span>
            </span>
            <Icon.Layers size={15} className="shrink-0" />
          </button>

          {sun && composited ? (
            <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface px-3 py-2">
              <div className="flex items-center gap-1.5 text-[13px] text-ink">
                <Icon.Sun size={13} className="shrink-0 text-gold" />
                <span className="min-w-0 truncate">{sun.phrase}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Chip mono className="!text-[10px]">{sun.directional}</Chip>
                {envIntensity != null ? <Chip mono className="!text-[10px]">env ×{envIntensity.toFixed(2)}</Chip> : null}
                <Chip mono className="!text-[10px]">{Math.round(sun.elevationDeg)}° above</Chip>
              </div>
              <p className="text-[11px] leading-snug text-dim">Read off the panorama's brightest region.</p>
            </div>
          ) : null}
        </>
      ) : null}

      {hasCollider ? (
        <>
          <div className="h-px w-full bg-line" />
          <LayerRow checked={showGeometry} onChange={onGeometry} title="Geometry" body="The mesh Marble measured, over the photograph." />
          {showGeometry ? (
            <Segmented
              size="sm"
              className="w-full"
              value={geometryView}
              onChange={onGeometryView}
              options={[
                { value: 'wireframe' as GeometryView, label: 'Wireframe' },
                { value: 'occluder' as GeometryView, label: 'Occluder' },
              ]}
            />
          ) : null}
        </>
      ) : null}

      <div className="h-px w-full bg-line" />
      <FloorOffset roomId={roomId} />

      {world?.metricScaleFactor || world?.groundPlaneOffset != null ? (
        <div className="flex flex-wrap gap-1">
          {world.metricScaleFactor ? (
            <Chip mono tone="accent" className="!text-[10px]">
              metric scale {world.metricScaleFactor.toFixed(3)} m/unit
            </Chip>
          ) : null}
          {world.groundPlaneOffset != null ? <Chip mono className="!text-[10px]">ground {world.groundPlaneOffset.toFixed(2)} m</Chip> : null}
        </div>
      ) : null}
      </div>
      {more ? (
        <button
          type="button"
          onClick={scrollDown}
          aria-label="Scroll down for more layers"
          className="absolute inset-x-0 bottom-0 flex items-end justify-center rounded-b-2xl bg-gradient-to-t from-bg/95 via-bg/70 to-transparent pb-1 pt-6 text-dim hover:text-ink"
        >
          <Icon.ChevronDown size={14} />
        </button>
      ) : null}
    </div>
  );
}

/** True while the scroller has content below the fold; `scrollDown` pages toward it. */
function useMoreBelow() {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setMore(el.scrollHeight - el.clientHeight - el.scrollTop > 8);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  });
  const scrollDown = useCallback(() => {
    const el = ref.current;
    el?.scrollBy({ top: el.clientHeight * 0.8, behavior: 'smooth' });
  }, []);
  return { ref, more, scrollDown };
}

function LayerRow({ checked, onChange, title, body, disabled }: { checked: boolean; onChange: (v: boolean) => void; title: string; body: string; disabled?: boolean }) {
  return (
    <div className={cx('flex items-start justify-between gap-3', disabled && 'opacity-55')}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{title}</div>
        <p className="text-[11px] leading-snug text-dim">{body}</p>
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}
