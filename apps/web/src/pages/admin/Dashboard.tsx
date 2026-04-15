import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout.tsx';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../contexts/AuthContext.tsx';
import type { User, ProvisionUserResponse } from '@lecture-feedback/shared';

export default function AdminDashboard() {
  const { user, impersonate } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Provision form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'lecturer' as 'lecturer' | 'student',
    studentNumber: '',
    englishProficiency: 'native' as 'native' | 'fluent' | 'intermediate' | 'beginner',
  });
  const [provisioned, setProvisioned] = useState<ProvisionUserResponse | null>(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState('');

  useEffect(() => {
    api.listUsers()
      .then((u) => { setUsers(u); })
      .catch((err) => { setError(err instanceof Error ? err.message : 'Failed to load users'); })
      .finally(() => { setLoading(false); });
  }, []);

  async function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const result = await api.provisionUser({
        email: form.email,
        name: form.name,
        role: form.role,
        studentNumber: form.role === 'student' ? form.studentNumber : undefined,
        englishProficiency: form.role === 'student' ? form.englishProficiency : undefined,
      });
      setProvisioned(result);
      setUsers((prev) => [...prev, result.user]);
      setForm({ email: '', name: '', role: 'lecturer', studentNumber: '', englishProficiency: 'native' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to provision user');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    try {
      await api.deleteUser(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }

  const roleLabel: Record<string, string> = { admin: 'Admin', lecturer: 'Lecturer', student: 'Student' };
  const roleBadge: Record<string, string> = {
    admin: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    lecturer: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    student: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  };

  return (
    <Layout title="Admin">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Users</h1>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-400">{users.length} accounts</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setProvisioned(null); }}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/25"
        >
          + Add user
        </button>
      </div>

      {/* Provision form */}
      {showForm && (
        <div className="mb-8 rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
          {provisioned ? (
            <div>
              <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Account created</h2>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Share this QR code with <strong>{provisioned.user.email}</strong>. They must scan it
                into an authenticator app, then visit <code className="text-blue-600 dark:text-blue-400">/register</code> to activate.
              </p>
              <div className="mb-4 flex justify-center rounded-xl bg-gray-50 dark:bg-gray-800 p-4">
                <img src={provisioned.qrCodeDataUrl} alt="TOTP QR code" className="h-48 w-48" />
              </div>
              <p className="mb-4 text-center text-xs text-gray-400 dark:text-gray-400">
                Manual key: <code className="font-mono">{provisioned.totpSecret}</code>
              </p>
              <button
                onClick={() => setShowForm(false)}
                className="w-full rounded-lg bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleProvision} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add user</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Full name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as 'lecturer' | 'student' }))}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                >
                  <option value="lecturer">Lecturer</option>
                  <option value="student">Student</option>
                </select>
              </div>

              {form.role === 'student' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Student number</label>
                    <input
                      value={form.studentNumber}
                      onChange={(e) => setForm((f) => ({ ...f, studentNumber: e.target.value }))}
                      required
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">English proficiency</label>
                    <select
                      value={form.englishProficiency}
                      onChange={(e) => setForm((f) => ({ ...f, englishProficiency: e.target.value as 'native' | 'fluent' | 'intermediate' | 'beginner' }))}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                    >
                      <option value="native">Native</option>
                      <option value="fluent">Fluent</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="beginner">Beginner</option>
                    </select>
                  </div>
                </div>
              )}

              {formError && (
                <p className="rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">{formError}</p>
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
                  {submitting ? 'Creating...' : 'Create user'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {/* Users table */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-gray-900 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800 overflow-x-auto">
          {users.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400 dark:text-gray-400">No users yet.</p>
          ) : (
            <table className="w-full text-sm min-w-[540px]">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {users.map((u) => (
                  <tr key={u.id} className="transition hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{u.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${roleBadge[u.role]}`}>
                        {roleLabel[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.totpVerified ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-500 dark:text-amber-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {u.role !== 'admin' && (
                        <>
                          <button
                            onClick={async () => {
                              await impersonate(u.id);
                              navigate(u.role === 'lecturer' ? '/lecturer' : '/student');
                            }}
                            className="rounded-lg px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 transition hover:bg-blue-50 dark:hover:bg-blue-900/30"
                          >
                            View as
                          </button>
                          <button
                            onClick={() => handleDelete(u.id)}
                            className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-500 dark:text-red-400 transition hover:bg-red-50 dark:hover:bg-red-900/30"
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Layout>
  );
}
