/**
 * Large-class session simulator — drives all 25 seeded students through
 * persona-based trajectories so the Learning dynamics panel's at-risk
 * truncation (+N more) and wider matrix estimation can be visually checked.
 *
 * Personas (5 each):
 *   A Stable      : got_it every slide                   → risk 0
 *   B Quick dip   : got_it, got_it, confused, got_it x2  → recovered, low risk
 *   C Slow wobble : got_it, neutral, confused, neutral, got_it → recovered, mid
 *   D Ends meh    : got_it, got_it, confused, neutral, neutral → AT RISK
 *   E Ends badly  : got_it, confused, lost, confused, lost     → AT RISK
 *
 * Expected at-risk: ~10 students (D + E buckets) — enough to trigger the
 * top-5 truncation in the panel.
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
  return { token: data.token, userId: data.user.id, name: data.user.name, email };
}

function openWs(sessionId: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}&sessionId=${sessionId}`);
    const t = setTimeout(() => reject(new Error('ws timeout')), 5000);
    ws.on('open', () => { clearTimeout(t); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}
const wsSend = (ws: WebSocket, m: unknown) => ws.send(JSON.stringify(m));

// 25 seeded students in the order they appear in sample-data.ts
const EMAILS = [
  'sc23ar@leeds.ac.uk', 'sc23bw@leeds.ac.uk', 'sc23cd@leeds.ac.uk', 'sc23do@leeds.ac.uk', 'sc23ej@leeds.ac.uk',
  'sc23fa@leeds.ac.uk', 'sc23gk@leeds.ac.uk', 'sc23hs@leeds.ac.uk', 'sc23it@leeds.ac.uk', 'sc23jn@leeds.ac.uk',
  'sc23kp@leeds.ac.uk', 'sc23lm@leeds.ac.uk', 'sc23mb@leeds.ac.uk', 'sc23nk@leeds.ac.uk', 'sc23oh@leeds.ac.uk',
  'sc23ps@leeds.ac.uk', 'sc23qa@leeds.ac.uk', 'sc23rf@leeds.ac.uk', 'sc23sf@leeds.ac.uk', 'sc23ti@leeds.ac.uk',
  'sc23uc@leeds.ac.uk', 'sc23vc@leeds.ac.uk', 'sc23wp@leeds.ac.uk', 'sc23xz@leeds.ac.uk', 'sc23ye@leeds.ac.uk',
];

const PERSONAS: Emoji[][] = [
  // A Stable
  ['got_it', 'got_it', 'got_it', 'got_it', 'got_it'],
  // B Quick dip
  ['got_it', 'got_it', 'confused', 'got_it', 'got_it'],
  // C Slow wobble
  ['got_it', 'neutral', 'confused', 'neutral', 'got_it'],
  // D Ends meh (at-risk)
  ['got_it', 'got_it', 'confused', 'neutral', 'neutral'],
  // E Ends badly (at-risk)
  ['got_it', 'confused', 'lost', 'confused', 'lost'],
];

function personaForIndex(i: number): Emoji[] {
  // Deterministic mapping: 5 students per persona, cycling through
  return PERSONAS[i % PERSONAS.length];
}

async function run() {
  const lecturer = await login('lecturer@leeds.ac.uk');
  console.log(`Logged in lecturer`);

  const students = [];
  for (const email of EMAILS) {
    students.push(await login(email));
  }
  console.log(`Logged in ${students.length} students`);

  const modsRes = await fetch(`${API}/modules`, { headers: { Authorization: `Bearer ${lecturer.token}` } });
  const mods = (await modsRes.json()) as any[];
  const mod = mods.find((m: any) => m.code === 'COMP101');
  if (!mod) throw new Error('COMP101 not found');

  // Build PDF
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  ['Intro', 'Core concept', 'The hard slide', 'Worked example', 'Summary'].forEach((t, i) => {
    const p = pdfDoc.addPage([600, 450]);
    p.drawText(t, { x: 40, y: 380, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
    p.drawText(`Slide ${i + 1} of 5`, { x: 40, y: 40, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
  });
  const pdfBytes = await pdfDoc.save();

  // Create session
  const createRes = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lecturer.token}` },
    body: JSON.stringify({ moduleId: mod.id, title: 'Lecture 12 — Large-class sim' }),
  });
  const { id: sessionId } = (await createRes.json()) as { id: string };

  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }), 'lecture.pdf');
  await fetch(`${API}/sessions/${sessionId}/pdf`, { method: 'POST', headers: { Authorization: `Bearer ${lecturer.token}` }, body: fd });
  await fetch(`${API}/sessions/${sessionId}/slides`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lecturer.token}` },
    body: JSON.stringify({ totalSlides: 5 }),
  });
  await fetch(`${API}/sessions/${sessionId}/start`, { method: 'POST', headers: { Authorization: `Bearer ${lecturer.token}` } });
  console.log(`Session started: ${sessionId}`);

  // Open WS connections (lecturer + 25 students)
  const lectWs = await openWs(sessionId, lecturer.token);
  const stWs: WebSocket[] = [];
  for (let i = 0; i < students.length; i++) {
    stWs.push(await openWs(sessionId, students[i].token));
    if (i % 5 === 4) await sleep(100); // small backoff every 5 to avoid slamming
  }
  await sleep(1000);
  console.log(`All WS connected: 1 lecturer + ${stWs.length} students`);

  // Drive slides — ~15s per slide, 5 slides = 75s total (3 buckets for the timeline)
  for (let slide = 0; slide < 5; slide++) {
    if (slide > 0) {
      wsSend(lectWs, { type: 'SLIDE_CHANGE', slideIndex: slide });
      await sleep(400);
    }
    console.log(`slide ${slide}`);
    for (let i = 0; i < students.length; i++) {
      const persona = personaForIndex(i);
      const emoji = persona[slide];
      wsSend(stWs[i], { type: 'FEEDBACK', emoji, slideIndex: slide });
    }
    await sleep(15_000);
  }

  await fetch(`${API}/sessions/${sessionId}/end`, { method: 'POST', headers: { Authorization: `Bearer ${lecturer.token}` } });
  await sleep(800);
  for (const ws of [lectWs, ...stWs]) ws.close();
  await sleep(400);

  // Fetch report and summarise
  const reportRes = await fetch(`${API}/sessions/${sessionId}/report`, { headers: { Authorization: `Bearer ${lecturer.token}` } });
  const report = (await reportRes.json()) as any;
  const ld = report.learningDynamics;
  console.log(`\n── LARGE-CLASS REPORT ──`);
  console.log(`Session ID:        ${sessionId}`);
  console.log(`Active students:   ${ld.activeStudents}`);
  console.log(`Sample size:       ${ld.sampleSize} transitions`);
  console.log(`Expected recovery: neutral=${ld.expectedRecovery.neutral?.toFixed(2)}, confused=${ld.expectedRecovery.confused?.toFixed(2)}, lost=${ld.expectedRecovery.lost?.toFixed(2)}`);
  console.log(`At-risk students:  ${ld.atRisk.length}`);
  console.log(`Top 5 at-risk:`);
  ld.atRisk.slice(0, 5).forEach((s: any, i: number) => {
    console.log(`  ${i + 1}. ${s.studentName.padEnd(22)} seq=${s.sequence.join(',').padEnd(40)} risk=${s.riskScore.toFixed(2)}`);
  });
  if (ld.atRisk.length > 5) {
    console.log(`  ... ${ld.atRisk.length - 5} more`);
  }
  console.log(`\nSession ID: ${sessionId}`);
}

run().catch((err) => { console.error('FAILED:', err); process.exit(1); });
