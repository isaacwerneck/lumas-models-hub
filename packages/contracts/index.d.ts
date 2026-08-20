export type Role = "CHATTER" | "MANAGER";

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PaginatedResponse<T> = {
  items: T[];
  pagination: Pagination;
};

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
};

export type AuthResponse = { accessToken: string; user: AuthUser };

export type NotificationType = "OCR_LOW_CONFIDENCE" | "NEGATIVE_SHIFT";
export type NotificationDto = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  sourceType: string;
  sourceId: string;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationListResponse = PaginatedResponse<NotificationDto> & {
  unreadCount: number;
};

export type AuditLogDto = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: Pick<AuthUser, "id" | "username" | "displayName"> | null;
};

export type ChatterListItem = {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  totalShifts: number;
  totalGrossCents: number;
  totalGrossFormatted: string;
  totalPayoutCents: number;
  totalPayoutFormatted: string;
  modelTags: Array<{ id: string; name: string; isActive: boolean }>;
};

export type PaymentRecordDto = {
  id: string;
  chatter?: { id: string; displayName: string };
  manager: { id: string; displayName: string };
  totalCents: number;
  totalFormatted: string;
  paidAt: string;
};
