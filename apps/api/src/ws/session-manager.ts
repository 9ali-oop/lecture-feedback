import type { WSContext } from 'hono/ws';
import type {
  Emoji,
  FeedbackDistribution,
  WsServerMessage,
  Question,
  Annotation,
  DrawToolType,
  Poll,
  PollResults,
  PaceValue,
  PaceDistribution,
} from '@lecture-feedback/shared';
import { db } from '../db/index.js';
import { feedbackEvents, modules, moduleEnrollments, sessionParticipants, sessions, slideTimings } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { computeSlideEngagement } from '../lib/engagement.js';

interface StudentState {
  ws: WSContext;
  userId: string;
  name: string;
  currentEmoji: Emoji | null;
  emojiSelectedAt: number | null;
  slideIndex: number;
}

interface AnnotationAccessRequest {
  studentId: string;
  studentName: string;
  reason: string;
  requestedAt: number;
}

interface SessionRoom {
  lecturerWs: WSContext | null;
  lecturerUserId: string | null;
  students: Map<string, StudentState>; // userId -> state
  currentSlide: number;
  totalSlides: number;
  autoEndTimer: ReturnType<typeof setTimeout> | null;
  annotations: Map<number, Annotation[]>;
  sessionStartTime: number;
  annotationAccessQueue: AnnotationAccessRequest[];
  grantedAnnotator: { studentId: string; studentName: string } | null;
  paceFeedback: Map<string, PaceValue>; // studentId -> current pace value
  // Engagement tracking
  questionCounts: Map<number, number>;  // slideIndex -> count
  confusionCounts: Map<number, number>; // slideIndex -> count
  noteActivity: Map<number, Set<string>>; // slideIndex -> Set<studentId>
  engagementTimer: ReturnType<typeof setInterval> | null;
}

function send(ws: WSContext, msg: WsServerMessage) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // connection already closed
  }
}

// Incoming WS frames are JSON.parse + type-asserted, not validated. A
// lecturer or granted annotator could send a DRAW_STROKE with a 10 M-point
// array; we'd store it in room.annotations AND fan-out to every student in
// the room — OOM-ing the server. Cap at a size that dwarfs any legitimate
// pen stroke (~100 points for a few-second scribble at 60 Hz).
const MAX_STROKE_POINTS = 5_000;
const MAX_COLOR_LEN = 32; // CSS colours are rgb(…)/#hex — 32 chars is plenty
// Hard ceiling for slideIndex even when we don't know totalSlides yet. A
// malicious client could otherwise send `slideIndex: 9e9` and use it as a
// Map key in room.annotations / noteActivity / confusionCounts — every
// unique value adds a Map entry that survives the room. Caps the per-room
// memory footprint for per-slide state maps. A deck that big doesn't exist.
const MAX_SLIDE_INDEX = 10_000;

function isValidSlideIndex(slideIndex: unknown, totalSlides: number): slideIndex is number {
  if (typeof slideIndex !== 'number' || !Number.isInteger(slideIndex)) return false;
  if (slideIndex < 0 || slideIndex > MAX_SLIDE_INDEX) return false;
  if (totalSlides > 0 && slideIndex >= totalSlides) return false;
  return true;
}

