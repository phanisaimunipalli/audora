/**
 * The exploded preview: the furniture layer lifted off the photograph.
 *
 * iOS shows you that a portrait photo is two layers by sliding the subject out of its background.
 * This is the same gesture and it makes the same point about Audora: the sofa is not painted into
 * the picture, it is a separate layer standing on the same floor with the same light. Two seconds,
 * 40 cm, critically damped both ways — subtle enough to be a demonstration rather than a toy.
 *
 * The shadow stays on the floor while the furniture rises, which is what sells it: the light did not
 * move, only the layer did.
 */
import { useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EXPLODE_LIFT_M } from './layers';

export interface ExplodedLayerProps {
  active: boolean;
  /** Metres to lift. */
  lift?: number;
  children: ReactNode;
}

export function ExplodedLayer({ active, lift = EXPLODE_LIFT_M, children }: ExplodedLayerProps) {
  const group = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const target = active ? lift : 0;
    if (Math.abs(g.position.y - target) < 0.0005) {
      if (g.position.y !== target) {
        g.position.y = target;
        invalidate();
      }
      return;
    }
    // `damp` is frame-rate independent, so the lift takes the same time on a 30 fps software
    // renderer as it does on a 120 Hz laptop.
    g.position.y = THREE.MathUtils.damp(g.position.y, target, 7, Math.min(0.1, delta));
    invalidate();
  });
  return <group ref={group}>{children}</group>;
}
