import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Artifact, CompileError } from "@/types";
import type {
  ProcessStage,
  ProcessStageStatus,
  QaAnswer,
  IoRecommendation,
  FbRecommendation,
  ProcessLinkageMatrix,
  LinkageDevice,
  LinkageIoSignal,
  LinkageInterlock,
  LinkageGlobalData,
  ProcessStep,
  MatrixReviewStatus,
} from "@/types/process-builder";
import type { PipelineExecution, PipelineStepResult } from "@/lib/pipeline";
import { PROCESS_STAGE_ORDER } from "@/types/process-builder";

/** Chat message in the Q&A phase (reuses FB Builder pattern). */
export interface ProcessQaMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface ProcessBuilderState {
  // Stage tracking
  currentStage: ProcessStage;
  stageStatuses: ProcessStageStatus[];

  // Q&A phase
  qaMessages: ProcessQaMessage[];
  qaAnswers: QaAnswer[];

  // Legacy recommendations from PM (kept for backward compat)
  ioRecommendations: IoRecommendation[];
  fbRecommendations: FbRecommendation[];
  folderStructure: Record<string, unknown>;

  // Linkage Matrix (new — replaces IO/FB recs as primary source of truth)
  linkageMatrix: ProcessLinkageMatrix | null;

  // Artifacts per stage
  stageArtifacts: Record<ProcessStage, Artifact[]>;

  // Compile results per stage (from TIA import)
  stageCompileResults: Record<ProcessStage, { success: boolean; errors: CompileError[] } | null>;

  // Gating
  autoGating: boolean;

  // Pipeline execution (reuse pattern from pac-st-store)
  pipelineExecution: PipelineExecution | null;
  activeAgentName: string | null;
  streamingContent: string | null;

  // Actions — stages
  setStage: (stage: ProcessStage) => void;
  updateStageStatus: (stage: ProcessStage, updates: Partial<ProcessStageStatus>) => void;

  // Actions — Q&A
  addQaMessage: (message: ProcessQaMessage) => void;
  addQaAnswer: (answer: QaAnswer) => void;

  // Actions — legacy recommendations
  setIoRecommendations: (recs: IoRecommendation[]) => void;
  confirmIo: (index: number, confirmed: boolean) => void;
  setFbRecommendations: (recs: FbRecommendation[]) => void;
  confirmFb: (index: number, confirmed: boolean) => void;
  setFolderStructure: (structure: Record<string, unknown>) => void;

  // Actions — linkage matrix
  setLinkageMatrix: (matrix: ProcessLinkageMatrix) => void;
  updateLinkageDevice: (deviceId: string, updates: Partial<LinkageDevice>) => void;
  addLinkageDevice: (device: LinkageDevice) => void;
  removeLinkageDevice: (deviceId: string) => void;
  addDeviceIoSignal: (deviceId: string, signal: LinkageIoSignal) => void;
  updateDeviceIoSignal: (deviceId: string, signalId: string, updates: Partial<LinkageIoSignal>) => void;
  removeDeviceIoSignal: (deviceId: string, signalId: string) => void;
  addDeviceInterlock: (deviceId: string, interlock: LinkageInterlock) => void;
  updateDeviceInterlock: (deviceId: string, interlockId: string, updates: Partial<LinkageInterlock>) => void;
  removeDeviceInterlock: (deviceId: string, interlockId: string) => void;
  updateGlobalData: (id: string, updates: Partial<LinkageGlobalData>) => void;
  addGlobalData: (data: LinkageGlobalData) => void;
  removeGlobalData: (id: string) => void;
  updateProcessStep: (stepId: string, updates: Partial<ProcessStep>) => void;
  addProcessStep: (step: ProcessStep) => void;
  removeProcessStep: (stepId: string) => void;
  reorderProcessSteps: (stepIds: string[]) => void;
  setMatrixReviewStatus: (status: MatrixReviewStatus) => void;

  // Actions — artifacts
  addStageArtifacts: (stage: ProcessStage, artifacts: Artifact[]) => void;
  clearStageArtifacts: (stage: ProcessStage) => void;

  // Actions — compile results
  setStageCompileResult: (stage: ProcessStage, result: { success: boolean; errors: CompileError[] } | null) => void;

  // Actions — rollback
  rollbackToStage: (stage: ProcessStage) => void;

  // Actions — gating
  toggleAutoGating: () => void;

