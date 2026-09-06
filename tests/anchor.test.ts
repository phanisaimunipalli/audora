import { describe, expect, it } from 'vitest';
import { anchorFromDoor, anchorFromOutlet, anchorFromWall, applyScale, plausibility } from '../src/engine/anchor';
import type { RawGeometry } from '../src/engine/types';

const raw: RawGeometry = {
  width: 2,
  depth: 2.5,
  height: 1.28,
  door: { wall: 'south', offset: 0.5, width: 0.44, height: 1 },
  windows: [],
  doorHeightUnits: 1,
  outletHeightUnits: 0.148,
};

describe('anchor', () => {
  it('door anchor derives metres per unit', () => {
    const a = anchorFromDoor(raw, 0.4);
    expect(a.metresPerUnit).toBeCloseTo(2.03);
    expect(a.uncertaintyM).toBeLessThanOrEqual(0.05);
    expect(a.label).toContain('2.03 m');
    const g = applyScale(raw, a.metresPerUnit);
    expect(g.width).toBeCloseTo(4.06, 2);
    expect(g.height).toBeCloseTo(2.598, 2);
  });
  it('a tiny door tap is less certain', () => {
    expect(anchorFromDoor(raw, 0.1).uncertaintyM).toBeGreaterThan(anchorFromDoor(raw, 0.5).uncertaintyM);
  });
  it('outlet anchor is coarser than a door', () => {
    expect(anchorFromOutlet(raw, 0.05).uncertaintyM).toBeGreaterThan(anchorFromDoor(raw, 0.4).uncertaintyM);
  });
  it('laser wall measurement is the tightest', () => {
    const a = anchorFromWall(raw, 'width', 4.2, 'laser');
    expect(a.metresPerUnit).toBeCloseTo(2.1);
    expect(a.uncertaintyM).toBe(0.01);
  });
  it('flags an implausible ceiling', () => {
    const g = applyScale(raw, 3.3);
    const w = plausibility(g);
    expect(w.some((x) => x.field === 'height')).toBe(true);
  });
});

describe('ceiling anchor', () => {
  it('scales from an assumed 2.44m ceiling', async () => {
    const { anchorFromCeiling } = await import('../src/engine/anchor');
    const a = anchorFromCeiling(raw);
    expect(a.metresPerUnit).toBeCloseTo(2.44 / 1.28, 4);
    expect(a.method).toBe('ceiling');
    expect(a.uncertaintyM).toBeGreaterThan(anchorFromDoor(raw, 0.4).uncertaintyM);
  });
});
