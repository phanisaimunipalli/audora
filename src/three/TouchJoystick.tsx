import { useEffect, useRef, useState } from 'react';

export interface TouchJoystickProps {
  className?: string;
  /** Diameter in px. */
  size?: number;
  /** Fraction of the radius that counts as "no input". */
  deadZone?: number;
  onChange?: (v: { x: number; y: number }) => void;
  /** Render only on coarse-pointer devices (phones, tablets). */
  touchOnly?: boolean;
}

type Joy = { x: number; y: number };
const win = () => window as unknown as { __audoraJoystick?: Joy };

/** Read the joystick from anywhere (WalkControls does this every frame). */
export function readJoystick(): Joy {
  return win().__audoraJoystick ?? { x: 0, y: 0 };
}

export function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const on = () => setCoarse(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return coarse;
}

/**
 * A thumb-stick for phones. Writes `window.__audoraJoystick = { x, y }` in -1..1 (y negative = forward,
 * matching a thumb pushed up the screen) so WalkControls can read it without any wiring.
 */
export function TouchJoystick({ className, size = 128, deadZone = 0.14, onChange, touchOnly = false }: TouchJoystickProps) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<Joy>({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const coarse = useIsCoarsePointer();

  useEffect(() => {
    const el = base.current;
    if (!el) return;
    const r = size / 2;
    const write = (v: Joy) => {
      win().__audoraJoystick = v;
      onChange?.(v);
    };
    const update = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      let dx = (clientX - (rect.left + rect.width / 2)) / r;
      let dy = (clientY - (rect.top + rect.height / 2)) / r;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      setKnob({ x: dx, y: dy });
      const m = Math.hypot(dx, dy);
      if (m < deadZone) {
        write({ x: 0, y: 0 });
        return;
      }
      // re-map so the dead zone edge is 0 and the rim is 1
      const k = (m - deadZone) / (1 - deadZone) / m;
      write({ x: dx * k, y: dy * k });
    };
    const down = (e: PointerEvent) => {
      if (active.current !== null) return;
      active.current = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic or already-released pointer */
      }
      update(e.clientX, e.clientY);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (active.current !== e.pointerId) return;
      update(e.clientX, e.clientY);
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (active.current !== e.pointerId) return;
      active.current = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      setKnob({ x: 0, y: 0 });
      write({ x: 0, y: 0 });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      write({ x: 0, y: 0 });
    };
  }, [size, deadZone, onChange]);

  if (touchOnly && !coarse) return null;
  const k = size * 0.36;
  return (
    <div
      ref={base}
      role="slider"
      aria-label="Move"
      aria-valuenow={0}
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        position: 'relative',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        background: 'radial-gradient(circle, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.4) 70%, rgba(255,255,255,0) 100%)',
        border: '1px solid rgba(10,10,10,0.1)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: k,
          height: k,
          borderRadius: '50%',
          transform: `translate(calc(-50% + ${knob.x * (size / 2 - k / 2)}px), calc(-50% + ${knob.y * (size / 2 - k / 2)}px))`,
          transition: active.current === null ? 'transform 160ms cubic-bezier(0.2,0.8,0.2,1)' : 'none',
          background: 'rgba(10,10,10,0.86)',
          boxShadow: '0 6px 20px -8px rgba(10,10,10,0.45), inset 0 1px 0 rgba(255,255,255,0.22)',
        }}
      />
      <div aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px dashed rgba(10,10,10,0.16)', margin: size * 0.18 }} />
    </div>
  );
}
