/**
 * Portrait-mode layers: light our furniture with the room's own light.
 *
 * The real capture (Marble's panorama, and the splat made from it) is the photo layer. The furniture
 * is a second layer rendered with the same camera. For the two to composite as one photograph the
 * second layer has to be lit by the first — so this module takes the panorama and turns it into:
 *
 * 1. an **environment map** (PMREM) published to the furniture's own materials — and to nothing else
 *    (see `lighting/captureEnv`; `scene.environment` is deliberately not used, because that would
 *    light whatever standard material happens to be in the scene). A white duvet under a cool north
 *    window goes cool; an oak nightstand picks up the warm floor;
 * 2. a **sun** estimated from the panorama's brightest region — direction, colour and how directional
 *    the room actually is — casting onto
 * 3. a **shadow catcher**: an invisible plane on the real floor (y = 0) that draws nothing but the
 *    shadow, so a bed throws a shadow across the photograph's floorboards.
 *
 * What is new here, and what makes the difference between "lit" and "belongs", is that the *level*
 * is measured rather than chosen. The photo layer is drawn untone-mapped and the furniture layer
 * through ACES at exposure 1.05, so identical radiance comes out at two different brightnesses; and
 * the environment already carries the whole room, so a key light and a fill added on top double-count
 * it. `lighting/panoramaLight` measures the irradiance the photograph actually delivers and
 * `lighting/tone` inverts the tone curve, and `lightBudget` divides one honest total between the
 * environment, the key and the fill. The result: a white sofa in the corner room reads like the walls
 * around it, because that is literally the number it was solved for.
 *
 * Contact shadows live on the pieces themselves (see FurniturePiece), because they are a property of
 * the piece touching the floor rather than of the light.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { publishCaptureEnv, type CaptureEnvironment } from './lighting/captureEnv';
import { lightBudget, samplePanoramaLight, NEUTRAL_LIGHT, NEUTRAL_SUN, type LightBudget, type PanoramaLight, type SunEstimate } from './lighting/panoramaLight';

export type { SunEstimate, PanoramaLight, LightBudget };
export { NEUTRAL_SUN, NEUTRAL_LIGHT };

/**
 * Where the light in an equirectangular panorama comes from. Kept as a named export because it is
 * the one number a reader goes looking for; the whole measurement lives in
 * `lighting/panoramaLight.samplePanoramaLight`, which this delegates to.
 */
export function estimateSun(image: TexImageSource, groupRotationY = Math.PI, size = { w: 96, h: 48 }): SunEstimate | null {
  const light = samplePanoramaLight(image, { groupRotationY, width: size.w, height: size.h });
  return light ? light.sun : null;
}

export interface CaptureLightProps {
  /** The panorama, once decoded. Without it the neutral estimate is used. */
  texture?: THREE.Texture | null;
  /** `splatTransform().rotationY` — the turn the Marble group applies to the capture. */
  groupRotationY?: number;
  /** Room span in metres, for the shadow camera. */
  span?: number;
  /**
   * The photographed floor, in metres — the room's own rectangle, centred on the origin. The shadow
   * catcher is exactly this size, because a cast shadow has to stop where the floor stops: a catcher
   * that runs past the walls catches long shadows behind them and paints them up the photographed
   * wall. Omit it and the catcher falls back to a square around `span`.
   */
  floor?: { width: number; depth: number };
  /** Height of the real floor in our frame. Always 0 today; a parameter so it stays honest. */
  floorY?: number;
  /** Off while no real capture is on screen, so the procedural shell keeps its own light. */
  enabled?: boolean;
  /** Overall multiplier on the light this room throws. */
  intensity?: number;
  /**
   * Cast shadows from the estimated sun. False when someone else owns the room's direction (the real
   * sun from the address, `SunLight`): the key light and its catcher are then left out **and their
   * share of the budget is left unfilled**, so the external sun has somewhere to land.
   */
  shadows?: boolean;
  /** Phones get a smaller shadow map. */
  quality?: 'low' | 'high';
  /** Draw the shadow catcher on the real floor. Off hides shadows without changing the light. */
  catcher?: boolean;
  /** What the panorama measured. Fires once per texture. */
  onLight?: (light: PanoramaLight | null) => void;
  /** How that light was divided. Fires with the same cadence. */
  onBudget?: (budget: LightBudget | null) => void;
}

/**
 * The room's own light, applied to everything Audora draws inside it. Mount it in place of the
 * studio lights whenever the real capture is what the buyer is looking at.
 */
