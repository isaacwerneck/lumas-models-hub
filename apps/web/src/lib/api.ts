import axios from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import type { AuthUser } from "../types";
import { API_URL } from "./runtime";

const API_V1_URL = `${API_URL.replace(/\/$/, "")}/api/v1`;
const LEGACY_ACCESS_TOKEN_KEY = "lumas_access_token";
const REFRESH_LOCK_NAME = "lumas-auth-refresh";

export type AuthSessionPayload = {
  accessToken: string;
  user: AuthUser;
};

export type SessionRefreshResult =
  | { status: "authenticated"; session: AuthSessionPayload }
  | { status: "anonymous" }
  | { status: "unavailable" };

let accessToken: string | null = null;

type TrackedRequestConfig = InternalAxiosRequestConfig & { _pageLoadTracked?: boolean };
const pageLoadListeners = new Set<(pendingRequests: number) => void>();
let pendingPageLoadRequests = 0;

const emitPageLoadActivity = () => {
  for (const listener of pageLoadListeners) listener(pendingPageLoadRequests);
};

const startPageLoadRequest = (config: TrackedRequestConfig) => {
  if ((config.method ?? "get").toLowerCase() !== "get" || config._pageLoadTracked) return;
  config._pageLoadTracked = true;
  pendingPageLoadRequests += 1;
  emitPageLoadActivity();
};

const finishPageLoadRequest = (config?: TrackedRequestConfig) => {
  if (!config?._pageLoadTracked) return;
  config._pageLoadTracked = false;
  pendingPageLoadRequests = Math.max(0, pendingPageLoadRequests - 1);
  emitPageLoadActivity();
};

export const getPendingPageLoadRequests = () => pendingPageLoadRequests;

export const subscribePageLoadActivity = (listener: (pendingRequests: number) => void) => {
  pageLoadListeners.add(listener);
  return () => pageLoadListeners.delete(listener);
};

export const clearLegacyStoredAccessToken = () => {
  try {
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
};

clearLegacyStoredAccessToken();

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

export const api = axios.create({
  baseURL: API_V1_URL,
  withCredentials: true
});

const sessionExpiredListeners = new Set<() => void>();
export const subscribeSessionExpired = (listener: () => void) => {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
};

const emitSessionExpired = () => {
  try {
    sessionStorage.setItem("lumas_session_expired", "1");
  } catch {
    // The in-memory session is still cleared even when storage is unavailable.
  }
  for (const listener of sessionExpiredListeners) listener();
};

let refreshPromise: Promise<SessionRefreshResult> | null = null;

const withCrossTabRefreshLock = async <T>(task: () => Promise<T>): Promise<T> => {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    return task();
  }

  return navigator.locks.request(REFRESH_LOCK_NAME, { mode: "exclusive" }, task);
};

const requestSessionRefresh = async (): Promise<SessionRefreshResult> => {
  if (!refreshPromise) {
    refreshPromise = withCrossTabRefreshLock(async () => {
      try {
        const response = await api.post<AuthSessionPayload>("/auth/refresh");
        setAccessToken(response.data.accessToken);
        return { status: "authenticated", session: response.data } as const;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          setAccessToken(null);
          return { status: "anonymous" } as const;
        }

        return { status: "unavailable" } as const;
      }
    }).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
};

export const refreshSession = async ({ notifyOnUnauthorized = false } = {}): Promise<SessionRefreshResult> => {
  const result = await requestSessionRefresh();
  if (result.status === "anonymous" && notifyOnUnauthorized) {
    emitSessionExpired();
  }
  return result;
};

api.interceptors.request.use((config) => {
  startPageLoadRequest(config as TrackedRequestConfig);
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    finishPageLoadRequest(response.config as TrackedRequestConfig);
    return response;
  },
  async (error) => {
    finishPageLoadRequest(error?.config as TrackedRequestConfig | undefined);
    const status = error?.response?.status;
    const originalRequest = error?.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const requestUrl = String(originalRequest?.url ?? "");
    const isAuthCall = ["/auth/login", "/auth/refresh", "/auth/logout"].some((path) => requestUrl.includes(path));

    if (status !== 401 || !originalRequest || originalRequest._retry || isAuthCall) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    const refreshResult = await refreshSession({ notifyOnUnauthorized: true });

    if (refreshResult.status !== "authenticated") {
      return Promise.reject(error);
    }

    originalRequest.headers = {
      ...(originalRequest.headers ?? {}),
      Authorization: `Bearer ${refreshResult.session.accessToken}`
    };

    return api.request(originalRequest);
  }
);

export const downloadApiFile = async (path: string, filename: string, params?: Record<string, string>) => {
  const response = await api.get(path, { params, responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
