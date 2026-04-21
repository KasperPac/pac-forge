import { useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router";
import { FolderOpen, Bot, Terminal, BookOpen, GraduationCap, Layers, SlidersHorizontal, FileText, Library, LogOut, User, Sun, Moon, Monitor, ChevronRight, PanelLeftClose, PanelLeftOpen, Wand2, BookPlus, Building2, Cpu, FlaskConical, LayoutDashboard, ClipboardList, SearchCode } from "lucide-react";
import { AgentChatFab } from "@/components/agent-chat/agent-chat-fab";
import pacLogo from "@/../media/logos/PacTechnologiesEdit_White.png";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
// useGlobalActiveSession removed — replaced by global activeProjectId in ui-store
import { useProject } from "@/hooks/use-projects";
import { usePendingPatternCount } from "@/hooks/use-patterns";
import { useBridgeStatus } from "@/hooks/use-tia-jobs";
import { useSupabaseStatus } from "@/hooks/use-supabase-status";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof FolderOpen;
  requiresProject?: boolean;
}

interface NavGroup {
  label?: string;
  collapsible?: boolean;
  items: NavItem[];
}

const PROJECT_SCOPED_ROUTES = new Set(["/forge", "/pac-audit", "/specs", "/hmi-editor"]);

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/projects", label: "Projects", icon: FolderOpen },
      { to: "/forge", label: "Project Wizard", icon: Wand2, requiresProject: true },
      { to: "/pac-audit", label: "Pac-Audit", icon: SearchCode, requiresProject: true },
      { to: "/specs", label: "Spec Builder", icon: ClipboardList, requiresProject: true },
      { to: "/hmi-editor", label: "HMI Editor", icon: Monitor, requiresProject: true },
    ],
  },
  {
    label: "Configuration",
    items: [
      { to: "/clients", label: "Clients", icon: Building2 },
      { to: "/profiles", label: "Profiles", icon: SlidersHorizontal },
      { to: "/fb-library", label: "FB Library", icon: Layers },
      { to: "/test-templates", label: "Test Templates", icon: FlaskConical },
      { to: "/library-import", label: "Library Import", icon: BookPlus },
      { to: "/instructions", label: "Instructions", icon: Cpu },
      { to: "/agents", label: "Agents", icon: Bot },
    ],
  },
  {
    label: "Training",
    collapsible: true,
    items: [
      { to: "/knowledge", label: "Knowledge", icon: GraduationCap },
      { to: "/reference-library", label: "Reference Library", icon: Library },
      { to: "/patterns", label: "Patterns", icon: BookOpen },
      { to: "/prompts", label: "Prompts", icon: FileText },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/tia-console", label: "TIA Console", icon: Terminal },
    ],
  },
];

