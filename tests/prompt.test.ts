/**
 * The Marble prompt compiler (server/prompt.ts). The prompt is hashed into the recipe, so this is
 * as much a contract test as a behaviour test: a full prompt is pinned verbatim, every fact must
 * appear in its fixed place, unknown facts must be left out, and the cap must trim context before
 * finishes before openings while never touching the geometry or the constraints.
 */
import { describe, expect, it } from 'vitest';
import { compileMarblePrompt, PROMPT_CONSTRAINTS, PROMPT_MAX_CHARS, type PromptFacts } from '../server/prompt';

function fullFacts(): PromptFacts {
  return {
    roomType: 'living',
    imageCount: 3,
    empty: true,
    capturedFrom: 'doorway',
    widthM: 3.75,
    depthM: 4.6,
    ceilingHeightM: 2.44,
    doors: [{ wall: 'south', offset: 1.2, width: 0.9, height: 2.03, swing: 'inward' }],
    windows: [
      { wall: 'north', offset: 0.9, width: 1.4, height: 1.2, sill: 0.9 },
      { wall: 'east', offset: 2.0, width: 0.8, height: 1.2, sill: 0.9 },
    ],
    flooring: 'oak',
    walls: 'white',
    trim: 'white',
    fixtures: ['radiator under the window', 'pendant light'],
    notes: ['renovated 2021'],
    floorLevel: 3,
    buildingType: 'brick apartment building',
    buildingYear: 1925,
    city: 'Boston',
    windowFacing: 261.4,
    captureHour: 15,
  };
}

/** The same object with its keys in reverse order at every level. */
function reversedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reversedKeys) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).reverse()) out[k] = reversedKeys((value as Record<string, unknown>)[k]);
    return out as T;
  }
  return value;
}

/** Positions of the given fragments in the text, asserting each is present. */
function positions(text: string, fragments: string[]): number[] {
  return fragments.map((f) => {
    const i = text.indexOf(f);
    expect(i, `expected the prompt to contain ${JSON.stringify(f)}`).toBeGreaterThanOrEqual(0);
    return i;
  });
}

