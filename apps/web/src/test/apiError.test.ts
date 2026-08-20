import { describe, expect, it } from "vitest";
import { getApiErrorMessage } from "../lib/apiError";

describe("mensagens de erro da API", () => {
  it("entende envelope v1, legado, erro local e fallback", () => {
    expect(getApiErrorMessage({ response: { data: { error: { message: "Conflito" } } } }, "fallback")).toBe("Conflito");
    expect(getApiErrorMessage({ response: { data: { message: "Legado" } } }, "fallback")).toBe("Legado");
    expect(getApiErrorMessage(new Error("Offline"), "fallback")).toBe("Offline");
    expect(getApiErrorMessage({}, "fallback")).toBe("fallback");
  });

  it("inclui issues quando solicitado", () => {
    const error = { response: { data: { error: { message: "Dados inválidos.", issues: [
      { field: "password", message: "muito curta" }, {}
    ] } } } };
    expect(getApiErrorMessage(error, "fallback", true)).toContain("password: muito curta; campo: inválido");
  });
});
