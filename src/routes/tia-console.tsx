import { useState, useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useKnowledgeConflicts } from "@/hooks/use-knowledge-conflicts";
import { KnowledgeConflictBanner } from "@/components/knowledge-conflict-banner";
import { KnowledgeConflictDialog } from "@/components/knowledge-conflict-dialog";
import {
  Terminal,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronRight,
  Play,
  Power,
  PowerOff,
  FolderOpen,
  Zap,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Shuffle,
  Sparkles,
  Download,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTiaJobs, useBridgeStatus } from "@/hooks/use-tia-jobs";
import { useTiaBridgeWs } from "@/hooks/use-tia-bridge-ws";
import { useDesignProfiles, useDesignProfile } from "@/hooks/use-design-profiles";
import { useProjects } from "@/hooks/use-projects";
import { useAgents } from "@/hooks/use-agents";
import { useFilteredAgentKnowledgeDocs, useFilteredMultiAgentKnowledgeDocs } from "@/hooks/use-agent-knowledge";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { Progress } from "@/components/ui/progress";
import { CompileFixChat } from "@/components/tia-console/compile-fix-chat";
import { LearnedCorrectionsLog } from "@/components/tia-console/learned-corrections-log";
import { DEMO_PROGRAMS, getRandomDemo } from "@/lib/demo-programs";
import { useDemoPipeline } from "@/hooks/use-demo-pipeline";
import { DEFAULT_PIPELINE_AGENT_NAMES } from "@/lib/pipeline";
import { useActivePatterns } from "@/hooks/use-patterns";
import { useFbTemplates } from "@/hooks/use-fb-templates";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { PipelineConsole } from "@/components/tia-console/pipeline-console";
import { toast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useTiaConsoleStore } from "@/stores/tia-console-store";
import type { TiaCompileResult } from "@/stores/tia-console-store";
import JSZip from "jszip";
import type { DemoProgram } from "@/lib/demo-programs";
import type { TiaJob } from "@/types";

