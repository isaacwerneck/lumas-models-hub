import bcrypt from "bcrypt";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotificationType, Role } from "@prisma/client";
import { buildApp } from "../src/app";
import { buildRefreshToken, tokenHash } from "../src/modules/auth/auth.service";
import { env } from "../src/config/env";
import { processStorageDeletionJobs, queueEvidencePurge } from "../src/services/evidence-cleanup";
import { createNotifications } from "../src/modules/notifications/notification.service";

const app = buildApp();
let managerId = "";
let chatterId = "";
let otherChatterId = "";
let tagId = "";
let otherTagId = "";
let managerToken = "";
let chatterToken = "";
let otherToken = "";
let openShiftId = "";
let negativeShiftId = "";
let createdTagId = "";
let createdChatterId = "";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const json = (response: { json(): any }) => response.json();
const createTestEvidence = async (uploadedById: string, name: string) => app.prisma.evidence.create({
  data: {
    uploadedById,
    storageKey: `tests/${crypto.randomUUID()}.webp`,
    originalName: name,
    mimeType: "image/webp",
    sizeBytes: 128,
    sha256: crypto.randomUUID().replaceAll("-", "")
  }
});

beforeAll(async () => {
  await app.ready();
  const prisma = app.prisma;
  await prisma.storageDeletionJob.deleteMany(); await prisma.notification.deleteMany(); await prisma.auditLog.deleteMany(); await prisma.chatMessage.deleteMany();
  await prisma.paymentHistory.deleteMany(); await prisma.earnings.deleteMany(); await prisma.shift.deleteMany(); await prisma.evidence.deleteMany();
  await prisma.refreshSession.deleteMany(); await prisma.chatterModelTag.deleteMany(); await prisma.modelTag.deleteMany(); await prisma.user.deleteMany();
  const passwordHash = await bcrypt.hash("Password@123", 4);
  const [manager, chatter, other, tag, otherTag] = await prisma.$transaction([
    prisma.user.create({ data: { username: "manager.test", displayName: "Manager Test", passwordHash, role: Role.MANAGER } }),
    prisma.user.create({ data: { username: "chatter.test", displayName: "Chatter Test", passwordHash, role: Role.CHATTER } }),
    prisma.user.create({ data: { username: "other.test", displayName: "Other Test", passwordHash, role: Role.CHATTER } }),
    prisma.modelTag.create({ data: { name: "Model Test" } }),
    prisma.modelTag.create({ data: { name: "Other Model" } })
  ]);
  managerId = manager.id; chatterId = chatter.id; otherChatterId = other.id; tagId = tag.id; otherTagId = otherTag.id;
  await prisma.chatterModelTag.create({ data: { chatterId, modelTagId: tagId } });
  managerToken = app.jwt.sign({ sub: managerId, role: Role.MANAGER, username: manager.username, authVersion: 0 });
  chatterToken = app.jwt.sign({ sub: chatterId, role: Role.CHATTER, username: chatter.username, authVersion: 0 });
  otherToken = app.jwt.sign({ sub: otherChatterId, role: Role.CHATTER, username: other.username, authVersion: 0 });
});

afterAll(async () => { await app.close(); });

