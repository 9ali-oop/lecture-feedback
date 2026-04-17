// Dedicated landscape screenshots without the fullscreen state confusion.
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
const lect = await pool.query("SELECT id FROM users WHERE role = 'lecturer' LIMIT 1");
const uniq = Date.now();
const mod = await pool.query(`INSERT INTO modules (code, name, lecturer_id) VALUES ($1,$2,$3) RETURNING id`, [`L${uniq}`, 'l', lect.rows[0].id]);
const sess = await pool.query(`INSERT INTO sessions (module_id, title, status, total_slides) VALUES ($1, 'landscape test', 'live', 5) RETURNING id`, [mod.rows[0].id]);
const sessionId = sess.rows[0].id;

const browser = await chromium.launch({ headless: true });
try {
  const iPhone = devices['iPhone 13'];
  // Start directly in landscape
  const ctx = await browser.newContext({
    ...iPhone,
    viewport: { width: iPhone.viewport.height, height: iPhone.viewport.width },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/join/${sessionId}`);
  await page.locator('input#first-name').fill('LandscapeTester');
  await page.locator('button:has-text("Y2")').click();
  await page.locator('button:has-text("Join session")').click();
  await page.waitForURL(/\/student\/session\//, { timeout: 15000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: 'C:/Users/ali26/Documents/FYP-Project/mobile-audit/L1-landscape-closed.png' });
  console.log('L1 landscape, panel closed');

  // Open Feedback panel in landscape
  await page.locator('div.flex.md\\:hidden button:has-text("Feedback")').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/ali26/Documents/FYP-Project/mobile-audit/L2-landscape-feedback.png' });
  console.log('L2 landscape, feedback open');

  // Open Q&A
  await page.locator('div.flex.md\\:hidden button:has-text("Q&A")').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/ali26/Documents/FYP-Project/mobile-audit/L3-landscape-qa.png' });
  console.log('L3 landscape, Q&A open');

  await ctx.close();
} finally {
  await browser.close();
  await pool.query('DELETE FROM session_participants WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM feedback_events WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM slide_timings WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM polls WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  await pool.query('DELETE FROM module_enrollments WHERE module_id = $1', [mod.rows[0].id]);
  await pool.query('DELETE FROM modules WHERE id = $1', [mod.rows[0].id]);
  await pool.end();
}
