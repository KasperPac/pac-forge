import { NavLink, Outlet, useNavigate } from "react-router";
import { FolderOpen, Bot, Code, Terminal, BookOpen, GraduationCap, Layers, SlidersHorizontal, FileText, Library, LogOut, User, Sun, Moon, Monitor } from "lucide-react";
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
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/knowledge", label: "Knowledge", icon: GraduationCap },
  { to: "/reference-library", label: "Reference Library", icon: Library },
  { to: "/pac-st", label: "Pac-ST", icon: Code },
  { to: "/patterns", label: "Patterns", icon: BookOpen },
  { to: "/profiles", label: "Profiles", icon: SlidersHorizontal },
  { to: "/fb-library", label: "FB Library", icon: Layers },
  { to: "/prompts", label: "Prompts", icon: FileText },
  { to: "/tia-console", label: "TIA Console", icon: Terminal },
] as const;

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
        {NAV_ITEMS.map((item) => (
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
            {item.to === "/patterns" && pendingCount != null && pendingCount > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/20 px-1.5 font-mono text-xs text-amber-400">
                {pendingCount}
              </span>
            )}
          </NavLink>
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
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        {activeSession ? (
          <>
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            <span>Session: <span className="text-foreground">{sessionProject?.client_name ?? "Loading..."}</span></span>
          </>
        ) : (
          <span>No active session</span>
        )}
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
