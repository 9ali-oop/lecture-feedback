import { useEffect, useState } from 'react';
import type { SessionSocket } from '../lib/ws.ts';
import type { WsServerMessage } from '@lecture-feedback/shared';
import type { IncomingStroke } from './useAnnotationReceiver.ts';

export function useStudentAnnotationReceiver(socket: SessionSocket | null) {
  const [incomingStroke, setIncomingStroke] = useState<IncomingStroke | null>(null);
  const [clearTrigger, setClearTrigger] = useState(0);
  const [annotatorName, setAnnotatorName] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    const unsub = socket.onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case 'STUDENT_DRAW_STROKE':
          setAnnotatorName(msg.studentName);
          setIncomingStroke({ type: 'draw', points: msg.points, color: msg.color, width: msg.width });
          break;
        case 'STUDENT_ERASE_STROKE':
          setAnnotatorName(msg.studentName);
          setIncomingStroke({ type: 'erase', points: msg.points, size: msg.size });
          break;
        case 'STUDENT_CLEAR_ANNOTATIONS':
          setClearTrigger((n) => n + 1);
          break;
      }
    });

    return unsub;
  }, [socket]);

  return { incomingStroke, clearTrigger, annotatorName };
}
