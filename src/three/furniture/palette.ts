/**
 * Colour maths for procedural furniture. Everything is a plain hex string so materials stay cheap
 * (no textures) and every part of a piece can be tinted by its status in one place.
 */
import type { PlacedPiece } from '@/engine/types';
import type { PieceStatus } from './FurniturePiece';

export const BUYER_BLUE = '#62a0ff';
export const ACCENT = '#e8734a';
const DANGER = '#e05d5d';
const WARN = '#e6b450';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const to = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Linear blend of two hex colours; t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const k = clamp01(t);
  return rgbToHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number): string {
  return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#000000', -amt);
}

/** Every tone a piece body can ask for. Derived from the piece colour so a blue buyer sofa stays blue in its shadows too. */
export interface Tones {
  /** Fabric / the piece's declared colour. */
  primary: string;
  /** Slightly lighter version for cushions, duvets, table tops. */
  light: string;
  /** Darker version for frames, backs and undersides. */
  dark: string;
  /** Warm wood for legs and frames. */
  wood: string;
  /** Brushed metal for poles and pedestals. */
  metal: string;
  /** Linen / pillows / lamp shades. */
  linen: string;
  /** Screens and glass. */
  screen: string;
  /** Foliage. */
  leaf: string;
  /** Terracotta pot. */
  clay: string;
  /** Emissive glow applied to solid parts (selection / hover), as hex + intensity. */
  emissive: string;
  emissiveIntensity: number;
}

const DEFAULTS = {
  wood: '#4c3b2f',
  metal: '#8a8d92',
  linen: '#ece5d8',
  screen: '#101214',
  leaf: '#4f7a4a',
  clay: '#a8664a',
};

/**
 * Tones for a piece. Buyer pieces are always blue. Status tints the whole piece towards red (overlap /
 * outside) or amber (blocks the door) so the problem reads instantly in the dollhouse view.
 */
export function tonesFor(piece: Pick<PlacedPiece, 'color' | 'owner' | 'kind'>, status: PieceStatus, opts: { selected?: boolean; hovered?: boolean } = {}): Tones {
  const buyer = piece.owner === 'buyer';
  const base = buyer ? BUYER_BLUE : piece.color ?? '#8d7b6a';
  let tint: string | null = null;
  let amount = 0;
  // Buyer furniture is always blue: a bad status glows red around a blue body (see FurniturePiece) rather than recolouring it.
  const bad = status === 'overlap' || status === 'outside';
  if (!buyer && bad) {
    tint = DANGER;
    amount = 0.62;
  } else if (!buyer && status === 'door') {
    tint = WARN;
    amount = 0.55;
  }
  const t = (hex: string, k = amount) => (tint ? mix(hex, tint, k) : hex);
  const primary = t(base);
  const wood = buyer ? mix(DEFAULTS.wood, BUYER_BLUE, 0.25) : piece.kind === 'coffeeTable' || piece.kind === 'sideTable' || piece.kind === 'desk' || piece.kind === 'diningSet' ? base : DEFAULTS.wood;
  const hoverLift = opts.hovered ? 0.07 : 0;
  return {
    primary: shade(primary, hoverLift),
    light: shade(primary, 0.18 + hoverLift),
    dark: shade(primary, -0.28 + hoverLift),
    wood: shade(t(wood, amount * 0.6), hoverLift),
    metal: t(DEFAULTS.metal, amount * 0.5),
    linen: t(buyer ? mix(DEFAULTS.linen, BUYER_BLUE, 0.2) : DEFAULTS.linen, amount * 0.5),
    screen: t(DEFAULTS.screen, amount * 0.3),
    leaf: t(buyer ? mix(DEFAULTS.leaf, BUYER_BLUE, 0.45) : DEFAULTS.leaf, amount * 0.5),
    clay: t(buyer ? mix(DEFAULTS.clay, BUYER_BLUE, 0.35) : DEFAULTS.clay, amount * 0.5),
    // A buyer's piece never changes colour: red emissive over blue reads as pink, and "pink" is not a
    // verdict. The misfit is shown as a red outline on the floor instead (see FurniturePiece).
    emissive: opts.selected ? ACCENT : opts.hovered ? '#ffffff' : '#000000',
    emissiveIntensity: opts.selected ? 0.16 : opts.hovered ? 0.05 : 0,
  };
}

/** Small deterministic hash so book colours / plant shapes are stable per piece. */
export function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
