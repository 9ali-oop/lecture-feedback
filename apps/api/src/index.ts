import { config } from 'dotenv';
config({ override: true }); // override any existing DATABASE_URL / env vars in the shell
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import modulesRouter from './routes/modules.js';
import sessionsRouter from './routes/sessions.js';
import questionsRouter from './routes/questions.js';
import notesRouter from './routes/notes.js';
import confusionRouter from './routes/confusion.js';
import pollsRouter from './routes/polls.js';
import reflectionsRouter from './routes/reflections.js';
import analyticsRouter from './routes/analytics.js';
import joinRouter from './routes/join.js';
import { verifyToken } from './lib/jwt.js';
import { sessionManager } from './ws/session-manager.js';
import { db } from './db/index.js';
import { users, questions, questionUpvotes, pollResponses, polls } from './db/schema.js';
import { eq, and, count, sql } from 'drizzle-orm';
import { ensureUploadsDir } from './lib/storage.js';
import type { WsClientMessage } from '@lecture-feedback/shared';

const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }),
);
app.use('*', logger());

app.onError((err, c) => {
  console.error('🔥 Unhandled error:', err);
  return c.json({ error: err.message ?? 'Internal Server Error' }, 500);
});

// ── REST routes ───────────────────────────────────────────────────────────────

app.route('/auth', authRouter);
app.route('/admin', adminRouter);
app.route('/modules', modulesRouter);
app.route('/sessions', sessionsRouter);
app.route('/questions', questionsRouter);
app.route('/notes', notesRouter);
app.route('/confusion', confusionRouter);
app.route('/polls', pollsRouter);
app.route('/reflections', reflectionsRouter);
app.route('/analytics', analyticsRouter);
app.route('/join', joinRouter);

app.get('/health', (c) => c.json({ ok: true }));

// ── WebSocket ─────────────────────────────────────────────────────────────────

