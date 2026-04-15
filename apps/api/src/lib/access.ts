/**
 * Shared session-access helpers used by every route that touches session-scoped
 * data (polls, questions, notes, confusion, reflections, …). Without these,
 * each route that only checked role would let a user from one module read or
 * write data belonging to a different module entirely — any logged-in student
 * could e.g. vote on polls in a session they aren't enrolled in.
 *
 * Rules:
 *   - admin → always allowed
 *   - lecturer → must own the module
 *   - student → must be enrolled in the module
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { modules, moduleEnrollments, sessions } from '../db/schema.js';

export type AccessResult =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 410; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True if the string is a valid UUID shape. Use this to guard any DB lookup
 * keyed by a client-supplied id — Postgres throws `invalid input syntax for
 * type uuid` on malformed values, which leaks both the error class and the
 * input back to the caller as a 500. A 404 is the right response.
 */
export function isUuid(s: string | undefined | null): s is string {
  return typeof s === 'string' && UUID_RE.test(s);
}

/** Check that the given user may act on data belonging to this module. */
export async function requireModuleAccess(
  moduleId: string,
  role: string,
  sub: string,
): Promise<AccessResult> {
  if (!isUuid(moduleId)) return { ok: false, status: 404, message: 'Module not found' };
  const mod = (await db.select().from(modules).where(eq(modules.id, moduleId)))[0];
  if (!mod) return { ok: false, status: 404, message: 'Module not found' };
  if (role === 'admin') return { ok: true };
  if (role === 'lecturer') {
    if (mod.lecturerId !== sub) return { ok: false, status: 403, message: 'Forbidden' };
    return { ok: true };
  }
  // student -- must be enrolled
  const enrollment = await db
    .select()
    .from(moduleEnrollments)
    .where(and(eq(moduleEnrollments.moduleId, moduleId), eq(moduleEnrollments.studentId, sub)));
  if (enrollment.length === 0) return { ok: false, status: 403, message: 'Forbidden' };
  return { ok: true };
}

/**
 * Resolve the session to its module, then apply requireModuleAccess.
 * The common case: routes keyed by sessionId (e.g. /questions/session/:sessionId).
 */
export async function requireSessionAccessById(
  sessionId: string,
  role: string,
  sub: string,
): Promise<AccessResult> {
  if (!isUuid(sessionId)) return { ok: false, status: 404, message: 'Session not found' };
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return { ok: false, status: 404, message: 'Session not found' };
  return requireModuleAccess(session.moduleId, role, sub);
}

/**
 * Session-access check that ALSO rejects if the session has ended. Use on
 * the WS upgrade so students can't keep participating (feedback, polls,
 * questions) in a session that's already over — the room has no lecturer
 * to see their activity, it just pollutes the DB and confuses other users
 * who might think the session is still live.
 *
 * REST routes mostly want the plain `requireSessionAccessById` because
 * read endpoints (report, questions list, ...) should still work post-end.
 */
export async function requireLiveSessionAccessById(
  sessionId: string,
  role: string,
  sub: string,
): Promise<AccessResult> {
  if (!isUuid(sessionId)) return { ok: false, status: 404, message: 'Session not found' };
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return { ok: false, status: 404, message: 'Session not found' };
  if (session.status === 'ended') {
    return { ok: false, status: 410, message: 'Session has ended' };
  }
  return requireModuleAccess(session.moduleId, role, sub);
}

/**
 * Reject out-of-range slide indices. Writes that reference a slide beyond the
 * current deck corrupt per-slide analytics (e.g. questions showing up on
 * "slide 99999 of 5"). Allow anything if totalSlides is 0 (no PDF yet — the
 * client may not know the count yet).
 */
export function isValidSlideIndex(slideIndex: number, totalSlides: number): boolean {
  if (!Number.isInteger(slideIndex) || slideIndex < 0) return false;
  if (totalSlides <= 0) return true; // no deck loaded — permissive
  return slideIndex < totalSlides;
}
