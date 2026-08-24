import { beforeEach, describe, expect, it } from "vitest";
import { getLastVisitedRoute, rememberLastVisitedRoute } from "../lib/lastVisitedRoute";
import type { AuthUser } from "../types";

const manager: AuthUser = { id: "manager-1", username: "manager", displayName: "Manager", role: "MANAGER" };
const chatter: AuthUser = { id: "chatter-1", username: "chatter", displayName: "Chatter", role: "CHATTER" };

describe("lastVisitedRoute", () => {
  beforeEach(() => localStorage.clear());

  it("usa um destino inicial útil para cada perfil", () => {
    expect(getLastVisitedRoute(manager)).toBe("/home");
    expect(getLastVisitedRoute(chatter)).toBe("/horarios");
  });

  it("preserva tela, filtros e aba separadamente por conta", () => {
    rememberLastVisitedRoute(manager, "/pagamentos", "?page=3");
    rememberLastVisitedRoute(chatter, "/central-modelo", "?tab=chat");

    expect(getLastVisitedRoute(manager)).toBe("/pagamentos?page=3");
    expect(getLastVisitedRoute(chatter)).toBe("/central-modelo?tab=chat");
  });

  it("descarta rotas incompatíveis com o perfil", () => {
    localStorage.setItem("lumas:last-visited:chatter-1", "/auditoria");
    expect(getLastVisitedRoute(chatter)).toBe("/horarios");
  });

  it("prioriza a troca obrigatória de senha", () => {
    localStorage.setItem("lumas:last-visited:chatter-1", "/pagamento");
    expect(getLastVisitedRoute({ ...chatter, mustChangePassword: true })).toBe("/config");
  });
});
