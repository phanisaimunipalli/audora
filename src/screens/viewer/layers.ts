/**
 * The portrait-mode layer stack, as a piece of viewer state.
 *
 * A real Marble room is not one picture, it is four things drawn in a fixed order: the photograph
 * (splat, with the panorama behind it), the real geometry written to depth so the photograph can
 * hide things, our furniture, and the shadow that furniture drops back onto the photographed floor.
 * Being able to switch each of them off is how a renter — or a reviewer — checks that the last three
 * really are separate layers rather than a picture with sofas painted on.
 *
 * Kept local to the viewer rather than in `viewerStore`: these are a per-screen inspection control,
 * they should not survive a room change into the staging editor, and they must not be persisted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PortraitLayers {
  /** The real capture: the splat, and the panorama behind it. Off brings the measured shell back. */
  photo: boolean;
  /** Everything Audora draws into the room: leasing team staging and the renter's own pieces. */
  furniture: boolean;
  /** The shadow catcher on the real floor, and the contact discs under each piece. */
  shadows: boolean;
  /** The collider mesh written to depth, so real walls hide furniture behind them. */
  occluder: boolean;
}

export const DEFAULT_LAYERS: PortraitLayers = { photo: true, furniture: true, shadows: true, occluder: true };

/** How far the furniture layer lifts in the exploded preview, metres. */
export const EXPLODE_LIFT_M = 0.4;
/** How long it stays up. */
export const EXPLODE_MS = 2000;

export interface LayerControl {
  layers: PortraitLayers;
  setLayer: (key: keyof PortraitLayers, value: boolean) => void;
  reset: () => void;
  /** The furniture layer is lifted off the photograph. */
  exploded: boolean;
  /** Lift it for {@link EXPLODE_MS}, then let it settle back. Calling again restarts the clock. */
  explode: () => void;
}

/**
 * The layer switches, plus the exploded preview — the iOS-portrait moment, where the furniture layer
 * lifts 40 cm off the photograph for two seconds so you can see that it is a layer. Deliberately
 * transient: it lifts, it settles, it leaves nothing behind.
 */
export function usePortraitLayers(): LayerControl {
  const [layers, setLayers] = useState<PortraitLayers>(DEFAULT_LAYERS);
  const [exploded, setExploded] = useState(false);
  const timer = useRef(0);

  const setLayer = useCallback((key: keyof PortraitLayers, value: boolean) => {
    setLayers((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setLayers(DEFAULT_LAYERS);
    window.clearTimeout(timer.current);
    setExploded(false);
  }, []);

  const explode = useCallback(() => {
    window.clearTimeout(timer.current);
    setExploded(true);
    timer.current = window.setTimeout(() => setExploded(false), EXPLODE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { layers, setLayer, reset, exploded, explode };
}
