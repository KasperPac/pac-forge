import { useState, useCallback, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useProjects, useProject, useUpdateProject } from "@/hooks/use-projects";
import { useAgents } from "@/hooks/use-agents";
import { useActiveSession } from "@/hooks/use-sessions";
import { useFilteredMultiAgentKnowledgeDocs } from "@/hooks/use-agent-knowledge";
import { useActivePatterns } from "@/hooks/use-patterns";
import { useFbTemplatesForSession } from "@/hooks/use-fb-templates";
import { useDesignProfile } from "@/hooks/use-design-profiles";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import {
  useSessionReservations,
  useAutoRenewLeases,
} from "@/hooks/use-agent-reservation";
import {
  useProcessBuilderSession,
  useCreateProcessBuilderSession,
  useUpdateProcessBuilderSession,
} from "@/hooks/use-process-builder-session";
import { useProcessQa } from "@/hooks/use-process-qa";
import { useMatrixReview } from "@/hooks/use-matrix-review";
import { useProcessPipeline } from "@/hooks/use-process-pipeline";
import { useSubmitTiaJob, useBridgeStatus, useTiaJob, isTiaProjectOpen, createProjectAndImport } from "@/hooks/use-tia-jobs";
import { useTiaBridgeWs } from "@/hooks/use-tia-bridge-ws";
import { useProcessBuilderStore } from "@/stores/process-builder-store";
import type { PipelineStepResult } from "@/lib/pipeline";
import { buildManifest } from "@/lib/manifest-builder";
import { SessionStartDialog } from "@/components/session-start-dialog";
import { QaChatPane } from "@/components/process-builder/qa-chat-pane";
import { QaSummaryPanel } from "@/components/process-builder/qa-summary-panel";
import { GenerationStagePanel } from "@/components/process-builder/generation-stage-panel";
import { StageGateDialog } from "@/components/process-builder/stage-gate-dialog";
import { ArtifactAccumulator } from "@/components/process-builder/artifact-accumulator";
import { ResumeSessionDialog } from "@/components/process-builder/resume-session-dialog";
import { LinkageMatrixPanel } from "@/components/process-builder/linkage-matrix-panel";
import { IoStageContext } from "@/components/process-builder/io-stage-panel";
import { FolderStageContext } from "@/components/process-builder/folder-stage-panel";
import { FbStageContext } from "@/components/process-builder/fb-stage-panel";
import { DbStageContext } from "@/components/process-builder/db-stage-panel";
import { FcObStageContext } from "@/components/process-builder/fc-ob-stage-panel";
import { PipelineLogPanel } from "@/components/process-builder/pipeline-log-panel";
import { generateIoArtifacts } from "@/lib/io-scl-generator";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { PROCESS_STAGE_ORDER, PROCESS_STAGE_LABELS } from "@/types/forge-matrix";
import type { ProcessStage } from "@/types/forge-matrix";
import type { CompileError } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Check, Circle, FolderOpen, Layers, RotateCcw, MessageSquare, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Detect affirmative messages that should auto-confirm pending recommendations. */
const AFFIRMATIVE_RE = /^(ok|okay|yes|yep|yeah|sure|confirm|confirmed|approve|approved|looks good|that'?s? ?(fine|good|correct|right)|go ahead|lgtm|sounds good|perfect|great|agreed|accept)\b/i;

/** Detect generation-intent messages that should trigger Proceed instead of PM chat. */
const GENERATE_RE = /^(generate|start generat|proceed|go ahead and generate|let'?s? generate|begin generat|run the pipeline|start the pipeline|kick off)/i;

/** Stable empty array to avoid infinite re-renders from Zustand selector creating new [] each render. */
const EMPTY_STEPS: PipelineStepResult[] = [];

function StageProgressBar({
  currentStage,
  onStageClick,
  onClear,
  tiaProjectPath,
  onTiaProjectPathChange,
  onTiaProjectPathBlur,
  bridgeConnected,
}: {
  currentStage: ProcessStage;
  onStageClick: (stage: ProcessStage) => void;
  onClear: () => void;
  tiaProjectPath: string | null;
  onTiaProjectPathChange: (path: string) => void;
  onTiaProjectPathBlur: () => void;
  bridgeConnected: boolean;
}) {
  const stageStatuses = useProcessBuilderStore((s) => s.stageStatuses);
  const autoGating = useProcessBuilderStore((s) => s.autoGating);

  return (
    <div className="space-y-0 border-b">
      <div className="flex items-center gap-1 px-4 py-2">
        {PROCESS_STAGE_ORDER.map((stage, i) => {
          const status = stageStatuses.find((s) => s.stage === stage);
          const isCurrent = stage === currentStage;
          const isCompleted = status?.status === "completed";
          const isFailed = status?.status === "failed";
          const isInProgress = status?.status === "in_progress";

          return (
            <div key={stage} className="flex items-center gap-1">
              <button
                onClick={() => onStageClick(stage)}
                disabled={!isCompleted && !isCurrent}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors",
                  isCurrent && "bg-accent text-accent-foreground",
                  isCompleted && "text-green-500 hover:bg-accent/50",
                  isFailed && "text-red-500",
                  isInProgress && "text-blue-400",
                  !isCurrent && !isCompleted && !isFailed && !isInProgress && "text-muted-foreground/50",
                )}
              >
                {isCompleted ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Circle className={cn("h-2.5 w-2.5", (isCurrent || isInProgress) && "fill-current")} />
                )}
                <span>{PROCESS_STAGE_LABELS[stage]}</span>
              </button>
              {i < PROCESS_STAGE_ORDER.length - 1 && (
                <span className="font-mono text-[10px] text-muted-foreground/30">&rarr;</span>
              )}
            </div>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="auto-gating" className="font-mono text-[10px] text-muted-foreground">
            Auto-advance
          </Label>
          <Switch
            id="auto-gating"
            checked={autoGating}
            onCheckedChange={() => useProcessBuilderStore.getState().toggleAutoGating()}
            className="scale-75"
          />
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-6 gap-1 px-2 font-mono text-[10px] text-muted-foreground hover:text-destructive"
          >
            <RotateCcw className="h-3 w-3" />
            Clear
          </Button>
        </div>
      </div>
      {/* TIA project path */}
      <div className="flex items-center gap-2 border-t border-border/50 px-4 py-1.5">
        <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">TIA Project</span>
        <Input
          value={tiaProjectPath ?? ""}
          onChange={(e) => onTiaProjectPathChange(e.target.value)}
          onBlur={onTiaProjectPathBlur}
          placeholder="C:\TIA Projects\MyProject"
          className="h-6 flex-1 border-0 bg-transparent px-1.5 font-mono text-[11px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {bridgeConnected ? (
          <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-green-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
            Bridge
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground/60">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            Bridge offline
          </span>
        )}
      </div>
    </div>
  );
}

export default function ProcessBuilderPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectId = searchParams.get("project");
  const { data: project } = useProject(projectId ?? undefined);
  const { data: allProjects } = useProjects();
  const { data: allAgents } = useAgents();

  // Session
  const {
    data: activeSession,
    isLoading: sessionLoading,
  } = useActiveSession(projectId ?? undefined);
  const sessionId = activeSession?.id ?? null;
  const [showStartDialog, setShowStartDialog] = useState(false);

  // Agents
  const selectedAgentIds = activeSession?.selected_agent_ids;
  const sessionAgents = useMemo(() => {
    if (!selectedAgentIds || !allAgents) return [];
    const selectedSet = new Set(selectedAgentIds);
    return allAgents.filter((a) => selectedSet.has(a.id));
  }, [selectedAgentIds, allAgents]);

  const pmAgent = useMemo(
    () => sessionAgents.find((a) => a.display_name === "Project Manager") ?? sessionAgents[0],
    [sessionAgents],
  );

  // Reservations
  useSessionReservations(sessionId);
  const { renewNow } = useAutoRenewLeases(sessionId);

  // Knowledge, templates, profile, prompts
  const sessionAgentIds = useMemo(() => sessionAgents.map((a) => a.id), [sessionAgents]);
  const { data: agentKnowledgeDocs } = useFilteredMultiAgentKnowledgeDocs(
    sessionAgentIds,
    project?.plc_brand ?? "SIEMENS_TIA",
    project?.cpu_type,
  );
  const { data: fbTemplates } = useFbTemplatesForSession(project?.design_profile_id ?? undefined);
  const { data: designProfile } = useDesignProfile(project?.design_profile_id ?? undefined);
  const { data: promptSections } = useActivePromptSections();

  // Process builder session (DB persistence)
  const { data: pbSession } = useProcessBuilderSession(sessionId);
  const createPbSession = useCreateProcessBuilderSession();
  const updatePbSession = useUpdateProcessBuilderSession();

  // Project update (for saving IO list)
  const updateProject = useUpdateProject();

  // TIA integration
  const { data: bridgeStatus } = useBridgeStatus();
  const bridgeConnected = bridgeStatus?.connected ?? false;
  const submitTiaJob = useSubmitTiaJob();
  const [currentTiaJobId, setCurrentTiaJobId] = useState<string | null>(null);
  const { data: currentTiaJob } = useTiaJob(currentTiaJobId);
  const [tiaProjectPath, setTiaProjectPath] = useState<string | null>(null);
  const [tiaImporting, setTiaImporting] = useState(false);

  // Restore tia_project_path from DB session
  useEffect(() => {
    if (pbSession?.tia_project_path && !tiaProjectPath) {
      setTiaProjectPath(pbSession.tia_project_path);
    }
  }, [pbSession?.tia_project_path, tiaProjectPath]);

  // Persist tia_project_path to DB session once pbSession exists
  useEffect(() => {
    if (pbSession && tiaProjectPath && !pbSession.tia_project_path) {
      updatePbSession.mutate({
        sessionId: pbSession.session_id,
        updates: { tia_project_path: tiaProjectPath },
      });
    }
  }, [pbSession, tiaProjectPath, updatePbSession]);

  // Auto-create process builder session when regular session exists
  useEffect(() => {
    if (sessionId && projectId && !pbSession && !createPbSession.isPending) {
      createPbSession.mutate({ sessionId, projectId });
    }
  }, [sessionId, projectId, pbSession, createPbSession]);

  // Crash recovery: restore store from DB session
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  useEffect(() => {
    if (pbSession && !recoveryChecked) {
      setRecoveryChecked(true);
      // If session has progressed beyond QA, offer to resume
      if (pbSession.current_stage !== "qa") {
        const store = useProcessBuilderStore.getState();
        // Restore stage statuses
        if (pbSession.stage_statuses?.length > 0) {
          for (const ss of pbSession.stage_statuses) {
            store.updateStageStatus(ss.stage, ss);
          }
        }
        store.setStage(pbSession.current_stage);
        if (pbSession.auto_gating) {
          if (!store.autoGating) store.toggleAutoGating();
        }
        // Restore pipeline log from DB
        if (pbSession.pipeline_log?.length > 0 && !store.pipelineExecution) {
          store.startPipeline("restored");
          for (const step of pbSession.pipeline_log) {
            store.addPipelineStep(step as unknown as PipelineStepResult);
          }
          store.completePipeline(0);
        }
        setShowResumeDialog(true);
      }
    }
  }, [pbSession, recoveryChecked]);

  const handleResume = useCallback(() => {
    setShowResumeDialog(false);
  }, []);

  const handleStartOver = useCallback(() => {
    useProcessBuilderStore.getState().reset();
    setShowResumeDialog(false);
    // Clear DB session data so crash recovery doesn't re-trigger
    if (sessionId) {
      queryClient.removeQueries({ queryKey: ["process-builder-session", sessionId] });
      updatePbSession.mutate({
        sessionId,
        updates: {
          current_stage: "qa",
          stage_statuses: [],
          qa_answers: [],
          io_recommendations: [],
          fb_recommendations: [],
          linkage_matrix: null,
          folder_structure: {},
          pipeline_log: [],
        },
      });
    }
  }, [sessionId, queryClient, updatePbSession]);

  // TIA Bridge WebSocket — track compile results
  const handleBridgeEvent = useCallback((event: { type: string; data: Record<string, unknown> }) => {
    if (event.type === "compile_result") {
      const errors = (event.data.errors ?? []) as CompileError[];
      const success = errors.filter((e) => e.severity === "ERROR").length === 0;
      const stage = useProcessBuilderStore.getState().currentStage;
      useProcessBuilderStore.getState().setStageCompileResult(stage, { success, errors });
      setTiaImporting(false);
    }
    if (event.type === "job_completed" || event.type === "job_failed") {
      setTiaImporting(false);
    }
  }, []);

  useTiaBridgeWs({
    enabled: bridgeConnected && !!currentTiaJobId,
    jobId: currentTiaJobId,
    onEvent: handleBridgeEvent,
  });

  // When TIA job completes via polling (fallback if WS misses it)
  useEffect(() => {
    if (currentTiaJob && (currentTiaJob.status === "COMPLETED" || currentTiaJob.status === "FAILED")) {
      if (tiaImporting) {
        const errors = [
          ...(currentTiaJob.compile_results?.errors ?? []),
          ...(currentTiaJob.compile_results?.warnings ?? []),
        ];
        const success = currentTiaJob.status === "COMPLETED" && (currentTiaJob.compile_results?.success ?? false);
        const stage = useProcessBuilderStore.getState().currentStage;
        useProcessBuilderStore.getState().setStageCompileResult(stage, { success, errors });
        setTiaImporting(false);
      }
    }
  }, [currentTiaJob, tiaImporting]);

  // Approved patterns
  const { data: approvedPatterns } = useActivePatterns(project?.plc_brand ?? "SIEMENS_TIA");

  // Q&A hook
  const { sendMessage } = useProcessQa();

  // Matrix review hook
  const { validateMatrix } = useMatrixReview();
  const [matrixValidating, setMatrixValidating] = useState(false);

  // Pipeline hook
  const { executeStage, rollbackToStage, cancel } = useProcessPipeline();

  // Store state
  const currentStage = useProcessBuilderStore((s) => s.currentStage);
  const stageCompileResults = useProcessBuilderStore((s) => s.stageCompileResults);
  const pipelineExecution = useProcessBuilderStore((s) => s.pipelineExecution);
  const pipelineSteps = pipelineExecution?.steps ?? EMPTY_STEPS;
  const [sending, setSending] = useState(false);
  const [stageRunning, setStageRunning] = useState(false);
  const [gateStage, setGateStage] = useState<ProcessStage | null>(null);
  const [leftPaneTab, setLeftPaneTab] = useState<"context" | "chat" | "log">("chat");

  // Can proceed from Q&A: at least one PM response and not sending
  const qaMessages = useProcessBuilderStore((s) => s.qaMessages);
  const canProceed = qaMessages.filter((m) => m.role === "assistant").length >= 1 && !sending;

  const handleProceed = useCallback(() => {
    const store = useProcessBuilderStore.getState();

    // Move from Q&A to matrix stage (matrix must exist from PM)
    store.updateStageStatus("qa", {
      status: "completed",
      completedAt: new Date().toISOString(),
    });
    store.setStage("matrix");
  }, []);

  // Matrix → IO: proceed from matrix editing to generation stages
  const handleMatrixProceed = useCallback(() => {
    const store = useProcessBuilderStore.getState();
    const matrix = store.linkageMatrix;

    if (!matrix) return;

    // Derive IO module recommendations from matrix wiring counts
    // (auto-populate ioRecommendations from IO wire totals for TIA import)
    const totals = { DI: 0, DQ: 0, AI: 0, AQ: 0 };
    for (const d of matrix.deviceLinkage) {
      for (const w of d.wiring) {
        if (w.wireType !== "io") continue;
        if (w.direction === "in") {
          totals[w.dataType === "Real" ? "AI" : "DI"]++;
        } else {
          totals[w.dataType === "Real" ? "AQ" : "DQ"]++;
        }
      }
    }

    // Mark matrix stage as completed
    store.updateStageStatus("matrix", {
      status: "completed",
      completedAt: new Date().toISOString(),
    });
    store.setStage("io");

    // Persist matrix to session
    if (sessionId) {
      updatePbSession.mutate({
        sessionId,
        updates: {
          linkage_matrix: matrix,
          current_stage: "io",
          stage_statuses: store.stageStatuses,
        },
      });
    }
  }, [sessionId, updatePbSession]);

  // Validate matrix with PM
  const handleValidateMatrix = useCallback(async () => {
    setMatrixValidating(true);
    await validateMatrix({ promptSections, designProfile });
    setMatrixValidating(false);
  }, [validateMatrix, promptSections, designProfile]);

  const handleSend = useCallback(
    async (message: string) => {
      if (!project || !pmAgent || !sessionId) return;

      const trimmed = message.trim();

      // Intercept generation-intent or affirmative messages → trigger Proceed only if matrix exists
      const hasMatrix = !!useProcessBuilderStore.getState().linkageMatrix;
      if (hasMatrix && canProceed && (GENERATE_RE.test(trimmed) || AFFIRMATIVE_RE.test(trimmed))) {
        handleProceed();
        toast({ title: "Proceeding to matrix review", description: "Review the linkage matrix before generation" });
        return;
      }

      renewNow();
      setSending(true);

      await sendMessage({
        userMessage: message,
        project,
        pmAgent,
        sessionId,
        knowledgeDocs: agentKnowledgeDocs?.[pmAgent.id],
        designProfile,
        fbTemplates,
        promptSections,
        pipelineSteps: useProcessBuilderStore.getState().pipelineExecution?.steps,
      });

      setSending(false);
    },
    [project, pmAgent, sessionId, renewNow, sendMessage, agentKnowledgeDocs, designProfile, fbTemplates, promptSections, canProceed, handleProceed],
  );

  const handleClear = useCallback(() => {
    useProcessBuilderStore.getState().reset();
    // Clear DB session so crash recovery doesn't re-trigger
    if (sessionId) {
      // Immediately evict cached pb session so remount doesn't trigger crash recovery
      queryClient.removeQueries({ queryKey: ["process-builder-session", sessionId] });
      updatePbSession.mutate({
        sessionId,
        updates: {
          current_stage: "qa",
          stage_statuses: [],
          qa_answers: [],
          io_recommendations: [],
          fb_recommendations: [],
          linkage_matrix: null,
          folder_structure: {},
          pipeline_log: [],
        },
      });
    }
    // Clear project IO list generated by previous process builder run
    if (project) {
      updateProject.mutate({ id: project.id, updates: { io_lists: [] } });
    }
    navigate("/pac-st/process");
  }, [sessionId, queryClient, updatePbSession, project, updateProject, navigate]);

  // Run a generation stage
  const handleRunStage = useCallback(
    async (stage: ProcessStage) => {
      if (!project || !sessionId) return;

      // Clear previous artifacts if re-running a completed or failed stage
      const prevStatus = useProcessBuilderStore.getState().stageStatuses.find((s) => s.stage === stage);
      if (prevStatus?.status === "completed" || prevStatus?.status === "failed") {
        useProcessBuilderStore.getState().clearStageArtifacts(stage);
      }

      setStageRunning(true);
      await executeStage(stage, {
        project,
        sessionId,
        agents: sessionAgents,
        approvedPatterns,
        fbTemplates,
        designProfile,
        agentKnowledgeDocs,
        promptSections,
      });
      setStageRunning(false);

      // Auto-import into TIA Portal if bridge connected + path configured
      // Fresh bridge check — closure value may be stale after long AI generation
      const storeState = useProcessBuilderStore.getState();
      const stageStatus = storeState.stageStatuses.find((s) => s.stage === stage);
      let liveBridgeOnline = false;
      try {
        const r = await fetch(`http://localhost:5102/tia/status`, { signal: AbortSignal.timeout(3000) });
        liveBridgeOnline = r.ok;
      } catch { /* bridge offline */ }
      console.log("[TIA Auto-Import] Check:", {
        stageComplete: stageStatus?.status,
        tiaProjectPath,
        bridgeOnline: liveBridgeOnline,
        artifactCount: Object.values(storeState.stageArtifacts).flat().length,
        ioRecs: storeState.ioRecommendations.length,
      });
      if (
        stageStatus?.status === "completed" &&
        tiaProjectPath &&
        liveBridgeOnline
      ) {
        // Collect ALL accumulated artifacts from all completed stages
        const allArtifacts = Object.values(storeState.stageArtifacts).flat();
        if (allArtifacts.length > 0) {
          setTiaImporting(true);

          const projectOpen = await isTiaProjectOpen();

          if (!projectOpen) {
            // No project open — use /tia/demo/create to create + import + compile in one call
            const sources: Record<string, string> = {};
            for (const a of allArtifacts) {
              sources[`${a.name}.scl`] = a.content;
            }
            const { manifest } = buildManifest(allArtifacts, {
              projectId: project.id,
              tiaVersion: project.tia_version,
              cpuType: project.cpu_type,
              userId: "",
              sessionId,
            });

            // Collect confirmed IO recommendations for hardware config
            const allIoRecs = storeState.ioRecommendations;
            const confirmedIoModules = allIoRecs
              .filter((r) => r.confirmed && r.mlfb)
              .map((r) => ({
                mlfb: r.mlfb,
                rack: r.rack,
                slot: r.slot,
                description: r.description,
              }));

            // Map project IO entries to the bridge tag format
            const ioTags = (project.io_lists ?? [])
              .filter((e) => e.address && e.tag_name)
              .map((e) => ({
                name: e.tag_name,
                data_type: e.data_type || "Bool",
                logical_address: e.address,
                comment: e.description ?? "",
              }));

            console.log("[TIA Create] IO recs total:", allIoRecs.length, "confirmed:", confirmedIoModules.length, "tags:", ioTags.length, allIoRecs);

            toast({
              title: "Creating TIA project...",
              description: `Creating project with ${confirmedIoModules.length}/${allIoRecs.length} IO module(s), ${ioTags.length} tag(s) and ${allArtifacts.length} artifact(s)`,
            });

            const result = await createProjectAndImport(
              tiaProjectPath,
              project.client_name ?? "PacForge_Project",
              sources,
              manifest.artifacts.map((a) => `${a.name}.scl`),
              confirmedIoModules,
              ioTags,
            );
            setTiaImporting(false);

            if (result.ok) {
              toast({
                title: "TIA project created",
                description: `Project created with ${allArtifacts.length} artifact(s) imported`,
              });
            } else {
              toast({
                title: "TIA project creation failed",
                description: result.error ?? "Unknown error",
                variant: "destructive",
                duration: Infinity,
              });
            }
          } else {
            // Project already open — use normal IMPORT_AND_COMPILE job
            const { manifest } = buildManifest(allArtifacts, {
              projectId: project.id,
              tiaVersion: project.tia_version,
              cpuType: project.cpu_type,
              userId: "",
              sessionId,
            });

            submitTiaJob.mutate(
              {
                projectId: project.id,
                sessionId,
                jobType: "IMPORT_AND_COMPILE",
                manifest,
                tiaProjectPath,
                artifacts: allArtifacts,
              },
              {
                onSuccess: (job) => {
                  setCurrentTiaJobId(job.id);
                  toast({
                    title: "TIA import started",
                    description: `Importing ${allArtifacts.length} artifact(s) after ${PROCESS_STAGE_LABELS[stage]}`,
                  });
                },
                onError: (err) => {
                  setTiaImporting(false);
                  toast({
                    title: "TIA import failed",
                    description: err instanceof Error ? err.message : "Unknown error",
                    variant: "destructive",
                    duration: Infinity,
                  });
                },
              },
            );
          }
        }
      }

      // Show gate dialog if gating is on and stage completed (not auto-gating)
      // For IO stage, delay gate until user has reviewed the suggested IO list
      const hasPendingIoReview = stage === "io" && storeState.suggestedIoList !== null;
      if (stageStatus?.status === "completed" && !storeState.autoGating && !hasPendingIoReview) {
        setGateStage(stage);
      }
    },
    [project, sessionId, sessionAgents, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs, promptSections, executeStage, tiaProjectPath, bridgeConnected, submitTiaJob],
  );

  const handleGateProceed = useCallback(() => {
    if (!gateStage) return;
    const nextIdx = PROCESS_STAGE_ORDER.indexOf(gateStage) + 1;
    if (nextIdx < PROCESS_STAGE_ORDER.length) {
      const nextStage = PROCESS_STAGE_ORDER[nextIdx];
      useProcessBuilderStore.getState().setStage(nextStage);
    }
    setGateStage(null);
  }, [gateStage]);

  const handleGateRollback = useCallback(() => {
    if (!gateStage || !sessionId) return;
    rollbackToStage(gateStage, sessionId);
    setGateStage(null);
  }, [gateStage, sessionId, rollbackToStage]);

  const handleStageClick = useCallback((stage: ProcessStage) => {
    const status = useProcessBuilderStore.getState().stageStatuses.find((s) => s.stage === stage);
    if (status?.status === "completed" || stage === useProcessBuilderStore.getState().currentStage) {
      useProcessBuilderStore.getState().setStage(stage);
    }
  }, []);

  const handleCancel = useCallback(() => {
    cancel();
    setStageRunning(false);
  }, [cancel]);

  // Handle TIA project path changes — update state immediately, persist on blur
  const handleTiaProjectPathChange = useCallback(
    (path: string) => {
      setTiaProjectPath(path || null);
    },
    [],
  );

  const handleTiaProjectPathBlur = useCallback(() => {
    if (sessionId) {
      updatePbSession.mutate({
        sessionId,
        updates: { tia_project_path: tiaProjectPath ?? "" },
      });
    }
  }, [sessionId, tiaProjectPath, updatePbSession]);

  const needsSession = !sessionLoading && !activeSession;

  if (!projectId) {
    return (
      <div className="-m-4 flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="font-mono text-xs text-muted-foreground">PROCESS BUILDER</div>
          <h2 className="text-lg font-semibold">Select a Project</h2>
          <p className="font-mono text-sm text-muted-foreground">
            Choose a project to start a staged process code generation session.
          </p>
          <div className="space-y-2">
            {allProjects?.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/pac-st/process?project=${p.id}`)}
                className="flex w-full items-center justify-between rounded-md border px-4 py-3 text-left transition-colors hover:bg-accent/50"
              >
                <div>
                  <div className="text-sm font-medium">{p.client_name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {p.cpu_type} &middot; {p.tia_version}
                  </div>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {new Date(p.updated_at).toLocaleDateString()}
                </div>
              </button>
            ))}
            {allProjects?.length === 0 && (
              <div className="rounded-md border border-dashed px-4 py-6 font-mono text-sm text-muted-foreground">
                No projects yet. Create one from the Projects page.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Phase detection
  const isQaPhase = currentStage === "qa";
  const isMatrixPhase = currentStage === "matrix";
  const isGenerationPhase = !isQaPhase && !isMatrixPhase;

  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col">
      {/* Session start dialog */}
      {projectId && (needsSession || showStartDialog) && (
        <SessionStartDialog
          projectId={projectId}
          open={true}
          showTiaProjectPath
          onSessionCreated={(_sessionId, tiaPath) => {
            if (tiaPath) {
              setTiaProjectPath(tiaPath);
            }
            setShowStartDialog(false);
          }}
          onCancel={() => navigate("/pac-st/process")}
        />
      )}

      {/* Stage progress bar + TIA path */}
      <StageProgressBar
        currentStage={currentStage}
        onStageClick={handleStageClick}
        onClear={handleClear}
        tiaProjectPath={tiaProjectPath}
        onTiaProjectPathChange={handleTiaProjectPathChange}
        onTiaProjectPathBlur={handleTiaProjectPathBlur}
        bridgeConnected={bridgeConnected}
      />

      {/* Q&A Phase */}
      {isQaPhase && (
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          <ResizablePanel defaultSize={60} minSize={30}>
            <div className="flex h-full flex-col">
              {/* Tab bar — only show when pipeline steps exist */}
              {pipelineSteps.length > 0 && (
                <div className="flex border-b">
                  <button
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] transition-colors",
                      leftPaneTab === "chat" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setLeftPaneTab("chat")}
                  >
                    <MessageSquare className="h-3 w-3" />
                    Chat
                  </button>
                  <button
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] transition-colors",
                      leftPaneTab === "log" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setLeftPaneTab("log")}
                  >
                    <Terminal className="h-3 w-3" />
                    Pipeline Log
                    <Badge variant="outline" className="px-1 py-0 text-[9px]">
                      {pipelineSteps.length}
                    </Badge>
                  </button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                {leftPaneTab === "chat" ? (
                  <QaChatPane
                    onSend={handleSend}
                    sending={sending}
                    onClear={handleClear}
                    onProceed={handleProceed}
                    canProceed={canProceed}
                  />
                ) : (
                  <PipelineLogPanel steps={pipelineSteps} isRunning={stageRunning} />
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={40} minSize={20}>
            <QaSummaryPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Matrix Phase — Q&A chat (left) + Linkage Matrix (right) */}
      {isMatrixPhase && (
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          <ResizablePanel defaultSize={30} minSize={20}>
            <div className="flex h-full flex-col">
              {pipelineSteps.length > 0 && (
                <div className="flex border-b">
                  <button
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] transition-colors",
                      leftPaneTab === "chat" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setLeftPaneTab("chat")}
                  >
                    <MessageSquare className="h-3 w-3" />
                    Chat
                  </button>
                  <button
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] transition-colors",
                      leftPaneTab === "log" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setLeftPaneTab("log")}
                  >
                    <Terminal className="h-3 w-3" />
                    Pipeline Log
                    <Badge variant="outline" className="px-1 py-0 text-[9px]">
                      {pipelineSteps.length}
                    </Badge>
                  </button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                {leftPaneTab === "chat" ? (
                  <QaChatPane
                    onSend={handleSend}
                    sending={sending || matrixValidating}
                    onClear={handleClear}
                    onProceed={handleProceed}
                    canProceed={false}
                  />
                ) : (
                  <PipelineLogPanel steps={pipelineSteps} isRunning={stageRunning} />
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={70} minSize={40}>
            <LinkageMatrixPanel
              onValidate={handleValidateMatrix}
              onProceed={handleMatrixProceed}
              validating={matrixValidating}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Generation Phase */}
      {isGenerationPhase && (
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          {/* Left: context / chat / pipeline log */}
          <ResizablePanel defaultSize={20} minSize={15}>
            <div className="flex h-full flex-col border-r">
              <div className="flex border-b">
                <button
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] transition-colors",
                    leftPaneTab === "context" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setLeftPaneTab("context")}
                >
                  <Layers className="h-3 w-3" />
                  Context
                </button>
                <button
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] transition-colors",
                    leftPaneTab === "chat" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setLeftPaneTab("chat")}
                >
                  <MessageSquare className="h-3 w-3" />
                  Chat
                </button>
                <button
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] transition-colors",
                    leftPaneTab === "log" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setLeftPaneTab("log")}
                >
                  <Terminal className="h-3 w-3" />
                  Log
                  {pipelineSteps.length > 0 && (
                    <Badge variant="outline" className="px-1 py-0 text-[9px]">
                      {pipelineSteps.length}
                    </Badge>
                  )}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {leftPaneTab === "context" && (
                  <>
                    {currentStage === "io" && <IoStageContext />}
                    {currentStage === "folders" && <FolderStageContext />}
                    {currentStage === "fb" && <FbStageContext />}
                    {currentStage === "db" && <DbStageContext />}
                    {currentStage === "fc_ob" && <FcObStageContext />}
                  </>
                )}
                {leftPaneTab === "chat" && (
                  <QaChatPane
                    onSend={handleSend}
                    sending={sending}
                    onClear={handleClear}
                    onProceed={handleProceed}
                    canProceed={false}
                  />
                )}
                {leftPaneTab === "log" && (
                  <PipelineLogPanel steps={pipelineSteps} isRunning={stageRunning} />
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Center: generation panel */}
          <ResizablePanel defaultSize={55} minSize={30}>
            <GenerationStagePanel
              stage={currentStage}
              onRunStage={() => handleRunStage(currentStage)}
              onCancel={handleCancel}
              isRunning={stageRunning}
              compileResult={stageCompileResults[currentStage]}
              tiaImporting={tiaImporting}
              existingIoList={project?.io_lists}
              onIoListApply={async (mergedIoList) => {
                if (!project) return;
                // Save approved IO list to project
                updateProject.mutate({
                  id: project.id,
                  updates: { io_lists: mergedIoList },
                });
                // Generate SCL artifacts from approved IO list (deterministic, no AI)
                const ioArtifacts = generateIoArtifacts(mergedIoList);
                const store = useProcessBuilderStore.getState();
                if (ioArtifacts.length > 0) {
                  // Clear any previous IO artifacts and add new ones
                  store.clearStageArtifacts("io");
                  const artifacts = ioArtifacts.map((a) => ({
                    id: `io-${a.name}-${Date.now()}`,
                    name: a.name,
                    type: a.type,
                    content: a.content,
                    filename: a.filename,
                    dependencies: a.dependencies,
                    destination_folder: a.folder ?? "",
                    approved_content: null,
                    compile_after_import: false,
                    overwrite_strategy: "CREATE_OR_UPDATE" as const,
                    safety_warnings: [],
                    notes: "Generated from approved IO list",
                    project_id: project.id,
                    session_id: sessionId ?? "",
                    version: 1,
                    created_at: new Date().toISOString(),
                  }));
                  store.addStageArtifacts("io", artifacts);

                  // Auto-import to TIA if bridge is online
                  if (tiaProjectPath) {
                    try {
                      const r = await fetch("http://localhost:5102/tia/status", { signal: AbortSignal.timeout(3000) });
                      if (r.ok) {
                        setTiaImporting(true);
                        // Re-read store state after addStageArtifacts (store snapshot is stale)
                        const allArtifacts = Object.values(useProcessBuilderStore.getState().stageArtifacts).flat();
                        const projectOpen = await isTiaProjectOpen();

                        if (projectOpen) {
                          const { manifest } = buildManifest(allArtifacts, {
                            projectId: project.id,
                            tiaVersion: project.tia_version,
                            cpuType: project.cpu_type,
                            userId: "",
                            sessionId: sessionId ?? "",
                          });
                          submitTiaJob.mutate({
                            projectId: project.id,
                            sessionId: sessionId ?? "",
                            jobType: "IMPORT_AND_COMPILE",
                            manifest,
                            tiaProjectPath,
                            artifacts: allArtifacts,
                          }, {
                            onSuccess: (job) => {
                              setCurrentTiaJobId(job.id);
                              toast({ title: "TIA import started", description: `Importing ${allArtifacts.length} IO artifact(s)` });
                            },
                            onError: (err) => {
                              setTiaImporting(false);
                              toast({ title: "TIA import failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
                            },
                          });
                        } else {
                          // Create project + import
                          // Source keys must NOT include .scl — bridge appends it
                          const sources: Record<string, string> = {};
                          for (const a of allArtifacts) sources[a.name] = a.content;
                          const { manifest } = buildManifest(allArtifacts, {
                            projectId: project.id,
                            tiaVersion: project.tia_version,
                            cpuType: project.cpu_type,
                            userId: "",
                            sessionId: sessionId ?? "",
                          });
                          const ioTags = mergedIoList
                            .filter((e) => e.address && e.tag_name)
                            .map((e) => ({ name: e.tag_name, data_type: e.data_type || "Bool", logical_address: e.address, comment: e.description ?? "" }));
                          // Build IO modules from project rack/slot layout
                          const ioModules = (project.rack_slot_layout ?? []).flatMap((rack) =>
                            rack.slots
                              .filter((s) => s.order_number && s.module_type !== "CPU")
                              .map((s) => ({ mlfb: s.order_number!, rack: rack.rack, slot: s.slot, description: s.description ?? s.module_type })),
                          );
                          const result = await createProjectAndImport(tiaProjectPath, project.client_name ?? "PacForge_Project", sources, manifest.artifacts.map((a) => a.name), ioModules, ioTags);
                          setTiaImporting(false);
                          toast(result.ok
                            ? { title: "TIA project created", description: `Imported ${allArtifacts.length} IO artifact(s)` }
                            : { title: "TIA project creation failed", description: result.error ?? "Unknown error", variant: "destructive" });
                        }
                      }
                    } catch { /* bridge offline — skip import */ }
                  }
                }
                // Show stage gate after IO review is complete
                const ioStatus = store.stageStatuses.find((s) => s.stage === "io");
                if (ioStatus?.status === "completed" && !store.autoGating) {
                  setGateStage("io");
                }
              }}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right: artifact accumulator */}
          <ResizablePanel defaultSize={25} minSize={15}>
            <ArtifactAccumulator />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Resume session dialog */}
      {showResumeDialog && pbSession && (
        <ResumeSessionDialog
          open={true}
          session={pbSession}
          onResume={handleResume}
          onStartOver={handleStartOver}
        />
      )}

      {/* Stage gate dialog */}
      {gateStage && (
        <StageGateDialog
          open={true}
          completedStage={gateStage}
          onProceed={handleGateProceed}
          onRollback={handleGateRollback}
          onDismiss={() => setGateStage(null)}
        />
      )}
    </div>
  );
}
