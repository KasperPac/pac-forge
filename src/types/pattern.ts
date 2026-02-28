export const CORRECTION_TYPES = {
  NAMING: "NAMING",
  IO_MAPPING: "IO_MAPPING",
  STATE_LOGIC: "STATE_LOGIC",
  ALARM: "ALARM",
  SAFETY: "SAFETY",
  TIMING: "TIMING",
} as const;

export type CorrectionType =
  (typeof CORRECTION_TYPES)[keyof typeof CORRECTION_TYPES];

export const PATTERN_STATUSES = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type PatternStatus =
  (typeof PATTERN_STATUSES)[keyof typeof PATTERN_STATUSES];

export interface PatternCandidate {
  id: string;
  short_id: string;
  plc_brand: string;
  device_type: string;
  context: string;
  original_snippet: string;
  corrected_snippet: string;
  correction_type: CorrectionType;
  explanation_tag: string;
  status: PatternStatus;
  created_by: string;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
}
