import { describe, expect, it } from "vitest";
import { BUSINESS_TIME_ZONE, formatDateTime, formatTime } from "../lib/dateTime";

describe("formatação no fuso do negócio", () => {
  it("mantém a virada de dia em America/Sao_Paulo", () => {
    const instant = "2026-08-20T01:30:00.000Z";
    expect(BUSINESS_TIME_ZONE).toBe("America/Sao_Paulo");
    expect(formatDateTime(instant)).toContain("19/08/2026");
    expect(formatTime(instant)).toMatch(/22:30/);
  });
});
