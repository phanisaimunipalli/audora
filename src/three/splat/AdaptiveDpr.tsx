/**
 * Splat sorting is per-pixel work: at full device pixel ratio a 500k-splat room costs four times
 * what it costs at 1.0, and that is exactly the moment the buyer is moving and cannot see the
 * difference. This drops the canvas to 1.0 while the camera moves and puts the sharp frame back a
 * beat after it stops — the standard "adaptive resolution" trick, driven by the camera itself rather
 * than by a frame timer, so it never oscillates.
 *
 * Only mounted while a real capture is on screen; the procedural shell is cheap enough to stay sharp.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface AdaptiveDprProps {
  /** Pixel ratio while moving. */
  low?: number;
  /** Pixel ratio at rest; defaults to the device's own, capped at 2. */
  high?: number;
  /** Milliseconds of stillness before the sharp frame comes back. */
  settleMs?: number;
  enabled?: boolean;
}

const POS = new THREE.Vector3();
const QUAT = new THREE.Quaternion();

export function AdaptiveDpr({ low = 1, high, settleMs = 320, enabled = true }: AdaptiveDprProps) {
  const setDpr = useThree((s) => s.setDpr);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const sharp = high ?? Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const last = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), movedAt: 0, dpr: 0 });

  // Put the canvas back the way we found it, so leaving walk mode does not leave a soft viewport.
  useEffect(() => {
    if (enabled) return;
    setDpr(sharp);
  }, [enabled, sharp, setDpr]);
  useEffect(
    () => () => {
      setDpr(sharp);
    },
    [sharp, setDpr],
  );

  useFrame(() => {
    if (!enabled) return;
    const st = last.current;
    camera.getWorldPosition(POS);
    camera.getWorldQuaternion(QUAT);
    const moved = POS.distanceToSquared(st.pos) > 1e-6 || Math.abs(QUAT.dot(st.quat)) < 0.999995;
    const now = performance.now();
    if (moved) {
      st.pos.copy(POS);
      st.quat.copy(QUAT);
      st.movedAt = now;
    }
    const want = now - st.movedAt < settleMs ? low : sharp;
    if (want === st.dpr) return;
    st.dpr = want;
    // `setDpr` resizes the drawing buffer; only ever called on a transition, never per frame.
    if (Math.abs(gl.getPixelRatio() - want) > 0.01) setDpr(want);
  });

  return null;
}
