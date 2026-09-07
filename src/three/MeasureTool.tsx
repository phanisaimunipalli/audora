import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { RoomGeometry } from '@/engine/types';
import { useViewer, type Measurement } from './viewerStore';

export interface MeasureToolProps {
  room: RoomGeometry;
  enabled: boolean;
  /** ± uncertainty of the room's anchor, shown with every measurement. */
  uncertaintyM: number;
  color?: string;
  onMeasure?: (m: Measurement | null) => void;
}

type P = { x: number; y: number; z: number };

const CLICK_PX = 5;

/** Objects flagged `userData.measureIgnore` (and their children), or hidden ones, never receive measurement points. */
function measurable(o: THREE.Object3D): boolean {
  let c: THREE.Object3D | null = o;
  while (c) {
    if (!c.visible || c.userData?.measureIgnore) return false;
    c = c.parent;
  }
  return true;
}

function Marker({ p, color, ghost }: { p: P; color: string; ghost?: boolean }) {
  return (
    <group position={[p.x, p.y, p.z]}>
      <mesh renderOrder={20}>
        <sphereGeometry args={[ghost ? 0.016 : 0.022, 16, 16]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={ghost ? 0.7 : 1} toneMapped={false} />
      </mesh>
      {/* A white halo so an ink marker still reads against a dark corner of the photograph. */}
      <mesh renderOrder={19}>
        <sphereGeometry args={[ghost ? 0.035 : 0.05, 16, 16]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.55} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Two clicks on any surface (floor, walls, furniture, a real splat) → a dimension line with its
 * length and the anchor's ± uncertainty. A third click or Escape starts over. The live distance
 * follows the pointer after the first click.
 */
export function MeasureTool({ enabled, uncertaintyM, color = '#0a0a0a', onMeasure }: MeasureToolProps) {
  const { gl, camera, scene } = useThree();
  const [a, setA] = useState<P | null>(null);
  const [b, setB] = useState<P | null>(null);
  const [hover, setHover] = useState<P | null>(null);
  const ndc = useRef<THREE.Vector2 | null>(null);
  const dirty = useRef(false);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const setMeasurement = useViewer((s) => s.setMeasurement);
  /* The HUD's × clears the store; without reading it back this tool kept its own `a`/`b` and left
     the line, both endpoint markers and the floating label standing in the room for ever. */
  const measurement = useViewer((s) => s.measurement);
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;
  const stateRef = useRef({ a, b });
  stateRef.current = { a, b };

  const pick = (v: THREE.Vector2): P | null => {
    raycaster.setFromCamera(v, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const h of hits) {
      if (!measurable(h.object)) continue;
      if (h.distance < 0.08) continue; // the near plane / our own eye
      return { x: h.point.x, y: h.point.y, z: h.point.z };
    }
    return null;
  };

  const publish = (na: P | null, nb: P | null) => {
    let m: Measurement | null = null;
    if (na) {
      m = { a: na, uncertaintyM };
      if (nb) {
        m.b = nb;
        m.metres = Math.hypot(nb.x - na.x, nb.y - na.y, nb.z - na.z);
      }
    }
    setMeasurement(m);
    onMeasureRef.current?.(m);
  };

  useEffect(() => {
    if (measurement !== null) return;
    setA(null);
    setB(null);
    setHover(null);
  }, [measurement]);

  useEffect(() => {
    if (!enabled) {
      setA(null);
      setB(null);
      setHover(null);
      return;
    }
    const el = gl.domElement;
    const prevCursor = el.style.cursor;
    el.style.cursor = 'crosshair';
    let down: { id: number; x: number; y: number } | null = null;
    const toNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      ndc.current = toNdc(e);
      dirty.current = true;
    };
    const onUp = (e: PointerEvent) => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_PX;
      down = null;
      if (moved) return;
      const p = pick(toNdc(e));
      if (!p) return;
      const { a: ca, b: cb } = stateRef.current;
      if (!ca || cb) {
        setA(p);
        setB(null);
        publish(p, null);
      } else {
        setB(p);
        publish(ca, p);
      }
    };
    const onLeave = () => {
      ndc.current = null;
      setHover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setA(null);
        setB(null);
        publish(null, null);
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
      el.style.cursor = prevCursor;
      setMeasurement(null);
      onMeasureRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, gl, camera, scene]);

  // Follow the pointer with a live preview; throttled to real pointer movement and ≥ 5 mm changes.
  useFrame(() => {
    if (!enabled || !dirty.current || !ndc.current) return;
    dirty.current = false;
    if (stateRef.current.b) return;
    const p = pick(ndc.current);
    setHover((prev) => {
      if (!p) return null;
      if (prev && Math.abs(prev.x - p.x) < 0.005 && Math.abs(prev.y - p.y) < 0.005 && Math.abs(prev.z - p.z) < 0.005) return prev;
      return p;
    });
  });

  if (!enabled) return null;
  const end = b ?? hover;
  const metres = a && end ? Math.hypot(end.x - a.x, end.y - a.y, end.z - a.z) : 0;
  const mid = a && end ? [(a.x + end.x) / 2, (a.y + end.y) / 2 + 0.02, (a.z + end.z) / 2] : null;
  const cm = Math.max(1, Math.round(uncertaintyM * 100));
  return (
    <group userData={{ measureIgnore: true, stillsHide: true }}>
      {hover && !b ? <Marker p={hover} color={color} ghost /> : null}
      {a ? <Marker p={a} color={color} /> : null}
      {b ? <Marker p={b} color={color} /> : null}
      {a && end ? (
        <Line points={[[a.x, a.y, a.z], [end.x, end.y, end.z]]} color={color} lineWidth={b ? 2.2 : 1.6} depthTest={false} transparent opacity={b ? 1 : 0.75} dashed={!b} dashSize={0.08} gapSize={0.05} renderOrder={18} toneMapped={false} />
      ) : null}
      {mid && a && end ? (
        <Html position={mid as [number, number, number]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {/* A white pill with mono numbers: the same label the HUD prints, standing in the room. */}
          <div className={`glass mono flex items-baseline gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-ink ${b ? '' : 'opacity-85'}`}>
            <span className="text-[15px]">{metres.toFixed(2)}</span>
            <span className="text-ink-2">m</span>
            <span className="text-dim">±{cm}cm</span>
          </div>
        </Html>
      ) : null}
      {a && !end ? null : null}
    </group>
  );
}
