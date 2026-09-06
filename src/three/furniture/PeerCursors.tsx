import { Html } from '@react-three/drei';
import type { Peer } from '@/state/collab';
import { noRaycast } from './partContext';

export interface PeerCursorsProps {
  peers: Peer[];
}

function Label({ name, color, y }: { name: string; color: string; y: number }) {
  return (
    <Html position={[0, y, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
      <span
        className="mono rounded-full border px-2 py-0.5 text-[11px]"
        style={{ background: 'rgba(14,13,12,0.82)', borderColor: color, color, backdropFilter: 'blur(6px)' }}
      >
        {name}
      </span>
    </Html>
  );
}

/**
 * Other people in the same room: a floor marker where their pointer is, or a translucent figure where
 * they stand when walking. Fed by useCollab(roomId).peers.
 */
export function PeerCursors({ peers }: PeerCursorsProps) {
  return (
    <group>
      {peers.map((p) => {
        if (p.cursor) {
          return (
            <group key={p.id} position={[p.cursor.x, 0.012, p.cursor.z]}>
              <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
                <ringGeometry args={[0.09, 0.13, 32]} />
                <meshBasicMaterial color={p.color} transparent opacity={0.9} depthWrite={false} />
              </mesh>
              <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
                <circleGeometry args={[0.045, 24]} />
                <meshBasicMaterial color={p.color} depthWrite={false} />
              </mesh>
              <Label name={p.name} color={p.color} y={0.32} />
            </group>
          );
        }
        if (p.pose && p.mode === 'walk') {
          return (
            <group key={p.id} position={[p.pose.x, 0, p.pose.z]} rotation={[0, p.pose.yaw, 0]}>
              <mesh position={[0, 0.8, 0]} raycast={noRaycast}>
                <capsuleGeometry args={[0.16, 1.25, 4, 12]} />
                <meshStandardMaterial color={p.color} transparent opacity={0.35} depthWrite={false} />
              </mesh>
              <mesh position={[0, 1.55, -0.2]} raycast={noRaycast}>
                <coneGeometry args={[0.06, 0.16, 10]} />
                <meshBasicMaterial color={p.color} transparent opacity={0.8} />
              </mesh>
              <Label name={`${p.name} · walking`} color={p.color} y={1.95} />
            </group>
          );
        }
        return null;
      })}
    </group>
  );
}
