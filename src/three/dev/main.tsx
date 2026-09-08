/**
 * Dev harness for the 3D core (not part of the app bundle). Open
 * http://localhost:5173/src/three/dev/index.html — add `?splat=sample` to load Spark's public
 * butterfly sample into the room, or `?room=2` to pick another demo room.
 *
 * For the photoreal layers, `?room=4` is the real Marble draft (an empty corner room) and `?room=5`
 * the full-quality furnished flat. Switch to Photo, turn Geometry on, and check the purple wireframe
 * against the panorama's walls; `?panoYaw=<degrees>` nudges the panorama inside the Marble group if
 * a future world needs a different convention.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@/index.css';
import { seedDemo } from '@/state/seed';
import { bestWorld, useAllTours, useTourRooms } from '@/state/store';
import { AnchorChip } from '@/components/AnchorChip';
import { Button, Chip, Kbd, Segmented, StagedLabel, Toggle } from '@/components/ui';
import { Icon } from '@/components/icons';
import { StagingLayer } from '@/three/furniture/StagingLayer';
import { SceneCanvas } from '../SceneCanvas';
import { RoomShell } from '../RoomShell';
import { OrbitRig, PhotoRig } from '../OrbitRig';
import { MarbleWorld, useMarbleFrame, type MarbleWorldStatus } from '../MarbleWorld';
import { WalkControls } from '../WalkControls';
import { MeasureTool } from '../MeasureTool';
import { Minimap } from '../Minimap';
import { TouchJoystick } from '../TouchJoystick';
import { SplatWorld, type SplatStatus } from '../SplatWorld';
import { StillsCapturer, type CaptureFn, type Still } from '../stills';
import { useViewer } from '../viewerStore';
import type { RoomWorld } from '@/state/types';

/** An empty stand-in so the Marble frame hook can be called for rooms with no reconstruction. */
const NO_WORLD = { metricScaleFactor: null, groundPlaneOffset: null, bounds: undefined } as const;

/** Spark's public sample splat. Dev harness only; never referenced by a production code path. */
const SPARK_SAMPLE_URL = 'https://sparkjs.dev/assets/splats/butterfly.spz';

seedDemo();

