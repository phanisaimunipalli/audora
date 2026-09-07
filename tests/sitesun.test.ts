import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  clockLabel,
  compassAbbr,
  compassLabel,
  dateFromInput,
  dateInputValue,
  defaultHeading,
  dominantWindowWall,
  effectiveHeading,
  facingToHeading,
  footprintAxes,
  headingToFacing,
  minutesOfDay,
  nearestAxis,
  norm360,
  snapHeading,
  sunIntensity,
  sunReadout,
  sunState,
  wallBearing,
  wallsPhrase,
  withMinutes,
} from '../src/engine/siteSun';

describe('compass', () => {
  it('names the eight points', () => {
    expect(compassLabel(0)).toBe('north');
    expect(compassLabel(225)).toBe('south-west');
    expect(compassLabel(359)).toBe('north');
    expect(compassLabel(-90)).toBe('west');
    expect(compassAbbr(225)).toBe('SW');
    expect(compassAbbr(90)).toBe('E');
  });
  it('wraps and measures the short way round', () => {
    expect(norm360(-10)).toBe(350);
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
  });
});

describe('heading snap', () => {
  it('gives a rectangular building four wall normals', () => {
    expect(footprintAxes(12)).toEqual([12, 102, 192, 282]);
    // The principal heading is a bearing mod 180; either half names the same four walls.
    expect(footprintAxes(192)).toEqual(footprintAxes(12));
  });
  it('snaps a thumb that missed the axis, and only that', () => {
    // 8° off a 102° wall: the seller meant the wall.
    expect(snapHeading(94, 12)).toBe(102);
    expect(snapHeading(110, 12)).toBe(102);
    // 30° off everything: they meant what they said.
    expect(snapHeading(60, 12)).toBe(60);
    // The tolerance is the contract.
    expect(snapHeading(102 - 12, 12)).toBe(102);
    expect(snapHeading(102 - 13, 12)).toBe(89);
  });
  it('snaps across the 0/360 seam', () => {
    expect(snapHeading(357, 5)).toBe(5);
    expect(snapHeading(3, 355)).toBe(355);
  });
  it('leaves the heading alone when the building has no footprint', () => {
    expect(snapHeading(94)).toBe(94);
    expect(snapHeading(-6)).toBe(354);
  });
  it('reports how far off the nearest axis is', () => {
    expect(nearestAxis(94, 12)).toEqual({ axis: 102, offBy: 8 });
    expect(nearestAxis(47, 12).offBy).toBe(35);
  });
  it('prefills the outward normal of the longest wall, and lets the room override the building', () => {
    // A long wall running east-west (bearing 90) faces its windows north or south; we offer south.
    expect(defaultHeading(90)).toBe(180);
    expect(defaultHeading(undefined)).toBe(0);
    expect(effectiveHeading(180, undefined)).toBe(180);
    expect(effectiveHeading(180, 95)).toBe(95);
    expect(effectiveHeading(undefined, undefined)).toBe(0);
  });
  it('turns a room wall into a compass bearing', () => {
    expect(wallBearing('north', 180)).toBe(180);
    expect(wallBearing('east', 180)).toBe(270);
    expect(wallBearing('west', 10)).toBe(280);
  });
});

describe('window wall ⇄ room heading', () => {
  it('picks the wall most of the windows are on, and north when there are none', () => {
    expect(dominantWindowWall(['west', 'west', 'south'])).toBe('west');
    expect(dominantWindowWall([])).toBe('north');
    // A tie is broken in room order, so the answer never depends on the order the rooms were added.
    expect(dominantWindowWall(['south', 'east'])).toBe(dominantWindowWall(['east', 'south']));
  });
  it('turns "the windows face west" into the heading the engine needs, and back', () => {
    // Windows on the room's west wall, looking due west: the north wall then faces true north.
    expect(facingToHeading(270, 'west')).toBe(0);
    expect(headingToFacing(0, 'west')).toBe(270);
    // The building's façade at 261°, windows on the west wall.
    expect(facingToHeading(261, 'west')).toBe(351);
    expect(headingToFacing(351, 'west')).toBe(261);
    // A room whose windows are on its north wall loses nothing: the two are the same number.
    expect(facingToHeading(137, 'north')).toBe(137);
    expect(headingToFacing(137, 'north')).toBe(137);
  });
  it('round-trips every wall', () => {
    for (const wall of ['north', 'east', 'south', 'west'] as const) {
      for (const facing of [0, 47, 180, 300, 359]) {
        expect(headingToFacing(facingToHeading(facing, wall), wall)).toBe(facing);
      }
    }
  });
  it('so the sun really comes through the window, not through the wall behind it', () => {
    // SF, 2026-09-06 18:00 PDT: the sun is in the west. A west-facing window must be lit.
    const heading = facingToHeading(270, 'west');
    const s = sunState(new Date(Date.UTC(2026, 8, 7, 1, 0, 0)), 37.7727, -122.4399, heading);
    expect(s.walls).toContain('west');
  });
});

