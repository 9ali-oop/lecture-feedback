import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, count, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { questions, users, questionUpvotes } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { sessionManager } from '../ws/session-manager.js';

const router = new Hono();

router.use('*', requireAuth());

// List questions for a session
router.get('/session/:sessionId', async (c) => {
  const { sessionId } = c.req.param();

  const upvoteCountSq = db
    .select({ questionId: questionUpvotes.questionId, cnt: count().as('cnt') })
    .from(questionUpvotes)
    .groupBy(questionUpvotes.questionId)
    .as('upvote_counts');

  const rows = await db
    .select({
      id: questions.id,
      sessionId: questions.sessionId,
      studentId: questions.studentId,
      studentName: users.name,
      content: questions.content,
      slideIndex: questions.slideIndex,
      askedAt: questions.askedAt,
      answered: questions.answered,
      answeredAt: questions.answeredAt,
      upvoteCount: sql<number>`coalesce(${upvoteCountSq.cnt}, 0)`.as('upvote_count'),
    })
    .from(questions)
    .innerJoin(users, eq(questions.studentId, users.id))
    .leftJoin(upvoteCountSq, eq(questions.id, upvoteCountSq.questionId))
    .where(eq(questions.sessionId, sessionId));

  return c.json(
    rows.map((q) => ({
      id: q.id,
      sessionId: q.sessionId,
      studentId: q.studentId,
      studentName: q.studentName,
      content: q.content,
      slideIndex: q.slideIndex ?? null,
      askedAt: q.askedAt.toISOString(),
      answered: q.answered,
      answeredAt: q.answeredAt?.toISOString() ?? null,
      upvoteCount: Number(q.upvoteCount),
    })),
  );
});

// Ask a question (student only)
router.post(
  '/session/:sessionId',
  requireAuth('student'),
  zValidator('json', z.object({ content: z.string().min(1).max(500), slideIndex: z.number().int().min(0).optional() })),
  async (c) => {
    const { sessionId } = c.req.param();
    const { content, slideIndex } = c.req.valid('json');
    const { sub } = c.get('jwtPayload');

    const [question] = await db
      .insert(questions)
      .values({ sessionId, studentId: sub, content, slideIndex: slideIndex ?? null })
      .returning();

    const [user] = await db.select().from(users).where(eq(users.id, sub));
    if (!user) return c.json({ error: 'User not found' }, 404);

    const questionPayload = {
      id: question.id,
      sessionId: question.sessionId,
      studentId: question.studentId,
      studentName: user.name,
      content: question.content,
      slideIndex: question.slideIndex ?? null,
      askedAt: question.askedAt.toISOString(),
      answered: question.answered,
      answeredAt: null,
      upvoteCount: 0,
    };

    // Push to lecturer via WebSocket
    sessionManager.handleNewQuestion(sessionId, questionPayload);

    return c.json(questionPayload, 201);
  },
);

// Mark question as answered (lecturer only)
router.patch('/:id/answer', requireAuth('lecturer', 'admin'), async (c) => {
  const { id } = c.req.param();

  const [question] = await db
    .update(questions)
    .set({ answered: true, answeredAt: new Date() })
    .where(eq(questions.id, id))
    .returning();

  if (!question) return c.json({ error: 'Question not found' }, 404);

  sessionManager.handleQuestionAnswered(question.sessionId, id);

  return c.json({ ok: true });
});

export default router;
