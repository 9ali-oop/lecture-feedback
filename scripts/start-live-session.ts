/**
 * Creates + starts a live session and prints its ID. Used for manual
 * (Playwright) testing of the live UI on multiple viewports. Does NOT end
 * the session — caller is responsible.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const API = 'http://localhost:3000';
const CODE = '123456';

async function main() {
  const lRes = await fetch(`${API}/auth/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'lecturer@leeds.ac.uk', code: CODE }),
  });
  const l = (await lRes.json()) as any;
  const mods = await fetch(`${API}/modules`, { headers: { Authorization: `Bearer ${l.token}` } }).then((r) => r.json()) as any[];
  const mod = mods.find((m: any) => m.code === 'COMP101');

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 4; i++) {
    const p = pdf.addPage([600, 450]);
    p.drawText(`Live slide ${i + 1}`, { x: 40, y: 380, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
  }
  const bytes = await pdf.save();

  const create = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${l.token}` },
    body: JSON.stringify({ moduleId: mod.id, title: 'Mobile UX test' }),
  });
  const { id: sessionId } = (await create.json()) as any;

  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 't.pdf');
  await fetch(`${API}/sessions/${sessionId}/pdf`, { method: 'POST', headers: { Authorization: `Bearer ${l.token}` }, body: fd });
  await fetch(`${API}/sessions/${sessionId}/slides`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${l.token}` },
    body: JSON.stringify({ totalSlides: 4 }),
  });
  await fetch(`${API}/sessions/${sessionId}/start`, { method: 'POST', headers: { Authorization: `Bearer ${l.token}` } });
  console.log(sessionId);
}

main().catch((err) => { console.error(err); process.exit(1); });