describe("infraestrutura e segurança", () => {
  it("expõe health legado", async () => { const r = await app.inject({ method: "GET", url: "/health" }); expect(r.statusCode).toBe(200); });
  it("marca rota legada como depreciada", async () => { const r = await app.inject({ method: "GET", url: "/health" }); expect(r.headers.deprecation).toBe("true"); });
  it("expõe health v1", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/health" }); expect(r.statusCode).toBe(200); });
  it("expõe readiness legado e v1 dependente de banco e storage", async () => {
    const [legacy, v1] = await Promise.all([
      app.inject({ method: "GET", url: "/ready" }),
      app.inject({ method: "GET", url: "/api/v1/ready" })
    ]);
    expect(legacy.statusCode).toBe(200);
    expect(v1.statusCode).toBe(200);
    expect(json(v1).status).toBe("ready");
  });
  it("não marca v1 como depreciada", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/health" }); expect(r.headers.deprecation).toBeUndefined(); });
  it("envia X-Content-Type-Options", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/health" }); expect(r.headers["x-content-type-options"]).toBe("nosniff"); });
  it("envia CSP", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/health" }); expect(r.headers["content-security-policy"]).toContain("default-src"); });
});

describe("autenticação", () => {
  it("rejeita login curto com 400", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "ab", password: "123" } }); expect(r.statusCode).toBe(400); });
  it("rejeita usuário inexistente", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "missing.user", password: "Password@123" } }); expect(r.statusCode).toBe(401); });
  it("rejeita senha incorreta", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "manager.test", password: "WrongPass@123" } }); expect(r.statusCode).toBe(401); });
  it("aceita credenciais válidas e cria cookie persistente seguro", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "manager.test", password: "Password@123" } });
    const cookieHeader = String(r.headers["set-cookie"]);
    expect(r.statusCode).toBe(200);
    expect(json(r).accessToken).toBeTruthy();
    expect(cookieHeader).toContain("Max-Age=2592000");
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).toContain("Path=/");
    expect(cookieHeader).not.toContain("Secure");
  });
  it("rotaciona, renova e revoga a sessão persistente no logout", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "manager.test", password: "Password@123" } });
    const loginCookie = String(login.headers["set-cookie"]).split(";")[0];
    const refresh = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { cookie: loginCookie } });
    const refreshHeader = String(refresh.headers["set-cookie"]);
    const rotatedCookie = refreshHeader.split(";")[0];

    expect(refresh.statusCode).toBe(200);
    expect(json(refresh).accessToken).toBeTruthy();
    expect(refreshHeader).toContain("Max-Age=2592000");
    expect(rotatedCookie).not.toBe(loginCookie);

    const staleRefresh = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { cookie: loginCookie } });
    expect(staleRefresh.statusCode).toBe(401);

    const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie: rotatedCookie } });
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers["set-cookie"])).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);

    const afterLogout = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { cookie: rotatedCookie } });
    expect(afterLogout.statusCode).toBe(401);
  });
  it("permite uso único do refresh mesmo sob requisições concorrentes", async () => {
    const sessionId = crypto.randomUUID();
    const refreshToken = buildRefreshToken({ sub: managerId, sessionId, tokenType: "refresh" });
    await app.prisma.refreshSession.create({
      data: { id: sessionId, userId: managerId, tokenHash: tokenHash(refreshToken), expiresAt: new Date(Date.now() + 60_000) }
    });
    const cookie = `${env.REFRESH_COOKIE_NAME}=${refreshToken}`;
    const responses = await Promise.all([
      app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { cookie } }),
      app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { cookie } })
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
  });
  it("rejeita refresh sem cookie", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/auth/refresh" }); expect(r.statusCode).toBe(401); });
  it("rejeita uma sessão persistente expirada", async () => {
    const sessionId = "expired-refresh-session";
    const refreshToken = buildRefreshToken({ sub: managerId, sessionId, tokenType: "refresh" });
    await app.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: managerId,
        tokenHash: tokenHash(refreshToken),
        expiresAt: new Date(Date.now() - 1_000)
      }
    });

    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: `${env.REFRESH_COOKIE_NAME}=${refreshToken}` }
    });
    expect(r.statusCode).toBe(401);
  });
  it("rejeita /me sem token", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/auth/me" }); expect(r.statusCode).toBe(401); });
  it("retorna /me autenticado", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(managerToken) }); expect(r.statusCode).toBe(200); expect(json(r).user.id).toBe(managerId); });
  it("revoga sessões persistentes ao trocar a senha", async () => {
    const session = await app.prisma.refreshSession.create({
      data: {
        userId: managerId,
        tokenHash: "password-change-session",
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: auth(managerToken),
      payload: { currentPassword: "Password@123", newPassword: "ChangedPassword@123" }
    });
    const revoked = await app.prisma.refreshSession.findUniqueOrThrow({ where: { id: session.id } });

    expect(changed.statusCode).toBe(200);
    expect(revoked.revokedAt).not.toBeNull();

    await app.prisma.user.update({
      where: { id: managerId },
      data: { passwordHash: await bcrypt.hash("Password@123", 4), authVersion: 0 }
    });
  });
  it("bloqueia chatter em rota de gerente", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/chatters", headers: auth(chatterToken) }); expect(r.statusCode).toBe(403); });
  it("bloqueia gerente em rota de chatter", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chatter/shifts/current", headers: auth(managerToken) }); expect(r.statusCode).toBe(403); });
  it("aplica rate limit na sexta tentativa", async () => {
    const isolated = buildApp(); await isolated.ready(); let status = 0;
    for (let index = 0; index < 6; index += 1) status = (await isolated.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: `missing.${index}`, password: "Password@123" } })).statusCode;
    expect(status).toBe(429); await isolated.close();
  });
  it("bloqueia conta na quinta senha incorreta", async () => {
    const isolated = buildApp(); await isolated.ready(); let status = 0;
    for (let index = 0; index < 5; index += 1) status = (await isolated.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "other.test", password: "WrongPass@123" } })).statusCode;
    expect(status).toBe(423); await isolated.close();
    await app.prisma.user.update({ where: { id: otherChatterId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  });
  it("mantém o bloqueio atômico sob tentativas concorrentes", async () => {
    const passwordHash = await bcrypt.hash("Password@123", 4);
    const concurrentUser = await app.prisma.user.create({
      data: { username: "concurrent.test", displayName: "Concurrent Test", passwordHash, role: Role.CHATTER }
    });
    const isolated = buildApp();
    await isolated.ready();
    await Promise.all(Array.from({ length: 5 }, () => isolated.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: concurrentUser.username, password: "WrongPass@123" }
    })));
    const locked = await app.prisma.user.findUniqueOrThrow({ where: { id: concurrentUser.id } });
    const lockEvents = await app.prisma.auditLog.count({
      where: { actorId: concurrentUser.id, action: "ACCOUNT_LOCKED" }
    });
    expect(locked.failedLoginAttempts).toBeGreaterThanOrEqual(5);
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(lockEvents).toBe(1);
    await isolated.close();
    await app.prisma.auditLog.deleteMany({ where: { actorId: concurrentUser.id } });
    await app.prisma.user.delete({ where: { id: concurrentUser.id } });
  });
  it("encerra todas as sessões e invalida imediatamente o access token", async () => {
    const user = await app.prisma.user.create({ data: {
      username: "logout.all.test", displayName: "Logout All", passwordHash: await bcrypt.hash("Password@123", 4), role: Role.CHATTER
    } });
    const token = app.jwt.sign({ sub: user.id, role: user.role, username: user.username, authVersion: user.authVersion });
    await app.prisma.refreshSession.create({ data: { userId: user.id, tokenHash: "logout-all-session", expiresAt: new Date(Date.now() + 60_000) } });
    const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout-all", headers: auth(token) });
    const stale = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(token) });
    expect(logout.statusCode).toBe(200);
    expect(stale.statusCode).toBe(401);
    expect((await app.prisma.refreshSession.findFirstOrThrow({ where: { userId: user.id } })).revokedAt).not.toBeNull();
    await app.prisma.auditLog.deleteMany({ where: { actorId: user.id } });
    await app.prisma.refreshSession.deleteMany({ where: { userId: user.id } });
    await app.prisma.user.delete({ where: { id: user.id } });
  });
});

