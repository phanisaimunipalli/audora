import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { useShallow } from 'zustand/react/shallow';
import type { PlacedPiece } from '@/engine/types';
import type { Room, RoomWorld } from '@/state/types';
import { bestWorld, toast, useAudora, useTourJobs, useTourRooms } from '@/state/store';
import { isFirstPerson, useViewer, type Pose, type ViewMode } from '@/three/viewerStore';
import { SceneCanvas } from '@/three/SceneCanvas';
import { RoomShell } from '@/three/RoomShell';
import { OrbitRig, PhotoRig } from '@/three/OrbitRig';
import { WalkControls } from '@/three/WalkControls';
import { MarbleWorld, useMarbleFrame, type MarbleWorldStatus } from '@/three/MarbleWorld';
import { MeasureTool } from '@/three/MeasureTool';
import { Minimap } from '@/three/Minimap';
import { TouchJoystick } from '@/three/TouchJoystick';
import { StagingLayer } from '@/three/furniture/StagingLayer';
import { AnchorChip } from '@/components/AnchorChip';
import { FurnitureTest } from '@/components/FurnitureTest';
import { Button, IconButton, Kbd, Segmented, Spinner, StagedLabel, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { isTouchDevice, sessionOnce, trackEvent } from './viewer/analytics';
import { copyText, publicUrl } from './viewer/share';
import { freeSpawn } from './viewer/spawn';
import { MODE_LABEL, allowedMode, defaultMode, floorOffsetOf, hasPano, isReal, layerLoading, layerReady, loadPill, type MarbleStatusMap } from './viewer/marble';

export interface TourViewerProps {
  tourId: string;
  roomId?: string;
  /** Buyer mode: no editing, "test my furniture", analytics events. */
  publicMode?: boolean;
  onRoomChange?: (roomId: string) => void;
  className?: string;
  /** Start walking or in the dollhouse. Defaults to walk in publicMode, dollhouse otherwise. */
  initialMode?: ViewMode;
  /** Render only the canvas (thumbnails, previews). */
  hideHud?: boolean;
}

/* ------------------------------------------------------------------ scene */

function CameraTuning({ mode }: { mode: ViewMode }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    if (!('fov' in cam)) return;
    // Photo view owns its own fov (the wheel zooms it), so leave it alone there.
    if (mode === 'photo') return;
    cam.fov = mode === 'walk' ? 68 : 50;
    cam.updateProjectionMatrix();
  }, [camera, mode]);
  return null;
}

/** An empty stand-in so the frame hook can be called unconditionally. */
const NO_WORLD = { metricScaleFactor: null, groundPlaneOffset: null, bounds: undefined } as const;

/**
 * Light for photo view, where the measured shell (and its sun) is hidden: enough to read our
 * procedural furniture against a photograph without pretending to match its light.
 */
function PhotoLights() {
  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 8, 4]} intensity={1.1} />
      <directionalLight position={[-4, 4, -3]} intensity={0.35} />
    </>
  );
}

/** A faint grid on our metric floor, so the Geometry toggle also shows where y = 0 sits in the photo. */
function FloorGrid({ span }: { span: number }) {
  return <gridHelper args={[Math.max(8, Math.ceil(span) + 4), Math.max(8, Math.ceil(span) + 4) * 2, '#7c6cf0', '#3a3a5c']} position={[0, 0.004, 0]} material-transparent material-opacity={0.22} userData={{ measureIgnore: true }} />;
}

interface SceneProps {
  room: Room;
  world?: RoomWorld;
  buyerPieces: PlacedPiece[];
  onBuyerChange: (pieces: PlacedPiece[]) => void;
  spawn: Pose;
  onMarbleStatus: (s: MarbleWorldStatus) => void;
  /** Fade the measured shell only once the real capture is actually mounted; never on load failure. */
  splatReady: boolean;
  /** The panorama's texture is on screen; only then is it safe to hide the measured room. */
  panoReady: boolean;
  editable: boolean;
}