describe('readout', () => {
  const at = (h: number, m: number) => new Date(2026, 8, 6, h, m, 0, 0);

  it('reads the way the owner asked for it', () => {
    expect(sunReadout(at(14, 20), { azimuth: 225, elevation: 61 }, ['south'])).toBe(
      '14:20 · sun 61° high, from the south-west · lights the south wall',
    );
  });
  it('lists more than one wall in room order', () => {
    expect(sunReadout(at(9, 5), { azimuth: 120, elevation: 28.4 }, ['west', 'south', 'north'])).toBe(
      '09:05 · sun 28° high, from the south-east · lights the north, south and west walls',
    );
    expect(wallsPhrase(['east', 'north'])).toBe('the north and east walls');
    expect(wallsPhrase([])).toBe('');
  });
  it('is honest when the sun is up but no wall catches it', () => {
    expect(sunReadout(at(7, 0), { azimuth: 90, elevation: 5 }, [])).toBe('07:00 · sun 5° high, from the east · no wall catches it');
  });
  it('says nothing clever at night', () => {
    expect(sunReadout(at(23, 45), { azimuth: 12, elevation: -14 }, [])).toBe('23:45 · the sun is below the horizon');
  });
  it('pads the clock and reads the slider back', () => {
    expect(clockLabel(at(6, 5))).toBe('06:05');
    expect(minutesOfDay(at(14, 20))).toBe(860);
    expect(clockLabel(withMinutes(at(0, 0), 860))).toBe('14:20');
    expect(dateInputValue(at(14, 20))).toBe('2026-09-06');
    const moved = dateFromInput('2026-12-21', at(14, 20));
    expect(moved && clockLabel(moved)).toBe('14:20');
    expect(moved && dateInputValue(moved)).toBe('2026-12-21');
    expect(dateFromInput('nonsense', at(14, 20))).toBeNull();
  });
});

describe('the light itself', () => {
  it('fades to nothing at the horizon rather than switching off', () => {
    expect(sunIntensity(-2)).toBe(0);
    expect(sunIntensity(0)).toBe(0);
    expect(sunIntensity(3)).toBeGreaterThan(0.4);
    expect(sunIntensity(3)).toBeLessThan(0.6);
    expect(sunIntensity(40)).toBe(1);
  });
  it('puts a September afternoon in San Francisco on the room walls facing it', () => {
    // 2026-09-06 15:00 PDT = 22:00 UTC. Room's north wall faces true north.
    const s = sunState(new Date(Date.UTC(2026, 8, 6, 22, 0, 0)), 37.7727, -122.4399, 0);
    expect(s.sun.elevation).toBeGreaterThan(30);
    expect(s.sun.azimuth).toBeGreaterThan(215); // south-west
    expect(s.walls).toContain('south');
    expect(s.walls).toContain('west');
    expect(s.direction.z).toBeGreaterThan(0); // toward the room's south
    expect(s.direction.x).toBeLessThan(0); // and its west
    expect(s.intensity).toBe(1);
    expect(s.readout).toContain('lights the south and west walls');
  });
  it('turns with the building: the same instant through a room rotated 180°', () => {
    const d = new Date(Date.UTC(2026, 8, 6, 22, 0, 0));
    const a = sunState(d, 37.7727, -122.4399, 0);
    const b = sunState(d, 37.7727, -122.4399, 180);
    expect(b.walls).toContain('north');
    expect(b.walls).toContain('east');
    expect(b.direction.y).toBeCloseTo(a.direction.y, 6);
    expect(b.direction.x).toBeCloseTo(-a.direction.x, 6);
    expect(b.direction.z).toBeCloseTo(-a.direction.z, 6);
  });
});
