import { create } from 'zustand';

/**
 * `photo` stands at the capture point inside Marble's panorama and looks around (the reconstruction
 * as photographed); `walk` moves through the room at eye height; `orbit` is the dollhouse.
 */
export type ViewMode = 'orbit' | 'walk' | 'photo';
export type Tool = 'select' | 'measure';

/** Modes that keep the camera inside the room at a person's height. */
export const isFirstPerson = (m: ViewMode): boolean => m === 'walk' || m === 'photo';

export interface Pose {
  x: number;
  z: number;
  /** radians, 0 = looking north (-z) */
  yaw: number;
}

export interface Measurement {
  a: { x: number; y: number; z: number };
  b?: { x: number; y: number; z: number };
  metres?: number;
  /** ± uncertainty of the anchor the measurement was derived from, in metres. */
  uncertaintyM?: number;
}

/** A request for the walker to glide somewhere (minimap click, "go to the window" chips...). */
export interface TeleportRequest {
  x: number;
  z: number;
  /** Optional facing after arrival, radians (0 = north). */
  yaw?: number;
  /** Changes on every request so identical targets still trigger. */
  nonce: number;
}

interface ViewerState {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  pose: Pose;
  setPose: (p: Pose) => void;
  showStaging: boolean;
  setShowStaging: (v: boolean) => void;
  showSplat: boolean;
  setShowSplat: (v: boolean) => void;
  /** Draw the reconstruction's collider mesh as a purple wireframe over the panorama. */
  showGeometry: boolean;
  setShowGeometry: (v: boolean) => void;
  /** Photo view's vertical field of view in degrees; the wheel zooms it between 40 and 90. */
  photoFov: number;
  setPhotoFov: (v: number) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
  measurement: Measurement | null;
  setMeasurement: (m: Measurement | null) => void;
  /** Set true by WalkControls while the pointer is locked. */
  locked: boolean;
  setLocked: (v: boolean) => void;
  /** True while the walker is gliding to a clicked point. */
  gliding: boolean;
  setGliding: (v: boolean) => void;
  /** Pending teleport for WalkControls; cleared by the walker once consumed. */
  teleport: TeleportRequest | null;
  /** Ask the walker to glide to a floor point (room metres). Works only while in walk mode. */
  requestTeleport: (x: number, z: number, yaw?: number) => void;
  clearTeleport: () => void;
  reset: () => void;
}

/** Photo view zoom range, degrees of vertical fov. */
export const PHOTO_FOV_MIN = 40;
export const PHOTO_FOV_MAX = 90;
export const PHOTO_FOV_DEFAULT = 78;

const initial = {
  mode: 'orbit' as ViewMode,
  tool: 'select' as Tool,
  pose: { x: 0, z: 0, yaw: 0 },
  showStaging: true,
  showSplat: true,
  showGeometry: false,
  photoFov: PHOTO_FOV_DEFAULT,
  selectedId: null,
  hoverId: null,
  measurement: null,
  locked: false,
  gliding: false,
  teleport: null,
};

/** Transient viewer state shared by the canvas and the HUD. Not persisted. */
export const useViewer = create<ViewerState>()((set) => ({
  ...initial,
  setMode: (mode) => set({ mode, selectedId: null }),
  setTool: (tool) => set({ tool, measurement: null }),
  setPose: (pose) => set({ pose }),
  setShowStaging: (showStaging) => set({ showStaging }),
  setShowSplat: (showSplat) => set({ showSplat }),
  setShowGeometry: (showGeometry) => set({ showGeometry }),
  setPhotoFov: (v) => set({ photoFov: Math.min(PHOTO_FOV_MAX, Math.max(PHOTO_FOV_MIN, v)) }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setHoverId: (hoverId) => set({ hoverId }),
  setMeasurement: (measurement) => set({ measurement }),
  setLocked: (locked) => set({ locked }),
  setGliding: (gliding) => set({ gliding }),
  requestTeleport: (x, z, yaw) => set({ teleport: { x, z, yaw, nonce: Date.now() + Math.random() } }),
  clearTeleport: () => set({ teleport: null }),
  reset: () => set(initial),
}));
