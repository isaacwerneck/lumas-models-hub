import { z } from "zod";

export const RoleSchema = z.enum(["CHATTER", "MANAGER"]);
export type Role = z.infer<typeof RoleSchema>;

export const PaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative()
});
export type Pagination = z.infer<typeof PaginationSchema>;
export type PaginatedResponse<T> = { items: T[]; pagination: Pagination };

export const ApiIssueSchema = z.object({ field: z.string(), message: z.string() });
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(), message: z.string(), issues: z.array(ApiIssueSchema).optional(), requestId: z.string().optional()
  })
});
export type ApiErrorResponse = z.infer<typeof ApiErrorSchema>;

export const AuthUserSchema = z.object({
  id: z.string(), username: z.string(), displayName: z.string(), role: RoleSchema,
  mustChangePassword: z.boolean().default(false), shiftReminderIntervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).optional()
});
export type AuthUser = z.infer<typeof AuthUserSchema>;
export const AuthSessionSchema = z.object({ accessToken: z.string(), user: AuthUserSchema });
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const EvidenceStatusSchema = z.enum(["AVAILABLE", "PURGE_PENDING", "PURGED", "MISSING_LEGACY"]);
export const EvidenceSchema = z.object({
  id: z.string(), originalName: z.string(), mimeType: z.string().optional(), sizeBytes: z.number().optional(),
  sha256: z.string().nullable().optional(), status: EvidenceStatusSchema, purgedAt: z.string().nullable().optional()
});
export type EvidenceDto = z.infer<typeof EvidenceSchema>;

export const OcrResultSchema = z.object({
  rawText: z.string(), confidence: z.number(), candidates: z.array(z.string()).default([]),
  detectedValue: z.string().nullable(), detectedCents: z.number().nullable().optional(),
  requiresManualConfirmation: z.boolean(), evidence: EvidenceSchema
});
export type OcrResult = z.infer<typeof OcrResultSchema>;

export const NotificationSchema = z.object({
  id: z.string(), type: z.enum(["OCR_LOW_CONFIDENCE", "NEGATIVE_SHIFT", "SHIFT_OPEN_REMINDER", "MIDNIGHT_SHIFT_WARNING"]), title: z.string(), message: z.string(),
  sourceType: z.string(), sourceId: z.string(), metadata: z.unknown().nullable().optional(), readAt: z.string().nullable(), createdAt: z.string()
});
export type NotificationDto = z.infer<typeof NotificationSchema>;
export type NotificationListResponse = PaginatedResponse<NotificationDto> & { unreadCount: number };

export const ModelTagSchema = z.object({
  id: z.string(), name: z.string(), isActive: z.boolean(), chatterCount: z.number().int().nonnegative().optional()
});
export type ModelTagDto = z.infer<typeof ModelTagSchema>;

export const UserSchema = z.object({
  id: z.string(), username: z.string(), displayName: z.string(), role: RoleSchema,
  isActive: z.boolean(), mustChangePassword: z.boolean().optional(), createdAt: z.string().optional(), updatedAt: z.string().optional()
});
export type UserDto = z.infer<typeof UserSchema>;

export const ChatterListItemSchema = z.object({
  id: z.string(), username: z.string(), displayName: z.string(), isActive: z.boolean(),
  createdAt: z.string(), updatedAt: z.string(), totalShifts: z.number().int().nonnegative(),
  totalGrossCents: z.number(), totalGrossFormatted: z.string(), totalPayoutCents: z.number(),
  totalPayoutFormatted: z.string(), modelTags: z.array(ModelTagSchema)
});
export type ChatterListItem = z.infer<typeof ChatterListItemSchema>;

export type MoneyMetadata = {
  currency: "BRL" | "USD";
  originalAmountCents?: number;
  fxRate?: number;
  fxProvider?: string;
  fxQuotedAt?: string;
};

export const ShiftSchema = z.object({
  id: z.string(), batchId: z.string().nullable().optional(), modelTagId: z.string(), modelTag: ModelTagSchema.pick({ id: true, name: true }),
  status: z.enum(["OPEN", "CLOSED"]), startedAt: z.string(), endedAt: z.string().nullable(),
  startEvidence: EvidenceSchema.nullable().optional(), endEvidence: EvidenceSchema.nullable().optional(),
  startValueFormatted: z.string(), endValueFormatted: z.string().nullable(), grossAmountFormatted: z.string().nullable(),
  payoutAmountFormatted: z.string().nullable(), negativeJustification: z.string().nullable(), notes: z.string().nullable(),
  chatterVerifiedAt: z.string().nullable().optional(), reviewRevision: z.number().int().positive().optional(),
  earnings: z.object({ amountFormatted: z.string(), status: z.enum(["PENDING", "PAID"]), paidAt: z.string().nullable() }).nullable().optional()
});
export type ShiftDto = z.infer<typeof ShiftSchema>;

