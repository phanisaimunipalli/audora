/**
 * Procedural bodies for every ProceduralKind. Every part is sized from the piece's real w / d / h so
 * a 220 × 95 sofa is exactly that footprint. Local frame: x = width, z = depth, +z is the front, y up,
 * floor at y = 0. Materials are flat colours only (no textures) so a staged room stays cheap.
 */
import { useMemo, type ReactElement } from 'react';
import type { ProceduralKind } from '@/engine/types';
import type { Tones } from './palette';
import { rng, shade } from './palette';
import { Ball, Box, Cyl, Legs, Soft } from './parts';

export interface BodyProps {
  kind: ProceduralKind;
  w: number;
  d: number;
  h: number;
  t: Tones;
  /** Stable per-piece seed for book colours / foliage. */
  seed: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ---------- seating ---------- */

interface SeatOpts {
  w: number;
  d: number;
  h: number;
  t: Tones;
  leftArm: boolean;
  rightArm: boolean;
  back: boolean;
  cushions?: number;
  armW?: number;
  /** Offset of this body inside the parent piece frame. */
  pos?: [number, number, number];
}

/** Sofa / armchair / sectional segments all share this body: legs, base, back, arms, seat + back cushions. */
function Seat({ w, d, h, t, leftArm, rightArm, back, cushions, armW: armWIn, pos = [0, 0, 0] }: SeatOpts) {
  const legH = clamp(0.07 * h, 0.04, 0.08);
  const armW = armWIn ?? clamp(0.11 * w, 0.1, 0.2);
  const backT = back ? clamp(0.2 * d, 0.13, 0.24) : 0;
  const seatTop = 0.5 * h;
  const cushionH = clamp(0.17 * h, 0.09, 0.16);
  const baseH = Math.max(0.06, seatTop - cushionH - legH);
  const backH = h - legH - baseH;
  const armH = 0.76 * h - legH;
  const innerX = w - (leftArm ? armW : 0) - (rightArm ? armW : 0);
  const innerStart = -w / 2 + (leftArm ? armW : 0);
  const n = cushions ?? clamp(Math.round(innerX / 0.68), 1, 4);
  const seatD = d - backT - 0.03;
  const seatZ = backT / 2 + 0.005;
  const cw = innerX / n;
  return (
    <group position={pos}>
      <Legs w={w} d={d} h={legH} inset={0.06} t={0.05} color={t.wood} round />
      <Box size={[w, baseH, d]} pos={[0, legH + baseH / 2, 0]} color={t.dark} rough={0.9} />
      {back ? <Soft size={[innerX + 0.01, backH, backT]} pos={[innerStart + innerX / 2, legH + baseH + backH / 2, -d / 2 + backT / 2]} radius={0.05} color={t.primary} rough={0.92} /> : null}
      {leftArm ? <Soft size={[armW, armH, d]} pos={[-w / 2 + armW / 2, legH + armH / 2, 0]} radius={0.05} color={t.primary} rough={0.92} /> : null}
      {rightArm ? <Soft size={[armW, armH, d]} pos={[w / 2 - armW / 2, legH + armH / 2, 0]} radius={0.05} color={t.primary} rough={0.92} /> : null}
      {Array.from({ length: n }, (_, i) => (
        <Soft key={`s${i}`} size={[cw - 0.025, cushionH, seatD]} pos={[innerStart + (i + 0.5) * cw, legH + baseH + cushionH / 2, seatZ]} radius={0.05} color={t.light} rough={0.95} />
      ))}
      {back
        ? Array.from({ length: n }, (_, i) => (
            <Soft key={`b${i}`} size={[cw - 0.035, backH * 0.6, 0.12]} pos={[innerStart + (i + 0.5) * cw, legH + baseH + cushionH + (backH * 0.6) / 2 - 0.03, -d / 2 + backT + 0.06]} radius={0.04} color={t.light} rough={0.95} shadow={false} />
          ))
        : null}
    </group>
  );
}

function Sofa({ w, d, h, t }: BodyProps) {
  return <Seat w={w} d={d} h={h} t={t} leftArm rightArm back />;
}

function Armchair({ w, d, h, t }: BodyProps) {
  return <Seat w={w} d={d} h={h} t={t} leftArm rightArm back cushions={1} armW={clamp(0.18 * w, 0.12, 0.2)} />;
}

/** L-sectional: the main sofa along the back, a chaise running forward on the right. Footprint = the L's bounding box. */
function Sectional({ w, d, h, t }: BodyProps) {
  const sd = clamp(d * 0.5, 0.8, 1.0); // sofa depth
  const cw = clamp(w * 0.35, 0.8, 1.05); // chaise width
  const cl = d - sd; // chaise length
  return (
    <group>
      <Seat w={w} d={sd} h={h} t={t} leftArm rightArm={false} back pos={[0, 0, -d / 2 + sd / 2]} />
      <group position={[w / 2 - cw / 2, 0, -d / 2 + sd + cl / 2]} rotation={[0, -Math.PI / 2, 0]}>
        <Seat w={cl} d={cw} h={h} t={t} leftArm={false} rightArm back={false} cushions={Math.max(1, Math.round(cl / 0.7))} armW={clamp(0.11 * w, 0.1, 0.2)} />
      </group>
    </group>
  );
}

function OfficeChair({ w, d, h, t }: BodyProps) {
  const k = Math.min(1, h / 0.95);
  const seatY = 0.47 * k;
  const spokes = 5;
  return (
    <group>
      {Array.from({ length: spokes }, (_, i) => {
        const a = (i / spokes) * Math.PI * 2;
        const r = w / 2 - 0.03;
        return (
          <group key={i} rotation={[0, -a, 0]}>
            <Box size={[r, 0.028, 0.05]} pos={[r / 2, 0.03, 0]} color={t.dark} rough={0.6} shadow={false} />
            <Ball r={0.025} pos={[r, 0.025, 0]} color={t.screen} rough={0.5} shadow={false} />
          </group>
        );
      })}
      <Cyl r={0.03} h={seatY - 0.06} pos={[0, 0.045 + (seatY - 0.06) / 2, 0]} color={t.metal} rough={0.35} metal={0.7} segments={12} />
      <Soft size={[w * 0.76, 0.08, d * 0.76]} pos={[0, seatY, 0.02]} radius={0.03} color={t.primary} rough={0.9} />
      <Soft size={[w * 0.7, h - seatY - 0.05, 0.06]} pos={[0, seatY + (h - seatY) / 2 + 0.01, -d * 0.3]} radius={0.03} color={t.primary} rough={0.9} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box size={[0.03, 0.02, d * 0.4]} pos={[s * w * 0.36, seatY + 0.22, -0.02]} color={t.dark} rough={0.6} shadow={false} />
          <Box size={[0.03, 0.2, 0.03]} pos={[s * w * 0.36, seatY + 0.12, 0.05]} color={t.dark} rough={0.6} shadow={false} />
        </group>
      ))}
    </group>
  );
}

