/**
 * Scale + edge-case smoke test.
 *
 * Simulates tomorrow's real flow:
 *   - Lecturer logs in via TOTP
 *   - Creates a module + session, uploads a small PDF, starts it
 *   - N guest students join via the anonymous QR flow (POST /api/join/:id)
 *   - Each opens a WS and fires a plausible mix of reactions, pace, questions, notes, confusion
 *   - Some students disconnect mid-session (idle / closed browser)
 *   - Lecturer ends session
 *   - Report is fetched and metrics validated
 *
 * Run: node scripts/test-scale.mjs [count]
 */
import WebSocket from 'ws';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const API = process.env.API_BASE ?? 'http://localhost:3000';
const N_STUDENTS = Number(process.argv[2] ?? 15);
const LECTURER = 'lecturer@leeds.ac.uk';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.random() * (max - min);

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else       { fail++; console.log(`  FAIL  ${label}`); }
}

async function req(path, opts = {}) {
  const { headers, ...rest } = opts;
  const r = await fetch(`${API}${path}`, { ...rest, headers: { 'Content-Type': 'application/json', ...headers } });
  const body = r.status === 204 ? {} : await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const slides = [
    { t: 'AI in 15 minutes', b: 'Slide 1 of 5' },
    { t: 'Tokens and probabilities', b: 'Slide 2 of 5' },
    { t: 'Attention and layers', b: 'Slide 3 of 5 - dense' },
    { t: 'The simpler picture', b: 'Slide 4 of 5 - recovery' },
    { t: 'What this explains', b: 'Slide 5 of 5' },
  ];
  for (const s of slides) {
    const p = doc.addPage([960, 540]);
    p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.96, 0.97, 0.98) });
    p.drawText(s.t, { x: 40, y: 450, size: 28, font, color: rgb(0.12, 0.23, 0.37) });
    p.drawText(s.b, { x: 40, y: 400, size: 18, font: bodyFont, color: rgb(0.3, 0.3, 0.3) });
  }
  return Buffer.from(await doc.save());
}

function openWs(token, sessionId) {
  return new Promise((resolve, reject) => {
    const wsUrl = API.replace(/^http/, 'ws');
    const s = new WebSocket(`${wsUrl}/ws?token=${token}&sessionId=${sessionId}`);
    s.on('open', () => resolve(s));
    s.on('error', reject);
  });
}

