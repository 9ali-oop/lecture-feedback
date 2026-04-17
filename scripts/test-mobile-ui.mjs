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
if (lect.rows.length === 0) { console.error('no lecturer'); process.exit(1); }
const uniq = Date.now();
const mod = await pool.query(`INSERT INTO modules (code, name, lecturer_id) VALUES ($1,$2,$3) RETURNING id`, [`M${uniq}`, 'mobile test', lect.rows[0].id]);
const sess = await pool.query(`INSERT INTO sessions (module_id, title, status, total_slides) VALUES ($1, 'mobile', 'live', 5) RETURNING id`, [mod.rows[0].id]);
const sessionId = sess.rows[0].id;

const browser = await chromium.launch({ headless: true });
const iPhone = devices['iPhone 13'];
try {
  const ctx = await browser.newContext({ ...iPhone });
  const page = await ctx.newPage();

  // Join via the anonymous flow
  await page.goto(`${BASE}/join/${sessionId}`);
  await page.waitForURL(new RegExp(`/student/session/${sessionId}`), { timeout: 15000 });

  // Wait for the page to settle
  await page.waitForTimeout(1500);

  // Snapshot the mobile layout
  await page.screenshot({ path: 'C:/Users/ali26/Documents/FYP-Project/mobile-session-portrait.png', fullPage: false });
  console.log('portrait screenshot saved');

  // Check key elements are present
  const feedbackTab = await page.locator('button:has-text("Feedback")').count();
  const qaTab = await page.locator('button:has-text("Q&A")').count();
  const fullscreenBtn = await page.locator('button[title*="Fullscreen"], button[title*="fullscreen"]').count();
  console.log(`Bottom tabs: Feedback=${feedbackTab > 0}, Q&A=${qaTab > 0}`);
  console.log(`Fullscreen button present: ${fullscreenBtn > 0}`);

  // Tap the Feedback tab to open the panel, then scroll to find emoji buttons
  await page.locator('button:has-text("Feedback")').first().click();
  await page.waitForTimeout(500);
  const gotItButton = await page.locator('button:has-text("Got it")').first();
  const gotItVisible = await gotItButton.isVisible().catch(() => false);
  console.log(`"Got it" button visible after opening Feedback: ${gotItVisible}`);
  if (gotItVisible) {
    const box = await gotItButton.boundingBox();
    console.log(`"Got it" tap area: ${box?.width}x${box?.height}px`);
  }

  // Open Q&A tab, check send button size
  await page.locator('button:has-text("Q&A")').first().click();
  await page.waitForTimeout(500);
  const sendBtn = await page.locator('button:has-text("Send question")').first();
  const sendVisible = await sendBtn.isVisible().catch(() => false);
  if (sendVisible) {
    const box = await sendBtn.boundingBox();
    console.log(`"Send question" tap area: ${box?.width}x${box?.height}px`);
  } else {
    console.log('"Send question" not visible');
  }

  await page.screenshot({ path: 'C:/Users/ali26/Documents/FYP-Project/mobile-session-qa.png', fullPage: false });

  // Try landscape
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/ali26/Documents/FYP-Project/mobile-session-landscape.png', fullPage: false });
  console.log('landscape screenshot saved');

  await ctx.close();
} finally {
  await browser.close();
  await pool.query('DELETE FROM session_participants WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  await pool.query('DELETE FROM module_enrollments WHERE module_id = $1', [mod.rows[0].id]);
  await pool.query('DELETE FROM modules WHERE id = $1', [mod.rows[0].id]);
  await pool.end();
}
