import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    // If an unauthenticated user lands on a student session URL (e.g. by copying
    // the lecturer's address bar instead of the join QR), send them to the
    // join-flow for that session instead of the generic login page.
    const sessionMatch = location.pathname.match(/^\/student\/session\/([^/]+)$/);
    if (sessionMatch) {
      return <Navigate to={`/join/${sessionMatch[1]}`} replace />;
    }
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect to the user's own dashboard if they hit a wrong-role route
    if (user.role === 'admin') return <Navigate to="/admin" replace />;
    if (user.role === 'lecturer') return <Navigate to="/lecturer" replace />;
    return <Navigate to="/student" replace />;
  }

  return <>{children}</>;
}
