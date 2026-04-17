/**
 * Simulate a full LectureFlow session with 5 students.
 *
 * Uses WebSocket + REST API to simulate student interactions reliably,
 * then opens a Playwright browser for the lecturer to view the report.
 *
 * Run:  node scripts/simulate-session.mjs
 */

import WebSocket from 'ws';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright';

const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';

const LECTURER = { email: 'bosslecturer@leeds.ac.uk', code: '123456' };
const STUDENTS = [
  { email: 'scac01@leeds.ac.uk', name: 'Alice Chen' },
  { email: 'scbs02@leeds.ac.uk', name: 'Bob Smith' },
  { email: 'sccd03@leeds.ac.uk', name: 'Charlie Davis' },
  { email: 'scde04@leeds.ac.uk', name: 'Diana Evans' },
  { email: 'scef05@leeds.ac.uk', name: 'Ethan Foster' },
];

const MODULE_ID = '71a97928-faf8-45cb-9c2d-9fd13d984110'; // COMP1234

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(path, opts = {}) {
  const { headers: h, ...rest } = opts;
  const r = await fetch(`${API}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...h },
  });
  if (r.status === 204) return {};
  return r.json();
}

async function login(email) {
  const { token } = await req('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code: '123456' }),
  });
  return token;
}

function openWs(token, sessionId) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://localhost:3000/ws?token=${token}&sessionId=${sessionId}`);
    s.on('open', () => resolve(s));
    s.on('error', reject);
  });
}

