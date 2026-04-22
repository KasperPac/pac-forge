import { create } from "zustand";
import { AUDIT_STEP_ORDER } from "@/types/audit";
import type { AuditStep, AnalysisClarificationQuestion } from "@/types/audit";

export type AuditStepStatus = "pending" | "active" | "completed" | "failed";

interface AuditStoreState {
  // ─── Wizard Navigation ─────────────────────────
  currentStep: AuditStep;
  setCurrentStep: (step: AuditStep) => void;
  stepStatuses: Record<AuditStep, AuditStepStatus>;
  setStepStatus: (step: AuditStep, status: AuditStepStatus) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;

  // ─── Session ───────────────────────────────────
  sessionId: string | null;
  setSessionId: (id: string | null) => void;

  // ─── Selection (Step 3) ────────────────────────
  selectedBlockIds: Set<string>;
  toggleBlockSelection: (id: string) => void;
  selectAllBlocks: (ids: string[]) => void;
  deselectAllBlocks: () => void;
  includeUdts: boolean;
  setIncludeUdts: (v: boolean) => void;
  includeTags: boolean;
  setIncludeTags: (v: boolean) => void;

  // ─── Analysis (Step 4) ─────────────────────────
  analysisProgress: {
    currentBlockId: string | null;
    currentBlockName: string | null;
    completedCount: number;
    totalCount: number;
    status: "idle" | "running" | "paused_for_input" | "complete" | "error";
    error: string | null;
  };
  setAnalysisProgress: (p: Partial<AuditStoreState["analysisProgress"]>) => void;
  pendingQuestion: AnalysisClarificationQuestion | null;
  setPendingQuestion: (q: AnalysisClarificationQuestion | null) => void;

  // ─── Workspace ─────────────────────────────────
  activeBlockId: string | null;
  setActiveBlockId: (id: string | null) => void;
  openBlockIds: string[];
  openBlock: (id: string) => void;
  closeBlock: (id: string) => void;

  understandingTab: "analysis" | "cross-refs" | "data-flow";
  setUnderstandingTab: (t: AuditStoreState["understandingTab"]) => void;

  bottomPanelOpen: boolean;
  bottomPanelTab: "modifications" | "tests" | "logs";
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelTab: (tab: AuditStoreState["bottomPanelTab"]) => void;

  // ─── Modification Mode ─────────────────────────
  modificationMode: boolean;
  setModificationMode: (on: boolean) => void;
  pendingEdits: Record<string, string>;
  setPendingEdit: (blockId: string, content: string) => void;
  clearPendingEdits: () => void;

  // ─── Test Runner ───────────────────────────────
  plcsimConnected: boolean;
  setPlcsimConnected: (v: boolean) => void;

  // ─── Workspace Search ──────────────────────────
  blockSearchQuery: string;
  setBlockSearchQuery: (q: string) => void;

  // ─── Reset ─────────────────────────────────────
  reset: () => void;
}

function createInitialStatuses(): Record<AuditStep, AuditStepStatus> {
  return {
    connect: "active",
    extract: "pending",
    select: "pending",
    analyze: "pending",
    classify: "pending",
    trace: "pending",
    verify: "pending",
    review: "pending",
    ready: "pending",
  };
}

function stepIndex(step: AuditStep) {
  return AUDIT_STEP_ORDER.indexOf(step);
}

const INITIAL_ANALYSIS_PROGRESS: AuditStoreState["analysisProgress"] = {
  currentBlockId: null,
  currentBlockName: null,
  completedCount: 0,
  totalCount: 0,
  status: "idle",
  error: null,
};

