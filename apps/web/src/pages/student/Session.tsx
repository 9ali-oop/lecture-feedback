/**
 * Student live session view.
 * Slides + emoji feedback + notes + Q&A.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PdfViewer from '../../components/PdfViewer.tsx';
import AnnotationOverlay from '../../components/AnnotationOverlay.tsx';
import StudentAnnotationOverlay from '../../components/StudentAnnotationOverlay.tsx';
import { useAnnotationReceiver } from '../../hooks/useAnnotationReceiver.ts';
import { useAnnotationAccess } from '../../hooks/useAnnotationAccess.ts';
import { useAnnotationSync } from '../../hooks/useAnnotationSync.ts';
import { useStudentAnnotationReceiver } from '../../hooks/useStudentAnnotationReceiver.ts';
import type { DrawTool } from '../../components/PdfViewer.tsx';
import { SessionSocket } from '../../lib/ws.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../contexts/AuthContext.tsx';
import type { Emoji, Session, SlideNote, PaceValue, Poll, PollResults, ConfusionHighlight } from '@lecture-feedback/shared';

const EMOJIS: { id: Emoji; label: string; emoji: string; color: string; active: string }[] = [
  {
    id: 'got_it',
    label: 'Got it',
    emoji: '😊',
    color: 'border-gray-200 hover:border-green-400 hover:bg-green-50',
    active: 'border-green-500 bg-green-50 ring-2 ring-green-200',
  },
  {
    id: 'neutral',
    label: 'Neutral',
    emoji: '😐',
    color: 'border-gray-200 hover:border-blue-400 hover:bg-blue-50',
    active: 'border-blue-500 bg-blue-50 ring-2 ring-blue-200',
  },
  {
    id: 'confused',
    label: 'Confused',
    emoji: '😕',
    color: 'border-gray-200 hover:border-yellow-400 hover:bg-yellow-50',
    active: 'border-yellow-500 bg-yellow-50 ring-2 ring-yellow-200',
  },
  {
    id: 'lost',
    label: 'Lost',
    emoji: '😵',
    color: 'border-gray-200 hover:border-red-400 hover:bg-red-50',
    active: 'border-red-500 bg-red-50 ring-2 ring-red-200',
  },
];

export default function StudentSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = localStorage.getItem('token')!;

  const [session, setSession] = useState<Session | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);
  const [synced, setSynced] = useState(true);
  const [lecturerSlide, setLecturerSlide] = useState(0);

  const [selectedEmoji, setSelectedEmoji] = useState<Emoji | null>(null);
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<Map<number, string>>(new Map());
  const [noteSaving, setNoteSaving] = useState(false);

  const [question, setQuestion] = useState('');
  const [questionSent, setQuestionSent] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const [showQA, setShowQA] = useState(false);

  const [ended, setEnded] = useState(false);

  // Pace
  const [pace, setPace] = useState<PaceValue>('ok');

  // Polls
  const [activePoll, setActivePoll] = useState<Poll | null>(null);
  const [pollAnswer, setPollAnswer] = useState<number | null>(null);
  const [pollResults, setPollResults] = useState<PollResults | null>(null);

  // Upvotes (track which questions this student has upvoted)
  const [myUpvotes, setMyUpvotes] = useState(new Set<string>());
  const [questionUpvoteCounts, setQuestionUpvoteCounts] = useState(new Map<string, number>());

  // Confusion inline state
  const [confusionText, setConfusionText] = useState('');
  const [confusionShape, setConfusionShape] = useState<'rect' | 'circle'>('rect');
  const [confusionHighlights, setConfusionHighlights] = useState<ConfusionHighlight[]>([]);
  const [confusionSent, setConfusionSent] = useState(false);
  const [drawingArea, setDrawingArea] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  const isConfused = selectedEmoji === 'confused' || selectedEmoji === 'lost';

  const socketRef = useRef<SessionSocket | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 506 });
  const [socketReady, setSocketReady] = useState(false);

  // Load session + notes
  useEffect(() => {
    if (!sessionId) return;
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setCurrentSlide(s.currentSlideIndex);
      setLecturerSlide(s.currentSlideIndex);
      setTotalSlides(s.totalSlides);
    });

    api.listNotes(sessionId).then((n) => {
      const map = new Map(n.map((note) => [note.slideIndex, note.content]));
      setNotes(map);
    });
  }, [sessionId]);

  // Sync current note with slide
  useEffect(() => {
    setNote(notes.get(currentSlide) ?? '');
    setSelectedEmoji(null);
  }, [currentSlide, notes]);

  // WebSocket
  useEffect(() => {
    if (!sessionId || !token) return;
    const socket = new SessionSocket(sessionId, token);
    socketRef.current = socket;

    const unsub = socket.onMessage((msg) => {
      if (msg.type === 'SLIDE_UPDATE') {
        setTotalSlides(msg.totalSlides);
        setLecturerSlide(msg.slideIndex);
        setSynced((v) => {
          if (v) setCurrentSlide(msg.slideIndex);
          return v;
        });
        // Reset emoji on slide change
        setSelectedEmoji(null);
      }
      if (msg.type === 'POLL_LAUNCHED') {
        setActivePoll(msg.poll);
        setPollAnswer(null);
        setPollResults(null);
      }
      if (msg.type === 'POLL_CLOSED') {
        setPollResults(msg.results);
        if (activePoll?.id === msg.pollId) {
          setActivePoll((p) => p ? { ...p, status: 'closed' } : null);
        }
      }
      if (msg.type === 'QUESTION_UPVOTED') {
        setQuestionUpvoteCounts((prev) => new Map(prev).set(msg.questionId, msg.upvoteCount));
      }
      if (msg.type === 'SESSION_ENDED') setEnded(true);
    });

    socket.connect();
    setSocketReady(true);
    return () => { setSocketReady(false); unsub(); socket.disconnect(); };
  }, [sessionId, token]);

  const annotationReceiver = useAnnotationReceiver(socketReady ? socketRef.current : null);
  const annotationAccess = useAnnotationAccess(socketReady ? socketRef.current : null);
  const studentAnnotationReceiver = useStudentAnnotationReceiver(socketReady ? socketRef.current : null);

  // Annotation tools state (only used when granted)
  const [studentTool, setStudentTool] = useState<DrawTool>('pen');
  const [studentPenColor, setStudentPenColor] = useState('#e11d48');
  const [studentPenWidth, setStudentPenWidth] = useState(5);
  const [studentEraserWidth, setStudentEraserWidth] = useState(32);
  const [accessReason, setAccessReason] = useState('');
  const [showAccessForm, setShowAccessForm] = useState(false);

  const annotationSync = useAnnotationSync({
    socket: annotationAccess.status === 'granted' && socketReady ? socketRef.current : null,
    slideIndex: currentSlide,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
  });

  // Reset tool state when access is revoked
  useEffect(() => {
    if (annotationAccess.status !== 'granted') {
      setStudentTool('pen');
      setShowAccessForm(false);
    }
  }, [annotationAccess.status]);

  const goToSlide = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, totalSlides - 1));
      setCurrentSlide(clamped);
      setSynced(clamped === lecturerSlide);
    },
    [totalSlides, lecturerSlide],
  );

  function syncToLecturer() {
    setCurrentSlide(lecturerSlide);
    setSynced(true);
  }

  function handleEmojiSelect(emoji: Emoji) {
    setSelectedEmoji(emoji);
    socketRef.current?.send({ type: 'FEEDBACK', emoji, slideIndex: currentSlide });
    // Reset confusion state
    setConfusionText('');
    setConfusionHighlights([]);
    setConfusionSent(false);
  }

  function handlePaceChange(value: PaceValue) {
    setPace(value);
    socketRef.current?.send({ type: 'PACE_FEEDBACK', value });
  }

  function handlePollAnswer(optionIndex: number) {
    if (!activePoll || pollAnswer !== null) return;
    setPollAnswer(optionIndex);
    socketRef.current?.send({ type: 'POLL_RESPONSE', pollId: activePoll.id, optionIndex });
  }

  function handleUpvote(questionId: string) {
    socketRef.current?.send({ type: 'QUESTION_UPVOTE', questionId });
    setMyUpvotes((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }

  // ── Confusion context ─────────────────────────────────────────────
  async function handleConfusionSubmit() {
    if (!sessionId || confusionSent) return;
    const emoji = selectedEmoji as 'confused' | 'lost';
    await api.submitConfusionContext(sessionId, {
      slideIndex: currentSlide,
      emoji,
      highlights: confusionHighlights,
      explanation: confusionText.trim() || undefined,
    });
    setConfusionSent(true);
    setTimeout(() => setConfusionSent(false), 4000);
  }

  function handleSlideMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!isConfused || !drawingArea) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragStart.current = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    setDragCurrent(dragStart.current);
  }
  function handleSlideMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDragCurrent({ x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) });
  }
  function handleSlideMouseUp() {
    if (!dragStart.current || !dragCurrent) return;
    const s = dragStart.current;
    const w = Math.abs(dragCurrent.x - s.x);
    const h = Math.abs(dragCurrent.y - s.y);
    if (w > 0.02 && h > 0.02) {
      const x = Math.min(s.x, dragCurrent.x);
      const y = Math.min(s.y, dragCurrent.y);
      const hl: ConfusionHighlight = confusionShape === 'rect'
        ? { shape: 'rect', x, y, width: w, height: h }
        : { shape: 'circle', x: x + w / 2, y: y + h / 2, width: w / 2, height: h / 2 };
      setConfusionHighlights((prev) => [...prev, hl]);
    }
    dragStart.current = null;
    setDragCurrent(null);
  }

  function highlightStyle(hl: ConfusionHighlight): React.CSSProperties {
    if (hl.shape === 'rect') return { position: 'absolute', left: `${hl.x*100}%`, top: `${hl.y*100}%`, width: `${hl.width*100}%`, height: `${hl.height*100}%`, border: '2px solid rgba(239,68,68,0.7)', background: 'rgba(239,68,68,0.1)', borderRadius: '4px', pointerEvents: 'none' };
    return { position: 'absolute', left: `${(hl.x-hl.width)*100}%`, top: `${(hl.y-hl.height)*100}%`, width: `${hl.width*2*100}%`, height: `${hl.height*2*100}%`, border: '2px solid rgba(239,68,68,0.7)', background: 'rgba(239,68,68,0.1)', borderRadius: '50%', pointerEvents: 'none' };
  }

  function getDragPreviewStyle(): React.CSSProperties | null {
    if (!dragStart.current || !dragCurrent) return null;
    const s = dragStart.current;
    return { position: 'absolute', left: `${Math.min(s.x,dragCurrent.x)*100}%`, top: `${Math.min(s.y,dragCurrent.y)*100}%`, width: `${Math.abs(dragCurrent.x-s.x)*100}%`, height: `${Math.abs(dragCurrent.y-s.y)*100}%`, border: '2px solid rgba(239,68,68,0.8)', background: 'rgba(239,68,68,0.15)', borderRadius: confusionShape==='circle'?'50%':'4px', pointerEvents: 'none' };
  }

  function handleNoteChange(value: string) {
    setNote(value);
    setNotes((prev) => new Map(prev).set(currentSlide, value));

    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(async () => {
      if (!sessionId) return;
      setNoteSaving(true);
      await api.saveNote(sessionId, currentSlide, value);
      setNoteSaving(false);
    }, 1000);
  }

  async function handleQuestion(e: React.FormEvent) {
    e.preventDefault();
    setQuestionError('');
    const content = question.trim();
    if (!content) return;
    try {
      socketRef.current?.send({ type: 'QUESTION', content });
      setQuestion('');
      setQuestionSent(true);
      setTimeout(() => setQuestionSent(false), 3000);
    } catch (err) {
      setQuestionError(err instanceof Error ? err.message : 'Failed to send');
    }
  }

  // Reflection state
  const [reflectionImportant, setReflectionImportant] = useState('');
  const [reflectionUnclear, setReflectionUnclear] = useState('');
  const [reflectionSubmitted, setReflectionSubmitted] = useState(false);

  async function handleReflectionSubmit() {
    if (!sessionId) return;
    await api.submitReflection(sessionId, {
      mostImportant: reflectionImportant.trim(),
      stillUnclear: reflectionUnclear.trim(),
    });
    setReflectionSubmitted(true);
  }

  if (ended) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-100">
          <p className="text-center text-2xl">🎓</p>
          <h2 className="mt-3 text-center text-xl font-bold text-gray-900">Session ended</h2>

          {!reflectionSubmitted ? (
            <>
              <p className="mt-2 text-center text-sm text-gray-500">
                Before you go, take a moment to reflect on what you learned.
              </p>
              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    What was the most important thing you learned?
                  </label>
                  <textarea
                    value={reflectionImportant}
                    onChange={(e) => setReflectionImportant(e.target.value)}
                    placeholder="The key takeaway from this session was…"
                    rows={3}
                    maxLength={1000}
                    className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none resize-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    What's still unclear?
                  </label>
                  <textarea
                    value={reflectionUnclear}
                    onChange={(e) => setReflectionUnclear(e.target.value)}
                    placeholder="I'm still not sure about…"
                    rows={3}
                    maxLength={1000}
                    className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none resize-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleReflectionSubmit}
                    disabled={!reflectionImportant.trim() && !reflectionUnclear.trim()}
                    className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
                  >
                    Submit reflection
                  </button>
                  <button
                    onClick={() => navigate('/student')}
                    className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-center text-sm text-green-600">Thank you for your reflection!</p>
              <button
                onClick={() => navigate('/student')}
                className="mt-6 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Back to dashboard
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/student')}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100"
          >
            ←
          </button>
          <div>
            <span className="text-sm font-semibold text-gray-900">{session?.title}</span>
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Live
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!synced && (
            <button
              onClick={syncToLecturer}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
            >
              Sync to lecturer
            </button>
          )}
          {/* Annotation access */}
          {annotationAccess.status === 'idle' && !showAccessForm && (
            <button
              onClick={() => setShowAccessForm(true)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Request pen
            </button>
          )}
          {annotationAccess.status === 'idle' && showAccessForm && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={accessReason}
                onChange={(e) => setAccessReason(e.target.value)}
                placeholder="Why? (required)"
                maxLength={100}
                className="w-40 rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
              />
              <button
                onClick={() => {
                  if (accessReason.trim()) {
                    annotationAccess.requestAccess(accessReason.trim());
                    setAccessReason('');
                    setShowAccessForm(false);
                  }
                }}
                disabled={!accessReason.trim()}
                className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
              >
                Send
              </button>
              <button
                onClick={() => { setShowAccessForm(false); setAccessReason(''); }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>
          )}
          {annotationAccess.status === 'pending' && (
            <button
              onClick={() => annotationAccess.cancelRequest()}
              className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-xs font-medium text-yellow-700 transition hover:bg-yellow-100"
            >
              Cancel request
            </button>
          )}
          {annotationAccess.status === 'granted' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700 ring-1 ring-green-200">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Annotating
            </span>
          )}
          <button
            onClick={() => setShowQA((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              showQA ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Q&amp;A
          </button>
        </div>
      </div>

      {/* Annotation toolbar (shown when granted) */}
      {annotationAccess.status === 'granted' && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-gray-100 bg-white px-4 py-1.5">
          <span className="text-xs font-medium text-green-700 mr-2">Annotation tools:</span>
          <div className="flex items-center gap-0.5 rounded-xl bg-gray-100 p-1">
            {(['pen', 'laser', 'eraser'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setStudentTool(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  studentTool === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t === 'pen' ? 'Pen' : t === 'laser' ? 'Laser' : 'Eraser'}
              </button>
            ))}
          </div>
          {studentTool === 'pen' && (
            <div className="flex items-center gap-1.5 ml-2">
              {['#e11d48', '#f97316', '#eab308', '#16a34a', '#2563eb'].map((c) => (
                <button
                  key={c}
                  onClick={() => setStudentPenColor(c)}
                  className="h-5 w-5 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: studentPenColor === c ? `2px solid ${c}` : '2px solid transparent',
                    outlineOffset: '2px',
                  }}
                />
              ))}
              <div className="mx-1 h-4 w-px bg-gray-300" />
              {[{ value: 2, label: 'S' }, { value: 5, label: 'M' }, { value: 10, label: 'L' }].map((w) => (
                <button
                  key={w.value}
                  onClick={() => setStudentPenWidth(w.value)}
                  className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                    studentPenWidth === w.value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          )}
          {studentTool === 'eraser' && (
            <div className="flex items-center gap-1.5 ml-2">
              {[{ value: 16, label: 'S' }, { value: 32, label: 'M' }, { value: 56, label: 'L' }].map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStudentEraserWidth(s.value)}
                  className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                    studentEraserWidth === s.value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => annotationSync.sendClear()}
            className="ml-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition hover:bg-gray-100"
          >
            Clear my drawings
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Slides column */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* PDF */}
          <div className="flex-1 overflow-auto bg-white p-4">
            {session?.hasPdf ? (
              <div className="relative" style={{ width: canvasSize.width, maxWidth: '100%' }}>
                <PdfViewer
                  url={api.pdfUrl(sessionId!)}
                  currentPage={currentSlide}
                  onTotalPages={setTotalSlides}
                  token={token}
                  onCanvasResize={(w, h) => setCanvasSize({ width: w, height: h })}
                  className="rounded-xl shadow-sm"
                  {...(annotationAccess.status === 'granted' ? {
                    overlayRef,
                    tool: studentTool,
                    penColor: studentPenColor,
                    penWidth: studentPenWidth,
                    eraserWidth: studentEraserWidth,
                    onDrawStart: (x: number, y: number, drawTool: DrawTool) => {
                      if (drawTool === 'pen') annotationSync.startDrawBatch(studentPenColor, studentPenWidth);
                      if (drawTool === 'eraser') annotationSync.startEraseBatch(studentEraserWidth);
                    },
                    onDrawMove: (x: number, y: number, drawTool: DrawTool) => {
                      if (drawTool === 'pen') annotationSync.addDrawPoint(x, y);
                      if (drawTool === 'eraser') annotationSync.addErasePoint(x, y);
                      if (drawTool === 'laser') annotationSync.sendLaserMove(x, y);
                      if (drawTool !== 'pointer' && drawTool !== 'text') annotationSync.sendCursorPosition(x, y, drawTool);
                    },
                    onDrawEnd: (drawTool: DrawTool) => {
                      if (drawTool === 'pen') annotationSync.endDrawBatch();
                      if (drawTool === 'eraser') annotationSync.endEraseBatch();
                      annotationSync.sendCursorHide();
                    },
                    onLeave: (drawTool: DrawTool) => {
                      if (drawTool === 'pen') annotationSync.endDrawBatch();
                      if (drawTool === 'eraser') annotationSync.endEraseBatch();
                      if (drawTool === 'laser') annotationSync.sendLaserEnd();
                      annotationSync.sendCursorHide();
                    },
                  } : {})}
                />
                <AnnotationOverlay
                  canvasWidth={canvasSize.width}
                  canvasHeight={canvasSize.height}
                  annotations={annotationReceiver.getAnnotations(currentSlide)}
                  incomingStroke={annotationReceiver.incomingStroke}
                  syncTrigger={annotationReceiver.syncTrigger}
                  clearSlide={annotationReceiver.clearSlide}
                  laserState={annotationReceiver.laserState}
                  cursorState={annotationReceiver.cursorState}
                />
                <StudentAnnotationOverlay
                  canvasWidth={canvasSize.width}
                  canvasHeight={canvasSize.height}
                  incomingStroke={studentAnnotationReceiver.incomingStroke}
                  clearTrigger={studentAnnotationReceiver.clearTrigger}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                No slides uploaded
              </div>
            )}
          </div>

          {/* Slide navigation */}
          <div className="flex shrink-0 items-center justify-center gap-3 border-t border-gray-100 bg-white py-2.5">
            <button onClick={() => goToSlide(0)} disabled={currentSlide === 0} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 disabled:opacity-30">⏮</button>
            <button onClick={() => goToSlide(currentSlide - 1)} disabled={currentSlide === 0} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 disabled:opacity-30">← Prev</button>
            <span className="min-w-[70px] text-center text-sm font-mono text-gray-500">
              {currentSlide + 1} / {totalSlides || '—'}
            </span>
            <button onClick={() => goToSlide(currentSlide + 1)} disabled={currentSlide >= totalSlides - 1} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 disabled:opacity-30">Next →</button>
            <button onClick={() => goToSlide(totalSlides - 1)} disabled={currentSlide >= totalSlides - 1} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 disabled:opacity-30">⏭</button>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex w-72 shrink-0 flex-col border-l border-gray-100 bg-white overflow-hidden">
          {showQA ? (
            /* Q&A panel */
            <div className="flex flex-1 flex-col overflow-hidden p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Ask a question</h3>
                <button onClick={() => setShowQA(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <form onSubmit={handleQuestion} className="space-y-3">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Type your question…"
                  rows={4}
                  maxLength={500}
                  className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none resize-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                {questionError && <p className="text-xs text-red-500">{questionError}</p>}
                {questionSent && <p className="text-xs text-green-600">Question sent ✓</p>}
                <button
                  type="submit"
                  disabled={!question.trim()}
                  className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
                >
                  Send question
                </button>
              </form>
            </div>
          ) : (
            /* Feedback + notes panel */
            <div className="flex flex-1 flex-col overflow-hidden p-4 space-y-4">
              {/* Emoji feedback */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-gray-900">How are you doing?</h3>
                <div className="grid grid-cols-2 gap-2">
                  {EMOJIS.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => handleEmojiSelect(e.id)}
                      className={`flex flex-col items-center gap-1 rounded-xl border py-3 transition ${
                        selectedEmoji === e.id ? e.active : e.color
                      }`}
                    >
                      <span className="text-2xl">{e.emoji}</span>
                      <span className="text-xs font-medium text-gray-700">{e.label}</span>
                    </button>
                  ))}
                </div>
                {!selectedEmoji && (
                  <p className="mt-2 text-center text-xs text-gray-400">
                    Select your understanding for this slide
                  </p>
                )}
              </div>

              {/* Inline confusion context */}
              {isConfused && !confusionSent && (
                <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 space-y-2">
                  <p className="text-xs font-medium text-yellow-800">
                    What's confusing? <span className="font-normal text-yellow-600">(optional)</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setDrawingArea(!drawingArea)}
                      className={`rounded-lg border px-2 py-1 text-[10px] font-medium transition ${drawingArea ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                      {drawingArea ? 'Marking on' : 'Mark area'}
                    </button>
                    {drawingArea && (
                      <>
                        <button onClick={() => setConfusionShape('rect')}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confusionShape === 'rect' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500'}`}>▭</button>
                        <button onClick={() => setConfusionShape('circle')}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confusionShape === 'circle' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500'}`}>○</button>
                      </>
                    )}
                    {confusionHighlights.length > 0 && (
                      <button onClick={() => setConfusionHighlights([])} className="text-[10px] text-gray-400 hover:text-gray-600">Clear</button>
                    )}
                  </div>
                  <textarea value={confusionText} onChange={(e) => setConfusionText(e.target.value)}
                    placeholder="e.g. I don't understand the formula…" maxLength={500} rows={2}
                    className="w-full resize-none rounded-lg border border-yellow-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-yellow-400" />
                  <button onClick={handleConfusionSubmit}
                    disabled={!confusionText.trim() && confusionHighlights.length === 0}
                    className="w-full rounded-lg bg-yellow-600 py-1.5 text-xs font-semibold text-white transition hover:bg-yellow-700 disabled:opacity-40">
                    Send feedback
                  </button>
                </div>
              )}
              {isConfused && confusionSent && (
                <p className="text-center text-xs text-green-600">Feedback sent ✓</p>
              )}

              {/* Pace indicator */}
              <div>
                <h3 className="mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Pace</h3>
                <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                  {([
                    { value: 'slow' as PaceValue, label: 'Too slow', icon: '🐢' },
                    { value: 'ok' as PaceValue, label: 'Just right', icon: '👌' },
                    { value: 'fast' as PaceValue, label: 'Too fast', icon: '🏃' },
                  ]).map((p) => (
                    <button key={p.value} onClick={() => handlePaceChange(p.value)}
                      className={`flex-1 py-2 text-center text-xs transition ${
                        pace === p.value
                          ? 'bg-blue-600 text-white font-semibold'
                          : 'text-gray-500 hover:bg-gray-50'
                      }`}>
                      <span className="block text-sm">{p.icon}</span>
                      <span className="block mt-0.5">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Notes</h3>
                  {noteSaving && <span className="text-xs text-gray-400">Saving…</span>}
                </div>
                <textarea
                  value={note}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  placeholder="Your notes for this slide…"
                  className="flex-1 resize-none rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Poll overlay */}
      {activePoll && activePoll.status === 'active' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{activePoll.question}</h3>
            <div className="space-y-2">
              {activePoll.options.map((opt, i) => (
                <button key={i} onClick={() => handlePollAnswer(i)} disabled={pollAnswer !== null}
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                    pollAnswer === i
                      ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700'
                      : pollAnswer !== null
                        ? 'border-gray-100 text-gray-400'
                        : 'border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                  }`}>
                  <span className="mr-2 font-mono text-xs text-gray-400">{String.fromCharCode(65 + i)}.</span>
                  {opt}
                </button>
              ))}
            </div>
            {pollAnswer !== null && (
              <p className="mt-4 text-center text-xs text-green-600">Response submitted — waiting for results...</p>
            )}
          </div>
        </div>
      )}

      {/* Poll results overlay (shown when closed) */}
      {pollResults && activePoll?.status === 'closed' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{pollResults.question}</h3>
            <div className="space-y-2">
              {pollResults.options.map((opt, i) => {
                const pct = pollResults.totalResponses > 0 ? Math.round((pollResults.counts[i] / pollResults.totalResponses) * 100) : 0;
                return (
                  <div key={i} className="relative overflow-hidden rounded-xl border border-gray-200 px-4 py-3">
                    <div className="absolute inset-y-0 left-0 bg-blue-100 transition-all" style={{ width: `${pct}%` }} />
                    <div className="relative flex justify-between text-sm">
                      <span className={pollAnswer === i ? 'font-semibold text-blue-700' : 'text-gray-700'}>
                        {String.fromCharCode(65 + i)}. {opt}
                      </span>
                      <span className="font-semibold text-gray-900">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-center text-xs text-gray-400">{pollResults.totalResponses} responses</p>
            <button onClick={() => { setActivePoll(null); setPollResults(null); }}
              className="mt-4 w-full rounded-lg bg-gray-100 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-200">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
