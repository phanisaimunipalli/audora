import { useMemo, useRef, useState, type SVGProps } from 'react';
import type { CatalogCategory, CatalogItem, ProceduralKind, RoomType } from '@/engine/types';
import { CATALOG, CATEGORY_LABELS, catalogFor } from '@/engine/catalog';
import { Chip, Input, Segmented, cx } from './ui';

export interface CatalogRailProps {
  roomType: RoomType;
  onAdd: (item: CatalogItem) => void;
  /** Optional: start a drag-to-place gesture instead of a click-to-add. */
  onDragStart?: (item: CatalogItem) => void;
  /** Highlight the item currently being placed. */
  activeId?: string | null;
  /** Start with the whole catalog rather than the room-type subset. */
  defaultAll?: boolean;
  className?: string;
}

/* ---------- kind glyphs ---------- */

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' });

const GLYPH_PATHS: Record<ProceduralKind, string> = {
  sofa: 'M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z',
  sectional: 'M3 6h11v6h7v7H3zM3 12h11M14 12v7',
  armchair: 'M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M4 13a2 2 0 0 1 4 0v1h8v-1a2 2 0 0 1 4 0v6H4z',
  coffeeTable: 'M3 10h18M5 10v7M19 10v7M8 14h8',
  sideTable: 'M6 8h12M8 8v10M16 8v10M8 14h8',
  tvUnit: 'M4 17h16v3H4zM6 4h12v10H6zM10 14v3M14 14v3',
  rug: 'M4 6h16v12H4zM7 9h10v6H7z',
  floorLamp: 'M8 4h8l2 6H6zM12 10v9M8 19h8',
  plant: 'M9 14h6l-1 6h-4zM12 14V8M12 8c-3 0-5-2-5-4 3 0 5 1 5 4zM12 8c3 0 5-2 5-4-3 0-5 1-5 4z',
  bookshelf: 'M5 3h14v18H5zM5 9h14M5 15h14M8 4v5M11 4v5M15 10v5',
  diningSet: 'M3 10h18M12 10v8M5 15v-3M19 15v-3M3 18h4M17 18h4',
  bed: 'M3 18v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8M3 14h18M6 8V5h12v3M9 8V6h6v2',
  nightstand: 'M6 8h12v11H6zM6 13h12M11 10.5h2',
  dresser: 'M4 6h16v13H4zM4 10.3h16M4 14.6h16M11 8.2h2M11 12.5h2M11 16.8h2',
  wardrobe: 'M5 3h14v18H5zM12 3v18M10 11v2M14 11v2',
  desk: 'M3 8h18M5 8v10M19 8v10M13 8v6h6',
  officeChair: 'M8 4h8v7H8zM8 11h8l1 3H7zM12 14v4M9 20l3-2 3 2',
  box: 'M4 6h16v12H4zM4 10h16',
};

/** Line glyph for a procedural kind; used by the catalog cards and the inspector. */
export function KindGlyph({ kind, size, ...p }: P & { kind: ProceduralKind }) {
  return (
    <svg {...base(size)} {...p}>
      <path d={GLYPH_PATHS[kind] ?? GLYPH_PATHS.box} />
    </svg>
  );
}

/** "220 × 95 × 85 cm", or "240 × 170 cm" for flat pieces. */
function itemDims(item: Pick<CatalogItem, 'w' | 'd' | 'h' | 'flat'>): string {
  const w = Math.round(item.w * 100);
  const d = Math.round(item.d * 100);
  return item.flat ? `${w} × ${d} cm` : `${w} × ${d} × ${Math.round(item.h * 100)} cm`;
}

const ROOM_LABEL: Record<RoomType, string> = {
  living: 'living room',
  bedroom: 'bedroom',
  kitchen: 'kitchen',
  dining: 'dining room',
  bathroom: 'bathroom',
  office: 'office',
  hallway: 'hallway',
  studio: 'studio',
  other: 'this room',
};

const CATEGORY_ORDER: CatalogCategory[] = ['seating', 'tables', 'storage', 'bedroom', 'office', 'decor'];
const DRAG_PX = 6;

