import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, count, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { modules, moduleEnrollments, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { MODULE_COLORS } from '@lecture-feedback/shared';

const validColorHexes = MODULE_COLORS.map((c) => c.hex) as [string, ...string[]];

const router = new Hono();

router.use('*', requireAuth());

// List modules
// - lecturer: their own modules
// - student: all modules (they can see what's available to enroll)
// - admin: all modules
router.get('/', async (c) => {
  const { sub, role } = c.get('jwtPayload');

  const enrollCountSq = db
    .select({ moduleId: moduleEnrollments.moduleId, cnt: count().as('cnt') })
    .from(moduleEnrollments)
    .groupBy(moduleEnrollments.moduleId)
    .as('enroll_counts');

  const rows = await db
    .select({
      id: modules.id,
      code: modules.code,
      name: modules.name,
      color: modules.color,
      lecturerId: modules.lecturerId,
      lecturerName: users.name,
      createdAt: modules.createdAt,
      enrolledCount: sql<number>`coalesce(${enrollCountSq.cnt}, 0)`.as('enrolled_count'),
    })
    .from(modules)
    .innerJoin(users, eq(modules.lecturerId, users.id))
    .leftJoin(enrollCountSq, eq(modules.id, enrollCountSq.moduleId));

  const filtered = role === 'lecturer' ? rows.filter((r) => r.lecturerId === sub) : rows;

  // For students, batch-check which modules they are enrolled in
  let enrolledSet: Set<string> | undefined;
  if (role === 'student') {
    const myEnrollments = await db
      .select({ moduleId: moduleEnrollments.moduleId })
      .from(moduleEnrollments)
      .where(eq(moduleEnrollments.studentId, sub));
    enrolledSet = new Set(myEnrollments.map((e) => e.moduleId));
  }

  return c.json(
    filtered.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      color: m.color,
      lecturerId: m.lecturerId,
      lecturerName: m.lecturerName,
      enrolledCount: Number(m.enrolledCount),
      enrolled: enrolledSet ? enrolledSet.has(m.id) : undefined,
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

// Create module (lecturer only)
router.post(
  '/',
  requireAuth('lecturer', 'admin'),
  zValidator(
    'json',
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      color: z.enum(validColorHexes),
    }),
  ),
  async (c) => {
    const { code, name, color } = c.req.valid('json');
    const { sub } = c.get('jwtPayload');

    const existing = await db.select().from(modules).where(eq(modules.code, code));
    if (existing.length > 0) return c.json({ error: 'Module code already exists' }, 409);

    const [mod] = await db.insert(modules).values({ code, name, color, lecturerId: sub }).returning();
    return c.json({ id: mod.id, code: mod.code, name: mod.name, color: mod.color }, 201);
  },
);

// Update module (lecturer only, must own)
router.patch(
  '/:id',
  requireAuth('lecturer', 'admin'),
  zValidator(
    'json',
    z.object({
      code: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      color: z.enum(validColorHexes).optional(),
    }),
  ),
  async (c) => {
    const { id } = c.req.param();
    const { sub } = c.get('jwtPayload');
    const updates = c.req.valid('json');

    const [mod] = await db.select().from(modules).where(eq(modules.id, id));
    if (!mod) return c.json({ error: 'Module not found' }, 404);
    if (mod.lecturerId !== sub) return c.json({ error: 'Forbidden' }, 403);

    if (updates.code && updates.code !== mod.code) {
      const existing = await db.select().from(modules).where(eq(modules.code, updates.code));
      if (existing.length > 0) return c.json({ error: 'Module code already exists' }, 409);
    }

    const [updated] = await db
      .update(modules)
      .set(updates)
      .where(eq(modules.id, id))
      .returning();

    return c.json({ id: updated.id, code: updated.code, name: updated.name, color: updated.color });
  },
);

// Enroll in module (student only)
router.post('/:id/enroll', requireAuth('student'), async (c) => {
  const { id } = c.req.param();
  const { sub } = c.get('jwtPayload');

  const mod = await db.select().from(modules).where(eq(modules.id, id));
  if (!mod.length) return c.json({ error: 'Module not found' }, 404);

  await db
    .insert(moduleEnrollments)
    .values({ moduleId: id, studentId: sub })
    .onConflictDoNothing();

  return c.json({ ok: true });
});

// Unenroll from module (student only)
router.delete('/:id/enroll', requireAuth('student'), async (c) => {
  const { id } = c.req.param();
  const { sub } = c.get('jwtPayload');

  await db
    .delete(moduleEnrollments)
    .where(and(eq(moduleEnrollments.moduleId, id), eq(moduleEnrollments.studentId, sub)));

  return c.json({ ok: true });
});

// Delete module and all its sessions
router.delete('/:id', requireAuth('lecturer', 'admin'), async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { id } = c.req.param();

  const mod = (await db.select().from(modules).where(eq(modules.id, id)))[0];
  if (!mod) return c.json({ error: 'Module not found' }, 404);
  if (role === 'lecturer' && mod.lecturerId !== sub) return c.json({ error: 'Forbidden' }, 403);

  // Check for live sessions
  const { sessions } = await import('../db/schema.js');
  const liveSessions = await db.select({ id: sessions.id }).from(sessions)
    .where(and(eq(sessions.moduleId, id), eq(sessions.status, 'live')));
  if (liveSessions.length > 0) return c.json({ error: 'Cannot delete module with live sessions' }, 400);

  // Delete all sessions in this module (reuse the session delete logic)
  const allSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.moduleId, id));
  const { feedbackEvents, sessionParticipants, slideTimings, slideWhiteboards, slideAnnotations, slideNotes, confusionContexts, questions, questionUpvotes, polls, pollResponses, paceFeedback, reflections } = await import('../db/schema.js');

  for (const sess of allSessions) {
    const sid = sess.id;
    await db.delete(feedbackEvents).where(eq(feedbackEvents.sessionId, sid));
    await db.delete(sessionParticipants).where(eq(sessionParticipants.sessionId, sid));
    await db.delete(slideTimings).where(eq(slideTimings.sessionId, sid));
    await db.delete(slideWhiteboards).where(eq(slideWhiteboards.sessionId, sid));
    await db.delete(slideAnnotations).where(eq(slideAnnotations.sessionId, sid));
    await db.delete(slideNotes).where(eq(slideNotes.sessionId, sid));
    await db.delete(confusionContexts).where(eq(confusionContexts.sessionId, sid));
    const qs = await db.select({ id: questions.id }).from(questions).where(eq(questions.sessionId, sid));
    for (const q of qs) await db.delete(questionUpvotes).where(eq(questionUpvotes.questionId, q.id));
    await db.delete(questions).where(eq(questions.sessionId, sid));
    const ps = await db.select({ id: polls.id }).from(polls).where(eq(polls.sessionId, sid));
    for (const p of ps) await db.delete(pollResponses).where(eq(pollResponses.pollId, p.id));
    await db.delete(polls).where(eq(polls.sessionId, sid));
    await db.delete(paceFeedback).where(eq(paceFeedback.sessionId, sid));
    await db.delete(reflections).where(eq(reflections.sessionId, sid));
    await db.delete(sessions).where(eq(sessions.id, sid));
  }

  // Delete enrollments and the module itself
  await db.delete(moduleEnrollments).where(eq(moduleEnrollments.moduleId, id));
  await db.delete(modules).where(eq(modules.id, id));

  return c.json({ ok: true });
});

export default router;