  // Actions — pipeline (reuse pac-st-store pattern)
  startPipeline: (id: string) => void;
  addPipelineStep: (step: PipelineStepResult) => void;
  updatePipelineStep: (agentId: string, updates: Partial<PipelineStepResult>) => void;
  completePipeline: (finalArtifactCount: number) => void;
  setActiveAgentName: (name: string | null) => void;

  // Actions — streaming
  appendStreamChunk: (chunk: string) => void;
  clearStreaming: () => void;

  // Reset
  reset: () => void;
}

function createInitialStageStatuses(): ProcessStageStatus[] {
  return PROCESS_STAGE_ORDER.map((stage) => ({
    stage,
    status: "pending",
    startedAt: null,
    completedAt: null,
    artifactIds: [],
    error: null,
  }));
}

function createEmptyStageArtifacts(): Record<ProcessStage, Artifact[]> {
  return {
    qa: [],
    matrix: [],
    io: [],
    folders: [],
    fb: [],
    db: [],
    fc_ob: [],
  };
}

function createEmptyStageCompileResults(): Record<ProcessStage, { success: boolean; errors: CompileError[] } | null> {
  return {
    qa: null,
    matrix: null,
    io: null,
    folders: null,
    fb: null,
    db: null,
    fc_ob: null,
  };
}

/** Helper to update a device within the matrix. */
function updateMatrixDevice(
  matrix: ProcessLinkageMatrix,
  deviceId: string,
  updater: (device: LinkageDevice) => LinkageDevice,
): ProcessLinkageMatrix {
  return {
    ...matrix,
    deviceLinkage: matrix.deviceLinkage.map((d) =>
      d.id === deviceId ? updater(d) : d
    ),
    reviewStatus: "user_edited",
  };
}

const INITIAL_STATE = {
  currentStage: "qa" as ProcessStage,
  stageStatuses: createInitialStageStatuses(),
  qaMessages: [] as ProcessQaMessage[],
  qaAnswers: [] as QaAnswer[],
  ioRecommendations: [] as IoRecommendation[],
  fbRecommendations: [] as FbRecommendation[],
  folderStructure: {} as Record<string, unknown>,
  linkageMatrix: null as ProcessLinkageMatrix | null,
  stageArtifacts: createEmptyStageArtifacts(),
  stageCompileResults: createEmptyStageCompileResults(),
  autoGating: false,
  pipelineExecution: null as PipelineExecution | null,
  activeAgentName: null as string | null,
  streamingContent: null as string | null,
};

