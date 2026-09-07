import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    /** Read by WalkControls each frame: x = strafe (-1..1), y = forward axis (-1 = forward). */
    __audoraJoystick?: { x: number; y: number };
  }
}

const R = 44;

/** Touch joystick for walk mode. Feeds WalkControls through window.__audoraJoystick. */
export function Joystick({ className }: { className?: string }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  useEffect(
    () => () => {
      window.__audoraJoystick = undefined;
    },
    [],
  );
  const update = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / R);
    const nx = (dx / len) * k;
    const ny = (dy / len) * k;
    setKnob({ x: nx * R, y: ny * R });
    window.__audoraJoystick = { x: nx, y: ny };
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    window.__audoraJoystick = undefined;
  };
  return (
    <div
      className={className}
      style={{ width: R * 2 + 24, height: R * 2 + 24, touchAction: 'none' }}
      onPointerDown={(e) => {
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (active.current === e.pointerId) update(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="glass relative h-full w-full rounded-full">
        <div className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-2 bg-accent/85" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
      </div>
    </div>
  );
}
