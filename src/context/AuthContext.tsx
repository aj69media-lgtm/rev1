import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, setApiToken } from '../lib/api';

export interface PermissionEntry {
  module_slug: string;
  action: string;
}

export interface UserProfile {
  id: number;
  email: string;
  full_name: string;
  role_id: number;
  role_slug: string;
  role_name: string;
  is_client_role: boolean;
  job_title: string;
  phone: string;
  permissions: PermissionEntry[];
  assigned_project_ids: number[];
  client_ids: number[];
}

interface AuthStatus {
  requiresBootstrap: boolean;
  hasAdminPasscodeEnv: boolean;
  companyName: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  authStatus: AuthStatus | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  bootstrapAdmin: (payload: {
    fullName: string;
    email: string;
    password: string;
    companyName: string;
    seedDemoData: boolean;
    demoStaffPassword?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (moduleSlug: string, action: string) => boolean;
  refreshStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await apiRequest<AuthStatus>('/api/auth/status');
      setAuthStatus(status);
    } catch {
      // Offline fallback if status fails
      setAuthStatus({ requiresBootstrap: false, hasAdminPasscodeEnv: false, companyName: 'BuildCore CBMS' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setApiToken(res.token);
    setTokenState(res.token);
    setUser(res.user);
  }, []);

  const bootstrapAdmin = useCallback(
    async (payload: {
      fullName: string;
      email: string;
      password: string;
      companyName: string;
      seedDemoData: boolean;
      demoStaffPassword?: string;
    }) => {
      const res = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/bootstrap-admin', {
        method: 'POST',
        body: payload,
      });
      setApiToken(res.token);
      setTokenState(res.token);
      setUser(res.user);
      setAuthStatus((prev) => (prev ? { ...prev, requiresBootstrap: false, companyName: payload.companyName } : prev));
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    setApiToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  const hasPerm = useCallback(
    (moduleSlug: string, action: string) => {
      if (!user) return false;
      if (user.role_slug === 'system_admin') return true;
      return user.permissions.some((p) => p.module_slug === moduleSlug && p.action === action);
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        authStatus,
        loading,
        login,
        bootstrapAdmin,
        logout,
        hasPerm,
        refreshStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
