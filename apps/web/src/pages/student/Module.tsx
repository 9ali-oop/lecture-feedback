import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout.tsx';
import { api } from '../../lib/api.ts';
import type { Session } from '@lecture-feedback/shared';

export default function StudentModule() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [moduleName, setModuleName] = useState('');
  const [loading, setLoading] = useState(true);
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

  const statusBadge: Record<string, string> = {
    scheduled: 'bg-gray-100 dark:bg-gray-800 text-gray-500',
    live: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    ended: 'bg-gray-50 dark:bg-gray-800 text-gray-400',
  };

  return (
    <Layout title={moduleName || 'Module'} back="/student">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Sessions</h1>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-gray-900 p-12 text-center shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
          <p className="text-gray-400">No sessions yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
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
                    {session.status === 'live' ? '● Live' : session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-400">
                  {session.hasPdf ? `${session.totalSlides} slides` : 'No slides'}
                  {session.startedAt && ` · ${new Date(session.startedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {session.status === 'ended' && (
                  <button
                    onClick={() => navigate(`/student/report/${session.id}`)}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 px-3.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                  >
                    View report
                  </button>
                )}
                {session.status === 'live' && (
                  <button
                    onClick={() => navigate(`/student/session/${session.id}`)}
                    className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700"
                  >
                    Join session
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
