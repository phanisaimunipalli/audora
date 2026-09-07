import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import type { CatalogItem, PieceOwner, PlacedPiece, RoomGeometry } from '@/engine/types';
import { clampToRoom, snapRotation, snapToWalls } from '@/engine/geometry';
import { pieceStatus } from '@/engine/fit';
import { makePiece, pieceId } from '@/engine/autostage';
import { FurniturePiece, type PieceStatus } from './FurniturePiece';
import { RotationHandle } from './RotationHandle';
import { capture, floorPoint, inTextField, throttle, wrapAngle, DRAG_FLOOR_LIMITS } from './floor';
import { ACCENT, BUYER_BLUE } from './palette';

export interface StagingLayerProps {
  room: RoomGeometry;
  /** Seller staging. */
  pieces: PlacedPiece[];
  /** Buyer's own pieces, drawn in the buyer colour; also editable when `editable`. */
  buyerPieces?: PlacedPiece[];
  editable?: boolean;
  /** Hide seller staging (buyer "see it bare" toggle) while keeping buyer pieces. */
  showSeller?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Called continuously while dragging / rotating. Receives the full updated list for the owner being edited. */
  onChange?: (pieces: PlacedPiece[], owner: 'seller' | 'buyer') => void;
  /** Floor pointer position, for collaboration cursors. */
  onFloorPointer?: (p: { x: number; z: number } | null) => void;

  /* ---- optional extras ---- */
  /** Keep seller staging fixed even when editable (public buyer view: only the buyer's pieces move). */
  lockSeller?: boolean;
  /** Catalog item being placed: a ghost follows the pointer on the floor until a click (or Enter) places it. */
  placing?: CatalogItem | null;
  placingOwner?: PieceOwner;
  /** The ghost was placed. `onChange` has already delivered the new list. */
  onPlaced?: (piece: PlacedPiece) => void;
  /** Escape while placing. */
  onCancelPlacing?: () => void;
  /** Drag-to-place: releasing the pointer over the floor places the ghost (instead of waiting for a click). */
  placeOnRelease?: boolean;
  onHover?: (id: string | null) => void;
  /** A drag / rotation gesture starts or ends — lets the editor coalesce one gesture into one undo step. */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** Wall snap threshold in metres (Alt disables snapping). */
  snap?: number;
  /**
   * Draw a soft contact shadow under every solid piece. On whenever the pieces stand on a real
   * capture rather than on our own floor, which has none of its own.
   */
  contactShadows?: boolean;
}

interface DragState {
  id: string;
  owner: PieceOwner;
  pointerId: number;
  offset: { x: number; z: number };
  moved: boolean;
}

const CLICK_SLOP_PX = 4;

interface PieceApi {
  down: (piece: PlacedPiece, e: ThreeEvent<PointerEvent>) => void;
  move: (piece: PlacedPiece, e: ThreeEvent<PointerEvent>) => void;
  up: (piece: PlacedPiece, e: ThreeEvent<PointerEvent>) => void;
  over: (piece: PlacedPiece, e: ThreeEvent<PointerEvent>) => void;
  out: (piece: PlacedPiece, e: ThreeEvent<PointerEvent>) => void;
  click: (piece: PlacedPiece, e: ThreeEvent<MouseEvent>) => void;
}

/** Binds one piece to the shared handler table with stable callbacks so FurniturePiece's memo holds. */
const PieceView = memo(function PieceView({ piece, status, selected, hovered, contact, api }: { piece: PlacedPiece; status: PieceStatus; selected: boolean; hovered: boolean; contact?: boolean; api: PieceApi }) {
  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => api.down(piece, e), [api, piece]);
  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => api.move(piece, e), [api, piece]);
  const onPointerUp = useCallback((e: ThreeEvent<PointerEvent>) => api.up(piece, e), [api, piece]);
  const onPointerOver = useCallback((e: ThreeEvent<PointerEvent>) => api.over(piece, e), [api, piece]);
  const onPointerOut = useCallback((e: ThreeEvent<PointerEvent>) => api.out(piece, e), [api, piece]);
  const onClick = useCallback((e: ThreeEvent<MouseEvent>) => api.click(piece, e), [api, piece]);
  return (
    <FurniturePiece
      piece={piece}
      status={status}
      selected={selected}
      hovered={hovered}
      contact={contact}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onClick={onClick}
    />
  );
});

