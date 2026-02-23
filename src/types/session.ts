export const SESSION_STATUSES = {
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
  EXPIRED: "EXPIRED",
} as const;

export type SessionStatus = (typeof SESSION_STATUSES)[keyof typeof SESSION_STATUSES];

export interface Session {
  id: string;
  user_id: string;
  project_id: string;
  selected_agent_ids: string[];
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

export type SessionCreate = Pick<Session, "project_id" | "selected_agent_ids">;
