import { useEffect, useState, useCallback } from 'react';
import type { SessionSocket } from '../lib/ws.ts';
import type { WsServerMessage } from '@lecture-feedback/shared';

export interface AnnotationAccessQueueItem {
  studentId: string;
  studentName: string;
  reason: string;
}

export function useAnnotationAccessManager(socket: SessionSocket | null) {
  const [queue, setQueue] = useState<AnnotationAccessQueueItem[]>([]);
  const [grantedStudent, setGrantedStudent] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!socket) return;

    const unsub = socket.onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case 'ANNOTATION_ACCESS_REQUESTED':
          setQueue((prev) => [
            ...prev,
            { studentId: msg.studentId, studentName: msg.studentName, reason: msg.reason },
          ]);
          break;
        case 'ANNOTATION_ACCESS_STATE':
          setGrantedStudent(msg.grantedStudent);
          setQueue(msg.queue);
          break;
      }
    });

    return unsub;
  }, [socket]);

  const grantAccess = useCallback((studentId: string) => {
    socket?.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId });
  }, [socket]);

  const dismissRequest = useCallback((studentId: string) => {
    socket?.send({ type: 'ANNOTATION_ACCESS_DISMISS', studentId });
  }, [socket]);

  const revokeAccess = useCallback(() => {
    socket?.send({ type: 'ANNOTATION_ACCESS_REVOKE' });
  }, [socket]);

  return { queue, grantedStudent, grantAccess, dismissRequest, revokeAccess };
}
