import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { env } from "./config/env";
import prismaPlugin from "./plugins/prisma";
import authPlugin from "./plugins/auth";
import socketPlugin from "./plugins/socket";
import shiftRemindersPlugin from "./plugins/shift-reminders";
import storagePlugin from "./plugins/storage";
import authRoutes from "./modules/auth/auth.routes";
import chatterRoutes from "./modules/chatter/chatter.routes";
import managerRoutes from "./modules/manager/manager.routes";
import chatRoutes from "./modules/chat/chat.routes";
import ocrRoutes from "./modules/ocr/ocr.routes";
import fxRoutes from "./modules/fx/fx.routes";
import mphRoutes from "./modules/mph/mph.routes";
import notificationRoutes from "./modules/notifications/notification.routes";
import reportRoutes from "./modules/reports/report.routes";
import evidenceRoutes from "./modules/evidence/evidence.routes";
import paymentReceiptRoutes from "./modules/payment-receipts/payment-receipt.routes";
import reconciliationRoutes from "./modules/reconciliation/reconciliation.routes";
import workspaceRoutes from "./modules/workspace/workspace.routes";

const registerRouteSet = async (app: FastifyInstance) => {
  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });
  app.get("/ready", async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      await app.evidenceStorage.ready();
      return { status: "ready", timestamp: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(chatterRoutes, { prefix: "/chatter" });
  app.register(managerRoutes, { prefix: "/manager" });
  app.register(chatRoutes, { prefix: "/chat" });
  app.register(ocrRoutes, { prefix: "/ocr" });
  app.register(fxRoutes, { prefix: "/fx" });
  app.register(mphRoutes, { prefix: "/mph" });
  app.register(notificationRoutes, { prefix: "/notifications" });
  app.register(reportRoutes, { prefix: "/manager/reports" });
  app.register(evidenceRoutes, { prefix: "/evidence" });
  app.register(paymentReceiptRoutes);
  app.register(reconciliationRoutes);
  app.register(workspaceRoutes);
};

export const buildApp = () => {
  const app = Fastify({
    logger: env.NODE_ENV !== "test",
    trustProxy: env.TRUST_PROXY
  });

  // ZodError (validação de body) deve retornar 400, não 500
  app.setErrorHandler((error, request, reply) => {
    const isV1 = request.url.startsWith("/api/v1/");
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message
      }));
      return reply.code(400).send(isV1
        ? { error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", issues, requestId: request.id } }
        : { message: "Dados inválidos.", issues });
    }
    const requestError = error as { statusCode?: number; message?: string };
    const statusCode = typeof requestError.statusCode === "number" && requestError.statusCode >= 400 && requestError.statusCode < 500
      ? requestError.statusCode
      : 500;
    const message = statusCode === 500 ? "Erro interno. Tente novamente." : requestError.message ?? "Requisição inválida.";
    if (statusCode === 500) request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
    return reply.code(statusCode).send(isV1
      ? { error: { code: statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", message, requestId: request.id } }
      : { message });
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-Id", request.id);
    if (request.url.startsWith("/api/v1/") && reply.statusCode >= 400 && typeof payload === "string") {
      try {
        const body = JSON.parse(payload) as { error?: unknown; message?: string; issues?: unknown };
        if (!body.error && body.message) {
          const codes: Record<number, string> = {
            400: "BAD_REQUEST",
            401: "AUTH_REQUIRED",
            403: "FORBIDDEN",
            404: "NOT_FOUND",
            409: "CONFLICT",
            410: "GONE",
            423: "ACCOUNT_LOCKED",
            429: "RATE_LIMITED"
          };
          reply.removeHeader("content-length");
          return JSON.stringify({
            error: {
              code: codes[reply.statusCode] ?? "REQUEST_ERROR",
              message: body.message,
              ...(body.issues ? { issues: body.issues } : {}),
              requestId: request.id
            }
          });
        }
      } catch {
        // Respostas binárias/textuais não fazem parte do contrato JSON de erros.
      }
    }
    return payload;
  });

  app.register(cors, {
    origin: env.NODE_ENV === "production"
      ? env.APP_ORIGIN
      : [env.APP_ORIGIN, /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });

  app.register(cookie);
  app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024
    }
  });
  app.register(rateLimit, {
    global: false
  });
  app.register(helmet, {
    strictTransportSecurity: env.NODE_ENV === "production" ? undefined : false
  });
  app.register(prismaPlugin);
  app.register(storagePlugin);
  app.register(authPlugin);
  app.register(socketPlugin);
  app.register(shiftRemindersPlugin);

  app.register(async (legacy) => {
    legacy.addHook("onSend", async (_request, reply) => {
      reply.header("Deprecation", "true");
      reply.header("Link", '</api/v1>; rel="successor-version"');
    });
    await registerRouteSet(legacy);
  });

  app.register(registerRouteSet, { prefix: "/api/v1" });

  return app;
};
