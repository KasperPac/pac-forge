import { create } from "zustand";
import { FORGE_STEP_ORDER } from "@/types/forge";
import type { ForgeStep } from "@/types/forge";

export type ForgeStepStatus = "pending" | "active" | "completed" | "failed";

interface ForgeStoreState {
  currentStep: ForgeStep;
  setCurrentStep: (step: ForgeStep) => void;

  stepStatuses: Record<ForgeStep, ForgeStepStatus>;
  setStepStatus: (step: ForgeStep, status: ForgeStepStatus) => void;

  /** Active forge session ID — set when a session is loaded so agent chat can access it */
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;

  selectedArtifactId: string | null;
  setSelectedArtifactId: (id: string | null) => void;

  specText: string | null;
  setSpecText: (text: string | null) => void;
  specFilename: string | null;
  setSpecFilename: (name: string | null) => void;

  /** Whether the store has been hydrated from a DB session this page load */
  hydrated: boolean;
  /** Restore step navigation state from a DB session */
  hydrateFromSession: (currentStep: ForgeStep, stepStatuses: Partial<Record<ForgeStep, ForgeStepStatus>>) => void;

  canProceedToNext: () => boolean;
  goToNextStep: () => void;
  goToPreviousStep: () => void;

  reset: () => void;
}

const createInitialStepStatuses = (): Record<ForgeStep, ForgeStepStatus> => ({
  spec_upload: "active",
  qa_review: "pending",
  project_setup: "pending",
  hardware_io: "pending",
  interface_contract: "pending",
  device_fb: "pending",
  assembly_fb: "pending",
  logic_check: "pending",
  matrix_review: "pending",
  device_code: "pending",
  plcsim_device_test: "pending",
  process_code: "pending",
  hmi: "pending",
  plcsim_system_test: "pending",
  tia_export: "pending",
});

const getStepIndex = (step: ForgeStep) => FORGE_STEP_ORDER.indexOf(step);

export const useForgeStore = create<ForgeStoreState>((set, get) => ({
  currentStep: "spec_upload",
  stepStatuses: createInitialStepStatuses(),
  activeSessionId: null,
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  selectedArtifactId: null,
  specText: null,
  specFilename: null,
  hydrated: false,

  hydrateFromSession: (dbStep, dbStatuses) => {
    // Migrate old step names (cast to string for comparison with legacy values)
    let safeStep: ForgeStep;
    if (FORGE_STEP_ORDER.includes(dbStep)) {
      safeStep = dbStep;
    } else if ((dbStep as string) === "plcsim_test") {
      safeStep = "plcsim_system_test";
    } else {
      safeStep = "spec_upload";
    }

    // Backward compat: old sessions stored before the 3 new steps
    // (interface_contract, assembly_fb, logic_check) were added.
    // If the session is at or past a step that was previously adjacent
    // to the new steps, auto-complete the new steps.
    const currentIdx = getStepIndex(safeStep);
    const statuses = createInitialStepStatuses();

    for (let i = 0; i < FORGE_STEP_ORDER.length; i++) {
      const step = FORGE_STEP_ORDER[i];
      if (dbStatuses[step]) {
        statuses[step] = dbStatuses[step]!;
      } else if (i < currentIdx) {
        // Steps before current that have no saved status → completed
        statuses[step] = "completed";
      } else if (i === currentIdx) {
        statuses[step] = "active";
      }
      // else stays "pending" from createInitialStepStatuses
    }
    set({ currentStep: safeStep, stepStatuses: statuses, hydrated: true });
  },

  setCurrentStep: (step) =>
    set((state) => {
      if (state.currentStep === step) {
        return state;
      }

      const nextStatuses = { ...state.stepStatuses };
      if (nextStatuses[step] === "pending") {
        nextStatuses[step] = "active";
      }

      if (nextStatuses[state.currentStep] === "active") {
        nextStatuses[state.currentStep] = "pending";
      }

      return {
        currentStep: step,
        stepStatuses: nextStatuses,
      };
    }),

  setStepStatus: (step, status) =>
    set((state) => {
      const nextStatuses = {
        ...state.stepStatuses,
        [step]: status,
      };

      if (status === "active" && state.currentStep !== step) {
        if (nextStatuses[state.currentStep] === "active") {
          nextStatuses[state.currentStep] = "pending";
        }

        return {
          currentStep: step,
          stepStatuses: nextStatuses,
        };
      }

      return { stepStatuses: nextStatuses };
    }),

  setSelectedArtifactId: (id) => set({ selectedArtifactId: id }),

  setSpecText: (text) => set({ specText: text }),
  setSpecFilename: (name) => set({ specFilename: name }),

  canProceedToNext: () => {
    const { currentStep, stepStatuses } = get();
    const currentStepIndex = getStepIndex(currentStep);
    const isLastStep = currentStepIndex === FORGE_STEP_ORDER.length - 1;

    if (isLastStep) {
      return false;
    }

    return stepStatuses[currentStep] === "completed";
  },

  goToNextStep: () => {
    const { currentStep, stepStatuses } = get();
    if (!get().canProceedToNext()) {
      return;
    }

    const currentStepIndex = getStepIndex(currentStep);
    const nextStep = FORGE_STEP_ORDER[currentStepIndex + 1];
    if (!nextStep) {
      return;
    }

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
    const currentStepIndex = getStepIndex(currentStep);
    if (currentStepIndex <= 0) {
      return;
    }

    const previousStep = FORGE_STEP_ORDER[currentStepIndex - 1];
    set({
      currentStep: previousStep,
      stepStatuses: {
        ...stepStatuses,
        [previousStep]: stepStatuses[previousStep] === "completed" ? "completed" : "active",
      },
    });
  },

  reset: () =>
    set({
      currentStep: "spec_upload",
      stepStatuses: createInitialStepStatuses(),
      selectedArtifactId: null,
      specText: null,
      specFilename: null,
      hydrated: false,
    }),
}));
