import { useRef, useCallback, useEffect } from 'react';
import type { SessionSocket } from '../lib/ws.ts';

interface UseAnnotationSyncOptions {
  socket: SessionSocket | null;
  slideIndex: number;
  canvasWidth: number;
  canvasHeight: number;
}

export function useAnnotationSync({ socket, slideIndex, canvasWidth, canvasHeight }: UseAnnotationSyncOptions) {
  const drawBatchRef = useRef<{ x: number; y: number }[]>([]);
  const eraseBatchRef = useRef<{ x: number; y: number }[]>([]);
  const drawBatchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eraseBatchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLaserSendRef = useRef(0);
  const lastCursorSendRef = useRef(0);
  const laserDwellRef = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> | null }>({ x: 0, y: 0, timer: null });
  const currentDrawPropsRef = useRef<{ color: string; width: number }>({ color: '#e11d48', width: 5 });
  const currentEraseSizeRef = useRef(32);

  const normalize = useCallback((px: number, py: number) => ({
    x: canvasWidth > 0 ? px / canvasWidth : 0,
    y: canvasHeight > 0 ? py / canvasHeight : 0,
  }), [canvasWidth, canvasHeight]);

  const normalizeDim = useCallback((val: number) =>
    canvasWidth > 0 ? val / canvasWidth : 0,
  [canvasWidth]);

  // ── Draw stroke batching ──────────────────────────────────────

  const startDrawBatch = useCallback((color: string, width: number) => {
    currentDrawPropsRef.current = { color, width };
    drawBatchRef.current = [];
    if (drawBatchTimerRef.current) clearInterval(drawBatchTimerRef.current);
    drawBatchTimerRef.current = setInterval(() => {
      if (drawBatchRef.current.length > 0 && socket) {
        socket.send({
          type: 'DRAW_STROKE',
          points: [...drawBatchRef.current],
          color: currentDrawPropsRef.current.color,
          width: normalizeDim(currentDrawPropsRef.current.width),
          slideIndex,
        });
        drawBatchRef.current = [];
      }
    }, 50);
  }, [socket, slideIndex, normalizeDim]);

  const addDrawPoint = useCallback((px: number, py: number) => {
    drawBatchRef.current.push(normalize(px, py));
  }, [normalize]);

  const endDrawBatch = useCallback(() => {
    if (drawBatchTimerRef.current) {
      clearInterval(drawBatchTimerRef.current);
      drawBatchTimerRef.current = null;
    }
    if (drawBatchRef.current.length > 0 && socket) {
      socket.send({
        type: 'DRAW_STROKE',
        points: [...drawBatchRef.current],
        color: currentDrawPropsRef.current.color,
        width: normalizeDim(currentDrawPropsRef.current.width),
        slideIndex,
      });
      drawBatchRef.current = [];
    }
  }, [socket, slideIndex, normalizeDim]);

  // ── Erase stroke batching ─────────────────────────────────────

  const startEraseBatch = useCallback((size: number) => {
    currentEraseSizeRef.current = size;
    eraseBatchRef.current = [];
    if (eraseBatchTimerRef.current) clearInterval(eraseBatchTimerRef.current);
    eraseBatchTimerRef.current = setInterval(() => {
      if (eraseBatchRef.current.length > 0 && socket) {
        socket.send({
          type: 'ERASE_STROKE',
          points: [...eraseBatchRef.current],
          size: normalizeDim(currentEraseSizeRef.current),
          slideIndex,
        });
        eraseBatchRef.current = [];
      }
    }, 50);
  }, [socket, slideIndex, normalizeDim]);

  const addErasePoint = useCallback((px: number, py: number) => {
    eraseBatchRef.current.push(normalize(px, py));
  }, [normalize]);

  const endEraseBatch = useCallback(() => {
    if (eraseBatchTimerRef.current) {
      clearInterval(eraseBatchTimerRef.current);
      eraseBatchTimerRef.current = null;
    }
    if (eraseBatchRef.current.length > 0 && socket) {
      socket.send({
        type: 'ERASE_STROKE',
        points: [...eraseBatchRef.current],
        size: normalizeDim(currentEraseSizeRef.current),
        slideIndex,
      });
      eraseBatchRef.current = [];
    }
  }, [socket, slideIndex, normalizeDim]);

  // ── Laser pointer ─────────────────────────────────────────────

  const sendLaserMove = useCallback((px: number, py: number) => {
    const now = Date.now();
    if (now - lastLaserSendRef.current < 30) return;
    lastLaserSendRef.current = now;

    const { x, y } = normalize(px, py);
    socket?.send({ type: 'LASER_MOVE', x, y, slideIndex });

    const dwell = laserDwellRef.current;
    const dist = Math.sqrt((x - dwell.x) ** 2 + (y - dwell.y) ** 2);
    if (dist > 0.01) {
      if (dwell.timer) clearTimeout(dwell.timer);
      dwell.x = x;
      dwell.y = y;
      dwell.timer = setTimeout(() => {
        socket?.send({ type: 'LASER_PAUSE', x, y, slideIndex });
      }, 500);
    }
  }, [socket, slideIndex, normalize]);

  const sendLaserEnd = useCallback(() => {
    if (laserDwellRef.current.timer) {
      clearTimeout(laserDwellRef.current.timer);
      laserDwellRef.current.timer = null;
    }
    socket?.send({ type: 'LASER_END' });
  }, [socket]);

  // ── Cursor position ───────────────────────────────────────────

  const sendCursorPosition = useCallback((px: number, py: number, tool: string) => {
    const now = Date.now();
    if (now - lastCursorSendRef.current < 60) return;
    lastCursorSendRef.current = now;

    const { x, y } = normalize(px, py);
    socket?.send({ type: 'CURSOR_POSITION', x, y, tool: tool as import('@lecture-feedback/shared').DrawToolType, slideIndex });
  }, [socket, slideIndex, normalize]);

  const sendCursorHide = useCallback(() => {
    socket?.send({ type: 'CURSOR_HIDE' });
  }, [socket]);

  // ── Clear ─────────────────────────────────────────────────────

  const sendClear = useCallback(() => {
    socket?.send({ type: 'CLEAR_ANNOTATIONS', slideIndex });
  }, [socket, slideIndex]);

  useEffect(() => {
    return () => {
      if (drawBatchTimerRef.current) clearInterval(drawBatchTimerRef.current);
      if (eraseBatchTimerRef.current) clearInterval(eraseBatchTimerRef.current);
      if (laserDwellRef.current.timer) clearTimeout(laserDwellRef.current.timer);
    };
  }, []);

  return {
    startDrawBatch,
    addDrawPoint,
    endDrawBatch,
    startEraseBatch,
    addErasePoint,
    endEraseBatch,
    sendLaserMove,
    sendLaserEnd,
    sendCursorPosition,
    sendCursorHide,
    sendClear,
  };
}
