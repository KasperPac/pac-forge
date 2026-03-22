import { create } from "zustand";
import { MIGRATION_STEP_ORDER } from "@/types/migrate";
import type { MigrationStep } from "@/types/migrate";

export type MigrationStepStatus = "pending" | "active" | "completed" | "failed";

interface MigrateStoreState {
  currentStep: MigrationStep;
  setCurrentStep: (step: MigrationStep) => void;

  stepStatuses: Record<MigrationStep, MigrationStepStatus>;
  setStepStatus: (step: MigrationStep, status: MigrationStepStatus) => void;

  /** Active session ID loaded from URL / created on start */
  sessionId: string | null;
  setSessionId: (id: string | null) => void;

  goToNextStep: () => void;
  goToPreviousStep: () => void;
  reset: () => void;
}

function createInitialStatuses(): Record<MigrationStep, MigrationStepStatus> {
  return {
    connect: "active",
    analyse: "pending",
    approve_plan: "pending",
    transform: "pending",
    compile: "pending",
    report: "pending",
  };
}

function stepIndex(step: MigrationStep) {
  return MIGRATION_STEP_ORDER.indexOf(step);
}

export const useMigrateStore = create<MigrateStoreState>((set, get) => ({
  currentStep: "connect",
  stepStatuses: createInitialStatuses(),
  sessionId: null,

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

  setSessionId: (id) => set({ sessionId: id }),

  goToNextStep: () => {
    const { currentStep, stepStatuses } = get();
    const idx = stepIndex(currentStep);
    const nextStep = MIGRATION_STEP_ORDER[idx + 1];
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
    const prevStep = MIGRATION_STEP_ORDER[idx - 1];
    set({
      currentStep: prevStep,
      stepStatuses: {
        ...stepStatuses,
        [prevStep]: stepStatuses[prevStep] === "completed" ? "completed" : "active",
      },
    });
  },

  reset: () =>
    set({
      currentStep: "connect",
      stepStatuses: createInitialStatuses(),
      sessionId: null,
    }),
}));
