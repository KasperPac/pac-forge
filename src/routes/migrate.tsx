import { useEffect, useState } from "react";
import { ArrowRightLeft, Loader2, Plus, RotateCcw } from "lucide-react";
import { useSearchParams, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MigrateConnect } from "@/components/migrate/steps/migrate-connect";
import { MigrateAnalyse } from "@/components/migrate/steps/migrate-analyse";
import { MigrateApprovePlan } from "@/components/migrate/steps/migrate-approve-plan";
import { MigrateTransform } from "@/components/migrate/steps/migrate-transform";
import { MigrateCompile } from "@/components/migrate/steps/migrate-compile";
import { MigrateReport } from "@/components/migrate/steps/migrate-report";
import { useMigrateStore } from "@/stores/migrate-store";
import {
  useCreateMigrationSession,
  useMigrationSession,
  useMigrationSessions,
} from "@/hooks/use-migrate-session";
import { MIGRATION_STEP_LABELS, MIGRATION_STEP_ORDER } from "@/types/migrate";
import type { MigrationStep } from "@/types/migrate";
import type { MigrationStepStatus } from "@/stores/migrate-store";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Local step-bar (same visual language as ForgeStepBar but for migrate steps)
// ---------------------------------------------------------------------------

function MigrateStepBar({
  steps,
  currentStep,
  stepStatuses,
  onStepClick,
}: {
  steps: MigrationStep[];
  currentStep: MigrationStep;
  stepStatuses: Record<MigrationStep, MigrationStepStatus>;
  onStepClick: (step: MigrationStep) => void;
}) {
  function getStatusClasses(status: MigrationStepStatus, isCurrent: boolean) {
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
    <div className="rounded-lg border border-border/70 bg-card/80 p-3">
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
                  "flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                  getStatusClasses(status, isCurrent),
                  isClickable
                    ? "cursor-pointer hover:bg-accent/60 hover:text-foreground"
                    : "cursor-not-allowed opacity-80"
                )}
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-current/30 bg-background/40 font-mono text-[11px]">
                  {status === "completed" ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[10px] uppercase tracking-[0.14em] opacity-70">
                    Step {index + 1}
                  </div>
                  <div className="truncate text-xs font-medium leading-tight">
                    {MIGRATION_STEP_LABELS[step]}
                  </div>
                </div>
                {status !== "completed" && (
                  <div className="shrink-0 opacity-60">
                    <Circle className="h-3.5 w-3.5" />
                  </div>
                )}
              </button>
              {index < steps.length - 1 && (
                <div
                  aria-hidden="true"
                  className={cn(
                    "mx-1 h-px w-4 shrink-0",
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
// Main route
// ---------------------------------------------------------------------------

export default function MigratePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const sessionIdFromUrl = searchParams.get("sessionId");

  const store = useMigrateStore();
  const currentStep = store.currentStep;
  const stepStatuses = store.stepStatuses;

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [creating, setCreating] = useState(false);

  const createSession = useCreateMigrationSession();
  const { data: sessions } = useMigrationSessions();
  const { data: session, refetch: refetchSession } = useMigrationSession(
    store.sessionId ?? sessionIdFromUrl
  );

  // Sync sessionId from URL to store on mount
  useEffect(() => {
    if (sessionIdFromUrl && !store.sessionId) {
      store.setSessionId(sessionIdFromUrl);
    }
  }, [sessionIdFromUrl, store]);

  // Keep Zustand step state in sync with the DB — DB is source of truth.
  // Also handles sessions that have the removed "review" step saved.
  useEffect(() => {
    if (!session) return;
    const dbStep = session.current_step as string;
    const resolvedStep: MigrationStep = MIGRATION_STEP_ORDER.includes(dbStep as MigrationStep)
      ? (dbStep as MigrationStep)
      : "compile"; // fallback for removed "review" step

    const idx = MIGRATION_STEP_ORDER.indexOf(resolvedStep);
    const statuses = {} as Record<MigrationStep, MigrationStepStatus>;
    for (let i = 0; i < MIGRATION_STEP_ORDER.length; i++) {
      statuses[MIGRATION_STEP_ORDER[i]] = i < idx ? "completed" : i === idx ? "active" : "pending";
    }
    store.setCurrentStep(resolvedStep);
    for (const [step, status] of Object.entries(statuses) as [MigrationStep, MigrationStepStatus][]) {
      store.setStepStatus(step, status);
    }
  }, [session?.current_step]); // eslint-disable-line react-hooks/exhaustive-deps

  // If no session chosen and sessions list is loaded, prompt to create/choose
  const hasSession = !!session;

  async function handleCreateSession() {
    if (!newSessionName.trim()) return;
    setCreating(true);
    try {
      const created = await createSession.mutateAsync({ name: newSessionName.trim() });
      store.reset();
      store.setSessionId(created.id);
      setSearchParams({ sessionId: created.id });
      setShowNewDialog(false);
      setNewSessionName("");
    } finally {
      setCreating(false);
    }
  }

  function handleSelectSession(id: string) {
    store.reset();
    store.setSessionId(id);
    setSearchParams({ sessionId: id });
  }

  function handleResetSession() {
    store.reset();
    store.setSessionId(null);
    setSearchParams({});
    setShowResetDialog(false);
  }

  function handleStepClick(step: MigrationStep) {
    store.setCurrentStep(step);
  }

  async function handleSessionUpdate() {
    await refetchSession();
  }

  // -------------------------------------------------------------------------
  // No session selected — show picker / new session dialog
  // -------------------------------------------------------------------------

  if (!hasSession) {
    return (
      <div className="flex h-full flex-col gap-4">
        <div className="flex items-center gap-3">
          <ArrowRightLeft className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Migration Wizard</h1>
          <Badge variant="outline" className="font-mono text-[10px]">S7-300/400 → S7-1500</Badge>
        </div>

        <div className="flex-1 rounded-lg border border-border/70 bg-card/60 p-6">
          <div className="mx-auto max-w-xl space-y-6">
            <div className="text-center">
              <ArrowRightLeft className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
              <h2 className="text-base font-semibold">S7-300/400 to S7-1500 Migration</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Export your legacy PLC code, let the AI analyse and transform it to S7-1500
                compatible SCL, review the changes, and compile directly to TIA Portal.
              </p>
            </div>

            <Button onClick={() => setShowNewDialog(true)} className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Start New Migration
            </Button>

            {sessions && sessions.length > 0 && (
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Recent Sessions
                </div>
                <div className="space-y-1.5">
                  {sessions.slice(0, 5).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleSelectSession(s.id)}
                      className="flex w-full items-center gap-3 rounded-md border border-border/60 bg-muted/10 px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {s.source_block_count} blocks · {MIGRATION_STEP_LABELS[s.current_step]}
                          {" "}· {new Date(s.updated_at).toLocaleDateString()}
                        </div>
                      </div>
                      <Badge variant="outline" className="font-mono text-[9px] shrink-0">
                        Resume
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* New session dialog */}
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Migration Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Session Name
                </label>
                <Input
                  placeholder="e.g. Line 3 Conveyor PLC"
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
              <Button onClick={handleCreateSession} disabled={creating || !newSessionName.trim()} className="gap-2">
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Session loaded — show wizard
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-base font-semibold">{session.name}</h1>
        <Badge variant="outline" className="font-mono text-[10px]">S7-300/400 → S7-1500</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/migrate")}
            className="h-7 gap-1.5 text-xs text-muted-foreground"
          >
            All Sessions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowResetDialog(true)}
            className="h-7 gap-1.5 text-xs text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Switch Session
          </Button>
        </div>
      </div>

      {/* Step bar */}
      <MigrateStepBar
        steps={MIGRATION_STEP_ORDER}
        currentStep={currentStep}
        stepStatuses={stepStatuses}
        onStepClick={handleStepClick}
      />

      {/* Step content */}
      <div className="min-h-0 flex-1">
        {currentStep === "connect" && (
          <MigrateConnect session={session} onSessionUpdate={handleSessionUpdate} />
        )}
        {currentStep === "analyse" && (
          <MigrateAnalyse session={session} onSessionUpdate={handleSessionUpdate} />
        )}
        {currentStep === "approve_plan" && (
          <MigrateApprovePlan session={session} onSessionUpdate={handleSessionUpdate} />
        )}
        {currentStep === "transform" && (
          <MigrateTransform session={session} onSessionUpdate={handleSessionUpdate} />
        )}
        {currentStep === "compile" && (
          <MigrateCompile session={session} onSessionUpdate={handleSessionUpdate} />
        )}
        {currentStep === "report" && (
          <MigrateReport session={session} onSessionUpdate={handleSessionUpdate} />
        )}
      </div>

      {/* Reset dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch Session</AlertDialogTitle>
            <AlertDialogDescription>
              Go back to the session picker? Your current session progress is saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetSession}>
              Switch Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
