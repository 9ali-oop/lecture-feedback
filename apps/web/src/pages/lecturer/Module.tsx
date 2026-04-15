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

  const [error, setError] = useState('');

  useEffect(() => {
    if (!moduleId) return;
    api.listSessions(moduleId)
      .then((s) => {
        setSessions(s);
        if (s[0]) setModuleName(`${s[0].moduleCode} — ${s[0].moduleName}`);
      })
      .catch((err) => { setError(err instanceof Error ? err.message : 'Failed to load sessions'); })
      .finally(() => { setLoading(false); });
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload PDF');
    } finally {
      setUploadingFor(null);
    }
  }

  async function handleStart(sessionId: string) {
    try {
      await api.startSession(sessionId);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'live' } : s)),
      );
      navigate(`/lecturer/live/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    }
  }

  async function handleDelete(sessionId: string) {
    if (!confirm('Delete this session and all its data? This cannot be undone.')) return;
    try {
      await api.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    }
  }

  async function handleEnd(sessionId: string) {
    if (!confirm('End this live session? Students will be disconnected.')) return;
    try {
      await api.endSession(sessionId);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'ended' as const, endedAt: new Date().toISOString() } : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end session');
    }
  }

  const statusBadge: Record<string, string> = {
    scheduled: 'bg-gray-100 dark:bg-gray-800 text-gray-500',
    live: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    ended: 'bg-gray-50 dark:bg-gray-800 text-gray-400',
  };

  return (
    <Layout title={moduleName || 'Module'} back="/lecturer">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Sessions</h1>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/25"
        >
          + New session
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {showForm && (
        <div className="mb-8 rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
          <form onSubmit={handleCreate} className="space-y-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Create session</h2>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Session title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Week 3 - Algorithms"
                required
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-800"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create'}
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
        <div className="rounded-2xl bg-white dark:bg-gray-900 p-12 text-center shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
          <p className="text-gray-400">No sessions yet.</p>
        </div>
      ) : (
        <>
          {/* Active sessions (live + scheduled) */}
          {sessions.filter((s) => s.status !== 'ended').length > 0 && (
            <div className="space-y-3">
              {sessions.filter((s) => s.status !== 'ended').map((session) => (
                <div
                  key={session.id}
                  className={`flex items-center justify-between rounded-2xl bg-white dark:bg-gray-900 px-5 py-4 shadow-sm ring-1 transition ${
                    session.status === 'live' ? 'ring-emerald-200 dark:ring-emerald-800 shadow-emerald-100/50' : 'ring-gray-100 dark:ring-gray-800'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{session.title}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[session.status]}`}>
                        {session.status === 'live' ? '● Live' : 'Scheduled'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {session.hasPdf ? `${session.totalSlides} slides` : 'No slides uploaded'}
                      {session.startedAt && ` · Started ${new Date(session.startedAt).toLocaleTimeString()}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setUploadingFor(session.id);
                        fileRef.current?.click();
                      }}
                      disabled={uploadingFor === session.id}
                      className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50"
                    >
                      {uploadingFor === session.id ? 'Uploading...' : session.hasPdf ? 'Replace PDF' : 'Upload PDF'}
                    </button>

                    {session.status === 'scheduled' && (
                      <button
                        onClick={() => handleDelete(session.id)}
                        className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600"
                        title="Delete session"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}

                    {session.status === 'scheduled' && session.hasPdf && (
                      <button
                        onClick={() => handleStart(session.id)}
                        className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700"
                      >
                        Start session
                      </button>
                    )}

                    {session.status === 'live' && (
                      <>
                        <button
                          onClick={() => navigate(`/lecturer/live/${session.id}`)}
                          className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700"
                        >
                          Open live view
                        </button>
                        <button
                          onClick={() => handleEnd(session.id)}
                          className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600"
                          title="End session"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Previous sessions */}
          {sessions.filter((s) => s.status === 'ended').length > 0 && (
            <div className="mt-10">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Previous sessions</h2>
              <div className="space-y-3">
                {sessions.filter((s) => s.status === 'ended').map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between rounded-2xl bg-white dark:bg-gray-900 px-5 py-4 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800"
                  >
                    <div>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{session.title}</span>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {session.totalSlides} slides
                        {session.endedAt && ` · Ended ${new Date(session.endedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/lecturer/report/${session.id}`)}
                        className="rounded-xl border border-gray-200 dark:border-gray-700 px-3.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                      >
                        View report
                      </button>
                      <button
                        onClick={() => handleDelete(session.id)}
                        className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600"
                        title="Delete session"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
