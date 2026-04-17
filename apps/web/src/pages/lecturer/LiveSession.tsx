import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PdfViewer, { type DrawTool } from '../../components/PdfViewer.tsx';
import TextBox, { type TextBoxData } from '../../components/TextBox.tsx';
import FeedbackPieChart from '../../components/FeedbackPieChart.tsx';
import EngagementGauge from '../../components/EngagementGauge.tsx';
import { SessionSocket } from '../../lib/ws.ts';
import { useAnnotationSync } from '../../hooks/useAnnotationSync.ts';
import { useAnnotationAccessManager } from '../../hooks/useAnnotationAccessManager.ts';
import { useStudentAnnotationReceiver } from '../../hooks/useStudentAnnotationReceiver.ts';
import StudentAnnotationOverlay from '../../components/StudentAnnotationOverlay.tsx';
import JoinQrOverlay from '../../components/JoinQrOverlay.tsx';
import { api } from '../../lib/api.ts';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import type { FeedbackDistribution, Question, Session, ConfusionHighlight, PaceDistribution, Poll, PollResults } from '@lecture-feedback/shared';

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconPointer() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.5 3.88l4.432 14.382.925-4.26 4.935 4.934 1.414-1.414-4.935-4.935 4.26-.925L4.5 3.88z" />
    </svg>
  );
}

function IconPen() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function IconLaser() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="19.07" y1="4.93" x2="16.24" y2="7.76" />
      <line x1="7.76" y1="16.24" x2="4.93" y2="19.07" />
    </svg>
  );
}

function IconEraser() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20H7L3 16l9.293-9.293a1 1 0 011.414 0L20 13.293a1 1 0 010 1.414L14.414 20" />
      <path d="M6.5 17.5l4-4" />
    </svg>
  );
}

function IconText() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function IconWhiteboard() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function IconChevronFirst() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="11 17 6 12 11 7" />
      <line x1="18" y1="7" x2="18" y2="17" />
    </svg>
  );
}

function IconChevronLast() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 17 18 12 13 7" />
      <line x1="6" y1="7" x2="6" y2="17" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ── Config constants ─────────────────────────────────────────────────────────

