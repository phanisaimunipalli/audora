import { useState, type FormEvent } from 'react';
import type { MyStuffItem } from '@/state/types';
import type { ProceduralKind } from '@/engine/types';
import { guessKind, parseFurnitureText } from '@/engine/catalog';
import { useAudora, useMyStuff } from '@/state/store';
import { dimsLabel } from '@/lib/format';
import { Button, Field, IconButton, Input, Select, cx } from './ui';
import { Icon } from './icons';

export interface MyStuffPanelProps {
  onPick: (item: MyStuffItem) => void;
  compact?: boolean;
  className?: string;
  /** Label on each item's action button. */
  pickLabel?: string;
}

const BUYER_BLUE = '#62a0ff';

const KIND_OPTIONS: { value: ProceduralKind; label: string }[] = [
  { value: 'sofa', label: 'Sofa' },
  { value: 'sectional', label: 'Sectional' },
  { value: 'armchair', label: 'Armchair' },
  { value: 'bed', label: 'Bed' },
  { value: 'diningSet', label: 'Dining table' },
  { value: 'desk', label: 'Desk' },
  { value: 'coffeeTable', label: 'Coffee table' },
  { value: 'sideTable', label: 'Side table' },
  { value: 'tvUnit', label: 'TV unit' },
  { value: 'bookshelf', label: 'Bookshelf' },
  { value: 'dresser', label: 'Dresser' },
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'nightstand', label: 'Nightstand' },
  { value: 'officeChair', label: 'Office chair' },
  { value: 'rug', label: 'Rug' },
  { value: 'floorLamp', label: 'Floor lamp' },
  { value: 'plant', label: 'Plant' },
  { value: 'box', label: 'Other' },
];

const DEFAULT_H: Partial<Record<ProceduralKind, number>> = { sofa: 85, sectional: 85, armchair: 80, bed: 95, diningSet: 75, desk: 75, coffeeTable: 45, sideTable: 55, tvUnit: 50, bookshelf: 200, dresser: 85, wardrobe: 220, nightstand: 55, officeChair: 95, rug: 1, floorLamp: 160, plant: 140, box: 80 };

/** A small line glyph per furniture family, drawn on the item's colour swatch. */
export function KindGlyph({ kind, color = BUYER_BLUE, size = 30, className }: { kind: ProceduralKind; color?: string; size?: number; className?: string }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let path: React.ReactNode;
  switch (kind) {
    case 'sofa':
    case 'sectional':
    case 'armchair':
      path = <path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z" />;
      break;
    case 'bed':
      path = <path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 15h18M5 9V6h6v3M13 9V6h6v3" />;
      break;
    case 'diningSet':
    case 'desk':
    case 'coffeeTable':
    case 'sideTable':
      path = <path d="M3 9h18M6 9v9M18 9v9M9 13h6" />;
      break;
    case 'tvUnit':
    case 'bookshelf':
    case 'dresser':
    case 'wardrobe':
    case 'nightstand':
      path = <path d="M5 4h14v16H5zM5 10h14M5 15h14M11 7h2" />;
      break;
    case 'rug':
      path = <path d="M4 7h16v10H4zM7 10h10M7 14h10" />;
      break;
    case 'floorLamp':
      path = <path d="M9 4h6l2 6H7zM12 10v9M8 19h8" />;
      break;
    case 'plant':
      path = <path d="M8 21h8l1-6H7zM12 15V9M12 9c-3 0-5-2-5-5 3 0 5 2 5 5zM12 11c3 0 5-2 5-5-3 0-5 2-5 5z" />;
      break;
    case 'officeChair':
      path = <path d="M8 4h8v7H8zM6 11h12v3H6zM12 14v4M8 21h8" />;
      break;
    default:
      path = <path d="M4 8l8-4 8 4v8l-8 4-8-4zM12 12l8-4M12 12 4 8M12 12v8" />;
  }
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-lg', className)} style={{ width: size, height: size, background: `${color}22`, color: color }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" {...stroke}>
        {path}
      </svg>
    </span>
  );
}

interface Draft {
  name: string;
  kind: ProceduralKind;
  w: string;
  d: string;
  h: string;
  color: string;
}

const emptyDraft = (): Draft => ({ name: '', kind: 'sofa', w: '', d: '', h: '', color: BUYER_BLUE });

function draftFrom(it: MyStuffItem): Draft {
  return { name: it.name, kind: it.kind, w: String(Math.round(it.w * 100)), d: String(Math.round(it.d * 100)), h: String(Math.round(it.h * 100)), color: it.color };
}

function readDraft(d: Draft): Omit<MyStuffItem, 'id' | 'createdAt'> | null {
  const w = Number(d.w);
  const dd = Number(d.d);
  if (!d.name.trim() || !(w > 0) || !(dd > 0)) return null;
  const h = Number(d.h) > 0 ? Number(d.h) : DEFAULT_H[d.kind] ?? 80;
  return { name: d.name.trim(), kind: d.kind, w: w / 100, d: dd / 100, h: h / 100, color: d.color || BUYER_BLUE, flat: d.kind === 'rug' };
}

/**
 * The buyer's reusable furniture list. Persisted in the store, so every listing they open is
 * judged against the same sofa. Add by typing ("sofa 200 by 90") or with the W / D / H fields.
 */
