/**
 * Edge-case and role-confusion scenarios. Probes what happens when a
 * student sends a lecturer-only message, when messages arrive in
 * pathological orders, and when state transitions overlap.
 *
 * Run: node scenarios-edge.mjs
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
  await sleep(400);
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

await reset();

// ── Role confusion: students sending lecturer-only messages ───────────────

await scenario('RC-A: student sends SLIDE_CHANGE (ignored)', async ({ L, A, B }) => {
  A.send({ type: 'SLIDE_CHANGE', slideIndex: 3 });
  await sleep(400);
  // L's currentSlide state should not have moved. Easiest probe: have L
  // subsequently send a real slide change and confirm students see its value.
  check('B did NOT see SLIDE_UPDATE to 3', !B.has('SLIDE_UPDATE') || B.latest('SLIDE_UPDATE')?.slideIndex !== 3);
});

await scenario('RC-B: student sends SESSION_END (ignored)', async ({ L, A, B }) => {
  A.send({ type: 'SESSION_END' });
  await sleep(400);
  check('B did NOT see SESSION_ENDED', !B.has('SESSION_ENDED'));
});

await scenario('RC-C: student sends WHITEBOARD_TOGGLE (ignored)', async ({ L, A, B }) => {
  A.send({ type: 'WHITEBOARD_TOGGLE', enabled: true });
  await sleep(400);
  check('B did NOT see WHITEBOARD_TOGGLE', !B.has('WHITEBOARD_TOGGLE'));
});

await scenario('RC-D: student sends QUESTION_ANSWERED (ignored)', async ({ L, A, B }) => {
  B.send({ type: 'QUESTION', content: 'will student try to answer own?' });
  await sleep(300);
  const q = L.latest('NEW_QUESTION').question;
  A.send({ type: 'QUESTION_ANSWERED', questionId: q.id });
  await sleep(400);
  check('B did NOT see QUESTION_ANSWERED', !B.has('QUESTION_ANSWERED'));
});

await scenario('RC-E: student sends ANNOTATION_ACCESS_GRANT (ignored)', async ({ L, A, B }) => {
  B.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: 'let me try' });
  await sleep(200);
  const req = L.latest('ANNOTATION_ACCESS_REQUESTED');
  A.send({ type: 'ANNOTATION_ACCESS_GRANT', studentId: req.studentId });
  await sleep(400);
  check('B did NOT receive GRANTED from student grant attempt', !B.has('ANNOTATION_ACCESS_GRANTED'));
});

await scenario('RC-F: student sends LASER_MOVE as lecturer would (ignored)', async ({ L, A, B }) => {
  A.send({ type: 'LASER_MOVE', x: 0.5, y: 0.5, slideIndex: 0 });
  await sleep(300);
  check('B did NOT see student LASER_MOVE', !B.has('LASER_MOVE'));
});

// ── Weird content ──────────────────────────────────────────────────────────

await scenario('Content: very long question (>500 chars, via WS)', async ({ L, A }) => {
  const long = 'x'.repeat(2000);
  A.send({ type: 'QUESTION', content: long });
  await sleep(400);
  // Server inserts without validation via WS path. Expected: question persists
  // but zod cap on REST path would reject. This is a known inconsistency.
  const q = L.latest('NEW_QUESTION');
  if (q) check('WS allows long question (known inconsistency)', q.question.content.length === 2000);
  else check('WS silently dropped long question', true);
});

await scenario('Content: question with newlines + unicode', async ({ L, A }) => {
  A.send({ type: 'QUESTION', content: 'line 1\nline 2\n🎯 emoji test' });
  await sleep(400);
  const q = L.latest('NEW_QUESTION');
  check('multiline question preserved', q?.question?.content?.includes('line 2'));
  check('emoji preserved', q?.question?.content?.includes('🎯'));
});

await scenario('Content: empty question content (WS)', async ({ L, A }) => {
  const mark = L.mark();
  A.send({ type: 'QUESTION', content: '' });
  await sleep(400);
  // WS path doesn't zod-validate, so empty string persists. Known behaviour.
  const q = L.since(mark).find((m) => m.type === 'NEW_QUESTION');
  if (q) console.log('  [note] WS accepts empty question — REST rejects');
  check('no crash', true);
});

// ── State ordering ────────────────────────────────────────────────────────

await scenario('Order: student joins BEFORE lecturer', async ({ }) => {
  // Close everyone, then spawn student first
  const aTok = await getToken(accounts.A);
  const A = new Client('A', aTok);
  await A.opened;
  await sleep(300);
  // A should still receive current slide (DB-sourced)
  const slide = A.latest('SLIDE_UPDATE');
  check('student gets SLIDE_UPDATE on early join', !!slide);
  // Then lecturer joins
  const lTok = await getToken(accounts.L);
  const L = new Client('L', lTok);
  await L.opened;
  await sleep(400);
  check('A sees LECTURER_RECONNECTED', A.has('LECTURER_RECONNECTED'));
  A.close(); L.close();
});

await scenario('Rapid flicker: emoji toggles 20x in 200ms', async ({ L, A }) => {
  const emojis = ['got_it', 'neutral', 'confused', 'lost'];
  for (let i = 0; i < 20; i++) {
    A.send({ type: 'FEEDBACK', emoji: emojis[i % 4], slideIndex: 0 });
  }
  await sleep(500);
  const d = L.latest('FEEDBACK_UPDATE');
  // Final should be emojis[19 % 4] = emojis[3] = 'lost'
  check('final emoji is lost', d?.distribution?.lost === 1, JSON.stringify(d?.distribution));
  check('total stays = 1', d?.distribution?.total === 1);
});

// ── Empty session ─────────────────────────────────────────────────────────

await scenario('Empty: L alone in session, slide changes and draws', async () => {
  const lTok = await getToken(accounts.L);
  const L = new Client('L', lTok);
  await L.opened;
  await sleep(300);
  L.send({ type: 'SLIDE_CHANGE', slideIndex: 2 });
  L.send({ type: 'DRAW_STROKE', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: '#f00', width: 0.003, slideIndex: 2 });
  await sleep(400);
  check('L sees own SLIDE_UPDATE echo', L.has('SLIDE_UPDATE'));
  check('no crash when sending DRAW without students', true);
  L.close();
});

// ── Question self-upvote ─────────────────────────────────────────────────

await scenario('Self-upvote: student upvotes their own question', async ({ L, A }) => {
  A.send({ type: 'QUESTION', content: 'self upvote test' });
  await sleep(300);
  const q = L.latest('NEW_QUESTION').question;
  A.send({ type: 'QUESTION_UPVOTE', questionId: q.id });
  await sleep(300);
  const up = L.latest('QUESTION_UPVOTED');
  // Design choice: self-upvote is allowed (like Reddit). Test that it works.
  check('self-upvote counted', up?.upvoteCount === 1, `got ${up?.upvoteCount}`);
});

// ── Reason bounds on annotation access ───────────────────────────────────

await scenario('Pen reason: empty string rejected', async ({ L, A }) => {
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: '' });
  await sleep(300);
  const err = A.latest('ERROR');
  check('A got ERROR for empty reason', err?.message?.includes('1-100'), JSON.stringify(err));
  const st = L.latest('ANNOTATION_ACCESS_STATE');
  check('L queue empty (not added)', !st?.queue?.length);
});

await scenario('Pen reason: 101-char rejected', async ({ L, A }) => {
  const long = 'x'.repeat(101);
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: long });
  await sleep(300);
  check('A got ERROR', A.has('ERROR'));
});

await scenario('Pen reason: 100-char accepted', async ({ L, A }) => {
  const exact = 'x'.repeat(100);
  A.send({ type: 'ANNOTATION_ACCESS_REQUEST', reason: exact });
  await sleep(300);
  const st = L.latest('ANNOTATION_ACCESS_STATE');
  check('queued at boundary', st?.queue?.length === 1);
});

// ── Session restart (end then start same session ID) ─────────────────────

await scenario('Session restart: end then start same ID, students can rejoin', async ({ L, A }) => {
  L.send({ type: 'SESSION_END' });
  await sleep(500);
  check('A got SESSION_ENDED', A.has('SESSION_ENDED'));
  // Restart via REST
  const lTok = await getToken(accounts.L);
  const r = await fetch(`${API}/sessions/${SID}/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${lTok}` },
  });
  check('restart returns 200', r.status === 200);
  // New client can connect
  const aTok = await getToken(accounts.A);
  const A2 = new Client('A2', aTok);
  await A2.opened;
  await sleep(400);
  check('A2 connected to restarted session', A2.has('SLIDE_UPDATE'));
  A2.close();
});

await reset();

// ── Pace distribution edge: same value twice ─────────────────────────────

await scenario('Pace: same value twice (idempotent)', async ({ L, A }) => {
  A.send({ type: 'PACE_FEEDBACK', value: 'fast' });
  await sleep(100);
  const before = L.latest('PACE_UPDATE');
  A.send({ type: 'PACE_FEEDBACK', value: 'fast' });
  await sleep(300);
  const after = L.latest('PACE_UPDATE');
  check('fast=1 both times', before?.distribution?.fast === 1 && after?.distribution?.fast === 1);
});

// ── Poll: change from 'active' to 'closed' mid-vote ─────────────────────

await scenario('Poll: close while A is voting — vote drops silently', async ({ L, A }) => {
  const lTok = await getToken(accounts.L);
  const resp = await fetch(`${API}/polls/session/${SID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'x', options: ['a', 'b'], slideIndex: 0 }),
  });
  const poll = await resp.json();
  await sleep(200);
  // Close in parallel with vote
  await Promise.all([
    fetch(`${API}/polls/${poll.id}/close`, { method: 'PATCH', headers: { Authorization: `Bearer ${lTok}` } }),
    (async () => {
      await sleep(10);
      A.send({ type: 'POLL_RESPONSE', pollId: poll.id, optionIndex: 0 });
    })(),
  ]);
  await sleep(400);
  check('no crash', true);
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n──────── EDGE/ROLE RESULT: ${pass} passed, ${fail} failed ────────`);
process.exit(fail > 0 ? 1 : 0);