async function main() {
  console.log(`=== LectureFlow scale test — ${N_STUDENTS} students ===`);
  console.log(`API: ${API}`);

  // 1. Lecturer login (dev shortcut on local)
  console.log(`\n[1] Lecturer login (${LECTURER})`);
  const loginRes = await req('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email: LECTURER, code: '123456' }),
  });
  check(loginRes.status === 200 && !!loginRes.body.token, `lecturer login returns token (got ${loginRes.status})`);
  if (!loginRes.body.token) { console.log('ABORT: cannot log in as lecturer'); process.exit(1); }
  const lecToken = loginRes.body.token;

  // 2. Create module (or reuse an existing one owned by this lecturer)
  console.log('\n[2] Ensuring a module exists');
  const modList = await req('/modules', { headers: { Authorization: `Bearer ${lecToken}` } });
  let moduleId;
  const owned = Array.isArray(modList.body) ? modList.body : [];
  if (owned.length > 0) {
    moduleId = owned[0].id;
    console.log(`  Using existing module ${owned[0].code}`);
  } else {
    const createMod = await req('/modules', {
      method: 'POST',
      headers: { Authorization: `Bearer ${lecToken}` },
      body: JSON.stringify({ code: `TEST${Date.now().toString().slice(-8)}`, name: 'Scale Test', color: '#1e3a5f' }),
    });
    check(createMod.status === 200 || createMod.status === 201, `module create (${createMod.status}) ${JSON.stringify(createMod.body)}`);
    moduleId = createMod.body.id;
  }

  // 3. Session + PDF + start
  console.log('\n[3] Create session, upload PDF, start');
  const sessRes = await req('/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
    body: JSON.stringify({ moduleId, title: 'Scale Test Session' }),
  });
  check(sessRes.status === 200 || sessRes.status === 201, `session create (${sessRes.status})`);
  const SESSION_ID = sessRes.body.id;

  const pdfBuf = await makePdf();
  const form = new FormData();
  form.append('file', new Blob([pdfBuf], { type: 'application/pdf' }), 'scale.pdf');
  const pdfRes = await fetch(`${API}/sessions/${SESSION_ID}/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
    body: form,
  });
  check(pdfRes.status === 200 || pdfRes.status === 201, `PDF upload (${pdfRes.status})`);

  const slidesRes = await req(`/sessions/${SESSION_ID}/slides`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${lecToken}` },
    body: JSON.stringify({ totalSlides: 5 }),
  });
  check(slidesRes.status === 200, `set totalSlides=5 (${slidesRes.status})`);

  const startRes = await req(`/sessions/${SESSION_ID}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
  });
  check(startRes.status === 200, `session start (${startRes.status})`);

  // 4. Guest students join via QR flow
  console.log(`\n[4] ${N_STUDENTS} students joining via /join/:id (guest flow)`);
  const students = [];
  for (let i = 0; i < N_STUDENTS; i++) {
    const r = await req(`/join/${SESSION_ID}`, {
      method: 'POST',
      body: JSON.stringify({ name: `Student${String(i + 1).padStart(2, '0')} (Y${1 + (i % 4)})` }),
    });
    if (r.status === 200) {
      students.push({ token: r.body.token, id: r.body.user.id, name: r.body.user.name });
    } else {
      console.log(`  FAIL student ${i + 1}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    }
    // Space out so rate limit (10 per minute) doesn't reject later joiners
    if ((i + 1) % 8 === 0) { console.log(`  ${i + 1} joined, pausing 65s for rate limit window...`); await sleep(65_000); }
  }
  check(students.length === N_STUDENTS, `all students joined (${students.length}/${N_STUDENTS})`);
  if (students.length === 0) { console.log('ABORT: no students joined'); process.exit(1); }

  // 5. Open WebSockets
  console.log('\n[5] Opening WebSockets');
  const lecWs = await openWs(lecToken, SESSION_ID);
  const studentWss = [];
  let wsOk = 0, wsFail = 0;
  for (const s of students) {
    try { studentWss.push(await openWs(s.token, SESSION_ID)); wsOk++; }
    catch { wsFail++; }
  }
  check(wsFail === 0, `WS connections (${wsOk} ok, ${wsFail} failed)`);

  let peakDistribution = null;
  lecWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'FEEDBACK_UPDATE') peakDistribution = msg.distribution;
    } catch {}
  });

  // 6. Simulate 5 slides of reactions
  console.log('\n[6] Simulating 5 slides of reactions');
  // Slide 1: warm-up — all neutral / got_it
  await fireReactions(studentWss, 0, (i) => i < N_STUDENTS * 0.7 ? 'got_it' : 'neutral');
  firePaces(studentWss, 'ok', 0.8);
  await sleep(1500);

  // Slide 2: add a question from student 0
  lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 1 }));
  await sleep(800);
  await fireReactions(studentWss, 1, (i) => i < N_STUDENTS * 0.8 ? 'got_it' : 'neutral');
  await req(`/questions/session/${SESSION_ID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${students[0].token}` },
    body: JSON.stringify({ content: 'Can you repeat the probability explanation?', slideIndex: 1 }),
  });
  console.log('  1 question submitted (slide 2)');
  await sleep(1500);

  // Slide 3: deliberately confusing slide
  lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 2 }));
  await sleep(800);
  await fireReactions(studentWss, 2, (i) => {
    if (i < N_STUDENTS * 0.3) return 'got_it';
    if (i < N_STUDENTS * 0.55) return 'neutral';
    if (i < N_STUDENTS * 0.85) return 'confused';
    return 'lost';
  });
  firePaces(studentWss, 'fast', 0.6);
  // A few students submit confusion highlights
  for (let i = 0; i < Math.min(3, students.length); i++) {
    await req(`/confusion/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${students[i].token}` },
      body: JSON.stringify({
        slideIndex: 2,
        emoji: 'confused',
        highlights: [{ shape: 'rect', x: 0.1 + i * 0.05, y: 0.4, width: 0.3, height: 0.2 }],
        explanation: `Confusion reason ${i + 1}: the attention diagram labels are unclear`,
      }),
    });
  }
  console.log('  3 confusion contexts submitted (slide 3)');
  // Questions from 2 students
  for (let i = 1; i < Math.min(3, students.length); i++) {
    await req(`/questions/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${students[i].token}` },
      body: JSON.stringify({ content: `Question ${i} on attention — what is Q vs K vs V?`, slideIndex: 2 }),
    });
  }
  // Simulate some students going idle (closing browser) during the dense slide
  const dropouts = Math.min(3, Math.floor(N_STUDENTS * 0.2));
  for (let i = 0; i < dropouts; i++) {
    const idx = N_STUDENTS - 1 - i;
    studentWss[idx]?.close();
  }
  console.log(`  ${dropouts} students dropped (simulated idle/close)`);
  await sleep(2000);

  // Slide 4: recovery
  lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 3 }));
  await sleep(800);
  await fireReactions(studentWss, 3, (i) => {
    if (i < N_STUDENTS * 0.75) return 'got_it';
    return 'neutral';
  }, N_STUDENTS - dropouts);
  firePaces(studentWss, 'ok', 0.9, N_STUDENTS - dropouts);
  // Notes from 3 students
  for (let i = 0; i < Math.min(3, students.length - dropouts); i++) {
    await req(`/notes/session/${SESSION_ID}/slide/3`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${students[i].token}` },
      body: JSON.stringify({ content: `Student ${i + 1}'s note: attention = query-key-value weighted sum. Much clearer now.` }),
    });
  }
  console.log('  3 slide-notes saved (slide 4)');
  await sleep(1500);

  // Slide 5: close — mostly got_it
  lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 4 }));
  await sleep(800);
  await fireReactions(studentWss, 4, (i) => i < (N_STUDENTS - dropouts) * 0.85 ? 'got_it' : 'neutral', N_STUDENTS - dropouts);
  await sleep(1500);

  // 7. One student re-joins after disconnect (reconnect test)
  console.log('\n[7] Reconnect: student[0] closes + re-opens WS');
  studentWss[0].close();
  await sleep(500);
  try {
    const reWs = await openWs(students[0].token, SESSION_ID);
    reWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 4 }));
    await sleep(500);
    reWs.close();
    check(true, 'reconnect + send reaction worked');
  } catch (e) {
    check(false, `reconnect failed: ${e.message}`);
  }

  // 8. End session
  console.log('\n[8] End session');
  const endRes = await req(`/sessions/${SESSION_ID}/end`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
  });
  check(endRes.status === 200, `session end (${endRes.status})`);

  // 9. Reject new WS on ended session
  console.log('\n[9] Verify WS rejects after end');
  let rejected = false;
  try {
    const w = await openWs(students[0].token, SESSION_ID);
    w.on('message', (d) => {
      try { if (JSON.parse(d).type === 'ERROR') rejected = true; } catch {}
    });
    await sleep(1000);
    w.close();
  } catch {
    rejected = true;
  }
  check(rejected, 'ended-session WS is rejected');

  // Reflections from 3 students
  console.log('\n[10] Post-session reflections');
  for (let i = 0; i < Math.min(3, students.length); i++) {
    await req(`/reflections/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${students[i].token}` },
      body: JSON.stringify({
        mostImportant: `Student ${i + 1}: attention is a weighted average over other tokens`,
        stillUnclear: `Student ${i + 1}: how RLHF actually updates weights`,
      }),
    });
  }

  // 11. Fetch report
  console.log('\n[11] Fetch session report');
  const report = await req(`/sessions/${SESSION_ID}/report`, {
    headers: { Authorization: `Bearer ${lecToken}` },
  });
  check(report.status === 200, `report fetch (${report.status})`);
  if (report.status !== 200) {
    console.log(`ABORT: report body: ${JSON.stringify(report.body)}`);
    process.exit(1);
  }
  const r = report.body;
  console.log(`  Title: ${r.session?.title}`);
  console.log(`  Enrolled: ${r.totalEnrolled}, peak: ${r.peakParticipants}`);
  console.log(`  Slides: ${r.slides?.length}`);
  const od = r.overallDistribution;
  if (od) console.log(`  Overall: got_it=${od.got_it} neutral=${od.neutral} confused=${od.confused} lost=${od.lost} total=${od.total}`);

  check(r.peakParticipants >= N_STUDENTS - dropouts - 1, `peak participants reflects live count (got ${r.peakParticipants})`);
  check((r.overallDistribution?.total ?? 0) > N_STUDENTS * 3, `feedback events recorded (total ${r.overallDistribution?.total})`);
  check(r.slides?.length === 5, `5 slides in report (got ${r.slides?.length})`);
  const slide3 = r.slides?.[2];
  if (slide3) {
    const d = slide3.distribution;
    check((d.confused + d.lost) > 0, 'slide 3 shows confusion (confused+lost>0)');
    check(slide3.questions?.length >= 2, `slide 3 questions (${slide3.questions?.length ?? 0})`);
    check(slide3.confusionContexts?.length >= 2, `slide 3 confusion contexts (${slide3.confusionContexts?.length ?? 0})`);
  }
  const slide4 = r.slides?.[3];
  if (slide4) {
    check((slide4.distribution?.got_it ?? 0) > (slide3?.distribution?.got_it ?? 0), 'slide 4 shows recovery (more got_it than slide 3)');
  }

  // Close WSs
  for (const w of studentWss) { try { w.close(); } catch {} }
  lecWs.close();

  console.log(`\n=== RESULT: ${pass} pass, ${fail} fail ===`);
  console.log(`Session: ${SESSION_ID}`);
  process.exit(fail > 0 ? 1 : 0);
}

async function fireReactions(wss, slide, picker, limit) {
  const cap = limit ?? wss.length;
  for (let i = 0; i < cap; i++) {
    const ws = wss[i];
    if (ws?.readyState !== WebSocket.OPEN) continue;
    ws.send(JSON.stringify({ type: 'FEEDBACK', emoji: picker(i), slideIndex: slide }));
    await sleep(jitter(30, 120));
  }
}
function firePaces(wss, value, fraction, limit) {
  const cap = limit ?? wss.length;
  const n = Math.floor(cap * fraction);
  for (let i = 0; i < n; i++) {
    const ws = wss[i];
    if (ws?.readyState !== WebSocket.OPEN) continue;
    ws.send(JSON.stringify({ type: 'PACE_FEEDBACK', value }));
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
