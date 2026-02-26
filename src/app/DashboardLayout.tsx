import { NavLink, Outlet } from "react-router";
import { FolderOpen, Bot, Code, Terminal, BookOpen, GraduationCap, Layers, SlidersHorizontal, FileText, Library, LogOut } from "lucide-react";
import pacLogo from "@/../media/logos/PacTechnologiesEdit_White.png";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useGlobalActiveSession } from "@/hooks/use-sessions";
import { useProject } from "@/hooks/use-projects";
import { usePendingPatternCount } from "@/hooks/use-patterns";
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
          className="h-10 w-auto"
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

function TopBar() {
  const { user, signOut } = useAuth();
  const { data: activeSession } = useGlobalActiveSession();
  const { data: sessionProject } = useProject(activeSession?.project_id);

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
      <div className="flex items-center gap-3">
        {user && (
          <span className="font-mono text-xs text-muted-foreground">
            {user.email}
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={signOut} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
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
    </div>
  );
}
