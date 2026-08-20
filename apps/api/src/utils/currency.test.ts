import { describe, expect, it } from "vitest";
import {
  brlStringToCents,
  centsToBrl,
  extractCurrencyCandidatesFromText,
  extractFaturadoValueFromText,
  resolveOcrValueCents
} from "./currency";

describe("utilitários monetários", () => {
  it.each([
    ["R$ 1.234,56", 123456],
    ["45,60", 4560],
    ["12.34", 1234],
    ["  ", null],
    ["inválido", null]
  ])("converte %s em centavos", (input, expected) => {
    expect(brlStringToCents(input)).toBe(expected);
  });

  it("extrai candidatos e formata BRL", () => {
    expect(extractCurrencyCandidatesFromText("Hoje R$ 45,60 e total 1.234,50")).toEqual(["R$ 45,60", "1.234,50"]);
    expect(extractCurrencyCandidatesFromText("sem números")).toEqual([]);
    expect(centsToBrl(5697)).toMatch(/56,97/);
  });

  it.each([
    ["Faturamento\nR$ 670,29\nTotal", "R$ 670,29"],
    ["FATURADO HOJE 67029", "670,29"],
    ["faturament0\nO 12345", "123,45"],
    ["Hoje\nR$ 98,70", "R$ 98,70"],
    ["Hoje\n1234", "12,34"],
    ["Faturamento\n0,00\nLiberado\nR$ 99,00", null],
    ["", null]
  ])("localiza o valor ancorado no OCR", (text, expected) => {
    expect(extractFaturadoValueFromText(text)).toBe(expected);
  });

  it("resolve valor detectado, texto ancorado, maior candidato e ausência", () => {
    expect(resolveOcrValueCents({ detectedValue: "R$ 10,00" })).toBe(1000);
    expect(resolveOcrValueCents({ rawText: "Faturamento\nR$ 20,00" })).toBe(2000);
    expect(resolveOcrValueCents({ rawText: "taxa 10,00 e saldo 99,90" })).toBe(9990);
    expect(resolveOcrValueCents({ rawText: "sem valor" })).toBeNull();
    expect(resolveOcrValueCents({ rawText: `${"9".repeat(400)},00` })).toBeNull();
    expect(resolveOcrValueCents({})).toBeNull();
  });
});
