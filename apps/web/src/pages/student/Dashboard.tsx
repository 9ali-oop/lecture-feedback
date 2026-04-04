import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout.tsx';
import { api } from '../../lib/api.ts';
import type { Module, Session } from '@lecture-feedback/shared';

export default function StudentDashboard() {
  const navigate = useNavigate();
  const [modules, setModules] = useState<(Module & { enrolled?: boolean })[]>([]);
  const [liveSessions, setLiveSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'enrolled' | 'browse'>('enrolled');

  useEffect(() => {
    api.listModules().then(async (mods) => {
      setModules(mods);
      // Find any live sessions across enrolled modules
      const enrolled = mods.filter((m) => m.enrolled);
      const sessionArrays = await Promise.all(enrolled.map((m) => api.listSessions(m.id)));
      const live = sessionArrays.flat().filter((s) => s.status === 'live');
      setLiveSessions(live);
      setLoading(false);
    });
  }, []);

  async function handleEnroll(moduleId: string) {
    await api.enrollModule(moduleId);
    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, enrolled: true, enrolledCount: m.enrolledCount + 1 } : m)),
    );
  }

  async function handleUnenroll(moduleId: string) {
    await api.unenrollModule(moduleId);
    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, enrolled: false, enrolledCount: m.enrolledCount - 1 } : m)),
    );
  }

  const enrolledModules = modules.filter((m) => m.enrolled);
  const browseModules = modules.filter((m) => !m.enrolled);

  return (
    <Layout title="My modules">
      {/* Live session banner */}
      {liveSessions.length > 0 && (
        <div className="mb-6 space-y-2">
          {liveSessions.map((session) => (
            <button
              key={session.id}
              onClick={() => navigate(`/student/session/${session.id}`)}
              className="w-full rounded-2xl bg-green-50 p-4 text-left ring-1 ring-green-200 transition hover:bg-green-100"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Live now
                </span>
                <span className="font-semibold text-green-900">
                  {session.moduleCode} — {session.title}
                </span>
              </div>
              <p className="mt-1 text-sm text-green-700">Tap to join →</p>
            </button>
          ))}
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Modules</h1>
        <div className="flex rounded-xl bg-gray-100 p-1">
          {(['enrolled', 'browse'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              {t === 'enrolled' ? `My modules (${enrolledModules.length})` : `Browse (${browseModules.length})`}
            </button>
          ))}
        </div>
      </div>

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
              className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 ${
                mod.enrolled ? 'cursor-pointer transition hover:ring-blue-200 hover:shadow-md' : ''
              }`}
            >
              <div className="mb-2 flex items-start justify-between">
                <span className="inline-flex rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {mod.code}
                </span>
              </div>
              <h3 className="font-semibold text-gray-900">{mod.name}</h3>
              <p className="mt-1 text-xs text-gray-400">{mod.lecturerName}</p>

              <div className="mt-4">
                {mod.enrolled ? (
                  <button
                    onClick={() => handleUnenroll(mod.id)}
                    className="w-full rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-50"
                  >
                    Unenroll
                  </button>
                ) : (
                  <button
                    onClick={() => handleEnroll(mod.id)}
                    className="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                  >
                    Enroll
                  </button>
                )}
              </div>
            </div>
          ))}

          {(tab === 'enrolled' ? enrolledModules : browseModules).length === 0 && (
            <div className="col-span-3 rounded-2xl bg-white p-12 text-center shadow-sm ring-1 ring-gray-100">
              <p className="text-gray-400">
                {tab === 'enrolled' ? 'No modules enrolled. Browse modules to enroll.' : 'No modules available.'}
              </p>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
