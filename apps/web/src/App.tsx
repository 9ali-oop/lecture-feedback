import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import ProtectedRoute from './components/ProtectedRoute.tsx';
import Login from './pages/Login.tsx';
import Register from './pages/Register.tsx';
import AdminDashboard from './pages/admin/Dashboard.tsx';
import LecturerDashboard from './pages/lecturer/Dashboard.tsx';
import LecturerModule from './pages/lecturer/Module.tsx';
import LiveSession from './pages/lecturer/LiveSession.tsx';
import StudentDashboard from './pages/student/Dashboard.tsx';
import StudentSession from './pages/student/Session.tsx';
import StudentModule from './pages/student/Module.tsx';
import StudentSessionReport from './pages/student/SessionReport.tsx';
import SessionReport from './pages/lecturer/SessionReport.tsx';

function ImpersonationBanner() {
  const { impersonating, user, realAdmin, stopImpersonating } = useAuth();
  const navigate = useNavigate();

  if (!impersonating || !user) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-md">
      <span>
        Viewing as <strong>{user.name}</strong> ({user.role})
        {realAdmin && <span className="opacity-75"> &mdash; logged in as {realAdmin.name}</span>}
      </span>
      <button
        onClick={() => {
          stopImpersonating();
          navigate('/admin');
        }}
        className="rounded bg-white/20 px-3 py-1 text-xs font-semibold transition hover:bg-white/30"
      >
        Exit impersonation
      </button>
    </div>
  );
}

function RoleRouter() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (user.role === 'lecturer') return <Navigate to="/lecturer" replace />;
  return <Navigate to="/student" replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <BrowserRouter>
        <ImpersonationBanner />
        <Routes>
          {/* Landing page redirects based on the user's role */}
          <Route path="/" element={<RoleRouter />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Admin */}
          <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />

          {/* Lecturer */}
          <Route path="/lecturer" element={<ProtectedRoute allowedRoles={['lecturer', 'admin']}><LecturerDashboard /></ProtectedRoute>} />
          <Route path="/lecturer/module/:moduleId" element={<ProtectedRoute allowedRoles={['lecturer', 'admin']}><LecturerModule /></ProtectedRoute>} />
          <Route path="/lecturer/live/:sessionId" element={<ProtectedRoute allowedRoles={['lecturer', 'admin']}><LiveSession /></ProtectedRoute>} />
          <Route path="/lecturer/report/:sessionId" element={<ProtectedRoute allowedRoles={['lecturer', 'admin']}><SessionReport /></ProtectedRoute>} />

          {/* Student */}
          <Route path="/student" element={<ProtectedRoute allowedRoles={['student']}><StudentDashboard /></ProtectedRoute>} />
          <Route path="/student/session/:sessionId" element={<ProtectedRoute allowedRoles={['student']}><StudentSession /></ProtectedRoute>} />
          <Route path="/student/module/:moduleId" element={<ProtectedRoute allowedRoles={['student']}><StudentModule /></ProtectedRoute>} />
          <Route path="/student/report/:sessionId" element={<ProtectedRoute allowedRoles={['student']}><StudentSessionReport /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}
