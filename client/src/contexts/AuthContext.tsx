import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useQueryClient } from 'react-query';
import axios from 'axios';
import api, { API_BASE_URL, AUTH_EXPIRED_EVENT } from '@/lib/api.ts';
import { resolveSession } from '@/lib/session.ts';
import { useNavigate } from 'react-router-dom';

export type UserRole = 'admin' | 'teacher' | 'student';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  date_of_birth?: string | null;
  address?: string | null;
  avatar_url?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Reloads the signed-in person from the API (for example after changing their picture). */
  refreshUser: () => Promise<void>;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // `initial` is true when the app is starting. Only then may a failed check show the sign-in page;
  // a later refresh (for example after changing a picture) never signs anyone out because the
  // server was briefly busy.
  const loadUser = useCallback(async (initial: boolean) => {
    const result = await resolveSession<AuthUser>({
      getMe: async () => (await api.get<{ user: AuthUser }>('/auth/me')).data.user,
      refresh: async () => {
        const { data } = await axios.post<{ access_token: string }>(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        localStorage.setItem('access_token', data.access_token);
      },
      statusOf: (error) => (axios.isAxiosError(error) ? error.response?.status : undefined),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });

    if (result.kind === 'signed-in') {
      setUser(result.user);
    } else if (result.kind === 'signed-out') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      setUser(null);
    } else if (initial) {
      setUser(null);
    }
    setIsLoading(false);
  }, []);

  const refreshUser = useCallback(() => loadUser(false), [loadUser]);

  useEffect(() => {
    loadUser(true);
  }, [loadUser]);

  // The session ended while the app was open (e.g. the account was deactivated).
  useEffect(() => {
    const onExpired = () => {
      queryClient.clear();
      setUser(null);
      navigate('/login', { replace: true });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [navigate, queryClient]);

  const login = async (email: string, password: string) => {
    const { data } = await api.post<{ user: AuthUser; access_token: string }>(
      '/auth/login',
      { email, password },
    );
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    // Pages cache what the server sent to the PREVIOUS person (a teacher's quizzes carry
    // "can manage" flags, drafts, class results). Drop it all so the next person only ever
    // sees data fetched with their own sign-in.
    queryClient.clear();
    setUser(data.user);
    navigate('/');
  };

  const logout = () => {
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    queryClient.clear();
    setUser(null);
    navigate('/login');
  };

  const hasRole = (roles: UserRole | UserRole[]) => {
    if (!user) return false;
    const allowed = Array.isArray(roles) ? roles : [roles];
    return allowed.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, refreshUser, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
