/**
 * Portrait-mode layers: light our furniture with the room's own light.
 *
 * The real capture (Marble's panorama, and the splat made from it) is the photo layer. The furniture
 * is a second layer rendered with the same camera. For the two to composite as one photograph the
 * second layer has to be lit by the first — so this module takes the panorama and turns it into:
 *
 * 1. an **environment map** (PMREM) that lights every standard material in the scene, so a white
 *    duvet under a cool north window goes cool and an oak nightstand picks up the warm floor;
 * 2. a **sun** estimated from the panorama's brightest region — direction, colour and how directional
 *    the room actually is — casting onto
 * 3. a **shadow catcher**: an invisible plane on the real floor (y = 0) that draws nothing but the
 *    shadow, so a bed throws a shadow across the photograph's floorboards.
 *
 * Contact shadows live on the pieces themselves (see FurniturePiece), because they are a property of
 * the piece touching the floor rather than of the light.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface SunEstimate {
  /** Unit vector from the room toward the light, in Audora's metric frame. */
  direction: THREE.Vector3;
  /** Colour of the bright region, normalised to full value. */
  color: THREE.Color;
  /** 0..1: how much brighter the brightest region is than the room average — an overcast room is ~0. */
  strength: number;
  /** Mean luminance 0..1, used to keep the fill in step with the photograph's exposure. */
  ambient: number;
}

/** The default when a panorama cannot be read: a soft key over the left shoulder. */
export const NEUTRAL_SUN: SunEstimate = {
  direction: new THREE.Vector3(-0.45, 0.78, 0.44).normalize(),
  color: new THREE.Color('#fff1de'),
  strength: 0.35,
  ambient: 0.5,
};

/**
 * Where the light in an equirectangular panorama comes from.
 *
 * The mapping is the one PanoWorld documents, carried through the Marble group: the sphere maps a
 * texel `u` to azimuth `360u − 90°`, the mesh's x-mirror flips that to `90° − 360u`, its `+90°` yaw
 * makes it `180° − 360u`, and the group's own `rotationY` adds the last turn. `v` is plain
 * elevation. Sampling is done on a small canvas (the panorama is 2304×1152; 96×48 is plenty for a
 * direction) and the brightest texels are weighted by luminance⁴ so one window wins over a wall.
 */
export function estimateSun(image: TexImageSource, groupRotationY = Math.PI, size = { w: 96, h: 48 }): SunEstimate | null {
  let data: ImageData;
  try {
    const c = document.createElement('canvas');
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image as CanvasImageSource, 0, 0, size.w, size.h);
    data = ctx.getImageData(0, 0, size.w, size.h);
  } catch {
    // A tainted canvas (a panorama served without CORS) is not worth throwing over.
    return null;
  }
  const px = data.data;
  const lum: number[] = new Array(size.w * size.h);
  let mean = 0;
  let max = 0;
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const l = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
    lum[i] = l;
    mean += l;
    if (l > max) max = l;
  }
  mean /= lum.length;
  if (!(max > 0)) return null;

  // Only the top of the range is "the light"; everything else is the room reflecting it.
  const cut = mean + (max - mean) * 0.55;
  const dir = new THREE.Vector3();
  const rgb = new THREE.Vector3();
  let weight = 0;
  for (let y = 0; y < size.h; y++) {
    // Row 0 is the top of the image, which is straight up.
    const v = 1 - (y + 0.5) / size.h;
    const elevation = (v - 0.5) * Math.PI;
    // A texel near the pole covers less of the sphere than one at the horizon.
    const solid = Math.cos(elevation);
    for (let x = 0; x < size.w; x++) {
      const i = y * size.w + x;
      const l = lum[i];
      if (l < cut) continue;
      const u = (x + 0.5) / size.w;
      const azimuth = Math.PI - 2 * Math.PI * u + groupRotationY;
      const w = Math.pow(l, 4) * solid;
      dir.x += Math.cos(elevation) * Math.sin(azimuth) * w;
      dir.y += Math.sin(elevation) * w;
      dir.z += Math.cos(elevation) * Math.cos(azimuth) * w;
      const p = i * 4;
      rgb.x += px[p] * w;
      rgb.y += px[p + 1] * w;
      rgb.z += px[p + 2] * w;
      weight += w;
    }
  }
  if (weight <= 0 || dir.lengthSq() < 1e-6) return null;
  dir.normalize();
  // Daylight arrives from above even when the brightest texel is a window at eye height. A key light
  // near the horizon would light our furniture from underneath and rake shadows right out of the
  // room, so the estimate is lifted to 20° — the elevation the light actually reaches the floor at
  // once it has bounced off the ceiling.
  if (dir.y < 0.34) {
    dir.y = 0.34;
    dir.normalize();
  }
  rgb.divideScalar(weight);
  const peak = Math.max(rgb.x, rgb.y, rgb.z, 1);
  const color = new THREE.Color(rgb.x / peak, rgb.y / peak, rgb.z / peak).convertSRGBToLinear();
  return {
    direction: dir,
    color,
    // Flat light → the mean is close to the max → almost no sun, which is the honest answer.
    strength: THREE.MathUtils.clamp((max - mean) / Math.max(0.08, max), 0, 1),
    ambient: mean,
  };
}

