import { useAudora } from '@/state/store';
import type { AnalyticsType } from '@/state/types';

/** True the first time `key` is seen in this browser session; false afterwards. Safe when storage is blocked. */
export function sessionOnce(key: string): boolean {
  const k = `audora.once.${key}`;
  try {
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, '1');
    return true;
  } catch {
    return true;
  }
}

/** Fire an analytics event without subscribing the caller to the store. */
export function trackEvent(tourId: string, type: AnalyticsType, extra?: { roomId?: string; item?: string }) {
  useAudora.getState().track(tourId, type, extra);
}

/** Coarse pointer = phone or tablet: show the joystick, hide keyboard hints. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
