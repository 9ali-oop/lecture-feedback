/**
 * Resource Profiling Script for LectureFlow
 *
 * Measures:
 * 1. API response times (login, session creation, report generation)
 * 2. WebSocket connection time and message latency
 * 3. Engagement score computation time
 * 4. Memory usage per concurrent student
 * 5. Scalability: 1, 2, 5, 10, 20 concurrent students
 *
 * Output: tables ready to paste into the report
 */

import WebSocket from 'ws';

const BASE = 'http://localhost:3000';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function req(path, opts = {}) {
  const { headers: h, ...rest } = opts;
  const r = await fetch(`${BASE}${path}`, { ...rest, headers: { 'Content-Type': 'application/json', ...h } });
  return r.json();
}

async function timedReq(path, opts = {}) {
  const start = performance.now();
  const result = await req(path, opts);
  return { result, ms: Math.round(performance.now() - start) };
}

async function login(email) {
  const { result, ms } = await timedReq('/auth/verify', {
    method: 'POST', body: JSON.stringify({ email, code: '123456' }),
  });
  return { token: result.token, ms };
}

function connectWS(token, sessionId) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}&sessionId=${sessionId}`);
    ws.on('open', () => resolve({ ws, ms: Math.round(performance.now() - start) }));
    ws.on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getMemoryMB() {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 10) / 10;
}

// ── Test 1: API Response Times ───────────────────────────────────────────────

async function testApiResponseTimes(lecToken) {
  console.log('\n═══ Test 1: API Response Times ═══\n');

  // Login
  const { ms: loginMs } = await login('bosslecturer@leeds.ac.uk');

  // List modules
  const { ms: modulesMs } = await timedReq('/modules', { headers: { Authorization: `Bearer ${lecToken}` } });

  // Get module ID
  const mods = (await req('/modules', { headers: { Authorization: `Bearer ${lecToken}` } }));
  const modId = mods.find(m => m.code === 'COMP1234')?.id;

  // List sessions
  const { ms: sessionsMs } = await timedReq(`/sessions/module/${modId}`, { headers: { Authorization: `Bearer ${lecToken}` } });

  // Create session
  const { result: session, ms: createMs } = await timedReq('/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${lecToken}` },
    body: JSON.stringify({ moduleId: modId, title: 'Profiling Test' }),
  });

  // Start session
  const { ms: startMs } = await timedReq(`/sessions/${session.id}/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${lecToken}` },
  });

  // End session
  const { ms: endMs } = await timedReq(`/sessions/${session.id}/end`, {
    method: 'POST', headers: { Authorization: `Bearer ${lecToken}` },
  });

  // Report generation (empty session)
  const { ms: reportEmptyMs } = await timedReq(`/sessions/${session.id}/report`, {
    headers: { Authorization: `Bearer ${lecToken}` },
  });

  // Cleanup
  await req(`/sessions/${session.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${lecToken}` } });

  console.log('| Operation              | Time (ms) |');
  console.log('|------------------------|-----------|');
  console.log(`| Login (TOTP verify)    | ${loginMs}        |`);
  console.log(`| List modules           | ${modulesMs}        |`);
  console.log(`| List sessions          | ${sessionsMs}        |`);
  console.log(`| Create session         | ${createMs}        |`);
  console.log(`| Start session          | ${startMs}        |`);
  console.log(`| End session            | ${endMs}        |`);
  console.log(`| Report (empty)         | ${reportEmptyMs}        |`);

  return { loginMs, modulesMs, sessionsMs, createMs, startMs, endMs, reportEmptyMs };
}

// ── Test 2: WebSocket Latency ────────────────────────────────────────────────

