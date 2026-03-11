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
import { useForgeDeviceGenerate } from "@/hooks/use-forge-device-generate";
import type { ForgeSession, ForgeArtifact } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";

export interface ForgeDeviceCodeProps {
  session: ForgeSession;
  profile: DesignProfile;
  fbTemplates: FbTemplate[];
  patterns: PatternCandidate[];
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onComplete: () => void;
}

function typeBadge(type: ForgeArtifact["type"]) {
  const colors: Record<string, string> = {
    FB: "border-blue-500/50 text-blue-400",
    FC: "border-cyan-500/50 text-cyan-400",
    DB: "border-purple-500/50 text-purple-400",
    UDT: "border-orange-500/50 text-orange-400",
    OB: "border-green-500/50 text-green-400",
    TAG_TABLE: "border-gray-500/50 text-gray-400",
  };
  return (
    <Badge variant="outline" className={`font-mono text-[10px] ${colors[type] ?? ""}`}>
      {type}
    </Badge>
  );
}

function langBadge(lang: ForgeArtifact["language"]) {
  return (
    <Badge
      variant="outline"
      className={`font-mono text-[10px] ${lang === "SCL" ? "border-emerald-500/50 text-emerald-400" : "border-yellow-500/50 text-yellow-400"}`}
    >
      {lang}
    </Badge>
  );
}

export function ForgeDeviceCode({
  session,
  profile,
  fbTemplates,
  patterns,
  onArtifactsUpdate,
  onComplete,
}: ForgeDeviceCodeProps) {
  const [artifacts, setArtifacts] = useState<ForgeArtifact[]>(session.device_artifacts ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(artifacts[0]?.id ?? null);
  const [editable, setEditable] = useState(false);

  const { generateAll, loading, progress, error } = useForgeDeviceGenerate();

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

  function updateContent(id: string, content: string) {
    const updated = artifacts.map(a => a.id === id ? { ...a, content } : a);
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  async function handleGenerateAll() {
    try {
      const generated = await generateAll(session, profile, fbTemplates, patterns);
      setArtifacts(generated);
      onArtifactsUpdate(generated);
      if (generated.length > 0) setSelectedId(generated[0].id);
    } catch {
      // error state handled by hook
    }
  }

  const approvedCount = artifacts.filter(a => a.approved).length;
  const progressPct = loading
    ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 rounded-md border border-border/70">
        {/* Left panel — artifact list */}
        <ResizablePanel defaultSize={35} minSize={25}>
          <div className="flex h-full flex-col">
            <div className="border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Artifacts
              </span>
              {artifacts.length > 0 && (
                <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                  {approvedCount}/{artifacts.length} approved
                </Badge>
              )}
            </div>
            <ScrollArea className="flex-1">
              {artifacts.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No artifacts yet — click Generate All
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
                      <div className="flex shrink-0 gap-1">
                        {typeBadge(a.type)}
                        {langBadge(a.language)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right panel — Monaco editor */}
        <ResizablePanel defaultSize={65}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {selected ? selected.name : "Select an artifact"}
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
            <div className="min-h-0 flex-1">
              <Editor
                height="100%"
                language={selected?.language === "LAD" ? "json" : "plaintext"}
                value={selected?.content ?? "// Select an artifact from the left panel"}
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
                Generating: {progress.currentDevice}
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
          <Button
            variant="outline"
            onClick={handleGenerateAll}
            disabled={loading}
            className="gap-2"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Generate All
          </Button>

          {artifacts.length > 0 && (
            <>
              <Button variant="outline" onClick={approveAll}>
                Approve All
              </Button>
              <div className="flex-1" />
              <Button
                disabled={approvedCount === 0}
                onClick={onComplete}
              >
                Continue ({approvedCount} approved)
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
