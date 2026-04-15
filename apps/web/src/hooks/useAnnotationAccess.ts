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
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    const unsub = socket.onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case 'ANNOTATION_ACCESS_GRANTED':
          setStatus('granted');
          setLastRevoke(null);
          setLastError(null);
          break;
        case 'ANNOTATION_ACCESS_REVOKED':
          setStatus('idle');
          setLastRevoke({ reason: msg.reason });
          break;
        case 'ANNOTATION_ACCESS_DISMISSED':
          setStatus('idle');
          break;
        case 'ERROR':
          // If the server rejected the request (e.g. reason too long), don't
          // leave the student stuck in 'pending' with no way out.
          setStatus((prev) => (prev === 'pending' ? 'idle' : prev));
          setLastError(msg.message);
          break;
      }
    });

    return unsub;
  }, [socket]);

  const requestAccess = useCallback((reason: string) => {
    if (!socket) return;
    setLastError(null);
    socket.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason });
    setStatus('pending');
  }, [socket]);

  const cancelRequest = useCallback(() => {
    if (!socket) return;
    socket.send({ type: 'ANNOTATION_ACCESS_CANCEL' });
    setStatus('idle');
  }, [socket]);

  return { status, lastRevoke, lastError, requestAccess, cancelRequest };
}
