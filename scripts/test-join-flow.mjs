/**
 * End-to-end test for the anonymous join flow.
 *
 * Seeds a module + live session directly via SQL (so we don't need an admin TOTP),
 * then uses Playwright to navigate to /join/:sessionId as a fresh browser session
 * and asserts that the user ends up on the student session page, logged in as
 * a freshly-created guest student.
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
  process.stdout.write(`  ${name.padEnd(60, '.')} `);
  try {
    await fn();
    console.log('PASS');
    return true;
  } catch (e) {
    console.log(`FAIL\n    → ${e.message}`);
    return false;
  }
}

async function seedLiveSession() {
  // Find a lecturer to own the module
  const lectRes = await pool.query("SELECT id FROM users WHERE role = 'lecturer' LIMIT 1");
  if (lectRes.rows.length === 0) throw new Error('No lecturer in DB to own test module');
  const lecturerId = lectRes.rows[0].id;

  const uniq = Date.now();
  const modRes = await pool.query(
    `INSERT INTO modules (code, name, lecturer_id) VALUES ($1, $2, $3) RETURNING id`,
    [`TEST${uniq}`, `Join Test Module ${uniq}`, lecturerId],
  );
  const moduleId = modRes.rows[0].id;

  const sessRes = await pool.query(
    `INSERT INTO sessions (module_id, title, status, total_slides) VALUES ($1, $2, 'live', 0) RETURNING id`,
    [moduleId, `Join test session ${uniq}`],
  );
  return { sessionId: sessRes.rows[0].id, moduleId };
}

async function cleanupSession({ sessionId, moduleId }) {
  // session_participants has no CASCADE on session_id, so clear it first.
  // Same for the other per-session tables that would block the session delete.
  await pool.query('DELETE FROM session_participants WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM feedback_events WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM slide_timings WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  await pool.query('DELETE FROM module_enrollments WHERE module_id = $1', [moduleId]);
  await pool.query('DELETE FROM modules WHERE id = $1', [moduleId]);
}

async function countGuestUsers() {
  const r = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE email LIKE 'guest-%@leeds.ac.uk'");
  return r.rows[0].n;
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  // Test 1 — join a live session via the name+year form creates a new user and navigates
  results.push(await runTest('join form → session page, new guest created', async () => {
    const seeded = await seedLiveSession();
    const guestsBefore = await countGuestUsers();
    try {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}/join/${seeded.sessionId}`);
      // Fill the form and submit
      await page.locator('input#first-name').fill('Alice');
      await page.locator('button:has-text("Y2")').click();
      await page.locator('button:has-text("Join session")').click();
      await page.waitForURL(new RegExp(`/student/session/${seeded.sessionId}`), { timeout: 10000 });
      const token = await page.evaluate(() => localStorage.getItem('token'));
      if (!token) throw new Error('no JWT set after join');
      // Verify the user name embeds the year (used for the report)
      const newName = (await pool.query(`SELECT name FROM users WHERE email LIKE 'guest-%' ORDER BY created_at DESC LIMIT 1`)).rows[0]?.name;
      if (!newName?.includes('(Y2)')) throw new Error(`expected name to include (Y2), got ${newName}`);
      if (!newName?.includes('Alice')) throw new Error(`expected name to include Alice, got ${newName}`);
      const guestsAfter = await countGuestUsers();
      if (guestsAfter !== guestsBefore + 1) throw new Error(`expected guest count +1, got before=${guestsBefore} after=${guestsAfter}`);
      await ctx.close();
    } finally {
      await cleanupSession(seeded);
    }
  }));

  async function joinAs(page, sessionId, name, year) {
    await page.goto(`${BASE}/join/${sessionId}`);
    await page.locator('input#first-name').fill(name);
    await page.locator(`button:has-text("Y${year}")`).click();
    await page.locator('button:has-text("Join session")').click();
  }

  // Test 2 — nonexistent session shows friendly error, no user created
  results.push(await runTest('join invalid session → error, no user created', async () => {
    const guestsBefore = await countGuestUsers();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await joinAs(page, 'deadbeef-dead-dead-dead-deaddeaddead', 'Bob', 1);
    await page.locator('text=/session not found/i').first().waitFor({ timeout: 8000 });
    const guestsAfter = await countGuestUsers();
    if (guestsAfter !== guestsBefore) throw new Error('unexpected guest user created');
    await ctx.close();
  }));

  // Test 3 — ended session returns the friendly "already ended" error
  results.push(await runTest('join ended session → "already ended" error', async () => {
    const seeded = await seedLiveSession();
    await pool.query("UPDATE sessions SET status = 'ended' WHERE id = $1", [seeded.sessionId]);
    try {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await joinAs(page, seeded.sessionId, 'Carol', 3);
      await page.locator('text=/ended/i').first().waitFor({ timeout: 8000 });
      await ctx.close();
    } finally {
      await cleanupSession(seeded);
    }
  }));

  // Test 4 — two participants get distinct accounts
  results.push(await runTest('two joins → two distinct guest accounts', async () => {
    const seeded = await seedLiveSession();
    try {
      const ctx1 = await browser.newContext();
      const page1 = await ctx1.newPage();
      await joinAs(page1, seeded.sessionId, 'Dave', 1);
      await page1.waitForURL(/\/student\/session\//, { timeout: 15000 });
      const token1 = await page1.evaluate(() => localStorage.getItem('token'));
      await ctx1.close();

      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();
      await joinAs(page2, seeded.sessionId, 'Eve', 4);
      await page2.waitForURL(/\/student\/session\//, { timeout: 15000 });
      const token2 = await page2.evaluate(() => localStorage.getItem('token'));
      await ctx2.close();

      if (token1 === token2) throw new Error('same token for two browsers');
    } finally {
      await cleanupSession(seeded);
    }
  }));
} finally {
  await browser.close();
  await pool.end();
}

const passed = results.filter(Boolean).length;
const total = results.length;
console.log('');
console.log(`${passed}/${total} tests passed`);
process.exit(passed === total ? 0 : 1);
