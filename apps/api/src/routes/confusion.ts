import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { confusionContexts, questions, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { sessionManager } from '../ws/session-manager.js';

const router = new Hono();

router.use('*', requireAuth());

// Submit confusion context (student only)
// Also auto-creates a Q&A question for the lecturer
router.post(
  '/session/:sessionId',
  requireAuth('student'),
  zValidator(
    'json',
    z.object({
      slideIndex: z.number().int().min(0),
      emoji: z.enum(['confused', 'lost']),
      highlights: z
        .array(
          z.object({
            shape: z.enum(['rect', 'circle']),
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          }),
        )
        .default([]),
      explanation: z.string().max(500).optional(),
    }),
  ),
  async (c) => {
    const { sessionId } = c.req.param();
    const { sub } = c.get('jwtPayload');
    const { slideIndex, emoji, highlights, explanation } = c.req.valid('json');

    // Save confusion context
    const [row] = await db
      .insert(confusionContexts)
      .values({
        sessionId,
        studentId: sub,
        slideIndex,
        emoji,
        highlightData: highlights.length > 0 ? highlights : null,
        explanation: explanation?.trim() || null,
      })
      .returning();

    // Auto-create a Q&A question so the lecturer sees it live
    const reason = explanation?.trim();
    const questionContent = reason
      ? `Could you please explain this in more detail? — ${reason}`
      : 'Could you please explain this in more detail?';

    const [user] = await db.select().from(users).where(eq(users.id, sub));
    const [question] = await db
      .insert(questions)
      .values({
        sessionId,
        studentId: sub,
        content: questionContent,
        slideIndex,
      })
      .returning();

    // Push to lecturer's live Q&A via WebSocket
    sessionManager.handleNewQuestion(sessionId, {
      id: question.id,
      sessionId: question.sessionId,
      studentId: question.studentId,
      studentName: user?.name ?? 'Student',
      content: question.content,
      slideIndex: question.slideIndex,
      askedAt: question.askedAt.toISOString(),
      answered: question.answered,
      answeredAt: null,
      upvoteCount: 0,
    });

    // Push each confusion highlight to the lecturer in real-time
    for (const hl of highlights) {
      sessionManager.handleConfusionArea(sessionId, slideIndex, hl, emoji);
    }

    return c.json({ id: row.id, questionId: question.id }, 201);
  },
);

// List confusion contexts for a session (lecturer/admin)
router.get('/session/:sessionId', requireAuth('lecturer', 'admin'), async (c) => {
  const { sessionId } = c.req.param();

  const rows = await db
    .select({
      id: confusionContexts.id,
      sessionId: confusionContexts.sessionId,
      studentId: confusionContexts.studentId,
      studentName: users.name,
      slideIndex: confusionContexts.slideIndex,
      emoji: confusionContexts.emoji,
      highlightData: confusionContexts.highlightData,
      explanation: confusionContexts.explanation,
      createdAt: confusionContexts.createdAt,
    })
    .from(confusionContexts)
    .innerJoin(users, eq(confusionContexts.studentId, users.id))
    .where(eq(confusionContexts.sessionId, sessionId));

  return c.json(
    rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      studentId: r.studentId,
      studentName: r.studentName,
      slideIndex: r.slideIndex,
      emoji: r.emoji,
      highlights: (r.highlightData as any[]) ?? [],
      explanation: r.explanation,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

export default router;
