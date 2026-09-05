// Audora reference data. Every dimension is in METRES.
//
// HONESTY NOTE: these are reference dimensions for common furniture classes,
// not verified retail SKUs. The Linkup research pass (global week) replaces
// this table with per-SKU dimensions verified against retailer sources, plus
// live purchase links. Nothing here is scraped and nothing is a price quote.

export const CATALOG = [
  { id: 'sofa3',    name: '3-seat sofa',    w: 2.20, d: 0.95, h: 0.85, color: '#7c6cf0' },
  { id: 'sofa2',    name: '2-seat sofa',    w: 1.75, d: 0.90, h: 0.85, color: '#8b7bf5' },
  { id: 'armchair', name: 'Armchair',       w: 0.80, d: 0.85, h: 1.00, color: '#9a8cf7' },
  { id: 'coffee',   name: 'Coffee table',   w: 1.20, d: 0.60, h: 0.45, color: '#c9a227' },
  { id: 'dining',   name: 'Dining table',   w: 1.40, d: 0.80, h: 0.75, color: '#d4af37' },
  { id: 'chair',    name: 'Dining chair',   w: 0.45, d: 0.50, h: 0.90, color: '#b8962e' },
  { id: 'bedq',     name: 'Queen bed',      w: 2.10, d: 1.55, h: 0.55, color: '#5f8bd8' },
  { id: 'bedk',     name: 'King bed',       w: 2.10, d: 1.90, h: 0.55, color: '#4f7bc8' },
  { id: 'night',    name: 'Nightstand',     w: 0.45, d: 0.40, h: 0.55, color: '#6f9be8' },
  { id: 'shelf',    name: 'Bookcase',       w: 0.80, d: 0.30, h: 2.02, color: '#cf7a4a' },
  { id: 'wardrobe', name: 'Wardrobe',       w: 1.50, d: 0.60, h: 2.10, color: '#bf6a3a' },
  { id: 'desk',     name: 'Desk',           w: 1.20, d: 0.60, h: 0.74, color: '#df8a5a' },
  { id: 'tvunit',   name: 'TV unit',        w: 1.60, d: 0.40, h: 0.50, color: '#54c2a8' },
  { id: 'rug',      name: 'Rug',            w: 2.30, d: 1.60, h: 0.02, color: '#3f9d88' },
  { id: 'lamp',     name: 'Floor lamp',     w: 0.35, d: 0.35, h: 1.60, color: '#e8d48a' },
]

export const DEMO_ROOMS = [
  { id: 'studio',  name: 'Studio',            w: 4.2, d: 3.4, h: 2.60 },
  { id: 'living',  name: 'Living room',       w: 5.5, d: 4.0, h: 2.70 },
  { id: 'bedroom', name: 'Master bedroom',    w: 4.6, d: 4.0, h: 2.60 },
]

// Known real-world objects used to recover metric scale from a photo.
// Monocular reconstruction is scale-free; one of these anchors it.
export const SCALE_REFS = [
  { id: 'door_h',   name: 'Interior door height', metres: 2.03 },
  { id: 'door_w',   name: 'Interior door width',  metres: 0.81 },
  { id: 'ceiling8', name: 'Ceiling (8 ft)',       metres: 2.44 },
  { id: 'outlet',   name: 'Outlet centre height', metres: 0.30 },
]

export const buyLink = (name) =>
  'https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(name)

export const cm = (m) => Math.round(m * 100)
