/**
 * The floor plan, met by one room — docs/ACCURACY.md §3.3.
 *
 * The viewer and the staging editor both draw a room that belongs to a unit, and both have to
 * answer the same four questions about it: which room on the drawing is this, where are its
 * doorways, which of them lead somewhere the renter can stand, and how much has this room's world
 * been turned. Answering them twice is how the shell came to cut one doorway while the marker stood
 * in another, so they are answered **once**, here, and both screens read the result.
 *
 * Conventions:
 * - **Pure underneath, hooks on top.** Everything the screens need is a plain function of the plan
 *   and the rooms (`unitModel`, `roomPlan`, {@link roomTurn}); the `use*` wrappers only memoise.
 *   Tests drive the functions.
 * - **One doorway list, two consumers.** `roomPlan().doorways` is `doorOpeningsFor`'s answer for the
 *   whole room — every hole in its walls — and `markers` is the subset that leads to a room the tour
 *   actually has. The shell gets the first, `Portals` the second, and the second is a subset of the
 *   first by construction. That is the invariant; it is not re-derived anywhere else.
 * - **One turn, four consumers.** {@link roomTurn} is the only place a room's world is turned, and
 *   the Marble group, the shell, the markers and the unit map all read the same object. Its doc
 *   says what Audora carries today and why the rest is a bearing rather than a rotation.
 */
import { useCallback, useMemo } from 'react';
import type { Room } from '@/state/types';
import type { TourFloorPlan } from '@/state/types';
import { pickWorld } from '@/state/publish';
import { effectiveHeading } from '@/engine/siteSun';
import { headingAfterYaw } from '@/three/splat/frame';
import { doorOpeningsFor, type DoorOpening } from '@/three/RoomShell';
import { buildUnitGraph, linkRooms, matchPortals, roomOf, type ColliderOpening, type Portal, type PortalMatch, type UnitGraph, type UnitRoom } from '@shared/unitGraph';

/* ------------------------------------------------------------------ the turn */

/**
 * How much of the plan's turn a room's world is actually carrying.
 *
 * There are two candidate terms, and Audora carries **neither as a rotation** today. That is a
 * decision, not an omission, and this is where it is written down.
 *
 * **The quarter turn** (`matchPortals().quarters`) is the turn between the frame the drawing is in
 * and the frame the capture is in. It could be carried two ways: by folding the room's own geometry
 * onto the plan's frame (its `door.wall`, its window walls, and width against depth on an odd
 * quarter) and then turning the Marble group by `−q·π/2` to bring the capture back onto the folded
 * shell — or not at all. It is not, because it does not have to be: `matchPortals` already folds
 * every plan door onto the room's own walls (`foldDoor`), and `toUnitPose` already undoes the same
 * turn when the renter's pose is put on the sheet. The two frames therefore agree about the only
 * two things that cross between them — where the doorways are, and where the renter is standing —
 * without either being rotated. Folding the geometry as well would move the room's stored numbers,
 * its staging coordinates and its measurement's width and depth, and buy nothing the renter can see.
 *
 * **The north arrow** (`UnitRoom.yawToNorth`) is a bearing, not a rotation. Its one observable
 * consumer is the sun, and the sun already takes a bearing: `Room.northWallHeading`, re-expressed
 * through `headingAfterYaw` for whatever turn the world *is* carrying. Turning the world by it
 * instead would turn the capture and the shell while the furniture, the walker's bounds, the
 * minimap and the fit report stayed in the room's own rectangle — and turning all of those too is a
 * rotation of the whole scene *including the camera*, which is the identity. The unit map draws
 * north as an arrow rather than by turning the page, for exactly the same reason.
 *
 * So the shipped policy is `{ foldedQuarters: 0, turnScene: false }` and every number below is 0.
 * The mechanism is wired end to end anyway — `planYaw` in the Marble group, `yaw` on the shell and
 * the markers, `roomYaw` on the map, `headingAfterYaw` on the sun — so the day a room's geometry is
 * folded, this function is the only thing that changes and all four consumers follow it.
 */
export interface TurnPolicy {
  /**
   * Quarter turns the room's **own geometry** has already been folded by, so its walls are named
   * the way the plan names them. The Marble group must then be turned by `−q·π/2` to put the
   * capture back on the folded shell, and the map has that much less to undo.
   */
  foldedQuarters?: number;
  /**
   * True once everything expressed in the room's rectangle — the shell, the markers, the staging
   * layer, the walker's bounds and the minimap — turns with the plan's north arrow. Until then the
   * arrow is a bearing (see above) and the scene stays axis-aligned.
   */
  turnScene?: boolean;
}

/** What Audora ships: neither term is carried as a rotation. See {@link TurnPolicy}. */
export const DEFAULT_TURN_POLICY: TurnPolicy = { foldedQuarters: 0, turnScene: false };

