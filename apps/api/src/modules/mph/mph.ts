import { centsToBrl } from "../../utils/currency";
import { getCurrentWeekHalfOpenRange, getMonthRangeInBusinessTz } from "../../utils/time";

export type MphWindow = "month" | "week" | "all";

export const MPH_WINDOWS = ["month", "week", "all"] as const;

export const MINIMUM_REPORTED_SHIFT_DURATION_MS = 60_000;

export const getReportedShiftDurationMs = (startedAt: Date, endedAt: Date): number | null => {
  const durationMs = endedAt.getTime() - startedAt.getTime();

  if (durationMs < 0) {
    return null;
  }

  // O editor trabalha com precisão de minutos. Registros legados no mesmo minuto
  // precisam continuar aparecendo nos totais sem provocar divisão por zero.
  return Math.max(durationMs, MINIMUM_REPORTED_SHIFT_DURATION_MS);
};

export const getWindowRange = (window: MphWindow): { gte?: Date; lt?: Date } => {
  if (window === "all") {
    return {};
  }

  if (window === "month") {
    return getMonthRangeInBusinessTz();
  }
  return getCurrentWeekHalfOpenRange();
};

export const formatHours = (totalHoursMs: number): string => {
  const totalMinutes = Math.round(totalHoursMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
};

export const computeMph = (totalGrossCents: number, totalHoursMs: number) => {
  const mphCentsPerHour = totalHoursMs > 0 ? totalGrossCents / (totalHoursMs / 3600000) : 0;

  return {
    totalGrossCents,
    totalGrossFormatted: centsToBrl(totalGrossCents),
    totalHoursMs,
    totalHoursFormatted: formatHours(totalHoursMs),
    mphCentsPerHour,
    mphFormatted: `${centsToBrl(mphCentsPerHour)}/h`
  };
};
