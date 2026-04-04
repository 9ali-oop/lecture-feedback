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
import { feedbackEvents, sessionParticipants, sessions, slideTimings } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';

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
}

function send(ws: WSContext, msg: WsServerMessage) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // connection already closed
  }
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

  private getOrCreate(sessionId: string): SessionRoom {
    if (!this.rooms.has(sessionId)) {
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

  async joinAsLecturer(sessionId: string, userId: string, ws: WSContext) {
    const room = this.getOrCreate(sessionId);
    room.lecturerWs = ws;
    room.lecturerUserId = userId;

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
  }

  async joinAsStudent(
    sessionId: string,
    userId: string,
    name: string,
    ws: WSContext,
  ) {
    const room = this.getOrCreate(sessionId);
    room.students.set(userId, {
      ws,
      userId,
      name,
      currentEmoji: null,
      emojiSelectedAt: null,
      slideIndex: room.currentSlide,
    });

    // Record participation in DB
    await db.insert(sessionParticipants).values({ sessionId, studentId: userId }).onConflictDoNothing();

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

    const prevSlide = room.currentSlide;
    const now = new Date();
    room.currentSlide = slideIndex;

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
    student.slideIndex = slideIndex;

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

  handleConfusionArea(sessionId: string, slideIndex: number, highlight: { shape: 'rect' | 'circle'; x: number; y: number; width: number; height: number }, emoji: 'confused' | 'lost') {
    const room = this.rooms.get(sessionId);
    if (!room?.lecturerWs) return;
    send(room.lecturerWs, { type: 'CONFUSION_AREA', slideIndex, highlight, emoji });
  }

  setTotalSlides(sessionId: string, totalSlides: number) {
    const room = this.getOrCreate(sessionId);
    room.totalSlides = totalSlides;
  }

  // ── Annotation handlers ──────────────────────────────────────────────────

  handleDrawStroke(sessionId: string, points: { x: number; y: number }[], color: string, width: number, slideIndex: number) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

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

    if (room.autoEndTimer) clearTimeout(room.autoEndTimer);

    // Revoke annotation access before ending
    this.revokeAllAnnotationAccess(room, 'session_ended');

    // Flush remaining feedback
    this.flushFeedback(sessionId, room, room.currentSlide);

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

    this.rooms.delete(sessionId);
  }

  scheduleAutoEnd(sessionId: string, minutes = 90) {
    const room = this.getOrCreate(sessionId);
    if (room.autoEndTimer) clearTimeout(room.autoEndTimer);
    room.autoEndTimer = setTimeout(() => this.endSession(sessionId), minutes * 60 * 1000);
  }

  disconnectStudent(sessionId: string, userId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    // Flush current feedback to DB before removing
    const student = room.students.get(userId);
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

  disconnectLecturer(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    room.lecturerWs = null;
    room.lecturerUserId = null;
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

  private flushFeedback(sessionId: string, room: SessionRoom, slideIndex: number) {
    const now = Date.now();
    for (const student of room.students.values()) {
      if (student.currentEmoji && student.emojiSelectedAt) {
        const duration = now - student.emojiSelectedAt;
        db.insert(feedbackEvents)
          .values({
            sessionId,
            studentId: student.userId,
            slideIndex,
            emoji: student.currentEmoji,
            durationMs: duration,
          })
          .catch(console.error);
      }
    }
  }
}

export const sessionManager = new SessionManager();
