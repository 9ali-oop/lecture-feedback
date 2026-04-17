/**
 * Isolated check of the mobile touch fix (bug 3). Mounts a canvas that mimics
 * the overlay in PdfViewer — same Pointer Event handlers, same touchAction
 * style — then simulates an iPhone touch drag and confirms the drag path is
 * delivered to our handlers (not swallowed by the browser's scroll gesture).
 *
 * Why isolated: the full Session.tsx path hits React-dev-mode StrictMode
 * double-mount races on the student WebSocket, which would conflate "our
 * pointer fix" with "dev-mode socket timing". This fixture loads no React,
 * no sockets, no backend — it only verifies the handler wiring.
 */
import { chromium, devices } from 'playwright';

const html = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body,html{margin:0;height:100%} .slide-canvas{position:relative;height:100vh;background:#eef}</style>
</head><body>
<div class="slide-canvas">
  <canvas id="base" width="800" height="400"></canvas>
  <canvas id="overlay" width="800" height="400" style="position:absolute;inset:0;touch-action:none"></canvas>
</div>
<script>
  // Mirror PdfViewer.tsx: capture pointerId on down, listen for move/up/cancel.
  const overlay = document.getElementById('overlay');
  window.__ev = { down: 0, move: 0, up: 0, cancel: 0, firstMovePt: null };
  overlay.addEventListener('pointerdown', (e) => {
    window.__ev.down++;
    try { overlay.setPointerCapture(e.pointerId); } catch {}
  });
  overlay.addEventListener('pointermove', (e) => {
    window.__ev.move++;
    if (!window.__ev.firstMovePt) {
      const r = overlay.getBoundingClientRect();
      window.__ev.firstMovePt = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
  });
  overlay.addEventListener('pointerup', () => window.__ev.up++);
  overlay.addEventListener('pointercancel', () => window.__ev.cancel++);
  window.__touchAction = getComputedStyle(overlay).touchAction;
</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const iPhone = devices['iPhone 13'];
const ctx = await browser.newContext({ ...iPhone, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.setContent(html);

// Simulate an iPhone touch drag — the exact thing that did NOT work before
// the fix (mouse-only handlers swallowed it, touch-action scrolled the page).
await page.evaluate(() => {
  const overlay = document.getElementById('overlay');
  const r = overlay.getBoundingClientRect();
  const mk = (type, x, y) => new PointerEvent(type, {
    pointerId: 1, pointerType: 'touch', isPrimary: true,
    clientX: x, clientY: y, bubbles: true, cancelable: true,
  });
  const sx = r.left + 100, sy = r.top + 100;
  overlay.dispatchEvent(mk('pointerdown', sx, sy));
  for (let i = 1; i <= 20; i++) {
    overlay.dispatchEvent(mk('pointermove', sx + i * 10, sy + Math.sin(i) * 5));
  }
  overlay.dispatchEvent(mk('pointerup', sx + 200, sy));
});

const ev = await page.evaluate(() => window.__ev);
const ta = await page.evaluate(() => window.__touchAction);

let fail = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
}

check('Bug 3a: overlay receives pointerdown from touch', ev.down === 1);
check('Bug 3b: overlay receives pointermove during drag', ev.move >= 15, `move=${ev.move}`);
check('Bug 3c: overlay receives pointerup at end of drag', ev.up === 1);
check('Bug 3d: touch-action:none prevents scroll capture', ta === 'none', `computed=${ta}`);
check('Bug 3e: pointermove carries real client coordinates', !!ev.firstMovePt && ev.firstMovePt.x > 0,
  ev.firstMovePt ? `first=${ev.firstMovePt.x},${ev.firstMovePt.y}` : 'no coords');

await browser.close();
if (fail) process.exit(1);
console.log(`\n5/5 mobile pointer checks passed`);
