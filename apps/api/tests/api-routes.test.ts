/**
 * REST API route tests.
 *
 * Runs against a live API server (localhost:3000) and real database.
 * Ensure `pnpm dev` is running before executing.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3000';

// ── Helpers ────────────────────────────────────────────────────────────────

async function login(email: string, code = '123456') {
  const res = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  return { status: res.status, data: await res.json() };
}

function authed(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...init.headers as Record<string, string>, Authorization: `Bearer ${token}` },
  };
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('Auth routes', () => {
  it('POST /auth/verify succeeds with valid credentials', async () => {
    const { status, data } = await login('admin@leeds.ac.uk');
    expect(status).toBe(200);
    expect(data.token).toBeDefined();
    expect(data.user.role).toBe('admin');
  });

  it('POST /auth/verify rejects invalid code', async () => {
    const res = await fetch(`${API}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@leeds.ac.uk', code: '000000' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /auth/verify rejects non-existent user', async () => {
    const res = await fetch(`${API}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@nowhere.com', code: '123456' }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns current user', async () => {
    const { data } = await login('admin@leeds.ac.uk');
    const res = await fetch(`${API}/auth/me`, authed(data.token));
    expect(res.status).toBe(200);
    const me = await res.json();
    expect(me.user.email).toBe('admin@leeds.ac.uk');
  });

  it('GET /auth/me rejects unauthenticated request', async () => {
    const res = await fetch(`${API}/auth/me`);
    expect(res.status).toBe(401);
  });
});

describe('Module routes', () => {
  let lecturerToken: string;
  let studentToken: string;

  beforeAll(async () => {
    lecturerToken = (await login('bosslecturer@leeds.ac.uk')).data.token;
    studentToken = (await login('oc@leeds.ac.uk')).data.token;
  });

  it('GET /modules returns modules for lecturer', async () => {
    const res = await fetch(`${API}/modules`, authed(lecturerToken));
    expect(res.status).toBe(200);
    const modules = await res.json();
    expect(Array.isArray(modules)).toBe(true);
    expect(modules.length).toBeGreaterThan(0);
  });

  it('GET /modules returns enrolled modules for student', async () => {
    const res = await fetch(`${API}/modules`, authed(studentToken));
    expect(res.status).toBe(200);
    const modules = await res.json();
    expect(Array.isArray(modules)).toBe(true);
  });
});

describe('Session routes', () => {
  let lecturerToken: string;
  let studentToken: string;
  let sessionId: string;
  let moduleId: string;

  beforeAll(async () => {
    lecturerToken = (await login('bosslecturer@leeds.ac.uk')).data.token;
    studentToken = (await login('oc@leeds.ac.uk')).data.token;

    // Find a module and live session
    const modRes = await fetch(`${API}/modules`, authed(lecturerToken));
    const modules = await modRes.json() as any[];
    for (const mod of modules) {
      const sessRes = await fetch(`${API}/sessions/module/${mod.id}`, authed(lecturerToken));
      const sessions = await sessRes.json() as any[];
      const live = sessions.find((s: any) => s.status === 'live');
      if (live) {
        sessionId = live.id;
        moduleId = mod.id;
        break;
      }
    }
  });

  it('GET /sessions/:id returns session details', async () => {
    const res = await fetch(`${API}/sessions/${sessionId}`, authed(lecturerToken));
    expect(res.status).toBe(200);
    const session = await res.json();
    expect(session.id).toBe(sessionId);
    expect(session.status).toBe('live');
  });

  it('GET /sessions/:id is accessible to enrolled student', async () => {
    const res = await fetch(`${API}/sessions/${sessionId}`, authed(studentToken));
    expect(res.status).toBe(200);
  });

  it('GET /sessions/module/:moduleId returns sessions', async () => {
    const res = await fetch(`${API}/sessions/module/${moduleId}`, authed(lecturerToken));
    expect(res.status).toBe(200);
    const sessions = await res.json();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.some((s: any) => s.id === sessionId)).toBe(true);
  });
});

describe('Notes routes', () => {
  let studentToken: string;
  let sessionId: string;

  beforeAll(async () => {
    studentToken = (await login('oc@leeds.ac.uk')).data.token;
    const lecturerToken = (await login('bosslecturer@leeds.ac.uk')).data.token;
    const modRes = await fetch(`${API}/modules`, authed(lecturerToken));
    const modules = await modRes.json() as any[];
    for (const mod of modules) {
      const sessRes = await fetch(`${API}/sessions/module/${mod.id}`, authed(lecturerToken));
      const sessions = await sessRes.json() as any[];
      const live = sessions.find((s: any) => s.status === 'live');
      if (live) { sessionId = live.id; break; }
    }
  });

  it('PUT /notes saves and GET /notes retrieves notes', async () => {
    const putRes = await fetch(`${API}/notes/session/${sessionId}/slide/0`, {
      ...authed(studentToken),
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ content: 'E2E test note' }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await fetch(`${API}/notes/session/${sessionId}`, authed(studentToken));
    expect(getRes.status).toBe(200);
    const notes = await getRes.json() as any[];
    expect(notes.some((n: any) => n.content === 'E2E test note')).toBe(true);
  });
});

describe('Confusion routes', () => {
  let studentToken: string;
  let lecturerToken: string;
  let sessionId: string;

  beforeAll(async () => {
    studentToken = (await login('oc@leeds.ac.uk')).data.token;
    lecturerToken = (await login('bosslecturer@leeds.ac.uk')).data.token;
    const modRes = await fetch(`${API}/modules`, authed(lecturerToken));
    const modules = await modRes.json() as any[];
    for (const mod of modules) {
      const sessRes = await fetch(`${API}/sessions/module/${mod.id}`, authed(lecturerToken));
      const sessions = await sessRes.json() as any[];
      const live = sessions.find((s: any) => s.status === 'live');
      if (live) { sessionId = live.id; break; }
    }
  });

  it('POST /confusion/session/:id submits confusion context', async () => {
    const res = await fetch(`${API}/confusion/session/${sessionId}`, {
      ...authed(studentToken),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        slideIndex: 1,
        emoji: 'confused',
        highlights: [{ shape: 'rect', x: 0.1, y: 0.2, width: 0.3, height: 0.2 }],
        explanation: 'E2E test confusion',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
  });

  it('GET /confusion/session/:id returns confusion contexts for lecturer', async () => {
    const res = await fetch(`${API}/confusion/session/${sessionId}`, authed(lecturerToken));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('GET /confusion/session/:id rejects student access', async () => {
    const res = await fetch(`${API}/confusion/session/${sessionId}`, authed(studentToken));
    expect(res.status).toBe(403);
  });
});

describe('Questions routes', () => {
  let lecturerToken: string;
  let sessionId: string;

  beforeAll(async () => {
    lecturerToken = (await login('bosslecturer@leeds.ac.uk')).data.token;
    const modRes = await fetch(`${API}/modules`, authed(lecturerToken));
    const modules = await modRes.json() as any[];
    for (const mod of modules) {
      const sessRes = await fetch(`${API}/sessions/module/${mod.id}`, authed(lecturerToken));
      const sessions = await sessRes.json() as any[];
      const live = sessions.find((s: any) => s.status === 'live');
      if (live) { sessionId = live.id; break; }
    }
  });

  it('GET /questions/session/:id returns questions', async () => {
    const res = await fetch(`${API}/questions/session/${sessionId}`, authed(lecturerToken));
    expect(res.status).toBe(200);
    const questions = await res.json();
    expect(Array.isArray(questions)).toBe(true);
  });
});

describe('Polls routes', () => {
  let lecturerToken: string;
  let studentToken: string;
  let sessionId: string;

  beforeAll(async () => {
    lecturerToken = (await login('bosslecturer@leeds.ac.uk')).data.token;
    studentToken = (await login('oc@leeds.ac.uk')).data.token;
    const modRes = await fetch(`${API}/modules`, authed(lecturerToken));
    const modules = await modRes.json() as any[];
    for (const mod of modules) {
      const sessRes = await fetch(`${API}/sessions/module/${mod.id}`, authed(lecturerToken));
      const sessions = await sessRes.json() as any[];
      const live = sessions.find((s: any) => s.status === 'live');
      if (live) { sessionId = live.id; break; }
    }
  });

  it('full poll lifecycle: create, respond, close', async () => {
    // Create poll
    const createRes = await fetch(`${API}/polls/session/${sessionId}`, {
      ...authed(lecturerToken),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lecturerToken}` },
      body: JSON.stringify({ question: 'E2E poll?', options: ['Yes', 'No'], slideIndex: 0 }),
    });
    expect(createRes.status).toBe(201);
    const poll = await createRes.json() as any;
    expect(poll.id).toBeDefined();

    // Student responds
    const respondRes = await fetch(`${API}/polls/${poll.id}/respond`, {
      ...authed(studentToken),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ optionIndex: 0 }),
    });
    expect(respondRes.status).toBe(200);

    // Get results
    const resultsRes = await fetch(`${API}/polls/${poll.id}/results`, authed(lecturerToken));
    expect(resultsRes.status).toBe(200);
    const results = await resultsRes.json() as any;
    expect(results.totalResponses).toBe(1);
    expect(results.counts[0]).toBe(1);

    // Close poll
    const closeRes = await fetch(`${API}/polls/${poll.id}/close`, {
      ...authed(lecturerToken),
      method: 'PATCH',
    });
    expect(closeRes.status).toBe(200);
  });

  it('rejects student from creating poll', async () => {
    const res = await fetch(`${API}/polls/session/${sessionId}`, {
      ...authed(studentToken),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ question: 'Nope', options: ['A', 'B'], slideIndex: 0 }),
    });
    expect(res.status).toBe(403);
  });
});

describe('Health check', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`${API}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
