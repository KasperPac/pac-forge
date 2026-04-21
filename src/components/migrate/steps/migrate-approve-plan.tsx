import { useState } from "react";
import { AlertTriangle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
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
import { useUpdateMigrationSession } from "@/hooks/use-migrate-session";
import { useMigrateStore } from "@/stores/migrate-store";
import type { MigrationSession, MigrationPlanStep, MigrationSeverity } from "@/types";

interface MigrateApprovePlanProps {
  session: MigrationSession;
  onSessionUpdate: () => void;
}

function severityBadge(severity: MigrationSeverity) {
  if (severity === "BREAKING")
    return <Badge variant="destructive" className="font-mono text-[10px]">BREAKING</Badge>;
  if (severity === "WARNING")
    return <Badge variant="outline" className="font-mono text-[10px] border-amber-500/50 text-amber-400">WARNING</Badge>;
  return <Badge variant="secondary" className="font-mono text-[10px]">INFO</Badge>;
}

function changeTypeBadge(type: string) {
  const colors: Record<string, string> = {
    TIMER: "border-blue-500/50 text-blue-400",
    COUNTER: "border-cyan-500/50 text-cyan-400",
    NAMING: "border-purple-500/50 text-purple-400",
    ADDRESSING: "border-red-500/50 text-red-400",
    BLOCK_CALL: "border-orange-500/50 text-orange-400",
    DATA_TYPE: "border-yellow-500/50 text-yellow-400",
    OB_INTERFACE: "border-green-500/50 text-green-400",
    SYSTEM_FUNCTION: "border-pink-500/50 text-pink-400",
    OTHER: "border-zinc-500/50 text-zinc-400",
  };
  return (
    <Badge variant="outline" className={`font-mono text-[10px] ${colors[type] ?? ""}`}>
      {type}
    </Badge>
  );
}

export function MigrateApprovePlan({ session, onSessionUpdate }: MigrateApprovePlanProps) {
  const [plan, setPlan] = useState<MigrationPlanStep[]>(session.migration_plan ?? []);
  const [showSkipWarning, setShowSkipWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const store = useMigrateStore();
  const updateSession = useUpdateMigrationSession();

  function toggleApprove(id: string) {
    setPlan((prev) =>
      prev.map((s) => (s.id === id ? { ...s, approved: !s.approved, skipped: false } : s))
    );
  }

  function toggleSkip(id: string) {
    setPlan((prev) =>
      prev.map((s) => (s.id === id ? { ...s, skipped: !s.skipped, approved: false } : s))
    );
  }

  function setNote(id: string, note: string) {
    setPlan((prev) => prev.map((s) => (s.id === id ? { ...s, note } : s)));
  }

  function approveAllBreaking() {
    setPlan((prev) =>
      prev.map((s) => (s.severity === "BREAKING" ? { ...s, approved: true, skipped: false } : s))
    );
  }

  function approveAll() {
    setPlan((prev) => prev.map((s) => ({ ...s, approved: true, skipped: false })));
  }

  async function handleProceed() {
    const skippedBreaking = plan.filter((s) => s.skipped && s.severity === "BREAKING");
    if (skippedBreaking.length > 0) {
      setShowSkipWarning(true);
      return;
    }
    await savePlan();
  }

  async function savePlan() {
    setSaving(true);
    setSaveError(null);
    try {
      await updateSession.mutateAsync({
        id: session.id,
        updates: { migration_plan: plan, current_step: "transform" },
      });
      // Update store directly — don't rely on refetch→useEffect chain
      store.setCurrentStep("transform");
      store.setStepStatus("approve_plan", "completed");
      store.setStepStatus("transform", "active");
      onSessionUpdate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const approvedCount = plan.filter((s) => s.approved).length;
  const skippedBreakingCount = plan.filter((s) => s.skipped && s.severity === "BREAKING").length;

  // Group by block
  const byBlock = plan.reduce<Record<string, MigrationPlanStep[]>>((acc, step) => {
    if (!acc[step.block_name]) acc[step.block_name] = [];
    acc[step.block_name].push(step);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={approveAllBreaking} className="text-xs">
          Approve All BREAKING
        </Button>
        <Button variant="outline" size="sm" onClick={approveAll} className="text-xs">
          Approve All
        </Button>
        <div className="ml-auto font-mono text-xs text-muted-foreground">
          {approvedCount}/{plan.length} approved
          {skippedBreakingCount > 0 && (
            <span className="ml-2 text-amber-400">({skippedBreakingCount} breaking skipped)</span>
          )}
        </div>
      </div>

      {/* Plan cards */}
      <ScrollArea className="flex-1 rounded-md border border-border/60">
        <div className="space-y-4 p-3">
          {Object.entries(byBlock).map(([blockName, steps]) => (
            <div key={blockName} className="rounded-md border border-border/50 bg-muted/10">
              <div className="border-b border-border/40 px-3 py-2">
                <span className="font-mono text-xs text-foreground">{blockName}</span>
                <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                  {steps.length} items
                </Badge>
              </div>
              <div className="divide-y divide-border/30">
                {steps.map((step) => (
                  <div key={step.id} className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleApprove(step.id)}
                          className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] font-bold transition-colors ${step.approved ? "border-green-500 bg-green-500/20 text-green-400" : "border-border/60 text-muted-foreground hover:border-green-500/50"}`}
                          title="Approve"
                        >
                          {step.approved ? "✓" : ""}
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          {severityBadge(step.severity)}
                          {changeTypeBadge(step.change_type)}
                        </div>
                        <p className="text-xs text-foreground/80">{step.description}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          Action: {step.action}
                        </p>
                        <div className="mt-2">
                          <Textarea
                            placeholder="Optional note…"
                            value={step.note}
                            onChange={(e) => setNote(step.id, e.target.value)}
                            className="h-14 resize-none font-mono text-[10px]"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSkip(step.id)}
                        className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${step.skipped ? "border border-zinc-500/50 bg-zinc-500/10 text-zinc-400" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {step.skipped ? "skipped" : "skip"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {saveError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{saveError}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleProceed} disabled={saving || approvedCount === 0}>
          Proceed to Transform
        </Button>
      </div>

      {/* Warning dialog for skipped breaking steps */}
      <AlertDialog open={showSkipWarning} onOpenChange={setShowSkipWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Skipping BREAKING Changes
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are skipping {skippedBreakingCount} BREAKING migration step
              {skippedBreakingCount !== 1 ? "s" : ""}. These will likely cause compile errors on
              S7-1500. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={savePlan}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Proceed anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
