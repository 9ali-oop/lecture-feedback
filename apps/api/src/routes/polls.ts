import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, count as dbCount } from 'drizzle-orm';
import { db } from '../db/index.js';
import { polls, pollResponses } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { sessionManager } from '../ws/session-manager.js';
import type { PollResults } from '@lecture-feedback/shared';

const router = new Hono();
router.use('*', requireAuth());

// Create a poll (lecturer only)
router.post(
  '/session/:sessionId',
  requireAuth('lecturer', 'admin'),
  zValidator('json', z.object({
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(200)).min(2).max(6),
    slideIndex: z.number().int().min(0),
    isTrueFalse: z.boolean().default(false),
  })),
  async (c) => {
    const { sessionId } = c.req.param();
    const { question, options, slideIndex, isTrueFalse } = c.req.valid('json');

    const [poll] = await db.insert(polls).values({
      sessionId,
      slideIndex,
      question,
      options,
      isTrueFalse,
    }).returning();

    const pollData = {
      id: poll.id,
      sessionId: poll.sessionId,
      slideIndex: poll.slideIndex,
      question: poll.question,
      options: poll.options as string[],
      isTrueFalse: poll.isTrueFalse,
      status: poll.status as 'active' | 'closed',
      createdAt: poll.createdAt.toISOString(),
      closedAt: null,
    };

    // Broadcast to all students
    sessionManager.broadcastPoll(sessionId, pollData);

    return c.json(pollData, 201);
  },
);

// Submit a poll response (student only)
router.post(
  '/:pollId/respond',
  requireAuth('student'),
  zValidator('json', z.object({ optionIndex: z.number().int().min(0) })),
  async (c) => {
    const { pollId } = c.req.param();
    const { sub } = c.get('jwtPayload');
    const { optionIndex } = c.req.valid('json');

    // Check if already responded
    const existing = await db.select().from(pollResponses)
      .where(and(eq(pollResponses.pollId, pollId), eq(pollResponses.studentId, sub)));
    if (existing.length > 0) return c.json({ error: 'Already responded' }, 409);

    await db.insert(pollResponses).values({ pollId, studentId: sub, optionIndex });

    // Get updated results and broadcast
    const poll = (await db.select().from(polls).where(eq(polls.id, pollId)))[0];
    if (poll) {
      const results = await computeResults(poll);
      sessionManager.broadcastPollResults(poll.sessionId, results);
    }

    return c.json({ ok: true });
  },
);

// Close a poll (lecturer only)
router.patch(
  '/:pollId/close',
  requireAuth('lecturer', 'admin'),
  async (c) => {
    const { pollId } = c.req.param();
    await db.update(polls).set({ status: 'closed', closedAt: new Date() }).where(eq(polls.id, pollId));

    const poll = (await db.select().from(polls).where(eq(polls.id, pollId)))[0];
    if (poll) {
      const results = await computeResults(poll);
      sessionManager.broadcastPollClosed(poll.sessionId, pollId, results);
    }

    return c.json({ ok: true });
  },
);

// Get poll results
router.get('/:pollId/results', async (c) => {
  const { pollId } = c.req.param();
  const poll = (await db.select().from(polls).where(eq(polls.id, pollId)))[0];
  if (!poll) return c.json({ error: 'Poll not found' }, 404);
  return c.json(await computeResults(poll));
});

// List polls for a session
router.get('/session/:sessionId', async (c) => {
  const { sessionId } = c.req.param();
  const rows = await db.select().from(polls).where(eq(polls.sessionId, sessionId));
  const results = [];
  for (const p of rows) {
    results.push({
      poll: {
        id: p.id,
        sessionId: p.sessionId,
        slideIndex: p.slideIndex,
        question: p.question,
        options: p.options as string[],
        isTrueFalse: p.isTrueFalse,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        closedAt: p.closedAt?.toISOString() ?? null,
      },
      results: await computeResults(p),
    });
  }
  return c.json(results);
});

async function computeResults(poll: typeof polls.$inferSelect): Promise<PollResults> {
  const options = poll.options as string[];
  const responses = await db.select().from(pollResponses).where(eq(pollResponses.pollId, poll.id));
  const counts = new Array(options.length).fill(0);
  for (const r of responses) {
    if (r.optionIndex >= 0 && r.optionIndex < counts.length) counts[r.optionIndex]++;
  }
  return {
    pollId: poll.id,
    question: poll.question,
    options,
    counts,
    totalResponses: responses.length,
    status: poll.status as 'active' | 'closed',
  };
}

export default router;
