/**
 * Student live session view.
 * Slides + emoji feedback + notes + Q&A.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PdfViewer from '../../components/PdfViewer.tsx';
import AnnotationOverlay from '../../components/AnnotationOverlay.tsx';
import StudentAnnotationOverlay from '../../components/StudentAnnotationOverlay.tsx';
import RequestPenModal from '../../components/RequestPenModal.tsx';
import AccessibilityToggles from '../../components/AccessibilityToggles.tsx';
import { useLiveAnnouncer } from '../../components/LiveRegion.tsx';
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
    color: 'border-gray-200 dark:border-gray-700 hover:border-green-400 hover:bg-green-50 dark:hover:border-green-600 dark:hover:bg-green-900/30',
    active: 'border-green-500 bg-green-50 ring-2 ring-green-200 dark:bg-green-900/30 dark:ring-green-700',
  },
  {
    id: 'neutral',
    label: 'Neutral',
    emoji: '😐',
    color: 'border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:bg-blue-50 dark:hover:border-blue-600 dark:hover:bg-blue-900/30',
    active: 'border-blue-500 bg-blue-50 ring-2 ring-blue-200 dark:bg-blue-900/30 dark:ring-blue-700',
  },
  {
    id: 'confused',
    label: 'Confused',
    emoji: '😕',
    color: 'border-gray-200 dark:border-gray-700 hover:border-yellow-400 hover:bg-yellow-50 dark:hover:border-yellow-600 dark:hover:bg-yellow-900/30',
    active: 'border-yellow-500 bg-yellow-50 ring-2 ring-yellow-200 dark:bg-yellow-900/30 dark:ring-yellow-700',
  },
  {
    id: 'lost',
    label: 'Lost',
    emoji: '😵',
    color: 'border-gray-200 dark:border-gray-700 hover:border-red-400 hover:bg-red-50 dark:hover:border-red-600 dark:hover:bg-red-900/30',
    active: 'border-red-500 bg-red-50 ring-2 ring-red-200 dark:bg-red-900/30 dark:ring-red-700',
  },
];

export default function StudentSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { announce } = useLiveAnnouncer();
  const token = localStorage.getItem('token')!;

  const [session, setSession] = useState<Session | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);
  const [synced, _setSynced] = useState(true);
  const syncedRef = useRef(true);
  const setSynced = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    _setSynced((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      syncedRef.current = next;
      return next;
    });
  }, []);
  const [lecturerSlide, setLecturerSlide] = useState(0);

  const [selectedEmoji, setSelectedEmoji] = useState<Emoji | null>(null);
  const [flashEmoji, setFlashEmoji] = useState<Emoji | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<Map<number, string>>(new Map());
  const [noteSaving, setNoteSaving] = useState(false);

  const [question, setQuestion] = useState('');
  const [questionSent, setQuestionSent] = useState(false);
  const [questionError, setQuestionError] = useState('');
  // Only auto-open the side panel on true desktop widths (lg breakpoint).
  // Below this the strip handles primary input and the panel opens on demand
  // via the tab bar — otherwise landscape phones (~900px) would start with
  // the panel open and eat the slide space.
  const [showPanel, setShowPanel] = useState(() => window.innerWidth >= 1024);
  const [focusMode, setFocusMode] = useState(false);
  // Bottom-tab selection on mobile: feedback | qa | notes
  const [activeTab, setActiveTab] = useState<'feedback' | 'qa' | 'notes'>('feedback');
  // Desktop stacks Feedback + Notes + Q&A in one sidebar. Q&A collapses so
  // Notes gets the flex-1 vertical real estate by default — asking a question
  // is deliberate, and auto-expands on focus.
  const [qaExpanded, setQaExpanded] = useState(false);
  const [myQuestions, setMyQuestions] = useState<{ id: string; content: string; answered: boolean }[]>([]);

  const [ended, setEnded] = useState(false);
  const [lecturerDisconnected, setLecturerDisconnected] = useState(false);

  // Keyboard shortcuts: focus mode (F), slide navigation (arrows)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'f' || e.key === 'F') {
        // Toggle focus mode. Entering: collapse the panel on every breakpoint
        // so the slide gets maximum room — the always-on emoji strip covers
        // rating needs. Exiting: restore the lg default (panel open) so
        // desktop users don't land looking at an empty gutter.
        setFocusMode((v) => {
          const nextFocus = !v;
          setShowPanel(nextFocus ? false : window.innerWidth >= 1024);
          return nextFocus;
        });
      }
      if (e.key === 'Escape' && focusMode) {
        setFocusMode(false);
        setShowPanel(window.innerWidth >= 1024);
      }
      // Slide navigation
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentSlide((prev) => {
          const next = Math.min(prev + 1, (totalSlides || 1) - 1);
          setSynced(false);
          return next;
        });
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentSlide((prev) => {
          const next = Math.max(prev - 1, 0);
          setSynced(false);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusMode, totalSlides]);

  // Whiteboard sync
  const [lecturerWhiteboard, setLecturerWhiteboard] = useState(false);
  const [viewMode, setViewMode] = useState<'slide' | 'whiteboard'>('slide');

  // Pace
  const [pace, setPace] = useState<PaceValue>('ok');

  // Polls
  const [activePoll, setActivePoll] = useState<Poll | null>(null);
  const [pollAnswer, setPollAnswer] = useState<number | null>(null);
  const [pollMinimized, setPollMinimized] = useState(false);
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

  // Lecturer text boxes (synced via WS)
  const [lecturerTextBoxes, setLecturerTextBoxes] = useState<Array<{ id: string; x: number; y: number; width: number; height: number; content: string; fontFamily: string; fontSize: number; color: string }>>([]);
  const textBoxCacheRef = useRef(new Map<number, Array<{ id: string; x: number; y: number; width: number; height: number; content: string; fontFamily: string; fontSize: number; color: string }>>());

  const isConfused = selectedEmoji === 'confused' || selectedEmoji === 'lost';

  const currentSlideRef = useRef(0);

  const socketRef = useRef<SessionSocket | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 506 });
  const handleCanvasResize = useCallback((w: number, h: number) => {
    setCanvasSize((prev) => prev.width === w && prev.height === h ? prev : { width: w, height: h });
  }, []);
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

  // Reset transient per-slide state on slide change only — keeping `notes` out
  // of the deps list because each keystroke updates the map and would otherwise
  // clear the emoji selection mid-typing.
  useEffect(() => {
    setSelectedEmoji(null);
    currentSlideRef.current = currentSlide;
    setLecturerTextBoxes(textBoxCacheRef.current.get(currentSlide) ?? []);
  }, [currentSlide]);

  // Reload the note textarea when the slide changes or the notes map finishes
  // loading. Re-running on keystrokes is a harmless no-op (value stays equal).
  useEffect(() => {
    setNote(notes.get(currentSlide) ?? '');
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
        if (syncedRef.current) {
          setCurrentSlide(msg.slideIndex);
          // Announce slide change to screen-reader users — sighted users see
          // the canvas swap, but a blind user would otherwise have no signal.
          announce(`Slide ${msg.slideIndex + 1} of ${msg.totalSlides}`);
        }
        // Reset emoji on slide change
        setSelectedEmoji(null);
      }
      if (msg.type === 'POLL_LAUNCHED') {
        setActivePoll(msg.poll);
        setPollAnswer(null);
        setPollResults(null);
        announce('A poll has been launched', 'assertive');
      }
      if (msg.type === 'POLL_CLOSED') {
        setPollResults(msg.results);
        setActivePoll((p) => p?.id === msg.pollId ? { ...p, status: 'closed' } : p);
        announce('Poll closed. Results available.');
      }
      if (msg.type === 'QUESTION_ANSWERED') {
        setMyQuestions((prev) => prev.map((q) => q.id === msg.questionId ? { ...q, answered: true } : q));
        announce('Your question has been answered.');
      }
      if (msg.type === 'QUESTION_UPVOTED') {
        setQuestionUpvoteCounts((prev) => new Map(prev).set(msg.questionId, msg.upvoteCount));
      }
      if (msg.type === 'SESSION_ENDED') setEnded(true);
      if (msg.type === 'LECTURER_DISCONNECTED') {
        setLecturerDisconnected(true);
        announce('Lecturer disconnected. Waiting for reconnection.', 'assertive');
      }
      if (msg.type === 'LECTURER_RECONNECTED') {
        setLecturerDisconnected(false);
        announce('Lecturer reconnected.');
      }
      if (msg.type === 'WHITEBOARD_TOGGLE') {
        setLecturerWhiteboard(msg.enabled);
        setViewMode(msg.enabled ? 'whiteboard' : 'slide');
      }
      if (msg.type === 'TEXT_BOX_SYNC') {
        textBoxCacheRef.current.set(msg.slideIndex, msg.textBoxes);
        if (msg.slideIndex === currentSlideRef.current) {
          setLecturerTextBoxes(msg.textBoxes);
        }
      }
    });

    socket.connect();
    setSocketReady(true);
    return () => {
      setSocketReady(false);
      unsub();
      socket.disconnect();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [sessionId, token]);

  // Suppress lecturer strokes when they're drawing on the whiteboard AND
  // the student chose to stay on the slide view — otherwise those whiteboard
  // scribbles would appear on top of the slide the student is reading.
  const suppressLecturerStrokes = lecturerWhiteboard && viewMode === 'slide';
  const annotationReceiver = useAnnotationReceiver(
    socketReady ? socketRef.current : null,
    { suppress: suppressLecturerStrokes },
  );
  const annotationAccess = useAnnotationAccess(socketReady ? socketRef.current : null);
  const studentAnnotationReceiver = useStudentAnnotationReceiver(socketReady ? socketRef.current : null);

  // Annotation tools state (only used when granted)
  const [studentTool, setStudentTool] = useState<DrawTool>('pen');
  const [studentPenColor, setStudentPenColor] = useState('#e11d48');
  const [studentPenWidth, setStudentPenWidth] = useState(5);
  const [studentEraserWidth, setStudentEraserWidth] = useState(32);
  const [showAccessForm, setShowAccessForm] = useState(false);

  const annotationSync = useAnnotationSync({
    socket: annotationAccess.status === 'granted' && socketReady ? socketRef.current : null,
    slideIndex: currentSlide,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
  });

  // Send LASER_END when switching away from the laser tool
  const prevStudentToolRef = useRef<DrawTool>(studentTool);
  useEffect(() => {
    if (prevStudentToolRef.current === 'laser' && studentTool !== 'laser') {
      annotationSync.sendLaserEnd();
      annotationSync.sendCursorHide();
    }
    prevStudentToolRef.current = studentTool;
  }, [studentTool, annotationSync]);

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
    // Announce selection for screen-reader parity with the visual flash + haptic.
    const labels: Record<Emoji, string> = { got_it: 'Got it', neutral: 'Neutral', confused: 'Confused', lost: 'Lost' };
    announce(`Feedback sent: ${labels[emoji]}`);
    // Eyes-off confirmation: short haptic pulse so students know the tap
    // registered without having to look back at the phone. Vibrate API is a
    // no-op on iOS Safari and desktop — acceptable fallback (visual flash below).
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(15); } catch { /* some browsers gate this */ }
    }
    // Visual flash: brief ring animation on the selected button. Cleared by
    // the next selection or on unmount via setTimeout.
    setFlashEmoji(emoji);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashEmoji(null), 500);
  }

  function handlePaceChange(value: PaceValue) {
    setPace(value);
    socketRef.current?.send({ type: 'PACE_FEEDBACK', value });
    const labels: Record<PaceValue, string> = { slow: 'Too slow', ok: 'Just right', fast: 'Too fast' };
    announce(`Pace set to ${labels[value]}`);
  }

  // Fullscreen: try to request document fullscreen + lock orientation to landscape.
  // On iOS Safari where this is restricted, we fall back to the pure-CSS focus mode.
  async function enterFullscreen() {
    setFocusMode(true);
    // Collapse the panel on entry: the always-on reaction strip covers
    // rating in focus mode and the extra width gives the slide more room.
    setShowPanel(false);
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch { /* user or browser rejected; CSS focus is enough */ }
    try {
      const orient = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
      await orient?.lock?.('landscape');
    } catch { /* iOS doesn't allow; fine, rotate the device manually */ }
  }

  async function exitFullscreen() {
    setFocusMode(false);
    // On phones we force-close the panel — otherwise a 40dvh landscape panel
    // + top bar + nav leaves the slide with ~80px of vertical space and the
    // user is "stuck" (content renders, just way too small to read). Desktop
    // doesn't have that problem, so preserve whatever panel state the user
    // had before entering focus. Default-open matches the initial state on
    // lg so the Q&A / pace / engagement controls are immediately reachable.
    setShowPanel(window.innerWidth >= 1024);
    try {
      const orient = (screen as Screen & { orientation?: { unlock?: () => void } }).orientation;
      orient?.unlock?.();
    } catch { /* ignore */ }
    try {
      const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> };
      if (doc.fullscreenElement && doc.exitFullscreen) await doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    } catch { /* ignore */ }
  }

  // Sync React state if the user leaves fullscreen via browser chrome / Esc / back button.
  // Also close the bottom panel so the slide reclaims its full height — covers the
  // "exit fullscreen → stuck because panel still eats 40dvh" bug Ali reported.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && focusMode) {
        setFocusMode(false);
        // Mirror exitFullscreen: preserve panel on desktop, close on mobile.
        setShowPanel(window.innerWidth >= 1024);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [focusMode]);

  // Defensive: if a phone rotates to landscape with the panel open, cap the
  // panel height aggressively so the slide always has room. Happens both
  // inside and outside fullscreen.
  useEffect(() => {
    const onResize = () => {
      const isLandscape = typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches;
      const isPhone = typeof window !== 'undefined' && window.innerWidth < 768;
      if (isLandscape && isPhone && showPanel && !focusMode) {
        // Nothing to set here — CSS `landscape:h-[40dvh]` handles it. This hook
        // exists so a re-render happens after rotation for any stale dvh values.
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [showPanel, focusMode]);

  // Reset poll-minimized state whenever a new poll becomes active
  useEffect(() => {
    setPollMinimized(false);
  }, [activePoll?.id]);

  function handlePollAnswer(optionIndex: number) {
    if (!activePoll || activePoll.status === 'closed') return;
    if (pollAnswer === optionIndex) return; // same option, no-op
    setPollAnswer(optionIndex);
    // Persist locally so a refresh restores the selection
    try { localStorage.setItem(`lf.poll.${activePoll.id}`, String(optionIndex)); } catch { /* quota / private mode */ }
    socketRef.current?.send({ type: 'POLL_RESPONSE', pollId: activePoll.id, optionIndex });
  }

  // Restore a previously-submitted answer when a poll becomes active
  // (covers the page-refresh case cleanly).
  useEffect(() => {
    if (!activePoll) return;
    if (pollAnswer !== null) return;
    try {
      const saved = localStorage.getItem(`lf.poll.${activePoll.id}`);
      if (saved !== null) setPollAnswer(Number(saved));
    } catch { /* ignore */ }
  }, [activePoll, pollAnswer]);

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
    try {
      await api.submitConfusionContext(sessionId, {
        slideIndex: currentSlide,
        emoji,
        highlights: confusionHighlights,
        explanation: confusionText.trim() || undefined,
      });
      setConfusionSent(true);
      setConfusionText('');
      setConfusionHighlights([]);
      setDrawingArea(false);
      announce('Confusion feedback sent to lecturer.');
    } catch {
      // Silently fail - the emoji feedback was already recorded
      setConfusionSent(true);
    }
  }

  // Pointer-based drag so touch devices can also mark confusion areas.
  // setPointerCapture keeps tracking even if the finger leaves the element bounds.
  function handleSlidePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isConfused || !drawingArea) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    dragStart.current = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    setDragCurrent(dragStart.current);
  }
  function handleSlidePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDragCurrent({
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    });
  }
  function handleSlidePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
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
      // Single-mark only: the newest drag replaces any previous marking.
      setConfusionHighlights([hl]);
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
    if (!content || !sessionId) return;
    try {
      const q = await api.askQuestion(sessionId, content, currentSlide);
      setMyQuestions((prev) => [{ id: q.id, content: q.content, answered: false }, ...prev]);
      setQuestion('');
      setQuestionSent(true);
      announce('Question sent to lecturer. Waiting for answer.');
      setTimeout(() => setQuestionSent(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send';
      setQuestionError(msg);
      announce(`Could not send question: ${msg}`, 'assertive');
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
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-xl shadow-gray-200/60 dark:shadow-black/40 ring-1 ring-gray-100 dark:ring-gray-800">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
            <svg className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
          </div>
          <h2 className="mt-4 text-center text-xl font-bold text-gray-900 dark:text-gray-100">Session ended</h2>

          {!reflectionSubmitted ? (
            <>
              <p className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
                Before you go, take a moment to reflect on what you learned.
              </p>
              <div className="mt-6 space-y-4">
                <div>
                  <label htmlFor="reflection-important" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    What was the most important thing you learned?
                  </label>
                  <textarea
                    id="reflection-important"
                    value={reflectionImportant}
                    onChange={(e) => setReflectionImportant(e.target.value)}
                    placeholder="The key takeaway from this session was…"
                    rows={3}
                    maxLength={1000}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-sm text-gray-900 dark:text-gray-100 outline-none resize-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-800"
                  />
                </div>
                <div>
                  <label htmlFor="reflection-unclear" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    What's still unclear?
                  </label>
                  <textarea
                    id="reflection-unclear"
                    value={reflectionUnclear}
                    onChange={(e) => setReflectionUnclear(e.target.value)}
                    placeholder="I'm still not sure about…"
                    rows={3}
                    maxLength={1000}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-sm text-gray-900 dark:text-gray-100 outline-none resize-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-800"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleReflectionSubmit}
                    disabled={!reflectionImportant.trim() && !reflectionUnclear.trim()}
                    className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-40"
                  >
                    Submit reflection
                  </button>
                  <button
                    onClick={() => navigate(`/student/report/${sessionId}`)}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-center text-sm text-green-600 dark:text-green-400">Thank you for your reflection!</p>
              <button
                onClick={() => navigate(`/student/report/${sessionId}`)}
                className="mt-6 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700"
              >
                View session report
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-gray-50 dark:bg-gray-950 overflow-hidden">
      <a href="#session-main" className="skip-link">Skip to slides and feedback</a>
      {/* Top bar */}
      <div className={`${focusMode ? 'hidden' : 'flex'} shrink-0 items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-3 py-2 sticky top-0 z-30`}>
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => { if (confirm('Leave this session?')) navigate('/student'); }}
            className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-700 dark:text-red-400 min-h-[36px]"
            title="Leave session"
          >
            Leave
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100 max-w-[140px] sm:max-w-none">{session?.title}</span>
            {session?.status === 'live' ? (
              <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            ) : session?.status === 'scheduled' ? (
              <span className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-gray-700">
                Scheduled
              </span>
            ) : session?.status === 'ended' ? (
              <span className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-gray-700">
                Ended
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => (focusMode ? exitFullscreen() : enterFullscreen())}
            className="rounded-lg p-2 text-gray-500 dark:text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[36px] min-w-[36px]"
            title={focusMode ? 'Exit fullscreen' : 'Fullscreen slides'}
          >
            {focusMode ? (
              // Exit-fullscreen: corners face center, arms extend to edges
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8H8V4 M16 4V8H20 M20 16H16V20 M8 20V16H4" /></svg>
            ) : (
              // Enter-fullscreen: corners at viewBox corners, arms extend inward
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4" /></svg>
            )}
          </button>
          {!synced && (
            <button
              onClick={syncToLecturer}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
            >
              Sync to lecturer
            </button>
          )}
          {/* Annotation access */}
          {annotationAccess.status === 'idle' && (
            <button
              onClick={() => setShowAccessForm(true)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-2 sm:px-3 text-xs font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800 min-h-[36px] min-w-[36px]"
              title="Request the pen"
            >
              {/* Icon-only on narrow screens, text on sm+ */}
              <svg className="h-4 w-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span className="hidden sm:inline">Request pen</span>
            </button>
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
          {/* Theme + Dyslexia toggles. No device-view toggle — the session
              layout is already viewport-responsive and the simulated phone
              frame would collide with the slide canvas. */}
          <AccessibilityToggles variant="header" hideViewToggle />
        </div>
      </div>

      {/* Lecturer disconnected warning */}
      {lecturerDisconnected && (
        <div className="shrink-0 bg-yellow-50 dark:bg-yellow-900/30 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2.5 text-center text-sm font-medium text-yellow-800 dark:text-yellow-300">
          Lecturer disconnected - waiting for reconnection...
        </div>
      )}

      {/* Annotation toolbar (shown when granted) — horizontally scrollable on mobile */}
      {annotationAccess.status === 'granted' && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 md:justify-center md:px-4">
          <span className="text-xs font-medium text-green-700 dark:text-green-400 mr-2">Annotation tools:</span>
          <div className="flex items-center gap-0.5 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
            {(['pen', 'laser', 'eraser'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setStudentTool(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  studentTool === t ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
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
              <div className="mx-1 h-4 w-px bg-gray-300 dark:bg-gray-600" />
              {[{ value: 2, label: 'S' }, { value: 5, label: 'M' }, { value: 10, label: 'L' }].map((w) => (
                <button
                  key={w.value}
                  onClick={() => setStudentPenWidth(w.value)}
                  className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                    studentPenWidth === w.value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
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
                    studentEraserWidth === s.value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              annotationSync.sendClear();
              // Also clear the local overlay canvas
              const canvas = overlayRef.current;
              if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
            }}
            className="ml-2 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Clear my drawings
          </button>
        </div>
      )}

      <div id="session-main" className="flex flex-1 flex-col lg:flex-row overflow-hidden">
        {/* Slides column. In focus mode on lg, the reaction strip is
            absolutely positioned at the bottom of the viewport (see below)
            — reserve 4rem of bottom padding so the slide doesn't render
            under it. Mobile keeps the strip in-flow so no padding needed. */}
        <div className={`flex flex-1 flex-col overflow-hidden min-h-0 ${focusMode ? 'lg:pb-16' : ''}`}>
          {/* PDF / Whiteboard — tap-to-exit-fullscreen when in focus mode (and not annotating) */}
          <div
            className="flex-1 overflow-hidden bg-white dark:bg-gray-950 p-2 md:p-4"
            onClick={() => {
              if (focusMode && annotationAccess.status !== 'granted') exitFullscreen();
            }}
          >
            {lecturerWhiteboard && (
              <div className="mb-2 flex items-center gap-2">
                <button
                  onClick={() => setViewMode('slide')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${viewMode === 'slide' ? 'bg-gray-800 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                >
                  Slide
                </button>
                <button
                  onClick={() => setViewMode('whiteboard')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${viewMode === 'whiteboard' ? 'bg-gray-800 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                >
                  Whiteboard
                </button>
              </div>
            )}
            {session?.hasPdf || viewMode === 'whiteboard' ? (
              <PdfViewer
                url={api.pdfUrl(sessionId!)}
                currentPage={currentSlide}
                onTotalPages={setTotalSlides}
                token={token}
                onCanvasResize={handleCanvasResize}
                className="rounded-xl shadow-sm"
                scaleMode="contain"
                whiteboardMode={viewMode === 'whiteboard'}
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
              >
                <AnnotationOverlay
                  canvasWidth={canvasSize.width}
                  canvasHeight={canvasSize.height}
                  annotations={annotationReceiver.getAnnotations(currentSlide)}
                  incomingStroke={annotationReceiver.incomingStroke}
                  syncTrigger={annotationReceiver.syncTrigger}
                  clearSlide={annotationReceiver.clearSlide}
                  laserState={annotationReceiver.laserState}
                  cursorState={annotationReceiver.cursorState}
                  currentSlide={currentSlide}
                />
                <StudentAnnotationOverlay
                  canvasWidth={canvasSize.width}
                  canvasHeight={canvasSize.height}
                  incomingStroke={studentAnnotationReceiver.incomingStroke}
                  clearTrigger={studentAnnotationReceiver.clearTrigger}
                />
                {/* Lecturer text boxes (read-only) */}
                {lecturerTextBoxes.map((tb) => (
                  <div
                    key={tb.id}
                    className="absolute overflow-hidden whitespace-pre-wrap break-words pointer-events-none"
                    style={{
                      left: tb.x * canvasSize.width,
                      top: tb.y * canvasSize.height,
                      width: tb.width * canvasSize.width,
                      height: tb.height * canvasSize.height,
                      fontFamily: tb.fontFamily,
                      fontSize: tb.fontSize,
                      color: tb.color,
                      lineHeight: 1.3,
                      padding: 4,
                      zIndex: 10,
                      userSelect: 'none',
                    }}
                  >
                    {tb.content}
                  </div>
                ))}
                {/* Confusion area drawing layer */}
                {isConfused && drawingArea && (
                  <div
                    className="absolute inset-0 touch-none"
                    style={{ zIndex: 20, cursor: 'crosshair' }}
                    onPointerDown={handleSlidePointerDown}
                    onPointerMove={handleSlidePointerMove}
                    onPointerUp={handleSlidePointerUp}
                    onPointerCancel={handleSlidePointerUp}
                  >
                    {confusionHighlights.map((hl, i) => (
                      <div key={i} style={highlightStyle(hl)} />
                    ))}
                    {getDragPreviewStyle() && <div style={getDragPreviewStyle()!} />}
                  </div>
                )}
                {/* Show confusion highlights when not drawing */}
                {isConfused && !drawingArea && confusionHighlights.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
                    {confusionHighlights.map((hl, i) => (
                      <div key={i} style={highlightStyle(hl)} />
                    ))}
                  </div>
                )}
              </PdfViewer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-600">
                No slides uploaded
              </div>
            )}
          </div>

          {/* Slide navigation. Hidden in focus mode AND in landscape on phones
              — landscape phone viewports are vertically starved; every row of
              chrome crowds the slide. Re-shown at lg (desktop/tablet where
              row layout kicks in and there's room). */}
          <div className={`${focusMode ? 'hidden' : 'flex landscape:hidden lg:flex'} shrink-0 items-center justify-center gap-2 md:gap-3 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 py-2 md:py-2.5`}>
            <button onClick={() => goToSlide(0)} disabled={currentSlide === 0} className="rounded-lg p-2.5 md:p-1.5 text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 min-h-[40px] min-w-[40px]">⏮</button>
            <button onClick={() => goToSlide(currentSlide - 1)} disabled={currentSlide === 0} className="rounded-lg px-4 py-2.5 md:px-3 md:py-1.5 text-sm text-gray-600 dark:text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 min-h-[40px]">← Prev</button>
            <span className="min-w-[70px] text-center text-sm font-mono text-gray-500">
              {currentSlide + 1} / {totalSlides || '—'}
            </span>
            <button onClick={() => goToSlide(currentSlide + 1)} disabled={currentSlide >= totalSlides - 1} className="rounded-lg px-4 py-2.5 md:px-3 md:py-1.5 text-sm text-gray-600 dark:text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 min-h-[40px]">Next →</button>
            <button onClick={() => goToSlide(totalSlides - 1)} disabled={currentSlide >= totalSlides - 1} className="rounded-lg p-2.5 md:p-1.5 text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 min-h-[40px] min-w-[40px]">⏭</button>
          </div>
        </div>

        {/* Panel toggle (desktop only — vertical edge strip) */}
        <button
          onClick={() => setShowPanel((v) => !v)}
          className="hidden lg:flex shrink-0 w-6 items-center justify-center border-l border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300"
          title={showPanel ? 'Hide panel' : 'Show panel'}
        >
          <svg className={`h-4 w-4 transition-transform ${showPanel ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Reaction strip — always visible (even in focus mode), pinned in
            the thumb zone so students can tap without taking eyes off the
            lecturer. Spatial memory: buttons stay in the same position so
            the thumb finds them blind.
            On desktop the same buttons live inside the right panel instead
            (to free horizontal space for the slide), EXCEPT in focus mode
            where the panel is collapsed — then the strip comes back at the
            bottom, overlaid on the slide via fixed positioning (otherwise
            the parent `lg:flex-row` would squeeze it into a narrow column
            between slide and panel). */}
        <div className={`shrink-0 flex border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 ${
          focusMode
            ? 'lg:fixed lg:bottom-0 lg:inset-x-0 lg:z-30'
            : 'lg:hidden'
        }`}>
          {EMOJIS.map((e) => {
            const isSelected = selectedEmoji === e.id;
            const isFlashing = flashEmoji === e.id;
            return (
              <button
                key={e.id}
                onClick={() => handleEmojiSelect(e.id)}
                aria-label={e.label}
                aria-pressed={isSelected}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[64px] transition active:scale-95 ${
                  isSelected
                    ? `${e.active} border-t-2`
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                } ${isFlashing ? 'ring-4 ring-inset ring-blue-300 dark:ring-blue-600' : ''}`}
              >
                <span className="text-3xl leading-none">{e.emoji}</span>
                <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">{e.label}</span>
              </button>
            );
          })}
        </div>

        {/* Deferred-detail nudge — shown when a student has flagged
            confused/lost but not yet provided detail. Non-blocking, taps
            through to the Feedback tab. Students can ignore it — the emoji
            signal alone is already captured server-side. */}
        {isConfused && !confusionSent && !(showPanel && activeTab === 'feedback') && (
          <button
            onClick={() => { setActiveTab('feedback'); setShowPanel(true); }}
            className="lg:hidden shrink-0 flex items-center justify-center gap-2 border-t border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/30 px-4 py-2 text-xs font-medium text-yellow-800 dark:text-yellow-300 active:bg-yellow-100 dark:active:bg-yellow-900/50"
          >
            <span>💬</span>
            <span>Add detail? (optional)</span>
          </button>
        )}

        {/* Mobile tab bar — Q&A and Notes (Feedback moved to the always-on
            strip above; this tab still holds pace + confusion-detail). */}
        <div className={`${focusMode ? 'hidden' : 'flex landscape:hidden lg:hidden'} lg:hidden shrink-0 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900`}>
          {(['feedback', 'qa', 'notes'] as const).map((t) => {
            const label = t === 'feedback' ? 'Feedback' : t === 'qa' ? 'Q\u0026A' : 'Notes';
            const isActive = showPanel && activeTab === t;
            return (
              <button
                key={t}
                onClick={() => { setActiveTab(t); setShowPanel(true); }}
                className={`flex-1 py-3 text-sm font-semibold transition relative min-h-[48px] ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-t-2 border-blue-500'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {label}
                {t === 'qa' && myQuestions.some((q) => !q.answered) && (
                  <span className="absolute top-1 right-4 h-2 w-2 rounded-full bg-blue-500" />
                )}
              </button>
            );
          })}
          {showPanel && (
            <button
              onClick={() => setShowPanel(false)}
              className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 min-h-[48px] min-w-[48px]"
              title="Close panel"
              aria-label="Close panel"
            >
              ▼
            </button>
          )}
        </div>

        {/* Right panel (desktop sidebar) / bottom drawer (mobile).
            Hidden entirely in fullscreen so it can't partially overlap the slide
            and leave the user stuck with half-visible emoji buttons. */}
        <div className={`flex shrink-0 flex-col border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden transition-all duration-200 ${focusMode ? 'hidden lg:flex' : ''} ${
          showPanel
            ? 'h-[55dvh] landscape:h-[40dvh] lg:!h-full lg:w-72'
            : 'h-0 lg:!h-full lg:w-0 lg:border-l-0'
        }`}>
          {/* Mobile / tablet rendering — the existing tab-based content
              (one panel visible at a time, chosen via the bottom tab bar).
              Desktop uses a three-section stacked layout further below so
              the full sidebar height isn't wasted on a single panel. */}
          <div className="flex flex-1 flex-col overflow-hidden lg:hidden">
          {activeTab === 'qa' ? (
            /* Q&A panel */
            <div className="flex flex-1 flex-col overflow-hidden p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ask a question</h3>
                <button onClick={() => setActiveTab('feedback')} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 md:inline hidden">✕</button>
              </div>
              <form onSubmit={handleQuestion} className="space-y-3">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Type your question…"
                  aria-label="Your question for the lecturer"
                  rows={3}
                  maxLength={500}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-sm text-gray-900 dark:text-gray-100 outline-none resize-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-800"
                />
                {questionError && <p className="text-xs text-red-500">{questionError}</p>}
                {questionSent && <p className="text-xs text-green-600">Question sent ✓</p>}
                <button
                  type="submit"
                  disabled={!question.trim()}
                  className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40 min-h-[44px]"
                >
                  Send question
                </button>
              </form>

              {/* My submitted questions */}
              {myQuestions.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">My questions</h4>
                  {myQuestions.map((q) => (
                    <div key={q.id} className={`rounded-lg border p-2.5 text-sm ${q.answered ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'}`}>
                      <p className="text-gray-700 dark:text-gray-300">{q.content}</p>
                      <p className={`mt-1 text-[10px] font-medium ${q.answered ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                        {q.answered ? 'Answered' : 'Waiting for answer...'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : activeTab === 'notes' ? (
            /* Notes panel — dedicated, full-height textarea */
            <div className="flex flex-1 flex-col overflow-hidden p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notes — slide {currentSlide + 1}</h3>
                {noteSaving && <span className="text-xs text-gray-400">Saving…</span>}
              </div>
              <textarea
                value={note}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder="Your notes for this slide. Saves automatically."
                aria-label={`Notes for slide ${currentSlide + 1}`}
                className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 p-3 text-base text-gray-900 dark:text-gray-100 outline-none transition focus:border-blue-400 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-800"
              />
            </div>
          ) : (
            /* Feedback panel — emoji, confusion, pace */
            <div className="flex flex-1 flex-col overflow-y-auto p-4 space-y-4">
              {/* Emoji feedback — hidden below lg because the always-on
                  reaction strip below the slide already handles this. Kept
                  for desktop/large-tablet where there's no strip. */}
              <div className="hidden lg:block">
                <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">How are you doing?</h3>
                <div className="grid grid-cols-2 gap-2">
                  {EMOJIS.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => handleEmojiSelect(e.id)}
                      className={`flex flex-col items-center gap-0.5 rounded-xl border py-2.5 transition active:scale-95 ${
                        selectedEmoji === e.id ? e.active : e.color
                      }`}
                    >
                      <span className="text-2xl">{e.emoji}</span>
                      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{e.label}</span>
                    </button>
                  ))}
                </div>
                {!selectedEmoji && (
                  <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                    Select your understanding for this slide
                  </p>
                )}
              </div>

              {/* Inline confusion context — mobile-friendly taps, auto-closes panel when marking */}
              {isConfused && !confusionSent && (
                <div className="rounded-xl border border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 p-3 space-y-3">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                    What's confusing? <span className="font-normal text-yellow-600 dark:text-yellow-400">(optional)</span>
                  </p>

                  {/* Shape toggle — shown only when marking; separate from the "Mark area" CTA */}
                  {drawingArea && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-yellow-700 dark:text-yellow-400">Shape:</span>
                      <button onClick={() => setConfusionShape('rect')}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium min-h-[36px] min-w-[44px] ${confusionShape === 'rect' ? 'bg-red-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-500 ring-1 ring-gray-200 dark:ring-gray-700'}`}>▭</button>
                      <button onClick={() => setConfusionShape('circle')}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium min-h-[36px] min-w-[44px] ${confusionShape === 'circle' ? 'bg-red-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-500 ring-1 ring-gray-200 dark:ring-gray-700'}`}>○</button>
                      {confusionHighlights.length > 0 && (
                        <button onClick={() => setConfusionHighlights([])} className="ml-auto text-xs text-gray-500 hover:text-gray-700 min-h-[36px] px-2">Clear</button>
                      )}
                    </div>
                  )}

                  {/* Big Mark area CTA — closes the panel so the slide is visible for drawing */}
                  <button
                    onClick={() => {
                      const next = !drawingArea;
                      setDrawingArea(next);
                      if (next) setShowPanel(false);
                    }}
                    className={`w-full rounded-xl border-2 py-3 text-sm font-semibold transition min-h-[48px] ${
                      drawingArea
                        ? 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                        : 'border-dashed border-yellow-400 bg-white dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-300 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                    }`}
                  >
                    {drawingArea
                      ? (confusionHighlights.length > 0 ? 'Marked — drag again to change' : 'Drag on the slide to mark')
                      : 'Mark a confusing area on the slide'}
                  </button>

                  <textarea value={confusionText} onChange={(e) => setConfusionText(e.target.value)}
                    placeholder="e.g. I don't understand the formula..." maxLength={500} rows={3}
                    aria-label="Describe what is confusing about this slide"
                    className="w-full resize-none rounded-xl border border-yellow-200 dark:border-yellow-700 bg-white dark:bg-gray-800 px-3 py-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-100 dark:focus:ring-yellow-900/40" />

                  <button onClick={handleConfusionSubmit}
                    disabled={!confusionText.trim() && confusionHighlights.length === 0}
                    className="w-full rounded-xl bg-yellow-600 py-3 text-sm font-semibold text-white transition hover:bg-yellow-700 disabled:opacity-40 min-h-[48px]">
                    Send feedback
                  </button>
                </div>
              )}
              {isConfused && confusionSent && (
                <p className="text-center text-xs text-green-600">Feedback sent ✓</p>
              )}

              {/* Pace indicator */}
              <div>
                <h3 className="mb-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Pace</h3>
                <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {([
                    { value: 'slow' as PaceValue, label: 'Too slow', icon: '🐢' },
                    { value: 'ok' as PaceValue, label: 'Just right', icon: '👌' },
                    { value: 'fast' as PaceValue, label: 'Too fast', icon: '🏃' },
                  ]).map((p) => (
                    <button key={p.value} onClick={() => handlePaceChange(p.value)}
                      className={`flex-1 py-3 text-center text-xs transition min-h-[56px] ${
                        pace === p.value
                          ? 'bg-blue-600 text-white font-semibold'
                          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100'
                      }`}>
                      <span className="block text-sm">{p.icon}</span>
                      <span className="block mt-0.5">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

            </div>
          )}
          </div>

          {/* Desktop stacked sidebar — Feedback on top (shrink-0), Notes in
              the middle (flex-1 so the textarea fills the bulk of the sidebar),
              Q&A at the bottom as a collapsible drawer. Avoids tab-switching
              for the two most frequent interactions (reacting + taking notes). */}
          <div className="hidden lg:flex flex-1 flex-col overflow-hidden min-h-0">
            {/* Feedback — always visible for one-tap reactions */}
            <div className="shrink-0 border-b border-gray-100 dark:border-gray-800 p-4 space-y-3">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">How are you doing?</h3>
                <div className="grid grid-cols-2 gap-2">
                  {EMOJIS.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => handleEmojiSelect(e.id)}
                      className={`flex flex-col items-center gap-0.5 rounded-xl border py-2.5 transition active:scale-95 ${
                        selectedEmoji === e.id ? e.active : e.color
                      }`}
                    >
                      <span className="text-2xl">{e.emoji}</span>
                      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{e.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {isConfused && !confusionSent && (
                <div className="rounded-xl border border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 p-3 space-y-3">
                  <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
                    What's confusing? <span className="font-normal text-yellow-600 dark:text-yellow-400">(optional)</span>
                  </p>
                  {drawingArea && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-yellow-700 dark:text-yellow-400">Shape:</span>
                      <button onClick={() => setConfusionShape('rect')}
                        className={`rounded-lg px-2.5 py-1 text-sm font-medium ${confusionShape === 'rect' ? 'bg-red-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-500 ring-1 ring-gray-200 dark:ring-gray-700'}`}>▭</button>
                      <button onClick={() => setConfusionShape('circle')}
                        className={`rounded-lg px-2.5 py-1 text-sm font-medium ${confusionShape === 'circle' ? 'bg-red-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-500 ring-1 ring-gray-200 dark:ring-gray-700'}`}>○</button>
                      {confusionHighlights.length > 0 && (
                        <button onClick={() => setConfusionHighlights([])} className="ml-auto text-xs text-gray-500 hover:text-gray-700 px-2">Clear</button>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      const next = !drawingArea;
                      setDrawingArea(next);
                      if (next) setShowPanel(false);
                    }}
                    className={`w-full rounded-xl border-2 py-2 text-xs font-semibold transition ${
                      drawingArea
                        ? 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                        : 'border-dashed border-yellow-400 bg-white dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-300 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                    }`}
                  >
                    {drawingArea
                      ? (confusionHighlights.length > 0 ? 'Marked — drag again to change' : 'Drag on the slide to mark')
                      : 'Mark a confusing area on the slide'}
                  </button>
                  <textarea value={confusionText} onChange={(e) => setConfusionText(e.target.value)}
                    placeholder="e.g. I don't understand the formula..." maxLength={500} rows={2}
                    className="w-full resize-none rounded-xl border border-yellow-200 dark:border-yellow-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-100 dark:focus:ring-yellow-900/40" />
                  <button onClick={handleConfusionSubmit}
                    disabled={!confusionText.trim() && confusionHighlights.length === 0}
                    className="w-full rounded-xl bg-yellow-600 py-2 text-xs font-semibold text-white transition hover:bg-yellow-700 disabled:opacity-40">
                    Send feedback
                  </button>
                </div>
              )}
              {isConfused && confusionSent && (
                <p className="text-center text-xs text-green-600">Feedback sent ✓</p>
              )}

              <div>
                <h3 className="mb-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Pace</h3>
                <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {([
                    { value: 'slow' as PaceValue, label: 'Too slow', icon: '🐢' },
                    { value: 'ok' as PaceValue, label: 'Just right', icon: '👌' },
                    { value: 'fast' as PaceValue, label: 'Too fast', icon: '🏃' },
                  ]).map((p) => (
                    <button key={p.value} onClick={() => handlePaceChange(p.value)}
                      className={`flex-1 py-2 text-center text-[11px] transition ${
                        pace === p.value
                          ? 'bg-blue-600 text-white font-semibold'
                          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}>
                      <span className="block text-sm">{p.icon}</span>
                      <span className="block mt-0.5">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Notes — flex-1 so the textarea owns the bulk of the sidebar */}
            <div className="flex flex-1 flex-col overflow-hidden min-h-0 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notes — slide {currentSlide + 1}</h3>
                {noteSaving && <span className="text-xs text-gray-400">Saving…</span>}
              </div>
              <textarea
                value={note}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder="Your notes for this slide. Saves automatically."
                className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 p-3 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-blue-400 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-800"
              />
            </div>

            {/* Q&A — collapsible footer. Collapsed by default so Notes owns
                the real estate; expands to ~45% max when asking. */}
            <div className={`shrink-0 border-t border-gray-100 dark:border-gray-800 ${qaExpanded ? 'flex flex-col min-h-0 max-h-[45%]' : ''}`}>
              <button
                onClick={() => setQaExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                <span className="flex items-center gap-2">
                  <span>Q&amp;A</span>
                  {myQuestions.some((q) => !q.answered) && (
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                  )}
                  {myQuestions.length > 0 && (
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">{myQuestions.length}</span>
                  )}
                </span>
                <svg className={`h-4 w-4 text-gray-400 transition-transform ${qaExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {qaExpanded && (
                <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
                  <form onSubmit={handleQuestion} className="space-y-2">
                    <textarea
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Type your question…"
                      aria-label="Your question for the lecturer"
                      rows={2}
                      maxLength={500}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none resize-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-800"
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
                  {myQuestions.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">My questions</h4>
                      {myQuestions.map((q) => (
                        <div key={q.id} className={`rounded-lg border p-2 text-xs ${q.answered ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'}`}>
                          <p className="text-gray-700 dark:text-gray-300">{q.content}</p>
                          <p className={`mt-1 text-[10px] font-medium ${q.answered ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                            {q.answered ? 'Answered' : 'Waiting for answer…'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating exit-fullscreen button (only when in focus mode). Tap anywhere
          on the slide area also exits — handled on the slide container below.
          Desktop-only keyboard hint sits next to it; phones don't have a
          keyboard so we skip the hint there to avoid clutter. */}
      {focusMode && (
        <>
          <button
            onClick={() => exitFullscreen()}
            className="fixed top-3 right-3 z-40 rounded-full bg-black/60 p-3 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/80 active:scale-95 min-h-[44px] min-w-[44px]"
            title="Exit fullscreen (Esc)"
            aria-label="Exit fullscreen"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {/* Exit-fullscreen: corners face center */}
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8H8V4 M16 4V8H20 M20 16H16V20 M8 20V16H4" />
            </svg>
          </button>
          <div className="pointer-events-none fixed top-3 right-20 z-40 hidden lg:block rounded-full bg-black/50 px-3 py-1.5 text-[10px] tracking-wide text-white/75 backdrop-blur-sm">
            F / Esc to exit · ← → to navigate
          </div>
        </>
      )}

      {/* Floating "Done marking" CTA — appears when the user is marking but the panel is closed */}
      {isConfused && !confusionSent && drawingArea && !showPanel && (
        <button
          onClick={() => { setShowPanel(true); setActiveTab('feedback'); }}
          className="fixed bottom-20 md:bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-yellow-600 px-5 py-3 text-sm font-semibold text-white shadow-lg ring-1 ring-yellow-700 transition active:scale-95 min-h-[48px]"
        >
          {confusionHighlights.length > 0
            ? 'Done — add details'
            : 'Skip marking — add details'}
        </button>
      )}

      {/* Request pen modal */}
      <RequestPenModal
        open={showAccessForm && annotationAccess.status === 'idle'}
        onClose={() => setShowAccessForm(false)}
        onSubmit={(reason) => {
          annotationAccess.requestAccess(reason);
          setShowAccessForm(false);
        }}
      />

      {/* Poll overlay */}
      {/* Active poll — minimizable so students can see the slide while it's up */}
      {activePoll && activePoll.status === 'active' && !pollMinimized && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-900 p-5 sm:p-6 shadow-2xl ring-1 ring-transparent dark:ring-gray-800">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{activePoll.question}</h3>
              <button
                onClick={() => setPollMinimized(true)}
                className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[40px] min-w-[40px]"
                title="Minimise poll"
                aria-label="Minimise poll"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            <div className="space-y-2">
              {activePoll.options.map((opt, i) => (
                <button key={i} onClick={() => handlePollAnswer(i)}
                  className={`w-full rounded-xl border px-4 py-3.5 text-left text-sm transition active:scale-[0.98] min-h-[52px] ${
                    pollAnswer === i
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 font-semibold text-blue-700 dark:text-blue-300 ring-2 ring-blue-100 dark:ring-blue-900/50'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  }`}>
                  <span className="mr-2 font-mono text-xs text-gray-400">{String.fromCharCode(65 + i)}.</span>
                  {opt}
                </button>
              ))}
            </div>
            {pollAnswer !== null && (
              <div className="mt-4 text-center">
                <p className="text-xs text-green-600 dark:text-green-400">Response submitted — you can change it until the poll closes.</p>
                <button onClick={() => setPollMinimized(true)}
                  className="mt-3 w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 min-h-[44px]">
                  Continue to slides
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Minimized poll pill — tap to re-open */}
      {activePoll && activePoll.status === 'active' && pollMinimized && (
        <button
          onClick={() => setPollMinimized(false)}
          className="fixed bottom-20 md:bottom-6 left-1/2 z-40 -translate-x-1/2 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg ring-1 ring-blue-700 transition active:scale-95 min-h-[44px]"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          {pollAnswer === null ? 'Poll open — tap to answer' : 'Poll open — change your answer'}
        </button>
      )}

      {/* Poll results overlay (shown when closed) */}
      {pollResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-2xl ring-1 ring-transparent dark:ring-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">{pollResults.question}</h3>
            <div className="space-y-2">
              {pollResults.options.map((opt, i) => {
                const pct = pollResults.totalResponses > 0 ? Math.round((pollResults.counts[i] / pollResults.totalResponses) * 100) : 0;
                return (
                  <div key={i} className="relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
                    <div className="absolute inset-y-0 left-0 bg-blue-100 dark:bg-blue-900/40 transition-all" style={{ width: `${pct}%` }} />
                    <div className="relative flex justify-between text-sm">
                      <span className={pollAnswer === i ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}>
                        {String.fromCharCode(65 + i)}. {opt}
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-center text-xs text-gray-400">{pollResults.totalResponses} responses</p>
            <button onClick={() => { setActivePoll(null); setPollResults(null); }}
              className="mt-4 w-full rounded-lg bg-gray-100 dark:bg-gray-800 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-200 dark:hover:bg-gray-700">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
