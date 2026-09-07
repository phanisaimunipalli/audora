/**
 * Multiplayer over BroadcastChannel: two tabs of the same browser stage a room together with live
 * cursors. The message shapes are the contract a Convex / WebSocket backend would carry across machines.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlacedPiece } from '@/engine/types';
import { shortId } from '@/lib/ids';
import { useAudora } from './store';

export interface Peer {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; z: number } | null;
  pose?: { x: number; z: number; yaw: number };
  mode: 'orbit' | 'walk';
  lastSeen: number;
}

type Msg =
  | { t: 'hello'; peer: Peer }
  | { t: 'presence'; peer: Peer }
  | { t: 'bye'; id: string }
  | { t: 'staging'; from: string; roomId: string; pieces: PlacedPiece[] };

const NAMES = ['Priya', 'Dan', 'Ana', 'Marco', 'Yuki', 'Sam'];
/* Presence colours: readable on the white page, and never the buyer's blue (#1d63ff) —
   that one belongs to the buyer's furniture alone. */
const COLORS = ['#7a6a3f', '#2f7a52', '#7c5cbf', '#b3593f', '#0f6f7a', '#a03a6b'];

const selfId = shortId(6);
const selfIdx = Math.abs(parseInt(selfId, 36)) % NAMES.length;
export const SELF: Peer = { id: selfId, name: NAMES[selfIdx], color: COLORS[selfIdx], cursor: null, mode: 'orbit', lastSeen: Date.now() };

export function useCollab(roomId: string | undefined) {
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const chanRef = useRef<BroadcastChannel | null>(null);
  const applyingRemote = useRef(false);

  useEffect(() => {
    if (!roomId || typeof BroadcastChannel === 'undefined') return;
    const chan = new BroadcastChannel(`audora:room:${roomId}`);
    chanRef.current = chan;
    const onMsg = (ev: MessageEvent<Msg>) => {
      const m = ev.data;
      if (m.t === 'hello') {
        setPeers((p) => ({ ...p, [m.peer.id]: { ...m.peer, lastSeen: Date.now() } }));
        chan.postMessage({ t: 'presence', peer: { ...SELF, lastSeen: Date.now() } } satisfies Msg);
      } else if (m.t === 'presence') {
        setPeers((p) => ({ ...p, [m.peer.id]: { ...m.peer, lastSeen: Date.now() } }));
      } else if (m.t === 'bye') {
        setPeers((p) => {
          const n = { ...p };
          delete n[m.id];
          return n;
        });
      } else if (m.t === 'staging' && m.roomId === roomId && m.from !== SELF.id) {
        applyingRemote.current = true;
        useAudora.getState().setStaging(roomId, m.pieces);
        applyingRemote.current = false;
      }
    };
    chan.addEventListener('message', onMsg);
    chan.postMessage({ t: 'hello', peer: { ...SELF, lastSeen: Date.now() } } satisfies Msg);
    const gc = window.setInterval(() => {
      const cutoff = Date.now() - 6000;
      setPeers((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v.lastSeen > cutoff)));
    }, 2000);
    const bye = () => chan.postMessage({ t: 'bye', id: SELF.id } satisfies Msg);
    window.addEventListener('beforeunload', bye);
    return () => {
      bye();
      window.removeEventListener('beforeunload', bye);
      window.clearInterval(gc);
      chan.removeEventListener('message', onMsg);
      chan.close();
      chanRef.current = null;
    };
  }, [roomId]);

  const api = useMemo(
    () => ({
      self: SELF,
      /** Call at ~15Hz while the pointer moves over the floor, with null when it leaves. */
      sendPresence(cursor: { x: number; z: number } | null, mode: 'orbit' | 'walk', pose?: Peer['pose']) {
        chanRef.current?.postMessage({ t: 'presence', peer: { ...SELF, cursor, mode, pose, lastSeen: Date.now() } } satisfies Msg);
      },
      /** Broadcast a staging change (skipped when the change itself came from a peer). */
      sendStaging(pieces: PlacedPiece[]) {
        if (!roomId || applyingRemote.current) return;
        chanRef.current?.postMessage({ t: 'staging', from: SELF.id, roomId, pieces } satisfies Msg);
      },
    }),
    [roomId],
  );

  return { peers: Object.values(peers), ...api };
}
