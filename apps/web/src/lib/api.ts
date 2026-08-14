import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

let accessToken: string | null = localStorage.getItem("lumas_access_token");

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  if (token) {
    localStorage.setItem("lumas_access_token", token);
  } else {
    localStorage.removeItem("lumas_access_token");
  }
};

export const getAccessToken = () => accessToken;

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true
});

let refreshPromise: Promise<string | null> | null = null;

const refreshAccessToken = async () => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await api.post("/auth/refresh");
        const token = response.data?.accessToken ?? null;
        setAccessToken(token);
        return token;
      } catch {
        setAccessToken(null);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
};

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const originalRequest = error?.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const requestUrl = String(originalRequest?.url ?? "");
    const isRefreshCall = requestUrl.includes("/auth/refresh");

    if (status !== 401 || !originalRequest || originalRequest._retry || isRefreshCall) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    const newToken = await refreshAccessToken();

    if (!newToken) {
      return Promise.reject(error);
    }

    originalRequest.headers = {
      ...(originalRequest.headers ?? {}),
      Authorization: `Bearer ${newToken}`
    };

    return api.request(originalRequest);
  }
);
