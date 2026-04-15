import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export type DrawTool = 'pointer' | 'pen' | 'laser' | 'eraser' | 'text';

interface PdfViewerProps {
  url: string;
  currentPage: number; // 0-indexed
  onTotalPages?: (total: number) => void;
  className?: string;
  overlayRef?: React.RefObject<HTMLCanvasElement | null>;
  tool?: DrawTool;
  penColor?: string;
  penWidth?: number;
  eraserWidth?: number;
  token?: string;
  whiteboardMode?: boolean;
  scaleMode?: 'contain' | 'width'; // 'contain' fits both w+h (lecturer), 'width' fits width only (student)
  onCanvasResize?: (width: number, height: number) => void;
  onDrawStart?: (x: number, y: number, tool: DrawTool) => void;
  onDrawMove?: (x: number, y: number, tool: DrawTool) => void;
  onDrawEnd?: (tool: DrawTool) => void;
  onLeave?: (tool: DrawTool) => void;
}

export default function PdfViewer({
  url,
  currentPage,
  onTotalPages,
  className = '',
  overlayRef,
  tool = 'pointer',
  penColor = '#e11d48',
  penWidth = 3,
  eraserWidth = 28,
  token,
  whiteboardMode = false,
  scaleMode = 'contain',
  onCanvasResize,
  onDrawStart,
  onDrawMove,
  onDrawEnd,
  onLeave,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const laserDotRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Keep onCanvasResize in a ref so it never causes renderPage to be recreated
  const onCanvasResizeRef = useRef(onCanvasResize);
  onCanvasResizeRef.current = onCanvasResize;

  // ── Load PDF ────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params: Parameters<typeof pdfjsLib.getDocument>[0] = { url };
    if (token) params.httpHeaders = { Authorization: `Bearer ${token}` };

    pdfjsLib
      .getDocument(params)
      .promise.then((doc) => {
        pdfRef.current = doc;
        onTotalPages?.(doc.numPages);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });

    return () => { pdfRef.current?.destroy(); };
  }, [url]);

  // ── Save/restore overlay on resize ──────────────────────────────
  const saveAndResizeOverlay = useCallback((w: number, h: number) => {
    const overlay = overlayRef?.current;
    if (!overlay) return;
    // Save current overlay content before resize clears it
    let savedData: ImageData | null = null;
    const prevW = overlay.width;
    const prevH = overlay.height;
    if (prevW > 0 && prevH > 0) {
      try { savedData = overlay.getContext('2d')!.getImageData(0, 0, prevW, prevH); } catch { /* empty */ }
    }
    overlay.width = w;
    overlay.height = h;
    // Restore by drawing the old data scaled to new dimensions
    if (savedData) {
      const tmp = document.createElement('canvas');
      tmp.width = prevW;
      tmp.height = prevH;
      tmp.getContext('2d')!.putImageData(savedData, 0, 0);
      overlay.getContext('2d')!.drawImage(tmp, 0, 0, w, h);
    }
  }, [overlayRef]);

  // ── Render page ─────────────────────────────────────────────────
  const renderPage = useCallback(async (pageIndex: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const containerWidth = container.clientWidth || 900;
    const containerHeight = container.clientHeight || 600;

    if (whiteboardMode) {
      // Fit 16:9 whiteboard within available space
      const wByWidth = containerWidth;
      const hByWidth = Math.round(containerWidth * 9 / 16);
      const wByHeight = Math.round(containerHeight * 16 / 9);
      const hByHeight = containerHeight;
      const w = hByWidth <= containerHeight ? wByWidth : wByHeight;
      const h = hByWidth <= containerHeight ? hByWidth : hByHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      saveAndResizeOverlay(w, h);
      onCanvasResizeRef.current?.(w, h);
      return;
    }

    const pdf = pdfRef.current;
    if (!pdf) return;

    const pageNum = Math.min(Math.max(pageIndex + 1, 1), pdf.numPages);
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    // Scale to fit the container (CSS pixels)
    const scaleByWidth = containerWidth / viewport.width;
    const baseScale = scaleMode === 'contain'
      ? Math.min(scaleByWidth, containerHeight / viewport.height)
      : scaleByWidth;

    // Render at device-pixel-ratio × base scale so text is crisp on high-DPI
    // phones. Cap at 2.5x to avoid pathological canvases on "4x" devices that
    // report large DPRs, which murder memory for no perceptible gain.
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const renderScale = baseScale * dpr;
    const sv = page.getViewport({ scale: renderScale });

    const pixelW = Math.round(sv.width);
    const pixelH = Math.round(sv.height);
    const displayW = Math.round(sv.width / dpr);
    const displayH = Math.round(sv.height / dpr);

    canvas.width = pixelW;           // canvas intrinsic resolution (high)
    canvas.height = pixelH;
    canvas.style.width = `${displayW}px`;  // CSS size (display)
    canvas.style.height = `${displayH}px`;
    saveAndResizeOverlay(displayW, displayH);
    onCanvasResizeRef.current?.(displayW, displayH);

    renderTaskRef.current?.cancel();
    renderTaskRef.current = page.render({ canvasContext: canvas.getContext('2d')!, viewport: sv });
    try { await renderTaskRef.current.promise; } catch { /* cancelled */ }
  }, [overlayRef, whiteboardMode, scaleMode, saveAndResizeOverlay]);

  useEffect(() => {
    if (whiteboardMode) {
      renderPage(currentPage);
    } else if (!loading && pdfRef.current) {
      renderPage(currentPage);
    }
  }, [currentPage, loading, renderPage, whiteboardMode]);

  // ── Resize observer ─────────────────────────────────────────────
  const lastObservedSize = useRef({ w: 0, h: 0 });
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w === 0 || (w === lastObservedSize.current.w && h === lastObservedSize.current.h)) return;
      lastObservedSize.current = { w, h };
      // Debounce to prevent resize loops
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => {
        if (whiteboardMode || (!loading && pdfRef.current)) {
          renderPage(currentPage);
        }
      }, 50);
    });
    ro.observe(container);
    return () => { ro.disconnect(); if (resizeTimer.current) clearTimeout(resizeTimer.current); };
  }, [currentPage, loading, renderPage, whiteboardMode]);

  // ── Drawing ──────────────────────────────────────────────────────
  // Uses Pointer Events so the same handler covers mouse, touch, and pen.
  // Mobile students can now swipe to move the laser / draw with a finger —
  // previously (mouse-only) the laser and drawing were invisible on phones.
  const drawing = useRef(false);
  const activePointerId = useRef<number | null>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!overlayRef?.current) return;
    // If we're in an active stroke, only track the pointer that started it
    if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return;
    const pos = getPos(e);

    if (tool === 'laser') {
      const dot = laserDotRef.current;
      if (dot) {
        dot.style.left = `${pos.x - 22}px`;
        dot.style.top = `${pos.y - 22}px`;
        dot.style.display = 'block';
      }
      onDrawMove?.(pos.x, pos.y, 'laser');
      return;
    }

    const ctx = overlayRef.current.getContext('2d')!;
    if (!drawing.current) return;

    if (tool === 'pen') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastPos.current!.x, lastPos.current!.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      onDrawMove?.(pos.x, pos.y, 'pen');
    } else if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = eraserWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastPos.current!.x, lastPos.current!.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      onDrawMove?.(pos.x, pos.y, 'eraser');
    }

    lastPos.current = pos;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === 'pointer' || tool === 'text') return;

    // Capture this pointer so we keep getting move/up events even if the
    // finger leaves the canvas bounds. Crucial on mobile.
    try { (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); } catch { /* older browser */ }
    activePointerId.current = e.pointerId;

    const pos = getPos(e);

    if (tool === 'laser') {
      // Show the laser dot immediately on tap / first touch
      const dot = laserDotRef.current;
      if (dot) {
        dot.style.left = `${pos.x - 22}px`;
        dot.style.top = `${pos.y - 22}px`;
        dot.style.display = 'block';
      }
      onDrawMove?.(pos.x, pos.y, 'laser');
      return;
    }

    drawing.current = true;
    lastPos.current = pos;
    onDrawStart?.(pos.x, pos.y, tool);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return;
    try { (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    activePointerId.current = null;

    if (tool === 'laser') {
      // Hide laser dot when finger lifts on touch. On desktop the mouse still
      // shows it during hover, so only hide the DOM dot — parent decides whether
      // to send LASER_END (it does via onLeave for touch devices).
      if (laserDotRef.current) laserDotRef.current.style.display = 'none';
      onLeave?.('laser');
      return;
    }

    drawing.current = false;
    onDrawEnd?.(tool);
  }

  function onPointerLeave() {
    drawing.current = false;
    if (tool === 'laser' && laserDotRef.current) {
      laserDotRef.current.style.display = 'none';
    }
    onLeave?.(tool);
  }

  function onPointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
    // e.g. OS gesture / scroll taking over. Treat like pointer up.
    onPointerUp(e);
  }

  const cursor =
    tool === 'pointer' ? 'default'
    : tool === 'text'   ? 'text'
    : tool === 'laser'  ? 'none'
    : tool === 'eraser' ? `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${eraserWidth}' height='${eraserWidth}' viewBox='0 0 ${eraserWidth} ${eraserWidth}'><circle cx='${eraserWidth / 2}' cy='${eraserWidth / 2}' r='${eraserWidth / 2 - 1}' fill='none' stroke='white' stroke-width='1.5'/></svg>") ${eraserWidth / 2} ${eraserWidth / 2}, crosshair`
    : 'crosshair';

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-800 text-sm text-gray-400 ${className}`}>
        Failed to load PDF — check the console for details.
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative slide-canvas ${className}`}>
      {loading && !whiteboardMode && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      )}
      <canvas ref={canvasRef} className="block" />
      {overlayRef && (
        <canvas
          ref={overlayRef as React.RefObject<HTMLCanvasElement>}
          className="absolute top-0 left-0"
          // `touchAction: none` disables the browser's scroll/zoom gesture
          // handling on this canvas so finger drags reach our pointer
          // handlers (otherwise phones treat a swipe as a page pan).
          style={{ cursor, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onPointerCancel={onPointerCancel}
        />
      )}
      {/* Laser dot rendered as DOM element to avoid clearing the annotation canvas */}
      <div
        ref={laserDotRef}
        className="pointer-events-none absolute"
        style={{ display: 'none', width: 44, height: 44, zIndex: 20 }}
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
      </div>
    </div>
  );
}
