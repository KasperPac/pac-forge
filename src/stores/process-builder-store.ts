import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Artifact, CompileError, IoEntry } from "@/types";
import type {
  ProcessStage,
  ProcessStageStatus,
  QaAnswer,
  IoRecommendation,
  FbRecommendation,
  ProcessLinkageMatrix,
  LinkageDevice,
  FbWire,
  LinkageInterlock,
  LinkageGlobalData,
  ProcessStep,
  ProcessSequence,
  ProcessPermissive,
  SafetyCondition,
  TransitionSubCondition,
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

  // IO comparison (suggested IO list from AI for side-by-side review)
  suggestedIoList: IoEntry[] | null;
  ioComparisonSummary: string | null;

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
  addDeviceWire: (deviceId: string, wire: FbWire) => void;
  updateDeviceWire: (deviceId: string, wireId: string, updates: Partial<FbWire>) => void;
  removeDeviceWire: (deviceId: string, wireId: string) => void;
  addDeviceInterlock: (deviceId: string, interlock: LinkageInterlock) => void;
  updateDeviceInterlock: (deviceId: string, interlockId: string, updates: Partial<LinkageInterlock>) => void;
  removeDeviceInterlock: (deviceId: string, interlockId: string) => void;
  updateGlobalData: (id: string, updates: Partial<LinkageGlobalData>) => void;
  addGlobalData: (data: LinkageGlobalData) => void;
  removeGlobalData: (id: string) => void;

  // Actions — process sequences
  addProcessSequence: (sequence: ProcessSequence) => void;
  updateProcessSequence: (sequenceId: string, updates: Partial<ProcessSequence>) => void;
  removeProcessSequence: (sequenceId: string) => void;
  addProcessStep: (sequenceId: string, step: ProcessStep) => void;
  updateProcessStep: (sequenceId: string, stepId: string, updates: Partial<ProcessStep>) => void;
  removeProcessStep: (sequenceId: string, stepId: string) => void;
  reorderProcessSteps: (sequenceId: string, stepIds: string[]) => void;
  addPermissive: (sequenceId: string, permissive: ProcessPermissive) => void;
  updatePermissive: (sequenceId: string, permissiveId: string, updates: Partial<ProcessPermissive>) => void;
  removePermissive: (sequenceId: string, permissiveId: string) => void;
  addSafetyCondition: (sequenceId: string, condition: SafetyCondition) => void;
  updateSafetyCondition: (sequenceId: string, conditionId: string, updates: Partial<SafetyCondition>) => void;
  removeSafetyCondition: (sequenceId: string, conditionId: string) => void;
  addTransitionSubCondition: (sequenceId: string, stepId: string, subCondition: TransitionSubCondition) => void;
  updateTransitionSubCondition: (sequenceId: string, stepId: string, subConditionId: string, updates: Partial<TransitionSubCondition>) => void;
  removeTransitionSubCondition: (sequenceId: string, stepId: string, subConditionId: string) => void;
  setTransitionCombinator: (sequenceId: string, stepId: string, combinator: "AND" | "OR") => void;

  setMatrixReviewStatus: (status: MatrixReviewStatus) => void;

  // Actions — IO comparison
  setSuggestedIoList: (entries: IoEntry[], summary: string | null) => void;
  clearSuggestedIoList: () => void;

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

/** Helper to update a sequence within the matrix. */
function updateMatrixSequence(
  matrix: ProcessLinkageMatrix,
  sequenceId: string,
  updater: (seq: ProcessSequence) => ProcessSequence,
): ProcessLinkageMatrix {
  return {
    ...matrix,
    processSequences: matrix.processSequences.map((s) =>
      s.id === sequenceId ? updater(s) : s
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
  suggestedIoList: null as IoEntry[] | null,
  ioComparisonSummary: null as string | null,
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

  addDeviceWire: (deviceId, wire) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({
          ...d,
          wiring: [...d.wiring, wire],
        })),
      };
    }),

  updateDeviceWire: (deviceId, wireId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({
          ...d,
          wiring: d.wiring.map((w) =>
            w.id === wireId ? { ...w, ...updates } : w
          ),
        })),
      };
    }),

  removeDeviceWire: (deviceId, wireId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixDevice(s.linkageMatrix, deviceId, (d) => ({
          ...d,
          wiring: d.wiring.filter((w) => w.id !== wireId),
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

  // --- Process Sequence actions ---

  addProcessSequence: (sequence) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          processSequences: [...s.linkageMatrix.processSequences, sequence],
          reviewStatus: "user_edited",
        },
      };
    }),

  updateProcessSequence: (sequenceId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({ ...seq, ...updates })),
      };
    }),

  removeProcessSequence: (sequenceId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: {
          ...s.linkageMatrix,
          processSequences: s.linkageMatrix.processSequences.filter((sq) => sq.id !== sequenceId),
          reviewStatus: "user_edited",
        },
      };
    }),

  addProcessStep: (sequenceId, step) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          steps: [...seq.steps, step],
        })),
      };
    }),

  updateProcessStep: (sequenceId, stepId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          steps: seq.steps.map((ps) => ps.id === stepId ? { ...ps, ...updates } : ps),
        })),
      };
    }),

  removeProcessStep: (sequenceId, stepId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          steps: seq.steps
            .filter((ps) => ps.id !== stepId)
            .map((ps, i) => ({ ...ps, stepNumber: i + 1 })),
        })),
      };
    }),

  reorderProcessSteps: (sequenceId, stepIds) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => {
          const stepMap = new Map(seq.steps.map((ps) => [ps.id, ps]));
          const reordered = stepIds
            .map((id) => stepMap.get(id))
            .filter((ps): ps is ProcessStep => !!ps)
            .map((ps, i) => ({ ...ps, stepNumber: i + 1 }));
          return { ...seq, steps: reordered };
        }),
      };
    }),

  addPermissive: (sequenceId, permissive) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          permissives: [...seq.permissives, permissive],
        })),
      };
    }),

  updatePermissive: (sequenceId, permissiveId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          permissives: seq.permissives.map((p) => p.id === permissiveId ? { ...p, ...updates } : p),
        })),
      };
    }),

  removePermissive: (sequenceId, permissiveId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          permissives: seq.permissives.filter((p) => p.id !== permissiveId),
        })),
      };
    }),

  addSafetyCondition: (sequenceId, condition) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          safetyConditions: [...seq.safetyConditions, condition],
        })),
      };
    }),

  updateSafetyCondition: (sequenceId, conditionId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          safetyConditions: seq.safetyConditions.map((c) => c.id === conditionId ? { ...c, ...updates } : c),
        })),
      };
    }),

  removeSafetyCondition: (sequenceId, conditionId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          safetyConditions: seq.safetyConditions.filter((c) => c.id !== conditionId),
        })),
      };
    }),

  addTransitionSubCondition: (sequenceId, stepId, subCondition) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          steps: seq.steps.map((ps) =>
            ps.id === stepId
              ? { ...ps, transition: { ...ps.transition, conditions: [...ps.transition.conditions, subCondition] } }
              : ps
          ),
        })),
      };
    }),

  updateTransitionSubCondition: (sequenceId, stepId, subConditionId, updates) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          steps: seq.steps.map((ps) =>
            ps.id === stepId
              ? {
                  ...ps,
                  transition: {
                    ...ps.transition,
                    conditions: ps.transition.conditions.map((c) =>
                      c.id === subConditionId ? { ...c, ...updates } : c
                    ),
                  },
                }
              : ps
          ),
        })),
      };
    }),

  removeTransitionSubCondition: (sequenceId, stepId, subConditionId) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          steps: seq.steps.map((ps) =>
            ps.id === stepId
              ? {
                  ...ps,
                  transition: {
                    ...ps.transition,
                    conditions: ps.transition.conditions.filter((c) => c.id !== subConditionId),
                  },
                }
              : ps
          ),
        })),
      };
    }),

  setTransitionCombinator: (sequenceId, stepId, combinator) =>
    set((s) => {
      if (!s.linkageMatrix) return s;
      return {
        linkageMatrix: updateMatrixSequence(s.linkageMatrix, sequenceId, (seq) => ({
          ...seq,
          steps: seq.steps.map((ps) =>
            ps.id === stepId
              ? { ...ps, transition: { ...ps.transition, combinator } }
              : ps
          ),
        })),
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

  setSuggestedIoList: (entries, summary) =>
    set({ suggestedIoList: entries, ioComparisonSummary: summary }),
  clearSuggestedIoList: () =>
    set({ suggestedIoList: null, ioComparisonSummary: null }),

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

      // Migrate old ioSignals → wiring on rehydration
      let linkageMatrix = p.linkageMatrix ?? null;
      if (linkageMatrix) {
        linkageMatrix = {
          ...linkageMatrix,
          deviceLinkage: linkageMatrix.deviceLinkage.map((d) => {
            const legacy = d as unknown as Record<string, unknown>;
            if (d.wiring && d.wiring.length > 0) return d;
            const oldSignals = (legacy.ioSignals ?? []) as Array<{ id?: string; tagName: string; signalType: string; purpose: string }>;
            if (oldSignals.length > 0) {
              return {
                ...d,
                wiring: oldSignals.map((sig) => ({
                  id: sig.id ?? crypto.randomUUID(),
                  paramName: sig.tagName,
                  direction: (sig.signalType === "DI" || sig.signalType === "AI" ? "in" : "out") as "in" | "out",
                  connectedTo: sig.tagName,
                  wireType: "io" as const,
                  dataType: sig.signalType === "AI" || sig.signalType === "AQ" ? "Real" : "Bool",
                })),
              };
            }
            return { ...d, wiring: d.wiring ?? [] };
          }),
        };
      }

      // Migrate old flat processSteps → processSequences
      if (linkageMatrix && !linkageMatrix.processSequences) {
        const oldSteps = (linkageMatrix as unknown as { processSteps?: ProcessStep[] }).processSteps ?? [];
        linkageMatrix = {
          ...linkageMatrix,
          processSequences: oldSteps.length > 0
            ? [{
                id: crypto.randomUUID(),
                name: "Main Sequence",
                description: "",
                permissives: [],
                safetyConditions: [],
                steps: oldSteps.map((ps) => ({
                  ...ps,
                  transition: ps.transition ?? {
                    combinator: "AND" as const,
                    conditions: ps.completionCriteria
                      ? [{ id: crypto.randomUUID(), description: ps.completionCriteria, deviceName: null }]
                      : [],
                  },
                  actions: ps.actions ?? (ps.action
                    ? [{ id: crypto.randomUUID(), description: ps.action, deviceName: null }]
                    : []),
                })),
              }]
            : [],
        };
      }

      return {
        ...current,
        ...p,
        linkageMatrix,
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
        pipelineExecution: state.pipelineExecution,
      };
      return persisted as unknown as ProcessBuilderState;
    },
  },
));
