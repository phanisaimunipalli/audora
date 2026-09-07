import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlacedPiece, RoomGeometry } from '@/engine/types';
import { RoomShell } from '@/three/RoomShell';
import { StagingLayer } from '@/three/furniture/StagingLayer';
import { cx } from '@/components/ui';
import { RoomPlan } from './RoomPlan';

export interface HeroSceneProps {
  room: RoomGeometry;
  staging: PlacedPiece[];
  buyerPieces?: PlacedPiece[];
  className?: string;
  /** Called once the WebGL context is up (used to fade the overlay in). */
  onReady?: () => void;
}

const AUTO_SPEED = 0.11; // radians per second
const DRAG_GAIN = 0.0065; // radians per pixel

function Rig({ room, paused, drag }: { room: RoomGeometry; paused: RefObject<boolean>; drag: RefObject<number> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const st = useRef({ angle: 0.85, speed: AUTO_SPEED });
  const target = useMemo(() => new THREE.Vector3(0, 0.45, 0), []);
  const span = Math.max(room.width, room.depth);
  // Portrait canvases (phones) need to pull back so the room still fits side to side.
  const aspect = size.width / Math.max(1, size.height);
  const fit = aspect < 1.25 ? 1.12 / aspect : 1;
  const radius = (span * 1.1 + 1.6) * fit;
  const height = span * 0.62 + 0.9;
  const invalidate = useThree((s) => s.invalidate);
  const place = useCallback(() => {
    camera.position.set(Math.sin(st.current.angle) * radius, height, Math.cos(st.current.angle) * radius);
    camera.lookAt(target);
  }, [camera, radius, height, target]);
  // Frame the room immediately (and whenever the canvas is resized) so even a single on-demand
  // frame, e.g. in a background tab where the loop is paused, shows the dollhouse rather than
  // the default camera pose.
  useLayoutEffect(() => {
    place();
    invalidate();
  }, [place, invalidate]);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    const want = paused.current ? 0 : AUTO_SPEED;
    st.current.speed += (want - st.current.speed) * Math.min(1, d * 2.5);
    st.current.angle += st.current.speed * d + drag.current;
    drag.current = 0;
    place();
  });
  return null;
}

function Plinth({ room }: { room: RoomGeometry }) {
  return (
    <mesh position={[0, -0.07, 0]} receiveShadow>
      <boxGeometry args={[room.width + 0.7, 0.14, room.depth + 0.7]} />
      <meshStandardMaterial color="#ececec" roughness={1} />
    </mesh>
  );
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // A hidden document reports nothing as intersecting; keep the last visible-state answer
    // instead of pausing the loop, so the scene is already running when the tab is shown.
    const io = new IntersectionObserver(([e]) => {
      if (document.visibilityState === 'hidden' && !e.isIntersecting) return;
      setInView(e.isIntersecting);
    }, { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

function useReducedMotionFlag(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduce;
}

/**
 * The live hero: the demo room as a dollhouse, slowly orbiting. Hover pauses it, dragging turns it,
 * and it stops rendering entirely while scrolled out of view. Falls back to the SVG plan when WebGL
 * is unavailable.
 */
export function HeroScene({ room, staging, buyerPieces = [], className, onReady }: HeroSceneProps) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const inView = useInView(wrap);
  const reduce = useReducedMotionFlag();
  const hovered = useRef(false);
  const paused = useRef(false);
  const drag = useRef(0);
  const pointer = useRef<{ id: number; x: number } | null>(null);
  const [ready, setReady] = useState(false);
  // Mount the canvas one tick after first paint so the hero copy is on screen before shaders compile.
  const [mount, setMount] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMount(true), 120);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    paused.current = reduce || hovered.current;
  }, [reduce]);

  const onEnter = () => {
    hovered.current = true;
    paused.current = true;
  };
  const onLeave = () => {
    hovered.current = false;
    paused.current = reduce;
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointer.current = { id: e.pointerId, x: e.clientX };
    paused.current = true;
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointer.current || pointer.current.id !== e.pointerId) return;
    drag.current += (e.clientX - pointer.current.x) * DRAG_GAIN;
    pointer.current.x = e.clientX;
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointer.current || pointer.current.id !== e.pointerId) return;
    pointer.current = null;
    paused.current = reduce || hovered.current;
  };

  const fallback = (
    <div className="flex h-full w-full items-center justify-center p-6">
      <RoomPlan room={room} staging={staging} buyer={buyerPieces[0]} className="max-h-full" />
    </div>
  );

  return (
    <div
      ref={wrap}
      className={cx('relative h-full w-full select-none', className)}
      style={{ touchAction: 'pan-y' }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <SceneBoundary fallback={fallback}>
        <div className={cx('h-full w-full transition-opacity duration-700', ready ? 'opacity-100' : 'opacity-0')}>
          {mount ? (
          <Canvas
            dpr={[1, 1.5]}
            shadows={{ type: THREE.PCFShadowMap }}
            frameloop={inView ? 'always' : 'never'}
            camera={{ fov: 34, near: 0.1, far: 80, position: [5, 4, 6] }}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            onCreated={() => {
              setReady(true);
              onReady?.();
            }}
            style={{ touchAction: 'pan-y' }}
          >
            <Rig room={room} paused={paused} drag={drag} />
            <Plinth room={room} />
            <RoomShell room={room} cullNearWalls shadowQuality="low" />
            <StagingLayer room={room} pieces={staging} buyerPieces={buyerPieces} />
          </Canvas>
          ) : null}
        </div>
      </SceneBoundary>
      {!ready ? <div className="skeleton absolute inset-0 rounded-[inherit]" aria-hidden /> : null}
    </div>
  );
}
