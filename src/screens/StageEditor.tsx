import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CatalogItem, PlacedPiece } from '@/engine/types';
import { STYLE_LABELS, pieceId, type StagingStyle } from '@/engine/autostage';
import { fitReport, pieceStatus } from '@/engine/fit';
import { clampToRoom } from '@/engine/geometry';
import { bestWorld, selectRoom, toast, useAudora, useTourRooms } from '@/state/store';
import { useCollab } from '@/state/collab';
import type { Room, Tour } from '@/state/types';
import { aiAutoStage } from '@/services/ai';
import { useViewer, type ViewMode } from '@/three/viewerStore';
import { SceneCanvas } from '@/three/SceneCanvas';
import { RoomShell } from '@/three/RoomShell';
import { OrbitRig, PhotoRig } from '@/three/OrbitRig';
import { MarbleWorld, useMarbleFrame, type MarbleWorldStatus } from '@/three/MarbleWorld';
import { WalkControls } from '@/three/WalkControls';
import { StagingLayer } from '@/three/furniture/StagingLayer';
import { PeerCursors } from '@/three/furniture/PeerCursors';
import { inTextField, throttle } from '@/three/furniture/floor';
import { CatalogRail } from '@/components/CatalogRail';
import { FitReportPanel } from '@/components/FitReportPanel';
import { AnchorChip } from '@/components/AnchorChip';
import { Icon } from '@/components/icons';
import { Button, Chip, EmptyState, IconButton, Kbd, Segmented, StagedLabel, cx } from '@/components/ui';
import { TopBar, type AutoStageMeta } from './editor/TopBar';
import { Inspector } from './editor/Inspector';
import { ShortcutLegend } from './editor/ShortcutLegend';
import { BottomSheet } from './editor/BottomSheet';
import { Joystick } from './editor/Joystick';
import { useUndoStack } from './editor/useUndoStack';
import { useMediaQuery, useTouchDevice } from './editor/useMediaQuery';
import { floorOffsetOf, hasPano, isReal, layerLoading, layerReady, loadPill, type MarbleStatusMap } from './viewer/marble';

/** An empty stand-in so the Marble frame hook can be called for rooms with no reconstruction. */
const NO_WORLD = { metricScaleFactor: null, groundPlaneOffset: null, bounds: undefined } as const;

export interface StageEditorProps {
  tourId: string;
  roomId: string;
}

const PERSIST_MS = 150;

/**
 * Full-bleed staging editor for one room. Arrange in Orbit (dollhouse), judge in Walk (1.60 m eye height).
 * Local undo/redo, debounced persistence to the store, and live collaboration over BroadcastChannel
 * (open the same URL in two tabs: cursors, presence and staging sync).
 */
export function StageEditor({ tourId, roomId }: StageEditorProps) {
  const tour = useAudora((s) => s.tours[tourId]);
  const room = useAudora(selectRoom(roomId));
  const rooms = useTourRooms(tourId);
  if (!tour || !room) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg p-6">
        <EmptyState
          title="Room not found"
          body="This room is not in the tour any more, or the link is wrong."
          action={
            <Link to={tour ? `/tours/${tourId}` : '/tours'}>
              <Button variant="primary">Back to {tour ? tour.title : 'tours'}</Button>
            </Link>
          }
        />
      </div>
    );
  }
  // Keyed by room so switching rooms resets the undo stack, the collab channel and the camera.
  return <Editor key={room.id} tour={tour} room={room} rooms={rooms} />;
}

