import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  getAccessToken,
  refreshSession,
  setAccessToken,
  subscribeSessionExpired
} from "../lib/api";
import type { AuthSessionPayload } from "../lib/api";
import type { AuthUser } from "../types";

export type AuthStatus = "restoring" | "authenticated" | "anonymous" | "unavailable";

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  retrySession: () => Promise<boolean>;
};

type AuthChannelMessage = {
  type: "login" | "logout" | "session-expired";
};

const AUTH_CHANNEL_NAME = "lumas-auth";
const PERSISTENCE_SUPPRESSED_KEY = "lumas_persistent_login_suppressed";

const isPersistenceSuppressed = () => {
  try {
    return localStorage.getItem(PERSISTENCE_SUPPRESSED_KEY) === "1";
  } catch {
    return false;
  }
};

const setPersistenceSuppressed = (suppressed: boolean) => {
  try {
    if (suppressed) {
      localStorage.setItem(PERSISTENCE_SUPPRESSED_KEY, "1");
    } else {
      localStorage.removeItem(PERSISTENCE_SUPPRESSED_KEY);
    }
  } catch {
    // The cookie-backed session still works when local storage is unavailable.
  }
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("restoring");
  const statusRef = useRef<AuthStatus>("restoring");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const bootstrapStartedRef = useRef(false);

  const updateStatus = useCallback((nextStatus: AuthStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const restoreSession = useCallback(async ({ ignoreSuppression = false } = {}): Promise<boolean> => {
    if (!ignoreSuppression && isPersistenceSuppressed()) {
      setAccessToken(null);
      setUser(null);
      updateStatus("anonymous");
      return false;
    }

    updateStatus("restoring");
    const result = await refreshSession();

    if (result.status === "authenticated") {
      setUser(result.session.user);
      updateStatus("authenticated");
      return true;
    }

    if (result.status === "anonymous") {
      setAccessToken(null);
      setUser(null);
      updateStatus("anonymous");
      return false;
    }

    setUser(null);
    updateStatus("unavailable");
    return false;
  }, [updateStatus]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api.post<AuthSessionPayload>("/auth/login", {
      username,
      password
    });

    setPersistenceSuppressed(false);
    setAccessToken(response.data.accessToken);
    setUser(response.data.user);
    updateStatus("authenticated");
    channelRef.current?.postMessage({ type: "login" } satisfies AuthChannelMessage);
    return response.data.user;
  }, [updateStatus]);

  const logout = useCallback(async () => {
    const token = getAccessToken();
    setPersistenceSuppressed(true);
    setAccessToken(null);
    setUser(null);
    updateStatus("anonymous");
    channelRef.current?.postMessage({ type: "logout" } satisfies AuthChannelMessage);

    try {
      await api.post("/auth/logout", undefined, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
    } catch {
      // The local opt-out prevents automatic restoration until the next login.
    }
  }, [updateStatus]);

  const retrySession = useCallback(() => restoreSession(), [restoreSession]);

  useEffect(() => {
    const unsubscribe = subscribeSessionExpired(() => {
      setAccessToken(null);
      setUser(null);
      updateStatus("anonymous");
      channelRef.current?.postMessage({ type: "session-expired" } satisfies AuthChannelMessage);
    });

    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
      channelRef.current = channel;
      channel.onmessage = (event: MessageEvent<AuthChannelMessage>) => {
        if (event.data?.type === "logout" || event.data?.type === "session-expired") {
          setAccessToken(null);
          setUser(null);
          updateStatus("anonymous");
          return;
        }

        if (event.data?.type === "login") {
          setPersistenceSuppressed(false);
          if (statusRef.current !== "authenticated") {
            void restoreSession({ ignoreSuppression: true });
          }
        }
      };
    }

    return () => {
      unsubscribe();
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [restoreSession, updateStatus]);

  useEffect(() => {
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    void restoreSession();
  }, [restoreSession]);

  const value = useMemo(
    () => ({
      user,
      status,
      login,
      logout,
      retrySession
    }),
    [user, status, login, logout, retrySession]
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
