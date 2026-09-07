import { useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import type { PlacedPiece } from '@/engine/types';
import { snapRotation } from '@/engine/geometry';
import { capture, floorPoint } from './floor';
import { noRaycast } from './partContext';

export interface RotationHandleProps {
  piece: PlacedPiece;
  color: string;
  onStart?: () => void;
  /** Continuous while the knob is dragged around the piece. */
  onRotate: (rot: number) => void;
  onEnd?: () => void;
}

/**
 * A knob in front of the selected piece. Drag it around the piece to rotate; snaps to 15° unless Alt is held.
 * A faint circle on the floor shows the pivot. Rendered in world space so the knob follows the rotation live.
 */
export function RotationHandle({ piece, color, onStart, onRotate, onEnd }: RotationHandleProps) {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const dragging = useRef<number | null>(null);
  const reach = piece.d / 2 + 0.32;
  const radius = Math.hypot(piece.w, piece.d) / 2 + 0.12;

  const down = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    dragging.current = e.pointerId;
    capture(e, 'set');
    if (controls) controls.enabled = false;
    document.body.style.cursor = 'grabbing';
    onStart?.();
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (dragging.current !== e.pointerId) return;
    e.stopPropagation();
    const p = floorPoint(e.ray);
    if (!p) return;
    const rot = Math.atan2(p.x - piece.x, p.z - piece.z);
    onRotate(e.altKey ? rot : snapRotation(rot, Math.PI / 12));
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    if (dragging.current !== e.pointerId) return;
    e.stopPropagation();
    dragging.current = null;
    capture(e, 'release');
    if (controls) controls.enabled = true;
    document.body.style.cursor = '';
    onEnd?.();
  };

  return (
    <group position={[piece.x, 0, piece.z]} rotation={[0, piece.rot, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} raycast={noRaycast}>
        <ringGeometry args={[radius - 0.008, radius, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.03, piece.d / 2 + 0.16]} raycast={noRaycast}>
        <boxGeometry args={[0.012, 0.012, 0.3]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <mesh
        position={[0, 0.06, reach]}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerOver={() => {
          if (dragging.current === null) document.body.style.cursor = 'grab';
        }}
        onPointerOut={() => {
          if (dragging.current === null) document.body.style.cursor = '';
        }}
      >
        <sphereGeometry args={[0.075, 18, 14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45} roughness={0.4} />
      </mesh>
    </group>
  );
}
