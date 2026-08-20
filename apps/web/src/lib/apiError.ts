type ApiIssue = { field?: string; message?: string };
type ApiError = {
  message?: string;
  response?: { data?: { message?: string; issues?: ApiIssue[]; error?: { message?: string; issues?: ApiIssue[] } } };
};

export const getApiErrorMessage = (error: unknown, fallback: string, includeIssues = false) => {
  const apiError = error as ApiError;
  const data = apiError.response?.data;
  const normalized = data?.error ?? data;
  if (includeIssues && normalized?.issues?.length) {
    const details = normalized.issues.map((issue) => `${issue.field ?? "campo"}: ${issue.message ?? "inválido"}`).join("; ");
    return `${normalized.message ?? "Dados inválidos."} (${details})`;
  }
  return normalized?.message ?? apiError.message ?? fallback;
};
