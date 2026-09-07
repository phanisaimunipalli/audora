import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Object3D } from 'three';
import type { CatalogItem, PlacedPiece } from '@/engine/types';
import { STYLE_LABELS, pieceId, type StagingStyle } from '@/engine/autostage';
import { fitReport, pieceStatus } from '@/engine/fit';
import { clampToRoom } from '@/engine/geometry';
import { bestWorld, selectRoom, toast, useAudora, useTourRooms } from '@/state/store';
import { useCollab } from '@/state/collab';
import type { Room, Tour } from '@/state/types';
import { aiAutoStage } from '@/services/ai';
import { useViewer, type Pose, type ViewMode } from '@/three/viewerStore';
import { SceneCanvas } from '@/three/SceneCanvas';
import { RoomShell } from '@/three/RoomShell';
import { OrbitRig, PhotoRig } from '@/three/OrbitRig';
import { MarbleWorld, useMarbleFrame, type GeometryView, type MarbleWorldStatus } from '@/three/MarbleWorld';
import { captureYaw } from '@/three/splat/frame';
import { CaptureLight, externalSunScale, type LightBudget, type PanoramaLight } from '@/three/CaptureLight';
import { describeSun, windowPositions, type SunDescription } from '@/three/lighting/describe';
import { SunLight } from '@/three/SunLight';
import { effectiveHeading, sunState } from '@/engine/siteSun';
import { TimeOfDay } from './viewer/TimeOfDay';
import { LayersPanel } from './viewer/LayersPanel';
import { ExplodedLayer } from './viewer/ExplodedLayer';
import { usePortraitLayers, type PortraitLayers } from './viewer/layers';
import { WalkControls } from '@/three/WalkControls';
import { buildWalkMask, type WalkMask } from '@/three/walkMask';
import { StagingLayer } from '@/three/furniture/StagingLayer';
import { PeerCursors } from '@/three/furniture/PeerCursors';
import { inTextField, throttle } from '@/three/furniture/floor';
import { FitReportPanel } from '@/components/FitReportPanel';
import { AnchorChip } from '@/components/AnchorChip';
import { Icon } from '@/components/icons';
import { Button, Chip, EmptyState, IconButton, Kbd, Segmented, StagedLabel } from '@/components/ui';
import { HudPill, RoomStrip } from './viewer/hud';
import { TopBar, type AutoStageMeta } from './editor/TopBar';
import { StagePanel } from './editor/StagePanel';
import { Inspector } from './editor/Inspector';
import { ShortcutLegend } from './editor/ShortcutLegend';
import { BottomSheet } from './editor/BottomSheet';
import { Joystick } from './editor/Joystick';
import { useUndoStack } from './editor/useUndoStack';
import { useMediaQuery, useTouchDevice } from './editor/useMediaQuery';
import { floorOffsetOf, hasPano, isReal, layerReady, loadPill, type MarbleStatusMap } from './viewer/marble';

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
  const showSplat = useViewer((s) => s.showSplat);
  const setShowSplat = useViewer((s) => s.setShowSplat);
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
  const [layersOpen, setLayersOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [marbleStatus, setMarbleStatus] = useState<MarbleStatusMap>({});
  // The panorama is the room's light as well as its backdrop (PMREM environment + estimated sun).
  const [panoTex, setPanoTex] = useState<import('three').Texture | null>(null);
  // How the panorama's light was divided; the real sun fills the key's share of it.
  const [budget, setBudget] = useState<LightBudget | null>(null);
  const [captureSun, setCaptureSun] = useState<PanoramaLight | null>(null);
  /* The same portrait stack the buyer gets (./viewer/layers), so the seller stages against the
     layers rather than against a flattened picture of them. Local and transient by design. */
  const { layers, setLayer, exploded, explode } = usePortraitLayers();
  const [geometryView, setGeometryView] = useState<GeometryView>('wireframe');
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

  /* Placing a piece into a room whose furniture layer is switched off would drop it into thin air:
     the layer comes back on, because reaching for the catalogue says what the seller wants to see. */
  const addFromCatalog = useCallback((item: CatalogItem) => {
    setPlaceOnRelease(false);
    setPlacing(item);
    setSheet(null);
    setSelectedId(null);
    setLayer('furniture', true);
  }, [setSelectedId, setLayer]);
  const dragFromCatalog = useCallback((item: CatalogItem) => {
    setPlacing(item);
    setPlaceOnRelease(true);
    setSelectedId(null);
    setLayer('furniture', true);
  }, [setSelectedId, setLayer]);

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

  /* ---------- the real sun, when the tour has an address ----------
     The seller stages under the light the buyer will be standing in: same site, same heading, same
     hour. The instant is parked on the tour, so opening the buyer's viewer picks up where the
     staging left off. */
  const site = tour.site;
  const heading = effectiveHeading(site?.heading, room.northWallHeading);
  const setPreviewTime = useAudora((s) => s.setPreviewTime);
  const [previewTime, setLocalPreviewTime] = useState<number>(() => site?.previewTime ?? Date.now());
  const hasSite = Boolean(site);
  useEffect(() => {
    if (!hasSite) return;
    const id = window.setTimeout(() => setPreviewTime(tourId, previewTime), 600);
    return () => window.clearTimeout(id);
  }, [hasSite, previewTime, tourId, setPreviewTime]);
  const siteLat = site?.lat;
  const siteLon = site?.lon;
  const sky = useMemo(
    () => (siteLat != null && siteLon != null ? sunState(new Date(previewTime), siteLat, siteLon, heading) : null),
    [siteLat, siteLon, previewTime, heading],
  );

  /* The Photo row and the store's `showSplat` are the same decision seen twice: taking the capture
     away must take the splat with it, or the room comes back as a splat with no panorama behind it. */
  const onLayerChange = useCallback(
    (key: keyof PortraitLayers, value: boolean) => {
      setLayer(key, value);
      if (key === 'photo') setShowSplat(value);
    },
    [setLayer, setShowSplat],
  );

  /* "Light from ahead · 21% directional" — what the panorama was measured to be lighting the
     furniture with, said relative to the way the seller is facing, because that is the only frame a
     person standing in a room has. Coarsened to 5° so turning does not re-render the panel. */
  const facing = Math.round(((pose.yaw * 180) / Math.PI) / 5) * 5;
  const sunDescription = useMemo<SunDescription | null>(() => {
    if (!captureSun || !budget) return null;
    return describeSun(captureSun.sun, {
      facing: (facing * Math.PI) / 180,
      windows: windowPositions(geometry),
      directionalShare: budget.directionalShare,
    });
  }, [captureSun, budget, facing, geometry]);

  /* ---------- the real reconstruction, when this room has one ---------- */

  const world = bestWorld(room);
  const real = isReal(world) ? world : undefined;
  const photo = mode === 'photo' && hasPano(real);
  /* Photo view's camera belongs to the *mode*; whether the photograph is drawn belongs to the
     *layer*. Switching the capture off leaves the seller standing where they were, looking at the
     measured room — which is the only way to see what the furniture is being composited onto. */
  const showPhotoLayer = layers.photo;
  const wantSplat = mode === 'walk' && showSplat && showPhotoLayer && Boolean(real?.spzUrl);
  const marbleFrame = useMarbleFrame(real ?? NO_WORLD, room.anchor.metresPerUnit, floorOffsetOf(room));
  const pill = loadPill(marbleStatus);
  // The measured room stays up until the photograph has actually arrived.
  const photoOnly = photo && showPhotoLayer && layerReady(marbleStatus, 'pano');
  const splatUp = wantSplat && layerReady(marbleStatus, 'splat');
  /** Furniture is standing on a real capture, so it is lit by it and casts onto it. */
  const composite = photoOnly || splatUp;
  /** The address's own sun is up: it owns the shadows, the panorama keeps owning the colour. */
  const sunUp = Boolean(sky && sky.intensity > 0.01);
  /* Under the splat the measured shell is a milky box drawn inside the photograph, not a stand-in:
     the seller has to stage against what the buyer will actually see. */
  const shell = !photoOnly && !splatUp;

  /* Real walls for walk mode, read off the collider mesh (the room rectangle is its bounding box). */
  const [collider, setCollider] = useState<Object3D | null>(null);
  const [walkMask, setWalkMask] = useState<WalkMask | null>(null);
  const captureX = marbleFrame.position[0];
  const captureZ = marbleFrame.position[2];
  const captureFacing = captureYaw(marbleFrame);
  const walkHome = useMemo(() => ({ x: captureX, z: captureZ }), [captureX, captureZ]);
  /* The seller walks the room from where the photographer stood, facing the way they faced — the
     same first frame the buyer gets, so staging is judged against the buyer's view. */
  const walkSpawn = useMemo<Pose | undefined>(() => (real ? { x: captureX, z: captureZ, yaw: captureFacing } : undefined), [real, captureX, captureZ, captureFacing]);
  useEffect(() => {
    if (!collider) {
      setWalkMask(null);
      return;
    }
    let dead = false;
    let tries = 0;
    const build = () => {
      if (dead) return;
      // the loader hands the mesh over a beat before r3f has attached it under the Marble group
      if (!collider.parent && tries++ < 60) {
        requestAnimationFrame(build);
        return;
      }
      const m = buildWalkMask(collider, {
        seed: { x: captureX, z: captureZ },
        reach: Math.max(8, Math.max(geometry.width, geometry.depth)),
        limit: { halfWidth: geometry.width / 2, halfDepth: geometry.depth / 2 },
      });
      setWalkMask(m);
      if (import.meta.env.DEV) window.__audoraWalkMask = m;
    };
    build();
    return () => {
      dead = true;
    };
  }, [collider, captureX, captureZ, geometry.width, geometry.depth]);
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
    <div className="rounded-xl border border-dashed border-line-2 bg-surface px-3 py-4 text-[12px] leading-relaxed text-dim">
      Select a piece to see its dimensions, turn it, or remove it. Drag it anywhere on the floor; it snaps to walls within <span className="mono">12 cm</span> and turns red the moment it overlaps.
    </div>
  );

  /* The layers and the hour of the day ride in the top bar's pill group, exactly as they do in the
     buyer's viewer; their panels open in the centre column above the room strip. */
  const extraPills = real || site ? (
    <>
      {real ? (
        <HudPill active={layersOpen || showGeometry} onClick={() => setLayersOpen((v) => !v)} icon={<Icon.Layers size={14} />} title="Layers · the photograph, the furniture and its shadow">
          <span className="hidden lg:inline">Layers</span>
        </HudPill>
      ) : null}
      {site ? (
        <HudPill square active={timeOpen} onClick={() => setTimeOpen((v) => !v)} aria-label="Time of day" title="Time of day · the real sun">
          <Icon.Sun size={15} />
        </HudPill>
      ) : null}
    </>
  ) : null;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <main className="relative min-h-0 flex-1 bg-bg">
        <SceneCanvas
          className="absolute inset-0"
          camera={{ fov: 50, near: 0.05, far: 200 }}
          style={{ touchAction: 'none' }}
          /* Any capture layer still coming down, not just the panorama: decoding half a million
             splats blocks the main thread before the first frame lands, and "Building the room…"
             for half a minute is the canvas describing the wrong wait. The pill says which layer
             and how far along it is. */
          busy={Boolean(pill)}
          busyLabel={pill?.label}
          busyProgress={pill?.progress ?? null}
          loadingLabel={photo ? 'Developing the photograph…' : 'Building the room…'}
        >
          {/* The seller stages against exactly what the buyer will see: the room's own light. */}
          {composite ? (
            <CaptureLight
              texture={panoTex}
              groupRotationY={marbleFrame.rotationY}
              span={Math.max(geometry.width, geometry.depth)}
              floor={{ width: geometry.width, depth: geometry.depth }}
              shadows={!sunUp}
              catcher={layers.shadows}
              onLight={setCaptureSun}
              onBudget={setBudget}
            />
          ) : null}
          {sky ? (
            <SunLight
              room={geometry}
              sun={sky}
              composite={composite}
              intensity={composite ? externalSunScale(budget, sky.intensity) : 1}
              shadows={layers.shadows}
              shadowOpacity={composite ? budget?.shadowOpacity : undefined}
            />
          ) : null}
          {shell ? (
            <RoomShell
              room={geometry}
              cullNearWalls={mode === 'orbit'}
              showGrid={mode === 'orbit'}
              showCeiling={mode === 'walk'}
              lights={!composite}
              externalSun={Boolean(sky)}
              sunWalls={sky?.walls}
            />
          ) : null}
          {real ? (
            /* Keyed on the world so a different capture is a teardown, not a re-point: the
               panorama is deliberately kept mounted across prop changes and would otherwise
               linger from the world it belonged to. */
            <MarbleWorld
              key={real.worldId || real.panoUrl || real.spzUrl}
              world={real}
              metresPerUnit={room.anchor.metresPerUnit}
              floorOffset={floorOffsetOf(room)}
              showPano={(photo || wantSplat) && showPhotoLayer}
              showSplat={wantSplat}
              showGeometry={showGeometry && Boolean(real.colliderUrl)}
              geometryView={geometryView}
              showOccluder={layers.occluder && composite && Boolean(real.colliderUrl)}
              onStatus={onMarbleStatus}
              onCollider={setCollider}
              onPanoTexture={setPanoTex}
            />
          ) : null}
          {layers.furniture ? (
            /* The furniture layer, liftable off the photograph for a moment. Dragging is off while
               it is in the air: the piece the seller would be dropping is 40 cm above the floor. */
            <ExplodedLayer active={exploded}>
              <StagingLayer
                room={geometry}
                pieces={present}
                contactShadows={composite && layers.shadows}
                editable={editable && !exploded}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onHover={setHoverId}
                onChange={handleChange}
                onFloorPointer={handleFloorPointer}
                placing={editable && !exploded ? placing : null}
                placeOnRelease={placeOnRelease}
                onPlaced={() => setPlacing(null)}
                onCancelPlacing={() => setPlacing(null)}
                onGestureStart={stack.beginGesture}
                onGestureEnd={stack.endGesture}
              />
            </ExplodedLayer>
          ) : null}
          <PeerCursors peers={collab.peers} />
          {photo ? (
            <PhotoRig origin={marbleFrame.position} initialYaw={captureFacing} fov={photoFov} onFov={setPhotoFov} resetKey={roomId} />
          ) : mode === 'orbit' ? (
            <OrbitRig room={geometry} resetKey={roomId} />
          ) : (
            <WalkControls room={geometry} pieces={present} spawn={walkSpawn} mask={real ? walkMask : null} collider={real ? collider : null} home={real ? walkHome : undefined} />
          )}
        </SceneCanvas>

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
          hasPhoto={hasPano(real)}
          extraPills={extraPills}
        />

        {/* left: what this room measures — the fit report and the selected piece */}
        {!isMobile ? (
          <div className="absolute bottom-[92px] left-3.5 z-20 flex w-[288px] flex-col" style={{ top: 'calc(var(--hud-top, 52px) + 6px)' }}>
            <div className="glass flex min-h-0 flex-col overflow-hidden rounded-2xl">
              <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-3.5">
                {fitPanel}
                <div className="h-px w-full bg-line" />
                <div className="flex flex-col gap-2">
                  <div className="micro">{selPiece ? 'Selected piece' : 'Inspector'}</div>
                  {inspector}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* right: stage a room, add one piece, nudge the floor */}
        {!isMobile ? (
          <div className="absolute bottom-[92px] right-3.5 z-20 flex w-[268px] flex-col" style={{ top: 'calc(var(--hud-top, 52px) + 6px)' }}>
            <StagePanel
              room={room}
              style={style}
              autoStaging={autoBusy}
              onAutoStage={runAutoStage}
              onAdd={addFromCatalog}
              onDragStart={dragFromCatalog}
              activeId={placing?.id ?? null}
              onClear={clear}
              showFloorHeight={Boolean(real)}
              pieces={present.length}
              className="min-h-0 flex-1"
            />
          </div>
        ) : null}

        {/* centre column: the hint, the layers and the hour — above the room strip */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col justify-between p-3 pb-[88px]" style={{ top: 'calc(var(--hud-top, 52px) + 6px)' }}>
          <div className="flex items-start justify-center px-2">
            {placing && editable ? (
              <div className="glass animate-rise pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-[13px] text-ink-2">
                <span>
                  Placing <span className="text-ink">{placing.name}</span> · <span className="mono">{Math.round(placing.w * 100)} × {Math.round(placing.d * 100)} cm</span>
                </span>
                {!touch ? (
                  <span className="hidden items-center gap-1 text-dim sm:flex">
                    click the floor · <Kbd>R</Kbd> turn · <Kbd>Esc</Kbd>
                  </span>
                ) : (
                  <span className="text-dim">tap the floor</span>
                )}
                <button type="button" onClick={() => setPlacing(null)} className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Cancel placing">
                  <Icon.X size={14} />
                </button>
              </div>
            ) : mode === 'walk' ? (
              <div className="glass animate-fade flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] text-ink-2">
                <Icon.Walk size={14} className="text-dim" />
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

            <div className="pointer-events-auto flex min-w-0 flex-col items-center gap-2">
              {timeOpen && site ? (
                <TimeOfDay
                  lat={site.lat}
                  lon={site.lon}
                  heading={heading}
                  date={new Date(previewTime)}
                  onChange={(d) => setLocalPreviewTime(d.getTime())}
                  onClose={() => setTimeOpen(false)}
                  place={site.displayName}
                />
              ) : null}
              {layersOpen && real ? (
                <LayersPanel
                  roomId={roomId}
                  world={real}
                  layers={layers}
                  onLayer={onLayerChange}
                  exploded={exploded}
                  onExplode={explode}
                  showGeometry={showGeometry}
                  onGeometry={setShowGeometry}
                  geometryView={geometryView}
                  onGeometryView={setGeometryView}
                  sun={sunDescription}
                  envIntensity={budget?.envMapIntensity ?? null}
                  hasCapture
                  photoHint={mode === 'orbit' ? 'The dollhouse draws the measured room; walk or switch to Photo to stand in the capture.' : undefined}
                  onClose={() => setLayersOpen(false)}
                />
              ) : null}
              {pill?.tone === 'error' ? <span className="glass rounded-full px-2.5 py-1 text-[11px] text-warn">{pill.label}</span> : null}
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
                  <IconButton label="Delete" className="!h-8 !w-8 !text-danger" onClick={() => deletePiece(selPiece.id)}>
                    <Icon.Trash size={15} />
                  </IconButton>
                  <IconButton label="Deselect" className="!h-8 !w-8" onClick={() => setSelectedId(null)}>
                    <Icon.X size={15} />
                  </IconButton>
                </div>
              ) : null}
              <StagedLabel className="pointer-events-auto bg-[color:var(--color-glass)] backdrop-blur-md" />
            </div>
          </div>
        </div>

        {/* the rooms in this tour, as tiles */}
        {!isMobile ? (
          <RoomStrip rooms={rooms} activeId={roomId} onPick={(id) => navigate(`/tours/${tourId}/stage/${id}`)} />
        ) : null}
      </main>

      {isMobile ? (
        <>
          {/* Two rows, because the anchor is not optional. Pushed to the end of one scrolling row it
              was cut off by the viewport edge with the ± unreachable — and an uncertainty the seller
              cannot read is the one number Audora refuses to hide. The controls scroll; the anchor
              gets its own full-width line and truncates its reference, never its ±. */}
          <nav className="flex shrink-0 flex-col gap-1.5 border-t border-line bg-bg px-3 py-2">
            <div className="no-scrollbar flex items-center gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]">
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
              <Icon.Plus size={14} /> Stage
            </Button>
            <Button size="sm" variant={sheet === 'fit' ? 'primary' : 'secondary'} onClick={() => setSheet('fit')} className="shrink-0">
              <Icon.Ruler size={14} /> Fit
              {report.misfits.length ? (
                <Chip tone="danger" mono className="!px-1.5 !py-0 !text-[10px]">
                  {report.misfits.length}
                </Chip>
              ) : null}
            </Button>
            </div>
            <AnchorChip anchor={room.anchor} size="sm" className="w-full" />
          </nav>
          <BottomSheet open={sheet === 'catalog'} onClose={() => setSheet(null)} title="Stage a room" height="tall">
            <StagePanel
              room={room}
              style={style}
              autoStaging={autoBusy}
              onAutoStage={runAutoStage}
              onAdd={addFromCatalog}
              activeId={placing?.id ?? null}
              onClear={clear}
              showFloorHeight={Boolean(real)}
              pieces={present.length}
              hideLabel
              className="h-full !border-0 !bg-transparent !shadow-none !backdrop-blur-none"
            />
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
