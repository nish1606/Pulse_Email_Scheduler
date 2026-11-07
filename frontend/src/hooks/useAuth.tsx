import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, API_URL } from "../services/api";
import type { User } from "../types";

type AuthState = {
  loading: boolean;
  authenticated: boolean;
  user: User | null;
  refresh: () => Promise<void>;
  login: () => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api<{ authenticated: boolean; user: User | null }>("/api/auth/me");
      setAuthenticated(!!data.authenticated);
      setUser(data.user ?? null);
    } catch {
      setAuthenticated(false);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const login = () => {
    // Real Google OAuth redirect (backend handles OAuth flow)
    window.location.href = `${API_URL}/api/auth/google?redirect=1`;
  };

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setAuthenticated(false);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ loading, authenticated, user, refresh, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