/** Generate an 8-slide PDF about "Introduction to Algorithms" */
async function generatePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);

  const slides = [
    { title: 'Introduction to Algorithms', body: 'COMP1234 - Lecture 5\nDr. Boss\nUniversity of Leeds' },
    { title: "Today's Agenda", body: '1. What is an algorithm?\n2. Big-O notation\n3. Sorting algorithms\n4. Searching algorithms\n5. Practice problems' },
    { title: 'What is an Algorithm?', body: 'A step-by-step procedure for\nsolving a problem or performing\na computation.\n\nKey properties:\n- Finite\n- Definite\n- Effective' },
    { title: 'Big-O Notation', body: "Describes the upper bound of\nan algorithm's time complexity.\n\nCommon complexities:\nO(1) - Constant\nO(log n) - Logarithmic\nO(n) - Linear\nO(n log n) - Linearithmic\nO(n^2) - Quadratic" },
    { title: 'Bubble Sort', body: 'Compare adjacent elements and\nswap if in wrong order.\n\nTime: O(n^2)\nSpace: O(1)\nStable: Yes\n\nSimple but inefficient for\nlarge datasets.' },
    { title: 'Merge Sort', body: 'Divide array in half, sort each\nhalf, then merge.\n\nTime: O(n log n)\nSpace: O(n)\nStable: Yes\n\nEfficient divide-and-conquer.' },
    { title: 'Binary Search', body: 'Search a sorted array by\nrepeatedly dividing in half.\n\nTime: O(log n)\nSpace: O(1)\n\nRequires sorted input.\nMuch faster than linear search.' },
    { title: 'Summary & Questions', body: 'Key takeaways:\n- Algorithms have measurable efficiency\n- Big-O helps compare approaches\n- Choose the right tool for the job\n\nAny questions?' },
  ];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const page = doc.addPage([960, 540]);
    page.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.96, 0.97, 0.98) });
    page.drawRectangle({ x: 0, y: 470, width: 960, height: 70, color: rgb(0.12, 0.23, 0.37) });
    page.drawText(slide.title, { x: 40, y: 490, size: 28, font, color: rgb(1, 1, 1) });
    const lines = slide.body.split('\n');
    lines.forEach((line, j) => {
      page.drawText(line, { x: 60, y: 420 - j * 32, size: 18, font: bodyFont, color: rgb(0.2, 0.2, 0.2) });
    });
    page.drawText(`${i + 1} / ${slides.length}`, { x: 890, y: 15, size: 12, font: bodyFont, color: rgb(0.5, 0.5, 0.5) });
  }

  return Buffer.from(await doc.save());
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== LectureFlow Session Simulation ===\n');

  // ── 1. Setup: create session, upload PDF ───────────────────────────────────
  console.log('[1/7] Authenticating...');
  const lecToken = await login(LECTURER.email);
  const studentTokens = [];
  for (const s of STUDENTS) {
    studentTokens.push(await login(s.email));
  }
  console.log(`  Lecturer + ${STUDENTS.length} students authenticated`);

  // Enroll all students
  console.log('[2/7] Enrolling students in COMP1234...');
  for (const tok of studentTokens) {
    await fetch(`${API}/modules/${MODULE_ID}/enroll`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}` },
    });
  }
  console.log('  All students enrolled');

  // Create session
  console.log('[3/7] Creating session + uploading PDF...');
  const sessRes = await req('/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
    body: JSON.stringify({ moduleId: MODULE_ID, title: 'Lecture 5: Introduction to Algorithms' }),
  });
  const SESSION_ID = sessRes.id;
  console.log(`  Session: ${SESSION_ID}`);

  // Upload PDF
  const pdfBuf = await generatePdf();
  const form = new FormData();
  form.append('file', new Blob([pdfBuf], { type: 'application/pdf' }), 'lecture5.pdf');
  await fetch(`${API}/sessions/${SESSION_ID}/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
    body: form,
  });

  // Set total slides
  await req(`/sessions/${SESSION_ID}/slides`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${lecToken}` },
    body: JSON.stringify({ totalSlides: 8 }),
  });
  console.log('  PDF uploaded (8 slides), slide count set');

  // Start session
  await req(`/sessions/${SESSION_ID}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
  });
  console.log('  Session is LIVE!\n');

  // ── 2. Connect everyone via WebSocket ──────────────────────────────────────
  console.log('[4/7] Opening WebSocket connections...');
  const lecWs = await openWs(lecToken, SESSION_ID);
  const studentWss = [];
  for (const tok of studentTokens) {
    studentWss.push(await openWs(tok, SESSION_ID));
  }
  console.log(`  ${1 + studentWss.length} WebSocket connections established\n`);

  // Listen for lecturer messages (for debugging)
  lecWs.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'FEEDBACK_UPDATE') {
      const d = msg.distribution;
      process.stdout.write(`  [Lecturer sees] Got it: ${d.got_it} | Neutral: ${d.neutral} | Confused: ${d.confused} | Lost: ${d.lost} (${d.total} votes)\r`);
    }
  });

  // ── 3. Simulate 8 slides of interactions ───────────────────────────────────
  console.log('[5/7] Simulating session (8 slides)...\n');

  const SLIDE_DELAY = 30_000; // 30 seconds per slide (~4 min total)

  // Slide 0: Title - everyone neutral, settling in
  {
    console.log('--- Slide 1/8: Introduction to Algorithms ---');
    for (let i = 0; i < 5; i++) {
      await sleep(500 + Math.random() * 1500);
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: 'neutral', slideIndex: 0 }));
      console.log(`  ${STUDENTS[i].name} -> neutral`);
    }
    // Alice takes a note
    await req(`/notes/session/${SESSION_ID}/slide/0`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${studentTokens[0]}` },
      body: JSON.stringify({ content: 'Lecture 5 - Introduction to Algorithms. Dr Boss.' }),
    });
    console.log('  Alice took notes');

    // Set pace
    studentWss[0].send(JSON.stringify({ type: 'PACE', value: 'ok' }));
    studentWss[1].send(JSON.stringify({ type: 'PACE', value: 'ok' }));
    studentWss[2].send(JSON.stringify({ type: 'PACE', value: 'ok' }));
    studentWss[3].send(JSON.stringify({ type: 'PACE', value: 'ok' }));
    studentWss[4].send(JSON.stringify({ type: 'PACE', value: 'slow' }));
    console.log('  Pace: 4x ok, Ethan: slow');
    console.log(`  (waiting ${SLIDE_DELAY / 1000}s...)\n`);
    await sleep(SLIDE_DELAY);
  }

  // Slide 1: Agenda - mostly got_it
  {
    console.log("--- Slide 2/8: Today's Agenda ---");
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 1 }));
    await sleep(1000);

    const emojis = ['got_it', 'got_it', 'got_it', 'neutral', 'got_it'];
    for (let i = 0; i < 5; i++) {
      await sleep(800 + Math.random() * 1200);
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: emojis[i], slideIndex: 1 }));
      console.log(`  ${STUDENTS[i].name} -> ${emojis[i]}`);
    }

    // Bob asks a question
    await req(`/questions/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokens[1]}` },
      body: JSON.stringify({ content: 'Will we cover recursive algorithms in this lecture?', slideIndex: 1 }),
    });
    console.log('  Bob asked: "Will we cover recursive algorithms in this lecture?"');

    console.log(`  (waiting ${SLIDE_DELAY / 1000}s...)\n`);
    await sleep(SLIDE_DELAY);
  }

  // Slide 2: What is an Algorithm - easy, mostly got_it
  {
    console.log('--- Slide 3/8: What is an Algorithm? ---');
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 2 }));
    await sleep(1000);

    const emojis = ['got_it', 'got_it', 'got_it', 'neutral', 'got_it'];
    for (let i = 0; i < 5; i++) {
      await sleep(600 + Math.random() * 1000);
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: emojis[i], slideIndex: 2 }));
      console.log(`  ${STUDENTS[i].name} -> ${emojis[i]}`);
    }

    // Alice asks a question
    await req(`/questions/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokens[0]}` },
      body: JSON.stringify({ content: 'Can you give a real-world example of an algorithm that is not finite?', slideIndex: 2 }),
    });
    console.log('  Alice asked: "Can you give a real-world example of an algorithm that is not finite?"');

    // Charlie takes notes
    await req(`/notes/session/${SESSION_ID}/slide/2`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${studentTokens[2]}` },
      body: JSON.stringify({ content: 'Algorithm = step-by-step procedure. Must be finite, definite, effective. Like a recipe but more precise.' }),
    });
    console.log('  Charlie took notes');

    // Diana changes her mind mid-slide
    await sleep(5000);
    studentWss[3].send(JSON.stringify({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 2 }));
    console.log('  Diana changed -> got_it');

    console.log(`  (waiting ${SLIDE_DELAY / 1000}s...)\n`);
    await sleep(SLIDE_DELAY - 5000);
  }

  // Slide 3: Big-O - harder, confusion starts
  {
    console.log('--- Slide 4/8: Big-O Notation ---');
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 3 }));
    await sleep(1000);

    const emojis = ['got_it', 'neutral', 'confused', 'confused', 'neutral'];
    for (let i = 0; i < 5; i++) {
      await sleep(1000 + Math.random() * 1500);
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: emojis[i], slideIndex: 3 }));
      console.log(`  ${STUDENTS[i].name} -> ${emojis[i]}`);
    }

    // Pace feedback shifts
    studentWss[2].send(JSON.stringify({ type: 'PACE', value: 'fast' }));
    studentWss[3].send(JSON.stringify({ type: 'PACE', value: 'fast' }));
    console.log('  Charlie & Diana: pace too fast');

    // Charlie asks a question
    await req(`/questions/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokens[2]}` },
      body: JSON.stringify({ content: 'Is Big-O always the worst case, or can it describe average case too?', slideIndex: 3 }),
    });
    console.log('  Charlie asked: "Is Big-O always the worst case, or can it describe average case too?"');

    // Alice takes notes
    await req(`/notes/session/${SESSION_ID}/slide/3`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${studentTokens[0]}` },
      body: JSON.stringify({ content: 'Big-O: O(1) < O(log n) < O(n) < O(n log n) < O(n^2). Remember this hierarchy for the exam!' }),
    });
    console.log('  Alice took notes');

    // Diana submits confusion context
    await req(`/confusion/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokens[3]}` },
      body: JSON.stringify({
        slideIndex: 3,
        emoji: 'confused',
        highlights: [{ shape: 'rect', x: 0.1, y: 0.4, width: 0.8, height: 0.3 }],
        explanation: 'I do not understand the difference between O(n) and O(n log n)',
      }),
    });
    console.log('  Diana submitted confusion context with highlight');

    // Ethan changes to confused too
    await sleep(5000);
    studentWss[4].send(JSON.stringify({ type: 'FEEDBACK', emoji: 'confused', slideIndex: 3 }));
    console.log('  Ethan changed -> confused');

    console.log(`  (waiting ${SLIDE_DELAY / 1000}s...)\n`);
    await sleep(SLIDE_DELAY - 5000);
  }

  // Slide 4: Bubble Sort - some confusion, some got_it
  {
    console.log('--- Slide 5/8: Bubble Sort ---');
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 4 }));
    await sleep(1000);

    const emojis = ['got_it', 'got_it', 'confused', 'neutral', 'confused'];
    for (let i = 0; i < 5; i++) {
      await sleep(800 + Math.random() * 1200);
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: emojis[i], slideIndex: 4 }));
      console.log(`  ${STUDENTS[i].name} -> ${emojis[i]}`);
    }

    // Bob asks a question
    await req(`/questions/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokens[1]}` },
      body: JSON.stringify({ content: 'Why would anyone use bubble sort if it is O(n^2)?', slideIndex: 4 }),
    });
    console.log('  Bob asked: "Why would anyone use bubble sort if it is O(n^2)?"');

    // Bob takes notes
    await req(`/notes/session/${SESSION_ID}/slide/4`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${studentTokens[1]}` },
      body: JSON.stringify({ content: 'Bubble sort: simple but slow O(n^2). Good for teaching purposes and nearly-sorted small arrays. Not used in production.' }),
    });
    console.log('  Bob took notes');

    // Pace normalizes
    studentWss[2].send(JSON.stringify({ type: 'PACE', value: 'ok' }));
    studentWss[3].send(JSON.stringify({ type: 'PACE', value: 'ok' }));

    console.log(`  (waiting ${SLIDE_DELAY / 1000}s...)\n`);
    await sleep(SLIDE_DELAY);
  }

  // Slide 5: Merge Sort - hardest slide, most confusion
  {
    console.log('--- Slide 6/8: Merge Sort ---');
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 5 }));
    await sleep(1000);

    const emojis = ['neutral', 'confused', 'lost', 'confused', 'neutral'];
    for (let i = 0; i < 5; i++) {
      await sleep(1000 + Math.random() * 2000);
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: emojis[i], slideIndex: 5 }));
      console.log(`  ${STUDENTS[i].name} -> ${emojis[i]}`);
    }

    // Pace: too fast
    studentWss[1].send(JSON.stringify({ type: 'PACE', value: 'fast' }));
    studentWss[2].send(JSON.stringify({ type: 'PACE', value: 'fast' }));
    studentWss[3].send(JSON.stringify({ type: 'PACE', value: 'fast' }));
    console.log('  Bob, Charlie, Diana: pace too fast');

    // Charlie submits confusion context
    await req(`/confusion/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokens[2]}` },
      body: JSON.stringify({
        slideIndex: 5,
        emoji: 'lost',
        highlights: [{ shape: 'rect', x: 0.05, y: 0.3, width: 0.9, height: 0.4 }],
        explanation: 'The merge step is completely unclear to me - how do we combine two sorted halves?',
      }),
    });
    console.log('  Charlie submitted confusion context (merge step unclear)');

    // Ethan asks a question
    await req(`/questions/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokens[4]}` },
      body: JSON.stringify({ content: 'How does merge sort compare to quicksort in practice?', slideIndex: 5 }),
    });
    console.log('  Ethan asked: "How does merge sort compare to quicksort in practice?"');

    // Alice takes notes
    await req(`/notes/session/${SESSION_ID}/slide/5`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${studentTokens[0]}` },
      body: JSON.stringify({ content: 'Merge sort: divide and conquer, O(n log n), uses O(n) extra space. Stable sort. Better worst-case than quicksort.' }),
    });
    console.log('  Alice took notes');

    // Some students change their minds after explanation
    await sleep(8000);
    studentWss[1].send(JSON.stringify({ type: 'FEEDBACK', emoji: 'neutral', slideIndex: 5 }));
    studentWss[3].send(JSON.stringify({ type: 'FEEDBACK', emoji: 'neutral', slideIndex: 5 }));
    console.log('  Bob & Diana recovered -> neutral');

    console.log(`  (waiting ${SLIDE_DELAY / 1000}s...)\n`);
    await sleep(SLIDE_DELAY - 8000);
  }

  // Slide 6: Binary Search - mixed but improving
  {
    console.log('--- Slide 7/8: Binary Search ---');
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 6 }));
    await sleep(1000);

    const emojis = ['got_it', 'got_it', 'neutral', 'got_it', 'neutral'];
    for (let i = 0; i < 5; i++) {
      await sleep(700 + Math.random() * 1000);
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: emojis[i], slideIndex: 6 }));
      console.log(`  ${STUDENTS[i].name} -> ${emojis[i]}`);
    }

    // Diana asks question
    await req(`/questions/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokens[3]}` },
      body: JSON.stringify({ content: 'What happens if the array is not sorted when using binary search?', slideIndex: 6 }),
    });
    console.log('  Diana asked: "What happens if the array is not sorted when using binary search?"');

    // Diana takes notes
    await req(`/notes/session/${SESSION_ID}/slide/6`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${studentTokens[3]}` },
      body: JSON.stringify({ content: 'Binary search: O(log n), needs sorted input. Much faster than linear O(n) search. Used in databases and search engines.' }),
    });
    console.log('  Diana took notes');

    // Pace back to normal
    studentWss[1].send(JSON.stringify({ type: 'PACE', value: 'ok' }));
    studentWss[2].send(JSON.stringify({ type: 'PACE', value: 'ok' }));
    studentWss[3].send(JSON.stringify({ type: 'PACE', value: 'ok' }));

    console.log(`  (waiting ${SLIDE_DELAY / 1000}s...)\n`);
    await sleep(SLIDE_DELAY);
  }

  // Slide 7: Summary - mostly got_it
  {
    console.log('--- Slide 8/8: Summary & Questions ---');
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 7 }));
    await sleep(1000);

    const emojis = ['got_it', 'got_it', 'neutral', 'got_it', 'got_it'];
    for (let i = 0; i < 5; i++) {
      await sleep(500 + Math.random() * 800);
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: emojis[i], slideIndex: 7 }));
      console.log(`  ${STUDENTS[i].name} -> ${emojis[i]}`);
    }

    // Alice asks final question
    await req(`/questions/session/${SESSION_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokens[0]}` },
      body: JSON.stringify({ content: 'Will sorting algorithms be covered in the coursework?', slideIndex: 7 }),
    });
    console.log('  Alice asked: "Will sorting algorithms be covered in the coursework?"');

    // Ethan takes summary notes
    await req(`/notes/session/${SESSION_ID}/slide/7`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${studentTokens[4]}` },
      body: JSON.stringify({ content: 'Key takeaways: algorithms have measurable efficiency via Big-O. Bubble sort O(n^2), merge sort O(n log n), binary search O(log n). Need to review merge sort.' }),
    });
    console.log('  Ethan took summary notes');

    console.log(`  (waiting ${SLIDE_DELAY / 1000}s...)\n`);
    await sleep(SLIDE_DELAY);
  }

  // ── 4. End session ─────────────────────────────────────────────────────────
  console.log('[6/7] Ending session...');
  await req(`/sessions/${SESSION_ID}/end`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
  });
  console.log('  Session ended!');

  // Close WebSockets
  for (const ws of studentWss) ws.close();
  lecWs.close();
  await sleep(2000);

  // Submit reflections from a few students
  console.log('  Students submitting reflections...');
  await req(`/reflections/session/${SESSION_ID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentTokens[0]}` },
    body: JSON.stringify({
      mostImportant: 'Big-O notation and how to compare algorithm efficiency. The hierarchy O(1) < O(log n) < O(n) was really helpful.',
      stillUnclear: 'I need more practice with merge sort - the divide and conquer part makes sense but the merging step is still fuzzy.',
    }),
  });
  console.log('  Alice submitted reflection');

  await req(`/reflections/session/${SESSION_ID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentTokens[1]}` },
    body: JSON.stringify({
      mostImportant: 'Understanding why bubble sort is never used in production despite being easy to implement.',
      stillUnclear: 'The space complexity of merge sort - why does it need O(n) extra space?',
    }),
  });
  console.log('  Bob submitted reflection');

  await req(`/reflections/session/${SESSION_ID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentTokens[3]}` },
    body: JSON.stringify({
      mostImportant: 'Binary search is incredibly efficient at O(log n) but requires sorted data.',
      stillUnclear: 'Big-O notation in general - I need to review the mathematical foundations.',
    }),
  });
  console.log('  Diana submitted reflection');

  // ── 5. Open lecturer browser to view report ────────────────────────────────
  console.log('\n[7/7] Opening browser for report...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Login as lecturer
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', LECTURER.email);
  await page.fill('input[type="text"]', LECTURER.code);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/lecturer/, { timeout: 10000 });
  await sleep(1000);

  // Navigate to report
  await page.goto(`${WEB}/lecturer/session/${SESSION_ID}/report`);
  await page.waitForLoadState('networkidle');
  await sleep(2000);

  // Print report data
  console.log('\n=== REPORT DATA ===');
  const report = await req(`/sessions/${SESSION_ID}/report`, { headers: { Authorization: `Bearer ${lecToken}` } });
  console.log(`Title: ${report.session?.title}`);
  console.log(`Enrolled: ${report.totalEnrolled} | Peak participants: ${report.peakParticipants}`);
  console.log(`Slides: ${report.slides?.length}`);

  const o = report.overallDistribution;
  if (o) console.log(`Overall: got_it=${o.got_it} neutral=${o.neutral} confused=${o.confused} lost=${o.lost} total=${o.total}`);

  if (report.slides) {
    console.log('\nPer-slide breakdown:');
    for (const s of report.slides) {
      const d = s.distribution;
      const parts = [];
      if (d.total > 0) parts.push(`G:${d.got_it} N:${d.neutral} C:${d.confused} L:${d.lost}`);
      if (s.questions.length > 0) parts.push(`${s.questions.length} question(s)`);
      if (s.confusionContexts?.length > 0) parts.push(`${s.confusionContexts.length} confusion report(s)`);
      console.log(`  Slide ${s.slideIndex + 1}: ${parts.join(' | ') || 'no feedback'}`);
    }
  }

  console.log(`\n=== SIMULATION COMPLETE ===`);
  console.log(`Session ID: ${SESSION_ID}`);
  console.log(`Report URL: ${WEB}/lecturer/session/${SESSION_ID}/report`);
  console.log(`\nBrowser is open - explore the report!`);
  console.log('Press Ctrl+C when done.\n');

  // Keep alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