const PEN_COLORS = [
  { value: '#e11d48', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#16a34a', label: 'Green' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#ffffff', label: 'White' },
];

const PEN_WIDTHS = [
  { value: 2,  label: 'Thin' },
  { value: 5,  label: 'Medium' },
  { value: 10, label: 'Thick' },
];

const ERASER_SIZES = [
  { value: 16, label: 'S' },
  { value: 32, label: 'M' },
  { value: 56, label: 'L' },
];

const FONT_FAMILIES = [
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times' },
  { value: '"Courier New", monospace', label: 'Courier' },
  { value: '"Comic Sans MS", cursive', label: 'Comic Sans' },
  { value: 'system-ui, sans-serif', label: 'System' },
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

// ── Layer data per slide ────────────────────────────────────────────────────

interface SlideLayerData {
  canvasDataUrl: string | null;
  textBoxes: TextBoxData[];
}

function emptyLayer(): SlideLayerData {
  return { canvasDataUrl: null, textBoxes: [] };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LiveSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const token = localStorage.getItem('token')!;
  const { resolved: theme, toggle: toggleTheme } = useTheme();

  const [session, setSession] = useState<Session | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [currentSlide, setCurrentSlide] = useState(0);
  const currentSlideRef = useRef(0);
  const [totalSlides, setTotalSlides] = useState(0);

  // Drawing state
  const [tool, setTool] = useState<DrawTool>('pointer');
  const [penColor, setPenColor] = useState('#e11d48');
  const [penWidth, setPenWidth] = useState(5);
  const [eraserWidth, setEraserWidth] = useState(32);

  // Whiteboard mode
  const [whiteboardMode, setWhiteboardMode] = useState(false);

  // Text tool state
  const [fontFamily, setFontFamily] = useState(FONT_FAMILIES[0].value);
  const [fontSize, setFontSize] = useState(20);
  const [textColor, setTextColor] = useState('#000000');
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);

  // Canvas dimensions (updated via onCanvasResize callback)
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 506 });
  const handleCanvasResize = useCallback((w: number, h: number) => {
    setCanvasSize((prev) => prev.width === w && prev.height === h ? prev : { width: w, height: h });
  }, []);

  // Per-slide layer data: key = `${slideIndex}-${'slide'|'wb'}`
  const layerDataRef = useRef(new Map<string, SlideLayerData>());

  // Current text boxes (for the active slide + mode)
  const [textBoxes, setTextBoxes] = useState<TextBoxData[]>([]);

  // Feedback / comms
  const [distribution, setDistribution] = useState<FeedbackDistribution>({
    got_it: 0, neutral: 0, confused: 0, lost: 0, total: 0,
  });
  const [participants, setParticipants] = useState({ active: 0, total: 0 });
  const [engagementScore, setEngagementScore] = useState<number | null>(null);
  const [engagementSignals, setEngagementSignals] = useState<import('@lecture-feedback/shared').EngagementSignals | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [showQuestions, setShowQuestions] = useState(false);
  const [showPanel, setShowPanel] = useState(() => window.innerWidth > 900);
  const [showToolbar, setShowToolbar] = useState(true);
  const [ended, setEnded] = useState(false);

  // Pace
  const [paceDistribution, setPaceDistribution] = useState<PaceDistribution>({ slow: 0, ok: 0, fast: 0, total: 0 });

  // Join QR modal
  const [showJoinQr, setShowJoinQr] = useState(false);

  // Polls
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [activePollResults, setActivePollResults] = useState<PollResults | null>(null);
  const [activePollId, setActivePollId] = useState<string | null>(null);

  // Student laser state (from granted annotator)
  const [studentLaser, setStudentLaser] = useState<{ x: number; y: number; visible: boolean; paused: boolean; slideIndex: number }>({
    x: 0, y: 0, visible: false, paused: false, slideIndex: -1,
  });
  const [studentLaserRingPhase, setStudentLaserRingPhase] = useState(0);
  const studentLaserAnimRef = useRef<number | null>(null);

  // Confusion areas (ephemeral, per-slide, from student submissions)
  const confusionAreasRef = useRef(new Map<number, { highlight: ConfusionHighlight; emoji: 'confused' | 'lost' }[]>());
  const [confusionCount, setConfusionCount] = useState(0); // count for current slide
  const [showConfusion, setShowConfusion] = useState(false);
  const [confusionAreas, setConfusionAreas] = useState<{ highlight: ConfusionHighlight; emoji: 'confused' | 'lost' }[]>([]);

  const overlayRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<SessionSocket | null>(null);
  const [socketReady, setSocketReady] = useState(false);

  // Pulsing ring animation for student laser dwell
  useEffect(() => {
    if (!studentLaser.paused) {
      setStudentLaserRingPhase(0);
      if (studentLaserAnimRef.current) {
        cancelAnimationFrame(studentLaserAnimRef.current);
        studentLaserAnimRef.current = null;
      }
      return;
    }
    const animate = () => {
      setStudentLaserRingPhase((p) => (p + 0.05) % (Math.PI * 2));
      studentLaserAnimRef.current = requestAnimationFrame(animate);
    };
    studentLaserAnimRef.current = requestAnimationFrame(animate);
    return () => {
      if (studentLaserAnimRef.current) cancelAnimationFrame(studentLaserAnimRef.current);
    };
  }, [studentLaser.paused]);

  const annotationSync = useAnnotationSync({
    socket: socketReady ? socketRef.current : null,
    slideIndex: currentSlide,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
  });

  const annotationAccessManager = useAnnotationAccessManager(socketReady ? socketRef.current : null);
  const studentAnnotationReceiver = useStudentAnnotationReceiver(socketReady ? socketRef.current : null);

  // Send LASER_END when switching away from the laser tool
  const prevToolRef = useRef<DrawTool>(tool);
  useEffect(() => {
    if (prevToolRef.current === 'laser' && tool !== 'laser') {
      annotationSync.sendLaserEnd();
      annotationSync.sendCursorHide();
    }
    prevToolRef.current = tool;
  }, [tool, annotationSync]);

  const slideAreaRef = useRef<HTMLDivElement>(null);

  // ── Layer key helper ──────────────────────────────────────────────
  const layerKey = useCallback((slide: number, wb: boolean) =>
    `${slide}-${wb ? 'wb' : 'slide'}`, []);

  // ── Save current overlay canvas + text boxes to layer map ─────────
  const saveCurrentLayer = useCallback(() => {
    const key = layerKey(currentSlide, whiteboardMode);
    const overlay = overlayRef.current;
    const dataUrl = overlay ? overlay.toDataURL() : null;
    layerDataRef.current.set(key, { canvasDataUrl: dataUrl, textBoxes: [...textBoxes] });
  }, [currentSlide, whiteboardMode, textBoxes, layerKey]);

  // ── Restore overlay canvas + text boxes from layer map ────────────
  const restoreLayer = useCallback((slide: number, wb: boolean) => {
    const key = layerKey(slide, wb);
    const data = layerDataRef.current.get(key) ?? emptyLayer();
    setTextBoxes(data.textBoxes);

    // Restore canvas after a frame to allow PdfViewer to set canvas dimensions
    requestAnimationFrame(() => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d')!;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      if (data.canvasDataUrl) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, overlay.width, overlay.height);
        img.src = data.canvasDataUrl;
      }
    });
  }, [layerKey]);

  // ── Initial data load ─────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    api.listQuestions(sessionId).then(setQuestions);
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setCurrentSlide(s.currentSlideIndex);
      currentSlideRef.current = s.currentSlideIndex;
      setTotalSlides(s.totalSlides);
    });
  }, [sessionId]);

  // ── Elapsed timer ────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.startedAt) return;
    const start = new Date(session.startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.startedAt]);

  // ── WebSocket ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !token) return;
    const socket = new SessionSocket(sessionId, token);
    socketRef.current = socket;
    const unsub = socket.onMessage((msg) => {
      if (msg.type === 'FEEDBACK_UPDATE')  setDistribution(msg.distribution);
      if (msg.type === 'ENGAGEMENT_UPDATE') { setEngagementScore(msg.score); setEngagementSignals(msg.signals); }
      if (msg.type === 'PARTICIPANT_COUNT') setParticipants({ active: msg.active, total: msg.total });
      if (msg.type === 'NEW_QUESTION')      setQuestions((prev) => [msg.question, ...prev]);
      if (msg.type === 'QUESTION_ANSWERED')
        setQuestions((prev) => prev.map((q) => q.id === msg.questionId ? { ...q, answered: true } : q));
      if (msg.type === 'CONFUSION_AREA') {
        const areas = confusionAreasRef.current;
        if (!areas.has(msg.slideIndex)) areas.set(msg.slideIndex, []);
        areas.get(msg.slideIndex)!.push({ highlight: msg.highlight, emoji: msg.emoji });
        // Only update display state if the confusion is for the current slide
        if (msg.slideIndex === currentSlideRef.current) {
          setConfusionCount(areas.get(msg.slideIndex)?.length ?? 0);
          setConfusionAreas([...(areas.get(msg.slideIndex) ?? [])]);
        }
      }
      if (msg.type === 'PACE_UPDATE') setPaceDistribution(msg.distribution);
      if (msg.type === 'POLL_RESULTS') setActivePollResults(msg.results);
      if (msg.type === 'POLL_CLOSED') setActivePollResults(msg.results);
      if (msg.type === 'QUESTION_UPVOTED')
        setQuestions((prev) => prev.map((q) => q.id === msg.questionId ? { ...q, upvoteCount: msg.upvoteCount } : q));
      if (msg.type === 'LASER_MOVE')
        setStudentLaser({ visible: true, x: msg.x, y: msg.y, paused: false, slideIndex: msg.slideIndex });
      if (msg.type === 'LASER_PAUSE')
        setStudentLaser({ visible: true, x: msg.x, y: msg.y, paused: true, slideIndex: msg.slideIndex });
      if (msg.type === 'LASER_END')
        setStudentLaser({ visible: false, x: 0, y: 0, paused: false, slideIndex: -1 });
      if (msg.type === 'SESSION_ENDED') setEnded(true);
    });
    socket.connect();
    setSocketReady(true);
    return () => { setSocketReady(false); unsub(); socket.disconnect(); };
  }, [sessionId, token]);

  // ── Slide navigation ──────────────────────────────────────────────
  const goToSlide = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, totalSlides - 1));
    saveCurrentLayer();
    setCurrentSlide(clamped);
    currentSlideRef.current = clamped;
    // Restore will happen after render via effect below
    socketRef.current?.send({ type: 'SLIDE_CHANGE', slideIndex: clamped });
  }, [totalSlides, saveCurrentLayer]);

  // Restore layer when slide or mode changes
  useEffect(() => {
    restoreLayer(currentSlide, whiteboardMode);
    // Update confusion areas for the new slide
    const areas = confusionAreasRef.current.get(currentSlide) ?? [];
    setConfusionAreas([...areas]);
    setConfusionCount(areas.length);
  }, [currentSlide, whiteboardMode, restoreLayer]);

  // Sync text boxes to students whenever they change
  useEffect(() => {
    if (!socketRef.current) return;
    socketRef.current.send({
      type: 'TEXT_BOX_SYNC',
      slideIndex: currentSlide,
      textBoxes: textBoxes.map(({ id, x, y, width, height, content, fontFamily, fontSize, color }) => ({
        id, x, y, width, height, content, fontFamily, fontSize, color,
      })),
    });
  }, [textBoxes, currentSlide]);

  // Save + restore when toggling whiteboard mode
  const toggleWhiteboard = useCallback(() => {
    saveCurrentLayer();
    setWhiteboardMode((prev) => {
      const next = !prev;
      socketRef.current?.send({ type: 'WHITEBOARD_TOGGLE', enabled: next });
      return next;
    });
  }, [saveCurrentLayer]);

  function handleTotalPages(total: number) {
    setTotalSlides(total);
    if (sessionId) api.updateTotalSlides(sessionId, total);
  }

  // ── Compositing helper: render canvas + text boxes to a single image ──
  const compositeWhiteboard = useCallback(async (slide: number): Promise<string | null> => {
    const key = layerKey(slide, true);
    const data = layerDataRef.current.get(key);
    if (!data?.canvasDataUrl && data?.textBoxes.length === 0) return null;
    if (!data) return null;

    const canvas = document.createElement('canvas');
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext('2d')!;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw the overlay strokes
    if (data.canvasDataUrl) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(); };
        img.onerror = () => resolve();
        img.src = data.canvasDataUrl!;
      });
    }

    // Draw text boxes
    for (const tb of data.textBoxes) {
      ctx.font = `${tb.fontSize}px ${tb.fontFamily}`;
      ctx.fillStyle = tb.color;
      ctx.textBaseline = 'top';
      const x = tb.x * canvas.width + 4;
      const y = tb.y * canvas.height + 4;
      const maxW = tb.width * canvas.width - 8;
      // Simple word-wrap
      const words = tb.content.split(' ');
      let line = '';
      let lineY = y;
      const lineHeight = tb.fontSize * 1.3;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) {
          ctx.fillText(line, x, lineY);
          line = word;
          lineY += lineHeight;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, x, lineY);
    }

    return canvas.toDataURL('image/png');
  }, [layerKey, canvasSize]);

  // ── End session ───────────────────────────────────────────────────
  async function handleEnd() {
    if (!confirm('End this session? Students will be disconnected.')) return;

    try {
      // Save current layer first
      saveCurrentLayer();

      // Try to save whiteboards and annotations (non-blocking)
      try {
        const whiteboards: { slideIndex: number; imageData: string }[] = [];
        const annotations: { slideIndex: number; imageData: string }[] = [];
        for (let i = 0; i < totalSlides; i++) {
          const wbImg = await compositeWhiteboard(i);
          if (wbImg) whiteboards.push({ slideIndex: i, imageData: wbImg });
          // Also save slide annotations (pen drawings on slides)
          const slideKey = layerKey(i, false);
          const slideData = layerDataRef.current.get(slideKey);
          if (slideData?.canvasDataUrl) {
            annotations.push({ slideIndex: i, imageData: slideData.canvasDataUrl });
          }
        }
        if (whiteboards.length > 0 && sessionId) {
          await api.saveWhiteboards(sessionId, whiteboards);
        }
        if (annotations.length > 0 && sessionId) {
          await api.saveAnnotations(sessionId, annotations);
        }
      } catch {
        // Save failed - continue ending session anyway
      }

      // End the session via API
      if (sessionId) await api.endSession(sessionId);
    } catch {
      // API call failed - try ending via WebSocket as fallback
      socketRef.current?.send({ type: 'SESSION_END' });
      await new Promise(r => setTimeout(r, 500));
    }

    // Always navigate to report
    navigate(`/lecturer/report/${sessionId}`);
  }

  async function handleLaunchPoll() {
    if (!sessionId || !pollQuestion.trim() || pollOptions.filter((o) => o.trim()).length < 2) return;
    const poll = await api.createPoll(sessionId, {
      question: pollQuestion.trim(),
      options: pollOptions.filter((o) => o.trim()),
      slideIndex: currentSlide,
    });
    setActivePollId(poll.id);
    setShowPollCreator(false);
    setPollQuestion('');
    setPollOptions(['', '']);
  }

  async function handleClosePoll() {
    if (!activePollId) return;
    await api.closePoll(activePollId);
    setActivePollId(null);
  }

  async function handleAnswerQuestion(questionId: string) {
    await api.answerQuestion(questionId);
    setQuestions((prev) => prev.map((q) => q.id === questionId ? { ...q, answered: true } : q));
  }

  function clearAnnotations() {
    const c = overlayRef.current;
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setTextBoxes([]);
    annotationSync.sendClear();
  }

  // ── Text box creation on canvas click ─────────────────────────────
  const handleSlideAreaClick = useCallback((e: React.MouseEvent) => {
    if (tool !== 'text') {
      setSelectedTextBoxId(null);
      return;
    }

    // Only create if clicking on the canvas area itself, not on a text box
    const target = e.target as HTMLElement;
    if (target.closest('[data-textbox]')) return;

    const rect = slideAreaRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.clientX - rect.left) / canvasSize.width;
    const y = (e.clientY - rect.top) / canvasSize.height;

    const newBox: TextBoxData = {
      id: crypto.randomUUID(),
      x: Math.max(0, Math.min(x, 0.85)),
      y: Math.max(0, Math.min(y, 0.85)),
      width: 0.2,
      height: 0.08,
      content: '',
      fontFamily,
      fontSize,
      color: textColor,
    };

    setTextBoxes((prev) => [...prev, newBox]);
    setSelectedTextBoxId(newBox.id);
  }, [tool, canvasSize, fontFamily, fontSize, textColor, whiteboardMode]);

  const updateTextBox = useCallback((id: string, patch: Partial<TextBoxData>) => {
    setTextBoxes((prev) => prev.map((tb) => tb.id === id ? { ...tb, ...patch } : tb));
  }, []);

  const deleteTextBox = useCallback((id: string) => {
    setTextBoxes((prev) => prev.filter((tb) => tb.id !== id));
    if (selectedTextBoxId === id) setSelectedTextBoxId(null);
  }, [selectedTextBoxId]);

  const unansweredCount = questions.filter((q) => !q.answered).length;

  // Tool button style helper
  const toolBtn = (id: DrawTool) =>
    `flex items-center justify-center rounded-lg w-9 h-9 transition-all ${
      tool === id
        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/60 hover:text-gray-800 dark:hover:text-gray-100'
    }`;

  const wbToggleClass = whiteboardMode
    ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/40'
    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/60 hover:text-gray-800 dark:hover:text-gray-100';

  // Keyboard shortcuts: focus mode (F), slide navigation (arrows), Home/End
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'f' || e.key === 'F') {
        setFocusMode((v) => {
          if (!v) setShowPanel(false);
          else setShowPanel(true);
          return !v;
        });
      }
      if (e.key === 'Escape' && focusMode) {
        setFocusMode(false);
        setShowPanel(true);
      }
      // Slide navigation
      if (!whiteboardMode) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
          e.preventDefault();
          goToSlide(currentSlideRef.current + 1);
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          goToSlide(currentSlideRef.current - 1);
        }
        if (e.key === 'Home') { e.preventDefault(); goToSlide(0); }
        if (e.key === 'End') { e.preventDefault(); goToSlide(totalSlides - 1); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusMode, goToSlide, whiteboardMode, totalSlides]);

  // ── Ended screen (must be after all hooks) ───────────────────────
  if (ended) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-600/20 ring-1 ring-green-300 dark:ring-green-500/30">
            <svg className="h-7 w-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-xl font-semibold text-gray-800 dark:text-gray-100">Session ended</p>
          <p className="mt-1 text-sm text-gray-500">All feedback has been saved</p>
          <button onClick={() => navigate(`/lecturer/report/${sessionId}`)}
            className="mt-6 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700">
            View report
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-100 dark:bg-gray-950 outline-none" tabIndex={-1} ref={(el) => { if (el && !el.dataset.focused) { el.focus(); el.dataset.focused = '1'; } }}>

      {/* ── Top bar ── */}
      <div className={`shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ${focusMode ? 'h-0 overflow-hidden border-b-0' : ''}`}>
        {/* Row 1: session info + action buttons */}
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            {session?.status === 'live' ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-100 dark:bg-green-950 px-2.5 py-1 text-xs font-semibold text-green-700 dark:text-green-400 ring-1 ring-green-300 dark:ring-green-800">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                Live
              </span>
            ) : session?.status === 'ended' ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-gray-700">
                Ended
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-gray-700">
                Scheduled
              </span>
            )}
            <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{session?.title}</span>
            {whiteboardMode && (
              <span className="rounded-full bg-amber-100 dark:bg-amber-800/50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700">
                Whiteboard
              </span>
            )}
            <span className="font-mono text-xs text-gray-500 dark:text-gray-400 tabular-nums">
              {Math.floor(elapsed / 3600) > 0 && `${Math.floor(elapsed / 3600)}:`}
              {String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{participants.active} active</span>
            {engagementScore !== null && (
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tabular-nums text-white ${
                engagementScore >= 75 ? 'bg-emerald-600' :
                engagementScore >= 50 ? 'bg-blue-600' :
                engagementScore >= 30 ? 'bg-amber-600' :
                'bg-red-600'
              }`} title="Engagement score">
                {engagementScore}
              </span>
            )}
            {distribution.total > 0 && (
              <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 ring-1 ring-gray-300 dark:ring-gray-700">
                {distribution.total} rated
              </span>
            )}
            {paceDistribution.total > 0 && (
              <div className="flex h-5 w-16 items-center gap-px rounded-full bg-gray-200 dark:bg-gray-800 px-1 ring-1 ring-gray-300 dark:ring-gray-700" title={`Pace: ${paceDistribution.slow} slow, ${paceDistribution.ok} ok, ${paceDistribution.fast} fast`}>
                {(['slow', 'ok', 'fast'] as const).map((k) => {
                  const pct = (paceDistribution[k] / paceDistribution.total) * 100;
                  const bg = k === 'slow' ? 'bg-orange-500' : k === 'ok' ? 'bg-green-500' : 'bg-red-500';
                  return pct > 0 ? <div key={k} className={`h-3 rounded-full ${bg}`} style={{ width: `${pct}%` }} /> : null;
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {/* Annotation access indicator */}
            {annotationAccessManager.grantedStudent && (
              <div className="flex items-center gap-1.5 rounded-lg bg-green-100 dark:bg-green-900/50 px-2.5 py-1.5 ring-1 ring-green-300 dark:ring-green-700">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 dark:bg-green-400 animate-pulse" />
                <span className="text-xs text-green-700 dark:text-green-300">{annotationAccessManager.grantedStudent.name}</span>
                <button onClick={() => annotationAccessManager.revokeAccess()}
                  className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-red-500 dark:text-red-400 transition hover:bg-red-100 dark:hover:bg-red-900/50 hover:text-red-700 dark:hover:text-red-300">Revoke</button>
              </div>
            )}
            {annotationAccessManager.queue.length > 0 && (
              // Always surface the pending queue — even while another student
              // currently has the pen. Granting a new request hands the pen
              // over (server revokes the previous grantee); dismissing clears
              // the notification. Previously the block was hidden whenever
              // `grantedStudent` was set, which silently stranded the second
              // / third student in "pending" forever.
              <div className="flex items-center gap-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1.5 ring-1 ring-amber-300 dark:ring-amber-700">
                <span className="text-xs text-amber-700 dark:text-amber-300 max-w-[300px]" title={annotationAccessManager.queue[0].reason}>
                  <span className="font-medium">{annotationAccessManager.queue[0].studentName}</span>{': '}{annotationAccessManager.queue[0].reason}
                </span>
                <button onClick={() => annotationAccessManager.grantAccess(annotationAccessManager.queue[0].studentId)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 transition hover:bg-green-100 dark:hover:bg-green-900/50"
                  title={annotationAccessManager.grantedStudent ? `Hand the pen from ${annotationAccessManager.grantedStudent.name} to ${annotationAccessManager.queue[0].studentName}` : 'Grant the pen'}>
                  {annotationAccessManager.grantedStudent ? 'Hand over' : 'Grant'}
                </button>
                <button onClick={() => annotationAccessManager.dismissRequest(annotationAccessManager.queue[0].studentId)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300">Dismiss</button>
                {annotationAccessManager.queue.length > 1 && (
                  <span className="rounded-full bg-amber-200 dark:bg-amber-700 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:text-amber-200" title={`${annotationAccessManager.queue.length - 1} more pending`}>+{annotationAccessManager.queue.length - 1}</span>
                )}
              </div>
            )}

            <button
              onClick={() => setShowJoinQr(true)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700"
              title="Show join QR code for students to scan"
            >
              Join QR
            </button>

            {activePollId ? (
              <button onClick={handleClosePoll} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-purple-700">Close poll</button>
            ) : (
              <button onClick={() => setShowPollCreator((v) => !v)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${showPollCreator ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>Poll</button>
            )}

            <div className="relative flex items-center gap-0.5">
              <button onClick={() => setShowConfusion((v) => !v)}
                className={`relative rounded-lg px-3 py-1.5 text-xs font-medium transition ${showConfusion ? 'bg-yellow-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                title="Toggle confusion areas overlay">
                Confusion
                {confusionCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-yellow-500 text-[9px] font-bold text-white">{confusionCount}</span>
                )}
              </button>
              {confusionCount > 0 && (
                <button onClick={() => { confusionAreasRef.current.delete(currentSlide); setConfusionCount(0); setConfusionAreas([]); }}
                  className="ml-0.5 rounded bg-gray-100 dark:bg-gray-800 px-1 py-1 text-[10px] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-white" title="Clear confusion areas for this slide">X</button>
              )}
            </div>

            <button onClick={() => setShowQuestions((v) => !v)}
              className={`relative rounded-lg px-3 py-1.5 text-xs font-medium transition ${showQuestions ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
              Q&amp;A
              {unansweredCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">{unansweredCount}</span>
              )}
            </button>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="rounded-lg p-1.5 text-gray-500 dark:text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            <button onClick={handleEnd} className="rounded-lg bg-red-700/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600">End session</button>
          </div>
        </div>

        {/* Toolbar toggle */}
        <button
          onClick={() => setShowToolbar((v) => !v)}
          className="flex w-full items-center justify-center border-t border-gray-200 dark:border-gray-800/50 py-0.5 text-gray-400 dark:text-gray-600 transition hover:bg-gray-100 dark:hover:bg-gray-800/50 hover:text-gray-600 dark:hover:text-gray-400"
          title={showToolbar ? 'Hide toolbar' : 'Show toolbar'}
        >
          <svg className={`h-3 w-3 transition-transform ${showToolbar ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>

        {/* Row 2: drawing toolbar */}
        <div className={`flex items-center justify-center gap-2 overflow-x-auto scrollbar-none px-4 transition-all ${showToolbar ? 'py-1.5' : 'h-0 overflow-hidden py-0'}`}>
          {/* Tool buttons */}
          <div className="flex items-center gap-0.5 rounded-xl bg-gray-100 dark:bg-gray-800 p-1 ring-1 ring-gray-300 dark:ring-gray-700 shrink-0">
            <button onClick={() => setTool('pointer')} title="Pointer" className={toolBtn('pointer')}>
              <IconPointer />
            </button>
            <button onClick={() => setTool('pen')} title="Pen" className={toolBtn('pen')}>
              <IconPen />
            </button>
            <button onClick={() => setTool('laser')} title="Laser pointer (hover)" className={toolBtn('laser')}>
              <IconLaser />
            </button>
            <button onClick={() => setTool('eraser')} title="Eraser" className={toolBtn('eraser')}>
              <IconEraser />
            </button>
            <button onClick={() => setTool('text')} title="Text box" className={toolBtn('text')}>
              <IconText />
            </button>

            <div className="mx-1 h-5 w-px bg-gray-300 dark:bg-gray-700" />

            <button onClick={toggleWhiteboard} title="Toggle whiteboard"
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all ${wbToggleClass}`}>
              <IconWhiteboard />
            </button>

            <div className="mx-1 h-5 w-px bg-gray-300 dark:bg-gray-700" />

            <button onClick={clearAnnotations} title="Clear all annotations"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-200 dark:hover:bg-gray-600/60 hover:text-gray-800 dark:hover:text-gray-200">
              <IconTrash />
            </button>
          </div>

          {/* Pen options sub-panel */}
          {tool === 'pen' && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-100 dark:bg-gray-800 px-3 py-2 ring-1 ring-gray-300 dark:ring-gray-700 shrink-0">
              <div className="flex items-center gap-1.5">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setPenColor(c.value)}
                    title={c.label}
                    className="h-5 w-5 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: c.value,
                      outline: penColor === c.value ? `2px solid ${c.value}` : '2px solid transparent',
                      outlineOffset: '2px',
                      boxShadow: c.value === '#ffffff' ? '0 0 0 1px rgba(255,255,255,0.2)' : 'none',
                    }}
                  />
                ))}
              </div>
              <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />
              <div className="flex items-center gap-1.5">
                {PEN_WIDTHS.map((w) => (
                  <button
                    key={w.value}
                    onClick={() => setPenWidth(w.value)}
                    title={w.label}
                    className={`flex h-7 w-9 items-center justify-center rounded-lg transition ${
                      penWidth === w.value ? 'bg-blue-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div
                      className="rounded-full bg-white"
                      style={{ width: `${Math.min(w.value * 2.5, 28)}px`, height: `${Math.min(w.value / 2, 5) + 1}px` }}
                    />
                  </button>
                ))}
              </div>
              <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />
              <div
                className="h-5 w-5 rounded-full ring-2 ring-gray-300 dark:ring-gray-600"
                style={{ background: penColor }}
              />
            </div>
          )}

          {/* Eraser options sub-panel */}
          {tool === 'eraser' && (
            <div className="flex items-center gap-2 rounded-xl bg-gray-100 dark:bg-gray-800 px-3 py-2 ring-1 ring-gray-300 dark:ring-gray-700 shrink-0">
              <span className="text-xs text-gray-500">Size</span>
              {ERASER_SIZES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setEraserWidth(s.value)}
                  title={s.label}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold transition ${
                    eraserWidth === s.value ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <div
                className="rounded-full border-2 border-gray-400"
                style={{ width: eraserWidth / 2, height: eraserWidth / 2 }}
              />
            </div>
          )}

          {/* Text options sub-panel */}
          {tool === 'text' && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-100 dark:bg-gray-800 px-3 py-2 ring-1 ring-gray-300 dark:ring-gray-700 shrink-0">
              {/* Font family */}
              <select
                value={fontFamily}
                onChange={(e) => {
                  setFontFamily(e.target.value);
                  if (selectedTextBoxId) updateTextBox(selectedTextBoxId, { fontFamily: e.target.value });
                }}
                className="h-7 rounded-lg border-0 bg-gray-200 dark:bg-gray-700 px-2 text-xs text-gray-800 dark:text-gray-200 outline-none focus:ring-1 focus:ring-blue-500"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>

              <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />

              {/* Font size */}
              <select
                value={fontSize}
                onChange={(e) => {
                  const sz = parseInt(e.target.value, 10);
                  setFontSize(sz);
                  if (selectedTextBoxId) updateTextBox(selectedTextBoxId, { fontSize: sz });
                }}
                className="h-7 w-16 rounded-lg border-0 bg-gray-200 dark:bg-gray-700 px-2 text-xs text-gray-800 dark:text-gray-200 outline-none focus:ring-1 focus:ring-blue-500"
              >
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>{s}px</option>
                ))}
              </select>

              <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />

              {/* Text colour */}
              <input
                type="color"
                value={textColor}
                onChange={(e) => {
                  setTextColor(e.target.value);
                  if (selectedTextBoxId) updateTextBox(selectedTextBoxId, { color: e.target.value });
                }}
                className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
                title="Text colour"
              />

              <span className="text-[10px] text-gray-500 dark:text-gray-400">Click canvas to add</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Slide area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* In focus mode, the floating toolbar pill + hint sit at the
              bottom of the viewport — reserve ~6rem so the slide doesn't
              render under them. */}
          <div className={`flex flex-1 items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-950 p-6 ${focusMode ? 'pb-24' : ''}`}>
            {session?.hasPdf || whiteboardMode ? (
              <PdfViewer
                url={api.pdfUrl(sessionId!)}
                currentPage={currentSlide}
                onTotalPages={handleTotalPages}
                overlayRef={overlayRef}
                tool={tool}
                penColor={penColor}
                penWidth={penWidth}
                eraserWidth={eraserWidth}
                token={token}
                whiteboardMode={whiteboardMode}
                onCanvasResize={handleCanvasResize}
                canvasAreaRef={slideAreaRef}
                onCanvasAreaClick={handleSlideAreaClick}
                onDrawStart={(x, y, drawTool) => {
                  if (drawTool === 'pen') annotationSync.startDrawBatch(penColor, penWidth);
                  if (drawTool === 'eraser') annotationSync.startEraseBatch(eraserWidth);
                }}
                onDrawMove={(x, y, drawTool) => {
                  if (drawTool === 'pen') annotationSync.addDrawPoint(x, y);
                  if (drawTool === 'eraser') annotationSync.addErasePoint(x, y);
                  if (drawTool === 'laser') annotationSync.sendLaserMove(x, y);
                  if (drawTool !== 'pointer' && drawTool !== 'text') annotationSync.sendCursorPosition(x, y, drawTool);
                }}
                onDrawEnd={(drawTool) => {
                  if (drawTool === 'pen') annotationSync.endDrawBatch();
                  if (drawTool === 'eraser') annotationSync.endEraseBatch();
                  annotationSync.sendCursorHide();
                }}
                onLeave={(drawTool) => {
                  if (drawTool === 'pen') annotationSync.endDrawBatch();
                  if (drawTool === 'eraser') annotationSync.endEraseBatch();
                  if (drawTool === 'laser') annotationSync.sendLaserEnd();
                  annotationSync.sendCursorHide();
                }}
                className="rounded-lg overflow-hidden shadow-2xl"
              >
                {/* Text boxes layer */}
                {textBoxes.map((tb) => (
                  <div key={tb.id} data-textbox>
                    <TextBox
                      data={tb}
                      containerWidth={canvasSize.width}
                      containerHeight={canvasSize.height}
                      selected={selectedTextBoxId === tb.id}
                      onSelect={() => setSelectedTextBoxId(tb.id)}
                      onUpdate={(patch) => updateTextBox(tb.id, patch)}
                      onDelete={() => deleteTextBox(tb.id)}
                    />
                  </div>
                ))}

                {/* Confusion areas overlay (ephemeral, toggle-able) */}
                {showConfusion && confusionAreas.map((ca, i) => {
                  const hl = ca.highlight;
                  const isLost = ca.emoji === 'lost';
                  const borderColor = isLost ? 'rgba(239, 68, 68, 0.8)' : 'rgba(234, 179, 8, 0.8)';
                  const bgColor = isLost ? 'rgba(239, 68, 68, 0.12)' : 'rgba(234, 179, 8, 0.12)';
                  const style: React.CSSProperties = hl.shape === 'rect'
                    ? {
                        position: 'absolute',
                        left: `${hl.x * 100}%`, top: `${hl.y * 100}%`,
                        width: `${hl.width * 100}%`, height: `${hl.height * 100}%`,
                        border: `2px solid ${borderColor}`, background: bgColor,
                        borderRadius: '4px', pointerEvents: 'none', zIndex: 15,
                      }
                    : {
                        position: 'absolute',
                        left: `${(hl.x - hl.width) * 100}%`, top: `${(hl.y - hl.height) * 100}%`,
                        width: `${hl.width * 2 * 100}%`, height: `${hl.height * 2 * 100}%`,
                        border: `2px solid ${borderColor}`, background: bgColor,
                        borderRadius: '50%', pointerEvents: 'none', zIndex: 15,
                      };
                  return <div key={i} style={style} />;
                })}

                {/* Student annotation overlay */}
                <StudentAnnotationOverlay
                  canvasWidth={canvasSize.width}
                  canvasHeight={canvasSize.height}
                  incomingStroke={studentAnnotationReceiver.incomingStroke}
                  clearTrigger={studentAnnotationReceiver.clearTrigger}
                />

                {/* Student laser pointer overlay */}
                {studentLaser.visible && studentLaser.slideIndex === currentSlide && (() => {
                  const lx = studentLaser.x * canvasSize.width;
                  const ly = studentLaser.y * canvasSize.height;
                  const ringScale = studentLaser.paused ? 1 + 0.3 * Math.sin(studentLaserRingPhase) : 0;
                  return (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: lx - 22,
                        top: ly - 22,
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
                      {studentLaser.paused && (
                        <div
                          className="absolute rounded-full border-2 border-red-400"
                          style={{
                            left: 22 - 18 * (1 + ringScale) / 2,
                            top: 22 - 18 * (1 + ringScale) / 2,
                            width: 18 * (1 + ringScale),
                            height: 18 * (1 + ringScale),
                            opacity: 0.6 + 0.4 * Math.sin(studentLaserRingPhase),
                            transition: 'width 0.1s, height 0.1s',
                          }}
                        />
                      )}
                    </div>
                  );
                })()}
              </PdfViewer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
                No slides uploaded
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className={`flex shrink-0 items-center justify-center gap-2 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ${focusMode ? 'h-0 overflow-hidden border-t-0 py-0' : 'py-3'}`}>
            <button onClick={() => goToSlide(0)} disabled={whiteboardMode || currentSlide === 0}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-25">
              <IconChevronFirst />
            </button>
            <button onClick={() => goToSlide(currentSlide - 1)} disabled={whiteboardMode || currentSlide === 0}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-100 disabled:opacity-25">
              <IconChevronLeft />
            </button>
            <span className="min-w-[72px] text-center text-sm font-mono text-gray-500">
              {whiteboardMode ? 'Whiteboard' : `${currentSlide + 1} / ${totalSlides || '—'}`}
            </span>
            <button onClick={() => goToSlide(currentSlide + 1)} disabled={whiteboardMode || currentSlide >= totalSlides - 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-100 disabled:opacity-25">
              <IconChevronRight />
            </button>
            <button onClick={() => goToSlide(totalSlides - 1)} disabled={whiteboardMode || currentSlide >= totalSlides - 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-25">
              <IconChevronLast />
            </button>
          </div>
        </div>

        {/* Panel toggle */}
        <button
          onClick={() => setShowPanel((v) => !v)}
          className="flex shrink-0 w-5 items-center justify-center border-l border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600 transition hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-400"
          title={showPanel ? 'Hide panel' : 'Show panel'}
        >
          <svg className={`h-3.5 w-3.5 transition-transform ${showPanel ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Right panel */}
        <div className={`flex shrink-0 flex-col border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden ${showPanel ? 'w-72' : 'w-0 border-l-0'}`}>
          {showQuestions ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-4 py-3">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  Questions
                  {unansweredCount > 0 && (
                    <span className="ml-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {unansweredCount}
                    </span>
                  )}
                </h3>
                <button onClick={() => setShowQuestions(false)}
                  className="rounded p-1 text-gray-400 dark:text-gray-600 transition hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {questions.length === 0 && (
                  <p className="pt-10 text-center text-xs text-gray-400 dark:text-gray-600">No questions yet</p>
                )}
                {[...questions].sort((a, b) => (b.upvoteCount ?? 0) - (a.upvoteCount ?? 0)).map((q) => (
                  <div key={q.id}
                    className={`rounded-xl p-3 ${q.answered ? 'opacity-40' : 'bg-gray-100 dark:bg-gray-800'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-[11px] font-medium text-gray-500">{q.studentName}</p>
                        <p className="mt-1 text-sm text-gray-800 dark:text-gray-100">{q.content}</p>
                      </div>
                      {(q.upvoteCount ?? 0) > 0 && (
                        <span className="shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-300">
                          ▲ {q.upvoteCount}
                        </span>
                      )}
                    </div>
                    {!q.answered && (
                      <button onClick={() => handleAnswerQuestion(q.id)}
                        className="mt-2 rounded-lg bg-blue-600 dark:bg-blue-700/70 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-700 dark:hover:bg-blue-600">
                        Mark answered
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : showPollCreator ? (
            /* Poll creator */
            <div className="flex flex-col overflow-hidden p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Create poll</h3>
                <button onClick={() => setShowPollCreator(false)} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">✕</button>
              </div>
              <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)}
                placeholder="Question…" maxLength={500}
                className="rounded-lg border-0 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 outline-none ring-1 ring-gray-300 dark:ring-gray-700 focus:ring-blue-500" />
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 font-mono">{String.fromCharCode(65 + i)}.</span>
                  <input value={opt} onChange={(e) => {
                    const next = [...pollOptions];
                    next[i] = e.target.value;
                    setPollOptions(next);
                  }} placeholder={`Option ${i + 1}`}
                    className="flex-1 rounded-lg border-0 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 outline-none ring-1 ring-gray-300 dark:ring-gray-700 focus:ring-blue-500" />
                </div>
              ))}
              {pollOptions.length < 6 && (
                <button onClick={() => setPollOptions([...pollOptions, ''])}
                  className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300">+ Add option</button>
              )}
              <button onClick={handleLaunchPoll}
                disabled={!pollQuestion.trim() || pollOptions.filter((o) => o.trim()).length < 2}
                className="rounded-lg bg-purple-600 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-40">
                Launch poll
              </button>
            </div>
          ) : activePollResults ? (
            /* Live poll results */
            <div className="flex flex-col overflow-hidden p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Poll results</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">{activePollResults.question}</p>
              {activePollResults.options.map((opt, i) => {
                const pct = activePollResults.totalResponses > 0 ? Math.round((activePollResults.counts[i] / activePollResults.totalResponses) * 100) : 0;
                return (
                  <div key={i} className="relative overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2">
                    <div className="absolute inset-y-0 left-0 bg-purple-200 dark:bg-purple-600/30" style={{ width: `${pct}%` }} />
                    <div className="relative flex justify-between text-xs">
                      <span className="text-gray-800 dark:text-gray-200">{String.fromCharCode(65 + i)}. {opt}</span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{pct}%</span>
                    </div>
                  </div>
                );
              })}
              <p className="text-[10px] text-gray-500 text-center">{activePollResults.totalResponses} responses</p>
              {!activePollId && (
                <button onClick={() => setActivePollResults(null)}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Dismiss</button>
              )}
            </div>
          ) : (
            <div className="p-5 overflow-y-auto flex-1">
              <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-400">
                Student understanding
              </h3>
              <FeedbackPieChart distribution={distribution} dark />

              {/* Live engagement score */}
              {engagementScore !== null && engagementSignals && (
                <div className="mt-5 border-t border-gray-800 pt-5">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                    Engagement
                  </h3>
                  <EngagementGauge
                    score={{ overall: engagementScore, signals: engagementSignals, participantCount: participants.active }}
                    dark
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {sessionId && (
        <JoinQrOverlay sessionId={sessionId} open={showJoinQr} onClose={() => setShowJoinQr(false)} />
      )}

      {/* Floating focus-mode toolbar.
          Focus mode hides the top bar + drawing toolbar + navigation so the
          slide fills the viewport — but without *some* surface to change
          tool, draw, or exit, lecturers get stuck mid-presentation. This
          pill gives them the essentials without restoring the full chrome. */}
      {focusMode && (
        <>
          <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 flex items-center gap-1 rounded-full bg-gray-900/85 px-2 py-1.5 shadow-xl ring-1 ring-white/10 backdrop-blur-sm">
            <button
              onClick={() => setTool('pointer')}
              title="Pointer"
              className={`flex h-9 w-9 items-center justify-center rounded-full transition ${tool === 'pointer' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'}`}
            >
              <IconPointer />
            </button>
            <button
              onClick={() => setTool('pen')}
              title="Pen"
              className={`flex h-9 w-9 items-center justify-center rounded-full transition ${tool === 'pen' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'}`}
            >
              <IconPen />
            </button>
            <button
              onClick={() => setTool('laser')}
              title="Laser pointer"
              className={`flex h-9 w-9 items-center justify-center rounded-full transition ${tool === 'laser' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'}`}
            >
              <IconLaser />
            </button>
            <button
              onClick={() => setTool('eraser')}
              title="Eraser"
              className={`flex h-9 w-9 items-center justify-center rounded-full transition ${tool === 'eraser' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'}`}
            >
              <IconEraser />
            </button>
            <div className="mx-1 h-5 w-px bg-white/20" />
            <button
              onClick={clearAnnotations}
              title="Clear annotations"
              className="flex h-9 w-9 items-center justify-center rounded-full text-gray-300 transition hover:bg-white/10"
            >
              <IconTrash />
            </button>
            <div className="mx-1 h-5 w-px bg-white/20" />
            <span className="px-2 font-mono text-xs tabular-nums text-gray-400">
              {whiteboardMode ? 'WB' : `${currentSlide + 1} / ${totalSlides || '—'}`}
            </span>
            <button
              onClick={() => { setFocusMode(false); setShowPanel(true); }}
              title="Exit focus (F or Esc)"
              className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium text-white transition hover:bg-white/20"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V5H5m0 14h4v-4m6-6h4V5m-4 14h4v-4" />
              </svg>
              Exit
            </button>
          </div>
          {/* Subtle keyboard-shortcut hint, shown alongside the pill */}
          <div className="pointer-events-none fixed bottom-16 left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[10px] tracking-wide text-white/70 backdrop-blur-sm">
            F / Esc exit · ← → or Space navigate · Home / End jump
          </div>
        </>
      )}
    </div>
  );
}
