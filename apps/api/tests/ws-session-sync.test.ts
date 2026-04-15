/**
 * End-to-end WebSocket session sync tests.
 *
 * These tests run against a live API server (localhost:3000) and real database.
 * Ensure `pnpm dev` is running before executing.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import WebSocket from 'ws';

const API = 'http://localhost:3000';

// ── Helpers ────────────────────────────────────────────────────────────────

async function login(email: string, code = '123456') {
  const res = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return res.json() as Promise<{ token: string; user: { id: string; role: string } }>;
}

function connectWS(token: string, sessionId: string): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((resolve, reject) => {
    const url = `ws://localhost:3000/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
    const ws = new WebSocket(url);
    const msgs: any[] = [];
    ws.on('message', (data) => {
      try { msgs.push(JSON.parse(data.toString())); } catch { /* skip */ }
    });
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
  });
}

function waitForMsg(msgs: any[], type: string, timeout = 2000): Promise<any> {
  const existing = msgs.find((m) => m.type === type);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const found = msgs.find((m) => m.type === type);
      if (found) { clearInterval(interval); resolve(found); }
    }, 50);
    setTimeout(() => { clearInterval(interval); reject(new Error(`Timeout waiting for ${type}`)); }, timeout);
  });
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── Test suite ─────────────────────────────────────────────────────────────

