export type ApiIssue = { field?: string; message?: string };
type ApiError = {
  code?: string;
  message?: string;
  name?: string;
  response?: { status?: number; data?: { code?: string; message?: string; issues?: ApiIssue[]; error?: { code?: string; message?: string; issues?: ApiIssue[]; requestId?: string } } };
  request?: unknown;
};

export type NormalizedApiError = { code: string; message: string; issues: ApiIssue[]; requestId?: string };

const isUnsafeLibraryMessage = (message?: string) => !message || /network error|failed to fetch|timeout|axios|status code|load failed|prisma|tesseract|googleapis|sqlstate|econn|enotfound|stack trace|<!doctype|\bat\s+[\w$.<>]+\s*\(/i.test(message);

export const normalizeApiError = (error: unknown, fallback: string): NormalizedApiError => {
  const apiError = error as ApiError;
  const data = apiError.response?.data;
  const normalized = data?.error ?? data;
  if (normalized?.message) {
    return {
      code: normalized.code ?? data?.code ?? "REQUEST_ERROR",
      message: isUnsafeLibraryMessage(normalized.message) ? fallback : normalized.message,
      issues: normalized.issues ?? [],
      requestId: "requestId" in normalized ? normalized.requestId : undefined
    };
  }
  if (apiError.request || apiError.code === "ERR_NETWORK") {
    return { code: "NETWORK_ERROR", message: "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.", issues: [] };
  }
  return { code: apiError.code ?? "UNEXPECTED_ERROR", message: isUnsafeLibraryMessage(apiError.message) ? fallback : apiError.message!, issues: [] };
};

export const getApiErrorMessage = (error: unknown, fallback: string, includeIssues = false) => {
  const normalized = normalizeApiError(error, fallback);
  if (includeIssues && normalized.issues.length) {
    const details = normalized.issues.map((issue) => `${issue.field ?? "campo"}: ${issue.message ?? "inválido"}`).join("; ");
    return `${normalized.message} (${details})`;
  }
  return normalized.message;
};
