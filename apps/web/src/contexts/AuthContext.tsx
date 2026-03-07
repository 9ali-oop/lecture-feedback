import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, StudentProfile } from '@lecture-feedback/shared';
import { api } from '../lib/api.ts';

interface AuthState {
  user: User | null;
  studentProfile: StudentProfile | null;
  token: string | null;
  loading: boolean;
  impersonating: boolean;
  realAdmin: User | null;
}

interface AuthContextValue extends AuthState {
  login: (token: string, user: User, studentProfile?: StudentProfile) => void;
  logout: () => void;
  impersonate: (userId: string) => Promise<void>;
  stopImpersonating: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    studentProfile: null,
    token: localStorage.getItem('token'),
    loading: true,
    impersonating: false,
    realAdmin: null,
  });

  useEffect(() => {
    // Check if we have an impersonation token in sessionStorage (tab-scoped)
    const impersonateToken = sessionStorage.getItem('impersonate_token');
    const token = impersonateToken ?? localStorage.getItem('token');
    if (!token) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    api.me()
      .then(({ user, studentProfile }) => {
        if (impersonateToken) {
          // Restore realAdmin from sessionStorage
          const realAdminJson = sessionStorage.getItem('real_admin');
          const realAdmin = realAdminJson ? JSON.parse(realAdminJson) as User : null;
          setState({ user, studentProfile: studentProfile ?? null, token, loading: false, impersonating: true, realAdmin });
        } else {
          setState({ user, studentProfile: studentProfile ?? null, token, loading: false, impersonating: false, realAdmin: null });
        }
      })
      .catch(() => {
        localStorage.removeItem('token');
        sessionStorage.removeItem('impersonate_token');
        sessionStorage.removeItem('real_admin');
        setState({ user: null, studentProfile: null, token: null, loading: false, impersonating: false, realAdmin: null });
      });
  }, []);

  const login = useCallback((token: string, user: User, studentProfile?: StudentProfile) => {
    localStorage.setItem('token', token);
    setState({ user, studentProfile: studentProfile ?? null, token, loading: false, impersonating: false, realAdmin: null });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    sessionStorage.removeItem('impersonate_token');
    sessionStorage.removeItem('real_admin');
    setState({ user: null, studentProfile: null, token: null, loading: false, impersonating: false, realAdmin: null });
  }, []);

  const impersonate = useCallback(async (userId: string) => {
    const result = await api.impersonateUser(userId);
    // Save current admin user so we can restore later
    sessionStorage.setItem('real_admin', JSON.stringify(state.user));
    sessionStorage.setItem('impersonate_token', result.token);
    setState({
      user: result.user,
      studentProfile: result.studentProfile ?? null,
      token: result.token,
      loading: false,
      impersonating: true,
      realAdmin: state.user,
    });
  }, [state.user]);

  const stopImpersonating = useCallback(() => {
    sessionStorage.removeItem('impersonate_token');
    sessionStorage.removeItem('real_admin');
    const token = localStorage.getItem('token');
    if (token) {
      // Re-fetch admin user from the real token
      setState((s) => ({ ...s, loading: true }));
      api.me()
        .then(({ user, studentProfile }) => {
          setState({ user, studentProfile: studentProfile ?? null, token, loading: false, impersonating: false, realAdmin: null });
        })
        .catch(() => {
          localStorage.removeItem('token');
          setState({ user: null, studentProfile: null, token: null, loading: false, impersonating: false, realAdmin: null });
        });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, impersonate, stopImpersonating }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
