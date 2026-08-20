import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { newEvidenceKey, normalizeEvidenceImage } from "./storage";

describe("normalização segura de comprovantes", () => {
  it("valida assinatura, converte para WebP, remove metadados e calcula hash", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#ff00aa" } }).png().toBuffer();
    const normalized = await normalizeEvidenceImage(png);
    expect(normalized.mimeType).toBe("image/webp");
    expect(normalized.buffer.subarray(8, 12).toString()).toBe("WEBP");
    expect(normalized.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejeita conteúdo sem assinatura de imagem", async () => {
    await expect(normalizeEvidenceImage(Buffer.from("not-an-image"))).rejects.toThrow();
  });

  it("gera chave privada particionada por data e usuário", () => {
    expect(newEvidenceKey("user-safe")).toMatch(/^\d{4}\/\d{2}\/user-safe\/[0-9a-f-]+\.webp$/);
  });
});