function Editor({ tour, room, rooms }: { tour: Tour; room: Room; rooms: Room[] }) {
  const roomId = room.id;
  const tourId = tour.id;
  const geometry = room.geometry;
  const navigate = useNavigate();
  const setStaging = useAudora((s) => s.setStaging);
  const mode = useViewer((s) => s.mode);
  const setMode = useViewer((s) => s.setMode);
  const selectedId = useViewer((s) => s.selectedId);
  const setSelectedId = useViewer((s) => s.setSelectedId);
  const setHoverId = useViewer((s) => s.setHoverId);
  const showGeometry = useViewer((s) => s.showGeometry);
  const setShowGeometry = useViewer((s) => s.setShowGeometry);
  const photoFov = useViewer((s) => s.photoFov);
  const setPhotoFov = useViewer((s) => s.setPhotoFov);
  const pose = useViewer((s) => s.pose);
  const isMobile = useMediaQuery('(max-width: 900px)');
  const touch = useTouchDevice();
  const collab = useCollab(roomId);
  const stack = useUndoStack<PlacedPiece[]>(room.staging);
  const present = stack.present;

  const [placing, setPlacing] = useState<CatalogItem | null>(null);
  const [placeOnRelease, setPlaceOnRelease] = useState(false);
  const [style, setStyle] = useState<StagingStyle>(room.stagingStyle);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMeta, setAutoMeta] = useState<AutoStageMeta | null>(null);
  const [sheet, setSheet] = useState<'catalog' | 'fit' | null>(null);
  const [marbleStatus, setMarbleStatus] = useState<MarbleStatusMap>({});
  const onMarbleStatus = useCallback((st: MarbleWorldStatus) => setMarbleStatus((prev) => ({ ...prev, [st.layer]: st })), []);

  const roomRef = useRef(room);
  roomRef.current = room;
  const styleRef = useRef(style);
  styleRef.current = style;
  const modeRef = useRef<ViewMode>(mode);
  modeRef.current = mode;
  const poseRef = useRef(pose);
  poseRef.current = pose;

  /* ---------- persistence: debounced while dragging, flushed on leave ---------- */

  const lastWritten = useRef<PlacedPiece[]>(room.staging);
  const timer = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const p = stack.get();
    if (p !== lastWritten.current) {
      lastWritten.current = p;
      setStaging(roomId, p, styleRef.current);
    }
  }, [stack.get, setStaging, roomId]);
  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, PERSIST_MS);
  }, [flush]);
  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [flush]);

  /* ---------- collaboration ---------- */

  const sendStagingRef = useRef(collab.sendStaging);
  sendStagingRef.current = collab.sendStaging;
  const broadcast = useMemo(() => throttle((p: PlacedPiece[]) => sendStagingRef.current(p), 33), []);
  useEffect(() => () => broadcast.cancel(), [broadcast]);

  // A peer's change lands in the store; adopt it without pushing an undo step.
  const storeStaging = room.staging;
  useEffect(() => {
    if (storeStaging === lastWritten.current || storeStaging === stack.get()) return;
    lastWritten.current = storeStaging;
    stack.replace(storeStaging);
  }, [storeStaging, stack.get, stack.replace]);

  const lastCursor = useRef<{ x: number; z: number } | null>(null);
  const sendPresence = collab.sendPresence;
  // The editor only ever shows Orbit or Walk; the viewer's Photo mode has no cursor to share.
  const presenceMode = (m: ViewMode): 'orbit' | 'walk' => (m === 'walk' ? 'walk' : 'orbit');
  const handleFloorPointer = useCallback(
    (p: { x: number; z: number } | null) => {
      lastCursor.current = p;
      sendPresence(p, presenceMode(modeRef.current), modeRef.current === 'walk' ? poseRef.current : undefined);
    },
    [sendPresence],
  );
  useEffect(() => {
    const id = window.setInterval(() => sendPresence(lastCursor.current, presenceMode(modeRef.current), modeRef.current === 'walk' ? poseRef.current : undefined), 2500);
    return () => window.clearInterval(id);
  }, [sendPresence]);
  const poseThrottled = useMemo(() => throttle((p: { x: number; z: number; yaw: number }) => sendPresence(null, 'walk', p), 100), [sendPresence]);
  useEffect(() => {
    if (mode === 'walk') poseThrottled(pose);
  }, [pose, mode, poseThrottled]);

  /* ---------- edits ---------- */

  const commit = useCallback(
    (next: PlacedPiece[]) => {
      stack.commit(next);
      schedule();
      broadcast(next);
    },
    [stack.commit, schedule, broadcast],
  );
  const handleChange = useCallback(
    (pieces: PlacedPiece[], owner: 'seller' | 'buyer') => {
      if (owner !== 'seller') return;
      commit(pieces);
    },
    [commit],
  );
  const doUndo = useCallback(() => {
    const p = stack.undo();
    if (p) {
      schedule();
      broadcast(p);
    }
  }, [stack.undo, schedule, broadcast]);
  const doRedo = useCallback(() => {
    const p = stack.redo();
    if (p) {
      schedule();
      broadcast(p);
    }
  }, [stack.redo, schedule, broadcast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (k === 'y') {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo]);

  // Selection follows the data: a piece removed by undo or a peer is no longer selected.
  useEffect(() => {
    if (selectedId && !present.some((p) => p.id === selectedId)) setSelectedId(null);
  }, [present, selectedId, setSelectedId]);
  useEffect(
    () => () => {
      setSelectedId(null);
      setHoverId(null);
    },
    [setSelectedId, setHoverId],
  );

  // Drag-to-place ends with this pointer; a later click places normally.
  useEffect(() => {
    if (!placeOnRelease) return;
    const up = () => window.setTimeout(() => setPlaceOnRelease(false), 0);
    window.addEventListener('pointerup', up, { once: true });
    return () => window.removeEventListener('pointerup', up);
  }, [placeOnRelease]);

  const changeMode = useCallback(
    (m: ViewMode) => {
      setPlacing(null);
      setMode(m);
    },
    [setMode],
  );

  const runAutoStage = useCallback(
    async (s: StagingStyle) => {
      setStyle(s);
      styleRef.current = s;
      setPlacing(null);
      setAutoBusy(true);
      try {
        const r = await aiAutoStage(roomRef.current, s);
        commit(r.pieces);
        setAutoMeta({ ...r.meta, dropped: r.dropped.length, rationale: r.rationale });
        toast({
          kind: 'success',
          title: `Staged ${r.pieces.length} pieces · ${STYLE_LABELS[s]}`,
          body: r.meta.source === 'nebius' ? `${r.meta.model ?? 'model'} in ${r.meta.ms}ms${r.dropped.length ? ` · ${r.dropped.length} proposal${r.dropped.length === 1 ? '' : 's'} dropped by the engine` : ''}` : `Rule-based stager in ${r.meta.ms}ms. Undo brings the old staging back.`,
          ttl: 5000,
        });
      } catch (e) {
        toast({ kind: 'error', title: 'Auto-stage failed', body: e instanceof Error ? e.message : String(e) });
      } finally {
        setAutoBusy(false);
      }
    },
    [commit],
  );

  const clear = useCallback(() => {
    if (!stack.get().length) return;
    commit([]);
    setSelectedId(null);
    toast({ kind: 'info', title: 'Staging cleared', body: 'Press ⌘Z to bring it back.', ttl: 4000 });
  }, [commit, stack.get, setSelectedId]);

  const done = useCallback(() => {
    flush();
    broadcast.flush();
    navigate(`/tours/${tourId}`);
  }, [flush, broadcast, navigate, tourId]);

  const addFromCatalog = useCallback((item: CatalogItem) => {
    setPlaceOnRelease(false);
    setPlacing(item);
    setSheet(null);
    setSelectedId(null);
  }, [setSelectedId]);
  const dragFromCatalog = useCallback((item: CatalogItem) => {
    setPlacing(item);
    setPlaceOnRelease(true);
    setSelectedId(null);
  }, [setSelectedId]);

  /* ---------- derived ---------- */

  const report = useMemo(() => fitReport(present, geometry), [present, geometry]);
  const names = useMemo(() => Object.fromEntries(present.map((p) => [p.id, p.name])), [present]);
  const selPiece = useMemo(() => (selectedId ? present.find((p) => p.id === selectedId) : undefined), [present, selectedId]);
  const selStatus = useMemo(() => (selPiece ? pieceStatus(selPiece, present, geometry) : 'ok'), [selPiece, present, geometry]);

  const updatePiece = useCallback((next: PlacedPiece) => commit(stack.get().map((p) => (p.id === next.id ? next : p))), [commit, stack.get]);
  const deletePiece = useCallback(
    (id: string) => {
      commit(stack.get().filter((p) => p.id !== id));
      setSelectedId(null);
    },
    [commit, stack.get, setSelectedId],
  );
  const duplicatePiece = useCallback(
    (piece: PlacedPiece) => {
      const draft: PlacedPiece = { ...piece, id: pieceId('p'), x: piece.x + 0.3, z: piece.z + 0.3 };
      const copy = clampToRoom(draft, geometry) as PlacedPiece;
      commit([...stack.get(), copy]);
      setSelectedId(copy.id);
    },
    [commit, stack.get, geometry, setSelectedId],
  );
  const focusPiece = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (isMobile) setSheet(null);
    },
    [setSelectedId, isMobile],
  );

  /* ---------- the real reconstruction, when this room has one ---------- */

  const world = bestWorld(room);
  const real = isReal(world) ? world : undefined;
  const photo = mode === 'photo' && hasPano(real);
  const marbleFrame = useMarbleFrame(real ?? NO_WORLD, room.anchor.metresPerUnit, floorOffsetOf(room));
  const pill = loadPill(marbleStatus);
  const panoLoading = layerLoading(marbleStatus, 'pano');
  // The measured room stays up until the photograph has actually arrived.
  const photoOnly = photo && layerReady(marbleStatus, 'pano');
  // Staging is arranged from above (orbit) and, for a real room, straight inside the photograph.
  const editable = mode === 'orbit' || photo;

  const fitPanel = (
    <FitReportPanel report={report} names={names} room={geometry} anchor={room.anchor} selectedId={selectedId} onFocusPiece={focusPiece} />
  );
  const inspector = selPiece ? (
    <Inspector
      piece={selPiece}
      room={geometry}
      anchor={room.anchor}
      status={selStatus}
      onChange={updatePiece}
      onDelete={() => deletePiece(selPiece.id)}
      onDuplicate={() => duplicatePiece(selPiece)}
      onBeginGesture={stack.beginGesture}
      onEndGesture={stack.endGesture}
    />
  ) : (
    <div className="rounded-xl border border-dashed border-line-2 px-3 py-4 text-[12px] leading-relaxed text-ink-3">
      Select a piece to see its dimensions, turn it, or remove it. Drag it anywhere on the floor; it snaps to walls within <span className="mono">12 cm</span> and turns red the moment it overlaps.
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <TopBar
        tourId={tourId}
        tourTitle={tour.title}
        room={room}
        rooms={rooms}
        mode={mode}
        onMode={changeMode}
        canUndo={stack.canUndo}
        canRedo={stack.canRedo}
        onUndo={doUndo}
        onRedo={doRedo}
        style={style}
        autoStaging={autoBusy}
        autoMeta={autoMeta}
        onAutoStage={runAutoStage}
        onClear={clear}
        onDone={done}
        peers={collab.peers}
        self={collab.self}
        compact={isMobile}
      />

      <div className="flex min-h-0 flex-1">
        {!isMobile ? (
          <aside className="w-72 shrink-0 border-r border-line bg-surface/50">
            <CatalogRail roomType={room.type} onAdd={addFromCatalog} onDragStart={dragFromCatalog} activeId={placing?.id ?? null} />
          </aside>
        ) : null}

        <main className="relative min-w-0 flex-1 bg-bg">
          <SceneCanvas
            className="absolute inset-0"
            camera={{ fov: 50, near: 0.05, far: 200 }}
            style={{ touchAction: 'none' }}
            busy={panoLoading}
            busyLabel={pill?.label}
            busyProgress={pill?.progress ?? null}
            loadingLabel={photo ? 'Developing the photograph…' : 'Building the room…'}
          >
            {photoOnly ? (
              <>
                <ambientLight intensity={0.85} />
                <directionalLight position={[3, 8, 4]} intensity={1.1} />
                <directionalLight position={[-4, 4, -3]} intensity={0.35} />
              </>
            ) : (
              <RoomShell room={geometry} cullNearWalls={mode === 'orbit'} showGrid={mode === 'orbit'} showCeiling={mode === 'walk'} />
            )}
            {real ? (
              <MarbleWorld
                world={real}
                metresPerUnit={room.anchor.metresPerUnit}
                floorOffset={floorOffsetOf(room)}
                showPano={photo}
                showSplat={mode === 'walk' && Boolean(real.spzUrl)}
                showGeometry={showGeometry && Boolean(real.colliderUrl)}
                onStatus={onMarbleStatus}
              />
            ) : null}
            <StagingLayer
              room={geometry}
              pieces={present}
              editable={editable}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onHover={setHoverId}
              onChange={handleChange}
              onFloorPointer={handleFloorPointer}
              placing={editable ? placing : null}
              placeOnRelease={placeOnRelease}
              onPlaced={() => setPlacing(null)}
              onCancelPlacing={() => setPlacing(null)}
              onGestureStart={stack.beginGesture}
              onGestureEnd={stack.endGesture}
            />
            <PeerCursors peers={collab.peers} />
            {photo ? (
              <PhotoRig origin={marbleFrame.position} fov={photoFov} onFov={setPhotoFov} resetKey={roomId} />
            ) : mode === 'orbit' ? (
              <OrbitRig room={geometry} resetKey={roomId} />
            ) : (
              <WalkControls room={geometry} pieces={present} />
            )}
          </SceneCanvas>

          {/* overlays */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
            {/* Real-reconstruction layers. Kept out of the top bar so the room's own controls stay put. */}
            {real ? (
              <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-1.5">
                {hasPano(real) ? (
                  <IconButton label={photo ? 'Leave the photograph' : 'Stand in the photograph'} active={photo} onClick={() => changeMode(photo ? 'orbit' : 'photo')} className="glass !h-8 !w-8">
                    <Icon.Camera size={15} />
                  </IconButton>
                ) : null}
                {real.colliderUrl ? (
                  <IconButton label={showGeometry ? 'Hide the measured geometry' : 'Show the measured geometry'} active={showGeometry} onClick={() => setShowGeometry(!showGeometry)} className="glass !h-8 !w-8">
                    <Icon.Grid size={15} />
                  </IconButton>
                ) : null}
                {pill ? (
                  <span className={cx('glass rounded-full px-2.5 py-1 text-[11px]', pill.tone === 'error' ? 'text-warn' : 'text-ink-2')}>{pill.label}</span>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-start justify-center">
              {placing && editable ? (
                <div className="glass animate-rise pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-[13px] text-ink-2">
                  <span>
                    Placing <span className="text-ink">{placing.name}</span> · <span className="mono">{Math.round(placing.w * 100)} × {Math.round(placing.d * 100)} cm</span>
                  </span>
                  {!touch ? (
                    <span className="hidden items-center gap-1 text-ink-3 sm:flex">
                      click the floor · <Kbd>R</Kbd> turn · <Kbd>Esc</Kbd>
                    </span>
                  ) : (
                    <span className="text-ink-3">tap the floor</span>
                  )}
                  <button type="button" onClick={() => setPlacing(null)} className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:text-ink" aria-label="Cancel placing">
                    <Icon.X size={14} />
                  </button>
                </div>
              ) : mode === 'walk' ? (
                <div className="glass animate-fade flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] text-ink-2">
                  <Icon.Walk size={14} className="text-accent-2" />
                  <span>
                    Eye height <span className="mono">1.60 m</span> ·{' '}
                    {touch ? 'drag to look, joystick to move' : (
                      <>
                        click to look · <Kbd>W</Kbd>
                        <Kbd>A</Kbd>
                        <Kbd>S</Kbd>
                        <Kbd>D</Kbd> move · <Kbd>Esc</Kbd> release
                      </>
                    )}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex items-end justify-between gap-3">
              <div className="flex items-end gap-3">
                {mode === 'walk' && touch ? <Joystick className="pointer-events-auto" /> : null}
                {!isMobile && mode === 'orbit' ? <ShortcutLegend /> : null}
              </div>
              <div className="flex items-center gap-2">
                {isMobile && selPiece && editable ? (
                  <div className="glass pointer-events-auto flex items-center gap-1 rounded-full p-1 pl-3">
                    <span className="mr-1 max-w-[30vw] truncate text-[12px] text-ink">{selPiece.name}</span>
                    <IconButton label="Rotate 90°" className="!h-8 !w-8" onClick={() => updatePiece(clampToRoom({ ...selPiece, rot: selPiece.rot + Math.PI / 2 }, geometry) as PlacedPiece)}>
                      <Icon.Rotate size={15} />
                    </IconButton>
                    <IconButton label="Duplicate" className="!h-8 !w-8" onClick={() => duplicatePiece(selPiece)}>
                      <Icon.Copy size={15} />
                    </IconButton>
                    <IconButton label="Delete" className="!h-8 !w-8 text-danger" onClick={() => deletePiece(selPiece.id)}>
                      <Icon.Trash size={15} />
                    </IconButton>
                    <IconButton label="Deselect" className="!h-8 !w-8" onClick={() => setSelectedId(null)}>
                      <Icon.X size={15} />
                    </IconButton>
                  </div>
                ) : null}
                <StagedLabel className="glass" />
              </div>
            </div>
          </div>
        </main>

        {!isMobile ? (
          <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-surface/50 p-4">
            {fitPanel}
            <div className="h-px w-full bg-line" />
            <div className="flex flex-col gap-2">
              <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">{selPiece ? 'Selected piece' : 'Inspector'}</div>
              {inspector}
            </div>
          </aside>
        ) : null}
      </div>

      {isMobile ? (
        <>
          {/* One scrollable row: the anchor chip is never clipped away, it scrolls into view (the mask is the affordance). */}
          <nav className="no-scrollbar flex h-14 shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-bg px-3 [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]">
            <Segmented
              size="sm"
              className="shrink-0"
              value={mode}
              onChange={changeMode}
              options={[
                ...(hasPano(real) ? [{ value: 'photo' as ViewMode, label: <span className="sr-only">Photo</span>, icon: <Icon.Camera size={15} /> }] : []),
                { value: 'orbit' as ViewMode, label: <span className="sr-only">Orbit</span>, icon: <Icon.Orbit size={15} /> },
                { value: 'walk' as ViewMode, label: <span className="sr-only">Walk</span>, icon: <Icon.Walk size={15} /> },
              ]}
            />
            <Button size="sm" variant={sheet === 'catalog' ? 'primary' : 'secondary'} onClick={() => setSheet('catalog')} className="shrink-0">
              <Icon.Plus size={14} /> Catalog
            </Button>
            <Button size="sm" variant={sheet === 'fit' ? 'primary' : 'secondary'} onClick={() => setSheet('fit')} className="shrink-0">
              <Icon.Ruler size={14} /> Fit
              {report.misfits.length ? (
                <Chip tone="danger" mono className="!px-1.5 !py-0 !text-[10px]">
                  {report.misfits.length}
                </Chip>
              ) : null}
            </Button>
            <AnchorChip anchor={room.anchor} size="sm" className="ml-auto shrink-0 !max-w-none" />
          </nav>
          <BottomSheet open={sheet === 'catalog'} onClose={() => setSheet(null)} title="Catalog" height="tall">
            <CatalogRail roomType={room.type} onAdd={addFromCatalog} activeId={placing?.id ?? null} />
          </BottomSheet>
          <BottomSheet open={sheet === 'fit'} onClose={() => setSheet(null)} title="Fit report" height="tall">
            <div className="flex flex-col gap-5 px-4 pb-6">
              {fitPanel}
              <div className="h-px w-full bg-line" />
              {inspector}
            </div>
          </BottomSheet>
        </>
      ) : null}
    </div>
  );
}
