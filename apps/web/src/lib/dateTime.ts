export const BUSINESS_TIME_ZONE = "America/Sao_Paulo";

export const formatDateTime = (value: string | Date) => new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: BUSINESS_TIME_ZONE
}).format(new Date(value));

export const formatTime = (value: string | Date) => new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE
}).format(new Date(value));

const businessParts = (value: string | Date) => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
) as Record<string, string>;

export const getBusinessDateTimeParts = (value: string | Date = new Date()) => {
  const parts = businessParts(value);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

export const formatBusinessDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
};

export const legacyIsoFromLocalFields = (date: string, time: string) => {
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
