/**
 * Where a real Marble capture sits in Audora's metric room frame — the one convention every real
 * layer (panorama sphere, Gaussian splat, collider mesh) obeys.
 *
 * ## The frame, in one line
 *
 * ```
 * p_world = P + s · Ry(φ) · Rx(π) · p_raw          Rx(π) = diag(1, −1, −1)
 * ```
 *
 * `p_raw` is a point in Marble's `marble_raw_opencv` frame (x right, y DOWN, z forward from the
 * capture point), `s` is metres per raw unit, `P` is where the capture point itself lands in our
 * frame, and `φ` is the room's own yaw. Audora's frame is metres, floor y = 0, room centre at the
 * origin, x east, z south — so `Rx(π)` turns Marble's y-down/z-forward into our y-up/z-back, and
 * `Ry(φ)` turns the *room* onto our axes, because Marble's frame is the camera's and the
 * photographer may have faced a corner (the demo corner room is 47° off; see `roomRect` in
 * services/marble). The capture therefore ends up looking along **yaw φ**, which is why walk mode
 * and photo view both spawn at `P` facing `frame.yaw`: the first frame is then exactly the
 * photograph, and the walls the buyer sees are the walls Audora measured.
 *
 * ## How each layer reaches that map
 *
 * | layer    | as delivered                              | what we apply                                |
 * |----------|-------------------------------------------|----------------------------------------------|
 * | SPZ      | raw (x, y↓, z→)                           | `Ry(φ)` ∘ `Rx(π)` (a proper rotation)         |
 * | collider | `(x_raw, −y_raw, z_raw)` — a *reflection*  | group `Ry(π + φ)` ∘ mirror x                 |
 * | panorama | equirect texel u → azimuth 360u − 90°      | mirror x + yaw +π/2, inside the group        |
 *
 * The collider arriving mirrored rather than rotated is the fact an earlier pass measured
 * (ARCHITECTURE, "Merged and measured"); `COLLIDER_MIRROR` in MarbleWorld is what puts it back, and
 * composed with the group's own `Ry(π + φ)` it lands on exactly the same map the SPZ gets. The
 * horizontal half of `Rx(π)` is `(x, z) → (x, −z)` — a reflection, because y flips too — so **raw
 * +x is our east**, not our west; that one sign is what every offset in the room frame turns on.
 *
 * ## Why this module exists
 *
 * It is the single place a reader can find the convention written down, and the place the group's
 * transform is derived for callers that are not the group itself (the splat places itself in world
 * space so Spark keeps one sorted set per canvas; the walk spawn and the photo camera need the
 * capture point and the capture direction). The arithmetic all lives in `splatTransform`.
 */
import type { RoomWorld } from '@/state/types';
import { splatTransform, type SplatTransform } from '@/services/marble';

/** The rotation that takes Marble's raw capture frame to ours, before the room's own yaw. */
export const MARBLE_ROT_X = Math.PI;

export type MarbleFrameWorld = Pick<RoomWorld, 'metricScaleFactor' | 'groundPlaneOffset' | 'bounds'>;

/**
 * The transform for the Marble group: uniform `scale`, the capture point at `position`, the room's
 * turn in `yaw` and `rotationY = π + yaw`. Marble's own metric scale when the world carries it and
 * the room anchor otherwise; floor from `bounds.floorY`, then `ground_plane_offset`, then `minY`.
 */
export function marbleFrame(world: MarbleFrameWorld, metresPerUnit: number, floorOffset = 0): SplatTransform {
  return splatTransform(world, metresPerUnit, floorOffset);
}

/**
 * The direction the capture looked, in our frame — the room's own yaw. Spawning here makes the
 * buyer's first frame the photograph itself.
 */
export const captureYaw = (frame: Pick<SplatTransform, 'yaw'>): number => frame.yaw;