export interface CaptureLightProps {
  /** The panorama, once decoded. Without it the neutral estimate is used. */
  texture?: THREE.Texture | null;
  /** `splatTransform().rotationY` — the turn the Marble group applies to the capture. */
  groupRotationY?: number;
  /** Room span in metres, for the shadow camera and the catcher plane. */
  span?: number;
  /** Height of the real floor in our frame. Always 0 today; a parameter so it stays honest. */
  floorY?: number;
  /** Off while no real capture is on screen, so the procedural shell keeps its own light. */
  enabled?: boolean;
  /** Overall multiplier on the light this room throws. */
  intensity?: number;
  /** Cast shadows from the estimated sun. */
  shadows?: boolean;
  /** Phones get a smaller shadow map. */
  quality?: 'low' | 'high';
}

/**
 * The room's own light, applied to everything Audora draws inside it. Mount it in place of the
 * studio lights whenever the real capture is what the buyer is looking at.
 */
export function CaptureLight({ texture, groupRotationY = Math.PI, span = 6, floorY = 0, enabled = true, intensity = 1, shadows = true, quality = 'high' }: CaptureLightProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const [sun, setSun] = useState<SunEstimate>(NEUTRAL_SUN);
  const target = useMemo(() => new THREE.Object3D(), []);
  const catcher = useRef<THREE.Mesh>(null);

  /* ---- the panorama as an environment map ---- */
  useEffect(() => {
    if (!enabled || !texture) return;
    let pmrem: THREE.PMREMGenerator | null = null;
    let rt: THREE.WebGLRenderTarget | null = null;
    try {
      pmrem = new THREE.PMREMGenerator(gl);
      pmrem.compileEquirectangularShader();
      rt = pmrem.fromEquirectangular(texture);
      scene.environment = rt.texture;
      /**
       * three looks an environment texel up with `u = atan2(d.z, d.x)/2π + 0.5`, which is the mirror
       * image of the `atan2(x, z)` azimuth the panorama sphere uses — and that mirror is exactly the
       * one the sphere's own `scale.x = −1` applies, so the two cancel and only a yaw is left.
       * Solving `u_env(d) = u_sphere(d)` gives `β = π/2 − groupRotationY`.
       */
      scene.environmentRotation = new THREE.Euler(0, Math.PI / 2 - groupRotationY, 0);
      scene.environmentIntensity = intensity;
      invalidate();
    } catch {
      /* no environment: the estimated sun and fill still light the furniture */
    }
    return () => {
      scene.environment = null;
      scene.environmentRotation = new THREE.Euler(0, 0, 0);
      scene.environmentIntensity = 1;
      rt?.dispose();
      pmrem?.dispose();
    };
  }, [enabled, texture, gl, scene, invalidate, groupRotationY, intensity]);

  /* ---- where the light comes from ---- */
  useEffect(() => {
    if (!enabled) return;
    const img = texture?.image as TexImageSource | undefined;
    if (!img) {
      setSun(NEUTRAL_SUN);
      return;
    }
    setSun(estimateSun(img, groupRotationY) ?? NEUTRAL_SUN);
    invalidate();
  }, [enabled, texture, groupRotationY, invalidate]);

  if (!enabled) return null;

  const dist = Math.max(6, span * 1.4 + 3);
  const p = sun.direction.clone().multiplyScalar(dist);
  const map = quality === 'high' ? 2048 : 1024;
  const half = Math.max(4, span * 0.85);
  // A room the panorama says is flatly lit gets a soft key and a faint shadow; a room with one bright
  // window gets a real one. Either way the environment map is doing most of the work.
  const key = (0.35 + sun.strength * 1.25) * intensity;
  const shadowAlpha = 0.16 + sun.strength * 0.3;

  return (
    <>
      <directionalLight
        position={[p.x, floorY + p.y, p.z]}
        target={target}
        intensity={key}
        color={sun.color}
        castShadow={shadows}
        shadow-mapSize={[map, map]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-radius={quality === 'high' ? 4 : 2}
        shadow-camera-near={0.5}
        shadow-camera-far={dist * 2.5}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
      />
      <primitive object={target} position={[0, floorY, 0]} />
      {/* Fill so a piece's shadowed side is never a silhouette. Scaled by the panorama's own mean
          brightness, so a dim flat stays dim and a sunlit room stays bright — the environment map
          still carries the colour and almost all of the level. */}
      <hemisphereLight args={['#ffffff', '#8a7f74', (texture ? 0.12 + sun.ambient * 0.34 : 0.3) * intensity]} />
      <ambientLight intensity={(texture ? 0.05 + sun.ambient * 0.14 : 0.5) * intensity} />
      {/* The real floor, drawn only where something shades it. */}
      {shadows ? (
        <mesh ref={catcher} rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY + 0.002, 0]} receiveShadow renderOrder={1} raycast={() => null} userData={{ measureIgnore: true, stillsKeep: true }}>
          <planeGeometry args={[span * 3, span * 3]} />
          <shadowMaterial transparent opacity={shadowAlpha} depthWrite={false} />
        </mesh>
      ) : null}
    </>
  );
}
