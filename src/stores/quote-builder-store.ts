import { create } from "zustand";

export const BUILDER_SECTIONS = [
  "scope",
  "inclusions",
  "exclusions",
  "assumptions",
  "line-items",
  "commercial",
  "tnc",
] as const;
export type BuilderSection = (typeof BUILDER_SECTIONS)[number];

export const BUILDER_SECTION_LABELS: Record<BuilderSection, string> = {
  scope: "Scope",
  inclusions: "Inclusions",
  exclusions: "Exclusions",
  assumptions: "Assumptions",
  "line-items": "Pricing",
  commercial: "Commercial Terms",
  tnc: "Terms & Conditions",
};

interface BuilderState {
  activeSection: BuilderSection;
  isDirty: boolean;
  setActive: (s: BuilderSection) => void;
  setDirty: (d: boolean) => void;
}

export const useQuoteBuilderStore = create<BuilderState>((set) => ({
  activeSection: "scope",
  isDirty: false,
  setActive: (s) => set({ activeSection: s }),
  setDirty: (d) => set({ isDirty: d }),
}));
