import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { BuyerVerdict, CatalogItem, PlacedPiece, ProceduralKind } from '@/engine/types';
import type { MyStuffItem, Room } from '@/state/types';
import { makePiece } from '@/engine/autostage';
import { buyerVerdict } from '@/engine/fit';
import { clampToRoom, snapRotation } from '@/engine/geometry';
import { parseFurniture, type AiMeta } from '@/services/ai';
import { useAudora, useMyStuff } from '@/state/store';
import type { Pose, ViewMode } from '@/three/viewerStore';
import { dimsLabel } from '@/lib/format';
import { dropFootprint } from '@/screens/viewer/dropPoint';
import { trackEvent } from '@/screens/viewer/analytics';
import { useMediaQuery } from '@/screens/editor/useMediaQuery';
import { AnchorChip } from './AnchorChip';
import { MyStuffPanel } from './MyStuffPanel';
import { Button, Chip, IconButton, Input, Segmented, cx } from './ui';
import { Icon } from './icons';

export interface FurnitureTestProps {
  room: Room;
  /** Buyer pieces currently in the room (controlled by the viewer). */
  buyerPieces: PlacedPiece[];
  onChange: (pieces: PlacedPiece[]) => void;
  onClose?: () => void;
  /** Seller pieces to judge against. Defaults to the room's staging; pass [] when the buyer hides it. */
  staging?: PlacedPiece[];
  /** Where the buyer stands right now; new pieces land 1.2 m ahead. */
  pose?: Pose;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Record test / fit / nofit events (buyer mode). */
  analytics?: boolean;
  /**
   * When provided, a Walk / Dollhouse switch is shown in the panel *on phones only* — there the panel is a
   * bottom sheet that covers the viewer's own bar. On wider screens the panel sits beside the bar, so
   * repeating the control there would be a duplicate.
   */
  mode?: ViewMode;
  onModeChange?: (mode: ViewMode) => void;
  className?: string;
}

const BUYER_BLUE = '#62a0ff';
const NUDGE = 0.1;

/** "Living room" → "the living room"; "Bedroom 2" → "the bedroom 2"; leaves a name that already reads as a phrase alone. */
export function roomPhrase(name: string): string {
  const n = name.trim().toLowerCase();
  if (!n) return 'this room';
  return /^(the|a|an|my|your|our)\b/.test(n) ? n : `the ${n}`;
}

function categoryFor(kind: ProceduralKind): CatalogItem['category'] {
  if (kind === 'bed' || kind === 'nightstand' || kind === 'dresser') return 'bedroom';
  if (kind === 'desk' || kind === 'officeChair') return 'office';
  if (kind === 'coffeeTable' || kind === 'sideTable' || kind === 'diningSet') return 'tables';
  if (kind === 'tvUnit' || kind === 'bookshelf' || kind === 'wardrobe') return 'storage';
  if (kind === 'rug' || kind === 'floorLamp' || kind === 'plant') return 'decor';
  return 'seating';
}

interface Spec {
  name: string;
  kind: ProceduralKind;
  w: number;
  d: number;
  h: number;
  flat: boolean;
}

/**
 * "Test my own furniture". Type a piece ("sectional, 220 by 95") or pick one from My Stuff; it lands
 * in blue in front of the buyer and the verdict updates live as the piece moves.
 */
