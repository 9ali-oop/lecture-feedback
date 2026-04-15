const BASE = '/api';

function getToken(): string | null {
  return sessionStorage.getItem('impersonate_token') ?? localStorage.getItem('token');
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    if (sessionStorage.getItem('impersonate_token')) {
      sessionStorage.removeItem('impersonate_token');
      sessionStorage.removeItem('real_admin');
      window.location.href = '/admin';
    } else {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({
      error: `Request failed (${res.status}${res.statusText ? ' ' + res.statusText : ''})`,
    }));
    throw new Error((err as { error: string }).error ?? `Request failed (${res.status})`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Auth
  verify: (email: string, code: string) =>
    request<{ token: string; user: import('@lecture-feedback/shared').User; studentProfile?: import('@lecture-feedback/shared').StudentProfile }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  me: () =>
    request<{
      user: import('@lecture-feedback/shared').User;
      studentProfile?: import('@lecture-feedback/shared').StudentProfile;
    }>('/auth/me'),

  // Admin
  listUsers: () =>
    request<import('@lecture-feedback/shared').User[]>('/admin/users'),

  provisionUser: (body: import('@lecture-feedback/shared').ProvisionUserBody) =>
    request<import('@lecture-feedback/shared').ProvisionUserResponse>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteUser: (id: string) =>
    request<void>(`/admin/users/${id}`, { method: 'DELETE' }),

  impersonateUser: (userId: string) => {
    // Always use the real admin token from localStorage, not any impersonation token
    const adminToken = localStorage.getItem('token');
    return request<{ token: string; user: import('@lecture-feedback/shared').User; studentProfile?: import('@lecture-feedback/shared').StudentProfile }>(`/admin/impersonate/${userId}`, {
      method: 'POST',
      headers: adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {},
    });
  },

  // Modules
  listModules: () =>
    request<(import('@lecture-feedback/shared').Module & { enrolled?: boolean })[]>('/modules'),

  createModule: (body: import('@lecture-feedback/shared').CreateModuleBody) =>
    request<import('@lecture-feedback/shared').Module>('/modules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteModule: (id: string) =>
    request<void>(`/modules/${id}`, { method: 'DELETE' }),

  updateModule: (id: string, body: { code?: string; name?: string; color?: string }) =>
    request<import('@lecture-feedback/shared').Module>(`/modules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  enrollModule: (moduleId: string) =>
    request<void>(`/modules/${moduleId}/enroll`, { method: 'POST' }),

  unenrollModule: (moduleId: string) =>
    request<void>(`/modules/${moduleId}/enroll`, { method: 'DELETE' }),

  // Sessions
  listSessions: (moduleId: string) =>
    request<import('@lecture-feedback/shared').Session[]>(`/sessions/module/${moduleId}`),

  getSession: (id: string) =>
    request<import('@lecture-feedback/shared').Session>(`/sessions/${id}`),

  createSession: (body: import('@lecture-feedback/shared').CreateSessionBody & { moduleId: string }) =>
    request<import('@lecture-feedback/shared').Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  uploadPdf: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<void>(`/sessions/${sessionId}/pdf`, {
      method: 'POST',
      body: form,
    });
  },

  startSession: (id: string) =>
    request<void>(`/sessions/${id}/start`, { method: 'POST' }),

  endSession: (id: string) =>
    request<void>(`/sessions/${id}/end`, { method: 'POST' }),

  deleteSession: (id: string) =>
    request<void>(`/sessions/${id}`, { method: 'DELETE' }),

  updateTotalSlides: (id: string, totalSlides: number) =>
    request<void>(`/sessions/${id}/slides`, {
      method: 'PATCH',
      body: JSON.stringify({ totalSlides }),
    }),

  getReport: (id: string) =>
    request<import('@lecture-feedback/shared').SessionReport>(`/sessions/${id}/report`),

  // Questions
  listQuestions: (sessionId: string) =>
    request<import('@lecture-feedback/shared').Question[]>(`/questions/session/${sessionId}`),

  askQuestion: (sessionId: string, content: string, slideIndex?: number) =>
    request<import('@lecture-feedback/shared').Question>(`/questions/session/${sessionId}`, {
      method: 'POST',
      body: JSON.stringify({ content, slideIndex }),
    }),

  answerQuestion: (questionId: string) =>
    request<void>(`/questions/${questionId}/answer`, { method: 'PATCH' }),

  // Notes
  listNotes: (sessionId: string) =>
    request<import('@lecture-feedback/shared').SlideNote[]>(`/notes/session/${sessionId}`),

  saveNote: (sessionId: string, slideIndex: number, content: string) =>
    request<void>(`/notes/session/${sessionId}/slide/${slideIndex}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  // Whiteboards
  saveWhiteboards: (sessionId: string, slides: { slideIndex: number; imageData: string }[]) =>
    request<{ ok: boolean; saved: number }>(`/sessions/${sessionId}/whiteboards`, {
      method: 'POST',
      body: JSON.stringify({ slides }),
    }),

  whiteboardUrl: (sessionId: string, slideIndex: number) =>
    `${BASE}/sessions/${sessionId}/whiteboards/${slideIndex}`,

  // Confusion context
  submitConfusionContext: (sessionId: string, data: {
    slideIndex: number;
    emoji: 'confused' | 'lost';
    highlights: import('@lecture-feedback/shared').ConfusionHighlight[];
    explanation?: string;
  }) =>
    request<{ id: string }>(`/confusion/session/${sessionId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Annotations
  saveAnnotations: (sessionId: string, slides: { slideIndex: number; imageData: string }[]) =>
    request<{ ok: boolean; saved: number }>(`/sessions/${sessionId}/annotations`, {
      method: 'POST',
      body: JSON.stringify({ slides }),
    }),

  annotationUrl: (sessionId: string, slideIndex: number) =>
    `${BASE}/sessions/${sessionId}/annotations/${slideIndex}`,

  // All notes (lecturer view — anonymous)
  getAllNotes: (sessionId: string) =>
    request<import('@lecture-feedback/shared').SlideNote[]>(`/notes/session/${sessionId}/all`),

  // Report PDF download
  downloadReportPdf: async (sessionId: string, annotations: boolean) => {
    const token = getToken();
    const url = `${BASE}/sessions/${sessionId}/report/pdf?annotations=${annotations}`;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Failed to download PDF');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report-${sessionId}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  // Reflections
  submitReflection: (sessionId: string, data: { mostImportant: string; stillUnclear: string }) =>
    request<void>(`/reflections/session/${sessionId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getReflections: (sessionId: string) =>
    request<import('@lecture-feedback/shared').ReflectionSummary>(`/reflections/session/${sessionId}`),

  // Analytics
  getModuleAnalytics: (moduleId: string) =>
    request<import('@lecture-feedback/shared').ModuleAnalytics>(`/analytics/module/${moduleId}`),

  // Polls
  createPoll: (sessionId: string, data: { question: string; options: string[]; slideIndex: number; isTrueFalse?: boolean }) =>
    request<import('@lecture-feedback/shared').Poll>(`/polls/session/${sessionId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  closePoll: (pollId: string) =>
    request<void>(`/polls/${pollId}/close`, { method: 'PATCH' }),

  getPollResults: (pollId: string) =>
    request<import('@lecture-feedback/shared').PollResults>(`/polls/${pollId}/results`),

  listPolls: (sessionId: string) =>
    request<{ poll: import('@lecture-feedback/shared').Poll; results: import('@lecture-feedback/shared').PollResults }[]>(`/polls/session/${sessionId}`),

  // Timeline
  getTimeline: (sessionId: string) =>
    request<import('@lecture-feedback/shared').TimelineBucket[]>(`/sessions/${sessionId}/timeline`),

  // PDF
  pdfUrl: (sessionId: string) => `${BASE}/sessions/${sessionId}/pdf`,
};