describe('WebSocket session sync (E2E)', () => {
  let lecturerToken: string;
  let studentToken: string;
  let sessionId: string;
  let lecWs: WebSocket;
  let stuWs: WebSocket;
  let lecMsgs: any[];
  let stuMsgs: any[];

  beforeAll(async () => {
    // Verify API is up
    const health = await fetch(`${API}/health`);
    expect(health.ok).toBe(true);

    // Login
    const lec = await login('bosslecturer@leeds.ac.uk');
    lecturerToken = lec.token;
    expect(lec.user.role).toBe('lecturer');

    const stu = await login('oc@leeds.ac.uk');
    studentToken = stu.token;
    expect(stu.user.role).toBe('student');

    // Find a live session
    const modRes = await fetch(`${API}/modules`, { headers: { Authorization: `Bearer ${lecturerToken}` } });
    const modules = await modRes.json() as any[];
    for (const mod of modules) {
      const sessRes = await fetch(`${API}/sessions/module/${mod.id}`, {
        headers: { Authorization: `Bearer ${lecturerToken}` },
      });
      const sessions = await sessRes.json() as any[];
      const live = sessions.find((s: any) => s.status === 'live');
      if (live) { sessionId = live.id; break; }
    }
    expect(sessionId).toBeDefined();
  });

  afterEach(() => {
    // Clear message buffers between tests
    if (lecMsgs) lecMsgs.length = 0;
    if (stuMsgs) stuMsgs.length = 0;
  });

  afterAll(() => {
    lecWs?.close();
    stuWs?.close();
  });

  it('connects both lecturer and student WebSockets', async () => {
    const lec = await connectWS(lecturerToken, sessionId);
    lecWs = lec.ws;
    lecMsgs = lec.msgs;

    const stu = await connectWS(studentToken, sessionId);
    stuWs = stu.ws;
    stuMsgs = stu.msgs;

    await sleep(500);

    // Lecturer should receive initial state
    expect(lecMsgs.some((m) => m.type === 'SLIDE_UPDATE')).toBe(true);
    expect(lecMsgs.some((m) => m.type === 'PARTICIPANT_COUNT')).toBe(true);
    expect(lecMsgs.some((m) => m.type === 'FEEDBACK_UPDATE')).toBe(true);

    // Student should receive slide update and annotation sync
    expect(stuMsgs.some((m) => m.type === 'SLIDE_UPDATE')).toBe(true);
    expect(stuMsgs.some((m) => m.type === 'ANNOTATION_SYNC')).toBe(true);
  });

  it('syncs slide changes from lecturer to student', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 3 }));

    const msg = await waitForMsg(stuMsgs, 'SLIDE_UPDATE');
    expect(msg.slideIndex).toBe(3);
    expect(msg.totalSlides).toBeGreaterThan(0);
  });

  it('syncs emoji feedback from student to lecturer', async () => {
    lecMsgs.length = 0;
    stuWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 3 }));

    const msg = await waitForMsg(lecMsgs, 'FEEDBACK_UPDATE');
    expect(msg.distribution).toBeDefined();
    expect(msg.distribution.got_it).toBeGreaterThanOrEqual(1);
  });

  it('syncs laser pointer from lecturer to student', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'LASER_MOVE', x: 0.5, y: 0.5, slideIndex: 3 }));

    const msg = await waitForMsg(stuMsgs, 'LASER_MOVE');
    expect(msg.x).toBe(0.5);
    expect(msg.y).toBe(0.5);
    expect(msg.slideIndex).toBe(3);
  });

  it('syncs laser pause from lecturer to student', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'LASER_PAUSE', x: 0.3, y: 0.4, slideIndex: 3 }));

    const msg = await waitForMsg(stuMsgs, 'LASER_PAUSE');
    expect(msg.x).toBe(0.3);
    expect(msg.y).toBe(0.4);
  });

  it('syncs laser end from lecturer to student', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'LASER_END' }));

    const msg = await waitForMsg(stuMsgs, 'LASER_END');
    expect(msg).toBeDefined();
  });

  it('syncs draw strokes from lecturer to student', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({
      type: 'DRAW_STROKE',
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      color: '#ff0000',
      width: 0.005,
      slideIndex: 3,
    }));

    const msg = await waitForMsg(stuMsgs, 'DRAW_STROKE');
    expect(msg.points).toHaveLength(2);
    expect(msg.color).toBe('#ff0000');
  });

  it('syncs erase strokes from lecturer to student', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({
      type: 'ERASE_STROKE',
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      size: 0.03,
      slideIndex: 3,
    }));

    const msg = await waitForMsg(stuMsgs, 'ERASE_STROKE');
    expect(msg.points).toHaveLength(2);
    expect(msg.size).toBe(0.03);
  });

  it('syncs clear annotations from lecturer to student', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'CLEAR_ANNOTATIONS', slideIndex: 3 }));

    const msg = await waitForMsg(stuMsgs, 'CLEAR_ANNOTATIONS');
    expect(msg.slideIndex).toBe(3);
  });

  it('syncs cursor position from lecturer to student', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'CURSOR_POSITION', x: 0.6, y: 0.7, tool: 'pen', slideIndex: 3 }));

    const msg = await waitForMsg(stuMsgs, 'CURSOR_POSITION');
    expect(msg.x).toBe(0.6);
    expect(msg.tool).toBe('pen');
  });

  it('syncs cursor hide from lecturer to student', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'CURSOR_HIDE' }));

    const msg = await waitForMsg(stuMsgs, 'CURSOR_HIDE');
    expect(msg).toBeDefined();
  });

  it('syncs pace feedback from student to lecturer', async () => {
    lecMsgs.length = 0;
    stuWs.send(JSON.stringify({ type: 'PACE_FEEDBACK', value: 'fast' }));

    const msg = await waitForMsg(lecMsgs, 'PACE_UPDATE');
    expect(msg.distribution).toBeDefined();
    expect(msg.distribution.fast).toBeGreaterThanOrEqual(1);
  });

  it('delivers Q&A questions from student to lecturer', async () => {
    lecMsgs.length = 0;
    stuWs.send(JSON.stringify({ type: 'QUESTION', content: 'Test question from E2E' }));

    const msg = await waitForMsg(lecMsgs, 'NEW_QUESTION');
    expect(msg.question.content).toBe('Test question from E2E');
    expect(msg.question.answered).toBe(false);
  });

  it('delivers question upvotes to both sides', async () => {
    // Send a fresh question first
    stuWs.send(JSON.stringify({ type: 'QUESTION', content: 'Upvote test question' }));
    const qMsg = await waitForMsg(lecMsgs, 'NEW_QUESTION');

    lecMsgs.length = 0;
    stuMsgs.length = 0;
    stuWs.send(JSON.stringify({ type: 'QUESTION_UPVOTE', questionId: qMsg.question.id }));

    const lecUpvote = await waitForMsg(lecMsgs, 'QUESTION_UPVOTED');
    expect(lecUpvote.upvoteCount).toBeGreaterThanOrEqual(1);

    const stuUpvote = await waitForMsg(stuMsgs, 'QUESTION_UPVOTED');
    expect(stuUpvote.questionId).toBe(qMsg.question.id);
  });

  it('handles annotation access request from student to lecturer', async () => {
    lecMsgs.length = 0;
    stuWs.send(JSON.stringify({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'E2E test request' }));

    const msg = await waitForMsg(lecMsgs, 'ANNOTATION_ACCESS_REQUESTED');
    expect(msg.reason).toBe('E2E test request');
    expect(msg.studentName).toBeDefined();
  });

  it('resets feedback distribution on slide change', async () => {
    lecMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 5 }));

    const feedback = await waitForMsg(lecMsgs, 'FEEDBACK_UPDATE');
    expect(feedback.distribution.total).toBe(0);
  });

  it('sends annotation sync to student on slide change', async () => {
    stuMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 6 }));

    const sync = await waitForMsg(stuMsgs, 'ANNOTATION_SYNC');
    expect(sync.slideIndex).toBe(6);
    expect(Array.isArray(sync.annotations)).toBe(true);
  });

  it('handles PING/PONG keepalive', async () => {
    lecMsgs.length = 0;
    lecWs.send(JSON.stringify({ type: 'PING' }));

    const pong = await waitForMsg(lecMsgs, 'PONG');
    expect(pong).toBeDefined();
  });

  // ── Regression: stale duplicate-socket close must not kick the live connection ──
  // Repro scenario: React StrictMode double-mount, browser refresh, tab duplication,
  // or the 3s auto-reconnect in ws.ts can produce two sockets for the same userId.
  // The server stores the newer ws under the same key; the older ws's eventual close
  // must not remove the live entry or null out the live lecturer ws.
  it('keeps live student ws when a stale duplicate closes (regression)', async () => {
    const stu2 = await connectWS(studentToken, sessionId);
    await sleep(300);

    // Close the ORIGINAL (now-stale) socket — its onClose must not evict stu2.
    stuWs.close();
    await sleep(500);

    // If the bug is present, the stale close removed stu2 from the room map,
    // so feedback from stu2 will never reach the lecturer.
    lecMsgs.length = 0;
    stu2.ws.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 6 }));
    const msg = await waitForMsg(lecMsgs, 'FEEDBACK_UPDATE', 2500);
    expect(msg.distribution.got_it).toBeGreaterThanOrEqual(1);

    // Hand over to stu2 for any remaining teardown.
    stuWs = stu2.ws;
    stuMsgs = stu2.msgs;
  });

  it('keeps live lecturer ws when a stale duplicate closes (regression)', async () => {
    const lec2 = await connectWS(lecturerToken, sessionId);
    await sleep(300);

    lecWs.close();
    await sleep(500);

    // If bug present, onClose for the stale lecWs set room.lecturerWs = null,
    // so lec2's SLIDE_CHANGE still reaches students (it goes via room.students)
    // but lec2 itself would stop receiving FEEDBACK updates. Test both directions.
    stuMsgs.length = 0;
    lec2.ws.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 7 }));
    const slideMsg = await waitForMsg(stuMsgs, 'SLIDE_UPDATE', 2500);
    expect(slideMsg.slideIndex).toBe(7);

    // Now confirm lec2 still receives feedback broadcasts (the canary for
    // room.lecturerWs being nulled out by the stale close).
    const lec2Msgs = lec2.msgs;
    lec2Msgs.length = 0;
    stuWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'confused', slideIndex: 7 }));
    const fb = await waitForMsg(lec2Msgs, 'FEEDBACK_UPDATE', 2500);
    expect(fb.distribution.confused).toBeGreaterThanOrEqual(1);

    lecWs = lec2.ws;
    lecMsgs = lec2.msgs;
  });
});