describe("gerência de chatters e tags", () => {
  it("lista chatters com paginação", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/chatters?page=1&pageSize=1", headers: auth(managerToken) }); expect(r.statusCode).toBe(200); expect(json(r).items).toHaveLength(1); });
  it("retorna metadados de paginação", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/chatters?page=1&pageSize=1", headers: auth(managerToken) }); expect(json(r).pagination.total).toBeGreaterThanOrEqual(2); });
  it("busca chatter por nome", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/chatters?search=Other", headers: auth(managerToken) }); expect(json(r).items[0].id).toBe(otherChatterId); });
  it("valida página inválida", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/chatters?page=0", headers: auth(managerToken) }); expect(r.statusCode).toBe(400); });
  it("cria chatter com username normalizado e senha temporária", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/manager/users", headers: auth(managerToken), payload: { username: "NEW.CHATTER", displayName: " New Chatter ", role: "CHATTER", password: "Password@123" } });
    expect(r.statusCode).toBe(201);
    expect(json(r).user.username).toBe("new.chatter");
    createdChatterId = json(r).user.id;
  });
  it("rejeita chatter duplicado", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/manager/users", headers: auth(managerToken), payload: { username: "new.chatter", displayName: "New Chatter", role: "CHATTER", password: "Password@123" } }); expect(r.statusCode).toBe(409); });
  it("rejeita criação inválida", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/manager/users", headers: auth(managerToken), payload: { username: "x" } }); expect(r.statusCode).toBe(400); });
  it("impede auto-desativação", async () => { const r = await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${managerId}`, headers: auth(managerToken), payload: { isActive: false } }); expect(r.statusCode).toBe(400); });
  it("desativa e reativa chatter", async () => {
    const session = await app.prisma.refreshSession.create({
      data: {
        userId: otherChatterId,
        tokenHash: "deactivation-session",
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    const disabled = await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${otherChatterId}`, headers: auth(managerToken), payload: { isActive: false } });
    const revoked = await app.prisma.refreshSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(disabled.statusCode).toBe(200); expect(json(disabled).user.isActive).toBe(false);
    expect(revoked.revokedAt).not.toBeNull();
    await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${otherChatterId}`, headers: auth(managerToken), payload: { isActive: true } });
    const reactivated = await app.prisma.user.findUniqueOrThrow({ where: { id: otherChatterId } });
    otherToken = app.jwt.sign({ sub: otherChatterId, role: Role.CHATTER, username: reactivated.username, authVersion: reactivated.authVersion });
  });
  it("aceita PATCH vazio como no-op legado", async () => { const r = await app.inject({ method: "PATCH", url: `/manager/users/${otherChatterId}`, headers: auth(managerToken), payload: {} }); expect(r.statusCode).toBe(200); });
  it("lista tags", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/tags", headers: auth(managerToken) }); expect(r.statusCode).toBe(200); expect(json(r).tags.length).toBeGreaterThan(0); });
  it("cria tag auditada", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/manager/tags", headers: auth(managerToken), payload: { name: "Disposable Tag" } }); expect(r.statusCode).toBe(201); createdTagId = json(r).tag.id; });
  it("rejeita tag duplicada", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/manager/tags", headers: auth(managerToken), payload: { name: "Disposable Tag" } }); expect(r.statusCode).toBe(409); });
  it("atribui tags", async () => { const r = await app.inject({ method: "PUT", url: `/api/v1/manager/chatters/${otherChatterId}/tags`, headers: auth(managerToken), payload: { modelTagIds: [otherTagId] } }); expect(r.statusCode).toBe(200); });
  it("rejeita tag inexistente", async () => { const r = await app.inject({ method: "PUT", url: `/api/v1/manager/chatters/${otherChatterId}/tags`, headers: auth(managerToken), payload: { modelTagIds: ["missing"] } }); expect(r.statusCode).toBe(400); });
  it("rejeita atribuição de tag a não-chatter", async () => { const r = await app.inject({ method: "PUT", url: `/api/v1/manager/chatters/${managerId}/tags`, headers: auth(managerToken), payload: { modelTagIds: [tagId] } }); expect(r.statusCode).toBe(404); });
  it("retorna histórico consolidado do chatter", async () => { const r = await app.inject({ method: "GET", url: `/api/v1/manager/chatters/${chatterId}/history`, headers: auth(managerToken) }); expect(r.statusCode).toBe(200); expect(json(r).chatter.id).toBe(chatterId); });
  it("separa detalhes e históricos paginados do chatter", async () => {
    const detail = await app.inject({ method: "GET", url: `/api/v1/manager/chatters/${chatterId}`, headers: auth(managerToken) });
    const shifts = await app.inject({ method: "GET", url: `/api/v1/manager/chatters/${chatterId}/shifts?page=1&pageSize=10&modelTagId=${tagId}`, headers: auth(managerToken) });
    const payments = await app.inject({ method: "GET", url: `/api/v1/manager/chatters/${chatterId}/payments?page=1&pageSize=10`, headers: auth(managerToken) });
    expect(json(detail).chatter.id).toBe(chatterId);
    expect(json(shifts).pagination.pageSize).toBe(10);
    expect(json(payments).pagination.pageSize).toBe(10);
  });
  it("reseta senha, exige troca e revoga sessões", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/manager/users/${createdChatterId}/reset-password`, headers: auth(managerToken), payload: { password: "Temporary@123" } });
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: createdChatterId } });
    expect(r.statusCode).toBe(200);
    expect(user.mustChangePassword).toBe(true);
    expect(user.authVersion).toBeGreaterThan(0);
  });
  it("bloqueia tag inativa em novas operações sem apagar histórico", async () => {
    await app.inject({ method: "PATCH", url: `/api/v1/manager/tags/${otherTagId}`, headers: auth(managerToken), payload: { isActive: false } });
    const evidence = await createTestEvidence(otherChatterId, "tag-inativa.webp");
    const rejected = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(otherToken), payload: { modelTagId: otherTagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00" } });
    expect(rejected.statusCode).toBe(403);
    await app.inject({ method: "PATCH", url: `/api/v1/manager/tags/${otherTagId}`, headers: auth(managerToken), payload: { isActive: true } });
    await app.prisma.evidence.delete({ where: { id: evidence.id } });
  });
  it("exclui tag sem referências", async () => { const r = await app.inject({ method: "DELETE", url: `/api/v1/manager/tags/${createdTagId}`, headers: auth(managerToken) }); expect(r.statusCode).toBe(204); });
});

