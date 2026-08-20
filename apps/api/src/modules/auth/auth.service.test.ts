import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { refreshTokenExpirationDate, tokenHash, verifyRefreshToken } from "./auth.service";

describe("serviço de refresh token", () => {
  it("rejeita payload textual e tipo de token incorreto", () => {
    const textual = jwt.sign("payload", env.JWT_REFRESH_SECRET, { algorithm: "HS256" });
    const wrongType = jwt.sign({ sub: "user", sessionId: "session", tokenType: "access" }, env.JWT_REFRESH_SECRET, { algorithm: "HS256" });
    expect(() => verifyRefreshToken(textual)).toThrow("Invalid refresh token payload");
    expect(() => verifyRefreshToken(wrongType)).toThrow("Invalid token type");
  });

  it("gera hash estável e expiração futura", () => {
    expect(tokenHash("token")).toBe(tokenHash("token"));
    expect(tokenHash("token")).not.toBe(tokenHash("other"));
    expect(refreshTokenExpirationDate().getTime()).toBeGreaterThan(Date.now());
  });
});