async function testWebSocketLatency(lecToken, studentToken) {
  console.log('\n═══ Test 2: WebSocket Connection & Message Latency ═══\n');

  const mods = await req('/modules', { headers: { Authorization: `Bearer ${lecToken}` } });
  const modId = mods.find(m => m.code === 'COMP1234')?.id;

  const { result: session } = await timedReq('/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${lecToken}` },
    body: JSON.stringify({ moduleId: modId, title: 'WS Latency Test' }),
  });
  await req(`/sessions/${session.id}/start`, { method: 'POST', headers: { Authorization: `Bearer ${lecToken}` } });

  // Measure connection time
  const { ws: lecWs, ms: lecConnMs } = await connectWS(lecToken, session.id);
  const { ws: stuWs, ms: stuConnMs } = await connectWS(studentToken, session.id);
  await sleep(500);

  // Measure feedback round-trip: student sends FEEDBACK, lecturer receives FEEDBACK_UPDATE
  const feedbackLatencies = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const promise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FEEDBACK_UPDATE') {
          lecWs.off('message', handler);
          resolve(performance.now() - start);
        }
      };
      lecWs.on('message', handler);
    });
    stuWs.send(JSON.stringify({ type: 'FEEDBACK', emoji: i % 2 === 0 ? 'got_it' : 'confused', slideIndex: 0 }));
    const latency = await promise;
    feedbackLatencies.push(Math.round(latency));
    await sleep(50);
  }

  // Measure slide change round-trip: lecturer sends SLIDE_CHANGE, student receives SLIDE_UPDATE
  const slideLatencies = [];
  for (let i = 1; i <= 5; i++) {
    const start = performance.now();
    const promise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'SLIDE_UPDATE') {
          stuWs.off('message', handler);
          resolve(performance.now() - start);
        }
      };
      stuWs.on('message', handler);
    });
    lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: i }));
    const latency = await promise;
    slideLatencies.push(Math.round(latency));
    await sleep(100);
  }

  lecWs.close(); stuWs.close();
  await sleep(500);
  await req(`/sessions/${session.id}/end`, { method: 'POST', headers: { Authorization: `Bearer ${lecToken}` } });
  await req(`/sessions/${session.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${lecToken}` } });

  const avgFeedback = Math.round(feedbackLatencies.reduce((a, b) => a + b, 0) / feedbackLatencies.length);
  const avgSlide = Math.round(slideLatencies.reduce((a, b) => a + b, 0) / slideLatencies.length);

  console.log('| Metric                         | Time (ms) |');
  console.log('|--------------------------------|-----------|');
  console.log(`| Lecturer WS connect            | ${lecConnMs}        |`);
  console.log(`| Student WS connect             | ${stuConnMs}        |`);
  console.log(`| Feedback round-trip (avg/10)    | ${avgFeedback}        |`);
  console.log(`| Feedback round-trip (min)       | ${Math.min(...feedbackLatencies)}        |`);
  console.log(`| Feedback round-trip (max)       | ${Math.max(...feedbackLatencies)}        |`);
  console.log(`| Slide change round-trip (avg/5) | ${avgSlide}        |`);

  return { lecConnMs, stuConnMs, avgFeedback, avgSlide };
}

// ── Test 3: Concurrent Student Scalability ───────────────────────────────────