export const useAuditStore = create<AuditStoreState>((set, get) => ({
  // ─── Wizard Navigation ─────────────────────────
  currentStep: "connect",
  stepStatuses: createInitialStatuses(),

  setCurrentStep: (step) =>
    set((state) => {
      if (state.currentStep === step) return state;
      const next = { ...state.stepStatuses };
      if (next[step] === "pending") next[step] = "active";
      if (next[state.currentStep] === "active") next[state.currentStep] = "pending";
      return { currentStep: step, stepStatuses: next };
    }),

  setStepStatus: (step, status) =>
    set((state) => {
      const next = { ...state.stepStatuses, [step]: status };
      if (status === "active" && state.currentStep !== step) {
        if (next[state.currentStep] === "active") next[state.currentStep] = "pending";
        return { currentStep: step, stepStatuses: next };
      }
      return { stepStatuses: next };
    }),

  goToNextStep: () => {
    const { currentStep, stepStatuses } = get();
    const idx = stepIndex(currentStep);
    const nextStep = AUDIT_STEP_ORDER[idx + 1];
    if (!nextStep) return;
    set({
      currentStep: nextStep,
      stepStatuses: {
        ...stepStatuses,
        [nextStep]: stepStatuses[nextStep] === "completed" ? "completed" : "active",
      },
    });
  },

  goToPreviousStep: () => {
    const { currentStep, stepStatuses } = get();
    const idx = stepIndex(currentStep);
    if (idx <= 0) return;
    const prevStep = AUDIT_STEP_ORDER[idx - 1];
    set({
      currentStep: prevStep,
      stepStatuses: {
        ...stepStatuses,
        [prevStep]: stepStatuses[prevStep] === "completed" ? "completed" : "active",
      },
    });
  },

  // ─── Session ───────────────────────────────────
  sessionId: null,
  setSessionId: (id) => set({ sessionId: id }),

  // ─── Selection ─────────────────────────────────
  selectedBlockIds: new Set<string>(),
  toggleBlockSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedBlockIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedBlockIds: next };
    }),
  selectAllBlocks: (ids) => set({ selectedBlockIds: new Set(ids) }),
  deselectAllBlocks: () => set({ selectedBlockIds: new Set<string>() }),
  includeUdts: true,
  setIncludeUdts: (v) => set({ includeUdts: v }),
  includeTags: true,
  setIncludeTags: (v) => set({ includeTags: v }),

  // ─── Analysis ──────────────────────────────────
  analysisProgress: { ...INITIAL_ANALYSIS_PROGRESS },
  setAnalysisProgress: (p) =>
    set((state) => ({
      analysisProgress: { ...state.analysisProgress, ...p },
    })),
  pendingQuestion: null,
  setPendingQuestion: (q) => set({ pendingQuestion: q }),

  // ─── Workspace ─────────────────────────────────
  activeBlockId: null,
  setActiveBlockId: (id) => set({ activeBlockId: id }),
  openBlockIds: [],
  openBlock: (id) =>
    set((state) => ({
      openBlockIds: state.openBlockIds.includes(id)
        ? state.openBlockIds
        : [...state.openBlockIds, id],
      activeBlockId: id,
    })),
  closeBlock: (id) =>
    set((state) => {
      const next = state.openBlockIds.filter((b) => b !== id);
      return {
        openBlockIds: next,
        activeBlockId:
          state.activeBlockId === id ? (next[next.length - 1] ?? null) : state.activeBlockId,
      };
    }),

  understandingTab: "analysis",
  setUnderstandingTab: (t) => set({ understandingTab: t }),

  bottomPanelOpen: false,
  bottomPanelTab: "modifications",
  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab, bottomPanelOpen: true }),

  // ─── Modification Mode ─────────────────────────
  modificationMode: false,
  setModificationMode: (on) => set({ modificationMode: on }),
  pendingEdits: {},
  setPendingEdit: (blockId, content) =>
    set((state) => ({
      pendingEdits: { ...state.pendingEdits, [blockId]: content },
    })),
  clearPendingEdits: () => set({ pendingEdits: {} }),

  // ─── Test Runner ───────────────────────────────
  plcsimConnected: false,
  setPlcsimConnected: (v) => set({ plcsimConnected: v }),

  // ─── Search ────────────────────────────────────
  blockSearchQuery: "",
  setBlockSearchQuery: (q) => set({ blockSearchQuery: q }),

  // ─── Reset ─────────────────────────────────────
  reset: () =>
    set({
      currentStep: "connect",
      stepStatuses: createInitialStatuses(),
      sessionId: null,
      selectedBlockIds: new Set<string>(),
      includeUdts: true,
      includeTags: true,
      analysisProgress: { ...INITIAL_ANALYSIS_PROGRESS },
      pendingQuestion: null,
      activeBlockId: null,
      openBlockIds: [],
      understandingTab: "analysis",
      bottomPanelOpen: false,
      bottomPanelTab: "modifications",
      modificationMode: false,
      pendingEdits: {},
      plcsimConnected: false,
      blockSearchQuery: "",
    }),
}));