export function CaptureLight({
  texture,
  groupRotationY = Math.PI,
  span = 6,
  floor,
  floorY = 0,
  enabled = true,
  intensity = 1,
  shadows = true,
  quality = 'high',
  catcher = true,
  onLight,
  onBudget,
}: CaptureLightProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [light, setLight] = useState<PanoramaLight>(NEUTRAL_LIGHT);
  const [envMap, setEnvMap] = useState<THREE.Texture | null>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const report = useRef({ onLight, onBudget });
  report.current = { onLight, onBudget };

  /* ---- what the photograph measured ---- */
  useEffect(() => {
    if (!enabled) return;
    const img = texture?.image as TexImageSource | undefined;
    const measured = img ? samplePanoramaLight(img, { groupRotationY }) ?? NEUTRAL_LIGHT : NEUTRAL_LIGHT;
    setLight(measured);
    report.current.onLight?.(img ? measured : null);
    invalidate();
  }, [enabled, texture, groupRotationY, invalidate]);

  /* ---- the panorama, prefiltered, as an environment map ---- */
  useEffect(() => {
    if (!enabled || !texture) {
      setEnvMap(null);
      return;
    }
    let pmrem: THREE.PMREMGenerator | null = null;
    let rt: THREE.WebGLRenderTarget | null = null;
    try {
      pmrem = new THREE.PMREMGenerator(gl);
      pmrem.compileEquirectangularShader();
      rt = pmrem.fromEquirectangular(texture);
      setEnvMap(rt.texture);
      invalidate();
    } catch {
      /* no environment: the estimated sun and the fill still light the furniture */
      setEnvMap(null);
    }
    const mine = rt;
    const generator = pmrem;
    return () => {
      setEnvMap(null);
      mine?.dispose();
      generator?.dispose();
    };
  }, [enabled, texture, gl, invalidate]);

  /**
   * How one room's light is divided. Recomputed only when the photograph or the exposure changes —
   * this is a bisection on a tone curve, not per-frame work.
   */
  const budget = useMemo(
    () => lightBudget(light, { exposure: gl.toneMappingExposure, toneMapped: gl.toneMapping !== THREE.NoToneMapping, intensity }),
    [light, gl.toneMappingExposure, gl.toneMapping, intensity],
  );
  useEffect(() => {
    report.current.onBudget?.(enabled ? budget : null);
  }, [budget, enabled]);

  /**
   * Publish the environment to the furniture layer.
   *
   * three looks an environment texel up with `u = atan2(d.z, d.x)/2π + 0.5`, which is the mirror
   * image of the `atan2(x, z)` azimuth the panorama sphere uses — and that mirror is exactly the one
   * the sphere's own `scale.x = −1` applies, so the two cancel and only a yaw is left. Solving
   * `u_env(d) = u_sphere(d)` gives `β = π/2 − groupRotationY`.
   */
  const rotationY = Math.PI / 2 - groupRotationY;
  const environment = useMemo<CaptureEnvironment | null>(
    () => (enabled && envMap ? { envMap, envMapIntensity: budget.envMapIntensity, rotationY, light, budget } : null),
    [enabled, envMap, budget, rotationY, light],
  );
  useEffect(() => {
    publishCaptureEnv(gl, environment);
    invalidate();
    return () => publishCaptureEnv(gl, null);
  }, [gl, environment, invalidate]);

  if (!enabled) return null;

  const sun = light.sun;
  const dist = Math.max(6, span * 1.4 + 3);
  const p = sun.direction.clone().multiplyScalar(dist);
  const map = quality === 'high' ? 2048 : 1024;
  const half = Math.max(4, span * 0.85);
  /* The catcher is the real floor and no more of it (see `floor`). Without a measured room to hand
     it falls back to a square that reaches past the shadow camera, so a piece near the wall still
     drops its shadow onto something. */
  const catcherSize = Math.max(span * 2.2, half * 2.2);
  const catcherW = floor ? floor.width : catcherSize;
  const catcherD = floor ? floor.depth : catcherSize;

  return (
    <>
      {shadows ? (
        <>
          <directionalLight
            position={[p.x, floorY + p.y, p.z]}
            target={target}
            /* With a panorama the key takes its measured share of the budget. Without one there is
               nothing to measure and nothing to match, so the old studio key stands in. */
            intensity={envMap ? budget.key : (0.35 + sun.strength * 1.25) * intensity}
            color={budget.keyColor}
            castShadow
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
        </>
      ) : null}
      {/* Fill, so a piece's shadowed side is never a silhouette. Both are a few per cent of the
          budget: the environment map carries the colour and almost all of the level, because it is
          the room. Without a panorama they stand in for it entirely. */}
      <hemisphereLight args={['#ffffff', '#8a7f74', envMap ? budget.hemisphere : 0.3 * intensity]} />
      <ambientLight intensity={envMap ? budget.ambient : 0.5 * intensity} />
      {/* The real floor, drawn only where something shades it. */}
      {shadows && catcher ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY + 0.002, 0]} receiveShadow renderOrder={1} raycast={() => null} userData={{ measureIgnore: true, stillsKeep: true }}>
          <planeGeometry args={[catcherW, catcherD]} />
          <shadowMaterial transparent opacity={budget.shadowOpacity} depthWrite={false} />
        </mesh>
      ) : null}
    </>
  );
}

/**
 * How hard an *external* directional light (the real sun from the address, `SunLight`) should shine
 * when the panorama is already lighting the room: hard enough to fill exactly the share of the
 * budget the estimated key would have taken, and no harder. `base` is the intensity that light
 * applies at full strength before this multiplier.
 */
export function externalSunScale(budget: LightBudget | null, skyIntensity: number, base = 2.2): number {
  if (!budget || !(skyIntensity > 0.004) || !(base > 0)) return 1;
  return THREE.MathUtils.clamp(budget.key / (base * skyIntensity), 0.05, 1);
}
