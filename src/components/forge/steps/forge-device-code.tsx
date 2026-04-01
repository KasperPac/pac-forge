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
import { useForgeReview } from "@/hooks/use-forge-review";
import { useForgeRewrite } from "@/hooks/use-forge-rewrite";
import { useForgeIoValidate } from "@/hooks/use-forge-io-validate";
import { useForgeCompileCheck, saveCompileFixPattern } from "@/hooks/use-forge-compile-check";
import { ReviewStepPanel } from "@/components/forge/forge-review-step-panel";
import { toTrackedFindings, derivedDbFindings } from "@/lib/forge-review-helpers";
import type { TrackedFinding, ReviewStepStatus } from "@/lib/forge-review-helpers";
import type { CompileFixProposal } from "@/hooks/use-forge-compile-check";
import { ForgeCompileReview } from "@/components/forge/forge-compile-review";
import { useCreatePatternCandidate } from "@/hooks/use-patterns";
import { useAgents } from "@/hooks/use-agents";
import { computeDiff, extractFocusedSnippets } from "@/lib/diff-engine";
import { cn } from "@/lib/utils";
import type { ForgeSession, ForgeArtifact, ForgeIoEntry, ForgeDeviceEntry } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate, AgentKnowledgeDoc } from "@/types";
import type { ReviewFinding } from "@/lib/forge-review-parser";

export interface ForgeDeviceCodeProps {
  session: ForgeSession;
  profile: DesignProfile;
  fbTemplates: FbTemplate[];
  patterns: PatternCandidate[];
  agentKnowledgeDocs?: AgentKnowledgeDoc[];
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onBeforeGenerate?: () => Promise<FbTemplate[]>;
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
  { label: "Generate", status: "pending" },
  { label: "Standards", status: "pending" },
  { label: "IO Check", status: "pending" },
  { label: "Safety", status: "pending" },
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
  // Review step state — Standards, IO, Safety
  const [standardsStatus, setStandardsStatus] = useState<ReviewStepStatus>("idle");
  const [standardsFindings, setStandardsFindings] = useState<TrackedFinding[]>([]);
  const [standardsRound, setStandardsRound] = useState(0);
  const [standardsError, setStandardsError] = useState<string | null>(null);

  const [ioStatus, setIoStatus] = useState<ReviewStepStatus>("idle");
  const [ioTrackedFindings, setIoTrackedFindings] = useState<TrackedFinding[]>([]);
  const [ioRound, setIoRound] = useState(0);
  const [ioError, setIoError] = useState<string | null>(null);

  // Legacy IO state (used by handleGenerateAll reset)
  const [, setIoValidationSummary] = useState<string | null>(null);
  const [, setIoFindings] = useState<ReviewFinding[]>([]);
  const [, setIoFindingsOpen] = useState(false);
  const [compileErrors, setCompileErrors] = useState<string[]>([]);
  const [, setCompileWarnings] = useState<string[]>([]);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [currentStepLabel, setCurrentStepLabel] = useState<string | null>(null);

  // Compile review state (two-phase flow)
  const [showCompileReview, setShowCompileReview] = useState(false);
  const [compileProposals, setCompileProposals] = useState<CompileFixProposal[]>([]);
  const [proposingFixes, setProposingFixes] = useState(false);
  const [recompileSuccess, setRecompileSuccess] = useState<boolean | null>(null);
  const [recompileErrors, setRecompileErrors] = useState<string[]>([]);
  const [savingToLibrary, setSavingToLibrary] = useState(false);

  // Manual diff state (user-triggered, not auto-review)
  const [preRewriteArtifacts, setPreRewriteArtifacts] = useState<ForgeArtifact[] | null>(null);
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"code" | "diff">("code");
  const [changesOpen, setChangesOpen] = useState(false);
  const [selectedForLibrary, setSelectedForLibrary] = useState<Set<string>>(new Set());
  const [savedToLibrary, setSavedToLibrary] = useState<Set<string>>(new Set());

  const { generateCallCode, loading: genLoading, progress, error: genError, log: genLog } = useForgeDeviceGenerate();
  const { review: runStandardsReview, loading: reviewLoading } = useForgeReview();
  const { rewrite: runRewrite, loading: rewriteLoading } = useForgeRewrite();
  const { validateIo, loading: ioValidateLoading } = useForgeIoValidate();
  const {
    uploadAndCompile,
    proposeFixes,
    applyFixesAndRecompile,
    loading: compileLoading,
    progress: compileProgress,
  } = useForgeCompileCheck();
  const { data: agents } = useAgents();
  const createPattern = useCreatePatternCandidate();

