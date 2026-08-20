import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { env } from "../config/env";

dayjs.extend(utc);
dayjs.extend(timezone);

export const nowInBusinessTz = () => dayjs().tz(env.TZ);

export const businessDateKey = (date: Date) => dayjs(date).tz(env.TZ).format("YYYY-MM-DD");

export const businessDateKeysInclusive = (firstKey: string, lastKey: string) => {
  const keys: string[] = [];
  let cursor = dayjs.tz(firstKey, env.TZ).startOf("day");
  const end = dayjs.tz(lastKey, env.TZ).startOf("day");
  while (!cursor.isAfter(end)) {
    keys.push(cursor.format("YYYY-MM-DD"));
    cursor = cursor.add(1, "day");
  }
  return keys;
};

export const getMonthRangeInBusinessTz = (monthOffset = 0, referenceDate?: Date) => {
  const ref = (referenceDate ? dayjs(referenceDate) : dayjs()).tz(env.TZ).add(monthOffset, "month");
  const start = ref.startOf("month");
  return { gte: start.toDate(), lt: start.add(1, "month").toDate() };
};

export const getCurrentWeekHalfOpenRange = (referenceDate?: Date) => {
  const ref = referenceDate ? dayjs(referenceDate).tz(env.TZ) : nowInBusinessTz();
  const mondayOffset = (ref.day() + 6) % 7;
  const start = ref.startOf("day").subtract(mondayOffset, "day");
  return { gte: start.toDate(), lt: start.add(7, "day").toDate() };
};

export const getWeekRangeInBusinessTz = (referenceDate?: Date) => {
  const ref = referenceDate ? dayjs(referenceDate).tz(env.TZ) : nowInBusinessTz();
  const mondayOffset = (ref.day() + 6) % 7;

  const weekStart = ref.startOf("day").subtract(mondayOffset, "day");
  const weekEnd = weekStart.add(6, "day").endOf("day");

  return {
    weekStart: weekStart.toDate(),
    weekEnd: weekEnd.toDate()
  };
};

export const isMondayInBusinessTz = (referenceDate?: Date) => {
  const ref = referenceDate ? dayjs(referenceDate).tz(env.TZ) : nowInBusinessTz();
  return ref.day() === 1;
};

export const daysUntilNextMonday = (referenceDate?: Date) => {
  const ref = referenceDate ? dayjs(referenceDate).tz(env.TZ) : nowInBusinessTz();
  const day = ref.day();
  if (day === 1) {
    return 0;
  }

  return (8 - day) % 7;
};
