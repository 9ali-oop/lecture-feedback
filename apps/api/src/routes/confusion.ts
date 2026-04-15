import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { confusionContexts, users, sessions } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { validateUuidParams } from '../middleware/uuidParams.js';
import { sessionManager } from '../ws/session-manager.js';
import { requireSessionAccessById, isValidSlideIndex } from '../lib/access.js';

const router = new Hono();

router.use('*', requireAuth());
router.use('*', validateUuidParams);

// Submit confusion context (student only)
router.post(
  '/session/:sessionId',
  requireAuth('student'),
  zValidator(
    'json',
    z.object({
      slideIndex: z.number().int().min(0),
      emoji: z.enum(['confused', 'lost']),
      // Cap highlight count + coordinate range. Without these, a student
      // could POST 10k highlights — each one fans out via
      // sessionManager.handleConfusionArea → lecturer broadcast — DoSing the
      // lecturer UI and persisting a huge JSON blob. Coordinates are
      // normalised (0–1) on the client, so anything outside [0,1] is junk.
      highlights: z
        .array(
          z.object({
            shape: z.enum(['rect', 'circle']),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            width: z.number().min(0).max(1),
            height: z.number().min(0).max(1),
          }),
        )
        .max(20)
        .default([]),
      explanation: z.string().max(500).optional(),
    }),
  ),
  async (c) => {
    const { sessionId } = c.req.param();
    const { sub, role } = c.get('jwtPayload');
    const { slideIndex, emoji, highlights, explanation } = c.req.valid('json');

    const access = await requireSessionAccessById(sessionId, role, sub);
    if (!access.ok) return c.json({ error: access.message }, access.status);

    const [sess] = await db.select({ totalSlides: sessions.totalSlides }).from(sessions).where(eq(sessions.id, sessionId));
    if (sess && !isValidSlideIndex(slideIndex, sess.totalSlides)) {
      return c.json({ error: 'Slide index out of range' }, 400);
    }

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

    // Push each confusion highlight to the lecturer in real-time
    for (const hl of highlights) {
      sessionManager.handleConfusionArea(sessionId, slideIndex, hl, emoji);
    }

    return c.json({ id: row.id }, 201);
  },
);

// List confusion contexts for a session (lecturer/admin)
router.get('/session/:sessionId', requireAuth('lecturer', 'admin'), async (c) => {
  const { sessionId } = c.req.param();
  const { sub, role } = c.get('jwtPayload');

  const access = await requireSessionAccessById(sessionId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

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
