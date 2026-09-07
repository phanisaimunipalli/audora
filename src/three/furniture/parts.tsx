/**
 * Cheap primitives every procedural piece is built from. A context carries the per-piece render state
 * (ghost opacity, selection glow, shadows) so the kind bodies in kinds.tsx only talk geometry + colour.
 */
import { useContext, type ReactNode } from 'react';
import { RoundedBox } from '@react-three/drei';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { useCaptureEnv } from '../lighting/captureEnv';
import { PartContext, noRaycast, type PartState } from './partContext';

type V3 = [number, number, number];

export interface MatProps {
  color: string;
  rough?: number;
  metal?: number;
  /** Extra emissive for lit parts like screens and lamp shades. */
  glow?: string;
  glowIntensity?: number;
  /** Render both faces (open lamp shades). */
  double?: boolean;
}

/**
 * Every procedural piece's only material — and the only material in Audora that reads the capture's
 * environment map.
 *
 * That is the portrait-mode contract made literal: the room's own light is delivered per material
 * (`lighting/captureEnv`) rather than through `scene.environment`, so it reaches the furniture layer
 * and cannot reach the photo layer, the measured shell, or anything a teammate mounts later. When no
 * real capture is on screen there is no environment and the piece falls back to whatever lights the
 * scene has, exactly as before.
 *
 * The `key` is load-bearing: three only recompiles a material's program when it is told to, and
 * gaining an `envMap` changes the program. Remounting the material — once, when the panorama lands —
 * is the cheap way to be certain the furniture is actually lit rather than silently unlit.
 */
export function Mat({ color, rough = 0.85, metal = 0, glow, glowIntensity = 0, double }: MatProps) {
  const s = useContext(PartContext);
  const env = useCaptureEnv();
  const em = glow ?? s.emissive;
  const emI = glow ? glowIntensity : s.emissiveIntensity;
  return (
    <meshStandardMaterial
      key={env ? env.envMap.uuid : 'unlit'}
      color={color}
      roughness={rough}
      metalness={metal}
      emissive={em}
      emissiveIntensity={emI}
      envMap={env ? env.envMap : null}
      envMapIntensity={env ? env.envMapIntensity : 1}
      envMapRotation={env ? [0, env.rotationY, 0] : undefined}
      transparent={s.ghost}
      opacity={s.ghost ? 0.5 : 1}
      depthWrite={!s.ghost}
      side={double ? THREE.DoubleSide : THREE.FrontSide}
    />
  );
}

interface Common extends MatProps {
  pos?: V3;
  rot?: V3;
  /** Solids cast shadows; skip for thin or flat details. */
  shadow?: boolean;
}

function useMeshFlags(shadow: boolean | undefined): Pick<ThreeElements['mesh'], 'castShadow' | 'receiveShadow' | 'raycast'> {
  const s = useContext(PartContext);
  const cast = (shadow ?? true) && s.shadow && !s.ghost;
  return { castShadow: cast, receiveShadow: !s.ghost, raycast: s.ghost ? noRaycast : undefined };
}

/** Axis-aligned box: size = [w (x), h (y), d (z)], pos is the centre. */
export function Box({ size, pos = [0, 0, 0], rot, shadow, ...mat }: Common & { size: V3 }) {
  const flags = useMeshFlags(shadow);
  return (
    <mesh position={pos} rotation={rot} {...flags}>
      <boxGeometry args={size} />
      <Mat {...mat} />
    </mesh>
  );
}

/** Rounded box for soft things (cushions, mattresses, pillows). Radius is clamped to the smallest side. */
export function Soft({ size, pos = [0, 0, 0], rot, radius = 0.04, shadow, ...mat }: Common & { size: V3; radius?: number }) {
  const flags = useMeshFlags(shadow);
  const r = Math.min(radius, Math.min(size[0], size[1], size[2]) / 2 - 0.002);
  return (
    <RoundedBox args={size} radius={Math.max(0.004, r)} smoothness={3} position={pos} rotation={rot} {...flags}>
      <Mat {...mat} />
    </RoundedBox>
  );
}

/** Vertical cylinder, pos is the centre. */
export function Cyl({ r, h, rTop, pos = [0, 0, 0], rot, segments = 18, shadow, open, ...mat }: Common & { r: number; h: number; rTop?: number; segments?: number; open?: boolean }) {
  const flags = useMeshFlags(shadow);
  return (
    <mesh position={pos} rotation={rot} {...flags}>
      <cylinderGeometry args={[rTop ?? r, r, h, segments, 1, Boolean(open)]} />
      <Mat {...mat} />
    </mesh>
  );
}

export function Ball({ r, pos = [0, 0, 0], scale, shadow, ...mat }: Common & { r: number; scale?: V3 }) {
  const flags = useMeshFlags(shadow);
  return (
    <mesh position={pos} scale={scale} {...flags}>
      <sphereGeometry args={[r, 14, 10]} />
      <Mat {...mat} />
    </mesh>
  );
}

/** A group of parts sharing the same render state. */
export function Parts({ state, children }: { state: PartState; children: ReactNode }) {
  return <PartContext.Provider value={state}>{children}</PartContext.Provider>;
}

/** Four legs under a rectangular top. */
export function Legs({ w, d, h, y = 0, inset = 0.05, t = 0.04, color, round, rough = 0.5, metal = 0 }: { w: number; d: number; h: number; y?: number; inset?: number; t?: number; color: string; round?: boolean; rough?: number; metal?: number }) {
  const hx = Math.max(0.01, w / 2 - inset - t / 2);
  const hz = Math.max(0.01, d / 2 - inset - t / 2);
  const legs: V3[] = [
    [-hx, y + h / 2, -hz],
    [hx, y + h / 2, -hz],
    [hx, y + h / 2, hz],
    [-hx, y + h / 2, hz],
  ];
  return (
    <>
      {legs.map((p, i) => (round ? <Cyl key={i} r={t / 2} h={h} pos={p} color={color} rough={rough} metal={metal} segments={10} /> : <Box key={i} size={[t, h, t]} pos={p} color={color} rough={rough} metal={metal} />))}
    </>
  );
}
