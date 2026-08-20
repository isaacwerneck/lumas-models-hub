import { describe, expect, it } from "vitest";
import { computeMph, formatHours, getReportedShiftDurationMs, getWindowRange, MINIMUM_REPORTED_SHIFT_DURATION_MS } from "./mph";

describe("getReportedShiftDurationMs", () => {
  it("usa um minuto para lançamentos legados com início e fim iguais", () => {
    const instant = new Date("2026-08-19T19:27:00.000Z");
    expect(getReportedShiftDurationMs(instant, instant)).toBe(MINIMUM_REPORTED_SHIFT_DURATION_MS);
  });

  it("rejeita duração negativa", () => {
    const start = new Date("2026-08-19T19:28:00.000Z");
    const end = new Date("2026-08-19T19:27:00.000Z");
    expect(getReportedShiftDurationMs(start, end)).toBeNull();
  });

  it("calcula todas as janelas, formatos de duração e MPH", () => {
    expect(getWindowRange("all")).toEqual({});
    expect(getWindowRange("month")).toHaveProperty("gte");
    expect(getWindowRange("week")).toHaveProperty("lt");
    expect(formatHours(30 * 60_000)).toBe("30m");
    expect(formatHours(2 * 3_600_000)).toBe("2h");
    expect(formatHours(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
    expect(computeMph(10_000, 2 * 3_600_000).mphCentsPerHour).toBe(5_000);
    expect(computeMph(10_000, 0).mphCentsPerHour).toBe(0);
  });
});
