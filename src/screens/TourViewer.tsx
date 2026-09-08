import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { Portals } from '@/three/Portals';
import { showsStaging } from '@/state/staging';
import { TouchJoystick } from '@/three/TouchJoystick';
import { StagingLayer } from '@/three/furniture/StagingLayer';
import { AnchorChip } from '@/components/AnchorChip';
import { FurnitureTest } from '@/components/FurnitureTest';
import { Kbd, SourceLabel, Spinner, StagedLabel, cx, stagedLabelShows } from '@/components/ui';
import { Icon } from '@/components/icons';
import { isTouchDevice, sessionOnce, trackEvent } from './viewer/analytics';
import { copyText, publicUrl } from './viewer/share';
import { TimeOfDay } from './viewer/TimeOfDay';
import { ExplodedLayer } from './viewer/ExplodedLayer';
import { LayersPanel } from './viewer/LayersPanel';
import { usePortraitLayers, type PortraitLayers } from './viewer/layers';
import { freeSpawn } from './viewer/spawn';
import { HudPill, HudPillLink, PillDivider, RoomStrip, TierTag, TopBar, Wordmark, tierWord } from './viewer/hud';
import { MeasuredPanel } from './viewer/MeasuredPanel';
import { UnitMap } from './viewer/UnitMap';
import { MODE_LABEL, allowedMode, defaultMode, floorOffsetOf, hasPano, isReal, layerLoading, layerReady, loadPill, type MarbleStatusMap } from './viewer/marble';
import { arrivalPose, buildUnitGraph, floorBounds, linkRooms, matchPortals, roomOf, type Portal, type PortalMatch, type UnitGraph } from '@shared/unitGraph';

export interface TourViewerProps {
  tourId: string;
  roomId?: string;
  /** Renter mode: no editing, "test my furniture", analytics events. */
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
 * the renter is actually looking, coarsely enough that the slow drift does not re-render the HUD.
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
  /** The panorama's pixel size, for "WHAT THE MODEL MEASURED". */
  onPanoSize: (size: { w: number; h: number } | null) => void;
  /** The doorways out of this room, matched to the plan (`shared/unitGraph`). Empty without a plan. */
  portals: readonly Portal[];
  /** The renter walked through, or clicked, one of them. */
  onPortal: (portal: Portal) => void;
  editable: boolean;
}

