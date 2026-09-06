import { useRef, useState, type DragEvent } from 'react';
import type { RoomType } from '@/engine/types';
import { Button, Callout, Chip, Field, IconButton, Input, Segmented, Select, Spinner, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { FloorPlanSvg } from '@/screens/hub/FloorPlanSvg';
import { ROOM_TYPES, ROOM_TYPE_LABELS, TOOL_OPTIONS, draftGeometry, type DraftRoom, type MeasureTool, type Measurements } from './types';

export interface StepRoomsProps {
  rooms: DraftRoom[];
  /** Photos currently being decoded. */
  loading: number;
  onAddFiles: (files: File[]) => void;
  onAddMeasured: (name: string, type: RoomType, m: Measurements) => void;
  onUpdate: (id: string, patch: Partial<DraftRoom>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
}

export function StepRooms({ rooms, loading, onAddFiles, onAddMeasured, onUpdate, onRemove, onMove }: StepRoomsProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [showMeasured, setShowMeasured] = useState(false);

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const to = rooms.findIndex((r) => r.id === targetId);
    if (to >= 0) onMove(dragId, to);
    setDragId(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <DropZone onFiles={onAddFiles} loading={loading} />

      {rooms.length ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-ink-2">
              <span className="mono text-ink">{rooms.length}</span> room{rooms.length === 1 ? '' : 's'} · drag to reorder
            </div>
            <span className="text-xs text-ink-3">Order is how buyers will walk the tour.</span>
          </div>
          {rooms.map((room, i) => (
            <DraftRoomCard
              key={room.id}
              room={room}
              index={i}
              count={rooms.length}
              dragging={dragId === room.id}
              onDragStart={() => setDragId(room.id)}
              onDragEnd={() => setDragId(null)}
              onDrop={() => dropOn(room.id)}
              onUpdate={(patch) => onUpdate(room.id, patch)}
              onRemove={() => onRemove(room.id)}
              onMove={(to) => onMove(room.id, to)}
            />
          ))}
        </div>
      ) : (
        <Callout tone="info" title="No rooms yet">
          Add one photo per room, or type a room in from a tape measure. Stand in the doorway, hold the phone sideways, get the far corner in shot.
        </Callout>
      )}

      <div className="panel p-5">
        <button type="button" onClick={() => setShowMeasured((v) => !v)} className="flex w-full items-center justify-between text-left">
          <div className="flex items-center gap-3">
            <span className="text-accent-2">
              <Icon.Ruler size={18} />
            </span>
            <div>
              <div className="text-sm font-medium text-ink">Add a room from measurements</div>
              <div className="text-xs text-ink-3">No photo. Type width, depth and height and the room is real by construction.</div>
            </div>
          </div>
          <Icon.ChevronDown size={18} className={cx('text-ink-3 transition-transform', showMeasured && 'rotate-180')} />
        </button>
        {showMeasured ? <MeasuredForm onAdd={(name, type, m) => onAddMeasured(name, type, m)} /> : null}
      </div>
    </div>
  );
}

/* ---------- drop zone ---------- */

function DropZone({ onFiles, loading }: { onFiles: (files: File[]) => void; loading: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const files = [...(list || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) onFiles(files);
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
        {loading > 0 ? <Spinner size={20} /> : <Icon.Upload size={22} />}
      </span>
      <div>
        <div className="text-base text-ink">{loading > 0 ? `Reading ${loading} photo${loading === 1 ? '' : 's'}…` : 'Drop room photos here'}</div>
        <div className="mt-1 text-sm text-ink-3">One photo per room. Doorway, phone sideways, far corner in shot. JPEG or HEIC-converted, any size.</div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          <Icon.Upload size={16} /> Choose photos
        </Button>
        <Button variant="secondary" onClick={() => camRef.current?.click()}>
          <Icon.Camera size={16} /> Take a photo
        </Button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/* ---------- room card ---------- */

function DraftRoomCard({
  room,
  index,
  count,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onUpdate,
  onRemove,
  onMove,
}: {
  room: DraftRoom;
  index: number;
  count: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onUpdate: (patch: Partial<DraftRoom>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [over, setOver] = useState(false);
  const g = draftGeometry(room);
  const a = room.analysis;
  return (
    <div
      draggable={armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={() => {
        setArmed(false);
        onDragEnd();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={cx('panel animate-rise grid gap-4 p-4 transition-all md:grid-cols-[220px_1fr]', dragging && 'opacity-50', over && 'border-accent/60')}
    >
      <div className="relative overflow-hidden rounded-xl border border-line bg-bg-2">
        {room.photo ? (
          <img src={room.photo.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" draggable={false} />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center p-3">
            <FloorPlanSvg geometry={g} showDims className="max-h-full" />
          </div>
        )}
        <span className="mono absolute left-2 top-2 rounded-md bg-bg/80 px-1.5 py-0.5 text-[11px] text-ink-2">{index + 1}</span>
        {room.synthetic ? <span className="chip mono absolute right-2 top-2 !text-[10px] uppercase">demo photo</span> : null}
        {room.source === 'measured' ? <span className="chip mono absolute right-2 top-2 !text-[10px] uppercase">typed</span> : null}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onMouseDown={() => setArmed(true)}
            onMouseUp={() => setArmed(false)}
            className="mt-2 cursor-grab text-ink-3 hover:text-ink active:cursor-grabbing"
            title="Drag to reorder"
            aria-label="Drag to reorder"
          >
            <Icon.Grid size={16} />
          </button>
          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_180px]">
            <Input value={room.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder="Room name" aria-label="Room name" />
            <Select value={room.type} onChange={(e) => onUpdate({ type: e.target.value as RoomType })} aria-label="Room type">
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ROOM_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(index - 1)} className="disabled:opacity-40">
              <Icon.ChevronDown size={16} className="rotate-180" />
            </IconButton>
            <IconButton label="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)} className="disabled:opacity-40">
              <Icon.ChevronDown size={16} />
            </IconButton>
            <IconButton label="Remove room" onClick={onRemove} className="hover:border-danger/50 hover:text-danger">
              <Icon.Trash size={16} />
            </IconButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {room.hints.map((h, i) => (
            <Chip key={i} tone={h.level === 'ok' ? 'ok' : h.level === 'warn' ? 'warn' : 'danger'}>
              {h.level === 'ok' ? <Icon.Check size={12} /> : <Icon.Warning size={12} />}
              {h.text}
            </Chip>
          ))}
          {room.source === 'measured' && room.measured ? (
            <Chip mono>
              <Icon.Ruler size={12} /> {room.measured.width.toFixed(2)} × {room.measured.depth.toFixed(2)} × {room.measured.height.toFixed(2)} m
            </Chip>
          ) : null}
        </div>

        {room.source === 'photo' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {room.analysisState === 'running' ? (
              <Chip>
                <Spinner size={12} /> Analysing the photo…
              </Chip>
            ) : a ? (
              <>
                <Chip tone="accent" mono>
                  <Icon.Sparkles size={12} />
                  AI · {ROOM_TYPE_LABELS[a.roomType].toLowerCase()} {Math.round(a.roomTypeConfidence * 100)}% · {a.isEmpty ? 'empty' : 'furnished'} · {a.doorVisible ? 'door visible' : 'no door seen'}
                </Chip>
                <Chip mono>
                  {a.source}
                  {a.model ? ` · ${a.model}` : ''}
                  {a.ms ? ` · ${a.ms} ms` : ''}
                </Chip>
                <Chip tone={a.quality === 'good' ? 'ok' : a.quality === 'ok' ? 'neutral' : 'warn'}>{a.quality} for reconstruction</Chip>
                {a.roomType !== room.type ? (
                  <button type="button" onClick={() => onUpdate({ type: a.roomType })} className="chip border-accent/40 text-accent-2 hover:bg-accent/10">
                    Use {ROOM_TYPE_LABELS[a.roomType].toLowerCase()}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {a && !a.isEmpty ? (
          <Callout tone="info">
            This room has things in it. That is fine for now; we will offer <span className="text-ink">clear the room</span> after the draft comes back.
          </Callout>
        ) : null}
        {a?.notes.length ? (
          <ul className="flex flex-col gap-0.5 text-xs text-ink-3">
            {a.notes.map((n, i) => (
              <li key={i}>· {n}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- typed room ---------- */

function MeasuredForm({ onAdd }: { onAdd: (name: string, type: RoomType, m: Measurements) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomType>('living');
  const [w, setW] = useState('4.20');
  const [d, setD] = useState('5.10');
  const [h, setH] = useState('2.60');
  const [tool, setTool] = useState<MeasureTool>('tape');
  const m: Measurements = { width: Number(w), depth: Number(d), height: Number(h), tool };
  const valid = [m.width, m.depth, m.height].every((v) => Number.isFinite(v) && v > 0.5);
  const submit = () => {
    if (!valid) return;
    onAdd(name.trim() || ROOM_TYPE_LABELS[type], type, m);
    setName('');
  };
  return (
    <div className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-[1fr_160px_repeat(3,110px)_auto] md:items-end">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={ROOM_TYPE_LABELS[type]} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </Field>
      <Field label="Type">
        <Select value={type} onChange={(e) => setType(e.target.value as RoomType)}>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ROOM_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Width (m)" hint="far wall">
        <Input value={w} onChange={(e) => setW(e.target.value)} inputMode="decimal" className="mono" />
      </Field>
      <Field label="Depth (m)" hint="side wall">
        <Input value={d} onChange={(e) => setD(e.target.value)} inputMode="decimal" className="mono" />
      </Field>
      <Field label="Height (m)" hint="ceiling">
        <Input value={h} onChange={(e) => setH(e.target.value)} inputMode="decimal" className="mono" />
      </Field>
      <Button variant="primary" onClick={submit} disabled={!valid} className="md:mb-5">
        <Icon.Plus size={16} /> Add room
      </Button>
      {/* The tool is the room's uncertainty: a tape carries ±2 cm, a laser ±1 cm. Never assume the laser. */}
      <div className="flex flex-wrap items-center gap-3 md:col-span-6">
        <span className="text-xs font-medium text-ink-2">Measured with</span>
        <Segmented size="sm" value={tool} onChange={setTool} options={TOOL_OPTIONS} />
        <span className="text-xs text-ink-3">This becomes the room's anchor uncertainty.</span>
      </div>
    </div>
  );
}
