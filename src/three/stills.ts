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
  /**
   * Take the pose from the live camera instead of `position`/`lookAt` — the "Portrait" still, which
   * is whatever the renter is looking at right now. `captureStills` needs `opts.camera` for this;
   * without one the spec falls back to its own position and lookAt.
   */
  fromCamera?: boolean;
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

/**
 * How far the floor runs from a point in a given direction before it meets a wall, in metres.
 * The room is the rectangle centred on the origin, so this is a ray/box intersection.
 */
export function runToWall(room: Pick<RoomGeometry, 'width' | 'depth'>, x: number, z: number, yaw: number): number {
  // Same convention as `lookAt` below: yaw 0 looks toward −z.
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  const hx = room.width / 2;
  const hz = room.depth / 2;
  let t = Infinity;
  if (Math.abs(dx) > 1e-6) t = Math.min(t, ((dx > 0 ? hx : -hx) - x) / dx);
  if (Math.abs(dz) > 1e-6) t = Math.min(t, ((dz > 0 ? hz : -hz) - z) / dz);
  return Number.isFinite(t) ? Math.max(0, t) : Math.max(room.width, room.depth);
}

/** Directions at least this far apart count as different pictures (radians ≈ 40°). */
const STILL_SEPARATION = 0.7;

/**
 * The lens a direction wants: the less room in front of the camera, the wider it has to be to show
 * any of it. A property photographer's own kit is 24 mm (74°) and goes wider in a small room, which is the
 * same trade — a 68° lens 1.2 m from a wall is a photograph of plaster.
 */
export function stillFov(run: number): number {
  const t = Math.max(0, Math.min(1, (3.2 - run) / 2.2));
  return Math.round(62 + 22 * t);
}

/**
 * Listing angles for a room that has a real capture behind it.
 *
 * Nothing here leaves the capture point. A panorama is only a photograph from where it was taken —
 * step away from that point and the walls stop having parallax — so a composite still turns on the
 * spot instead of walking around, and the only thing that varies between the four is the direction.
 * The first is **Portrait**: the direction the renter is actually looking, so the still they save is
 * the frame they were sold on.
 *
 * **The other three are chosen by what they can see.** They used to be fixed offsets from the
 * photographer's own direction — +0°, +66°, +180° — which on the demo corner room put the capture
 * point 60 cm from the rear wall and made "Looking back" a featureless blurred wall, while the first
 * two were the same picture whenever the renter had not turned. So every direction is scored by how
 * much room is in front of it (`runToWall`) and by the staged furniture it frames, and the three
 * best that are at least ~55° from each other and from Portrait are the ones taken. With no room to
 * score against the old fixed offsets are used, which is what a caller passing no geometry gets.
 *
 * The furniture is metric and stands on our floor, so it composites correctly from the capture point
 * in exactly the way the viewer does.
 */
export function compositeSpecs(
  capture: { x: number; z: number; yaw: number },
  /** Where the renter is looking now. Only the direction is used; the position stays honest. */
  viewer?: { yaw: number; fov?: number } | null,
  /** The measured room and what is staged in it, so the angles can be picked by content. */
  scene?: { room: Pick<RoomGeometry, 'width' | 'depth'>; pieces?: { x: number; z: number }[] } | null,
): StillSpec[] {
  const eye: [number, number, number] = [capture.x, EYE_HEIGHT_M, capture.z];
  const at = (yaw: number): [number, number, number] => [capture.x - Math.sin(yaw) * 4, 1.3, capture.z - Math.cos(yaw) * 4];
  const first = viewer?.yaw ?? capture.yaw;
  /* Named for what they are, not for a direction they no longer have: the three after Portrait are
     whichever directions see the most room, so "Looking back" — which used to be `yaw + π` and was a
     photograph of the wall behind the photographer — would be a caption that lies. */
  const names = ['Portrait', 'The long view', 'Across the room', 'The far corner'];
  const yaws = scene?.room ? pickYaws(capture, first, scene.room, scene.pieces ?? []) : [first, capture.yaw, capture.yaw + 1.15, capture.yaw + Math.PI];
  return yaws.map((yaw, i) => ({
    name: names[i] ?? `Angle ${i + 1}`,
    position: eye,
    lookAt: at(yaw),
    fov: i === 0 && viewer?.fov ? viewer.fov : scene?.room ? stillFov(runToWall(scene.room, capture.x, capture.z, yaw)) : [64, 68, 66, 68][i] ?? 66,
  }));
}

/**
 * Portrait, then the three best-scoring directions that are pictures of their own.
 *
 * A capture point in the corner of a 3 × 4 m room cannot yield four views a quarter-turn apart that
 * all see the room — one of them is always the wall behind the photographer, which is exactly the
 * blank frame this replaces. So the angles are allowed to cluster over the half of the room that has
 * something in it (40° apart is a different photograph, not a duplicate) and directions with less
 * than a couple of metres in front of them are dropped outright while better ones remain.
 */