/**
 * Interactive staging. Drag on the floor (clamped to the room, snapped to walls within 12 cm unless Alt),
 * rotate with R / [ / ] or the handle, Backspace deletes, Cmd/Ctrl+D duplicates, arrows nudge, Escape deselects.
 * Every piece is re-validated continuously with pieceStatus so it turns red the moment it overlaps.
 * Works with a single touch pointer. Orbit controls are paused while dragging.
 */
export function StagingLayer(props: StagingLayerProps) {
  const { room, pieces, buyerPieces = [], editable = false, showSeller = true, selectedId, placing = null, placingOwner = 'seller', snap = 0.12, contactShadows = false } = props;
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const gl = useThree((s) => s.gl);

  const controlled = selectedId !== undefined;
  const [internalSel, setInternalSel] = useState<string | null>(null);
  const sel = controlled ? selectedId : internalSel;
  const [hover, setHover] = useState<string | null>(null);
  /** The piece being dragged, ahead of the parent's state. */
  const [live, setLive] = useState<PlacedPiece | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; z: number } | null>(null);
  const [ghostRot, setGhostRot] = useState(0);
  const drag = useRef<DragState | null>(null);

  // Latest props/state for the stable handler table.
  const latest = useRef({ ...props, sel, controls, live });
  latest.current = { ...props, sel, controls, live };

  const select = useCallback(
    (id: string | null) => {
      if (!controlled) setInternalSel(id);
      latest.current.onSelect?.(id);
    },
    [controlled],
  );

  const canEdit = useCallback((owner: PieceOwner) => {
    const L = latest.current;
    return Boolean(L.editable) && (owner === 'buyer' || !L.lockSeller);
  }, []);

  /** Push an updated piece into its owner's list and hand the list to the parent. */
  const emit = useCallback((next: PlacedPiece) => {
    const L = latest.current;
    const list = next.owner === 'buyer' ? L.buyerPieces ?? [] : L.pieces;
    L.onChange?.(
      list.map((p) => (p.id === next.id ? next : p)),
      next.owner,
    );
  }, []);

  const findPiece = useCallback((id: string | null): PlacedPiece | undefined => {
    const L = latest.current;
    if (!id) return undefined;
    if (L.live && L.live.id === id) return L.live;
    return L.pieces.find((p) => p.id === id) ?? (L.buyerPieces ?? []).find((p) => p.id === id);
  }, []);

  const settle = useCallback(
    (f: PlacedPiece, alt: boolean): PlacedPiece => {
      const L = latest.current;
      let next = clampToRoom(f, L.room) as PlacedPiece;
      if (!alt) next = clampToRoom(snapToWalls(next, L.room, L.snap ?? snap), L.room) as PlacedPiece;
      return next;
    },
    [snap],
  );

  const setCursor = useCallback(
    (c: string) => {
      gl.domElement.style.cursor = c;
    },
    [gl],
  );

  /* ---------- ghost placement ---------- */

  const ghostBase = useMemo(() => (placing ? makePiece(placing, 0, 0, 0, placingOwner) : null), [placing, placingOwner]);
  useEffect(() => {
    setGhostRot(0);
    setGhostPos(null);
  }, [placing]);
  const ghost = useMemo(() => {
    if (!ghostBase) return null;
    const at = ghostPos ?? { x: 0, z: 0 };
    return settle({ ...ghostBase, x: at.x, z: at.z, rot: ghostRot }, false);
  }, [ghostBase, ghostPos, ghostRot, settle]);
  const ghostRef = useRef<PlacedPiece | null>(null);
  ghostRef.current = ghost;
  const ghostBaseRef = useRef(ghostBase);
  ghostBaseRef.current = ghostBase;
  const ghostRotRef = useRef(ghostRot);
  ghostRotRef.current = ghostRot;

  /** Place the ghost; with `at`, place at that floor point even if the pointer never hovered the floor first. */
  const placeGhost = useCallback((at?: { x: number; z: number }) => {
    const L = latest.current;
    const base = ghostBaseRef.current;
    const g = at && base ? settle({ ...base, x: at.x, z: at.z, rot: ghostRotRef.current }, false) : ghostRef.current;
    if (!L.placing || !g) return;
    const piece = makePiece(L.placing, g.x, g.z, g.rot, L.placingOwner ?? 'seller');
    const list = piece.owner === 'buyer' ? L.buyerPieces ?? [] : L.pieces;
    L.onChange?.([...list, piece], piece.owner);
    L.onPlaced?.(piece);
    select(piece.id);
    setGhostPos(null);
  }, [select, settle]);

  /* ---------- piece handlers ---------- */

  const api = useMemo<PieceApi>(
    () => ({
      down(piece, e) {
        const L = latest.current;
        if (L.placing) {
          e.stopPropagation();
          const fp = floorPoint(e.ray);
          placeGhost(fp ?? undefined);
          return;
        }
        e.stopPropagation();
        select(piece.id);
        if (!canEdit(piece.owner)) return;
        if (e.button !== 0) return;
        const fp = floorPoint(e.ray);
        if (!fp) return;
        drag.current = { id: piece.id, owner: piece.owner, pointerId: e.pointerId, offset: { x: piece.x - fp.x, z: piece.z - fp.z }, moved: false };
        capture(e, 'set');
        if (L.controls) L.controls.enabled = false;
        setCursor('grabbing');
      },
      move(piece, e) {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId || d.id !== piece.id) return;
        // Near the horizon a pixel is worth metres of floor, so the drag stops following rather than
        // flinging the piece across the room. Lower the pointer and it picks up again.
        const fp = floorPoint(e.ray, DRAG_FLOOR_LIMITS);
        if (!fp) return;
        const raw = { ...piece, x: fp.x + d.offset.x, z: fp.z + d.offset.z };
        if (!d.moved) {
          if (Math.hypot(raw.x - piece.x, raw.z - piece.z) < 0.004) return;
          d.moved = true;
          latest.current.onGestureStart?.();
        }
        const next = settle(raw, e.altKey);
        setLive(next);
        emit(next);
      },
      up(_piece, e) {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        drag.current = null;
        capture(e, 'release');
        const L = latest.current;
        if (L.controls) L.controls.enabled = true;
        setCursor(hover ? 'grab' : '');
        setLive(null);
        if (d.moved) L.onGestureEnd?.();
      },
      over(piece, e) {
        e.stopPropagation();
        if (drag.current) return;
        setHover(piece.id);
        latest.current.onHover?.(piece.id);
        if (!latest.current.placing) setCursor(canEdit(piece.owner) ? 'grab' : 'pointer');
      },
      out(piece) {
        setHover((h) => (h === piece.id ? null : h));
        latest.current.onHover?.(null);
        if (!drag.current) setCursor('');
      },
      click(_piece, e) {
        // Selection happens on pointer down; the click only needs to stay off the floor's deselect.
        e.stopPropagation();
      },
    }),
    [canEdit, emit, placeGhost, select, setCursor, settle, hover],
  );

  /* ---------- floor ---------- */

  const pointerThrottled = useMemo(() => throttle((p: { x: number; z: number } | null) => latest.current.onFloorPointer?.(p), 60), []);
  useEffect(() => () => pointerThrottled.cancel(), [pointerThrottled]);

  const floorMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const fp = { x: e.point.x, z: e.point.z };
      pointerThrottled(fp);
      if (latest.current.placing) setGhostPos(fp);
    },
    [pointerThrottled],
  );
  const floorLeave = useCallback(() => {
    pointerThrottled.cancel();
    latest.current.onFloorPointer?.(null);
    if (latest.current.placing) setGhostPos(null);
  }, [pointerThrottled]);
  const floorClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (e.delta > CLICK_SLOP_PX) return;
      // Place where the click landed: a click with no prior hover has no ghost position yet.
      if (latest.current.placing) placeGhost({ x: e.point.x, z: e.point.z });
      else select(null);
    },
    [placeGhost, select],
  );
  const floorUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const L = latest.current;
      if (!L.placing || !L.placeOnRelease) return;
      placeGhost({ x: e.point.x, z: e.point.z });
    },
    [placeGhost],
  );

  /* ---------- keyboard ---------- */

  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e)) return;
      const L = latest.current;
      if (e.key === 'Escape') {
        if (L.placing) {
          L.onCancelPlacing?.();
          setGhostPos(null);
        } else if (L.sel) select(null);
        return;
      }
      if (L.placing) {
        if (e.key === 'r' || e.key === 'R') setGhostRot((r) => wrapAngle(r + Math.PI / 2));
        else if (e.key === '[') setGhostRot((r) => wrapAngle(r - Math.PI / 12));
        else if (e.key === ']') setGhostRot((r) => wrapAngle(r + Math.PI / 12));
        else if (e.key === 'Enter') placeGhost();
        return;
      }
      const piece = findPiece(L.sel);
      if (!piece || !canEdit(piece.owner)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const list = piece.owner === 'buyer' ? L.buyerPieces ?? [] : L.pieces;
        const copy = settle({ ...piece, id: pieceId(piece.owner === 'buyer' ? 'b' : 'p'), x: piece.x + 0.3, z: piece.z + 0.3 }, true);
        L.onChange?.([...list, copy], piece.owner);
        select(copy.id);
        return;
      }
      if (meta) return; // undo / redo belong to the editor
      const rotate = (rot: number) => emit(settle({ ...piece, rot: wrapAngle(rot) }, true));
      const nudge = (dx: number, dz: number) => {
        const step = e.shiftKey ? 0.1 : 0.01;
        emit(settle({ ...piece, x: piece.x + dx * step, z: piece.z + dz * step }, true));
      };
      switch (e.key) {
        case 'r':
        case 'R':
          rotate(snapRotation(piece.rot + Math.PI / 2, Math.PI / 2));
          break;
        case '[':
          rotate(piece.rot - Math.PI / 12);
          break;
        case ']':
          rotate(piece.rot + Math.PI / 12);
          break;
        case 'Backspace':
        case 'Delete': {
          e.preventDefault();
          const list = piece.owner === 'buyer' ? L.buyerPieces ?? [] : L.pieces;
          L.onChange?.(
            list.filter((p) => p.id !== piece.id),
            piece.owner,
          );
          select(null);
          break;
        }
        case 'ArrowLeft':
          e.preventDefault();
          nudge(-1, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          nudge(1, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          nudge(0, -1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          nudge(0, 1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, canEdit, emit, findPiece, placeGhost, select, settle]);

  // A mode switch mid-drag must not leave the orbit controls disabled.
  useEffect(() => {
    if (editable) return;
    if (drag.current) {
      drag.current = null;
      if (controls) controls.enabled = true;
      setLive(null);
      setCursor('');
    }
  }, [editable, controls, setCursor]);

  // Once the parent has adopted a change the live override is redundant.
  useEffect(() => {
    if (!drag.current) setLive(null);
  }, [pieces, buyerPieces]);

  /* ---------- derived ---------- */

  const visible = useMemo(() => {
    const list = [...(showSeller ? pieces : []), ...buyerPieces];
    return live ? list.map((p) => (p.id === live.id ? live : p)) : list;
  }, [pieces, buyerPieces, showSeller, live]);

  const statusById = useMemo(() => {
    const out: Record<string, PieceStatus> = {};
    for (const p of visible) out[p.id] = pieceStatus(p, visible, room);
    return out;
  }, [visible, room]);

  const ghostStatus = useMemo(() => (ghost ? pieceStatus(ghost, visible, room) : 'ok'), [ghost, visible, room]);

  const selPiece = sel ? visible.find((p) => p.id === sel) : undefined;
  const showHandle = Boolean(selPiece && editable && !placing && canEdit(selPiece!.owner) && !live);
  const handleColor = selPiece?.owner === 'buyer' ? BUYER_BLUE : ACCENT;

  return (
    <group>
      {/* Invisible floor catcher: pointer position, ghost placement and click-to-deselect. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} onPointerMove={floorMove} onPointerLeave={floorLeave} onPointerUp={floorUp} onClick={floorClick} receiveShadow={false}>
        <planeGeometry args={[room.width + 80, room.depth + 80]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {visible.map((p) => (
        <PieceView key={p.id} piece={p} status={statusById[p.id] ?? 'ok'} selected={sel === p.id} hovered={hover === p.id && !placing} contact={contactShadows} api={api} />
      ))}
      {ghost ? <FurniturePiece piece={ghost} ghost status={ghostStatus} /> : null}
      {showHandle && selPiece ? (
        <RotationHandle
          piece={selPiece}
          color={handleColor}
          onStart={() => latest.current.onGestureStart?.()}
          onRotate={(rot) => {
            const cur = findPiece(selPiece.id);
            if (cur) emit(settle({ ...cur, rot: wrapAngle(rot) }, true));
          }}
          onEnd={() => latest.current.onGestureEnd?.()}
        />
      ) : null}
    </group>
  );
}
