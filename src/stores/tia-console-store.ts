import { create } from "zustand";
import type { PipelineStepResult } from "@/lib/pipeline";

/** Compile result shape — matches the bridge response in tia-console.tsx */
export interface TiaCompileError {
  artifact_name: string;
  line: number | null;
  column: number | null;
  error_text: string;
  severity: "ERROR" | "WARNING" | "INFO";
}

export interface TiaCompileResult {
  success: boolean;
  errors: TiaCompileError[];
  warnings: TiaCompileError[];
  compiled_at: string;
  sources?: Record<string, string>;
}

type GenerationStep = "idle" | "generating" | "creating";

interface TiaConsoleState {
  // Pipeline steps (survive navigation)
  pipelineSteps: PipelineStepResult[];

  // Compile results (local overlay from compile-fix rounds)
  localCompileResult: TiaCompileResult | null;
  fixSessionActive: boolean;

  // Generation progress
  demoStep: GenerationStep;
  customStep: GenerationStep;

  // Last generated sources for download
  lastGeneratedSources: {
    sources: Record<string, string>;
    importOrder: string[];
  } | null;

  // Actions
  setPipelineSteps: (
    updater:
      | PipelineStepResult[]
      | ((prev: PipelineStepResult[]) => PipelineStepResult[]),
  ) => void;
  setLocalCompileResult: (result: TiaCompileResult | null) => void;
  setFixSessionActive: (active: boolean) => void;
  setDemoStep: (step: GenerationStep) => void;
  setCustomStep: (step: GenerationStep) => void;
  setLastGeneratedSources: (
    sources: { sources: Record<string, string>; importOrder: string[] } | null,
  ) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  pipelineSteps: [] as PipelineStepResult[],
  localCompileResult: null as TiaCompileResult | null,
  fixSessionActive: false,
  demoStep: "idle" as GenerationStep,
  customStep: "idle" as GenerationStep,
  lastGeneratedSources: null as TiaConsoleState["lastGeneratedSources"],
};

export const useTiaConsoleStore = create<TiaConsoleState>((set) => ({
  ...INITIAL_STATE,

  setPipelineSteps: (updater) =>
    set((s) => ({
      pipelineSteps:
        typeof updater === "function" ? updater(s.pipelineSteps) : updater,
    })),

  setLocalCompileResult: (result) => set({ localCompileResult: result }),
  setFixSessionActive: (active) => set({ fixSessionActive: active }),
  setDemoStep: (step) => set({ demoStep: step }),
  setCustomStep: (step) => set({ customStep: step }),
  setLastGeneratedSources: (sources) =>
    set({ lastGeneratedSources: sources }),

  reset: () => set(INITIAL_STATE),
}));
