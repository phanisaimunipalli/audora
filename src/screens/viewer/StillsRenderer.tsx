import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import type { Room } from '@/state/types';
import { RoomShell } from '@/three/RoomShell';
import { StagingLayer } from '@/three/furniture/StagingLayer';
import { captureStills, stillSpecs, type StillSpec } from '@/three/stills';
import * as THREE from 'three';

export interface Still {
  name: string;
  dataUrl: string;
}

export interface StillsRendererProps {
  room: Room;
  width?: number;
  height?: number;
  specs?: StillSpec[];
  onDone: (stills: Still[]) => void;
  onError?: (error: unknown) => void;
}

/**
 * Drives the capture by hand (the canvas runs with frameloop "never"): for each listing angle the
 * default camera is parked at the viewpoint and one frame is advanced so RoomShell's near-wall
 * culling is computed for it, then the frame is rendered at listing resolution and read back.
 * Doing this synchronously means it also works when the tab is not in the foreground.
 */
function Capturer({ room, width, height, specs, onDone, onError }: Required<Pick<StillsRendererProps, 'room' | 'width' | 'height' | 'specs' | 'onDone'>> & Pick<StillsRendererProps, 'onError'>) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const advance = useThree((s) => s.advance);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
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
          out.push(...captureStills(gl, scene, room.geometry, { width, height, specs: [spec] }));
        }
        onDone(out);
      } catch (e) {
        onError?.(e);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [advance, camera, gl, scene, room, width, height, specs, onDone, onError]);

  return null;
}

/** An offscreen r3f canvas that renders a room's listing stills and reports back data URLs. Mount, wait for onDone, unmount. */
export function StillsRenderer({ room, width = 1600, height = 1000, specs, onDone, onError }: StillsRendererProps) {
  const list = useMemo(() => specs ?? stillSpecs(room.geometry), [specs, room.geometry]);
  return (
    <div aria-hidden style={{ position: 'fixed', left: -4200, top: 0, width: 840, height: 525, pointerEvents: 'none' }}>
      <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={1} frameloop="never" gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ fov: 60, near: 0.05, far: 200, position: [3, 2, 4] }}>
        <color attach="background" args={['#0e0d0c']} />
        <RoomShell room={room.geometry} cullNearWalls showCeiling={false} />
        <StagingLayer room={room.geometry} pieces={room.staging} />
        <Capturer room={room} width={width} height={height} specs={list} onDone={onDone} onError={onError} />
      </Canvas>
    </div>
  );
}
