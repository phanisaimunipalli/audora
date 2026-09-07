import { useMemo } from 'react';
import type { AnchorSpec, PlacedPiece, RoomGeometry } from '@/engine/types';
import { catalogItem } from '@/engine/catalog';
import { clampToRoom, wallGaps } from '@/engine/geometry';
import type { WallSide } from '@/engine/types';
import { KindGlyph } from '@/components/CatalogRail';
import { Icon } from '@/components/icons';
import { Button, Chip, IconButton, cx } from '@/components/ui';
import type { PieceStatus } from '@/three/furniture/FurniturePiece';
import { degrees } from '@/three/furniture/floor';
import { m } from '@/lib/format';

export interface InspectorProps {
  piece: PlacedPiece;
  room: RoomGeometry;
  anchor?: AnchorSpec;
  status?: PieceStatus;
  onChange: (next: PlacedPiece) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Slider drags collapse into one undo step. */
  onBeginGesture?: () => void;
  onEndGesture?: () => void;
  className?: string;
}

const STATUS_LABEL: Record<PieceStatus, { text: string; tone: 'ok' | 'danger' | 'warn' }> = {
  ok: { text: 'fits', tone: 'ok' },
  overlap: { text: 'overlaps', tone: 'danger' },
  outside: { text: 'outside the room', tone: 'danger' },
  door: { text: 'blocks the door', tone: 'warn' },
};

/** "220 × 95 × 85 cm", or "240 × 170 cm" for flat pieces. */
function itemDims(p: Pick<PlacedPiece, 'w' | 'd' | 'h' | 'flat'>): string {
  const w = Math.round(p.w * 100);
  const d = Math.round(p.d * 100);
  return p.flat ? `${w} × ${d} cm` : `${w} × ${d} × ${Math.round(p.h * 100)} cm`;
}

const WALL_NAME: Record<WallSide, string> = { north: 'north', south: 'south', east: 'east', west: 'west' };

/** The selected piece: what it is, how big it is, where it sits, and how to turn or remove it. */
export function Inspector({ piece, room, status = 'ok', onChange, onDelete, onDuplicate, onBeginGesture, onEndGesture, className }: InspectorProps) {
  const item = useMemo(() => catalogItem(piece.itemId), [piece.itemId]);
  const gaps = useMemo(() => wallGaps(piece, room), [piece, room]);
  const nearest = useMemo(() => (Object.keys(gaps) as WallSide[]).sort((a, b) => gaps[a] - gaps[b]).slice(0, 2), [gaps]);
  const deg = degrees(piece.rot);
  const buyer = piece.owner === 'buyer';
  const st = STATUS_LABEL[status];

  const setRot = (d: number) => onChange(clampToRoom({ ...piece, rot: (d * Math.PI) / 180 }, room) as PlacedPiece);

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <div className="flex items-start gap-3">
        <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border', buyer ? 'border-buyer-line bg-buyer-soft text-buyer' : 'border-line-2 bg-surface text-ink-2')}>
          <KindGlyph kind={piece.kind} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium text-ink">{piece.name}</div>
          <div className="mono text-[12px] text-ink-2">{itemDims(piece)}</div>
        </div>
        <Chip tone={st.tone} className="!text-[10px] uppercase tracking-wider">
          {st.text}
        </Chip>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {buyer ? <Chip tone="buyer">buyer's piece</Chip> : <Chip>seller staging</Chip>}
        <Chip tone={piece.verified ? 'ok' : 'neutral'}>{piece.verified ? 'verified dimensions' : 'reference dimensions'}</Chip>
        {piece.flat ? <Chip>flat · never collides</Chip> : null}
      </div>
      {item?.source ? <p className="text-[12px] leading-snug text-dim">{item.source}</p> : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="micro">Rotation</span>
          <span className="mono text-[12px] text-ink-2">{deg}°</span>
        </div>
        <input
          type="range"
          min={0}
          max={359}
          step={1}
          value={deg}
          onPointerDown={onBeginGesture}
          onPointerUp={onEndGesture}
          onKeyDown={onBeginGesture}
          onKeyUp={onEndGesture}
          onBlur={onEndGesture}
          onChange={(e) => setRot(Number(e.target.value))}
          className="w-full accent-accent"
          aria-label="Rotation in degrees"
        />
        <div className="grid grid-cols-4 gap-1">
          {[0, 90, 180, 270].map((d) => (
            <button key={d} type="button" onClick={() => setRot(d)} className={cx('mono h-7 rounded-lg border text-[11px] transition-colors duration-200 ease-audora', deg === d ? 'border-accent bg-accent text-white' : 'border-line-2 bg-bg text-ink-2 hover:border-ink-2 hover:text-ink')}>
              {d}°
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="micro">Position</span>
        <div className="grid grid-cols-2 gap-1.5">
          {nearest.map((w) => (
            <div key={w} className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-dim">{WALL_NAME[w]} wall</div>
              <div className={cx('mono text-[13px]', gaps[w] < -0.001 ? 'text-danger' : gaps[w] < 0.02 ? 'text-dim' : 'text-ink')}>{gaps[w] < 0.02 && gaps[w] > -0.001 ? 'flush' : m(gaps[w])}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <IconButton label="Rotate 90°" onClick={() => setRot((deg + 90) % 360)}>
          <Icon.Rotate size={16} />
        </IconButton>
        <IconButton label="Duplicate" onClick={onDuplicate}>
          <Icon.Copy size={16} />
        </IconButton>
        <Button variant="danger" size="sm" onClick={onDelete} className="ml-auto">
          <Icon.Trash size={14} /> Delete
        </Button>
      </div>
    </div>
  );
}
