import { useState } from "react";
import { CheckCircle2, Circle, Loader2, AlertCircle, Monitor } from "lucide-react";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useForgeHmiGenerate } from "@/hooks/use-forge-hmi-generate";
import type { ForgeSession, ForgeArtifact } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";

export interface ForgeHmiProps {
  session: ForgeSession;
  profile: DesignProfile;
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onComplete: () => void;
}

export function ForgeHmi({
  session,
  profile,
  onArtifactsUpdate,
  onComplete,
}: ForgeHmiProps) {
  const [artifacts, setArtifacts] = useState<ForgeArtifact[]>(session.hmi_artifacts ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(artifacts[0]?.id ?? null);
  const { generateAll, loading, error } = useForgeHmiGenerate();

  const selected = artifacts.find(a => a.id === selectedId) ?? null;

  function toggleApprove(id: string) {
    const updated = artifacts.map(a => a.id === id ? { ...a, approved: !a.approved } : a);
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  function approveAll() {
    const updated = artifacts.map(a => ({ ...a, approved: true }));
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  async function handleGenerate() {
    try {
      const generated = await generateAll(session, profile);
      setArtifacts(generated);
      onArtifactsUpdate(generated);
      if (generated.length > 0) setSelectedId(generated[0].id);
    } catch {
      // error handled by hook
    }
  }

  const approvedCount = artifacts.filter(a => a.approved).length;

  return (
    <div className="flex h-full flex-col gap-3">
      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1 rounded-md border border-border/70">
        {/* Left — screen list */}
        <ResizablePanel defaultSize={30} minSize={20}>
          <div className="flex h-full flex-col">
            <div className="border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                HMI Screens
              </span>
              {artifacts.length > 0 && (
                <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                  {approvedCount}/{artifacts.length}
                </Badge>
              )}
            </div>
            <ScrollArea className="flex-1">
              {artifacts.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
                  <Monitor className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">
                    Click "Generate HMI Screens" to create overview and faceplate screens
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5 p-2">
                  {artifacts.map(a => (
                    <button
                      key={a.id}
                      onClick={() => setSelectedId(a.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors ${selectedId === a.id ? "bg-primary/15 text-foreground" : "hover:bg-muted/40 text-muted-foreground"}`}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); toggleApprove(a.id); }}
                        className="shrink-0"
                      >
                        {a.approved
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          : <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />}
                      </button>
                      <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                      <span className="min-w-0 flex-1 truncate font-mono">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right — JSON viewer */}
        <ResizablePanel defaultSize={70}>
          <div className="flex h-full flex-col">
            <div className="border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {selected ? `${selected.name} — HmiScreenSpec JSON` : "Select a screen"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <Editor
                height="100%"
                language="json"
                value={selected?.content ?? "// Select a screen to view its HmiScreenSpec JSON"}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: "JetBrains Mono, Consolas, monospace",
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  theme: "vs-dark",
                }}
              />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Toolbar */}
      <div className="flex flex-col gap-2">
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleGenerate} disabled={loading} className="gap-2">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Generate HMI Screens
          </Button>
          {artifacts.length > 0 && (
            <>
              <Button variant="outline" onClick={approveAll}>Approve All</Button>
              <div className="flex-1" />
              <Button onClick={onComplete}>
                {approvedCount > 0 ? `Continue (${approvedCount} approved)` : "Skip HMI"}
              </Button>
            </>
          )}
          {artifacts.length === 0 && !loading && (
            <>
              <div className="flex-1" />
              <Button variant="outline" onClick={onComplete}>Skip HMI</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
