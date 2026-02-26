import { create } from "zustand";
import type { PipelineStepResult } from "@/lib/pipeline";
import type { CompileErrorInfo } from "@/lib/compile-fix-prompt";
import type { FixedSource } from "@/lib/compile-fix-parser";
import type { PatternAnalysisCorrection } from "@/hooks/use-pattern-librarian-analysis";

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

// --- Compile-fix session types (shared with compile-fix-chat component) ---

export interface CompileFixMessage {
  role: "user" | "assistant" | "system";
  content: string;
  fixes?: FixedSource[];
  appliedFixes?: boolean;
}

export interface CompileFixStuckInfo {
  errors: CompileErrorInfo[];
  sources: Record<string, string>;
  rounds: number;
  reason: string;
}

export interface CompileFixRoundSnapshot {
  round: number;
  sourcesBefore: Record<string, string>;
  sourcesAfter: Record<string, string>;
  errorsAddressed: CompileErrorInfo[];
  fixes: FixedSource[];
  explanation: string;
}

export interface CompileFixVerificationCorrection extends PatternAnalysisCorrection {
  roundNumber: number;
  checked: boolean;
}

export type CompileFixVerificationState =
  | "idle"
  | "prompting"
  | "analyzing"
  | "reviewing"
  | "saving"
  | "done";

export interface CompileFixSessionData {
  messages: CompileFixMessage[];
  round: number;
  resolved: boolean;
  stuck: CompileFixStuckInfo | null;
  currentSources: Record<string, string>;
  currentErrors: CompileErrorInfo[];
  currentWarnings: CompileErrorInfo[];
  roundSnapshots: CompileFixRoundSnapshot[];
  verificationState: CompileFixVerificationState;
  verificationCorrections: CompileFixVerificationCorrection[];
  savedCount: number;
}

// --- Store ---

type GenerationStep = "idle" | "generating" | "creating";

interface TiaConsoleState {
  // Pipeline steps (survive navigation)
  pipelineSteps: PipelineStepResult[];

  // Compile results (local overlay from compile-fix rounds)
  localCompileResult: TiaCompileResult | null;
  fixSessionActive: boolean;

  // Compile-fix session (survives navigation)
  compileFixSession: CompileFixSessionData | null;

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
  setCompileFixSession: (session: CompileFixSessionData | null) => void;
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
  compileFixSession: null as CompileFixSessionData | null,
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
  setCompileFixSession: (session) => set({ compileFixSession: session }),
  setDemoStep: (step) => set({ demoStep: step }),
  setCustomStep: (step) => set({ customStep: step }),
  setLastGeneratedSources: (sources) =>
    set({ lastGeneratedSources: sources }),

  reset: () => set(INITIAL_STATE),
}));
