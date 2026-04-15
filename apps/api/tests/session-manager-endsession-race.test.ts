/**
 * Unit tests for endSession re-entrancy.
 *
 * endSession can be triggered from three independent paths:
 *   1. POST /sessions/:id/end (REST)
 *   2. WS message { type: 'SESSION_END' }
 *   3. scheduleAutoEnd timer (90 min)
 *
 * Without a re-entrancy guard, two concurrent invocations both pass the
 * `this.rooms.get(sessionId)` check (the room is only deleted at the very
 * end, after awaited DB writes) and both flush student feedback — inserting
 * duplicate rows into feedback_events. Since feedback_events has no unique
 * constraint on (sessionId, studentId, slideIndex, emoji, selectedAt), the
 * dupes persist and corrupt per-slide analytics (time-on-emoji is double).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── DB mock that records inserts so we can count feedback_events writes ────

const insertCalls: Array<{ values: any }> = [];

vi.mock('../src/db/index.js', () => {
  const thenable = (resolveValue: unknown = []) => {
    const p: any = Promise.resolve(resolveValue);
    p.onConflictDoNothing = () => Promise.resolve();
    p.where = () => thenable(resolveValue);
    p.set = () => thenable(resolveValue);
    return p;
  };
  return {
    db: {
      insert: () => ({
        values: (v: any) => {
          // feedbackEvents rows have an `emoji` field; others don't
          if (v && typeof v === 'object' && 'emoji' in v) {
            insertCalls.push({ values: v });
          }
          return thenable();
        },
      }),
      select: () => ({ from: () => ({ where: () => thenable([]) }) }),
      update: () => ({ set: () => ({ where: () => thenable() }) }),
    },
  };
});

import { SessionManager } from '../src/ws/session-manager.js';

function mkWs() {
  const sent: any[] = [];
  return {
    sent,
    ws: {
      send: (m: string) => sent.push(JSON.parse(m)),
      close: () => {},
    } as any,
  };
}

describe('SessionManager — endSession re-entrancy', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
    insertCalls.length = 0;
  });

  afterEach(async () => {
    await sm.endSession('sid').catch(() => {});
  });

  it('concurrent endSession calls flush feedback exactly once per student', async () => {
    const lec = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);

    // Three students vote
    const s1 = mkWs();
    const s2 = mkWs();
    const s3 = mkWs();
    await sm.joinAsStudent('sid', 's1', 'S1', s1.ws);
    await sm.joinAsStudent('sid', 's2', 'S2', s2.ws);
    await sm.joinAsStudent('sid', 's3', 'S3', s3.ws);
    sm.handleFeedback('sid', 's1', 'got_it', 0);
    sm.handleFeedback('sid', 's2', 'confused', 0);
    sm.handleFeedback('sid', 's3', 'lost', 0);

    // Baseline — handleFeedback doesn't flush the FIRST vote to DB, so
    // insertCalls should be empty.
    expect(insertCalls.length).toBe(0);

    // Fire endSession from two paths simultaneously (REST + WS, say).
    await Promise.all([sm.endSession('sid'), sm.endSession('sid')]);

    // Exactly one flush per student — no duplicates.
    expect(insertCalls.length).toBe(3);
  });

  it('endSession is idempotent after the room has been cleaned up', async () => {
    const lec = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);

    const s1 = mkWs();
    await sm.joinAsStudent('sid', 's1', 'S1', s1.ws);
    sm.handleFeedback('sid', 's1', 'got_it', 0);

    await sm.endSession('sid');
    const afterFirst = insertCalls.length;

    // Calling again must NOT re-flush or error.
    await sm.endSession('sid');
    expect(insertCalls.length).toBe(afterFirst);
  });
});
