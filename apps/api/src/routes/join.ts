/**
 * Anonymous join flow for usability studies and guest participation.
 *
 * Students scan a QR shown on the lecturer's screen. The QR URL opens
 * POST /join/:sessionId which creates a throw-away student account,
 * enrols it in the session's module, and returns a JWT. No pre-provisioning,
 * no typing, no QR cards to print.
 *
 * The endpoint is public (no auth required) but is gated on the session
 * existing and being in a joinable state (scheduled or live, not ended).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { sessions, users, studentProfiles, moduleEnrollments } from '../db/schema.js';
import { generateTotpSecret } from '../lib/totp.js';
import { signToken } from '../lib/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = new Hono();

// Note: join has its own explicit UUID checks inline because it needs the
// custom "Session not found" message for non-existent sessionIds anyway.

function randomId(length = 8): string {
  // URL-safe short id. Not cryptographically meaningful beyond uniqueness.
  return randomBytes(length).toString('base64url').slice(0, length);
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Auto-enrol the currently-authenticated student in the session's module.
 * Used when a real (non-guest) student scans the join QR — they shouldn't be
 * forced through the anonymous guest form if they already have an account.
 * Idempotent: succeeds whether or not enrollment already exists.
 *
 * Registered BEFORE the catch-all POST /:sessionId so Hono picks the more
 * specific path.
 */
router.post('/:sessionId/enroll', requireAuth('student'), async (c) => {
  const { sessionId } = c.req.param();
  const { sub } = c.get('jwtPayload');

  if (!uuidRe.test(sessionId)) return c.json({ error: 'Session not found' }, 404);

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return c.json({ error: 'Session not found' }, 404);
  if (session.status === 'ended') {
    return c.json({ error: 'Session has already ended' }, 410);
  }

  await db
    .insert(moduleEnrollments)
    .values({ studentId: sub, moduleId: session.moduleId })
    .onConflictDoNothing();

  return c.json({ ok: true, sessionId: session.id });
});

// 10 guest creations per IP per minute is enough for a shared classroom
// router (NATed phones) but blocks scripted spam. Real participants only
// join once per session.
router.post(
  '/:sessionId',
  rateLimit(10, 60_000),
  zValidator('json', z.object({ name: z.string().trim().min(1).max(60).optional() }).optional()),
  async (c) => {
    const { sessionId } = c.req.param();
    const body = c.req.valid('json') as { name?: string } | undefined;

    // Validate UUID shape to return a clean 404 instead of a SQL error.
    if (!uuidRe.test(sessionId)) return c.json({ error: 'Session not found' }, 404);

    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (session.status === 'ended') {
      return c.json({ error: 'Session has already ended' }, 410);
    }

    // Pick a display name. If not provided, fall back to "Guest".
    // Participant numbering for the report happens later during analysis.
    const displayName = body?.name?.trim() || 'Guest';

    // Synthesise a unique e-mail so we never collide with a real user.
    // leeds.ac.uk domain is used so the dev auth shortcut (code 123456) works
    // if a participant ever needs to re-authenticate from the same account.
    const guestId = randomId(10);
    const email = `guest-${guestId}@leeds.ac.uk`;
    const studentNumber = `guest-${guestId}`;

    // Create the user + student profile, and enrol them in the session's module
    // in a single round trip worth of queries. totpSecret is generated but the
    // dev shortcut means code 123456 is what actually verifies.
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        name: displayName,
        role: 'student',
        totpSecret: generateTotpSecret(),
        totpVerified: true,
      })
      .returning();

    await db.insert(studentProfiles).values({
      userId: newUser.id,
      studentNumber,
      englishProficiency: 'native',
    });

    await db.insert(moduleEnrollments).values({
      studentId: newUser.id,
      moduleId: session.moduleId,
    });

    const token = await signToken({ sub: newUser.id, email: newUser.email, role: newUser.role });

    return c.json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        totpVerified: true,
        createdAt: newUser.createdAt.toISOString(),
      },
      studentProfile: {
        userId: newUser.id,
        studentNumber,
        englishProficiency: 'native',
      },
      sessionId: session.id,
    });
  },
);

export default router;
