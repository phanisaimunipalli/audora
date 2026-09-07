import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { STYLE_LABELS, type StagingStyle } from '@/engine/autostage';
import type { Peer } from '@/state/collab';
import type { Room } from '@/state/types';
import type { AiMeta } from '@/services/ai';
import type { ViewMode } from '@/three/viewerStore';
import { AnchorChip } from '@/components/AnchorChip';
import { Icon } from '@/components/icons';
import { Button, Chip, Spinner, cx } from '@/components/ui';
import { HudPill, PillDivider, TierTag, TopBar as HudTopBar, Wordmark, tierWord } from '@/screens/viewer/hud';
import { usd } from '@/lib/format';

export interface AutoStageMeta extends AiMeta {
  dropped?: number;
  rationale?: string;
}

export interface TopBarProps {
  tourId: string;
  tourTitle: string;
  room: Room;
  rooms: Room[];
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  style: StagingStyle;
  autoStaging: boolean;
  autoMeta: AutoStageMeta | null;
  onAutoStage: (style: StagingStyle) => void;
  onClear: () => void;
  onDone: () => void;
  peers: Peer[];
  self: Peer;
  compact?: boolean;
  /** This room has a panorama, so Photo joins Orbit / Walk — the same choice the buyer gets. */
  hasPhoto?: boolean;
  /** Extra pills for the right-hand group (the layers and the hour of the day). */
  extraPills?: ReactNode;
}

/**
 * Click-outside + Escape aware menu anchored under its trigger. It is portalled to `document.body` and
 * positioned from the trigger's rect: the editor is a stack of positioned panels over a canvas, and any
 * in-flow `absolute` menu ends up painted underneath one of them.
 */
function Popover({
  open,
  onClose,
  children,
  align = 'left',
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left?: number; right?: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = r.bottom + 6;
      setBox({
        top,
        ...(align === 'right' ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) }),
        maxHeight: Math.max(160, window.innerHeight - top - 12),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, align, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !box || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="popover animate-rise fixed z-[90] min-w-56 max-w-[min(92vw,22rem)] overflow-y-auto rounded-2xl p-1.5"
      style={{ top: box.top, left: box.left, right: box.right, maxHeight: box.maxHeight }}
    >
      {children}
    </div>,
    document.body,
  );
}

const STYLE_HINT: Record<StagingStyle, string> = {
  warm: 'Layered textures, a rug, a shelf, plants.',
  minimal: 'Fewer pieces, quiet tones, clear floor.',
  scandi: 'Light woods, pale fabrics, airy.',
  family: 'Sofa for everyone, storage, sturdy.',
};

