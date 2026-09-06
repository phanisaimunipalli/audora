import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RoomGeometry } from '@/engine/types';
import { wallFeaturePosition, wallLength } from '@/engine/geometry';
import { EYE_HEIGHT_M } from '@/engine/anchor';

export interface StillSpec {
  name: string;
  position: [number, number, number];
  lookAt: [number, number, number];
  fov?: number;
}

export interface Still {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** Four listing angles: doorway, far corner, window side, and a dollhouse overview. */
export function stillSpecs(room: RoomGeometry): StillSpec[] {
  const d = wallFeaturePosition(room, room.door.wall, room.door.offset);
  const doorIn = { x: d.x + d.inward.x * 0.45, z: d.z + d.inward.z * 0.45 };
  // the corner diagonally opposite the door, inset a little
  const far = { x: -Math.sign(d.x || 1) * (room.width / 2 - 0.5), z: -Math.sign(d.z || 1) * (room.depth / 2 - 0.5) };
  const win = room.windows[0];
  const wp = win ? wallFeaturePosition(room, win.wall, win.offset) : wallFeaturePosition(room, 'north', room.width / 2);
  const winSide = { x: wp.x + wp.inward.x * Math.min(1.4, wallLength(room, win?.wall === 'east' || win?.wall === 'west' ? 'north' : 'east') * 0.3), z: wp.z + wp.inward.z * Math.min(1.4, room.depth * 0.3) };
  const span = Math.max(room.width, room.depth);
  const out = { x: -d.inward.x, z: -d.inward.z };
  return [
    { name: 'From the doorway', position: [doorIn.x, EYE_HEIGHT_M, doorIn.z], lookAt: [-doorIn.x * 0.2, 1.05, -doorIn.z * 0.2], fov: 64 },
    { name: 'Far corner', position: [far.x, EYE_HEIGHT_M, far.z], lookAt: [d.x * 0.5, 1.0, d.z * 0.5], fov: 62 },
    { name: 'Window side', position: [winSide.x, EYE_HEIGHT_M, winSide.z], lookAt: [-wp.x * 0.5, 1.0, -wp.z * 0.5], fov: 60 },
    { name: 'Overview', position: [out.x * (span * 0.9 + 1) + span * 0.45, span * 0.95 + 1.2, out.z * (span * 0.9 + 1) + span * 0.45], lookAt: [0, 0.4, 0], fov: 46 },
  ];
}

interface Restore {
  obj: THREE.Object3D;
  visible: boolean;
}

/** Hide measure markers etc., cull walls / ceiling for the given camera, and remember how to undo it. */
function stageFor(scene: THREE.Scene, cam: THREE.Camera, room: RoomGeometry): Restore[] {
  const undo: Restore[] = [];
  const inside = Math.abs(cam.position.x) < room.width / 2 && Math.abs(cam.position.z) < room.depth / 2 && cam.position.y < room.height;
  scene.traverse((o) => {
    const ud = o.userData || {};
    if (ud.stillsHide) {
      undo.push({ obj: o, visible: o.visible });
      o.visible = false;
      return;
    }
    if (ud.audoraWall) {
      const w = ud.audoraWall as { inward: { x: number; z: number }; x: number; z: number };
      const dot = (cam.position.x - w.x) * w.inward.x + (cam.position.z - w.z) * w.inward.z;
      undo.push({ obj: o, visible: o.visible });
      o.visible = inside || dot > -0.2;
      return;
    }
    if (ud.audoraCeiling !== undefined) {
      undo.push({ obj: o, visible: o.visible });
      o.visible = inside;
      return;
    }
    if (ud.stillsSky) {
      undo.push({ obj: o, visible: o.visible });
      o.visible = cam.position.y < room.height + 0.8;
    }
  });
  return undo;
}

/**
 * Render each spec with a temporary camera and read the pixels back. Works without
 * preserveDrawingBuffer because the read happens right after the render, in the same task.
 * Safe to call from inside a running r3f Canvas: the renderer's size and pixel ratio are restored.
 */
export function captureStills(gl: THREE.WebGLRenderer, scene: THREE.Scene, room: RoomGeometry, opts?: { width?: number; height?: number; specs?: StillSpec[]; quality?: number }): Still[] {
  const specs = opts?.specs ?? stillSpecs(room);
  const width = opts?.width ?? 1600;
  const height = opts?.height ?? 1000;
  const quality = opts?.quality ?? 0.92;
  const prevSize = new THREE.Vector2();
  gl.getSize(prevSize);
  const prevPixelRatio = gl.getPixelRatio();
  const prevTarget = gl.getRenderTarget();
  const prevAutoClear = gl.autoClear;
  const out: Still[] = [];
  try {
    gl.setRenderTarget(null);
    gl.autoClear = true;
    gl.setPixelRatio(1);
    gl.setSize(width, height, false);
    for (const s of specs) {
      const cam = new THREE.PerspectiveCamera(s.fov ?? 60, width / height, 0.05, 200);
      cam.position.set(...s.position);
      cam.lookAt(...s.lookAt);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      const undo = stageFor(scene, cam, room);
      try {
        gl.render(scene, cam);
        out.push({ name: s.name, dataUrl: gl.domElement.toDataURL('image/jpeg', quality), width, height });
      } finally {
        for (const u of undo) u.obj.visible = u.visible;
      }
    }
  } finally {
    gl.setPixelRatio(prevPixelRatio);
    gl.setSize(prevSize.x, prevSize.y, false);
    gl.setRenderTarget(prevTarget);
    gl.autoClear = prevAutoClear;
  }
  return out;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * Burn the disclosure into the image so the label travels with the file. The first line is the
 * headline ("Digitally staged"), the rest are details (anchor, room, agent). Legible at thumbnail size.
 */
export async function watermark(dataUrl: string, lines: string[]): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  if (!lines.length) return c.toDataURL('image/jpeg', 0.92);
  const pad = Math.round(img.width * 0.02);
  const fsHead = Math.max(18, Math.round(img.width * 0.019));
  const fsBody = Math.max(15, Math.round(img.width * 0.0145));
  const headFont = `600 ${fsHead}px Inter, system-ui, sans-serif`;
  const bodyFont = `500 ${fsBody}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
  const [head, ...rest] = lines;
  ctx.font = headFont;
  const headW = ctx.measureText(head.toUpperCase()).width + fsHead * 1.1; // room for the dot
  ctx.font = bodyFont;
  const bodyW = Math.max(0, ...rest.map((l) => ctx.measureText(l).width));
  const bw = Math.max(headW, bodyW) + pad * 2.2;
  const lineH = fsBody * 1.55;
  const bh = pad * 1.6 + fsHead * 1.2 + rest.length * lineH;
  const bx = pad;
  const by = img.height - bh - pad;
  // backdrop with a soft shadow, then an accent bar on the left
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = pad;
  ctx.shadowOffsetY = pad * 0.3;
  ctx.fillStyle = 'rgba(14,13,12,0.82)';
  roundedRect(ctx, bx, by, bw, bh, Math.round(fsHead * 0.6));
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#e8734a';
  roundedRect(ctx, bx, by, Math.max(4, Math.round(fsHead * 0.22)), bh, 3);
  ctx.fill();
  // headline: accent dot + small caps
  let y = by + pad * 0.8 + fsHead;
  const x = bx + pad * 1.4;
  ctx.fillStyle = '#e8734a';
  ctx.beginPath();
  ctx.arc(x + fsHead * 0.28, y - fsHead * 0.35, fsHead * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = headFont;
  ctx.fillStyle = '#f4eee5';
  ctx.fillText(head.toUpperCase(), x + fsHead * 0.85, y);
  ctx.font = bodyFont;
  ctx.fillStyle = 'rgba(244,238,229,0.9)';
  for (const l of rest) {
    y += lineH;
    ctx.fillText(l, x, y);
  }
  return c.toDataURL('image/jpeg', 0.92);
}

export interface CaptureOptions {
  width?: number;
  height?: number;
  specs?: StillSpec[];
  quality?: number;
  /** Lines to burn in; the first is the headline. Omit for clean frames. */
  watermark?: string[];
}

export type CaptureFn = (opts?: CaptureOptions) => Promise<Still[]>;

/**
 * Lives inside a Canvas and hands the parent a `capture()` that renders listing stills from the live
 * scene. Usage: `<StillsCapturer room={room.geometry} onReady={(c) => (captureRef.current = c)} />`,
 * then `const stills = await captureRef.current?.({ watermark: ['Digitally staged', anchor.label] })`.
 */
export function StillsCapturer({ room, onReady, watermark: defaultLines }: { room: RoomGeometry; onReady: (capture: CaptureFn) => void; watermark?: string[] }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const roomRef = useRef(room);
  roomRef.current = room;
  const linesRef = useRef(defaultLines);
  linesRef.current = defaultLines;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    const capture: CaptureFn = async (opts) => {
      // wait for a frame so pending loads / shadow maps are in place, then render in the same task
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const raw = captureStills(gl, scene, roomRef.current, opts);
      const lines = opts?.watermark ?? linesRef.current;
      if (!lines || !lines.length) return raw;
      const out: Still[] = [];
      for (const s of raw) out.push({ ...s, dataUrl: await watermark(s.dataUrl, lines) });
      return out;
    };
    onReadyRef.current(capture);
  }, [gl, scene]);
  return null;
}
