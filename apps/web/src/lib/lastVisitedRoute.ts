import type { AuthUser, Role } from "../types";

const LAST_ROUTE_PREFIX = "lumas:last-visited:";

const defaultRouteByRole: Record<Role, string> = {
  MANAGER: "/home",
  CHATTER: "/horarios"
};

const managerRoutes = [
  /^\/home$/,
  /^\/chatters(?:\/[^/]+)?$/,
  /^\/pagamentos$/,
  /^\/central-modelo$/,
  /^\/funcionario-do-mes$/,
  /^\/auditoria$/,
  /^\/config$/
];

const chatterRoutes = [
  /^\/horarios$/,
  /^\/pagamento$/,
  /^\/central-modelo$/,
  /^\/funcionario-do-mes$/,
  /^\/config$/
];

export const getDefaultRoute = (role: Role) => defaultRouteByRole[role];

const isAllowedPath = (role: Role, pathname: string) => {
  const routes = role === "MANAGER" ? managerRoutes : chatterRoutes;
  return routes.some((route) => route.test(pathname));
};

const normalizeStoredRoute = (role: Role, route: string | null) => {
  if (!route || !route.startsWith("/") || route.startsWith("//")) return null;

  try {
    const parsed = new URL(route, window.location.origin);
    if (parsed.origin !== window.location.origin || !isAllowedPath(role, parsed.pathname)) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

export const getLastVisitedRoute = (user: Pick<AuthUser, "id" | "role" | "mustChangePassword">) => {
  if (user.mustChangePassword) return "/config";

  try {
    return normalizeStoredRoute(user.role, localStorage.getItem(`${LAST_ROUTE_PREFIX}${user.id}`))
      ?? getDefaultRoute(user.role);
  } catch {
    return getDefaultRoute(user.role);
  }
};

export const rememberLastVisitedRoute = (
  user: Pick<AuthUser, "id" | "role">,
  pathname: string,
  search = "",
  hash = ""
) => {
  if (!isAllowedPath(user.role, pathname)) return;

  try {
    localStorage.setItem(`${LAST_ROUTE_PREFIX}${user.id}`, `${pathname}${search}${hash}`);
  } catch {
    // A navegação continua normalmente quando o armazenamento está indisponível.
  }
};
