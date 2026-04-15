/**
 * Multi-user interaction scenarios. Spins up 4 WS clients (lecturer + 3
 * students) and walks through every state transition for the pen, Q&A,
 * polls, feedback, pace, and slide-change features. Reports PASS/FAIL per
 * assertion.
 *
 * Run: node scenarios.mjs
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
};

async function getToken(email) {
  const r = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: '123456' }),
  });
  const j = await r.json();
  return j.token;
}

class Client {
  constructor(label, token) {
    this.label = label;
    this.log = [];
    this.ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(token)}&sessionId=${SID}`);
    this.ws.on('message', (d) => {
      try { this.log.push(JSON.parse(d.toString())); } catch {}
    });
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
  try { await fn(env.clients); }
  catch (e) { console.log(`  [CRASH] ${e.message}`); fail++; }
  finally { env.close(); await sleep(150); }
}

async function reset() {
  const token = await getToken(accounts.L);
  await fetch(`${API}/sessions/${SID}/end`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  await sleep(500);
  await fetch(`${API}/sessions/${SID}/start`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  await fetch(`${API}/sessions/${SID}/slides`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalSlides: 5 }),
  });
  await sleep(500);
}

// ── SCENARIOS ──────────────────────────────────────────────────────────────

await reset();

await scenario('P1: request → grant → draw broadcasts to all', async ({ L, A, B, C }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'answer q1' });
  await sleep(250);
  check('L received REQUESTED', L.has('ANNOTATION_ACCESS_REQUESTED'));
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: req.studentId });
  await sleep(250);
  check('A received GRANTED', A.has('ANNOTATION_ACCESS_GRANTED'));
  A.send({ type: 'DRAW_STROKE', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: '#f00', width: 0.003, slideIndex: 0 });
  await sleep(200);
  check('L sees STUDENT_DRAW_STROKE', L.has('STUDENT_DRAW_STROKE'));
  check('B sees STUDENT_DRAW_STROKE', B.has('STUDENT_DRAW_STROKE'));
  check('C sees STUDENT_DRAW_STROKE', C.has('STUDENT_DRAW_STROKE'));
});

await scenario('P2: two simultaneous requests queue in order', async ({ L, A, B }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'r-A' });
  await sleep(50);
  B.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'r-B' });
  await sleep(300);
  const st = L.latest('ANNOTATION_ACCESS_STATE');
  check('L queue has 2', st?.queue?.length === 2, `got ${st?.queue?.length}`);
  check('A is first', st?.queue?.[0]?.reason === 'r-A');
  check('B is second', st?.queue?.[1]?.reason === 'r-B');
});

await scenario('P3: grant A then grant B → A auto-revoked', async ({ L, A, B }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'first' });
  await sleep(200);
  const reqA = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: reqA.studentId });
  await sleep(200);
  const aMark = A.mark();
  B.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'second' });
  await sleep(200);
  const reqB = L.log.slice(-5).reverse().find((m) => m.type === 'ANNOTATION_ACCESS_REQUESTED' && m.studentId === reqA.studentId === false) || L.latest('ANNOTATION_ACCESS_REQUESTED');
  // pick the latest requested that has a *different* studentId than reqA
  const bReq = L.log.filter((m) => m.type === 'ANNOTATION_ACCESS_REQUESTED' && m.studentId !== reqA.studentId).slice(-1)[0];
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: bReq.studentId });
  await sleep(300);
  check('A got REVOKED after B granted', A.hasSince(aMark, 'ANNOTATION_ACCESS_REVOKED'));
  check('B got GRANTED', B.has('ANNOTATION_ACCESS_GRANTED'));
  const st = L.latest('ANNOTATION_ACCESS_STATE');
  check('L shows B is granted', st?.grantedStudent?.id === bReq.studentId);
});

await scenario('P4: A cancels own request', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'cancel me' });
  await sleep(200);
  A.send({ type: 'ANNOTATION_ACCESS_CANCEL' });
  await sleep(200);
  const st = L.latest('ANNOTATION_ACCESS_STATE');
  check('L queue empty after cancel', st?.queue?.length === 0);
});

await scenario('P5: L dismisses A\'s request', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'dismiss me' });
  await sleep(200);
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_DISMISS', studentId: req.studentId });
  await sleep(200);
  check('A received DISMISSED', A.has('ANNOTATION_ACCESS_DISMISSED'));
});

await scenario('P6: granted student disconnects → state clears', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'dc test' });
  await sleep(200);
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: req.studentId });
  await sleep(200);
  A.close();
  await sleep(500);
  const st = L.latest('ANNOTATION_ACCESS_STATE');
  check('grantedStudent cleared on disconnect', st?.grantedStudent === null);
});

await scenario('P7: slide change auto-revokes pen', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'slide test' });
  await sleep(200);
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: req.studentId });
  await sleep(200);
  const aMark = A.mark();
  L.send({ type: 'SLIDE_CHANGE', slideIndex: 2 });
  await sleep(300);
  const rev = A.since(aMark).find((m) => m.type === 'ANNOTATION_ACCESS_REVOKED');
  check('A revoked on slide change', !!rev);
  check('reason is slide_change', rev?.reason === 'slide_change');
});

await scenario('P8: L explicitly revokes pen', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'revoke test' });
  await sleep(200);
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  L.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: req.studentId });
  await sleep(200);
  const aMark = A.mark();
  L.send({ type: 'ANNOTATION_ACCESS_REVOKE' });
  await sleep(200);
  const rev = A.since(aMark).find((m) => m.type === 'ANNOTATION_ACCESS_REVOKED');
  check('A received REVOKED', !!rev);
  check('reason is lecturer_revoked', rev?.reason === 'lecturer_revoked');
});

await scenario('P9: non-granted student\'s stroke is dropped', async ({ L, B }) => {
  B.send({ type: 'DRAW_STROKE', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: '#f00', width: 0.003, slideIndex: 0 });
  await sleep(300);
  check('L did NOT receive stroke', !L.has('STUDENT_DRAW_STROKE'));
});

await scenario('P10: duplicate request is idempotent', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'first' });
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'dup' });
  await sleep(300);
  const st = L.latest('ANNOTATION_ACCESS_STATE');
  check('L queue len = 1', st?.queue?.length === 1, `len=${st?.queue?.length}`);
  check('first reason preserved', st?.queue?.[0]?.reason === 'first');
});

// ── Q&A ────────────────────────────────────────────────────────────────────

await scenario('Q1: A asks question, broadcast to lecturer', async ({ L, A }) => {
  A.send({ type: 'QUESTION', content: 'what does this mean?' });
  await sleep(300);
  check('L received NEW_QUESTION', L.has('NEW_QUESTION'));
  const q = L.latest('NEW_QUESTION');
  check('question content correct', q?.question?.content === 'what does this mean?');
});

await scenario('Q2: B upvotes A\'s question, both see count', async ({ L, A, B }) => {
  A.send({ type: 'QUESTION', content: 'question for upvote' });
  await sleep(300);
  const q = L.latest('NEW_QUESTION').question;
  B.send({ type: 'QUESTION_UPVOTE', questionId: q.id });
  await sleep(300);
  const upvoted = L.latest('QUESTION_UPVOTED');
  check('L got QUESTION_UPVOTED', !!upvoted);
  check('upvote count = 1', upvoted?.upvoteCount === 1, `got ${upvoted?.upvoteCount}`);
  check('A got QUESTION_UPVOTED too', A.has('QUESTION_UPVOTED'));
});

await scenario('Q3: Upvote toggle — upvote twice returns to 0', async ({ L, A, B }) => {
  A.send({ type: 'QUESTION', content: 'toggle test' });
  await sleep(300);
  const q = L.latest('NEW_QUESTION').question;
  B.send({ type: 'QUESTION_UPVOTE', questionId: q.id });
  await sleep(200);
  B.send({ type: 'QUESTION_UPVOTE', questionId: q.id });
  await sleep(300);
  const last = L.log.filter((m) => m.type === 'QUESTION_UPVOTED').slice(-1)[0];
  check('final count = 0', last?.upvoteCount === 0, `got ${last?.upvoteCount}`);
});

await scenario('Q4: L marks answered, broadcast', async ({ L, A }) => {
  A.send({ type: 'QUESTION', content: 'will be answered' });
  await sleep(300);
  const q = L.latest('NEW_QUESTION').question;
  L.send({ type: 'QUESTION_ANSWERED', questionId: q.id });
  await sleep(300);
  check('A received QUESTION_ANSWERED', A.has('QUESTION_ANSWERED'));
});

// ── Feedback emojis ────────────────────────────────────────────────────────

await scenario('F1: A picks got_it, L sees distribution update', async ({ L, A }) => {
  A.send({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 0 });
  await sleep(200);
  const d = L.latest('FEEDBACK_UPDATE');
  check('L got FEEDBACK_UPDATE', !!d);
  check('got_it=1', d?.distribution?.got_it === 1, JSON.stringify(d?.distribution));
});

await scenario('F2: A switches got_it → confused', async ({ L, A }) => {
  A.send({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 0 });
  await sleep(150);
  A.send({ type: 'FEEDBACK', emoji: 'confused', slideIndex: 0 });
  await sleep(250);
  const d = L.latest('FEEDBACK_UPDATE');
  check('got_it=0, confused=1', d?.distribution?.got_it === 0 && d?.distribution?.confused === 1, JSON.stringify(d?.distribution));
});

await scenario('F3: Invalid emoji is rejected (not persisted)', async ({ L, A }) => {
  const mark = L.mark();
  A.send({ type: 'FEEDBACK', emoji: 'REKT', slideIndex: 0 });
  await sleep(250);
  const d = L.since(mark).filter((m) => m.type === 'FEEDBACK_UPDATE').slice(-1)[0];
  // Either no FEEDBACK_UPDATE at all, or distribution is empty (all zero) because msg was rejected
  if (!d) { check('no FEEDBACK_UPDATE for bad emoji', true); }
  else check('no counts for bad emoji', d.distribution.got_it === 0 && d.distribution.confused === 0 && d.distribution.lost === 0 && d.distribution.neutral === 0);
});

// ── Pace ───────────────────────────────────────────────────────────────────

await scenario('Pa1: A picks pace=fast, L sees PACE_UPDATE', async ({ L, A }) => {
  A.send({ type: 'PACE_FEEDBACK', value: 'fast' });
  await sleep(250);
  const p = L.latest('PACE_UPDATE');
  check('L got PACE_UPDATE', !!p);
  check('fast=1', p?.distribution?.fast === 1, JSON.stringify(p?.distribution));
});

await scenario('Pa2: Invalid pace value rejected', async ({ L, A }) => {
  const mark = L.mark();
  A.send({ type: 'PACE_FEEDBACK', value: 'sideways' });
  await sleep(250);
  const p = L.since(mark).filter((m) => m.type === 'PACE_UPDATE').slice(-1)[0];
  if (!p) check('no PACE_UPDATE for bad value', true);
  else check('distribution zero for bad value', (p.distribution.slow + p.distribution.ok + p.distribution.fast) === 0);
});

// ── Slide changes ──────────────────────────────────────────────────────────

await scenario('S1: L changes slide, all students update', async ({ L, A, B, C }) => {
  L.send({ type: 'SLIDE_CHANGE', slideIndex: 3 });
  await sleep(300);
  check('A got SLIDE_UPDATE', A.has('SLIDE_UPDATE'));
  check('B got SLIDE_UPDATE', B.has('SLIDE_UPDATE'));
  check('C got SLIDE_UPDATE', C.has('SLIDE_UPDATE'));
  const a = A.latest('SLIDE_UPDATE');
  check('slideIndex=3', a?.slideIndex === 3);
});

await scenario('S2: slide beyond totalSlides is clamped', async ({ L, A }) => {
  L.send({ type: 'SLIDE_CHANGE', slideIndex: 999 });
  await sleep(300);
  const u = A.latest('SLIDE_UPDATE');
  check('clamped to 4 (last slide)', u?.slideIndex === 4, `got ${u?.slideIndex}`);
});

// ── Confusion highlights ────────────────────────────────────────────────────

await scenario('C1: student submits confusion highlight → L broadcast', async ({ L, A }) => {
  const lTok = await getToken(accounts.A);
  const r = await fetch(`${API}/confusion/session/${SID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slideIndex: 0, emoji: 'confused',
      highlights: [{ shape: 'rect', x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
      explanation: 'not sure what this means',
    }),
  });
  check('REST 201', r.status === 201, `got ${r.status}`);
  await sleep(300);
  check('L got CONFUSION_AREA', L.has('CONFUSION_AREA'));
  const area = L.latest('CONFUSION_AREA');
  check('highlight preserved', area?.highlight?.shape === 'rect');
});

// ── Polls ──────────────────────────────────────────────────────────────────

await scenario('Po1: L launches poll, all students get POLL_LAUNCHED', async ({ L, A, B, C }) => {
  const lTok = await getToken(accounts.L);
  const r = await fetch(`${API}/polls/session/${SID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'which is better?', options: ['cats', 'dogs'], slideIndex: 0 }),
  });
  check('poll create 201', r.status === 201);
  await sleep(300);
  check('A got POLL_LAUNCHED', A.has('POLL_LAUNCHED'));
  check('B got POLL_LAUNCHED', B.has('POLL_LAUNCHED'));
  check('C got POLL_LAUNCHED', C.has('POLL_LAUNCHED'));
  const p = A.latest('POLL_LAUNCHED');
  check('poll has options[2]', p?.poll?.options?.length === 2);
});

await scenario('Po2: A votes, L sees POLL_RESULTS', async ({ L, A }) => {
  const lTok = await getToken(accounts.L);
  const resp = await fetch(`${API}/polls/session/${SID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'x', options: ['a', 'b', 'c'], slideIndex: 1 }),
  });
  const poll = await resp.json();
  await sleep(200);
  A.send({ type: 'POLL_RESPONSE', pollId: poll.id, optionIndex: 1 });
  await sleep(300);
  check('L got POLL_RESULTS', L.has('POLL_RESULTS'));
  const r = L.latest('POLL_RESULTS');
  check('counts show option 1 = 1', r?.results?.counts?.[1] === 1, JSON.stringify(r?.results?.counts));
});

await scenario('Po3: A changes vote, counts adjust', async ({ L, A }) => {
  const lTok = await getToken(accounts.L);
  const resp = await fetch(`${API}/polls/session/${SID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'x', options: ['a', 'b'], slideIndex: 2 }),
  });
  const poll = await resp.json();
  await sleep(200);
  A.send({ type: 'POLL_RESPONSE', pollId: poll.id, optionIndex: 0 });
  await sleep(200);
  A.send({ type: 'POLL_RESPONSE', pollId: poll.id, optionIndex: 1 });
  await sleep(300);
  const r = L.latest('POLL_RESULTS');
  check('final: option 0 = 0, option 1 = 1', r?.results?.counts?.[0] === 0 && r?.results?.counts?.[1] === 1, JSON.stringify(r?.results?.counts));
});

await scenario('Po4: L closes poll, all students get POLL_CLOSED', async ({ L, A, B }) => {
  const lTok = await getToken(accounts.L);
  const resp = await fetch(`${API}/polls/session/${SID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'x', options: ['a', 'b'], slideIndex: 3 }),
  });
  const poll = await resp.json();
  await sleep(200);
  await fetch(`${API}/polls/${poll.id}/close`, { method: 'PATCH', headers: { Authorization: `Bearer ${lTok}` } });
  await sleep(300);
  check('A got POLL_CLOSED', A.has('POLL_CLOSED'));
  check('B got POLL_CLOSED', B.has('POLL_CLOSED'));
});

await scenario('Po5: vote after close is rejected', async ({ L, A }) => {
  const lTok = await getToken(accounts.L);
  const resp = await fetch(`${API}/polls/session/${SID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'x', options: ['a', 'b'], slideIndex: 4 }),
  });
  const poll = await resp.json();
  await fetch(`${API}/polls/${poll.id}/close`, { method: 'PATCH', headers: { Authorization: `Bearer ${lTok}` } });
  await sleep(300);
  const lMark = L.mark();
  A.send({ type: 'POLL_RESPONSE', pollId: poll.id, optionIndex: 0 });
  await sleep(400);
  // After closed, WS path checks respondPoll.status === 'active' → silently drops
  check('no new POLL_RESULTS after close', !L.since(lMark).some((m) => m.type === 'POLL_RESULTS'));
});

await scenario('Po6: invalid optionIndex rejected via REST', async () => {
  const lTok = await getToken(accounts.L);
  const studTok = await getToken(accounts.A);
  const resp = await fetch(`${API}/polls/session/${SID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'x', options: ['a', 'b'], slideIndex: 0 }),
  });
  const poll = await resp.json();
  const r = await fetch(`${API}/polls/${poll.id}/respond`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionIndex: 99 }),
  });
  check('REST rejects optionIndex=99', r.status === 400, `got ${r.status}`);
});

// ── Whiteboard / laser / cursor ────────────────────────────────────────────

await scenario('W1: L toggles whiteboard, students see', async ({ A, B }) => {
  const L = globalThis._L; // unused
  const env = await spawn(['L', 'A', 'B']);
  env.clients.L.send({ type: 'WHITEBOARD_TOGGLE', enabled: true });
  await sleep(300);
  check('A got WHITEBOARD_TOGGLE', env.clients.A.has('WHITEBOARD_TOGGLE'));
  check('B got WHITEBOARD_TOGGLE', env.clients.B.has('WHITEBOARD_TOGGLE'));
  const w = env.clients.A.latest('WHITEBOARD_TOGGLE');
  check('enabled=true', w?.enabled === true);
  env.close();
});

await scenario('L1: laser move broadcasts to students', async ({ L, A, B }) => {
  L.send({ type: 'LASER_MOVE', x: 0.5, y: 0.5, slideIndex: 0 });
  await sleep(200);
  check('A got LASER_MOVE', A.has('LASER_MOVE'));
  check('B got LASER_MOVE', B.has('LASER_MOVE'));
});

await scenario('L2: laser end clears', async ({ L, A }) => {
  L.send({ type: 'LASER_MOVE', x: 0.3, y: 0.3, slideIndex: 0 });
  await sleep(100);
  L.send({ type: 'LASER_END' });
  await sleep(200);
  check('A got LASER_END', A.has('LASER_END'));
});

await scenario('Cursor: L cursor position broadcasts to students', async ({ L, A }) => {
  L.send({ type: 'CURSOR_POSITION', x: 0.5, y: 0.5, tool: 'pen', slideIndex: 0 });
  await sleep(200);
  check('A got CURSOR_POSITION', A.has('CURSOR_POSITION'));
});

// ── Session control ────────────────────────────────────────────────────────

await scenario('SC1: L ends session via WS, all get SESSION_ENDED', async ({ L, A, B, C }) => {
  L.send({ type: 'SESSION_END' });
  await sleep(400);
  check('A got SESSION_ENDED', A.has('SESSION_ENDED'));
  check('B got SESSION_ENDED', B.has('SESSION_ENDED'));
  check('C got SESSION_ENDED', C.has('SESSION_ENDED'));
  // After SESSION_END the harness ends. Re-start for any remaining scenarios.
});

await reset();

await scenario('SC2: L disconnects, students get LECTURER_DISCONNECTED', async ({ L, A, B }) => {
  L.close();
  await sleep(500);
  check('A got LECTURER_DISCONNECTED', A.has('LECTURER_DISCONNECTED'));
  check('B got LECTURER_DISCONNECTED', B.has('LECTURER_DISCONNECTED'));
});

await scenario('SC3: L reconnects, students get LECTURER_RECONNECTED', async ({ A, B }) => {
  // L client is already connected; simulate lecturer reconnect by opening
  // a second L WS, which supersedes the first. But spawn() already opens one.
  // Simpler: test that when a new L connects, A and B see RECONNECTED.
  const lTok = await getToken(accounts.L);
  const L2 = new Client('L2', lTok);
  await L2.opened;
  await sleep(400);
  check('A got LECTURER_RECONNECTED', A.has('LECTURER_RECONNECTED'));
  check('B got LECTURER_RECONNECTED', B.has('LECTURER_RECONNECTED'));
  L2.close();
});

// ── Participant count ──────────────────────────────────────────────────────

await scenario('PC1: joining student updates participant count', async ({ L, A }) => {
  // A is already joined — let's add a new student D
  const dTok = await getToken(accounts.C); // use C (sccd03)
  const D = new Client('D', dTok);
  await D.opened;
  await sleep(400);
  const pc = L.latest('PARTICIPANT_COUNT');
  check('L sees PARTICIPANT_COUNT', !!pc);
  check('active >= 2', pc?.active >= 2, `got ${pc?.active}`);
  D.close();
});

await scenario('PC2: student disconnect decrements count', async ({ L, A, B, C }) => {
  await sleep(300);
  const before = L.latest('PARTICIPANT_COUNT');
  const beforeActive = before?.active ?? 0;
  C.close();
  await sleep(500);
  const after = L.latest('PARTICIPANT_COUNT');
  check('active decremented', after?.active === beforeActive - 1, `before=${beforeActive} after=${after?.active}`);
});

// ── Duplicate tab handling ─────────────────────────────────────────────────

await scenario('DT1: Same student opens 2 WS → old is superseded', async ({ L, A, B, C }) => {
  const aTok = await getToken(accounts.A);
  const A2 = new Client('A2', aTok);
  await A2.opened;
  await sleep(400);
  check('A2 received state', A2.log.length > 0);
  // PARTICIPANT_COUNT should not double
  const pc = L.latest('PARTICIPANT_COUNT');
  check('count stays consistent', pc?.active >= 1 && pc?.active <= 4, `active=${pc?.active}`);
  A2.close();
});

// ── Annotation editing ─────────────────────────────────────────────────────

await scenario('A-E: L erases → broadcast + persist', async ({ L, A, B }) => {
  L.send({ type: 'ERASE_STROKE', points: [{ x: 0.5, y: 0.5 }], size: 0.01, slideIndex: 0 });
  await sleep(200);
  check('A got ERASE_STROKE', A.has('ERASE_STROKE'));
  check('B got ERASE_STROKE', B.has('ERASE_STROKE'));
});

await scenario('A-C: L clears annotations → broadcast', async ({ L, A, B }) => {
  L.send({ type: 'CLEAR_ANNOTATIONS', slideIndex: 0 });
  await sleep(200);
  check('A got CLEAR_ANNOTATIONS', A.has('CLEAR_ANNOTATIONS'));
  check('B got CLEAR_ANNOTATIONS', B.has('CLEAR_ANNOTATIONS'));
});

await scenario('A-LP: L laser pause broadcasts', async ({ L, A }) => {
  L.send({ type: 'LASER_PAUSE', x: 0.4, y: 0.4, slideIndex: 0 });
  await sleep(200);
  check('A got LASER_PAUSE', A.has('LASER_PAUSE'));
});

await scenario('A-TB: L syncs text box → students receive', async ({ L, A, B }) => {
  L.send({
    type: 'TEXT_BOX_SYNC', slideIndex: 0,
    textBoxes: [{ id: 'tb1', x: 0.1, y: 0.1, width: 0.2, height: 0.05, content: 'label', fontFamily: 'sans', fontSize: 14, color: '#000' }],
  });
  await sleep(200);
  check('A got TEXT_BOX_SYNC', A.has('TEXT_BOX_SYNC'));
  check('B got TEXT_BOX_SYNC', B.has('TEXT_BOX_SYNC'));
  const tb = A.latest('TEXT_BOX_SYNC');
  check('1 text box', tb?.textBoxes?.length === 1);
});

// ── Aggregation (multi-student) ─────────────────────────────────────────────

await scenario('F-Agg: A+B+C all confused → distribution.confused=3', async ({ L, A, B, C }) => {
  A.send({ type: 'FEEDBACK', emoji: 'confused', slideIndex: 0 });
  B.send({ type: 'FEEDBACK', emoji: 'confused', slideIndex: 0 });
  C.send({ type: 'FEEDBACK', emoji: 'confused', slideIndex: 0 });
  await sleep(400);
  const d = L.latest('FEEDBACK_UPDATE');
  check('confused=3', d?.distribution?.confused === 3, JSON.stringify(d?.distribution));
  check('total=3', d?.distribution?.total === 3);
});

await scenario('Pa-Agg: 2 slow + 1 fast → dist shows both', async ({ L, A, B, C }) => {
  A.send({ type: 'PACE_FEEDBACK', value: 'slow' });
  B.send({ type: 'PACE_FEEDBACK', value: 'slow' });
  C.send({ type: 'PACE_FEEDBACK', value: 'fast' });
  await sleep(400);
  const p = L.latest('PACE_UPDATE');
  check('slow=2 fast=1', p?.distribution?.slow === 2 && p?.distribution?.fast === 1, JSON.stringify(p?.distribution));
});

// ── REST round-trips ───────────────────────────────────────────────────────

await scenario('REST-notes: student saves then reloads', async () => {
  const tok = await getToken(accounts.A);
  await fetch(`${API}/notes/session/${SID}/slide/0`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'my lecture note' }),
  });
  const r = await fetch(`${API}/notes/session/${SID}`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  const notes = await r.json();
  const n = notes.find((x) => x.slideIndex === 0);
  check('saved note retrievable', n?.content === 'my lecture note', JSON.stringify(n));
});

await scenario('REST-reflection: student submits reflection', async () => {
  const tok = await getToken(accounts.A);
  const r = await fetch(`${API}/reflections/session/${SID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mostImportant: 'the big idea', stillUnclear: 'the edge cases' }),
  });
  check('reflection 200', r.status === 200, `got ${r.status}`);
});

await scenario('REST-answer: L marks Q answered via REST', async ({ L, A }) => {
  const lTok = await getToken(accounts.L);
  A.send({ type: 'QUESTION', content: 'rest answer test' });
  await sleep(300);
  const q = L.latest('NEW_QUESTION').question;
  const r = await fetch(`${API}/questions/${q.id}/answer`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${lTok}` },
  });
  check('answer 200', r.status === 200);
  await sleep(300);
  check('A got QUESTION_ANSWERED broadcast', A.has('QUESTION_ANSWERED'));
});

await scenario('REST-questions-list: L fetches all questions', async ({ L, A }) => {
  A.send({ type: 'QUESTION', content: 'visible to all' });
  await sleep(300);
  const lTok = await getToken(accounts.L);
  const r = await fetch(`${API}/questions/session/${SID}`, {
    headers: { Authorization: `Bearer ${lTok}` },
  });
  const qs = await r.json();
  check('questions returned', Array.isArray(qs) && qs.length >= 1);
  check('latest content correct', qs.some((q) => q.content === 'visible to all'));
});

// ── Reconnection semantics ─────────────────────────────────────────────────

await scenario('RC1: student reconnects → receives current slide', async ({ L }) => {
  L.send({ type: 'SLIDE_CHANGE', slideIndex: 2 });
  await sleep(300);
  const tok = await getToken(accounts.B);
  const B2 = new Client('B2', tok);
  await B2.opened;
  await sleep(300);
  const u = B2.latest('SLIDE_UPDATE');
  check('B2 received current slide on join', u?.slideIndex === 2, `got ${u?.slideIndex}`);
  B2.close();
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n──────── RESULT: ${pass} passed, ${fail} failed ────────`);
process.exit(fail > 0 ? 1 : 0);
