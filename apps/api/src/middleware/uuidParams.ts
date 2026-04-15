/**
 * Validate UUID path segments up front. Without this, drizzle passes any
 * string straight to Postgres, which throws `invalid input syntax for type
 * uuid` — that surfaces as a 500 with the raw PG error in the body: noisy,
 * and a minor info leak.
 *
 * Hono's middleware runs before route pattern matching, so `c.req.param()`
 * isn't available at `router.use('*')` time. Instead we parse `c.req.path`
 * directly: for each segment that appears after one of the known resource
 * prefixes, assert it's a UUID. If not, 404 with the resource name.
 */
import type { Context, Next } from 'hono';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prefix segment → "Resource name" used in the 404 message. The NEXT path
// segment after the prefix is expected to be a UUID.
const PREFIX_RESOURCE: Record<string, string> = {
  sessions: 'Session',
  modules: 'Module',
  polls: 'Poll',
  users: 'User',
  questions: 'Question',
  reflections: 'Reflection',
  confusion: 'Confusion',
  // Nested keyword segments that also take a UUID right after them.
  session: 'Session',
  module: 'Module',
  impersonate: 'User',
  answer: 'Question',
};

// Segments that follow a prefix but are NOT UUIDs (route constants). We
// shouldn't try to validate these as UUIDs.
const NON_UUID_FOLLOWERS = new Set([
  'module', 'session', 'health', '', 'me', 'verify',
]);

export async function validateUuidParams(c: Context, next: Next) {
  // c.req.path is e.g. "/sessions/not-a-uuid/pdf" or "/api/polls/abc/results".
  const segments = c.req.path.split('/').filter(Boolean);
  for (let i = 0; i < segments.length - 1; i++) {
    const prefix = segments[i];
    const value = segments[i + 1];
    if (!(prefix in PREFIX_RESOURCE)) continue;
    if (NON_UUID_FOLLOWERS.has(value)) continue;
    if (!UUID_RE.test(value)) {
      return c.json({ error: `${PREFIX_RESOURCE[prefix]} not found` }, 404);
    }
  }
  await next();
}
