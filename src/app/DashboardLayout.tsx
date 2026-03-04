import { useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router";
import { FolderOpen, Bot, Code, Terminal, BookOpen, GraduationCap, Layers, SlidersHorizontal, FileText, Library, LogOut, User, Sun, Moon, Monitor, ChevronRight, MessageSquare, Blocks, Workflow } from "lucide-react";
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
import { useGlobalActiveSession } from "@/hooks/use-sessions";
import { useProject } from "@/hooks/use-projects";
import { usePendingPatternCount } from "@/hooks/use-patterns";
import { useBridgeStatus } from "@/hooks/use-tia-jobs";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

interface NavChild {
  to: string;
  label: string;
  icon: typeof Code;
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof Code;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/agents", label: "Agents", icon: Bot },
  {
    to: "/pac-st",
    label: "Pac-ST",
    icon: Code,
    children: [
      { to: "/pac-st/chat", label: "Chat", icon: MessageSquare },
      { to: "/pac-st/fb-builder", label: "FB Builder", icon: Blocks },
      { to: "/pac-st/process", label: "Process Builder", icon: Workflow },
    ],
  },
  {
    to: "/training",
    label: "Training",
    icon: GraduationCap,
    children: [
      { to: "/knowledge", label: "Knowledge", icon: GraduationCap },
      { to: "/reference-library", label: "Reference Library", icon: Library },
      { to: "/patterns", label: "Patterns", icon: BookOpen },
      { to: "/prompts", label: "Prompts", icon: FileText },
    ],
  },
  { to: "/profiles", label: "Profiles", icon: SlidersHorizontal },
  { to: "/fb-library", label: "FB Library", icon: Layers },
  { to: "/tia-console", label: "TIA Console", icon: Terminal },
];

function NavGroupItem({ item, pendingPatternCount }: { item: NavItem; pendingPatternCount?: number }) {
  const location = useLocation();
  const isChildActive = item.children?.some((c) => location.pathname.startsWith(c.to)) ?? false;
  const [expanded, setExpanded] = useState(isChildActive);

  // Auto-expand when a child route becomes active
  if (isChildActive && !expanded) setExpanded(true);

  return (
    <div>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isChildActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <item.icon className="h-4 w-4" />
        {item.label}
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pb-1 pl-6 pt-0.5">
            {item.children?.map((child) => (
              <NavLink
                key={child.to}
                to={child.to}
                className={({ isActive }) =>
                  cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )
                }
              >
                <child.icon className="h-3.5 w-3.5" />
                {child.label}
                {child.to === "/patterns" && pendingPatternCount != null && pendingPatternCount > 0 && (
                  <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 font-mono text-[10px] text-amber-400">
                    {pendingPatternCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  const { data: pendingCount } = usePendingPatternCount();

  return (
    <aside className="flex w-64 flex-col border-r bg-background">
      <div className="flex flex-col items-center p-4">
        <img
          src={pacLogo}
          alt="Pac Technologies"
          className="h-10 w-auto invert dark:invert-0"
        />
      </div>

      <Separator />

      <nav className="flex-1 p-2 space-y-1">
        {NAV_ITEMS.map((item) =>
          item.children ? (
            <NavGroupItem key={item.to} item={item} pendingPatternCount={pendingCount ?? undefined} />
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          )
        )}
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

function BridgeStatusIndicator() {
  const { data: status } = useBridgeStatus();
  const bridgeOn = status?.bridgeOnline ?? false;
  const tiaOn = status?.tiaConnected ?? false;
  const projectOn = status?.projectOpen ?? false;

  const label = !bridgeOn
    ? "Bridge offline"
    : !tiaOn
      ? "Bridge online"
      : projectOn
        ? "TIA connected"
        : "TIA connected (no project)";

  const dotColor = !bridgeOn
    ? "bg-zinc-500"
    : !tiaOn
      ? "bg-amber-500"
      : "bg-green-500";

  return (
    <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground" title={label}>
      <Terminal className="h-3 w-3" />
      <span className={cn("inline-block h-2 w-2 rounded-full", dotColor)} />
      <span>{label}</span>
    </div>
  );
}

function TopBar() {
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const { data: activeSession } = useGlobalActiveSession();
  const { data: sessionProject } = useProject(activeSession?.project_id);
  const navigate = useNavigate();
  const { theme, cycleTheme } = useUiStore();

  const initials = getInitials(profile?.display_name, user?.email ?? undefined);
  const ThemeIcon = THEME_ICON[theme];

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {activeSession ? (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              <span>Session: <span className="text-foreground">{sessionProject?.client_name ?? "Loading..."}</span></span>
            </>
          ) : (
            <span>No active session</span>
          )}
        </div>
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
