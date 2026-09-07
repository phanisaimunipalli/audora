/**
 * The seller answers one question on the compass — "which way do the windows face?" — and the engine
 * stores a different number: the bearing of the room's *north* wall. `facingToHeading` converts
 * between them, and the conversion needs the wall the windows are on, which is read off the rooms.
 *
 * The rooms are not fixed. The Site step is step 2 of six; the floor plan then adds rooms and the
 * seller adds photos, and a later room can move the *dominant* window wall. Re-deriving the wall at
 * display time therefore renames a heading that never moved — in the create flow this turned a
 * confirmed "264° · west" into "84° · east" on the hub, purely because a garage arrived.
 *
 * `TourSite.windowWall` records the wall the answer was given against. These tests pin the invariant
 * the Site card relies on.
 */
import { describe, expect, it } from 'vitest';
import { WALL_BEARING, compassLabel, facingToHeading, headingToFacing, norm360 } from '@/engine/siteSun';
import type { WallSide } from '@/engine/types';

const WALLS: WallSide[] = ['north', 'east', 'south', 'west'];

describe('site heading, as stored and as said', () => {
  it('round-trips every façade bearing through every window wall', () => {
    for (const wall of WALLS) {
      for (const facing of [0, 47, 90, 171.4, 261.4, 359]) {
        expect(headingToFacing(facingToHeading(facing, wall), wall)).toBeCloseTo(norm360(facing), 6);
      }
    }
  });

  it('reads the same façade back whichever wall the windows turned out to be on', () => {
    const confirmed = 261.4; // west, the demo listing's own façade
    const stored = WALLS.map((wall) => ({ wall, heading: facingToHeading(confirmed, wall) }));
    // Every one of these is a different stored heading …
    expect(new Set(stored.map((s) => Math.round(s.heading))).size).toBe(4);
    // … and every one says "west" again when read against the wall it was stored with.
    for (const { wall, heading } of stored) {
      const facing = headingToFacing(heading, wall);
      expect(Math.round(facing)).toBe(Math.round(confirmed));
      expect(compassLabel(facing)).toBe('west');
    }
  });

  it('is the drift the recorded wall exists to prevent', () => {
    // Confirmed on rooms whose windows were on the west wall …
    const heading = facingToHeading(264, 'west');
    // … then a room with east windows arrives and takes the majority.
    expect(Math.round(headingToFacing(heading, 'east'))).toBe(84);
    // Recording the wall keeps the seller's own answer.
    expect(Math.round(headingToFacing(heading, 'west'))).toBe(264);
  });

  it('turns a wall bearing the way the compass does', () => {
    expect(WALL_BEARING).toEqual({ north: 0, east: 90, south: 180, west: 270 });
  });
});
