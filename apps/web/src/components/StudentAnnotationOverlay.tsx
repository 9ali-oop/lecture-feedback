import { useRef, useEffect } from 'react';
import type { IncomingStroke } from '../hooks/useAnnotationReceiver.ts';

interface StudentAnnotationOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  incomingStroke: IncomingStroke | null;
  clearTrigger: number;
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

export default function StudentAnnotationOverlay({
  canvasWidth,
  canvasHeight,
  incomingStroke,
  clearTrigger,
}: StudentAnnotationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Clear canvas on trigger
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.clearRect(0, 0, canvasWidth, canvasHeight);
  }, [clearTrigger, canvasWidth, canvasHeight]);

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

  return (
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      className="absolute inset-0 pointer-events-none"
      style={{ width: canvasWidth, height: canvasHeight, zIndex: 12 }}
    />
  );
}