export const useProcessBuilderStore = create<ProcessBuilderState>()(
  persist(
  (set) => ({
  ...INITIAL_STATE,

  setStage: (stage) => set({ currentStage: stage }),

  updateStageStatus: (stage, updates) =>
    set((s) => ({
      stageStatuses: s.stageStatuses.map((ss) =>
        ss.stage === stage ? { ...ss, ...updates } : ss
      ),
    })),

  addQaMessage: (message) =>
    set((s) => ({ qaMessages: [...s.qaMessages, message] })),

  addQaAnswer: (answer) =>
    set((s) => ({ qaAnswers: [...s.qaAnswers, answer] })),

  setIoRecommendations: (recs) => set({ ioRecommendations: recs }),

  confirmIo: (index, confirmed) =>
    set((s) => {
      const updated = [...s.ioRecommendations];
      if (updated[index]) updated[index] = { ...updated[index], confirmed };
      return { ioRecommendations: updated };
    }),

  setFbRecommendations: (recs) => set({ fbRecommendations: recs }),

  confirmFb: (index, confirmed) =>
    set((s) => {
      const updated = [...s.fbRecommendations];
      if (updated[index]) updated[index] = { ...updated[index], confirmed };
      return { fbRecommendations: updated };
    }),

  setFolderStructure: (structure) => set({ folderStructure: structure }),

  // --- Linkage Matrix actions ---

  setLinkageMatrix: (matrix) => set({ linkageMatrix: matrix }),

  updateLinkageDevice: (deviceId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({ ...d, ...updates })),
      };
    }),

  addLinkageDevice: (device) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          deviceLinkage: [...s.linkageMatrix.deviceLinkage, device],
          reviewStatus: "user_edited",
        },
      };
    }),

  removeLinkageDevice: (deviceId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          deviceLinkage: s.linkageMatrix.deviceLinkage.filter((d) => d.id !== deviceId),
          reviewStatus: "user_edited",
        },
      };
    }),

  addDeviceIoSignal: (deviceId, signal) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({
          ...d,
          ioSignals: [...d.ioSignals, signal],
        })),
      };
    }),

  updateDeviceIoSignal: (deviceId, signalId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({
          ...d,
          ioSignals: d.ioSignals.map((sig) =>
            sig.id === signalId ? { ...sig, ...updates } : sig
          ),
        })),
      };
    }),

  removeDeviceIoSignal: (deviceId, signalId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({
          ...d,
          ioSignals: d.ioSignals.filter((sig) => sig.id !== signalId),
        })),
      };
    }),

  addDeviceInterlock: (deviceId, interlock) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({
          ...d,
          interlocks: [...d.interlocks, interlock],
        })),
      };
    }),

  updateDeviceInterlock: (deviceId, interlockId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({
          ...d,
          interlocks: d.interlocks.map((il) =>
            il.id === interlockId ? { ...il, ...updates } : il
          ),
        })),
      };
    }),

  removeDeviceInterlock: (deviceId, interlockId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({
          ...d,
          interlocks: d.interlocks.filter((il) => il.id !== interlockId),
        })),
      };
    }),

  updateGlobalData: (id, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          globalData: s.linkageMatrix.globalData.map((gd) =>
            gd.id === id ? { ...gd, ...updates } : gd
          ),
          reviewStatus: "user_edited",
        },
      };
    }),

  addGlobalData: (data) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          globalData: [...s.linkageMatrix.globalData, data],
          reviewStatus: "user_edited",
        },
      };
    }),

  removeGlobalData: (id) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          globalData: s.linkageMatrix.globalData.filter((gd) => gd.id !== id),
          reviewStatus: "user_edited",
        },
      };
    }),

  updateProcessStep: (stepId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          processSteps: s.linkageMatrix.processSteps.map((ps) =>
            ps.id === stepId ? { ...ps, ...updates } : ps
          ),
          reviewStatus: "user_edited",
        },
      };
    }),

  addProcessStep: (step) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          processSteps: [...s.linkageMatrix.processSteps, step],
          reviewStatus: "user_edited",
        },
      };
    }),

  removeProcessStep: (stepId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      const filtered = s.linkageMatrix.processSteps.filter((ps) => ps.id !== stepId);
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          processSteps: filtered.map((ps, i) => ({ ...ps, stepNumber: i + 1 })),
          reviewStatus: "user_edited",
        },
      };
    }),

  reorderProcessSteps: (stepIds) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      const stepMap = new Map(s.linkageMatrix.processSteps.map((ps) => [ps.id, ps]));
      const reordered = stepIds
        .map((id) => stepMap.get(id))
        .filter((ps): ps is ProcessStep => !!ps)
        .map((ps, i) => ({ ...ps, stepNumber: i + 1 }));
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          processSteps: reordered,
          reviewStatus: "user_edited",
        },
      };
    }),

  setMatrixReviewStatus: (status) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          reviewStatus: status,
          lastReviewedAt: status === "pm_validated" ? new Date().toISOString() : s.linkageMatrix.lastReviewedAt,
        },
      };
    }),

  addStageArtifacts: (stage, artifacts) =>
    set((s) => ({
      stageArtifacts: {
        ...s.stageArtifacts,
        [stage]: [...s.stageArtifacts[stage], ...artifacts],
      },
    })),

  clearStageArtifacts: (stage) =>
    set((s) => ({
      stageArtifacts: { ...s.stageArtifacts, [stage]: [] },
      stageCompileResults: { ...s.stageCompileResults, [stage]: null },
    })),

  setStageCompileResult: (stage, result) =>
    set((s) => ({
      stageCompileResults: {
        ...s.stageCompileResults,
        [stage]: result,
      },
    })),

  rollbackToStage: (stage) =>
    set((s) => {
      const targetIdx = PROCESS_STAGE_ORDER.indexOf(stage);
      const clearedStatuses = s.stageStatuses.map((ss) => {
        const idx = PROCESS_STAGE_ORDER.indexOf(ss.stage);
        if (idx >= targetIdx) {
          return { ...ss, status: "pending" as const, startedAt: null, completedAt: null, artifactIds: [], error: null };
        }
        return ss;
      });
      const clearedArtifacts = { ...s.stageArtifacts };
      const clearedCompileResults = { ...s.stageCompileResults };
      for (const st of PROCESS_STAGE_ORDER) {
        if (PROCESS_STAGE_ORDER.indexOf(st) >= targetIdx) {
          clearedArtifacts[st] = [];
          clearedCompileResults[st] = null;
        }
      }
      return {
        currentStage: stage,
        stageStatuses: clearedStatuses,
        stageArtifacts: clearedArtifacts,
        stageCompileResults: clearedCompileResults,
      };
    }),

  toggleAutoGating: () => set((s) => ({ autoGating: !s.autoGating })),

  startPipeline: (id) =>
    set({
      pipelineExecution: {
        id,
        startedAt: new Date().toISOString(),
        completedAt: null,
        steps: [],
        finalArtifactCount: 0,
      },
      activeAgentName: null,
    }),

  addPipelineStep: (step) =>
    set((s) => {
      if (!s.pipelineExecution) return s;
      return {
        pipelineExecution: {
          ...s.pipelineExecution,
          steps: [...s.pipelineExecution.steps, step],
        },
      };
    }),

  updatePipelineStep: (agentId, updates) =>
    set((s) => {
      if (!s.pipelineExecution) return s;
      return {
        pipelineExecution: {
          ...s.pipelineExecution,
          steps: s.pipelineExecution.steps.map((step) =>
            step.agentId === agentId ? { ...step, ...updates } : step
          ),
        },
      };
    }),

  completePipeline: (finalArtifactCount) =>
    set((s) => {
      if (!s.pipelineExecution) return s;
      return {
        pipelineExecution: {
          ...s.pipelineExecution,
          completedAt: new Date().toISOString(),
          finalArtifactCount,
        },
        activeAgentName: null,
      };
    }),

  setActiveAgentName: (name) => set({ activeAgentName: name }),

  appendStreamChunk: (chunk) =>
    set((s) => ({ streamingContent: (s.streamingContent ?? "") + chunk })),

  clearStreaming: () => set({ streamingContent: null }),

  reset: () => {
    set({ ...INITIAL_STATE, stageStatuses: createInitialStageStatuses(), stageArtifacts: createEmptyStageArtifacts(), stageCompileResults: createEmptyStageCompileResults() });
    // Clear persisted storage on explicit reset
    sessionStorage.removeItem("process-builder-store");
  },
}),
  {
    name: "process-builder-store",
    storage: {
      getItem: (name) => {
        const str = sessionStorage.getItem(name);
        return str ? JSON.parse(str) : null;
      },
      setItem: (name, value) => {
        sessionStorage.setItem(name, JSON.stringify(value));
      },
      removeItem: (name) => {
        sessionStorage.removeItem(name);
      },
    },
    merge: (persisted, current) => {
      const p = persisted as Partial<ProcessBuilderState> | undefined;
      if (!p) return current;
      return {
        ...current,
        ...p,
        // Ensure all stage keys exist even if new stages were added after persistence
        stageStatuses: p.stageStatuses?.length
          ? PROCESS_STAGE_ORDER.map((stage) => {
              const existing = p.stageStatuses!.find((ss) => ss.stage === stage);
              return existing ?? { stage, status: "pending" as const, startedAt: null, completedAt: null, artifactIds: [], error: null };
            })
          : createInitialStageStatuses(),
        stageArtifacts: {
          ...createEmptyStageArtifacts(),
          ...(p.stageArtifacts ?? {}),
        },
        stageCompileResults: {
          ...createEmptyStageCompileResults(),
          ...(p.stageCompileResults ?? {}),
        },
      };
    },
    partialize: (state) => {
      // Persist meaningful state — skip transient/streaming fields
      const persisted = {
        currentStage: state.currentStage,
        stageStatuses: state.stageStatuses,
        qaMessages: state.qaMessages,
        qaAnswers: state.qaAnswers,
        ioRecommendations: state.ioRecommendations,
        fbRecommendations: state.fbRecommendations,
        folderStructure: state.folderStructure,
        linkageMatrix: state.linkageMatrix,
        stageArtifacts: state.stageArtifacts,
        stageCompileResults: state.stageCompileResults,
        autoGating: state.autoGating,
        // Strip raw responses from pipeline steps to save space
        pipelineExecution: state.pipelineExecution
          ? {
              ...state.pipelineExecution,
              steps: state.pipelineExecution.steps.map((s) => ({
                ...s,
                rawResponse: undefined,
                systemPrompt: undefined,
                userMessage: undefined,
              })),
            }
          : null,
      };
      return persisted as unknown as ProcessBuilderState;
    },
  },
));
