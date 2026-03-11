import { useEffect, useState, useCallback } from 'react';
import type { SessionSocket } from '../lib/ws.ts';
import type { WsServerMessage } from '@lecture-feedback/shared';

export type AnnotationAccessStatus = 'idle' | 'pending' | 'granted';

export interface RevokeInfo {
  reason: 'slide_change' | 'lecturer_revoked' | 'session_ended';
}

export function useAnnotationAccess(socket: SessionSocket | null) {
  const [status, setStatus] = useState<AnnotationAccessStatus>('idle');
  const [lastRevoke, setLastRevoke] = useState<RevokeInfo | null>(null);

  useEffect(() => {
    if (!socket) return;

    const unsub = socket.onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case 'ANNOTATION_ACCESS_GRANTED':
          setStatus('granted');
          setLastRevoke(null);
          break;
        case 'ANNOTATION_ACCESS_REVOKED':
          setStatus('idle');
          setLastRevoke({ reason: msg.reason });
          break;
        case 'ANNOTATION_ACCESS_DISMISSED':
          setStatus('idle');
          break;
      }
    });

    return unsub;
  }, [socket]);

  const requestAccess = useCallback((reason: string) => {
    if (!socket) return;
    socket.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason });
    setStatus('pending');
  }, [socket]);

  const cancelRequest = useCallback(() => {
    if (!socket) return;
    socket.send({ type: 'ANNOTATION_ACCESS_CANCEL' });
    setStatus('idle');
  }, [socket]);

  return { status, lastRevoke, requestAccess, cancelRequest };
}
