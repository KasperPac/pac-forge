import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Maximize2,
  GitCompareArrows,
  Code2,
  Undo2,
  BookMarked,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { ForgeCodeViewer } from "@/components/forge/forge-code-viewer";
import { ForgeArtifactDialog } from "@/components/forge/forge-artifact-dialog";
import { DiffView } from "@/components/pac-st/diff-view";
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
import type { DeviceGenLogEntry } from "@/hooks/use-forge-device-generate";
import { useForgeIoValidate } from "@/hooks/use-forge-io-validate";
import { useForgeCompileCheck } from "@/hooks/use-forge-compile-check";
import { useCreatePatternCandidate } from "@/hooks/use-patterns";
import { useAgents } from "@/hooks/use-agents";
import { computeDiff, extractFocusedSnippets } from "@/lib/diff-engine";
import { cn } from "@/lib/utils";
import type { ForgeSession, ForgeArtifact, ForgeIoEntry, ForgeDeviceEntry } from "@/types/forge";
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

function GenerationLog({ entries }: { entries: DeviceGenLogEntry[] }) {
  const [open, setOpen] = useState(true);
  const warnCount = entries.filter(e => e.level === "warn").length;
  const fixCount = entries.filter(e => e.level === "fix").length;

  return (
    <div className="rounded-md border border-border/60 bg-muted/10">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Generation Log</span>
        <div className="ml-auto flex items-center gap-1.5">
          {fixCount > 0 && <Badge variant="outline" className="font-mono text-[9px] border-amber-500/50 text-amber-400">{fixCount} auto-fixed</Badge>}
          {warnCount > 0 && <Badge variant="outline" className="font-mono text-[9px] border-red-500/50 text-red-400">{warnCount} warnings</Badge>}
          <Badge variant="outline" className="font-mono text-[9px]">{entries.length} entries</Badge>
        </div>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-2">
          <div className="max-h-48 overflow-y-auto space-y-0.5 font-mono text-[10px]">
            {entries.map((e, i) => (
              <div key={i} className={`flex gap-2 ${e.level === "warn" ? "text-red-400" : e.level === "fix" ? "text-amber-400" : "text-muted-foreground"}`}>
                <span className="shrink-0 text-muted-foreground/50">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className={`shrink-0 uppercase ${e.level === "warn" ? "text-red-500" : e.level === "fix" ? "text-amber-500" : "text-blue-500"}`}>{e.level}</span>
                <span className="break-all">{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const INITIAL_STAGES: SubPipelineStage[] = [
  { label: "Generate FBs", status: "pending" },
  { label: "Validate IO", status: "pending" },
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stages, setStages] = useState<SubPipelineStage[]>(INITIAL_STAGES);
  const [ioValidationSummary, setIoValidationSummary] = useState<string | null>(null);
  const [compileErrors, setCompileErrors] = useState<string[]>([]);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [currentStepLabel, setCurrentStepLabel] = useState<string | null>(null);

  // Manual diff state (user-triggered, not auto-review)
  const [preRewriteArtifacts, setPreRewriteArtifacts] = useState<ForgeArtifact[] | null>(null);
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"code" | "diff">("code");
  const [changesOpen, setChangesOpen] = useState(false);
  const [selectedForLibrary, setSelectedForLibrary] = useState<Set<string>>(new Set());
  const [savedToLibrary, setSavedToLibrary] = useState<Set<string>>(new Set());

  const { generateAll, loading: genLoading, progress, error: genError, log: genLog } = useForgeDeviceGenerate();
  const { validateIo, loading: ioValidateLoading } = useForgeIoValidate();
  const { compileCheck, loading: compileLoading, progress: compileProgress } = useForgeCompileCheck();
  const { data: agents } = useAgents();
  const createPattern = useCreatePatternCandidate();

  const loading = genLoading || ioValidateLoading || compileLoading;
  const selected = artifacts.find(a => a.id === selectedId) ?? null;
  const selectedPre = preRewriteArtifacts?.find(a => a.id === selectedId) ?? null;
  const showDiffToggle = !!selectedPre && changedIds.has(selectedId ?? "");

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

  function revertArtifact(id: string) {
    if (!preRewriteArtifacts) return;
    const original = preRewriteArtifacts.find(a => a.id === id);
    if (!original) return;
    updateContent(id, original.content);
    setChangedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function saveToLibrary(ids: string[]) {
    if (!preRewriteArtifacts) return;
    for (const id of ids) {
      if (savedToLibrary.has(id)) continue;
      const pre = preRewriteArtifacts.find(a => a.id === id);
      const post = artifacts.find(a => a.id === id);
      if (!pre || !post) continue;
      const diff = computeDiff(pre.content, post.content);
      const { originalSnippet, correctedSnippet } = extractFocusedSnippets(diff);
      await createPattern.mutateAsync({
        plc_brand: "SIEMENS_TIA",
        device_type: post.name,
        context: `Auto-review fix in ${post.name} (${post.type})`,
        original_snippet: originalSnippet,
        corrected_snippet: correctedSnippet,
        correction_type: "review_rewrite",
        explanation_tag: `Review fix — ${post.name}`,
      });
    }
    setSavedToLibrary(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
  }

  async function handleGenerateAll() {
    setStages(INITIAL_STAGES.map(s => ({ ...s, status: "pending" })));
    setIoValidationSummary(null);
    setCompileErrors([]);
    setPipelineError(null);
    setCurrentStepLabel(null);
    setPreRewriteArtifacts(null);
    setChangedIds(new Set());
    setViewMode("code");
    setChangesOpen(false);
    setSelectedForLibrary(new Set());
    setSavedToLibrary(new Set());

    try {
      // 1. Generate
      setStageStatus("Generate FBs", "running");
      setCurrentStepLabel("Generating device FBs…");
      const generated = await generateAll(session, profile, fbTemplates, patterns);
      setArtifacts(generated);
      onArtifactsUpdate(generated);
      if (generated.length > 0) setSelectedId(generated[0].id);
      setStageStatus("Generate FBs", "completed", `${generated.length} artifacts`);

      // 2. IO Validation
      const ioValidatorAgent = agents?.find(a => a.display_name === "IO Validator");
      const ioList = session.io_list as ForgeIoEntry[];
      const deviceList = session.device_list as ForgeDeviceEntry[];

      if (!ioValidatorAgent?.is_enabled) {
        setStageStatus("Validate IO", "skipped");
      } else if (!ioList?.length) {
        setStageStatus("Validate IO", "skipped");
      } else {
        setStageStatus("Validate IO", "running");
        setCurrentStepLabel("IO Validator checking signal mappings…");
        const ioResult = await validateIo(generated, ioList, deviceList, profile);
        if (ioResult.hasCritical || ioResult.hasWarning) {
          const count = ioResult.findings.filter(f => f.severity === "CRITICAL" || f.severity === "WARNING").length;
          setStageStatus("Validate IO", "completed", `${count} issues`);
          setIoValidationSummary(`IO Validation: ${count} issue(s) found — review before approving.`);
        } else {
          setStageStatus("Validate IO", "completed", "clean");
          setIoValidationSummary("IO Validation passed — all IO signals correctly mapped.");
        }
      }

      setStageStatus("Approve", "pending");
      setCurrentStepLabel(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPipelineError(msg);
      setCurrentStepLabel(null);
      setStages(prev => prev.map(s => s.status === "running" ? { ...s, status: "failed", detail: msg } : s));
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
      const result = await compileCheck(approved, tiaProjectPath, patterns);

      if (result.success) {
        setStageStatus("Upload", "completed");
        setStageStatus("Compile", "completed", "clean");
        setCompileErrors([]);
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
                      onClick={() => { setSelectedId(a.id); setViewMode("code"); }}
                      className={`group/row flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors ${selectedId === a.id ? "bg-primary/15 text-foreground" : "hover:bg-muted/40 text-muted-foreground"}`}
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
                      <div className="flex shrink-0 items-center gap-1">
                        {changedIds.has(a.id) && (
                          <Badge variant="outline" className="font-mono text-[9px] border-amber-500/50 text-amber-400">
                            edited
                          </Badge>
                        )}
                        {a.fb_template_id && (
                          <Badge variant="outline" className="font-mono text-[9px] border-green-600/40 text-green-500">
                            library
                          </Badge>
                        )}
                        {typeBadge(a.type)}
                        {langBadge(a.language)}
                        <button
                          onClick={e => { e.stopPropagation(); setExpandedId(a.id); }}
                          className="ml-1 hidden rounded p-0.5 hover:bg-muted/60 group-hover/row:flex"
                          title="Open full-screen editor"
                        >
                          <Maximize2 className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right panel — Monaco editor / diff */}
        <ResizablePanel defaultSize={65}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {selected ? selected.name : "Select an artifact"}
              </span>
              {showDiffToggle && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setViewMode(viewMode === "diff" ? "code" : "diff")}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] transition-colors",
                      viewMode === "diff"
                        ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                    )}
                  >
                    {viewMode === "diff"
                      ? <><Code2 className="h-3 w-3" /> Show Code</>
                      : <><GitCompareArrows className="h-3 w-3" /> Show Diff</>}
                  </button>
                  {viewMode === "diff" && (
                    <button
                      type="button"
                      onClick={() => { revertArtifact(selectedId!); setViewMode("code"); }}
                      className="flex items-center gap-1 rounded border border-destructive/30 px-2 py-0.5 font-mono text-[10px] text-destructive hover:bg-destructive/10 transition-colors"
                      title="Revert this artifact to the pre-review version"
                    >
                      <Undo2 className="h-3 w-3" /> Revert
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1">
              {viewMode === "diff" && selected && selectedPre ? (
                <DiffView original={selectedPre.content} modified={selected.content} />
              ) : (
                <ForgeCodeViewer
                  artifact={selected}
                  editable={editable}
                  onToggleEditable={() => setEditable(v => !v)}
                  onContentChange={content => { if (selected) updateContent(selected.id, content); }}
                />
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Bottom toolbar */}
      <div className="flex flex-col gap-2">
        {genLoading && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">{progress.currentDevice}</span>
              <span className="font-mono text-xs text-muted-foreground">{progress.current}/{progress.total}</span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>
        )}

        {currentStepLabel && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {currentStepLabel}
          </div>
        )}

        {compilePhaseLabel && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {compilePhaseLabel}
          </div>
        )}

        {/* Manual edit diff panel — shown when user edits and wants to save to pattern library */}
        {preRewriteArtifacts && changedIds.size > 0 && (
          <div className="rounded border border-amber-500/20 bg-amber-500/5 text-xs">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-amber-400 hover:bg-amber-500/10 transition-colors"
              onClick={() => setChangesOpen(v => !v)}
            >
              <span className="flex items-center gap-1.5">
                <GitCompareArrows className="h-3 w-3" />
                Review Changes — {changedIds.size} artifact{changedIds.size !== 1 ? "s" : ""} modified
              </span>
              {changesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>

            {changesOpen && (
              <div className="border-t border-amber-500/20 px-3 py-2 space-y-2">
                {/* Per-artifact rows */}
                {artifacts.filter(a => changedIds.has(a.id)).map(a => {
                  const pre = preRewriteArtifacts.find(p => p.id === a.id);
                  const isSaved = savedToLibrary.has(a.id);
                  return (
                    <div key={a.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-3 w-3 accent-amber-400"
                        checked={selectedForLibrary.has(a.id)}
                        onChange={e => setSelectedForLibrary(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(a.id) : next.delete(a.id);
                          return next;
                        })}
                      />
                      <span className="flex-1 font-mono text-amber-300/80">{a.name}</span>
                      {pre && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {pre.content.split("\n").length} → {a.content.split("\n").length} lines
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => { setSelectedId(a.id); setViewMode("diff"); }}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
                      >
                        <GitCompareArrows className="h-3 w-3" /> Diff
                      </button>
                      <button
                        type="button"
                        onClick={() => { revertArtifact(a.id); }}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono border border-border/50 text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                      >
                        <Undo2 className="h-3 w-3" /> Revert
                      </button>
                      {isSaved && (
                        <span className="font-mono text-[10px] text-green-400">saved</span>
                      )}
                    </div>
                  );
                })}

                {/* Save to library footer */}
                <div className="flex items-center gap-2 border-t border-amber-500/15 pt-2">
                  <button
                    type="button"
                    className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                      const all = new Set(changedIds);
                      setSelectedForLibrary(prev => prev.size === all.size ? new Set() : all);
                    }}
                  >
                    {selectedForLibrary.size === changedIds.size ? "Deselect all" : "Select all"}
                  </button>
                  <div className="flex-1" />
                  <button
                    type="button"
                    disabled={selectedForLibrary.size === 0 || createPattern.isPending}
                    onClick={() => void saveToLibrary([...selectedForLibrary])}
                    className="flex items-center gap-1.5 rounded border border-amber-500/30 px-2 py-1 font-mono text-[10px] text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                  >
                    {createPattern.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <BookMarked className="h-3 w-3" />}
                    Save {selectedForLibrary.size > 0 ? selectedForLibrary.size : ""} to Pattern Library
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {ioValidationSummary && (
          <div className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${ioValidationSummary.includes("passed") ? "border-green-600/30 bg-green-500/5 text-green-400" : "border-red-600/30 bg-red-500/5 text-red-400"}`}>
            {ioValidationSummary}
          </div>
        )}

        {/* Generation log */}
        {genLog.length > 0 && (
          <GenerationLog entries={genLog} />
        )}

        {(genError ?? pipelineError ?? compileErrors.length > 0) && (
          <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {genError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {genError}
              </div>
            )}
            {pipelineError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {pipelineError}
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
            {genLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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

      <ForgeArtifactDialog
        artifacts={artifacts}
        initialId={expandedId}
        open={expandedId !== null}
        onClose={() => setExpandedId(null)}
        onContentChange={updateContent}
        onToggleApprove={toggleApprove}
      />
    </div>
  );
}
