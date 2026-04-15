import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Maximize2,
  GitCompareArrows,
  Undo2,
  BookMarked,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { ForgeCodeViewer } from "@/components/forge/forge-code-viewer";
import { ForgeArtifactDialog } from "@/components/forge/forge-artifact-dialog";
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
import { ReviewStepPanel } from "@/components/forge/forge-review-step-panel";
import { toTrackedFindings, derivedDbFindings } from "@/lib/forge-review-helpers";
import type { TrackedFinding, ReviewStepStatus } from "@/lib/forge-review-helpers";
import { useForgeProcessGenerate } from "@/hooks/use-forge-process-generate";
import { useForgeReview } from "@/hooks/use-forge-review";
import { useForgeRewrite } from "@/hooks/use-forge-rewrite";
import { useForgeIoValidate } from "@/hooks/use-forge-io-validate";
import { useForgeCompileCheck } from "@/hooks/use-forge-compile-check";
import { useLogicValidator } from "@/hooks/use-logic-validator";
import type { LogicFinding } from "@/hooks/use-logic-validator";
import { useCreatePatternCandidate } from "@/hooks/use-patterns";
import { useAgents } from "@/hooks/use-agents";
import { computeDiff, extractFocusedSnippets } from "@/lib/diff-engine";
import type { ForgeSession, ForgeArtifact, SpecAnalysis, SpecAnalysisProcessSequence } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { PatternCandidate, AgentKnowledgeDoc } from "@/types";

export interface ForgeProcessCodeProps {
  session: ForgeSession;
  profile: DesignProfile;
  patterns: PatternCandidate[];
  agentKnowledgeDocs?: AgentKnowledgeDoc[];
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onComplete: () => void;
}

/** Categories the rewriter can safely auto-fix (localized, deterministic). */
const FIXABLE_LOGIC_CATEGORIES = new Set([
  "type_mismatch",
  "signal_polarity",
  "missing_initial_state",
  "timer_abuse",
  "sequence_reset",
  "retentive_coil_confusion",
]);

