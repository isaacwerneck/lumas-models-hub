import type { InternalAxiosRequestConfig } from "axios";
import { AxiosError, AxiosHeaders } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  clearLegacyStoredAccessToken,
  getAccessToken,
  setAccessToken,
  subscribeSessionExpired
} from "../lib/api";

const rejectUnauthorized = (config: InternalAxiosRequestConfig) => Promise.reject(
  new AxiosError(
    "Unauthorized",
    "ERR_BAD_REQUEST",
    config,
    undefined,
    {
      data: { message: "Unauthorized" },
      status: 401,
      statusText: "Unauthorized",
      headers: new AxiosHeaders(),
      config
    }
  )
);

describe("cliente da API", () => {
  const originalAdapter = api.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setAccessToken(null);
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    vi.restoreAllMocks();
  });

  it("usa exclusivamente a versão v1", () => {
    expect(api.defaults.baseURL).toMatch(/\/api\/v1$/);
  });

  it("mantém o access token apenas em memória e remove o legado persistido", () => {
    localStorage.setItem("lumas_access_token", "token-legado");
    clearLegacyStoredAccessToken();
    setAccessToken("token-em-memoria");

    expect(getAccessToken()).toBe("token-em-memoria");
    expect(localStorage.getItem("lumas_access_token")).toBeNull();
    expect(sessionStorage.getItem("lumas_access_token")).toBeNull();
  });

  it("não tenta refresh quando o próprio login retorna 401", async () => {
    const calls: string[] = [];
    api.defaults.adapter = async (config) => {
      calls.push(String(config.url));
      return rejectUnauthorized(config);
    };

    await expect(api.post("/auth/login", { username: "x", password: "incorreta" })).rejects.toBeTruthy();
    expect(calls).toEqual(["/auth/login"]);
    expect(sessionStorage.getItem("lumas_session_expired")).toBeNull();
  });

  it("limpa a sessão e avisa a aplicação quando o refresh falha", async () => {
    const calls: string[] = [];
    const expired = vi.fn();
    const unsubscribe = subscribeSessionExpired(expired);
    setAccessToken("token-antigo");
    api.defaults.adapter = async (config) => {
      calls.push(String(config.url));
      return rejectUnauthorized(config);
    };

    await expect(api.get("/manager/chatters")).rejects.toBeTruthy();

    expect(calls).toEqual(["/manager/chatters", "/auth/refresh"]);
    expect(getAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("lumas_session_expired")).toBe("1");
    unsubscribe();
  });

  it("deduplica refreshes concorrentes e usa o lock compartilhado do navegador", async () => {
    const calls: string[] = [];
    const lockRequest = vi.fn(async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback());
    const originalLocks = navigator.locks;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: lockRequest }
    });
    setAccessToken("token-expirado");

    api.defaults.adapter = async (config) => {
      const url = String(config.url);
      calls.push(url);
      if (url === "/auth/refresh") {
        return {
          data: {
            accessToken: "token-renovado",
            user: { id: "1", username: "manager", displayName: "Manager", role: "MANAGER" }
          },
          status: 200,
          statusText: "OK",
          headers: new AxiosHeaders(),
          config
        };
      }

      if (config.headers.get("Authorization") === "Bearer token-renovado") {
        return { data: { ok: true }, status: 200, statusText: "OK", headers: new AxiosHeaders(), config };
      }

      return rejectUnauthorized(config);
    };

    await Promise.all([api.get("/manager/chatters"), api.get("/manager/tags")]);

    expect(calls.filter((url) => url === "/auth/refresh")).toHaveLength(1);
    expect(lockRequest).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBe("token-renovado");

    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: originalLocks
    });
  });
});
