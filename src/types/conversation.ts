export const CONVERSATION_ROLES = {
  USER: "USER",
  AGENT: "AGENT",
} as const;

export type ConversationRole =
  (typeof CONVERSATION_ROLES)[keyof typeof CONVERSATION_ROLES];

export const SAFETY_WARNING_TYPES = {
  UNSAFE_MOTOR: "UNSAFE_MOTOR",
  MISSING_INTERLOCK: "MISSING_INTERLOCK",
  IO_MISMATCH: "IO_MISMATCH",
  ALARM_RESET_VIOLATION: "ALARM_RESET_VIOLATION",
  ARRAY_OOB: "ARRAY_OOB",
  UNINITIALIZED_STATE: "UNINITIALIZED_STATE",
} as const;

export type SafetyWarningType =
  (typeof SAFETY_WARNING_TYPES)[keyof typeof SAFETY_WARNING_TYPES];

export interface SafetyWarning {
  id: string;
  type: SafetyWarningType;
  artifact_name: string;
  description: string;
  line: number | null;
  acknowledged: boolean;
}

export interface ConversationTurn {
  id: string;
  session_id: string;
  role: ConversationRole;
  agent_id: string | null;
  content: string;
  artifacts_generated: string[];
  safety_warnings: SafetyWarning[];
  created_at: string;
}

export const INTERACTION_MODES = {
  GUIDED: "GUIDED",
  FREEFORM: "FREEFORM",
  HYBRID: "HYBRID",
} as const;

export type InteractionMode =
  (typeof INTERACTION_MODES)[keyof typeof INTERACTION_MODES];

export const GENERATION_MODES = {
  FB_PER_DEVICE: "FB_PER_DEVICE",
  PROJECT_LEVEL: "PROJECT_LEVEL",
  PROCESS_CODE: "PROCESS_CODE",
} as const;

export type GenerationMode =
  (typeof GENERATION_MODES)[keyof typeof GENERATION_MODES];
