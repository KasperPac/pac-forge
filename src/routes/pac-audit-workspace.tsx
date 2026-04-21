import { useParams, useNavigate } from "react-router";
import { SearchCode, ArrowLeft, X } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BlockTree } from "@/components/pac-audit/workspace/block-tree";
import { CodeViewer } from "@/components/pac-audit/workspace/code-viewer";
import { UnderstandingPanel } from "@/components/pac-audit/workspace/understanding-panel";
import { useAuditProject } from "@/hooks/use-audit-session";
import { useAuditStore } from "@/stores/audit-store";
import { cn } from "@/lib/utils";

export default function PacAuditWorkspacePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const store = useAuditStore();

  const { data: session, isLoading } = useAuditProject(sessionId ?? null);

  if (!sessionId) {
    return <NotFound message="No session ID in URL" onBack={() => navigate("/pac-audit")} />;
  }

  if (isLoading) {
    return (
      <div className="-m-4 flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="font-mono text-sm text-muted-foreground">Loading session…</div>
      </div>
    );
  }

  if (!session) {
    return <NotFound message={`Session ${sessionId.slice(0, 8)} not found`} onBack={() => navigate("/pac-audit")} />;
  }

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Top bar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card/60 px-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/pac-audit")}
          className="h-7 gap-1.5 px-2 font-mono text-xs text-muted-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </Button>
        <div className="h-4 w-px bg-border/60" />
        <SearchCode className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-sm font-medium">{session.name}</span>
        {session.tia_version && (
          <Badge variant="outline" className="font-mono text-[9px] px-1 py-0">
            TIA {session.tia_version}
          </Badge>
        )}
        {store.plcsimConnected && (
          <Badge variant="outline" className="font-mono text-[9px] px-1.5 py-0 text-green-400 border-green-500/40">
            PLCSIM
          </Badge>
        )}

        {/* Open block tabs summary */}
        {store.openBlockIds.length > 0 && (
          <div className="ml-2 flex items-center gap-1">
            <span className="font-mono text-[10px] text-muted-foreground">{store.openBlockIds.length} open</span>
            <button
              type="button"
              onClick={() => { store.openBlockIds.forEach((id) => store.closeBlock(id)); }}
              className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Close all"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* 3-pane layout */}
      <Group orientation="horizontal" className="flex-1 flex overflow-hidden">
        {/* Left: Block tree */}
        <Panel defaultSize={20} minSize={14} maxSize={35} className="flex flex-col overflow-hidden border-r border-border/40">
          <div className="flex items-center gap-1.5 border-b border-border/40 px-2 py-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Blocks</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <BlockTree sessionId={sessionId} />
          </div>
        </Panel>

        <Separator className={cn(
          "w-1 bg-border/30 transition-colors hover:bg-border/70",
          "data-[resize-handle-active]:bg-blue-500/50"
        )} />

        {/* Middle: Code viewer */}
        <Panel defaultSize={50} minSize={30} className="flex flex-col overflow-hidden">
          <CodeViewer sessionId={sessionId} session={session} />
        </Panel>

        <Separator className={cn(
          "w-1 bg-border/30 transition-colors hover:bg-border/70",
          "data-[resize-handle-active]:bg-blue-500/50"
        )} />

        {/* Right: Understanding + Chat + Testing */}
        <Panel defaultSize={30} minSize={22} maxSize={45} className="flex flex-col overflow-hidden border-l border-border/40">
          <div className="flex items-center gap-1.5 border-b border-border/40 px-2 py-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Inspector</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <UnderstandingPanel sessionId={sessionId} session={session} />
          </div>
        </Panel>
      </Group>
    </div>
  );
}

function NotFound({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4">
      <SearchCode className="h-10 w-10 text-muted-foreground/30" />
      <p className="font-mono text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onBack} className="gap-2">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Pac-Audit
      </Button>
    </div>
  );
}