function CatalogCard({ item, active, onAdd, onDragStart }: { item: CatalogItem; active: boolean; onAdd: () => void; onDragStart?: () => void }) {
  const press = useRef<{ x: number; y: number; id: number; dragging: boolean } | null>(null);
  return (
    <button
      type="button"
      title={item.source}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        press.current = { x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.dragging || !onDragStart || p.id !== e.pointerId) return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return;
        p.dragging = true;
        // Hand the pointer over so the canvas floor gets the moves (touch captures implicitly).
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* not captured */
        }
        onDragStart();
      }}
      onPointerUp={() => {
        const p = press.current;
        press.current = null;
        if (p?.dragging) return;
      }}
      onPointerCancel={() => (press.current = null)}
      onClick={(e) => {
        const p = press.current;
        if (p?.dragging) {
          e.preventDefault();
          return;
        }
        onAdd();
      }}
      className={cx(
        'group flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors select-none',
        active ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:border-line-2 hover:bg-surface-2',
      )}
    >
      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', active ? 'border-accent/50 bg-accent/15 text-accent-2' : 'border-line-2 bg-surface-2 text-ink-2 group-hover:text-ink')}>
        <KindGlyph kind={item.kind} size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-ink" title={item.name}>{item.name}</span>
        <span className="mono text-[11px] text-ink-3">{itemDims(item)}</span>
      </span>
      <Chip tone={item.verified ? 'ok' : 'neutral'} className="!px-1.5 !py-0.5 !text-[10px] uppercase tracking-wider">
        {item.verified ? 'verified' : 'reference'}
      </Chip>
    </button>
  );
}

/**
 * The furniture catalog. Every card shows real dimensions in centimetres and whether they are a verified
 * SKU or reference dimensions for the category. Click to place (a ghost follows the pointer), or drag a
 * card onto the floor.
 */
export function CatalogRail({ roomType, onAdd, onDragStart, activeId, defaultAll = false, className }: CatalogRailProps) {
  const [scope, setScope] = useState<'room' | 'all'>(defaultAll ? 'all' : 'room');
  const [category, setCategory] = useState<CatalogCategory | 'all'>('all');
  const [q, setQ] = useState('');

  const pool = useMemo(() => (scope === 'all' ? CATALOG : catalogFor(roomType)), [scope, roomType]);
  const categories = useMemo(() => CATEGORY_ORDER.filter((c) => pool.some((i) => i.category === c)), [pool]);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((i) => (category === 'all' || i.category === category) && (!needle || i.name.toLowerCase().includes(needle) || i.kind.toLowerCase().includes(needle) || CATEGORY_LABELS[i.category].toLowerCase().includes(needle)));
  }, [pool, category, q]);

  return (
    <div className={cx('flex h-full min-h-0 flex-col', className)}>
      <div className="flex flex-col gap-2.5 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Catalog</div>
          <span className="mono text-[11px] text-ink-3">{items.length} pieces</span>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sofa, bed, desk…" className="!h-9 !text-[13px]" aria-label="Search the catalog" />
        <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: 'room', label: `For ${ROOM_LABEL[roomType]}` }, { value: 'all', label: 'All' }]} />
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]">
          <button type="button" onClick={() => setCategory('all')} className={cx('chip shrink-0 transition-colors', category === 'all' && 'border-accent/40 bg-accent/10 text-accent-2')}>
            All
          </button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(category === c ? 'all' : c)} className={cx('chip shrink-0 transition-colors', category === c && 'border-accent/40 bg-accent/10 text-accent-2')}>
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-ink-3">Nothing matches. Try “All” or a shorter search.</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <CatalogCard key={item.id} item={item} active={activeId === item.id} onAdd={() => onAdd(item)} onDragStart={onDragStart ? () => onDragStart(item) : undefined} />
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-line px-3 py-2 text-[11px] text-ink-3">Click a piece, then click the floor to place it. Or drag it straight onto the floor.</div>
    </div>
  );
}
