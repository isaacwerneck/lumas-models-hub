import type { FastifyRequest } from "fastify";

export const auditRequestMetadata = (request: FastifyRequest) => ({
  ip: request.ip,
  userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null
});
