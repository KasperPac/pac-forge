import { useState, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useProject, useProjects } from "@/hooks/use-projects";
import { useAgents } from "@/hooks/use-agents";
import { useActiveSession, useEndSession } from "@/hooks/use-sessions";
import {
  useSessionReservations,
  useReleaseAgent,
  useAutoRenewLeases,
} from "@/hooks/use-agent-reservation";
import { useConversationHistory, useClearConversation } from "@/hooks/use-conversation";
import { usePipelineGenerate } from "@/hooks/use-pipeline-generate";
import { useProcessGenerate } from "@/hooks/use-process-generate";
import { useMultiAgentKnowledgeDocs } from "@/hooks/use-agent-knowledge";
import { useCreatePatternCandidate, useActivePatterns } from "@/hooks/use-patterns";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useSubmitTiaJob, useBridgeStatus, useTiaJob } from "@/hooks/use-tia-jobs";
import { useFbTemplates } from "@/hooks/use-fb-templates";
import { useDesignProfile } from "@/hooks/use-design-profiles";
import { useTiaBridgeWs } from "@/hooks/use-tia-bridge-ws";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useLeaseCheck } from "@/hooks/use-lease-check";
import { toast } from "@/hooks/use-toast";
import { usePacStStore } from "@/stores/pac-st-store";
import { computeDiff } from "@/lib/diff-engine";
import { classifyCorrections } from "@/lib/correction-classifier";
import { buildManifest } from "@/lib/manifest-builder";
import { SessionStartDialog } from "@/components/session-start-dialog";
import { ExportDialog } from "@/components/pac-st/export-dialog";
import { TiaSubmitDialog } from "@/components/pac-st/tia-submit-dialog";
import { ChatPane } from "@/components/pac-st/chat-pane";
import { ProcessUploadPane } from "@/components/pac-st/process-upload-pane";
import { GeneratedCodePane } from "@/components/pac-st/generated-code-pane";
import { ApprovedCodePane } from "@/components/pac-st/approved-code-pane";
import { BottomPanel } from "@/components/pac-st/bottom-panel";
import { DebugDrawer } from "@/components/pac-st/debug-drawer";
import { TeachPatternDialog } from "@/components/pac-st/teach-pattern-dialog";
import { TeachUploadDialog } from "@/components/pac-st/teach-upload-dialog";
import { supabase } from "@/lib/supabase";
import type { BridgeEvent, CompileErrorEvent } from "@/lib/tia-bridge-contract";
import type { ConversationTurn, SafetyWarning, CompileError, TiaManifest, TiaJobType } from "@/types";

