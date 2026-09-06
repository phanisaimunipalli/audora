import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SplatMesh as SplatMeshT } from '@sparkjsdev/spark';
import type { RoomWorld } from '@/state/types';
import { marbleFrame } from './splat/frame';
import { loadSpz, type SpzProgress } from './splat/loadSpz';
import { acquireSpark, type SparkModule } from './splat/sparkContext';
import { deviceCeiling, planLadder, spzTiers, wantsUpgrade, type SplatAsset, type SplatTier } from './splat/tiers';

export type SplatStatus = 'loading' | 'ready' | 'error';

/** What the viewer needs to say "real capture · 500k splats · full res loading…". */
export interface SplatInfo {
  /** The tier on screen (or, while loading, the one being fetched). */
  tier?: SplatTier;
  /** Splats actually decoded, once a tier is up. */
  splats?: number;
  /** A better tier is downloading behind the one on screen. */
  upgrading?: SplatTier | null;
  progress?: SpzProgress;
}

export interface SplatWorldProps {
  world: RoomWorld;
  visible?: boolean;
  onStatus?: (s: SplatStatus, detail?: string, info?: SplatInfo) => void;
  /** 0..1 global opacity of the splat. */
  opacity?: number;
  /** Extra placement inside the metric room frame (after Marble's own metric transform). */
  transform?: { x?: number; z?: number; yaw?: number; y?: number };
  /**
   * The room anchor's metres per raw unit. Draft worlds carry no `metricScaleFactor`, so this is what
   * scales them; with collider `bounds` on the world it also centres the capture on the room origin
   * with its floor at y = 0 (see `marbleFrame` in three/splat/frame).
   */
  metresPerUnit?: number;
  /** Never load a tier above this one (the viewer caps it on weak devices). */
  maxTier?: SplatTier;
  /** Cross-fade duration between tiers, ms. */
  fadeMs?: number;
  /** The splat mesh on screen, for callers that want to raycast it. Called with null while there is none. */
  onMesh?: (mesh: THREE.Object3D | null) => void;
}

/**
 * Place a Marble splat in the metric room frame, in world space, using the same transform
 * MarbleWorld's group uses — so the splat, the panorama sphere and the collider wireframe all land on
 * top of each other.
 *
 * The SPZ is in Marble's `marble_raw_opencv` frame (x right, y down, z forward), a proper
 * right-handed frame, so it needs no mirror: a 180° turn about x brings it to y-up, and the room's
 * own yaw turns its walls onto ours. See `three/splat/frame.ts` for the whole convention, including
 * why the collider (a reflection of the same capture) needs its mirror.
 */
export function applyMarbleFrame(
  obj: THREE.Object3D,
  world: Pick<RoomWorld, 'metricScaleFactor' | 'groundPlaneOffset' | 'provider' | 'bounds'>,
  extra?: SplatWorldProps['transform'],
  metresPerUnit?: number,
) {
  const rotX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const t = marbleFrame(world, metresPerUnit && metresPerUnit > 0 ? metresPerUnit : (world.metricScaleFactor ?? 1));
  // The room's own turn (`t.yaw`), plus whatever the caller nudges on top. The group carries the
  // same turn as `rotationY = π + yaw`; here the π is already in `rotX` about the other axis.
  const turn = t.yaw + (extra?.yaw ?? 0);
  obj.scale.setScalar(t.scale);
  obj.quaternion.copy(rotX);
  if (turn) obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn));
  obj.position.set(t.position[0] + (extra?.x ?? 0), t.position[1] + (extra?.y ?? 0), t.position[2] + (extra?.z ?? 0));
  obj.updateMatrixWorld();
}

/**
 * A real Marble world as a Gaussian splat, streamed **progressively**.
 *
 * The buyer should be standing in the photograph within a second, not staring at a spinner for
 * eight, so the smallest file Marble made (100k or 150k splats, about a megabyte) loads first, the
 * 500k file replaces it when it arrives, and full resolution follows only on a machine that can
 * carry it and a connection that has already proved itself (see `splat/tiers`). Each swap is a
 * cross-fade — two tiers of the same room lined up on the same transform, one fading up while the
 * other fades down — so nothing ever pops, and the replaced mesh is disposed the moment the fade
 * ends. While all this happens the panorama stands behind it, which is why the viewer never shows a
 * black frame.
 *
 * Spark is imported lazily, so a procedural room never pays for it. Nothing here throws: every
 * failure lands on `onStatus('error')` and the viewer falls back to the panorama or the shell.
 */
