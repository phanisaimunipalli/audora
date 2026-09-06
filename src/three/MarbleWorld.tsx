import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RoomWorld } from '@/state/types';
import { marbleFrame } from './splat/frame';
import type { SplatTier } from './splat/tiers';
import { PANO_RADIUS, PanoWorld, type PanoProgress, type PanoStatus } from './PanoWorld';
import { SplatWorld, type SplatInfo, type SplatStatus } from './SplatWorld';

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
 *
 * The mirror is also why the horizontal map is `(x, z) → (x, −z)` rather than a plain 180° turn:
 * raw +x is our EAST, not our west. `three/splat/frame.ts` writes the whole convention down, and
 * the group's `rotationY = π + yaw` carries the room's own turn on top of it.
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
  /** Splat only: which resolution is on screen, how many splats it holds, what is loading behind it. */
  tier?: SplatTier;
  splats?: number;
  upgrading?: SplatTier | null;
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
  /**
   * Keep the panorama loaded even when it is not drawn, so it can light the furniture standing in
   * the splat (PMREM environment; see CaptureLight). Default: on whenever the splat is on.
   */
  keepPanoLoaded?: boolean;
  /** Never load a splat tier above this one. */
  maxSplatTier?: SplatTier;
  /** Aggregated load state of whichever layers are switched on. */
  onStatus?: (s: MarbleWorldStatus) => void;
  /** The capture point in Audora's metric frame — where the photo camera stands. */
  onOrigin?: (position: [number, number, number]) => void;
  /** The loaded collider scene, for callers that want to raycast it. */
  onCollider?: (scene: THREE.Object3D | null) => void;
  /** The panorama's decoded texture, so it can light the furniture standing in it (see CaptureLight). */
  onPanoTexture?: (texture: THREE.Texture | null) => void;
}

/**
 * Marble's collider is meshed from a depth map, so every depth discontinuity — a window reveal, a
 * door frame, the far edge of a doorway — is bridged by a few enormously stretched triangles that
 * hang in mid-air between the near surface and the far one. Drawn as a wireframe they are the purple
 * curtains that appear to float in front of the furniture, which is the opposite of the story the
 * Geometry toggle tells ("the mesh hugs the walls").
 *
 * They are trivially separable: a real surface triangle spans centimetres, a bridging one spans
 * metres. Anything with an edge longer than `maxEdge` (a fraction of the room's own diagonal) is
 * dropped. Vertices are left alone; only the index changes, so the mesh keeps its bounds.
 */
export function trimStretchedTriangles(geometry: THREE.BufferGeometry, edgeFraction = 0.055): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return geometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;
  const maxEdge = box.min.distanceTo(box.max) * edgeFraction;
  if (!(maxEdge > 0)) return geometry;
  const index = geometry.getIndex();
  const count = index ? index.count : pos.count;
  const read = (i: number) => (index ? index.getX(i) : i);
  const kept: number[] = [];
  const span = (a: number, b: number) => Math.hypot(pos.getX(a) - pos.getX(b), pos.getY(a) - pos.getY(b), pos.getZ(a) - pos.getZ(b));
  for (let i = 0; i + 2 < count; i += 3) {
    const a = read(i);
    const b = read(i + 1);
    const c = read(i + 2);
    if (span(a, b) > maxEdge || span(b, c) > maxEdge || span(c, a) > maxEdge) continue;
    kept.push(a, b, c);
  }
  // All or nothing would be a bug, not a clean-up: keep the mesh as delivered.
  if (kept.length === 0 || kept.length === count) return geometry;
  geometry.setIndex(kept);
  return geometry;
}

