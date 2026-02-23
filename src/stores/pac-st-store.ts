import { create } from "zustand";
import type { Artifact } from "@/types";

type BottomPanelTab = "compile" | "logs" | "warnings";

interface ApprovedArtifact {
  artifact: Artifact;
  content: string;
}

interface PacStState {
  // Artifacts
  generatedArtifacts: Artifact[];
  approvedArtifacts: ApprovedArtifact[];
  activeGeneratedIndex: number;
  activeApprovedIndex: number;

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

  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab, bottomPanelOpen: true }),

  toggleDiff: () => set((s) => ({ showDiff: !s.showDiff })),

  reset: () =>
    set({
      generatedArtifacts: [],
      approvedArtifacts: [],
      activeGeneratedIndex: 0,
      activeApprovedIndex: 0,
      bottomPanelOpen: false,
      bottomPanelTab: "compile",
      showDiff: false,
    }),
}));
