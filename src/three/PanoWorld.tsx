import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export type PanoStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PanoProgress {
  /** Bytes received so far. */
  loaded: number;
  /** Bytes expected, 0 when the server sends no content-length. */
  total: number;
  /** 0..1, or null when the length is unknown. */
  ratio: number | null;
}

export interface PanoWorldProps {
  /** Marble's `assets.imagery.pano_url` (equirectangular, 2:1). */
  url?: string;
  /** Sphere radius in the *provider's raw units*; the Marble group scales it into metres. */
  radius?: number;
  visible?: boolean;
  /** 0..1. Below 1 the sphere turns transparent (used to cross-fade to the measured shell). */
  opacity?: number;
  /** Extra yaw in radians on top of {@link PANO_YAW}, for a per-room correction. */
  yaw?: number;
  onStatus?: (s: PanoStatus, detail?: string) => void;
  onProgress?: (p: PanoProgress) => void;
  /** Pixel size of the panorama once decoded. */
  onMeasured?: (size: { w: number; h: number }) => void;
}

/**
 * Marble's panorama and its collider mesh describe the same room, but the collider `.glb` arrives
 * with y flipped rather than rotated — a *reflection* of the capture frame — so drawing the mesh
 * straight into three.js mirrors the room. Every real asset therefore gets mirrored back in x
 * inside the Marble group (see MarbleWorld), which is also what makes the panorama read the way
 * the source photo does.
 *
 * Measured, not guessed. Against the demo world (24be684c, public/demo/empty-room-corner-windows.jpg):
 * the collider's floor-line distance profile and the panorama's own floor line agree on
 * `u = 0.5 + azimuth / 360°` with `azimuth = atan2(x, z)` in the collider's frame — the four room
 * corners line up to within 2°, the collider's hole for the tall window sits at azimuth −55° and the
 * panorama's tall window at u = 0.334 (−60°).
 *
 * three.js maps an equirect texel `u` onto a sphere at `azimuth = 360u − 90°`; mirroring x flips
 * that to `90° − 360u`, so a further **+90° yaw** lands it on the `180° − 360u` the mirrored
 * collider needs. Hence: mirror in x, yaw +π/2.
 */
export const PANO_MIRROR: [number, number, number] = [-1, 1, 1];
export const PANO_YAW = Math.PI / 2;

/** Default sphere radius in raw units — large enough that nothing real ever pokes through it. */
export const PANO_RADIUS = 60;

/**
 * Panorama URLs Marble has used. A world record written before the shape settled can hold
 * `…_pano.jpg`, which 404s; the asset actually lives at `…_pano/rgb_0.png`. Trying the sibling
 * costs one request and saves the viewer from a black canvas.
 */
export function panoCandidates(url: string): string[] {
  const out = [url];
  const jpg = url.match(/^(.*)_pano\.(?:jpg|jpeg|png)$/);
  if (jpg) out.push(`${jpg[1]}_pano/rgb_0.png`);
  const dir = url.match(/^(.*)_pano\/rgb_0\.png$/);
  if (dir) out.push(`${dir[1]}_pano.jpg`);
  return out;
}

function tuneTexture(tex: THREE.Texture) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Fetch the panorama with byte progress, then decode it off the main thread. Falls back to a plain
 * texture load when streaming is not available (older Safari) or the fetch is rejected.
 */
async function loadPano(url: string, onProgress: (p: PanoProgress) => void, signal: AbortSignal): Promise<THREE.Texture> {
  if (typeof createImageBitmap === 'function') {
    try {
      const res = await fetch(url, { mode: 'cors', signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const total = Number(res.headers.get('content-length')) || 0;
      let blob: Blob;
      if (res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          onProgress({ loaded, total, ratio: total ? Math.min(1, loaded / total) : null });
        }
        blob = new Blob(chunks as BlobPart[]);
      } else {
        blob = await res.blob();
        onProgress({ loaded: blob.size, total: blob.size, ratio: 1 });
      }
      // ImageBitmap ignores Texture.flipY (three uploads it as-is), so the flip has to happen here
      // or the room comes out with its floor on the ceiling.
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      if (signal.aborted) {
        bitmap.close();
        throw new Error('aborted');
      }
      const tex = tuneTexture(new THREE.Texture(bitmap));
      tex.flipY = false;
      return tex;
    } catch (e) {
      if (signal.aborted) throw e;
      // fall through to the image-element loader
    }
  }
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const tex = await loader.loadAsync(url);
  return tuneTexture(tex);
}

/**
 * The photoreal layer: Marble's equirectangular panorama on a big inside-out sphere, drawn without
 * tone mapping so it looks like the photograph it is. Loads with progress and never throws —
 * `onStatus` reports `loading` / `ready` / `error` so the viewer can keep a spinner (or the measured
 * shell) up instead of a black canvas.
 *
 * Lives inside the Marble group, so `radius` is in raw provider units and the mirror/yaw above put
 * the room where the collider and the splat put it.
 */
export function PanoWorld({ url, radius = PANO_RADIUS, visible = true, opacity = 1, yaw = 0, onStatus, onProgress, onMeasured }: PanoWorldProps) {
  const invalidate = useThree((s) => s.invalidate);
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const cb = useRef({ onStatus, onProgress, onMeasured });
  cb.current = { onStatus, onProgress, onMeasured };

  useEffect(() => {
    setTex(null);
    if (!url) {
      cb.current.onStatus?.('idle');
      return;
    }
    const ctrl = new AbortController();
    let mine: THREE.Texture | null = null;
    cb.current.onStatus?.('loading');
    cb.current.onProgress?.({ loaded: 0, total: 0, ratio: null });
    // A 3 MB panorama arrives in hundreds of chunks; report whole percents only, so the HUD does
    // not re-render the scene on every one of them.
    let lastPct = -1;
    const report = (p: PanoProgress) => {
      const pct = p.ratio == null ? -1 : Math.floor(p.ratio * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      cb.current.onProgress?.(p);
    };
    (async () => {
      const tried = panoCandidates(url);
      let last: unknown = null;
      for (const candidate of tried) {
        try {
          const t = await loadPano(candidate, report, ctrl.signal);
          if (ctrl.signal.aborted) {
            t.dispose();
            return;
          }
          mine = t;
          setTex(t);
          const img = t.image as { width?: number; height?: number } | null;
          if (img?.width) cb.current.onMeasured?.({ w: img.width, h: img.height ?? 0 });
          cb.current.onStatus?.('ready', img?.width ? `${img.width}×${img.height}` : undefined);
          invalidate();
          return;
        } catch (e) {
          if (ctrl.signal.aborted) return;
          last = e;
        }
      }
      const msg = last instanceof Error ? last.message : 'Could not load the panorama';
      cb.current.onStatus?.('error', msg);
    })();
    return () => {
      ctrl.abort();
      if (mine) {
        const img = mine.image as ImageBitmap | null;
        mine.dispose();
        if (img && typeof (img as ImageBitmap).close === 'function') (img as ImageBitmap).close();
      }
    };
  }, [url, invalidate]);

  const geometry = useMemo(() => new THREE.SphereGeometry(radius, 96, 64), [radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  if (!tex) return null;
  return (
    <mesh
      geometry={geometry}
      scale={PANO_MIRROR}
      rotation={[0, PANO_YAW + yaw, 0]}
      visible={visible}
      frustumCulled={false}
      renderOrder={-10}
      raycast={() => null}
      userData={{ measureIgnore: true, stillsKeep: true }}
    >
      <meshBasicMaterial map={tex} side={THREE.BackSide} toneMapped={false} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} fog={false} />
    </mesh>
  );
}
