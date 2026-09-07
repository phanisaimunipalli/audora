import { useCallback, useMemo, useReducer, useRef } from 'react';

export interface UndoStack<T> {
  /** Current value (snapshot at render). */
  present: T;
  /** Current value, read synchronously (safe inside effects and handlers). */
  get: () => T;
  canUndo: boolean;
  canRedo: boolean;
  /** Commit a new value. Inside a gesture, consecutive commits collapse into a single undo step. */
  commit: (next: T) => void;
  beginGesture: () => void;
  endGesture: () => void;
  /** Returns the restored value, or undefined when there is nothing to undo. */
  undo: () => T | undefined;
  redo: () => T | undefined;
  /** Replace the present without touching history (changes that arrived from a peer). */
  replace: (next: T) => void;
  /** Start over with a new baseline (switching rooms). */
  reset: (initial: T) => void;
}

/**
 * Synchronous undo/redo history kept in a ref, so handlers can read the restored value immediately
 * (to persist and broadcast it) while React re-renders from a tick.
 */
export function useUndoStack<T>(initial: T, limit = 120): UndoStack<T> {
  const ref = useRef<{ past: T[]; present: T; future: T[] }>({ past: [], present: initial, future: [] });
  const gesture = useRef<{ open: boolean; pushed: boolean }>({ open: false, pushed: false });
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const commit = useCallback(
    (next: T) => {
      const s = ref.current;
      if (Object.is(next, s.present)) return;
      const merge = gesture.current.open && gesture.current.pushed;
      if (gesture.current.open) gesture.current.pushed = true;
      ref.current = merge ? { ...s, present: next } : { past: [...s.past.slice(-(limit - 1)), s.present], present: next, future: [] };
      bump();
    },
    [limit],
  );
  const beginGesture = useCallback(() => {
    gesture.current = { open: true, pushed: false };
  }, []);
  const endGesture = useCallback(() => {
    gesture.current = { open: false, pushed: false };
  }, []);
  const undo = useCallback(() => {
    const s = ref.current;
    if (!s.past.length) return undefined;
    const present = s.past[s.past.length - 1];
    ref.current = { past: s.past.slice(0, -1), present, future: [s.present, ...s.future] };
    gesture.current = { open: false, pushed: false };
    bump();
    return present;
  }, []);
  const redo = useCallback(() => {
    const s = ref.current;
    if (!s.future.length) return undefined;
    const present = s.future[0];
    ref.current = { past: [...s.past, s.present], present, future: s.future.slice(1) };
    gesture.current = { open: false, pushed: false };
    bump();
    return present;
  }, []);
  const replace = useCallback((next: T) => {
    if (Object.is(next, ref.current.present)) return;
    ref.current = { ...ref.current, present: next };
    bump();
  }, []);
  const reset = useCallback((init: T) => {
    ref.current = { past: [], present: init, future: [] };
    gesture.current = { open: false, pushed: false };
    bump();
  }, []);
  const get = useCallback(() => ref.current.present, []);

  const s = ref.current;
  return useMemo(
    () => ({ present: s.present, get, canUndo: s.past.length > 0, canRedo: s.future.length > 0, commit, beginGesture, endGesture, undo, redo, replace, reset }),
    [s, get, commit, beginGesture, endGesture, undo, redo, replace, reset],
  );
}
