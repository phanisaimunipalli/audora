import { describe, expect, it } from 'vitest';
import { floorLabel, lengthToMetres, metresFromDimensions, planFromJson, planRoomType, planRooms, planSummary, storeyLabel } from '@/services/floorplan';

/**
 * The floor plan is the only place in Audora where a number arrives as *text a model read off a
 * drawing*. Converting it is arithmetic, so it is done here rather than delegated — and these are the
 * forms real estate-agent plans actually print.
 */
describe('reading a printed length', () => {
  it('reads feet and inches in every form a plan prints them', () => {
    expect(lengthToMetres("12'")).toBeCloseTo(3.6576, 4);
    expect(lengthToMetres(`12'6"`)).toBeCloseTo(3.8100, 4);
    expect(lengthToMetres(`12'-6"`)).toBeCloseTo(3.8100, 4);
    expect(lengthToMetres('12’6”')).toBeCloseTo(3.81, 4);
    expect(lengthToMetres('12 ft 6 in')).toBeCloseTo(3.81, 4);
  });

  it('reads metres and millimetres', () => {
    expect(lengthToMetres('3.80 m')).toBeCloseTo(3.8, 4);
    expect(lengthToMetres('3760 mm')).toBeCloseTo(3.76, 4);
    expect(lengthToMetres('380 cm')).toBeCloseTo(3.8, 4);
  });

  it('reads a bare number the way the plan means it', () => {
    expect(lengthToMetres('16', 'feet')).toBeCloseTo(4.8768, 4);
    expect(lengthToMetres('4.20', 'metres')).toBeCloseTo(4.2, 4);
    // No declared units: 3.80 is a metric room, 16 is a room in feet.
    expect(lengthToMetres('3.80')).toBeCloseTo(3.8, 4);
    expect(lengthToMetres('16')).toBeCloseTo(4.8768, 4);
  });

  it('refuses what is not a length', () => {
    expect(lengthToMetres('')).toBeUndefined();
    expect(lengthToMetres('Living Room')).toBeUndefined();
    expect(lengthToMetres(`12'19"`)).toBeUndefined();
  });
});

describe('reading a printed dimension pair', () => {
  it('converts a feet-and-inches pair', () => {
    expect(metresFromDimensions(`12'-4" × 15'-2"`)).toEqual({ width: 3.76, depth: 4.62 });
    expect(metresFromDimensions(`16'0" x 13'6"`)).toEqual({ width: 4.88, depth: 4.11 });
  });

  it('converts a metric pair, with or without the unit', () => {
    expect(metresFromDimensions('3.80 x 4.42', 'metres')).toEqual({ width: 3.8, depth: 4.42 });
    expect(metresFromDimensions('3.25 × 4.00 m')).toEqual({ width: 3.25, depth: 4 });
  });

  it('prefers the draughtsman’s own metric restatement on a mixed-unit plan', () => {
    expect(metresFromDimensions(`12'-0" × 9'-6"  (3.66 × 2.90 m)`, 'mixed')).toEqual({ width: 3.66, depth: 2.9 });
  });

  it('does not turn a metric room into a cupboard when the plan is mislabelled "feet"', () => {
    // The 1911 Paris plans print `3.74 x 4.70` in metres; a model that calls the sheet "feet" would
    // otherwise make that bedroom 1.14 x 1.43 m.
    expect(metresFromDimensions('3.74 x 4.70', 'feet')).toEqual({ width: 3.74, depth: 4.7 });
    // But a genuine 5 ft by 4 ft cupboard, written without decimals, stays in feet.
    expect(metresFromDimensions('5 x 4', 'feet')).toEqual({ width: 1.52, depth: 1.22 });
    // And a real feet-and-inches bathroom is left alone.
    expect(metresFromDimensions(`8'-0" × 5'-0"`, 'feet')).toEqual({ width: 2.44, depth: 1.52 });
  });

  it('returns nothing for a single length or a caption', () => {
    expect(metresFromDimensions(`12'-4"`)).toBeUndefined();
    expect(metresFromDimensions('approximate')).toBeUndefined();
  });
});

describe('room names', () => {
  it('knows what plans print, in English and in French', () => {
    expect(planRoomType('CHAMBRE')).toBe('bedroom');
    expect(planRoomType('Salle à manger')).toBe('dining');
    expect(planRoomType('SALON')).toBe('living');
    expect(planRoomType('Cuisine')).toBe('kitchen');
    expect(planRoomType('W.C.')).toBe('bathroom');
    expect(planRoomType('Antichambre')).toBe('hallway');
    expect(planRoomType('2 Car Garage')).toBe('other');
    expect(planRoomType('W.I.C.')).toBe('other');
    expect(planRoomType('Bed 3')).toBe('bedroom');
    expect(planRoomType('Primary Bedroom')).toBe('bedroom');
  });
});

