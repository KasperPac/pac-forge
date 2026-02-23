import { create } from "zustand";
import type { Artifact } from "@/types";

type BottomPanelTab = "compile" | "logs" | "warnings";

interface ApprovedArtifact {
  artifact: Artifact;
  content: string;
}

interface PendingEditorNavigation {
  artifactName: string;
  line: number;
}

interface PacStState {
  // Artifacts
  generatedArtifacts: Artifact[];
  approvedArtifacts: ApprovedArtifact[];
  activeGeneratedIndex: number;
  activeApprovedIndex: number;

  // Streaming
  streamingContent: string | null;

  // TIA integration
  currentTiaJobId: string | null;
  pendingEditorNavigation: PendingEditorNavigation | null;

  // Bottom panel
  bottomPanelOpen: boolean;
  bottomPanelTab: BottomPanelTab;

  // Diff
  showDiff: boolean;

  // Actions — artifacts
  setGeneratedArtifacts: (artifacts: Artifact[]) => void;
  setActiveGeneratedIndex: (index: number) => void;
  setActiveApprovedIndex: (index: number) => void;
  approveArtifact: (index: number) => void;
  approveAllArtifacts: () => void;
  updateApprovedContent: (index: number, content: string) => void;

  // Actions — streaming
  appendStreamChunk: (chunk: string) => void;
  clearStreaming: () => void;

  // Actions — TIA integration
  setCurrentTiaJobId: (id: string | null) => void;
  navigateToArtifact: (artifactName: string, line: number) => void;
  clearPendingNavigation: () => void;

  // Actions — bottom panel
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelTab: (tab: BottomPanelTab) => void;

  // Actions — diff
  toggleDiff: () => void;

  // Reset
  reset: () => void;
}

export const usePacStStore = create<PacStState>((set) => ({
  generatedArtifacts: [],
  approvedArtifacts: [],
  activeGeneratedIndex: 0,
  activeApprovedIndex: 0,
  streamingContent: null,
  currentTiaJobId: null,
  pendingEditorNavigation: null,
  bottomPanelOpen: false,
  bottomPanelTab: "compile",
  showDiff: false,

  setGeneratedArtifacts: (artifacts) =>
    set({ generatedArtifacts: artifacts, activeGeneratedIndex: 0 }),

  setActiveGeneratedIndex: (index) => set({ activeGeneratedIndex: index }),
  setActiveApprovedIndex: (index) => set({ activeApprovedIndex: index }),

  approveArtifact: (index) =>
    set((s) => {
      const artifact = s.generatedArtifacts[index];
      if (!artifact) return s;
      const exists = s.approvedArtifacts.findIndex(
        (a) => a.artifact.name === artifact.name
      );
      const updated = [...s.approvedArtifacts];
      if (exists >= 0) {
        updated[exists] = { artifact, content: artifact.content };
      } else {
        updated.push({ artifact, content: artifact.content });
      }
      return { approvedArtifacts: updated, activeApprovedIndex: exists >= 0 ? exists : updated.length - 1 };
    }),

  approveAllArtifacts: () =>
    set((s) => ({
      approvedArtifacts: s.generatedArtifacts.map((a) => ({
        artifact: a,
        content: a.content,
      })),
      activeApprovedIndex: 0,
    })),

  updateApprovedContent: (index, content) =>
    set((s) => {
      const updated = [...s.approvedArtifacts];
      if (updated[index]) {
        updated[index] = { ...updated[index], content };
      }
      return { approvedArtifacts: updated };
    }),

  appendStreamChunk: (chunk) =>
    set((s) => ({ streamingContent: (s.streamingContent ?? "") + chunk })),
  clearStreaming: () => set({ streamingContent: null }),

  setCurrentTiaJobId: (id) => set({ currentTiaJobId: id }),

  navigateToArtifact: (artifactName, line) =>
    set((s) => {
      // Try approved artifacts first
      const approvedIdx = s.approvedArtifacts.findIndex(
        (a) => a.artifact.name === artifactName
      );
      if (approvedIdx >= 0) {
        return {
          activeApprovedIndex: approvedIdx,
          pendingEditorNavigation: { artifactName, line },
        };
      }
      // Fall back to generated artifacts
      const generatedIdx = s.generatedArtifacts.findIndex(
        (a) => a.name === artifactName
      );
      if (generatedIdx >= 0) {
        return {
          activeGeneratedIndex: generatedIdx,
          pendingEditorNavigation: { artifactName, line },
        };
      }
      return s;
    }),

  clearPendingNavigation: () => set({ pendingEditorNavigation: null }),

  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab, bottomPanelOpen: true }),

  toggleDiff: () => set((s) => ({ showDiff: !s.showDiff })),

  reset: () =>
    set({
      generatedArtifacts: [],
      approvedArtifacts: [],
      activeGeneratedIndex: 0,
      activeApprovedIndex: 0,
      streamingContent: null,
      currentTiaJobId: null,
      pendingEditorNavigation: null,
      bottomPanelOpen: false,
      bottomPanelTab: "compile",
      showDiff: false,
    }),
}));
