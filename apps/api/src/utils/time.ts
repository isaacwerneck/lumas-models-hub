import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { env } from "../config/env";

dayjs.extend(utc);
dayjs.extend(timezone);

export const nowInBusinessTz = () => dayjs().tz(env.TZ);

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
