import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { slideNotes } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = new Hono();

// Get all student notes for a session — anonymous (lecturer only)
router.get('/session/:sessionId/all', requireAuth('lecturer', 'admin'), async (c) => {
  const { sessionId } = c.req.param();
  const notes = await db
    .select({ id: slideNotes.id, sessionId: slideNotes.sessionId, slideIndex: slideNotes.slideIndex, content: slideNotes.content, updatedAt: slideNotes.updatedAt })
    .from(slideNotes)
    .where(eq(slideNotes.sessionId, sessionId));
  return c.json(
    notes.map((n) => ({ id: n.id, sessionId: n.sessionId, studentId: 'anonymous', slideIndex: n.slideIndex, content: n.content, updatedAt: n.updatedAt.toISOString() })),
  );
});

// Get all notes for a student in a session
router.get('/session/:sessionId', requireAuth('student'), async (c) => {
  const { sessionId } = c.req.param();
  const { sub } = c.get('jwtPayload');

  const notes = await db
    .select()
    .from(slideNotes)
    .where(and(eq(slideNotes.sessionId, sessionId), eq(slideNotes.studentId, sub)));

  return c.json(
    notes.map((n) => ({
      id: n.id,
      sessionId: n.sessionId,
      studentId: n.studentId,
      slideIndex: n.slideIndex,
      content: n.content,
      updatedAt: n.updatedAt.toISOString(),
    })),
  );
});

// Save or update a note for a specific slide
router.put(
  '/session/:sessionId/slide/:slideIndex',
  requireAuth('student'),
  zValidator('json', z.object({ content: z.string() })),
  async (c) => {
    const { sessionId, slideIndex } = c.req.param();
    const { content } = c.req.valid('json');
    const { sub } = c.get('jwtPayload');

    const idx = parseInt(slideIndex, 10);
    if (isNaN(idx)) return c.json({ error: 'Invalid slide index' }, 400);

    const existing = await db
      .select()
      .from(slideNotes)
      .where(
        and(
          eq(slideNotes.sessionId, sessionId),
          eq(slideNotes.studentId, sub),
          eq(slideNotes.slideIndex, idx),
        ),
      );

    if (existing.length > 0) {
      await db
        .update(slideNotes)
        .set({ content, updatedAt: new Date() })
        .where(eq(slideNotes.id, existing[0].id));
    } else {
      await db.insert(slideNotes).values({
        sessionId,
        studentId: sub,
        slideIndex: idx,
        content,
      });
    }

    return c.json({ ok: true });
  },
);

export default router;
