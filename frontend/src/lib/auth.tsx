import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { User } from '../types';

const TOKEN_STORAGE_KEY = 'plotter_token';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    api
      .me(token)
      .then((response) => setUser(response.user))
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login({ email, password });
    localStorage.setItem(TOKEN_STORAGE_KEY, response.token);
    sessionStorage.setItem('temp_user_pwd', password);
    setToken(response.token);
    setUser(response.user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const response = await api.register({ name, email, password });
    localStorage.setItem(TOKEN_STORAGE_KEY, response.token);
    sessionStorage.setItem('temp_user_pwd', password);
    setToken(response.token);
    setUser(response.user);
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // token pode ja estar expirado, seguimos limpando o estado local mesmo assim
      }
    }
    sessionStorage.removeItem('temp_user_pwd');
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, [token]);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, isLoading, login, register, logout, updateUser }),
    [user, token, isLoading, login, register, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth precisa ser usado dentro de um AuthProvider.');
  }
  return context;
}

export { ApiError };