/* ---------- tables ---------- */

function CoffeeTable({ w, d, h, t }: BodyProps) {
  const topT = 0.035;
  return (
    <group>
      <Box size={[w, topT, d]} pos={[0, h - topT / 2, 0]} color={t.primary} rough={0.45} />
      <Legs w={w} d={d} h={h - topT} inset={0.06} t={0.045} color={t.dark} rough={0.55} />
      {h > 0.35 ? <Box size={[w - 0.16, 0.015, d - 0.16]} pos={[0, h * 0.3, 0]} color={t.dark} rough={0.55} shadow={false} /> : null}
    </group>
  );
}

function SideTable({ w, d, h, t }: BodyProps) {
  const topT = 0.03;
  return (
    <group>
      <Box size={[w, topT, d]} pos={[0, h - topT / 2, 0]} color={t.primary} rough={0.45} />
      <Legs w={w} d={d} h={h - topT} inset={0.04} t={0.03} color={t.dark} rough={0.55} round />
    </group>
  );
}

function Desk({ w, d, h, t }: BodyProps) {
  const topT = 0.03;
  const blockH = h * 0.42;
  return (
    <group>
      <Box size={[w, topT, d]} pos={[0, h - topT / 2, 0]} color={t.primary} rough={0.5} />
      <Legs w={w} d={d} h={h - topT} inset={0.03} t={0.04} color={t.dark} rough={0.5} />
      <Box size={[Math.min(0.42, w * 0.35), blockH, d - 0.06]} pos={[w / 2 - Math.min(0.42, w * 0.35) / 2 - 0.03, h - topT - blockH / 2, 0]} color={t.dark} rough={0.55} />
      <Box size={[w - 0.1, blockH, 0.02]} pos={[0, h - topT - blockH / 2, -d / 2 + 0.03]} color={t.dark} rough={0.55} shadow={false} />
      <Box size={[Math.min(0.42, w * 0.35) - 0.06, 0.006, 0.006]} pos={[w / 2 - Math.min(0.42, w * 0.35) / 2 - 0.03, h - topT - blockH / 2, d / 2 - 0.027]} color={t.screen} shadow={false} />
    </group>
  );
}

