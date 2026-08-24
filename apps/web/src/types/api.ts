// ---- API response types ----

export type FxRateResponse = {
  rate: number;
  provider?: string;
  quotedAt?: string;
  cached?: boolean;
};

export type OcrExtractResponse = {
  confidence: number;
  detectedValue: string | null;
  rawText: string;
  evidence: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    confidence: number;
    detectedValue: string | null;
  };
};

export type EvidenceSummary = {
  id: string;
  originalName: string;
  status: "AVAILABLE" | "PURGE_PENDING" | "PURGED" | "MISSING_LEGACY";
  purgedAt: string | null;
  sha256: string | null;
};

export type AnalyticsSummary = {
  totalGrossCents: number;
  totalGrossFormatted: string;
  totalPayoutCents: number;
  totalPayoutFormatted: string;
  totalHoursMs: number;
  totalHoursFormatted: string;
  shiftCount: number;
  mphCentsPerHour: number;
  mphFormatted: string;
};

export type ModelRow = {
  modelTag: { id: string; name: string; isActive: boolean };
  grossCents: number;
  grossFormatted: string;
  payoutCents: number;
  payoutFormatted: string;
  hoursMs: number;
  hoursFormatted: string;
  shiftCount: number;
  mphCentsPerHour: number;
  mphFormatted: string;
};

export type ChatterRow = {
  chatter: { id: string; displayName: string; username: string; isActive: boolean };
  grossCents: number;
  grossFormatted: string;
  payoutCents: number;
  payoutFormatted: string;
  hoursMs: number;
  hoursFormatted: string;
  shiftCount: number;
  mphCentsPerHour: number;
  mphFormatted: string;
};

export type DailyPoint = {
  date: string;
  grossCents: number;
  payoutCents: number;
  hoursMs: number;
  shiftCount: number;
};

export type AnalyticsResponse = {
  summary: AnalyticsSummary;
  byModel: ModelRow[];
  byChatter: ChatterRow[];
  daily: DailyPoint[];
};

export type ChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  modelTagId: string;
  sender: {
    id: string;
    displayName: string;
    username: string;
    role: string;
  };
};

export type Shift = {
  id: string;
  batchId?: string | null;
  modelTagId: string;
  modelTag: { id: string; name: string };
  status: string;
  startedAt: string;
  endedAt: string | null;
  startImageUrl: string | null;
  startEvidence?: EvidenceSummary | null;
  startValueFormatted: string;
  endImageUrl: string | null;
  endEvidence?: EvidenceSummary | null;
  endValueFormatted: string | null;
  grossAmountFormatted: string | null;
  payoutAmountFormatted: string | null;
  negativeJustification: string | null;
  notes: string | null;
  earnings: { amountFormatted: string; status: string; paidAt: string | null } | null;
};

export type PaymentRecord = {
  id: string;
  chatter: { id: string; displayName: string };
  manager: { id: string; displayName: string };
  totalCents: number;
  totalFormatted: string;
  paidAt: string;
};

export type BalanceChatter = {
  id: string;
  displayName: string;
  isActive: boolean;
  pendingCents: number;
  pendingFormatted: string;
};

export type TagOption = { id: string; name: string; isActive: boolean };
