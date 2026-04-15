import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, studentProfiles } from '../db/schema.js';
import { generateTotpSecret, generateQrCodeDataUrl } from '../lib/totp.js';
import { requireAuth } from '../middleware/auth.js';
import { validateUuidParams } from '../middleware/uuidParams.js';
import { signToken } from '../lib/jwt.js';
import type { Role } from '@lecture-feedback/shared';

const router = new Hono();

router.use('*', requireAuth('admin'));
router.use('*', validateUuidParams);

// List all users
router.get('/users', async (c) => {
  const allUsers = await db.select().from(users);
  return c.json(
    allUsers.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      totpVerified: u.totpVerified,
      createdAt: u.createdAt.toISOString(),
    })),
  );
});

// Provision a new lecturer or student
router.post(
  '/users',
  zValidator(
    'json',
    z.object({
      email: z.string().email().max(254),
      name: z.string().min(1).max(120),
      role: z.enum(['lecturer', 'student']),
      studentNumber: z.string().max(30).optional(),
      englishProficiency: z
        .enum(['native', 'fluent', 'intermediate', 'beginner'])
        .optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid('json');

    const existing = await db.select().from(users).where(eq(users.email, body.email));
    if (existing.length > 0) return c.json({ error: 'Email already registered' }, 409);

    if (body.role === 'student' && !body.studentNumber) {
      return c.json({ error: 'studentNumber is required for students' }, 400);
    }

    const secret = generateTotpSecret();
    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        name: body.name,
        role: body.role,
        totpSecret: secret,
        totpVerified: false,
      })
      .returning();

    if (body.role === 'student') {
      await db.insert(studentProfiles).values({
        userId: user.id,
        studentNumber: body.studentNumber!,
        englishProficiency: body.englishProficiency ?? 'native',
      });
    }

    const qrCodeDataUrl = await generateQrCodeDataUrl(secret, body.email);

    return c.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          totpVerified: user.totpVerified,
          createdAt: user.createdAt.toISOString(),
        },
        qrCodeDataUrl,
        totpSecret: secret,
      },
      201,
    );
  },
);

// Impersonate a user (admin only, returns a token for that user)
router.post('/impersonate/:userId', async (c) => {
  const { userId } = c.req.param();
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) return c.json({ error: 'User not found' }, 404);

  const token = await signToken({ sub: target.id, email: target.email, role: target.role as Role });

  let studentProfile = null;
  if (target.role === 'student') {
    const [sp] = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, target.id));
    if (sp) studentProfile = sp;
  }

  return c.json({
    token,
    user: {
      id: target.id,
      email: target.email,
      name: target.name,
      role: target.role,
      totpVerified: target.totpVerified,
      createdAt: target.createdAt.toISOString(),
    },
    studentProfile,
  });
});

// Delete a user
router.delete('/users/:id', async (c) => {
  const { sub } = c.get('jwtPayload');
  const { id } = c.req.param();
  if (id === sub) return c.json({ error: 'Cannot delete your own account' }, 400);
  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) return c.json({ error: 'User not found' }, 404);
  try {
    await db.delete(users).where(eq(users.id, id));
  } catch (err) {
    // Most common cause: FK violation because the user has activity
    // (questions, feedback, notes, …). Rather than returning a raw 500
    // with a PG error, surface a clear 409 so the admin UI can prompt
    // the operator to either delete the module/session first or request
    // a cascade-delete endpoint.
    const msg = (err as Error).message ?? '';
    if (/foreign key|violates|still referenced/i.test(msg)) {
      return c.json({
        error: 'User has activity in the system (questions, feedback, notes, etc.). Delete their modules or sessions first.',
      }, 409);
    }
    throw err;
  }
  return c.json({ ok: true });
});

export default router;
