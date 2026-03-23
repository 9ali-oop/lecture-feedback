import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { api } from '../lib/api.ts';
import type { SlideNote } from '@lecture-feedback/shared';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface SlideViewerModalProps {
  sessionId: string;
  totalSlides: number;
  initialSlide: number;
  annotatedSlides: Set<number>;
  notes: SlideNote[];
  role: 'student' | 'lecturer' | 'admin';
  onClose: () => void;
}

export default function SlideViewerModal({
  sessionId,
  totalSlides,
  initialSlide,
  annotatedSlides,
  notes,
  role,
  onClose,
}: SlideViewerModalProps) {
  const [currentSlide, setCurrentSlide] = useState(initialSlide);
  const [zoom, setZoom] = useState(1);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  const token = localStorage.getItem('token');
  const pdfUrl = api.pdfUrl(sessionId);

  // Load PDF
  useEffect(() => {
    const params: Parameters<typeof pdfjsLib.getDocument>[0] = { url: pdfUrl };
    if (token) params.httpHeaders = { Authorization: `Bearer ${token}` };

    pdfjsLib.getDocument(params).promise.then((doc) => {
      pdfRef.current = doc;
      renderPage(currentSlide);
    });

    return () => { pdfRef.current?.destroy(); };
  }, [pdfUrl]);

  // Render page
  const renderPage = useCallback(async (pageIndex: number) => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!pdf || !canvas || !container) return;

    const pageNum = Math.min(Math.max(pageIndex + 1, 1), pdf.numPages);
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });

    const containerWidth = container.clientWidth - 48;
    const scale = containerWidth / viewport.width;
    const sv = page.getViewport({ scale });

    canvas.width = sv.width;
    canvas.height = sv.height;

    renderTaskRef.current?.cancel();
    renderTaskRef.current = page.render({ canvasContext: canvas.getContext('2d')!, viewport: sv });
    try { await renderTaskRef.current.promise; } catch { /* cancelled */ }
  }, []);

  // Re-render on slide change
  useEffect(() => {
    if (pdfRef.current) renderPage(currentSlide);
  }, [currentSlide, renderPage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentSlide > 0) setCurrentSlide((s) => s - 1);
      if (e.key === 'ArrowRight' && currentSlide < totalSlides - 1) setCurrentSlide((s) => s + 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentSlide, totalSlides, onClose]);

  const currentNotes = notes.filter((n) => n.slideIndex === currentSlide && n.content.trim());

  const annotationUrl = annotatedSlides.has(currentSlide)
    ? `${api.annotationUrl(sessionId, currentSlide)}${token ? `?token=${token}` : ''}`
    : null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await api.downloadReportPdf(sessionId, showAnnotations);
    } finally {
      setDownloading(false);
    }
  };

  const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const zoomReset = () => setZoom(1);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-6 py-3">
        <button
          onClick={onClose}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Close
        </button>
        <span className="text-sm font-medium text-gray-300">
          Slide {currentSlide + 1} of {totalSlides}
        </span>
        <div className="w-20" />
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Slide area */}
        <div ref={containerRef} className="flex flex-1 flex-col overflow-auto p-6">
          <div
            className="relative mx-auto"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
          >
            <canvas ref={canvasRef} className="block rounded-lg shadow-2xl" />
            {showAnnotations && annotationUrl && (
              <img
                src={annotationUrl}
                alt="Annotations"
                className="absolute inset-0 h-full w-full rounded-lg"
                style={{ pointerEvents: 'none' }}
              />
            )}
          </div>
        </div>

        {/* Notes panel */}
        <div className="flex w-80 shrink-0 flex-col border-l border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-5 py-3">
            <h3 className="text-sm font-semibold text-gray-200">
              {role === 'student' ? 'My Notes' : 'Student Notes'}
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {currentNotes.length === 0 ? (
              <p className="text-xs text-gray-600">No notes for this slide</p>
            ) : (
              <ul className="space-y-3">
                {currentNotes.map((note) => (
                  <li key={note.id} className="rounded-lg bg-gray-800 px-3 py-2">
                    <p className="text-sm text-gray-200">{note.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="flex shrink-0 items-center justify-center gap-4 border-t border-gray-800 bg-gray-900 py-3 px-6">
        {/* Navigation */}
        <button
          onClick={() => setCurrentSlide((s) => Math.max(0, s - 1))}
          disabled={currentSlide === 0}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-800 hover:text-gray-100 disabled:opacity-25"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span className="min-w-[72px] text-center text-sm font-mono text-gray-500">
          {currentSlide + 1} / {totalSlides}
        </span>

        <button
          onClick={() => setCurrentSlide((s) => Math.min(totalSlides - 1, s + 1))}
          disabled={currentSlide >= totalSlides - 1}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-800 hover:text-gray-100 disabled:opacity-25"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <div className="mx-2 h-5 w-px bg-gray-700" />

        {/* Zoom controls */}
        <button onClick={zoomOut} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-800 hover:text-gray-100" title="Zoom out">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>

        <button onClick={zoomIn} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-800 hover:text-gray-100" title="Zoom in">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <button onClick={zoomReset} className="rounded-lg px-2 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-100" title="Reset zoom">
          Reset
        </button>

        <div className="mx-2 h-5 w-px bg-gray-700" />

        {/* Annotation toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showAnnotations}
            onChange={(e) => setShowAnnotations(e.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
          />
          <span className="text-xs text-gray-400">Show Annotations</span>
        </label>

        <div className="mx-2 h-5 w-px bg-gray-700" />

        {/* Download */}
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {downloading ? (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
          Download PDF
        </button>
      </div>
    </div>
  );
}
