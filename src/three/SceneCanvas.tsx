import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { Spinner, cx } from '@/components/ui';

export interface SceneCanvasProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onCreated?: (state: RootState) => void;
  /** Initial camera; the rigs take over immediately. */
  camera?: { fov?: number; near?: number; far?: number; position?: [number, number, number] };
  /** MSAA. Spark prefers false for splat-heavy scenes; the procedural room looks better with it on. */
  antialias?: boolean;
  /** Distance fog in the house colour; false to disable. */
  fog?: boolean | { near: number; far: number };
  background?: string;
  /** Needed only when reading pixels back outside a render (stills do not need it). */
  preserveDrawingBuffer?: boolean;
  /** Fixed device pixel ratio range. */
  dpr?: [number, number];
  /** Extra props forwarded to the r3f Canvas (eventSource, frameloop, ...). */
  frameloop?: 'always' | 'demand' | 'never';
  eventSource?: HTMLElement | React.RefObject<HTMLElement>;
  /** A click that hit nothing in the scene (r3f `onPointerMissed`), e.g. to clear a selection. */
  onPointerMissed?: (event: MouseEvent) => void;
  /** Copy for the placeholder shown until the first frame has rendered. */
  loadingLabel?: string;
  /** Hide the first-frame placeholder (thumbnails, offscreen renders). */
  hideLoading?: boolean;
  /**
   * Keeps the placeholder up past the first frame — a scene whose panorama or splat is still
   * downloading has rendered a frame but has nothing in it yet.
   */
  busy?: boolean;
  /** Replaces `loadingLabel` while `busy`, e.g. "Loading the panorama · 62%". */
  busyLabel?: string;
  /** 0..1 progress bar under the label. */
  busyProgress?: number | null;
  /**
   * The first frame has been drawn — the scene is on screen. HUDs use it to hold back anything that
   * would cover the loading state (or claim the buyer is standing somewhere that is not there yet).
   */
  onReady?: () => void;
}

/** The house background: a near-white ground, so the dollhouse sits on the page rather than in a void. */
export const HOUSE_BG = '#f4f4f4';

declare global {
  interface Window {
    /** Dev only: every mounted Audora scene's r3f root state, so frames can be stepped from the console (`advance`). */
    __audoraScenes?: RootState[];
  }
}

/**
 * Reports the first rendered frame (so the placeholder can go) and, in dev, registers the root state
 * on `window.__audoraScenes` for scripted testing.
 */
function FirstFrame({ onFrame }: { onFrame: () => void }) {
  const fired = useRef(false);
  const get = useThree((s) => s.get);
  useFrame(() => {
    if (fired.current) return;
    fired.current = true;
    onFrame();
  });
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const st = get();
    const list = (window.__audoraScenes ||= []);
    list.push(st);
    return () => {
      const i = list.indexOf(st);
      if (i >= 0) list.splice(i, 1);
    };
  }, [get]);
  return null;
}

/**
 * The house look for every 3D surface in Audora: soft (PCF, radius-filtered) shadows, ACES tone mapping, sRGB output,
 * the near-white background and a whisper of fog so the dollhouse recedes at the edges. Until the first frame lands the
 * viewport shows a quiet placeholder instead of an empty void.
 */
export function SceneCanvas({
  children,
  className,
  style,
  onCreated,
  camera,
  antialias = true,
  fog = true,
  background = HOUSE_BG,
  preserveDrawingBuffer = false,
  dpr = [1, 2],
  frameloop,
  eventSource,
  onPointerMissed,
  loadingLabel = 'Building the room…',
  hideLoading = false,
  busy = false,
  busyLabel,
  busyProgress = null,
  onReady,
}: SceneCanvasProps) {
  const fogArgs: [number, number] | null = fog === false ? null : fog === true ? [14, 46] : [fog.near, fog.far];
  const extra: Record<string, unknown> = {};
  if (frameloop) extra.frameloop = frameloop;
  if (eventSource) extra.eventSource = eventSource;
  if (onPointerMissed) extra.onPointerMissed = onPointerMissed;
  const [ready, setReady] = useState(false);
  const readyCb = useRef(onReady);
  readyCb.current = onReady;
  const showLoading = !hideLoading && frameloop !== 'never' && (!ready || busy);
  /* A real Marble room can take half a minute to its first frame, and "Building the room…" for
     thirty seconds is indistinguishable from a hang. Whenever the caller knows what is actually
     downloading, that line — and its progress bar — wins over the generic one, before the first
     frame as well as after it. */
  const informative = (busy || !ready) && busyLabel ? busyLabel : null;
  const label = informative ?? loadingLabel;
  const progress = (busy || !ready) && busyProgress != null ? busyProgress : null;
  // `h-full w-full` is the default so a canvas dropped into a sized parent fills it. Without it the
  // wrapper collapses (its only child is absolutely positioned) and the viewport is a black void.
  return (
    <div className={cx('relative h-full w-full overflow-hidden', className)} style={{ background, ...style }}>
      <Canvas
        {...extra}
        style={{ position: 'absolute', inset: 0, touchAction: style?.touchAction }}
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={dpr}
        camera={{ fov: camera?.fov ?? 55, near: camera?.near ?? 0.05, far: camera?.far ?? 200, position: camera?.position ?? [4, 3, 6] }}
        gl={{ antialias, preserveDrawingBuffer, powerPreference: 'high-performance', alpha: false, stencil: false }}
        onCreated={(state) => {
          const { gl } = state;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFShadowMap;
          gl.setClearColor(new THREE.Color(background), 1);
          onCreated?.(state);
        }}
      >
        <color attach="background" args={[background]} />
        {fogArgs ? <fog attach="fog" args={[background, fogArgs[0], fogArgs[1]]} /> : null}
        {children}
        <FirstFrame
          onFrame={() => {
            setReady(true);
            readyCb.current?.();
          }}
        />
      </Canvas>
      {showLoading ? (
        <div className={cx('pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300', ready && 'bg-transparent')} aria-hidden>
          {!ready ? (
            <>
              <div className="grid-bg absolute inset-0 opacity-70" />
              <div className="skeleton absolute inset-0 opacity-25" />
            </>
          ) : null}
          <div className="glass animate-fade relative flex min-w-[190px] flex-col gap-1.5 rounded-2xl px-3.5 py-2">
            <div className="flex items-center gap-2 text-xs text-ink-2">
              <Spinner size={12} className="text-dim" /> {label}
            </div>
            {progress != null ? (
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
