import { createContext } from 'react';

/** Per-piece render state shared by every primitive part (see parts.tsx). */
export interface PartState {
  ghost: boolean;
  emissive: string;
  emissiveIntensity: number;
  shadow: boolean;
}

export const PartContext = createContext<PartState>({ ghost: false, emissive: '#000000', emissiveIntensity: 0, shadow: true });

/** Ghost pieces and floor decorations must never catch pointer events. */
export const noRaycast = () => null;
