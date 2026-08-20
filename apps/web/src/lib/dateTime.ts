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