function Scene({ room, world, buyerPieces, onBuyerChange, spawn, onMarbleStatus, splatReady, panoReady, editable }: SceneProps) {
  const mode = useViewer((s) => s.mode);
  const tool = useViewer((s) => s.tool);
  const showStaging = useViewer((s) => s.showStaging);
  const showSplat = useViewer((s) => s.showSplat);
  const showGeometry = useViewer((s) => s.showGeometry);
  const photoFov = useViewer((s) => s.photoFov);
  const setPhotoFov = useViewer((s) => s.setPhotoFov);
  const setPose = useViewer((s) => s.setPose);
  const selectedId = useViewer((s) => s.selectedId);
  const setSelectedId = useViewer((s) => s.setSelectedId);

  const real = isReal(world) ? world : undefined;
  const floorOffset = floorOffsetOf(room);
  const frame = useMarbleFrame(real ?? NO_WORLD, room.anchor.metresPerUnit, floorOffset);
  const photo = mode === 'photo' && hasPano(real);
  // The photograph replaces the measured room only once it has arrived.
  const photoOnly = photo && panoReady;
  const wantSplat = mode === 'walk' && showSplat && Boolean(real?.spzUrl);
  const splat = wantSplat && splatReady;
  const walkPieces = useMemo(() => [...(showStaging ? room.staging : []), ...buyerPieces], [showStaging, room.staging, buyerPieces]);
  const walking = mode === 'walk' && tool !== 'measure';

  // The minimap and "test my furniture" ask where the viewer stands; in photo view that is the
  // capture point, which never moves.
  const px = frame.position[0];
  const pz = frame.position[2];
  useEffect(() => {
    if (photo) setPose({ x: px, z: pz, yaw: 0 });
  }, [photo, px, pz, setPose]);

  return (
    <>
      <CameraTuning mode={mode} />
      {photoOnly ? <PhotoLights /> : <RoomShell room={room.geometry} cullNearWalls={mode === 'orbit'} opacity={splat ? 0.15 : 1} showGrid={mode === 'orbit' && !splat} showCeiling={mode === 'walk' && !splat} />}
      {photo && showGeometry ? <FloorGrid span={Math.max(room.geometry.width, room.geometry.depth)} /> : null}
      {real ? (
        <MarbleWorld
          world={real}
          metresPerUnit={room.anchor.metresPerUnit}
          floorOffset={floorOffset}
          showPano={photo}
          showSplat={wantSplat}
          showGeometry={showGeometry && Boolean(real.colliderUrl)}
          onStatus={onMarbleStatus}
        />
      ) : null}
      <StagingLayer
        room={room.geometry}
        pieces={room.staging}
        buyerPieces={buyerPieces}
        showSeller={showStaging}
        editable={editable && tool !== 'measure'}
        lockSeller
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChange={(pieces, owner) => {
          if (owner === 'buyer') onBuyerChange(pieces);
        }}
      />
      {photo ? (
        <PhotoRig origin={frame.position} fov={photoFov} onFov={setPhotoFov} resetKey={room.id} drift={tool !== 'measure'} />
      ) : mode === 'walk' ? (
        <WalkControls room={room.geometry} pieces={walkPieces} enabled={walking} spawn={spawn} />
      ) : (
        <OrbitRig room={room.geometry} resetKey={room.id} />
      )}
      <MeasureTool room={room.geometry} enabled={tool === 'measure'} uncertaintyM={room.anchor.uncertaintyM} />
    </>
  );
}

/* ------------------------------------------------------------------ viewer */

function useNarrow(query = '(max-width: 639px)'): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

const coarse = (p: Pose): Pose => ({ x: Math.round(p.x * 4) / 4, z: Math.round(p.z * 4) / 4, yaw: Math.round(p.yaw * 4) / 4 });

/**
 * The buyer's room. Full-bleed canvas with a glass HUD: room switcher, anchor, staging toggle,
 * walk / dollhouse, measure, "test my furniture", minimap, and a share link.
 */
