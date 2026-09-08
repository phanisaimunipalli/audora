import { useRef, useState, type DragEvent } from 'react';
import type { RoomType } from '@/engine/types';
import type { PhotoAngle } from '@/state/types';
import { ANGLE_LABELS, MAX_ROOM_PHOTOS } from '@/services/marble';
import { metricText, type FlatPlanRoom } from '@/services/floorplan';
import { AnchorChip } from '@/components/AnchorChip';
import { Button, Callout, Chip, Field, IconButton, Input, Segmented, Select, Spinner, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { FloorPlanSvg } from '@/screens/hub/FloorPlanSvg';
import {
  ANGLE_PLAN,
  MIN_ANGLES,
  RECOMMENDED_ANGLES,
  blockedRooms,
  planPhotoRows,
  roomIntake,
  suggestPlanRoom,
  wantsReconstruction,
  type PlanPhotoRow,
  type RoomIntake,
} from './intake';
import { ROOM_TYPES, ROOM_TYPE_LABELS, TOOL_OPTIONS, canAddPhoto, draftGeometry, draftPhotos, finalAnchor, isFromPlan, planRoomRef, type DraftRoom, type MeasureTool, type Measurements } from './types';

/** Progress of a "paste photo URLs" import, so the box can report each line as it lands. */
export interface UrlImportState {
  running: boolean;
  done: number;
  total: number;
  errors: { url: string; error: string }[];
}

export interface StepRoomsProps {
  rooms: DraftRoom[];
  /** Photos currently being decoded. */
  loading: number;
  onAddFiles: (files: File[]) => void;
  onAddMeasured: (name: string, type: RoomType, m: Measurements) => void;
  onUpdate: (id: string, patch: Partial<DraftRoom>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
  /** Rooms read off the unit's floor plan, offered as the match for each photo. */
  planRooms?: FlatPlanRoom[];
  onMatchPlan?: (id: string, key: string | undefined) => void;
  /** Another angle of the same room; up to six per room reach Marble as one multi-image prompt. */
  onAddAngle?: (id: string, files: File[]) => void;
  onRemovePhoto?: (id: string, index: number) => void;
  onPhotoAngle?: (id: string, index: number, angle: PhotoAngle | undefined) => void;
  /** Photo URLs copied off the listing, fetched through the server. */
  onAddUrls?: (text: string) => void;
  urlImport?: UrlImportState | null;
}

export function StepRooms({ rooms, loading, onAddFiles, onAddMeasured, onUpdate, onRemove, onMove, planRooms, onMatchPlan, onAddAngle, onRemovePhoto, onPhotoAngle, onAddUrls, urlImport }: StepRoomsProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [showMeasured, setShowMeasured] = useState(false);
  const takenKeys = new Set(rooms.map((r) => r.planRoom?.key).filter(Boolean) as string[]);
  const blocked = blockedRooms(rooms);
  const thin = rooms.map(roomIntake).filter((r) => r.photos > 0 && !r.angles.enough);

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const to = rooms.findIndex((r) => r.id === targetId);
    if (to >= 0) onMove(dragId, to);
    setDragId(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <AngleGuidance />

      <DropZone onFiles={onAddFiles} loading={loading} />

      {onAddUrls ? <PhotoUrlBox onSubmit={onAddUrls} state={urlImport} /> : null}

      {/* The gate, said once at the top so it is not a surprise at the bottom of a long list. */}
      {blocked.length ? (
        <Callout tone="danger" title={`${blocked.length} room${blocked.length === 1 ? '' : 's'} cannot be reconstructed from the photo you gave`}>
          {blocked.map((b) => b.name).join(', ')} — retake the primary photo, or open the room and choose “use anyway”. A poor photo does not fail loudly: it comes back as a
          room with the wrong walls in it.
        </Callout>
      ) : null}
      {!blocked.length && thin.length ? (
        <Callout tone="warn" title={`${thin.length} room${thin.length === 1 ? ' has' : 's have'} only one angle`}>
          One photograph gives the model no parallax, so the far wall is a guess. {MIN_ANGLES} angles is the minimum that earns the accuracy targets; {RECOMMENDED_ANGLES} is
          what they were written against.
        </Callout>
      ) : null}

      {planRooms?.length && onMatchPlan ? <PlanConfirmation rooms={rooms} planRooms={planRooms} onUpdate={onUpdate} /> : null}

      {rooms.length ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-ink-2">
              <span className="mono text-ink">{rooms.length}</span> room{rooms.length === 1 ? '' : 's'} · drag to reorder
            </div>
            <span className="text-xs text-ink-3">Order is how a renter will walk the unit.</span>
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
              planRooms={planRooms}
              takenKeys={takenKeys}
              onMatchPlan={onMatchPlan ? (key) => onMatchPlan(room.id, key) : undefined}
              onAddAngle={onAddAngle ? (files) => onAddAngle(room.id, files) : undefined}
              onRemovePhoto={onRemovePhoto ? (i) => onRemovePhoto(room.id, i) : undefined}
              onPhotoAngle={onPhotoAngle ? (i, a) => onPhotoAngle(room.id, i, a) : undefined}
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
            <span className="text-ink">
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
        'ease-audora relative flex flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed px-6 py-11 text-center transition-colors duration-200',
        over ? 'border-ink-2 bg-surface-2' : 'border-line-2 bg-surface',
      )}
    >
      <span className={cx('grid h-[52px] w-[52px] place-items-center rounded-full bg-bg shadow-sm', over ? 'text-ink' : 'text-ink-2')}>
        {loading > 0 ? <Spinner size={20} /> : <Icon.Upload size={22} />}
      </span>
      <div>
        <div className="text-[15.5px] font-semibold text-ink">{loading > 0 ? `Reading ${loading} photo${loading === 1 ? '' : 's'}…` : 'Drop room photos here'}</div>
        <div className="mt-1 text-[12.5px] text-dim">One photo per room. Doorway, phone sideways, far corner in shot. JPEG or HEIC-converted, any size.</div>
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
  planRooms,
  takenKeys,
  onMatchPlan,
  onAddAngle,
  onRemovePhoto,
  onPhotoAngle,
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
  planRooms?: FlatPlanRoom[];
  takenKeys: Set<string>;
  onMatchPlan?: (key: string | undefined) => void;
  onAddAngle?: (files: File[]) => void;
  onRemovePhoto?: (index: number) => void;
  onPhotoAngle?: (index: number, angle: PhotoAngle | undefined) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [over, setOver] = useState(false);
  const g = draftGeometry(room);
  const a = room.analysis;
  const photos = draftPhotos(room);
  const fromPlan = isFromPlan(room);
  const intake = roomIntake(room);
  /** A real photograph the quality gate judges, as against a browser-drawn demo room. */
  const gated = Boolean(room.photo) && !room.synthetic;
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
      className={cx(
        'panel animate-rise grid gap-4 p-4 transition-all md:grid-cols-[220px_1fr]',
        dragging && 'opacity-50',
        over && 'border-accent/60',
        /* A blocked room is not a styling flourish: it is the one thing standing between the leasing team
           and Generate, so the card itself says so. */
        intake.blocked && 'border-danger/50',
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="relative overflow-hidden rounded-xl border border-line bg-surface">
          {room.photo ? (
            <img src={room.photo.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" draggable={false} />
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center p-3">
              <FloorPlanSvg geometry={g} showDims className="max-h-full" />
            </div>
          )}
          <span className="mono absolute left-2 top-2 rounded-md bg-bg/80 px-1.5 py-0.5 text-[11px] text-ink-2">{index + 1}</span>
          {room.synthetic ? <span className="chip mono absolute right-2 top-2 !text-[10px] uppercase">demo photo</span> : null}
          {!room.synthetic && room.planRoom && !room.photo ? <span className="chip mono absolute right-2 top-2 !text-[10px] uppercase">floor plan</span> : null}
          {!room.synthetic && !room.planRoom && room.source === 'measured' ? <span className="chip mono absolute right-2 top-2 !text-[10px] uppercase">typed</span> : null}
          {room.photo?.origin === 'url' ? <span className="chip mono absolute bottom-2 left-2 !text-[10px] uppercase">from listing</span> : null}
        </div>
        <PhotoAngles room={room} photos={photos} onAddAngle={onAddAngle} onRemovePhoto={onRemovePhoto} onPhotoAngle={onPhotoAngle} />
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
            <IconButton label="Remove room" onClick={onRemove} className="hover:border-danger/40 hover:text-danger">
              <Icon.Trash size={16} />
            </IconButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* `photoHints` and `photoVerdict` are two readings of the same three numbers, and the card
              was printing both: "Too dark to reconstruct well. Open the blinds…" beside "Too dark to
              reconstruct. Open the blinds or turn the lights on." The verdict is the one the gate
              acts on, so it is the one that speaks. The hints stay for a room the gate never sees —
              a browser-drawn demo room, which has a photo but no photograph. */}
          {gated
            ? null
            : room.hints.map((h, i) => (
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

        {gated ? <QualityGate intake={intake} onAccept={(v) => onUpdate({ photoAccepted: v })} /> : null}

        {planRooms?.length && onMatchPlan ? (
          <div className={cx('flex flex-col gap-2 rounded-xl border bg-surface p-3', room.planRoom && !room.planConfirmed && fromPlan ? 'border-line-2' : 'border-line')}>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <span className="text-ink">
                  <Icon.Grid size={14} />
                </span>
                Which room on the floor plan is this?
              </label>
              <Select
                value={room.planRoom?.key ?? ''}
                onChange={(e) => onMatchPlan(e.target.value || undefined)}
                aria-label={`Floor-plan room for ${room.name}`}
                className="h-9 sm:w-[260px]"
              >
                <option value="">Not on the plan</option>
                {planRooms.map((p) => (
                  <option key={p.key} value={p.key} disabled={takenKeys.has(p.key) && p.key !== room.planRoom?.key}>
                    {p.floor} · {p.name}
                    {metricText(p) ? ` — ${metricText(p)}` : ' — no dimensions'}
                    {takenKeys.has(p.key) && p.key !== room.planRoom?.key ? ' (taken)' : ''}
                  </option>
                ))}
              </Select>
            </div>
            {/* Nothing matched yet: offer the plan room whose name this one most looks like, once. */}
            {!room.planRoom ? <PlanSuggestion room={room} planRooms={planRooms} taken={takenKeys} onMatchPlan={onMatchPlan} /> : null}
            {room.planRoom ? (
              <div className="flex flex-wrap items-center gap-2">
                {fromPlan ? (
                  <Chip tone="accent" mono>
                    <Icon.Ruler size={12} /> plan · {g.width.toFixed(2)} × {g.depth.toFixed(2)} m
                  </Chip>
                ) : null}
                {room.planRoom.text ? <Chip mono>printed: {room.planRoom.text}</Chip> : null}
                {/* The room's numbers are on screen (the plan thumbnail), so the anchor is too. */}
                <AnchorChip anchor={finalAnchor(room)} size="sm" />
                {fromPlan && room.photo ? <span className="text-[11px] text-ink-3">The plan’s dimensions replace the estimate from this photo.</span> : null}
                {!fromPlan ? <span className="text-[11px] text-ink-3">The plan printed no dimensions for this room — add a photo or type a wall.</span> : null}
              </div>
            ) : null}
            {/* The confirmation itself: one pairing, one yes. `planConfirmed` is cleared by a re-map. */}
            {fromPlan ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                {room.planConfirmed ? (
                  <>
                    <Chip tone="ok">
                      <Icon.Check size={12} /> Confirmed: this photo is {room.planRoom?.name}
                    </Chip>
                    <button type="button" onClick={() => onUpdate({ planConfirmed: undefined })} className="text-[11px] text-ink-3 hover:text-ink">
                      Change
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[12px] text-ink-2">
                      Plan says <span className="mono text-ink">{g.width.toFixed(2)} × {g.depth.toFixed(2)} m</span> for {room.planRoom?.name}. Is that this photo?
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => onUpdate({ planConfirmed: true })}>
                      <Icon.Check size={14} /> Yes, that is this room
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

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
                  <button type="button" onClick={() => onUpdate({ type: a.roomType })} className="ease-audora chip border-ink/25 font-semibold text-ink transition-colors duration-200 hover:border-ink hover:bg-surface">
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

/* ---------- what to photograph ----------
 * docs/ACCURACY.md 3.4. Two to four angles per room, and the three that matter are named: a corner,
 * the doorway, the opposite corner. Said before the drop zone, because the shot is taken in the
 * room and the leasing team is standing in it. */

function AngleGuidance() {
  return (
    <div className="panel flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <span className="text-ink">
          <Icon.Camera size={16} />
        </span>
        <div className="micro">Two to four angles per room</div>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-2">
        One photograph has no parallax: the model has to invent the far wall. Two views triangulate it, three pin it. Shoot the same room from the three places below — phone
        sideways, nothing moved between shots — and add them all to one room.
      </p>
      <ol className="grid gap-2 sm:grid-cols-3">
        {ANGLE_PLAN.slice(0, 3).map((slot, i) => (
          <li key={slot.key} className="flex gap-2.5 rounded-xl border border-line bg-surface p-3">
            <span className="mono mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-2 text-[11px] text-ink-2">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{slot.label}</span>
              <span className="block text-[11.5px] leading-snug text-ink-3">{slot.hint}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- the quality gate ----------
 * A poor primary photo is the one failure that is invisible until the world comes back wrong, so it
 * blocks the room. "Use anyway" is on the record (`photoAccepted`) and is cleared the moment the
 * primary photo changes, so the decision is always about the shot on screen. */

function QualityGate({ intake, onAccept }: { intake: RoomIntake; onAccept: (v: boolean | undefined) => void }) {
  const { verdict, accepted, blocked, angles } = intake;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={verdict.level === 'good' ? 'ok' : verdict.level === 'fair' ? 'warn' : 'danger'}>
          {verdict.level === 'good' ? <Icon.Check size={12} /> : <Icon.Warning size={12} />}
          {verdict.headline}
        </Chip>
        <Chip mono tone={angles.recommended ? 'ok' : angles.enough ? 'neutral' : 'warn'} className="!text-[10px]">
          {intake.photos} of {RECOMMENDED_ANGLES} angles
        </Chip>
        {wantsReconstruction(intake.photos) ? (
          <Chip mono className="!text-[10px]">
            multi-image
          </Chip>
        ) : null}
        {accepted ? (
          <Chip tone="warn" className="!text-[10px] uppercase">
            used anyway
          </Chip>
        ) : null}
      </div>
      {verdict.reasons.length ? (
        <ul className="flex flex-col gap-0.5 text-[11.5px] text-ink-3">
          {verdict.reasons.map((r, i) => (
            <li key={i}>· {r}</li>
          ))}
        </ul>
      ) : null}
      {!angles.recommended ? <div className="text-[11.5px] text-ink-3">{angles.text}</div> : null}
      {blocked ? (
        <Callout tone="danger" title="This room is blocked">
          <div className="flex flex-wrap items-center gap-2">
            <span>Retake the primary photo and drop it in above, or say so explicitly:</span>
            <Button size="sm" variant="secondary" onClick={() => onAccept(true)}>
              Use anyway, accuracy will suffer
            </Button>
          </div>
        </Callout>
      ) : null}
      {accepted ? (
        <button type="button" onClick={() => onAccept(undefined)} className="self-start text-[11px] text-ink-3 hover:text-ink">
          Undo “use anyway” and block this room again
        </button>
      ) : null}
    </div>
  );
}

/* ---------- plan says / photo shows ---------- */

/** One tap to take the plan room whose name this photo already looks like. Never automatic. */
function PlanSuggestion({
  room,
  planRooms,
  taken,
  onMatchPlan,
}: {
  room: DraftRoom;
  planRooms: FlatPlanRoom[];
  taken: Set<string>;
  onMatchPlan: (key: string | undefined) => void;
}) {
  const suggestion = suggestPlanRoom(room, planRooms, taken);
  if (!suggestion) return null;
  return (
    <button
      type="button"
      onClick={() => onMatchPlan(planRoomRef(suggestion).key)}
      className="ease-audora chip self-start border-ink/25 font-semibold text-ink transition-colors duration-200 hover:border-ink hover:bg-surface-2"
    >
      <Icon.Sparkles size={12} /> Looks like {suggestion.floor} · {suggestion.name}
      {metricText(suggestion) ? ` — ${metricText(suggestion)}` : ''}
    </button>
  );
}

/**
 * The unit's confirmation table: every room, what the plan says about it, what photo it was matched
 * to, and whether the leasing team has said yes. It is the summary; the per-room card is where the yes is
 * given, so this only counts and links.
 */
function PlanConfirmation({ rooms, planRooms, onUpdate }: { rooms: DraftRoom[]; planRooms: FlatPlanRoom[]; onUpdate: (id: string, patch: Partial<DraftRoom>) => void }) {
  const allRows = planPhotoRows(rooms);
  const rows = allRows.filter((r) => r.state !== 'unmatched' || r.thumbnail);
  const pending = allRows.filter((r) => r.state === 'unconfirmed');
  /* Only a pairing that has dimensions to confirm can be confirmed. Counting the rest on the
     confirmed side of the fraction read "19 of 19 confirmed" before the leasing team had touched one —
     on a plan whose 19 rooms printed no dimensions at all, so none of them was confirmable. */
  const confirmable = allRows.filter((r) => r.state === 'confirmed' || r.state === 'unconfirmed');
  const unused = planRooms.filter((p) => !rooms.some((r) => r.planRoom?.key === p.key));
  if (!rows.length) return null;
  return (
    <div className="panel flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="micro">Plan says · photo shows</div>
        <span className="mono text-[11px] text-ink-3">
          {confirmable.length ? `${confirmable.length - pending.length} of ${confirmable.length} confirmed` : 'nothing to confirm — the plan printed no dimensions'}
        </span>
      </div>
      <p className="text-[12.5px] text-ink-3">
        The plan’s metres become the room’s geometry and its anchor, so the pairing has to be right. A wrong pairing is the disagreement fusion flags later as “plan says
        3.75 m, model measures 3.41 m”.
      </p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <PlanConfirmRow key={row.roomId} row={row} onConfirm={() => onUpdate(row.roomId, { planConfirmed: true })} />
        ))}
      </ul>
      {unused.length ? (
        <div className="text-[11.5px] text-ink-3">
          <span className="text-ink-2">{unused.length}</span> plan room{unused.length === 1 ? '' : 's'} with no photo yet: {unused.map((p) => p.name).join(', ')}. They can
          still be generated from the plan’s dimensions alone.
        </div>
      ) : null}
    </div>
  );
}

function PlanConfirmRow({ row, onConfirm }: { row: PlanPhotoRow; onConfirm: () => void }) {
  const tone = row.state === 'confirmed' ? 'ok' : row.state === 'unconfirmed' ? 'warn' : 'neutral';
  return (
    <li className="grid items-center gap-3 rounded-xl border border-line bg-surface p-2 sm:grid-cols-[56px_minmax(0,1fr)_auto]">
      <div className="h-10 w-14 overflow-hidden rounded-lg border border-line bg-bg">
        {row.thumbnail ? (
          <img src={row.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-3">
            <Icon.Ruler size={14} />
          </div>
        )}
      </div>
      {/* The room's identity leads. Without it every row of a plan that printed no dimensions is the
          same two sentences, and the leasing team is asked to confirm a pairing the row never names. */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-[12.5px] font-medium text-ink">{row.roomName}</span>
          {row.planRoomName && row.planRoomName !== row.roomName ? <span className="truncate text-[11px] text-ink-3">on the plan: {row.planRoomName}</span> : null}
          {row.planFloor ? <span className="mono shrink-0 text-[10.5px] text-faint">{row.planFloor}</span> : null}
        </div>
        <div className="mono truncate text-[11.5px] text-ink-2">{row.planLine}</div>
        <div className="truncate text-[11.5px] text-ink-3">{row.photoLine}</div>
      </div>
      {row.state === 'unconfirmed' ? (
        <Button size="sm" variant="secondary" onClick={onConfirm}>
          <Icon.Check size={14} /> Confirm
        </Button>
      ) : (
        <Chip tone={tone} className="!text-[10px] uppercase">
          {row.state === 'confirmed' ? 'confirmed' : row.state === 'no-dimensions' ? 'no dimensions' : 'not on the plan'}
        </Chip>
      )}
    </li>
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

/* ---------- more angles of the same room ----------
 * Marble reconstructs a room better from several views than from one, and a listing already has
 * them. Up to six photos per room go up as one multi-image prompt; the first is the primary — the
 * shot the anchor is tapped on and the one the others are angled against. Saying which way an angle
 * faces is optional: an unlabelled angle lets Marble work the arrangement out, which beats a wrong
 * hint. */

const ANGLE_ORDER: PhotoAngle[] = ['left', 'centre', 'right', 'back'];

function PhotoAngles({
  room,
  photos,
  onAddAngle,
  onRemovePhoto,
  onPhotoAngle,
}: {
  room: DraftRoom;
  photos: ReturnType<typeof draftPhotos>;
  onAddAngle?: (files: File[]) => void;
  onRemovePhoto?: (index: number) => void;
  onPhotoAngle?: (index: number, angle: PhotoAngle | undefined) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  if (!onAddAngle) return null;
  // The demo photo is drawn in the browser; extra angles of it would mean nothing.
  if (room.synthetic) return null;
  const extra = photos.slice(1);
  const next = ANGLE_PLAN[photos.length];

  return (
    <div className="flex flex-col gap-2">
      {extra.length ? (
        <div className="flex flex-col gap-1.5">
          {extra.map((p, i) => {
            const index = i + 1;
            return (
              <div key={index} className="flex items-center gap-2 rounded-lg border border-line bg-surface p-1.5">
                <img src={p.dataUrl} alt="" className="h-10 w-14 shrink-0 rounded object-cover" draggable={false} />
                <Select
                  value={p.angle ?? ''}
                  onChange={(e) => onPhotoAngle?.(index, (e.target.value || undefined) as PhotoAngle | undefined)}
                  aria-label={`Which way angle ${index} faces`}
                  className="h-8 min-w-0 flex-1 !text-[11px]"
                >
                  <option value="">Angle {index} · let Marble decide</option>
                  {ANGLE_ORDER.map((a) => (
                    <option key={a} value={a}>
                      {ANGLE_LABELS[a]}
                    </option>
                  ))}
                </Select>
                <IconButton label={`Remove angle ${index}`} onClick={() => onRemovePhoto?.(index)} className="shrink-0 hover:border-danger/40 hover:text-danger">
                  <Icon.X size={14} />
                </IconButton>
              </div>
            );
          })}
        </div>
      ) : null}
      {/* The button names the shot that is missing, so "add another angle" becomes an instruction. */}
      <Button
        variant={next && photos.length < MIN_ANGLES ? 'secondary' : 'ghost'}
        size="sm"
        disabled={!canAddPhoto(room)}
        onClick={() => fileRef.current?.click()}
        className="w-full justify-center"
        title={next?.hint}
      >
        <Icon.Plus size={14} /> {next ? next.label : 'Add another angle'} · <span className="mono">{photos.length} of {MAX_ROOM_PHOTOS}</span>
      </Button>
      {next ? <span className="text-[11px] leading-snug text-ink-3">{next.hint}</span> : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files || [])].filter((f) => f.type.startsWith('image/'));
          if (files.length) onAddAngle(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/* ---------- photo URLs copied off the listing ----------
 * The unit's own listing page already carries twenty photographs. The browser cannot read them (listing
 * CDNs send no CORS header), so the URLs go to the dev server's /api/fetch-image proxy, which fetches
 * one image at a time with an 8 MB cap and refuses anything that is not an image. Audora never
 * touches the listing page itself. */

function PhotoUrlBox({ onSubmit, state }: { onSubmit: (text: string) => void; state?: UrlImportState | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const lines = text.split(/[\s,]+/).filter((s) => /^https?:\/\//i.test(s.trim())).length;
  return (
    <div className="panel p-5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <div className="flex items-center gap-3">
          <span className="text-ink">
            <Icon.Link size={18} />
          </span>
          <div>
            <div className="text-sm font-medium text-ink">Paste photo URLs from the listing</div>
            <div className="text-xs text-ink-3">One per line. Right-click a photo on Zillow, Redfin or Compass → Copy image address.</div>
          </div>
        </div>
        <Icon.ChevronDown size={18} className={cx('text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={'https://photos.zillowstatic.com/fp/….jpg\nhttps://ssl.cdn-redfin.com/photo/….jpg'}
            aria-label="Listing-page photo URLs, one per line"
            className="mono w-full resize-y rounded-[10px] border border-line-2 bg-bg px-3 py-2 text-xs text-ink outline-none placeholder:text-faint focus:border-ink"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={!lines || state?.running}
              loading={state?.running}
              onClick={() => {
                onSubmit(text);
                setText('');
              }}
            >
              <Icon.Download size={14} /> Fetch {lines || ''} photo{lines === 1 ? '' : 's'}
            </Button>
            {state?.running ? (
              <span className="mono text-xs text-ink-3">
                {state.done} of {state.total} fetched…
              </span>
            ) : null}
            <span className="text-xs text-ink-3">Each photo becomes a room; match it to the floor plan below.</span>
          </div>
          {state?.errors.length ? (
            <ul className="flex flex-col gap-1 text-xs text-warn">
              {state.errors.slice(0, 4).map((e, i) => (
                <li key={i} className="truncate">
                  · {e.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
