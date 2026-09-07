import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { Object3D, PerspectiveCamera, Texture } from 'three';
import { useShallow } from 'zustand/react/shallow';
import type { PlacedPiece } from '@/engine/types';
import type { Room, RoomWorld } from '@/state/types';
import { bestWorld, toast, useAudora, useTourJobs, useTourRooms } from '@/state/store';
import { isFirstPerson, useViewer, type Pose, type ViewMode } from '@/three/viewerStore';
import { SceneCanvas } from '@/three/SceneCanvas';
import { RoomShell } from '@/three/RoomShell';
import { OrbitRig, PhotoRig } from '@/three/OrbitRig';
import { WalkControls } from '@/three/WalkControls';
import { buildWalkMask, type WalkMask } from '@/three/walkMask';
import { MarbleWorld, useMarbleFrame, type GeometryView, type MarbleWorldStatus } from '@/three/MarbleWorld';
import { AdaptiveDpr } from '@/three/splat/AdaptiveDpr';
import { captureYaw } from '@/three/splat/frame';
import { CaptureLight, externalSunScale, type LightBudget, type PanoramaLight } from '@/three/CaptureLight';
import { describeSun, windowPositions, type SunDescription } from '@/three/lighting/describe';
import { SunLight } from '@/three/SunLight';
import { effectiveHeading, sunState, type SunState } from '@/engine/siteSun';
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
import { TimeOfDay } from './viewer/TimeOfDay';
import { ExplodedLayer } from './viewer/ExplodedLayer';
import { LayersPanel } from './viewer/LayersPanel';
import { usePortraitLayers, type PortraitLayers } from './viewer/layers';
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

const LOOK = new Vector3();

/**
 * Photo view's camera never moves, but it does turn, and "your sofa lands in front of you" is only
 * true if the viewer knows which way "in front" is. Publishes the capture point plus the direction
 * the buyer is actually looking, coarsely enough that the slow drift does not re-render the HUD.
 */
function PhotoPose({ x, z }: { x: number; z: number }) {
  const camera = useThree((s) => s.camera);
  const setPose = useViewer((s) => s.setPose);
  const last = useRef<number | null>(null);
  useFrame(() => {
    camera.getWorldDirection(LOOK);
    const yaw = Math.atan2(-LOOK.x, -LOOK.z);
    const prev = last.current;
    if (prev !== null && Math.abs(Math.atan2(Math.sin(yaw - prev), Math.cos(yaw - prev))) < 0.05) return;
    last.current = yaw;
    setPose({ x, z, yaw });
  });
  useEffect(() => {
    last.current = null;
  }, [x, z]);
  return null;
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
  /** The real sun for this address at the chosen instant, or null when the tour has no site. */
  sky: SunState | null;
  /** Which of the portrait layers are switched on. */
  layers: PortraitLayers;
  /** The furniture layer is lifted off the photograph for a moment. */
  exploded: boolean;
  /** How the Geometry layer draws the collider when it is on. */
  geometryView: GeometryView;
  /** What the photograph turned out to be lighting the room with — for the Layers panel. */
  onCaptureLight: (info: { light: PanoramaLight; budget: LightBudget } | null) => void;
  editable: boolean;
}

