import { create } from "zustand";

type BottomPanelTab = "compile" | "logs" | "warnings";
type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const THEME_KEY = "pac-forge-theme";
const DROPBOX_ROOT_KEY = "pac-forge-dropbox-root";
const ACTIVE_PROJECT_KEY = "pac-forge-active-project";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? getSystemTheme() : pref;
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

function loadThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  // Pac design system is light-first. Dark mode stays available via the theme toggle.
  return "light";
}

interface UiState {
  sidebarCollapsed: boolean;
  bottomPanelOpen: boolean;
  bottomPanelTab: BottomPanelTab;
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  /** Dropbox root folder cached locally and hydrated from the user profile when available. */
  dropboxRoot: string;
  /** Global active project ID — persisted to localStorage */
  activeProjectId: string | null;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
  setTheme: (theme: ThemePreference) => void;
  cycleTheme: () => void;
  setDropboxRoot: (path: string) => void;
  setActiveProjectId: (id: string | null) => void;
}

const initialTheme = loadThemePreference();
const initialResolved = resolveTheme(initialTheme);
applyTheme(initialResolved);

export const useUiStore = create<UiState>((set, get) => {
  // Listen for system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const { theme } = get();
    if (theme === "system") {
      const resolved = getSystemTheme();
      applyTheme(resolved);
      set({ resolvedTheme: resolved });
    }
  });

  return {
    sidebarCollapsed: false,
    bottomPanelOpen: false,
    bottomPanelTab: "compile",
    theme: initialTheme,
    resolvedTheme: initialResolved,
    dropboxRoot: localStorage.getItem(DROPBOX_ROOT_KEY) ?? "",
    activeProjectId: localStorage.getItem(ACTIVE_PROJECT_KEY) ?? null,

    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
    setBottomPanelTab: (tab) => set({ bottomPanelTab: tab, bottomPanelOpen: true }),

    setTheme: (theme) => {
      localStorage.setItem(THEME_KEY, theme);
      const resolved = resolveTheme(theme);
      applyTheme(resolved);
      set({ theme, resolvedTheme: resolved });
    },

    cycleTheme: () => {
      const order: ThemePreference[] = ["system", "light", "dark"];
      const { theme } = get();
      const next = order[(order.indexOf(theme) + 1) % order.length];
      get().setTheme(next);
    },

    setDropboxRoot: (path) => {
      localStorage.setItem(DROPBOX_ROOT_KEY, path);
      set({ dropboxRoot: path });
    },

    setActiveProjectId: (id) => {
      if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      else localStorage.removeItem(ACTIVE_PROJECT_KEY);
      set({ activeProjectId: id });
    },
  };
});
