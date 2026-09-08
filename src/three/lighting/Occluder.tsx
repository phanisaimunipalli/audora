/**
 * Occlusion by real geometry.
 *
 * A sofa pushed past a photographed wall should disappear behind it, and a plant standing behind a
 * real column should be hidden by the column. Nothing in a splat can do that on its own: Gaussians
 * are transparent, they write no depth, and our furniture is drawn on top of everything. The
 * reconstruction's collider mesh is the missing surface — it is the only thing Audora holds that
 * knows where the real walls are — so it is drawn into the **depth buffer only**: `colorWrite` off,
 * `depthWrite` on, before the furniture. It paints no pixels and hides everything behind it.
 *
 * Two details make it work rather than nearly work:
 *
 * - **The margin.** The collider is a mesh of the same surfaces the splat draws, and the two do not
 *   agree to the centimetre — a depth-map mesh cuts corners around a window reveal, and a Gaussian
 *   has thickness. Written at its exact depth it therefore eats the splats *on* those walls: the
 *   corner room's windows came back as black streaks. So the mesh is scaled out from the capture
 *   point by a few per cent before it is drawn, which moves every surface a hand's width further
 *   away than the photograph puts it. The wall's own splats survive; furniture actually behind the
 *   wall — which is never 15 cm behind it, it is a metre behind it — is still hidden. Polygon offset
 *   on top of that covers the last coplanar case.
 * - **Double-sided.** The mesh is mirrored inside the Marble group (`COLLIDER_MIRROR`), which flips
 *   every triangle's winding; a front-sided material would occlude nothing at all.
 *
 * The same clone can also be *shown* — the "occluder" view of the Geometry layer — as a flat-shaded
 * normal surface, which is the honest picture of what is doing the hiding and reads at a glance as
 * geometry rather than as a room.
 */
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** Where the occluder sits in the render order: after the panorama, before the furniture. */
export const OCCLUDER_RENDER_ORDER = -2;

/**
 * Where it sits when it is being *shown* instead. The occluding surface is pushed out past the
 * photograph on purpose (see {@link OCCLUDER_MARGIN}), so drawn in its usual place it is behind the
 * splat and invisible — which makes for a poor answer to "show me the occluder". The revealed copy
 * therefore ignores depth and draws last, translucent, over the room it is hiding things behind.
 */
export const OCCLUDER_REVEAL_ORDER = 6;

/**
 * How far the occluding surface is pushed out from the capture point, as a fraction of its distance.
 * 5% is 15 cm on a wall 3 m away — comfortably more than the disagreement between the collider mesh
 * and the splat, comfortably less than "behind the wall". Measured on the demo corner room: at 0
 * the windows and the ceiling corner come back as black streaks, at 0.05 the splat is untouched.
 */
export const OCCLUDER_MARGIN = 0.05;

export interface OccluderProps {
  /** The loaded collider scene. Mount this component beside it, inside the same Marble group. */
  source: THREE.Object3D | null;
  /** Write depth, so real geometry hides furniture behind it. */
  enabled?: boolean;
  /** Also paint it, so the renter can see what is doing the hiding. */
  reveal?: boolean;
  /** The mirror the collider needs inside the Marble group. */
  scale?: [number, number, number];
  /** Fraction of its own distance the surface is pushed away from the capture point. See {@link OCCLUDER_MARGIN}. */
  margin?: number;
  /** Depth push, in polygon-offset units, for surfaces that end up coplanar anyway. */
  offset?: number;
}

/**
 * A depth-only copy of the collider mesh.
 *
 * `Object3D.clone()` shares geometry, so this costs a hierarchy and nothing else — the 150k
 * triangles are not duplicated, and the clone re-materials to a shader that writes no colour.
 */
export function Occluder({ source, enabled = true, reveal = false, scale = [-1, 1, 1], margin = OCCLUDER_MARGIN, offset = 3 }: OccluderProps) {
  const invalidate = useThree((s) => s.invalidate);

  const depthOnly = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: offset,
        polygonOffsetUnits: offset * 2,
      }),
    [offset],
  );
  const shown = useMemo(
    () => new THREE.MeshNormalMaterial({ flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false }),
    [],
  );

  const clone = useMemo(() => {
    if (!source) return null;
    const copy = source.clone(true);
    copy.name = 'audora-occluder';
    copy.userData = { measureIgnore: true, stillsKeep: true };
    copy.traverse((o) => {
      o.userData = { ...o.userData, measureIgnore: true, stillsKeep: true };
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = () => undefined;
    });
    return copy;
  }, [source]);

  useEffect(() => {
    if (!clone) return;
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = reveal ? shown : depthOnly;
      mesh.renderOrder = reveal ? OCCLUDER_REVEAL_ORDER : OCCLUDER_RENDER_ORDER;
    });
    invalidate();
  }, [clone, reveal, shown, depthOnly, invalidate]);

  useEffect(
    () => () => {
      depthOnly.dispose();
      shown.dispose();
    },
    [depthOnly, shown],
  );

  if (!clone || !(enabled || reveal)) return null;
  /* The collider's own origin is the capture point, so scaling it here pushes every surface away
     from where the photograph was taken — outward, through the walls — by `margin` of its distance.
     `renderOrder` is set on the *meshes* and deliberately not on this root: three reads a Group's
     renderOrder as the whole subtree's `groupOrder`, which outranks every mesh's own renderOrder —
     so an ordered root would have drawn the occluder before the panorama sphere and cut the
     photograph itself out of the frame. That is exactly the bug this comment is standing on. */
  const k = 1 + Math.max(0, margin);
  return <primitive object={clone} scale={[scale[0] * k, scale[1] * k, scale[2] * k]} raycast={() => null} />;
}
