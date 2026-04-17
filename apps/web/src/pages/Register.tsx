import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { roleHome } from '../lib/roles.ts';
import AccessibilityToggles from '../components/AccessibilityToggles.tsx';

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 px-4">
      {/* Theme + Dyslexia + View toggles */}
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <AccessibilityToggles variant="corner" />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/25">
            <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">LectureFlow</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">University of Leeds</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-xl shadow-gray-200/60 dark:shadow-black/20 ring-1 ring-gray-100 dark:ring-gray-800">
          <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Activate your account</h2>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            Scan the QR code you received into an authenticator app (e.g. Google Authenticator),
            then enter your email and the first 6-digit code.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="register-email" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Email address
              </label>
              <input
                id="register-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@leeds.ac.uk"
                required
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              />
            </div>

            <div>
              <label htmlFor="register-code" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Authenticator code
              </label>
              <input
                id="register-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-4 py-3 text-center text-lg font-mono tracking-[0.3em] text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-2.5 text-sm text-red-600 dark:text-red-400">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-600/25 transition hover:shadow-md hover:shadow-brand-600/30 disabled:opacity-50"
            >
              {loading ? 'Activating...' : 'Activate account'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
            Already set up?{' '}
            <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