/** Table with 4 or 6 chairs; chairs pulled in along the two long sides. */
function DiningSet({ w, d, h, t }: BodyProps) {
  const chairD = 0.45;
  const chairW = 0.42;
  const gap = 0.05;
  const tableD = Math.max(0.6, d - 2 * (chairD + gap));
  const n = w >= 1.8 ? 3 : 2;
  const topT = 0.04;
  const seatH = 0.45 * Math.min(1, h / 0.75);
  return (
    <group>
      <Box size={[w, topT, tableD]} pos={[0, h - topT / 2, 0]} color={t.primary} rough={0.45} />
      <Legs w={w} d={tableD} h={h - topT} inset={0.08} t={0.06} color={t.dark} rough={0.5} />
      {[-1, 1].map((side) =>
        Array.from({ length: n }, (_, i) => {
          const x = -w / 2 + (i + 0.5) * (w / n);
          const cz = side * (tableD / 2 + gap + chairD / 2);
          const backZ = side * (chairD / 2 - 0.015);
          return (
            <group key={`${side}${i}`} position={[x, 0, cz]}>
              <Soft size={[chairW, 0.045, chairD - 0.03]} pos={[0, seatH, 0]} radius={0.015} color={t.light} rough={0.85} />
              <Legs w={chairW} d={chairD - 0.03} h={seatH - 0.02} inset={0.025} t={0.03} color={t.dark} rough={0.55} round />
              <Box size={[chairW, 0.42, 0.03]} pos={[0, seatH + 0.02 + 0.21, backZ]} color={t.dark} rough={0.55} />
            </group>
          );
        }),
      )}
    </group>
  );
}

/* ---------- storage ---------- */

function TvUnit({ w, d, h, t }: BodyProps) {
  const legH = 0.1;
  const bodyH = h - legH;
  const screenW = Math.min(w * 0.85, 1.45);
  const screenH = screenW * (9 / 16);
  return (
    <group>
      <Legs w={w} d={d} h={legH} inset={0.06} t={0.035} color={t.metal} rough={0.4} metal={0.6} />
      <Box size={[w, bodyH, d]} pos={[0, legH + bodyH / 2, 0]} color={t.primary} rough={0.5} />
      {[-w / 6, w / 6].map((x) => (
        <Box key={x} size={[0.006, bodyH - 0.04, 0.006]} pos={[x, legH + bodyH / 2, d / 2 + 0.003]} color={t.screen} shadow={false} />
      ))}
      <Box size={[0.42, 0.05, 0.2]} pos={[0, h + 0.025, -d / 2 + 0.12]} color={t.metal} rough={0.4} metal={0.6} shadow={false} />
      <Box size={[screenW, screenH, 0.028]} pos={[0, h + 0.05 + screenH / 2, -d / 2 + 0.11]} color={t.screen} rough={0.25} metal={0.3} glow="#1b2a3d" glowIntensity={0.35} />
    </group>
  );
}

