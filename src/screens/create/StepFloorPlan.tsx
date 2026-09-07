/**
 * Step 3 — the listing floor plan (optional).
 *
 * The plan is the cheapest metric truth a listing has. One vision call turns the drawing into a room
 * list with names, types and, when the draughtsman printed them, real dimensions; those dimensions
 * become the room's geometry and its anchor ("floor plan · 3.75 m wall · ±5 cm"), which beats
 * anything the seller could tap on a photo. A plan with no printed dimensions is still worth reading:
 * it gives the tour its room list and its floors, and each room then waits for a photo or a tape.
 *
 * Nothing here is destructive: the seller ticks which rooms to keep, can correct any number the model
 * misread, and can skip the step entirely.
 */
import { useRef, useState, type DragEvent } from 'react';
import { anchorFromFloorplan } from '@/engine/anchor';
import type { RoomType } from '@/engine/types';
import { dimensionedRooms, planRooms, planSummary, type FlatPlanRoom, type PlanRoom } from '@/services/floorplan';
import { AnchorChip } from '@/components/AnchorChip';
import { Button, Callout, Chip, Input, Select, Spinner, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ROOM_TYPES, ROOM_TYPE_LABELS, PLAN_CEILING_M, rawFromMeasurements, type DraftPlan } from './types';

