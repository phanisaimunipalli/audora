import { useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { anchorFromMarble, plausibility, DOOR_HEIGHT_M, OUTLET_HEIGHT_M } from '@/engine/anchor';
import { bestWorld, useAudora } from '@/state/store';
import { AnchorChip } from '@/components/AnchorChip';
import { FloorOffset } from '@/components/FloorOffset';
import { Button, Callout, Chip, Field, Input, Segmented, Select, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { cm, m2, uncertainty } from '@/lib/format';
import type { LoadedPhoto } from '@/lib/image';
import { FloorPlanSvg } from '@/screens/hub/FloorPlanSvg';
import {
  ROOM_TYPE_LABELS,
  TOOL_OPTIONS,
  anchorFromRecipe,
  draftAnchor,
  draftGeometry,
  finalAnchor,
  isAnchored,
  tapFraction,
  type AnchorMethodChoice,
  type AnchorRecipe,
  type DraftRoom,
  type MeasureTool,
  type Measurements,
  type Tap,
} from './types';

export const ANCHOR_COPY = 'Photos have no scale. A room reconstructed from a picture could be a doll house or a cathedral. Give us one real measurement and every other number becomes true.';

export interface StepAnchorProps {
  rooms: DraftRoom[];
  activeId?: string;
  onActive: (id: string) => void;
  onRecipe: (id: string, recipe: AnchorRecipe | undefined) => void;
  onMeasured: (id: string, m: Measurements) => void;
  /**
   * Store room ids for draft rooms that already exist — re-anchoring a room that has been
   * reconstructed. When one of them carries a real Marble world the step also offers the model's
   * own metric scale and the floor nudge, which a photo tap cannot give.
   */
  realRoomIds?: Record<string, string>;
}

export function StepAnchor({ rooms, activeId, onActive, onRecipe, onMeasured, realRoomIds }: StepAnchorProps) {
  const active = rooms.find((r) => r.id === activeId) ?? rooms[0];
  const idx = rooms.findIndex((r) => r.id === active?.id);
  const anchored = rooms.filter(isAnchored).length;
  if (!active) return <Callout tone="warn">Add at least one room first.</Callout>;
  return (
    <div className="flex flex-col gap-6">
      <div className="panel flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
        <p className="display max-w-3xl text-xl leading-snug text-ink md:text-2xl">{ANCHOR_COPY}</p>
        <div className="shrink-0 text-right">
          <div className="mono text-2xl text-ink">
            {anchored}
            <span className="text-ink-3">/{rooms.length}</span>
          </div>
          <div className="text-xs text-ink-3">rooms anchored</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <ol className="flex gap-2 overflow-x-auto no-scrollbar lg:flex-col">
          {rooms.map((r, i) => {
            const ok = isAnchored(r);
            return (
              <li key={r.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onActive(r.id)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                    r.id === active.id ? 'border-accent bg-accent/5' : 'border-line bg-surface hover:bg-surface-2',
                  )}
                >
                  <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]', ok ? 'border-ink/25 bg-surface text-ink' : 'border-line-2 text-ink-3')}>
                    {ok ? <Icon.Check size={13} /> : <span className="mono">{i + 1}</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{r.name}</span>
                    <span className="block truncate text-[11px] text-ink-3">{ok ? finalAnchor(r).label : r.source === 'measured' ? 'typed' : 'needs an anchor'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="min-w-0">
          {active.source === 'measured' ? (
            <MeasuredPanel key={active.id} room={active} onMeasured={(m) => onMeasured(active.id, m)} />
          ) : (
            <PhotoPanel key={active.id} room={active} onRecipe={(rec) => onRecipe(active.id, rec)} />
          )}
          {realRoomIds?.[active.id] ? <RealWorldPanel key={`real-${active.id}`} roomId={realRoomIds[active.id]} /> : null}
          <div className="mt-4 flex items-center justify-between">
            <Button variant="ghost" disabled={idx <= 0} onClick={() => onActive(rooms[idx - 1].id)}>
              <Icon.ArrowLeft size={16} /> Previous room
            </Button>
            <Button variant="secondary" disabled={idx >= rooms.length - 1} onClick={() => onActive(rooms[idx + 1].id)}>
              Next room <Icon.ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- a room that already has a real reconstruction ---------- */

/**
 * Anchoring for rooms whose world came back from Marble. A full-quality world measured itself, so
 * its scale can be adopted with one tap; a draft world did not, and only a typed wall length or a
 * door tap will tighten it. Either way the floor may need a centimetre or two of nudging before
 * staged furniture stands on the floor you can see.
 */
function RealWorldPanel({ roomId }: { roomId: string }) {
  const room = useAudora((s) => s.rooms[roomId]);
  const setAnchor = useAudora((s) => s.setAnchor);
  const world = bestWorld(room);
  if (!room || !world || world.provider !== 'marble') return null;
  const msf = world.metricScaleFactor && world.metricScaleFactor > 0 ? world.metricScaleFactor : undefined;
  const onModelScale = room.anchor.method === 'marble';
  return (
    <div className="panel mt-4 flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-ink">
          <Icon.Layers size={15} /> Reconstructed room
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip mono className="!text-[10px]">
            {world.tier} · {world.model}
          </Chip>
          {world.panoUrl ? (
            <Chip mono className="!text-[10px]">
              panorama
            </Chip>
          ) : null}
        </div>
      </div>
      {msf ? (
        <>
          <p className="text-xs leading-snug text-ink-3">
            Marble measured this world itself: one raw unit is <span className="mono text-ink-2">{msf.toFixed(4)} m</span>
            {world.groundPlaneOffset != null ? (
              <>
                {' '}
                and the camera stood <span className="mono text-ink-2">{world.groundPlaneOffset.toFixed(2)} m</span> above the floor
              </>
            ) : null}
            . It is an estimate, so a tapped door or a typed wall still beats it.
          </p>
          <Button size="sm" variant="secondary" disabled={onModelScale} onClick={() => setAnchor(room.id, anchorFromMarble(msf))}>
            <Icon.Sparkles size={14} /> {onModelScale ? "Using the model's scale" : "Use the model's scale"}
          </Button>
        </>
      ) : (
        <Callout tone="warn" title="This draft carries no metric scale">
          Draft reconstructions come back without measurements, so the room is sized from an assumed 2.44 m ceiling. Type a wall length above and every number tightens.
        </Callout>
      )}
      <FloorOffset roomId={room.id} showAnchor={false} />
      <AnchorChip anchor={room.anchor} size="sm" className="self-start" />
    </div>
  );
}

/* ---------- photo room ---------- */

const METHODS: { value: AnchorMethodChoice; letter: string; title: string; body: string; icon: (p: { size?: number }) => ReactElement }[] = [
  { value: 'door', letter: 'a', title: 'Tap the door', body: `Tap the top, then the bottom of a door in the photo. Interior doors are ${DOOR_HEIGHT_M.toFixed(2)} m.`, icon: Icon.Door },
  { value: 'outlet', letter: 'b', title: 'Tap a power outlet', body: `Top then bottom of an outlet plate. Its centre sits ${(OUTLET_HEIGHT_M * 100).toFixed(0)} cm above the floor. Less precise.`, icon: Icon.Zap },
  { value: 'wall', letter: 'c', title: 'Type one wall length', body: 'Tape or laser: the far wall or a side wall in metres.', icon: Icon.Ruler },
  { value: 'floorplan', letter: 'd', title: 'Import from floor plan', body: 'Read the far wall length off the listing floor plan.', icon: Icon.Grid },
];

function emptyRecipe(method: AnchorMethodChoice): AnchorRecipe {
  switch (method) {
    case 'door':
      return { method: 'door', taps: [] };
    case 'outlet':
      return { method: 'outlet', taps: [] };
    case 'wall':
      return { method: 'wall', wall: 'width', metres: 0, tool: 'tape' };
    case 'floorplan':
      return { method: 'floorplan', metres: 0 };
    case 'skip':
      return { method: 'skip' };
  }
}

/** Does this recipe actually produce a measurement, or is it still half-typed? */
function recipeMeasures(room: DraftRoom, recipe: AnchorRecipe): boolean {
  return recipe.method === 'skip' || Boolean(anchorFromRecipe(room.raw, recipe));
}

function PhotoPanel({ room, onRecipe }: { room: DraftRoom; onRecipe: (r: AnchorRecipe | undefined) => void }) {
  const recipe = room.recipe;
  const [method, setMethod] = useState<AnchorMethodChoice>(recipe && recipe.method !== 'skip' ? recipe.method : 'door');
  /**
   * The half-finished recipe of the method being tried, held here rather than pushed up: switching
   * from "type a wall length" to "tap the door" must not throw away the 4.20 m the seller already
   * measured. The room keeps its anchor until the new method produces one of its own.
   */
  const [pending, setPending] = useState<AnchorRecipe | undefined>(undefined);
  const photo = room.photo!;
  const anchor = draftAnchor(room);
  const shown = finalAnchor(room);
  const g = draftGeometry(room);
  const warnings = plausibility(g);
  const skipped = recipe?.method === 'skip';
  // What the controls edit: the stored recipe when it is the method on screen, else the local draft.
  const editing: AnchorRecipe | undefined = recipe && recipe.method === method ? recipe : pending && pending.method === method ? pending : undefined;
  // An anchor is only "kept" while the method on screen has not replaced it yet.
  const keeping = recipe && recipe.method !== method && anchor ? anchor : undefined;

  /** Push a recipe up only once it measures something; until then it lives in `pending`. */
  const propose = (next: AnchorRecipe) => {
    setPending(next);
    if (recipeMeasures(room, next) || !anchor) onRecipe(next);
  };
  const choose = (m: AnchorMethodChoice) => {
    setMethod(m);
    if (recipe?.method === m) return;
    const fresh = emptyRecipe(m);
    setPending(fresh);
    // Nothing to lose (no declared anchor yet), or a deliberate skip: adopt the new method at once.
    if (!anchor || m === 'skip') onRecipe(fresh);
  };
  const taps: Tap[] = editing && (editing.method === 'door' || editing.method === 'outlet') ? editing.taps : [];
  const tap = (t: Tap) => {
    if (method !== 'door' && method !== 'outlet') return;
    const next = taps.length >= 2 ? [t] : [...taps, t];
    propose({ method, taps: next });
  };
  const useSuggestion = () => {
    const b = room.analysis?.doorBox;
    if (!b) return;
    const cx = b.x + b.w / 2;
    setMethod('door');
    propose({ method: 'door', taps: [{ x: cx, y: b.y }, { x: cx, y: b.y + b.h }] });
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg text-ink">{room.name}</div>
            <div className="text-xs text-ink-3">{ROOM_TYPE_LABELS[room.type]}{room.synthetic ? ' · demo photo' : ''}</div>
          </div>
          {room.analysis ? (
            <Chip mono>
              <Icon.Sparkles size={12} /> {room.analysis.doorVisible ? 'AI: door visible' : 'AI: no door seen'} · {room.analysis.source}
            </Chip>
          ) : null}
        </div>
        <TapImage
          photo={photo}
          taps={method === 'door' || method === 'outlet' ? taps : []}
          kind={method === 'outlet' ? 'outlet' : 'door'}
          tapping={method === 'door' || method === 'outlet'}
          suggestion={method === 'door' ? room.analysis?.doorBox : undefined}
          onTap={tap}
          onReset={() => propose({ method: method === 'outlet' ? 'outlet' : 'door', taps: [] })}
          onUseSuggestion={useSuggestion}
        />
      </div>

      <div className="flex flex-col gap-4">
        <ol className="flex flex-col gap-2">
          {METHODS.map((m) => {
            const I = m.icon;
            const on = method === m.value && !skipped;
            return (
              <li key={m.value}>
                <button
                  type="button"
                  onClick={() => choose(m.value)}
                  className={cx('flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors', on ? 'border-accent bg-accent/5' : 'border-line bg-surface hover:bg-surface-2')}
                >
                  <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border', on ? 'border-accent text-ink' : 'border-line-2 text-ink-3')}>
                    <I size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">
                      <span className="mono text-ink-3">{m.letter} · </span>
                      {m.title}
                    </span>
                    <span className="block text-xs text-ink-3">{m.body}</span>
                  </span>
                </button>
                {on ? <MethodControls recipe={editing} onRecipe={propose} /> : null}
              </li>
            );
          })}
        </ol>

        {keeping ? (
          <Callout tone="info" title="Your measurement is still in place">
            <span className="mono">{keeping.label}</span> stays the anchor until this method gives one of its own. Nothing is lost by looking.
          </Callout>
        ) : null}

        <DerivedPanel anchor={shown} declared={!!anchor && !skipped} g={g} warnings={warnings} />

        {skipped ? (
          <Callout tone="warn" title="Skipped: numbers are a guess">
            Nothing has been measured in this room. Every dimension carries ±30 cm until you anchor it. You can do it later from the tour hub.
          </Callout>
        ) : (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => onRecipe({ method: 'skip' })}>
            Skip for now — the numbers will be a guess
          </Button>
        )}
        <div className="flex flex-col gap-2 text-xs text-ink-3">
          <FloorPlanSvg geometry={g} className="max-h-56 rounded-xl border border-line bg-surface p-2" />
        </div>
      </div>
    </div>
  );
}

/** "4.20" or "4,20" → 4.2; anything else → 0 (not yet a measurement). */
function parseMetres(text: string): number {
  const n = Number(text.replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A metres field that keeps what the user typed. A controlled number field that re-renders from the
 * parsed value eats the decimal point ("4." becomes "4"), so the text lives here and only the number
 * goes up.
 */
function MetresInput({ value, onChange, placeholder = '4.20', autoFocus, label }: { value: number; onChange: (metres: number) => void; placeholder?: string; autoFocus?: boolean; label: string }) {
  const [text, setText] = useState(value > 0 ? String(value) : '');
  return (
    <Input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseMetres(e.target.value));
      }}
      inputMode="decimal"
      placeholder={placeholder}
      className="mono"
      autoFocus={autoFocus}
      aria-label={label}
    />
  );
}

function MethodControls({ recipe, onRecipe }: { recipe: AnchorRecipe | undefined; onRecipe: (r: AnchorRecipe) => void }) {
  if (!recipe) return null;
  if (recipe.method === 'door' || recipe.method === 'outlet') {
    const f = tapFraction(recipe.taps);
    return (
      <div className="ml-10 mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="mono">
          {recipe.taps.length}/2 taps{f != null ? ` · ${(f * 100).toFixed(0)}% of frame height` : ''}
        </span>
        {f != null && f < (recipe.method === 'door' ? 0.02 : 0.005) ? <Chip tone="warn">Taps are too close together. Tap the top, then the bottom.</Chip> : null}
      </div>
    );
  }
  if (recipe.method === 'wall') {
    return (
      <div className="ml-10 mt-3 grid gap-3 sm:grid-cols-[1fr_110px]">
        <Field label="Which wall">
          <Select value={recipe.wall} onChange={(e) => onRecipe({ ...recipe, wall: e.target.value as 'width' | 'depth' })}>
            <option value="width">Far wall (the one you face from the door)</option>
            <option value="depth">Side wall (door wall to far wall)</option>
          </Select>
        </Field>
        <Field label="Metres">
          <MetresInput value={recipe.metres} onChange={(metres) => onRecipe({ ...recipe, metres })} autoFocus label="Wall length in metres" />
        </Field>
        <div className="sm:col-span-2">
          <Segmented
            size="sm"
            value={recipe.tool}
            onChange={(tool) => onRecipe({ ...recipe, tool })}
            options={[
              { value: 'tape', label: 'Tape · ±2 cm' },
              { value: 'laser', label: 'Laser · ±1 cm' },
            ]}
          />
        </div>
      </div>
    );
  }
  if (recipe.method === 'floorplan') {
    return (
      <div className="ml-10 mt-3 grid gap-3 sm:grid-cols-[1fr_110px]">
        <div className="text-xs text-ink-3">
          Find this room on the plan and read the length of the far wall (the one you face from the door). Plans round to 5 cm, so we carry ±5 cm.
        </div>
        <Field label="Far wall, m">
          <MetresInput value={recipe.metres} onChange={(metres) => onRecipe({ ...recipe, metres })} autoFocus label="Far wall length in metres" />
        </Field>
      </div>
    );
  }
  return null;
}

function DerivedPanel({ anchor, declared, g, warnings }: { anchor: ReturnType<typeof finalAnchor>; declared: boolean; g: ReturnType<typeof draftGeometry>; warnings: ReturnType<typeof plausibility> }) {
  return (
    <div className={cx('panel flex flex-col gap-3 p-4', declared && 'ring-accent')}>
      <div className="flex items-center justify-between">
        <div className="micro">Derived dimensions</div>
        <span className="mono text-[11px] text-ink-3">W × D × H</span>
      </div>
      <div className={cx('mono flex flex-wrap items-baseline gap-x-2 gap-y-1 text-3xl leading-none', declared ? 'text-ink' : 'text-ink-3')}>
        <span className="whitespace-nowrap">{g.width.toFixed(2)} ×</span>
        <span className="whitespace-nowrap">{g.depth.toFixed(2)} ×</span>
        <span className="whitespace-nowrap">
          {g.height.toFixed(2)} <span className="text-lg">m</span>
        </span>
      </div>
      <div className="mono flex flex-wrap gap-x-2 text-xs text-ink-3">
        <span className="whitespace-nowrap">door {cm(g.door.width)} wide</span>
        <span>·</span>
        <span className="whitespace-nowrap">floor {m2(g.width * g.depth)}</span>
        <span>·</span>
        <span className="whitespace-nowrap">{declared ? uncertainty(anchor.uncertaintyM) : 'unanchored guess'}</span>
      </div>
      <AnchorChip anchor={anchor} />
      {warnings.map((w) => (
        <Callout key={w.field} tone={w.severity === 'error' ? 'danger' : 'warn'}>
          {w.message}
        </Callout>
      ))}
    </div>
  );
}

/* ---------- tap overlay ---------- */

function TapImage({
  photo,
  taps,
  kind,
  tapping,
  suggestion,
  onTap,
  onReset,
  onUseSuggestion,
}: {
  photo: LoadedPhoto;
  taps: Tap[];
  kind: 'door' | 'outlet';
  tapping: boolean;
  suggestion?: { x: number; y: number; w: number; h: number };
  onTap: (t: Tap) => void;
  onReset: () => void;
  onUseSuggestion: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const W = photo.width;
  const H = photo.height;
  const r = Math.max(6, W * 0.011);
  const f = tapFraction(taps);
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!tapping) return;
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    onTap({ x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) });
  };
  const prompt = !tapping ? 'Typed measurement: no taps needed' : taps.length === 0 ? `Tap the top of the ${kind}` : taps.length === 1 ? `Now tap the bottom of the ${kind}` : `${kind} spans ${Math.round((f ?? 0) * 100)}% of the frame · tap again to redo`;
  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} onClick={click} className={cx('relative select-none overflow-hidden rounded-2xl border border-line bg-surface shadow-soft', tapping && 'cursor-crosshair')}>
        <img src={photo.dataUrl} alt="" draggable={false} className="block w-full" />
        <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 h-full w-full">
          {suggestion && tapping ? (
            <rect
              x={suggestion.x * W}
              y={suggestion.y * H}
              width={suggestion.w * W}
              height={suggestion.h * H}
              rx={W * 0.004}
              fill="color-mix(in srgb, var(--color-ok) 10%, transparent)"
              stroke="var(--color-ok)"
              strokeWidth={Math.max(2, W * 0.0028)}
              strokeDasharray={`${W * 0.012} ${W * 0.008}`}
            />
          ) : null}
          {taps.length === 2 ? (
            <line x1={taps[0].x * W} y1={taps[0].y * H} x2={taps[1].x * W} y2={taps[1].y * H} stroke="var(--color-accent)" strokeWidth={Math.max(2, W * 0.0035)} strokeDasharray={`${W * 0.01} ${W * 0.008}`} />
          ) : null}
          {taps.map((t, i) => (
            <g key={i}>
              <circle cx={t.x * W} cy={t.y * H} r={r * 2} fill="rgb(10 10 10 / 0.18)" />
              <circle cx={t.x * W} cy={t.y * H} r={r} fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth={r * 0.35} />
              <line x1={t.x * W - r * 3} y1={t.y * H} x2={t.x * W + r * 3} y2={t.y * H} stroke="var(--color-accent)" strokeWidth={Math.max(1.5, W * 0.002)} />
            </g>
          ))}
        </svg>
        {/* Before the markers on purpose: a tap near the bottom-left must not disappear under this pill. */}
        <div className="glass mono pointer-events-none absolute bottom-3 left-3 rounded-full px-3 py-1.5 text-[12px] text-ink">{prompt}</div>
        {taps.map((t, i) => (
          <span key={i} className="chip mono pointer-events-none absolute !text-[11px]" style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, transform: 'translate(18px, -50%)' }}>
            {i === 0 ? 'top' : 'bottom'}
          </span>
        ))}
        {suggestion && tapping && taps.length === 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUseSuggestion();
            }}
            className="chip absolute border-ink/25 bg-bg/85 text-ink hover:bg-surface"
            style={{ left: `${Math.min(suggestion.x, 0.7) * 100}%`, top: `${suggestion.y * 100}%`, transform: 'translate(0, -120%)' }}
          >
            <Icon.Sparkles size={12} /> AI found a door here · use it
          </button>
        ) : null}
      </div>
      <div className="flex items-center justify-between text-xs text-ink-3">
        <span>
          {photo.width} × {photo.height} px · taps are normalised to the frame
        </span>
        {taps.length ? (
          <button type="button" onClick={onReset} className="text-ink-2 hover:text-ink">
            Reset taps
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- typed room ---------- */

/**
 * A room with no photograph to tap on: the seller types its three dimensions.
 *
 * Two rules, both learned the hard way:
 *
 * - **The fields are metres, so they are seeded with metres.** A room read off a floor plan that
 *   printed no dimensions carries `raw` in the reconstruction's own units, and the anchor's
 *   `metresPerUnit` (2.03 on the demo plan) is what turns those into the metres the Derived panel
 *   prints. Seeding the boxes from `room.raw` put 1.70 in a box labelled "Width (m)" beside a
 *   Derived panel reading 3.45 m — and committing it halved the room.
 * - **Touching a field is not measuring it.** `onBlur` used to commit whatever the boxes held, so
 *   a focus and a click away turned a room the app itself calls a ±30 cm guess into an anchored
 *   ±2 cm measurement without anyone typing a digit. Nothing is committed until a value changes.
 */
function MeasuredPanel({ room, onMeasured }: { room: DraftRoom; onMeasured: (m: Measurements) => void }) {
  const g = draftGeometry(room);
  const seeded = room.measured ?? { width: g.width, depth: g.depth, height: g.height, tool: 'tape' as MeasureTool };
  const [w, setW] = useState(seeded.width.toFixed(2));
  const [d, setD] = useState(seeded.depth.toFixed(2));
  const [h, setH] = useState(seeded.height.toFixed(2));
  const [tool, setTool] = useState<MeasureTool>(seeded.tool ?? 'tape');
  /** Has the seller actually changed a number? Until they have, this room has not been measured. */
  const [touched, setTouched] = useState(false);
  const anchor = finalAnchor(room);
  const warnings = plausibility(g);
  const read = () => ({ width: Number(w), depth: Number(d), height: Number(h) });
  const apply = (next = read(), t: MeasureTool = tool) => {
    if ([next.width, next.depth, next.height].every((v) => Number.isFinite(v) && v > 0.5)) onMeasured({ ...next, tool: t });
  };
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setTouched(true);
  };
  /* The tool is a claim about how these numbers were arrived at, so it only commits numbers that
     are already the seller's own — either typed here, or typed on an earlier visit. */
  const chooseTool = (t: MeasureTool) => {
    setTool(t);
    if (touched || room.measured) apply(read(), t);
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <div className="panel flex flex-col gap-3 p-4">
        <div>
          <div className="text-lg text-ink">{room.name}</div>
          <div className="text-xs text-ink-3">
            {ROOM_TYPE_LABELS[room.type]} · {room.planRoom ? 'from the floor plan' : 'typed in'}
          </div>
        </div>
        {/* A room read off a plan that printed no dimensions is NOT anchored, and must not say it is. */}
        {anchor.method === 'assumed' ? (
          <Callout tone="warn" title="Not anchored yet">
            The floor plan named this room but printed no dimensions for it, so every number below is a ±30 cm guess. Type the far wall and the rest becomes real by construction.
          </Callout>
        ) : (
          <Callout tone="info" title="Already anchored">
            The far wall <span className="mono">{g.width.toFixed(2)} m</span> is the reference, so every other number is real by construction.{' '}
            {room.planRoom && anchor.method === 'floorplan' ? 'It came off the plan, which carries ±5 cm. Typing it yourself with a tape is tighter.' : 'How it was measured sets the ±.'}
          </Callout>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-ink-2">Measured with</span>
          <Segmented size="sm" value={tool} onChange={chooseTool} options={TOOL_OPTIONS} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Width (m)">
            <Input value={w} onChange={(e) => edit(setW)(e.target.value)} onBlur={() => touched && apply()} inputMode="decimal" className="mono" />
          </Field>
          <Field label="Depth (m)">
            <Input value={d} onChange={(e) => edit(setD)(e.target.value)} onBlur={() => touched && apply()} inputMode="decimal" className="mono" />
          </Field>
          <Field label="Height (m)">
            <Input value={h} onChange={(e) => edit(setH)(e.target.value)} onBlur={() => touched && apply()} inputMode="decimal" className="mono" />
          </Field>
        </div>
        <FloorPlanSvg geometry={g} className="max-h-64 rounded-xl border border-line bg-surface p-2" />
      </div>
      <DerivedPanel anchor={anchor} declared g={g} warnings={warnings} />
    </div>
  );
}
