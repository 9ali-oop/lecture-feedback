/**
 * End-to-end test for the session-scoped identity persistence rules.
 *
 * Covers the exact cases Ali complained about:
 *   T1 – Fresh join → form shown, submits → lands in session
 *   T2 – Same browser refreshes session page → stays in session (no re-prompt)
 *   T3 – Same browser visits a DIFFERENT session → form shown (carryover prevented)
 *   T4 – Incognito-equivalent (fresh context) hits /student/session/:id directly
 *        → redirects to /join/:id (not to /login)
 *   T5 – ?new=1 on the join URL forces the form even if the joined-flag is set
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiPkg = resolve(__dirname, '..', 'apps', 'api', 'package.json');
const require = createRequire(pathToFileURL(apiPkg));
const { Pool } = require('pg');

const BASE = 'http://localhost:5173';
const pool = new Pool({ connectionString: 'postgresql://postgres:1234@localhost:5432/lecture_feedback' });

async function runTest(name, fn) {
  process.stdout.write(`  ${name.padEnd(72, '.')} `);
  try {
    await fn();
    console.log('PASS');
    return true;
  } catch (e) {
    console.log(`FAIL\n    → ${e.message}`);
    return false;
  }
}

async function seedLiveSession(title = 'p') {
  const lect = await pool.query("SELECT id FROM users WHERE role = 'lecturer' LIMIT 1");
  const uniq = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
  const mod = await pool.query(`INSERT INTO modules (code, name, lecturer_id) VALUES ($1,$2,$3) RETURNING id`, [`M${uniq}`, `m-${uniq}`, lect.rows[0].id]);
  const sess = await pool.query(`INSERT INTO sessions (module_id, title, status, total_slides) VALUES ($1, $2, 'live', 5) RETURNING id`, [mod.rows[0].id, title]);
  return { sessionId: sess.rows[0].id, moduleId: mod.rows[0].id };
}
async function cleanup({ sessionId, moduleId }) {
  await pool.query('DELETE FROM session_participants WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM feedback_events WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM slide_timings WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM polls WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  await pool.query('DELETE FROM module_enrollments WHERE module_id = $1', [moduleId]);
  await pool.query('DELETE FROM modules WHERE id = $1', [moduleId]);
}

async function fillJoinForm(page, name, year) {
  await page.locator('input#first-name').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('input#first-name').fill(name);
  await page.locator(`button:has-text("Y${year}")`).click();
  await page.locator('button:has-text("Join session")').click();
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  // -- T1 & T2: same browser, same session — form once then straight in on refresh --
  const s1 = await seedLiveSession('session-one');
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();

  results.push(await runTest('T1: fresh browser on /join/:id shows form, submits into session', async () => {
    await page1.goto(`${BASE}/join/${s1.sessionId}`);
    await fillJoinForm(page1, 'Alice', '2');
    await page1.waitForURL(new RegExp(`/student/session/${s1.sessionId}`), { timeout: 15000 });
    const token = await page1.evaluate(() => localStorage.getItem('token'));
    if (!token) throw new Error('no token set');
    const flag = await page1.evaluate((id) => localStorage.getItem(`lf.joined.${id}`), s1.sessionId);
    if (flag !== '1') throw new Error('joined flag not set');
  }));

  results.push(await runTest('T2: refresh on session page stays in session (no re-prompt)', async () => {
    await page1.reload();
    await page1.waitForURL(new RegExp(`/student/session/${s1.sessionId}`), { timeout: 10000 });
  }));

  results.push(await runTest('T2b: revisit /join/:id with existing token → skips form, routes to session', async () => {
    const beforeGoto = await page1.evaluate((id) => ({
      url: location.pathname,
      token: localStorage.getItem('token') ? 'yes' : 'no',
      flag: localStorage.getItem(`lf.joined.${id}`),
    }), s1.sessionId);
    const logs = [];
    page1.on('console', (m) => { if (m.type() === 'debug' || m.text().includes('[Join]')) logs.push(m.text()); });
    await page1.goto(`${BASE}/join/${s1.sessionId}`);
    await page1.waitForTimeout(3000);
    const after = await page1.evaluate((id) => ({
      url: location.pathname,
      token: localStorage.getItem('token') ? 'yes' : 'no',
      flag: localStorage.getItem(`lf.joined.${id}`),
    }), s1.sessionId);
    if (after.url.startsWith('/student/session/')) return;
    throw new Error(`before=${JSON.stringify(beforeGoto)} after=${JSON.stringify(after)} logs=${JSON.stringify(logs)}`);
  }));

  // -- T3: same browser, visits a DIFFERENT session → form appears again --
  const s2 = await seedLiveSession('session-two');
  results.push(await runTest('T3: same browser visits different session → form re-shown', async () => {
    await page1.goto(`${BASE}/join/${s2.sessionId}`);
    // The form's first-name input should appear (meaning old token was cleared)
    await page1.locator('input#first-name').waitFor({ state: 'visible', timeout: 8000 });
    // Confirm token was cleared when visiting the different session
    const token = await page1.evaluate(() => localStorage.getItem('token'));
    if (token !== null) throw new Error('stale token was not cleared for the new session');
  }));

  // Finish joining session 2
  results.push(await runTest('T3b: can join that different session with new name/year', async () => {
    await fillJoinForm(page1, 'AliceAgain', '3');
    await page1.waitForURL(new RegExp(`/student/session/${s2.sessionId}`), { timeout: 15000 });
  }));

  await ctx1.close();

  // -- T4: fresh incognito context hits /student/session/:id directly → redirect to /join/:id --
  const ctx4 = await browser.newContext();
  const page4 = await ctx4.newPage();
  results.push(await runTest('T4: /student/session/:id without auth → /join/:id (not /login)', async () => {
    await page4.goto(`${BASE}/student/session/${s1.sessionId}`);
    await page4.waitForURL(new RegExp(`/join/${s1.sessionId}`), { timeout: 10000 });
    await page4.locator('input#first-name').waitFor({ state: 'visible', timeout: 5000 });
  }));
  await ctx4.close();

  // -- T6: mid-session join — session is live, has prior participants + advanced slide --
  const sMid = await seedLiveSession('mid-session');
  // Simulate that some activity has already happened in this session:
  //   - advance the current slide
  //   - have an existing student enrolled + participating
  await pool.query('UPDATE sessions SET current_slide_index = 3, started_at = now() WHERE id = $1', [sMid.sessionId]);
  const lect = await pool.query("SELECT id FROM users WHERE role = 'lecturer' LIMIT 1");
  void lect;
  // Seed an existing student + enrolment so the DB isn't empty when the new student joins
  const existing = await pool.query(
    `INSERT INTO users (email, name, role, totp_secret) VALUES ($1,$2,'student',$3) RETURNING id`,
    [`priormid-${Date.now()}@leeds.ac.uk`, 'Prior (Y2)', 'x']
  );
  await pool.query(`INSERT INTO student_profiles (user_id, student_number) VALUES ($1,$2)`, [existing.rows[0].id, `s${Date.now()}`]);
  await pool.query(`INSERT INTO module_enrollments (student_id, module_id) VALUES ($1,$2)`, [existing.rows[0].id, sMid.moduleId]);
  await pool.query(`INSERT INTO session_participants (session_id, student_id) VALUES ($1,$2)`, [sMid.sessionId, existing.rows[0].id]);

  results.push(await runTest('T6: joining a live session mid-way lands in the session, no "ended" error', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/join/${sMid.sessionId}`);
    await fillJoinForm(page, 'LateJoiner', '4');
    await page.waitForURL(new RegExp(`/student/session/${sMid.sessionId}`), { timeout: 15000 });
    // Should NOT see the "session has ended" or error text
    await page.waitForTimeout(800);
    const body = (await page.locator('body').textContent()) ?? '';
    if (/session has ended|already ended/i.test(body)) {
      throw new Error('saw "session has ended" text on a live session');
    }
    // The Leave button in the live-session top bar is a reliable "we're in" marker
    const leave = await page.locator('button:has-text("Leave")').first().isVisible().catch(() => false);
    if (!leave) throw new Error('did not reach live session UI (no Leave button)');
    await ctx.close();
  }));

  // Clean up the prior participant rows so cleanup() later doesn't trip over them
  await pool.query('DELETE FROM session_participants WHERE student_id = $1', [existing.rows[0].id]);
  await pool.query('DELETE FROM module_enrollments WHERE student_id = $1', [existing.rows[0].id]);
  await pool.query('DELETE FROM student_profiles WHERE user_id = $1', [existing.rows[0].id]);
  await pool.query('DELETE FROM users WHERE id = $1', [existing.rows[0].id]);
  await cleanup(sMid);

  // -- T5: ?new=1 forces the form even when flagged --
  const ctx5 = await browser.newContext();
  const page5 = await ctx5.newPage();
  await page5.goto(`${BASE}/join/${s1.sessionId}`);
  await fillJoinForm(page5, 'Bob', '1');
  await page5.waitForURL(new RegExp(`/student/session/${s1.sessionId}`), { timeout: 15000 });

  results.push(await runTest('T5: ?new=1 wipes identity and re-shows form', async () => {
    await page5.goto(`${BASE}/join/${s1.sessionId}?new=1`);
    await page5.locator('input#first-name').waitFor({ state: 'visible', timeout: 8000 });
    const token = await page5.evaluate(() => localStorage.getItem('token'));
    if (token) throw new Error('token not cleared after ?new=1');
  }));
  await ctx5.close();

  await cleanup(s1);
  await cleanup(s2);
} finally {
  await browser.close();
  await pool.end();
}

const passed = results.filter(Boolean).length;
const total = results.length;
console.log('');
console.log(`${passed}/${total} tests passed`);
process.exit(passed === total ? 0 : 1);