function Scene({ room, world, buyerPieces, onBuyerChange, spawn, onMarbleStatus, splatReady, panoReady, sky, layers, exploded, geometryView, onCaptureLight, onPanoSize, portals, onPortal, editable }: SceneProps) {
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
     without throwing the renter out of the room they were standing in. */
  const photo = mode === 'photo' && hasPano(real);
  const showPhoto = layers.photo;
  const wantSplat = mode === 'walk' && showSplat && showPhoto && Boolean(real?.spzUrl);
  const splat = wantSplat && splatReady;
  /* The panorama is up in about a second and the smallest splat in two or three, so while the splat
     streams the renter stands in the photograph rather than in the procedural stand-in — and it stays
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
  /* The panorama's own pixels, straight off the texture — the measurements panel prints them. */
  const takePano = useCallback(
    (t: Texture | null) => {
      setPanoTex(t);
      const img = t?.image as { width?: number; height?: number } | undefined;
      onPanoSize(img?.width && img?.height ? { w: img.width, h: img.height } : null);
    },
    [onPanoSize],
  );

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
          renter stops moving, which is the only moment they can see it. */}
      <AdaptiveDpr enabled={splat} />
      {/* The real sun owns the shadows whenever the address gives us one; the panorama keeps giving
          the room its colour and its level (the environment map), which is what a photograph's own
          light is for. Below the horizon the estimated sun takes the shadows back. */}
      {composite ? (
        /* `catcher` rather than `shadows`: switching the Shadows layer off must take the shadow off
           the photographed floor without changing the light the furniture is lit by, or the whole
           room dims when the renter only asked to see the shadow go. */
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
           panorama sphere is deliberately kept mounted across a change — which is how the renter
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
          onPanoTexture={takePano}
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
      {/* The doorways this room shares with the rest of the flat. Not in the dollhouse: from above
          the room is a diagram, and the unit plan is what shows how it joins the others. */}
      <Portals portals={portals} height={room.geometry.height} enabled={isFirstPerson(mode) && tool !== 'measure'} walking={walking} onEnter={onPortal} />
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
 * The renter's room. Full-bleed canvas with a glass HUD: room switcher, anchor, staging toggle,
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

  /* ---- the unit as one model (docs/ACCURACY.md 3.3) ----
     The floor plan is the only thing that knows this flat is one flat: `buildUnitGraph` turns it
     into rooms, their places and the doors between them, `linkRooms` says which tour room is which
     room on the drawing, and `matchPortals` puts each of those doors on the opening the collider
     actually measured in the room the renter is standing in. Without a plan every one of these is
     empty and the viewer behaves exactly as it did. */
  const floorPlan = tour?.floorPlan;
  const unit = useMemo<UnitGraph | null>(() => (floorPlan?.floors?.length ? buildUnitGraph(floorPlan) : null), [floorPlan]);
  const planRefs = useMemo(
    () => (unit ? linkRooms(unit, rooms.map((r) => ({ id: r.id, name: r.name, planRoomName: r.planDims?.planRoomName, floor: r.planDims?.floor }))) : {}),
    [unit, rooms],
  );
  const roomIdForRef = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, ref] of Object.entries(planRefs)) out[ref] = id;
    return out;
  }, [planRefs]);
  /** One room's doorways, in its own metric frame — the same call for the room we are in and the one we are entering. */
  const portalsFor = useCallback(
    (r: Room | undefined): PortalMatch => {
      const ref = r ? planRefs[r.id] : undefined;
      if (!unit || !r || !ref) return { portals: [], quarters: 0, matched: 0 };
      return matchPortals({
        graph: unit,
        roomRef: ref,
        geometry: r.geometry,
        openings: bestWorld(r)?.bounds?.walls?.openings ?? [],
        /* The openings are in the provider's raw units. The scale that turns them into the frame the
           portals are drawn in is the room's OWN anchor — `Room.geometry` is `applyScale(raw,
           anchor.metresPerUnit)` (state/store), and a doorway has to land on that room's walls. */
        metresPerUnit: r.anchor.metresPerUnit,
      });
    },
    [unit, planRefs],
  );
  /* Only doorways that lead somewhere the renter can actually stand. A plan usually draws rooms the
     leasing team never photographed — a hall, a kitchen — and `matchPortals` reports those doors because
     they are on the drawing; drawing a doorway that does nothing when you walk into it is worse
     than not drawing it. The unit map still shows those rooms, greyed, so the flat stays whole. */
  const doorways = useMemo(() => {
    const all = portalsFor(room);
    const walkable = all.portals.filter((p) => roomIdForRef[p.toRoomRef]);
    return walkable.length === all.portals.length ? all : { ...all, portals: walkable };
  }, [portalsFor, room, roomIdForRef]);

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
  /* Staging deferred (docs/ACCURACY.md 3.7). The leasing team's furniture layer, the renter's
     furniture test and the "digitally staged" label are the three staging surfaces this screen owns;
     each is hidden, not deleted, and the viewer leads with MeasuredPanel's numbers instead. The
     "AI-generated from photos" label is NOT one of them: it is permanent (docs/COPY.md). */
  const stagingLayerOn = useAudora((s) => showsStaging(s.settings, 'staging-layer'));
  const furnitureTestOn = useAudora((s) => showsStaging(s.settings, 'furniture-test'));
  const [layersOpen, setLayersOpen] = useState(false);
  /* "What the model measured" is up by default on a laptop and behind its pill on a phone, where it
     would otherwise cover the room it is describing. */
  const [measuredOpen, setMeasuredOpen] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1024px)').matches : true));
  const [panoSize, setPanoSize] = useState<{ w: number; h: number } | null>(null);
  const onPanoSize = useCallback((s: { w: number; h: number } | null) => setPanoSize(s), []);
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
  /* Where the renter lands in the room they are walking INTO. It cannot be a teleport yet — the room
     has not changed — and the room-change effect below is what turns it into one, so that walking
     through a doorway puts them just inside the next room's matching door rather than back at its
     own capture point. */
  const arrival = useRef<{ roomId: string; pose: Pose } | null>(null);
  const [marbleStatus, setMarbleStatus] = useState<MarbleStatusMap>({});
  const [fullscreen, setFullscreen] = useState(false);
  /* The canvas has drawn its first frame. Until then the viewport is the loading placeholder, and
     anything the HUD centres over it (the welcome card) would hide the one thing the renter needs
     to see: that the room is still being built. */
  const [sceneReady, setSceneReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const touch = useMemo(() => isTouchDevice(), []);
  const narrow = useNarrow();

  /* Where walking starts.
     On a real reconstruction it is the capture point, facing the way the camera faced (the room's own
     yaw in our frame; see three/splat/frame) — so the renter's first frame IS the photograph, exactly as it is
     in photo view, and the splat lines up with what they were promised. Everywhere else it is just
     inside the door. Either way `freeSpawn` nudges out of a staged piece, because spawning inside
     the sofa leaves the walker stuck against it. Renter pieces are deliberately not a dependency:
     dropping a sofa must not teleport the walker back to the door. */
  const realWorld = isReal(world) ? world : undefined;
  const captureFrame = useMarbleFrame(realWorld ?? NO_WORLD, room?.anchor.metresPerUnit ?? 1, floorOffsetOf(room));
  const captureX = captureFrame.position[0];
  const captureZ = captureFrame.position[2];
  const captureFacing = captureYaw(captureFrame);
  const spawn = useMemo<Pose>(() => {
    if (teleport) return teleport;
    // Read on this render rather than waiting for the effect below to turn it into a teleport: the
    // room has already changed, and one frame spent at the capture point would be a visible jump
    // out of the doorway the renter just walked through.
    if (arrival.current && arrival.current.roomId === room?.id) return arrival.current.pose;
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
    // A room reached through a doorway starts at that doorway; any other room change starts fresh.
    const landing = arrival.current;
    arrival.current = null;
    setTeleport(landing && landing.roomId === room?.id ? landing.pose : null);
    const st = useViewer.getState();
    st.setTool('select');
    st.setSelectedId(null);
    setMarbleStatus({});
    setPanoSize(null);
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
    if (layersOpen || testOpen || timeOpen || (narrow && measuredOpen)) setHint(false);
  }, [layersOpen, testOpen, timeOpen, narrow, measuredOpen]);

  /* The scene, the minimap, the walk mask and the fit verdict all read `showStaging`, so switching
     it off is what actually removes the leasing team's furniture — hiding the toggle alone would leave a
     staged room on screen with no way back. The renter's own panel is closed for the same reason. */
  useEffect(() => {
    if (!stagingLayerOn) setShowStaging(false);
  }, [stagingLayerOn, setShowStaging]);
  useEffect(() => {
    if (!furnitureTestOn) setTestOpen(false);
  }, [furnitureTestOn]);

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

  /**
   * Through a doorway. The room on the other side has a doorway back — the same opening, measured
   * from inside it — so the renter steps out of *that* one, facing into the room, rather than being
   * dropped at its capture point. Photo view has no way to walk, so going through starts walking.
   */
  const onPortal = useCallback(
    (portal: Portal) => {
      const nextId = roomIdForRef[portal.toRoomRef];
      const next = rooms.find((r) => r.id === nextId);
      if (!next || next.id === room?.id) return;
      const back = portalsFor(next).portals.find((p) => p.toRoomRef === planRefs[room?.id ?? '']);
      const pose = back ? arrivalPose(back, next.geometry) : null;
      // `freeSpawn` for the same reason walking always uses it: landing inside the sofa behind the
      // door leaves the renter stuck against it.
      arrival.current = pose ? { roomId: next.id, pose: freeSpawn(next.geometry, next.staging, pose) } : null;
      if (useViewer.getState().mode === 'photo') setMode('walk');
      setLocalRoomId(next.id);
      onRoomChange?.(next.id);
      if (publicMode && tourId) trackEvent(tourId, 'toggle', { roomId: next.id, item: `door to ${portal.toName}` });
    },
    [roomIdForRef, rooms, room?.id, portalsFor, planRefs, setMode, onRoomChange, publicMode, tourId],
  );

  const changeMode = (m: ViewMode) => {
    if (m === mode) return;
    if (m === 'walk' && room) {
      // resume where the renter last stood (in photo view that is the capture point), not at the door
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
     said relative to the way the renter is facing, because that is the only frame a person in a room
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
  const modeOptions: { value: ViewMode; label: string; title: string; icon: ReactNode }[] = [
    ...(hasPano(world) ? [{ value: 'photo' as ViewMode, label: 'Photo', title: 'Stand where the photo was taken', icon: <Icon.Camera size={14} /> }] : []),
    { value: 'walk' as ViewMode, label: 'Walk', title: 'Walk the room at 1.60 m eye height', icon: <Icon.Walk size={14} /> },
    { value: 'orbit' as ViewMode, label: 'Dollhouse', title: 'Look down into the measured room', icon: <Icon.Orbit size={14} /> },
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
        {tour ? 'This unit has no rooms yet.' : 'This unit does not exist.'}
      </div>
    );
  }

  const cmUncertainty = Math.max(1, Math.round(room.anchor.uncertaintyM * 100));
  /* The corner plan. With a floor plan behind it that is the whole flat with the renter standing
     in one of its rooms; without one it is this room, measured from its own collider. The unit map
     only takes over when the plan really places this room among others — a one-room plan, or a room
     the plan never named, is better served by the room's own drawing. */
  const unitRef = unit ? planRefs[room.id] : undefined;
  const unitRoom = unit && unitRef ? roomOf(unit, unitRef) : undefined;
  const unitBox = unit && unitRoom ? floorBounds(unit, unitRoom.floorIndex) : null;
  const showUnit = Boolean(unit && unitRef && unitBox && unit.rooms.filter((r) => r.floorIndex === unitRoom!.floorIndex).length > 1);
  /* The unit map carries room names and printed dimensions and the room map does not, so it needs
     the room to draw them: at 178 px a five-room storey put "Living room" on screen 2.8 px tall.
     It is also given a floor on the short axis, because a wide storey (rooms chained along one
     line) would otherwise letterbox down to a strip too shallow for a name and a dimension. */
  const planSize = showUnit ? (narrow || touch ? 168 : 252) : narrow || touch ? 96 : 140;
  const planW = showUnit && unitBox ? unitBox.maxX - unitBox.minX + 1.8 : room.geometry.width + 1.1;
  const planH = showUnit && unitBox ? unitBox.maxZ - unitBox.minZ + 1.8 : room.geometry.depth + 1.1;
  const planFit = planW >= planH ? { w: planSize, h: (planSize * planH) / planW } : { w: (planSize * planW) / planH, h: planSize };
  const plan = showUnit ? { w: planFit.w, h: Math.max(planFit.h, narrow || touch ? 96 : 132) } : planFit;
  const jobFor = (id: string) => jobs.filter((j) => j.roomId === id && (j.status === 'queued' || j.status === 'running')).pop();
  const stagingForVerdict = showStaging ? room.staging : [];
  // Anything real enough to have layers worth switching: the panel also carries the floor nudge.
  const layerWorld = world && (world.panoUrl || world.spzUrl || world.colliderUrl) ? world : undefined;
  /** "Draft" / "Full" / "Simulated" — the quiet tag beside the wordmark, as in the prototype. */
  const tier = tierWord(room);

  return (
    <div ref={wrapRef} className={cx('relative isolate overflow-hidden bg-bg', className)}>
      <SceneCanvas
        camera={{ fov: 50, near: 0.05, far: 200, position: [4, 3, 6] }}
        className="absolute inset-0"
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
        onPointerMissed={() => setSelectedId(null)}
        // The HUD owns the loading line; without a HUD (thumbnails, embeds) the canvas shows it itself.
        busy={hideHud ? panoLoading : false}
        /* Even before the first frame the card says what is actually coming down ("Loading the real
           capture · 100k splats · 62%") instead of a static "Building the room…" for half a minute. */
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
          onPanoSize={onPanoSize}
          portals={doorways.portals}
          onPortal={onPortal}
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
              style={{ background: 'radial-gradient(ellipse 80% 80% at 50% 46%, rgba(10,10,10,0) 52%, rgba(10,10,10,0.16) 100%)' }}
              aria-hidden
            />
          ) : null}

          {/* ---- top bar: the wordmark and the tier on the left, the pill group on the right ---- */}
          <TopBar
            left={
              <>
                <Wordmark to={publicMode ? '/' : null} />
                {tier ? <TierTag>{tier}</TierTag> : null}
                <span className="hidden h-4 w-px shrink-0 bg-line-2 sm:block" aria-hidden />
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="display min-w-0 truncate text-[17px] leading-none text-ink">{tour.title}</span>
                  {tour.price ? <span className="mono shrink-0 text-[11.5px] text-dim">{tour.price}</span> : null}
                </div>
              </>
            }
            right={
              <>
                {/* The words stay on a phone. Nine identical 44 px circles told a first-time renter
                    nothing about which one measures and which one tests furniture; the row scrolls
                    (with a fade and an arrow, see TopBar) rather than dropping every label. */}
                {modeOptions.map((o) => (
                  <HudPill key={o.value} active={mode === o.value} onClick={() => changeMode(o.value)} icon={o.icon} title={o.title}>
                    {o.label}
                  </HudPill>
                ))}
                <PillDivider />
                <HudPill active={measuredOpen} onClick={() => setMeasuredOpen((v) => !v)} icon={<Icon.Info size={14} />} title="What the model measured">
                  <span className="hidden lg:inline">Measurements</span>
                </HudPill>
                {layerWorld ? (
                  <HudPill active={layersOpen || showGeometry} onClick={() => setLayersOpen((v) => !v)} icon={<Icon.Layers size={14} />} title="Layers · the photograph, the furniture and its shadow">
                    <span className="hidden lg:inline">Layers</span>
                  </HudPill>
                ) : null}
                <HudPill active={tool === 'measure'} onClick={toggleMeasure} icon={<Icon.Ruler size={14} />} title={tool === 'measure' ? 'Stop measuring' : 'Measure anything'}>
                  Measure
                </HudPill>
                {/* Black, not blue: this is a chrome toggle sitting beside four black/white siblings.
                    The renter's blue belongs to the piece, its dimension chip and the verdict card. */}
                {furnitureTestOn ? (
                  <HudPill active={testOpen} onClick={() => setTestOpen((v) => !v)} icon={<Icon.Sofa size={14} />} title="Test your own furniture in this room">
                    {testOpen ? 'Close' : 'Test my furniture'}
                    {buyerPieces.length ? <span className="mono text-[11px] opacity-70">{buyerPieces.length}</span> : null}
                  </HudPill>
                ) : null}
                {stagingLayerOn ? (
                  <>
                    <PillDivider />
                    <HudPill square active={!showStaging} onClick={toggleStaging} aria-label={showStaging ? 'See it bare' : 'Show staging'} title={showStaging ? 'See it bare' : 'Show staging'}>
                      {showStaging ? <Icon.EyeOff size={15} /> : <Icon.Eye size={15} />}
                    </HudPill>
                  </>
                ) : null}
                {site ? (
                  <HudPill square active={timeOpen} onClick={() => setTimeOpen((v) => !v)} aria-label="Time of day" title={timeOpen ? 'Close the time of day' : 'Time of day · the real sun'}>
                    <Icon.Sun size={15} />
                  </HudPill>
                ) : null}
                <HudPill square active={copied} onClick={share} aria-label={copied ? 'Copied' : 'Copy share link'} title={copied ? 'Copied' : 'Copy share link'}>
                  {copied ? <Icon.Check size={15} /> : <Icon.Share size={15} />}
                </HudPill>
                <HudPill square active={fullscreen} onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                  <Icon.Fullscreen size={15} />
                </HudPill>
                {publicMode ? (
                  <HudPillLink to="/" external icon={<Icon.Logo size={12} />} title="Made with Audora" className="hidden xl:inline-flex">
                    Made with Audora
                  </HudPillLink>
                ) : null}
              </>
            }
          />

          {/* ---- left: what the model measured ---- */}
          {measuredOpen ? (
            <div
              className="pointer-events-none absolute z-20 flex justify-start"
              style={narrow ? { left: 12, right: 12, bottom: 92 } : { left: 14, top: 'calc(var(--hud-top, 52px) + 6px)' }}
            >
              <MeasuredPanel
                room={room}
                world={world}
                cameraHeight={realWorld ? captureFrame.position[1] : null}
                pano={panoSize}
                status={marbleStatus}
                onClose={() => setMeasuredOpen(false)}
                className="max-h-[52vh] sm:max-h-[calc(100vh_-_var(--hud-top,52px)_-_120px)]"
              />
            </div>
          ) : null}

          {/* ---- HUD, above the room strip ---- */}
          {/* `mt-auto` rather than `justify-end`: a flex column that justifies to the end overflows
              past its own start, so with the Layers panel and Time of day both open the top panel's
              heading slid up under the top bar and could not be scrolled back. An auto margin puts
              the stack on the floor when it fits and lets it scroll when it does not. */}
          <div className={cx('pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-y-auto no-scrollbar p-3 pb-[86px] transition-[right] duration-300 md:p-4 md:pb-[88px]', testOpen && 'md:right-[356px]')} style={{ top: 'calc(var(--hud-top, 52px) + 6px)' }}>
            <div className="mt-auto grid grid-cols-[auto_auto] items-end justify-between gap-2 sm:h-full sm:max-h-full sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-rows-[minmax(0,1fr)] sm:gap-3">
              {/* the plan, the anchor and the disclosure — the three things that must never leave the screen */}
              <div className="flex flex-col items-start gap-1.5 justify-self-start">
                <div className="glass pointer-events-auto hidden rounded-2xl p-2 sm:block" style={{ width: plan.w + 16 }}>
                  {showUnit && unit ? (
                    <UnitMap
                      graph={unit}
                      activeRoomRef={unitRef}
                      quarters={doorways.quarters}
                      onPickRoom={(ref) => {
                        const id = roomIdForRef[ref];
                        if (id) switchRoom(id);
                      }}
                      onWalkTo={teleportTo}
                      style={{ height: plan.h + 26 }}
                      className="w-full"
                    />
                  ) : (
                    <Minimap room={room.geometry} pieces={room.staging} buyerPieces={buyerPieces} showSeller={showStaging} selectedId={selectedId} uncertaintyM={room.anchor.uncertaintyM} onClick={teleportTo} style={{ height: plan.h + 22 }} className="w-full" />
                  )}
                </div>
                <div className="pointer-events-auto flex max-w-[60vw] flex-wrap items-center gap-1.5">
                  <AnchorChip anchor={room.anchor} size="sm" className="max-w-full bg-[color:var(--color-glass)] backdrop-blur-md" />
                  {/* Permanent: every frame of this model came from photographs of the unit. */}
                  <SourceLabel className="bg-[color:var(--color-glass)] backdrop-blur-md" />
                  {/* Furniture that is not in the unit — only when there actually is some on screen. */}
                  {stagedLabelShows(room.staging.length, stagingLayerOn) ? <StagedLabel className="bg-[color:var(--color-glass)] backdrop-blur-md" /> : null}
                </div>
              </div>

              <div className="no-scrollbar pointer-events-auto order-last col-span-2 flex max-h-full min-h-0 min-w-0 max-w-full flex-col items-center gap-2 justify-self-center overflow-y-auto sm:order-none sm:col-span-1">
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
                        <Icon.Ruler size={14} className="text-gold" />
                        <span className="mono text-sm text-ink">{measurement.metres.toFixed(2)} m</span>
                        <span className="mono text-xs text-dim">± {cmUncertainty}cm</span>
                        <button type="button" className="text-faint hover:text-ink" onClick={() => setMeasurement(null)} aria-label="Clear measurement">
                          <Icon.X size={14} />
                        </button>
                      </div>
                    ) : tool === 'measure' ? (
                      <div className="glass animate-fade rounded-full px-3 py-1.5 text-xs text-ink-2">
                        Click two points to measure. <span className="mono text-dim">± {cmUncertainty}cm</span>
                      </div>
                    ) : pill ? (
                      <div className={cx('glass animate-fade flex items-center gap-2 rounded-full px-3 py-1.5 text-xs', pill.tone === 'error' ? 'text-warn' : 'text-ink-2')}>
                        {pill.tone === 'loading' ? <Spinner size={12} /> : pill.tone === 'error' ? <Icon.Warning size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-ink" aria-hidden />}
                        <span className={pill.tone === 'info' ? 'mono text-[11px]' : undefined}>{pill.label}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="pointer-events-auto flex flex-col items-end gap-2 justify-self-end">
                {mode === 'walk' && touch ? <TouchJoystick size={112} /> : <div className="hidden w-[140px] md:block" aria-hidden />}
              </div>
            </div>
          </div>

          {/* ---- the rooms in this unit ---- */}
          <RoomStrip
            rooms={rooms}
            activeId={room.id}
            onPick={switchRoom}
            progressFor={(r) => {
              const j = jobFor(r.id);
              return j ? j.progress : null;
            }}
          />

          {/* first-time hint */}
          {hint && mode !== 'orbit' ? (
            <button
              type="button"
              onClick={() => setHint(false)}
              /* `left-1/2` leaves an absolutely positioned card only half the viewport to grow into,
                 which on a phone turned one sentence into five lines; `w-max` takes the width the
                 sentence needs and the max clamps it back inside the screen. */
              className="glass pointer-events-auto absolute left-1/2 top-1/2 z-20 flex w-max max-w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 animate-rise flex-col items-center gap-2 rounded-2xl px-6 py-5 text-center"
            >
              <div className="display text-2xl leading-tight text-ink">
                {mode === 'photo' ? `You are standing where the photo was taken.` : `You are standing in the ${room.name.toLowerCase()}.`}
              </div>
              {mode === 'photo' ? (
                <div className="text-sm text-dim">{touch ? 'Drag to look around · pinch to zoom' : 'Drag to look around · scroll to zoom · Walk to move'}</div>
              ) : touch ? (
                <div className="text-sm text-dim">Drag to look · use the stick or tap the floor to move</div>
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-dim">
                  <span>Drag to look</span>
                  <span className="text-dim">·</span>
                  <span className="inline-flex items-center gap-1"><Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd> or click the floor to move</span>
                  <span className="text-dim">·</span>
                  <span className="inline-flex items-center gap-1">double-click for mouse look, <Kbd>Esc</Kbd> releases</span>
                </div>
              )}
              <div className="mono text-[11px] text-dim">
                {mode === 'photo' ? 'capture point' : 'eye height 1.60 m'} · {room.geometry.width.toFixed(2)} × {room.geometry.depth.toFixed(2)} m
              </div>
            </button>
          ) : null}

          {/* the renter's own furniture: the prototype's right-hand glass panel, a bottom sheet on a phone */}
          {testOpen && furnitureTestOn ? (
            <div className="glass animate-rise absolute inset-x-0 bottom-0 z-40 max-h-[70vh] rounded-t-2xl md:inset-x-auto md:bottom-[92px] md:right-3.5 md:top-[var(--hud-top,52px)] md:max-h-none md:w-[340px] md:rounded-2xl">
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
                className="max-h-[70vh] md:max-h-none"
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
