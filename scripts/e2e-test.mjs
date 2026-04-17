import WebSocket from 'ws';

const BASE = 'http://localhost:3000';

async function req(path, opts = {}) {
  const { headers: extraHeaders, ...rest } = opts;
  const r = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function login(email) {
  const { token } = await req('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code: '123456' }),
  });
  return token;
}

function connectWS(token, sessionId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}&sessionId=${sessionId}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('=== E2E Foundation Test ===\n');

  // 1. Login
  const lecToken = await login('bosslecturer@leeds.ac.uk');
  const omarToken = await login('oc@leeds.ac.uk');
  const aliceToken = await login('scac01@leeds.ac.uk');
  console.log('1. All logins OK (lecturer + 2 students)');

  // 2. Get module
  const modules = await req('/modules', { headers: { Authorization: `Bearer ${lecToken}` } });
  const mod = modules.find(m => m.code === 'COMP1234');
  console.log(`2. Module: ${mod.code} - ${mod.name} (${mod.enrolledCount} enrolled)`);

  // 3. Create session
  const session = await req('/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
    body: JSON.stringify({ moduleId: mod.id, title: 'E2E Foundation Test' }),
  });
  if (!session.id) { console.error('Session creation failed:', session); process.exit(1); }
  console.log(`3. Session created: ${session.title} (${session.id})`);

  // 4. Copy PDF from existing session
  const sessions = await req(`/sessions/module/${mod.id}`, { headers: { Authorization: `Bearer ${lecToken}` } });
  const withPdf = sessions.find(s => s.hasPdf && s.id !== session.id);
  if (withPdf) {
    const pdfResp = await fetch(`${BASE}/sessions/${withPdf.id}/pdf`, {
      headers: { Authorization: `Bearer ${lecToken}` },
    });
    const pdfBlob = await pdfResp.blob();
    const form = new FormData();
    form.append('file', pdfBlob, 'slides.pdf');
    await fetch(`${BASE}/sessions/${session.id}/pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${lecToken}` },
      body: form,
    });
    console.log('4. PDF uploaded');
  } else {
    console.log('4. No PDF to copy (skipped)');
  }

  // 5. Start session
  await req(`/sessions/${session.id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lecToken}` },
  });
  console.log('5. Session started (live)');

  // 6. Connect WebSockets
  const lecWs = await connectWS(lecToken, session.id);
  const omarWs = await connectWS(omarToken, session.id);
  const aliceWs = await connectWS(aliceToken, session.id);
  console.log('6. WebSocket connections established');
  await sleep(500);

  // 7. Slide 0: Omar=got_it, Alice=confused
  omarWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 0 }));
  aliceWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'confused', slideIndex: 0 }));
  console.log('7. Slide 0 feedback sent');
  await sleep(300);

  // 8. Change to slide 1 (flushes slide 0)
  lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 1 }));
  await sleep(500);
  omarWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 1 }));
  aliceWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'got_it', slideIndex: 1 }));
  console.log('8. Slide 1: both got_it');
  await sleep(300);

  // 9. Change to slide 2 (flushes slide 1)
  lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 2 }));
  await sleep(500);
  omarWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'neutral', slideIndex: 2 }));
  aliceWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: 'lost', slideIndex: 2 }));
  console.log('9. Slide 2: Omar=neutral, Alice=lost');

  // 10. Pace
  omarWs.send(JSON.stringify({ type: 'PACE', value: 'ok' }));
  aliceWs.send(JSON.stringify({ type: 'PACE', value: 'fast' }));
  console.log('10. Pace sent');

  // 11. Question
  const q = await req(`/questions/session/${session.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${omarToken}` },
    body: JSON.stringify({ content: 'Can you explain slide 2 further?', slideIndex: 2 }),
  });
  console.log(`11. Question asked: ${q.id ? 'OK' : 'FAIL - ' + JSON.stringify(q)}`);
  await sleep(2000); // Wait for all WS messages to be processed before ending

  // 12. End session
  lecWs.send(JSON.stringify({ type: 'END_SESSION' }));
  await sleep(1500);
  console.log('12. Session ended');
  omarWs.close();
  aliceWs.close();
  lecWs.close();
  await sleep(500); // Wait for disconnect handlers to flush to DB

  // 13. Verify report
  const report = await req(`/sessions/${session.id}/report`, {
    headers: { Authorization: `Bearer ${lecToken}` },
  });

  console.log('\n=== REPORT VERIFICATION ===');
  console.log(`Title: ${report.session?.title}`);
  console.log(`Enrolled: ${report.totalEnrolled} | Peak: ${report.peakParticipants}`);
  console.log(`Slides: ${report.slides?.length}`);

  const o = report.overallDistribution;
  console.log(`Overall: got_it=${o?.got_it} neutral=${o?.neutral} confused=${o?.confused} lost=${o?.lost} total=${o?.total}`);

  let pass = 0, fail = 0;

  function check(name, condition) {
    if (condition) { console.log(`  PASS: ${name}`); pass++; }
    else { console.log(`  FAIL: ${name}`); fail++; }
  }

  // Slide 0
  const s0 = report.slides?.find(s => s.slideIndex === 0)?.distribution;
  check('Slide 0: got_it=1', s0?.got_it === 1);
  check('Slide 0: confused=1', s0?.confused === 1);
  check('Slide 0: total=2', s0?.total === 2);

  // Slide 1
  const s1 = report.slides?.find(s => s.slideIndex === 1)?.distribution;
  check('Slide 1: got_it=2', s1?.got_it === 2);
  check('Slide 1: total=2', s1?.total === 2);

  // Slide 2
  const s2 = report.slides?.find(s => s.slideIndex === 2);
  console.log(`Slide 2 raw: ${JSON.stringify(s2?.distribution)}`);
  check('Slide 2: neutral=1', s2?.distribution?.neutral === 1);
  check('Slide 2: lost=1', s2?.distribution?.lost === 1);
  check('Slide 2: total=2', s2?.distribution?.total === 2);
  check('Slide 2: 1 question', s2?.questions?.length === 1);

  // Overall: 3 got_it + 1 neutral + 1 confused + 1 lost = 6
  check('Overall: got_it=3', o?.got_it === 3);
  check('Overall: neutral=1', o?.neutral === 1);
  check('Overall: confused=1', o?.confused === 1);
  check('Overall: lost=1', o?.lost === 1);
  check('Overall: total=6', o?.total === 6);
  check('Peak participants >= 2', report.peakParticipants >= 2);

  // Student report (Omar should see it too)
  const studentReport = await req(`/sessions/${session.id}/report`, {
    headers: { Authorization: `Bearer ${omarToken}` },
  });
  check('Student can access report', !!studentReport.session);

  // Engagement analytics checks
  const eng = report.engagement;
  check('Engagement analytics exists', !!eng);
  if (eng) {
    check('Overall engagement score > 0', eng.overallScore.overall > 0);
    check('Overall engagement score <= 100', eng.overallScore.overall <= 100);
    check('Emoji signal present', eng.overallScore.signals.emoji !== null);
    check('Per-slide engagement exists', eng.perSlide.length > 0);
    check('Signal comparisons exist', eng.signalComparison.length === 5);

    console.log(`\n=== ENGAGEMENT ANALYTICS ===`);
    console.log(`Overall score: ${eng.overallScore.overall}/100`);
    console.log(`Signals: emoji=${eng.overallScore.signals.emoji} pace=${eng.overallScore.signals.pace} questions=${eng.overallScore.signals.questions} confusion=${eng.overallScore.signals.confusion} notes=${eng.overallScore.signals.notes}`);
    console.log('Signal comparisons:');
    for (const sc of eng.signalComparison) {
      console.log(`  ${sc.signalName}: solo=${sc.soloScore} weight=${sc.weight} r=${sc.correlation}`);
    }
    if (eng.proficiencyBreakdown.length > 0) {
      console.log('Proficiency breakdown:');
      for (const p of eng.proficiencyBreakdown) {
        console.log(`  ${p.proficiency}: score=${p.averageScore} n=${p.studentCount}`);
      }
    }
    // Per-slide
    for (const ps of eng.perSlide) {
      console.log(`  Slide ${ps.slideIndex}: engagement=${ps.engagement.overall}`);
    }
  }

  console.log(`\n=== ${fail === 0 ? 'ALL ' + pass + ' CHECKS PASSED' : fail + ' FAILED, ' + pass + ' passed'} ===`);

  // Cleanup
  await req(`/sessions/${session.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${lecToken}` },
  });
  console.log('Test session cleaned up.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