export interface StepFloorPlanProps {
  plan: DraftPlan;
  /** Rooms already in the wizard, so the step can say what "Use these rooms" will replace. */
  roomCount: number;
  planRoomCount: number;
  onFile: (file: File) => void;
  onDemo: () => void;
  onClear: () => void;
  onToggle: (key: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  onEditRoom: (key: string, patch: Partial<PlanRoom>) => void;
  onUseRooms: () => void;
}

export function StepFloorPlan({ plan, roomCount, planRoomCount, onFile, onDemo, onClear, onToggle, onToggleAll, onEditRoom, onUseRooms }: StepFloorPlanProps) {
  const parsed = plan.plan;
  const rooms = parsed ? planRooms(parsed) : [];
  const chosen = new Set(plan.chosen);
  const chosenCount = rooms.filter((r) => chosen.has(r.key)).length;

  return (
    <div className="flex flex-col gap-6">
      {!plan.image ? (
        <>
          <PlanDropZone onFile={onFile} onDemo={onDemo} />
          <Callout tone="info" title="No plan? Skip this step.">
            Every room can still be anchored from its photo. A plan just makes the numbers better: printed dimensions carry ±5 cm, a tapped door ±4 cm at best, and an unanchored room ±30 cm.
          </Callout>
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
          <div className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
            <div className="panel overflow-hidden p-2">
              <img src={plan.image.dataUrl} alt="The listing floor plan" className="w-full rounded-xl bg-white object-contain" style={{ maxHeight: '58vh' }} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip mono>{plan.fileName || 'floor plan'}</Chip>
              <Button variant="ghost" size="sm" onClick={onClear}>
                <Icon.Trash size={14} /> Remove
              </Button>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {plan.state === 'parsing' ? (
              <div className="panel flex items-center gap-3 p-5">
                <Spinner size={18} />
                <div>
                  <div className="text-sm text-ink">Reading the floor plan…</div>
                  <div className="text-xs text-ink-3">A vision model is naming the rooms and reading every printed dimension. About ten seconds.</div>
                </div>
              </div>
            ) : null}

            {plan.state === 'done' && parsed ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="accent" mono>
                    <Icon.Sparkles size={12} /> {planSummary(parsed)}
                  </Chip>
                  <Chip mono>units · {parsed.units}</Chip>
                  {parsed.northArrow ? (
                    <Chip mono>
                      <Icon.Info size={12} /> north arrow{parsed.northArrow.direction ? ` · ${parsed.northArrow.direction}` : ''}
                    </Chip>
                  ) : (
                    <Chip mono tone="warn">no north arrow</Chip>
                  )}
                  <Chip mono>
                    {parsed.source}
                    {parsed.model ? ` · ${parsed.model}` : ''}
                    {parsed.ms ? ` · ${(parsed.ms / 1000).toFixed(1)} s` : ''}
                    {parsed.usd ? ` · $${parsed.usd.toFixed(4)}` : ''}
                  </Chip>
                </div>

                {parsed.notes.length ? (
                  <ul className="flex flex-col gap-1 text-xs text-ink-3">
                    {parsed.notes.map((n, i) => (
                      <li key={i}>· {n}</li>
                    ))}
                  </ul>
                ) : null}

                {rooms.length ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-ink-2">
                        <span className="mono text-ink">{chosenCount}</span> of <span className="mono text-ink">{rooms.length}</span> rooms selected ·{' '}
                        <span className="mono">{dimensionedRooms(parsed).length}</span> with dimensions
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => onToggleAll(true)}>
                          Select all
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onToggleAll(false)}>
                          None
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4">
                      {parsed.floors.map((f, fi) => (
                        <section key={fi} className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-accent-2">
                            <Icon.Layers size={13} /> {f.label}
                          </div>
                          <div className="flex flex-col gap-2">
                            {f.rooms.map((r, ri) => {
                              const key = `${fi}:${ri}`;
                              return <PlanRoomRow key={key} room={{ ...r, floor: f.label, key }} on={chosen.has(key)} onToggle={(v) => onToggle(key, v)} onEdit={(patch) => onEditRoom(key, patch)} />;
                            })}
                          </div>
                        </section>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                      <Button variant="primary" disabled={!chosenCount} onClick={onUseRooms}>
                        <Icon.Check size={16} /> Use {chosenCount} room{chosenCount === 1 ? '' : 's'}
                      </Button>
                      <span className="text-xs text-ink-3">
                        {planRoomCount > 0
                          ? `Replaces the ${planRoomCount} room${planRoomCount === 1 ? '' : 's'} already taken from this plan. Photos you uploaded are untouched.`
                          : roomCount > 0
                            ? `Added to the ${roomCount} room${roomCount === 1 ? '' : 's'} you already have.`
                            : 'They become the tour’s room list. You match photos to them in the next step.'}
                      </span>
                    </div>
                  </>
                ) : (
                  <Callout tone="warn" title="No rooms could be read">
                    The drawing may be too small or too soft to read. Try a larger export of the same plan, or skip this step and anchor each room from its photo.
                  </Callout>
                )}
              </>
            ) : null}

            {plan.state === 'failed' ? (
              <Callout tone="warn" title="The plan could not be read">
                {parsed?.notes[0] || 'The vision model did not answer. You can retry with a larger image, or skip this step.'}
              </Callout>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- one parsed room ---------- */

function PlanRoomRow({ room, on, onToggle, onEdit }: { room: FlatPlanRoom; on: boolean; onToggle: (v: boolean) => void; onEdit: (patch: Partial<PlanRoom>) => void }) {
  const dimensioned = room.width != null && room.depth != null;
  // The anchor this room will carry, shown here because this is where its dimensions first appear.
  const anchor = dimensioned ? anchorFromFloorplan(rawFromMeasurements({ width: room.width!, depth: room.depth!, height: PLAN_CEILING_M }), room.width!) : undefined;
  return (
    <div className={cx('grid gap-3 rounded-xl border p-3 transition-colors md:grid-cols-[20px_minmax(0,1fr)_140px_190px]', on ? 'border-line-2 bg-surface' : 'border-line bg-bg-2 opacity-60')}>
      <label className="flex items-start pt-2" title={on ? 'Do not use this room' : 'Use this room'}>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" aria-label={`Use ${room.name}`} />
      </label>

      <div className="flex min-w-0 flex-col gap-1">
        <div className="truncate text-sm text-ink">{room.name}</div>
        {room.dimensionsText ? (
          <div className="mono text-[11px] text-ink-3">
            printed: {room.dimensionsText}
            {room.dimensionsFrom === 'model' ? ' · converted by the model' : ''}
          </div>
        ) : (
          <div className="text-[11px] text-ink-3">no dimensions printed</div>
        )}
        {anchor ? <AnchorChip anchor={anchor} size="sm" className="mt-0.5 max-w-full" /> : null}
      </div>

      <Select value={room.type} onChange={(e) => onEdit({ type: e.target.value as RoomType })} aria-label={`Type of ${room.name}`} className="h-9 min-w-0">
        {ROOM_TYPES.map((t) => (
          <option key={t} value={t}>
            {ROOM_TYPE_LABELS[t]}
          </option>
        ))}
      </Select>

      <div className="flex min-w-0 items-center gap-1.5">
        <MetreInput value={room.width} onChange={(width) => onEdit({ width })} label={`Width of ${room.name} in metres`} />
        <span className="text-ink-3">×</span>
        <MetreInput value={room.depth} onChange={(depth) => onEdit({ depth })} label={`Depth of ${room.name} in metres`} />
        <span className="mono text-xs text-ink-3">m</span>
      </div>
    </div>
  );
}

/**
 * One correction box for a printed dimension.
 *
 * It holds the **text** the seller is typing and reports the metres it parses to, rather than being
 * driven by `String(value)`. Driven by the number, every keystroke round-tripped through
 * Number→String: typing `.` after `5` gave `metres("5.") === 5`, which re-rendered the box as `5`
 * and swallowed the point, so `5.2` came out as `52` — a 52 m living room stamped with the plan's
 * ±5 cm. A half-typed value (`3.`, `0.`, empty) simply reports nothing until it parses.
 */
function MetreInput({ value, onChange, label }: { value?: number; onChange: (v: number | undefined) => void; label: string }) {
  const [text, setText] = useState(value != null ? String(value) : '');
  const [seen, setSeen] = useState(value);
  // Re-seed only when the value changed from OUTSIDE this box (a re-parse, "Select all", a reset).
  if (value !== seen) {
    setSeen(value);
    if (value !== metres(text)) setText(value != null ? String(value) : '');
  }
  return (
    <Input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const m = metres(e.target.value);
        setSeen(m);
        onChange(m);
      }}
      inputMode="decimal"
      placeholder="—"
      aria-label={label}
      className="mono h-9 !w-[68px] shrink-0 text-center"
    />
  );
}

/** A half-typed decimal ("3." while the user is still typing) must not become NaN. */
export function metres(v: string): number | undefined {
  const s = v.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/* ---------- upload ---------- */

function PlanDropZone({ onFile, onDemo }: { onFile: (f: File) => void; onDemo: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const f = [...(list || [])].find((x) => x.type.startsWith('image/'));
    if (f) onFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cx(
        'grid-bg relative flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors',
        over ? 'border-accent bg-accent/5' : 'border-line-2 bg-surface',
      )}
    >
      <span className={cx('flex h-12 w-12 items-center justify-center rounded-2xl border border-line-2 bg-surface-2', over ? 'text-accent' : 'text-ink-2')}>
        <Icon.Grid size={22} />
      </span>
      <div>
        <div className="text-base text-ink">Drop the listing floor plan here</div>
        <div className="mt-1 text-sm text-ink-3">The PDF export, the brochure page, a screenshot of the plan on the listing. Bigger is better: the dimensions have to be legible.</div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          <Icon.Upload size={16} /> Choose a plan
        </Button>
        <Button variant="ghost" onClick={onDemo}>
          <Icon.Play size={16} /> Try the demo plan
        </Button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
    </div>
  );
}