function RoomSwitcher({ tourId, room, rooms, compact }: { tourId: string; room: Room; rooms: Room[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const nav = useNavigate();
  return (
    <div className="relative min-w-0">
      <button ref={trigger} type="button" onClick={() => setOpen((o) => !o)} className="flex max-w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-surface">
        <span className="display min-w-0 truncate text-[19px] leading-none text-ink">{room.name}</span>
        {!compact ? (
          <span className="mono hidden text-[11px] text-dim sm:inline">
            {room.geometry.width.toFixed(2)} × {room.geometry.depth.toFixed(2)} m
          </span>
        ) : null}
        <Icon.ChevronDown size={14} className="shrink-0 text-faint" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={trigger}>
        <div className="micro px-2.5 pb-1 pt-1.5">Rooms in this tour</div>
        {rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => {
              setOpen(false);
              if (r.id !== room.id) nav(`/tours/${tourId}/stage/${r.id}`);
            }}
            className={cx('flex w-full items-center justify-between gap-4 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors', r.id === room.id ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink')}
          >
            <span className="truncate">{r.name}</span>
            <span className="mono shrink-0 text-[11px] text-dim">
              {r.geometry.width.toFixed(1)} × {r.geometry.depth.toFixed(1)} m · {r.staging.length} pcs
            </span>
          </button>
        ))}
      </Popover>
    </div>
  );
}

function AutoStageMenu({ style, busy, meta, onRun, compact }: { style: StagingStyle; busy: boolean; meta: AutoStageMeta | null; onRun: (s: StagingStyle) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative flex items-center gap-2">
      <Button ref={trigger} variant="primary" size="sm" onClick={() => setOpen((o) => !o)} disabled={busy} title="Auto-stage this room" className="!h-[30px]">
        {busy ? <Spinner size={14} /> : <Icon.Sparkles size={15} />}
        {compact ? null : <span>Auto-stage</span>}
        <Icon.ChevronDown size={13} className="opacity-70" />
      </Button>
      {meta && !compact ? (
        <span className="hidden xl:inline-flex" title={meta.rationale ?? (meta.source === 'heuristic' ? 'Rule-based stager (no model key, or the model proposal failed validation).' : 'Nebius Token Factory proposal, validated by the engine.')}>
          <Chip mono className="!text-[10px]">
            {meta.source}
            {meta.model ? ` · ${meta.model.split('/').pop()}` : ''} · {meta.ms}ms{meta.usd != null ? ` · ${usd(meta.usd)}` : ''}
            {meta.dropped ? ` · ${meta.dropped} dropped` : ''}
          </Chip>
        </span>
      ) : null}
      <Popover open={open} onClose={() => setOpen(false)} align="right" anchorRef={trigger}>
        <div className="micro px-2.5 pb-1 pt-1.5">Stage in a style</div>
        {(Object.keys(STYLE_LABELS) as StagingStyle[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setOpen(false);
              onRun(s);
            }}
            className={cx('flex w-full flex-col items-start gap-0.5 rounded-xl px-2.5 py-2 text-left transition-colors', s === style ? 'bg-accent-soft' : 'hover:bg-surface')}
          >
            <span className="text-[13.5px] font-semibold text-ink">{STYLE_LABELS[s]}</span>
            <span className="text-[11px] text-dim">{STYLE_HINT[s]}</span>
          </button>
        ))}
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-dim">Replaces the current staging. Undo brings it back.</div>
      </Popover>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function PresenceAvatars({ self, peers, max = 4 }: { self: Peer; peers: Peer[]; max?: number }) {
  const shown = peers.slice(0, max);
  return (
    <div className="flex items-center" title={peers.length ? `${peers.map((p) => p.name).join(', ')} ${peers.length === 1 ? 'is' : 'are'} in this room` : 'Only you here. Open this page in a second tab to stage together.'}>
      <span className="mono flex h-7 w-7 items-center justify-center rounded-full border-2 bg-bg text-[10px]" style={{ borderColor: self.color, color: self.color }}>
        {initials(self.name)}
      </span>
      {shown.map((p) => (
        <span key={p.id} className="mono -ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-bg text-[10px]" style={{ borderColor: p.color, color: p.color }}>
          {initials(p.name)}
        </span>
      ))}
      {peers.length > max ? <span className="mono -ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-line-2 bg-bg text-[10px] text-ink-2">+{peers.length - max}</span> : null}
      {peers.length ? <span className="ml-2 hidden text-[11px] text-dim lg:inline">{peers.length === 1 ? `${peers[0].name} is here` : `${peers.length} others here`}</span> : null}
    </div>
  );
}

/**
 * The editor's chrome: the same transparent bar the buyer's viewer wears — wordmark and tier on the
 * left, the black/white pill group on the right — so a seller stages inside the frame the buyer will
 * open.
 */
export function TopBar(p: TopBarProps) {
  const { compact } = p;
  const modes: { value: ViewMode; label: string; icon: ReactNode }[] = [
    ...(p.hasPhoto ? [{ value: 'photo' as ViewMode, label: 'Photo', icon: <Icon.Camera size={14} /> }] : []),
    { value: 'orbit' as ViewMode, label: 'Orbit', icon: <Icon.Orbit size={14} /> },
    { value: 'walk' as ViewMode, label: 'Walk', icon: <Icon.Walk size={14} /> },
  ];
  const tier = tierWord(p.room);
  return (
    <HudTopBar
      left={
        <>
          <Wordmark to={null} />
          {tier ? <TierTag className="hidden sm:inline">{tier}</TierTag> : null}
          <span className="hidden h-4 w-px shrink-0 bg-line-2 sm:block" aria-hidden />
          <RoomSwitcher tourId={p.tourId} room={p.room} rooms={p.rooms} compact={compact} />
          {!compact ? <AnchorChip anchor={p.room.anchor} size="sm" className="hidden xl:inline-flex" /> : null}
        </>
      }
      right={
        <>
          {/* On phones the mode switch lives in the bottom bar so the title keeps its room. */}
          {!compact
            ? modes.map((m) => (
                <HudPill key={m.value} active={p.mode === m.value} onClick={() => p.onMode(m.value)} icon={m.icon} title={`${m.label} view`}>
                  <span className="hidden lg:inline">{m.label}</span>
                </HudPill>
              ))
            : null}
          {p.extraPills}
          <PillDivider />
          <HudPill square onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo" title="Undo (⌘Z)">
            <Icon.Rotate size={15} style={{ transform: 'scaleX(-1)' }} />
          </HudPill>
          <HudPill square onClick={p.onRedo} disabled={!p.canRedo} aria-label="Redo" title="Redo (⇧⌘Z)">
            <Icon.Rotate size={15} />
          </HudPill>
          <AutoStageMenu style={p.style} busy={p.autoStaging} meta={p.autoMeta} onRun={p.onAutoStage} compact={compact} />
          {!compact ? (
            <HudPill onClick={p.onClear} title="Remove every piece (undoable)">
              Clear
            </HudPill>
          ) : null}
          {!compact ? <PresenceAvatars self={p.self} peers={p.peers} /> : null}
          {compact ? (
            <HudPill square onClick={p.onDone} aria-label="Done" title="Done">
              <Icon.Check size={16} />
            </HudPill>
          ) : (
            <HudPill onClick={p.onDone} icon={<Icon.Check size={14} />} title={`Back to ${p.tourTitle}`}>
              Done
            </HudPill>
          )}
        </>
      }
    />
  );
}
