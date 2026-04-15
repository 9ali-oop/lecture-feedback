import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';

/**
 * Anonymous join flow for guest participants.
 * Reached by scanning a QR shown on the lecturer's screen.
 *
 * We collect a first name and year of study before creating the account, so
 * the resulting student profile is identifiable in the post-session report
 * (e.g. "Alice (Y2)"). Stored verbatim in the user.name field so every
 * feedback event / question already shows the year inline.
 */
export default function Join() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login, logout, user, loading: authLoading } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [year, setYear] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  // Forced re-identify: append ?new=1 to the QR URL (or tap "Not me?" below)
  // and we clear the existing guest token so the form is always shown.
  const forceNew = searchParams.get('new') === '1';

  // Per-session "already joined" flag. Set on successful join for THIS session.
  // This is how we distinguish "refreshing an already-identified session" (skip
  // the form) from "fresh person on this phone who has an old token from a
  // previous session" (show the form).
  const joinedFlagKey = sessionId ? `lf.joined.${sessionId}` : '';
  const hasJoinedThisSession = !!joinedFlagKey && (() => {
    try { return localStorage.getItem(joinedFlagKey) === '1'; } catch { return false; }
  })();

  // Auto-route behaviour:
  //   - ?new=1 in the URL → force log out so the form shows.
  //   - Logged-in REAL student (non-guest email) → auto-enrol and navigate straight in.
  //     This is the common case: a student scans the QR on a session in a module
  //     they may or may not be enrolled in. The /join/:id/enroll endpoint is
  //     idempotent, so it's safe whether or not they're already enrolled.
  //   - Logged-in guest AND joined THIS session already (refresh case) → straight in.
  //   - Logged-in guest but no flag for this session (cross-session carryover) →
  //     log them out so the form shows — they're a new participant for this session.
  //   - No token → form shows.
  useEffect(() => {
    if (!sessionId || authLoading) return;
    if (forceNew && user) {
      try { localStorage.removeItem(joinedFlagKey); } catch { /* ignore */ }
      logout();
      return;
    }
    if (user && user.role === 'student') {
      const isGuest = user.email.startsWith('guest-');
      if (!isGuest) {
        // Real student — ensure enrolment, then drop them straight into the session.
        const token = localStorage.getItem('token') ?? '';
        void fetch(`/api/join/${sessionId}/enroll`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
          .catch(() => { /* non-fatal: session page will surface any real error */ })
          .finally(() => {
            try { localStorage.setItem(joinedFlagKey, '1'); } catch { /* ignore */ }
            navigate(`/student/session/${sessionId}`, { replace: true });
          });
        return;
      }
      if (hasJoinedThisSession) {
        navigate(`/student/session/${sessionId}`, { replace: true });
      } else {
        // Guest token left over from a different session — force re-identify.
        logout();
      }
    }
  }, [sessionId, authLoading, user, navigate, forceNew, logout, hasJoinedThisSession, joinedFlagKey]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!sessionId || submittedRef.current) return;

    const trimmedName = firstName.trim();
    if (!trimmedName) {
      setError('Please enter your first name');
      return;
    }
    if (!year) {
      setError('Please pick your year of study');
      return;
    }

    submittedRef.current = true;
    setSubmitting(true);
    setError(null);

    // Final display name includes the year so the report breaks down feedback
    // by year without an extra database column.
    const displayName = `${trimmedName} (Y${year})`;

    try {
      const res = await fetch(`/api/join/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: displayName }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
        throw new Error(errJson.error ?? 'Could not join');
      }
      const data = await res.json() as {
        token: string;
        user: Parameters<typeof login>[1];
        studentProfile?: Parameters<typeof login>[2];
        sessionId: string;
      };
      login(data.token, data.user, data.studentProfile);
      // Mark this session as "identified on this device" so refreshes skip the form.
      try { localStorage.setItem(`lf.joined.${data.sessionId}`, '1'); } catch { /* ignore */ }
      navigate(`/student/session/${data.sessionId}`, { replace: true });
    } catch (e) {
      submittedRef.current = false;
      setSubmitting(false);
      setError(e instanceof Error ? e.message : 'Could not join session');
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/25">
            <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">LectureFlow</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Join the session</p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl shadow-gray-200/60 dark:shadow-black/20 ring-1 ring-gray-100 dark:ring-gray-800"
        >
          <div>
            <label htmlFor="first-name" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              First name
            </label>
            <input
              id="first-name"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Alice"
              autoComplete="given-name"
              maxLength={40}
              autoFocus
              disabled={submitting}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-4 py-3 text-base text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:opacity-50"
            />
            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">Used only on the researcher's dashboard. Anonymous in the report.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Year of study
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYear(String(y))}
                  disabled={submitting}
                  className={`rounded-xl border py-3 text-sm font-semibold transition active:scale-95 ${
                    year === String(y)
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-2 ring-blue-100 dark:ring-blue-800'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  Y{y}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-2.5 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !firstName.trim() || !year}
            className="w-full rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-3 text-base font-semibold text-white shadow-sm shadow-brand-600/25 transition hover:shadow-md hover:shadow-brand-600/30 disabled:opacity-50 min-h-[48px]"
          >
            {submitting ? 'Joining...' : 'Join session'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
          You can leave at any time. No account signup required.
        </p>

        {/* Escape hatch: if a prior participant on this phone left a token behind,
            tapping "Not me?" wipes it and shows the form fresh. */}
        {user && (
          <p className="mt-3 text-center text-xs text-gray-400 dark:text-gray-500">
            Signed in as <span className="font-medium text-gray-600 dark:text-gray-300">{user.name}</span>.
            {' '}
            <button
              type="button"
              onClick={() => { logout(); submittedRef.current = false; }}
              className="underline hover:text-blue-600 dark:hover:text-blue-400"
            >
              Not you? Sign in as someone else
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
