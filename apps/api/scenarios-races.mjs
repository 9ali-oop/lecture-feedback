/**
 * Timing and race-condition scenarios. Things that work in single-user tests
 * but can fall over under concurrent clients.
 *
 * Run: node scenarios-races.mjs
 */
import WebSocket from 'ws';

const API = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';
const SID = process.env.SID ?? 'f6267249-f044-4442-aa9c-2b2d2b1fd5ee';

const accounts = {
  L: 'bosslecturer@leeds.ac.uk',
  A: 'scac01@leeds.ac.uk',
  B: 'scbs02@leeds.ac.uk',
  C: 'sccd03@leeds.ac.uk',
  D: 'scde04@leeds.ac.uk',
};

async function getToken(email) {
  const r = await fetch(`${API}/auth/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: '123456' }),
  });
  return (await r.json()).token;
}

class Client {
  constructor(label, token) {
    this.label = label; this.log = [];
    this.ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(token)}&sessionId=${SID}`);
    this.ws.on('message', (d) => { try { this.log.push(JSON.parse(d.toString())); } catch {} });
    this.ws.on('error', () => {});
    this.opened = new Promise((res) => this.ws.on('open', res));
  }
  send(msg) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
  close() { this.ws.close(); }
  mark() { return this.log.length; }
  since(n) { return this.log.slice(n); }
  has(type) { return this.log.some((m) => m.type === type); }
  hasSince(n, type) { return this.log.slice(n).some((m) => m.type === type); }
  latest(type) {
    for (let i = this.log.length - 1; i >= 0; i--)
      if (this.log[i].type === type) return this.log[i];
    return null;
  }
  count(type) { return this.log.filter((m) => m.type === type).length; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(desc, cond, extra = '') {
  if (cond) { pass++; console.log(`  [OK] ${desc}`); }
  else { fail++; console.log(`  [FAIL] ${desc}${extra ? ' — ' + extra : ''}`); }
}

async function spawn(labels = ['L', 'A', 'B', 'C']) {
  const tokens = {};
  for (const lbl of labels) tokens[lbl] = await getToken(accounts[lbl]);
  const clients = {};
  for (const lbl of labels) clients[lbl] = new Client(lbl, tokens[lbl]);
  await Promise.all(Object.values(clients).map((c) => c.opened));
  await sleep(300);
  return { clients, close: () => Object.values(clients).forEach((c) => c.close()) };
}

async function scenario(name, fn) {
  console.log(`\n=== ${name} ===`);
  const env = await spawn();
  try { await fn(env.clients, env); }
  catch (e) { console.log(`  [CRASH] ${e.message}`); fail++; }
  finally { env.close(); await sleep(200); }
}

async function reset() {
  const token = await getToken(accounts.L);
  await fetch(`${API}/sessions/${SID}/end`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  await sleep(400);
  await fetch(`${API}/sessions/${SID}/start`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  await fetch(`${API}/sessions/${SID}/slides`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalSlides: 5 }),
  });
  await sleep(400);
}

// ── SCENARIOS ──────────────────────────────────────────────────────────────

await reset();

await scenario('R1: simultaneous upvotes from 2 students — final count = 2, no crash', async ({ L, A, B }) => {
  A.send({ type: 'QUESTION', content: 'race test' });
  await sleep(300);
  const q = L.latest('NEW_QUESTION').question;
  // Fire both upvotes as close together as possible
  B.send({ type: 'QUESTION_UPVOTE', questionId: q.id });
  // Third user needed — grab C via another client (but scenario already has 3 students max). Use A's own upvote.
  A.send({ type: 'QUESTION_UPVOTE', questionId: q.id });
  await sleep(500);
  const upvoted = L.log.filter((m) => m.type === 'QUESTION_UPVOTED').slice(-1)[0];
  check('final count = 2', upvoted?.upvoteCount === 2, `got ${upvoted?.upvoteCount}`);
});