/** Where this world sits in the metric room frame. Same maths the group below uses. */
export function useMarbleFrame(world: Pick<RoomWorld, 'metricScaleFactor' | 'groundPlaneOffset' | 'bounds'>, metresPerUnit: number, floorOffset = 0) {
  const msf = world.metricScaleFactor ?? null;
  const gpo = world.groundPlaneOffset ?? null;
  const b = world.bounds;
  const w = b?.walls;
  // The wall rectangle turns and centres the room, so it belongs in the key with the box.
  const key = b ? `${b.minX},${b.maxX},${b.minY},${b.maxY},${b.minZ},${b.maxZ},${b.floorY},${b.method},${w?.minX},${w?.maxX},${w?.minZ},${w?.maxZ},${w?.rotation}` : '';
  return useMemo(
    () => marbleFrame({ metricScaleFactor: msf, groundPlaneOffset: gpo, bounds: b }, metresPerUnit, floorOffset),
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
 * Geometry toggle is instant after the first look — and so the walk mask and the measure tool have
 * the real walls whether or not anyone asked to see them.
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
    /* Double-sided on purpose: the mesh is mirrored inside the group (COLLIDER_MIRROR), which flips
       every triangle's winding, and a single-sided material would make the raycaster — the measure
       tool, through ColliderPick — miss the very walls it is meant to measure. */
    const material = new THREE.MeshBasicMaterial({ color: GEOMETRY_COLOR, wireframe: true, transparent: true, opacity: GEOMETRY_OPACITY, depthWrite: false, side: THREE.DoubleSide });
    cb.current.onStatus('loading');
    new GLTFLoader().loadAsync(url).then(
      (gltf) => {
        if (dead) return;
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            if (mesh.geometry) trimStretchedTriangles(mesh.geometry);
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
 * A pickable stand-in for the collider mesh.
 *
 * "Measure anything" has to work on a real capture, and the honest surface to measure is the mesh
 * Marble reconstructed — but that mesh is invisible unless the Geometry layer is on, and drawing it
 * just so the raycaster can see it would cost a 150k-triangle pass every frame. This object draws
 * nothing and delegates its `raycast` to the collider's meshes, reporting the hits as its own. It
 * lives OUTSIDE the Marble group on purpose: the group is flagged `measureIgnore` (nobody wants to
 * measure the panorama sphere), and the measure tool honours that flag up the whole parent chain.
 */
function ColliderPick({ target, enabled }: { target: THREE.Object3D | null; enabled: boolean }) {
  const proxy = useMemo(() => {
    const o = new THREE.Object3D();
    o.name = 'audora-collider-pick';
    return o;
  }, []);
  const ref = useRef<{ target: THREE.Object3D | null; enabled: boolean }>({ target, enabled });
  ref.current = { target, enabled };

  useEffect(() => {
    const hits: THREE.Intersection[] = [];
    proxy.raycast = (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => {
      const { target: t, enabled: on } = ref.current;
      if (!on || !t) return;
      t.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        hits.length = 0;
        mesh.raycast(raycaster, hits);
        for (const h of hits) intersects.push({ ...h, object: proxy });
      });
    };
    return () => {
      proxy.raycast = () => undefined;
    };
  }, [proxy]);

  return <primitive object={proxy} />;
}

/**
 * Everything real about a Marble world, in ONE frame — `marbleFrame(world, metresPerUnit,
 * floorOffset)`: the panorama sphere, the collider wireframe and (when the world has a `.spz`) the
 * Gaussian splat. The group's `position` is exactly where the capture point lands in Audora's metric
 * frame — floor y = 0, room centre at the origin — which is where the photo view puts its camera and
 * where walk mode spawns the buyer, facing yaw 0, so the first frame is the photograph.
 *
 * Scale comes from Marble's own `metric_scale_factor` when the world carries metric semantics
 * (full quality) and from the room's anchor otherwise (draft); the floor comes from the collider's
 * own floor plane, then `ground_plane_offset`, then its lowest point. Inside the group everything is
 * in the provider's raw units. See `three/splat/frame.ts` for the full convention.
 *
 * The splat places itself in world space with the same transform (see SplatWorld) rather than
 * hanging off this group, so Spark keeps one sorted set per canvas; the maths is identical.
 *
 * **The panorama is the splat's backdrop, and it stays there.** A 500k splat takes seconds to
 * arrive and the panorama about one, so whenever the splat is wanted the panorama loads too and
 * stands behind it — first as the whole picture while the splat streams, then as the sky the
 * reconstruction does not reach. The buyer never sees a black frame, at any viewport aspect, at
 * any moment of the load. It is also the room's light (CaptureLight's environment map).
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
  keepPanoLoaded,
  maxSplatTier,
  onStatus,
  onOrigin,
  onCollider,
  onPanoTexture,
}: MarbleWorldProps) {
  const t = useMarbleFrame(world, metresPerUnit, floorOffset);
  const report = useRef(onStatus);
  report.current = onStatus;
  const originCb = useRef(onOrigin);
  originCb.current = onOrigin;
  const [collider, setCollider] = useState<THREE.Object3D | null>(null);
  const colliderCb = useRef(onCollider);
  colliderCb.current = onCollider;

  const wantSplat = showSplat && Boolean(world.spzUrl);
  useEffect(() => {
    if (wantSplat) return;
    // Photo view and the dollhouse have no splat, so whatever it last said about itself ("loading
    // the real capture…") is no longer true and must not be left on the viewer's status line.
    report.current?.({ layer: 'splat', status: 'idle' });
  }, [wantSplat]);

  /* **The panorama stays behind the splat.** It used to fade out over 0.6 s once real splats were
     up, which left whatever the reconstruction does not cover — everything above the top of the
     reconstructed volume, most visible on a tall phone screen — as pure black. The sphere is 60 raw
     units out and drawn first (renderOrder −10), so the splat wins everywhere it has data and the
     photograph fills in everywhere it does not. Nothing in a real Marble room is ever a black
     frame, and the buyer looking up sees the room's own ceiling rather than a hard horizontal edge. */
  const keepLoaded = keepPanoLoaded ?? wantSplat;
  const wantPano = (showPano || keepLoaded) && Boolean(world.panoUrl);
  const [keptPano, setKeptPano] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (wantPano && world.panoUrl) setKeptPano(world.panoUrl);
  }, [wantPano, world.panoUrl]);
  const panoMounted = Boolean(world.panoUrl) && keptPano === world.panoUrl;
  const panoAlpha = panoOpacity;
  const panoVisible = showPano && panoAlpha > 0.01;

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
            visible={panoVisible}
            opacity={panoAlpha}
            onStatus={(s: PanoStatus, detail?: string) => report.current?.({ layer: 'pano', status: s, detail })}
            onProgress={(progress) => report.current?.({ layer: 'pano', status: 'loading', progress })}
            onTexture={onPanoTexture}
          />
        ) : null}
        <Collider
          url={world.colliderUrl}
          visible={showGeometry}
          onStatus={(s, detail) => report.current?.({ layer: 'collider', status: s, detail })}
          onScene={(scene) => {
            setCollider(scene);
            colliderCb.current?.(scene);
          }}
        />
      </group>
      {/* Measurable real geometry — only while a capture is actually on screen, so the dollhouse
          keeps measuring the room Audora drew rather than the mesh hidden inside it. */}
      <ColliderPick target={collider} enabled={showGeometry || wantSplat || (showPano && panoVisible)} />
      {wantSplat ? (
        <SplatWorld
          world={world}
          metresPerUnit={metresPerUnit}
          opacity={splatOpacity}
          transform={{ y: floorOffset }}
          maxTier={maxSplatTier}
          onStatus={(s: SplatStatus, detail?: string, info?: SplatInfo) =>
            report.current?.({ layer: 'splat', status: s, detail, tier: info?.tier, splats: info?.splats, upgrading: info?.upgrading, progress: info?.progress })
          }
        />
      ) : null}
    </>
  );
}
