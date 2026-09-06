import * as THREE from 'three';
import { fnv1a, mulberry32 } from '@/lib/ids';

/**
 * Procedural, canvas-generated textures for the metric room. Everything here is
 * authored in metres (each texture declares how many metres one tile covers) so
 * `repeat` can be set from the room size and scale reads correctly.
 * Textures are generated once per process and shared; callers clone when they
 * need a different `repeat`.
 */

export type FloorStyle = 'oak' | 'walnut' | 'tile' | 'plain';

const cache = new Map<string, THREE.CanvasTexture>();

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return { c, ctx };
}

function finish(c: HTMLCanvasElement, srgb: boolean, anisotropy = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function memo(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const t = make();
  cache.set(key, t);
  return t;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;
}

export interface FloorTextureSet {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  /** How many metres one texture tile covers (square). */
  metresPerTile: number;
  roughness: number;
}

interface WoodPalette {
  hue: number;
  sat: number;
  light: number;
  spread: number;
}

const WOOD: Record<'oak' | 'walnut', WoodPalette> = {
  oak: { hue: 30, sat: 0.36, light: 0.56, spread: 0.07 },
  walnut: { hue: 22, sat: 0.32, light: 0.34, spread: 0.06 },
};

/** Wood planks, 2 m × 2 m per tile: 12.5 cm planks, ~1 m long, staggered, with grain and bevels. */
function makeWood(kind: 'oak' | 'walnut'): FloorTextureSet {
  const size = 1024;
  const metres = 2;
  const px = size / metres; // pixels per metre
  const pal = WOOD[kind];
  const rng = mulberry32(fnv1a(`wood:${kind}`));
  const { c, ctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const plankW = 0.125 * px;
  const rows = Math.round(size / plankW);
  rctx.fillStyle = '#b8b8b8';
  rctx.fillRect(0, 0, size, size);
  for (let r = 0; r < rows; r++) {
    const y = r * plankW;
    // stagger so seams do not line up; plank lengths vary around 1 m
    let x = -rng() * px;
    while (x < size) {
      const len = (0.7 + rng() * 0.6) * px;
      const l = pal.light + (rng() - 0.5) * pal.spread * 2;
      const h = pal.hue + (rng() - 0.5) * 6;
      const s = pal.sat + (rng() - 0.5) * 0.08;
      // base plank
      ctx.fillStyle = hsl(h, s, l);
      ctx.fillRect(x, y, len, plankW);
      // grain: long soft streaks with slight waviness
      const streaks = 18 + Math.floor(rng() * 14);
      for (let i = 0; i < streaks; i++) {
        const gy = y + rng() * plankW;
        const dark = rng() > 0.5;
        ctx.strokeStyle = hsl(h, s + 0.05, dark ? l - 0.09 - rng() * 0.06 : l + 0.05 + rng() * 0.04, 0.35 + rng() * 0.3);
        ctx.lineWidth = 0.6 + rng() * 1.6;
        ctx.beginPath();
        const amp = 0.4 + rng() * 1.8;
        const freq = 0.004 + rng() * 0.01;
        for (let gx = x; gx <= x + len; gx += 6) {
          const yy = gy + Math.sin(gx * freq + i) * amp;
          if (gx === x) ctx.moveTo(gx, yy);
          else ctx.lineTo(gx, yy);
        }
        ctx.stroke();
      }
      // occasional knot
      if (rng() > 0.82) {
        const kx = x + len * (0.2 + rng() * 0.6);
        const ky = y + plankW * (0.3 + rng() * 0.4);
        const kr = 3 + rng() * 6;
        const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.2);
        g.addColorStop(0, hsl(h, s + 0.1, l - 0.22, 0.85));
        g.addColorStop(0.5, hsl(h, s + 0.05, l - 0.1, 0.45));
        g.addColorStop(1, hsl(h, s, l, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * 2.2, kr * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // bevel between planks (end seam)
      ctx.fillStyle = 'rgba(30,18,10,0.55)';
      ctx.fillRect(x + len - 1, y, 2, plankW);
      ctx.fillStyle = 'rgba(255,240,220,0.12)';
      ctx.fillRect(x + len + 1, y, 1, plankW);
      // roughness: grain a little glossier, seams matte
      rctx.fillStyle = `rgba(${150 + Math.floor(rng() * 40)},${150 + Math.floor(rng() * 40)},${150 + Math.floor(rng() * 40)},0.35)`;
      rctx.fillRect(x, y, len, plankW);
      rctx.fillStyle = 'rgba(240,240,240,0.9)';
      rctx.fillRect(x + len - 1, y, 2, plankW);
      x += len;
    }
    // long seam
    ctx.fillStyle = 'rgba(30,18,10,0.5)';
    ctx.fillRect(0, y - 1, size, 2);
    ctx.fillStyle = 'rgba(255,240,220,0.1)';
    ctx.fillRect(0, y + 1, size, 1);
    rctx.fillStyle = 'rgba(240,240,240,0.9)';
    rctx.fillRect(0, y - 1, size, 2);
  }
  // very faint dust / tone variation across the tile so repeats are less obvious
  for (let i = 0; i < 60; i++) {
    const gx = rng() * size;
    const gy = rng() * size;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 120 + rng() * 200);
    const dark = rng() > 0.5;
    g.addColorStop(0, dark ? 'rgba(20,10,0,0.05)' : 'rgba(255,240,220,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return { map: finish(c, true, 16), roughnessMap: finish(rc, false, 8), metresPerTile: metres, roughness: 0.72 };
}

/** Warm stone tiles, 1.2 m per texture tile: 30 cm tiles with 3 mm grout. */
function makeTile(): FloorTextureSet {
  const size = 1024;
  const metres = 1.2;
  const px = size / metres;
  const rng = mulberry32(fnv1a('tile'));
  const { c, ctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const tile = 0.3 * px;
  const grout = 0.004 * px;
  ctx.fillStyle = '#a89c8c';
  ctx.fillRect(0, 0, size, size);
  rctx.fillStyle = '#e0e0e0';
  rctx.fillRect(0, 0, size, size);
  const n = Math.round(size / tile);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * tile + grout / 2;
      const y = j * tile + grout / 2;
      const l = 0.78 + (rng() - 0.5) * 0.08;
      const h = 34 + (rng() - 0.5) * 8;
      ctx.fillStyle = hsl(h, 0.18, l);
      ctx.fillRect(x, y, tile - grout, tile - grout);
      // stone veining
      for (let k = 0; k < 4; k++) {
        ctx.strokeStyle = hsl(h, 0.12, l - 0.08 - rng() * 0.06, 0.25);
        ctx.lineWidth = 0.8 + rng() * 1.2;
        ctx.beginPath();
        let vx = x + rng() * (tile - grout);
        let vy = y + rng() * (tile - grout);
        ctx.moveTo(vx, vy);
        for (let s = 0; s < 6; s++) {
          vx += (rng() - 0.5) * 60;
          vy += (rng() - 0.5) * 60;
          ctx.lineTo(Math.max(x, Math.min(x + tile - grout, vx)), Math.max(y, Math.min(y + tile - grout, vy)));
        }
        ctx.stroke();
      }
      rctx.fillStyle = `rgba(${120 + Math.floor(rng() * 40)},${120 + Math.floor(rng() * 40)},${120 + Math.floor(rng() * 40)},1)`;
      rctx.fillRect(x, y, tile - grout, tile - grout);
    }
  }
  return { map: finish(c, true, 16), roughnessMap: finish(rc, false, 8), metresPerTile: metres, roughness: 0.55 };
}

function makePlain(): FloorTextureSet {
  const { c, ctx } = canvas(64, 64);
  ctx.fillStyle = '#b89a7a';
  ctx.fillRect(0, 0, 64, 64);
  const { c: rc, ctx: rctx } = canvas(8, 8);
  rctx.fillStyle = '#d0d0d0';
  rctx.fillRect(0, 0, 8, 8);
  return { map: finish(c, true, 1), roughnessMap: finish(rc, false, 1), metresPerTile: 1, roughness: 0.85 };
}

const floorSets = new Map<FloorStyle, FloorTextureSet>();

export function floorTextures(style: FloorStyle): FloorTextureSet {
  const hit = floorSets.get(style);
  if (hit) return hit;
  const set = style === 'tile' ? makeTile() : style === 'plain' ? makePlain() : makeWood(style);
  floorSets.set(style, set);
  return set;
}

/** Fine plaster noise for matte painted walls; 1 m per tile. Use as a bump map at a small scale. */
export function wallBump(): THREE.CanvasTexture {
  return memo('wallBump', () => {
    const size = 256;
    const { c, ctx } = canvas(size, size);
    const img = ctx.createImageData(size, size);
    const rng = mulberry32(fnv1a('plaster'));
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 118 + Math.floor(rng() * 20);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // soften the noise so it reads as roller texture, not static
    ctx.globalAlpha = 0.5;
    ctx.drawImage(c, 1, 0);
    ctx.drawImage(c, 0, 1);
    ctx.globalAlpha = 1;
    return finish(c, false, 4);
  });
}

/** Vertical alpha gradient: opaque dark at the top of the image fading to clear at the bottom. */
export function coveGradient(): THREE.CanvasTexture {
  return memo('cove', () => {
    const { c, ctx } = canvas(4, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.35, 'rgba(0,0,0,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    const t = finish(c, false, 1);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Soft daylight sky seen through a window: bright blue-white above, warm haze at the horizon. */
export function skyGradient(): THREE.CanvasTexture {
  return memo('sky', () => {
    const { c, ctx } = canvas(64, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#a9c9ea');
    g.addColorStop(0.45, '#d5e6f4');
    g.addColorStop(0.75, '#efe9dc');
    g.addColorStop(1, '#d9c7a8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 256);
    // a hint of foliage / neighbouring building at the bottom
    ctx.fillStyle = 'rgba(96,110,80,0.55)';
    for (let i = 0; i < 12; i++) {
      const x = (i / 12) * 64;
      ctx.beginPath();
      ctx.ellipse(x + 3, 250, 9 + (i % 3) * 3, 14 + (i % 2) * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const t = finish(c, true, 1);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/**
 * The pool of light a window throws on the floor: a soft rectangle with the mullion
 * shadow, brightest near the window (top of the image) and fading away from it.
 */
export function lightPool(): THREE.CanvasTexture {
  return memo('pool', () => {
    const w = 256;
    const h = 512;
    const { c, ctx } = canvas(w, h);
    const v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(255,236,205,0.95)');
    v.addColorStop(0.55, 'rgba(255,236,205,0.6)');
    v.addColorStop(1, 'rgba(255,236,205,0)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    // feather the sides
    const side = ctx.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.12, 'rgba(0,0,0,0)');
    side.addColorStop(0.88, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, w, h);
    // mullion cross: a vertical bar and a horizontal bar, blurred
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.filter = 'blur(5px)';
    ctx.fillRect(w / 2 - 5, 0, 10, h * 0.7);
    ctx.fillRect(0, h * 0.3, w, 9);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    const t = finish(c, true, 4);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/**
 * The soft darkening a solid object puts on the floor it stands on. Alpha only, black, radial: the
 * ambient occlusion a shadow map at room scale can never resolve, and the thing that stops a piece
 * of furniture from floating over a photograph.
 */
export function contactShadow(): THREE.CanvasTexture {
  return memo('contact', () => {
    const s = 128;
    const { c, ctx } = canvas(s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.42, 'rgba(0,0,0,0.62)');
    g.addColorStop(0.72, 'rgba(0,0,0,0.2)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const t = finish(c, false, 2);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Clone a shared texture with its own repeat, without re-uploading the source more than needed. */
export function withRepeat(t: THREE.CanvasTexture, rx: number, ry: number): THREE.CanvasTexture {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}
