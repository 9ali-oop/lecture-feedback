import { chromium } from 'playwright';
const url = process.argv[2];
if (!url) { console.error('usage: node test-tunnel.mjs <url>'); process.exit(1); }
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  console.log(`Step 1: Navigating to ${url}`);
  await page.goto(url, { timeout: 15000 });
  await page.waitForTimeout(1500);
  console.log(`  Initial title: ${await page.title()}`);
  console.log(`  Final URL: ${page.url()}`);

  // Try to click through any splash/continue button
  const continueButton = await page.locator('button:has-text("Continue"), a:has-text("Continue"), button:has-text("continue")').first();
  if (await continueButton.isVisible({ timeout: 500 }).catch(() => false)) {
    console.log('Step 2: Clicking "Continue" splash button...');
    await continueButton.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    console.log(`  Title after continue: ${await page.title()}`);
  } else {
    console.log('Step 2: No splash page detected.');
  }

  // Final check: is LectureFlow actually loaded?
  await page.waitForTimeout(2000);
  const h1 = await page.locator('h1, h2').first().textContent({ timeout: 5000 }).catch(() => null);
  console.log(`  First heading: ${h1}`);
  const hasLogin = await page.locator('input[type=email]').count();
  console.log(`  Login form present: ${hasLogin > 0 ? 'YES' : 'NO'}`);
} finally {
  await browser.close();
}