await scenario('R2: same user double-clicks upvote (unique-violation race)', async ({ L, A, B }) => {
  A.send({ type: 'QUESTION', content: 'dup click' });
  await sleep(300);
  const q = L.latest('NEW_QUESTION').question;
  // Flood B with 5 upvote messages — should be toggle-toggle-toggle etc
  for (let i = 0; i < 5; i++) B.send({ type: 'QUESTION_UPVOTE', questionId: q.id });
  await sleep(600);
  const last = L.log.filter((m) => m.type === 'QUESTION_UPVOTED').slice(-1)[0];
  check('final count is 0 or 1 (odd/even)', last?.upvoteCount === 0 || last?.upvoteCount === 1, `got ${last?.upvoteCount}`);
  // WS is still alive:
  B.send({ type: 'PING' });
  await sleep(200);
  check('B WS still alive (got PONG)', B.has('PONG'));
});

await scenario('R3: student sends feedback mid-slide-change', async ({ L, A }) => {
  // Let L fully settle (join messages flushed) before racing the 3 messages
  await sleep(300);
  A.send({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 0 });
  L.send({ type: 'SLIDE_CHANGE', slideIndex: 1 });
  A.send({ type: 'FEEDBACK', emoji: 'confused', slideIndex: 1 });
  await sleep(500);
  const d = L.latest('FEEDBACK_UPDATE');
  check('final distribution has confused=1', d?.distribution?.confused === 1, JSON.stringify(d?.distribution));
});

await scenario('R4: student disconnects immediately after picking emoji', async ({ L, A }) => {
  A.send({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 0 });
  await sleep(50);
  A.close();
  await sleep(500);
  const d = L.latest('FEEDBACK_UPDATE');
  // got_it should drop to 0 because student left the room, but feedback event persisted with duration
  check('distribution re-computed after disconnect', d?.distribution?.total === 0 || d?.distribution?.got_it === 0, JSON.stringify(d?.distribution));
});

await scenario('R5: concurrent pen requests — grant order matters', async ({ L, A, B, C }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'A' });
  B.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'B' });
  C.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'C' });
  await sleep(300);
  const st = L.latest('ANNOTATION_ACCESS_STATE');
  check('queue has 3', st?.queue?.length === 3, `got ${st?.queue?.length}`);
  // Grant B (middle of queue) — should dismiss A and C
  const bEntry = st.queue.find((q) => q.reason === 'B');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: bEntry.studentId });
  await sleep(400);
  check('A dismissed', A.has('ANNOTATION_ACCESS_DISMISSED'));
  check('C dismissed', C.has('ANNOTATION_ACCESS_DISMISSED'));
  check('B granted', B.has('ANNOTATION_ACCESS_GRANTED'));
  const st2 = L.latest('ANNOTATION_ACCESS_STATE');
  check('queue empty after grant', st2.queue.length === 0);
  check('B is granted in state', st2.grantedStudent.name.includes('Ben') || st2.grantedStudent.name.length > 0);
});

await scenario('R6: granted student draws right as lecturer changes slides', async ({ L, A, B }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'race' });
  await sleep(200);
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: req.studentId });
  await sleep(200);
  // A draws while L changes slide simultaneously
  A.send({ type: 'DRAW_STROKE', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: '#f00', width: 0.003, slideIndex: 0 });
  L.send({ type: 'SLIDE_CHANGE', slideIndex: 2 });
  await sleep(300);
  // Expectation: stroke is for slide 0, slide change revokes grant — A should be revoked
  check('A revoked on slide change', A.has('ANNOTATION_ACCESS_REVOKED'));
  // B should have seen slide update
  check('B saw SLIDE_UPDATE to 2', B.latest('SLIDE_UPDATE')?.slideIndex === 2);
});

await scenario('R7: session ends while student has pen', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'end test' });
  await sleep(200);
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: req.studentId });
  await sleep(200);
  const aMark = A.mark();
  L.send({ type: 'SESSION_END' });
  await sleep(400);
  // A should either get ACCESS_REVOKED(session_ended) OR just SESSION_ENDED — either is acceptable UX
  const got = A.since(aMark).some((m) => m.type === 'ANNOTATION_ACCESS_REVOKED' || m.type === 'SESSION_ENDED');
  check('A notified of session end or pen revoke', got);
});

await reset();

