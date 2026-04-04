import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, studentProfiles } from '../db/schema.js';
import { verifyTotp } from '../lib/totp.js';
import { signToken } from '../lib/jwt.js';
import { requireAuth } from '../middleware/auth.js';

const router = new Hono();

// Verify TOTP to activate account (first-time setup) or login
router.post(
  '/verify',
  zValidator('json', z.object({ email: z.string().email(), code: z.string().length(6) })),
  async (c) => {
    const { email, code } = c.req.valid('json');

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) return c.json({ error: 'Invalid credentials' }, 401);

    // Dev override: sc####@leeds.ac.uk and admin accounts accept 123456
    const isTestAccount = /^sc\d{4}@leeds\.ac\.uk$/.test(user.email);
    const isAdmin = user.role === 'admin';
    const valid = ((isTestAccount || isAdmin) && code === '123456') || verifyTotp(user.totpSecret, code, email);
    if (!valid) return c.json({ error: 'Invalid TOTP code' }, 401);

    // Mark verified on first use
    if (!user.totpVerified) {
      await db.update(users).set({ totpVerified: true }).where(eq(users.id, user.id));
    }

    const token = await signToken({ sub: user.id, email: user.email, role: user.role });

    const studentProfile =
      user.role === 'student'
        ? (await db.select().from(studentProfiles).where(eq(studentProfiles.userId, user.id)))[0]
        : undefined;

    return c.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        totpVerified: true,
        createdAt: user.createdAt.toISOString(),
      },
      studentProfile: studentProfile
        ? {
            userId: studentProfile.userId,
            studentNumber: studentProfile.studentNumber,
            englishProficiency: studentProfile.englishProficiency,
          }
        : undefined,
    });
  },
);

// Get current user info
router.get('/me', requireAuth(), async (c) => {
  const { sub } = c.get('jwtPayload');
  const [user] = await db.select().from(users).where(eq(users.id, sub));
  if (!user) return c.json({ error: 'User not found' }, 404);

  const studentProfile =
    user.role === 'student'
      ? (await db.select().from(studentProfiles).where(eq(studentProfiles.userId, user.id)))[0]
      : undefined;

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      totpVerified: user.totpVerified,
      createdAt: user.createdAt.toISOString(),
    },
    studentProfile: studentProfile
      ? {
          userId: studentProfile.userId,
          studentNumber: studentProfile.studentNumber,
          englishProficiency: studentProfile.englishProficiency,
        }
      : undefined,
  });
});

export default router;
