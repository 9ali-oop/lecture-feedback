/**
 * Mobile UX audit — takes screenshots of every important state on an iPhone viewport.
 * Seeds a live session + uploads a small PDF, joins as a guest, and captures:
 *   01  join form (portrait)
 *   02  session portrait (feedback panel closed)
 *   03  feedback panel open (portrait)
 *   04  Q&A panel open (portrait)
 *   05  Q&A after typing a question (keyboard simulated by focusing)
 *   06  request-pen form inline (portrait)
 *   07  fullscreen mode (portrait)
 *   08  landscape view
 *   09  landscape with panel open
 *   10  poll overlay (portrait)
 *   11  session ended + reflection form (portrait)
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiPkg = resolve(__dirname, '..', 'apps', 'api', 'package.json');
const require = createRequire(pathToFileURL(apiPkg));
const { Pool } = require('pg');

const BASE = 'http://localhost:5173';
const OUT = 'C:/Users/ali26/Documents/FYP-Project/mobile-audit';
mkdirSync(OUT, { recursive: true });

const pool = new Pool({ connectionString: 'postgresql://postgres:1234@localhost:5432/lecture_feedback' });

async function seed() {
  const lect = await pool.query("SELECT id FROM users WHERE role = 'lecturer' LIMIT 1");
  const uniq = Date.now();
  const mod = await pool.query(`INSERT INTO modules (code, name, lecturer_id) VALUES ($1,$2,$3) RETURNING id`, [`AUDIT${uniq}`, 'audit', lect.rows[0].id]);
  const sess = await pool.query(`INSERT INTO sessions (module_id, title, status, total_slides) VALUES ($1, 'AI in 15 minutes', 'live', 5) RETURNING id`, [mod.rows[0].id]);
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

const seeded = await seed();
const browser = await chromium.launch({ headless: true });
const iPhone = devices['iPhone 13'];

const issues = [];
function log(n, desc) { console.log(`  [${n}] ${desc}`); }

try {
  const ctx = await browser.newContext({ ...iPhone });
  const page = await ctx.newPage();

  // 01 – Join form
  await page.goto(`${BASE}/join/${seeded.sessionId}`);
  await page.waitForSelector('input#first-name');
  await page.screenshot({ path: `${OUT}/01-join-form.png`, fullPage: false });
  log('01', 'join form');

  // Submit join
  await page.locator('input#first-name').fill('Ali');
  await page.locator('button:has-text("Y3")').click();
  await page.locator('button:has-text("Join session")').click();
  await page.waitForURL(/\/student\/session\//, { timeout: 15000 });
  await page.waitForTimeout(1500);

  // 02 – Session portrait (feedback panel closed)
  await page.screenshot({ path: `${OUT}/02-session-closed.png`, fullPage: false });
  log('02', 'session portrait (panel closed)');

  // 03 – Feedback panel open
  const feedbackTab = page.locator('button:has-text("Feedback"):visible').first();
  await feedbackTab.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/03-feedback-open.png`, fullPage: false });
  log('03', 'feedback panel open');

  // Measure key tap targets
  const gotItBox = await page.locator('button:has-text("Got it")').first().boundingBox();
  const paceOkBox = await page.locator('button:has-text("Just right")').first().boundingBox();
  console.log(`      Got it: ${Math.round(gotItBox?.width)}x${Math.round(gotItBox?.height)}`);
  console.log(`      Pace OK: ${Math.round(paceOkBox?.width)}x${Math.round(paceOkBox?.height)}`);

  // Scroll within panel to expose notes
  await page.evaluate(() => {
    const panels = document.querySelectorAll('.overflow-hidden');
    for (const p of panels) p.scrollTop = p.scrollHeight;
  });
  await page.screenshot({ path: `${OUT}/03b-feedback-scrolled.png`, fullPage: false });
  log('03b', 'feedback panel scrolled to bottom');

  // 04 – Q&A panel open
  const qaTab = page.locator('button:has-text("Q&A"):visible').first();
  await qaTab.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/04-qa-open.png`, fullPage: false });
  log('04', 'Q&A open');

  // 05 – Q&A with typed text
  await page.locator('textarea').first().fill('Hey lecturer can you repeat the last bit about attention?');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05-qa-typed.png`, fullPage: false });
  log('05', 'Q&A with typed question');

  // Close panel
  const closeBtn = page.locator('button:has-text("▼"):visible').first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(500);
  }

  // 06 – Request pen modal
  const reqPen = page.locator('button:has-text("Request pen")').first();
  if (await reqPen.isVisible().catch(() => false)) {
    await reqPen.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/06-request-pen.png`, fullPage: false });
    log('06', 'request pen modal');

    const modalTextarea = page.locator('textarea[placeholder*="circle the part"]').first();
    if (await modalTextarea.isVisible().catch(() => false)) {
      const box = await modalTextarea.boundingBox();
      if (box && box.x + box.width > iPhone.viewport.width + 2) {
        issues.push(`Request-pen textarea overflows viewport (x=${box.x}, w=${box.width}, vw=${iPhone.viewport.width})`);
      }
    } else {
      issues.push('Request pen modal did not open');
    }

    await page.locator('button:has-text("Cancel")').first().click().catch(() => {});
    await page.waitForTimeout(300);
  }

  // 07 – Fullscreen mode
  const fullscreenBtn = page.locator('button[title*="Fullscreen"]').first();
  await fullscreenBtn.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/07-fullscreen.png`, fullPage: false });
  log('07', 'fullscreen mode');

  // Exit fullscreen — real browser fullscreen AND focus mode
  await page.evaluate(async () => {
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  }).catch(() => {});
  const exitBtn = page.locator('button[title*="Exit fullscreen"]').first();
  if (await exitBtn.isVisible().catch(() => false)) await exitBtn.click().catch(() => {});
  await page.waitForTimeout(500);

  // 08 – Landscape
  await page.setViewportSize({ width: iPhone.viewport.height, height: iPhone.viewport.width });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/08-landscape.png`, fullPage: false });
  log('08', 'landscape');

  // 09 – Landscape with panel open
  await feedbackTab.click().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/09-landscape-panel.png`, fullPage: false });
  log('09', 'landscape + panel open');

  await ctx.close();
} finally {
  await browser.close();
  await cleanup(seeded);
  await pool.end();
}

console.log('\nScreenshots written to', OUT);
if (issues.length) {
  console.log(`\n${issues.length} issue(s):`);
  for (const i of issues) console.log('  -', i);
}
