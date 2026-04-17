import { useEffect, useRef, useCallback, useState } from 'react';
import type { SessionSocket } from '../lib/ws.ts';
import type { WsServerMessage } from '@lecture-feedback/shared';

interface StoredAnnotation {
  type: string;
  points: { x: number; y: number }[];
  color?: string;
  width?: number;
  size?: number;
  timestamp: number;
}

export interface LaserState {
  visible: boolean;
  x: number;
  y: number;
  paused: boolean;
  slideIndex: number;
}

export interface CursorState {
  visible: boolean;
  x: number;
  y: number;
  tool: string;
}

export interface IncomingStroke {
  type: 'draw' | 'erase';
  points: { x: number; y: number }[];
  color?: string;
  width?: number;
  size?: number;
}

const EMPTY_ANNOTATIONS: StoredAnnotation[] = [];

export interface AnnotationReceiverOptions {
  /** When true, incoming draw/erase/clear messages are ignored. Used to
   *  suppress lecturer strokes on the student slide view while the lecturer
   *  is drawing on the whiteboard — otherwise the strokes would paint onto
   *  the slide the student is still looking at. */
  suppress?: boolean;
}

export function useAnnotationReceiver(socket: SessionSocket | null, options?: AnnotationReceiverOptions) {
  const annotationsRef = useRef<Map<number, StoredAnnotation[]>>(new Map());
  const [laserState, setLaserState] = useState<LaserState>({ visible: false, x: 0, y: 0, paused: false, slideIndex: -1 });
  const [cursorState, setCursorState] = useState<CursorState>({ visible: false, x: 0, y: 0, tool: 'pointer' });
  const [incomingStroke, setIncomingStroke] = useState<IncomingStroke | null>(null);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const [clearSlide, setClearSlide] = useState(0);

  const getAnnotations = useCallback((slideIndex: number): StoredAnnotation[] => {
    return annotationsRef.current.get(slideIndex) ?? EMPTY_ANNOTATIONS;
  }, []);

  // Ref-mirrored so the message handler reads the latest value without
  // re-subscribing the socket every time `suppress` flips.
  const suppressRef = useRef(options?.suppress ?? false);
  useEffect(() => { suppressRef.current = options?.suppress ?? false; }, [options?.suppress]);

  useEffect(() => {
    if (!socket) return;

    const unsub = socket.onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case 'DRAW_STROKE': {
          // If the stroke is tagged as a whiteboard stroke and we're
          // suppressing (student chose to stay on slide view while lecturer
          // is on whiteboard), ignore it — don't persist, don't render.
          if (msg.whiteboard && suppressRef.current) break;
          const existing = annotationsRef.current.get(msg.slideIndex) ?? [];
          existing.push({
            type: 'draw',
            points: msg.points,
            color: msg.color,
            width: msg.width,
            timestamp: Date.now(),
          });
          annotationsRef.current.set(msg.slideIndex, existing);
          setIncomingStroke({ type: 'draw', points: msg.points, color: msg.color, width: msg.width });
          break;
        }

        case 'ERASE_STROKE': {
          if (msg.whiteboard && suppressRef.current) break;
          const existing = annotationsRef.current.get(msg.slideIndex) ?? [];
          existing.push({
            type: 'erase',
            points: msg.points,
            size: msg.size,
            timestamp: Date.now(),
          });
          annotationsRef.current.set(msg.slideIndex, existing);
          setIncomingStroke({ type: 'erase', points: msg.points, size: msg.size });
          break;
        }

        case 'CLEAR_ANNOTATIONS':
          annotationsRef.current.set(msg.slideIndex, []);
          setClearSlide((n) => n + 1);
          break;

        case 'ANNOTATION_SYNC':
          annotationsRef.current.set(msg.slideIndex, msg.annotations);
          setSyncTrigger((n) => n + 1);
          break;

        case 'LASER_MOVE':
          setLaserState({ visible: true, x: msg.x, y: msg.y, paused: false, slideIndex: msg.slideIndex });
          break;

        case 'LASER_PAUSE':
          setLaserState({ visible: true, x: msg.x, y: msg.y, paused: true, slideIndex: msg.slideIndex });
          break;

        case 'LASER_END':
          setLaserState({ visible: false, x: 0, y: 0, paused: false, slideIndex: -1 });
          break;

        case 'CURSOR_POSITION':
          setCursorState({ visible: true, x: msg.x, y: msg.y, tool: msg.tool });
          break;

        case 'CURSOR_HIDE':
          setCursorState({ visible: false, x: 0, y: 0, tool: 'pointer' });
          break;
      }
    });

    return unsub;
  }, [socket]);

  return {
    getAnnotations,
    incomingStroke,
    syncTrigger,
    clearSlide,
    laserState,
    cursorState,
  };
}