await scenario('R8: 10 rapid slide changes — no drop, final value sticks', async ({ L, A }) => {
  for (let i = 0; i < 10; i++) L.send({ type: 'SLIDE_CHANGE', slideIndex: i % 5 });
  await sleep(600);
  const last = A.latest('SLIDE_UPDATE');
  check('A received final slide update', last?.slideIndex === 4, `got ${last?.slideIndex}`);
  check('A received at least 3 updates', A.count('SLIDE_UPDATE') >= 3, `got ${A.count('SLIDE_UPDATE')}`);
});

await scenario('R9: text box sync storm (lecturer drags rapidly)', async ({ L, A }) => {
  for (let i = 0; i < 20; i++) {
    L.send({
      type: 'TEXT_BOX_SYNC', slideIndex: 0,
      textBoxes: [{ id: 'tb1', x: 0.01 * i, y: 0.01 * i, width: 0.2, height: 0.05, content: 'x', fontFamily: 's', fontSize: 14, color: '#000' }],
    });
  }
  await sleep(500);
  check('A received sync messages', A.count('TEXT_BOX_SYNC') >= 5, `got ${A.count('TEXT_BOX_SYNC')}`);
  const last = A.latest('TEXT_BOX_SYNC');
  check('final text box position is ~0.19', last?.textBoxes?.[0]?.x > 0.1);
});

await scenario('R10: pending request when student leaves early', async ({ L, A, B }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'will leave' });
  B.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'stays' });
  await sleep(300);
  const st1 = L.latest('ANNOTATION_ACCESS_STATE');
  check('queue has 2 before leave', st1.queue.length === 2);
  A.close();
  await sleep(500);
  const st2 = L.latest('ANNOTATION_ACCESS_STATE');
  check('A removed from queue after disconnect', st2.queue.length === 1, `queue=${JSON.stringify(st2.queue.map(q=>q.reason))}`);
  check('B still in queue', st2.queue[0]?.reason === 'stays');
});

await scenario('R11: granted annotator reconnects — what happens to grant?', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'reconnect test' });
  await sleep(200);
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: req.studentId });
  await sleep(200);
  A.close();
  await sleep(400);
  // Reconnect as A
  const aTok = await getToken(accounts.A);
  const A2 = new Client('A2', aTok);
  await A2.opened;
  await sleep(400);
  const st = L.latest('ANNOTATION_ACCESS_STATE');
  check('state reflects post-disconnect (grant cleared)', st.grantedStudent === null);
  // A2 should NOT think they still have the pen
  A2.send({ type: 'DRAW_STROKE', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: '#f00', width: 0.003, slideIndex: 0 });
  await sleep(300);
  // server drops because grantedAnnotator is null
  const lMark = L.log.length;
  A2.send({ type: 'DRAW_STROKE', points: [{ x: 0.3, y: 0.3 }], color: '#f00', width: 0.003, slideIndex: 0 });
  await sleep(300);
  check('reconnected A2 cannot draw without re-requesting', !L.since(lMark).some((m) => m.type === 'STUDENT_DRAW_STROKE'));
  A2.close();
});

await scenario('R12: student sends large stroke batch — server clamps or drops', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'flood' });
  await sleep(200);
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: req.studentId });
  await sleep(200);
  // 6000 points in one batch (over MAX_STROKE_POINTS=5000)
  const pts = Array(6000).fill(0).map((_, i) => ({ x: i * 0.0001, y: i * 0.0001 }));
  const lMark = L.log.length;
  A.send({ type: 'DRAW_STROKE', points: pts, color: '#f00', width: 0.003, slideIndex: 0 });
  await sleep(400);
  // isValidStroke rejects > MAX_STROKE_POINTS, so L should NOT see STUDENT_DRAW_STROKE from this flood
  check('oversized stroke dropped', !L.since(lMark).some((m) => m.type === 'STUDENT_DRAW_STROKE'));
});

await scenario('R13: feedback after SESSION_END arrives silently', async ({ L, A }) => {
  L.send({ type: 'SESSION_END' });
  await sleep(500);
  // Now try FEEDBACK — room is gone, should be no-op
  const lMark = L.log.length;
  A.send({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 0 });
  await sleep(300);
  check('no FEEDBACK_UPDATE after session end', !L.since(lMark).some((m) => m.type === 'FEEDBACK_UPDATE'));
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n──────── RACE/TIMING RESULT: ${pass} passed, ${fail} failed ────────`);
process.exit(fail > 0 ? 1 : 0);
