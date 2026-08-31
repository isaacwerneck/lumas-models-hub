import { validateHeaderValue } from "node:http";
import { describe, expect, it } from "vitest";
import { inlineContentDisposition } from "./content-disposition";

describe("Content-Disposition privado", () => {
  it("mantém nome Unicode no filename* e usa fallback ASCII válido", () => {
    const value = inlineContentDisposition("Captura ação 🚀 final.webp");

    expect(value).toContain('filename="Captura acao _ final.webp"');
    expect(value).toContain("filename*=UTF-8''Captura%20a%C3%A7%C3%A3o%20%F0%9F%9A%80%20final.webp");
    expect(() => validateHeaderValue("Content-Disposition", value)).not.toThrow();
  });

  it("remove caminho, quebras de linha, aspas e barras do fallback", () => {
    const value = inlineContentDisposition('../pasta\\foto"\r\n.webp');

    expect(value).toContain('filename="foto___.webp"');
    expect(value).not.toContain("pasta");
    expect(() => validateHeaderValue("Content-Disposition", value)).not.toThrow();
  });
});
