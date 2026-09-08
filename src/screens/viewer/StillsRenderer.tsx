import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { PerspectiveCamera, Texture } from 'three';
import type { Room } from '@/state/types';
import { bestWorld } from '@/state/store';
import { RoomShell } from '@/three/RoomShell';
import { CaptureLight, externalSunScale, type LightBudget } from '@/three/CaptureLight';
import { SunLight } from '@/three/SunLight';
import type { SunState } from '@/engine/siteSun';
import { MarbleWorld, useMarbleFrame, type MarbleWorldStatus } from '@/three/MarbleWorld';
import { captureYaw } from '@/three/splat/frame';
import { StagingLayer } from '@/three/furniture/StagingLayer';
import { useViewer } from '@/three/viewerStore';
import { captureStills, compositeSpecs, stillSpecs, type StillSpec } from '@/three/stills';
import * as THREE from 'three';
import { HOUSE_BG } from '@/three/SceneCanvas';
import { floorOffsetOf, isReal } from './marble';

export interface Still {
  name: string;
  dataUrl: string;
}

export interface StillsRendererProps {
  room: Room;
  width?: number;
  height?: number;
  specs?: StillSpec[];
  /**
   * The address's own sun at the hour the leasing team staged at (`sunState`). The listing photograph then
   * carries the light the room will really have — the same sun the renter opens the tour under —
   * instead of the shell's studio key. Omit it and nothing changes.
   */
  sun?: SunState | null;
  onDone: (stills: Still[]) => void;
  onError?: (error: unknown) => void;
  /**
   * The room has a real capture but it could not be drawn, so these stills are of the measured room
   * instead of the photograph. Fires before `onDone`, so the caller can say so rather than let a
   * leasing team publish synthetic images believing they are the flat.
   */
  onFallback?: (reason: string) => void;
}

/**
 * How long the panorama may go **without progress** before the measured room is drawn instead.
 * Not a total budget: a 10 MB full-quality panorama on a slow line, or an offscreen canvas that has
 * to wait its turn for the main thread, is a wait rather than a failure, and a fixed 14 s from mount
 * quietly turned the flat's listing stills into procedural renders. The absolute cap below is the
 * backstop, so nothing hangs for ever.
 */
const PANO_STALL_MS = 15000;
const PANO_MAX_MS = 60000;

/** An empty stand-in so the frame hook can be called unconditionally. */
const NO_WORLD = { metricScaleFactor: null, groundPlaneOffset: null, bounds: undefined } as const;

/**
 * Drives the capture by hand (the canvas runs with frameloop "never"): for each listing angle the
 * default camera is parked at the viewpoint and one frame is advanced so RoomShell's near-wall
 * culling — and the shadow map for that view — is computed for it, then the frame is rendered at
 * listing resolution and read back. Doing this synchronously means it also works when the tab is not
 * in the foreground.
 */
function Capturer({
  room,
  width,
  height,
  specs,
  ready,
  onDone,
  onError,
}: Required<Pick<StillsRendererProps, 'room' | 'width' | 'height' | 'specs' | 'onDone'>> & Pick<StillsRendererProps, 'onError'> & { ready: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const advance = useThree((s) => s.advance);
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !ready) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled || done.current) return;
      done.current = true;
      try {
        const cam = camera as PerspectiveCamera;
        const out: Still[] = [];
        advance(performance.now()); // warm-up: compiles materials and shadow maps
        for (const spec of specs) {
          cam.position.set(...spec.position);
          cam.lookAt(...spec.lookAt);
          cam.fov = spec.fov ?? 60;
          cam.updateProjectionMatrix();
          advance(performance.now()); // runs the culling pass for this viewpoint
          out.push(...captureStills(gl, scene, room.geometry, { width, height, specs: [spec], camera: cam }));
        }
        onDone(out);
      } catch (e) {
        onError?.(e);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [advance, camera, gl, scene, room, width, height, specs, ready, onDone, onError]);

  return null;
}

/**
 * An offscreen r3f canvas that renders a room's listing stills and reports back data URLs. Mount,
 * wait for onDone, unmount.
 *
 * **A room with a real capture is composited, not redrawn.** The listing still is the same three
 * layers the renter walks in: the photograph, the furniture lit by it (`CaptureLight`'s environment
 * and its estimated sun) and the shadow that furniture drops back onto the photographed floor —
 * plus the collider written to depth, so a piece behind a real wall is behind it in the still too.
 * The measured shell is not drawn at all, exactly as in the viewer. The angles all turn on the
 * capture point, because a panorama is only a photograph from where it was taken, and the first of
 * them is **Portrait**: the direction the renter was looking when they asked for stills.
 *
 * The panorama rather than the splat is the photo layer here: Spark sorts its splats on the render
 * loop, and this canvas has none (`frameloop="never"`). From the capture point the two are the same
 * photograph.
 *
 * The caller burns the disclosure in (`watermark` in three/stills); these frames come out clean.
 */
