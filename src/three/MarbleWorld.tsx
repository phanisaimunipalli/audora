import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RoomWorld } from '@/state/types';
import { splatTransform } from '@/services/marble';
import { PANO_RADIUS, PanoWorld, type PanoProgress, type PanoStatus } from './PanoWorld';
import { SplatWorld, type SplatStatus } from './SplatWorld';

/** Purple wireframe of the reconstruction's collider mesh (the "Geometry" toggle). */
export const GEOMETRY_COLOR = '#7c6cf0';
export const GEOMETRY_OPACITY = 0.3;

/**
 * The collider `.glb` comes out of Marble's mesher with y flipped rather than rotated: x right,
 * y up, z forward is a *reflection* of the capture frame, so drawing it as delivered mirrors the
 * room. Mirroring x inside the Marble group puts it back — and lines it up with the SPZ splat,
 * which is a proper rotation of the same capture (rotX π; see SplatWorld) and needs no mirror.
 *
 * Verified on the demo world 24be684c against public/demo/empty-room-corner-windows.jpg: with this
 * mirror, looking from the capture point into the room puts the tall window on the LEFT wall and the
 * small window on the far wall, and the wireframe hugs the panorama's walls. Without it the room is
 * a mirror image of the photograph.
 */
export const COLLIDER_MIRROR: [number, number, number] = [-1, 1, 1];

export type MarbleLayer = 'pano' | 'collider' | 'splat';
export type MarbleStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MarbleWorldStatus {
  /** The layer the viewer is waiting on, or the one that failed. */
  layer: MarbleLayer;
  status: MarbleStatus;
  detail?: string;
  progress?: PanoProgress;
}

export interface MarbleWorldProps {
  world: RoomWorld;
  /** Metres per raw unit from the room's anchor; ignored when Marble reports its own metric scale. */
  metresPerUnit: number;
  /** `Room.floorOffset` — metres the whole reconstruction is nudged up so its floor meets ours. */
  floorOffset?: number;
  /** Draw the panorama sphere (photo view, and behind the splat in walk view). */
  showPano?: boolean;
  /** Draw the Gaussian splat when the world has one. */
  showSplat?: boolean;
  /** Draw the collider mesh as a purple wireframe. */
  showGeometry?: boolean;
  panoOpacity?: number;
  splatOpacity?: number;
  /** Aggregated load state of whichever layers are switched on. */
  onStatus?: (s: MarbleWorldStatus) => void;
  /** The capture point in Audora's metric frame — where the photo camera stands. */
  onOrigin?: (position: [number, number, number]) => void;
  /** The loaded collider scene, for callers that want to raycast it. */
  onCollider?: (scene: THREE.Object3D | null) => void;
}

/** Where this world sits in the metric room frame. Same maths the group below uses. */
export function useMarbleFrame(world: Pick<RoomWorld, 'metricScaleFactor' | 'groundPlaneOffset' | 'bounds'>, metresPerUnit: number, floorOffset = 0) {
  const msf = world.metricScaleFactor ?? null;
  const gpo = world.groundPlaneOffset ?? null;
  const b = world.bounds;
  const key = b ? `${b.minX},${b.maxX},${b.minY},${b.maxY},${b.minZ},${b.maxZ}` : '';
  return useMemo(
    () => splatTransform({ metricScaleFactor: msf, groundPlaneOffset: gpo, bounds: b }, metresPerUnit, floorOffset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [msf, gpo, key, metresPerUnit, floorOffset],
  );
}

interface ColliderProps {
  url?: string;
  visible: boolean;
  onStatus: (s: MarbleStatus, detail?: string) => void;
  onScene?: (scene: THREE.Object3D | null) => void;
}

/**
 * The collider mesh as a purple wireframe. Loaded once per url and kept even while hidden, so the
 * Geometry toggle is instant after the first look.
 */
function Collider({ url, visible, onStatus, onScene }: ColliderProps) {
  const invalidate = useThree((s) => s.invalidate);
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const cb = useRef({ onStatus, onScene });
  cb.current = { onStatus, onScene };

  useEffect(() => {
    setScene(null);
    if (!url) {
      cb.current.onStatus('idle');
      return;
    }
    let dead = false;
    let mine: THREE.Object3D | null = null;
    const material = new THREE.MeshBasicMaterial({ color: GEOMETRY_COLOR, wireframe: true, transparent: true, opacity: GEOMETRY_OPACITY, depthWrite: false });
    cb.current.onStatus('loading');
    new GLTFLoader().loadAsync(url).then(
      (gltf) => {
        if (dead) return;
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.material = material;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.userData.measureIgnore = true;
          }
        });
        gltf.scene.userData.measureIgnore = true;
        mine = gltf.scene;
        setScene(gltf.scene);
        cb.current.onScene?.(gltf.scene);
        cb.current.onStatus('ready');
        invalidate();
      },
      (e: unknown) => {
        if (dead) return;
        cb.current.onStatus('error', e instanceof Error ? e.message : 'Could not load the collider mesh');
      },
    );
    return () => {
      dead = true;
      cb.current.onScene?.(null);
      material.dispose();
      mine?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry?.dispose();
      });
    };
  }, [url, invalidate]);

  if (!scene) return null;
  return <primitive object={scene} scale={COLLIDER_MIRROR} visible={visible} raycast={() => null} />;
}

