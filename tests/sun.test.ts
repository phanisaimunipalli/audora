import { describe, expect, it } from 'vitest';
import { sunDirectionInRoom, sunPosition, sunTimes, sunlitWalls } from '../src/engine/sun';

const SF = { lat: 37.7727, lon: -122.4399 };

describe('solar position', () => {
  it('puts the midsummer midday sun high in the south over San Francisco', () => {
    // 2026-06-21 13:00 PDT = 20:00 UTC
    const s = sunPosition(new Date(Date.UTC(2026, 5, 21, 20, 0, 0)), SF.lat, SF.lon);
    expect(s.elevation).toBeGreaterThan(70);
    expect(s.elevation).toBeLessThan(80);
    expect(s.azimuth).toBeGreaterThan(150);
    expect(s.azimuth).toBeLessThan(230);
  });
  it('is below the horizon at midnight', () => {
    const s = sunPosition(new Date(Date.UTC(2026, 5, 21, 8, 0, 0)), SF.lat, SF.lon); // 01:00 PDT
    expect(s.elevation).toBeLessThan(0);
  });
  it('rises in the north-east in June and sets in the north-west', () => {
    const { sunrise, sunset } = sunTimes(new Date(Date.UTC(2026, 5, 21)), SF.lat, SF.lon);
    expect(sunrise).not.toBeNull();
    expect(sunset).not.toBeNull();
    const rise = sunPosition(new Date(sunrise!.getTime() + 10 * 60000), SF.lat, SF.lon);
    const set = sunPosition(new Date(sunset!.getTime() - 10 * 60000), SF.lat, SF.lon);
    expect(rise.azimuth).toBeGreaterThan(50);
    expect(rise.azimuth).toBeLessThan(80);
    expect(set.azimuth).toBeGreaterThan(280);
    expect(set.azimuth).toBeLessThan(310);
    // sunrise ≈ 05:48 PDT = 12:48 UTC
    expect(sunrise!.getUTCHours()).toBe(12);
  });
  it('winter noon sun is low', () => {
    const s = sunPosition(new Date(Date.UTC(2026, 11, 21, 20, 10, 0)), SF.lat, SF.lon);
    expect(s.elevation).toBeGreaterThan(25);
    expect(s.elevation).toBeLessThan(32);
  });
});

describe('sun in the room frame', () => {
  it('a southern sun lights the south wall when the north wall faces true north', () => {
    const d = sunDirectionInRoom({ azimuth: 180, elevation: 40 }, 0);
    expect(d.z).toBeGreaterThan(0.5);
    expect(d.y).toBeCloseTo(Math.sin((40 * Math.PI) / 180), 3);
    expect(sunlitWalls({ azimuth: 180, elevation: 40 }, 0)).toEqual(['south']);
  });
  it('rotating the building rotates the sun', () => {
    // The room's north wall faces east (heading 90): a sun due east is straight through the north wall.
    expect(sunlitWalls({ azimuth: 90, elevation: 30 }, 90)).toEqual(['north']);
  });
  it('no walls are sunlit at night', () => {
    expect(sunlitWalls({ azimuth: 10, elevation: -5 }, 0)).toEqual([]);
  });
});
