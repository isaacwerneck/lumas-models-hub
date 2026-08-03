import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env";

const refreshExpiresInSeconds = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

export type AccessTokenPayload = {
  sub: string;
  username: string;
  role: "CHATTER" | "MANAGER";
};

type RefreshTokenPayload = {
  sub: string;
  sessionId: string;
  tokenType: "refresh";
};

const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const buildAccessToken = (fastify: FastifyInstance, payload: AccessTokenPayload): string => {
  return fastify.jwt.sign(payload, {
    expiresIn: env.ACCESS_TOKEN_TTL
  });
};

export const buildRefreshToken = (payload: RefreshTokenPayload): string => {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: refreshExpiresInSeconds,
    algorithm: "HS256"
  });
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
    algorithms: ["HS256"]
  });

  if (typeof payload === "string") {
    throw new Error("Invalid refresh token payload.");
  }

  if (payload.tokenType !== "refresh") {
    throw new Error("Invalid token type.");
  }

  return payload as RefreshTokenPayload;
};

export const refreshTokenExpirationDate = (): Date => {
  return new Date(Date.now() + refreshExpiresInSeconds * 1000);
};

export const refreshCookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.COOKIE_SECURE
};

export const tokenHash = hashToken;
