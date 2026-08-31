import { describe, expect, it } from "vitest";
import {
  businessDateKey,
  businessDateKeysInclusive,
  businessTimeLabel,
  daysUntilNextMonday,
  getCurrentWeekHalfOpenRange,
  getMonthRangeInBusinessTz,
  getWeekRangeInBusinessTz,
  isMondayInBusinessTz,
  isSameBusinessDate,
  nowInBusinessTz,
  parseBusinessLocalDateTime
} from "./time";

describe("períodos em America/Sao_Paulo", () => {
  const wednesday = new Date("2026-08-19T15:00:00.000Z");

  it("produz início/fim do mês no fuso do negócio", () => {
    expect(getMonthRangeInBusinessTz(0, wednesday)).toEqual({
      gte: new Date("2026-08-01T03:00:00.000Z"),
      lt: new Date("2026-09-01T03:00:00.000Z")
    });
    expect(getMonthRangeInBusinessTz(1, wednesday).gte).toEqual(new Date("2026-09-01T03:00:00.000Z"));
  });

  it("produz semana de segunda a segunda sem sobreposição", () => {
    expect(getCurrentWeekHalfOpenRange(wednesday)).toEqual({
      gte: new Date("2026-08-17T03:00:00.000Z"),
      lt: new Date("2026-08-24T03:00:00.000Z")
    });
    const closed = getWeekRangeInBusinessTz(wednesday);
    expect(closed.weekStart).toEqual(new Date("2026-08-17T03:00:00.000Z"));
    expect(closed.weekEnd).toEqual(new Date("2026-08-24T02:59:59.999Z"));
  });

  it("calcula segunda-feira e dias restantes", () => {
    expect(isMondayInBusinessTz(new Date("2026-08-17T15:00:00.000Z"))).toBe(true);
    expect(isMondayInBusinessTz(wednesday)).toBe(false);
    expect(daysUntilNextMonday(new Date("2026-08-17T15:00:00.000Z"))).toBe(0);
    expect(daysUntilNextMonday(wednesday)).toBe(5);
    expect(nowInBusinessTz().isValid()).toBe(true);
  });

  it("gera chaves diárias independentes do fuso do servidor", () => {
    expect(businessDateKey(new Date("2026-08-20T01:30:00.000Z"))).toBe("2026-08-19");
    expect(businessDateKeysInclusive("2026-08-30", "2026-09-02")).toEqual([
      "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"
    ]);
  });

  it("formata o horário dos eventos no fuso do negócio", () => {
    expect(businessTimeLabel(new Date("2026-08-20T01:30:00.000Z"))).toBe("22:30");
  });

  it("interpreta campos locais e detecta a virada do dia operacional", () => {
    expect(parseBusinessLocalDateTime("2026-08-20", "18:25")).toEqual(new Date("2026-08-20T21:25:00.000Z"));
    expect(parseBusinessLocalDateTime("2026-02-31", "18:25")).toBeNull();
    expect(isSameBusinessDate(new Date("2026-08-20T03:00:00.000Z"), new Date("2026-08-21T02:59:59.000Z"))).toBe(true);
    expect(isSameBusinessDate(new Date("2026-08-21T02:59:59.000Z"), new Date("2026-08-21T03:00:00.000Z"))).toBe(false);
  });
});
