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
 * - **Metres, in the room's own frame.** Every portal is already positioned on one of Audora's four
 *   walls (`Portal.x/z`, floor y = 0), so this file does no frame arithmetic at all — it turns the
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
import { useViewer, type Pose } from './viewerStore';

/** A standard interior door — the same 2.03 m the door anchor measures against. */
export const PORTAL_HEIGHT_M = 2.03;
/** How far the renter has to get from a doorway before walking into it counts again. */
const ARM_M = 1.4;
/** Within this, the doorway says which room it leads to. */
const NEAR_M = 3.2;

const INK = '#0a0a0a';
const LIGHT = '#ffffff';

export interface PortalsProps {
  /** The current room's doorways, from `matchPortals`. */
  portals: readonly Portal[];
  /** The room's ceiling height in metres; the doorway is the shorter of it and a standard door. */
  height?: number;
  /** Off in the dollhouse: a doorway belongs to the room you are standing in. */
  enabled?: boolean;
  /** The renter can move, so proximity opens a doorway. In photo view only a click does. */
  walking?: boolean;
  /** The renter went through: switch to `portal.toRoomRef` and put them just inside it. */
  onEnter: (portal: Portal) => void;
}

/**
 * Every doorway out of the room the renter is standing in.
 *
 * Nothing here is drawn in the dollhouse — from above, the room is a diagram and the unit minimap
 * is the thing that shows how it joins the rest of the flat.
 */
export function Portals({ portals, height = PORTAL_HEIGHT_M, enabled = true, walking = false, onEnter }: PortalsProps) {
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

  /* Proximity, off the viewer's pose rather than the render loop: the walker publishes a pose
     whenever it actually moves (WalkControls), and a canvas that renders on demand must not be the
     thing that decides whether the renter has reached a door. */
  useEffect(() => {
    armed.current = new Set<string>();
    setNear([]);
    setHover(null);
    if (!enabled || !portals.length) return;
    let last: readonly string[] = [];
    const evaluate = (pose: Pose) => {
      const close: string[] = [];
      let through: Portal | null = null;
      for (const p of portals) {
        const d = Math.hypot(pose.x - p.x, pose.z - p.z);
        if (d > ARM_M) armed.current.add(p.id);
        else if (walking && d < PORTAL_ENTER_M && armed.current.has(p.id) && !through) through = p;
        if (d < NEAR_M) close.push(p.id);
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
  }, [enabled, portals, walking, go]);

  const cursor = useCallback(
    (on: boolean) => {
      gl.domElement.style.cursor = on ? 'pointer' : '';
    },
    [gl],
  );
  useEffect(() => () => cursor(false), [cursor]);

  const h = useMemo(() => Math.max(1.4, Math.min(PORTAL_HEIGHT_M, height - 0.1)), [height]);
  if (!enabled || !portals.length) return null;

  return (
    <group userData={{ measureIgnore: true }}>
      {portals.map((p) => {
        const w = Math.max(0.6, p.width);
        const on = hover === p.id;
        const named = on || near.includes(p.id);
        // Local frame: +x runs along the wall, +z points out through the doorway, so everything
        // below is drawn a few centimetres INSIDE the room, at −z.
        return (
          <group key={p.id} position={[p.x, 0, p.z]} rotation={[0, p.yaw + Math.PI, 0]}>
            <mesh
              position={[0, h / 2, -0.06]}
              renderOrder={12}
              onClick={(e) => {
                e.stopPropagation();
                go(p);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(p.id);
                cursor(true);
              }}
              onPointerOut={() => {
                setHover((v) => (v === p.id ? null : v));
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
                <div className="glass flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink" style={{ opacity: on ? 1 : 0.8 }}>
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
