import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router";
import { SearchCode, Plus, Loader2, RotateCcw, Check, FolderOpen, AlertCircle, Crosshair, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { ListDirectoryResponse } from "@/lib/tia-bridge-contract";
import { AuditConnect } from "@/components/pac-audit/steps/audit-connect";
import { AuditExtract } from "@/components/pac-audit/steps/audit-extract";
import { AuditSelect } from "@/components/pac-audit/steps/audit-select";
import { AuditAnalyze } from "@/components/pac-audit/steps/audit-analyze";
import { AuditReview } from "@/components/pac-audit/steps/audit-review";
import { AuditReady } from "@/components/pac-audit/steps/audit-ready";
import { useAuditStore } from "@/stores/audit-store";
import type { AuditStepStatus } from "@/stores/audit-store";
import {
  useAuditProject,
  useAuditProjects,
  useCreateAuditProject,
} from "@/hooks/use-audit-session";
import { useProject } from "@/hooks/use-projects";
import { useUiStore } from "@/stores/ui-store";
import { AUDIT_STEP_ORDER, AUDIT_STEP_LABELS } from "@/types/audit";
import type { AuditStep, AuditType } from "@/types/audit";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Step bar
// ---------------------------------------------------------------------------

function AuditStepBar({
  steps,
  currentStep,
  stepStatuses,
  onStepClick,
}: {
  steps: AuditStep[];
  currentStep: AuditStep;
  stepStatuses: Record<AuditStep, AuditStepStatus>;
  onStepClick: (step: AuditStep) => void;
}) {
  function getStatusClasses(status: AuditStepStatus, isCurrent: boolean) {
    if (status === "completed")
      return isCurrent
        ? "border-green-500/60 bg-green-500/15 text-green-400"
        : "border-green-500/40 bg-green-500/10 text-green-500";
    if (status === "active") return "border-blue-500/50 bg-blue-500/10 text-blue-400";
    if (status === "failed") return "border-red-500/50 bg-red-500/10 text-red-400";
    return isCurrent
      ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
      : "border-border/70 bg-background/40 text-muted-foreground";
  }

  return (
    <div className="rounded-lg border border-border/70 bg-card/80 p-2">
      <div className="flex items-center gap-0">
        {steps.map((step, index) => {
          const status = stepStatuses[step];
          const isCurrent = step === currentStep;
          const isClickable = step === currentStep || status === "completed";
          return (
            <div key={step} className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                onClick={() => isClickable && onStepClick(step)}
                disabled={!isClickable}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                  getStatusClasses(status, isCurrent),
                  isClickable
                    ? "cursor-pointer hover:bg-accent/60 hover:text-foreground"
                    : "cursor-not-allowed opacity-80"
                )}
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-current/30 bg-background/40 font-mono text-[10px]">
                  {status === "completed" ? <Check className="h-3 w-3" /> : index + 1}
                </div>
                <span className="truncate font-mono text-xs">
                  {AUDIT_STEP_LABELS[step]}
                </span>
              </button>
              {index < steps.length - 1 && (
                <div
                  aria-hidden="true"
                  className={cn(
                    "mx-0.5 h-px w-3 shrink-0",
                    stepStatuses[step] === "completed" ? "bg-green-500/40" : "bg-border/70"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step content
// ---------------------------------------------------------------------------

function AuditStepContent({
  step,
  session,
  onSessionUpdate,
}: {
  step: AuditStep;
  session: NonNullable<ReturnType<typeof useAuditProject>["data"]>;
  onSessionUpdate: () => void;
}) {
  switch (step) {
    case "connect":
      return <AuditConnect session={session} onSessionUpdate={onSessionUpdate} />;
    case "extract":
      return <AuditExtract session={session} onSessionUpdate={onSessionUpdate} />;
    case "select":
      return <AuditSelect session={session} onSessionUpdate={onSessionUpdate} />;
    case "analyze":
      return <AuditAnalyze session={session} onSessionUpdate={onSessionUpdate} />;
    case "review":
      return <AuditReview session={session} onSessionUpdate={onSessionUpdate} />;
    case "ready":
      return <AuditReady session={session} onSessionUpdate={onSessionUpdate} />;
  }
}

// ---------------------------------------------------------------------------
// Session picker
// ---------------------------------------------------------------------------

function SessionPicker({
  onCreateNew,
  onSelectSession,
  activeProjectId,
}: {
  onCreateNew: () => void;
  onSelectSession: (id: string) => void;
  activeProjectId: string | null;
}) {
  const { data: sessions } = useAuditProjects();
  const navigate = useNavigate();

  // Filter sessions to active project only
  const projectSessions = sessions?.filter((s) => s.project_id === activeProjectId) ?? [];

  if (!activeProjectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <AlertCircle className="h-10 w-10 text-amber-400" />
        <div className="text-center">
          <h2 className="text-base font-semibold">No Project Selected</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a project from the Projects page to start an audit session.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/projects")} className="gap-2">
          <FolderOpen className="h-4 w-4" />
          Go to Projects
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <SearchCode className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Pac-Audit</h1>
        <Badge variant="outline" className="font-mono text-[10px]">
          Reverse Engineer
        </Badge>
      </div>

      <div className="flex-1 rounded-lg border border-border/70 bg-card/60 p-6">
        <div className="mx-auto max-w-xl space-y-6">
          <div className="text-center">
            <SearchCode className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <h2 className="text-base font-semibold">Reverse-Engineer TIA Projects</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect to an existing TIA Portal project, extract all code and configuration,
              and build a deep understanding for modifications and testing.
            </p>
          </div>

          <Button onClick={onCreateNew} className="w-full gap-2">
            <Plus className="h-4 w-4" />
            New Audit Session
          </Button>

          {projectSessions.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Sessions for this project
              </div>
              <div className="space-y-1.5">
                {projectSessions.slice(0, 5).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectSession(s.id)}
                    className="flex w-full items-center gap-3 rounded-md border border-border/60 bg-muted/10 px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {s.extraction_status === "extracted" ? "Extracted" : s.current_step}
                        {" · "}
                        {new Date(s.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 font-mono text-[9px]">
                      Resume
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main route
// ---------------------------------------------------------------------------

export default function PacAuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const store = useAuditStore();
  const currentStep = store.currentStep;
  const stepStatuses = store.stepStatuses;

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [selectedPlcPath, setSelectedPlcPath] = useState<string>("");
  const [auditType, setAuditType] = useState<AuditType>("full");
  const [creating, setCreating] = useState(false);
  const [plcFolders, setPlcFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [plcLoading, setPlcLoading] = useState(false);
  const [plcError, setPlcError] = useState<string | null>(null);

  const { activeProjectId } = useUiStore();
  const { data: activeProject } = useProject(activeProjectId ?? undefined);

  const listDirMutation = useMutation({
    mutationFn: async (dirPath: string) => {
      const res = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/list-directory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dirPath }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: "Failed" }))) as { message?: string };
        throw new Error(err.message ?? "Failed to list directory");
      }
      return (await res.json()) as ListDirectoryResponse;
    },
  });
  const sessionIdFromUrl = searchParams.get("sessionId");
  const createAuditProject = useCreateAuditProject();
  const { data: session, refetch: refetchSession } = useAuditProject(
    store.sessionId ?? sessionIdFromUrl
  );

  // Sync sessionId from URL to store on mount
  useEffect(() => {
    if (sessionIdFromUrl && !store.sessionId) {
      store.setSessionId(sessionIdFromUrl);
    }
  }, [sessionIdFromUrl, store]);

  // Keep Zustand step state in sync with the DB
  useEffect(() => {
    if (!session) return;
    const dbStep = session.current_step as string;
    const resolvedStep: AuditStep = AUDIT_STEP_ORDER.includes(dbStep as AuditStep)
      ? (dbStep as AuditStep)
      : "connect";

    const idx = AUDIT_STEP_ORDER.indexOf(resolvedStep);
    const statuses = {} as Record<AuditStep, AuditStepStatus>;
    for (let i = 0; i < AUDIT_STEP_ORDER.length; i++) {
      statuses[AUDIT_STEP_ORDER[i]] =
        i < idx ? "completed" : i === idx ? "active" : "pending";
    }
    store.setCurrentStep(resolvedStep);
    for (const [step, status] of Object.entries(statuses) as [AuditStep, AuditStepStatus][]) {
      store.setStepStatus(step, status);
    }
  }, [session?.current_step]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSession = !!session;

  function handleOpenNewDialog() {
    setShowNewDialog(true);
    setNewSessionName("");
    setSelectedPlcPath("");
    setAuditType("full");
    setPlcFolders([]);
    setPlcError(null);

    // Auto-load PLC folders if project has a Dropbox path
    if (activeProject?.dropbox_folder_path) {
      const plcDir = `${activeProject.dropbox_folder_path}\\50 PLC`;
      setPlcLoading(true);
      listDirMutation.mutate(plcDir, {
        onSuccess: (data) => {
          setPlcFolders(data.entries.filter((e) => e.type === "directory"));
          setPlcLoading(false);
        },
        onError: (err) => {
          setPlcError(err instanceof Error ? err.message : "Failed to list PLC folders");
          setPlcLoading(false);
        },
      });
    }
  }

  async function handleCreateSession() {
    if (!newSessionName.trim() || !activeProjectId || !selectedPlcPath) return;
    setCreating(true);
    try {
      const created = await createAuditProject.mutateAsync({
        name: newSessionName.trim(),
        tia_project_path: selectedPlcPath,
        audit_type: auditType,
        project_id: activeProjectId,
        design_profile_id: activeProject?.design_profile_id ?? undefined,
      });
      store.reset();
      store.setSessionId(created.id);
      setSearchParams({ sessionId: created.id });
      setShowNewDialog(false);
    } finally {
      setCreating(false);
    }
  }

  function handleSelectSession(id: string) {
    store.reset();
    store.setSessionId(id);
    setSearchParams({ sessionId: id });
  }

  function handleStepClick(step: AuditStep) {
    store.setCurrentStep(step);
  }

  async function handleSessionUpdate() {
    await refetchSession();
  }

  // No session selected — show picker
  if (!hasSession) {
    return (
      <div className="flex h-full flex-col p-4">
        <SessionPicker
          onCreateNew={handleOpenNewDialog}
          onSelectSession={handleSelectSession}
          activeProjectId={activeProjectId}
        />

        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New Audit Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Active project info */}
              {activeProject && (
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/10 px-3 py-2">
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-xs">{activeProject.client_name}</span>
                  {activeProject.project_number && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {activeProject.project_number}
                    </span>
                  )}
                </div>
              )}

              {/* PLC program selection */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  PLC Program
                </label>
                {plcLoading && (
                  <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading PLC folders...
                  </div>
                )}
                {plcError && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                    {plcError}
                  </div>
                )}
                {!plcLoading && plcFolders.length > 0 && (
                  <ScrollArea className="h-[160px] rounded-md border border-border/60">
                    <div className="space-y-0.5 p-1">
                      {plcFolders.map((f) => (
                        <button
                          key={f.path}
                          type="button"
                          onClick={() => {
                            setSelectedPlcPath(f.path);
                            if (!newSessionName) setNewSessionName(f.name);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors",
                            selectedPlcPath === f.path
                              ? "border border-green-500/50 bg-green-500/10 text-green-400"
                              : "hover:bg-accent/30"
                          )}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate font-mono text-xs">{f.name}</span>
                          {selectedPlcPath === f.path && (
                            <Check className="h-3.5 w-3.5 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
                {!plcLoading && plcFolders.length === 0 && !plcError && !activeProject?.dropbox_folder_path && (
                  <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-3 text-xs text-muted-foreground">
                    No Dropbox folder linked to this project. Link one from the project settings first,
                    or enter the TIA project path manually below.
                  </div>
                )}
                {!plcLoading && plcFolders.length === 0 && !plcError && activeProject?.dropbox_folder_path && (
                  <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-3 text-xs text-muted-foreground">
                    No PLC folders found in 50 PLC. Make sure the bridge is running and the Dropbox folder is synced.
                  </div>
                )}
                {/* Manual path fallback */}
                {plcFolders.length === 0 && !plcLoading && (
                  <div className="mt-2">
                    <Input
                      value={selectedPlcPath}
                      onChange={(e) => {
                        setSelectedPlcPath(e.target.value);
                      }}
                      placeholder="C:\path\to\TIA Portal project"
                      className="font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Audit type */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Audit Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAuditType("full")}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors",
                      auditType === "full"
                        ? "border-green-500/50 bg-green-500/10 text-green-400"
                        : "border-border/60 hover:bg-accent/30"
                    )}
                  >
                    <ScanSearch className="h-5 w-5" />
                    <span className="text-xs font-medium">Full Audit</span>
                    <span className="text-[10px] text-muted-foreground text-center">
                      Extract and analyze everything
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuditType("targeted")}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors",
                      auditType === "targeted"
                        ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                        : "border-border/60 hover:bg-accent/30"
                    )}
                  >
                    <Crosshair className="h-5 w-5" />
                    <span className="text-xs font-medium">Targeted Audit</span>
                    <span className="text-[10px] text-muted-foreground text-center">
                      Select specific blocks to analyze
                    </span>
                  </button>
                </div>
              </div>

              {/* Session name */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Session Name
                </label>
                <Input
                  placeholder="e.g. Initial audit"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleCreateSession()}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateSession}
                disabled={creating || !newSessionName.trim() || !selectedPlcPath}
                className="gap-2"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Session active — show wizard
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <SearchCode className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{session.name}</h1>
        {activeProject && (
          <Badge variant="outline" className="font-mono text-[10px]">
            <FolderOpen className="mr-1 h-3 w-3" />
            {activeProject.client_name}
          </Badge>
        )}
        <div className="ml-auto flex-1">
          <AuditStepBar
            steps={AUDIT_STEP_ORDER}
            currentStep={currentStep}
            stepStatuses={stepStatuses}
            onStepClick={handleStepClick}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            store.reset();
            store.setSessionId(null);
            setSearchParams({});
          }}
          className="gap-1.5 font-mono text-xs text-muted-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          Back
        </Button>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <AuditStepContent
          step={currentStep}
          session={session}
          onSessionUpdate={handleSessionUpdate}
        />
      </div>
    </div>
  );
}
