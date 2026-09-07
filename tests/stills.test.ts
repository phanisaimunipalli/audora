import { describe, expect, it } from 'vitest';
import { compositeSpecs, runToWall } from '@/three/stills';

/** The demo corner room: 3.00 × 4.06 m, with the capture point near the rear wall. */
const CORNER = { width: 3.0, depth: 4.06 };
const CAPTURE = { x: 0.92, z: 1.15, yaw: 0.75 };

const yawOf = (spec: { position: [number, number, number]; lookAt: [number, number, number] }) =>
  Math.atan2(spec.position[0] - spec.lookAt[0], spec.position[2] - spec.lookAt[2]);

const apart = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('runToWall', () => {
  it('measures the floor in front of a direction, to the room rectangle', () => {
    // From the centre, looking north (yaw 0 → −z) is half the depth away.
    expect(runToWall(CORNER, 0, 0, 0)).toBeCloseTo(CORNER.depth / 2, 6);
    expect(runToWall(CORNER, 0, 0, Math.PI / 2)).toBeCloseTo(CORNER.width / 2, 6);
    // Standing 60 cm off the rear wall, looking back at it is 60 cm of room.
    expect(runToWall(CORNER, 0, CORNER.depth / 2 - 0.6, Math.PI)).toBeCloseTo(0.6, 6);
  });
});

describe('compositeSpecs', () => {
  it('turns on the capture point and keeps Portrait first', () => {
    const specs = compositeSpecs(CAPTURE, { yaw: 1.2 }, { room: CORNER });
    expect(specs).toHaveLength(4);
    expect(specs[0].name).toBe('Portrait');
    for (const s of specs) {
      expect(s.position[0]).toBeCloseTo(CAPTURE.x, 6);
      expect(s.position[2]).toBeCloseTo(CAPTURE.z, 6);
    }
    expect(yawOf(specs[0])).toBeCloseTo(1.2, 3);
  });

  it('picks four distinct directions, none of them a wall in your face', () => {
    const specs = compositeSpecs(CAPTURE, null, { room: CORNER });
    const yaws = specs.map(yawOf);
    for (let i = 0; i < yaws.length; i++)
      for (let j = i + 1; j < yaws.length; j++) expect(apart(yaws[i], yaws[j])).toBeGreaterThan(0.25);
    // Every angle sees a metre of room or more, and the worst of the four beats the worst of the
    // fixed offsets that made "Looking back" a blurred wall.
    const run = (yaw: number) => runToWall(CORNER, CAPTURE.x, CAPTURE.z, yaw);
    for (const yaw of yaws) expect(run(yaw)).toBeGreaterThan(1.4);
    const fixed = [CAPTURE.yaw, CAPTURE.yaw, CAPTURE.yaw + 1.15, CAPTURE.yaw + Math.PI].map(run);
    expect(Math.min(...yaws.map(run))).toBeGreaterThan(Math.min(...fixed) * 2);
  });

  it('keeps the old fixed offsets when no room is given', () => {
    const specs = compositeSpecs(CAPTURE, null);
    expect(specs.map((s) => s.name)).toEqual(['Portrait', 'The long view', 'Across the room', 'The far corner']);
    expect(apart(yawOf(specs[3]), CAPTURE.yaw + Math.PI)).toBeLessThan(1e-3);
  });
});