export function MyStuffPanel({ onPick, compact, className, pickLabel = 'Test here' }: MyStuffPanelProps) {
  const items = useMyStuff();
  const addMyStuff = useAudora((s) => s.addMyStuff);
  const updateMyStuff = useAudora((s) => s.updateMyStuff);
  const removeMyStuff = useAudora((s) => s.removeMyStuff);

  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string | null>(null);
  const [showFields, setShowFields] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [armedRemove, setArmedRemove] = useState<string | null>(null);

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseFurnitureText(text);
    if (!parsed) {
      setTextError('Give it a name and two numbers, like "sofa 200 by 90".');
      return;
    }
    addMyStuff({ name: parsed.name, kind: parsed.kind, w: parsed.w, d: parsed.d, h: parsed.h, color: BUYER_BLUE, flat: parsed.flat });
    setText('');
    setTextError(null);
  };

  const submitFields = (e: FormEvent) => {
    e.preventDefault();
    const it = readDraft(draft);
    if (!it) return;
    addMyStuff(it);
    setDraft(emptyDraft());
    setShowFields(false);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const it = readDraft(editDraft);
    if (!it) return;
    updateMyStuff(editingId, it);
    setEditingId(null);
  };

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {!compact ? (
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium text-ink">My Stuff</div>
          <div className="mono text-[11px] text-ink-3">{items.length} piece{items.length === 1 ? '' : 's'}</div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-2 px-4 py-5 text-center">
          <div className="display text-lg text-ink">Measure your furniture once.</div>
          <p className="mt-1 text-xs text-ink-3">Every listing you visit is evaluated against it.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) =>
            editingId === it.id ? (
              <li key={it.id} className="rounded-xl border border-buyer/40 bg-buyer/5 p-3">
                <DraftFields draft={editDraft} onChange={setEditDraft} />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  <Button size="sm" variant="buyer" onClick={saveEdit} disabled={!readDraft(editDraft)}>Save</Button>
                </div>
              </li>
            ) : (
              <li key={it.id} className="group flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 px-2.5 py-2">
                <KindGlyph kind={it.kind} color={it.color} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{it.name}</div>
                  <div className="mono text-[11px] text-ink-3">{dimsLabel(it.w, it.d, it.flat ? undefined : it.h)}</div>
                </div>
                <span className="h-3 w-3 shrink-0 rounded-full border border-line-2" style={{ background: it.color }} title={it.color} />
                <Button size="sm" variant="buyer" onClick={() => onPick(it)} className="shrink-0">
                  {pickLabel}
                </Button>
                <IconButton
                  label="Edit"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    setEditingId(it.id);
                    setEditDraft(draftFrom(it));
                    setArmedRemove(null);
                  }}
                >
                  <Icon.Settings size={14} />
                </IconButton>
                <IconButton
                  label={armedRemove === it.id ? 'Click again to remove' : 'Remove'}
                  className={cx('h-8 w-8 shrink-0', armedRemove === it.id && '!border-danger/50 !text-danger')}
                  onClick={() => {
                    if (armedRemove === it.id) {
                      removeMyStuff(it.id);
                      setArmedRemove(null);
                    } else {
                      setArmedRemove(it.id);
                      window.setTimeout(() => setArmedRemove((a) => (a === it.id ? null : a)), 3000);
                    }
                  }}
                >
                  <Icon.Trash size={14} />
                </IconButton>
              </li>
            ),
          )}
        </ul>
      )}

      <form onSubmit={submitText} className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (textError) setTextError(null);
            }}
            placeholder='Add: "sofa 200 by 90"'
            aria-label="Add furniture by text"
          />
          <Button type="submit" variant="secondary" disabled={!text.trim()} className="shrink-0">
            <Icon.Plus size={14} /> Add
          </Button>
        </div>
        {textError ? <div className="text-xs text-danger">{textError}</div> : null}
        <button type="button" onClick={() => setShowFields((v) => !v)} className="self-start text-xs text-ink-3 hover:text-ink-2">
          {showFields ? 'Hide fields' : 'Or enter width, depth and height'}
        </button>
      </form>

      {showFields ? (
        <form onSubmit={submitFields} className="rounded-xl border border-line bg-surface-2/60 p-3">
          <DraftFields draft={draft} onChange={setDraft} />
          <div className="mt-2 flex justify-end">
            <Button type="submit" size="sm" variant="buyer" disabled={!readDraft(draft)}>
              Save to My Stuff
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function DraftFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr]">
      <Field label="Name" className="col-span-2 sm:col-span-1">
        <Input value={draft.name} onChange={(e) => set({ name: e.target.value, kind: draft.name ? draft.kind : guessKind(e.target.value) })} placeholder="Our grey sectional" />
      </Field>
      <Field label="Kind" className="col-span-2 sm:col-span-1">
        <Select value={draft.kind} onChange={(e) => set({ kind: e.target.value as ProceduralKind })}>
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </Select>
      </Field>
      <div className="col-span-2 grid grid-cols-4 gap-2">
        <Field label="W cm"><Input inputMode="numeric" value={draft.w} onChange={(e) => set({ w: e.target.value })} className="mono" placeholder="220" /></Field>
        <Field label="D cm"><Input inputMode="numeric" value={draft.d} onChange={(e) => set({ d: e.target.value })} className="mono" placeholder="95" /></Field>
        <Field label="H cm"><Input inputMode="numeric" value={draft.h} onChange={(e) => set({ h: e.target.value })} className="mono" placeholder="85" /></Field>
        <Field label="Colour"><Input type="color" value={draft.color} onChange={(e) => set({ color: e.target.value })} className="h-10 p-1" /></Field>
      </div>
    </div>
  );
}
