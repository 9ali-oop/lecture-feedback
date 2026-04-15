import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useViewMode } from '../contexts/ViewModeContext.tsx';
import { roleHome } from '../lib/roles.ts';

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  back?: string;
}

function ViewModeToggle() {
  const { mode, toggle } = useViewMode();
  return (
    <button
      onClick={toggle}
      className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      title={`Switch to ${mode === 'desktop' ? 'phone' : 'desktop'} view`}
    >
      {mode === 'desktop' ? (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
    >
      {resolved === 'dark' ? (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  );
}

export default function Layout({ children, title, back }: LayoutProps) {
  const { user, logout, impersonating, stopImpersonating } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const home = impersonating ? '/admin' : user ? roleHome(user.role) : '/login';

  function handleHomeClick() {
    if (impersonating) {
      stopImpersonating();
    }
    navigate(home);
  }

  const roleLabel = user?.role === 'admin' ? 'Admin' : user?.role === 'lecturer' ? 'Lecturer' : 'Student';

  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors${impersonating ? ' pt-10' : ''}`}>
      <header className="border-b border-gray-100/80 dark:border-gray-800/80 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {back && (
              <button
                onClick={() => navigate(back)}
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {!back && (
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm shadow-brand-500/25">
                <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            )}
            <button
              onClick={handleHomeClick}
              className="font-semibold text-gray-900 dark:text-gray-100 transition hover:text-brand-600"
            >
              {title ?? 'LectureFlow'}
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ViewModeToggle />
            <ThemeToggle />
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{user?.name}</div>
              <div className="text-[10px] text-gray-400 dark:text-gray-400">{roleLabel}</div>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 sm:px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