export function FurnitureTest({ room, buyerPieces, onChange, onClose, staging, pose, selectedId, onSelect, analytics = true, mode, onModeChange, className }: FurnitureTestProps) {
  const seller = staging ?? room.staging;
  const myStuff = useMyStuff();
  const addMyStuff = useAudora((s) => s.addMyStuff);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [lastMeta, setLastMeta] = useState<AiMeta | null>(null);
  const [showStuff, setShowStuff] = useState(buyerPieces.length === 0 && myStuff.length > 0);
  // Below `md` the panel is a bottom sheet over the viewer's bar, so it carries its own Walk / Dollhouse switch.
  const sheetLayout = useMediaQuery('(max-width: 767px)');

  // The parse read-out belongs to the piece that was just typed; a new room starts clean.
  useEffect(() => {
    setLastMeta(null);
    setError(null);
    setText('');
  }, [room.id]);

  const verdicts = useMemo(() => {
    const m = new Map<string, BuyerVerdict>();
    for (const p of buyerPieces) m.set(p.id, buyerVerdict(p, seller, room.geometry));
    return m;
  }, [buyerPieces, seller, room.geometry]);

  // Track the outcome once at drop time, and again when a moved piece's verdict settles on a new answer.
  const lastOutcome = useRef<Record<string, boolean>>({});
  const flipKey = buyerPieces.map((p) => `${p.id}:${verdicts.get(p.id)?.fits ? 1 : 0}`).join('|');
  useEffect(() => {
    if (!analytics) return;
    const timers: number[] = [];
    for (const p of buyerPieces) {
      const fits = verdicts.get(p.id)?.fits;
      if (fits === undefined) continue;
      const prev = lastOutcome.current[p.id];
      if (prev === undefined || prev === fits) continue;
      timers.push(
        window.setTimeout(() => {
          lastOutcome.current[p.id] = fits;
          trackEvent(room.tourId, fits ? 'fit' : 'nofit', { roomId: room.id, item: p.name });
        }, 1200),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipKey, analytics]);

  const drop = (spec: Spec) => {
    const item: CatalogItem = {
      id: 'custom',
      name: spec.name,
      category: categoryFor(spec.kind),
      kind: spec.kind,
      w: spec.w,
      d: spec.d,
      h: spec.h,
      roomTypes: [],
      flat: spec.flat,
      verified: false,
      source: 'Dimensions entered by the buyer.',
      color: BUYER_BLUE,
    };
    const f = dropFootprint(room.geometry, spec.w, spec.d, pose, [...seller, ...buyerPieces]);
    const piece = makePiece(item, f.x, f.z, f.rot, 'buyer');
    const next = [...buyerPieces, piece];
    onChange(next);
    onSelect?.(piece.id);
    const v = buyerVerdict(piece, seller, room.geometry);
    lastOutcome.current[piece.id] = v.fits;
    if (analytics) {
      trackEvent(room.tourId, 'test', { roomId: room.id, item: spec.name });
      trackEvent(room.tourId, v.fits ? 'fit' : 'nofit', { roomId: room.id, item: spec.name });
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseFurniture(t);
      if (!parsed || !(parsed.w > 0) || !(parsed.d > 0)) {
        setError('Give it a name and two numbers, like "sectional, 220 by 95". Centimetres unless you say otherwise.');
        return;
      }
      setLastMeta(parsed.meta);
      drop({ name: parsed.name, kind: parsed.kind, w: parsed.w, d: parsed.d, h: parsed.h, flat: parsed.flat });
      setText('');
    } finally {
      setParsing(false);
    }
  };

  const update = (id: string, patch: Partial<PlacedPiece>) => onChange(buyerPieces.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const nudge = (p: PlacedPiece, dx: number, dz: number) => {
    const f = clampToRoom({ x: p.x + dx, z: p.z + dz, w: p.w, d: p.d, rot: p.rot }, room.geometry);
    update(p.id, { x: f.x, z: f.z });
  };
  const rotate = (p: PlacedPiece) => {
    const rot = snapRotation(p.rot + Math.PI / 2, Math.PI / 2);
    const f = clampToRoom({ x: p.x, z: p.z, w: p.w, d: p.d, rot }, room.geometry);
    update(p.id, { rot, x: f.x, z: f.z });
  };
  const remove = (id: string) => {
    delete lastOutcome.current[id];
    onChange(buyerPieces.filter((p) => p.id !== id));
    if (selectedId === id) onSelect?.(null);
  };
  const isSaved = (p: PlacedPiece) => myStuff.some((m) => m.name.toLowerCase() === p.name.toLowerCase() && Math.abs(m.w - p.w) < 0.005 && Math.abs(m.d - p.d) < 0.005);
  const save = (p: PlacedPiece) => addMyStuff({ name: p.name, kind: p.kind, w: p.w, d: p.d, h: p.h, color: BUYER_BLUE, flat: p.flat });
  const pick = (it: MyStuffItem) => drop({ name: it.name, kind: it.kind, w: it.w, d: it.d, h: it.h, flat: Boolean(it.flat) });

  return (
    <div className={cx('flex h-full flex-col', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-buyer">Your furniture</div>
          <div className="display text-2xl leading-tight text-ink">Will it fit in {roomPhrase(room.name)}?</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode && onModeChange && sheetLayout ? (
            <Segmented
              size="sm"
              value={mode}
              onChange={onModeChange}
              options={[
                { value: 'walk', label: <span className="sr-only sm:not-sr-only">Walk</span>, icon: <Icon.Walk size={14} /> },
                { value: 'orbit', label: <span className="sr-only sm:not-sr-only">Dollhouse</span>, icon: <Icon.Orbit size={14} /> },
              ]}
            />
          ) : null}
          {onClose ? (
            <IconButton label="Close" onClick={onClose}>
              <Icon.X size={16} />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <form onSubmit={submit} className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Input autoFocus={buyerPieces.length === 0} value={text} onChange={(e) => { setText(e.target.value); if (error) setError(null); }} placeholder="sectional, 220 by 95" aria-label="Describe your furniture" autoComplete="off" />
            <Button type="submit" variant="buyer" loading={parsing} disabled={!text.trim()} className="shrink-0">
              Test
            </Button>
          </div>
          {error ? (
            <div className="text-xs text-danger">{error}</div>
          ) : (
            // How the text was parsed is engineering detail, not a buyer's business: it stays in the tooltip.
            <div className="text-xs text-ink-3" title={lastMeta ? `Parsed ${lastMeta.source === 'nebius' ? `by ${lastMeta.model ?? 'nebius'}` : 'locally'} in ${lastMeta.ms} ms.` : undefined}>
              Name it and give two numbers in cm; height is optional. It lands in front of you.
            </div>
          )}
        </form>

        {buyerPieces.length ? (
          <ul className="mt-4 flex flex-col gap-3">
            {buyerPieces.map((p) => {
              const v = verdicts.get(p.id);
              if (!v) return null;
              const active = selectedId === p.id;
              return (
                <li
                  key={p.id}
                  className={cx('animate-rise rounded-2xl border p-4 transition-colors', v.fits ? 'border-ok/35 bg-ok/[0.06]' : 'border-danger/35 bg-danger/[0.06]', active && 'ring-2 ring-buyer/40')}
                  onClick={() => onSelect?.(p.id)}
                >
                  <div className="flex items-start gap-3">
                    <span className={cx('mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full', v.fits ? 'bg-ok/20 text-ok' : 'bg-danger/20 text-danger')}>
                      {v.fits ? <Icon.Check size={16} /> : <Icon.X size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={cx('display text-[22px] leading-tight', v.fits ? 'text-ok' : 'text-danger')}>{v.headline}</div>
                      <div className="mt-1 text-sm text-ink-2">{v.detail}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Chip tone="buyer" mono>{dimsLabel(p.w, p.d, p.flat ? undefined : p.h)}</Chip>
                        <AnchorChip anchor={room.anchor} size="sm" />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <div className="inline-flex items-center gap-0.5 rounded-lg border border-line-2 bg-surface-2 p-0.5" role="group" aria-label={`Move or turn the ${p.name.toLowerCase()}`}>
                      <span className="px-1.5 text-[11px] text-ink-3">Nudge</span>
                      <IconButton label="Move west 10 cm" className="h-7 w-7 border-0 bg-transparent" onClick={(e) => { e.stopPropagation(); nudge(p, -NUDGE, 0); }}><Icon.ArrowLeft size={14} /></IconButton>
                      <IconButton label="Move north 10 cm" className="h-7 w-7 border-0 bg-transparent" onClick={(e) => { e.stopPropagation(); nudge(p, 0, -NUDGE); }}><Icon.ChevronDown size={14} className="rotate-180" /></IconButton>
                      <IconButton label="Move south 10 cm" className="h-7 w-7 border-0 bg-transparent" onClick={(e) => { e.stopPropagation(); nudge(p, 0, NUDGE); }}><Icon.ChevronDown size={14} /></IconButton>
                      <IconButton label="Move east 10 cm" className="h-7 w-7 border-0 bg-transparent" onClick={(e) => { e.stopPropagation(); nudge(p, NUDGE, 0); }}><Icon.ArrowRight size={14} /></IconButton>
                      <IconButton label="Rotate 90°" className="h-7 w-7 border-0 bg-transparent" onClick={(e) => { e.stopPropagation(); rotate(p); }}><Icon.Rotate size={14} /></IconButton>
                    </div>
                    <span className="flex-1" />
                    {isSaved(p) ? (
                      <Chip tone="buyer">In My Stuff</Chip>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); save(p); }}>
                        Save to My Stuff
                      </Button>
                    )}
                    <IconButton label="Remove" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); remove(p.id); }}>
                      <Icon.Trash size={14} />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="mt-4 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5 text-xs text-ink-3">
          Drag the blue piece in Dollhouse view, or nudge it here. The verdict follows it, judged against {seller.length ? 'the staged furniture' : 'the bare room'} and the door swing.
        </div>

        <div className="mt-4">
          <button type="button" onClick={() => setShowStuff((v) => !v)} className="flex w-full items-center justify-between rounded-lg py-1 text-left text-sm text-ink-2 hover:text-ink">
            <span className="flex items-center gap-2">
              <Icon.Sofa size={16} className="text-buyer" /> My Stuff
              <span className="mono text-[11px] text-ink-3">{myStuff.length}</span>
            </span>
            <Icon.ChevronDown size={16} className={cx('transition-transform', showStuff && 'rotate-180')} />
          </button>
          {showStuff ? (
            <div className="mt-2">
              <MyStuffPanel compact onPick={pick} pickLabel="Test" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
