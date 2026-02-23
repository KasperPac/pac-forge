import { create } from "zustand";

type BottomPanelTab = "compile" | "logs" | "warnings";

interface UiState {
  sidebarCollapsed: boolean;
  bottomPanelOpen: boolean;
  bottomPanelTab: BottomPanelTab;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  bottomPanelOpen: false,
  bottomPanelTab: "compile",

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab, bottomPanelOpen: true }),
}));
