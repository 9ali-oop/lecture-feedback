/**
 * Verifies that oversized / malformed stroke payloads are rejected at the
 * session-manager boundary, not silently stored and broadcast.
 *
 * Incoming WS messages are JSON.parse + type-assertion only, so a lecturer
 * (or granted annotator) could forge a DRAW_STROKE with 10 M points. Without
 * the guard we'd push that into room.annotations and then send(ws, …) it
 * to every student in the room — OOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/db/index.js', () => {
  const thenable = (v: unknown = []) => {
    const p: any = Promise.resolve(v);
    p.onConflictDoNothing = () => Promise.resolve();
    p.where = () => thenable(v);
    p.set = () => thenable(v);
    return p;
  };
  return {
    db: {
      insert: () => ({ values: () => thenable() }),
      select: () => ({ from: () => ({ where: () => thenable([]) }) }),
      update: () => ({ set: () => ({ where: () => thenable() }) }),
    },
  };
});

import { SessionManager } from '../src/ws/session-manager.js';

function mkWs() {
  const sent: any[] = [];
  return { sent, ws: { send: (m: string) => sent.push(JSON.parse(m)), close: () => {} } as any };
}

describe('SessionManager — stroke input validation', () => {
  let sm: SessionManager;
  beforeEach(() => { sm = new SessionManager(); });
  afterEach(async () => { await sm.endSession('sid').catch(() => {}); });

  it('accepts a normal pen stroke', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);

    const points = Array.from({ length: 100 }, (_, i) => ({ x: i / 100, y: i / 100 }));
    sm.handleDrawStroke('sid', points, '#ff0000', 0.005, 0);

    expect(stu.sent.some((m) => m.type === 'DRAW_STROKE')).toBe(true);
  });

  it('rejects strokes with > 5000 points (OOM guard)', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    const huge = Array.from({ length: 10_000 }, (_, i) => ({ x: i, y: i }));
    sm.handleDrawStroke('sid', huge, '#ff0000', 0.005, 0);

    expect(stu.sent.some((m) => m.type === 'DRAW_STROKE')).toBe(false);
  });

  it('rejects NaN/Infinity coordinates', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    sm.handleDrawStroke('sid', [{ x: NaN, y: 0 }], '#ff0000', 0.005, 0);
    sm.handleDrawStroke('sid', [{ x: Infinity, y: 0 }], '#ff0000', 0.005, 0);

    expect(stu.sent.some((m) => m.type === 'DRAW_STROKE')).toBe(false);
  });

  it('rejects non-numeric coordinates (shape-forged JSON)', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    sm.handleDrawStroke('sid', [{ x: 'nope' as any, y: 0 }], '#ff0000', 0.005, 0);
    sm.handleDrawStroke('sid', ['not-a-point' as any], '#ff0000', 0.005, 0);

    expect(stu.sent.some((m) => m.type === 'DRAW_STROKE')).toBe(false);
  });

  it('rejects oversized color strings (would bloat broadcast)', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    sm.handleDrawStroke('sid', [{ x: 0, y: 0 }], 'a'.repeat(10_000), 0.005, 0);

    expect(stu.sent.some((m) => m.type === 'DRAW_STROKE')).toBe(false);
  });

  it('rejects unreasonable stroke width', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    sm.handleDrawStroke('sid', [{ x: 0, y: 0 }], '#000', 1e9, 0);

    expect(stu.sent.some((m) => m.type === 'DRAW_STROKE')).toBe(false);
  });

  it('rejects huge erase strokes too', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    const huge = Array.from({ length: 10_000 }, (_, i) => ({ x: i, y: i }));
    sm.handleEraseStroke('sid', huge, 0.03, 0);

    expect(stu.sent.some((m) => m.type === 'ERASE_STROKE')).toBe(false);
  });

  // ── Text box sync validation ──────────────────────────────────────────
  //
  // Same reasoning as strokes: textBoxes arrives from the lecturer's WS
  // without runtime validation. A forged message with 1 MB `content` or
  // hundreds of boxes would fan out to every student in the room.

  function mkTextBox(overrides: Partial<any> = {}) {
    return {
      id: 'tb1',
      x: 0.1, y: 0.1, width: 0.2, height: 0.05,
      content: 'hello',
      fontFamily: 'sans-serif',
      fontSize: 14,
      color: '#000',
      ...overrides,
    };
  }

  it('accepts a normal text-box sync', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    sm.handleTextBoxSync('sid', 0, [mkTextBox()]);
    expect(stu.sent.some((m) => m.type === 'TEXT_BOX_SYNC')).toBe(true);
  });

  it('rejects > 50 text boxes', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    const many = Array.from({ length: 100 }, (_, i) => mkTextBox({ id: `tb${i}` }));
    sm.handleTextBoxSync('sid', 0, many);
    expect(stu.sent.some((m) => m.type === 'TEXT_BOX_SYNC')).toBe(false);
  });

  it('rejects oversized content strings', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    sm.handleTextBoxSync('sid', 0, [mkTextBox({ content: 'x'.repeat(100_000) })]);
    expect(stu.sent.some((m) => m.type === 'TEXT_BOX_SYNC')).toBe(false);
  });

  it('rejects NaN/Infinity numeric fields', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    sm.handleTextBoxSync('sid', 0, [mkTextBox({ x: NaN })]);
    sm.handleTextBoxSync('sid', 0, [mkTextBox({ fontSize: Infinity })]);
    expect(stu.sent.some((m) => m.type === 'TEXT_BOX_SYNC')).toBe(false);
  });

  it('rejects wrong-type fields (shape-forged JSON)', async () => {
    const lec = mkWs();
    const stu = mkWs();
    await sm.joinAsLecturer('sid', 'lec1', lec.ws);
    await sm.joinAsStudent('sid', 'stu1', 'S', stu.ws);
    stu.sent.length = 0;

    sm.handleTextBoxSync('sid', 0, [mkTextBox({ id: 123 as any })]);
    sm.handleTextBoxSync('sid', 0, [mkTextBox({ content: { html: '<script>' } as any })]);
    sm.handleTextBoxSync('sid', 0, ['not-an-object' as any]);
    expect(stu.sent.some((m) => m.type === 'TEXT_BOX_SYNC')).toBe(false);
  });
});