app.get(
  '/ws',
  upgradeWebSocket(async (c) => {
    const token = c.req.query('token');
    const sessionId = c.req.query('sessionId');

    if (!token || !sessionId) {
      return {
        onOpen(_, ws) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Missing token or sessionId' }));
          ws.close();
        },
      };
    }

    // Verify the JWT before the WS upgrade - reject early if invalid
    let payload: Awaited<ReturnType<typeof verifyToken>>;
    try {
      payload = await verifyToken(token);
    } catch {
      return {
        onOpen(_, ws) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid token' }));
          ws.close();
        },
      };
    }

    const userId = payload.sub;
    const role = payload.role;
    const isDashboard = sessionId === 'dashboard';

    // Dashboard connection: lightweight WS for live session notifications
    if (isDashboard) {
      return {
        onOpen(_, ws) {
          sessionManager.joinDashboard(userId, ws);
        },
        onMessage(event, ws) {
          let msg: WsClientMessage;
          try { msg = JSON.parse(event.data.toString()) as WsClientMessage; } catch { return; }
          if (msg.type === 'PING') ws.send(JSON.stringify({ type: 'PONG' }));
        },
        onClose(_evt, ws) {
          sessionManager.disconnectDashboard(userId, ws);
        },
      };
    }

    return {
      async onOpen(_, ws) {
        if (role === 'lecturer' || role === 'admin') {
          sessionManager.joinAsLecturer(sessionId, userId, ws);
        } else {
          const [user] = await db.select().from(users).where(eq(users.id, userId));
          await sessionManager.joinAsStudent(sessionId, userId, user?.name ?? 'Student', ws);
        }
      },

      async onMessage(event, ws) {
        let msg: WsClientMessage;
        try {
          msg = JSON.parse(event.data.toString()) as WsClientMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'PING':
            ws.send(JSON.stringify({ type: 'PONG' }));
            break;

          case 'SLIDE_CHANGE':
            if (role === 'lecturer' || role === 'admin') {
              // DB persist now lives inside handleSlideChange so the clamped
              // value is always what gets written — no race between the raw
              // and clamped writes.
              sessionManager.handleSlideChange(sessionId, msg.slideIndex);
            }
            break;

          case 'FEEDBACK':
            if (role === 'student') {
              sessionManager.handleFeedback(sessionId, userId, msg.emoji, msg.slideIndex);
            }
            break;

          // ── Annotation messages ──────────────────────────────────────────────
          case 'DRAW_STROKE':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleDrawStroke(sessionId, msg.points, msg.color, msg.width, msg.slideIndex);
            } else if (sessionManager.isGrantedAnnotator(sessionId, userId)) {
              sessionManager.handleStudentDrawStroke(sessionId, msg.points, msg.color, msg.width, msg.slideIndex);
            }
            break;

          case 'ERASE_STROKE':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleEraseStroke(sessionId, msg.points, msg.size, msg.slideIndex);
            } else if (sessionManager.isGrantedAnnotator(sessionId, userId)) {
              sessionManager.handleStudentEraseStroke(sessionId, msg.points, msg.size, msg.slideIndex);
            }
            break;

          case 'CLEAR_ANNOTATIONS':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleClearAnnotations(sessionId, msg.slideIndex);
            } else if (sessionManager.isGrantedAnnotator(sessionId, userId)) {
              sessionManager.handleStudentClearAnnotations(sessionId, msg.slideIndex);
            }
            break;

          case 'LASER_MOVE':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleLaserMove(sessionId, msg.x, msg.y, msg.slideIndex);
            } else if (sessionManager.isGrantedAnnotator(sessionId, userId)) {
              sessionManager.handleStudentLaserMove(sessionId, msg.x, msg.y, msg.slideIndex);
            }
            break;

          case 'LASER_PAUSE':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleLaserPause(sessionId, msg.x, msg.y, msg.slideIndex);
            } else if (sessionManager.isGrantedAnnotator(sessionId, userId)) {
              sessionManager.handleStudentLaserPause(sessionId, msg.x, msg.y, msg.slideIndex);
            }
            break;

          case 'LASER_END':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleLaserEnd(sessionId);
            } else if (sessionManager.isGrantedAnnotator(sessionId, userId)) {
              sessionManager.handleStudentLaserEnd(sessionId);
            }
            break;

          case 'CURSOR_POSITION':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleCursorPosition(sessionId, msg.x, msg.y, msg.tool, msg.slideIndex);
            } else if (sessionManager.isGrantedAnnotator(sessionId, userId)) {
              sessionManager.handleStudentCursorPosition(sessionId, msg.x, msg.y, msg.tool, msg.slideIndex);
            }
            break;

          case 'CURSOR_HIDE':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleCursorHide(sessionId);
            } else if (sessionManager.isGrantedAnnotator(sessionId, userId)) {
              sessionManager.handleStudentCursorHide(sessionId);
            }
            break;

          // ── Q&A messages ─────────────────────────────────────────────────────
          case 'QUESTION':
            if (role === 'student') {
              const [user] = await db.select().from(users).where(eq(users.id, userId));
              const [question] = await db
                .insert(questions)
                .values({ sessionId, studentId: userId, content: msg.content })
                .returning();
              sessionManager.handleNewQuestion(sessionId, {
                id: question.id,
                sessionId: question.sessionId,
                studentId: question.studentId,
                studentName: user?.name ?? 'Student',
                content: question.content,
                slideIndex: question.slideIndex,
                askedAt: question.askedAt.toISOString(),
                answered: question.answered,
                answeredAt: question.answeredAt?.toISOString() ?? null,
                upvoteCount: 0,
              });
            }
            break;

          case 'QUESTION_ANSWERED':
            if (role === 'lecturer' || role === 'admin') {
              await db
                .update(questions)
                .set({ answered: true, answeredAt: new Date() })
                .where(eq(questions.id, msg.questionId));
              sessionManager.handleQuestionAnswered(sessionId, msg.questionId);
            }
            break;

          // ── Session control ──────────────────────────────────────────────────
          case 'SESSION_END':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.endSession(sessionId);
            }
            break;

          case 'WHITEBOARD_TOGGLE':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleWhiteboardToggle(sessionId, msg.enabled);
            }
            break;

          case 'TEXT_BOX_SYNC':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleTextBoxSync(sessionId, msg.slideIndex, msg.textBoxes);
            }
            break;

          // ── Annotation access messages ──────────────────────────────────
          case 'ANNOTATION_ACCESS_REQUEST':
            if (role === 'student') {
              const [reqUser] = await db.select().from(users).where(eq(users.id, userId));
              sessionManager.handleAnnotationAccessRequest(
                sessionId, userId, reqUser?.name ?? 'Student', msg.reason,
              );
            }
            break;

          case 'ANNOTATION_ACCESS_CANCEL':
            if (role === 'student') {
              sessionManager.handleAnnotationAccessCancel(sessionId, userId);
            }
            break;

          case 'ANNOTATION_ACCESS_GRANT':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleAnnotationAccessGrant(sessionId, msg.studentId);
            }
            break;

          case 'ANNOTATION_ACCESS_DISMISS':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleAnnotationAccessDismiss(sessionId, msg.studentId);
            }
            break;

          case 'ANNOTATION_ACCESS_REVOKE':
            if (role === 'lecturer' || role === 'admin') {
              sessionManager.handleAnnotationAccessRevoke(sessionId);
            }
            break;

          // ── Pace feedback ──────────────────────────────────────────────────
          case 'PACE_FEEDBACK':
            if (role === 'student') {
              sessionManager.handlePaceFeedback(sessionId, userId, msg.value);
              // Persist to DB (upsert)
              await db.execute(sql`
                INSERT INTO pace_feedback (id, session_id, student_id, value, updated_at)
                VALUES (gen_random_uuid(), ${sessionId}, ${userId}, ${msg.value}, now())
                ON CONFLICT (session_id, student_id)
                DO UPDATE SET value = ${msg.value}, updated_at = now()
              `);
            }
            break;

          // ── Poll response (via WS for speed, also available via REST) ──────
          case 'POLL_RESPONSE':
            if (role === 'student') {
              // Only allow responses while the poll is active
              const respondPoll = (await db.select().from(polls).where(eq(polls.id, msg.pollId)))[0];
              if (respondPoll && respondPoll.status === 'active') {
                // Upsert: insert or update if student changes their answer
                await db.execute(sql`
                  INSERT INTO poll_responses (id, poll_id, student_id, option_index, responded_at)
                  VALUES (gen_random_uuid(), ${msg.pollId}, ${userId}, ${msg.optionIndex}, now())
                  ON CONFLICT (poll_id, student_id)
                  DO UPDATE SET option_index = ${msg.optionIndex}, responded_at = now()
                `);
                // Compute and broadcast results to lecturer
                const responses = await db.select().from(pollResponses).where(eq(pollResponses.pollId, respondPoll.id));
                const options = respondPoll.options as string[];
                const counts = new Array(options.length).fill(0);
                for (const r of responses) { if (r.optionIndex >= 0 && r.optionIndex < counts.length) counts[r.optionIndex]++; }
                sessionManager.broadcastPollResults(sessionId, {
                  pollId: respondPoll.id, question: respondPoll.question, options, counts,
                  totalResponses: responses.length, status: respondPoll.status as 'active' | 'closed',
                });
              }
            }
            break;

          // ── Question upvote ────────────────────────────────────────────────
          case 'QUESTION_UPVOTE':
            if (role === 'student') {
              const upExisting = await db.select().from(questionUpvotes)
                .where(and(eq(questionUpvotes.questionId, msg.questionId), eq(questionUpvotes.studentId, userId)));
              if (upExisting.length > 0) {
                // Toggle off
                await db.delete(questionUpvotes)
                  .where(and(eq(questionUpvotes.questionId, msg.questionId), eq(questionUpvotes.studentId, userId)));
              } else {
                // Toggle on
                await db.insert(questionUpvotes).values({ questionId: msg.questionId, studentId: userId });
              }
              const [{ count: upCount }] = await db.select({ count: count() }).from(questionUpvotes)
                .where(eq(questionUpvotes.questionId, msg.questionId));
              sessionManager.broadcastUpvote(sessionId, msg.questionId, Number(upCount));
            }
            break;

          default:
            break;
        }
      },

      onClose(_evt, ws) {
        if (role === 'lecturer' || role === 'admin') {
          sessionManager.disconnectLecturer(sessionId, ws);
        } else {
          sessionManager.disconnectStudent(sessionId, userId, ws);
        }
      },
    };
  }),
);

// ── Boot ──────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? '3000', 10);

await ensureUploadsDir();

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`API running at http://localhost:${port}`);
});

injectWebSocket(server);
