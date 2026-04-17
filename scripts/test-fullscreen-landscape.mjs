/**
 * Regression test for the "stuck after fullscreen exit" bug.
 *
 *  Flow: enter fullscreen → open panel (should be hidden while in fullscreen)
 *        → exit fullscreen → panel is closed AND slide takes full height
 */
import { chromium, devices } from 'playwright';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiPkg = resolve(__dirname, '..', 'apps', 'api', 'package.json');
const require = createRequire(pathToFileURL(apiPkg));
const { Pool } = require('pg');

const BASE = 'http://localhost:5173';
const pool = new Pool({ connectionString: 'postgresql://postgres:1234@localhost:5432/lecture_feedback' });

async function seed() {
  const lect = await pool.query("SELECT id FROM users WHERE role = 'lecturer' LIMIT 1");
  const uniq = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
  const mod = await pool.query(`INSERT INTO modules (code, name, lecturer_id) VALUES ($1,$2,$3) RETURNING id`, [`FSX${uniq}`, 'fsx', lect.rows[0].id]);
  const sess = await pool.query(`INSERT INTO sessions (module_id, title, status, total_slides) VALUES ($1, 'fs test', 'live', 5) RETURNING id`, [mod.rows[0].id]);
  return { sessionId: sess.rows[0].id, moduleId: mod.rows[0].id };
}
async function cleanup({ sessionId, moduleId }) {
  await pool.query('DELETE FROM session_participants WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM feedback_events WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM slide_timings WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  await pool.query('DELETE FROM module_enrollments WHERE module_id = $1', [moduleId]);
  await pool.query('DELETE FROM modules WHERE id = $1', [moduleId]);
}

async function runTest(name, fn) {
  process.stdout.write(`  ${name.padEnd(70, '.')} `);
  try { await fn(); console.log('PASS'); return true; }
  catch (e) { console.log(`FAIL\n    → ${e.message}`); return false; }
}

const s = await seed();
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const iPhone = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...iPhone });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/join/${s.sessionId}`);
  await page.locator('input#first-name').fill('FS');
  await page.locator('button:has-text("Y2")').click();
  await page.locator('button:has-text("Join session")').click();
  await page.waitForURL(/\/student\/session\//, { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Open the panel via the Feedback tab (pick the mobile tab by filtering to
  // buttons at min-height 44+, which filters out the desktop toolbar button)
  const feedbackTabs = page.locator('button:has-text("Feedback")');
  const count = await feedbackTabs.count();
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const el = feedbackTabs.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error('no visible Feedback tab');
  await page.waitForTimeout(500);

  results.push(await runTest('panel visible in non-fullscreen', async () => {
    const visible = await page.locator('button:has-text("Got it")').first().isVisible();
    if (!visible) throw new Error('feedback panel not visible');
  }));

  // Enter fullscreen mode via the UI button — we set focusMode, even if real
  // fullscreen API rejects (which it will in headless)
  await page.locator('button[title*="Fullscreen"]').first().click();
  await page.waitForTimeout(600);

  results.push(await runTest('panel is hidden while in fullscreen (focusMode)', async () => {
    const gotItVisible = await page.locator('button:has-text("Got it")').first().isVisible().catch(() => false);
    if (gotItVisible) throw new Error('emoji button still visible in fullscreen — panel not hidden');
  }));

  // Now exit fullscreen via the floating button (target the aria-label exactly)
  await page.locator('button[aria-label="Exit fullscreen"]').click();
  await page.waitForTimeout(600);

  results.push(await runTest('after exit, panel is closed (showPanel=false)', async () => {
    // Panel container collapses to h-0 when closed. Read the bounding box to
    // confirm the content is effectively hidden.
    await page.waitForTimeout(800);
    const gotItBox = await page.locator('button:has-text("Got it")').first().boundingBox().catch(() => null);
    const panelHeight = gotItBox?.height ?? 0;
    // When closed, any rendered child button would still have some pixel height
    // but its parent clips to 0. Check if button's top is within viewport.
    const state = await page.evaluate(() => {
      const target = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Got it');
      if (!target) return { exists: false };
      const rect = target.getBoundingClientRect();
      return { exists: true, top: rect.top, height: rect.height, visibleInViewport: rect.top < window.innerHeight && rect.bottom > 0 };
    });
    if (state.exists && state.visibleInViewport) {
      throw new Error(`panel still visible after exit: ${JSON.stringify(state)} box=${JSON.stringify(gotItBox)} panelHeight=${panelHeight}`);
    }
  }));

  results.push(await runTest('after exit, slide area is full-height (Feedback tab button visible)', async () => {
    // Tab bar should be visible (not hidden by focusMode anymore)
    const feedbackTab = await page.locator('button:has-text("Feedback")').first().isVisible();
    if (!feedbackTab) throw new Error('tab bar not visible after fullscreen exit');
  }));

  results.push(await runTest('can reopen panel after exit', async () => {
    await page.locator('button:has-text("Feedback")').first().click();
    await page.waitForTimeout(400);
    const visible = await page.locator('button:has-text("Got it")').first().isVisible();
    if (!visible) throw new Error('could not reopen panel after exit');
  }));

  await ctx.close();
} finally {
  await browser.close();
  await cleanup(s);
  await pool.end();
}

const passed = results.filter(Boolean).length;
const total = results.length;
console.log('');
console.log(`${passed}/${total} tests passed`);
process.exit(passed === total ? 0 : 1);
