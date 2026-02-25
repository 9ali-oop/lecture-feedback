import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout.tsx';
import { api } from '../../lib/api.ts';
import type { Session } from '@lecture-feedback/shared';

export default function LecturerModule() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [moduleName, setModuleName] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!moduleId) return;
    api.listSessions(moduleId).then((s) => {
      setSessions(s);
      if (s[0]) setModuleName(`${s[0].moduleCode} — ${s[0].moduleName}`);
      setLoading(false);
    });
  }, [moduleId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const session = await api.createSession({ moduleId: moduleId!, title });
      setSessions((prev) => [...prev, session]);
      setShowForm(false);
      setTitle('');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpload(sessionId: string, file: File) {
    setUploadingFor(sessionId);
    try {
      await api.uploadPdf(sessionId, file);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, hasPdf: true } : s)),
      );
    } finally {
      setUploadingFor(null);
    }
  }

  async function handleStart(sessionId: string) {
    await api.startSession(sessionId);
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, status: 'live' } : s)),
    );
    window.open(`/lecturer/live/${sessionId}`, '_blank', 'width=1280,height=800');
  }

  const statusBadge: Record<string, string> = {
    scheduled: 'bg-gray-100 text-gray-600',
    live: 'bg-green-100 text-green-700',
    ended: 'bg-gray-100 text-gray-400',
  };

  return (
    <Layout title={moduleName || 'Module'} back="/lecturer">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          + New session
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <form onSubmit={handleCreate} className="space-y-4">
            <h2 className="font-semibold text-gray-900">Create session</h2>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Session title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Week 3 — Algorithms"
                required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadingFor) handleUpload(uploadingFor, file);
          e.target.value = '';
        }}
      />

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl bg-white p-12 text-center shadow-sm ring-1 ring-gray-100">
          <p className="text-gray-400">No sessions yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-100"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{session.title}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[session.status]}`}>
                    {session.status === 'live' ? '● Live' : session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-400">
                  {session.hasPdf ? `${session.totalSlides} slides` : 'No slides uploaded'}
                  {session.startedAt && ` · Started ${new Date(session.startedAt).toLocaleTimeString()}`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {session.status === 'ended' && (
                  <button
                    onClick={() => navigate(`/lecturer/report/${session.id}`)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                  >
                    View report
                  </button>
                )}

                {session.status !== 'ended' && (
                  <>
                    <button
                      onClick={() => {
                        setUploadingFor(session.id);
                        fileRef.current?.click();
                      }}
                      disabled={uploadingFor === session.id}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                    >
                      {uploadingFor === session.id ? 'Uploading…' : session.hasPdf ? 'Replace PDF' : 'Upload PDF'}
                    </button>

                    {session.status === 'scheduled' && session.hasPdf && (
                      <button
                        onClick={() => handleStart(session.id)}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
                      >
                        Start session
                      </button>
                    )}

                    {session.status === 'live' && (
                      <button
                        onClick={() => window.open(`/lecturer/live/${session.id}`, '_blank', 'width=1280,height=800')}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                      >
                        Open live view
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
