import { describe, expect, it } from 'vitest';
import { buyerVerdict, fitReport, pieceStatus } from '../src/engine/fit';
import { autoStage, makePiece, validateProposal } from '../src/engine/autostage';
import { catalogItem, parseFurnitureText } from '../src/engine/catalog';
import type { RoomGeometry } from '../src/engine/types';

const room: RoomGeometry = {
  width: 4.2,
  depth: 5.1,
  height: 2.6,
  door: { wall: 'south', offset: 0.8, width: 0.9, height: 2.03 },
  windows: [{ wall: 'north', offset: 2.1, width: 1.6, height: 1.3, sill: 0.9 }],
};

describe('fit report', () => {
  it('reports an empty room', () => {
    const r = fitReport([], room);
    expect(r.pieces).toBe(0);
    expect(r.floorUsedPct).toBe(0);
    expect(r.narrowestWalkway).toBeNull();
  });
  it('flags overlaps and out of bounds', () => {
    const sofa = makePiece(catalogItem('sofa-3')!, 0, 0, 0);
    const table = makePiece(catalogItem('coffee')!, 0, 0, 0);
    const far = makePiece(catalogItem('plant')!, 10, 0, 0);
    const r = fitReport([sofa, table, far], room);
    expect(r.overlaps.length).toBe(1);
    expect(r.outOfBounds).toContain(far.id);
    expect(r.misfits.length).toBe(3);
  });
  it('rugs never collide', () => {
    const sofa = makePiece(catalogItem('sofa-3')!, 0, 0, 0);
    const rug = makePiece(catalogItem('rug-l')!, 0, 0, 0);
    expect(pieceStatus(rug, [sofa], room)).toBe('ok');
    expect(fitReport([sofa, rug], room).overlaps.length).toBe(0);
  });
  it('measures the narrowest walkway between corridor-defining pieces', () => {
    const sofa = makePiece(catalogItem('sofa-3')!, 0, -2.075, 0); // against north wall
    const shelf = makePiece(catalogItem('shelf')!, 0, -2.075 + 0.475 + 0.5 + 0.15, 0); // 0.5m gap, not a companion
    const r = fitReport([sofa, shelf], room);
    expect(r.narrowestWalkway).toBeCloseTo(0.5, 2);
    expect(r.tightSpots.length).toBeGreaterThan(0);
  });
  it('treats a coffee table in front of a sofa as legroom, not a walkway', () => {
    const sofa = makePiece(catalogItem('sofa-3')!, 0, -2.075, 0);
    const table = makePiece(catalogItem('coffee')!, 0, -2.075 + 0.475 + 0.45 + 0.3, 0); // 0.45m gap
    const r = fitReport([sofa, table], room);
    expect(r.tightSpots.length).toBe(0);
  });
  it('rule-based stager places a bed in a tiny bedroom without blocking the door', () => {
    const tiny: RoomGeometry = { width: 2.6, depth: 2.9, height: 2.4, door: { wall: 'south', offset: 0.6, width: 0.8, height: 2.03 }, windows: [] };
    const pieces = autoStage(tiny, 'bedroom', 'minimal');
    expect(pieces.some((p) => p.kind === 'bed')).toBe(true);
    const r = fitReport(pieces, tiny);
    expect(r.blocksDoor).toEqual([]);
    expect(r.overlaps).toEqual([]);
  });
  it('flags a piece blocking the door', () => {
    const chair = makePiece(catalogItem('armchair')!, -2.1 + 0.8, 2.55 - 0.45, 0);
    expect(fitReport([chair], room).blocksDoor).toContain(chair.id);
  });
});

describe('auto stage', () => {
  it('produces a valid living room', () => {
    const pieces = autoStage(room, 'living', 'warm');
    expect(pieces.length).toBeGreaterThanOrEqual(4);
    const r = fitReport(pieces, room);
    expect(r.overlaps).toEqual([]);
    expect(r.outOfBounds).toEqual([]);
    expect(r.blocksDoor).toEqual([]);
  });
  it('produces a valid bedroom in a small room', () => {
    const small: RoomGeometry = { ...room, width: 3.1, depth: 3.4 };
    const pieces = autoStage(small, 'bedroom', 'minimal');
    expect(pieces.some((p) => p.kind === 'bed')).toBe(true);
    const r = fitReport(pieces, small);
    expect(r.misfits).toEqual([]);
  });
  it('repairs an AI proposal', () => {
    const { pieces, dropped } = validateProposal(room, [
      { itemId: 'sofa-3', x: 0, z: -2.0, rot: 0 },
      { itemId: 'coffee', x: 0, z: -2.0, rot: 0 }, // overlaps the sofa
      { itemId: 'plant', x: 9, z: 9, rot: 0 }, // clamped into the corner
      { itemId: 'nope', x: 0, z: 0, rot: 0 },
    ]);
    expect(pieces.length).toBe(2);
    expect(dropped.length).toBe(2);
  });
});

describe('buyer verdict', () => {
  it('says yes with the walkway that remains', () => {
    const staging = autoStage(room, 'living', 'minimal');
    const item = parseFurnitureText('sectional, 220 by 95')!;
    expect(item.w).toBeCloseTo(2.2);
    const piece = makePiece({ ...catalogItem('sofa-3')!, id: 'custom', name: item.name, w: item.w, d: item.d, h: item.h }, 0, 1.6, 0, 'buyer');
    const v = buyerVerdict(piece, staging, room);
    expect(typeof v.fits).toBe('boolean');
    expect(v.headline.length).toBeGreaterThan(0);
  });
  it('says no when the piece is bigger than the room', () => {
    const piece = makePiece({ ...catalogItem('sofa-3')!, id: 'custom', name: 'Giant sofa', w: 6, d: 1 }, 0, 0, 0, 'buyer');
    const v = buyerVerdict(piece, [], room);
    expect(v.fits).toBe(false);
    expect(v.reasons[0]).toMatch(/crosses/);
  });
  it('parses units', () => {
    expect(parseFurnitureText('queen bed 160x210x95')).toMatchObject({ w: 1.6, d: 2.1, h: 0.95, kind: 'bed' });
    expect(parseFurnitureText('table 1.4m x 0.8m')?.w).toBeCloseTo(1.4);
    expect(parseFurnitureText('sofa 84in by 36in')?.w).toBeCloseTo(2.1336);
    expect(parseFurnitureText('nothing')).toBeNull();
  });
});

describe('furniture text parser names', () => {
  it('keeps the name clean when dimensions are joined with "by" and commas', () => {
    expect(parseFurnitureText('sectional, 220 by 95')?.name).toBe('Sectional');
    expect(parseFurnitureText('queen bed 160x210')?.name).toBe('Queen bed');
    expect(parseFurnitureText('Dining table for 6, 200 x 100 cm')?.name).toBe('Dining table for');
  });
});