function pickYaws(capture: { x: number; z: number; yaw: number }, first: number, room: Pick<RoomGeometry, 'width' | 'depth'>, pieces: { x: number; z: number }[]): number[] {
  const diag = Math.hypot(room.width, room.depth);
  const runOf = (yaw: number) => runToWall(room, capture.x, capture.z, yaw);
  const score = (yaw: number) => {
    // A wall in your face is not a listing photograph; depth of view is most of the answer.
    let s = Math.min(1, runOf(yaw) / Math.max(1, diag * 0.75));
    for (const p of pieces) {
      const dx = p.x - capture.x;
      const dz = p.z - capture.z;
      if (Math.hypot(dx, dz) < 0.2) continue;
      const toPiece = Math.atan2(-dx, -dz);
      const off = Math.abs(Math.atan2(Math.sin(toPiece - yaw), Math.cos(toPiece - yaw)));
      if (off < 0.6) s += 0.4 * (1 - off / 0.6);
    }
    return s;
  };
  const apart = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const candidates: { yaw: number; run: number; score: number }[] = [];
  for (let i = 0; i < 36; i++) {
    const yaw = first + (i * Math.PI * 2) / 36;
    candidates.push({ yaw, run: runOf(yaw), score: score(yaw) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const deepest = Math.max(...candidates.map((c) => c.run));
  const floorRun = Math.min(1.6, deepest * 0.6);
  const deep = candidates.filter((c) => c.run >= floorRun);
  const picked = [first];
  /* Four frames that all see the room beat four maximally different frames, one of which is a wall.
     So the separation is relaxed before the "must see the room" rule is: 40° apart if the room
     allows it, then 26°, then 16°, and only a room with nothing else to show falls through to the
     shallow directions. */
  for (const pass of [
    { list: deep, sep: STILL_SEPARATION },
    { list: deep, sep: 0.45 },
    { list: deep, sep: 0.28 },
    { list: candidates, sep: 0.28 },
  ]) {
    for (const c of pass.list) {
      if (picked.length >= 4) break;
      if (picked.every((y) => apart(y, c.yaw) >= pass.sep)) picked.push(c.yaw);
    }
    if (picked.length >= 4) break;
  }
  // A room too small to hold four distinct views still gets four: spread whatever is left.
  for (let i = 1; picked.length < 4; i++) picked.push(first + (i * Math.PI) / 2);
  return picked;
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
export function captureStills(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  room: RoomGeometry,
  opts?: { width?: number; height?: number; specs?: StillSpec[]; quality?: number; camera?: THREE.Camera },
): Still[] {
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
      const live = s.fromCamera ? (opts?.camera as THREE.PerspectiveCamera | undefined) : undefined;
      if (live) {
        // The live camera's world pose, so the still is exactly the frame on screen.
        live.updateMatrixWorld();
        cam.position.setFromMatrixPosition(live.matrixWorld);
        cam.quaternion.setFromRotationMatrix(live.matrixWorld);
        if (typeof live.fov === 'number') cam.fov = s.fov ?? live.fov;
      } else {
        cam.position.set(...s.position);
        cam.lookAt(...s.lookAt);
      }
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
 * headline ("AI-generated from photos · Audora"), the rest are details (anchor, room, leasing team).
 * Legible at thumbnail size.
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
  const headFont = `700 ${fsHead}px Manrope, ui-sans-serif, system-ui, sans-serif`;
  const bodyFont = `500 ${fsBody}px ui-monospace, "SF Mono", Menlo, monospace`;
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
  // The glass plate of the design language: 88% white with a soft shadow, then a gold bar on the left.
  ctx.save();
  ctx.shadowColor = 'rgba(10,10,10,0.28)';
  ctx.shadowBlur = pad;
  ctx.shadowOffsetY = pad * 0.3;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  roundedRect(ctx, bx, by, bw, bh, Math.round(fsHead * 0.6));
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#7a6a3f';
  roundedRect(ctx, bx, by, Math.max(4, Math.round(fsHead * 0.22)), bh, 3);
  ctx.fill();
  // headline: gold dot + small caps in ink
  let y = by + pad * 0.8 + fsHead;
  const x = bx + pad * 1.4;
  ctx.fillStyle = '#7a6a3f';
  ctx.beginPath();
  ctx.arc(x + fsHead * 0.28, y - fsHead * 0.35, fsHead * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = headFont;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillText(head.toUpperCase(), x + fsHead * 0.85, y);
  ctx.font = bodyFont;
  ctx.fillStyle = 'rgba(10,10,10,0.72)';
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
 * Lives inside a Canvas and hands the parent a `capture()` that renders stills for the listing page from the live
 * scene. Usage: `<StillsCapturer room={room.geometry} onReady={(c) => (captureRef.current = c)} />`,
 * then `const stills = await captureRef.current?.({ watermark: ['AI-generated from photos', anchor.label] })`.
 */
export function StillsCapturer({ room, onReady, watermark: defaultLines }: { room: RoomGeometry; onReady: (capture: CaptureFn) => void; watermark?: string[] }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
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
      const raw = captureStills(gl, scene, roomRef.current, { ...opts, camera });
      const lines = opts?.watermark ?? linesRef.current;
      if (!lines || !lines.length) return raw;
      const out: Still[] = [];
      for (const s of raw) out.push({ ...s, dataUrl: await watermark(s.dataUrl, lines) });
      return out;
    };
    onReadyRef.current(capture);
  }, [gl, scene, camera]);
  return null;
}
