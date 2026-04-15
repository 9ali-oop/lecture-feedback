import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout.tsx';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../contexts/AuthContext.tsx';
import type { Module } from '@lecture-feedback/shared';

export default function LecturerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', color: '#1e3a5f' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState('');

  useEffect(() => {
    api.listModules()
      .then((m) => { setModules(m); })
      .catch((err) => { setError(err instanceof Error ? err.message : 'Failed to load modules'); })
      .finally(() => { setLoading(false); });
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const mod = await api.createModule(form);
      setModules((prev) => [...prev, { ...mod, lecturerName: user!.name, enrolledCount: 0 }]);
      setShowForm(false);
      setForm({ code: '', name: '', color: '#1e3a5f' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create module');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">My modules</h1>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-400">Welcome back, {user?.name}</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/25"
        >
          + New module
        </button>
      </div>

      {showForm && (
        <div className="mb-8 rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
          <form onSubmit={handleCreate} className="space-y-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Create module</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Module code</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="COMP1234"
                  required
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Module name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Introduction to Computing"
                  required
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                />
              </div>
            </div>
            {formError && (
              <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
            )}
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

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : modules.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-gray-900 p-12 text-center shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
          <p className="text-gray-400 dark:text-gray-400">No modules yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod) => (
            <div
              key={mod.id}
              onClick={() => navigate(`/lecturer/module/${mod.id}`)}
              className="group cursor-pointer rounded-2xl bg-white dark:bg-gray-900 p-5 text-left shadow-sm ring-1 ring-gray-100 dark:ring-gray-800 transition hover:shadow-md hover:ring-blue-200 dark:hover:ring-blue-800"
            >
              <div className="mb-3 flex items-start justify-between">
                <span className="inline-flex rounded-lg bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  {mod.code}
                </span>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete "${mod.name}" and all its sessions? This cannot be undone.`)) return;
                    try {
                      await api.deleteModule(mod.id);
                      setModules((prev) => prev.filter((m) => m.id !== mod.id));
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to delete module');
                    }
                  }}
                  className="rounded-lg p-1 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500"
                  title="Delete module"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">{mod.name}</h3>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-400">
                {mod.enrolledCount} {mod.enrolledCount === 1 ? 'student' : 'students'} enrolled
              </p>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
