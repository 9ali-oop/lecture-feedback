/**
 * Resilience harness — simulates disconnect/reconnect during a live session
 * and verifies that state is preserved and nothing is lost at session end.
 */
import WebSocket from 'ws';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const API = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000/ws';
const CODE = '123456';
type Emoji = 'got_it' | 'neutral' | 'confused' | 'lost';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(email: string) {
  const res = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: CODE }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  const data = (await res.json()) as { token: string; user: { id: string; name: string } };
  return { token: data.token, userId: data.user.id, name: data.user.name };
}

function openWs(sessionId: string, token: string, msgs: any[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}&sessionId=${sessionId}`);
    const t = setTimeout(() => reject(new Error('ws timeout')), 5000);
    ws.on('open', () => { clearTimeout(t); resolve(ws); });
    ws.on('message', (b) => { try { msgs.push(JSON.parse(b.toString())); } catch { /* ignore */ } });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}
const send = (ws: WebSocket, msg: unknown) => ws.send(JSON.stringify(msg));

const FAILURES: string[] = [];
const assert = (label: string, cond: boolean, detail?: string) => {
  if (!cond) FAILURES.push(`FAIL  ${label}${detail ? '  (' + detail + ')' : ''}`);
  else console.log(`  ok  ${label}`);
};

async function run() {
  const lecturer = await login('lecturer@leeds.ac.uk');
  const students = await Promise.all([
    login('sc23ar@leeds.ac.uk'),
    login('sc23bw@leeds.ac.uk'),
  ]);

  const modsRes = await fetch(`${API}/modules`, { headers: { Authorization: `Bearer ${lecturer.token}` } });
  const mods = (await modsRes.json()) as any[];
  const mod = mods.find((m) => m.code === 'COMP101');

  // Build tiny PDF
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 3; i++) {
    const p = pdfDoc.addPage([600, 450]);
    p.drawText(`Resilience slide ${i + 1}`, { x: 40, y: 380, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
  }
  const bytes = await pdfDoc.save();

  // Create/upload/start
  const create = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lecturer.token}` },
    body: JSON.stringify({ moduleId: mod.id, title: 'Resilience test' }),
  });
  const { id: sessionId } = (await create.json()) as { id: string };
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 't.pdf');
  await fetch(`${API}/sessions/${sessionId}/pdf`, { method: 'POST', headers: { Authorization: `Bearer ${lecturer.token}` }, body: fd });
  await fetch(`${API}/sessions/${sessionId}/slides`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lecturer.token}` },
    body: JSON.stringify({ totalSlides: 3 }),
  });
  await fetch(`${API}/sessions/${sessionId}/start`, { method: 'POST', headers: { Authorization: `Bearer ${lecturer.token}` } });
  console.log(`Session started: ${sessionId}`);

  // Open WS connections
  const lectMsgs: any[] = [];
  const s1Msgs: any[] = [];
  const s2Msgs: any[] = [];
  const lectWs = await openWs(sessionId, lecturer.token, lectMsgs);
  const s1Ws = await openWs(sessionId, students[0].token, s1Msgs);
  const s2Ws = await openWs(sessionId, students[1].token, s2Msgs);
  await sleep(500);

  // ── Scenario 1: slide 0 feedback, then student 1 refreshes (disconnect + reconnect)
  send(s1Ws, { type: 'FEEDBACK', emoji: 'got_it' as Emoji, slideIndex: 0 });
  send(s2Ws, { type: 'FEEDBACK', emoji: 'neutral' as Emoji, slideIndex: 0 });
  await sleep(400);

  // Capture pre-refresh distribution from lecturer's perspective
  const preRefreshDist = [...lectMsgs].reverse().find((m) => m.type === 'FEEDBACK_UPDATE')?.distribution;
  assert('pre-refresh distribution seen by lecturer', !!preRefreshDist && preRefreshDist.total === 2,
    `saw ${JSON.stringify(preRefreshDist)}`);

  // Clear recorded lecturer messages so we only inspect what happens
  // between the refresh and any re-vote.
  const lectMsgCountBeforeRefresh = lectMsgs.length;

  // Simulate student 1 refresh
  s1Ws.close();
  await sleep(500);
  const s1MsgsAfter: any[] = [];
  const s1WsNew = await openWs(sessionId, students[0].token, s1MsgsAfter);
  await sleep(800);

  // Verify: lecturer did NOT lose student 1 from the count (old WS was superseded)
  const postRefreshCount = [...lectMsgs].reverse().find((m) => m.type === 'PARTICIPANT_COUNT');
  assert('lecturer still sees 2 participants after student refresh',
    postRefreshCount?.active === 2, `got ${JSON.stringify(postRefreshCount)}`);

  // Student gets current slide state on reconnect
  const slideUpdate = s1MsgsAfter.find((m) => m.type === 'SLIDE_UPDATE');
  assert('refreshed student receives current slide on reconnect',
    slideUpdate?.slideIndex === 0 && slideUpdate?.totalSlides === 3,
    `got ${JSON.stringify(slideUpdate)}`);

  // THE NEW BEHAVIOUR: without the student re-voting, the lecturer's live
  // distribution must still include s1's got_it because the server restored
  // it from the DB on reconnect. Previously this assertion would fail —
  // lecturer would see got_it=0/neutral=1 briefly until the student re-tapped.
  const postRefreshDist = lectMsgs
    .slice(lectMsgCountBeforeRefresh)
    .reverse()
    .find((m) => m.type === 'FEEDBACK_UPDATE');
  assert('lecturer distribution preserves student vote after refresh (no re-vote)',
    postRefreshDist?.distribution.got_it === 1 && postRefreshDist?.distribution.neutral === 1 && postRefreshDist?.distribution.total === 2,
    `got ${JSON.stringify(postRefreshDist?.distribution)}`);

  // After reconnect, student votes again, lecturer sees updated dist
  send(s1WsNew, { type: 'FEEDBACK', emoji: 'confused' as Emoji, slideIndex: 0 });
  await sleep(400);
  const afterVote = [...lectMsgs].reverse().find((m) => m.type === 'FEEDBACK_UPDATE');
  assert('post-reconnect vote reaches lecturer',
    afterVote?.distribution.confused === 1, `got ${JSON.stringify(afterVote?.distribution)}`);

  // ── Scenario 2: lecturer refresh — state must not explode
  lectWs.close();
  await sleep(500);
  const lectMsgsAfter: any[] = [];
  const lectWsNew = await openWs(sessionId, lecturer.token, lectMsgsAfter);
  await sleep(800);

  // Reconnected lecturer should receive current state: slide + participant count + distribution
  const relSlide = lectMsgsAfter.find((m) => m.type === 'SLIDE_UPDATE');
  const relCount = lectMsgsAfter.find((m) => m.type === 'PARTICIPANT_COUNT');
  const relDist = lectMsgsAfter.find((m) => m.type === 'FEEDBACK_UPDATE');
  assert('reconnected lecturer gets SLIDE_UPDATE', !!relSlide && relSlide.slideIndex === 0);
  assert('reconnected lecturer gets PARTICIPANT_COUNT=2', relCount?.active === 2,
    `got ${JSON.stringify(relCount)}`);
  assert('reconnected lecturer gets current distribution',
    !!relDist && relDist.distribution.total >= 2, `got ${JSON.stringify(relDist)}`);

  // ── Scenario 3: notes posted before session end persist past it
  await fetch(`${API}/notes/session/${sessionId}/slide/0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${students[0].token}` },
    body: JSON.stringify({ content: 'notes taken before session ended' }),
  });

  // Advance a slide so feedback gets flushed, then end the session
  send(lectWsNew, { type: 'SLIDE_CHANGE', slideIndex: 1 });
  await sleep(500);
  send(s1WsNew, { type: 'FEEDBACK', emoji: 'got_it' as Emoji, slideIndex: 1 });
  send(s2Ws, { type: 'FEEDBACK', emoji: 'got_it' as Emoji, slideIndex: 1 });
  await sleep(500);

  await fetch(`${API}/sessions/${sessionId}/end`, { method: 'POST', headers: { Authorization: `Bearer ${lecturer.token}` } });
  await sleep(800);

  // Report should include all the feedback + the note
  const reportRes = await fetch(`${API}/sessions/${sessionId}/report`, { headers: { Authorization: `Bearer ${lecturer.token}` } });
  const report = await reportRes.json() as any;
  assert('report.peakParticipants == 2', report.peakParticipants === 2,
    `got ${report.peakParticipants}`);
  // Student 1 votes twice on slide 0 (got_it before refresh, confused after).
  // Disconnect flushes got_it and the slide change flushes confused, so the
  // slide ends up with 3 events from 2 students. Report's distribution counts
  // events, not unique students — by design (duration_ms analytics depend on
  // multiple rows per student). We just verify nothing was lost.
  assert('post-refresh feedback persisted on slide 0 (>= pre-refresh)',
    report.slides[0].distribution.total >= 2,
    `got slide 0 dist ${JSON.stringify(report.slides[0].distribution)}`);
  assert('student 1 pre-refresh got_it not lost',
    report.slides[0].distribution.got_it >= 1,
    `got ${JSON.stringify(report.slides[0].distribution)}`);
  assert('student 1 post-refresh confused not lost',
    report.slides[0].distribution.confused >= 1,
    `got ${JSON.stringify(report.slides[0].distribution)}`);
  assert('slide 1 feedback persisted after session end',
    report.slides[1].distribution.total === 2,
    `got slide 1 dist ${JSON.stringify(report.slides[1].distribution)}`);

  const notesRes = await fetch(`${API}/notes/session/${sessionId}`, { headers: { Authorization: `Bearer ${students[0].token}` } });
  const notes = await notesRes.json() as any[];
  assert('student 1 note preserved after session end',
    notes.some((n) => n.slideIndex === 0 && n.content.includes('before session ended')),
    `got ${JSON.stringify(notes)}`);

  // Verify session is marked ended in DB
  const sessRes = await fetch(`${API}/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${lecturer.token}` } });
  const sess = await sessRes.json() as any;
  assert('session status == ended', sess.status === 'ended', `got ${sess.status}`);

  // Cleanup sockets
  [lectWsNew, s1WsNew, s2Ws].forEach((w) => { try { w.close(); } catch { /* already closed */ } });

  console.log('\n── SUMMARY ──');
  if (FAILURES.length === 0) {
    console.log('All resilience checks passed.');
    console.log('Session ID:', sessionId);
    process.exit(0);
  }
  for (const f of FAILURES) console.log(f);
  process.exit(2);
}

run().catch((err) => { console.error('FAILED:', err); process.exit(1); });
