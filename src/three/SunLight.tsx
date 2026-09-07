/**
 * The real sun, through the real windows.
 *
 * Everything else in the scene guesses at light: the shell has a studio key by the window,
 * `CaptureLight` reads a sun out of the panorama's brightest region. This one is not a guess. The
 * address gives a latitude and longitude, the OpenStreetMap footprint and the seller's compass give
 * the heading of the room's north wall, and `sunPosition` gives the sun for that instant — so the
 * light in the room is the light that will actually be in the room at 14:20 on the 6th of March.
 *
 * Two rooms, one light:
 * - **Procedural room.** The shell drops its own directional sun (`externalSun`) and this one takes
 *   over, shining in through the windows on the walls the sun is really on and sweeping across the
 *   floor as the hour slider moves.
 * - **Real capture.** The photograph is not relit — the splat and the panorama are unlit materials
 *   and ignore lights by construction, which is exactly the portrait-mode contract. The sun lights
 *   only the furniture layer and drops its shadows onto a catcher plane on the photographed floor.
 *
 * Below the horizon the intensity fades to 0 (`sunIntensity`) rather than switching off, so dusk
 * looks like dusk.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import type { RoomGeometry, WallSide } from '@/engine/types';
import { wallFeaturePosition } from '@/engine/geometry';
import type { SunState } from '@/engine/siteSun';
import { lightPool } from './textures';

export interface SunLightProps {
  room: RoomGeometry;
  /** `sunState(date, lat, lon, heading)` — computed by the caller, which also prints its readout. */
  sun: SunState;
  /**
   * A real capture is on screen. The sun then lights only what Audora draws (the photograph is
   * unlit) and brings its own shadow catcher, because the shell's floor is not there to receive.
   */
  composite?: boolean;
  /**
   * Overall multiplier. Over a real capture pass `externalSunScale(budget, sun.intensity)` from
   * `CaptureLight`: the photograph's light budget already reserved a share for the key it did not
   * emit, and this sun fills exactly that share — no brighter, or the furniture stops belonging.
   */
  intensity?: number;
  shadows?: boolean;
  /** Opacity of the shadow on the real floor; `budget.shadowOpacity` when a photograph is up. */
  shadowOpacity?: number;
  quality?: 'low' | 'high';
  /** The bright quad a window throws across the floor. */
  shafts?: boolean;
}

interface Shaft {
  key: string;
  x: number;
  z: number;
  yaw: number;
  width: number;
  length: number;
  opacity: number;
}

/**
 * Where a window's light lands on the floor: a quad starting at the window, running away from the
 * sun along the floor, as long as the sun is low (`top / tan(elevation)`) and as wide as the window
 * is when seen from the sun's direction.
 */
export function sunShafts(room: RoomGeometry, sun: SunState, walls: WallSide[]): Shaft[] {
  if (sun.intensity <= 0.001) return [];
  const d = sun.direction;
  const horiz = Math.hypot(d.x, d.z);
  if (horiz < 1e-3) return [];
  // Away from the sun, along the floor.
  const fx = -d.x / horiz;
  const fz = -d.z / horiz;
  const span = Math.max(room.width, room.depth);
  const out: Shaft[] = [];
  room.windows.forEach((w, i) => {
    if (!walls.includes(w.wall)) return;
    const p = wallFeaturePosition(room, w.wall, w.offset);
    // How square the sun is onto this wall: a grazing sun throws almost nothing inside.
    const face = fx * p.inward.x + fz * p.inward.z;
    if (face <= 0.08) return;
    const top = w.sill + w.height;
    const elev = Math.max(2, sun.sun.elevation);
    const length = Math.min(span * 1.7, Math.max(0.5, top / Math.tan((elev * Math.PI) / 180)));
    out.push({
      key: `${w.wall}${i}`,
      x: p.x + p.inward.x * 0.06,
      z: p.z + p.inward.z * 0.06,
      yaw: Math.atan2(fx, fz),
      width: Math.min(span, (w.width * 1.1) / Math.max(0.35, face)),
      length,
      opacity: 0.34 * sun.intensity * Math.min(1, face + 0.25),
    });
  });
  return out;
}

/** The warm quad a window throws on the floor. Cosmetic, and ignored by measuring. */
function Shaft({ shaft }: { shaft: Shaft }) {
  const tex = useMemo(() => lightPool(), []);
  return (
    <group position={[shaft.x, 0, shaft.z]} rotation={[0, shaft.yaw, 0]}>
      <mesh position={[0, 0.007, shaft.length / 2]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} userData={{ measureIgnore: true, stillsKeep: true }}>
        <planeGeometry args={[shaft.width, shaft.length]} />
        <meshBasicMaterial map={tex} transparent opacity={shaft.opacity} depthWrite={false} blending={THREE.AdditiveBlending} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
    </group>
  );
}

export function SunLight({ room, sun, composite = false, intensity = 1, shadows = true, shadowOpacity, quality = 'high', shafts = true }: SunLightProps) {
  const target = useMemo(() => new THREE.Object3D(), []);
  const list = useMemo(() => (shafts ? sunShafts(room, sun, sun.walls) : []), [room, sun, shafts]);
  const span = Math.max(room.width, room.depth, room.height);
  const dist = Math.max(8, span * 1.8 + 4);
  const k = sun.intensity * intensity;
  // A shadow needs a sun; below the horizon there is neither, and the room falls back to its fill.
  const lit = k > 0.004;
  const half = Math.max(4, span * 0.9);
  const map = quality === 'high' ? 2048 : 1024;

  return (
    <>
      {lit ? (
        <>
          <directionalLight
            position={[sun.direction.x * dist, sun.direction.y * dist, sun.direction.z * dist]}
            target={target}
            intensity={(composite ? 2.2 : 2.8) * k}
            color={sun.color}
            castShadow={shadows}
            shadow-mapSize={[map, map]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.024}
            shadow-radius={quality === 'high' ? 4 : 2}
            shadow-camera-near={0.5}
            shadow-camera-far={dist * 2.5}
            shadow-camera-left={-half}
            shadow-camera-right={half}
            shadow-camera-top={half}
            shadow-camera-bottom={-half}
          />
          <primitive object={target} position={[0, 0, 0]} />
        </>
      ) : null}
      {/* On a real capture the photographed floor is not a surface we own, so the sun needs a plane
          to drop its shadows on: invisible except where something shades it — and exactly the size
          of the floor the buyer can see. It used to be `span * 3`, three times the room, which at a
          low morning sun caught the long shadows *past* the far wall and painted them up the
          photographed wall as a hard grey smudge (the depth-only occluder does not always cover the
          wall/floor junction, where the collider's stretched triangles are trimmed away). The floor
          stops at the wall, so the shadow does too. */}
      {composite && shadows && lit ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0025, 0]} receiveShadow renderOrder={1} raycast={() => null} userData={{ measureIgnore: true, stillsKeep: true }}>
          <planeGeometry args={[room.width, room.depth]} />
          <shadowMaterial transparent opacity={shadowOpacity ?? 0.14 + 0.28 * sun.intensity} depthWrite={false} />
        </mesh>
      ) : null}
      {list.map((s) => (
        <Shaft key={s.key} shaft={s} />
      ))}
    </>
  );
}
