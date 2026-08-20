export const MANAGER_ROOM = "role:manager";
export const ANALYTICS_UPDATED_EVENT = "analytics:updated";
export const PAYMENTS_UPDATED_EVENT = "payments:updated";

export type AnalyticsUpdatedPayload = {
  shiftId: string;
  operation: "closed" | "updated" | "deleted";
};