/** One room's turn, as each consumer needs it. Radians, except `quarters`. */
export interface RoomTurn {
  /**
   * What the Marble group is given (`plan` on `MarbleWorld` / `useMarbleFrame`, `planYaw` in
   * services/marble): the quarter turn the room's geometry was folded by, negated, plus the north
   * arrow when the scene carries it.
   */
  world: number;
  /**
   * What `RoomShell` and `Portals` are turned by. Equal to the part of `world` the room's own
   * geometry does **not** already carry — which is the north arrow, and only when the scene turns
   * with it. A shell turned by anything else would part company with the capture drawn over it.
   */
  shell: number;
  /**
   * What `UnitMap` undoes before it puts the renter's pose on the sheet: the turn the frame that
   * pose is measured in has already been given, which is the scene's.
   */
  map: number;
  /** The quarter turn `UnitMap` still has to undo itself (`toUnitPose`) — what the geometry did not absorb. */
  quarters: number;
}

/** One quarter turn, radians. */
const QUARTER = Math.PI / 2;

const quarterOf = (q: number) => ((Math.round(q) % 4) + 4) % 4;

/**
 * The one place a room's world is turned. See {@link TurnPolicy} for what Audora carries and why.
 *
 * `match` is the room's `matchPortals` answer (its `quarters` is the plan↔capture turn) and
 * `unitRoom` is its room on the drawing (its `yawToNorth` is the north arrow). Either missing — a
 * room with no plan — gives every number 0, which is exactly where every room Audora has today is.
 */
export function roomTurn(
  match: Pick<PortalMatch, 'quarters'> | null | undefined,
  unitRoom: Pick<UnitRoom, 'yawToNorth'> | null | undefined,
  policy: TurnPolicy = DEFAULT_TURN_POLICY,
): RoomTurn {
  const recovered = quarterOf(match?.quarters ?? 0);
  const folded = quarterOf(policy.foldedQuarters ?? 0);
  const arrow = policy.turnScene ? (Number.isFinite(unitRoom?.yawToNorth) ? (unitRoom?.yawToNorth as number) : 0) : 0;
  // The geometry took `folded` quarters, so the group turns back by that much to land on it again.
  const world = arrow - folded * QUARTER;
  return {
    world: world === 0 ? 0 : world,
    shell: arrow,
    map: arrow,
    // What the geometry did not absorb is still between the room's frame and the sheet's.
    quarters: quarterOf(recovered - folded),
  };
}

/* ------------------------------------------------------------------ the unit */

/** What this module needs of a room. Every `Room` satisfies it. */
export type UnitRoomInput = Pick<Room, 'id' | 'name' | 'geometry' | 'anchor' | 'planDims' | 'draft' | 'full'>;

/** The plan, resolved against the tour's rooms — everything both screens share. */
export interface UnitModel {
  /** The unit as a graph, or null when the tour has no floor plan with rooms on it. */
  graph: UnitGraph | null;
  /** Tour room id → the room it is on the drawing. */
  planRefs: Record<string, string>;
  /** The other way round, and only for rooms the tour actually has — the walkability test. */
  roomIdForRef: Record<string, string>;
}

/** The unit graph and the links between it and the tour's rooms. Pure. */
export function unitModel(plan: TourFloorPlan | undefined | null, rooms: readonly UnitRoomInput[]): UnitModel {
  const graph = plan?.floors?.length ? buildUnitGraph(plan) : null;
  const planRefs = graph
    ? linkRooms(graph, rooms.map((r) => ({ id: r.id, name: r.name, planRoomName: r.planDims?.planRoomName, floor: r.planDims?.floor })))
    : {};
  const roomIdForRef: Record<string, string> = {};
  for (const [id, ref] of Object.entries(planRefs)) roomIdForRef[ref] = id;
  return { graph, planRefs, roomIdForRef };
}

/* ------------------------------------------------------------------ one room */

/** Everything one room needs from the plan, in the frames its scene is drawn in. */
export interface RoomPlan {
  /** The room on the drawing, when the tour's room is one of them. */
  unitRef?: string;
  unitRoom?: UnitRoom;
  /** `matchPortals` for this room: the plan's doors, put on the walls the collider measured. */
  match: PortalMatch;
  /**
   * Every doorway in this room's walls, from `doorOpeningsFor` — the hole the shell cuts. Includes
   * doorways into rooms nobody photographed: that is still a hole in this wall.
   */
  doorways: DoorOpening[];
  /**
   * The subset of {@link doorways} that leads to a room the tour has, so walking through one
   * actually arrives somewhere. `Portals` draws a marker for each. A subset of `doorways` by
   * construction — that is the whole invariant this module exists for.
   */
  markers: DoorOpening[];
  /** The portals behind those markers, for callers that need the graph's own record. */
  portals: Portal[];
  /** How much this room's world is turned, for every consumer at once ({@link roomTurn}). */
  turn: RoomTurn;
}

const EMPTY_MATCH: PortalMatch = { portals: [], quarters: 0, matched: 0 };