function Bookshelf({ w, d, h, t, seed }: BodyProps) {
  const shelves = 4;
  const bays = shelves + 1;
  const bayH = h / bays;
  const books = useMemo(() => {
    const r = rng(seed);
    const palette = ['#8c5a4a', '#5b6f8a', '#7a7f5a', '#b09a6a', '#5a4a6a', '#a35a5a', '#3f5a52', '#c2a27a'];
    const out: { bay: number; x: number; bw: number; bh: number; color: string }[] = [];
    for (let bay = 0; bay < bays; bay++) {
      let x = -w / 2 + 0.03 + r() * 0.05;
      const limit = w / 2 - 0.03;
      while (x < limit - 0.03) {
        if (r() < 0.12) {
          x += 0.04 + r() * 0.1;
          continue;
        }
        const bw = 0.02 + r() * 0.035;
        if (x + bw > limit) break;
        out.push({ bay, x: x + bw / 2, bw, bh: bayH * (0.55 + r() * 0.3), color: palette[Math.floor(r() * palette.length)] });
        x += bw + 0.003;
      }
    }
    return out;
  }, [seed, w, bays, bayH]);
  return (
    <group>
      <Box size={[0.02, h, d]} pos={[-w / 2 + 0.01, h / 2, 0]} color={t.primary} rough={0.55} />
      <Box size={[0.02, h, d]} pos={[w / 2 - 0.01, h / 2, 0]} color={t.primary} rough={0.55} />
      <Box size={[w, 0.02, d]} pos={[0, h - 0.01, 0]} color={t.primary} rough={0.55} />
      <Box size={[w, 0.02, d]} pos={[0, 0.01, 0]} color={t.primary} rough={0.55} />
      <Box size={[w - 0.04, h - 0.04, 0.01]} pos={[0, h / 2, -d / 2 + 0.005]} color={t.dark} rough={0.8} shadow={false} />
      {Array.from({ length: shelves }, (_, i) => (
        <Box key={i} size={[w - 0.04, 0.02, d - 0.02]} pos={[0, bayH * (i + 1), 0.01]} color={t.primary} rough={0.55} shadow={false} />
      ))}
      {books.map((b, i) => (
        <Box key={i} size={[b.bw, b.bh, d - 0.09]} pos={[b.x, bayH * b.bay + 0.02 + b.bh / 2, -0.01]} color={b.color} rough={0.9} shadow={false} />
      ))}
    </group>
  );
}

function Dresser({ w, d, h, t }: BodyProps) {
  const legH = 0.1;
  const bodyH = h - legH;
  const rows = 3;
  const cols = w > 1.2 ? 2 : 1;
  return (
    <group>
      <Legs w={w} d={d} h={legH} inset={0.05} t={0.04} color={t.dark} rough={0.55} />
      <Box size={[w, bodyH, d]} pos={[0, legH + bodyH / 2, 0]} color={t.primary} rough={0.55} />
      <Box size={[w + 0.02, 0.02, d + 0.02]} pos={[0, h - 0.01, 0]} color={t.light} rough={0.45} />
      {Array.from({ length: rows - 1 }, (_, i) => (
        <Box key={`r${i}`} size={[w - 0.08, 0.007, 0.007]} pos={[0, legH + (bodyH * (i + 1)) / rows, d / 2 + 0.003]} color={t.screen} shadow={false} />
      ))}
      {cols === 2 ? <Box size={[0.007, bodyH - 0.06, 0.007]} pos={[0, legH + bodyH / 2, d / 2 + 0.003]} color={t.screen} shadow={false} /> : null}
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => (
          <Ball key={`k${r}${c}`} r={0.013} pos={[cols === 1 ? 0 : (c === 0 ? -1 : 1) * (w / 4), legH + (bodyH * (r + 0.5)) / rows, d / 2 + 0.012]} color={t.metal} rough={0.3} metal={0.8} shadow={false} />
        )),
      )}
    </group>
  );
}

