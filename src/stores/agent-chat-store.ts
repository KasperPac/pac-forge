import { create } from "zustand";
import type { ChatMessage } from "@/types";

type WidgetView = "closed" | "selecting" | "chatting";

export type LearningType = "agent_knowledge" | "correction_pattern";

export interface LearningProposal {
  /** Which user message triggered this */
  messageId: string;
  /** AI-classified type */
  type: LearningType;
  /** Why the AI chose this classification */
  reasoning: string;
  /** Suggested title */
  title: string;
  /** Formatted content to save */
  content: string;
  /** Agent display names the AI recommends saving to */
  targetAgents: string[];
  /** For correction_pattern type: NAMING, IO_MAPPING, STATE_LOGIC, etc. */
  correctionType?: string;
}

interface AgentChatState {
  view: WidgetView;
  selectedAgent: string | null;
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  showSavePrompt: boolean;

  // Learning proposal (AI-classified)
  learningProposal: LearningProposal | null;
  isClassifying: boolean;

  openSelector: () => void;
  selectAgent: (agentName: string) => void;
  requestClose: () => void;
  confirmDiscard: () => void;
  setShowSavePrompt: (show: boolean) => void;
  addMessage: (msg: ChatMessage) => void;
  appendStreamChunk: (chunk: string) => void;
  finalizeStream: (fullContent: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  setLearningProposal: (proposal: LearningProposal | null) => void;
  setIsClassifying: (classifying: boolean) => void;
  reset: () => void;
}

export const useAgentChatStore = create<AgentChatState>((set, get) => ({
  view: "closed",
  selectedAgent: null,
  messages: [],
  streamingContent: "",
  isStreaming: false,
  showSavePrompt: false,
  learningProposal: null,
  isClassifying: false,

  openSelector: () => {
    const { messages, view } = get();
    // If chatting with messages, prompt to save first
    if (view === "chatting" && messages.length > 0) {
      set({ showSavePrompt: true });
      return;
    }
    set({ view: "selecting" });
  },

  selectAgent: (agentName) =>
    set({
      selectedAgent: agentName,
      view: "chatting",
      messages: [],
      streamingContent: "",
      learningProposal: null,
      isClassifying: false,
    }),

  requestClose: () => {
    const { messages } = get();
    if (messages.length > 0) {
      set({ showSavePrompt: true });
    } else {
      get().reset();
    }
  },

  confirmDiscard: () => {
    set({
      view: "closed",
      selectedAgent: null,
      messages: [],
      streamingContent: "",
      isStreaming: false,
      showSavePrompt: false,
      learningProposal: null,
      isClassifying: false,
    });
  },

  setShowSavePrompt: (show) => set({ showSavePrompt: show }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  appendStreamChunk: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),

  finalizeStream: (fullContent) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: fullContent,
          timestamp: new Date().toISOString(),
        },
      ],
      streamingContent: "",
    })),

  setIsStreaming: (streaming) => set({ isStreaming: streaming }),
  setLearningProposal: (proposal) => set({ learningProposal: proposal }),
  setIsClassifying: (classifying) => set({ isClassifying: classifying }),

  reset: () =>
    set({
      view: "closed",
      selectedAgent: null,
      messages: [],
      streamingContent: "",
      isStreaming: false,
      showSavePrompt: false,
      learningProposal: null,
      isClassifying: false,
    }),
}));
