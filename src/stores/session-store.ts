import { create } from "zustand";
import type { SessionStatus } from "@/types";

interface SessionState {
  activeSessionId: string | null;
  selectedAgentIds: string[];
  sessionStatus: SessionStatus | null;

  setActiveSession: (sessionId: string, agentIds: string[], status: SessionStatus) => void;
  clearSession: () => void;
  setSessionStatus: (status: SessionStatus) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSessionId: null,
  selectedAgentIds: [],
  sessionStatus: null,

  setActiveSession: (sessionId, agentIds, status) =>
    set({
      activeSessionId: sessionId,
      selectedAgentIds: agentIds,
      sessionStatus: status,
    }),
  clearSession: () =>
    set({
      activeSessionId: null,
      selectedAgentIds: [],
      sessionStatus: null,
    }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
}));
