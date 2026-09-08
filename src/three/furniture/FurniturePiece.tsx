import { memo, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { PlacedPiece } from '@/engine/types';
import { contactShadow } from '../textures';
import { KindBody } from './kinds';
import { ACCENT, BUYER_BLUE, hash32, tonesFor } from './palette';
import { Parts } from './parts';
import { noRaycast, type PartState } from './partContext';

export type PieceStatus = 'ok' | 'overlap' | 'outside' | 'door';

export interface FurniturePieceProps {
  piece: PlacedPiece;
  status?: PieceStatus;
  selected?: boolean;
  hovered?: boolean;
  /** Translucent preview while placing from the catalog. */
  ghost?: boolean;
  /**
   * Draw the soft darkening where the piece meets the floor. On over a real capture, where the piece
   * is composited onto a photograph and has nothing else to sit in.
   */
  contact?: boolean;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

/* The verdict colours: red does not fit, gold blocks the door. They are the only colours a piece
   ever takes on besides its own — the renter's blue is never recoloured (see palette). */
const STATUS_RING: Record<PieceStatus, string | null> = { ok: null, overlap: '#c0392b', outside: '#c0392b', door: '#8a6a2a' };

/** Flat halo + hairline outline on the floor around a footprint. Never catches pointer events. */
function FootprintRing({ w, d, color, opacity, pad = 0.08, thickness = 0.018, y = 0 }: { w: number; d: number; color: string; opacity: number; pad?: number; thickness?: number; y?: number }) {
  const W = w + pad * 2;
  const D = d + pad * 2;
  const t = thickness;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004 + y, 0]} raycast={noRaycast}>
        <planeGeometry args={[W, D]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * 0.22} depthWrite={false} />
      </mesh>
      {[
        [0, -D / 2, W, t],
        [0, D / 2, W, t],
        [-W / 2, 0, t, D],
        [W / 2, 0, t, D],
      ].map(([x, z, sx, sz], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.006 + y, z]} raycast={noRaycast}>
          <planeGeometry args={[sx, sz]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * One piece of furniture: a procedural, metric body (see kinds.tsx) sized from the piece's real w/d/h.
 * Status tints it red (overlap / outside) or amber (blocks the door); renter pieces are always blue;
 * selection adds an accent halo on the floor; hover lifts and brightens; ghosts render at 50%.
 */
function FurniturePieceImpl({ piece, status = 'ok', selected, hovered, ghost, contact, onPointerDown, onPointerOver, onPointerOut, onPointerMove, onPointerUp, onClick }: FurniturePieceProps) {
  const tones = useMemo(() => tonesFor(piece, status, { selected, hovered }), [piece, status, selected, hovered]);
  const seed = useMemo(() => hash32(piece.id), [piece.id]);
  const state = useMemo<PartState>(
    () => ({ ghost: Boolean(ghost), emissive: tones.emissive, emissiveIntensity: tones.emissiveIntensity, shadow: !piece.flat }),
    [ghost, tones.emissive, tones.emissiveIntensity, piece.flat],
  );
  const lift = hovered && !ghost && !piece.flat ? 0.012 : 0;
  const buyer = piece.owner === 'buyer';
  // A renter's piece keeps its blue selection ring; the misfit is a separate red outline drawn over it.
  const ringColor = buyer ? BUYER_BLUE : STATUS_RING[status] ?? ACCENT;
  const misfitEdge = buyer ? STATUS_RING[status] : null;
  const contactTex = useMemo(() => (contact && !piece.flat && !ghost ? contactShadow() : null), [contact, piece.flat, ghost]);
  return (
    <group
      position={[piece.x, lift, piece.z]}
      rotation={[0, piece.rot, 0]}
      onPointerDown={onPointerDown}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
    >
      {/* Under the body, so the piece itself never draws over its own contact shadow. */}
      {contactTex ? (
        // 2 cm up, not on the floor: a rug is a flat piece 1.2 cm thick, and a contact shadow drawn
        // under it would be invisible for exactly the pieces most likely to stand on one.
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02 - lift, 0]} raycast={noRaycast} renderOrder={2} userData={{ measureIgnore: true, stillsKeep: true }}>
          <planeGeometry args={[piece.w * 1.5 + 0.18, piece.d * 1.5 + 0.18]} />
          <meshBasicMaterial map={contactTex} transparent opacity={0.5} depthWrite={false} toneMapped={false} fog={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ) : null}
      <Parts state={state}>
        <KindBody kind={piece.kind} w={piece.w} d={piece.d} h={piece.flat ? 0.012 : piece.h} t={tones} seed={seed} />
      </Parts>
      {selected && !ghost ? <FootprintRing w={piece.w} d={piece.d} color={ringColor} opacity={0.9} /> : null}
      {ghost ? <FootprintRing w={piece.w} d={piece.d} color={STATUS_RING[status] ?? ringColor} opacity={0.55} /> : null}
      {/* Renter pieces stay blue in 3D — exactly as in the minimap — and carry a red edge when they do not fit. */}
      {misfitEdge && !ghost ? <FootprintRing w={piece.w} d={piece.d} color={misfitEdge} opacity={1} pad={0.13} thickness={0.026} y={0.002} /> : null}
    </group>
  );
}

export const FurniturePiece = memo(FurniturePieceImpl);
