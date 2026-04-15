/**
 * Forge wizard step: Logic Check
 *
 * Validates assembly FB artifacts against FDS behavioral specifications.
 * Shows issues grouped by assembly with severity, category, and suggestions.
 * Engineer can continue with warnings or fix and re-check.
 */
import { useState, useMemo, useCallback } from "react";
import {
  XCircle,
  AlertTriangle,
  Info,
  Play,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useForgeLogicCheck } from "@/hooks/use-forge-logic-check";
import type { ForgeSession, ForgeArtifact, ForgeAssemblyEntry } from "@/types/forge";
import type { LogicCheckIssue, LogicCheckResult } from "@/types/forge-logic-check";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ForgeLogicCheckProps {
  session: ForgeSession;
  onComplete: (result: LogicCheckResult) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  state_coverage: "State Coverage",
  step_sequence: "Step Sequence",
  permissive: "Permissive",
  completion_criteria: "Completion",
  timeout: "Timeout",
  device_state: "Device State",
  fault_handling: "Fault Handling",
  interface: "Interface",
  syntax: "Syntax",
  general: "General",
};

function severityIcon(severity: LogicCheckIssue["severity"]) {
  switch (severity) {
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    case "warning":
      return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
    case "info":
      return <Info className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  }
}

function severityColor(severity: LogicCheckIssue["severity"]) {
  switch (severity) {
    case "error": return "border-red-500/30 text-red-400";
    case "warning": return "border-yellow-500/30 text-yellow-400";
    case "info": return "border-blue-500/30 text-blue-400";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function IssueRow({ issue }: { issue: LogicCheckIssue }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded bg-background/40 border border-border/20">
      {severityIcon(issue.severity)}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Badge variant="outline" className={`font-mono text-[8px] px-1 py-0 ${severityColor(issue.severity)}`}>
            {CATEGORY_LABELS[issue.category] ?? issue.category}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">{issue.blockName}</span>
        </div>
        <p className="text-xs">{issue.message}</p>
        {issue.suggestion && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Suggestion: {issue.suggestion}
          </p>
        )}
      </div>
    </div>
  );
}

function AssemblyGroup({
  tag,
  issues,
  defaultOpen,
}: {
  tag: string;
  issues: LogicCheckIssue[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  return (
    <div className="rounded border border-border/30">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-mono text-xs font-semibold">{tag}</span>
        <div className="flex gap-1.5 ml-auto">
          {errorCount > 0 && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 border-red-500/30 text-red-400">
              {errorCount} error{errorCount !== 1 ? "s" : ""}
            </Badge>
          )}
          {warnCount > 0 && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 border-yellow-500/30 text-yellow-400">
              {warnCount} warning{warnCount !== 1 ? "s" : ""}
            </Badge>
          )}
          {infoCount > 0 && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 border-blue-500/30 text-blue-400">
              {infoCount} info
            </Badge>
          )}
          {issues.length === 0 && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 border-green-500/30 text-green-400">
              All clear
            </Badge>
          )}
        </div>
      </button>
      {open && issues.length > 0 && (
        <div className="px-2 pb-2 space-y-1">
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ForgeLogicCheck({ session, onComplete }: ForgeLogicCheckProps) {
  const { check, result, loading } = useForgeLogicCheck(session);

  const assemblies = useMemo(
    () =>
      (session.assembly_list?.length ? session.assembly_list : null) ??
      (session.spec_analysis?.assemblies as ForgeAssemblyEntry[] | undefined) ??
      [],
    [session],
  );

  const assemblyArtifacts = useMemo(
    () => ((session.assembly_artifacts as ForgeArtifact[]) ?? []).filter((a) => a.stage === "assembly_fb"),
    [session.assembly_artifacts],
  );

  const handleRunCheck = useCallback(() => {
    check(assemblies, assemblyArtifacts);
  }, [check, assemblies, assemblyArtifacts]);

  // Group issues by assembly
  const issuesByAssembly = useMemo(() => {
    if (!result) return new Map<string, LogicCheckIssue[]>();
    const map = new Map<string, LogicCheckIssue[]>();
    // Initialize with all assemblies (even those with no issues)
    for (const asm of assemblies) {
      map.set(asm.tag, []);
    }
    for (const issue of result.issues) {
      const existing = map.get(issue.assemblyTag) ?? [];
      existing.push(issue);
      map.set(issue.assemblyTag, existing);
    }
    return map;
  }, [result, assemblies]);

  const errorCount = result?.issues.filter((i) => i.severity === "error").length ?? 0;
  const warnCount = result?.issues.filter((i) => i.severity === "warning").length ?? 0;

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRunCheck}
          disabled={loading || assemblyArtifacts.length === 0}
          className="gap-2"
        >
          {result ? <RotateCcw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {result ? "Re-check" : "Run Logic Check"}
        </Button>

        {assemblyArtifacts.length === 0 && (
          <span className="text-[10px] text-muted-foreground">No assembly artifacts to check</span>
        )}

        <div className="flex-1" />

        {result && (
          <div className="flex items-center gap-2">
            {result.passed ? (
              <div className="flex items-center gap-1.5 text-green-400">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-xs font-semibold">Passed</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-red-400">
                <XCircle className="h-4 w-4" />
                <span className="text-xs font-semibold">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>
              </div>
            )}
            {warnCount > 0 && (
              <span className="text-[10px] text-yellow-400">{warnCount} warning{warnCount !== 1 ? "s" : ""}</span>
            )}

            <Badge variant="outline" className="font-mono text-[10px]">
              {result.assembliesChecked} assemblies — {result.artifactsChecked} artifacts
            </Badge>
          </div>
        )}

        {result && (
          <Button
            size="sm"
            onClick={() => onComplete(result)}
            variant={result.passed ? "default" : "outline"}
          >
            {result.passed ? "Continue" : "Continue with warnings"}
          </Button>
        )}

        {!result && assemblyArtifacts.length === 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onComplete({ passed: true, issues: [], checkedAt: new Date().toISOString(), assembliesChecked: 0, artifactsChecked: 0 })}
          >
            Skip — No assemblies to check
          </Button>
        )}
      </div>

      {/* Results */}
      {result ? (
        <ScrollArea className="flex-1">
          <div className="space-y-2 p-1">
            {[...issuesByAssembly.entries()].map(([tag, issues]) => (
              <AssemblyGroup
                key={tag}
                tag={tag}
                issues={issues}
                defaultOpen={issues.some((i) => i.severity === "error")}
              />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground/30" />
            <p className="text-sm">Run the logic check to validate assembly FBs</p>
            <p className="text-[10px]">
              Checks: state coverage, step sequences, permissives, timeouts, fault handling, interface signals, syntax
            </p>
            {session.spec_project_id && (
              <p className="text-[10px] text-blue-400">FDS-linked — will validate against the functional design specification</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
