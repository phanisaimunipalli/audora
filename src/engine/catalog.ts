import type { CatalogItem, RoomType } from './types';

const cm = (n: number) => n / 100;
const REF = 'Reference dimensions for the category, not a specific product.';
const LIVING: RoomType[] = ['living', 'studio', 'other'];
const BED: RoomType[] = ['bedroom', 'studio'];
const DINING: RoomType[] = ['dining', 'kitchen', 'living', 'studio'];
const OFFICE: RoomType[] = ['office', 'bedroom', 'studio', 'living'];
const ANY: RoomType[] = ['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'studio', 'other'];

export const CATALOG: CatalogItem[] = [
  { id: 'sofa-3', name: '3-seat sofa', category: 'seating', kind: 'sofa', w: cm(220), d: cm(95), h: cm(85), roomTypes: LIVING, verified: false, source: REF, color: '#8d7b6a' },
  { id: 'sofa-2', name: 'Loveseat', category: 'seating', kind: 'sofa', w: cm(160), d: cm(90), h: cm(85), roomTypes: LIVING, verified: false, source: REF, color: '#7f8a7a' },
  { id: 'sectional', name: 'L-sectional', category: 'seating', kind: 'sectional', w: cm(280), d: cm(200), h: cm(85), roomTypes: LIVING, verified: false, source: `${REF} Footprint is the bounding box of the L.`, color: '#6f6a78' },
  { id: 'armchair', name: 'Armchair', category: 'seating', kind: 'armchair', w: cm(85), d: cm(90), h: cm(80), roomTypes: [...LIVING, 'bedroom', 'office'], verified: false, source: REF, color: '#a3684d' },
  { id: 'coffee', name: 'Coffee table', category: 'tables', kind: 'coffeeTable', w: cm(120), d: cm(60), h: cm(45), roomTypes: LIVING, verified: false, source: REF, color: '#4c3b2f' },
  { id: 'side', name: 'Side table', category: 'tables', kind: 'sideTable', w: cm(50), d: cm(50), h: cm(55), roomTypes: [...LIVING, 'bedroom'], verified: false, source: REF, color: '#4c3b2f' },
  { id: 'tv', name: 'TV console + 65" TV', category: 'storage', kind: 'tvUnit', w: cm(180), d: cm(45), h: cm(50), roomTypes: LIVING, verified: false, source: REF, color: '#2d2a28' },
  { id: 'rug-l', name: 'Rug 240×170', category: 'decor', kind: 'rug', w: cm(240), d: cm(170), h: cm(1), roomTypes: ANY, flat: true, verified: true, source: 'Standard rug size.', color: '#b59a7a' },
  { id: 'rug-m', name: 'Rug 200×140', category: 'decor', kind: 'rug', w: cm(200), d: cm(140), h: cm(1), roomTypes: ANY, flat: true, verified: true, source: 'Standard rug size.', color: '#9a8b8b' },
  { id: 'lamp', name: 'Floor lamp', category: 'decor', kind: 'floorLamp', w: cm(35), d: cm(35), h: cm(160), roomTypes: ANY, verified: false, source: REF, color: '#d9c7a3' },
  { id: 'plant', name: 'Large plant', category: 'decor', kind: 'plant', w: cm(45), d: cm(45), h: cm(140), roomTypes: ANY, verified: false, source: REF, color: '#4f7a4a' },
  { id: 'shelf', name: 'Bookshelf', category: 'storage', kind: 'bookshelf', w: cm(80), d: cm(30), h: cm(200), roomTypes: [...LIVING, 'office', 'bedroom'], verified: false, source: REF, color: '#5a4636' },
  { id: 'dining-6', name: 'Dining table for 6', category: 'tables', kind: 'diningSet', w: cm(200), d: cm(190), h: cm(75), roomTypes: DINING, verified: false, source: `${REF} Footprint includes chairs pulled in.`, color: '#5b4a3a' },
  { id: 'dining-4', name: 'Dining table for 4', category: 'tables', kind: 'diningSet', w: cm(140), d: cm(170), h: cm(75), roomTypes: DINING, verified: false, source: `${REF} Footprint includes chairs pulled in.`, color: '#5b4a3a' },
  { id: 'dining-2', name: 'Dining table for 2', category: 'tables', kind: 'diningSet', w: cm(80), d: cm(150), h: cm(75), roomTypes: DINING, verified: false, source: `${REF} Footprint includes two chairs pulled in.`, color: '#5b4a3a' },
  { id: 'bed-queen', name: 'Queen bed', category: 'bedroom', kind: 'bed', w: cm(160), d: cm(210), h: cm(95), roomTypes: BED, verified: true, source: 'Queen mattress 152×203cm plus a slim frame and headboard.', color: '#c9bfae' },
  { id: 'bed-king', name: 'King bed', category: 'bedroom', kind: 'bed', w: cm(193), d: cm(213), h: cm(95), roomTypes: BED, verified: true, source: 'King mattress 193×203cm plus a slim frame and headboard.', color: '#c9bfae' },
  { id: 'bed-double', name: 'Double bed', category: 'bedroom', kind: 'bed', w: cm(140), d: cm(200), h: cm(90), roomTypes: BED, verified: true, source: 'Double mattress 137×190cm plus a slim frame.', color: '#c9bfae' },
  { id: 'nightstand', name: 'Nightstand', category: 'bedroom', kind: 'nightstand', w: cm(50), d: cm(40), h: cm(55), roomTypes: BED, verified: false, source: REF, color: '#5a4636' },
  { id: 'dresser', name: 'Dresser', category: 'bedroom', kind: 'dresser', w: cm(150), d: cm(50), h: cm(85), roomTypes: [...BED, 'dining', 'hallway'], verified: false, source: REF, color: '#6e5847' },
  { id: 'wardrobe', name: 'Wardrobe', category: 'storage', kind: 'wardrobe', w: cm(200), d: cm(60), h: cm(220), roomTypes: BED, verified: false, source: REF, color: '#e6e1d8' },
  { id: 'desk', name: 'Desk', category: 'office', kind: 'desk', w: cm(140), d: cm(70), h: cm(75), roomTypes: OFFICE, verified: false, source: REF, color: '#8a6e55' },
  { id: 'office-chair', name: 'Office chair', category: 'office', kind: 'officeChair', w: cm(65), d: cm(65), h: cm(95), roomTypes: OFFICE, verified: false, source: REF, color: '#2b2b2e' },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((c) => c.id === id);
}

export function catalogFor(roomType: RoomType): CatalogItem[] {
  return CATALOG.filter((c) => c.roomTypes.includes(roomType));
}

export const CATEGORY_LABELS: Record<CatalogItem['category'], string> = {
  seating: 'Seating',
  tables: 'Tables',
  storage: 'Storage',
  bedroom: 'Bedroom',
  office: 'Office',
  decor: 'Decor',
};

/** Guess a procedural kind for a renter-typed piece like "sectional 220 by 95". */
export function guessKind(name: string): CatalogItem['kind'] {
  const n = name.toLowerCase();
  if (/sectional|l-shape|chaise/.test(n)) return 'sectional';
  if (/sofa|couch|loveseat|settee/.test(n)) return 'sofa';
  if (/armchair|chair|recliner/.test(n) && !/office|desk/.test(n)) return 'armchair';
  if (/office|desk chair/.test(n) && /chair/.test(n)) return 'officeChair';
  if (/coffee/.test(n)) return 'coffeeTable';
  if (/side|end table|lamp table/.test(n)) return 'sideTable';
  if (/dining|table/.test(n)) return 'diningSet';
  if (/tv|console|media/.test(n)) return 'tvUnit';
  if (/rug|carpet/.test(n)) return 'rug';
  if (/lamp/.test(n)) return 'floorLamp';
  if (/plant|tree|fiddle/.test(n)) return 'plant';
  if (/shelf|bookcase|shelving/.test(n)) return 'bookshelf';
  if (/bed|mattress/.test(n)) return 'bed';
  if (/nightstand|bedside/.test(n)) return 'nightstand';
  if (/dresser|chest|sideboard|credenza/.test(n)) return 'dresser';
  if (/wardrobe|armoire|closet/.test(n)) return 'wardrobe';
  if (/desk/.test(n)) return 'desk';
  return 'box';
}

/**
 * Parse free text like "sectional, 220 by 95", "queen bed 160x210x95", "table 1.4m x 0.8m".
 * Returns metres. Height is optional and falls back to a sensible default for the kind.
 */
export function parseFurnitureText(text: string): { name: string; w: number; d: number; h: number; kind: CatalogItem['kind']; flat: boolean } | null {
  const t = text.trim();
  const nums = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(m|cm|mm|in|ft|")?/gi)].map((m) => {
    const v = parseFloat(m[1].replace(',', '.'));
    const unit = (m[2] || '').toLowerCase();
    if (unit === 'm') return v;
    if (unit === 'mm') return v / 1000;
    if (unit === 'in' || unit === '"') return v * 0.0254;
    if (unit === 'ft') return v * 0.3048;
    if (unit === 'cm') return v / 100;
    // no unit: values under 10 are metres, otherwise centimetres
    return v < 10 ? v : v / 100;
  });
  if (nums.length < 2) return null;
  // Strip the numbers (with their units) first, then the separators and connectors, so "sectional, 220 by 95"
  // reads "sectional" rather than gluing the comma's neighbours into "sectionalby".
  const name =
    t
      .replace(/\d+(?:[.,]\d+)?\s*(m|cm|mm|in|ft|")?/gi, ' ')
      .replace(/[,;:()×]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !/^(by|x|and|of|about|roughly|around|approx|is|it's|its|my|our|a|an|the)$/i.test(w))
      .join(' ')
      .trim() || 'My piece';
  const kind = guessKind(name);
  const defaults: Record<string, number> = { sofa: 0.85, sectional: 0.85, armchair: 0.8, coffeeTable: 0.45, sideTable: 0.55, diningSet: 0.75, tvUnit: 0.5, rug: 0.01, floorLamp: 1.6, plant: 1.4, bookshelf: 2, bed: 0.95, nightstand: 0.55, dresser: 0.85, wardrobe: 2.2, desk: 0.75, officeChair: 0.95, box: 0.8 };
  return { name: name.charAt(0).toUpperCase() + name.slice(1), w: nums[0], d: nums[1], h: nums[2] ?? defaults[kind] ?? 0.8, kind, flat: kind === 'rug' };
}
