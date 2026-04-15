import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout.tsx';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { SessionSocket } from '../../lib/ws.ts';
import type { Module, Session } from '@lecture-feedback/shared';

export default function StudentDashboard() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [modules, setModules] = useState<(Module & { enrolled?: boolean })[]>([]);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'enrolled' | 'browse'>('enrolled');
  const socketRef = useRef<SessionSocket | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const mods = await api.listModules();
      setModules(mods);
      const enrolled = mods.filter((m) => m.enrolled);
      // Use allSettled so one failing module doesn't blank out all sessions
      const results = await Promise.allSettled(enrolled.map((m) => api.listSessions(m.id)));
      const sessions = results
        .filter((r): r is PromiseFulfilledResult<Session[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value);
      setAllSessions(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load modules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchData]);

  // Open a lightweight WS connection for instant live-session notifications
  useEffect(() => {
    if (!token) return;

    const socket = new SessionSocket('dashboard', token);
    socketRef.current = socket;
    socket.connect();

    const unsub = socket.onMessage((msg) => {
      if (msg.type === 'SESSION_LIVE' || msg.type === 'SESSION_ENDED_DASHBOARD') {
        fetchData();
      }
    });

    return () => {
      unsub();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, fetchData]);

  async function handleEnroll(moduleId: string) {
    setError('');
    try {
      await api.enrollModule(moduleId);
    } catch (firstErr) {
      // Retry once on transient failure (e.g., proxy 502)
      try {
        await new Promise((r) => setTimeout(r, 500));
        await api.enrollModule(moduleId);
      } catch (retryErr) {
        setError(retryErr instanceof Error ? retryErr.message : 'Failed to enroll');
        return;
      }
    }
    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, enrolled: true, enrolledCount: m.enrolledCount + 1 } : m)),
    );
    // Fetch sessions for the newly enrolled module
    try {
      const newSessions = await api.listSessions(moduleId);
      setAllSessions((prev) => [...prev, ...newSessions]);
    } catch {
      // Session fetch failing shouldn't undo the enrollment UI update
    }
  }

  async function handleUnenroll(moduleId: string) {
    try {
      await api.unenrollModule(moduleId);
      setModules((prev) =>
        prev.map((m) => (m.id === moduleId ? { ...m, enrolled: false, enrolledCount: m.enrolledCount - 1 } : m)),
      );
      // Remove sessions from the unenrolled module
      setAllSessions((prev) => prev.filter((s) => s.moduleId !== moduleId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unenroll');
    }
  }

  const enrolledModules = modules.filter((m) => m.enrolled);
  const browseModules = modules.filter((m) => !m.enrolled);

  const liveSessions = allSessions.filter((s) => s.status === 'live');
  const scheduledSessions = allSessions.filter((s) => s.status === 'scheduled');
  const recentSessions = allSessions
    .filter((s) => s.status === 'ended')
    .sort((a, b) => new Date(b.endedAt!).getTime() - new Date(a.endedAt!).getTime())
    .slice(0, 5);

  return (
    <Layout>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
        </h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            {enrolledModules.length} module{enrolledModules.length !== 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {allSessions.filter((s) => s.status === 'ended' && s.participated).length} session{allSessions.filter((s) => s.status === 'ended' && s.participated).length !== 1 ? 's' : ''} attended
          </span>
        </div>
      </div>

      {/* Live session banner */}
      {liveSessions.length > 0 && (
        <div className="mb-8 space-y-3">
          {liveSessions.map((session) => (
            <button
              key={session.id}
              onClick={() => navigate(`/student/session/${session.id}`)}
              className="group w-full rounded-2xl bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 p-5 text-left ring-1 ring-emerald-200 dark:ring-emerald-800 transition hover:shadow-lg hover:shadow-emerald-100/50 dark:hover:shadow-emerald-900/20 hover:ring-emerald-300 dark:hover:ring-emerald-700"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                  Live now
                </span>
                <span className="text-lg font-semibold text-gray-900 dark:text-gray-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition">
                  {session.moduleCode} - {session.title}
                </span>
              </div>
              <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">Tap to join the session</p>
            </button>
          ))}
        </div>
      )}

      {/* Upcoming sessions */}
      {scheduledSessions.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-400">Upcoming</h2>
          <div className="space-y-2">
            {scheduledSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between rounded-2xl bg-white dark:bg-gray-900 px-5 py-4 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex rounded-lg bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                      {session.moduleCode}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{session.title}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-400">
                    {session.totalSlides > 0 ? `${session.totalSlides} slides` : 'No slides yet'}
                  </p>
                </div>
                <span className="rounded-full bg-gray-50 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-400 dark:text-gray-400">
                  Scheduled
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent sessions */}
      {recentSessions.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-400">Recent sessions</h2>
          <div className="space-y-2">
            {recentSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between rounded-2xl bg-white dark:bg-gray-900 px-5 py-4 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800 transition hover:ring-gray-200 dark:hover:ring-gray-700"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex rounded-lg bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                      {session.moduleCode}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{session.title}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-400">
                    {session.totalSlides} slides
                    {session.endedAt && ` · ${new Date(session.endedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}`}
                  </p>
                </div>
                <button
                  onClick={() => navigate(`/student/report/${session.id}`)}
                  className="rounded-xl border border-gray-200 dark:border-gray-700 px-3.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                >
                  View report
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modules */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-400">Modules</h2>
        <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
          {(['enrolled', 'browse'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === t ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t === 'enrolled' ? `My modules (${enrolledModules.length})` : `Browse (${browseModules.length})`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(tab === 'enrolled' ? enrolledModules : browseModules).map((mod) => (
            <div
              key={mod.id}
              onClick={mod.enrolled ? () => navigate(`/student/module/${mod.id}`) : undefined}
              className={`group rounded-2xl bg-white dark:bg-gray-900 p-5 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800 ${
                mod.enrolled ? 'cursor-pointer transition hover:ring-blue-200 dark:hover:ring-blue-800 hover:shadow-md' : ''
              }`}
            >
              <div className="mb-2 flex items-start justify-between">
                <span className="inline-flex rounded-lg bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  {mod.code}
                </span>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">{mod.name}</h3>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-400">{mod.lecturerName}</p>

              <div className="mt-4">
                {mod.enrolled ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUnenroll(mod.id); }}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                  >
                    Unenroll
                  </button>
                ) : (
                  <button
                    onClick={() => handleEnroll(mod.id)}
                    className="w-full rounded-xl bg-blue-600 py-1.5 text-xs font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700"
                  >
                    Enroll
                  </button>
                )}
              </div>
            </div>
          ))}

          {(tab === 'enrolled' ? enrolledModules : browseModules).length === 0 && (
            <div className="col-span-3 rounded-2xl bg-white dark:bg-gray-900 p-12 text-center shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
              <p className="text-gray-400 dark:text-gray-400">
                {tab === 'enrolled' ? 'No modules enrolled. Browse modules to enroll.' : 'No modules available.'}
              </p>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