export const PaymentRecordSchema = z.object({
  id: z.string(), chatter: z.object({ id: z.string(), displayName: z.string() }).optional(),
  manager: z.object({ id: z.string(), displayName: z.string() }), totalCents: z.number(),
  totalFormatted: z.string(), paidAt: z.string(),
  receipt: z.object({ id: z.string(), originalName: z.string(), mimeType: z.string(), sizeBytes: z.number() }).nullable().optional()
});
export type PaymentRecordDto = z.infer<typeof PaymentRecordSchema>;

export const ReconciliationStatusSchema = z.enum(["MATCHED", "MISMATCH", "OUT_OF_RANGE", "AMBIGUOUS", "OVERRIDDEN"]);
export const ShiftReconciliationSchema = z.object({
  id: z.string(), shiftId: z.string(), shiftReviewRevision: z.number().int().positive(),
  statementCommissionCents: z.number(), reportedGrossCents: z.number(), deltaCents: z.number(),
  matchedRowCount: z.number().int().nonnegative(), status: ReconciliationStatusSchema,
  overrideReason: z.string().nullable(), overriddenAt: z.string().nullable()
});
export type ShiftReconciliationDto = z.infer<typeof ShiftReconciliationSchema>;

export const WorksheetCellSchema = z.object({
  rowIndex: z.number().int().min(0).max(19), columnIndex: z.number().int().min(0).max(5),
  value: z.string().max(2000), valueType: z.enum(["TEXT", "NUMBER"]), version: z.number().int().positive(),
  updatedAt: z.string(), updatedBy: z.object({ id: z.string(), displayName: z.string() })
});
export type WorksheetCellDto = z.infer<typeof WorksheetCellSchema>;
export const WorksheetSchema = z.object({
  id: z.string(), modelTagId: z.string(), rowCount: z.number().int().min(1).max(20),
  columnCount: z.number().int().min(1).max(6), revision: z.number().int().nonnegative(), cells: z.array(WorksheetCellSchema)
});
export type WorksheetDto = z.infer<typeof WorksheetSchema>;

export const AuditLogSchema = z.object({
  id: z.string(), action: z.string(), targetType: z.string(), targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(), createdAt: z.string(),
  actor: z.object({ id: z.string(), displayName: z.string(), username: z.string() }).nullable()
});
export type AuditLogDto = z.infer<typeof AuditLogSchema>;

export const ChatRoomSchema = z.object({ id: z.string(), name: z.string(), isActive: z.boolean().optional() });
export type ChatRoomDto = z.infer<typeof ChatRoomSchema>;
export const ChatMessageSchema = z.object({
  id: z.string(), content: z.string().max(2000), createdAt: z.string(), modelTagId: z.string(),
  sender: z.object({ id: z.string(), displayName: z.string(), username: z.string(), role: RoleSchema })
});
export type ChatMessageDto = z.infer<typeof ChatMessageSchema>;

export const AnalyticsEntrySchema = z.object({
  grossCents: z.number(), grossFormatted: z.string(), payoutCents: z.number(), payoutFormatted: z.string(),
  hoursMs: z.number().nonnegative(), hoursFormatted: z.string(), shiftCount: z.number().int().nonnegative(),
  mphCentsPerHour: z.number(), mphFormatted: z.string()
});
export const AnalyticsSummarySchema = z.object({
  totalGrossCents: z.number(), totalGrossFormatted: z.string(), totalPayoutCents: z.number(), totalPayoutFormatted: z.string(),
  totalHoursMs: z.number().nonnegative(), totalHoursFormatted: z.string(), shiftCount: z.number().int().nonnegative(),
  mphCentsPerHour: z.number(), mphFormatted: z.string()
});
export const AnalyticsResponseSchema = z.object({
  summary: AnalyticsSummarySchema,
  byModel: z.array(AnalyticsEntrySchema.extend({ modelTag: ModelTagSchema })),
  byChatter: z.array(AnalyticsEntrySchema.extend({ chatter: UserSchema.pick({ id: true, username: true, displayName: true, isActive: true }) })),
  daily: z.array(z.object({ date: z.string(), grossCents: z.number(), payoutCents: z.number(), hoursMs: z.number(), shiftCount: z.number().int() }))
});
export type AnalyticsResponseDto = z.infer<typeof AnalyticsResponseSchema>;
