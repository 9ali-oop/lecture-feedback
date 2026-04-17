import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { roleHome } from '../lib/roles.ts';
import AccessibilityToggles from '../components/AccessibilityToggles.tsx';

export default function Login() {
  const navigate = useNavigate();
  const { login, user, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
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

  async function doLogin(emailValue: string, codeValue: string) {
    setError('');
    setLoading(true);
    try {
      const { token, user, studentProfile } = await api.verify(emailValue.trim(), codeValue.trim());
      login(token, user, studentProfile);

      if (user.role === 'admin') navigate('/admin', { replace: true });
      else if (user.role === 'lecturer') navigate('/lecturer', { replace: true });
      else navigate('/student', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  // Auto-login via URL params: /login?email=X&code=Y&autosubmit=1
  // Used for study-day QR codes so participants don't have to type anything.
  // Fires once auth has finished loading and only if no one is currently signed in.
  const [autoTried, setAutoTried] = useState(false);
  useEffect(() => {
    if (authLoading || autoTried) return;
    const urlEmail = searchParams.get('email');
    const urlCode = searchParams.get('code');
    const autosubmit = searchParams.get('autosubmit') === '1';
    if (urlEmail) setEmail(urlEmail);
    if (urlCode) setCode(urlCode);
    if (autosubmit && urlEmail && urlCode && !user) {
      setAutoTried(true);
      doLogin(urlEmail, urlCode);
    } else if (urlEmail || urlCode) {
      // Only auto-fill; no submit
      setAutoTried(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, autoTried]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doLogin(email, code);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 px-4">
      {/* View mode + Theme + Dyslexia toggles */}
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
          <h2 className="mb-6 text-lg font-semibold text-gray-900 dark:text-gray-100">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@leeds.ac.uk"
                required
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:border-blue-500 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              />
            </div>

            <div>
              <label htmlFor="login-code" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Authenticator code
              </label>
              <input
                id="login-code"
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
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                6-digit code from your authenticator app
              </p>
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
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
            First time?{' '}
            <Link to="/register" className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
              Set up your account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