describe("turnos", () => {
  it("retorna turno atual vazio", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chatter/shifts/current", headers: auth(chatterToken) }); expect(json(r).shift).toBeNull(); });
  it("rejeita início sem imagem", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(chatterToken), payload: { modelTagId: tagId } }); expect(r.statusCode).toBe(400); });
  it("rejeita tag não vinculada", async () => { const evidence = await createTestEvidence(otherChatterId, "sem-tag.webp"); const r = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(otherToken), payload: { modelTagId: tagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00" } }); expect(r.statusCode).toBe(403); });
  it("impede dois turnos simultâneos sob requisições concorrentes", async () => {
    const evidences = await Promise.all([
      createTestEvidence(chatterId, "concorrente-a.webp"),
      createTestEvidence(chatterId, "concorrente-b.webp")
    ]);
    const responses = await Promise.all(evidences.map((evidence) => app.inject({
      method: "POST",
      url: "/api/v1/chatter/shifts/start",
      headers: auth(chatterToken),
      payload: { modelTagId: tagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00" }
    })));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const createdId = json(responses.find((response) => response.statusCode === 201)!).shift.id;
    await app.prisma.shift.delete({ where: { id: createdId } });
    await app.prisma.evidence.deleteMany({ where: { id: { in: evidences.map((evidence) => evidence.id) } } });
  });
  it("inicia turno", async () => { const evidence = await createTestEvidence(chatterId, "inicio.webp"); const r = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(chatterToken), payload: { modelTagId: tagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00" } }); expect(r.statusCode).toBe(201); openShiftId = json(r).shift.id; });
  it("rejeita segundo turno aberto", async () => { const evidence = await createTestEvidence(chatterId, "inicio-duplicado.webp"); const r = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(chatterToken), payload: { modelTagId: tagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00" } }); expect(r.statusCode).toBe(409); });
  it("retorna turno atual", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chatter/shifts/current", headers: auth(chatterToken) }); expect(json(r).shift.id).toBe(openShiftId); });
  it("rejeita encerramento sem imagem", async () => { const r = await app.inject({ method: "POST", url: `/api/v1/chatter/shifts/${openShiftId}/end`, headers: auth(chatterToken), payload: {} }); expect(r.statusCode).toBe(400); });
  it("encerra turno positivo", async () => { const evidence = await createTestEvidence(chatterId, "fim.webp"); const r = await app.inject({ method: "POST", url: `/api/v1/chatter/shifts/${openShiftId}/end`, headers: auth(chatterToken), payload: { endEvidenceId: evidence.id, manualConfirmedValue: "R$ 140,00" } }); expect(r.statusCode).toBe(200); });
  it("lista histórico paginado", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chatter/shifts/history?page=1&pageSize=1", headers: auth(chatterToken) }); expect(r.statusCode).toBe(200); expect(json(r).items).toHaveLength(1); });
  it("rejeita PATCH vazio", async () => { const r = await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${openShiftId}`, headers: auth(chatterToken), payload: {} }); expect(r.statusCode).toBe(400); });
  it("edita observação do turno", async () => { const r = await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${openShiftId}`, headers: auth(chatterToken), payload: { notes: "Revisado" } }); expect(r.statusCode).toBe(200); expect(json(r).shift.notes).toBe("Revisado"); });
  it("rejeita datas invertidas no PATCH", async () => { const r = await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${openShiftId}`, headers: auth(chatterToken), payload: { startedAt: "2026-08-20T12:00:00.000Z", endedAt: "2026-08-19T12:00:00.000Z" } }); expect(r.statusCode).toBe(400); });
  it("rejeita lançamento editado sem duração", async () => { const instant = "2026-08-19T16:27:00.000Z"; const r = await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${openShiftId}`, headers: auth(chatterToken), payload: { startedAt: instant, endedAt: instant } }); expect(r.statusCode).toBe(400); });
  it("cria turno negativo com justificativa", async () => {
    const startEvidence = await createTestEvidence(chatterId, "negativo-inicio.webp");
    const endEvidence = await createTestEvidence(chatterId, "negativo-fim.webp");
    const start = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(chatterToken), payload: { modelTagId: tagId, startEvidenceId: startEvidence.id, manualConfirmedValue: "R$ 100,00" } }); negativeShiftId = json(start).shift.id;
    const rejected = await app.inject({ method: "POST", url: `/api/v1/chatter/shifts/${negativeShiftId}/end`, headers: auth(chatterToken), payload: { endEvidenceId: endEvidence.id, manualConfirmedValue: "R$ 90,00" } }); expect(rejected.statusCode).toBe(400);
    const end = await app.inject({ method: "POST", url: `/api/v1/chatter/shifts/${negativeShiftId}/end`, headers: auth(chatterToken), payload: { endEvidenceId: endEvidence.id, manualConfirmedValue: "R$ 90,00", negativeJustification: "Ajuste" } }); expect(end.statusCode).toBe(200);
  });
  it("notifica chatter e gerentes ativos sem destinatários duplicados", async () => {
    const notifications = await app.prisma.notification.findMany({ where: { sourceId: negativeShiftId } });
    expect(new Set(notifications.map((item) => item.userId)).size).toBe(notifications.length);
    expect(notifications.map((item) => item.userId)).toEqual(expect.arrayContaining([chatterId, managerId]));
  });
  it("retorna conflito ao excluir tag referenciada e preserva seus turnos", async () => {
    const r = await app.inject({ method: "DELETE", url: `/api/v1/manager/tags/${tagId}`, headers: auth(managerToken) });
    expect(r.statusCode).toBe(409);
    expect(await app.prisma.shift.count({ where: { modelTagId: tagId } })).toBeGreaterThan(0);
  });
  it("reflete exclusão imediatamente no ranking e no dashboard do gerente", async () => {
    const shift = await app.prisma.shift.create({ data: {
      chatterId, modelTagId: tagId, status: "CLOSED", startedAt: new Date("2026-08-19T12:00:00.000Z"), endedAt: new Date("2026-08-19T14:00:00.000Z"),
      startImageUrl: "legacy:delete-start.webp", endImageUrl: "legacy:delete-end.webp", startValueCents: 0, endValueCents: 8000,
      grossAmountCents: 8000, payoutAmountCents: 2000, commissionDivisor: 4
    } });
    await app.prisma.earnings.create({ data: { shiftId: shift.id, chatterId, amountCents: 2000 } });
    const beforeRanking = await app.inject({ method: "GET", url: "/api/v1/mph/ranking?window=all", headers: auth(chatterToken) });
    const beforeAnalytics = await app.inject({ method: "GET", url: "/api/v1/manager/analytics", headers: auth(managerToken) });
    const beforeEntry = json(beforeRanking).ranking.find((item: { chatter: { id: string } }) => item.chatter.id === chatterId);

    const deleted = await app.inject({ method: "DELETE", url: `/api/v1/chatter/shifts/${shift.id}`, headers: auth(chatterToken) });
    const afterRanking = await app.inject({ method: "GET", url: "/api/v1/mph/ranking?window=all", headers: auth(chatterToken) });
    const afterAnalytics = await app.inject({ method: "GET", url: "/api/v1/manager/analytics", headers: auth(managerToken) });
    const afterEntry = json(afterRanking).ranking.find((item: { chatter: { id: string } }) => item.chatter.id === chatterId);

    expect(deleted.statusCode).toBe(200);
    expect(afterEntry.shiftCount).toBe(beforeEntry.shiftCount - 1);
    expect(afterEntry.totalGrossCents).toBe(beforeEntry.totalGrossCents - 8000);
    expect(json(afterAnalytics).summary.shiftCount).toBe(json(beforeAnalytics).summary.shiftCount - 1);
    expect(json(afterAnalytics).summary.totalGrossCents).toBe(json(beforeAnalytics).summary.totalGrossCents - 8000);
  });
  it("permite ao gerente editar observações sem alterar os valores", async () => {
    const r = await app.inject({ method: "PATCH", url: `/api/v1/manager/shifts/${negativeShiftId}/notes`, headers: auth(managerToken), payload: { notes: "  Conferido pelo gerente  " } });
    expect(r.statusCode).toBe(200);
    expect(json(r).shift.notes).toBe("Conferido pelo gerente");
  });
  it("inclui lançamento legado sem duração nos totais do ranking", async () => {
    const instant = new Date("2026-08-19T19:27:00.000Z");
    const legacyShift = await app.prisma.shift.create({ data: {
      chatterId, modelTagId: tagId, status: "CLOSED", startedAt: instant, endedAt: instant,
      startImageUrl: "data:image/png;base64,legacy-start", endImageUrl: "data:image/png;base64,legacy-end",
      startValueCents: 0, endValueCents: 4560, grossAmountCents: 4560,
      commissionDivisor: 4, payoutAmountCents: 1140
    } });
    const expected = await app.prisma.shift.aggregate({
      where: { chatterId, status: "CLOSED", grossAmountCents: { not: null } },
      _sum: { grossAmountCents: true }, _count: { id: true }
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/mph/ranking?window=all", headers: auth(chatterToken) });
    const entry = json(response).ranking.find((item: { chatter: { id: string } }) => item.chatter.id === chatterId);

    expect(response.statusCode).toBe(200);
    expect(entry.totalGrossCents).toBe(expected._sum.grossAmountCents);
    expect(entry.shiftCount).toBe(expected._count.id);
    expect(entry.totalHoursMs).toBeGreaterThanOrEqual(60_000);
    await app.prisma.shift.delete({ where: { id: legacyShift.id } });
  });
});

describe("comprovantes privados", () => {
  it("diferencia comprovante inexistente, legado e objeto ausente", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/v1/evidence/missing/content", headers: auth(chatterToken) });
    const legacy = await app.prisma.evidence.create({ data: {
      uploadedById: chatterId, storageKey: null, originalName: "legado.png", mimeType: "image/png", sizeBytes: 0, status: "MISSING_LEGACY"
    } });
    const absent = await createTestEvidence(chatterId, "ausente.webp");
    const [legacyResponse, absentResponse] = await Promise.all([
      app.inject({ method: "GET", url: `/api/v1/evidence/${legacy.id}/content`, headers: auth(chatterToken) }),
      app.inject({ method: "GET", url: `/api/v1/evidence/${absent.id}/content`, headers: auth(chatterToken) })
    ]);
    expect(missing.statusCode).toBe(404);
    expect(legacyResponse.statusCode).toBe(410);
    expect(absentResponse.statusCode).toBe(410);
  });
  it("permite acesso somente ao proprietário e ao gerente e retorna 410 após limpeza", async () => {
    const evidence = await createTestEvidence(chatterId, "comprovante privado.webp");
    await app.evidenceStorage.put(evidence.storageKey!, Buffer.from("private-proof"), evidence.mimeType);

    const owner = await app.inject({ method: "GET", url: `/api/v1/evidence/${evidence.id}/content`, headers: auth(chatterToken) });
    const manager = await app.inject({ method: "GET", url: `/api/v1/evidence/${evidence.id}/content`, headers: auth(managerToken) });
    const stranger = await app.inject({ method: "GET", url: `/api/v1/evidence/${evidence.id}/content`, headers: auth(otherToken) });
    expect(owner.statusCode).toBe(200);
    expect(owner.headers["cache-control"]).toBe("private, no-store");
    expect(manager.statusCode).toBe(200);
    expect(stranger.statusCode).toBe(403);

    await app.prisma.evidence.update({ where: { id: evidence.id }, data: { status: "PURGED", purgedAt: new Date(), storageKey: null } });
    await app.evidenceStorage.delete(evidence.storageKey!);
    const purged = await app.inject({ method: "GET", url: `/api/v1/evidence/${evidence.id}/content`, headers: auth(chatterToken) });
    expect(purged.statusCode).toBe(410);
  });
  it("mantém a limpeza reexecutável quando o storage falha", async () => {
    const evidence = await createTestEvidence(chatterId, "retry.webp");
    await app.evidenceStorage.put(evidence.storageKey!, Buffer.from("retry-proof"), evidence.mimeType);
    await app.prisma.$transaction((tx) => queueEvidencePurge(tx, [evidence.id]));

    const originalDelete = app.evidenceStorage.delete.bind(app.evidenceStorage);
    app.evidenceStorage.delete = async () => { throw new Error("storage temporarily unavailable"); };
    expect(await processStorageDeletionJobs(app)).toBe(0);
    const failed = await app.prisma.storageDeletionJob.findUniqueOrThrow({ where: { evidenceId: evidence.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.attempts).toBe(1);

    app.evidenceStorage.delete = originalDelete;
    await app.prisma.storageDeletionJob.update({ where: { id: failed.id }, data: { nextAttemptAt: new Date(0) } });
    expect(await processStorageDeletionJobs(app)).toBe(1);
    expect((await app.prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } })).status).toBe("PURGED");
  });
});

describe("pagamentos, chat, notificações e relatórios", () => {
  it("retorna resumo do chatter", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chatter/payment/summary", headers: auth(chatterToken) }); expect(r.statusCode).toBe(200); });
  it("lista saldos do gerente", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/payments/balances?page=1&pageSize=20", headers: auth(managerToken) }); expect(r.statusCode).toBe(200); expect(json(r).items.length).toBeGreaterThan(0); });
  it("registra pagamento idempotente", async () => {
    const headers = { ...auth(managerToken), "idempotency-key": "payment-main-test" };
    const first = await app.inject({ method: "POST", url: "/api/v1/manager/payments/pay", headers, payload: { chatterId } });
    const retry = await app.inject({ method: "POST", url: "/api/v1/manager/payments/pay", headers, payload: { chatterId } });
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(json(retry).payment.id).toBe(json(first).payment.id);
    expect(json(retry).idempotent).toBe(true);
  });
  it("impede pagamento duplicado sob requisições concorrentes", async () => {
    const shift = await app.prisma.shift.create({ data: {
      chatterId, modelTagId: tagId, status: "CLOSED", startedAt: new Date("2026-08-20T12:00:00.000Z"), endedAt: new Date("2026-08-20T13:00:00.000Z"),
      startImageUrl: "legacy:test-start.webp", endImageUrl: "legacy:test-end.webp", startValueCents: 0, endValueCents: 4000,
      grossAmountCents: 4000, payoutAmountCents: 1000, commissionDivisor: 4
    } });
    await app.prisma.earnings.create({ data: { shiftId: shift.id, chatterId, amountCents: 1000 } });
    const responses = await Promise.all(["concurrent-a", "concurrent-b"].map((key) => app.inject({
      method: "POST", url: "/api/v1/manager/payments/pay",
      headers: { ...auth(managerToken), "idempotency-key": key }, payload: { chatterId }
    })));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(await app.prisma.paymentHistory.count({ where: { earnings: { some: { shiftId: shift.id } } } })).toBe(1);
  });
  it("rejeita pagamento sem pendência", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/manager/payments/pay", headers: auth(managerToken), payload: { chatterId } }); expect(r.statusCode).toBe(400); });
  it("rejeita pagamento para chatter inexistente", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/manager/payments/pay", headers: auth(managerToken), payload: { chatterId: "missing" } }); expect(r.statusCode).toBe(404); });
  it("lista histórico de pagamentos", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/payments/history?page=1&pageSize=20", headers: auth(managerToken) }); expect(json(r).items.length).toBeGreaterThan(0); });
  it("lista o histórico de pagamentos para o próprio chatter", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chatter/payment/history?page=1&pageSize=20", headers: auth(chatterToken) }); expect(r.statusCode).toBe(200); expect(json(r).items.length).toBeGreaterThan(0); });
  it("lista salas do chat", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chat/rooms", headers: auth(chatterToken) }); expect(json(r).rooms).toHaveLength(1); });
  it("permite ao gerente listar e acessar salas ativas", async () => {
    const rooms = await app.inject({ method: "GET", url: "/api/v1/chat/rooms", headers: auth(managerToken) });
    const messages = await app.inject({ method: "GET", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(managerToken) });
    expect(json(rooms).rooms.some((room: { id: string }) => room.id === tagId)).toBe(true);
    expect(messages.statusCode).toBe(200);
  });
  it("envia mensagem", async () => { const r = await app.inject({ method: "POST", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(chatterToken), payload: { content: "Olá" } }); expect(r.statusCode).toBe(201); });
  it("lista mensagens", async () => { const r = await app.inject({ method: "GET", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(chatterToken) }); expect(r.statusCode).toBe(200); expect(json(r).messages.length).toBeGreaterThan(0); });
  it("rejeita mensagem vazia", async () => { const r = await app.inject({ method: "POST", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(chatterToken), payload: { content: "" } }); expect(r.statusCode).toBe(400); });
  it("rejeita mensagem acima de 2000 caracteres", async () => { const r = await app.inject({ method: "POST", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(chatterToken), payload: { content: "x".repeat(2001) } }); expect(r.statusCode).toBe(400); });
  it("rejeita acesso a sala", async () => { const r = await app.inject({ method: "GET", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(otherToken) }); expect(r.statusCode).toBe(403); });
  it("lista notificações", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/notifications?page=1&pageSize=20", headers: auth(chatterToken) }); expect(r.statusCode).toBe(200); expect(json(r).unreadCount).toBeGreaterThan(0); });
  it("deduplica notificações do serviço e protege leitura por proprietário", async () => {
    await createNotifications(app, {
      userIds: [chatterId, chatterId], type: NotificationType.OCR_LOW_CONFIDENCE,
      title: "Revisar OCR", message: "Confira o valor.", sourceType: "Evidence", sourceId: "dedupe-test"
    });
    await createNotifications(app, {
      userIds: [chatterId], type: NotificationType.OCR_LOW_CONFIDENCE,
      title: "Revisar OCR", message: "Confira o valor.", sourceType: "Evidence", sourceId: "dedupe-test"
    });
    await createNotifications(app, {
      userIds: [], type: NotificationType.OCR_LOW_CONFIDENCE,
      title: "Nada", message: "Nada", sourceType: "Evidence", sourceId: "empty-test"
    });
    const notification = await app.prisma.notification.findFirstOrThrow({ where: { userId: chatterId, sourceId: "dedupe-test" } });
    expect(await app.prisma.notification.count({ where: { userId: chatterId, sourceId: "dedupe-test" } })).toBe(1);
    const unread = await app.inject({ method: "GET", url: "/api/v1/notifications?unreadOnly=true", headers: auth(chatterToken) });
    const forbidden = await app.inject({ method: "PATCH", url: `/api/v1/notifications/${notification.id}/read`, headers: auth(otherToken) });
    const read = await app.inject({ method: "PATCH", url: `/api/v1/notifications/${notification.id}/read`, headers: auth(chatterToken) });
    expect(json(unread).items.length).toBeGreaterThan(0);
    expect(forbidden.statusCode).toBe(404);
    expect(read.statusCode).toBe(200);
  });
  it("marca todas notificações", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/notifications/read-all", headers: auth(chatterToken) }); expect(r.statusCode).toBe(200); });
  it("expõe auditoria ao gerente", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/audit-logs?page=1&pageSize=20", headers: auth(managerToken) }); expect(r.statusCode).toBe(200); expect(json(r).items.length).toBeGreaterThan(0); });
  it("protege auditoria do chatter", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/manager/audit-logs", headers: auth(chatterToken) }); expect(r.statusCode).toBe(403); });
  it("gera XLSX de turnos com cabeçalhos e total", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/manager/reports/shifts.xlsx", headers: auth(managerToken) });
    expect(r.statusCode).toBe(200); expect(r.headers["content-type"]).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(r.rawPayload);
    const sheet = workbook.getWorksheet("Turnos")!;
    expect(sheet.getCell("A1").value).toBe("Chatter");
    expect(sheet.getCell(`B${sheet.rowCount}`).value).toBe("Total");
    expect(sheet.views[0]?.state).toBe("frozen");
  });
  it("gera XLSX de pagamentos com fórmula de total", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/manager/reports/payments.xlsx", headers: auth(managerToken) });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(r.rawPayload);
    const sheet = workbook.getWorksheet("Pagamentos")!;
    expect(sheet.getCell("A1").value).toBe("Data");
    expect(sheet.getCell(`D${sheet.rowCount}`).value).toHaveProperty("formula");
  });
  it("gera XLSX de analytics por modelo e chatter", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/manager/reports/analytics.xlsx", headers: auth(managerToken) });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(r.rawPayload);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Por modelo", "Por chatter"]);
  });
  it("rejeita OCR sem arquivo com 400", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/ocr/extract", headers: auth(chatterToken) }); expect(r.statusCode).toBe(400); });
  it("rejeita arquivo disfarçado de imagem pela assinatura real", async () => {
    const boundary = "----lumas-invalid-image";
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="fake.png"\r\nContent-Type: image/png\r\n\r\nnot-an-image\r\n--${boundary}--\r\n`);
    const r = await app.inject({
      method: "POST", url: "/api/v1/ocr/extract",
      headers: { ...auth(chatterToken), "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body
    });
    expect(r.statusCode).toBe(400);
    expect(json(r).error.message).toContain("Imagem inválida");
  });
  it("rejeita upload que não declara tipo de imagem", async () => {
    const boundary = "----lumas-invalid-mime";
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="proof.txt"\r\nContent-Type: text/plain\r\n\r\ntext\r\n--${boundary}--\r\n`);
    const r = await app.inject({
      method: "POST", url: "/api/v1/ocr/extract",
      headers: { ...auth(chatterToken), "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body
    });
    expect(r.statusCode).toBe(400);
  });
  it("consulta câmbio ou informa indisponibilidade externa", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/fx/usd-brl", headers: auth(chatterToken) }); expect([200, 502]).toContain(r.statusCode); });
});
