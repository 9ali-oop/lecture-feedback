import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';
import { roleHome } from '../lib/roles.ts';

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

  // When impersonating, home always goes back to admin
  const home = impersonating ? '/admin' : user ? roleHome(user.role) : '/login';

  function handleHomeClick() {
    if (impersonating) {
      stopImpersonating();
    }
    navigate(home);
  }

  return (
    <div className={`min-h-screen bg-gray-50${impersonating ? ' pt-10' : ''}`}>
      <header className="border-b border-gray-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {back && (
              <button
                onClick={() => navigate(back)}
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <button
              onClick={handleHomeClick}
              className="font-semibold text-gray-900 transition hover:text-blue-600"
            >
              {title ?? 'LectureFlow'}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{user?.name}</span>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
