import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { slideNotes, sessions } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { validateUuidParams } from '../middleware/uuidParams.js';
import { sessionManager } from '../ws/session-manager.js';
import { requireSessionAccessById, isValidSlideIndex } from '../lib/access.js';

const router = new Hono();
router.use('*', validateUuidParams);

// Get all student notes for a session — anonymous (lecturer only)
router.get('/session/:sessionId/all', requireAuth('lecturer', 'admin'), async (c) => {
  const { sessionId } = c.req.param();
  const { sub, role } = c.get('jwtPayload');

  const access = await requireSessionAccessById(sessionId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

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
  const { sub, role } = c.get('jwtPayload');

  const access = await requireSessionAccessById(sessionId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

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
  zValidator('json', z.object({ content: z.string().max(20_000) })),
  async (c) => {
    const { sessionId, slideIndex } = c.req.param();
    const { content } = c.req.valid('json');
    const { sub, role } = c.get('jwtPayload');

    const access = await requireSessionAccessById(sessionId, role, sub);
    if (!access.ok) return c.json({ error: access.message }, access.status);

    const idx = parseInt(slideIndex, 10);
    if (isNaN(idx)) return c.json({ error: 'Invalid slide index' }, 400);

    // Reject notes for slides beyond the deck (prevents polluting analytics
    // with rows like "slide 99999 of 5").
    const [sess] = await db.select({ totalSlides: sessions.totalSlides }).from(sessions).where(eq(sessions.id, sessionId));
    if (sess && !isValidSlideIndex(idx, sess.totalSlides)) {
      return c.json({ error: 'Slide index out of range' }, 400);
    }

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

    // Track note activity for real-time engagement scoring
    sessionManager.trackNoteActivity(sessionId, sub, idx);

    return c.json({ ok: true });
  },
);

export default router;
