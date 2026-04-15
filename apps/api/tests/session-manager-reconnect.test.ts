/**
 * Unit tests for SessionManager reconnect race conditions.
 *
 * These test the in-memory room bookkeeping without touching the DB
 * (db is mocked below). They target the specific race where a stale
 * WebSocket's onClose fires *after* the client has already reconnected,
 * which previously caused the participant to be evicted from the room
 * and the active-user count to flicker down to 0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── DB mock ────────────────────────────────────────────────────────────────
//
// session-manager uses drizzle fluent builders: db.insert().values().catch(),
// db.select().from().where(), db.update().set().where(). We return a thenable
// at every terminal step so both awaited and fire-and-forget chains work.

vi.mock('../src/db/index.js', () => {
  const thenable = (resolveValue: unknown = []) => {
    const p: any = Promise.resolve(resolveValue);
    p.onConflictDoNothing = () => Promise.resolve();
    p.where = () => thenable(resolveValue);
    p.set = () => thenable(resolveValue);
    return p;
  };
  // notifySessionLive/Ended now filter the dashboard broadcast to the
  // module's audience (lecturer + enrolled students). The dashboard race
  // test uses 'user1' / 'mod1', so the mocked SELECTs return a matching
  // row so 'user1' passes the audience check.
  const selectRow: any = {
    // satisfies fanoutToModuleAudience (modules + enrollments)
    lecturerId: 'user1',
    studentId: 'user1',
    moduleId: 'mod1',
    // satisfies join*/endSession session lookup (no-op defaults)
    currentSlideIndex: 0,
    totalSlides: 0,
  };
  return {
    db: {
      insert: () => ({ values: () => thenable() }),
      select: () => ({ from: () => ({ where: () => thenable([selectRow]) }) }),
      update: () => ({ set: () => ({ where: () => thenable() }) }),
    },
  };
});

import { SessionManager } from '../src/ws/session-manager.js';

// ── WS test double ────────────────────────────────────────────────────────

interface FakeWs {
  ws: any;
  sent: any[];
  closed: boolean;
}

function mkWs(): FakeWs {
  const sent: any[] = [];
  const fake: FakeWs = {
    sent,
    closed: false,
    ws: {
      send: (m: string) => sent.push(JSON.parse(m)),
      close: () => {
        fake.closed = true;
      },
    },
  };
  return fake;
}

function lastCount(lec: FakeWs): number | undefined {
  const counts = lec.sent.filter((m) => m.type === 'PARTICIPANT_COUNT');
  return counts.at(-1)?.active;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SessionManager — reconnect race', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
  });

  afterEach(async () => {
    // Clear the engagement setInterval so vitest can exit.
    await sm.endSession('sid').catch(() => {});
  });

  it('stale onClose does not evict a student who has already reconnected', async () => {
    const lec = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);

    const oldS = mkWs();
    await sm.joinAsStudent('sid', 'stu1', 'Stu', oldS.ws);
    expect(lastCount(lec)).toBe(1);

    // Student reconnects with a fresh WS before the old one's onClose fires.
    const newS = mkWs();
    await sm.joinAsStudent('sid', 'stu1', 'Stu', newS.ws);
    expect(lastCount(lec)).toBe(1); // still 1, no flicker on reconnect

    // The old WS's onClose now fires (server finally notices the dead TCP).
    sm.disconnectStudent('sid', 'stu1', oldS.ws);

    // The student is still in the room — the stale close must be a no-op.
    expect(lastCount(lec)).toBe(1);
  });

  it('real disconnect still evicts the student and drops the count', async () => {
    const lec = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);

    const s = mkWs();
    await sm.joinAsStudent('sid', 'stu1', 'Stu', s.ws);
    expect(lastCount(lec)).toBe(1);

    sm.disconnectStudent('sid', 'stu1', s.ws);
    expect(lastCount(lec)).toBe(0);
  });

  it('closes the superseded WS when a student reconnects', async () => {
    const lec = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);

    const oldS = mkWs();
    await sm.joinAsStudent('sid', 'stu1', 'Stu', oldS.ws);

    const newS = mkWs();
    await sm.joinAsStudent('sid', 'stu1', 'Stu', newS.ws);

    // The old WS should have been proactively closed so the client and
    // browser stop thinking it's alive.
    expect(oldS.closed).toBe(true);
    expect(newS.closed).toBe(false);
  });

  it('stale dashboard onClose does not drop a reconnected user from notifySessionLive targets', async () => {
    const oldD = mkWs();
    sm.joinDashboard('user1', oldD.ws);

    const newD = mkWs();
    sm.joinDashboard('user1', newD.ws);

    // The superseded socket should have been closed proactively.
    expect(oldD.closed).toBe(true);

    // Stale onClose from the old socket must NOT evict the reconnected user.
    sm.disconnectDashboard('user1', oldD.ws);

    sm.notifySessionLive('sid', 'mod1', 'Live');
    // notifySessionLive fires fanoutToModuleAudience as void (await'd DB
    // round-trip internally). Flush microtasks so the broadcast lands before
    // the assertion.
    await new Promise((r) => setTimeout(r, 0));
    expect(newD.sent.some((m) => m.type === 'SESSION_LIVE')).toBe(true);
  });

  it('stale onClose does not wipe a lecturer who has already reconnected', async () => {
    const oldL = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', oldL.ws);

    // Add a student so we can observe LECTURER_DISCONNECTED broadcasts.
    const s = mkWs();
    await sm.joinAsStudent('sid', 'stu1', 'Stu', s.ws);

    // Lecturer reconnects.
    const newL = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', newL.ws);

    // Student should not see a spurious LECTURER_DISCONNECTED after reconnect.
    const countAfterReconnect = s.sent.filter((m) => m.type === 'LECTURER_DISCONNECTED').length;

    // Old WS's onClose now fires late.
    sm.disconnectLecturer('sid', oldL.ws);

    const countAfterStaleClose = s.sent.filter((m) => m.type === 'LECTURER_DISCONNECTED').length;
    expect(countAfterStaleClose).toBe(countAfterReconnect);

    // New lecturer WS should still be receiving broadcasts (participant count).
    newL.sent.length = 0;
    const s2 = mkWs();
    await sm.joinAsStudent('sid', 'stu2', 'Stu2', s2.ws);
    expect(newL.sent.some((m) => m.type === 'PARTICIPANT_COUNT')).toBe(true);
  });
});