function Harness() {
  const tours = useAllTours();
  const tour = tours.find((t) => t.shareId === 'oak1247') ?? tours[0];
  const rooms = useTourRooms(tour?.id);
  const params = new URLSearchParams(location.search);
  const idx = Math.min(rooms.length - 1, Math.max(0, Number(params.get('room') ?? 0)));
  const room = rooms[idx];
  const mode = useViewer((s) => s.mode);
  const setMode = useViewer((s) => s.setMode);
  const tool = useViewer((s) => s.tool);
  const setTool = useViewer((s) => s.setTool);
  const pose = useViewer((s) => s.pose);
  const measurement = useViewer((s) => s.measurement);
  const requestTeleport = useViewer((s) => s.requestTeleport);
  const showStaging = useViewer((s) => s.showStaging);
  const setShowStaging = useViewer((s) => s.setShowStaging);
  const [ceiling, setCeiling] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [splatStatus, setSplatStatus] = useState<{ s: SplatStatus; d?: string } | null>(null);
  const [stills, setStills] = useState<Still[]>([]);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const captureRef = useRef<CaptureFn | null>(null);
  const splatParam = params.get('splat');
  const onStatus = useCallback((s: SplatStatus, d?: string) => setSplatStatus({ s, d }), []);
  const splatWorld = useMemo<RoomWorld | null>(() => {
    if (!splatParam || !room) return null;
    const url = splatParam === 'sample' ? SPARK_SAMPLE_URL : splatParam === 'broken' ? 'https://example.invalid/nope.spz' : splatParam;
    return { ...(room.draft as RoomWorld), spzUrl: url, metricScaleFactor: 1, groundPlaneOffset: 0 };
  }, [splatParam, room]);
  const [showSplat, setShowSplat] = useState(true);
  const showGeometry = useViewer((s) => s.showGeometry);
  const setShowGeometry = useViewer((s) => s.setShowGeometry);
  const photoFov = useViewer((s) => s.photoFov);
  const setPhotoFov = useViewer((s) => s.setPhotoFov);
  const [marble, setMarble] = useState<MarbleWorldStatus | null>(null);
  const onMarble = useCallback((st: MarbleWorldStatus) => setMarble(st), []);
  const realWorld = room ? bestWorld(room) : undefined;
  const real = realWorld && (realWorld.panoUrl || realWorld.spzUrl) ? realWorld : undefined;
  const panoYaw = (Number(params.get('panoYaw') ?? 0) * Math.PI) / 180;
  const marbleFrame = useMarbleFrame(real ?? NO_WORLD, room?.anchor.metresPerUnit ?? 1, room?.floorOffset ?? 0);
  const photo = mode === 'photo' && Boolean(real?.panoUrl);
  if (!tour || !room) return <div className="p-10">No demo unit</div>;
  const g = room.geometry;
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg">
      <SceneCanvas className="absolute inset-0" busy={marble?.layer === 'pano' && marble.status === 'loading'} busyLabel={`Loading the panorama${marble?.progress?.ratio != null ? ` · ${Math.round(marble.progress.ratio * 100)}%` : '…'}`} busyProgress={marble?.progress?.ratio ?? null}>
        {photo ? (
          <>
            <ambientLight intensity={0.85} />
            <directionalLight position={[3, 8, 4]} intensity={1.1} />
          </>
        ) : (
          <RoomShell room={g} cullNearWalls={mode === 'orbit'} showCeiling={ceiling} />
        )}
        {real ? (
          <MarbleWorld
            world={real}
            metresPerUnit={room.anchor.metresPerUnit}
            floorOffset={room.floorOffset ?? 0}
            showPano={photo}
            showSplat={mode === 'walk' && Boolean(real.spzUrl) && showSplat}
            showGeometry={showGeometry && Boolean(real.colliderUrl)}
            onStatus={onMarble}
          />
        ) : null}
        <StagingLayer room={g} pieces={room.staging} showSeller={showStaging} />
        {photo ? (
          <PhotoRig origin={marbleFrame.position} fov={photoFov} onFov={setPhotoFov} initialYaw={panoYaw} resetKey={resetKey} />
        ) : mode === 'orbit' ? (
          <OrbitRig room={g} resetKey={resetKey} azimuthOffset={Number(params.get('az') ?? 0.42)} />
        ) : (
          <WalkControls room={g} pieces={room.staging} />
        )}
        <MeasureTool room={g} enabled={tool === 'measure'} uncertaintyM={room.anchor.uncertaintyM} />
        {splatWorld ? <SplatWorld world={splatWorld} visible={showSplat} onStatus={onStatus} transform={{ y: 1.2 }} /> : null}
        <StillsCapturer room={g} onReady={(c) => { captureRef.current = c; (window as unknown as { __audoraCapture?: CaptureFn }).__audoraCapture = c; }} watermark={['AI-generated from photos', `anchor: ${room.anchor.label}`, `${tour.title} · ${room.name}`]} />
      </SceneCanvas>
      {/* top bar */}
      <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2">
        <div className="glass flex items-center gap-2 rounded-2xl px-3 py-2">
          <Segmented
            size="sm"
            value={mode}
            onChange={(m) => setMode(m)}
            options={[
              { value: 'orbit' as const, label: 'Dollhouse', icon: <Icon.Orbit size={14} /> },
              { value: 'walk' as const, label: 'Walk', icon: <Icon.Walk size={14} /> },
              ...(real?.panoUrl ? [{ value: 'photo' as const, label: 'Photo', icon: <Icon.Camera size={14} /> }] : []),
            ]}
          />
          <Segmented
            size="sm"
            value={tool}
            onChange={(t) => setTool(t)}
            options={[
              { value: 'select', label: 'Select', icon: <Icon.Cursor size={12} /> },
              { value: 'measure', label: 'Measure', icon: <Icon.Ruler size={14} /> },
            ]}
          />
          <Button size="sm" onClick={() => setResetKey((k) => k + 1)}>
            <Icon.Rotate size={14} /> Re-frame
          </Button>
          <Toggle checked={ceiling} onChange={setCeiling} label="Ceiling" />
          <Toggle checked={showStaging} onChange={setShowStaging} label="Staging" />
          {splatWorld || real?.spzUrl ? <Toggle checked={showSplat} onChange={setShowSplat} label="Splat" /> : null}
          {real?.colliderUrl ? <Toggle checked={showGeometry} onChange={setShowGeometry} label="Geometry" /> : null}
        </div>
        <div className="glass flex items-center gap-2 rounded-2xl px-3 py-2 text-xs text-ink-2">
          <span className="mono">
            {g.width.toFixed(2)} × {g.depth.toFixed(2)} × {g.height.toFixed(2)} m
          </span>
          <AnchorChip anchor={room.anchor} size="sm" />
          <StagedLabel />
        </div>
      </div>
      {/* right: status */}
      <div className="absolute right-4 top-4 flex flex-col items-end gap-2 text-xs">
        <div className="glass mono rounded-xl px-3 py-2 text-ink-2">
          pose {pose.x.toFixed(2)}, {pose.z.toFixed(2)} · yaw {((pose.yaw * 180) / Math.PI).toFixed(0)}°
        </div>
        {measurement?.metres !== undefined ? (
          <div className="glass mono rounded-xl px-3 py-2 text-ink">
            {measurement.metres.toFixed(2)} m <span className="text-ink-3">±{Math.round((measurement.uncertaintyM ?? 0) * 100)}cm</span>
          </div>
        ) : tool === 'measure' ? (
          <div className="glass rounded-xl px-3 py-2 text-ink-3">Click two points. <Kbd>Esc</Kbd> resets.</div>
        ) : null}
        {marble ? (
          <Chip tone={marble.status === 'error' ? 'danger' : marble.status === 'ready' ? 'ok' : 'neutral'} mono>
            {marble.layer}: {marble.status}
            {marble.detail ? ` · ${marble.detail}` : marble.progress?.ratio != null ? ` · ${Math.round(marble.progress.ratio * 100)}%` : ''}
          </Chip>
        ) : null}
        {photo ? <div className="glass mono rounded-xl px-3 py-2 text-ink-2">fov {photoFov.toFixed(0)}° · origin {marbleFrame.position.map((n) => n.toFixed(2)).join(', ')} · scale {marbleFrame.scale.toFixed(3)} {marbleFrame.metric ? '(metric)' : '(anchor)'}</div> : null}
        {splatStatus ? (
          <Chip tone={splatStatus.s === 'error' ? 'danger' : splatStatus.s === 'ready' ? 'ok' : 'neutral'} mono>
            splat: {splatStatus.s}
            {splatStatus.d ? ` · ${splatStatus.d}` : ''}
          </Chip>
        ) : null}
        {mode === 'walk' ? (
          <div className="glass rounded-xl px-3 py-2 text-ink-3">
            Drag to look · click floor to go · <Kbd>W</Kbd>
            <Kbd>A</Kbd>
            <Kbd>S</Kbd>
            <Kbd>D</Kbd> · <Kbd>⇧</Kbd> hurry · double-click locks
          </div>
        ) : null}
      </div>
      {/* bottom-left: minimap */}
      <div className="absolute bottom-4 left-4 glass rounded-2xl p-3" style={{ width: 220 }}>
        <Minimap room={g} pieces={room.staging} showSeller={showStaging} uncertaintyM={room.anchor.uncertaintyM} onClick={(x, z) => { if (mode !== 'walk') setMode('walk'); requestTeleport(x, z); }} className="h-[180px]" />
      </div>
      {/* bottom-right: joystick + stills */}
      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-3">
        {captureError ? <Chip tone="danger">stills: {captureError}</Chip> : null}
        {stills.length ? (
          <div className="glass flex gap-2 rounded-2xl p-2">
            {stills.map((s) => (
              <img key={s.name} src={s.dataUrl} alt={s.name} title={s.name} className="h-24 rounded-lg border border-line" />
            ))}
          </div>
        ) : null}
        <Button
          size="sm"
          onClick={async () => {
            try {
              const out = await captureRef.current?.();
              if (out) setStills(out);
            } catch (e) {
              setCaptureError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          <Icon.Camera size={14} /> Capture stills
        </Button>
        {mode === 'walk' ? <TouchJoystick size={120} /> : null}
      </div>
    </div>
  );
}

const strict = new URLSearchParams(location.search).get('strict') === '1';
ReactDOM.createRoot(document.getElementById('root')!).render(strict ? (
  <React.StrictMode>
    <Harness />
  </React.StrictMode>
) : (
  <Harness />
));
