import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAuth } from '../contexts/AuthContext.tsx';

function roleHome(role: string) {
  if (role === 'admin') return '/admin';
  if (role === 'lecturer') return '/lecturer';
  return '/student';
}

/**
 * First-time account activation: user enters email + first TOTP code.
 * The TOTP secret was set up by admin and shared as a QR code.
 * This page verifies the first code and logs them in.
 */
export default function Register() {
  const navigate = useNavigate();
  const { login, user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (!authLoading && user) {
      navigate(roleHome(user.role), { replace: true });
    }
  }, [authLoading, user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user, studentProfile } = await api.verify(email.trim(), code.trim());
      login(token, user, studentProfile);

      if (user.role === 'admin') navigate('/admin', { replace: true });
      else if (user.role === 'lecturer') navigate('/lecturer', { replace: true });
      else navigate('/student', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">LectureFlow</h1>
          <p className="mt-2 text-sm text-gray-500">University of Leeds</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-100">
          <h2 className="mb-2 text-xl font-semibold text-gray-900">Activate your account</h2>
          <p className="mb-6 text-sm text-gray-500">
            Scan the QR code you received into an authenticator app (e.g. Google Authenticator),
            then enter your email and the first 6-digit code.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@leeds.ac.uk"
                required
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Authenticator code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-center text-lg font-mono tracking-widest outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Activating…' : 'Activate account'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-400">
            Already set up?{' '}
            <Link to="/login" className="text-blue-600 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
