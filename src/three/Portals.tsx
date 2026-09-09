/**
 * Doorways you can walk through — docs/ACCURACY.md section 3.3, "the unit as one model".
 *
 * A room's collider knows where its openings are and the floor plan knows which room is on the
 * other side of each of them; `shared/unitGraph` puts the two together and hands this component the
 * result. What is left here is only how a doorway *looks* and how you go through it: a pane of
 * light standing in the opening with an ink frame round it, a threshold on the floor, and the name
 * of the room it leads to once you are near enough to care.
 *
 * Conventions:
 * - **One opening, two things drawn on it.** Where a doorway *is* — its wall, offset, width and
 *   height — is decided once, by `doorOpeningsFor` in `three/RoomShell`, and passed to both the
 *   shell that cuts the wall and this file that stands a marker in the hole. A caller that passes
 *   `doorways` gives the two components the same array; the pane can then only ever be the size and
 *   the place of the hole behind it.
 * - **Metres, in the room's own frame.** Every doorway is already positioned on one of Audora's four
 *   walls (`x/z`, floor y = 0), so this file does no frame arithmetic at all — it turns the
 *   group to `yaw + π` so local +z points out through the doorway and draws in that local frame.
 * - **Two ways through, one event.** Walking within {@link PORTAL_ENTER_M} of a doorway goes
 *   through it, and so does clicking it. A doorway is *armed* only once the renter has been further
 *   than `ARM_M` from it, so arriving next to the door you just came out of does not bounce you
 *   straight back.
 * - **Subtle.** It is drawn over a photograph, so it is white light and a hairline, never a UI
 *   colour: the renter should see the room, and the doorway only when they look at it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { DoubleSide } from 'three';
import { PORTAL_ENTER_M, type Portal } from '@shared/unitGraph';
import { DOORWAY_HEIGHT_M, MIN_DOORWAY_M, doorwayHeight, type DoorOpening } from './RoomShell';
import { useViewer, type Pose } from './viewerStore';

/**
 * A standard interior door — the same 2.03 m the door anchor measures against, and the same number
 * `RoomShell` cuts its wall with, because a lit pane that is not the size of the hole behind it is
 * the bug this module and that one share one rule to avoid.
 */
export const PORTAL_HEIGHT_M = DOORWAY_HEIGHT_M;
/** How far the renter has to get from a doorway before walking into it counts again. */
const ARM_M = 1.4;
/** Within this, the doorway says which room it leads to. */
const NEAR_M = 3.2;

const INK = '#0a0a0a';
const LIGHT = '#ffffff';

/** A doorway with the graph's own record of where it leads: what this file draws a marker for. */
type Marker = DoorOpening & { portal: Portal };

const hasPortal = (d: DoorOpening): d is Marker => Boolean(d.portal);

/**
 * One portal as the doorway it is, for a caller that does not yet pass the room's own answer.
 * `matchPortals` has already put every portal on this room's walls, so the only thing left to bound
 * is the height; the moment a caller passes `doorways`, the shell and these markers are literally
 * reading one array.
 */
function markerOf(portal: Portal, roomHeight: number): Marker {
  return {
    id: portal.id,
    wall: portal.wall,
    offset: portal.offset,
    width: Math.max(MIN_DOORWAY_M, portal.width),
    height: doorwayHeight(roomHeight),
    x: portal.x,
    z: portal.z,
    yaw: portal.yaw,
    source: 'portal',
    portal,
  };
}

export interface PortalsProps {
  /** The current room's doorways, from `matchPortals`. */
  portals: readonly Portal[];
  /**
   * The room's doorways, from `doorOpeningsFor` (three/RoomShell) — the same array the shell cuts
   * its walls with. Openings that are not doorways out of the room (the room's own door spec, an
   * opening only the collider found) carry no portal and get no marker.
   */
  doorways?: readonly DoorOpening[];
  /** The room's ceiling height in metres; the doorway is the shorter of it and a standard door. */
  height?: number;
  /** Off in the dollhouse: a doorway belongs to the room you are standing in. */
  enabled?: boolean;
  /** The renter can move, so proximity opens a doorway. In photo view only a click does. */
  walking?: boolean;
  /**
   * The turn the room's shell is drawn with (`RoomShell`'s own `yaw`), radians.
   *
   * A doorway is expressed in the room's own frame, which is the frame `RoomShell` cuts its walls
   * in. When the shell is turned into the scene, the markers have to turn with it or they part
   * company with the holes they are standing in — so pass whatever `yaw` the shell is given. The
   * renter's pose is in the scene's frame, so the proximity test turns each doorway into it.
   */
  yaw?: number;
  /** The renter went through: switch to `portal.toRoomRef` and put them just inside it. */
  onEnter: (portal: Portal) => void;
}

/**
 * Every doorway out of the room the renter is standing in.
 *
 * Nothing here is drawn in the dollhouse — from above, the room is a diagram and the unit minimap
 * is the thing that shows how it joins the rest of the flat.
 */
