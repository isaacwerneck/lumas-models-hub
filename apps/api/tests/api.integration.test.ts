import bcrypt from "bcrypt";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditAction, NotificationType, Role } from "@prisma/client";
import { buildApp } from "../src/app";
import { buildRefreshToken, tokenHash } from "../src/modules/auth/auth.service";
import { env } from "../src/config/env";
import { processStorageDeletionJobs, queueEvidencePurge } from "../src/services/evidence-cleanup";
import { createNotifications } from "../src/modules/notifications/notification.service";
import { businessTimeLabel } from "../src/utils/time";

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
const makeShiftPayable = async (shiftId: string) => {
  const shift = await app.prisma.shift.update({ where: { id: shiftId }, data: { chatterVerifiedAt: new Date() } });
  const statementImport = await app.prisma.salesStatementImport.create({ data: {
    managerId,
    modelTagId: shift.modelTagId,
    originalName: `test-${shiftId}.xlsx`,
    fileSha256: crypto.randomUUID().replaceAll("-", ""),
    vendorName: "Chatter Test",
    coverageStart: shift.startedAt,
    coverageEnd: shift.endedAt ?? shift.startedAt,
    rowCount: 1,
    confirmedRowCount: 1,
    excludedRowCount: 0,
    totalSalesCents: shift.grossAmountCents ?? 0,
    totalCommissionCents: shift.grossAmountCents ?? 0,
    unmatchedRowCount: 0
  } });
  await app.prisma.shiftReconciliation.create({ data: {
    importId: statementImport.id,
    shiftId,
    shiftReviewRevision: shift.reviewRevision,
    statementCommissionCents: shift.grossAmountCents ?? 0,
    reportedGrossCents: shift.grossAmountCents ?? 0,
    deltaCents: 0,
    matchedRowCount: 1,
    status: "MATCHED"
  } });
};