function Nightstand({ w, d, h, t }: BodyProps) {
  const legH = 0.08;
  const bodyH = h - legH;
  return (
    <group>
      <Legs w={w} d={d} h={legH} inset={0.04} t={0.035} color={t.dark} rough={0.55} round />
      <Box size={[w, bodyH, d]} pos={[0, legH + bodyH / 2, 0]} color={t.primary} rough={0.55} />
      <Box size={[w + 0.02, 0.02, d + 0.02]} pos={[0, h - 0.01, 0]} color={t.light} rough={0.45} />
      <Box size={[w - 0.06, 0.007, 0.007]} pos={[0, legH + bodyH * 0.5, d / 2 + 0.003]} color={t.screen} shadow={false} />
      <Ball r={0.012} pos={[0, legH + bodyH * 0.75, d / 2 + 0.012]} color={t.metal} rough={0.3} metal={0.8} shadow={false} />
    </group>
  );
}

function Wardrobe({ w, d, h, t }: BodyProps) {
  const plinth = 0.06;
  const bodyH = h - plinth;
  const doors = w >= 1.8 ? 3 : 2;
  return (
    <group>
      <Box size={[w - 0.04, plinth, d - 0.04]} pos={[0, plinth / 2, 0]} color={t.dark} rough={0.6} shadow={false} />
      <Box size={[w, bodyH, d]} pos={[0, plinth + bodyH / 2, 0]} color={t.primary} rough={0.6} />
      {Array.from({ length: doors - 1 }, (_, i) => (
        <Box key={i} size={[0.008, bodyH - 0.06, 0.008]} pos={[-w / 2 + (w / doors) * (i + 1), plinth + bodyH / 2, d / 2 + 0.003]} color={t.screen} shadow={false} />
      ))}
      {Array.from({ length: doors }, (_, i) => {
        const cx = -w / 2 + (w / doors) * (i + 0.5);
        const side = i < doors / 2 ? 1 : -1;
        return <Box key={`h${i}`} size={[0.016, 0.26, 0.02]} pos={[cx + side * (w / doors / 2 - 0.06), h * 0.5, d / 2 + 0.012]} color={t.metal} rough={0.3} metal={0.8} shadow={false} />;
      })}
    </group>
  );
}

/* ---------- bedroom ---------- */

function Bed({ w, d, h, t }: BodyProps) {
  const k = Math.min(1, h / 0.9);
  const frameH = 0.22 * k;
  const mattH = 0.22 * k;
  const headT = 0.05;
  const mattD = d - headT - 0.07;
  const mattZ = headT / 2;
  const duvetL = mattD * 0.62;
  const pillows = w < 1.2 ? 1 : 2;
  const pillowW = pillows === 1 ? w * 0.55 : w * 0.4 - 0.04;
  return (
    <group>
      <Box size={[w, h, headT]} pos={[0, h / 2, -d / 2 + headT / 2]} color={t.wood} rough={0.6} />
      <Box size={[w, frameH, d - headT]} pos={[0, frameH / 2, headT / 2]} color={t.wood} rough={0.6} />
      <Soft size={[w - 0.06, mattH, mattD]} pos={[0, frameH + mattH / 2, mattZ]} radius={0.05} color={t.linen} rough={0.95} />
      <Soft size={[w - 0.02, 0.07, duvetL]} pos={[0, frameH + mattH + 0.03, d / 2 - 0.05 - duvetL / 2]} radius={0.03} color={t.primary} rough={0.95} />
      {Array.from({ length: pillows }, (_, i) => (
        <Soft key={i} size={[pillowW, 0.1, 0.34]} pos={[pillows === 1 ? 0 : (i === 0 ? -1 : 1) * (w * 0.22), frameH + mattH + 0.05, -d / 2 + headT + 0.22]} radius={0.04} color={t.light} rough={0.95} shadow={false} />
      ))}
    </group>
  );
}

/* ---------- decor ---------- */

