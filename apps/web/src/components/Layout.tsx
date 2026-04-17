import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';
import { roleHome } from '../lib/roles.ts';
import AccessibilityToggles from './AccessibilityToggles.tsx';

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  back?: string;
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
      <a href="#main-content" className="skip-link">Skip to main content</a>
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
            <AccessibilityToggles variant="header" />
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{user?.name}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">{roleLabel}</div>
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

      <main id="main-content" className="mx-auto max-w-5xl px-3 sm:px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