describe('compileMarblePrompt', () => {
  it('says only what it knows: the images sentence and the constraints for a bare room', () => {
    expect(compileMarblePrompt({ roomType: 'kitchen', imageCount: 1 })).toBe(`1 photograph of one real kitchen. ${PROMPT_CONSTRAINTS}`);
  });

  it('renders every known fact, in the fixed order, with the fixed phrasing', () => {
    const text = compileMarblePrompt(fullFacts());
    expect(text).toBe(PINNED_FULL_PROMPT);
    const at = positions(text, [
      '3 photographs of one real, empty living room, taken from the doorway.',
      'The room measures 3.8 m by 4.6 m (12 ft 4 in by 15 ft 1 in) on the floor plan.',
      'Ceiling height 2.4 m (8 ft).',
      'Door on the south wall, 1.2 m from its west end.',
      'Windows on the north wall, 0.9 m from its west end; the east wall, 2.0 m from its north end.',
      '1 door, 0.9 m wide and 2.0 m high, swinging inward.',
      '2 windows: 1.4 m wide and 1.2 m high, sill at 0.9 m; 0.8 m wide and 1.2 m high, sill at 0.9 m.',
      'Flooring: oak.',
      'Walls: white.',
      'Trim: white.',
      'Fixtures: radiator under the window, pendant light.',
      'Listing notes: renovated 2021.',
      'On the 3rd floor of a 1920s brick apartment building in Boston.',
      'The windows face west.',
      'Photographed in the afternoon.',
      PROMPT_CONSTRAINTS,
    ]);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
  });

  it('is identical for identical facts, whatever the key order', () => {
    expect(compileMarblePrompt(fullFacts())).toBe(compileMarblePrompt(fullFacts()));
    expect(compileMarblePrompt(reversedKeys(fullFacts()))).toBe(compileMarblePrompt(fullFacts()));
  });

  it('omits unknown or invalid facts rather than guessing', () => {
    const text = compileMarblePrompt({
      roomType: 'bedroom',
      imageCount: 2,
      widthM: 3.5, // no depth: no dimensions sentence
      ceilingHeightM: -1,
      doors: [],
      windows: [{ wall: 'up' as never, offset: 1 }], // a real window on an unknown wall: counted, never placed
      flooring: '   ',
      walls: '',
      fixtures: ['', '  \n '],
      notes: [],
      floorLevel: 2.5,
      buildingYear: 12,
      city: '...',
      windowFacing: NaN,
      captureHour: 24,
    });
    expect(text).toBe(`2 photographs of one real bedroom. 1 window. ${PROMPT_CONSTRAINTS}`);
    expect(compileMarblePrompt({ roomType: 'bedroom', imageCount: 2, doors: [], windows: [] })).toBe(`2 photographs of one real bedroom. ${PROMPT_CONSTRAINTS}`);
  });

  it('formats metres to one decimal and feet to the inch, and never prints -0', () => {
    const text = compileMarblePrompt({ roomType: 'other', imageCount: 1, widthM: 2.4384, depthM: 3.048, ceilingHeightM: 2.999, doors: [{ wall: 'west', offset: -0.001 }] });
    expect(text).toContain('The room measures 2.4 m by 3.0 m (8 ft by 10 ft) on the floor plan.');
    expect(text).toContain('Ceiling height 3.0 m (9 ft 10 in).');
    expect(text).not.toContain('-0');
    expect(text).toContain('Door on the west wall.');
  });

  it('names the wall start the engine frame uses: west end for north/south walls, north end for east/west', () => {
    const text = compileMarblePrompt({
      roomType: 'hallway',
      imageCount: 1,
      doors: [
        { wall: 'north', offset: 0.5 },
        { wall: 'east', offset: 1.5 },
      ],
    });
    expect(text).toContain('Doors on the north wall, 0.5 m from its west end; the east wall, 1.5 m from its north end.');
    expect(text).toContain('2 doors.');
  });

  it('describes the photographer, the room state and partial opening details', () => {
    const text = compileMarblePrompt({
      roomType: 'studio',
      imageCount: 1,
      empty: false,
      capturedFrom: 'corner',
      doors: [{ width: 0.8 }, { height: 2.1, swing: 'outward' }],
      windows: [{ sill: 1 }],
    });
    expect(text.startsWith('1 photograph of one real, furnished studio apartment, taken from a corner.')).toBe(true);
    expect(text).toContain('2 doors: 0.8 m wide; 2.1 m high, swinging outward.');
    expect(text).toContain('1 window, sill at 1.0 m.');
    expect(text).not.toContain('Door on');
  });

  it('buckets the capture hour and the window bearing deterministically', () => {
    const at = (captureHour: number) => compileMarblePrompt({ roomType: 'other', imageCount: 1, captureHour });
    expect(at(8)).toContain('Photographed in the morning.');
    expect(at(12.75)).toContain('Photographed at midday.');
    expect(at(15)).toContain('Photographed in the afternoon.');
    expect(at(19)).toContain('Photographed in the evening.');
    expect(at(23)).toContain('Photographed at night.');
    expect(at(2)).toContain('Photographed at night.');
    const facing = (windowFacing: number) => compileMarblePrompt({ roomType: 'other', imageCount: 1, windowFacing });
    expect(facing(0)).toContain('The windows face north.');
    expect(facing(44)).toContain('The windows face north-east.');
    expect(facing(261.4)).toContain('The windows face west.');
    expect(facing(359)).toContain('The windows face north.');
    expect(facing(-90)).toContain('The windows face west.');
  });

  it('words the floor level, the building and the city as one sentence', () => {
    const ctx = (f: Partial<PromptFacts>) => compileMarblePrompt({ roomType: 'other', imageCount: 1, ...f });
    expect(ctx({ floorLevel: 0 })).toContain('On the ground floor.');
    expect(ctx({ floorLevel: 1 })).toContain('On the 1st floor.');
    expect(ctx({ floorLevel: 2 })).toContain('On the 2nd floor.');
    expect(ctx({ floorLevel: 11 })).toContain('On the 11th floor.');
    expect(ctx({ floorLevel: 13 })).toContain('On the 13th floor.');
    expect(ctx({ floorLevel: 22 })).toContain('On the 22nd floor.');
    expect(ctx({ floorLevel: -1 })).toContain('Below ground.');
    expect(ctx({ city: 'Boston' })).toContain('In Boston.');
    expect(ctx({ buildingType: 'apartment building' })).toContain('In an apartment building.');
    expect(ctx({ buildingYear: 1885 })).toContain('In an 1880s building.');
    expect(ctx({ buildingYear: 1925, buildingType: 'house' })).toContain('In a 1920s house.');
    expect(ctx({ floorLevel: 4, city: 'Austin' })).toContain('On the 4th floor in Austin.');
    expect(ctx({ floorLevel: 4, buildingType: 'tower', city: 'Austin' })).toContain('On the 4th floor of a tower in Austin.');
  });

  it('cleans free text: whitespace, control characters, trailing punctuation, length and count', () => {
    const text = compileMarblePrompt({
      roomType: 'other',
      imageCount: 1,
      flooring: '  wide\tplank\n oak.. ',
      fixtures: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      notes: ['x'.repeat(200), 'two;', 'three', 'four', 'five'],
    });
    expect(text).toContain('Flooring: wide plank oak.');
    expect(text).toContain('Fixtures: a, b, c, d, e, f.');
    expect(text).toContain(`Listing notes: ${'x'.repeat(80)}; two; three; four.`);
    expect(text).not.toContain('five');
  });

  it('rejects an image count that is not a positive integer', () => {
    expect(() => compileMarblePrompt({ roomType: 'other', imageCount: 0 })).toThrow(/imageCount/);
    expect(() => compileMarblePrompt({ roomType: 'other', imageCount: 1.5 })).toThrow(/imageCount/);
    expect(() => compileMarblePrompt({ roomType: 'other', imageCount: NaN })).toThrow(/imageCount/);
  });

  describe('the cap', () => {
    const heavyFinishes = (noteChars: number, fixtureChars: number): Partial<PromptFacts> => ({
      flooring: 'wide plank white oak',
      walls: 'warm white',
      trim: 'bright white',
      fixtures: ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => c.repeat(fixtureChars)),
      notes: ['w', 'x', 'y', 'z'].map((c) => c.repeat(noteChars)),
    });

    it('drops the context first and keeps the finishes when that is enough', () => {
      // Sized so that the full text overflows (1221 chars) and the text without context fits (1103).
      const facts: PromptFacts = { ...fullFacts(), ...heavyFinishes(80, 10) };
      const untrimmed = compileMarblePrompt({ ...facts, floorLevel: undefined, buildingType: undefined, buildingYear: undefined, city: undefined, windowFacing: undefined, captureHour: undefined });
      expect(untrimmed.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
      expect(untrimmed).toContain('Listing notes:');
      const text = compileMarblePrompt(facts);
      expect(text.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
      expect(text).toBe(untrimmed);
      expect(text).not.toContain('Boston');
      expect(text).toContain('Listing notes:');
      expect(text).toContain('1 door, 0.9 m wide');
      expect(text).toContain('The room measures 3.8 m by 4.6 m');
      expect(text.endsWith(PROMPT_CONSTRAINTS)).toBe(true);
    });

    it('drops the finishes next and keeps the openings', () => {
      const text = compileMarblePrompt({ ...fullFacts(), ...heavyFinishes(80, 80) });
      expect(text.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
      expect(text).not.toContain('Boston');
      expect(text).not.toContain('Flooring:');
      expect(text).toContain('1 door, 0.9 m wide');
      expect(text).toContain('The room measures 3.8 m by 4.6 m');
      expect(text.endsWith(PROMPT_CONSTRAINTS)).toBe(true);
    });

    it('drops the openings last and never the geometry or the constraints', () => {
      const windows = Array.from({ length: 12 }, (_, i) => ({ wall: (['north', 'east', 'south', 'west'] as const)[i % 4], offset: i * 0.5, width: 1.2, height: 1.4, sill: 0.8 }));
      const text = compileMarblePrompt({ ...fullFacts(), ...heavyFinishes(80, 80), windows });
      expect(text).not.toContain('Boston');
      expect(text).not.toContain('Flooring:');
      expect(text).not.toContain('12 windows:');
      expect(text).toContain('Windows on the north wall, 0.0 m from its west end;');
      expect(text).toContain('The room measures 3.8 m by 4.6 m');
      expect(text.endsWith(PROMPT_CONSTRAINTS)).toBe(true);
      // Geometry and constraints are never trimmed, even when they alone pass the cap.
      expect(text.length).toBeGreaterThan(PROMPT_MAX_CHARS - 400);
    });
  });
});

/** Pinned so a change of phrasing is a deliberate one: it changes every recipe hash. */
const PINNED_FULL_PROMPT =
  '3 photographs of one real, empty living room, taken from the doorway. The room measures 3.8 m by 4.6 m (12 ft 4 in by 15 ft 1 in) on the floor plan. Ceiling height 2.4 m (8 ft). Door on the south wall, 1.2 m from its west end. Windows on the north wall, 0.9 m from its west end; the east wall, 2.0 m from its north end. 1 door, 0.9 m wide and 2.0 m high, swinging inward. 2 windows: 1.4 m wide and 1.2 m high, sill at 0.9 m; 0.8 m wide and 1.2 m high, sill at 0.9 m. Flooring: oak. Walls: white. Trim: white. Fixtures: radiator under the window, pendant light. Listing notes: renovated 2021. On the 3rd floor of a 1920s brick apartment building in Boston. The windows face west. Photographed in the afternoon. The same room in every image; keep the real geometry; do not add furniture, people or extra rooms; walls, floor and ceiling as photographed.';