function NavGroupSection({
  group,
  collapsed,
  pendingPatternCount,
  hasActiveProject,
}: {
  group: NavGroup;
  collapsed: boolean;
  pendingPatternCount?: number;
  hasActiveProject: boolean;
}) {
  const location = useLocation();
  const isAnyActive = group.items.some((item) => location.pathname.startsWith(item.to));
  const [expanded, setExpanded] = useState(!group.collapsible || isAnyActive);

  if (group.collapsible && isAnyActive && !expanded) setExpanded(true);

  const itemsVisible = !group.collapsible || expanded;

  if (collapsed) {
    return (
      <>
        {group.items.map((item) => {
          const disabled = item.requiresProject && !hasActiveProject;
          if (disabled) {
            return (
              <div
                key={item.to}
                title="Select a project first"
                className="flex items-center justify-center rounded-md p-2 text-muted-foreground/30 cursor-not-allowed"
              >
                <item.icon className="h-4 w-4" />
              </div>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  "flex items-center justify-center rounded-md p-2 transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )
              }
            >
              <item.icon className="h-4 w-4" />
            </NavLink>
          );
        })}
      </>
    );
  }

  return (
    <div className="space-y-0.5">
      {/* Group header */}
      {group.label && (
        <div className="pb-0.5 pt-3">
          <div className="mb-1 border-t border-border/50" />
          {group.collapsible ? (
            <button
              onClick={() => setExpanded((prev) => !prev)}
              className="flex w-full items-center gap-1.5 px-3 py-0.5 text-left transition-colors hover:text-foreground"
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {group.label}
              </span>
              <ChevronRight
                className={cn(
                  "h-3 w-3 text-muted-foreground/60 transition-transform duration-200",
                  expanded && "rotate-90"
                )}
              />
            </button>
          ) : (
            <div className="px-3 py-0.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {group.label}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Items */}
      {group.collapsible ? (
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200",
            itemsVisible ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <div className="overflow-hidden">
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem key={item.to} item={item} pendingPatternCount={pendingPatternCount} hasActiveProject={hasActiveProject} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-0.5">
          {group.items.map((item) => (
            <NavItem key={item.to} item={item} pendingPatternCount={pendingPatternCount} hasActiveProject={hasActiveProject} />
          ))}
        </div>
      )}
    </div>
  );
}

function NavItem({ item, pendingPatternCount, hasActiveProject }: { item: NavItem; pendingPatternCount?: number; hasActiveProject: boolean }) {
  const disabled = item.requiresProject && !hasActiveProject;

  if (disabled) {
    return (
      <div
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground/40 cursor-not-allowed"
        title="Select a project first"
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {item.label}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
      {item.to === "/patterns" && pendingPatternCount != null && pendingPatternCount > 0 && (
        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 font-mono text-[10px] text-amber-400">
          {pendingPatternCount}
        </span>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const { data: pendingCount } = usePendingPatternCount();
  const { sidebarCollapsed, toggleSidebar, activeProjectId } = useUiStore();
  const hasActiveProject = !!activeProjectId;

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-background transition-[width] duration-200",
        sidebarCollapsed ? "w-12" : "w-56",
      )}
    >
      <div className={cn("relative flex items-center", sidebarCollapsed ? "justify-center p-2" : "px-3 py-3")}>
        {sidebarCollapsed ? (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar}>
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        ) : (
          <>
            <img
              src={pacLogo}
              alt="Pac Technologies"
              className="h-10 w-auto object-contain invert dark:invert-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute -right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border border-border bg-background shadow-sm hover:bg-accent z-10"
              onClick={toggleSidebar}
            >
              <PanelLeftClose className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>

      <Separator />

      <nav className={cn("flex-1 overflow-y-auto", sidebarCollapsed ? "space-y-1 p-1" : "p-2")}>
        {NAV_GROUPS.map((group, i) => (
          <NavGroupSection
            key={i}
            group={group}
            collapsed={sidebarCollapsed}
            pendingPatternCount={pendingCount ?? undefined}
            hasActiveProject={hasActiveProject}
          />
        ))}
      </nav>
    </aside>
  );
}

function getInitials(displayName: string | undefined, email: string | undefined): string {
  if (displayName) {
    return displayName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (email?.[0] ?? "?").toUpperCase();
}

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

function SupabaseStatusIndicator() {
  const { data: health } = useSupabaseStatus();

  const dot =
    health === "healthy"  ? "bg-green-500" :
    health === "degraded" ? "bg-amber-500" :
    health === "offline"  ? "bg-red-500 animate-pulse" :
    "bg-zinc-500";

  const label =
    health === "healthy"  ? "Supabase healthy" :
    health === "degraded" ? "Supabase degraded" :
    health === "offline"  ? "Supabase offline" :
    "Supabase checking…";

  return (
    <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground" title={label}>
      <span className={cn("inline-block h-2 w-2 rounded-full", dot)} />
      <span>{label}</span>
    </div>
  );
}

function BridgeStatusIndicator() {
  const { data: status } = useBridgeStatus();
  const [starting, setStarting] = useState(false);
  const bridgeOn = status?.bridgeOnline ?? false;
  const tiaOn = status?.tiaConnected ?? false;
  const projectOn = status?.projectOpen ?? false;

  const activePort = status?.activePort;
  const versionTag = activePort ? ` [V${activePort === 5103 ? "18" : "20"}]` : "";
  const label = !bridgeOn
    ? "Bridge offline"
    : !tiaOn
      ? `Bridge online${versionTag}`
      : projectOn
        ? `TIA connected${versionTag}`
        : `TIA connected${versionTag} (no project)`;

  const dotColor = !bridgeOn
    ? "bg-zinc-500"
    : !tiaOn
      ? "bg-amber-500"
      : "bg-green-500";

  async function handleStartBridge() {
    setStarting(true);
    // Check if any bridge is already online
    for (const port of [5102, 5103]) {
      try {
        const resp = await fetch(`http://localhost:${port}/tia/status`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) { setStarting(false); return; }
      } catch { /* offline */ }
    }
    try {
      await fetch("/__bridge/start", { method: "POST", signal: AbortSignal.timeout(5000) });
    } catch {
      await navigator.clipboard.writeText("dotnet run --project bridge/PacForgeBridge");
    }
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      for (const port of [5102, 5103]) {
        try {
          const resp = await fetch(`http://localhost:${port}/tia/status`, { signal: AbortSignal.timeout(2000) });
          if (resp.ok) { setStarting(false); return; }
        } catch { /* still starting */ }
      }
    }
    setStarting(false);
  }

  return (
    <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground" title={label}>
      <Terminal className="h-3 w-3" />
      <span className={cn("inline-block h-2 w-2 rounded-full", dotColor, starting && "animate-pulse")} />
      <span>{label}</span>
      {!bridgeOn && (
        <button
          onClick={() => void handleStartBridge()}
          disabled={starting}
          className="ml-1 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start"}
        </button>
      )}
    </div>
  );
}

function TopBar() {
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const { theme, cycleTheme, activeProjectId, setActiveProjectId } = useUiStore();
  const { data: activeProject } = useProject(activeProjectId ?? undefined);

  const initials = getInitials(profile?.display_name, user?.email ?? undefined);
  const ThemeIcon = THEME_ICON[theme];

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {activeProject ? (
            <button
              onClick={() => navigate(`/projects/${activeProject.id}`)}
              className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/50"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              <FolderOpen className="h-3 w-3" />
              <span className="text-foreground">{activeProject.client_name}</span>
              {activeProject.project_number && (
                <span className="text-muted-foreground/70">{activeProject.project_number}</span>
              )}
            </button>
          ) : (
            <button
              onClick={() => navigate("/projects")}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-amber-400 transition-colors hover:bg-accent/50"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
              <span>No project selected</span>
            </button>
          )}
        </div>
        <Separator orientation="vertical" className="h-4" />
        <SupabaseStatusIndicator />
        <Separator orientation="vertical" className="h-4" />
        <BridgeStatusIndicator />
      </div>
      <div className="flex items-center gap-1">
      <Button variant="ghost" className="h-8 w-8 p-0" onClick={cycleTheme} title={`Theme: ${theme}`}>
        <ThemeIcon className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 rounded-full p-0">
            <Avatar className="h-8 w-8">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="text-sm font-medium">{profile?.display_name || user?.email}</div>
            {profile?.display_name && (
              <div className="text-xs text-muted-foreground">{user?.email}</div>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/profile")}>
            <User className="mr-2 h-4 w-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
  );
}

export function DashboardLayout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-4">
          <Outlet />
        </main>
      </div>
      <AgentChatFab />
    </div>
  );
}
