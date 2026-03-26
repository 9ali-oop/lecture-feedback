/**
 * Dialog that appears when a student selects "confused" or "lost".
 * Allows them to circle the confusing part of the slide and optionally explain.
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import type { Emoji } from '@lecture-feedback/shared';

interface ConfusionHighlight {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface ConfusionDialogProps {
  open: boolean;
  emoji: Emoji;
  slideImageUrl: string;
  token: string;
  onSubmit: (highlights: ConfusionHighlight[], explanation: string) => void;
  onSkip: () => void;
  onDisable: () => void;
}

const HIGHLIGHT_COLOR = '#ef4444';
const HIGHLIGHT_WIDTH = 0.004; // normalized

export default function ConfusionDialog({
  open,
  emoji,
  slideImageUrl,
  token,
  onSubmit,
  onSkip,
  onDisable,
}: ConfusionDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [explanation, setExplanation] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [strokes, setStrokes] = useState<ConfusionHighlight[]>([]);
  const currentStroke = useRef<{ x: number; y: number }[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setExplanation('');
      setStrokes([]);
      currentStroke.current = [];
      setImageLoaded(false);
    }
  }, [open]);

  // Draw the slide image + all strokes
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageLoaded) return;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Draw existing strokes
    for (const stroke of strokes) {
      drawStroke(ctx, stroke, canvas.width, canvas.height);
    }

    // Draw current in-progress stroke
    if (currentStroke.current.length > 1) {
      drawStroke(ctx, {
        points: currentStroke.current,
        color: HIGHLIGHT_COLOR,
        width: HIGHLIGHT_WIDTH,
      }, canvas.width, canvas.height);
    }
  }, [strokes, imageLoaded]);

  useEffect(() => { redraw(); }, [redraw]);

  function drawStroke(
    ctx: CanvasRenderingContext2D,
    stroke: ConfusionHighlight,
    w: number,
    h: number,
  ) {
    if (stroke.points.length < 2) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x * w, stroke.points[i].y * h);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function getPos(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    setDrawing(true);
    currentStroke.current = [getPos(e)];
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    currentStroke.current.push(getPos(e));
    redraw();
  }

  function onMouseUp() {
    if (!drawing) return;
    setDrawing(false);
    if (currentStroke.current.length > 1) {
      setStrokes((prev) => [
        ...prev,
        { points: [...currentStroke.current], color: HIGHLIGHT_COLOR, width: HIGHLIGHT_WIDTH },
      ]);
    }
    currentStroke.current = [];
  }

  function handleUndo() {
    setStrokes((prev) => prev.slice(0, -1));
  }

  function handleSubmit() {
    onSubmit(strokes, explanation.trim());
  }

  function handleImageLoad() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    // Size canvas to match image aspect ratio within the dialog
    const maxW = canvas.parentElement?.clientWidth ?? 600;
    const aspect = img.naturalHeight / img.naturalWidth;
    canvas.width = maxW;
    canvas.height = Math.round(maxW * aspect);
    setImageLoaded(true);
  }

  if (!open) return null;

  const label = emoji === 'lost' ? 'lost' : 'confused';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              What made you {label}?
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Circle the part of the slide that confused you, or just explain below
            </p>
          </div>
          <button
            onClick={onSkip}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            title="Skip"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Slide canvas */}
        <div className="relative px-5 pt-4">
          {/* Hidden image for loading */}
          <img
            ref={imgRef}
            src={slideImageUrl}
            crossOrigin="anonymous"
            onLoad={handleImageLoad}
            className="hidden"
            alt=""
          />
          <canvas
            ref={canvasRef}
            className="w-full cursor-crosshair rounded-lg border border-gray-200 shadow-sm"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
          {!imageLoaded && (
            <div className="absolute inset-5 flex items-center justify-center rounded-lg bg-gray-50">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          )}
          {strokes.length > 0 && (
            <button
              onClick={handleUndo}
              className="absolute right-7 top-6 rounded-lg bg-white/90 px-2 py-1 text-xs font-medium text-gray-600 shadow ring-1 ring-gray-200 transition hover:bg-gray-50"
            >
              Undo
            </button>
          )}
        </div>

        {/* Explanation */}
        <div className="px-5 pt-3">
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Optional: describe what confused you..."
            maxLength={500}
            rows={2}
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-5 py-4">
          <button
            onClick={onDisable}
            className="text-xs text-gray-400 transition hover:text-gray-600"
          >
            Don't show this again
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onSkip}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
