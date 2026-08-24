import { describe, expect, it } from "vitest";
import { calculatePayoutCents } from "./payout";

describe("calculatePayoutCents", () => {
  it("calcula percentuais inteiros", () => {
    expect(calculatePayoutCents(10_000, 20)).toBe(2_000);
    expect(calculatePayoutCents(10_000, 35)).toBe(3_500);
  });

  it("trunca frações de centavo como o cálculo legado", () => {
    expect(calculatePayoutCents(101, 20)).toBe(20);
  });

  it("mantém o truncamento em valores negativos", () => {
    expect(calculatePayoutCents(-101, 20)).toBe(-20);
  });

  it("evita perda de precisão em valores monetários grandes", () => {
    const grossAmountCents = Number.MAX_SAFE_INTEGER;
    expect(calculatePayoutCents(grossAmountCents, 100)).toBe(grossAmountCents);
  });
});