describe('normalising a model answer', () => {
  const answer = {
    units: 'feet',
    north_arrow: { present: true, direction: 'up' },
    floors: [
      {
        label: 'Main Floor',
        rooms: [
          // The model read the string correctly and then converted it badly: our reading wins.
          { name: 'Living Room', type: 'living', dimensions_text: `16'-0" × 13'-6"`, width_m: 16, depth_m: 13.5 },
          { name: 'Hall', type: 'hallway' },
          { name: '', type: 'other' },
        ],
      },
      { label: 'Empty', rooms: [] },
    ],
    notes: ['Two units share the sheet.'],
  };

  it('re-reads the printed text and drops nameless rooms and empty floors', () => {
    const plan = planFromJson(answer);
    expect(plan.floors).toHaveLength(1);
    const rooms = planRooms(plan);
    expect(rooms.map((r) => r.name)).toEqual(['Living Room', 'Hall']);
    expect(rooms[0].width).toBeCloseTo(4.88, 2);
    expect(rooms[0].depth).toBeCloseTo(4.11, 2);
    expect(rooms[0].dimensionsFrom).toBe('text');
    expect(rooms[1].width).toBeUndefined();
    expect(plan.northArrow).toEqual({ present: true, direction: 'up', degrees: undefined });
    expect(planSummary(plan)).toBe('1 floor · 2 rooms · 1 with dimensions');
  });

  it('falls back to the model’s own metres when the printed text cannot be read', () => {
    const plan = planFromJson({
      units: 'unknown',
      floors: [{ label: 'Floor plan', rooms: [{ name: 'Salon', type: 'living', dimensions_text: '≈ trente pieds carrés', width_m: 3.7, depth_m: 5.35 }] }],
      notes: [],
    });
    const [room] = planRooms(plan);
    expect(room).toMatchObject({ width: 3.7, depth: 5.35, dimensionsFrom: 'model' });
  });

  it('drops a stuck decoder’s hundred identical rooms but keeps a plan’s real repeats', () => {
    const rooms = (n: number) => Array.from({ length: n }, () => ({ name: 'Chambre', type: 'bedroom', dimensions_text: '3.74 x 4.70' }));
    const plan = planFromJson({ units: 'metres', floors: [{ label: 'Lot H', rooms: [...rooms(40), { name: 'Cuisine', type: 'kitchen' }] }], notes: [] });
    const got = planRooms(plan);
    expect(got.filter((r) => r.name === 'Chambre')).toHaveLength(3);
    expect(got.some((r) => r.name === 'Cuisine')).toBe(true);
  });

  it('survives rubbish', () => {
    expect(planFromJson(null).floors).toEqual([]);
    expect(planFromJson({ floors: 'nope' }).units).toBe('unknown');
  });
});

describe('floor labels', () => {
  const rooms = (...names: string[]) => names.map((name) => ({ name, type: 'other' as const }));

  it('names the sheets by storey when the model hands back room labels and the plan title', () => {
    // Exactly what the demo townhouse plan came back with.
    const plan = planFromJson({
      units: 'feet',
      floors: [
        { label: '2 CAR GARAGE', rooms: [{ name: '2 CAR GARAGE', type: 'other' }, { name: 'PORCH', type: 'other' }] },
        { label: 'DECK', rooms: [{ name: 'LIVING', type: 'living' }, { name: 'KITCHEN', type: 'kitchen' }] },
        { label: 'FLOOR PLAN', rooms: [{ name: 'Bed 1', type: 'bedroom' }, { name: 'Bed 2', type: 'bedroom' }] },
      ],
      notes: [],
    });
    expect(plan.floors.map((f) => f.label)).toEqual(['Ground floor', 'First floor', 'Second floor']);
    expect(planRooms(plan).map((r) => r.floor)).toEqual(['Ground floor', 'Ground floor', 'First floor', 'First floor', 'Second floor', 'Second floor']);
  });

  it('keeps a real storey title, and keeps "Floor plan" for a single unlabelled sheet', () => {
    expect(floorLabel('Ground Floor', 0, rooms('Kitchen'))).toBe('Ground Floor');
    expect(floorLabel('Basement', 1, rooms('Store'))).toBe('Basement');
    expect(floorLabel('Floor plan', 0, rooms('Salon'), { single: true })).toBe('Floor plan');
    expect(floorLabel('', 0, rooms('Salon'), { single: true })).toBe('Floor plan');
  });

  it('refuses a label that is one of the rooms on the sheet, and numbers duplicates', () => {
    expect(floorLabel('Kitchen', 1, rooms('Kitchen', 'Hall'))).toBe('First floor');
    const taken = new Set(['ground floor']);
    expect(floorLabel('Ground Floor', 1, rooms('Hall'), { taken })).toBe('First floor');
    expect(storeyLabel(4)).toBe('Level 5');
  });
});
