'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';
import { getSocket, disconnectSocket } from './socket';
import type { AuthUser, UserRole } from '@arihant/shared';

/**
 * Demo persona shortcuts (login quick-roles, persona switcher FAB, 403 role switch) exist only in development builds
 * or when a deployment opts in with NEXT_PUBLIC_ENABLE_DEMO_PERSONAS=true. They call POST /auth/demo-login, which the
 * API serves only when it is enabled there too (DEMO_LOGIN_ENABLED) — no password is ever shipped to the browser.
 */
export const DEMO_PERSONAS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEMO_PERSONAS === 'true' ||
  (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ENABLE_DEMO_PERSONAS !== 'false');

export const PRESET_ROLE_USERS: Record<
  UserRole,
  { name: string; email: string; title: string; zone: string; color: string }
> = {
  management: {
    name: 'Rajiv Arihant',
    email: 'mgmt@arihant.com',
    title: 'Managing Director & CEO',
    zone: 'HQ / All India',
    color: 'bg-[#E3EFEE] text-[#0F5E63] border-[#DCD8CE]',
  },
  regional_manager: {
    name: 'Vikram Sharma',
    email: 'regmgr.north@arihant.com',
    title: 'Regional Manager (North Zone)',
    zone: 'North Zone',
    color: 'bg-[#EEF1F5] text-[#14213D] border-[#DCD8CE]',
  },
  sales: {
    name: 'Amit Verma',
    email: 'sales.delhi@arihant.com',
    title: 'Senior Sales Executive',
    zone: 'Delhi NCR & North',
    color: 'bg-[#E3EFEE] text-[#0B4A4E] border-[#D0E5E3]',
  },
  tender_team: {
    name: 'Suresh Nair',
    email: 'tender@arihant.com',
    title: 'Tender Operations Lead',
    zone: 'National GeM Cell',
    color: 'bg-[#FFF8EB] text-[#7C2D12] border-[#E9C9B4]',
  },
  demo_team: {
    name: 'Ramesh Patel',
    email: 'demo@arihant.com',
    title: 'Demo & Trials Specialist',
    zone: 'North Depot (Delhi)',
    color: 'bg-[#E3EFEE] text-[#0B4A4E] border-[#D0E5E3]',
  },
  service_team: {
    name: 'Anil Kumar',
    email: 'service@arihant.com',
    title: 'Chief Service Engineer',
    zone: 'North Service Depot',
    color: 'bg-[#E3EFEE] text-[#0B4A4E] border-[#D0E5E3]',
  },
  accounts: {
    name: 'Kavita Rao',
    email: 'accounts@arihant.com',
    title: 'Head of Finance & Billing',
    zone: 'Corporate Accounts',
    color: 'bg-[#E3EFEE] text-[#0B4A4E] border-[#D0E5E3]',
  },
  admin: {
    name: 'System Admin',
    email: 'admin@arihant.com',
    title: 'System Administrator',
    zone: 'Infrastructure',
    color: 'bg-[#ECE9E2] text-[#14213D] border-[#DCD8CE]',
  },
};

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Signs in as a demo persona (dev / opted-in builds only; the API decides whether demo sign-in is allowed). */
  demoLogin: (role: UserRole) => Promise<void>;
  logout: () => void;
  switchRole: (role: UserRole) => Promise<void>;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const fetchProfile = useCallback(async () => {
    try {
      const storedToken = localStorage.getItem('arihant_auth_token');
      if (!storedToken) {
        setUser(null);
        setToken(null);
        setIsLoading(false);
        return;
      }

      setToken(storedToken);
      const profile = await api.get<AuthUser>('/auth/me');
      setUser(profile);
      getSocket();
    } catch {
      localStorage.removeItem('arihant_auth_token');
      setUser(null);
      setToken(null);
      disconnectSocket();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Warm the sign-in route so signing out never leaves an empty screen while it compiles / downloads.
  useEffect(() => {
    router.prefetch?.('/login');
  }, [router]);

  const login = (email: string, password: string) => startSession(api.post('/auth/login', { email, password }));

  const startSession = async (request: Promise<any>) => {
    setIsLoading(true);
    try {
      const res = await request;
      const authToken = res.accessToken || res.token;
      localStorage.setItem('arihant_auth_token', authToken);
      if (typeof document !== 'undefined') {
        document.cookie = `arihant_auth_token=${authToken}; path=/; max-age=86400; SameSite=Lax`;
        document.cookie = `sb-access-token=${authToken}; path=/; max-age=86400; SameSite=Lax`;
      }
      setToken(authToken);
      setUser(res.user);
      getSocket();
      router.replace('/dashboard');
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const demoLogin = async (role: UserRole) => {
    if (!DEMO_PERSONAS_ENABLED) throw new Error('Persona switching is disabled in this environment. Sign out and sign in as that user.');
    await startSession(api.post('/auth/demo-login', { role }));
  };

  const switchRole = demoLogin;

  const logout = async () => {
    // Revoke server-side in the background: the user must land on /login at once, not after a slow request.
    api.post('/auth/logout').catch(() => {
      // ignore network errors on logout
    });
    localStorage.removeItem('arihant_auth_token');
    if (typeof document !== 'undefined') {
      document.cookie = 'arihant_auth_token=; path=/; max-age=0; SameSite=Lax';
      document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax';
    }
    disconnectSocket();
    setUser(null);
    setToken(null);
    router.replace('/login');
  };

  const hasRole = (roles: UserRole | UserRole[]): boolean => {
    if (!user) return false;
    if (Array.isArray(roles)) {
      return roles.includes(user.role);
    }
    return user.role === roles;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        logout,
        demoLogin,
        switchRole,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