export function Portals({ portals, doorways, height = PORTAL_HEIGHT_M + 0.1, enabled = true, walking = false, yaw = 0, onEnter }: PortalsProps) {
  const gl = useThree((s) => s.gl);
  const [hover, setHover] = useState<string | null>(null);
  const [near, setNear] = useState<readonly string[]>([]);
  const armed = useRef(new Set<string>());
  const enter = useRef(onEnter);
  enter.current = onEnter;

  const go = useCallback((p: Portal) => {
    armed.current.delete(p.id);
    enter.current(p);
  }, []);

  /* The doorways, exactly as the shell cut them when the caller passed them in. Everything below —
     the pane, the frame, the threshold, the proximity test — is drawn and measured off THIS list,
     so there is no second opinion about where a doorway is. */
  const markers = useMemo<Marker[]>(
    () => (doorways ? doorways.filter(hasPortal) : portals.map((p) => markerOf(p, height))),
    [doorways, portals, height],
  );

  /* Proximity, off the viewer's pose rather than the render loop: the walker publishes a pose
     whenever it actually moves (WalkControls), and a canvas that renders on demand must not be the
     thing that decides whether the renter has reached a door. */
  useEffect(() => {
    armed.current = new Set<string>();
    setNear([]);
    setHover(null);
    if (!enabled || !markers.length) return;
    const cy = yaw ? Math.cos(yaw) : 1;
    const sy = yaw ? Math.sin(yaw) : 0;
    let last: readonly string[] = [];
    const evaluate = (pose: Pose) => {
      const close: string[] = [];
      let through: Portal | null = null;
      for (const m of markers) {
        // The doorway is in the room's frame and the pose is in the scene's; `Ry(yaw)` is the one
        // step between them, and it is the identity for a shell that is not turned.
        const x = m.x * cy + m.z * sy;
        const z = m.z * cy - m.x * sy;
        const d = Math.hypot(pose.x - x, pose.z - z);
        if (d > ARM_M) armed.current.add(m.id);
        else if (walking && d < PORTAL_ENTER_M && armed.current.has(m.id) && !through) through = m.portal;
        if (d < NEAR_M) close.push(m.id);
      }
      if (close.length !== last.length || close.some((id, i) => last[i] !== id)) {
        last = close;
        setNear(close);
      }
      // After the state update, so the doorway that took us out of the room is not left "near".
      if (through) go(through);
    };
    evaluate(useViewer.getState().pose);
    return useViewer.subscribe((s, prev) => {
      if (s.pose !== prev.pose) evaluate(s.pose);
    });
  }, [enabled, markers, walking, yaw, go]);

  const cursor = useCallback(
    (on: boolean) => {
      gl.domElement.style.cursor = on ? 'pointer' : '';
    },
    [gl],
  );
  useEffect(() => () => cursor(false), [cursor]);

  if (!enabled || !markers.length) return null;

  return (
    /* Turned with the shell, so a marker never leaves the hole it is standing in (`RoomShell.yaw`). */
    <group rotation={[0, yaw, 0]} userData={{ measureIgnore: true }}>
      {markers.map((m) => {
        const p = m.portal;
        const w = m.width;
        const h = m.height;
        const on = hover === m.id;
        const named = on || near.includes(m.id);
        // Local frame: +x runs along the wall, +z points out through the doorway, so everything
        // below is drawn a few centimetres INSIDE the room, at −z.
        return (
          <group key={m.id} position={[m.x, 0, m.z]} rotation={[0, m.yaw + Math.PI, 0]}>
            <mesh
              position={[0, h / 2, -0.06]}
              renderOrder={12}
              onClick={(e) => {
                e.stopPropagation();
                go(p);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(m.id);
                cursor(true);
              }}
              onPointerOut={() => {
                setHover((v) => (v === m.id ? null : v));
                cursor(false);
              }}
            >
              <planeGeometry args={[w, h]} />
              <meshBasicMaterial color={LIGHT} transparent opacity={on ? 0.24 : 0.1} depthWrite={false} side={DoubleSide} toneMapped={false} />
            </mesh>
            {/* The jambs and the head: an ink hairline, dashed when only the plan says there is a
                door here and the collider measured no opening to put it on. */}
            <Line
              points={[
                [-w / 2, 0, -0.06],
                [-w / 2, h, -0.06],
                [w / 2, h, -0.06],
                [w / 2, 0, -0.06],
              ]}
              color={INK}
              lineWidth={on ? 1.8 : 1.2}
              transparent
              opacity={on ? 0.7 : 0.42}
              dashed={p.source === 'plan'}
              dashSize={0.1}
              gapSize={0.07}
              raycast={() => null}
            />
            {/* The threshold, and a chevron on the floor pointing the way out. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, -0.28]} renderOrder={11} raycast={() => null}>
              <planeGeometry args={[w, 0.52]} />
              <meshBasicMaterial color={LIGHT} transparent opacity={on ? 0.32 : 0.15} depthWrite={false} toneMapped={false} />
            </mesh>
            <Line
              points={[
                [-0.15, 0.02, -0.52],
                [0, 0.02, -0.34],
                [0.15, 0.02, -0.52],
              ]}
              color={INK}
              lineWidth={1.2}
              transparent
              opacity={on ? 0.6 : 0.3}
              raycast={() => null}
            />
            {named ? (
              <Html position={[0, h + 0.16, -0.06]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                <div className="glass flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink" style={{ opacity: on ? 1 : 0.8 }} title={m.note}>
                  <span className="text-dim">to</span>
                  <span>{p.toName}</span>
                  {p.source === 'plan' ? <span className="mono text-[10px] text-faint">from the plan</span> : null}
                </div>
              </Html>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}