function Rug({ w, d, t }: BodyProps) {
  return (
    <group>
      <Box size={[w, 0.01, d]} pos={[0, 0.005, 0]} color={shade(t.primary, -0.22)} rough={1} shadow={false} />
      <Box size={[Math.max(0.1, w - 0.24), 0.012, Math.max(0.1, d - 0.24)]} pos={[0, 0.0065, 0]} color={t.primary} rough={1} shadow={false} />
      <Box size={[Math.max(0.05, w - 0.6), 0.013, Math.max(0.05, d - 0.6)]} pos={[0, 0.0072, 0]} color={shade(t.primary, 0.08)} rough={1} shadow={false} />
    </group>
  );
}

function FloorLamp({ w, h, t }: BodyProps) {
  const shadeH = 0.3;
  const r = w / 2;
  return (
    <group>
      <Cyl r={r} h={0.025} pos={[0, 0.0125, 0]} color={t.dark} rough={0.4} metal={0.5} />
      <Cyl r={0.014} h={h - shadeH - 0.025} pos={[0, 0.025 + (h - shadeH - 0.025) / 2, 0]} color={t.metal} rough={0.3} metal={0.8} segments={10} />
      <Cyl r={r * 1.15} rTop={r * 0.8} h={shadeH} pos={[0, h - shadeH / 2, 0]} color={t.linen} rough={0.9} open double glow="#ffd39a" glowIntensity={0.45} shadow={false} />
      <pointLight position={[0, h - shadeH / 2 - 0.05, 0]} color="#ffd6a3" intensity={1.4} distance={4} decay={1.5} />
    </group>
  );
}

function Plant({ w, h, t, seed }: BodyProps) {
  const potH = clamp(0.3 * h, 0.22, 0.42);
  const balls = useMemo(() => {
    const r = rng(seed);
    const n = 3 + Math.round(r());
    const span = Math.max(0.2, h - potH - 0.25);
    return Array.from({ length: n }, (_, i) => {
      const f = i / Math.max(1, n - 1);
      const rad = (w / 2) * (0.95 - f * 0.35) * (0.85 + r() * 0.25);
      return {
        x: (r() - 0.5) * w * 0.35 * (1 - f * 0.5),
        z: (r() - 0.5) * w * 0.35 * (1 - f * 0.5),
        y: potH + 0.1 + f * span,
        r: rad,
        color: shade(t.leaf, (r() - 0.5) * 0.25),
      };
    });
  }, [seed, w, h, potH, t.leaf]);
  return (
    <group>
      <Cyl r={(w / 2) * 0.62} rTop={(w / 2) * 0.78} h={potH} pos={[0, potH / 2, 0]} color={t.clay} rough={0.8} />
      <Cyl r={(w / 2) * 0.72} h={0.02} pos={[0, potH - 0.005, 0]} color="#2e241c" rough={1} shadow={false} />
      <Cyl r={0.02} h={h - potH - 0.2} pos={[0, potH + (h - potH - 0.2) / 2, 0]} color="#4a3a2a" rough={0.9} segments={8} shadow={false} />
      {balls.map((b, i) => (
        <Ball key={i} r={b.r} pos={[b.x, Math.min(b.y, h - b.r), b.z]} color={b.color} rough={0.95} />
      ))}
    </group>
  );
}

function Fallback({ w, d, h, t }: BodyProps) {
  return <Box size={[w, h, d]} pos={[0, h / 2, 0]} color={t.primary} rough={0.8} />;
}

const BODIES: Record<ProceduralKind, (p: BodyProps) => ReactElement> = {
  sofa: Sofa,
  sectional: Sectional,
  armchair: Armchair,
  coffeeTable: CoffeeTable,
  sideTable: SideTable,
  tvUnit: TvUnit,
  rug: Rug,
  floorLamp: FloorLamp,
  plant: Plant,
  bookshelf: Bookshelf,
  diningSet: DiningSet,
  bed: Bed,
  nightstand: Nightstand,
  dresser: Dresser,
  wardrobe: Wardrobe,
  desk: Desk,
  officeChair: OfficeChair,
  box: Fallback,
};

export function KindBody(props: BodyProps) {
  const Body = BODIES[props.kind] ?? Fallback;
  return <Body {...props} />;
}
