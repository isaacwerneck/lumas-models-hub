import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, setAccessToken } from "../lib/api";
import type { AuthUser } from "../types";

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = async (): Promise<boolean> => {
    try {
      const response = await api.post("/auth/refresh");
      setAccessToken(response.data.accessToken);
      setUser(response.data.user);
      return true;
    } catch {
      setAccessToken(null);
      setUser(null);
      return false;
    }
  };

  const login = async (username: string, password: string) => {
    const response = await api.post("/auth/login", {
      username,
      password
    });

    setAccessToken(response.data.accessToken);
    setUser(response.data.user);
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  };

  useEffect(() => {
    void (async () => {
      await refresh();
      setReady(true);
    })();
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      login,
      logout,
      refresh
    }),
    [user, ready]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
};