interface TiaActionResponse {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

// Re-use types from the Zustand store
type CompileResult = TiaCompileResult;

function useCompileResult(enabled: boolean) {
  return useQuery<CompileResult | null>({
    queryKey: ["tia-compile-result"],
    queryFn: async () => {
      const res = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/compile-result`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      // Bridge returns TiaActionResponse when no results available
      if (data.message === "No compile results available") return null;
      return data as CompileResult;
    },
    enabled,
    refetchInterval: false,
  });
}

const STATUS_STYLES: Record<string, { className: string; label: string }> = {
  PENDING: { className: "bg-amber-500/10 text-amber-400 border-amber-500/30", label: "Pending" },
  RUNNING: { className: "bg-blue-500/10 text-blue-400 border-blue-500/30", label: "Running" },
  COMPLETED: { className: "bg-green-500/10 text-green-400 border-green-500/30", label: "Completed" },
  FAILED: { className: "bg-red-500/10 text-red-400 border-red-500/30", label: "Failed" },
  CANCELLED: { className: "bg-neutral-500/10 text-neutral-400 border-neutral-500/30", label: "Cancelled" },
};

// --- Bridge action hooks ---

function useTiaAction<T = void>(endpoint: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body?: T): Promise<TiaActionResponse> => {
      const response = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : "{}",
        signal: AbortSignal.timeout(120_000), // TIA operations can be slow
      });
      return (await response.json()) as TiaActionResponse;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tia-bridge-status"] });
      queryClient.invalidateQueries({ queryKey: ["tia-compile-result"] });
    },
  });
}

// --- Job detail row ---

function JobDetailRow({ job }: { job: TiaJob }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_STYLES[job.status] ?? STATUS_STYLES.PENDING;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
      >
        <TableCell className="w-8">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-mono text-sm">{job.job_type}</TableCell>
        <TableCell>
          <Badge variant="outline" className={`font-mono text-xs ${status.className}`}>
            {status.label}
          </Badge>
        </TableCell>
        <TableCell className="font-mono text-sm">
          {job.manifest.artifacts.length}
        </TableCell>
        <TableCell className="font-mono text-sm text-muted-foreground">
          {new Date(job.created_at).toLocaleString()}
        </TableCell>
        <TableCell className="font-mono text-sm text-muted-foreground">
          {job.completed_at
            ? new Date(job.completed_at).toLocaleString()
            : "—"}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 p-0">
            <div className="space-y-2 px-6 py-3">
              {/* Manifest artifacts */}
              <div>
                <div className="mb-1 font-mono text-xs text-muted-foreground">
                  ARTIFACTS (import order)
                </div>
                <div className="space-y-0.5">
                  {job.manifest.artifacts.map((a, i) => (
                    <div key={a.name} className="flex items-center gap-2">
                      <span className="w-4 text-right font-mono text-xs text-muted-foreground">
                        {i + 1}.
                      </span>
                      <Badge variant="outline" className="px-1 py-0 font-mono text-xs">
                        {a.type}
                      </Badge>
                      <span className="font-mono text-sm">{a.name}</span>
                      {a.dependencies.length > 0 && (
                        <span className="font-mono text-xs text-muted-foreground">
                          → {a.dependencies.join(", ")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Compile results */}
              {job.compile_results && (
                <div>
                  <div className="mb-1 font-mono text-xs text-muted-foreground">
                    COMPILE RESULTS
                  </div>
                  {job.compile_results.success ? (
                    <div className="font-mono text-sm text-green-400">
                      Compilation successful
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {job.compile_results.errors.map((err, i) => (
                        <div key={i} className="font-mono text-sm text-red-400">
                          {err.artifact_name}
                          {err.line ? `:${err.line}` : ""} — {err.error_text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// --- Main page ---

export default function TiaConsolePage() {
  const { data: bridgeStatus } = useBridgeStatus();
  const { data: jobs, isLoading } = useTiaJobs(undefined);
  const queryClient = useQueryClient();
  const auditLog = useAuditLog();

  // Persisted state (survives navigation)
  const {
    pipelineSteps, setPipelineSteps,
    localCompileResult, setLocalCompileResult,
    fixSessionActive, setFixSessionActive,
    compileFixSession, setCompileFixSession,
    demoStep, setDemoStep,
    customStep, setCustomStep,
    lastGeneratedSources, setLastGeneratedSources,
    reset: resetStore,
  } = useTiaConsoleStore();

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [designProfileId, setDesignProfileId] = useState(
    () => localStorage.getItem("tia-design-profile-id") ?? ""
  );

  const [selectedProjectId, setSelectedProjectId] = useState(
    () => localStorage.getItem("tia-selected-project-id") ?? ""
  );

  // Design profile + project list for compile-fix
  const { data: designProfiles } = useDesignProfiles();
  const { data: selectedDesignProfile } = useDesignProfile(designProfileId || undefined);
  const { data: projects } = useProjects();

  // Fetch agent knowledge for compile-fix prompts (filtered by project platform)
  const selectedProject = projects?.find((p) => p.id === selectedProjectId);
  const { data: agents } = useAgents();
  const codeArchitectId = agents?.find((a) => a.display_name === "Code Architect")?.id;
  const { data: codeArchitectKnowledge } = useFilteredAgentKnowledgeDocs(
    codeArchitectId,
    selectedProject?.plc_brand ?? "SIEMENS_TIA",
    selectedProject?.cpu_type,
  );
  const patternLibrarianId = agents?.find((a) => a.display_name === "Pattern Librarian")?.id;
  const { data: patternLibrarianKnowledge } = useFilteredAgentKnowledgeDocs(
    patternLibrarianId,
    selectedProject?.plc_brand ?? "SIEMENS_TIA",
    selectedProject?.cpu_type,
  );

  // Additional data for demo pipeline
  const allAgentIds = (agents ?? []).map((a) => a.id);
  const { data: allAgentKnowledge, isLoading: knowledgeLoading } = useFilteredMultiAgentKnowledgeDocs(
    allAgentIds,
    selectedProject?.plc_brand ?? "SIEMENS_TIA",
    selectedProject?.cpu_type,
  );
  const { data: approvedPatterns, isLoading: patternsLoading } = useActivePatterns(
    selectedProject?.plc_brand ?? "SIEMENS_TIA",
  );
  const { data: fbTemplates, isLoading: fbLoading } = useFbTemplates();
  const { data: promptSections } = useActivePromptSections();
  const pipelineDataReady = !knowledgeLoading && !patternsLoading && !fbLoading;

  // Knowledge conflict detection
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const conflictContext = useMemo(() => {
    if (!approvedPatterns) return null;
    return {
      patterns: approvedPatterns,
      designProfile: selectedDesignProfile ?? undefined,
      fbTemplates: fbTemplates ?? [],
      agentKnowledgeDocs: allAgentKnowledge
        ? Object.values(allAgentKnowledge).flat()
        : [],
    };
  }, [approvedPatterns, selectedDesignProfile, fbTemplates, allAgentKnowledge]);

  const {
    conflicts,
    unresolvedCount,
    resolveConflict,
    getResolution,
  } = useKnowledgeConflicts(conflictContext);

  // Count learnings for diagnostic display
  const knowledgeDocCount = allAgentKnowledge
    ? Object.values(allAgentKnowledge).reduce((sum, docs) => sum + docs.length, 0)
    : 0;
  const patternCount = approvedPatterns?.length ?? 0;
  const fbTemplateCount = fbTemplates?.length ?? 0;

  const bridgeOnline = bridgeStatus?.bridgeOnline ?? false;
  const tiaConnected = bridgeStatus?.tiaConnected ?? false;
  const projectOpen = bridgeStatus?.projectOpen ?? false;
  // For features needing the bridge (WS, compile results, etc.)
  const isConnected = bridgeOnline;

  // WebSocket for real-time job progress
  const { progress: wsProgress, currentStep: wsCurrentStep } = useTiaBridgeWs({
    enabled: isConnected,
    jobId: activeJobId,
    onEvent: (event) => {
      if (event.type === "job_started") {
        setActiveJobId(event.job_id);
      }
      if (event.type === "job_completed") {
        queryClient.invalidateQueries({ queryKey: ["tia-compile-result"] });
        setActiveJobId(null);
        toast({ title: "TIA job completed" });
        auditLog.mutate({ action: "TIA_COMPILE", details: { jobId: event.job_id, status: "completed" } });
      }
      if (event.type === "job_failed") {
        queryClient.invalidateQueries({ queryKey: ["tia-compile-result"] });
        setActiveJobId(null);
        toast({ title: "TIA job failed", variant: "destructive" });
        auditLog.mutate({ action: "TIA_COMPILE", details: { jobId: event.job_id, status: "failed" } });
      }
    },
  });

  // Lift compile result to page level so both CompileResultsCard and CompileFixChat can use it
  const { data: fetchedCompileResult, isLoading: compileLoading, isFetching: compileFetching } =
    useCompileResult(isConnected);

  const compileResult = localCompileResult ?? fetchedCompileResult ?? null;
  const hasErrors = (compileResult?.errors?.length ?? 0) > 0;
  const hasSources = Object.keys(compileResult?.sources ?? {}).length > 0;

  // Quick action mutations
  const connectMutation = useTiaAction<{ mode: string }>("/tia/connect");
  const disconnectMutation = useTiaAction("/tia/disconnect");
  const openProjectMutation = useTiaAction<{ project_path: string }>("/tia/open-project");
  const createProjectMutation = useTiaAction<{
    project_path: string;
    project_name: string;
    sources: Record<string, string>;
    import_order: string[];
  }>("/tia/demo/create");

  // Demo pipeline (full multi-agent pipeline)
  const demoPipelineMutation = useDemoPipeline();

  // Demo pool state
  const [selectedDemo, setSelectedDemo] = useState<DemoProgram>(() => getRandomDemo());
  const handleShuffle = useCallback(() => {
    let next = getRandomDemo();
    while (DEMO_PROGRAMS.length > 1 && next.id === selectedDemo.id) {
      next = getRandomDemo();
    }
    setSelectedDemo(next);
  }, [selectedDemo.id]);

  // Track which section last ran (so idle-state ActionResult only shows in the right section)
  const [lastRunSection, setLastRunSection] = useState<"demo" | "custom" | null>(null);

  const hasSessionState = pipelineSteps.length > 0 || fixSessionActive || !!localCompileResult || !!compileFixSession || !!lastGeneratedSources;

  function handleClearSession() {
    resetStore();
    setLastRunSection(null);
    demoPipelineMutation.reset();
    createProjectMutation.reset();
  }

  // Custom project state
  const [customDescription, setCustomDescription] = useState("");

  // Persisted inputs
  const [projectPath, setProjectPath] = useState(
    () => localStorage.getItem("tia-project-path") ?? ""
  );
  const [demoPath, setDemoPath] = useState(
    () => localStorage.getItem("tia-demo-path") ?? "C:\\TIA_Projects"
  );
  const [demoName, setDemoName] = useState(
    () => localStorage.getItem("tia-demo-name") ?? "PacForge_Demo"
  );

  async function handleDownloadSources() {
    if (!lastGeneratedSources) return;
    const zip = new JSZip();
    for (const name of lastGeneratedSources.importOrder) {
      const content = lastGeneratedSources.sources[name];
      if (content) zip.file(`${name}.scl`, content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${demoName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${timestamp}.zip`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleOpenProject() {
    if (!projectPath) return;
    localStorage.setItem("tia-project-path", projectPath);
    openProjectMutation.mutate({ project_path: projectPath });
  }

  function handleRunDemo() {
    localStorage.setItem("tia-demo-path", demoPath);
    localStorage.setItem("tia-demo-name", demoName);
    setLastRunSection("demo");
    setDemoStep("generating");
    setPipelineSteps([]);
    demoPipelineMutation.mutate(
      {
        description: selectedDemo.description,
        project: selectedProject,
        agents: (agents ?? []).filter(
              (a) =>
                DEFAULT_PIPELINE_AGENT_NAMES.has(a.display_name) ||
                a.display_name === "Project Manager",
            ),
        designProfile: selectedDesignProfile,
        fbTemplates,
        agentKnowledgeDocs: allAgentKnowledge,
        approvedPatterns,
        promptSections,
        onStepUpdate: setPipelineSteps,
      },
      {
        onSuccess: (generated) => {
          setPipelineSteps(generated.steps);
          setLastGeneratedSources({ sources: generated.sources, importOrder: generated.importOrder });
          setDemoStep("creating");
          setActiveJobId("pending");
          createProjectMutation.mutate(
            {
              project_path: demoPath,
              project_name: demoName,
              sources: generated.sources,
              import_order: generated.importOrder,
            },
            {
              onSettled: () => setDemoStep("idle"),
              onError: () => setActiveJobId(null),
            },
          );
        },
        onError: () => setDemoStep("idle"),
      },
    );
  }

  function handleCustomGenerate() {
    if (!customDescription.trim()) return;
    localStorage.setItem("tia-demo-path", demoPath);
    localStorage.setItem("tia-demo-name", demoName);
    setLastRunSection("custom");
    setCustomStep("generating");
    setPipelineSteps([]);
    demoPipelineMutation.mutate(
      {
        description: customDescription.trim(),
        project: selectedProject,
        agents: (agents ?? []).filter(
              (a) =>
                DEFAULT_PIPELINE_AGENT_NAMES.has(a.display_name) ||
                a.display_name === "Project Manager",
            ),
        designProfile: selectedDesignProfile,
        fbTemplates,
        agentKnowledgeDocs: allAgentKnowledge,
        approvedPatterns,
        promptSections,
        onStepUpdate: setPipelineSteps,
      },
      {
        onSuccess: (generated) => {
          setPipelineSteps(generated.steps);
          setLastGeneratedSources({ sources: generated.sources, importOrder: generated.importOrder });
          setCustomStep("creating");
          createProjectMutation.mutate(
            {
              project_path: demoPath,
              project_name: demoName,
              sources: generated.sources,
              import_order: generated.importOrder,
            },
            {
              onSettled: () => setCustomStep("idle"),
            },
          );
        },
        onError: () => setCustomStep("idle"),
      },
    );
  }

  return (
    <div className="space-y-4">
      {/* Knowledge conflict dialog */}
      <KnowledgeConflictDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        conflicts={conflicts}
        onResolve={resolveConflict}
        getResolution={getResolution}
      />

      {/* Knowledge conflict banner */}
      <KnowledgeConflictBanner
        unresolvedCount={unresolvedCount}
        onReview={() => setShowConflictDialog(true)}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">TIA PORTAL</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Terminal className="h-5 w-5" />
            TIA Console
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {hasSessionState && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
              onClick={handleClearSession}
            >
              <RotateCcw className="h-3 w-3" />
              Clear Session
            </Button>
          )}

        {/* Bridge status */}
        <Card className="px-3 py-2">
          <div className="flex items-center gap-2">
            {bridgeOnline ? (
              <>
                <Wifi className={`h-4 w-4 ${tiaConnected ? "text-green-400" : "text-amber-400"}`} />
                <div>
                  <div className={`font-mono text-sm ${tiaConnected ? "text-green-400" : "text-amber-400"}`}>
                    {tiaConnected ? "TIA Connected" : "Bridge Online"}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {tiaConnected
                      ? bridgeStatus?.version
                        ? `TIA ${bridgeStatus.version}${projectOpen ? " — Project Open" : ""}`
                        : projectOpen ? "Project Open" : "No project open"
                      : "TIA Portal not connected"}
                  </div>
                </div>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-mono text-sm text-muted-foreground">Bridge Offline</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    Start the TIA Bridge to connect
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
        </div>
      </div>

      <Separator />

      {/* Quick Actions */}
      <div>
        <div className="mb-2 font-mono text-sm text-muted-foreground">QUICK ACTIONS</div>
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Connect */}
          <Card className="p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Power className="h-3.5 w-3.5 text-green-400" />
              <span className="font-mono text-sm font-medium">Connect TIA Portal</span>
            </div>
            <p className="mb-3 font-mono text-xs text-muted-foreground">
              {tiaConnected
                ? "TIA Portal is connected."
                : bridgeOnline
                  ? "Bridge is online. Attach to a running TIA Portal or start a new instance."
                  : "Start the TIA Bridge first, then connect to TIA Portal."}
            </p>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-6 flex-1 font-mono text-xs"
                disabled={!bridgeOnline || tiaConnected || connectMutation.isPending}
                onClick={() => connectMutation.mutate({ mode: "attach" })}
              >
                {connectMutation.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Play className="mr-1 h-3 w-3" />
                )}
                Attach
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 flex-1 font-mono text-xs"
                disabled={!bridgeOnline || tiaConnected || connectMutation.isPending}
                onClick={() => connectMutation.mutate({ mode: "start" })}
              >
                {connectMutation.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Play className="mr-1 h-3 w-3" />
                )}
                Start New
              </Button>
            </div>
            <ActionResult isPending={connectMutation.isPending} isError={connectMutation.isError} data={connectMutation.data} />
          </Card>

          {/* Open Project */}
          <Card className="p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5 text-blue-400" />
              <span className="font-mono text-sm font-medium">Open Project</span>
            </div>
            <p className="mb-2 font-mono text-xs text-muted-foreground">
              Open a TIA Portal project file (.ap18, .ap17, etc.)
            </p>
            <div className="flex gap-1.5">
              <Input
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="C:\Projects\MyProject.ap18"
                className="h-6 flex-1 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-6 shrink-0 font-mono text-xs"
                disabled={!tiaConnected || !projectPath || openProjectMutation.isPending}
                onClick={handleOpenProject}
              >
                {openProjectMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  "Open"
                )}
              </Button>
            </div>
            <ActionResult isPending={openProjectMutation.isPending} isError={openProjectMutation.isError} data={openProjectMutation.data} />
          </Card>

          {/* Disconnect */}
          <Card className="p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <PowerOff className="h-3.5 w-3.5 text-red-400" />
              <span className="font-mono text-sm font-medium">Disconnect</span>
            </div>
            <p className="mb-3 font-mono text-xs text-muted-foreground">
              Close the current project and disconnect from TIA Portal.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-6 w-full font-mono text-xs"
              disabled={!tiaConnected || disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate()}
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <PowerOff className="mr-1 h-3 w-3" />
              )}
              Disconnect
            </Button>
            <ActionResult isPending={disconnectMutation.isPending} isError={disconnectMutation.isError} data={disconnectMutation.data} />
          </Card>
        </div>
      </div>