export function TourViewer({ tourId, roomId, publicMode = false, onRoomChange, className, initialMode, hideHud }: TourViewerProps) {
  const tour = useAudora((s) => s.tours[tourId]);
  const rooms = useTourRooms(tourId);
  const jobs = useTourJobs(tourId);

  const [localRoomId, setLocalRoomId] = useState<string | undefined>(roomId);
  useEffect(() => {
    if (roomId) setLocalRoomId(roomId);
  }, [roomId]);
  const room = useMemo(() => {
    const wanted = rooms.find((r) => r.id === localRoomId);
    return wanted ?? rooms.find((r) => r.status === 'ready') ?? rooms[0];
  }, [rooms, localRoomId]);
  const world = bestWorld(room);

  const mode = useViewer((s) => s.mode);
  const setMode = useViewer((s) => s.setMode);
  const tool = useViewer((s) => s.tool);
  const setTool = useViewer((s) => s.setTool);
  const showStaging = useViewer((s) => s.showStaging);
  const setShowStaging = useViewer((s) => s.setShowStaging);
  const showSplat = useViewer((s) => s.showSplat);
  const setShowSplat = useViewer((s) => s.setShowSplat);
  const showGeometry = useViewer((s) => s.showGeometry);
  const setShowGeometry = useViewer((s) => s.setShowGeometry);
  const measurement = useViewer((s) => s.measurement);
  const setMeasurement = useViewer((s) => s.setMeasurement);
  const selectedId = useViewer((s) => s.selectedId);
  const setSelectedId = useViewer((s) => s.setSelectedId);
  const locked = useViewer((s) => s.locked);
  const resetViewer = useViewer((s) => s.reset);
  const coarsePose = useViewer(useShallow((s) => (isFirstPerson(s.mode) ? coarse(s.pose) : null)));

  const [buyerByRoom, setBuyerByRoom] = useState<Record<string, PlacedPiece[]>>({});
  const buyerPieces = useMemo(() => (room ? buyerByRoom[room.id] ?? [] : []), [buyerByRoom, room]);
  const setBuyerPieces = useCallback(
    (pieces: PlacedPiece[]) => {
      if (!room) return;
      setBuyerByRoom((m) => ({ ...m, [room.id]: pieces }));
    },
    [room],
  );

  const [testOpen, setTestOpen] = useState(false);
  const [hint, setHint] = useState(false);
  const hintShown = useRef<Partial<Record<ViewMode, boolean>>>({});
  const [teleport, setTeleport] = useState<Pose | null>(null);
  const [marbleStatus, setMarbleStatus] = useState<MarbleStatusMap>({});
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const touch = useMemo(() => isTouchDevice(), []);
  const narrow = useNarrow();

  // Spawn just inside the door, never inside a staged piece. Buyer pieces are deliberately not a dependency:
  // dropping a sofa must not teleport the walker back to the door.
  const spawn = useMemo<Pose>(() => teleport ?? (room ? freeSpawn(room.geometry, room.staging) : { x: 0, z: 0, yaw: 0 }), [teleport, room]);

  /* mode on mount, reset on unmount. A public tour of a real reconstruction opens in the photograph. */
  useEffect(() => {
    const st = useViewer.getState();
    st.reset();
    st.setMode(initialMode ?? defaultMode(world, publicMode));
    return () => resetViewer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  /* room change: fresh spawn, no stale tools. The mode carries over — unless this room has no
     panorama to stand in, in which case photo view falls back to walking. */
  useEffect(() => {
    setTeleport(null);
    const st = useViewer.getState();
    st.setTool('select');
    st.setSelectedId(null);
    setMarbleStatus({});
    const legal = allowedMode(st.mode, world);
    if (legal !== st.mode) st.setMode(legal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  /* analytics: visit once per tour per session */
  useEffect(() => {
    if (!publicMode || !tour) return;
    if (sessionOnce(`visit.${tour.id}`)) trackEvent(tour.id, 'visit');
  }, [publicMode, tour]);

  /* analytics: walk on the first real pose change; measure when a measurement lands */
  useEffect(() => {
    if (!publicMode || !tour || !room) return;
    const unsubPose = useViewer.subscribe((s, prev) => {
      if (s.pose === prev.pose || s.mode !== 'walk') return;
      const moved = Math.hypot(s.pose.x - spawn.x, s.pose.z - spawn.z) > 0.35 || Math.abs(s.pose.yaw - spawn.yaw) > 0.4;
      if (moved && sessionOnce(`walk.${tour.id}`)) trackEvent(tour.id, 'walk', { roomId: room.id });
    });
    const unsubMeasure = useViewer.subscribe((s, prev) => {
      if (s.measurement?.metres != null && s.measurement !== prev.measurement && prev.measurement?.metres == null) {
        trackEvent(tour.id, 'measure', { roomId: room.id, item: `${s.measurement.metres.toFixed(2)}m` });
      }
    });
    return () => {
      unsubPose();
      unsubMeasure();
    };
  }, [publicMode, tour, room, spawn]);

  /* first-time hint, once per first-person mode */
  useEffect(() => {
    if (mode === 'orbit' || hintShown.current[mode]) return;
    hintShown.current[mode] = true;
    setHint(true);
    const t = window.setTimeout(() => setHint(false), 9000);
    return () => window.clearTimeout(t);
  }, [mode]);
  useEffect(() => {
    if (locked) setHint(false);
  }, [locked]);

  /* keyboard: Esc closes tools and panels */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useViewer.getState();
      if (st.tool === 'measure') st.setTool('select');
      else if (testOpen) setTestOpen(false);
      setHint(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [testOpen]);

  /* fullscreen state */
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const onMarbleStatus = useCallback((s: MarbleWorldStatus) => setMarbleStatus((prev) => ({ ...prev, [s.layer]: s })), []);
  const pill = loadPill(marbleStatus);
  const splatReady = layerReady(marbleStatus, 'splat');
  // Until the photograph is actually on screen the measured room stays up, so the viewport is never
  // a black void with a spinner over it.
  const panoReady = layerReady(marbleStatus, 'pano');
  const panoLoading = layerLoading(marbleStatus, 'pano');

  const switchRoom = (id: string) => {
    if (!tour || id === room?.id) return;
    setLocalRoomId(id);
    onRoomChange?.(id);
  };

  const teleportTo = useCallback(
    (x: number, z: number) => {
      if (!room) return;
      const st = useViewer.getState();
      if (st.mode === 'walk' && st.tool !== 'measure') {
        // already walking: glide there (WalkControls backs off from obstacles itself)
        st.requestTeleport(x, z);
        return;
      }
      const solids = [...(st.showStaging ? room.staging : []), ...buyerPieces];
      setTeleport(freeSpawn(room.geometry, solids, { x, z, yaw: st.pose.yaw }));
      if (st.mode !== 'walk') setMode('walk');
    },
    [setMode, room, buyerPieces],
  );

  const changeMode = (m: ViewMode) => {
    if (m === mode) return;
    if (m === 'walk' && room) {
      // resume where the buyer last stood (in photo view that is the capture point), not at the door
      const p = useViewer.getState().pose;
      if (Math.abs(p.x) > 0.01 || Math.abs(p.z) > 0.01) setTeleport(freeSpawn(room.geometry, room.staging, { ...p }));
    }
    if (useViewer.getState().tool === 'measure') setTool('select');
    setMode(m);
    if (publicMode && tour) trackEvent(tour.id, 'toggle', { roomId: room?.id, item: MODE_LABEL[m] });
  };

  const toggleStaging = () => {
    const next = !showStaging;
    setShowStaging(next);
    if (publicMode && tour) trackEvent(tour.id, 'toggle', { roomId: room?.id, item: next ? 'staging on' : 'see it bare' });
  };

  const toggleGeometry = () => {
    const next = !showGeometry;
    setShowGeometry(next);
    if (publicMode && tour) trackEvent(tour.id, 'toggle', { roomId: room?.id, item: next ? 'geometry on' : 'geometry off' });
  };

  // Photo is offered only where there is a photograph to stand in.
  const modeOptions = [
    ...(hasPano(world) ? [{ value: 'photo' as ViewMode, label: <span className="hidden sm:inline">Photo</span>, icon: <Icon.Camera size={15} /> }] : []),
    { value: 'walk' as ViewMode, label: <span className="hidden sm:inline">Walk</span>, icon: <Icon.Walk size={15} /> },
    { value: 'orbit' as ViewMode, label: <span className="hidden sm:inline">Dollhouse</span>, icon: <Icon.Orbit size={15} /> },
  ];

  const toggleMeasure = () => {
    if (tool === 'measure') {
      setTool('select');
      return;
    }
    // freeze the walker where they stand so the pointer is free for measuring
    if (mode === 'walk') setTeleport({ ...useViewer.getState().pose });
    setTool('measure');
    setHint(false);
  };

  const share = async () => {
    if (!tour) return;
    const ok = await copyText(publicUrl(tour.shareId, room?.id));
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1800);
    toast({ kind: ok ? 'success' : 'warn', title: ok ? 'Link copied' : 'Could not copy', body: ok ? publicUrl(tour.shareId) : 'Copy it from the address bar instead.' });
    if (publicMode) trackEvent(tour.id, 'share', { roomId: room?.id });
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen?.();
    else void el.requestFullscreen?.();
  };

  if (!tour || !room) {
    return (
      <div className={cx('grid place-items-center bg-bg text-sm text-ink-3', className)}>
        {tour ? 'This tour has no rooms yet.' : 'This tour does not exist.'}
      </div>
    );
  }

  const cmUncertainty = Math.max(1, Math.round(room.anchor.uncertaintyM * 100));
  // The plan keeps the room's aspect inside a box whose longer side is `planSize` px.
  const planSize = narrow || touch ? 96 : 140;
  const planW = room.geometry.width + 1.1;
  const planH = room.geometry.depth + 1.1;
  const plan = planW >= planH ? { w: planSize, h: (planSize * planH) / planW } : { w: (planSize * planW) / planH, h: planSize };
  const jobFor = (id: string) => jobs.filter((j) => j.roomId === id && (j.status === 'queued' || j.status === 'running')).pop();
  const stagingForVerdict = showStaging ? room.staging : [];

  return (
    <div ref={wrapRef} className={cx('relative isolate overflow-hidden bg-bg', className)}>
      <SceneCanvas
        camera={{ fov: 50, near: 0.05, far: 200, position: [4, 3, 6] }}
        className="absolute inset-0"
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
        onPointerMissed={() => setSelectedId(null)}
        busy={panoLoading}
        busyLabel={pill?.label}
        busyProgress={pill?.progress ?? null}
        loadingLabel={mode === 'photo' ? 'Developing the photograph…' : 'Building the room…'}
      >
        <Scene room={room} world={world} buyerPieces={buyerPieces} onBuyerChange={setBuyerPieces} spawn={spawn} onMarbleStatus={onMarbleStatus} splatReady={splatReady} panoReady={panoReady} editable={buyerPieces.length > 0} />
      </SceneCanvas>

      {hideHud ? null : (
        <>
          {/* HUD */}
          <div className={cx('pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3 transition-[right] duration-300 md:p-4', testOpen && 'md:right-[400px]')}>
            {/* top row */}
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
              <div className="pointer-events-auto glass max-w-full rounded-2xl px-3.5 py-2.5 sm:max-w-[min(64vw,520px)]">
                <div className="flex items-baseline gap-2">
                  <div className="display truncate text-lg leading-tight text-ink md:text-xl">{tour.title}</div>
                  {tour.price ? <div className="mono hidden text-xs text-ink-3 sm:block">{tour.price}</div> : null}
                </div>
                <div className="no-scrollbar mt-1.5 flex gap-1 overflow-x-auto">
                  {rooms.map((r) => {
                    const active = r.id === room.id;
                    const job = jobFor(r.id);
                    const ready = r.status === 'ready';
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={!ready}
                        onClick={() => switchRoom(r.id)}
                        className={cx(
                          'chip shrink-0 whitespace-nowrap !py-1 transition-colors',
                          active ? '!border-accent/50 !bg-accent/15 !text-accent-2' : ready ? 'hover:!border-ink-3/50 hover:!text-ink' : '!text-ink-3 opacity-80',
                        )}
                        title={ready ? r.name : job ? `${r.name} · ${job.step} · ${job.progress}%` : `${r.name} · ${r.status}`}
                      >
                        {r.status === 'generating' || job ? <Spinner size={11} className="text-accent-2" /> : r.status === 'failed' ? <span className="h-1.5 w-1.5 rounded-full bg-danger" /> : null}
                        {r.name}
                        {job ? <span className="mono text-[10px] text-ink-3">{job.progress}%</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 sm:flex-col sm:items-end">
                <AnchorChip anchor={room.anchor} size="sm" className="max-w-full whitespace-nowrap !bg-surface/80 backdrop-blur-md" />
                <div className="flex items-center gap-1.5">
                  <StagedLabel className="!bg-surface/80 backdrop-blur-md" />
                  <IconButton label={copied ? 'Copied' : 'Copy share link'} onClick={share} active={copied} className="!bg-surface/80 backdrop-blur-md">
                    {copied ? <Icon.Check size={16} /> : <Icon.Share size={16} />}
                  </IconButton>
                </div>
                {publicMode ? (
                  <Link to="/" target="_blank" rel="noreferrer" className="chip !bg-surface/80 !py-1 !text-[11px] backdrop-blur-md hover:!text-ink">
                    <span className="text-accent"><Icon.Logo size={12} /></span> Made with Audora
                  </Link>
                ) : null}
              </div>
            </div>

            {/* bottom row */}
            <div className="grid grid-cols-[auto_auto] items-end justify-between gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-3">
              <div className="pointer-events-auto glass justify-self-start rounded-2xl p-2" style={{ width: plan.w + 16 }}>
                <Minimap room={room.geometry} pieces={room.staging} buyerPieces={buyerPieces} showSeller={showStaging} selectedId={selectedId} uncertaintyM={room.anchor.uncertaintyM} onClick={teleportTo} style={{ height: plan.h + 22 }} className="w-full" />
              </div>

              <div className="pointer-events-auto order-last col-span-2 flex min-w-0 max-w-full flex-col items-center gap-2 justify-self-center sm:order-none sm:col-span-1">
                {measurement?.metres != null ? (
                  <div className="glass animate-rise flex items-center gap-2 rounded-full px-3 py-1.5">
                    <Icon.Ruler size={14} className="text-accent-2" />
                    <span className="mono text-sm text-ink">{measurement.metres.toFixed(2)} m</span>
                    <span className="mono text-xs text-ink-3">± {cmUncertainty}cm</span>
                    <button type="button" className="text-ink-3 hover:text-ink" onClick={() => setMeasurement(null)} aria-label="Clear measurement">
                      <Icon.X size={14} />
                    </button>
                  </div>
                ) : tool === 'measure' ? (
                  <div className="glass animate-fade rounded-full px-3 py-1.5 text-xs text-ink-2">
                    Click two points to measure. <span className="mono text-ink-3">± {cmUncertainty}cm</span>
                  </div>
                ) : pill ? (
                  <div className={cx('glass animate-fade flex items-center gap-2 rounded-full px-3 py-1.5 text-xs', pill.tone === 'error' ? 'text-warn' : 'text-ink-2')}>
                    {pill.tone === 'loading' ? <Spinner size={12} /> : <Icon.Warning size={12} />}
                    {pill.label}
                  </div>
                ) : null}

                <div className="no-scrollbar glass flex max-w-full items-center gap-1.5 overflow-x-auto rounded-2xl p-1.5">
                  <Segmented size="sm" value={mode} onChange={changeMode} options={modeOptions} />
                  <IconButton label={showStaging ? 'See it bare' : 'Show staging'} active={!showStaging} onClick={toggleStaging} className="h-8 w-8 shrink-0">
                    {showStaging ? <Icon.EyeOff size={15} /> : <Icon.Eye size={15} />}
                  </IconButton>
                  <IconButton label={tool === 'measure' ? 'Stop measuring' : 'Measure'} active={tool === 'measure'} onClick={toggleMeasure} className="h-8 w-8 shrink-0">
                    <Icon.Ruler size={15} />
                  </IconButton>
                  {world?.colliderUrl ? (
                    <IconButton label={showGeometry ? 'Hide the measured geometry' : 'Show the measured geometry'} active={showGeometry} onClick={toggleGeometry} className="h-8 w-8 shrink-0">
                      <Icon.Grid size={15} />
                    </IconButton>
                  ) : null}
                  {world?.spzUrl && mode === 'walk' ? (
                    <IconButton label={showSplat ? 'Show the measured shell' : 'Show the real capture'} active={showSplat} onClick={() => setShowSplat(!showSplat)} className="h-8 w-8 shrink-0">
                      <Icon.Layers size={15} />
                    </IconButton>
                  ) : null}
                  <Button size="sm" variant={testOpen ? 'secondary' : 'buyer'} onClick={() => setTestOpen((v) => !v)} className="shrink-0">
                    <Icon.Sofa size={15} />
                    <span className="hidden sm:inline">{testOpen ? 'Close' : 'Test my furniture'}</span>
                    <span className="sm:hidden">{testOpen ? 'Close' : 'My furniture'}</span>
                    {buyerPieces.length ? <span className="mono rounded-full bg-black/20 px-1.5 text-[11px]">{buyerPieces.length}</span> : null}
                  </Button>
                  <IconButton label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} active={fullscreen} onClick={toggleFullscreen} className="h-8 w-8 shrink-0">
                    <Icon.Fullscreen size={15} />
                  </IconButton>
                </div>
              </div>

              <div className="pointer-events-auto flex flex-col items-end gap-2 justify-self-end">
                {mode === 'walk' && touch ? <TouchJoystick size={112} /> : <div className="hidden w-[140px] md:block" aria-hidden />}
              </div>
            </div>
          </div>

          {/* first-time hint */}
          {hint && mode !== 'orbit' ? (
            <button
              type="button"
              onClick={() => setHint(false)}
              className="pointer-events-auto absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 animate-rise flex-col items-center gap-2 rounded-2xl border border-line-2 bg-bg/80 px-5 py-4 text-center backdrop-blur-md"
            >
              <div className="display text-xl text-ink">
                {mode === 'photo' ? `You are standing where the photo was taken.` : `You are standing in the ${room.name.toLowerCase()}.`}
              </div>
              {mode === 'photo' ? (
                <div className="text-sm text-ink-2">{touch ? 'Drag to look around · pinch to zoom' : 'Drag to look around · scroll to zoom · Walk to move'}</div>
              ) : touch ? (
                <div className="text-sm text-ink-2">Drag to look · use the stick or tap the floor to move</div>
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-ink-2">
                  <span>Drag to look</span>
                  <span className="text-ink-3">·</span>
                  <span className="inline-flex items-center gap-1"><Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd> or click the floor to move</span>
                  <span className="text-ink-3">·</span>
                  <span className="inline-flex items-center gap-1">double-click for mouse look, <Kbd>Esc</Kbd> releases</span>
                </div>
              )}
              <div className="mono text-[11px] text-ink-3">
                {mode === 'photo' ? 'capture point' : 'eye height 1.60 m'} · {room.geometry.width.toFixed(2)} × {room.geometry.depth.toFixed(2)} m
              </div>
            </button>
          ) : null}

          {/* furniture test drawer */}
          {testOpen ? (
            <div className="glass animate-rise absolute inset-x-0 bottom-0 z-30 max-h-[64vh] rounded-t-2xl md:inset-y-0 md:left-auto md:right-0 md:w-[400px] md:max-h-none md:rounded-none md:border-y-0 md:border-r-0">
              <FurnitureTest
                room={room}
                buyerPieces={buyerPieces}
                onChange={setBuyerPieces}
                onClose={() => setTestOpen(false)}
                staging={stagingForVerdict}
                pose={coarsePose ?? undefined}
                selectedId={selectedId}
                onSelect={setSelectedId}
                mode={mode}
                onModeChange={changeMode}
                analytics={publicMode}
                className="max-h-[64vh] md:max-h-none"
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