  const loading = genLoading || reviewLoading || rewriteLoading || ioValidateLoading || compileLoading;
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

  // ---- Generation (step 1 only — review steps are user-driven) ----

  async function handleGenerateAll() {
    setStages(INITIAL_STAGES.map(s => ({ ...s, status: "pending" })));
    setIoValidationSummary(null);
    setIoFindings([]);
    setIoFindingsOpen(false);
    setCompileErrors([]);
    setPipelineError(null);
    setCurrentStepLabel(null);
    setPreRewriteArtifacts(null);
    setChangedIds(new Set());
    setViewMode("code");
    setChangesOpen(false);
    setSelectedForLibrary(new Set());
    setSavedToLibrary(new Set());
    // Reset review states
    setStandardsStatus("idle");
    setStandardsFindings([]);
    setStandardsRound(0);
    setStandardsError(null);
    setIoStatus("idle");
    setIoTrackedFindings([]);
    setIoRound(0);
    setIoError(null);

    try {
      setStageStatus("Generate", "running");
      setCurrentStepLabel("Validating FB artifacts…");
      const existingFbArtifacts = (session.device_artifacts as ForgeArtifact[])?.filter(a => a.stage === "device_fb") ?? [];

      // Pre-generation validation: check each FB artifact actually contains an FB definition
      const missingFbs: string[] = [];
      for (const art of existingFbArtifacts) {
        if (art.type === "FB") {
          const hasFbDef = /FUNCTION_BLOCK\s+["']?\w+["']?/i.test(art.content);
          if (!hasFbDef) {
            missingFbs.push(`${art.name} — artifact is type FB but content has no FUNCTION_BLOCK definition (may contain only a UDT)`);
          }
        }
      }
      if (missingFbs.length > 0) {
        throw new Error(
          `Cannot generate call code — ${missingFbs.length} FB artifact(s) are incomplete:\n\n` +
          missingFbs.map(m => `• ${m}`).join("\n") +
          "\n\nGo back to the Device FBs step and regenerate the missing FBs."
        );
      }

      setCurrentStepLabel("Generating call code…");
      const generated = await generateCallCode(session, profile, existingFbArtifacts, patterns);
      setArtifacts(generated);
      onArtifactsUpdate(generated);
      if (generated.length > 0) setSelectedId(generated[0].id);
      setStageStatus("Generate", "completed", `${generated.length} artifacts`);

      // Auto-start standards review if agent is enabled (default to enabled if agents not loaded)
      const standardsAgent = agents?.find(a => a.display_name === "PLC Standards Enforcer");
      const standardsEnabled = standardsAgent ? standardsAgent.is_enabled : true;
      if (standardsEnabled) {
        setStandardsStatus("idle");
        setStageStatus("Standards", "pending");
      } else {
        setStandardsStatus("skipped");
        setStageStatus("Standards", "skipped");
      }

      setCurrentStepLabel(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPipelineError(msg);
      setCurrentStepLabel(null);
      setStages(prev => prev.map(s => s.status === "running" ? { ...s, status: "failed", detail: msg } : s));
    }
  }

  // ---- Standards Review step ----

  async function handleStandardsRun() {
    setStandardsStatus("reviewing");
    setStandardsError(null);
    setStageStatus("Standards", "running");
    try {
      const result = await runStandardsReview(artifacts, "fc_ob", profile);
      // Auto-generate derived DB findings for cross-artifact consistency (BUG-11)
      const artifactNames = artifacts.map(a => a.name);
      const derived = derivedDbFindings(result.findings, artifactNames);
      const allFindings = [...result.findings, ...derived];

      const round = standardsRound + 1;
      setStandardsRound(round);
      const tracked = toTrackedFindings(allFindings, round, round > 1 ? standardsFindings : undefined);
      setStandardsFindings(tracked);
      if (tracked.length === 0) {
        setStandardsStatus("clean");
        setStageStatus("Standards", "completed", "clean");
      } else {
        setStandardsStatus("findings");
        const issues = tracked.filter(f => f.severity === "CRITICAL" || f.severity === "WARNING").length;
        setStageStatus("Standards", "completed", `${issues} issues`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStandardsError(msg);
      setStandardsStatus("findings");
      setStageStatus("Standards", "failed", msg.slice(0, 40));
    }
  }

  async function handleStandardsFix() {
    const selected = standardsFindings.filter(f => f.selected);
    if (selected.length === 0) return;
    setStandardsStatus("rewriting");
    setStageStatus("Standards", "running");
    setPreRewriteArtifacts(artifacts);

    try {
      let currentArtifacts = [...artifacts];

      // Fix one finding at a time — focused, reliable rewrites
      for (let i = 0; i < selected.length; i++) {
        const finding = selected[i];
        setCurrentStepLabel(`Fixing ${i + 1}/${selected.length}: ${finding.artifactName}…`);

        // For DB schema findings (including auto-derived), send ALL artifacts
        // so the rewriter can see both the FC that references the field and
        // the DB that needs the field added (BUG-11 cross-artifact fix).
        const isDbSchemaFinding = finding.message.includes("AUTO-DERIVED") ||
          finding.artifactName.startsWith("DB_") ||
          finding.message.toLowerCase().includes("db schema") ||
          finding.message.toLowerCase().includes("undeclared variable");
        const affected = isDbSchemaFinding
          ? currentArtifacts // Send all artifacts for cross-artifact consistency
          : currentArtifacts.filter(a => a.name === finding.artifactName);
        if (affected.length === 0) continue;
        const rewritten = await runRewrite(affected, [finding], profile);

        // Merge changes back
        for (const rw of rewritten) {
          const idx = currentArtifacts.findIndex(a => a.id === rw.id);
          if (idx >= 0 && currentArtifacts[idx].content !== rw.content) {
            currentArtifacts[idx] = rw;
            setChangedIds(prev => new Set([...prev, rw.id]));
          }
        }
      }

      setArtifacts(currentArtifacts);
      onArtifactsUpdate(currentArtifacts);
      setCurrentStepLabel("Re-reviewing…");

      // Re-review automatically
      setStandardsStatus("re-reviewing");
      const result = await runStandardsReview(currentArtifacts, "fc_ob", profile);
      // Auto-generate derived DB findings for re-review too (BUG-11)
      const reReviewArtifactNames = currentArtifacts.map(a => a.name);
      const reReviewDerived = derivedDbFindings(result.findings, reReviewArtifactNames);
      const reReviewAllFindings = [...result.findings, ...reReviewDerived];
      const round = standardsRound + 1;
      setStandardsRound(round);
      const tracked = toTrackedFindings(reReviewAllFindings, round, standardsFindings);
      setStandardsFindings(tracked);
      if (tracked.length === 0) {
        setStandardsStatus("clean");
        setStageStatus("Standards", "completed", "clean");
      } else {
        const unresolvedCount = tracked.filter(f => f.unresolved).length;
        const issues = tracked.filter(f => f.severity === "CRITICAL" || f.severity === "WARNING").length;
        setStandardsStatus("findings");
        setStageStatus("Standards", "completed", `${issues} issues${unresolvedCount > 0 ? ` (${unresolvedCount} unresolved)` : ""}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStandardsError(msg);
      setStandardsStatus("findings");
      setStageStatus("Standards", "failed", msg.slice(0, 40));
    } finally {
      setCurrentStepLabel(null);
    }
  }

  function handleStandardsAccept() {
    setStandardsStatus("accepted");
    setStageStatus("Standards", "completed", "accepted");
    // Enable IO validation step
    const ioAgent = agents?.find(a => a.display_name === "IO Validator");
    if (ioAgent?.is_enabled) {
      setIoStatus("idle");
      setStageStatus("IO Check", "pending");
    } else {
      setIoStatus("skipped");
      setStageStatus("IO Check", "skipped");
      setStageStatus("Approve", "pending");
    }
  }

  function handleStandardsSkip() {
    setStandardsStatus("skipped");
    setStageStatus("Standards", "skipped");
    handleStandardsAccept();
  }

  // ---- IO Validation step ----

  async function handleIoRun() {
    setIoStatus("reviewing");
    setIoError(null);
    setStageStatus("IO Check", "running");
    try {
      const ioList = session.io_list as ForgeIoEntry[];
      const deviceList = session.device_list as ForgeDeviceEntry[];
      const result = await validateIo(artifacts, ioList, deviceList, profile);
      const round = ioRound + 1;
      setIoRound(round);
      const tracked = toTrackedFindings(result.findings, round, round > 1 ? ioTrackedFindings : undefined);
      setIoTrackedFindings(tracked);

      // Also update legacy display
      setIoFindings(result.findings);
      if (tracked.length === 0) {
        setIoStatus("clean");
        setStageStatus("IO Check", "completed", "clean");
        setIoValidationSummary("IO Validation passed.");
      } else {
        setIoStatus("findings");
        const issues = tracked.filter(f => f.severity === "CRITICAL" || f.severity === "WARNING").length;
        setStageStatus("IO Check", "completed", `${issues} issues`);
        setIoValidationSummary(`IO Validation: ${issues} issue(s) found.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setIoError(msg);
      setIoStatus("findings");
      setStageStatus("IO Check", "failed", msg.slice(0, 40));
    }
  }

  async function handleIoFix() {
    const selected = ioTrackedFindings.filter(f => f.selected);
    if (selected.length === 0) return;
    setIoStatus("rewriting");
    setStageStatus("IO Check", "running");
    setPreRewriteArtifacts(artifacts);

    try {
      let currentArtifacts = [...artifacts];

      for (let i = 0; i < selected.length; i++) {
        const finding = selected[i];
        setCurrentStepLabel(`Fixing IO ${i + 1}/${selected.length}: ${finding.artifactName}…`);

        const affected = currentArtifacts.filter(a => a.name === finding.artifactName);
        if (affected.length === 0) continue;
        const rewritten = await runRewrite(affected, [finding], profile);

        for (const rw of rewritten) {
          const idx = currentArtifacts.findIndex(a => a.id === rw.id);
          if (idx >= 0 && currentArtifacts[idx].content !== rw.content) {
            currentArtifacts[idx] = rw;
            setChangedIds(prev => new Set([...prev, rw.id]));
          }
        }
      }

      setArtifacts(currentArtifacts);
      onArtifactsUpdate(currentArtifacts);
      setCurrentStepLabel("Re-validating IO…");

      // Re-validate
      setIoStatus("re-reviewing");
      const ioList = session.io_list as ForgeIoEntry[];
      const deviceList = session.device_list as ForgeDeviceEntry[];
      const result = await validateIo(currentArtifacts, ioList, deviceList, profile);
      const round = ioRound + 1;
      setIoRound(round);
      const tracked = toTrackedFindings(result.findings, round, ioTrackedFindings);
      setIoTrackedFindings(tracked);
      setIoFindings(result.findings);

      if (tracked.length === 0) {
        setIoStatus("clean");
        setStageStatus("IO Check", "completed", "clean");
      } else {
        const unresolvedCount = tracked.filter(f => f.unresolved).length;
        const issues = tracked.filter(f => f.severity === "CRITICAL" || f.severity === "WARNING").length;
        setIoStatus("findings");
        setStageStatus("IO Check", "completed", `${issues} issues${unresolvedCount > 0 ? ` (${unresolvedCount} unresolved)` : ""}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setIoError(msg);
      setIoStatus("findings");
      setStageStatus("IO Check", "failed", msg.slice(0, 40));
    } finally {
      setCurrentStepLabel(null);
    }
  }

  function handleIoAccept() {
    setIoStatus("accepted");
    setStageStatus("IO Check", "completed", "accepted");
    // Safety audit step — not yet implemented as an AI agent
    setStageStatus("Safety", "skipped");
    setStageStatus("Approve", "pending");
  }

  function handleIoSkip() {
    setIoStatus("skipped");
    setStageStatus("IO Check", "skipped");
    handleIoAccept();
  }

  async function handleUploadAndCompile() {
    const approved = artifacts.filter(a => a.approved);
    if (approved.length === 0) return;

    const tiaProjectPath = session.tia_project_path;
    if (!tiaProjectPath) {
      setCompileErrors(["No TIA project path set — configure it in the TIA Export step first."]);
      return;
    }

    // Resolve library_block at upload time using template source
    const libraryTemplateIds = new Set(
      fbTemplates.filter(t => t.source === "library").map(t => t.id),
    );
    const resolvedArtifacts = approved.map(a => {
      if (a.library_block) return a;
      if (a.type === "DB") return a; // Instance DBs always need importing
      if (a.fb_template_id && libraryTemplateIds.has(a.fb_template_id)) {
        return { ...a, library_block: true };
      }
      return a;
    });

    // Reset compile review state
    setShowCompileReview(false);
    setCompileProposals([]);
    setRecompileSuccess(null);
    setRecompileErrors([]);

    setStageStatus("Approve", "completed", `${approved.length} approved`);
    setStageStatus("Upload", "running");

    try {
      // Phase 0: Copy library blocks from global library into project
      const libraryArtifacts = resolvedArtifacts.filter(a => a.library_block);
      console.log(`[forge] Phase 0: ${libraryArtifacts.length} library artifact(s) to copy:`, libraryArtifacts.map(a => a.name));
      if (libraryArtifacts.length > 0) {
        const dropboxRoot = localStorage.getItem("pac-forge-dropbox-root") ?? "";
        if (!dropboxRoot) {
          const errMsg = `Library blocks found (${libraryArtifacts.map(a => a.name).join(", ")}) but Dropbox root path is not set. Go to your Profile page and set the Dropbox root path, or these blocks will be imported as SCL instead of copied from the TIA library.`;
          console.error(`[forge] ${errMsg}`);
          setCompileWarnings(prev => [...prev, errMsg]);
        } else {
          console.log(`[forge] Copying library blocks from: ${dropboxRoot}`);
          const { copyLibraryBlocksToProject } = await import("@/lib/forge-library-copy");
          const libResult = await copyLibraryBlocksToProject(dropboxRoot, libraryArtifacts, fbTemplates);
          console.log(`[forge] Library copy result:`, libResult);
          if (libResult.warnings.length > 0) {
            setCompileWarnings(prev => [...prev, ...libResult.warnings]);
          }
        }
      } else {
        // Check if there SHOULD be library artifacts — templates with source="library" exist but no artifacts tagged
        const libraryTemplateCount = fbTemplates.filter(t => t.source === "library").length;
        if (libraryTemplateCount > 0) {
          const untagged = resolvedArtifacts.filter(a =>
            a.type !== "DB" && a.fb_template_id && libraryTemplateIds.has(a.fb_template_id) && !a.library_block
          );
          if (untagged.length > 0) {
            console.warn(`[forge] WARNING: ${untagged.length} artifact(s) matched library templates but are NOT tagged as library_block:`, untagged.map(a => `${a.name} (template: ${a.fb_template_id})`));
          }
        }
      }

      // Phase 1: Upload & compile (no auto-fix)
      const result = await uploadAndCompile(resolvedArtifacts, tiaProjectPath);

      if (result.success) {
        setStageStatus("Upload", "completed");
        setStageStatus("Compile", "completed", "clean");
        setCompileErrors([]);
        setCompileWarnings(result.warnings);
      } else {
        setStageStatus("Upload", "completed");
        setStageStatus("Compile", "failed", `${result.errors.length} errors`);
        setCompileErrors(result.errors);
        setCompileWarnings(result.warnings);

        // Show review panel and propose fixes
        setShowCompileReview(true);
        setProposingFixes(true);
        const proposals = await proposeFixes(approved, result.errors, patterns);
        setCompileProposals(proposals);
        setProposingFixes(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStageStatus("Compile", "failed", msg);
      setCompileErrors([msg]);
    }
  }

  function handleUpdateProposal(artifactId: string, code: string) {
    setCompileProposals(prev =>
      prev.map(p => p.artifactId === artifactId ? { ...p, proposedCode: code } : p)
    );
  }

  function handleToggleAccepted(artifactId: string) {
    setCompileProposals(prev =>
      prev.map(p => p.artifactId === artifactId ? { ...p, accepted: !p.accepted } : p)
    );
  }

  async function handleApplyAndRecompile() {
    const tiaProjectPath = session.tia_project_path;
    if (!tiaProjectPath) return;

    const approved = artifacts.filter(a => a.approved);
    setRecompileSuccess(null);
    setRecompileErrors([]);

    const result = await applyFixesAndRecompile(approved, compileProposals, tiaProjectPath);

    if (result.success) {
      setRecompileSuccess(true);
      setRecompileErrors([]);
      setStageStatus("Compile", "completed", "clean (after fix)");
      setCompileErrors([]);
      // Update artifacts with fixed code
      const updatedArtifacts = artifacts.map(orig => {
        const fixed = result.artifacts.find(a => a.id === orig.id);
        return fixed ?? orig;
      });
      setArtifacts(updatedArtifacts);
      onArtifactsUpdate(updatedArtifacts);
    } else {
      setRecompileSuccess(false);
      setRecompileErrors(result.compileErrors);
      setStageStatus("Compile", "failed", `${result.compileErrors.length} errors after fix`);
    }
  }

  async function handleSaveFixesToLibrary(artifactIds: string[]) {
    setSavingToLibrary(true);
    try {
      for (const id of artifactIds) {
        const proposal = compileProposals.find(p => p.artifactId === id);
        if (!proposal || proposal.proposedCode === proposal.originalCode) continue;
        await saveCompileFixPattern(proposal.artifactName, proposal.originalCode, proposal.proposedCode);
      }
    } finally {
      setSavingToLibrary(false);
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
                        onChange={e => {
                          setSelectedForLibrary(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) { next.add(a.id); } else { next.delete(a.id); }
                            return next;
                          });
                        }}
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

        {/* Review pipeline — Standards → IO → Safety */}
        {artifacts.length > 0 && (
          <div className="space-y-2">
            <ReviewStepPanel
              title="Standards Review"
              accentColor="blue"
              status={standardsStatus}
              findings={standardsFindings}
              loading={reviewLoading || rewriteLoading}
              error={standardsError}
              onRunReview={handleStandardsRun}
              onToggleFinding={(id) => setStandardsFindings(prev => prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f))}
              onSelectAll={(selected) => setStandardsFindings(prev => prev.map(f => ({ ...f, selected })))}
              onFixSelected={handleStandardsFix}
              onAccept={handleStandardsAccept}
              onSkip={handleStandardsSkip}
              enabled={agents?.find(a => a.display_name === "PLC Standards Enforcer")?.is_enabled ?? true}
            />

            <ReviewStepPanel
              title="IO Validation"
              accentColor="amber"
              status={ioStatus}
              findings={ioTrackedFindings}
              loading={ioValidateLoading || rewriteLoading}
              error={ioError}
              onRunReview={handleIoRun}
              onToggleFinding={(id) => setIoTrackedFindings(prev => prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f))}
              onSelectAll={(selected) => setIoTrackedFindings(prev => prev.map(f => ({ ...f, selected })))}
              onFixSelected={handleIoFix}
              onAccept={handleIoAccept}
              onSkip={handleIoSkip}
              enabled={(agents?.find(a => a.display_name === "IO Validator")?.is_enabled ?? true) && (standardsStatus === "accepted" || standardsStatus === "skipped" || standardsStatus === "clean")}
            />

            <ReviewStepPanel
              title="Safety Audit"
              accentColor="red"
              status={"skipped"}
              findings={[]}
              loading={false}
              error={null}
              onRunReview={() => {}}
              onToggleFinding={() => {}}
              onSelectAll={() => {}}
              onFixSelected={() => {}}
              onAccept={() => { setStageStatus("Safety", "skipped"); setStageStatus("Approve", "pending"); }}
              onSkip={() => { setStageStatus("Safety", "skipped"); setStageStatus("Approve", "pending"); }}
              enabled={false}
            />
          </div>
        )}

        {/* Generation log */}
        {genLog.length > 0 && (
          <GenerationLog entries={genLog} />
        )}

        {(genError ?? pipelineError) && (
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
          </div>
        )}

        {/* Compile error review panel (two-phase flow) */}
        {showCompileReview && compileErrors.length > 0 && (
          <ForgeCompileReview
            compileErrors={compileErrors}
            proposals={compileProposals}
            proposing={proposingFixes}
            recompiling={compileLoading}
            recompileSuccess={recompileSuccess}
            recompileErrors={recompileErrors}
            onUpdateProposal={handleUpdateProposal}
            onToggleAccepted={handleToggleAccepted}
            onApplyAndRecompile={() => void handleApplyAndRecompile()}
            onSaveToLibrary={(ids) => void handleSaveFixesToLibrary(ids)}
            onDismiss={() => setShowCompileReview(false)}
            savingToLibrary={savingToLibrary}
          />
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
