export const AGENT_STATUSES = {
  AVAILABLE: "AVAILABLE",
  RESERVED: "RESERVED",
  OFFLINE: "OFFLINE",
  DISABLED: "DISABLED",
} as const;

export type AgentStatus = (typeof AGENT_STATUSES)[keyof typeof AGENT_STATUSES];

export const AGENT_SPECIALTIES = {
  TIA: "TIA",
  IO: "IO",
  SAFETY: "SAFETY",
  REVIEW: "REVIEW",
  PATTERNS: "PATTERNS",
} as const;

export type AgentSpecialty = (typeof AGENT_SPECIALTIES)[keyof typeof AGENT_SPECIALTIES];

export const RELEASE_REASONS = {
  USER_RELEASE: "USER_RELEASE",
  SESSION_END: "SESSION_END",
  LEASE_TIMEOUT: "LEASE_TIMEOUT",
  ADMIN_FORCE: "ADMIN_FORCE",
} as const;

export type ReleaseReason = (typeof RELEASE_REASONS)[keyof typeof RELEASE_REASONS];

export interface Agent {
  id: string;
  display_name: string;
  specialties: AgentSpecialty[];
  is_enabled: boolean;
  status: AgentStatus;
  max_concurrency: number;
  system_prompt: string;
  created_at: string;
}

export interface AgentReservation {
  id: string;
  agent_id: string;
  session_id: string;
  user_id: string;
  reserved_at: string;
  lease_expires_at: string;
  released_at: string | null;
  release_reason: ReleaseReason | null;
}
