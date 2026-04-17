import WebSocket from 'ws';
const BASE = 'http://localhost:3000';
async function req(path, opts = {}) {
  const { headers: h, ...rest } = opts;
  return (await fetch(`${BASE}${path}`, { ...rest, headers: { 'Content-Type': 'application/json', ...h } })).json();
}
async function login(email) {
  return (await req('/auth/verify', { method: 'POST', body: JSON.stringify({ email, code: '123456' }) })).token;
}
function ws(token, sid) {
  return new Promise(r => { const s = new WebSocket(`ws://localhost:3000/ws?token=${token}&sessionId=${sid}`); s.on('open', () => r(s)); });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const lt = await login('bosslecturer@leeds.ac.uk');
  const st = await login('oc@leeds.ac.uk');
  const mods = await req('/modules', { headers: { Authorization: `Bearer ${lt}` } });
  const mid = mods.find(m => m.code === 'COMP1234').id;
  const sess = await req('/sessions', { method: 'POST', headers: { Authorization: `Bearer ${lt}` }, body: JSON.stringify({ moduleId: mid, title: 'WB Sync Test' }) });
  await req(`/sessions/${sess.id}/start`, { method: 'POST', headers: { Authorization: `Bearer ${lt}` } });

  const lws = await ws(lt, sess.id);
  const sws = await ws(st, sess.id);
  await sleep(500);

  // Lecturer toggles whiteboard
  lws.send(JSON.stringify({ type: 'WHITEBOARD_TOGGLE', enabled: true }));
  await sleep(300);

  // Lecturer draws a stroke
  lws.send(JSON.stringify({ type: 'DRAW_STROKE', points: [{x:0.1,y:0.1},{x:0.5,y:0.5},{x:0.9,y:0.1}], color: '#ff0000', width: 0.005, slideIndex: 0 }));

  // Check what student receives
  const received = await new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'DRAW_STROKE') {
        sws.off('message', handler);
        resolve({ received: true, slideIndex: msg.slideIndex, points: msg.points.length });
      }
    };
    sws.on('message', handler);
    setTimeout(() => { sws.off('message', handler); resolve({ received: false }); }, 2000);
  });

  console.log('Student received DRAW_STROKE:', JSON.stringify(received));

  lws.close(); sws.close();
  await sleep(300);
  await req(`/sessions/${sess.id}/end`, { method: 'POST', headers: { Authorization: `Bearer ${lt}` } });
  await req(`/sessions/${sess.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${lt}` } });
}
main().catch(e => console.error(e));