function isValidStroke(
  points: unknown,
  color?: unknown,
  width?: unknown,
): points is { x: number; y: number }[] {
  if (!Array.isArray(points) || points.length === 0 || points.length > MAX_STROKE_POINTS) return false;
  for (const p of points) {
    if (!p || typeof p !== 'object') return false;
    const { x, y } = p as { x: unknown; y: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  }
  if (color !== undefined && (typeof color !== 'string' || color.length > MAX_COLOR_LEN)) return false;
  if (width !== undefined && (typeof width !== 'number' || !Number.isFinite(width) || width < 0 || width > 1)) return false;
  return true;
}

function computeDistribution(room: SessionRoom): FeedbackDistribution {
  const dist: FeedbackDistribution = { got_it: 0, neutral: 0, confused: 0, lost: 0, total: 0 };
  for (const s of room.students.values()) {
    if (s.currentEmoji) {
      dist[s.currentEmoji]++;
      dist.total++;
    }
  }
  return dist;
}

// Manages all live lecture sessions in memory.
// Each session gets its own "room" with a lecturer and connected students.
// Might need to swap this for Redis if we ever run multiple server instances.
export class SessionManager {
  private rooms = new Map<string, SessionRoom>();
  private dashboardClients = new Map<string, WSContext>(); // userId -> ws

  hasRoom(sessionId: string): boolean {
    return this.rooms.has(sessionId);
  }

  private getOrCreate(sessionId: string): SessionRoom {
    if (!this.rooms.has(sessionId)) {
      // Load current state from DB asynchronously - set defaults first, update after
      this.rooms.set(sessionId, {
        lecturerWs: null,
        lecturerUserId: null,
        students: new Map(),
        currentSlide: 0,
        totalSlides: 0,
        autoEndTimer: null,
        annotations: new Map(),
        sessionStartTime: Date.now(),
        annotationAccessQueue: [],
        grantedAnnotator: null,
        paceFeedback: new Map(),
        questionCounts: new Map(),
        confusionCounts: new Map(),
        noteActivity: new Map(),
        engagementTimer: null,
      });
    }
    return this.rooms.get(sessionId)!;
  }

  private broadcastToStudents(room: SessionRoom, msg: WsServerMessage) {
    for (const student of room.students.values()) {
      send(student.ws, msg);
    }
  }

  private broadcastToAll(room: SessionRoom, msg: WsServerMessage) {
    if (room.lecturerWs) send(room.lecturerWs, msg);
    for (const student of room.students.values()) {
      send(student.ws, msg);
    }
  }

  // ── Dashboard connections (students watching for live sessions) ──────────

  joinDashboard(userId: string, ws: WSContext) {
    // Same stale-close defence as joinAsStudent/joinAsLecturer: if the user
    // already has a dashboard socket (e.g. StrictMode double-mount or the 3s
    // auto-reconnect), close the old one so its late onClose becomes a no-op
    // instead of wiping the fresh connection out of the map.
    const existing = this.dashboardClients.get(userId);
    if (existing && existing !== ws) {
      try { existing.close(); } catch { /* already closed */ }
    }
    this.dashboardClients.set(userId, ws);
  }

  disconnectDashboard(userId: string, ws?: WSContext) {
    const current = this.dashboardClients.get(userId);
    // Identity guard — stale onClose from a superseded socket is a no-op.
    if (ws && current && current !== ws) return;
    this.dashboardClients.delete(userId);
  }

  /**
   * Fan-out dashboard notifications to users who have access to the module.
   * Previously we broadcast to every connected dashboard client, which leaked
   * the existence of every live session in the system to every student —
   * including modules they aren't enrolled in. Now we check each recipient
   * against the module's lecturer + enrolled students before sending.
   *
   * Cost is one DB query per broadcast (rare events — session start / end),
   * filtered in-memory against the set of currently-connected dashboards.
   */
  private async fanoutToModuleAudience(moduleId: string, msg: WsServerMessage) {
    if (this.dashboardClients.size === 0) return;
    const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId));
    if (!mod) return;
    const enrolled = await db
      .select({ studentId: moduleEnrollments.studentId })
      .from(moduleEnrollments)
      .where(eq(moduleEnrollments.moduleId, moduleId));
    const allowed = new Set<string>([mod.lecturerId, ...enrolled.map((e) => e.studentId)]);
    for (const [userId, ws] of this.dashboardClients) {
      if (allowed.has(userId)) send(ws, msg);
    }
  }

  notifySessionLive(sessionId: string, moduleId: string, title: string) {
    const msg: WsServerMessage = { type: 'SESSION_LIVE', sessionId, moduleId, title };
    void this.fanoutToModuleAudience(moduleId, msg);
  }

  async notifySessionEnded(sessionId: string) {
    // Need the moduleId to filter. Look it up from the session row.
    const [sess] = await db.select({ moduleId: sessions.moduleId }).from(sessions).where(eq(sessions.id, sessionId));
    if (!sess) return;
    const msg: WsServerMessage = { type: 'SESSION_ENDED_DASHBOARD', sessionId };
    await this.fanoutToModuleAudience(sess.moduleId, msg);
  }

  async joinAsLecturer(sessionId: string, userId: string, ws: WSContext) {
    const room = this.getOrCreate(sessionId);

    // If a previous lecturer socket is still registered (reconnect before its
    // onClose fired), close it so the stale onClose becomes a guarded no-op
    // instead of wiping out the fresh connection.
    if (room.lecturerWs && room.lecturerWs !== ws) {
      try { room.lecturerWs.close(); } catch { /* already closed */ }
    }

    room.lecturerWs = ws;
    room.lecturerUserId = userId;

    // Sync room state from DB (in case server restarted)
    const [sess] = await db.select({ currentSlideIndex: sessions.currentSlideIndex, totalSlides: sessions.totalSlides })
      .from(sessions).where(eq(sessions.id, sessionId));
    if (sess) {
      room.currentSlide = sess.currentSlideIndex;
      room.totalSlides = sess.totalSlides;
    }

    // Start timing for the current slide
    await db.insert(slideTimings).values({
      sessionId,
      slideIndex: room.currentSlide,
      startedAt: new Date(),
    }).onConflictDoNothing();

    // Send current state
    send(ws, {
      type: 'SLIDE_UPDATE',
      slideIndex: room.currentSlide,
      totalSlides: room.totalSlides,
    });
    send(ws, {
      type: 'PARTICIPANT_COUNT',
      active: room.students.size,
      total: room.students.size,
    });
    send(ws, { type: 'FEEDBACK_UPDATE', distribution: computeDistribution(room) });

    // Send annotation access state (for reconnection)
    this.sendAnnotationAccessState(room);

    // Notify students that the lecturer has reconnected
    this.broadcastToStudents(room, { type: 'LECTURER_RECONNECTED' });

    // Start engagement scoring timer (every 10 seconds)
    this.startEngagementTimer(sessionId, room);
  }

  private startEngagementTimer(sessionId: string, room: SessionRoom) {
    if (room.engagementTimer) clearInterval(room.engagementTimer);
    room.engagementTimer = setInterval(() => {
      if (!room.lecturerWs) return;

      // Always keep participant count in sync
      send(room.lecturerWs, {
        type: 'PARTICIPANT_COUNT',
        active: room.students.size,
        total: room.students.size,
      });

      if (room.students.size === 0) return;

      const dist = computeDistribution(room);
      // Don't broadcast engagement if no one has voted on current slide yet
      if (dist.total === 0) return;
      const paceDist = { slow: 0, ok: 0, fast: 0, total: 0 };
      for (const v of room.paceFeedback.values()) {
        paceDist[v]++;
        paceDist.total++;
      }
      const eng = computeSlideEngagement({
        distribution: dist,
        paceDistribution: paceDist,
        questionCount: room.questionCounts.get(room.currentSlide) ?? 0,
        confusionReports: room.confusionCounts.get(room.currentSlide) ?? 0,
        studentsWithNotes: room.noteActivity.get(room.currentSlide)?.size ?? 0,
        participantCount: room.students.size,
      });
      send(room.lecturerWs, {
        type: 'ENGAGEMENT_UPDATE',
        score: eng.overall,
        signals: eng.signals,
        slideIndex: room.currentSlide,
      });
    }, 10_000);
  }

  async joinAsStudent(
    sessionId: string,
    userId: string,
    name: string,
    ws: WSContext,
  ) {
    const room = this.getOrCreate(sessionId);

    // Sync room state from DB (in case server restarted)
    if (room.totalSlides === 0) {
      const [sess] = await db.select({ currentSlideIndex: sessions.currentSlideIndex, totalSlides: sessions.totalSlides })
        .from(sessions).where(eq(sessions.id, sessionId));
      if (sess) {
        room.currentSlide = sess.currentSlideIndex;
        room.totalSlides = sess.totalSlides;
      }
    }

    // If the same student already has a live socket (e.g. flaky network
    // triggered a reconnect before the old socket's onClose fired, or a
    // duplicate tab), close the stale one. Without this the old socket's
    // eventual onClose would evict the student from the room even though
    // their new socket is still connected — causing the active-user count
    // to flicker down and silently dropping their feedback.
    const existing = room.students.get(userId);
    if (existing && existing.ws !== ws) {
      try { existing.ws.close(); } catch { /* already closed */ }
    }

    room.students.set(userId, {
      ws,
      userId,
      name,
      currentEmoji: null,
      emojiSelectedAt: null,
      slideIndex: room.currentSlide,
    });

    // Record participation in DB. If the session or user was deleted between
    // the WS handshake and here (e.g. dev cleanup, test teardown, or a bug),
    // we swallow the FK error so the process doesn't crash.
    try {
      await db.insert(sessionParticipants).values({ sessionId, studentId: userId }).onConflictDoNothing();
    } catch (err) {
      console.warn(`[session-manager] could not record participation for ${userId} in ${sessionId}:`, (err as Error).message);
    }

    // Send current slide to student
    send(ws, {
      type: 'SLIDE_UPDATE',
      slideIndex: room.currentSlide,
      totalSlides: room.totalSlides,
    });

    // Send current annotations for this slide
    send(ws, {
      type: 'ANNOTATION_SYNC',
      slideIndex: room.currentSlide,
      annotations: room.annotations.get(room.currentSlide) ?? [],
    });

    // Notify lecturer
    if (room.lecturerWs) {
      send(room.lecturerWs, {
        type: 'PARTICIPANT_COUNT',
        active: room.students.size,
        total: room.students.size,
      });
    }
  }

  handleSlideChange(sessionId: string, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    // Clamp to a valid range. Without this, a buggy client can persist an
    // out-of-range slideIndex (e.g. "slide 8 on a 5-slide deck") which then
    // corrupts per-slide feedback analytics. If totalSlides is 0 (no PDF yet),
    // we have nothing to clamp against, so only guard against negatives.
    const clamped = room.totalSlides > 0
      ? Math.max(0, Math.min(slideIndex, room.totalSlides - 1))
      : Math.max(0, slideIndex);

    // Persist the clamped value (fire-and-forget — errors are logged only).
    // Single source of truth: callers should NOT also write to the DB.
    db.update(sessions).set({ currentSlideIndex: clamped }).where(eq(sessions.id, sessionId)).catch(console.error);

    const prevSlide = room.currentSlide;
    const now = new Date();
    room.currentSlide = clamped;
    slideIndex = clamped;

    // Close timing for previous slide, open timing for new slide
    db.update(slideTimings)
      .set({ endedAt: now })
      .where(and(eq(slideTimings.sessionId, sessionId), eq(slideTimings.slideIndex, prevSlide), isNull(slideTimings.endedAt)))
      .catch(console.error);
    db.insert(slideTimings)
      .values({ sessionId, slideIndex, startedAt: now })
      .catch(console.error);

    // Flush current emoji durations to DB for the previous slide
    this.flushFeedback(sessionId, room, prevSlide);

    // Reset all student emoji states for new slide
    for (const student of room.students.values()) {
      student.currentEmoji = null;
      student.emojiSelectedAt = null;
      student.slideIndex = slideIndex;
    }

    // Broadcast new slide to all students
    const msg: WsServerMessage = {
      type: 'SLIDE_UPDATE',
      slideIndex,
      totalSlides: room.totalSlides,
    };
    for (const student of room.students.values()) {
      send(student.ws, msg);
    }

    // Send annotations for the new slide
    this.broadcastToStudents(room, {
      type: 'ANNOTATION_SYNC',
      slideIndex,
      annotations: room.annotations.get(slideIndex) ?? [],
    });

    // Reset distribution for new slide
    if (room.lecturerWs) {
      send(room.lecturerWs, {
        type: 'FEEDBACK_UPDATE',
        distribution: { got_it: 0, neutral: 0, confused: 0, lost: 0, total: 0 },
      });
    }

    // Revoke annotation access and clear student annotations
    this.revokeAllAnnotationAccess(room, 'slide_change');
    this.broadcastToAll(room, { type: 'STUDENT_CLEAR_ANNOTATIONS', slideIndex });
    this.sendAnnotationAccessState(room);
  }

  handleFeedback(sessionId: string, studentId: string, emoji: Emoji, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    const student = room.students.get(studentId);
    if (!student) return;

    // Runtime emoji validation. The TS union only constrains the compiler —
    // a raw WS client can send any string. The DB enum would reject it at
    // insert time, but that throws inside a fire-and-forget .catch which
    // still noises up the logs. Reject up front.
    if (emoji !== 'got_it' && emoji !== 'neutral' && emoji !== 'confused' && emoji !== 'lost') {
      return;
    }

    // Reject malformed slideIndex outright (NaN/Infinity/non-integer). The
    // clamp below copes with out-of-range integers but Math.max/min with NaN
    // silently propagates NaN into the DB insert, which then throws at the
    // integer column. Reject up front so the socket stays quiet.
    if (typeof slideIndex !== 'number' || !Number.isInteger(slideIndex)) return;

    // Clamp to room's deck range. Without this, a client can claim feedback
    // on an arbitrary slide (including negative or beyond totalSlides),
    // polluting per-slide analytics forever.
    const clampedSlide = room.totalSlides > 0
      ? Math.max(0, Math.min(slideIndex, room.totalSlides - 1))
      : Math.max(0, slideIndex);

    const now = Date.now();

    // Persist the previous emoji with duration
    if (student.currentEmoji && student.emojiSelectedAt) {
      const duration = now - student.emojiSelectedAt;
      db.insert(feedbackEvents)
        .values({
          sessionId,
          studentId,
          slideIndex: student.slideIndex,
          emoji: student.currentEmoji,
          durationMs: duration,
        })
        .catch(console.error);
    }

    student.currentEmoji = emoji;
    student.emojiSelectedAt = now;
    student.slideIndex = clampedSlide;

    // Broadcast updated distribution to lecturer
    if (room.lecturerWs) {
      send(room.lecturerWs, {
        type: 'FEEDBACK_UPDATE',
        distribution: computeDistribution(room),
      });
    }
  }

  handleNewQuestion(sessionId: string, question: Question) {
    const room = this.rooms.get(sessionId);
    if (!room?.lecturerWs) return;
    // Track question count for engagement scoring
    room.questionCounts.set(room.currentSlide, (room.questionCounts.get(room.currentSlide) ?? 0) + 1);
    send(room.lecturerWs, { type: 'NEW_QUESTION', question });
  }

  handleQuestionAnswered(sessionId: string, questionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    // Notify all students
    for (const student of room.students.values()) {
      send(student.ws, { type: 'QUESTION_ANSWERED', questionId });
    }
  }

  // ── Poll broadcasts ──────────────────────────────────────────────────────

  broadcastPoll(sessionId: string, poll: Poll) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    this.broadcastToStudents(room, { type: 'POLL_LAUNCHED', poll });
    if (room.lecturerWs) send(room.lecturerWs, { type: 'POLL_LAUNCHED', poll });
  }

  broadcastPollResults(sessionId: string, results: PollResults) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    // Only send to lecturer (students see after close or via their own response)
    if (room.lecturerWs) send(room.lecturerWs, { type: 'POLL_RESULTS', results });
  }

  broadcastPollClosed(sessionId: string, pollId: string, results: PollResults) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    const msg: WsServerMessage = { type: 'POLL_CLOSED', pollId, results };
    if (room.lecturerWs) send(room.lecturerWs, msg);
    this.broadcastToStudents(room, msg);
  }

  // ── Pace feedback ───────────────────────────────────────────────────────

  handlePaceFeedback(sessionId: string, studentId: string, value: PaceValue) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    // Runtime guard — see handleFeedback for why.
    if (value !== 'slow' && value !== 'ok' && value !== 'fast') return;
    room.paceFeedback.set(studentId, value);
    // Compute distribution and send to lecturer
    if (room.lecturerWs) {
      const dist: PaceDistribution = { slow: 0, ok: 0, fast: 0, total: 0 };
      for (const v of room.paceFeedback.values()) {
        dist[v]++;
        dist.total++;
      }
      send(room.lecturerWs, { type: 'PACE_UPDATE', distribution: dist });
    }
  }

  // ── Question upvotes ────────────────────────────────────────────────────

  broadcastUpvote(sessionId: string, questionId: string, upvoteCount: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    const msg: WsServerMessage = { type: 'QUESTION_UPVOTED', questionId, upvoteCount };
    if (room.lecturerWs) send(room.lecturerWs, msg);
    this.broadcastToStudents(room, msg);
  }

  handleTextBoxSync(sessionId: string, slideIndex: number, textBoxes: Array<{ id: string; x: number; y: number; width: number; height: number; content: string; fontFamily: string; fontSize: number; color: string }>) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    // Reject malformed / oversized payloads. textBoxes arrives from the
    // lecturer's WS without runtime validation (JSON.parse + type assertion),
    // so a forged message could carry a 1 MB `content` string, hundreds of
    // boxes, or NaN coords — each fanned out to every student. Same shape
    // as isValidStroke: bound count, string lengths, and numeric ranges.
    if (!Array.isArray(textBoxes) || textBoxes.length > 50) return;
    for (const b of textBoxes) {
      if (!b || typeof b !== 'object') return;
      const { id, x, y, width, height, content, fontFamily, fontSize, color } = b as Record<string, unknown>;
      if (typeof id !== 'string' || id.length > 64) return;
      if (typeof content !== 'string' || content.length > 5000) return;
      if (typeof fontFamily !== 'string' || fontFamily.length > 64) return;
      if (typeof color !== 'string' || color.length > MAX_COLOR_LEN) return;
      for (const n of [x, y, width, height, fontSize]) {
        if (typeof n !== 'number' || !Number.isFinite(n)) return;
      }
    }
    this.broadcastToStudents(room, { type: 'TEXT_BOX_SYNC', slideIndex, textBoxes });
  }

  handleWhiteboardToggle(sessionId: string, enabled: boolean) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    this.broadcastToStudents(room, { type: 'WHITEBOARD_TOGGLE', enabled });
  }

  handleConfusionArea(sessionId: string, slideIndex: number, highlight: { shape: 'rect' | 'circle'; x: number; y: number; width: number; height: number }, emoji: 'confused' | 'lost') {
    const room = this.rooms.get(sessionId);
    if (!room?.lecturerWs) return;
    if (!isValidSlideIndex(slideIndex, room.totalSlides)) return;
    // Track confusion count for engagement scoring
    room.confusionCounts.set(slideIndex, (room.confusionCounts.get(slideIndex) ?? 0) + 1);
    send(room.lecturerWs, { type: 'CONFUSION_AREA', slideIndex, highlight, emoji });
  }

  /** Track note activity for engagement scoring */
  trackNoteActivity(sessionId: string, studentId: string, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    if (!isValidSlideIndex(slideIndex, room.totalSlides)) return;
    if (!room.noteActivity.has(slideIndex)) room.noteActivity.set(slideIndex, new Set());
    room.noteActivity.get(slideIndex)!.add(studentId);
  }

  setTotalSlides(sessionId: string, totalSlides: number) {
    const room = this.getOrCreate(sessionId);
    room.totalSlides = totalSlides;
  }

  // ── Annotation handlers ──────────────────────────────────────────────────

  handleDrawStroke(sessionId: string, points: { x: number; y: number }[], color: string, width: number, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    if (!isValidStroke(points, color, width)) return;
    if (!isValidSlideIndex(slideIndex, room.totalSlides)) return;

    const annotation: Annotation = {
      type: 'draw',
      points,
      color,
      width,
      timestamp: Date.now() - room.sessionStartTime,
    };

    if (!room.annotations.has(slideIndex)) {
      room.annotations.set(slideIndex, []);
    }
    room.annotations.get(slideIndex)!.push(annotation);

    this.broadcastToStudents(room, {
      type: 'DRAW_STROKE',
      points,
      color,
      width,
      slideIndex,
    });
  }

  handleEraseStroke(sessionId: string, points: { x: number; y: number }[], size: number, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    // size is the eraser radius; bound with the same width constraint.
    if (!isValidStroke(points, undefined, size)) return;
    if (!isValidSlideIndex(slideIndex, room.totalSlides)) return;

    const annotation: Annotation = {
      type: 'erase',
      points,
      size,
      timestamp: Date.now() - room.sessionStartTime,
    };

    if (!room.annotations.has(slideIndex)) {
      room.annotations.set(slideIndex, []);
    }
    room.annotations.get(slideIndex)!.push(annotation);

    this.broadcastToStudents(room, {
      type: 'ERASE_STROKE',
      points,
      size,
      slideIndex,
    });
  }

  handleClearAnnotations(sessionId: string, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    if (!isValidSlideIndex(slideIndex, room.totalSlides)) return;

    room.annotations.set(slideIndex, []);

    this.broadcastToStudents(room, {
      type: 'CLEAR_ANNOTATIONS',
      slideIndex,
    });
  }

  handleLaserMove(sessionId: string, x: number, y: number, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToStudents(room, {
      type: 'LASER_MOVE',
      x,
      y,
      slideIndex,
    });
  }

  handleLaserPause(sessionId: string, x: number, y: number, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToStudents(room, {
      type: 'LASER_PAUSE',
      x,
      y,
      slideIndex,
    });
  }

  handleLaserEnd(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToStudents(room, {
      type: 'LASER_END',
    });
  }

  handleCursorPosition(sessionId: string, x: number, y: number, tool: DrawToolType, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToStudents(room, {
      type: 'CURSOR_POSITION',
      x,
      y,
      tool,
      slideIndex,
    });
  }

  handleCursorHide(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToStudents(room, {
      type: 'CURSOR_HIDE',
    });
  }

  handleStudentDrawStroke(sessionId: string, points: { x: number; y: number }[], color: string, width: number, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room || !room.grantedAnnotator) return;
    if (!isValidStroke(points, color, width)) return;

    this.broadcastToAll(room, {
      type: 'STUDENT_DRAW_STROKE',
      studentName: room.grantedAnnotator.studentName,
      points,
      color,
      width,
      slideIndex,
    });
  }

  handleStudentEraseStroke(sessionId: string, points: { x: number; y: number }[], size: number, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room || !room.grantedAnnotator) return;
    if (!isValidStroke(points, undefined, size)) return;

    this.broadcastToAll(room, {
      type: 'STUDENT_ERASE_STROKE',
      studentName: room.grantedAnnotator.studentName,
      points,
      size,
      slideIndex,
    });
  }

  handleStudentClearAnnotations(sessionId: string, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToAll(room, {
      type: 'STUDENT_CLEAR_ANNOTATIONS',
      slideIndex,
    });
  }

  handleStudentLaserMove(sessionId: string, x: number, y: number, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToAll(room, { type: 'LASER_MOVE', x, y, slideIndex });
  }

  handleStudentLaserPause(sessionId: string, x: number, y: number, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToAll(room, { type: 'LASER_PAUSE', x, y, slideIndex });
  }

  handleStudentLaserEnd(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToAll(room, { type: 'LASER_END' });
  }

  handleStudentCursorPosition(sessionId: string, x: number, y: number, tool: DrawToolType, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToAll(room, { type: 'CURSOR_POSITION', x, y, tool, slideIndex });
  }

  handleStudentCursorHide(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcastToAll(room, { type: 'CURSOR_HIDE' });
  }

  // Annotation persistence is now handled by the frontend (PNG snapshots via POST /annotations)

  async endSession(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    // Re-entrancy guard: detach the room from the map *before* any awaits.
    // endSession can be triggered from three paths (REST /end, WS SESSION_END,
    // 90-min auto-end). Without this, two concurrent calls both pass the
    // `get` check and both flush feedback — duplicating feedback_events rows
    // and corrupting per-slide analytics. Delete up front so the second
    // caller finds nothing and returns.
    this.rooms.delete(sessionId);

    if (room.autoEndTimer) clearTimeout(room.autoEndTimer);
    if (room.engagementTimer) clearInterval(room.engagementTimer);

    // Revoke annotation access before ending
    this.revokeAllAnnotationAccess(room, 'session_ended');

    // Flush remaining feedback (await to ensure DB writes complete before room cleanup)
    await this.flushFeedback(sessionId, room, room.currentSlide);

    // Close any open slide timings
    await db
      .update(slideTimings)
      .set({ endedAt: new Date() })
      .where(and(eq(slideTimings.sessionId, sessionId), isNull(slideTimings.endedAt)));

    // Mark all active participants as left
    await db
      .update(sessionParticipants)
      .set({ leftAt: new Date() })
      .where(and(eq(sessionParticipants.sessionId, sessionId), isNull(sessionParticipants.leftAt)));

    // Update session status
    await db
      .update(sessions)
      .set({ status: 'ended', endedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    const endMsg: WsServerMessage = { type: 'SESSION_ENDED' };
    if (room.lecturerWs) send(room.lecturerWs, endMsg);
    for (const student of room.students.values()) {
      send(student.ws, endMsg);
    }

    // Notify dashboard clients so the live banner disappears
    this.notifySessionEnded(sessionId);
    // Room was already detached from this.rooms at the top of this method
    // for re-entrancy safety — no second delete needed.
  }

  scheduleAutoEnd(sessionId: string, minutes = 90) {
    const room = this.getOrCreate(sessionId);
    if (room.autoEndTimer) clearTimeout(room.autoEndTimer);
    room.autoEndTimer = setTimeout(() => this.endSession(sessionId), minutes * 60 * 1000);
  }

  disconnectStudent(sessionId: string, userId: string, ws?: WSContext) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    // Flush current feedback to DB before removing
    const student = room.students.get(userId);

    // Identity guard: if this onClose is for a stale WS that has already been
    // superseded by a reconnect, do nothing. Evicting the current entry would
    // drop the student from the room even though their new socket is live.
    if (ws && student && student.ws !== ws) return;

    if (student?.currentEmoji && student.emojiSelectedAt) {
      const duration = Date.now() - student.emojiSelectedAt;
      db.insert(feedbackEvents)
        .values({
          sessionId,
          studentId: userId,
          slideIndex: room.currentSlide,
          emoji: student.currentEmoji,
          durationMs: duration,
        })
        .catch(console.error);
    }

    // If this student was the granted annotator, clear and notify
    if (room.grantedAnnotator?.studentId === userId) {
      room.grantedAnnotator = null;
      this.broadcastToAll(room, { type: 'STUDENT_CLEAR_ANNOTATIONS', slideIndex: room.currentSlide });
      this.sendAnnotationAccessState(room);
    }

    // If this student was in the request queue, remove them
    const wasInQueue = room.annotationAccessQueue.some((r) => r.studentId === userId);
    if (wasInQueue) {
      room.annotationAccessQueue = room.annotationAccessQueue.filter((r) => r.studentId !== userId);
      this.sendAnnotationAccessState(room);
    }

    room.students.delete(userId);
    if (room.lecturerWs) {
      send(room.lecturerWs, {
        type: 'PARTICIPANT_COUNT',
        active: room.students.size,
        total: room.students.size,
      });
    }
  }

  disconnectLecturer(sessionId: string, ws?: WSContext) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    // Identity guard: a stale onClose from a superseded socket must not wipe
    // out the fresh lecturer connection or spuriously tell students the
    // lecturer has disconnected.
    if (ws && room.lecturerWs && room.lecturerWs !== ws) return;

    room.lecturerWs = null;
    room.lecturerUserId = null;

    // Notify students that the lecturer has disconnected
    this.broadcastToStudents(room, { type: 'LECTURER_DISCONNECTED' });
  }

  isGrantedAnnotator(sessionId: string, userId: string): boolean {
    const room = this.rooms.get(sessionId);
    return room?.grantedAnnotator?.studentId === userId;
  }

  private sendAnnotationAccessState(room: SessionRoom) {
    if (!room.lecturerWs) return;
    send(room.lecturerWs, {
      type: 'ANNOTATION_ACCESS_STATE',
      grantedStudent: room.grantedAnnotator ? { id: room.grantedAnnotator.studentId, name: room.grantedAnnotator.studentName } : null,
      queue: room.annotationAccessQueue.map(({ studentId, studentName, reason }) => ({ studentId, studentName, reason })),
    });
  }

  handleAnnotationAccessRequest(sessionId: string, studentId: string, studentName: string, reason: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    // Ignore if already granted or already in queue
    if (room.grantedAnnotator?.studentId === studentId) return;
    if (room.annotationAccessQueue.some((r) => r.studentId === studentId)) return;

    // Validate reason
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      const student = room.students.get(studentId);
      if (student) send(student.ws, { type: 'ERROR', message: 'Reason must be 1-100 characters' });
      return;
    }

    room.annotationAccessQueue.push({ studentId, studentName, reason: trimmed, requestedAt: Date.now() });

    if (room.lecturerWs) {
      send(room.lecturerWs, { type: 'ANNOTATION_ACCESS_REQUESTED', studentId, studentName, reason: trimmed });
    }
    // Also push the full access state so the lecturer UI stays authoritative
    // when multiple requests are in flight (e.g. two students tap "request pen"
    // within the same tick) or the client reconnected mid-queue.
    this.sendAnnotationAccessState(room);
  }

  handleAnnotationAccessCancel(sessionId: string, studentId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    room.annotationAccessQueue = room.annotationAccessQueue.filter((r) => r.studentId !== studentId);
    this.sendAnnotationAccessState(room);
  }

  handleAnnotationAccessDismiss(sessionId: string, studentId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    const request = room.annotationAccessQueue.find((r) => r.studentId === studentId);
    if (!request) return;

    room.annotationAccessQueue = room.annotationAccessQueue.filter((r) => r.studentId !== studentId);

    const student = room.students.get(studentId);
    if (student) send(student.ws, { type: 'ANNOTATION_ACCESS_DISMISSED' });

    this.sendAnnotationAccessState(room);
  }

  handleAnnotationAccessGrant(sessionId: string, studentId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    const student = room.students.get(studentId);
    if (!student) {
      // Student disconnected — remove from queue and update lecturer
      room.annotationAccessQueue = room.annotationAccessQueue.filter((r) => r.studentId !== studentId);
      this.sendAnnotationAccessState(room);
      return;
    }

    // If a different student currently has the pen, revoke theirs first so
    // their client clears its annotation toolbar + any in-flight stroke batch.
    // Without this the previous grantee thinks they're still granted, but the
    // backend silently drops their strokes (isGrantedAnnotator check fails).
    if (room.grantedAnnotator && room.grantedAnnotator.studentId !== studentId) {
      const prev = room.students.get(room.grantedAnnotator.studentId);
      if (prev) send(prev.ws, { type: 'ANNOTATION_ACCESS_REVOKED', reason: 'lecturer_revoked' });
      // Clear any strokes the previous annotator had drawn on the current slide
      this.broadcastToAll(room, { type: 'STUDENT_CLEAR_ANNOTATIONS', slideIndex: room.currentSlide });
    }

    room.grantedAnnotator = { studentId, studentName: student.name };

    // Notify granted student
    send(student.ws, { type: 'ANNOTATION_ACCESS_GRANTED' });

    // Dismiss all others in queue
    for (const req of room.annotationAccessQueue) {
      if (req.studentId !== studentId) {
        const other = room.students.get(req.studentId);
        if (other) send(other.ws, { type: 'ANNOTATION_ACCESS_DISMISSED' });
      }
    }
    room.annotationAccessQueue = [];

    this.sendAnnotationAccessState(room);
  }

  handleAnnotationAccessRevoke(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room || !room.grantedAnnotator) return;

    const student = room.students.get(room.grantedAnnotator.studentId);
    if (student) send(student.ws, { type: 'ANNOTATION_ACCESS_REVOKED', reason: 'lecturer_revoked' });

    room.grantedAnnotator = null;

    // Clear student annotations from all screens
    this.broadcastToAll(room, { type: 'STUDENT_CLEAR_ANNOTATIONS', slideIndex: room.currentSlide });

    this.sendAnnotationAccessState(room);
  }

  private revokeAllAnnotationAccess(room: SessionRoom, reason: 'slide_change' | 'session_ended') {
    // Revoke granted annotator
    if (room.grantedAnnotator) {
      const student = room.students.get(room.grantedAnnotator.studentId);
      if (student) send(student.ws, { type: 'ANNOTATION_ACCESS_REVOKED', reason });
      room.grantedAnnotator = null;
    }

    // Dismiss all queued requests
    for (const req of room.annotationAccessQueue) {
      const student = room.students.get(req.studentId);
      if (student) send(student.ws, { type: 'ANNOTATION_ACCESS_DISMISSED' });
    }
    room.annotationAccessQueue = [];
  }

  private async flushFeedback(sessionId: string, room: SessionRoom, slideIndex: number) {
    const now = Date.now();
    const inserts = [];
    for (const student of room.students.values()) {
      if (student.currentEmoji && student.emojiSelectedAt) {
        const duration = now - student.emojiSelectedAt;
        inserts.push(
          db.insert(feedbackEvents)
            .values({
              sessionId,
              studentId: student.userId,
              slideIndex,
              emoji: student.currentEmoji,
              durationMs: duration,
            })
            .catch(console.error),
        );
      }
    }
    await Promise.all(inserts);
  }
}

export const sessionManager = new SessionManager();
