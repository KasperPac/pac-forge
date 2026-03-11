import { create } from "zustand";
import { FORGE_STEP_ORDER } from "@/types/forge";
import type { ForgeStep } from "@/types/forge";

export type ForgeStepStatus = "pending" | "active" | "completed" | "failed";

interface ForgeStoreState {
  currentStep: ForgeStep;
  setCurrentStep: (step: ForgeStep) => void;

  stepStatuses: Record<ForgeStep, ForgeStepStatus>;
  setStepStatus: (step: ForgeStep, status: ForgeStepStatus) => void;

  selectedArtifactId: string | null;
  setSelectedArtifactId: (id: string | null) => void;

  specText: string | null;
  setSpecText: (text: string | null) => void;
  specFilename: string | null;
  setSpecFilename: (name: string | null) => void;

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
  device_code: "pending",
  process_code: "pending",
  hmi: "pending",
  tia_export: "pending",
});

const getStepIndex = (step: ForgeStep) => FORGE_STEP_ORDER.indexOf(step);

export const useForgeStore = create<ForgeStoreState>((set, get) => ({
  currentStep: "spec_upload",
  stepStatuses: createInitialStepStatuses(),
  selectedArtifactId: null,
  specText: null,
  specFilename: null,

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
    }),
}));