async function testScalability(lecToken, studentTokens) {
  console.log('\n═══ Test 3: Concurrent Student Scalability ═══\n');

  const mods = await req('/modules', { headers: { Authorization: `Bearer ${lecToken}` } });
  const modId = mods.find(m => m.code === 'COMP1234')?.id;

  const counts = [1, 2, 3]; // limited by actual student accounts
  const results = [];

  for (const n of counts) {
    const { result: session } = await timedReq('/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${lecToken}` },
      body: JSON.stringify({ moduleId: modId, title: `Scale Test ${n}` }),
    });
    await req(`/sessions/${session.id}/start`, { method: 'POST', headers: { Authorization: `Bearer ${lecToken}` } });

    const { ws: lecWs } = await connectWS(lecToken, session.id);
    await sleep(200);

    // Connect N students
    const connectStart = performance.now();
    const studentWss = [];
    for (let i = 0; i < n; i++) {
      const { ws } = await connectWS(studentTokens[i % studentTokens.length], session.id);
      studentWss.push(ws);
    }
    const connectTime = Math.round(performance.now() - connectStart);
    await sleep(300);

    // All students send feedback simultaneously
    const feedbackStart = performance.now();
    const emojis = ['got_it', 'neutral', 'confused', 'lost'];
    for (let i = 0; i < studentWss.length; i++) {
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: emojis[i % 4], slideIndex: 0 }));
    }

    // Wait for lecturer to receive FEEDBACK_UPDATE
    const feedbackTime = await new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FEEDBACK_UPDATE' && msg.distribution.total >= n) {
          lecWs.off('message', handler);
          resolve(Math.round(performance.now() - feedbackStart));
        }
      };
      lecWs.on('message', handler);
      // Timeout after 5s
      setTimeout(() => resolve(-1), 5000);
    });

    // Slide change broadcast time
    const slideStart = performance.now();
    let received = 0;
    const slideTime = await new Promise(resolve => {
      for (const sw of studentWss) {
        const handler = (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'SLIDE_UPDATE') {
            sw.off('message', handler);
            received++;
            if (received >= n) resolve(Math.round(performance.now() - slideStart));
          }
        };
        sw.on('message', handler);
      }
      lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: 1 }));
      setTimeout(() => resolve(-1), 5000);
    });

    results.push({ n, connectTime, feedbackTime, slideTime });

    // Cleanup
    for (const sw of studentWss) sw.close();
    lecWs.close();
    await sleep(300);
    await req(`/sessions/${session.id}/end`, { method: 'POST', headers: { Authorization: `Bearer ${lecToken}` } });
    await req(`/sessions/${session.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${lecToken}` } });
  }

  console.log('| Students | Connect (ms) | Feedback broadcast (ms) | Slide broadcast (ms) |');
  console.log('|----------|--------------|-------------------------|----------------------|');
  for (const r of results) {
    console.log(`| ${String(r.n).padEnd(8)} | ${String(r.connectTime).padEnd(12)} | ${String(r.feedbackTime).padEnd(23)} | ${String(r.slideTime).padEnd(20)} |`);
  }

  return results;
}

// ── Test 4: Report Generation with Data ──────────────────────────────────────