      {/* Shared project path/name inputs */}
      <div>
        <div className="mb-2 font-mono text-sm text-muted-foreground">PROJECT SETTINGS</div>

        {/* Project selector */}
        <div className="mb-2 flex items-end gap-2">
          <div className="flex-1">
            <div className="mb-1 font-mono text-xs text-muted-foreground">LINKED PROJECT</div>
            <Select
              value={selectedProjectId || "none"}
              onValueChange={(v) => {
                const id = v === "none" ? "" : v;
                setSelectedProjectId(id);
                localStorage.setItem("tia-selected-project-id", id);

                // Auto-fill from project
                const project = projects?.find((p) => p.id === id);
                if (project) {
                  setDemoName(project.client_name);
                  localStorage.setItem("tia-demo-name", project.client_name);
                  if (project.design_profile_id) {
                    setDesignProfileId(project.design_profile_id);
                    localStorage.setItem("tia-design-profile-id", project.design_profile_id);
                  }
                }
              }}
            >
              <SelectTrigger className="h-6 font-mono text-xs" aria-label="Linked project">
                <SelectValue placeholder="None (manual)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="font-mono text-xs">
                  None (manual)
                </SelectItem>
                {projects?.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="font-mono text-xs">
                    {p.client_name}{p.project_number ? ` (${p.project_number})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedProjectId && projects?.find((p) => p.id === selectedProjectId) && (() => {
            const project = projects!.find((p) => p.id === selectedProjectId)!;
            return (
              <div className="flex items-center gap-1.5 pb-0.5">
                <Badge variant="outline" className="font-mono text-xs">{project.cpu_type}</Badge>
                <Badge variant="outline" className="font-mono text-xs">TIA {project.tia_version}</Badge>
              </div>
            );
          })()}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <div className="mb-1 font-mono text-xs text-muted-foreground">PROJECT DIRECTORY</div>
            <Input
              value={demoPath}
              onChange={(e) => setDemoPath(e.target.value)}
              placeholder="C:\TIA_Projects"
              className="h-6 font-mono text-xs"
              aria-label="Project directory path"
            />
          </div>
          <div className="w-48">
            <div className="mb-1 font-mono text-xs text-muted-foreground">PROJECT NAME</div>
            <Input
              value={demoName}
              onChange={(e) => setDemoName(e.target.value)}
              placeholder="PacForge_Demo"
              className="h-6 font-mono text-xs"
              aria-label="Project name"
            />
          </div>
          <div className="w-52">
            <div className="mb-1 font-mono text-xs text-muted-foreground">DESIGN PROFILE</div>
            <Select
              value={designProfileId}
              onValueChange={(v) => {
                const id = v === "none" ? "" : v;
                setDesignProfileId(id);
                localStorage.setItem("tia-design-profile-id", id);
              }}
            >
              <SelectTrigger className="h-6 font-mono text-xs" aria-label="Design profile">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="font-mono text-xs">
                  None
                </SelectItem>
                {designProfiles?.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="font-mono text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Pipeline learnings summary */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">PIPELINE CONTEXT:</span>
          {!pipelineDataReady ? (
            <Badge variant="outline" className="gap-1 px-1.5 py-0 font-mono text-xs">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Loading...
            </Badge>
          ) : (
            <>
              <Badge
                variant="outline"
                className={`px-1.5 py-0 font-mono text-xs ${knowledgeDocCount > 0 ? "text-emerald-400 border-emerald-500/30" : "text-muted-foreground"}`}
              >
                {knowledgeDocCount} knowledge doc{knowledgeDocCount !== 1 ? "s" : ""}
              </Badge>
              <Badge
                variant="outline"
                className={`px-1.5 py-0 font-mono text-xs ${patternCount > 0 ? "text-emerald-400 border-emerald-500/30" : "text-muted-foreground"}`}
              >
                {patternCount} pattern{patternCount !== 1 ? "s" : ""}
              </Badge>
              <Badge
                variant="outline"
                className={`px-1.5 py-0 font-mono text-xs ${fbTemplateCount > 0 ? "text-emerald-400 border-emerald-500/30" : "text-muted-foreground"}`}
              >
                {fbTemplateCount} FB template{fbTemplateCount !== 1 ? "s" : ""}
              </Badge>
              <Badge
                variant="outline"
                className={`px-1.5 py-0 font-mono text-xs ${selectedDesignProfile ? "text-emerald-400 border-emerald-500/30" : "text-muted-foreground"}`}
              >
                {selectedDesignProfile ? selectedDesignProfile.name : "No profile"}
              </Badge>
            </>
          )}
        </div>
      </div>

      {/* Job progress bar */}
      {activeJobId && (
        <Card className="flex items-center gap-3 px-3 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-blue-400">
                {wsCurrentStep || "Running..."}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {Math.round(wsProgress)}%
              </span>
            </div>
            <Progress value={wsProgress} className="mt-1 h-1" />
          </div>
        </Card>
      )}

      {/* Demo + Custom project in 2 columns */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Section A: Demo — Quick Start */}
        <div>
          <div className="mb-2 font-mono text-sm text-muted-foreground">DEMO — QUICK START</div>
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                <Zap className="h-4 w-4 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium">{selectedDemo.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 font-mono text-xs"
                    onClick={handleShuffle}
                  >
                    <Shuffle className="mr-1 h-2.5 w-2.5" />
                    Shuffle
                  </Button>
                </div>
                <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                  {selectedDemo.description}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selectedDemo.importOrder.map((name) => (
                    <Badge key={name} variant="outline" className="px-1 py-0 font-mono text-xs">
                      {name}
                    </Badge>
                  ))}
                </div>

                <div className="mt-3">
                  <Button
                    size="sm"
                    className="h-6 font-mono text-xs"
                    disabled={!isConnected || demoStep !== "idle" || !pipelineDataReady}
                    onClick={handleRunDemo}
                  >
                    {demoStep === "generating" ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Generating SCL...
                      </>
                    ) : demoStep === "creating" ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Creating project...
                      </>
                    ) : (
                      <>
                        <Zap className="mr-1 h-3 w-3" />
                        Generate & Create
                      </>
                    )}
                  </Button>
                </div>

                {demoPipelineMutation.isError && demoStep === "idle" && (
                  <div className="mt-2 flex items-center gap-1 font-mono text-xs text-red-400">
                    <XCircle className="h-3 w-3 shrink-0" />
                    {demoPipelineMutation.error?.message ?? "Generation failed"}
                  </div>
                )}

                {demoStep !== "idle" && createProjectMutation.data && (
                  <ActionResult
                    isPending={false}
                    isError={createProjectMutation.isError}
                    data={createProjectMutation.data}
                    showDetails
                  />
                )}

                {demoStep === "idle" &&
                  lastRunSection === "demo" &&
                  demoPipelineMutation.isSuccess &&
                  createProjectMutation.isSuccess &&
                  createProjectMutation.data && (
                    <ActionResult
                      isPending={false}
                      isError={false}
                      data={createProjectMutation.data}
                      showDetails
                    />
                  )}
              </div>
            </div>
          </Card>
        </div>

        {/* Section B: Custom Project */}
        <div>
          <div className="mb-2 font-mono text-sm text-muted-foreground">CUSTOM PROJECT</div>
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                <Sparkles className="h-4 w-4 text-violet-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs font-medium">Generate from Description</div>
                <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                  Describe what you want to build. Claude generates SCL, imports into TIA, and compiles.
                </p>

                <Textarea
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="e.g., Bottle filling line with 3 stations: fill, cap, label. Each station has a presence sensor and actuator cylinder..."
                  aria-label="Custom project description"
                  className="mt-2 h-20 resize-none font-mono text-sm"
                  rows={4}
                />

                <div className="mt-2">
                  <Button
                    size="sm"
                    className="h-6 font-mono text-xs"
                    disabled={
                      !isConnected ||
                      !customDescription.trim() ||
                      customStep !== "idle" ||
                      !pipelineDataReady
                    }
                    onClick={handleCustomGenerate}
                  >
                    {customStep === "generating" ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Generating SCL...
                      </>
                    ) : customStep === "creating" ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Creating project...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1 h-3 w-3" />
                        Generate & Create
                      </>
                    )}
                  </Button>
                </div>

                {demoPipelineMutation.isError && customStep === "idle" && (
                  <div className="mt-2 flex items-center gap-1 font-mono text-xs text-red-400">
                    <XCircle className="h-3 w-3 shrink-0" />
                    {demoPipelineMutation.error?.message ?? "Generation failed"}
                  </div>
                )}

                {customStep !== "idle" && createProjectMutation.data && (
                  <ActionResult
                    isPending={false}
                    isError={createProjectMutation.isError}
                    data={createProjectMutation.data}
                    showDetails
                  />
                )}

                {customStep === "idle" &&
                  lastRunSection === "custom" &&
                  demoPipelineMutation.isSuccess &&
                  createProjectMutation.isSuccess &&
                  createProjectMutation.data && (
                    <ActionResult
                      isPending={false}
                      isError={false}
                      data={createProjectMutation.data}
                      showDetails
                    />
                  )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Compile Results */}
      <CompileResultsCard
        isConnected={isConnected}
        compileResult={compileResult}
        isLoading={compileLoading}
        isFetching={compileFetching}
      />

      {/* Compile Fix Chat — stays mounted after fix success so "Remember" prompt is visible */}
      {/* Also mount when there's a saved session (e.g. user navigated away and back) */}
      {isConnected && ((hasErrors || fixSessionActive) && hasSources && compileResult || !!compileFixSession) && (
        <CompileFixChat
          compileErrors={compileResult?.errors ?? []}
          compileWarnings={compileResult?.warnings ?? []}
          sources={compileResult?.sources ?? {}}
          isConnected={isConnected}
          designProfile={selectedDesignProfile}
          agentKnowledgeDocs={codeArchitectKnowledge}
          patternLibrarianKnowledgeDocs={patternLibrarianKnowledge}
          promptSections={promptSections}
          project={selectedProject}
          fbTemplates={fbTemplates}
          generationPipelineSteps={pipelineSteps.filter((s) => s.role !== "compile_fix")}
          onStepUpdate={setPipelineSteps}
          savedSession={compileFixSession}
          onSessionChange={setCompileFixSession}
          onCompileResultUpdate={(result) => {
            if (!fixSessionActive) {
              setFixSessionActive(true);
            }
            setLocalCompileResult({
              success: result.success,
              errors: result.errors,
              warnings: result.warnings,
              compiled_at: new Date().toISOString(),
              sources: result.sources,
            });
          }}
          onFixSessionEnd={() => setFixSessionActive(false)}
        />
      )}

      {/* Learned corrections log */}
      {isConnected && <LearnedCorrectionsLog />}

      {/* Pipeline Console — shows agent prompts/responses */}
      <PipelineConsole
        steps={pipelineSteps}
        isRunning={demoPipelineMutation.isPending}
        onClear={() => setPipelineSteps([])}
      />

      {/* Download generated SCL */}
      {lastGeneratedSources && !demoPipelineMutation.isPending && (
        <Card className="flex items-center gap-2 px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 font-mono text-xs"
            onClick={handleDownloadSources}
          >
            <Download className="h-3 w-3" />
            Download SCL ({lastGeneratedSources.importOrder.length} files)
          </Button>
          <span className="font-mono text-[10px] text-muted-foreground">
            {lastGeneratedSources.importOrder.join(", ")}
          </span>
        </Card>
      )}

      <Separator />

      {/* Job history */}
      <div>
        <div className="mb-2 font-mono text-sm text-muted-foreground">JOB HISTORY</div>

        {isLoading && (
          <div className="py-8 text-center font-mono text-sm text-muted-foreground">
            Loading jobs...
          </div>
        )}

        {!isLoading && (!jobs || jobs.length === 0) && (
          <Card className="p-6">
            <p className="font-mono text-sm text-muted-foreground">
              No TIA jobs yet. Generate and export artifacts from Pac-ST to create jobs.
            </p>
          </Card>
        )}

        {jobs && jobs.length > 0 && (
          <ScrollArea className="h-[calc(100vh-38rem)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="font-mono text-sm">Type</TableHead>
                  <TableHead className="font-mono text-sm">Status</TableHead>
                  <TableHead className="font-mono text-sm">Artifacts</TableHead>
                  <TableHead className="font-mono text-sm">Created</TableHead>
                  <TableHead className="font-mono text-sm">Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <JobDetailRow key={job.id} job={job as TiaJob} />
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

// --- Compile result display ---

function CompileResultDisplay({ result, expanded = false, compact = false }: { result: CompileResult; expanded?: boolean; compact?: boolean }) {
  if (!result) return null;

  const errorCount = result.errors?.length ?? 0;
  const warningCount = result.warnings?.length ?? 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span
          className={`font-mono text-xs font-medium ${
            result.success ? "text-green-400" : "text-red-400"
          }`}
        >
          {result.success ? "Compile OK" : "Compile Failed"}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {errorCount} errors, {warningCount} warnings
        </span>
      </div>
      {!compact && errorCount > 0 && (
        <ScrollArea className={`rounded border border-red-500/20 bg-red-500/5 ${expanded ? "" : "max-h-72"}`}>
          <div className="space-y-0.5 p-2">
            {result.errors.map((err, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <XCircle className="mt-0.5 h-2.5 w-2.5 shrink-0 text-red-400" />
                <span className="font-mono text-xs text-red-300">
                  <span className="text-red-300 font-medium">{err.artifact_name}</span>
                  {err.line != null && <span>:{err.line}</span>}
                  {err.column != null && <span>:{err.column}</span>}
                  {" \u2014 "}
                  {err.error_text}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
      {!compact && warningCount > 0 && (
        <ScrollArea className={`rounded border border-amber-500/20 bg-amber-500/5 ${expanded ? "" : "max-h-48"}`}>
          <div className="space-y-0.5 p-2">
            {result.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-400" />
                <span className="font-mono text-xs text-amber-300">
                  <span className="text-amber-300 font-medium">{w.artifact_name}</span>
                  {w.line != null && <span>:{w.line}</span>}
                  {" \u2014 "}
                  {w.error_text}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// --- Compile results card section ---

function CompileResultsCard({
  isConnected,
  compileResult,
  isLoading,
  isFetching,
}: {
  isConnected: boolean;
  compileResult: CompileResult | null;
  isLoading: boolean;
  isFetching: boolean;
}) {
  const queryClient = useQueryClient();
  const [fullscreen, setFullscreen] = useState(false);

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["tia-compile-result"] });
  }

  if (!isConnected) return null;

  const hasResult = !isLoading && compileResult;

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-sm text-muted-foreground">LAST COMPILE RESULT</div>
        <div className="flex items-center gap-1">
          {hasResult && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-muted-foreground"
              onClick={() => setFullscreen(true)}
              aria-label="Expand compile results"
            >
              <Maximize2 className="h-2.5 w-2.5" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 font-mono text-xs"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-1 h-2.5 w-2.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>
      <Card className="p-3">
        {isLoading && (
          <div className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading compile results...
          </div>
        )}
        {!isLoading && !compileResult && (
          <div className="font-mono text-sm text-muted-foreground">
            No compile results available. Run a demo or import job first.
          </div>
        )}
        {hasResult && (
          <CompileResultDisplay result={compileResult} />
        )}
      </Card>

      {/* Fullscreen dialog */}
      {hasResult && (
        <Dialog open={fullscreen} onOpenChange={setFullscreen}>
          <DialogContent className="flex max-h-[90vh] max-w-[90vw] flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="shrink-0 border-b px-4 py-3">
              <div className="flex items-center gap-2 pr-8">
                <DialogTitle className="font-mono text-sm">
                  Compile Results
                </DialogTitle>
                <Badge
                  variant="outline"
                  className={`px-1.5 py-0 text-[10px] ${compileResult.success ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400"}`}
                >
                  {compileResult.success ? "OK" : "Failed"}
                </Badge>
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <CompileResultDisplay result={compileResult} expanded />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// --- Inline result display for mutations ---

function ActionResult({
  isPending,
  isError,
  data,
  showDetails,
}: {
  isPending: boolean;
  isError: boolean;
  data: TiaActionResponse | undefined;
  showDetails?: boolean;
}) {
  if (isPending) return null;

  if (isError) {
    return (
      <div className="mt-2 flex items-center gap-1 font-mono text-xs text-red-400">
        <XCircle className="h-3 w-3 shrink-0" />
        Bridge unreachable
      </div>
    );
  }

  if (data) {
    return (
      <div className="mt-2 space-y-1">
        <div
          className={`flex items-center gap-1 font-mono text-xs ${
            data.success ? "text-green-400" : "text-red-400"
          }`}
        >
          {data.success ? (
            <CheckCircle2 className="h-3 w-3 shrink-0" />
          ) : (
            <XCircle className="h-3 w-3 shrink-0" />
          )}
          {data.message}
        </div>

        {showDetails && data.details && (
          <div className="space-y-0.5 pl-4">
            {data.details.project_path != null && (
              <div className="font-mono text-xs text-muted-foreground">
                Path: {String(data.details.project_path)}
              </div>
            )}
            {Array.isArray(data.details.imported_blocks) && (
              <div className="font-mono text-xs text-muted-foreground">
                Blocks: {(data.details.imported_blocks as string[]).join(", ")}
              </div>
            )}
            {data.details.compile_result != null && (
              <CompileResultDisplay result={data.details.compile_result as CompileResult} compact />
            )}
            {Array.isArray(data.details.warnings) && (data.details.warnings as string[]).length > 0 && (
              <div className="font-mono text-xs text-amber-400">
                Warnings: {(data.details.warnings as string[]).join("; ")}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
