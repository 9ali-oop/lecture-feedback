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

  useEffect(() => {
    api.listUsers().then((u) => { setUsers(u); setLoading(false); });
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
    await api.deleteUser(id);
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  const roleLabel: Record<string, string> = { admin: 'Admin', lecturer: 'Lecturer', student: 'Student' };
  const roleBadge: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-700',
    lecturer: 'bg-blue-100 text-blue-700',
    student: 'bg-green-100 text-green-700',
  };

  return (
    <Layout title="Admin">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="mt-1 text-sm text-gray-500">{users.length} accounts</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setProvisioned(null); }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          + Add user
        </button>
      </div>

      {/* Provision form */}
      {showForm && (
        <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          {provisioned ? (
            <div>
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Account created</h2>
              <p className="mb-4 text-sm text-gray-600">
                Share this QR code with <strong>{provisioned.user.email}</strong>. They must scan it
                into an authenticator app, then visit <code className="text-blue-600">/register</code> to activate.
              </p>
              <div className="mb-4 flex justify-center rounded-xl bg-gray-50 p-4">
                <img src={provisioned.qrCodeDataUrl} alt="TOTP QR code" className="h-48 w-48" />
              </div>
              <p className="mb-4 text-center text-xs text-gray-400">
                Manual key: <code className="font-mono">{provisioned.totpSecret}</code>
              </p>
              <button
                onClick={() => setShowForm(false)}
                className="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleProvision} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Add user</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as 'lecturer' | 'student' }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="lecturer">Lecturer</option>
                  <option value="student">Student</option>
                </select>
              </div>

              {form.role === 'student' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Student number</label>
                    <input
                      value={form.studentNumber}
                      onChange={(e) => setForm((f) => ({ ...f, studentNumber: e.target.value }))}
                      required
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">English proficiency</label>
                    <select
                      value={form.englishProficiency}
                      onChange={(e) => setForm((f) => ({ ...f, englishProficiency: e.target.value as 'native' | 'fluent' | 'intermediate' | 'beginner' }))}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
              )}

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
                  {submitting ? 'Creating…' : 'Create user'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Users table */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          {users.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">No users yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u) => (
                  <tr key={u.id} className="transition hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${roleBadge[u.role]}`}>
                        {roleLabel[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.totpVerified ? (
                        <span className="text-green-600">Active</span>
                      ) : (
                        <span className="text-amber-500">Pending setup</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-3">
                      {u.role !== 'admin' && (
                        <>
                          <button
                            onClick={async () => {
                              await impersonate(u.id);
                              navigate(u.role === 'lecturer' ? '/lecturer' : '/student');
                            }}
                            className="text-xs text-blue-500 transition hover:text-blue-700"
                          >
                            View as
                          </button>
                          <button
                            onClick={() => handleDelete(u.id)}
                            className="text-xs text-red-400 transition hover:text-red-600"
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