export function SplatWorld({ world, visible = true, onStatus, opacity = 1, transform, metresPerUnit, maxTier, fadeMs = 420, onMesh }: SplatWorldProps) {
  const { scene, gl, invalidate } = useThree();
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const meshRef = useRef(onMesh);
  meshRef.current = onMesh;
  const live = useRef<SplatMeshT[]>([]);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const fading = useRef(false);

  const scale = world.metricScaleFactor ?? null;
  const ground = world.groundPlaneOffset ?? null;
  const bounds = world.bounds;
  // The wall rectangle is part of the placement now (it turns and centres the room), so a world
  // whose walls were re-measured has to be re-placed.
  const w = bounds?.walls;
  const boundsKey = bounds ? [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, bounds.minZ, bounds.maxZ, bounds.floorY, bounds.method, w?.minX, w?.maxX, w?.minZ, w?.maxZ, w?.rotation].join(',') : '';
  const mpu = metresPerUnit ?? null;
  const tx = transform?.x ?? 0;
  const tz = transform?.z ?? 0;
  const ty = transform?.y ?? 0;
  const tyaw = transform?.yaw ?? 0;
  // The whole ladder for this world; the effect below re-runs only when the *files* change, never
  // when the floor is nudged — a floor slider that re-downloads 5 MB per pixel is not a slider.
  const assets = spzTiers(world);
  const assetKey = assets.map((a) => a.url).join('|');

  /* ---- placement: applied to every live mesh, cheaply, whenever the metric frame moves ---- */
  useEffect(() => {
    const frame = { metricScaleFactor: scale, groundPlaneOffset: ground, provider: world.provider, bounds };
    for (const m of live.current) applyMarbleFrame(m, frame, { x: tx, z: tz, y: ty, yaw: tyaw }, mpu ?? undefined);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, ground, boundsKey, mpu, tx, tz, ty, tyaw, invalidate]);

  /* ---- the ladder ---- */
  useEffect(() => {
    if (!assetKey) return;
    const ladder = planLadder(assets, maxTier ?? deviceCeiling());
    if (!ladder.length) return;
    let cancelled = false;
    let raf = 0;
    let release: (() => void) | null = null;
    const ctrl = new AbortController();
    const frameOf = () => ({ metricScaleFactor: scale, groundPlaneOffset: ground, provider: world.provider, bounds });
    const report = (s: SplatStatus, detail?: string, info?: SplatInfo) => {
      if (!cancelled) statusRef.current?.(s, detail, info);
    };
    const drop = (m: SplatMeshT | null) => {
      if (!m) return;
      live.current = live.current.filter((x) => x !== m);
      scene.remove(m);
      try {
        m.dispose();
      } catch {
        /* Spark disposes its own GPU buffers; a double dispose is not worth throwing over. */
      }
    };
    const crossFade = (from: SplatMeshT | null, to: SplatMeshT) =>
      new Promise<void>((resolve) => {
        if (!from || fadeMs <= 0) {
          to.opacity = opacityRef.current;
          invalidate();
          resolve();
          return;
        }
        fading.current = true;
        const t0 = performance.now();
        const tick = () => {
          const k = cancelled ? 1 : Math.min(1, (performance.now() - t0) / fadeMs);
          const target = opacityRef.current;
          to.opacity = target * k;
          from.opacity = target * (1 - k);
          invalidate();
          if (k < 1) {
            raf = requestAnimationFrame(tick);
            return;
          }
          fading.current = false;
          resolve();
        };
        tick();
      });

    (async () => {
      const mod: SparkModule = await import('@sparkjsdev/spark');
      if (cancelled) return;
      release = acquireSpark(mod, gl, scene, { onDirty: invalidate });
      let current: SplatMeshT | null = null;
      let onScreen: { tier: SplatTier; splats: number } | null = null;
      let step = 0;
      let next: SplatAsset | undefined = ladder[0];
      while (next && !cancelled) {
        const rung: SplatAsset = next;
        const startedAt = performance.now();
        /* An upgrade is not a wait. While full resolution streams behind a tier the buyer is already
           walking, the layer keeps saying **ready** — with `upgrading` and the progress attached —
           because everything downstream reads "the splat is ready" as "a photograph is on screen",
           and flipping it back to `loading` would put the procedural shell over the capture for the
           length of a 23 MB download. Only the first rung of the ladder is a genuine wait. */
        const say = (progress?: SpzProgress) =>
          onScreen
            ? report('ready', `${Math.round(onScreen.splats / 1000)}k splats`, { tier: onScreen.tier, splats: onScreen.splats, upgrading: rung.tier, progress })
            : report('loading', undefined, { tier: rung.tier, upgrading: null, progress });
        say();
        const file = await loadSpz(rung.url, { signal: ctrl.signal, onProgress: (progress) => say(progress) });
        if (cancelled) return;
        const mesh = new mod.SplatMesh({ fileBytes: file.bytes, fileType: mod.SplatFileType.SPZ, fileName: rung.url.split('/').pop(), raycastable: true });
        mesh.name = 'audora-splat';
        mesh.userData.stillsKeep = true;
        mesh.userData.splatTier = rung.tier;
        applyMarbleFrame(mesh, frameOf(), { x: tx, z: tz, y: ty, yaw: tyaw }, mpu ?? undefined);
        mesh.opacity = current ? 0 : opacityRef.current;
        mesh.visible = visibleRef.current;
        scene.add(mesh);
        live.current = [...live.current, mesh];
        await mesh.initialized;
        if (cancelled) {
          drop(mesh);
          return;
        }
        mesh.visible = visibleRef.current;
        await crossFade(current, mesh);
        if (cancelled) return;
        drop(current);
        current = mesh;
        meshRef.current?.(mesh);
        const n = mesh.packedSplats?.numSplats ?? 0;
        onScreen = { tier: rung.tier, splats: n };
        report('ready', n ? `${Math.round(n / 1000)}k splats` : undefined, { tier: rung.tier, splats: n, upgrading: null });
        step += 1;
        /* The next rung is either the rest of the plan or, at the top of it, the upgrade this
           machine has earned. The budget is measured from the request to the first frame the tier is
           actually on screen — not just the download — because decoding and uploading half a million
           splats is exactly the part a weak GPU cannot afford, and a machine that took four seconds
           over 5 MB has no business being handed 23. */
        const earned = performance.now() - startedAt;
        next = ladder[step] ?? wantsUpgrade(assets, rung.tier, earned, maxTier ?? deviceCeiling()) ?? undefined;
        if (next) report('ready', n ? `${Math.round(n / 1000)}k splats` : undefined, { tier: rung.tier, splats: n, upgrading: next.tier });
      }
    })().catch((e: unknown) => {
      if (cancelled || ctrl.signal.aborted) return;
      const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not load the splat';
      // A failed upgrade must not take away the tier already on screen.
      if (live.current.length) {
        report('ready', undefined, { tier: live.current[live.current.length - 1].userData.splatTier as SplatTier, upgrading: null });
        return;
      }
      report('error', msg);
    });

    return () => {
      cancelled = true;
      ctrl.abort();
      cancelAnimationFrame(raf);
      fading.current = false;
      for (const m of live.current) {
        scene.remove(m);
        try {
          m.dispose();
        } catch {
          /* ignore */
        }
      }
      live.current = [];
      meshRef.current?.(null);
      release?.();
    };
    // Re-load only when the asset list or the canvas changes; placement, visibility and opacity are
    // applied live by the effects around this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetKey, maxTier, scene, gl]);

  /* ---- visibility and opacity, applied live (never a reload) ---- */
  useEffect(() => {
    for (const m of live.current) m.visible = visible;
    if (!fading.current) for (const m of live.current) m.opacity = opacity;
    invalidate();
  }, [visible, opacity, invalidate]);

  return null;
}