export function StillsRenderer({ room, width = 1600, height = 1000, specs, sun, onDone, onError, onFallback }: StillsRendererProps) {
  const world = bestWorld(room);
  const real = isReal(world) ? world : undefined;
  const frame = useMarbleFrame(real ?? NO_WORLD, room.anchor.metresPerUnit, floorOffsetOf(room));
  const [panoTex, setPanoTex] = useState<Texture | null>(null);
  /** The photograph is on screen (or has given up), so the stills can be taken. */
  const [ready, setReady] = useState(!real);
  const [failed, setFailed] = useState<string | null>(null);
  /** Last sign of life from the panorama — bytes arriving counts, mounting does not. */
  const beat = useRef(Date.now());
  const fallbackCb = useRef(onFallback);
  fallbackCb.current = onFallback;
  const giveUp = (reason: string) => {
    setFailed((f) => f ?? reason);
    setReady(true);
  };

  /* Never leave the leasing team waiting on a CDN — but never call a download that is still arriving a
     failure either. The clock is reset by every progress report and only runs out on a stall. */
  useEffect(() => {
    if (!real || ready) return;
    const started = Date.now();
    beat.current = started;
    const t = window.setInterval(() => {
      const now = Date.now();
      if (now - beat.current < PANO_STALL_MS && now - started < PANO_MAX_MS) return;
      window.clearInterval(t);
      giveUp(now - started >= PANO_MAX_MS ? 'the panorama took too long to load' : 'the panorama stopped downloading');
    }, 1000);
    return () => window.clearInterval(t);
  }, [real, ready]);

  const onStatus = (s: MarbleWorldStatus) => {
    if (s.layer !== 'pano') return;
    if (s.status === 'loading') beat.current = Date.now();
    if (s.status === 'ready') setReady(true);
    if (s.status === 'error') giveUp(s.detail ? `the panorama could not be loaded (${s.detail})` : 'the panorama could not be loaded');
  };

  /* The leasing team is told, once, when a room that has a real capture comes back as a procedural
     render — silently publishing the shell as if it were the flat is the thing to avoid. */
  const told = useRef(false);
  useEffect(() => {
    if (!failed || !real || told.current) return;
    told.current = true;
    fallbackCb.current?.(failed);
  }, [failed, real]);

  const composite = Boolean(real) && !failed;
  const span = Math.max(room.geometry.width, room.geometry.depth);
  /* The real sun owns the shadows whenever the address gives us one, exactly as in the viewer; the
     panorama keeps giving the room its colour and its level. Below the horizon the panorama's own
     estimated sun takes the shadows back, so a dusk still is not a shadowless one. */
  const sunUp = Boolean(sun && sun.intensity > 0.01);
  /* Over a photograph the sun's strength is a share of the measured light budget, so the capture has
     to wait for that measurement — `externalSunScale(null, …)` is 1, which would put a studio sun on
     the photograph and undo the whole point of the composite. */
  const [budget, setBudget] = useState<LightBudget | null>(null);
  const lit = !composite || !sunUp || budget !== null || Boolean(failed);
  const list = useMemo(() => {
    if (specs) return specs;
    if (!composite) return stillSpecs(room.geometry);
    const pose = useViewer.getState().pose;
    const capture = { x: frame.position[0], z: frame.position[2], yaw: captureYaw(frame) };
    // The renter's own direction, when they have one — a pose still at the origin is the default.
    const looking = Math.abs(pose.x) > 0.001 || Math.abs(pose.z) > 0.001 || Math.abs(pose.yaw) > 0.001 ? { yaw: pose.yaw } : null;
    // The room and what stands in it, so the four angles are four pictures rather than one wall.
    return compositeSpecs(capture, looking, { room: room.geometry, pieces: room.staging });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specs, composite, room.geometry, room.staging, frame.position[0], frame.position[2], frame.yaw]);

  return (
    <div aria-hidden style={{ position: 'fixed', left: -4200, top: 0, width: 840, height: 525, pointerEvents: 'none' }}>
      <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={1} frameloop="never" gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ fov: 60, near: 0.05, far: 200, position: [3, 2, 4] }}>
        {/* The house ground: a listing still of a simulated room is a white-page picture, not a night shot. */}
        <color attach="background" args={[HOUSE_BG]} />
        {real ? (
          <MarbleWorld
            world={real}
            metresPerUnit={room.anchor.metresPerUnit}
            floorOffset={floorOffsetOf(room)}
            showPano={!failed}
            showSplat={false}
            showOccluder={composite}
            onStatus={onStatus}
            onPanoTexture={setPanoTex}
          />
        ) : null}
        {composite ? (
          <CaptureLight
            texture={panoTex}
            groupRotationY={frame.rotationY}
            span={span}
            floor={{ width: room.geometry.width, depth: room.geometry.depth }}
            shadows={!sunUp}
            onBudget={setBudget}
          />
        ) : (
          <RoomShell room={room.geometry} cullNearWalls showCeiling={false} externalSun={Boolean(sun)} sunWalls={sun?.walls} />
        )}
        {sun ? (
          <SunLight
            room={room.geometry}
            sun={sun}
            composite={composite}
            intensity={composite ? externalSunScale(budget, sun.intensity) : 1}
            shadowOpacity={composite ? budget?.shadowOpacity : undefined}
          />
        ) : null}
        <StagingLayer room={room.geometry} pieces={room.staging} contactShadows={composite} />
        <Capturer room={room} width={width} height={height} specs={list} ready={ready && lit} onDone={onDone} onError={onError} />
      </Canvas>
    </div>
  );
}