export default function PacStPage() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const { data: project } = useProject(projectId ?? undefined);

  // Session lifecycle
  const {
    data: activeSession,
    isLoading: sessionLoading,
  } = useActiveSession(projectId ?? undefined);
  const sessionId = activeSession?.id ?? null;
  const [showStartDialog, setShowStartDialog] = useState(false);

  // Agents & reservations
  const { data: allAgents } = useAgents();
  const { data: reservations } = useSessionReservations(sessionId);
  const { expiringSoon } = useLeaseCheck(reservations);
  const { renewNow } = useAutoRenewLeases(sessionId);
  const releaseAgent = useReleaseAgent();
  const endSession = useEndSession();

  // Filter agents to only those in the active session
  const selectedAgentIds = activeSession?.selected_agent_ids;
  const sessionAgents = useMemo(() => {
    if (!selectedAgentIds || !allAgents) return [];
    const selectedSet = new Set(selectedAgentIds);
    return allAgents.filter((a) => selectedSet.has(a.id));
  }, [selectedAgentIds, allAgents]);

  // Conversation history from DB
  const { data: dbMessages } = useConversationHistory(sessionId);
  const clearConversation = useClearConversation();

  // Knowledge docs for session agents
  const sessionAgentIds = useMemo(() => sessionAgents.map((a) => a.id), [sessionAgents]);
  const { data: agentKnowledgeDocs } = useMultiAgentKnowledgeDocs(sessionAgentIds);

  // Generation (pipeline for chat, streaming for process)
  const { executePipeline, isRunning: isPipelineRunning } = usePipelineGenerate();
  const { generateProcess, isStreaming: isProcessStreaming } = useProcessGenerate();
  const { setGeneratedArtifacts, currentTiaJobId, setCurrentTiaJobId, navigateToArtifact, setDebugDrawerOpen } = usePacStStore();

  // Left panel mode: chat vs process code
  const [leftPanelMode, setLeftPanelMode] = useState<"chat" | "process">("chat");

  // Pattern detection + audit + FB templates
  const { data: approvedPatterns } = useActivePatterns(project?.plc_brand ?? "SIEMENS_TIA");
  const { data: fbTemplates } = useFbTemplates();
  const { data: designProfile } = useDesignProfile(project?.design_profile_id ?? undefined);
  const createPattern = useCreatePatternCandidate();
  const auditLog = useAuditLog();

  // TIA integration
  const { data: bridgeStatus } = useBridgeStatus();
  const bridgeConnected = bridgeStatus?.connected ?? false;
  const submitTiaJob = useSubmitTiaJob();
  const { data: currentTiaJob } = useTiaJob(currentTiaJobId);
  const [liveCompileErrors, setLiveCompileErrors] = useState<CompileError[]>([]);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [selectedJobType, setSelectedJobType] = useState<TiaJobType>("IMPORT_AND_COMPILE");
  const [showTeachDialog, setShowTeachDialog] = useState(false);
  const [showTeachUploadDialog, setShowTeachUploadDialog] = useState(false);

  const handleBridgeEvent = useCallback((event: BridgeEvent) => {
    if (event.type === "compile_error") {
      const ceEvent = event as CompileErrorEvent;
      setLiveCompileErrors((prev) => [
        ...prev,
        {
          artifact_name: ceEvent.data.artifact_name,
          line: ceEvent.data.line,
          column: ceEvent.data.column,
          error_text: ceEvent.data.error_text,
          severity: ceEvent.data.severity,
        },
      ]);
    }
    if (event.type === "job_completed" || event.type === "job_failed") {
      setLogs((prev) => [
        ...prev,
        `[TIA] Job ${event.type === "job_completed" ? "completed" : "failed"}: ${event.job_id}`,
      ]);
    }
    if (event.type === "artifact_imported") {
      const data = event.data as { artifact_name?: string; success?: boolean };
      setLogs((prev) => [
        ...prev,
        `[TIA] Imported: ${data.artifact_name ?? "unknown"} — ${data.success ? "OK" : "FAILED"}`,
      ]);
    }
  }, []);

  useTiaBridgeWs({
    enabled: bridgeConnected && !!currentTiaJobId,
    jobId: currentTiaJobId,
    onEvent: handleBridgeEvent,
  });

  // Derive compile errors from DB job results, falling back to live WS errors
  const compileErrors: CompileError[] = useMemo(() => {
    const dbErrors = currentTiaJob?.compile_results?.errors ?? [];
    return dbErrors.length > 0 ? dbErrors : liveCompileErrors;
  }, [currentTiaJob, liveCompileErrors]);

  // Local UI state
  const [optimisticMessages, setOptimisticMessages] = useState<ConversationTurn[]>([]);
  const [warnings, setWarnings] = useState<SafetyWarning[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [currentManifest, setCurrentManifest] = useState<TiaManifest | null>(null);

  // Merge DB messages with optimistic local messages
  const messages = useMemo(() => {
    const db = dbMessages ?? [];
    const dbIds = new Set(db.map((m) => m.id));
    const pending = optimisticMessages.filter((m) => !dbIds.has(m.id));
    return [...db, ...pending];
  }, [dbMessages, optimisticMessages]);

  const handleSend = useCallback(
    (message: string) => {
      if (!project || !sessionId) return;

      renewNow();

      const userTurn: ConversationTurn = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        role: "USER",
        agent_id: null,
        content: message,
        artifacts_generated: [],
        safety_warnings: [],
        created_at: new Date().toISOString(),
      };
      setOptimisticMessages((prev) => [...prev, userTurn]);

      executePipeline(
        {
          project,
          sessionId,
          agents: sessionAgents,
          generationMode: "FB_PER_DEVICE",
          userMessage: message,
          conversationHistory: messages
            .filter((m) => m.role === "USER" || m.role === "AGENT")
            .map((m) => ({
              role: m.role === "USER" ? "user" as const : "assistant" as const,
              content: m.content,
            })),
          approvedPatterns: approvedPatterns ?? [],
          fbTemplates: fbTemplates ?? [],
          designProfile,
          agentKnowledgeDocs,
        },
        {
          onSuccess: (result) => {
            setGeneratedArtifacts(result.artifacts);
            setCurrentManifest(result.manifest);

            if (result.warnings.length > 0) {
              setWarnings((prev) => [...prev, ...result.warnings]);
            }

            const allErrors = [...result.parseErrors, ...result.manifestErrors];
            if (allErrors.length > 0) {
              setLogs((prev) => [...prev, ...allErrors.map((e) => `[WARN] ${e}`)]);
            }

            if (result.dbWarnings.length > 0) {
              setLogs((prev) => [...prev, ...result.dbWarnings.map((w) => `[DB] ${w}`)]);
              toast({ title: "DB Warning", description: result.dbWarnings[0], variant: "destructive" });
            }

            setLogs((prev) => [
              ...prev,
              `[INFO] Generated ${result.artifacts.length} artifact(s)`,
            ]);

            setOptimisticMessages([]);

            auditLog.mutate({
              action: "GENERATION",
              projectId: project.id,
              details: {
                session_id: sessionId,
                artifact_count: result.artifacts.length,
                warning_count: result.warnings.length,
              },
            });
          },
          onError: (error) => {
            const errorTurn: ConversationTurn = {
              id: crypto.randomUUID(),
              session_id: sessionId,
              role: "AGENT",
              agent_id: null,
              content: `Generation failed: ${error.message}`,
              artifacts_generated: [],
              safety_warnings: [],
              created_at: new Date().toISOString(),
            };
            setOptimisticMessages((prev) => [...prev, errorTurn]);
            setLogs((prev) => [...prev, `[ERROR] ${error.message}`]);
          },
        },
      );
    },
    [project, sessionId, sessionAgents, messages, renewNow, executePipeline, setGeneratedArtifacts, auditLog, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs]
  );

  const handleProcessGenerate = useCallback(
    (functionalDescription: string) => {
      if (!project || !sessionId) return;

      renewNow();

      generateProcess(
        {
          project,
          sessionId,
          agents: sessionAgents,
          approvedPatterns: approvedPatterns ?? [],
          fbTemplates: fbTemplates ?? [],
          designProfile,
          agentKnowledgeDocs,
          functionalDescription,
        },
        {
          onSuccess: (result) => {
            setGeneratedArtifacts(result.artifacts);
            setCurrentManifest(result.manifest);

            if (result.warnings.length > 0) {
              setWarnings((prev) => [...prev, ...result.warnings]);
            }

            setLogs((prev) => [
              ...prev,
              `[INFO] Process code: generated ${result.artifacts.length} artifact(s)`,
            ]);

            if (result.dbWarnings.length > 0) {
              setLogs((prev) => [...prev, ...result.dbWarnings.map((w) => `[DB] ${w}`)]);
              toast({ title: "DB Warning", description: result.dbWarnings[0], variant: "destructive" });
            }

            auditLog.mutate({
              action: "GENERATION",
              projectId: project.id,
              details: {
                session_id: sessionId,
                mode: "PROCESS_CODE",
                artifact_count: result.artifacts.length,
                warning_count: result.warnings.length,
              },
            });
          },
          onError: (error) => {
            setLogs((prev) => [...prev, `[ERROR] Process code generation failed: ${error.message}`]);
          },
        },
      );
    },
    [project, sessionId, sessionAgents, renewNow, generateProcess, setGeneratedArtifacts, auditLog, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs],
  );

  const handleAcknowledgeWarning = useCallback((id: string) => {
    setWarnings((prev) =>
      prev.map((w) => (w.id === id ? { ...w, acknowledged: true } : w))
    );
  }, []);

  const handleReleaseAgent = useCallback(
    (reservationId: string, agentId: string) => {
      releaseAgent.mutate({
        reservationId,
        agentId,
        reason: "USER_RELEASE",
      });
    },
    [releaseAgent]
  );

  const handleSessionCreated = useCallback(() => {
    setShowStartDialog(false);
  }, []);

  const handleClearChat = useCallback(() => {
    if (!sessionId) return;
    clearConversation.mutate(sessionId, {
      onSuccess: () => {
        setOptimisticMessages([]);
        setWarnings([]);
        setLogs([]);
        usePacStStore.getState().reset();
        setCurrentManifest(null);
        setLogs(["[INFO] Session workspace cleared"]);
        toast({ title: "Workspace cleared" });
        auditLog.mutate({ action: "CLEAR_WORKSPACE", projectId: project?.id });
      },
    });
  }, [sessionId, clearConversation]);

  const handleSaveSnapshot = useCallback(async () => {
    const { approvedArtifacts, activeApprovedIndex, generatedArtifacts } = usePacStStore.getState();
    const active = approvedArtifacts[activeApprovedIndex];
    if (!active || !project) return;

    const { data: { user } } = await supabase.auth.getUser();

    // Get next version number
    const { data: existing } = await supabase
      .from("snapshots")
      .select("version_number")
      .eq("artifact_id", active.artifact.id)
      .order("version_number", { ascending: false })
      .limit(1);

    const nextVersion = (existing?.[0]?.version_number ?? 0) + 1;

    const { error } = await supabase.from("snapshots").insert({
      project_id: project.id,
      artifact_id: active.artifact.id,
      content: active.content,
      trigger: "APPROVAL",
      version_number: nextVersion,
      created_by: user?.id ?? "",
    });

    if (error) {
      setLogs((prev) => [...prev, `[ERROR] Failed to save snapshot: ${error.message}`]);
      toast({ title: "Snapshot failed", description: error.message, variant: "destructive" });
    } else {
      setLogs((prev) => [...prev, `[INFO] Snapshot v${nextVersion} saved for ${active.artifact.name}`]);
      toast({ title: "Snapshot saved", description: `v${nextVersion} — ${active.artifact.name}` });
    }

    // Persist approved content
    await supabase
      .from("artifacts")
      .update({ approved_content: active.content })
      .eq("id", active.artifact.id);

    // Auto-detect corrections: diff generated vs approved
    const matchingGenerated = generatedArtifacts.find(
      (a) => a.name === active.artifact.name
    );
    if (matchingGenerated && matchingGenerated.content !== active.content) {
      const diff = computeDiff(matchingGenerated.content, active.content);
      if (diff.hasChanges) {
        const corrections = classifyCorrections(diff, {
          artifactName: active.artifact.name,
          deviceType: active.artifact.type,
        });

        for (const correction of corrections) {
          createPattern.mutate({
            plc_brand: project.plc_brand,
            device_type: correction.correctionType,
            context: active.artifact.name,
            original_snippet: correction.originalSnippet,
            corrected_snippet: correction.correctedSnippet,
            correction_type: correction.correctionType,
            explanation_tag: correction.explanationTag,
          });
        }

        if (corrections.length > 0) {
          setLogs((prev) => [
            ...prev,
            `[INFO] ${corrections.length} correction(s) detected — queued for pattern review`,
          ]);
        }
      }
    }

    auditLog.mutate({
      action: "APPROVAL",
      projectId: project.id,
      details: {
        artifact_name: active.artifact.name,
        version: nextVersion,
      },
    });
  }, [project, createPattern, auditLog]);

  const saveSnapshotsForApproved = useCallback(async (trigger: string) => {
    const { approvedArtifacts: approved } = usePacStStore.getState();
    if (!project || approved.length === 0) return;

    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? "";

    for (const item of approved) {
      try {
        const { data: existing } = await supabase
          .from("snapshots")
          .select("version_number")
          .eq("artifact_id", item.artifact.id)
          .order("version_number", { ascending: false })
          .limit(1);

        const nextVersion = (existing?.[0]?.version_number ?? 0) + 1;

        await supabase.from("snapshots").insert({
          project_id: project.id,
          artifact_id: item.artifact.id,
          content: item.content,
          trigger,
          version_number: nextVersion,
          created_by: userId,
        });
      } catch (err) {
        console.error(`Snapshot failed for ${item.artifact.name}:`, err);
      }
    }
  }, [project]);

  const handleExport = useCallback(async () => {
    // Build manifest from current approved artifacts
    const { approvedArtifacts } = usePacStStore.getState();
    if (!project || approvedArtifacts.length === 0) return;

    // Save snapshots for all approved artifacts
    await saveSnapshotsForApproved("EXPORT");

    const artifacts = approvedArtifacts.map((a) => ({
      ...a.artifact,
      content: a.content,
      approved_content: a.content,
    }));

    const { manifest } = buildManifest(artifacts, {
      projectId: project.id,
      tiaVersion: project.tia_version,
      cpuType: project.cpu_type,
      userId: "",
      sessionId: sessionId ?? "",
    });

    setCurrentManifest(manifest);
    setShowExport(true);
    toast({ title: "Export ready", description: `${artifacts.length} artifact(s) bundled` });

    auditLog.mutate({
      action: "EXPORT",
      projectId: project.id,
      details: { artifact_count: artifacts.length },
    });
  }, [project, sessionId, auditLog, saveSnapshotsForApproved]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    "ctrl+s": () => handleSaveSnapshot(),
    "ctrl+shift+e": () => handleExport(),
  });

  // TIA job submission flow
  const handleTiaSubmit = useCallback((jobType: TiaJobType) => {
    // Build manifest from current approved artifacts if not already built
    const { approvedArtifacts: approved } = usePacStStore.getState();
    if (!project || approved.length === 0) return;

    if (!currentManifest) {
      const artifacts = approved.map((a) => ({
        ...a.artifact,
        content: a.content,
        approved_content: a.content,
      }));
      const { manifest } = buildManifest(artifacts, {
        projectId: project.id,
        tiaVersion: project.tia_version,
        cpuType: project.cpu_type,
        userId: "",
        sessionId: sessionId ?? "",
      });
      setCurrentManifest(manifest);
    }

    setSelectedJobType(jobType);
    setShowSubmitDialog(true);
  }, [project, sessionId, currentManifest]);

  const handleTiaSubmitConfirm = useCallback(async (tiaProjectPath: string) => {
    if (!project || !sessionId || !currentManifest) return;

    // Save snapshots for all approved artifacts before TIA submit
    await saveSnapshotsForApproved("TIA_SUBMIT");

    setLiveCompileErrors([]);
    submitTiaJob.mutate(
      {
        projectId: project.id,
        sessionId,
        jobType: selectedJobType,
        manifest: currentManifest,
        tiaProjectPath,
      },
      {
        onSuccess: (job) => {
          setCurrentTiaJobId(job.id);
          setShowSubmitDialog(false);
          setLogs((prev) => [
            ...prev,
            `[TIA] Job submitted: ${job.id} (${selectedJobType})`,
          ]);
          auditLog.mutate({
            action: "TIA_SUBMIT",
            projectId: project.id,
            details: {
              job_id: job.id,
              job_type: selectedJobType,
              artifact_count: currentManifest.artifacts.length,
            },
          });
        },
        onError: (error) => {
          setLogs((prev) => [...prev, `[ERROR] TIA submit failed: ${error.message}`]);
        },
      }
    );
  }, [project, sessionId, currentManifest, selectedJobType, submitTiaJob, setCurrentTiaJobId, auditLog, saveSnapshotsForApproved]);

  const handleErrorClick = useCallback((artifactName: string, line: number | null) => {
    if (!line) return;
    navigateToArtifact(artifactName, line);
  }, [navigateToArtifact]);

  const handleRegenerateAffected = useCallback((errorArtifacts: string[]) => {
    if (!currentTiaJob) return;
    const errors = currentTiaJob.compile_results?.errors ?? liveCompileErrors;
    const relevantErrors = errors.filter((e) => errorArtifacts.includes(e.artifact_name));

    const errorSummary = relevantErrors
      .map((e) => `- ${e.artifact_name}${e.line ? `:${e.line}` : ""}: ${e.error_text}`)
      .join("\n");

    const prompt = `The following artifacts had compile errors in TIA Portal. Please fix them:\n\n${errorSummary}\n\nRegenerate the affected artifacts: ${errorArtifacts.join(", ")}`;
    handleSend(prompt);
  }, [currentTiaJob, liveCompileErrors, handleSend]);

  const navigate = useNavigate();
  const { data: allProjects } = useProjects();

  if (!projectId) {
    return (
      <div className="-m-4 flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="font-mono text-xs text-muted-foreground">PAC-ST</div>
          <h2 className="text-lg font-semibold">Select a Project</h2>
          <p className="font-mono text-sm text-muted-foreground">
            Choose a project to open a Pac-ST code generation session.
          </p>
          <div className="space-y-2">
            {allProjects?.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/pac-st?project=${p.id}`)}
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

  const needsSession = !sessionLoading && !activeSession;

  // Get approved artifacts for export dialog
  const { approvedArtifacts } = usePacStStore.getState();
  const exportArtifacts = approvedArtifacts.map((a) => ({
    ...a.artifact,
    content: a.content,
    approved_content: a.content,
  }));

  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col">
      {/* Session start dialog */}
      {projectId && (needsSession || showStartDialog) && (
        <SessionStartDialog
          projectId={projectId}
          open={true}
          onSessionCreated={handleSessionCreated}
          onCancel={() => navigate("/pac-st")}
        />
      )}

      {/* Export dialog */}
      {currentManifest && (
        <ExportDialog
          open={showExport}
          onOpenChange={setShowExport}
          artifacts={exportArtifacts}
          manifest={currentManifest}
          warnings={warnings}
          projectName={project?.client_name ?? "pac-st"}
        />
      )}

      {/* Debug drawer */}
      <DebugDrawer />

      {/* Teach pattern dialogs */}
      <TeachPatternDialog
        open={showTeachDialog}
        onOpenChange={setShowTeachDialog}
        plcBrand={project?.plc_brand ?? "SIEMENS_TIA"}
      />
      <TeachUploadDialog
        open={showTeachUploadDialog}
        onOpenChange={setShowTeachUploadDialog}
        plcBrand={project?.plc_brand ?? "SIEMENS_TIA"}
      />

      {/* TIA submit confirmation dialog */}
      <TiaSubmitDialog
        open={showSubmitDialog}
        onOpenChange={setShowSubmitDialog}
        manifest={currentManifest}
        warnings={warnings}
        bridgeConnected={bridgeConnected}
        jobType={selectedJobType}
        onConfirm={handleTiaSubmitConfirm}
        submitting={submitTiaJob.isPending}
      />

      {/* Main three-pane area */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize={30} minSize={15}>
          <div className="flex h-full flex-col">
            {/* Mode toggle */}
            <div className="flex border-b">
              <button
                onClick={() => setLeftPanelMode("chat")}
                className={`flex-1 px-3 py-1.5 font-mono text-xs transition-colors ${
                  leftPanelMode === "chat"
                    ? "border-b-2 border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setLeftPanelMode("process")}
                className={`flex-1 px-3 py-1.5 font-mono text-xs transition-colors ${
                  leftPanelMode === "process"
                    ? "border-b-2 border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Process Code
              </button>
            </div>

            {/* Content */}
            <div className="min-h-0 flex-1">
              {leftPanelMode === "chat" ? (
                <ChatPane
                  project={project ?? null}
                  agents={sessionAgents}
                  reservations={reservations ?? undefined}
                  messages={messages}
                  warnings={warnings}
                  onSend={handleSend}
                  onAcknowledgeWarning={handleAcknowledgeWarning}
                  onReleaseAgent={handleReleaseAgent}
                  onClearChat={handleClearChat}
                  onEndSession={activeSession ? () => endSession.mutate(activeSession.id) : undefined}
                  profileName={designProfile?.name}
                  expiringSoon={expiringSoon}
                  sending={isPipelineRunning}
                  clearing={clearConversation.isPending}
                  endingSession={endSession.isPending}
                />
              ) : (
                <ProcessUploadPane
                  onGenerate={handleProcessGenerate}
                  generating={isProcessStreaming}
                />
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={37.5} minSize={20}>
          <GeneratedCodePane />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={37.5} minSize={20}>
          <ApprovedCodePane
            projectId={projectId}
            onSaveSnapshot={handleSaveSnapshot}
            onExport={handleExport}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Bottom panel */}
      <BottomPanel
        compileErrors={compileErrors}
        logs={logs}
        warnings={warnings}
        onErrorClick={handleErrorClick}
        bridgeConnected={bridgeConnected}
        onSubmitRequest={sessionId ? handleTiaSubmit : undefined}
        submitDisabled={!currentManifest}
        submitting={submitTiaJob.isPending}
        currentJob={currentTiaJob ?? null}
        onRegenerateAffected={handleRegenerateAffected}
        onDebugOpen={() => setDebugDrawerOpen(true)}
        debugAvailable={!!usePacStStore.getState().pipelineExecution}
        onTeachOpen={() => setShowTeachDialog(true)}
        onTeachUploadOpen={() => setShowTeachUploadDialog(true)}
      />
    </div>
  );
}
