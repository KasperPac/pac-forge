import { NavLink, Outlet } from "react-router";
import { FolderOpen, Bot, Code, Terminal, BookOpen, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/pac-st", label: "Pac-ST", icon: Code },
  { to: "/patterns", label: "Patterns", icon: BookOpen },
  { to: "/tia-console", label: "TIA Console", icon: Terminal },
] as const;

function Sidebar() {
  return (
    <aside className="flex w-64 flex-col border-r bg-background">
      <div className="p-4">
        <div className="font-mono text-xs text-muted-foreground">PAC-FORGE</div>
        <div className="mt-1 text-lg font-semibold tracking-tight">Pac-ST</div>
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
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function TopBar() {
  const { user, signOut } = useAuth();

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <div className="font-mono text-xs text-muted-foreground">
        Session: <span className="text-foreground">ACTIVE</span>
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
      <div className="flex flex-1 flex-col">
        <TopBar />
        <ScrollArea className="flex-1">
          <main className="p-4">
            <Outlet />
          </main>
        </ScrollArea>
      </div>
    </div>
  );
}