function Scene({ room, world, buyerPieces, onBuyerChange, spawn, onMarbleStatus, splatReady, panoReady, sky, layers, exploded, geometryView, onCaptureLight, editable }: SceneProps) {
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
  /* Photo view's camera and rig belong to the *mode*; whether the photograph is actually drawn
     belongs to the *layer*. Keeping them apart is what lets the Layers panel take the capture away
     without throwing the buyer out of the room they were standing in. */
  const photo = mode === 'photo' && hasPano(real);
  const showPhoto = layers.photo;
  const wantSplat = mode === 'walk' && showSplat && showPhoto && Boolean(real?.spzUrl);
  const splat = wantSplat && splatReady;
  /* The panorama is up in about a second and the smallest splat in two or three, so while the splat
     streams the buyer stands in the photograph rather than in the procedural stand-in — and it stays
     there afterwards, behind the splat, as the sky the reconstruction does not reach (and as the
     room's light). See MarbleWorld: nothing here is ever a black frame. */
  const panoBackdrop = wantSplat && hasPano(real);
  const showPanoLayer = (photo && showPhoto) || panoBackdrop;
  /** The photo layer is actually on screen — only then is it safe to take the measured room away. */
  const photoOnly = showPanoLayer && panoReady;
  /** Furniture is being composited onto a real capture, so it must borrow that capture's light. */
  const composite = photoOnly || splat;
  /** The address's own sun is up: it, not the panorama's estimate, casts the furniture's shadows. */
  const sunUp = Boolean(sky && sky.intensity > 0.01);
  const walkPieces = useMemo(() => [...(showStaging ? room.staging : []), ...buyerPieces], [showStaging, room.staging, buyerPieces]);
  const walking = mode === 'walk' && tool !== 'measure';
  const span = Math.max(room.geometry.width, room.geometry.depth);
  // The panorama doubles as the room's light: PMREM environment plus a sun estimated from it.
  const [panoTex, setPanoTex] = useState<Texture | null>(null);
  /* What that measurement came out as. It drives the Layers panel's readout, and it is also what
     tells an *external* sun (the address's own, `SunLight`) how hard to shine so the two lights add
     up to one room rather than to two. */
  const [light, setLight] = useState<PanoramaLight | null>(null);
  const [budget, setBudget] = useState<LightBudget | null>(null);
  useEffect(() => {
    onCaptureLight(light && budget ? { light, budget } : null);
  }, [light, budget, onCaptureLight]);

  // The minimap and "test my furniture" ask where the viewer stands; in photo view that is the
  // capture point, which never moves.
  const px = frame.position[0];
  const pz = frame.position[2];
  const yaw = captureYaw(frame);
  useEffect(() => {
    if (photo) setPose({ x: px, z: pz, yaw });
  }, [photo, px, pz, yaw, setPose]);

  /* The reconstruction's collider is the only honest answer to "where are the real walls?" — the
     room rectangle is its bounding box and overstates the corner room by 15–20%. The mesh loads
     whether or not the Geometry layer is switched on, so the mask is ready a moment after the room. */
  const [collider, setCollider] = useState<Object3D | null>(null);
  const [walkMask, setWalkMask] = useState<WalkMask | null>(null);
  useEffect(() => {
    if (!collider) {
      setWalkMask(null);
      return;
    }
    let dead = false;
    let tries = 0;
    let timer = 0;
    /* The mesh reaches us straight out of the loader, a beat before r3f has attached it under the
       Marble group — and the mask has to be read in *our* metric frame, so wait for the parent.
       The wait is on a timer, not on `requestAnimationFrame`: r3f attaches the object during a
       React commit, which owes nothing to the render loop, and a throttled or slow frame loop (a
       background tab, a software renderer) used to stretch these sixty ticks into two minutes of
       walking with no collisions but the room rectangle. */
    const build = () => {
      if (dead) return;
      if (!collider.parent && tries++ < 60) {
        timer = window.setTimeout(build, 8);
        return;
      }
      const m = buildWalkMask(collider, {
        seed: { x: px, z: pz },
        reach: Math.max(8, span),
        // The mask never claims floor outside the room the tour states (see WalkMaskOptions.limit).
        limit: { halfWidth: room.geometry.width / 2, halfDepth: room.geometry.depth / 2 },
      });
      setWalkMask(m);
      if (import.meta.env.DEV) window.__audoraWalkMask = m;
    };
    build();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [collider, px, pz, span, room.geometry.width, room.geometry.depth]);
  const home = useMemo(() => ({ x: px, z: pz }), [px, pz]);

  /* Under a real capture the measured shell is not a stand-in any more, it is a milky box drawn
     *inside* the photograph: its walls are a different size, so they read as hard-edged pale panels
     over the splat. Portrait-mode layering means the photo layer wins; the shell only comes back
     when there is no capture on screen. StagingLayer carries its own invisible floor for dragging. */
  const shell = !photoOnly && !splat;

  return (
    <>
      <CameraTuning mode={mode} />
      {/* Sorting half a million splats is per-pixel work; the sharp frame comes back the moment the
          buyer stops moving, which is the only moment they can see it. */}
      <AdaptiveDpr enabled={splat} />
      {/* The real sun owns the shadows whenever the address gives us one; the panorama keeps giving
          the room its colour and its level (the environment map), which is what a photograph's own
          light is for. Below the horizon the estimated sun takes the shadows back. */}
      {composite ? (
        /* `catcher` rather than `shadows`: switching the Shadows layer off must take the shadow off
           the photographed floor without changing the light the furniture is lit by, or the whole
           room dims when the buyer only asked to see the shadow go. */
        <CaptureLight
          texture={panoTex}
          groupRotationY={frame.rotationY}
          span={span}
          floor={{ width: room.geometry.width, depth: room.geometry.depth }}
          shadows={!sunUp}
          catcher={layers.shadows}
          onLight={setLight}
          onBudget={setBudget}
        />
      ) : null}
      {sky ? (
        <SunLight
          room={room.geometry}
          sun={sky}
          composite={composite}
          intensity={composite ? externalSunScale(budget, sky.intensity) : 1}
          shadows={layers.shadows}
          shadowOpacity={composite ? budget?.shadowOpacity : undefined}
        />
      ) : null}
      {shell ? (
        <RoomShell
          room={room.geometry}
          cullNearWalls={mode === 'orbit'}
          showGrid={mode === 'orbit'}
          showCeiling={mode === 'walk'}
          lights={!composite}
          externalSun={Boolean(sky)}
          sunWalls={sky?.walls}
        />
      ) : null}
      {photo && showGeometry ? <FloorGrid span={span} /> : null}
      {real ? (
        /* Keyed on the world: switching rooms (or a full-quality world landing under an open
           viewer) tears the whole capture down instead of re-pointing it. Without the key the
           panorama sphere is deliberately kept mounted across a change — which is how the buyer
           spent several seconds looking at the *previous* room's capture under the new room's
           chrome, minimap and dimensions. */
        <MarbleWorld
          key={real.worldId || real.panoUrl || real.spzUrl}
          world={real}
          metresPerUnit={room.anchor.metresPerUnit}
          floorOffset={floorOffset}
          showPano={showPanoLayer}
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
        <ExplodedLayer active={exploded}>
          <StagingLayer
            room={room.geometry}
            pieces={room.staging}
            buyerPieces={buyerPieces}
            showSeller={showStaging}
            contactShadows={composite && layers.shadows}
            editable={editable && tool !== 'measure' && !exploded}
            lockSeller
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={(pieces, owner) => {
              if (owner === 'buyer') onBuyerChange(pieces);
            }}
          />
        </ExplodedLayer>
      ) : null}
      {photo ? (
        <>
          <PhotoRig origin={frame.position} initialYaw={yaw} fov={photoFov} onFov={setPhotoFov} resetKey={room.id} drift={tool !== 'measure'} />
          <PhotoPose x={px} z={pz} />
        </>
      ) : mode === 'walk' ? (
        <WalkControls room={room.geometry} pieces={walkPieces} enabled={walking} spawn={spawn} mask={real ? walkMask : null} home={real ? home : undefined} collider={real ? collider : null} />
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

  /* ---- the real sun ----
     The tour's site gives the place, the room (or the building) gives the heading, and the hour
     slider gives the instant. `sunState` turns the three into one direction, one colour and one
     sentence, which the scene's light and the HUD's readout both read from. The chosen instant is
     parked on the tour so the next visitor opens on it. */
  const site = tour?.site;
  const heading = effectiveHeading(site?.heading, room?.northWallHeading);
  const setPreviewTime = useAudora((s) => s.setPreviewTime);
  const [previewTime, setLocalPreviewTime] = useState<number>(() => site?.previewTime ?? Date.now());
  useEffect(() => {
    setLocalPreviewTime(useAudora.getState().tours[tourId]?.site?.previewTime ?? Date.now());
  }, [tourId]);
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
  const [layersOpen, setLayersOpen] = useState(false);
  /* The portrait stack: photo, furniture, shadows, occluder — plus the exploded preview. Local to
     this screen on purpose (see ./layers): it is an inspection control, not a preference. */
  const { layers, setLayer, reset: resetLayers, exploded, explode } = usePortraitLayers();
  const [geometryView, setGeometryView] = useState<GeometryView>('wireframe');
  const [captureLight, setCaptureLight] = useState<{ light: PanoramaLight; budget: LightBudget } | null>(null);
  const onCaptureLight = useCallback((info: { light: PanoramaLight; budget: LightBudget } | null) => setCaptureLight(info), []);
  const [timeOpen, setTimeOpen] = useState(false);
  const [hint, setHint] = useState(false);
  const hintShown = useRef<Partial<Record<ViewMode, boolean>>>({});
  const [teleport, setTeleport] = useState<Pose | null>(null);
  const [marbleStatus, setMarbleStatus] = useState<MarbleStatusMap>({});
  const [fullscreen, setFullscreen] = useState(false);
  /* The canvas has drawn its first frame. Until then the viewport is the loading placeholder, and
     anything the HUD centres over it (the welcome card) would hide the one thing the buyer needs
     to see: that the room is still being built. */
  const [sceneReady, setSceneReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const touch = useMemo(() => isTouchDevice(), []);
  const narrow = useNarrow();

  /* Where walking starts.
     On a real reconstruction it is the capture point, facing the way the camera faced (the room's own
     yaw in our frame; see three/splat/frame) — so the buyer's first frame IS the photograph, exactly as it is
     in photo view, and the splat lines up with what they were promised. Everywhere else it is just
     inside the door. Either way `freeSpawn` nudges out of a staged piece, because spawning inside
     the sofa leaves the walker stuck against it. Buyer pieces are deliberately not a dependency:
     dropping a sofa must not teleport the walker back to the door. */
  const realWorld = isReal(world) ? world : undefined;
  const captureFrame = useMarbleFrame(realWorld ?? NO_WORLD, room?.anchor.metresPerUnit ?? 1, floorOffsetOf(room));
  const captureX = captureFrame.position[0];
  const captureZ = captureFrame.position[2];
  const captureFacing = captureYaw(captureFrame);
  const spawn = useMemo<Pose>(() => {
    if (teleport) return teleport;
    if (!room) return { x: 0, z: 0, yaw: 0 };
    const base = realWorld ? { x: captureX, z: captureZ, yaw: captureFacing } : undefined;
    return freeSpawn(room.geometry, room.staging, base);
  }, [teleport, room, realWorld, captureX, captureZ, captureFacing]);

  /* mode on mount, reset on unmount. A public tour of a real reconstruction opens in the photograph. */
  useEffect(() => {
    const st = useViewer.getState();
    st.reset();
    st.setMode(initialMode ?? defaultMode(world, publicMode));
    return () => resetViewer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  /* room change — and a world change, which is what a full-quality upgrade landing under an open
     viewer looks like: fresh spawn, no stale tools, and no stale "the capture is ready" left over
     from the asset that has just been replaced (that would keep the measured shell hidden while the
     new one streams). The mode carries over — unless this room has no panorama to stand in, in
     which case photo view falls back to walking. */
  useEffect(() => {
    setTeleport(null);
    const st = useViewer.getState();
    st.setTool('select');
    st.setSelectedId(null);
    setMarbleStatus({});
    resetLayers();
    const legal = allowedMode(st.mode, world);
    if (legal !== st.mode) st.setMode(legal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, world?.worldId]);

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

  /* first-time hint, once per first-person mode — never before the room it welcomes them into */
  useEffect(() => {
    if (mode === 'orbit' || !sceneReady || hintShown.current[mode]) return;
    hintShown.current[mode] = true;
    setHint(true);
    const t = window.setTimeout(() => setHint(false), 9000);
    return () => window.clearTimeout(t);
  }, [mode, sceneReady]);
  useEffect(() => {
    if (locked) setHint(false);
  }, [locked]);
  /* The card sits in the middle of the frame; a panel opening under it would be half hidden behind
     it with nothing to say so. Opening one is also proof the hint has been read. */
  useEffect(() => {
    if (layersOpen || testOpen || timeOpen) setHint(false);
  }, [layersOpen, testOpen, timeOpen]);

  /* keyboard: Esc closes tools and panels */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useViewer.getState();
      if (st.tool === 'measure') st.setTool('select');
      else if (layersOpen) setLayersOpen(false);
      else if (timeOpen) setTimeOpen(false);
      else if (testOpen) setTestOpen(false);
      setHint(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [testOpen, layersOpen, timeOpen]);

  /* the room switcher scrolls; the room you are in must be the one you can see */
  useEffect(() => {
    const row = pillsRef.current;
    const active = row?.querySelector<HTMLElement>('[data-active="true"]');
    if (!row || !active) return;
    row.scrollTo({ left: Math.max(0, active.offsetLeft - (row.clientWidth - active.clientWidth) / 2), behavior: 'smooth' });
  }, [room?.id, rooms.length]);

  /* fullscreen state */
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const onMarbleStatus = useCallback((s: MarbleWorldStatus) => setMarbleStatus((prev) => ({ ...prev, [s.layer]: s })), []);
  const pill = loadPill(marbleStatus);
  const splatReady = layerReady(marbleStatus, 'splat');
  /** A photograph is on screen (splat or panorama) — the vignette and the capture chip belong to it. */
  const captureOnScreen = Boolean(realWorld) && (splatReady || layerReady(marbleStatus, 'pano'));
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

  /* One switch, seen twice: the Photo row and the store's `showSplat` are the same decision, so the
     panel can never claim the capture is on while the store has it off. */
  const onLayerChange = useCallback(
    (key: keyof PortraitLayers, value: boolean) => {
      setLayer(key, value);
      if (key === 'photo') setShowSplat(value);
      if (publicMode && tour) trackEvent(tour.id, 'toggle', { roomId: room?.id, item: `${key} ${value ? 'on' : 'off'}` });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setLayer, setShowSplat, publicMode, tour?.id, room?.id],
  );

  /* "Light ahead on the left · 62% directional" — the estimate the furniture is actually lit by,
     said relative to the way the buyer is facing, because that is the only frame a person in a room
     has. The bearing follows the coarse pose, so it does not re-render the HUD as you turn. */
  const sunDescription = useMemo<SunDescription | null>(() => {
    if (!captureLight || !room) return null;
    return describeSun(captureLight.light.sun, {
      facing: coarsePose?.yaw,
      windows: windowPositions(room.geometry),
      directionalShare: captureLight.budget.directionalShare,
    });
  }, [captureLight, room, coarsePose?.yaw]);

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
    // One url, copied and quoted: the recipient lands in the room the sender was showing them.
    const url = publicUrl(tour.shareId, room?.id);
    const ok = await copyText(url);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1800);
    toast({ kind: ok ? 'success' : 'warn', title: ok ? 'Link copied' : 'Could not copy', body: ok ? url : 'Copy it from the address bar instead.' });
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
  // Anything real enough to have layers worth switching: the panel also carries the floor nudge.
  const layerWorld = world && (world.panoUrl || world.spzUrl || world.colliderUrl) ? world : undefined;

  return (
    <div ref={wrapRef} className={cx('relative isolate overflow-hidden bg-bg', className)}>
      <SceneCanvas
        camera={{ fov: 50, near: 0.05, far: 200, position: [4, 3, 6] }}
        className="absolute inset-0"
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
        onPointerMissed={() => setSelectedId(null)}
        // The HUD owns the loading line; without a HUD (thumbnails, embeds) the canvas shows it itself.
        busy={hideHud ? panoLoading : false}
        busyLabel={pill?.label}
        busyProgress={pill?.progress ?? null}
        loadingLabel={mode === 'photo' ? 'Developing the photograph…' : 'Building the room…'}
        onReady={() => setSceneReady(true)}
      >
        <Scene
          room={room}
          world={world}
          buyerPieces={buyerPieces}
          onBuyerChange={setBuyerPieces}
          spawn={spawn}
          onMarbleStatus={onMarbleStatus}
          splatReady={splatReady}
          panoReady={panoReady}
          sky={sky}
          layers={layers}
          exploded={exploded}
          geometryView={geometryView}
          onCaptureLight={onCaptureLight}
          editable={buyerPieces.length > 0}
        />
      </SceneCanvas>

      {hideHud ? null : (
        <>
          {/* A soft vignette, the way a photograph sits in a frame. Drawn over the canvas rather
              than in it, so it costs no fill rate and never touches the capture's own colours. */}
          {captureOnScreen ? (
            <div
              className="pointer-events-none absolute inset-0 z-[5]"
              style={{ background: 'radial-gradient(ellipse 78% 78% at 50% 48%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.34) 100%)' }}
              aria-hidden
            />
          ) : null}

          {/* HUD */}
          <div className={cx('pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3 transition-[right] duration-300 md:p-4', testOpen && 'md:right-[400px]')}>
            {/* top row */}
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
              {/* Wide enough for six room chips at desktop width: a buyer who cannot see that the
                  photoreal rooms exist will never open one. It still scrolls on a phone. */}
              <div className="pointer-events-auto glass max-w-full rounded-2xl px-3.5 py-2.5 sm:max-w-[min(70vw,760px)]">
                <div className="flex items-baseline gap-2">
                  <div className="display truncate text-lg leading-tight text-ink md:text-xl">{tour.title}</div>
                  {/* The price is the second thing a buyer looks for; hiding it on a phone left the
                      panel top-heavy over the one screen size it matters most on. */}
                  {tour.price ? <div className="mono shrink-0 text-xs text-ink-3">{tour.price}</div> : null}
                </div>
                {/* `overflow-x-auto` also clips vertically (a scroll container has no `visible`
                    axis), and the mask paints only inside the border box — so the row needs slack
                    above and below the pills or their descenders and lower border are shaved off.
                    The negative margin keeps the panel's own spacing unchanged. */}
                <div ref={pillsRef} className="no-scrollbar -my-0.5 mt-1 flex gap-1 overflow-x-auto py-0.5 [mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)]">
                  {rooms.map((r) => {
                    const active = r.id === room.id;
                    const job = jobFor(r.id);
                    const ready = r.status === 'ready';
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={!ready}
                        data-active={active}
                        onClick={() => switchRoom(r.id)}
                        className={cx(
                          'chip max-w-[11rem] shrink-0 whitespace-nowrap !py-1 transition-colors',
                          active ? '!border-accent/50 !bg-accent/15 !text-accent-2' : ready ? 'hover:!border-ink-3/50 hover:!text-ink' : '!text-ink-3 opacity-80',
                        )}
                        title={ready ? r.name : job ? `${r.name} · ${job.step} · ${job.progress}%` : `${r.name} · ${r.status}`}
                      >
                        {r.status === 'generating' || job ? <Spinner size={11} className="text-accent-2" /> : r.status === 'failed' ? <span className="h-1.5 w-1.5 rounded-full bg-danger" /> : null}
                        <span className="min-w-0 truncate">{r.name}</span>
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
                {layersOpen && layerWorld ? (
                  <LayersPanel
                    roomId={room.id}
                    world={layerWorld}
                    layers={layers}
                    onLayer={onLayerChange}
                    exploded={exploded}
                    onExplode={explode}
                    showGeometry={showGeometry}
                    onGeometry={toggleGeometry}
                    geometryView={geometryView}
                    onGeometryView={setGeometryView}
                    sun={sunDescription}
                    envIntensity={captureLight?.budget.envMapIntensity ?? null}
                    hasCapture={isReal(world)}
                    photoHint={mode === 'orbit' ? 'The dollhouse draws the measured room; walk to stand in the capture.' : undefined}
                    onClose={() => setLayersOpen(false)}
                  />
                ) : null}
                {/* One status slot: the measurement, the measure hint, or what the capture is doing.
                    While the Layers panel is open the slot keeps its height whether or not anything
                    is in it — a load pill mounting under an open panel used to push it 39 px up the
                    screen mid-click, so a tap aimed at Geometry landed on the row above it. */}
                {layersOpen || measurement?.metres != null || tool === 'measure' || pill ? (
                  <div className={cx('flex items-center justify-center', layersOpen && 'min-h-[30px]')}>
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
                        {pill.tone === 'loading' ? <Spinner size={12} /> : pill.tone === 'error' ? <Icon.Warning size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />}
                        <span className={pill.tone === 'info' ? 'mono text-[11px]' : undefined}>{pill.label}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* On a phone this row is wider than the space beside the minimap; it scrolls, and the
                    faded edge is the affordance that says so. */}
                <div className="no-scrollbar glass flex max-w-full items-center gap-1.5 overflow-x-auto rounded-2xl p-1.5 [mask-image:linear-gradient(to_right,black_calc(100%-22px),transparent)] sm:[mask-image:none]">
                  <Segmented size="sm" value={mode} onChange={changeMode} options={modeOptions} />
                  <IconButton label={showStaging ? 'See it bare' : 'Show staging'} active={!showStaging} onClick={toggleStaging} className="h-8 w-8 shrink-0">
                    {showStaging ? <Icon.EyeOff size={15} /> : <Icon.Eye size={15} />}
                  </IconButton>
                  <IconButton label={tool === 'measure' ? 'Stop measuring' : 'Measure'} active={tool === 'measure'} onClick={toggleMeasure} className="h-8 w-8 shrink-0">
                    <Icon.Ruler size={15} />
                  </IconButton>
                  {layerWorld ? (
                    <IconButton label={layersOpen ? 'Close the layers' : 'Layers · the photograph, the furniture and its shadow'} active={layersOpen || showGeometry} onClick={() => setLayersOpen((v) => !v)} className="h-8 w-8 shrink-0">
                      <Icon.Layers size={15} />
                    </IconButton>
                  ) : null}
                  {/* The sun that will actually be in this room, at the hour the buyer picks. */}
                  {site ? (
                    <IconButton label={timeOpen ? 'Close the time of day' : 'Time of day · the real sun'} active={timeOpen} onClick={() => setTimeOpen((v) => !v)} className="h-8 w-8 shrink-0">
                      <Icon.Sun size={15} />
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
