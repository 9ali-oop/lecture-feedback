import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reflections, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = new Hono();
router.use('*', requireAuth());

// Submit reflection (student, one per session)
router.post(
  '/session/:sessionId',
  requireAuth('student'),
  zValidator('json', z.object({
    mostImportant: z.string().max(1000).default(''),
    stillUnclear: z.string().max(1000).default(''),
  })),
  async (c) => {
    const { sessionId } = c.req.param();
    const { sub } = c.get('jwtPayload');
    const { mostImportant, stillUnclear } = c.req.valid('json');

    // Upsert
    await db.execute(sql`
      INSERT INTO reflections (id, session_id, student_id, most_important, still_unclear, created_at)
      VALUES (gen_random_uuid(), ${sessionId}, ${sub}, ${mostImportant}, ${stillUnclear}, now())
      ON CONFLICT (session_id, student_id)
      DO UPDATE SET most_important = ${mostImportant}, still_unclear = ${stillUnclear}
    `);

    return c.json({ ok: true });
  },
);

// Get all reflections for a session (lecturer/admin)
router.get('/session/:sessionId', requireAuth('lecturer', 'admin'), async (c) => {
  const { sessionId } = c.req.param();

  const rows = await db
    .select({
      id: reflections.id,
      sessionId: reflections.sessionId,
      studentId: reflections.studentId,
      studentName: users.name,
      mostImportant: reflections.mostImportant,
      stillUnclear: reflections.stillUnclear,
      createdAt: reflections.createdAt,
    })
    .from(reflections)
    .innerJoin(users, eq(reflections.studentId, users.id))
    .where(eq(reflections.sessionId, sessionId));

  // Compute word frequency for themes
  const topLearnings = extractTopPhrases(rows.map((r) => r.mostImportant).filter(Boolean));
  const topUnclear = extractTopPhrases(rows.map((r) => r.stillUnclear).filter(Boolean));

  return c.json({
    totalResponses: rows.length,
    reflections: rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      studentId: r.studentId,
      studentName: r.studentName,
      mostImportant: r.mostImportant,
      stillUnclear: r.stillUnclear,
      createdAt: r.createdAt.toISOString(),
    })),
    topLearnings,
    topUnclear,
  });
});

// Simple word frequency extraction (stop words removed, top N)
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'it', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'and', 'but', 'or', 'not', 'no', 'so', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'their', 'its',
  'what', 'which', 'who', 'how', 'when', 'where', 'why', 'very', 'really', 'just', 'also',
  'more', 'most', 'much', 'many', 'some', 'any', 'all', 'each', 'every', 'both', 'few',
  'don\'t', 'didn\'t', 'wasn\'t', 'aren\'t', 'isn\'t', 'won\'t', 'couldn\'t', 'wouldn\'t',
  'still', 'understand', 'understood', 'think', 'know', 'get', 'got', 'learned', 'learning',
  'important', 'thing', 'things', 'part', 'bit', 'lot', 'like', 'really',
]);

function extractTopPhrases(texts: string[], topN = 8): string[] {
  const freq = new Map<string, number>();

  for (const text of texts) {
    const words = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, '').split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    // Count individual words
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }

    // Count bigrams (two-word phrases)
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      freq.set(bigram, (freq.get(bigram) ?? 0) + 1);
    }
  }

  // Filter: must appear more than once, or in >25% of texts
  const threshold = Math.max(2, Math.ceil(texts.length * 0.25));
  return Array.from(freq.entries())
    .filter(([, count]) => count >= Math.min(2, threshold))
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([phrase]) => phrase);
}

export default router;