beforeAll(async () => {
  await app.ready();
  const prisma = app.prisma;
  await prisma.storageDeletionJob.deleteMany(); await prisma.notification.deleteMany(); await prisma.auditLog.deleteMany(); await prisma.chatMessage.deleteMany();
  await prisma.modelWorksheetCell.deleteMany(); await prisma.modelWorksheet.deleteMany(); await prisma.shiftReconciliation.deleteMany(); await prisma.salesStatementImport.deleteMany();
  await prisma.paymentHistory.deleteMany(); await prisma.paymentReceipt.deleteMany(); await prisma.earnings.deleteMany(); await prisma.shift.deleteMany(); await prisma.evidence.deleteMany();
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
    expect(json(r).user.payoutPercentage).toBe(20);
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
  it("edita o nome com trim e audita os valores anterior e posterior", async () => {
    const before = await app.prisma.user.findUniqueOrThrow({ where: { id: createdChatterId } });
    const r = await app.inject({
      method: "PATCH", url: `/api/v1/manager/users/${createdChatterId}`, headers: auth(managerToken),
      payload: { displayName: "  Chatter Renomeado  " }
    });
    expect(r.statusCode).toBe(200);
    expect(json(r).user.displayName).toBe("Chatter Renomeado");
    const after = await app.prisma.user.findUniqueOrThrow({ where: { id: createdChatterId } });
    expect(after.username).toBe(before.username);
    expect(after.authVersion).toBe(before.authVersion);
    const audit = await app.prisma.auditLog.findFirstOrThrow({
      where: { actorId: managerId, targetId: createdChatterId, action: AuditAction.USER_UPDATED },
      orderBy: { createdAt: "desc" }
    });
    expect(audit.metadata).toMatchObject({
      changes: { displayName: { before: before.displayName, after: "Chatter Renomeado" } }
    });
  });
  it("rejeita nome vazio após trim", async () => {
    const r = await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${createdChatterId}`, headers: auth(managerToken), payload: { displayName: "   " } });
    expect(r.statusCode).toBe(400);
  });
  it("permite ao gerente configurar e audita o payout inteiro do chatter", async () => {
    const r = await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${createdChatterId}`, headers: auth(managerToken), payload: { payoutPercentage: 35 } });
    expect(r.statusCode).toBe(200);
    expect(json(r).user.payoutPercentage).toBe(35);
    const updated = await app.prisma.user.findUniqueOrThrow({ where: { id: createdChatterId } });
    expect(updated.payoutPercentage).toBe(35);
    const audit = await app.prisma.auditLog.findFirstOrThrow({
      where: { actorId: managerId, targetId: createdChatterId, action: AuditAction.USER_UPDATED },
      orderBy: { createdAt: "desc" }
    });
    expect(audit.metadata).toMatchObject({
      changes: { payoutPercentage: { before: 20, after: 35 } }
    });
  });
  it.each([0, 101, 20.5])("rejeita payout inválido (%s)", async (payoutPercentage) => {
    const r = await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${createdChatterId}`, headers: auth(managerToken), payload: { payoutPercentage } });
    expect(r.statusCode).toBe(400);
  });
  it("rejeita payout para gerente e alteração feita por chatter", async () => {
    const managerTarget = await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${managerId}`, headers: auth(managerToken), payload: { payoutPercentage: 20 } });
    const chatterActor = await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${createdChatterId}`, headers: auth(chatterToken), payload: { payoutPercentage: 20 } });
    expect(managerTarget.statusCode).toBe(400);
    expect(chatterActor.statusCode).toBe(403);
  });
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
    expect(json(detail).chatter.payoutPercentage).toBe(20);
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
    const rejected = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(otherToken), payload: { modelTagId: otherTagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00", notificationsEnabled: true } });
    expect(rejected.statusCode).toBe(403);
    await app.inject({ method: "PATCH", url: `/api/v1/manager/tags/${otherTagId}`, headers: auth(managerToken), payload: { isActive: true } });
    await app.prisma.evidence.delete({ where: { id: evidence.id } });
  });
  it("exclui tag sem referências", async () => { const r = await app.inject({ method: "DELETE", url: `/api/v1/manager/tags/${createdTagId}`, headers: auth(managerToken) }); expect(r.statusCode).toBe(204); });
});

describe("turnos", () => {
  it("retorna turno atual vazio", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chatter/shifts/current", headers: auth(chatterToken) }); expect(json(r).shift).toBeNull(); });
  it("rejeita início sem imagem", async () => { const r = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(chatterToken), payload: { modelTagId: tagId } }); expect(r.statusCode).toBe(400); });
  it("exige notificações ativadas para iniciar", async () => { const evidence = await createTestEvidence(chatterId, "notificacao-obrigatoria.webp"); const r = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(chatterToken), payload: { modelTagId: tagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00" } }); expect(r.statusCode).toBe(403); await app.prisma.evidence.delete({ where: { id: evidence.id } }); });
  it("rejeita tag não vinculada", async () => { const evidence = await createTestEvidence(otherChatterId, "sem-tag.webp"); const r = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(otherToken), payload: { modelTagId: tagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00", notificationsEnabled: true } }); expect(r.statusCode).toBe(403); });
  it("impede dois turnos simultâneos sob requisições concorrentes", async () => {
    const evidences = await Promise.all([
      createTestEvidence(chatterId, "concorrente-a.webp"),
      createTestEvidence(chatterId, "concorrente-b.webp")
    ]);
    const responses = await Promise.all(evidences.map((evidence) => app.inject({
      method: "POST",
      url: "/api/v1/chatter/shifts/start",
      headers: auth(chatterToken),
      payload: { modelTagId: tagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00", notificationsEnabled: true }
    })));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const createdId = json(responses.find((response) => response.statusCode === 201)!).shift.id;
    await app.prisma.shift.delete({ where: { id: createdId } });
    await app.prisma.evidence.deleteMany({ where: { id: { in: evidences.map((evidence) => evidence.id) } } });
  });
  it("arquiva chatter sem apagar histórico ou vínculos e bloqueia novas alterações", async () => {
    const passwordHash = await bcrypt.hash("Password@123", 4);
    const archived = await app.prisma.user.create({
      data: { username: `archive.${crypto.randomUUID()}`, displayName: "Chatter Arquivado", passwordHash, role: Role.CHATTER }
    });
    const link = await app.prisma.chatterModelTag.create({ data: { chatterId: archived.id, modelTagId: tagId } });
    const shift = await app.prisma.shift.create({ data: {
      chatterId: archived.id, modelTagId: tagId, status: "CLOSED",
      startedAt: new Date("2026-08-01T10:00:00.000Z"), endedAt: new Date("2026-08-01T11:00:00.000Z"),
      startValueCents: 1000, endValueCents: 1000, grossAmountCents: 0, payoutAmountCents: 0
    } });
    const message = await app.prisma.chatMessage.create({
      data: { modelTagId: tagId, senderId: archived.id, content: "Histórico preservado" }
    });
    const session = await app.prisma.refreshSession.create({
      data: { userId: archived.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) }
    });

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/manager/users/${archived.id}`, headers: auth(managerToken) });
    expect(removed.statusCode).toBe(200);
    const stored = await app.prisma.user.findUniqueOrThrow({ where: { id: archived.id } });
    expect(stored.isActive).toBe(false);
    expect(stored.deletedAt).not.toBeNull();
    expect(await app.prisma.chatterModelTag.findUnique({ where: { id: link.id } })).not.toBeNull();
    expect(await app.prisma.shift.findUnique({ where: { id: shift.id } })).not.toBeNull();
    expect(await app.prisma.chatMessage.findUnique({ where: { id: message.id } })).not.toBeNull();
    expect((await app.prisma.refreshSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();

    const list = await app.inject({ method: "GET", url: `/api/v1/manager/chatters?search=${encodeURIComponent(archived.username)}`, headers: auth(managerToken) });
    expect(json(list).items).toHaveLength(0);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${archived.id}`, headers: auth(managerToken), payload: { displayName: "Outro nome" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/v1/manager/users/${archived.id}/reset-password`, headers: auth(managerToken), payload: { password: "Temporary@123" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `/api/v1/manager/chatters/${archived.id}/tags`, headers: auth(managerToken), payload: { modelTagIds: [] } })).statusCode).toBe(404);
  });
  it("serializa arquivamento com lançamento retroativo que cria ganho pendente", async () => {
    const passwordHash = await bcrypt.hash("Password@123", 4);
    const suffix = crypto.randomUUID();
    const [candidate, model] = await app.prisma.$transaction([
      app.prisma.user.create({ data: {
        username: `archive-retro.${suffix}`,
        displayName: "Corrida Retroativa",
        passwordHash,
        role: Role.CHATTER
      } }),
      app.prisma.modelTag.create({ data: { name: `Modelo corrida retro ${suffix}` } })
    ]);
    await app.prisma.chatterModelTag.create({ data: { chatterId: candidate.id, modelTagId: model.id } });
    const candidateToken = app.jwt.sign({ sub: candidate.id, role: Role.CHATTER, username: candidate.username, authVersion: 0 });
    const evidence = await Promise.all([
      createTestEvidence(candidate.id, "corrida-retro-inicio.webp"),
      createTestEvidence(candidate.id, "corrida-retro-fim.webp")
    ]);

    const [removed, retroactive] = await Promise.all([
      app.inject({ method: "DELETE", url: `/api/v1/manager/users/${candidate.id}`, headers: auth(managerToken) }),
      app.inject({ method: "POST", url: "/api/v1/chatter/shifts/retroactive-batch", headers: auth(candidateToken), payload: {
        startedAt: "2026-08-01T10:00:00.000Z",
        endedAt: "2026-08-01T11:00:00.000Z",
        shifts: [{
          modelTagId: model.id,
          start: { evidenceId: evidence[0].id, manualConfirmedValue: "R$ 100,00" },
          end: { evidenceId: evidence[1].id, manualConfirmedValue: "R$ 150,00" }
        }]
      } })
    ]);

    expect([[200, 401], [200, 403], [409, 201]]).toContainEqual([removed.statusCode, retroactive.statusCode]);
    const stored = await app.prisma.user.findUniqueOrThrow({ where: { id: candidate.id } });
    const pending = await app.prisma.earnings.count({ where: { chatterId: candidate.id, status: "PENDING" } });
    if (stored.deletedAt) {
      expect(pending).toBe(0);
    } else {
      expect(pending).toBeGreaterThan(0);
    }

    await app.prisma.earnings.deleteMany({ where: { chatterId: candidate.id } });
    await app.prisma.shift.deleteMany({ where: { chatterId: candidate.id } });
    await app.prisma.evidence.deleteMany({ where: { uploadedById: candidate.id } });
    await app.prisma.chatterModelTag.deleteMany({ where: { chatterId: candidate.id } });
    await app.prisma.auditLog.deleteMany({ where: { OR: [{ actorId: candidate.id }, { targetId: candidate.id }] } });
    await app.prisma.refreshSession.deleteMany({ where: { userId: candidate.id } });
    await app.prisma.user.delete({ where: { id: candidate.id } });
    await app.prisma.modelTag.delete({ where: { id: model.id } });
  });
  it("serializa arquivamento com recálculo que recria ganho pendente", async () => {
    const passwordHash = await bcrypt.hash("Password@123", 4);
    const suffix = crypto.randomUUID();
    const [candidate, model] = await app.prisma.$transaction([
      app.prisma.user.create({ data: {
        username: `archive-edit.${suffix}`,
        displayName: "Corrida Recálculo",
        passwordHash,
        role: Role.CHATTER
      } }),
      app.prisma.modelTag.create({ data: { name: `Modelo corrida edição ${suffix}` } })
    ]);
    await app.prisma.chatterModelTag.create({ data: { chatterId: candidate.id, modelTagId: model.id } });
    const shift = await app.prisma.shift.create({ data: {
      chatterId: candidate.id,
      modelTagId: model.id,
      status: "CLOSED",
      startedAt: new Date("2026-08-02T10:00:00.000Z"),
      endedAt: new Date("2026-08-02T11:00:00.000Z"),
      startValueCents: 10_000,
      endValueCents: 10_000,
      grossAmountCents: 0,
      payoutPercentage: 20,
      payoutAmountCents: 0
    } });
    const candidateToken = app.jwt.sign({ sub: candidate.id, role: Role.CHATTER, username: candidate.username, authVersion: 0 });

    const [removed, recalculated] = await Promise.all([
      app.inject({ method: "DELETE", url: `/api/v1/manager/users/${candidate.id}`, headers: auth(managerToken) }),
      app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${shift.id}`, headers: auth(candidateToken), payload: {
        startValue: "R$ 100,00",
        endValue: "R$ 150,00"
      } })
    ]);

    expect([[200, 409], [200, 401], [409, 200]]).toContainEqual([removed.statusCode, recalculated.statusCode]);
    const stored = await app.prisma.user.findUniqueOrThrow({ where: { id: candidate.id } });
    const pending = await app.prisma.earnings.count({ where: { chatterId: candidate.id, status: "PENDING" } });
    if (stored.deletedAt) {
      expect(pending).toBe(0);
    } else {
      expect(pending).toBeGreaterThan(0);
    }

    await app.prisma.earnings.deleteMany({ where: { chatterId: candidate.id } });
    await app.prisma.shift.deleteMany({ where: { chatterId: candidate.id } });
    await app.prisma.chatterModelTag.deleteMany({ where: { chatterId: candidate.id } });
    await app.prisma.auditLog.deleteMany({ where: { OR: [{ actorId: candidate.id }, { targetId: candidate.id }] } });
    await app.prisma.refreshSession.deleteMany({ where: { userId: candidate.id } });
    await app.prisma.user.delete({ where: { id: candidate.id } });
    await app.prisma.modelTag.delete({ where: { id: model.id } });
  });
  it("inicia turno", async () => { const evidence = await createTestEvidence(chatterId, "inicio.webp"); const r = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(chatterToken), payload: { modelTagId: tagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00", notificationsEnabled: true } }); expect(r.statusCode).toBe(201); openShiftId = json(r).shift.id; });
  it("persiste a abertura como evento com snapshot do nome", async () => {
    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: openShiftId } });
    const message = await app.prisma.chatMessage.findFirstOrThrow({
      where: { senderId: chatterId, modelTagId: tagId, kind: "SHIFT_EVENT" }, orderBy: { createdAt: "desc" }
    });
    expect(message.content).toBe(`Chatter Test abriu o ponto às ${businessTimeLabel(shift.startedAt)}h.`);
  });
  it("rejeita segundo turno aberto identificando o chatter", async () => {
    const evidence = await createTestEvidence(chatterId, "inicio-duplicado.webp");
    const r = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(chatterToken), payload: { modelTagId: tagId, startEvidenceId: evidence.id, manualConfirmedValue: "R$ 100,00", notificationsEnabled: true } });
    expect(r.statusCode).toBe(409);
    expect(json(r).error.message).toBe("O chatter Chatter Test está com o ponto aberto no momento.");
  });
  it("retorna turno atual", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chatter/shifts/current", headers: auth(chatterToken) }); expect(json(r).shift.id).toBe(openShiftId); });
  it("rejeita encerramento sem imagem", async () => { const r = await app.inject({ method: "POST", url: `/api/v1/chatter/shifts/${openShiftId}/end`, headers: auth(chatterToken), payload: {} }); expect(r.statusCode).toBe(400); });
  it("encerra turno positivo com o payout padrão de 20%", async () => {
    const evidence = await createTestEvidence(chatterId, "fim.webp");
    const r = await app.inject({ method: "POST", url: `/api/v1/chatter/shifts/${openShiftId}/end`, headers: auth(chatterToken), payload: { endEvidenceId: evidence.id, manualConfirmedValue: "R$ 140,00" } });
    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: openShiftId } });
    expect(r.statusCode).toBe(200);
    expect(shift.payoutPercentage).toBe(20);
    expect(shift.payoutAmountCents).toBe(800);
    const message = await app.prisma.chatMessage.findFirstOrThrow({
      where: { senderId: chatterId, modelTagId: tagId, kind: "SHIFT_EVENT", content: { contains: "bateu o ponto" } },
      orderBy: { createdAt: "desc" }
    });
    expect(message.content).toBe(`Chatter Test bateu o ponto às ${businessTimeLabel(shift.endedAt!)}h.`);
  });
  it("encerra uma única vez sob requisições concorrentes e cria um único evento", async () => {
    const startEvidence = await createTestEvidence(otherChatterId, "corrida-fechamento-inicio.webp");
    const startedAt = new Date("2026-08-26T11:00:00.000Z");
    const endedAt = new Date("2026-08-26T13:00:00.000Z");
    const opened = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(otherToken), payload: {
      modelTagId: otherTagId, startedAt: startedAt.toISOString(), startEvidenceId: startEvidence.id,
      manualConfirmedValue: "R$ 100,00", notificationsEnabled: true
    } });
    expect(opened.statusCode).toBe(201);
    const closeEvidence = await Promise.all([
      createTestEvidence(otherChatterId, "corrida-fechamento-a.webp"),
      createTestEvidence(otherChatterId, "corrida-fechamento-b.webp")
    ]);
    const responses = await Promise.all(closeEvidence.map((evidence) => app.inject({
      method: "POST", url: `/api/v1/chatter/shifts/${json(opened).shift.id}/end`, headers: auth(otherToken),
      payload: { endedAt: endedAt.toISOString(), endEvidenceId: evidence.id, manualConfirmedValue: "R$ 150,00" }
    })));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const content = `Other Test bateu o ponto às ${businessTimeLabel(endedAt)}h.`;
    expect(await app.prisma.chatMessage.count({ where: { senderId: otherChatterId, modelTagId: otherTagId, kind: "SHIFT_EVENT", content } })).toBe(1);
    await app.prisma.shift.delete({ where: { id: json(opened).shift.id } });
  });
  it("preserva o snapshot e usa a nova taxa apenas ao recalcular valores", async () => {
    const shift = await app.prisma.shift.create({ data: {
      chatterId: otherChatterId,
      modelTagId: otherTagId,
      status: "CLOSED",
      startedAt: new Date("2026-08-20T12:00:00.000Z"),
      endedAt: new Date("2026-08-20T14:00:00.000Z"),
      startValueCents: 0,
      endValueCents: 10_000,
      grossAmountCents: 10_000,
      payoutPercentage: 20,
      payoutAmountCents: 2_000
    } });
    await app.prisma.earnings.create({ data: { shiftId: shift.id, chatterId: otherChatterId, amountCents: 2_000 } });
    await app.inject({ method: "PATCH", url: `/api/v1/manager/users/${otherChatterId}`, headers: auth(managerToken), payload: { payoutPercentage: 35 } });

    await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${shift.id}`, headers: auth(otherToken), payload: { notes: "Sem recálculo financeiro" } });
    const preserved = await app.prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(preserved.payoutPercentage).toBe(20);
    expect(preserved.payoutAmountCents).toBe(2_000);

    await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${shift.id}`, headers: auth(otherToken), payload: { endValue: "R$ 200,00" } });
    const recalculated = await app.prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    const earnings = await app.prisma.earnings.findUniqueOrThrow({ where: { shiftId: shift.id } });
    expect(recalculated.payoutPercentage).toBe(35);
    expect(recalculated.payoutAmountCents).toBe(7_000);
    expect(earnings.amountCents).toBe(7_000);

    await app.prisma.shift.delete({ where: { id: shift.id } });
    await app.prisma.user.update({ where: { id: otherChatterId }, data: { payoutPercentage: 20 } });
  });
  it("lista histórico paginado", async () => { const r = await app.inject({ method: "GET", url: "/api/v1/chatter/shifts/history?page=1&pageSize=1", headers: auth(chatterToken) }); expect(r.statusCode).toBe(200); expect(json(r).items).toHaveLength(1); });
  it("rejeita PATCH vazio", async () => { const r = await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${openShiftId}`, headers: auth(chatterToken), payload: {} }); expect(r.statusCode).toBe(400); });
  it("edita observação do turno", async () => { const r = await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${openShiftId}`, headers: auth(chatterToken), payload: { notes: "Revisado" } }); expect(r.statusCode).toBe(200); expect(json(r).shift.notes).toBe("Revisado"); });
  it("rejeita datas invertidas no PATCH", async () => { const r = await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${openShiftId}`, headers: auth(chatterToken), payload: { startedAt: "2026-08-20T12:00:00.000Z", endedAt: "2026-08-19T12:00:00.000Z" } }); expect(r.statusCode).toBe(400); });
  it("rejeita lançamento editado sem duração", async () => { const instant = "2026-08-19T16:27:00.000Z"; const r = await app.inject({ method: "PATCH", url: `/api/v1/chatter/shifts/${openShiftId}`, headers: auth(chatterToken), payload: { startedAt: instant, endedAt: instant } }); expect(r.statusCode).toBe(400); });
  it("cria turno negativo com justificativa", async () => {
    const startEvidence = await createTestEvidence(chatterId, "negativo-inicio.webp");
    const endEvidence = await createTestEvidence(chatterId, "negativo-fim.webp");
    const start = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(chatterToken), payload: { modelTagId: tagId, startEvidenceId: startEvidence.id, manualConfirmedValue: "R$ 100,00", notificationsEnabled: true } }); negativeShiftId = json(start).shift.id;
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
  it("abre e encerra um lote simultâneo em duas modelos diferentes", async () => {
    await app.prisma.chatterModelTag.upsert({
      where: { chatterId_modelTagId: { chatterId, modelTagId: otherTagId } },
      create: { chatterId, modelTagId: otherTagId }, update: {}
    });
    const startEvidence = await Promise.all([
      createTestEvidence(chatterId, "lote-modelo-a-inicio.webp"),
      createTestEvidence(chatterId, "lote-modelo-b-inicio.webp")
    ]);
    const startedAt = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
    const opened = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start-batch", headers: auth(chatterToken), payload: {
      startedAt, notificationsEnabled: true,
      shifts: [
        { modelTagId: tagId, evidenceId: startEvidence[0].id, manualConfirmedValue: "R$ 100,00" },
        { modelTagId: otherTagId, evidenceId: startEvidence[1].id, manualConfirmedValue: "R$ 200,00" }
      ]
    } });
    expect(opened.statusCode).toBe(201);
    expect(json(opened).shifts).toHaveLength(2);
    for (const shift of json(opened).shifts as Array<{ modelTagId: string }>) {
      const event = await app.prisma.chatMessage.findFirstOrThrow({
        where: { senderId: chatterId, modelTagId: shift.modelTagId, kind: "SHIFT_EVENT" }, orderBy: { createdAt: "desc" }
      });
      expect(event.content).toBe(`Chatter Test abriu o ponto às ${businessTimeLabel(new Date(startedAt))}h.`);
    }
    const current = await app.inject({ method: "GET", url: "/api/v1/chatter/shifts/current", headers: auth(chatterToken) });
    expect(json(current).shifts).toHaveLength(2);

    const endEvidence = await Promise.all([
      createTestEvidence(chatterId, "lote-modelo-a-fim.webp"),
      createTestEvidence(chatterId, "lote-modelo-b-fim.webp")
    ]);
    const ended = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/end-batch", headers: auth(chatterToken), payload: {
      endedAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
      shifts: json(opened).shifts.map((shift: { id: string; modelTagId: string }, index: number) => ({
        shiftId: shift.id, evidenceId: endEvidence[index].id,
        manualConfirmedValue: shift.modelTagId === tagId ? "R$ 140,00" : "R$ 250,00"
      }))
    } });
    expect(ended.statusCode).toBe(200);
    expect(json(ended).shifts).toHaveLength(2);
    for (const shift of json(ended).shifts as Array<{ modelTagId: string; endedAt: string }>) {
      const event = await app.prisma.chatMessage.findFirstOrThrow({
        where: { senderId: chatterId, modelTagId: shift.modelTagId, kind: "SHIFT_EVENT", content: { contains: "bateu o ponto" } },
        orderBy: { createdAt: "desc" }
      });
      expect(event.content).toBe(`Chatter Test bateu o ponto às ${businessTimeLabel(new Date(shift.endedAt))}h.`);
    }
  });
  it("aceita turno anterior sem sobreposição enquanto outro chatter está online na mesma modelo", async () => {
    await app.prisma.chatterModelTag.upsert({
      where: { chatterId_modelTagId: { chatterId: otherChatterId, modelTagId: tagId } },
      create: { chatterId: otherChatterId, modelTagId: tagId }, update: {}
    });
    const now = Date.now();
    const onlineEvidence = await createTestEvidence(otherChatterId, "online-atual.webp");
    const online = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/start", headers: auth(otherToken), payload: {
      modelTagId: tagId, startedAt: new Date(now - 2 * 60 * 60_000).toISOString(),
      startEvidenceId: onlineEvidence.id, manualConfirmedValue: "R$ 500,00", notificationsEnabled: true
    } });
    expect(online.statusCode).toBe(201);

    const retroEvidence = await Promise.all([
      createTestEvidence(chatterId, "retro-inicio.webp"), createTestEvidence(chatterId, "retro-fim.webp")
    ]);
    const retro = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/retroactive-batch", headers: auth(chatterToken), payload: {
      startedAt: new Date(now - 26 * 60 * 60_000).toISOString(),
      endedAt: new Date(now - 20 * 60 * 60_000).toISOString(),
      shifts: [{ modelTagId: tagId,
        start: { evidenceId: retroEvidence[0].id, manualConfirmedValue: "R$ 100,00" },
        end: { evidenceId: retroEvidence[1].id, manualConfirmedValue: "R$ 160,00" }
      }]
    } });
    expect(retro.statusCode).toBe(201);

    const overlapEvidence = await Promise.all([
      createTestEvidence(chatterId, "sobreposto-inicio.webp"), createTestEvidence(chatterId, "sobreposto-fim.webp")
    ]);
    const overlap = await app.inject({ method: "POST", url: "/api/v1/chatter/shifts/retroactive-batch", headers: auth(chatterToken), payload: {
      startedAt: new Date(now - 90 * 60_000).toISOString(), endedAt: new Date(now - 30 * 60_000).toISOString(),
      shifts: [{ modelTagId: tagId,
        start: { evidenceId: overlapEvidence[0].id, manualConfirmedValue: "R$ 200,00" },
        end: { evidenceId: overlapEvidence[1].id, manualConfirmedValue: "R$ 210,00" }
      }]
    } });
    expect(overlap.statusCode).toBe(409);
    await app.prisma.shift.delete({ where: { id: json(online).shift.id } });
  });
  it("permite ao gerente apagar turno confirmado não pago e protege turno pago", async () => {
    const removable = await app.prisma.shift.create({ data: {
      chatterId, modelTagId: tagId, status: "CLOSED", startedAt: new Date("2026-08-18T10:00:00.000Z"),
      endedAt: new Date("2026-08-18T11:00:00.000Z"), startValueCents: 0, endValueCents: 5000,
      grossAmountCents: 5000, payoutPercentage: 20, payoutAmountCents: 1000, chatterVerifiedAt: new Date()
    } });
    await app.prisma.earnings.create({ data: { chatterId, shiftId: removable.id, amountCents: 1000 } });
    const deleted = await app.inject({ method: "DELETE", url: `/api/v1/manager/shifts/${removable.id}`, headers: auth(managerToken) });
    expect(deleted.statusCode).toBe(200);
    expect(await app.prisma.shift.findUnique({ where: { id: removable.id } })).toBeNull();

    const paidShift = await app.prisma.shift.create({ data: {
      chatterId, modelTagId: tagId, status: "CLOSED", startedAt: new Date("2026-08-18T12:00:00.000Z"),
      endedAt: new Date("2026-08-18T13:00:00.000Z"), startValueCents: 0, endValueCents: 5000,
      grossAmountCents: 5000, payoutPercentage: 20, payoutAmountCents: 1000
    } });
    const payment = await app.prisma.paymentHistory.create({ data: { chatterId, managerId, totalCents: 1000 } });
    await app.prisma.earnings.create({ data: { chatterId, shiftId: paidShift.id, amountCents: 1000, status: "PAID", paidAt: new Date(), paymentId: payment.id } });
    const protectedResponse = await app.inject({ method: "DELETE", url: `/api/v1/manager/shifts/${paidShift.id}`, headers: auth(managerToken) });
    expect(protectedResponse.statusCode).toBe(409);
    await app.prisma.earnings.delete({ where: { shiftId: paidShift.id } });
    await app.prisma.paymentHistory.delete({ where: { id: payment.id } });
    await app.prisma.shift.delete({ where: { id: paidShift.id } });
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
  it("registra pagamento idempotente sem exigir conciliação", async () => {
    const pending = await app.prisma.earnings.findMany({ where: { chatterId, status: "PENDING" }, select: { shiftId: true } });
    await app.prisma.shift.updateMany({
      where: { id: { in: pending.map((item) => item.shiftId) } },
      data: { chatterVerifiedAt: new Date() }
    });
    const balancesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/manager/payments/balances?page=1&pageSize=20",
      headers: auth(managerToken)
    });
    const balance = json(balancesResponse).items.find((item: { id: string }) => item.id === chatterId);
    expect(balance.payableCents).toBeGreaterThan(0);
    expect(balance.payableCents).toBe(balance.verifiedCents);
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
      grossAmountCents: 4000, payoutAmountCents: 1000, commissionDivisor: 4, chatterVerifiedAt: new Date()
    } });
    await app.prisma.earnings.create({ data: { shiftId: shift.id, chatterId, amountCents: 1000 } });
    await makeShiftPayable(shift.id);
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
  it("lista as salas atualmente vinculadas sem depender da quantidade inicial", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/chat/rooms", headers: auth(chatterToken) });
    expect(r.statusCode).toBe(200);
    expect(json(r).rooms.map((room: { id: string }) => room.id)).toEqual(expect.arrayContaining([tagId, otherTagId]));
  });
  it("permite ao gerente listar e acessar salas ativas", async () => {
    const rooms = await app.inject({ method: "GET", url: "/api/v1/chat/rooms", headers: auth(managerToken) });
    const messages = await app.inject({ method: "GET", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(managerToken) });
    expect(json(rooms).rooms.some((room: { id: string }) => room.id === tagId)).toBe(true);
    expect(messages.statusCode).toBe(200);
  });
  it("envia mensagem de usuário com kind compatível", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(chatterToken), payload: { content: "Olá" } });
    expect(r.statusCode).toBe(201);
    expect(json(r).message.kind).toBe("USER");
  });
  it("lista a mensagem criada pelo próprio teste", async () => {
    const content = `Mensagem isolada ${crypto.randomUUID()}`;
    await app.prisma.chatMessage.create({ data: { modelTagId: tagId, senderId: chatterId, content } });
    const r = await app.inject({ method: "GET", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(chatterToken) });
    expect(r.statusCode).toBe(200);
    expect(json(r).messages).toEqual(expect.arrayContaining([expect.objectContaining({ content, kind: "USER" })]));
  });
  it("rejeita mensagem vazia", async () => { const r = await app.inject({ method: "POST", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(chatterToken), payload: { content: "" } }); expect(r.statusCode).toBe(400); });
  it("rejeita mensagem acima de 2000 caracteres", async () => { const r = await app.inject({ method: "POST", url: `/api/v1/chat/rooms/${tagId}/messages`, headers: auth(chatterToken), payload: { content: "x".repeat(2001) } }); expect(r.statusCode).toBe(400); });
  it("rejeita acesso a uma sala criada sem vínculo para o chatter", async () => {
    const isolatedTag = await app.prisma.modelTag.create({ data: { name: `Sala isolada ${crypto.randomUUID()}` } });
    const r = await app.inject({ method: "GET", url: `/api/v1/chat/rooms/${isolatedTag.id}/messages`, headers: auth(otherToken) });
    expect(r.statusCode).toBe(403);
    await app.prisma.modelTag.delete({ where: { id: isolatedTag.id } });
  });
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