const INITIAL_STAGES: SubPipelineStage[] = [
  { label: "Generate", status: "pending" },
  { label: "Standards", status: "pending" },
  { label: "IO Check", status: "pending" },
  { label: "Logic Check", status: "pending" },
  { label: "Approve", status: "pending" },
  { label: "Upload", status: "pending" },
  { label: "Compile", status: "pending" },
];

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stages, setStages] = useState<SubPipelineStage[]>(INITIAL_STAGES);
  const [compileErrors, setCompileErrors] = useState<string[]>([]);

  // Standards Review state (user-driven)
  const [standardsStatus, setStandardsStatus] = useState<ReviewStepStatus>("idle");
  const [standardsFindings, setStandardsFindings] = useState<TrackedFinding[]>([]);
  const [standardsRound, setStandardsRound] = useState(0);
  const [standardsError, setStandardsError] = useState<string | null>(null);
  const [currentStepLabel, setCurrentStepLabel] = useState<string | null>(null);

  // IO Validation state (user-driven)
  const [ioStatus, setIoStatus] = useState<ReviewStepStatus>("idle");
  const [ioFindings, setIoFindings] = useState<TrackedFinding[]>([]);
  const [ioRound, setIoRound] = useState(0);
  const [ioError, setIoError] = useState<string | null>(null);

  // Pre-rewrite tracking for diff / pattern library
  const [preRewriteArtifacts, setPreRewriteArtifacts] = useState<ForgeArtifact[] | null>(null);
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const [changesOpen, setChangesOpen] = useState(false);
  const [selectedForLibrary, setSelectedForLibrary] = useState<Set<string>>(new Set());
  const [savedToLibrary, setSavedToLibrary] = useState<Set<string>>(new Set());

  // Logic Validator state
  const [logicStatus, setLogicStatus] = useState<ReviewStepStatus>("idle");
  const [logicTrackedFindings, setLogicTrackedFindings] = useState<TrackedFinding[]>([]);
  const [logicRawFindings, setLogicRawFindings] = useState<LogicFinding[]>([]);
  const [logicRound, setLogicRound] = useState(0);
  const [logicError, setLogicError] = useState<string | null>(null);

  const { generateAll, loading: genLoading, progress, error: genError } = useForgeProcessGenerate();
  const { review: runStandardsReview, loading: reviewLoading } = useForgeReview();
  const { rewrite: runRewrite, loading: rewriteLoading } = useForgeRewrite();
  const { validateIo, loading: ioValidateLoading } = useForgeIoValidate();
  const { validate: logicValidate, loading: logicLoading } = useLogicValidator();
  const { compileCheck, loading: compileLoading, progress: compileProgress } = useForgeCompileCheck();
  const { data: agents } = useAgents();
  const createPattern = useCreatePatternCandidate();

  const loading = genLoading || reviewLoading || rewriteLoading || ioValidateLoading || logicLoading || compileLoading;

  const specAnalysis = session.spec_analysis as SpecAnalysis | null;
  const sequences = specAnalysis?.process_sequences ?? [];

  const selected = artifacts.find(a => a.id === selectedId) ?? null;
  const selectedSequence: SpecAnalysisProcessSequence | undefined = sequences.find(
    seq => selected && selected.name.includes(seq.name.slice(0, 20)),
  );

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
    const original = preRewriteArtifacts?.find(a => a.id === id);
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
        context: `Review fix in ${post.name} (${post.type}) — process code`,
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
    setCompileErrors([]);
    setLogicStatus("idle");
    setLogicTrackedFindings([]);
    setLogicRawFindings([]);
    setLogicRound(0);
    setLogicError(null);
    setPreRewriteArtifacts(null);
    setChangedIds(new Set());
    setChangesOpen(false);
    setSelectedForLibrary(new Set());
    setSavedToLibrary(new Set());
    // Reset review state
    setStandardsStatus("idle");
    setStandardsFindings([]);
    setStandardsRound(0);
    setStandardsError(null);
    setIoStatus("idle");
    setIoFindings([]);
    setIoRound(0);
    setIoError(null);

    try {
      // 1. Generate
      setStageStatus("Generate", "running");
      const generated = await generateAll(session, profile, patterns);
      setArtifacts(generated);
      onArtifactsUpdate(generated);
      if (generated.length > 0) setSelectedId(generated[0].id);
      setStageStatus("Generate", "completed", `${generated.length} artifacts`);

      // Auto-start standards review if the agent is enabled
      const sclArtifacts = generated.filter(a => a.language === "SCL" && !a.deterministic);
      const reviewAgent = agents?.find(a => a.display_name === "PLC Standards Enforcer");
      if (sclArtifacts.length > 0 && (reviewAgent?.is_enabled ?? true)) {
        setStandardsStatus("idle");
        setStageStatus("Standards", "pending");
      } else {
        setStandardsStatus("skipped");
        setStageStatus("Standards", "skipped");
        setStageStatus("Logic Check", "pending");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const runningStage = stages.find(s => s.status === "running");
      if (runningStage) setStageStatus(runningStage.label, "failed", msg);
    }
  }

  // ---- Standards Review step ----

  async function handleStandardsRun() {
    setStandardsStatus("reviewing");
    setStandardsError(null);
    setStageStatus("Standards", "running");
    try {
      const result = await runStandardsReview(artifacts, "process", profile);
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
    const selectedFindings = standardsFindings.filter(f => f.selected);
    if (selectedFindings.length === 0) return;
    setStandardsStatus("rewriting");
    setStageStatus("Standards", "running");
    setPreRewriteArtifacts(artifacts);

    try {
      let currentArtifacts = [...artifacts];

      for (let i = 0; i < selectedFindings.length; i++) {
        const finding = selectedFindings[i];
        setCurrentStepLabel(`Fixing ${i + 1}/${selectedFindings.length}: ${finding.artifactName}...`);

        const isDbSchemaFinding = finding.message.includes("AUTO-DERIVED") ||
          finding.artifactName.startsWith("DB_") ||
          finding.message.toLowerCase().includes("db schema") ||
          finding.message.toLowerCase().includes("undeclared variable");
        const affected = isDbSchemaFinding
          ? currentArtifacts
          : currentArtifacts.filter(a => a.name === finding.artifactName);
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
      setCurrentStepLabel("Re-reviewing...");

      // Re-review automatically after fix
      setStandardsStatus("re-reviewing");
      const result = await runStandardsReview(currentArtifacts, "process", profile);
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
    const ioAgent = agents?.find(a => a.display_name === "IO Validator");
    if (ioAgent?.is_enabled && session.io_list?.length) {
      setIoStatus("idle");
      setStageStatus("IO Check", "pending");
    } else {
      setIoStatus("skipped");
      setStageStatus("IO Check", "skipped");
      setStageStatus("Logic Check", "pending");
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
      const result = await validateIo(
        artifacts,
        session.io_list ?? [],
        session.device_list ?? [],
        profile,
      );
      const round = ioRound + 1;
      setIoRound(round);
      const tracked = toTrackedFindings(result.findings, round, round > 1 ? ioFindings : undefined);
      setIoFindings(tracked);
      if (tracked.length === 0) {
        setIoStatus("clean");
        setStageStatus("IO Check", "completed", "clean");
      } else {
        setIoStatus("findings");
        const issues = tracked.filter(f => f.severity === "CRITICAL" || f.severity === "WARNING").length;
        setStageStatus("IO Check", "completed", `${issues} issues`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setIoError(msg);
      setIoStatus("findings");
      setStageStatus("IO Check", "failed", msg.slice(0, 40));
    }
  }

  async function handleIoFix() {
    const selectedFindings = ioFindings.filter(f => f.selected);
    if (selectedFindings.length === 0) return;
    setIoStatus("rewriting");
    setStageStatus("IO Check", "running");
    if (!preRewriteArtifacts) setPreRewriteArtifacts(artifacts);

    try {
      let currentArtifacts = [...artifacts];

      for (let i = 0; i < selectedFindings.length; i++) {
        const finding = selectedFindings[i];
        setCurrentStepLabel(`IO fix ${i + 1}/${selectedFindings.length}: ${finding.artifactName}...`);
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
      setCurrentStepLabel("Re-checking IO...");

      setIoStatus("re-reviewing");
      const result = await validateIo(currentArtifacts, session.io_list ?? [], session.device_list ?? [], profile);
      const round = ioRound + 1;
      setIoRound(round);
      const tracked = toTrackedFindings(result.findings, round, ioFindings);
      setIoFindings(tracked);
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
    setStageStatus("Logic Check", "pending");
  }

  function handleIoSkip() {
    setIoStatus("skipped");
    setStageStatus("IO Check", "skipped");
    setStageStatus("Logic Check", "pending");
  }

  // ---- Logic Validator (user-triggered, ReviewStepPanel) ----

  async function handleLogicRun() {
    setLogicStatus("reviewing");
    setLogicError(null);
    setStageStatus("Logic Check", "running");
    try {
      const findings = await logicValidate(
        session.device_artifacts ?? [],
        artifacts,
      );
      const round = logicRound + 1;
      setLogicRound(round);
      setLogicRawFindings(findings);
      // Convert LogicFinding[] → TrackedFinding[] for ReviewStepPanel
      const tracked: TrackedFinding[] = findings.map((f, i) => ({
        severity: f.severity as "CRITICAL" | "WARNING" | "INFO",
        artifactName: `${f.category.replace(/_/g, " ")} · ${f.code_reference || f.affected_blocks.join(", ") || "cross-block"}`,
        message: `${f.title}${f.description ? ` — ${f.description}` : ""}${f.suggested_fix ? `\nFix: ${f.suggested_fix}` : ""}${f.found_by ? ` [${f.found_by === "both" ? "Claude + Gemini" : f.found_by === "claude" ? "Claude" : "Gemini"}${f.validated_by === "both" ? ", peer-validated" : ""}]` : ""}${f.confidence !== "HIGH" ? ` [${f.confidence} confidence]` : ""}${f.scan_cycle_sensitive ? " [scan-sensitive]" : ""}`,
        id: `logic-r${round}-${i}`,
        selected: FIXABLE_LOGIC_CATEGORIES.has(f.category),
        unresolved: false,
        round,
      }));
      setLogicTrackedFindings(tracked);
      if (tracked.length === 0) {
        setLogicStatus("clean");
        setStageStatus("Logic Check", "completed", "clean");
      } else {
        setLogicStatus("findings");
        const issues = tracked.filter(f => f.severity === "CRITICAL" || f.severity === "WARNING").length;
        setStageStatus("Logic Check", "completed", `${issues} issues`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogicError(msg);
      setLogicStatus("findings");
      setStageStatus("Logic Check", "failed", msg.slice(0, 40));
    }
  }

  async function handleLogicFix() {
    const selectedFindings = logicTrackedFindings.filter(f => f.selected);
    if (selectedFindings.length === 0) return;
    setLogicStatus("rewriting");
    setStageStatus("Logic Check", "running");
    if (!preRewriteArtifacts) setPreRewriteArtifacts(artifacts);

    try {
      let currentArtifacts = [...artifacts];
      const allArtifacts = [...(session.device_artifacts ?? []), ...currentArtifacts];

      for (let i = 0; i < selectedFindings.length; i++) {
        const finding = selectedFindings[i];
        setCurrentStepLabel(`Logic fix ${i + 1}/${selectedFindings.length}...`);

        // Find the matching raw finding to get affected_blocks
        const idxStr = finding.id.replace(/^logic-r\d+-/, "");
        const rawIdx = parseInt(idxStr, 10);
        const rawFinding = logicRawFindings[rawIdx];
        const affectedNames = rawFinding?.affected_blocks ?? [];

        // Collect all affected artifacts (from both device and process)
        const affected = affectedNames.length > 0
          ? allArtifacts.filter(a => affectedNames.some(name =>
              a.name === name || a.name.toLowerCase() === name.toLowerCase()))
          : currentArtifacts;

        if (affected.length === 0) continue;
        const rewritten = await runRewrite(affected, [finding], profile);

        // Only update process artifacts (device artifacts are read-only here)
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
      setCurrentStepLabel("Re-checking logic...");

      // Re-run logic check after fix
      setLogicStatus("re-reviewing");
      const findings = await logicValidate(
        session.device_artifacts ?? [],
        currentArtifacts,
      );
      const round = logicRound + 1;
      setLogicRound(round);
      setLogicRawFindings(findings);
      const tracked: TrackedFinding[] = findings.map((f, i) => ({
        severity: f.severity as "CRITICAL" | "WARNING" | "INFO",
        artifactName: `${f.category.replace(/_/g, " ")} · ${f.code_reference || f.affected_blocks.join(", ") || "cross-block"}`,
        message: `${f.title}${f.description ? ` — ${f.description}` : ""}${f.suggested_fix ? `\nFix: ${f.suggested_fix}` : ""}${f.found_by ? ` [${f.found_by === "both" ? "Claude + Gemini" : f.found_by === "claude" ? "Claude" : "Gemini"}${f.validated_by === "both" ? ", peer-validated" : ""}]` : ""}${f.confidence !== "HIGH" ? ` [${f.confidence} confidence]` : ""}${f.scan_cycle_sensitive ? " [scan-sensitive]" : ""}`,
        id: `logic-r${round}-${i}`,
        selected: false,
        unresolved: false,
        round,
      }));
      setLogicTrackedFindings(tracked);
      if (tracked.length === 0) {
        setLogicStatus("clean");
        setStageStatus("Logic Check", "completed", "clean");
      } else {
        const issues = tracked.filter(f => f.severity === "CRITICAL" || f.severity === "WARNING").length;
        setLogicStatus("findings");
        setStageStatus("Logic Check", "completed", `${issues} issues`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogicError(msg);
      setLogicStatus("findings");
      setStageStatus("Logic Check", "failed", msg.slice(0, 40));
    } finally {
      setCurrentStepLabel(null);
    }
  }

  function handleLogicAccept() {
    setLogicStatus("accepted");
    setStageStatus("Logic Check", "completed", "accepted");
    setStageStatus("Approve", "pending");
  }

  function handleLogicSkip() {
    setLogicStatus("skipped");
    setStageStatus("Logic Check", "skipped");
    setStageStatus("Approve", "pending");
  }

  // ---- Upload & Compile ----

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
    ? `Fixing (attempt ${compileProgress.attempt}/3)`
    : compileProgress.phase === "recompiling"
    ? `Recompiling (attempt ${compileProgress.attempt})`
    : null;

  const standardsDone = standardsStatus === "accepted" || standardsStatus === "skipped" || standardsStatus === "clean";
  const ioDone = ioStatus === "accepted" || ioStatus === "skipped" || ioStatus === "clean";

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Sub-pipeline progress */}
      <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
        <ForgeSubPipeline stages={stages} />
      </div>

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
                        <Badge variant="outline" className="font-mono text-[10px]">{(seq.steps ?? []).length} steps</Badge>
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
                        <Badge variant="outline" className={`font-mono text-[10px] ${
                          a.type === "FB" ? "border-blue-500/50 text-blue-400" :
                          a.type === "FC" ? "border-cyan-500/50 text-cyan-400" :
                          a.type === "DB" ? "border-purple-500/50 text-purple-400" :
                          a.type === "OB" ? "border-green-500/50 text-green-400" : ""
                        }`}>
                          {a.type}
                        </Badge>
                        <Badge variant="outline" className={`font-mono text-[10px] ${a.language === "SCL" ? "border-emerald-500/50 text-emerald-400" : "border-yellow-500/50 text-yellow-400"}`}>
                          {a.language}
                        </Badge>
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

        {/* Right panel */}
        <ResizablePanel defaultSize={65}>
          <div className="flex h-full flex-col gap-2 p-2">
            {selectedSequence && (
              <div className="shrink-0 rounded-md border border-border/60 bg-background/50 px-3 py-2">
                <div className="text-xs font-mono text-muted-foreground mb-1">
                  Reference: {selectedSequence.name}
                </div>
                <div className="space-y-0.5 max-h-24 overflow-y-auto">
                  {(selectedSequence.steps ?? []).map(s => (
                    <div key={s.step_number} className="flex gap-2 text-xs">
                      <span className="shrink-0 font-mono text-muted-foreground w-6">{s.step_number}.</span>
                      <span className="text-muted-foreground">{s.action}</span>
                      <span className="ml-auto shrink-0 text-muted-foreground/60">→ {s.completion_criteria}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 rounded-md border border-border/60 overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/60 bg-card px-3 py-1.5">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {selected ? selected.name : "Select a sequence artifact"}
                </span>
              </div>
              <ForgeCodeViewer
                artifact={selected}
                editable={editable}
                onToggleEditable={() => setEditable((value) => !value)}
                onContentChange={(content) => {
                  if (selected) {
                    updateContent(selected.id, content);
                  }
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
              <span className="font-mono text-xs text-muted-foreground">{progress.currentSequence}</span>
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

        {/* Rewrite diff + pattern library panel */}
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

        {/* Review pipeline — Standards Review */}
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
              onSelectAll={(sel) => setStandardsFindings(prev => prev.map(f => ({ ...f, selected: sel })))}
              onFixSelected={handleStandardsFix}
              onAccept={handleStandardsAccept}
              onSkip={handleStandardsSkip}
              enabled={agents?.find(a => a.display_name === "PLC Standards Enforcer")?.is_enabled ?? true}
            />

            <ReviewStepPanel
              title="IO Validation"
              accentColor="amber"
              status={ioStatus}
              findings={ioFindings}
              loading={ioValidateLoading || rewriteLoading}
              error={ioError}
              onRunReview={handleIoRun}
              onToggleFinding={(id) => setIoFindings(prev => prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f))}
              onSelectAll={(sel) => setIoFindings(prev => prev.map(f => ({ ...f, selected: sel })))}
              onFixSelected={handleIoFix}
              onAccept={handleIoAccept}
              onSkip={handleIoSkip}
              enabled={(agents?.find(a => a.display_name === "IO Validator")?.is_enabled ?? true) && standardsDone}
            />

            <ReviewStepPanel
              title="Logic Check"
              accentColor="green"
              status={logicStatus}
              findings={logicTrackedFindings}
              loading={logicLoading || rewriteLoading}
              error={logicError}
              onRunReview={handleLogicRun}
              onToggleFinding={(id) => setLogicTrackedFindings(prev => prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f))}
              onSelectAll={(sel) => setLogicTrackedFindings(prev => prev.map(f => ({ ...f, selected: sel })))}
              onFixSelected={handleLogicFix}
              onAccept={handleLogicAccept}
              onSkip={handleLogicSkip}
              enabled={standardsDone && ioDone}
            />
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
          <Button variant="outline" onClick={handleGenerateAll} disabled={loading} className="gap-2">
            {genLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Generate All
          </Button>
          {artifacts.length > 0 && (
            <>
              <Button variant="outline" onClick={approveAll} disabled={loading}>Approve All</Button>
              <Button
                variant="outline"
                onClick={handleUploadAndCompile}
                disabled={loading || approvedCount === 0 || !session.tia_project_path}
                className="gap-2"
              >
                {compileLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Upload & Compile
              </Button>
              <div className="flex-1" />
              <Button disabled={approvedCount === 0} onClick={onComplete}>
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
