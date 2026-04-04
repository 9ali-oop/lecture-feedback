import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, studentProfiles } from '../db/schema.js';
import { generateTotpSecret, generateQrCodeDataUrl } from '../lib/totp.js';
import { requireAuth } from '../middleware/auth.js';
import { signToken } from '../lib/jwt.js';
import type { Role } from '@lecture-feedback/shared';

const router = new Hono();

router.use('*', requireAuth('admin'));

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
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(['lecturer', 'student']),
      studentNumber: z.string().optional(),
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
  await db.delete(users).where(eq(users.id, id));
  return c.json({ ok: true });
});

export default router;
