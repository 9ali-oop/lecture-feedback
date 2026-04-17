/**
 * End-to-end session simulation + verification harness.
 *
 * Drives a full session over HTTP + WebSocket and prints a diff between
 * the scripted "truth" (what we sent) and what the lecturer's report
 * actually reports back. Intended for deletion after the report pass.
 *
 * Run from repo root:
 *   DATABASE_URL=... pnpm exec tsx scripts/simulate-session.ts
 */
import WebSocket from 'ws';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const API = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000/ws';
const CODE = '123456';

type Emoji = 'got_it' | 'neutral' | 'confused' | 'lost';
type Pace = 'slow' | 'ok' | 'fast';

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function api(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${body}`);
  }
  return res;
}

async function login(email: string) {
  const res = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: CODE }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string; user: { id: string; name: string; role: string } };
  return { token: data.token, userId: data.user.id, name: data.user.name, email };
}

function openWs(sessionId: string, token: string, label: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}&sessionId=${sessionId}`);
    const timer = setTimeout(() => reject(new Error(`ws open timeout: ${label}`)), 5000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

const wsSend = (ws: WebSocket, msg: unknown) => ws.send(JSON.stringify(msg));

async function run() {
  // ── 1. Authenticate everyone ──────────────────────────────────────────────
  const lecturer = await login('lecturer@leeds.ac.uk');
  const emails = [
    'sc23ar@leeds.ac.uk', // Aisha      fluent
    'sc23bw@leeds.ac.uk', // Ben        native
    'sc23cd@leeds.ac.uk', // Chloe      native
    'sc23fa@leeds.ac.uk', // Faisal     intermediate
    'sc23gk@leeds.ac.uk', // Grace      fluent
    'sc23ti@leeds.ac.uk', // Tanya      beginner
  ];
  const students = await Promise.all(emails.map(login));
  console.log(`Authed: lecturer + ${students.length} students`);

  // ── 2. Find COMP101 module ───────────────────────────────────────────────
  const modsRes = await api('/modules', lecturer.token);
  const modules = (await modsRes.json()) as Array<{ id: string; code: string; lecturerId: string }>;
  const mod = modules.find((m) => m.code === 'COMP101' && m.lecturerId === lecturer.userId);
  if (!mod) throw new Error('COMP101 not found for lecturer');
  console.log(`Module: COMP101 (${mod.id})`);

  // ── 3. Build a 5-slide PDF ────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const titles = [
    'Lecture 5 — Algorithms I',
    'Sorting algorithms',
    'Big-O analysis and proofs',
    'Worked example: merge sort',
    'Summary and next week',
  ];
  titles.forEach((title, i) => {
    const page = pdfDoc.addPage([600, 450]);
    page.drawText(title, { x: 40, y: 380, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(`Slide ${i + 1} of ${titles.length}`, { x: 40, y: 40, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
  });
  const pdfBytes = await pdfDoc.save();
  console.log(`PDF built: ${titles.length} slides, ${pdfBytes.length} bytes`);

  // ── 4. Create session ────────────────────────────────────────────────────
  const createRes = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lecturer.token}` },
    body: JSON.stringify({ moduleId: mod.id, title: 'Lecture 5 — Algorithms I (SIM)' }),
  });
  const { id: sessionId } = (await createRes.json()) as { id: string };
  console.log(`Session: ${sessionId}`);

  // ── 5. Upload PDF ────────────────────────────────────────────────────────
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }), 'lecture.pdf');
  await api(`/sessions/${sessionId}/pdf`, lecturer.token, { method: 'POST', body: fd });

  // ── 6. Set slide count ───────────────────────────────────────────────────
  await api(`/sessions/${sessionId}/slides`, lecturer.token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalSlides: titles.length }),
  });

  // ── 7. Start session ─────────────────────────────────────────────────────
  await api(`/sessions/${sessionId}/start`, lecturer.token, { method: 'POST' });
  console.log('Session started');

  // ── 8. Open WebSockets ───────────────────────────────────────────────────
  const lectWs = await openWs(sessionId, lecturer.token, 'lecturer');
  const stWs: WebSocket[] = [];
  // Stagger student connects so the PARTICIPANT_COUNT climbs visibly
  for (let i = 0; i < students.length; i++) {
    stWs.push(await openWs(sessionId, students[i].token, `student ${i}`));
    await sleep(200);
  }
  console.log(`WS connected: 1 lecturer + ${stWs.length} students`);
  // Let the lecturer's initial state propagate
  await sleep(500);

  // ── 9. Scripted timeline ─────────────────────────────────────────────────
  // Truth we'll compare the report against.
  const EXPECTED: {
    feedbackPerSlide: Array<Record<Emoji, number>>;
    questionsPerSlide: Record<number, string[]>;
    confusionContextsPerSlide: Record<number, number>;
    notesPerSlide: Record<number, number>;
    paceByStudent: Record<string, Pace>; // name -> pace
    reflectionsCount: number;
  } = {
    feedbackPerSlide: [
      { got_it: 6, neutral: 0, confused: 0, lost: 0 }, // 0 — consensus
      { got_it: 4, neutral: 2, confused: 0, lost: 0 }, // 1 — mostly got it
      { got_it: 1, neutral: 0, confused: 3, lost: 2 }, // 2 — the HARD slide
      { got_it: 4, neutral: 1, confused: 1, lost: 0 }, // 3 — recovery
      { got_it: 5, neutral: 1, confused: 0, lost: 0 }, // 4 — consensus again
    ],
    questionsPerSlide: {
      2: ['What does O(n log n) actually mean?', 'Can someone re-explain the master theorem?'],
      3: ['In merge sort, why do we divide by 2 each time?'],
    },
    confusionContextsPerSlide: { 2: 2 }, // 2 students drop a highlight+explanation on slide 2
    notesPerSlide: { 1: 3, 4: 3 },
    paceByStudent: {
      [students[0].name]: 'slow', // Aisha
      [students[1].name]: 'ok',   // Ben
      [students[2].name]: 'ok',   // Chloe
      [students[3].name]: 'slow', // Faisal
      [students[4].name]: 'ok',   // Grace
      [students[5].name]: 'slow', // Tanya
    },
    reflectionsCount: 3,
  };

  console.log('── timeline begin ──');

  // Slide 0 (already active): everyone got_it — 20s
  console.log('slide 0 — consensus');
  for (let i = 0; i < 6; i++) wsSend(stWs[i], { type: 'FEEDBACK', emoji: 'got_it', slideIndex: 0 });
  await sleep(20000);

  // Slide 1: mostly got it, 2 neutral — 40s
  wsSend(lectWs, { type: 'SLIDE_CHANGE', slideIndex: 1 });
  await sleep(500);
  console.log('slide 1 — mostly got it');
  const s1: Emoji[] = ['got_it', 'got_it', 'got_it', 'neutral', 'got_it', 'neutral'];
  s1.forEach((e, i) => wsSend(stWs[i], { type: 'FEEDBACK', emoji: e, slideIndex: 1 }));
  await Promise.all([
    api(`/notes/session/${sessionId}/slide/1`, students[0].token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Key: sorting stability' }) }),
    api(`/notes/session/${sessionId}/slide/1`, students[1].token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'insertion vs merge sort differ by invariant' }) }),
    api(`/notes/session/${sessionId}/slide/1`, students[3].token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'need to revisit bubble sort proof later' }) }),
  ]);
  await sleep(40000);

  // Slide 2: the hard one — 60s, confusion develops across multiple buckets
  wsSend(lectWs, { type: 'SLIDE_CHANGE', slideIndex: 2 });
  await sleep(500);
  console.log('slide 2 — confusion (60s, spread out)');
  // First wave at t≈0: Ben gets it, Aisha + Chloe early confusion
  wsSend(stWs[1], { type: 'FEEDBACK', emoji: 'got_it', slideIndex: 2 });
  wsSend(stWs[0], { type: 'FEEDBACK', emoji: 'confused', slideIndex: 2 });
  wsSend(stWs[2], { type: 'FEEDBACK', emoji: 'lost', slideIndex: 2 });
  // Early question
  wsSend(stWs[0], { type: 'QUESTION', content: EXPECTED.questionsPerSlide[2][0] });
  await sleep(20000);
  // Mid-slide: Faisal + Grace confused, Tanya lost
  wsSend(stWs[3], { type: 'FEEDBACK', emoji: 'confused', slideIndex: 2 });
  wsSend(stWs[4], { type: 'FEEDBACK', emoji: 'confused', slideIndex: 2 });
  wsSend(stWs[5], { type: 'FEEDBACK', emoji: 'lost', slideIndex: 2 });
  // 2 confusion contexts with highlights + explanations (Faisal & Tanya)
  await api(`/confusion/session/${sessionId}`, students[3].token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slideIndex: 2, emoji: 'confused',
      highlights: [{ shape: 'rect', x: 0.25, y: 0.35, width: 0.40, height: 0.18 }],
      explanation: 'The big-O definition around this formula is unclear',
    }),
  });
  await api(`/confusion/session/${sessionId}`, students[5].token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slideIndex: 2, emoji: 'lost',
      highlights: [
        { shape: 'rect', x: 0.30, y: 0.30, width: 0.35, height: 0.20 },
        { shape: 'circle', x: 0.60, y: 0.55, width: 0.08, height: 0.08 },
      ],
      explanation: 'Whole master theorem section lost me completely',
    }),
  });
  // Pace feedback
  Object.entries(EXPECTED.paceByStudent).forEach(([name, pace]) => {
    const idx = students.findIndex((s) => s.name === name);
    if (idx >= 0) wsSend(stWs[idx], { type: 'PACE_FEEDBACK', value: pace });
  });
  await sleep(20000);
  // Late question
  wsSend(stWs[5], { type: 'QUESTION', content: EXPECTED.questionsPerSlide[2][1] });
  await sleep(20000);

  // Slide 3: recovery — 40s
  wsSend(lectWs, { type: 'SLIDE_CHANGE', slideIndex: 3 });
  await sleep(500);
  console.log('slide 3 — recovery');
  const s3: Emoji[] = ['got_it', 'got_it', 'got_it', 'neutral', 'got_it', 'confused'];
  s3.forEach((e, i) => wsSend(stWs[i], { type: 'FEEDBACK', emoji: e, slideIndex: 3 }));
  await sleep(15000);
  wsSend(stWs[3], { type: 'QUESTION', content: EXPECTED.questionsPerSlide[3][0] });
  await sleep(25000);

  // Slide 4: consensus again — 30s
  wsSend(lectWs, { type: 'SLIDE_CHANGE', slideIndex: 4 });
  await sleep(500);
  console.log('slide 4 — consensus');
  const s4: Emoji[] = ['got_it', 'got_it', 'got_it', 'got_it', 'neutral', 'got_it'];
  s4.forEach((e, i) => wsSend(stWs[i], { type: 'FEEDBACK', emoji: e, slideIndex: 4 }));
  await Promise.all([
    api(`/notes/session/${sessionId}/slide/4`, students[0].token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'summary clear; revise master theorem' }) }),
    api(`/notes/session/${sessionId}/slide/4`, students[2].token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'next week: dynamic programming' }) }),
    api(`/notes/session/${sessionId}/slide/4`, students[4].token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'action: revisit recurrence relations' }) }),
  ]);
  await sleep(30000);

  // ── 10. End session ──────────────────────────────────────────────────────
  console.log('ending session');
  await api(`/sessions/${sessionId}/end`, lecturer.token, { method: 'POST' });
  await sleep(800);
  for (const ws of [lectWs, ...stWs]) ws.close();
  await sleep(400);

  // ── 11. Reflections (post-session) ───────────────────────────────────────
  console.log('submitting reflections (3 students)');
  await Promise.all([
    api(`/reflections/session/${sessionId}`, students[0].token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mostImportant: 'sorting algorithms and their stability', stillUnclear: 'proofs using the master theorem' }),
    }),
    api(`/reflections/session/${sessionId}`, students[1].token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mostImportant: 'merge sort walk-through', stillUnclear: '' }),
    }),
    api(`/reflections/session/${sessionId}`, students[3].token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mostImportant: 'sorting algorithms overview', stillUnclear: 'master theorem proofs and asymptotic bounds' }),
    }),
  ]);

  // ── 12. Fetch report + verify ────────────────────────────────────────────
  const reportRes = await api(`/sessions/${sessionId}/report`, lecturer.token);
  const report = await reportRes.json() as any;
  const timelineRes = await api(`/sessions/${sessionId}/timeline`, lecturer.token);
  const timeline = await timelineRes.json() as any[];
  const reflectionsRes = await api(`/reflections/session/${sessionId}`, lecturer.token);
  const reflections = await reflectionsRes.json() as any;

  // ── Diff ──
  const issues: string[] = [];
  const expect = (label: string, a: any, b: any) => {
    const aJ = JSON.stringify(a), bJ = JSON.stringify(b);
    if (aJ !== bJ) issues.push(`MISMATCH  ${label}  expected=${aJ}  actual=${bJ}`);
    else console.log(`  ok  ${label}  ${aJ}`);
  };

  console.log('\n── VERIFICATION ──');
  console.log(`Session ID: ${sessionId}`);
  expect('peakParticipants', 6, report.peakParticipants);
  expect('overall.total', 30, report.overallDistribution.total);
  expect('overall.got_it', 20, report.overallDistribution.got_it);
  expect('overall.neutral', 4, report.overallDistribution.neutral);
  expect('overall.confused', 4, report.overallDistribution.confused);
  expect('overall.lost', 2, report.overallDistribution.lost);

  for (let i = 0; i < 5; i++) {
    const s = report.slides.find((x: any) => x.slideIndex === i);
    const exp = EXPECTED.feedbackPerSlide[i];
    expect(`slide ${i} got_it`, exp.got_it, s?.distribution.got_it);
    expect(`slide ${i} neutral`, exp.neutral, s?.distribution.neutral);
    expect(`slide ${i} confused`, exp.confused, s?.distribution.confused);
    expect(`slide ${i} lost`, exp.lost, s?.distribution.lost);
    const expQ = (EXPECTED.questionsPerSlide[i] ?? []).length;
    expect(`slide ${i} questions`, expQ, s?.questions.length ?? 0);
    const expCC = EXPECTED.confusionContextsPerSlide[i] ?? 0;
    expect(`slide ${i} confusionContexts`, expCC, s?.confusionContexts.length ?? 0);
    if (s?.timeSeconds !== null && s?.timeSeconds !== undefined) {
      console.log(`  info slide ${i} timeSeconds = ${s.timeSeconds}`);
    }
  }

  expect('reflections.totalResponses', EXPECTED.reflectionsCount, reflections.totalResponses);
  console.log(`  info timeline buckets: ${timeline.length}`);
  console.log(`  info engagement.overallScore: ${JSON.stringify(report.engagement?.overallScore)}`);
  console.log(`  info proficiencyBreakdown: ${JSON.stringify(report.engagement?.proficiencyBreakdown)}`);
  console.log(`  info signalComparison: ${JSON.stringify(report.engagement?.signalComparison)}`);
  console.log(`  info reflections.topLearnings: ${JSON.stringify(reflections.topLearnings)}`);
  console.log(`  info reflections.topUnclear: ${JSON.stringify(reflections.topUnclear)}`);

  if (issues.length > 0) {
    console.log('\n── ISSUES ──');
    for (const s of issues) console.log(s);
    console.log(`\n${issues.length} issue(s)`);
    process.exit(2);
  }

  console.log('\nAll verified. Session ID:', sessionId);
  process.exit(0);
}

run().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
