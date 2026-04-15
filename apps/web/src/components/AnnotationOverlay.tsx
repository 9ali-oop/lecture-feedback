import { useRef, useEffect, useState } from 'react';
import type { LaserState, CursorState, IncomingStroke } from '../hooks/useAnnotationReceiver.ts';

interface StoredAnnotation {
  type: string;
  points: { x: number; y: number }[];
  color?: string;
  width?: number;
  size?: number;
  timestamp: number;
}

interface AnnotationOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  annotations: StoredAnnotation[];
  incomingStroke: IncomingStroke | null;
  syncTrigger: number;
  clearSlide: number;
  laserState: LaserState;
  cursorState: CursorState;
  currentSlide: number;
}

function drawStrokeOnCanvas(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  type: string,
  color: string | undefined,
  width: number | undefined,
  size: number | undefined,
  canvasWidth: number,
  canvasHeight: number,
) {
  if (points.length === 0) return;

  if (type === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = (size ?? 0.03) * canvasWidth;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color ?? '#e11d48';
    ctx.lineWidth = (width ?? 0.005) * canvasWidth;
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    // Single point: draw a filled dot so taps/short strokes are visible
    const px = points[0].x * canvasWidth;
    const py = points[0].y * canvasHeight;
    ctx.beginPath();
    ctx.arc(px, py, ctx.lineWidth / 2, 0, Math.PI * 2);
    if (type === 'erase') {
      ctx.fill();
    } else {
      ctx.fillStyle = color ?? '#e11d48';
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x * canvasWidth, points[0].y * canvasHeight);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * canvasWidth, points[i].y * canvasHeight);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export default function AnnotationOverlay({
  canvasWidth,
  canvasHeight,
  annotations,
  incomingStroke,
  syncTrigger,
  clearSlide,
  laserState,
  cursorState,
  currentSlide,
}: AnnotationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ringPhase, setRingPhase] = useState(0);
  const laserAnimRef = useRef<number | null>(null);

  // Full re-render on sync or clear
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    for (const ann of annotations) {
      drawStrokeOnCanvas(ctx, ann.points, ann.type, ann.color, ann.width, ann.size, canvasWidth, canvasHeight);
    }
  }, [syncTrigger, clearSlide, canvasWidth, canvasHeight, annotations]);

  // Incremental render for incoming strokes
  useEffect(() => {
    if (!incomingStroke) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    drawStrokeOnCanvas(
      ctx,
      incomingStroke.points,
      incomingStroke.type,
      incomingStroke.color,
      incomingStroke.width,
      incomingStroke.size,
      canvasWidth,
      canvasHeight,
    );
  }, [incomingStroke, canvasWidth, canvasHeight]);

  // Pulsing ring animation for laser dwell
  useEffect(() => {
    if (!laserState.paused) {
      setRingPhase(0);
      if (laserAnimRef.current) {
        cancelAnimationFrame(laserAnimRef.current);
        laserAnimRef.current = null;
      }
      return;
    }

    const animate = () => {
      setRingPhase((p) => (p + 0.05) % (Math.PI * 2));
      laserAnimRef.current = requestAnimationFrame(animate);
    };
    laserAnimRef.current = requestAnimationFrame(animate);
    return () => {
      if (laserAnimRef.current) cancelAnimationFrame(laserAnimRef.current);
    };
  }, [laserState.paused]);

  const laserVisible = laserState.visible && laserState.slideIndex === currentSlide;
  const laserX = laserState.x * canvasWidth;
  const laserY = laserState.y * canvasHeight;
  const cursorX = cursorState.x * canvasWidth;
  const cursorY = cursorState.y * canvasHeight;
  const ringScale = laserState.paused ? 1 + 0.3 * Math.sin(ringPhase) : 0;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ width: canvasWidth, height: canvasHeight, zIndex: 15 }}>
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        className="absolute inset-0"
        style={{ width: canvasWidth, height: canvasHeight }}
      />

      {laserVisible && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: laserX - 22,
            top: laserY - 22,
            width: 44,
            height: 44,
            zIndex: 25,
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(255,30,30,0.35) 0%, rgba(255,30,30,0) 70%)',
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              left: 17,
              top: 17,
              width: 10,
              height: 10,
              background: 'rgba(255, 30, 30, 0.95)',
            }}
          />
          {laserState.paused && (
            <div
              className="absolute rounded-full border-2 border-red-400"
              style={{
                left: 22 - 18 * (1 + ringScale) / 2,
                top: 22 - 18 * (1 + ringScale) / 2,
                width: 18 * (1 + ringScale),
                height: 18 * (1 + ringScale),
                opacity: 0.6 + 0.4 * Math.sin(ringPhase),
                transition: 'width 0.1s, height 0.1s',
              }}
            />
          )}
        </div>
      )}

      {cursorState.visible && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: cursorX,
            top: cursorY,
            transform: 'translate(-50%, -50%)',
            zIndex: 25,
          }}
        >
          {cursorState.tool === 'pen' && (
            <div className="h-3 w-3 rounded-full bg-white/60 ring-1 ring-white/30" />
          )}
          {cursorState.tool === 'eraser' && (
            <div className="h-6 w-6 rounded-full border-2 border-white/50" />
          )}
          {(cursorState.tool === 'pointer' || cursorState.tool === 'text') && (
            <div className="h-2 w-2 rounded-full bg-white/60" />
          )}
        </div>
      )}
    </div>
  );
}
