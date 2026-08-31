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

  it("não expõe mensagens técnicas de rede", () => {
    expect(getApiErrorMessage({ code: "ERR_NETWORK", message: "Network Error", request: {} }, "fallback"))
      .toBe("Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.");
    expect(getApiErrorMessage(new Error("Request failed with status code 500"), "Não foi possível concluir."))
      .toBe("Não foi possível concluir.");
    expect(getApiErrorMessage({ response: { data: { message: "PrismaClientKnownRequestError: SQLSTATE 23505" } } }, "Mensagem segura."))
      .toBe("Mensagem segura.");
  });
});
