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
import { ForgeSubPipeline } from "@/components/forge/forge-sub-pipeline";
import type { SubPipelineStage } from "@/components/forge/forge-sub-pipeline";
import { useForgeDeviceGenerate } from "@/hooks/use-forge-device-generate";
import { useForgeReview } from "@/hooks/use-forge-review";
import { useForgeRewrite } from "@/hooks/use-forge-rewrite";
import { useForgeCompileCheck } from "@/hooks/use-forge-compile-check";
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

const INITIAL_STAGES: SubPipelineStage[] = [
  { label: "Generate FBs", status: "pending" },
  { label: "Review", status: "pending" },
  { label: "Fix", status: "pending" },
  { label: "Approve", status: "pending" },
  { label: "Upload", status: "pending" },
  { label: "Compile", status: "pending" },
];

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
  const [stages, setStages] = useState<SubPipelineStage[]>(INITIAL_STAGES);
  const [reviewSummary, setReviewSummary] = useState<string | null>(null);
  const [compileErrors, setCompileErrors] = useState<string[]>([]);

  const { generateAll, loading: genLoading, progress, error: genError } = useForgeDeviceGenerate();
  const { review, loading: reviewLoading } = useForgeReview();
  const { rewrite, loading: rewriteLoading } = useForgeRewrite();
  const { compileCheck, loading: compileLoading, progress: compileProgress } = useForgeCompileCheck();

  const loading = genLoading || reviewLoading || rewriteLoading || compileLoading;
  const selected = artifacts.find(a => a.id === selectedId) ?? null;

  function setStageStatus(label: string, status: SubPipelineStage["status"], detail?: string) {
    setStages(prev => prev.map(s => s.label === label ? { ...s, status, detail } : s));
  }

  function toggleApprove(id: string) {
    const updated = artifacts.map(a => a.id === id ? { ...a, approved: !a.approved } : a);
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  function approveAll() {
    const updated = artifacts.map(a => ({ ...a, approved: true }));
    setArtifacts(updated);
    onArtifactsUpdate(updated);
    setStageStatus("Approve", "completed", `${updated.length} artifacts`);
  }

  function updateContent(id: string, content: string) {
    const updated = artifacts.map(a => a.id === id ? { ...a, content } : a);
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  async function handleGenerateAll() {
    setStages(INITIAL_STAGES.map(s => ({ ...s, status: "pending" })));
    setReviewSummary(null);
    setCompileErrors([]);

    try {
      // 1. Generate
      setStageStatus("Generate FBs", "running");
      const generated = await generateAll(session, profile, fbTemplates, patterns);
      setArtifacts(generated);
      onArtifactsUpdate(generated);
      if (generated.length > 0) setSelectedId(generated[0].id);
      setStageStatus("Generate FBs", "completed", `${generated.length} artifacts`);

      // 2. Review (FB scope)
      setStageStatus("Review", "running");
      const reviewResult = await review(generated, "fb", profile);

      if (reviewResult.hasCritical || reviewResult.hasWarning) {
        const count = reviewResult.findings.filter(f => f.severity === "CRITICAL" || f.severity === "WARNING").length;
        setStageStatus("Review", "completed", `${count} issues`);

        // 3. Rewrite
        setStageStatus("Fix", "running");
        const rewritten = await rewrite(generated, reviewResult.findings, profile);
        setArtifacts(rewritten);
        onArtifactsUpdate(rewritten);
        setStageStatus("Fix", "completed", `${count} fixed`);
        setReviewSummary(`Review found ${count} issue${count !== 1 ? "s" : ""} — code rewritten automatically.`);
      } else {
        setStageStatus("Review", "completed", "clean");
        setStageStatus("Fix", "skipped");
        setReviewSummary("Review passed — no issues found.");
      }

      setStageStatus("Approve", "pending");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const runningStage = stages.find(s => s.status === "running");
      if (runningStage) setStageStatus(runningStage.label, "failed", msg);
    }
  }

  async function handleUploadAndCompile() {
    const approved = artifacts.filter(a => a.approved);
    if (approved.length === 0) return;

    const tiaProjectPath = session.tia_project_path;
    if (!tiaProjectPath) {
      setCompileErrors(["No TIA project path set — configure it in the TIA Export step first."]);
      return;
    }

    setStageStatus("Approve", "completed", `${approved.length} approved`);
    setStageStatus("Upload", "running");

    try {
      const result = await compileCheck(approved, tiaProjectPath);

      if (result.success) {
        setStageStatus("Upload", "completed");
        setStageStatus("Compile", "completed", "clean");
        setCompileErrors([]);

        // Update artifacts with any auto-fixed versions
        const updatedArtifacts = artifacts.map(orig => {
          const fixed = result.artifacts.find(a => a.id === orig.id);
          return fixed ?? orig;
        });
        setArtifacts(updatedArtifacts);
        onArtifactsUpdate(updatedArtifacts);
      } else {
        setStageStatus("Upload", "completed");
        setStageStatus("Compile", "failed", `${result.compileErrors.length} errors`);
        setCompileErrors(result.compileErrors);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStageStatus("Compile", "failed", msg);
      setCompileErrors([msg]);
    }
  }

  const approvedCount = artifacts.filter(a => a.approved).length;
  const progressPct = genLoading
    ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  const compilePhaseLabel = compileProgress.phase === "fixing"
    ? `Fixing (attempt ${compileProgress.attempt}/${3})`
    : compileProgress.phase === "recompiling"
    ? `Recompiling (attempt ${compileProgress.attempt})`
    : null;

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Sub-pipeline progress */}
      <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
        <ForgeSubPipeline stages={stages} />
      </div>

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
        {genLoading && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">
                {progress.currentDevice}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {progress.current}/{progress.total}
              </span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>
        )}

        {compilePhaseLabel && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {compilePhaseLabel}
          </div>
        )}

        {reviewSummary && (
          <div className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${reviewSummary.includes("passed") ? "border-green-600/30 bg-green-500/5 text-green-400" : "border-amber-600/30 bg-amber-500/5 text-amber-400"}`}>
            {reviewSummary}
          </div>
        )}

        {(genError ?? compileErrors.length > 0) && (
          <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {genError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {genError}
              </div>
            )}
            {compileErrors.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {e}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleGenerateAll}
            disabled={loading}
            className="gap-2"
          >
            {(genLoading || reviewLoading || rewriteLoading) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Generate All
          </Button>

          {artifacts.length > 0 && (
            <>
              <Button variant="outline" onClick={approveAll} disabled={loading}>
                Approve All
              </Button>
              <Button
                variant="outline"
                onClick={handleUploadAndCompile}
                disabled={loading || approvedCount === 0 || !session.tia_project_path}
                title={!session.tia_project_path ? "No TIA project path set" : ""}
                className="gap-2"
              >
                {compileLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Upload & Compile
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
