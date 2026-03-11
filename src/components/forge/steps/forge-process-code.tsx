import { useState } from "react";
import { CheckCircle2, Circle, Loader2, AlertCircle, Edit, Eye } from "lucide-react";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useForgeProcessGenerate } from "@/hooks/use-forge-process-generate";
import type { ForgeSession, ForgeArtifact, SpecAnalysis, SpecAnalysisProcessSequence } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { PatternCandidate } from "@/types";

export interface ForgeProcessCodeProps {
  session: ForgeSession;
  profile: DesignProfile;
  patterns: PatternCandidate[];
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onComplete: () => void;
}

export function ForgeProcessCode({
  session,
  profile,
  patterns,
  onArtifactsUpdate,
  onComplete,
}: ForgeProcessCodeProps) {
  const [artifacts, setArtifacts] = useState<ForgeArtifact[]>(session.process_artifacts ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(artifacts[0]?.id ?? null);
  const [editable, setEditable] = useState(false);

  const { generateAll, loading, progress, error } = useForgeProcessGenerate();

  const specAnalysis = session.spec_analysis as SpecAnalysis | null;
  const sequences = specAnalysis?.process_sequences ?? [];

  const selected = artifacts.find(a => a.id === selectedId) ?? null;
  const selectedSequence: SpecAnalysisProcessSequence | undefined = sequences.find(
    seq => selected && selected.name.includes(seq.name.slice(0, 20)),
  );

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

  function updateContent(id: string, content: string) {
    const updated = artifacts.map(a => a.id === id ? { ...a, content } : a);
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  async function handleGenerateAll() {
    try {
      const generated = await generateAll(session, profile, patterns);
      setArtifacts(generated);
      onArtifactsUpdate(generated);
      if (generated.length > 0) setSelectedId(generated[0].id);
    } catch {
      // error handled by hook
    }
  }

  const approvedCount = artifacts.filter(a => a.approved).length;
  const progressPct = loading
    ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 rounded-md border border-border/70">
        {/* Left panel — sequence / artifact list */}
        <ResizablePanel defaultSize={35} minSize={25}>
          <div className="flex h-full flex-col">
            <div className="border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Sequences
              </span>
              {artifacts.length > 0 && (
                <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                  {approvedCount}/{artifacts.length} approved
                </Badge>
              )}
            </div>
            <ScrollArea className="flex-1">
              {artifacts.length === 0 ? (
                <div className="space-y-0.5 p-2">
                  {sequences.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                      No process sequences found in spec
                    </p>
                  ) : (
                    sequences.map((seq, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                        <span className="text-xs">{seq.name}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">{seq.steps.length} steps</Badge>
                      </div>
                    ))
                  )}
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
                      <span className="min-w-0 flex-1 truncate font-mono">{a.name}</span>
                      <Badge variant="outline" className={`shrink-0 font-mono text-[10px] ${a.language === "SCL" ? "border-emerald-500/50 text-emerald-400" : "border-yellow-500/50 text-yellow-400"}`}>
                        {a.language}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right panel */}
        <ResizablePanel defaultSize={65}>
          <div className="flex h-full flex-col gap-2 p-2">
            {/* Sequence reference card */}
            {selectedSequence && (
              <Card className="shrink-0 border-border/60 bg-background/50">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs text-muted-foreground">
                    Reference: {selectedSequence.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {selectedSequence.steps.map(s => (
                      <div key={s.step_number} className="flex gap-2 text-xs">
                        <span className="shrink-0 font-mono text-muted-foreground w-6">{s.step_number}.</span>
                        <span className="text-muted-foreground">{s.action}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground/60">→ {s.completion_criteria}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Editor */}
            <div className="min-h-0 flex-1 rounded-md border border-border/60 overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/60 bg-card px-3 py-1.5">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {selected ? selected.name : "Select a sequence artifact"}
                </span>
                {selected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 font-mono text-[10px]"
                    onClick={() => setEditable(e => !e)}
                  >
                    {editable ? <><Eye className="h-3 w-3" /> Read-only</> : <><Edit className="h-3 w-3" /> Edit</>}
                  </Button>
                )}
              </div>
              <Editor
                height="100%"
                language="plaintext"
                value={selected?.content ?? "// Select a sequence artifact to view generated code"}
                onChange={v => selected && editable && updateContent(selected.id, v ?? "")}
                options={{
                  readOnly: !editable,
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

      {/* Bottom toolbar */}
      <div className="flex flex-col gap-2">
        {loading && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">
                Generating: {progress.currentSequence}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {progress.current}/{progress.total}
              </span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleGenerateAll} disabled={loading} className="gap-2">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Generate All
          </Button>
          {artifacts.length > 0 && (
            <>
              <Button variant="outline" onClick={approveAll}>Approve All</Button>
              <div className="flex-1" />
              <Button disabled={approvedCount === 0} onClick={onComplete}>
                Continue ({approvedCount} approved)
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
