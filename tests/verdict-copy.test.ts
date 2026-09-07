/**
 * The buyer's verdict is read out loud in the panel, so it has to read like a sentence a person wrote.
 * Repeating "It overlaps the nightstand. It overlaps the nightstand." is the bug this file guards.
 */
import { describe, expect, it } from 'vitest';
import { buyerVerdict, listNames } from '../src/engine/fit';
import { makePiece } from '../src/engine/autostage';
import { catalogItem } from '../src/engine/catalog';
import type { PlacedPiece, RoomGeometry } from '../src/engine/types';
import { itemKey, itemLabel } from '../src/screens/insights/stats';

const room: RoomGeometry = {
  width: 4.2,
  depth: 5.1,
  height: 2.6,
  door: { wall: 'south', offset: 0.8, width: 0.9, height: 2.03 },
  windows: [],
};

const nightstand = (id: string, x: number, z: number): PlacedPiece => ({
  ...makePiece(catalogItem('nightstand')!, x, z, 0, 'seller'),
  id,
});

describe('listNames', () => {
  it('names one blocker once', () => {
    expect(listNames(['Nightstand'])).toBe('the nightstand');
  });
  it('counts a repeated blocker instead of repeating it', () => {
    expect(listNames(['Nightstand', 'Nightstand'])).toBe('both nightstands');
    expect(listNames(['Nightstand', 'nightstand', 'NIGHTSTAND'])).toBe('3 nightstands');
  });
  it('joins different blockers with a comma and an "and"', () => {
    expect(listNames(['Bed', 'Nightstand', 'Nightstand'])).toBe('the bed and both nightstands');
  });
});

describe('buyerVerdict copy', () => {
  it('says each overlapping piece once, with a count', () => {
    const staging = [nightstand('n1', -0.5, -1.5), nightstand('n2', 0.5, -1.5)];
    const piece = makePiece({ ...catalogItem('bed-king')!, id: 'custom', name: 'Our bed' }, 0, -1.5, 0, 'buyer');
    const v = buyerVerdict(piece, staging, room);
    expect(v.fits).toBe(false);
    const overlap = v.reasons.filter((r) => r.includes('overlaps'));
    expect(overlap).toHaveLength(1);
    expect(overlap[0]).toBe('It overlaps both nightstands.');
    // No sentence appears twice in the detail line.
    const sentences = v.detail.split(/(?<=\.)\s+/).filter(Boolean);
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe('insight item names', () => {
  it('groups case, spacing and plural variants of the same piece', () => {
    expect(itemKey(' Sofa ')).toBe(itemKey('sofa'));
    expect(itemKey('sofas')).toBe('sofa');
    expect(itemKey('Dining  Tables')).toBe('dining table');
    expect(itemKey('3-seat sofa')).not.toBe(itemKey('sofa'));
  });
  it('title-cases for display without shouting the small words', () => {
    expect(itemLabel('3-seat sofa')).toBe('3-Seat Sofa');
    expect(itemLabel('dining table for 6')).toBe('Dining Table for 6');
    expect(itemLabel('chair')).toBe('Chair');
  });
});