/**
 * Everything real about a Marble world, in ONE group placed by `splatTransform(world,
 * metresPerUnit, floorOffset)`: the panorama sphere, the collider wireframe and (when the world has
 * a `.spz`) the Gaussian splat. The group's `position` is exactly where the capture point lands in
 * Audora's metric frame — floor y = 0, room centre at the origin — which is where the photo view
 * puts its camera.
 *
 * Scale comes from Marble's own `metric_scale_factor` when the world carries metric semantics
 * (full quality) and from the room's anchor otherwise (draft); the floor comes from
 * `ground_plane_offset` or, failing that, the collider's lowest point. Inside the group everything
 * is in the provider's raw units.
 *
 * The splat places itself in world space with the same transform (see SplatWorld) rather than
 * hanging off this group, so Spark keeps one sorted mesh per canvas; the maths is identical.
 */
export function MarbleWorld({
  world,
  metresPerUnit,
  floorOffset = 0,
  showPano = true,
  showSplat = false,
  showGeometry = false,
  panoOpacity = 1,
  splatOpacity = 1,
  onStatus,
  onOrigin,
  onCollider,
}: MarbleWorldProps) {
  const t = useMarbleFrame(world, metresPerUnit, floorOffset);
  const report = useRef(onStatus);
  report.current = onStatus;
  const originCb = useRef(onOrigin);
  originCb.current = onOrigin;

  const wantSplat = showSplat && Boolean(world.spzUrl);
  // Once the panorama has been asked for it stays mounted and merely hides, so bouncing between
  // Photo and Walk does not re-download and re-decode several megabytes each time. A different
  // world's panorama is a different asset, so `keptPano` is the url rather than a flag.
  const wantPano = showPano && Boolean(world.panoUrl);
  const [keptPano, setKeptPano] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (wantPano && world.panoUrl) setKeptPano(world.panoUrl);
  }, [wantPano, world.panoUrl]);
  const panoMounted = Boolean(world.panoUrl) && keptPano === world.panoUrl;

  const px = t.position[0];
  const py = t.position[1];
  const pz = t.position[2];
  useEffect(() => {
    originCb.current?.([px, py, pz]);
  }, [px, py, pz]);

  return (
    <>
      <group position={t.position} rotation={[0, t.rotationY, 0]} scale={t.scale} userData={{ measureIgnore: true, stillsKeep: true }}>
        {panoMounted ? (
          <PanoWorld
            url={world.panoUrl}
            radius={PANO_RADIUS}
            visible={wantPano}
            opacity={panoOpacity}
            onStatus={(s: PanoStatus, detail?: string) => report.current?.({ layer: 'pano', status: s, detail })}
            onProgress={(progress) => report.current?.({ layer: 'pano', status: 'loading', progress })}
          />
        ) : null}
        <Collider url={world.colliderUrl} visible={showGeometry} onStatus={(s, detail) => report.current?.({ layer: 'collider', status: s, detail })} onScene={onCollider} />
      </group>
      {wantSplat ? (
        <SplatWorld
          world={world}
          metresPerUnit={metresPerUnit}
          opacity={splatOpacity}
          transform={{ y: floorOffset }}
          onStatus={(s: SplatStatus, detail?: string) => report.current?.({ layer: 'splat', status: s, detail })}
        />
      ) : null}
    </>
  );
}