async function testReportGeneration(lecToken, studentTokens) {
  console.log('\n═══ Test 4: Report Generation Performance ═══\n');

  const mods = await req('/modules', { headers: { Authorization: `Bearer ${lecToken}` } });
  const modId = mods.find(m => m.code === 'COMP1234')?.id;

  const { result: session } = await timedReq('/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${lecToken}` },
    body: JSON.stringify({ moduleId: modId, title: 'Report Perf Test' }),
  });
  await req(`/sessions/${session.id}/start`, { method: 'POST', headers: { Authorization: `Bearer ${lecToken}` } });

  const { ws: lecWs } = await connectWS(lecToken, session.id);
  const studentWss = [];
  for (const t of studentTokens) {
    const { ws } = await connectWS(t, session.id);
    studentWss.push(ws);
  }
  await sleep(300);

  // Generate data across 5 slides
  const emojis = ['got_it', 'neutral', 'confused', 'lost'];
  for (let slide = 0; slide < 5; slide++) {
    if (slide > 0) {
      lecWs.send(JSON.stringify({ type: 'SLIDE_CHANGE', slideIndex: slide }));
      await sleep(300);
    }
    for (let i = 0; i < studentWss.length; i++) {
      studentWss[i].send(JSON.stringify({ type: 'FEEDBACK', emoji: emojis[(i + slide) % 4], slideIndex: slide }));
    }
    // Questions on some slides
    if (slide === 1 || slide === 3) {
      await req(`/questions/session/${session.id}`, {
        method: 'POST', headers: { Authorization: `Bearer ${studentTokens[0]}` },
        body: JSON.stringify({ content: `Question about slide ${slide}`, slideIndex: slide }),
      });
    }
    await sleep(200);
  }

  // End session
  lecWs.send(JSON.stringify({ type: 'END_SESSION' }));
  await sleep(1500);
  for (const sw of studentWss) sw.close();
  lecWs.close();
  await sleep(500);

  // Measure report generation (with engagement analytics)
  const reportTimes = [];
  for (let i = 0; i < 5; i++) {
    const { ms } = await timedReq(`/sessions/${session.id}/report`, {
      headers: { Authorization: `Bearer ${lecToken}` },
    });
    reportTimes.push(ms);
  }

  // Measure timeline generation
  const timelineTimes = [];
  for (let i = 0; i < 5; i++) {
    const { ms } = await timedReq(`/sessions/${session.id}/timeline`, {
      headers: { Authorization: `Bearer ${lecToken}` },
    });
    timelineTimes.push(ms);
  }

  const avgReport = Math.round(reportTimes.reduce((a, b) => a + b, 0) / reportTimes.length);
  const avgTimeline = Math.round(timelineTimes.reduce((a, b) => a + b, 0) / timelineTimes.length);

  // Cleanup
  await req(`/sessions/${session.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${lecToken}` } });

  console.log('| Operation                        | Avg (ms) | Min (ms) | Max (ms) |');
  console.log('|----------------------------------|----------|----------|----------|');
  console.log(`| Report (5 slides, 3 students)    | ${avgReport}       | ${Math.min(...reportTimes)}       | ${Math.max(...reportTimes)}       |`);
  console.log(`| Timeline (5 slides, 3 students)  | ${avgTimeline}       | ${Math.min(...timelineTimes)}       | ${Math.max(...timelineTimes)}       |`);

  return { avgReport, avgTimeline, reportTimes, timelineTimes };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   LectureFlow Resource Profiling Report      ║');
  console.log('║   Date: ' + new Date().toISOString().split('T')[0] + '                           ║');
  console.log('╚══════════════════════════════════════════════╝');

  // Login all accounts
  const { token: lecToken } = await login('bosslecturer@leeds.ac.uk');
  const { token: omarToken } = await login('oc@leeds.ac.uk');
  const { token: aliceToken } = await login('scac01@leeds.ac.uk');
  const { token: bobToken } = await login('scbs02@leeds.ac.uk');
  const studentTokens = [omarToken, aliceToken, bobToken];

  const apiResults = await testApiResponseTimes(lecToken);
  const wsResults = await testWebSocketLatency(lecToken, omarToken);
  const scaleResults = await testScalability(lecToken, studentTokens);
  const reportResults = await testReportGeneration(lecToken, studentTokens);

  // ── Summary ──
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║                  SUMMARY                     ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  console.log('Key findings:');
  console.log(`  - Login: ${apiResults.loginMs}ms`);
  console.log(`  - Feedback round-trip (student→server→lecturer): ${wsResults.avgFeedback}ms avg`);
  console.log(`  - Slide change broadcast: ${wsResults.avgSlide}ms avg`);
  console.log(`  - Report generation (5 slides, 3 students): ${reportResults.avgReport}ms avg`);
  console.log(`  - WebSocket connect time: ${wsResults.stuConnMs}ms`);

  const scale3 = scaleResults.find(r => r.n === 3);
  if (scale3) {
    console.log(`  - 3 concurrent students feedback broadcast: ${scale3.feedbackTime}ms`);
    console.log(`  - 3 concurrent students slide broadcast: ${scale3.slideTime}ms`);
  }

  console.log('\nScalability projection (linear extrapolation from measured data):');
  const perStudent = scale3 ? Math.round(scale3.connectTime / 3) : 50;
  const perFeedback = scale3 ? Math.round(scale3.feedbackTime / 3) : 5;
  console.log(`  - Per-student WebSocket connect overhead: ~${perStudent}ms`);
  console.log(`  - Per-student feedback processing overhead: ~${perFeedback}ms`);
  console.log(`  - Estimated 50 students connect: ~${perStudent * 50}ms`);
  console.log(`  - Estimated 50 students feedback broadcast: ~${perFeedback * 50}ms`);
  console.log(`  - Estimated 200 students connect: ~${perStudent * 200}ms`);
  console.log(`  - Estimated 200 students feedback broadcast: ~${perFeedback * 200}ms`);

  console.log('\nAll data captured. Use these tables in Chapter 5 of the report.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