/** The room on the drawing, and `matchPortals` for it. The half of {@link roomPlan} the turn needs. */
function matchOf(model: UnitModel, room: UnitRoomInput | undefined): { unitRef?: string; unitRoom?: UnitRoom; match: PortalMatch; openings: readonly ColliderOpening[] } {
  if (!room) return { match: EMPTY_MATCH, openings: [] };
  const unitRef = model.graph ? model.planRefs[room.id] : undefined;
  const unitRoom = model.graph && unitRef ? roomOf(model.graph, unitRef) : undefined;
  // `bestWorld`'s own rule, without needing a whole `Room`: the world the renter is being shown.
  const openings = pickWorld(room.draft, room.full)?.bounds?.walls?.openings ?? [];
  const match =
    model.graph && unitRef
      ? matchPortals({
          graph: model.graph,
          roomRef: unitRef,
          geometry: room.geometry,
          openings,
          /* The openings are in the provider's raw units. The scale that turns them into the frame
             the portals are drawn in is the room's OWN anchor — `Room.geometry` is `applyScale(raw,
             anchor.metresPerUnit)` (state/store), and a doorway has to land on that room's walls. */
          metresPerUnit: room.anchor.metresPerUnit,
        })
      : EMPTY_MATCH;
  return { ...(unitRef ? { unitRef } : {}), ...(unitRoom ? { unitRoom } : {}), match, openings };
}

/**
 * {@link roomTurn} for one room of a unit, without computing its doorways — for the screens that
 * only need to know how the room is turned (the hub's per-room sun, the listing stills).
 */
export function roomTurnFor(model: UnitModel, room: UnitRoomInput | undefined, policy: TurnPolicy = DEFAULT_TURN_POLICY): RoomTurn {
  const { match, unitRoom } = matchOf(model, room);
  return roomTurn(match, unitRoom, policy);
}

/**
 * The bearing the sun is computed against for one room — **the only rule**, and every screen that
 * shows a sun reads it.
 *
 * `effectiveHeading` picks the room's own north-wall bearing over the building's, and
 * `headingAfterYaw` re-expresses it against whatever wall is north *after* the room's world has been
 * turned. Both steps matter: the first is why a corner bedroom can face the other way from the
 * façade, the second is why turning a room does not leave the sun on the wall that used to be north.
 * A room with no turn — every room Audora has today — gets `effectiveHeading` unchanged.
 */
export function sunHeading(siteHeading: number | undefined, room: Pick<Room, 'northWallHeading'> | undefined, turn: RoomTurn): number {
  return headingAfterYaw(effectiveHeading(siteHeading, room?.northWallHeading), turn.world);
}

/** One room's doorways and turn. Pure: same room, same plan, same answer, in the same order. */
export function roomPlan(model: UnitModel, room: UnitRoomInput | undefined, policy: TurnPolicy = DEFAULT_TURN_POLICY): RoomPlan {
  if (!room) return { match: EMPTY_MATCH, doorways: [], markers: [], portals: [], turn: roomTurn(null, null, policy) };
  const { unitRef, unitRoom, match, openings } = matchOf(model, room);
  /* THE list. The shell cuts these and the markers stand in a subset of them, so a lit pane can
     never be the size or the place of a hole that is not there. */
  const doorways = doorOpeningsFor({ geometry: room.geometry, openings, metresPerUnit: room.anchor.metresPerUnit }, { portals: match.portals });
  const markers = doorways.filter((d) => d.portal && model.roomIdForRef[d.portal.toRoomRef]);
  return {
    ...(unitRef ? { unitRef } : {}),
    ...(unitRoom ? { unitRoom } : {}),
    match,
    doorways,
    markers,
    portals: markers.map((d) => d.portal as Portal),
    turn: roomTurn(match, unitRoom, policy),
  };
}

/* ------------------------------------------------------------------ hooks */

/** {@link unitModel}, memoised on the plan and the rooms' identities. */
export function useUnitModel(plan: TourFloorPlan | undefined | null, rooms: readonly UnitRoomInput[]): UnitModel {
  return useMemo(() => unitModel(plan, rooms), [plan, rooms]);
}

/** {@link roomTurnFor}, memoised — for a screen that needs the turn but not the doorways. */
export function useRoomTurn(plan: TourFloorPlan | undefined | null, rooms: readonly UnitRoomInput[], room: UnitRoomInput | undefined): RoomTurn {
  const model = useUnitModel(plan, rooms);
  return useMemo(() => roomTurnFor(model, room), [model, room]);
}

/** {@link roomPlan} for one room, plus the same answer for any other room the screen needs. */
export function useRoomPlan(model: UnitModel, room: UnitRoomInput | undefined) {
  const planOf = useCallback((r: UnitRoomInput | undefined) => roomPlan(model, r), [model]);
  const here = useMemo(() => planOf(room), [planOf, room]);
  return { ...here, planOf };
}
