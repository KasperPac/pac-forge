import { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Network,
  GitBranch,
  Shield,
  Zap,
  ShieldCheck,
  Maximize2,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Wrench,
  BookMarked,
  Cable,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { renderProcessFlowSvg } from "@/lib/process-flow-svg";
import { useForgeMatrixGenerate } from "@/hooks/use-forge-matrix-generate";
import { useForgeMatrixValidate } from "@/hooks/use-forge-matrix-validate";
import { useCreatePatternCandidate } from "@/hooks/use-patterns";
import { cn } from "@/lib/utils";
import type { ForgeSession, ForgeArtifact, ForgeIoEntry } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type { DesignProfile } from "@/types/design-profile";
import type { PatternCandidate, AgentKnowledgeDoc } from "@/types";
import type {
  FaultMatrixEntry,
  ProcessLinkageMatrix,
  LinkageDevice,
  ProcessSequence,
  ProcessStep,
  SequenceRow,
} from "@/types/forge-matrix";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ForgeMatrixReviewProps {
  session: ForgeSession;
  fbTemplates?: FbTemplate[];
  profile?: DesignProfile;
  patterns?: PatternCandidate[];
  agentKnowledgeDocs?: AgentKnowledgeDoc[];
  onComplete: (matrix: ProcessLinkageMatrix) => void | Promise<void>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function WireTypeBadge({ wireType }: { wireType: string }) {
  const variants: Record<string, string> = {
    io: "border-blue-500/40 bg-blue-500/10 text-blue-400",
    fb: "border-purple-500/40 bg-purple-500/10 text-purple-400",
    global: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    constant: "border-muted-foreground/40 bg-muted/30 text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "rounded border px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider",
        variants[wireType] ?? "border-border text-muted-foreground",
      )}
    >
      {wireType}
    </span>
  );
}

function DeviceCard({ device }: { device: LinkageDevice }) {
  const [expanded, setExpanded] = useState(false);
  const inWires = device.wiring.filter((w) => w.direction === "in");
  const outWires = device.wiring.filter((w) => w.direction === "out");

  return (
    <div className="rounded border border-border/60 bg-background/40">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/20 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{device.name}</span>
            <Badge variant="outline" className="font-mono text-[9px] shrink-0">
              {device.deviceType}
            </Badge>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            FB: {device.fbName} · DB: {device.instanceDbName}
          </div>
        </div>
        <div className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {device.wiring.length}w · {device.interlocks.length}il
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2 space-y-3">
          {inWires.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Inputs
              </div>
              <div className="space-y-1">
                {inWires.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="w-32 shrink-0 truncate font-mono text-foreground">
                      {w.paramName}
                    </span>
                    <span className="text-muted-foreground">←</span>
                    <WireTypeBadge wireType={w.wireType} />
                    <span className="truncate font-mono text-muted-foreground">
                      {w.connectedTo}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {outWires.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Outputs
              </div>
              <div className="space-y-1">
                {outWires.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="w-32 shrink-0 truncate font-mono text-foreground">
                      {w.paramName}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <WireTypeBadge wireType={w.wireType} />
                    <span className="truncate font-mono text-muted-foreground">
                      {w.connectedTo}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {device.interlocks.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Interlocks
              </div>
              <div className="space-y-1">
                {device.interlocks.map((il) => (
                  <div key={il.id} className="flex items-start gap-2 text-xs">
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 font-mono text-[9px]",
                        il.direction === "requires" &&
                          "border-amber-500/40 text-amber-400",
                        il.direction === "blocks" &&
                          "border-red-500/40 text-red-400",
                        il.direction === "follows" &&
                          "border-green-500/40 text-green-400",
                      )}
                    >
                      {il.direction}
                    </Badge>
                    <span className="text-muted-foreground">
                      {il.targetDeviceName}: {il.condition}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Best-effort conversion of legacy ProcessStep[] to SequenceRow[] for display. */
function migrateStepsToRows(steps: ProcessStep[]): SequenceRow[] {
  const rows: SequenceRow[] = [];
  for (const step of steps) {
    const conditions = step.transition?.conditions ?? [];
    const combinator = step.transition?.combinator ?? "AND";
    const actions = step.actions ?? [];
    const isOr = combinator === "OR" && conditions.length >= 2;

    const firstCond = conditions[0]?.description ?? "—";
    const mainActions = actions.length > 0 ? actions : [{ id: "", description: "(idle)", deviceName: null }];

    for (let i = 0; i < mainActions.length; i++) {
      const a = mainActions[i];
      const isMonitor = /\b(wait|monitor|poll|await)\b/i.test(a.description);
      // Try to extract "SIGNAL = VALUE" from the action text as the output field
      const outputMatch = a.description.match(/\b(\w+\s*=\s*(?:TRUE|FALSE|ON|OFF|0|1))\b/i);
      rows.push({
        step: step.stepNumber,
        branch: null,
        condition: i === 0 ? firstCond : "—",
        action: a.description,
        output: outputMatch ? outputMatch[1] : null,
        next: "IDLE",
        type: isMonitor ? "monitor" : "action",
        devices: step.devicesInvolved ?? [],
      });
    }

    // OR transition: extra conditions become branch rows
    if (isOr) {
      for (let ci = 1; ci < conditions.length; ci++) {
        const c = conditions[ci];
        rows.push({
          step: step.stepNumber,
          branch: String.fromCharCode(97 + ci), // "b", "c", ...
          condition: c.description,
          action: "Branch",
          output: null,
          next: c.targetStepNumber ?? "IDLE",
          type: "branch",
          devices: step.devicesInvolved ?? [],
        });
      }
    }
  }
  return rows;
}

const ROW_TYPE_COLORS: Record<string, string> = {
  action: "text-teal-400",
  branch: "text-blue-400",
  monitor: "text-purple-400",
  fault_exit: "text-red-400",
  merge: "text-amber-400",
};

type ColKey = "step" | "condition" | "action" | "output" | "next";
const COL_LABELS: Record<ColKey, string> = { step: "Step", condition: "Condition", action: "Action", output: "Output", next: "Next" };
const COLS: ColKey[] = ["step", "condition", "action", "output", "next"];

function SequenceRowsTable({ rows, highlightedSteps }: { rows: SequenceRow[]; highlightedSteps?: Set<number> }) {
  // null = auto layout (browser fits content); Record = user has dragged at least one column
  const [colWidths, setColWidths] = useState<Record<ColKey, number> | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const dragRef = useRef<{ col: ColKey; startX: number; startW: number } | null>(null);

  const onDragStart = (col: ColKey, e: React.MouseEvent) => {
    e.preventDefault();

    // On first drag: snapshot the browser's auto-computed widths so resize starts from reality
    let widths = colWidths;
    if (!widths && tableRef.current) {
      const ths = tableRef.current.querySelectorAll<HTMLElement>("thead th");
      widths = {} as Record<ColKey, number>;
      COLS.forEach((c, i) => { widths![c] = ths[i]?.offsetWidth ?? 120; });
      setColWidths(widths);
    }

    dragRef.current = { col, startX: e.clientX, startW: widths![col] ?? 120 };

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = me.clientX - dragRef.current.startX;
      setColWidths((prev) => ({
        ...prev!,
        [dragRef.current!.col]: Math.max(48, dragRef.current!.startW + delta),
      }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="w-full">
      <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        Sequence Rows
      </div>
      <div className="w-full overflow-x-auto rounded border border-border/40">
        <table
          ref={tableRef}
          className={cn("font-mono text-xs w-full", colWidths ? "table-fixed" : "table-auto")}
          style={colWidths ? { width: COLS.reduce((s, c) => s + colWidths[c], 0) } : undefined}
        >
          {colWidths && (
            <colgroup>
              {COLS.map((col) => (
                <col key={col} style={{ width: colWidths[col] }} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr className="border-b border-border/40 bg-muted/20 text-muted-foreground">
              {COLS.map((col, idx) => (
                <th key={col} className="relative px-2 py-1.5 text-left font-medium select-none">
                  {COL_LABELS[col]}
                  {idx < COLS.length - 1 && (
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary/80"
                      onMouseDown={(e) => onDragStart(col, e)}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  "border-b border-border/20 last:border-0 transition-colors",
                  highlightedSteps?.has(row.step)
                    ? "bg-amber-500/15 ring-1 ring-inset ring-amber-500/40"
                    : row.type === "fault_exit" ? "bg-red-500/5"
                    : row.type === "monitor" ? "bg-purple-500/5"
                    : row.type === "branch" ? "bg-blue-500/5"
                    : "",
                )}
              >
                <td className="px-2 py-1.5 whitespace-nowrap overflow-hidden">
                  <span className="font-bold text-primary">{row.step}</span>
                  {row.branch && (
                    <span className="ml-0.5 text-muted-foreground">{row.branch}</span>
                  )}
                  <span className={cn("ml-1.5 text-[10px]", ROW_TYPE_COLORS[row.type] ?? "text-muted-foreground")}>
                    {row.type}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground truncate overflow-hidden">{row.condition}</td>
                <td className="px-2 py-1.5 text-foreground font-medium truncate overflow-hidden">{row.action}</td>
                <td className="px-2 py-1.5 text-teal-400 truncate overflow-hidden">{row.output ?? "—"}</td>
                <td className={cn(
                  "px-2 py-1.5 whitespace-nowrap overflow-hidden",
                  row.next === "FAULT" ? "text-red-400 font-bold" : row.next === "IDLE" ? "text-amber-400 font-bold" : "text-muted-foreground",
                )}>
                  {String(row.next)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SequenceCard({ seq, highlightedSteps, autoExpand }: { seq: ProcessSequence; highlightedSteps?: Set<number>; autoExpand?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasHighlight = highlightedSteps && highlightedSteps.size > 0;

  useEffect(() => {
    if (autoExpand && hasHighlight) setExpanded(true);
  }, [autoExpand, hasHighlight]);

  return (
    <div className="rounded border border-border/60 bg-background/40">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/20 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{seq.name}</span>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {seq.rows
              ? `${seq.rows.filter(r => r.type !== "fault_exit").length} rows`
              : `${(seq.steps ?? []).length} steps`
            } · {seq.permissives.length} permissives
            {seq.safetyConditions.length > 0 &&
              ` · ${seq.safetyConditions.length} safety`}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2 space-y-3">
          {seq.permissives.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                <Shield className="h-2.5 w-2.5" />
                Permissives
              </div>
              <div className="space-y-0.5">
                {seq.permissives.map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5 text-xs">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        p.polarity ? "bg-green-500" : "bg-red-500",
                      )}
                    />
                    <span className="text-muted-foreground">{p.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {seq.safetyConditions.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-amber-500">
                <Zap className="h-2.5 w-2.5" />
                Safety Conditions
              </div>
              <div className="space-y-0.5">
                {seq.safetyConditions.map((sc) => (
                  <div key={sc.id} className="flex items-center gap-1.5 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-amber-500" />
                    <span className="text-muted-foreground">{sc.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <SequenceRowsTable
            rows={
              seq.rows && seq.rows.length > 0
                ? seq.rows
                : migrateStepsToRows(seq.steps ?? [])
            }
            highlightedSteps={highlightedSteps}
          />
        </div>
      )}
    </div>
  );
}

function FaultCard({ fault }: { fault: FaultMatrixEntry }) {
  return (
    <div className="rounded border border-border/60 bg-background/40 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[9px] shrink-0">
              {fault.code}
            </Badge>
            <span className="truncate text-sm font-medium">{fault.description}</span>
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            Tag: {fault.tag} · Source: {fault.source}
          </div>
        </div>
        <Badge variant="outline" className="font-mono text-[9px] shrink-0">
          {fault.severity}
        </Badge>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-2">
        <div className="rounded border border-border/40 bg-background/30 p-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Condition
          </div>
          <div className="font-mono text-[11px] text-foreground break-words">
            {fault.condition}
          </div>
        </div>
        <div className="rounded border border-border/40 bg-background/30 p-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Reset
          </div>
          <div className="font-mono text-[11px] text-foreground break-words">
            {fault.resetCondition ?? "Manual reset only"}
          </div>
        </div>
      </div>

      {fault.affectsSequences.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {fault.affectsSequences.map((sequenceName) => (
            <Badge key={sequenceName} variant="outline" className="font-mono text-[9px]">
              {sequenceName}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ForgeMatrixReview({ session, fbTemplates, profile, patterns, agentKnowledgeDocs, onComplete }: ForgeMatrixReviewProps) {
  const [matrix, setMatrix] = useState<ProcessLinkageMatrix | null>(
    session.linkage_matrix,
  );
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [diagramFullscreen, setDiagramFullscreen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const { generate, loading, error } = useForgeMatrixGenerate();

  const [activeTab, setActiveTab] = useState<"devices" | "sequences" | "faults" | "wiring">("devices");
  const [selectedSeqId, setSelectedSeqId] = useState<string | undefined>(undefined);
  const { validate, applySelectedFixes, fixDiagnostic, loading: validating, applying: applyingFixes, result: validationResult, clear: clearValidation } = useForgeMatrixValidate();
  const createPattern = useCreatePatternCandidate();
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [dismissedIssueIds, setDismissedIssueIds] = useState<Set<string>>(new Set());
  const [savedToLibrary, setSavedToLibrary] = useState<Set<string>>(new Set());
  const [applyError, setApplyError] = useState<string | null>(null);
  const [fixingDiagIdx, setFixingDiagIdx] = useState<number | null>(null);
  const [diagInstruction, setDiagInstruction] = useState("");
  const [diagDrawerOpen, setDiagDrawerOpen] = useState(false);
  const [activeDiagIdx, setActiveDiagIdx] = useState<number | null>(null);
  const [highlightedSeqName, setHighlightedSeqName] = useState<string | null>(null);
  const [highlightedSteps, setHighlightedSteps] = useState<Set<number>>(new Set());

  // Auto-generate on mount if no matrix exists
  useEffect(() => {
    if (!matrix && !loading) {
      void handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    try {
      const deviceFbArtifacts = (session.device_artifacts as ForgeArtifact[] | null)
        ?.filter((a) => a.stage === "device_fb") ?? [];
      const result = await generate(
        session.device_list,
        session.io_list,
        session.spec_analysis,
        fbTemplates,
        deviceFbArtifacts,
        profile,
        patterns,
        agentKnowledgeDocs,
      );
      setMatrix(result);
    } catch {
      // error shown from hook
    }
  }

  async function handleConfirm() {
    if (!matrix) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      await Promise.resolve(onComplete(matrix));
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : "Failed to advance step");
    } finally {
      setCompleting(false);
    }
  }

  const activeSeq = matrix?.processSequences?.length
    ? (selectedSeqId
        ? matrix.processSequences.find((s) => s.id === selectedSeqId) ?? matrix.processSequences[0]
        : matrix.processSequences[0])
    : null;

  const hasDiagram = !!(activeSeq?.rows?.length || activeSeq?.steps?.length);

  return (
    <div className="flex h-full gap-2 min-h-0">
      {/* Left panel — Matrix editor */}
      {leftCollapsed ? (
        <div className="flex w-7 shrink-0 flex-col items-center gap-2 py-1">
          <button
            type="button"
            title="Expand matrix panel"
            onClick={() => setLeftCollapsed(false)}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground transition-colors"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1 flex items-center justify-center">
            <span
              className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground whitespace-nowrap"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              Matrix
            </span>
          </div>
        </div>
      ) : (
      <div className={cn("flex shrink-0 flex-col gap-3 min-h-0 transition-all", rightCollapsed ? "flex-1" : "w-[55%]")}>
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Process Linkage Matrix
            </span>
            {matrix && (
              <Badge variant="outline" className="font-mono text-[9px]">
                {matrix.deviceLinkage.length} devices · {matrix.processSequences.length} sequences
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 font-mono text-xs"
              onClick={handleGenerate}
              disabled={loading || completing || validating}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {matrix ? "Regenerate" : "Generate Matrix"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 font-mono text-xs"
              onClick={() => { clearValidation(); setSelectedIssueIds(new Set()); setSavedToLibrary(new Set()); setApplyError(null); if (matrix) void validate(matrix); }}
              disabled={!matrix || loading || completing || validating}
            >
              {validating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              Validate
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1.5 font-mono text-xs"
              onClick={handleConfirm}
              disabled={!matrix || loading || completing || validating}
            >
              {completing ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
              ) : (
                <><CheckCircle2 className="h-3.5 w-3.5" /> Confirm & Continue</>
              )}
            </Button>
            <button
              type="button"
              title="Collapse matrix panel"
              onClick={() => setLeftCollapsed(true)}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground transition-colors"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Error */}
        {(error ?? completeError) && (
          <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error ?? completeError}
          </div>
        )}

        {/* Validation result */}
        {validationResult && (
          <div className={cn(
            "rounded border px-3 py-2 text-xs space-y-2",
            validationResult.verdict === "ok" && "border-green-500/30 bg-green-500/10 text-green-400",
            validationResult.verdict === "warnings" && "border-amber-500/30 bg-amber-500/10 text-amber-400",
            validationResult.verdict === "errors" && "border-red-500/30 bg-red-950/40 text-red-300",
          )}>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-mono font-medium uppercase tracking-wider text-[10px]">
                <ShieldCheck className="h-3 w-3" />
                PM Validation — {validationResult.verdict}
                {validationResult.timerFixCount > 0 && (
                  <span className="text-muted-foreground normal-case tracking-normal">
                    · {validationResult.timerFixCount} timer value{validationResult.timerFixCount !== 1 ? "s" : ""} auto-fixed
                  </span>
                )}
              </div>
              {validationResult.correctedMatrix && (
                <button
                  type="button"
                  className="rounded border border-current px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider hover:opacity-80 transition-opacity"
                  onClick={() => { setMatrix(validationResult.correctedMatrix!); clearValidation(); }}
                >
                  Apply T# Fixes
                </button>
              )}
            </div>

            {/* Per-issue checkboxes */}
            {validationResult.fixableIssues.length > 0 && (() => {
              const activeIssues = validationResult.fixableIssues.filter(i => !dismissedIssueIds.has(i.id));
              const dismissedCount = validationResult.fixableIssues.length - activeIssues.length;
              return (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] opacity-70 uppercase tracking-wider">
                    Issues ({activeIssues.length}){dismissedCount > 0 ? ` · ${dismissedCount} dismissed` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    {dismissedCount > 0 && (
                      <button
                        type="button"
                        className="font-mono text-[10px] opacity-40 hover:opacity-80 transition-opacity"
                        onClick={() => setDismissedIssueIds(new Set())}
                      >
                        Show dismissed
                      </button>
                    )}
                    <button
                      type="button"
                      className="font-mono text-[10px] opacity-60 hover:opacity-100 transition-opacity"
                      onClick={() => {
                        const allIds = new Set(activeIssues.map(i => i.id));
                        setSelectedIssueIds(prev => prev.size === allIds.size ? new Set() : allIds);
                      }}
                    >
                      {selectedIssueIds.size === activeIssues.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                </div>
                {activeIssues.map(issue => (
                  <label
                    key={issue.id}
                    className="flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-white/5 transition-colors group"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3 w-3 shrink-0 accent-current"
                      checked={selectedIssueIds.has(issue.id)}
                      onChange={e => {
                        setSelectedIssueIds(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(issue.id) : next.delete(issue.id);
                          return next;
                        });
                      }}
                    />
                    <div className="min-w-0 space-y-0.5 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          "font-mono text-[9px] uppercase tracking-wider px-1 rounded",
                          issue.severity === "error" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300",
                        )}>
                          {issue.severity}
                        </span>
                        <span className="opacity-60 font-mono text-[10px]">{issue.field}</span>
                        <button
                          type="button"
                          className="ml-auto font-mono text-[9px] opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity"
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDismissedIssueIds(prev => new Set([...prev, issue.id]));
                            setSelectedIssueIds(prev => { const next = new Set(prev); next.delete(issue.id); return next; });
                          }}
                        >
                          dismiss
                        </button>
                      </div>
                      <div>{issue.description}</div>
                      <div className="opacity-70">→ {issue.suggestedFix}</div>
                    </div>
                  </label>
                ))}
              </div>
              ); })()}

            {/* Apply selected button */}
            {selectedIssueIds.size > 0 && matrix && (
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={applyingFixes}
                  className="flex items-center gap-1.5 rounded border border-current px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider hover:opacity-80 transition-opacity disabled:opacity-40"
                  onClick={async () => {
                    setApplyError(null);
                    const selected = validationResult.fixableIssues.filter(i => selectedIssueIds.has(i.id));
                    try {
                      const corrected = await applySelectedFixes(matrix, selected);
                      setMatrix(corrected);
                      // Mark as available for library save
                      setSavedToLibrary(new Set());
                      // Remove applied issues from result
                      clearValidation();
                    } catch (err) {
                      setApplyError(err instanceof Error ? err.message : String(err));
                    }
                  }}
                >
                  {applyingFixes ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                  Apply {selectedIssueIds.size} Fix{selectedIssueIds.size !== 1 ? "es" : ""}
                </button>
                <button
                  type="button"
                  disabled={applyingFixes || createPattern.isPending}
                  className="flex items-center gap-1.5 rounded border border-current px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider hover:opacity-80 transition-opacity disabled:opacity-40 opacity-70"
                  onClick={async () => {
                    const selected = validationResult.fixableIssues.filter(
                      i => selectedIssueIds.has(i.id) && !savedToLibrary.has(i.id)
                    );
                    for (const issue of selected) {
                      await createPattern.mutateAsync({
                        plc_brand: "SIEMENS_TIA",
                        device_type: issue.field.split("[")[0] ?? "matrix",
                        context: `Matrix validation: ${issue.field}`,
                        original_snippet: issue.wrongSnippet,
                        corrected_snippet: issue.correctSnippet,
                        correction_type: "matrix_validation",
                        explanation_tag: issue.description,
                      });
                    }
                    setSavedToLibrary(prev => {
                      const next = new Set(prev);
                      selected.forEach(i => next.add(i.id));
                      return next;
                    });
                  }}
                >
                  {createPattern.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookMarked className="h-3 w-3" />}
                  Save {selectedIssueIds.size - savedToLibrary.size > 0
                    ? `${selectedIssueIds.size - savedToLibrary.size} `
                    : ""}to Library
                </button>
              </div>
            )}

            {applyError && (
              <div className="text-destructive text-[10px] font-mono">{applyError}</div>
            )}

            {/* Compiler diagnostics — open drawer */}
            {validationResult.compilerDiagnostics.length > 0 && (
              <div className="pt-1 border-t border-current/10">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 font-mono text-[10px] hover:bg-white/5 transition-colors"
                  onClick={() => { setDiagDrawerOpen(true); setActiveTab("sequences"); }}
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="uppercase tracking-wider font-medium">
                    {validationResult.compilerDiagnostics.filter(d => d.severity === "error").length} error(s),{" "}
                    {validationResult.compilerDiagnostics.filter(d => d.severity === "warning").length} warning(s)
                  </span>
                  <span className="ml-auto opacity-60">Show &rarr;</span>
                </button>
              </div>
            )}

            {/* Suggestions */}
            {validationResult.suggestions.length > 0 && (
              <div className="space-y-0.5 pt-0.5 border-t border-current/10">
                <div className="font-mono text-[10px] opacity-70 uppercase tracking-wider">Suggestions</div>
                {validationResult.suggestions.map((s, i) => <div key={i} className="pl-2 opacity-80">· {s}</div>)}
              </div>
            )}
          </div>
        )}

        {/* Loading state */}
        {loading && !matrix && (
          <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">PM agent is generating the matrix…</span>
          </div>
        )}

        {/* Matrix content */}
        {matrix && (
          <>
            {/* Tabs */}
            <div className="flex gap-1 border-b border-border/60 pb-0">
              <button
                type="button"
                onClick={() => setActiveTab("devices")}
                className={cn(
                  "flex items-center gap-1.5 px-3 pb-2 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  activeTab === "devices"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Network className="h-3 w-3" />
                Devices ({matrix.deviceLinkage.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("sequences")}
                className={cn(
                  "flex items-center gap-1.5 px-3 pb-2 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  activeTab === "sequences"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <GitBranch className="h-3 w-3" />
                Sequences ({matrix.processSequences.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("wiring")}
                className={cn(
                  "flex items-center gap-1.5 px-3 pb-2 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  activeTab === "wiring"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Cable className="h-3 w-3" />
                Wiring Map
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("faults")}
                className={cn(
                  "flex items-center gap-1.5 px-3 pb-2 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  activeTab === "faults"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Shield className="h-3 w-3" />
                Faults ({matrix.faultMatrix?.length ?? 0})
              </button>
            </div>

            <ScrollArea className="flex-1">
              <div className="space-y-2 pr-1">
                {activeTab === "devices" && (
                  <>
                    {matrix.deviceLinkage.map((device) => (
                      <DeviceCard key={device.id} device={device} />
                    ))}
                    {matrix.deviceLinkage.length === 0 && (
                      <div className="py-6 text-center font-mono text-xs text-muted-foreground">
                        No devices in matrix
                      </div>
                    )}
                  </>
                )}

                {activeTab === "sequences" && (
                  <>
                    {matrix.processSequences.map((seq) => (
                      <SequenceCard
                        key={seq.id}
                        seq={seq}
                        highlightedSteps={highlightedSeqName === seq.name ? highlightedSteps : undefined}
                        autoExpand={highlightedSeqName === seq.name}
                      />
                    ))}
                    {matrix.processSequences.length === 0 && (
                      <div className="py-6 text-center font-mono text-xs text-muted-foreground">
                        No sequences in matrix
                      </div>
                    )}
                  </>
                )}

                {activeTab === "wiring" && (
                  <WiringMapPanel matrix={matrix} ioList={session.io_list} />
                )}

                {activeTab === "faults" && (
                  <>
                    {(matrix.faultMatrix ?? []).map((fault) => (
                      <FaultCard key={fault.id} fault={fault} />
                    ))}
                    {(matrix.faultMatrix?.length ?? 0) === 0 && (
                      <div className="py-6 text-center font-mono text-xs text-muted-foreground">
                        No faults in matrix
                      </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>

            {matrix.notes && (
              <div className="rounded border border-border/40 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
                {matrix.notes}
              </div>
            )}
          </>
        )}
      </div>
      )} {/* end left panel conditional */}

      {/* Right panel — Sequence diagram */}
      {rightCollapsed ? (
        <div className="flex w-7 shrink-0 flex-col items-center gap-2 py-1">
          <button
            type="button"
            title="Expand diagram panel"
            onClick={() => setRightCollapsed(false)}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground transition-colors"
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1 flex items-center justify-center">
            <span
              className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground whitespace-nowrap"
              style={{ writingMode: "vertical-rl" }}
            >
              Diagram
            </span>
          </div>
        </div>
      ) : (
      <div className={cn("flex min-w-0 flex-col gap-2 min-h-0", leftCollapsed ? "flex-1" : "flex-1")}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Sequence Diagram
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {matrix && matrix.processSequences.length > 1 && (
              <select
                value={selectedSeqId ?? matrix.processSequences[0]?.id ?? ""}
                onChange={(e) => setSelectedSeqId(e.target.value)}
                className="h-6 rounded border border-input bg-background px-2 font-mono text-[10px] text-foreground"
              >
                {matrix.processSequences.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            {hasDiagram && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                title="Fullscreen"
                onClick={() => setDiagramFullscreen(true)}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <button
              type="button"
              title="Collapse diagram panel"
              onClick={() => setRightCollapsed(true)}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground transition-colors"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded-md border border-border/60 bg-background/40 p-3 min-h-0">
          {loading && !matrix ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Waiting for matrix…
            </div>
          ) : activeSeq ? (
            <div
              className="w-full"
              dangerouslySetInnerHTML={{ __html: renderProcessFlowSvg(activeSeq) }}
            />
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
              No process sequences defined
            </div>
          )}
        </div>
      </div>
      )} {/* end right panel conditional */}

      {/* Diagnostics drawer */}
      {diagDrawerOpen && validationResult && validationResult.compilerDiagnostics.length > 0 && (
        <div className="w-[320px] shrink-0 flex flex-col border-l border-border/60 bg-card/50 min-h-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <AlertCircle className="h-3 w-3" />
              Diagnostics ({validationResult.compilerDiagnostics.length})
            </div>
            <button
              type="button"
              onClick={() => { setDiagDrawerOpen(false); setActiveDiagIdx(null); setHighlightedSteps(new Set()); setHighlightedSeqName(null); }}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2 space-y-1">
              {validationResult.compilerDiagnostics.map((d, i) => {
                const seqName = d.title.split(":")[0]?.trim() ?? "";
                const isActive = activeDiagIdx === i;
                return (
                  <div key={i} className={cn(
                    "rounded border px-2 py-1.5 transition-colors cursor-pointer space-y-1.5",
                    isActive
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-transparent hover:bg-white/5",
                  )}>
                    <div
                      className="flex items-start gap-2"
                      onClick={() => {
                        if (isActive) {
                          setActiveDiagIdx(null);
                          setHighlightedSteps(new Set());
                          setHighlightedSeqName(null);
                        } else {
                          setActiveDiagIdx(i);
                          setHighlightedSteps(new Set(d.affectedSteps));
                          setHighlightedSeqName(seqName);
                          setActiveTab("sequences");
                        }
                        setFixingDiagIdx(null);
                        setDiagInstruction("");
                      }}
                    >
                      <span className={cn(
                        "mt-0.5 shrink-0 font-mono text-[9px] uppercase tracking-wider px-1 rounded",
                        d.severity === "error" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300",
                      )}>
                        {d.severity}
                      </span>
                      <div className="min-w-0 space-y-0.5 flex-1">
                        <div className="font-mono text-[10px] opacity-60">{d.category}</div>
                        <div className="text-xs">{d.title}</div>
                        <div className="text-xs opacity-70">{d.description}</div>
                        {d.affectedSteps.length > 0 && (
                          <div className="opacity-50 font-mono text-[10px]">
                            Steps: {d.affectedSteps.join(", ")}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Fix panel — inline in the active diagnostic */}
                    {isActive && (
                      <div className="pt-1 space-y-1.5 border-t border-border/30">
                        <textarea
                          className="w-full rounded border border-border/50 bg-background/50 px-2 py-1.5 font-mono text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                          rows={2}
                          placeholder="How should this be fixed? (optional)"
                          value={fixingDiagIdx === i ? diagInstruction : ""}
                          onChange={(e) => { setFixingDiagIdx(i); setDiagInstruction(e.target.value); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          type="button"
                          disabled={applyingFixes}
                          className="flex w-full items-center justify-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!matrix) return;
                            try {
                              setApplyError(null);
                              const corrected = await fixDiagnostic(matrix, d, diagInstruction || undefined);
                              setMatrix(corrected);
                              setFixingDiagIdx(null);
                              setDiagInstruction("");
                              setActiveDiagIdx(null);
                              setHighlightedSteps(new Set());
                              setHighlightedSeqName(null);
                              clearValidation();
                            } catch (err) {
                              setApplyError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                        >
                          {applyingFixes ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                          Apply Fix
                        </button>
                        {applyError && (
                          <div className="text-destructive text-[10px] font-mono">{applyError}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Fullscreen diagram dialog */}
      <Dialog open={diagramFullscreen} onOpenChange={setDiagramFullscreen}>
        <DialogContent className="flex h-[95vh] max-w-[95vw] flex-col gap-0 p-0 overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-2">
            <div className="flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5 text-primary" />
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {activeSeq?.name ?? "Sequence Diagram"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setDiagramFullscreen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {activeSeq && (
              <div dangerouslySetInnerHTML={{ __html: renderProcessFlowSvg(activeSeq) }} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Wiring Map Panel ─────────────────────────────────────────────────────────

type PillVariant =
  | "param"
  | "io-input"
  | "io-output"
  | "tag-input"
  | "tag-output"
  | "process-var"
  | "conversion"
  | "global"
  | "constant"
  | "datatype"
  | "behaviour"
  | "interlock-requires"
  | "interlock-blocks"
  | "interlock-follows";

const PILL_STYLES: Record<PillVariant, string> = {
  param:              "bg-slate-500/15 text-slate-200 border-slate-400/30",
  "io-input":         "bg-blue-500/15 text-blue-300 border-blue-500/40",
  "io-output":        "bg-green-500/15 text-green-300 border-green-500/40",
  "tag-input":        "bg-sky-500/10 text-sky-300 border-sky-500/30",
  "tag-output":       "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  "process-var":      "bg-purple-500/15 text-purple-300 border-purple-500/40",
  conversion:         "bg-orange-500/15 text-orange-300 border-orange-500/40",
  global:             "bg-amber-500/15 text-amber-300 border-amber-500/40",
  constant:           "bg-rose-500/15 text-rose-300 border-rose-500/40",
  datatype:           "bg-muted/40 text-muted-foreground border-border/40",
  behaviour:          "bg-yellow-500/10 text-yellow-300/90 border-yellow-500/30",
  "interlock-requires": "bg-amber-500/15 text-amber-300 border-amber-500/40",
  "interlock-blocks":   "bg-red-500/15 text-red-300 border-red-500/40",
  "interlock-follows":  "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
};

function Pill({ variant, children, title }: { variant: PillVariant; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0 font-mono text-[10px] leading-[18px] whitespace-nowrap",
        PILL_STYLES[variant],
      )}
    >
      {children}
    </span>
  );
}

interface IoLookup {
  byTag: Map<string, ForgeIoEntry>;
}

function buildIoLookup(ioList: ForgeIoEntry[]): IoLookup {
  const byTag = new Map<string, ForgeIoEntry>();
  for (const io of ioList) {
    if (io.tag_name) byTag.set(io.tag_name.toLowerCase(), io);
  }
  return { byTag };
}

function resolveIoEntry(connectedTo: string, lookup: IoLookup): ForgeIoEntry | null {
  const dbFieldMatch = connectedTo.match(/^"(?:Inputs|Outputs)"\.(.+)$/);
  const fieldName = dbFieldMatch ? dbFieldMatch[1] : connectedTo;
  return lookup.byTag.get(fieldName.toLowerCase()) ?? null;
}

interface SignalChain {
  id: string;
  ioTag: string | null;
  ioAddr: string | null;
  ioType: "DI" | "DQ" | "AI" | "AQ" | "CONST" | "GLOBAL";
  ioDesc: string | null;
  fbDevice: string;
  fbParam: string;
  fbName: string;
  instanceDb: string;
  globalField: string | null;
  globalDb: string | null;
  seqUsages: Array<{ seqName: string; step: number; role: "condition" | "output"; text: string }>;
  broken: boolean;
  direction: "in" | "out";
}

function buildSignalChains(
  matrix: ProcessLinkageMatrix,
  ioList: ForgeSession["io_list"],
): SignalChain[] {
  const lookup = buildIoLookup(ioList ?? []);
  const chains: SignalChain[] = [];

  // Build a set of all global DB field references used in sequences
  const seqFieldUsages = new Map<string, Array<{ seqName: string; step: number; role: "condition" | "output"; text: string }>>();
  for (const seq of matrix.processSequences ?? []) {
    for (const row of seq.rows ?? []) {
      const texts: Array<{ text: string; role: "condition" | "output" }> = [];
      if (row.condition) texts.push({ text: row.condition, role: "condition" });
      if (row.output) texts.push({ text: row.output, role: "output" });
      for (const { text, role } of texts) {
        const re = /DB_\w+\.([a-zA-Z_]\w*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const fullRef = text.slice(m.index, m.index + m[0].length);
          const key = fullRef.toLowerCase();
          const list = seqFieldUsages.get(key) ?? [];
          if (!list.some(u => u.seqName === seq.name && u.step === row.step && u.role === role)) {
            list.push({ seqName: seq.name, step: row.step, role, text: row.action || text });
          }
          seqFieldUsages.set(key, list);
        }
      }
    }
  }

  for (const device of matrix.deviceLinkage) {
    for (const wire of device.wiring) {
      const io = wire.wireType === "io" ? resolveIoEntry(wire.connectedTo, lookup) : null;
      const isGlobal = wire.wireType === "global";
      const isConstant = wire.wireType === "constant";

      const globalField = isGlobal ? wire.connectedTo?.split(".")?.pop() ?? null : null;
      const globalDb = isGlobal ? wire.connectedTo?.split(".")?.[0] ?? null : null;

      // For output wires going to global DBs, look up sequence usages of that field
      const globalRef = isGlobal ? wire.connectedTo : null;
      // For output wires going to IO, the signal chain ends at the physical output
      const usages = globalRef ? (seqFieldUsages.get(`db_${globalRef}`.toLowerCase()) ?? seqFieldUsages.get(globalRef.toLowerCase()) ?? []) : [];

      // Also check with DB_ prefix
      if (usages.length === 0 && globalRef) {
        const withPrefix = globalRef.startsWith("DB_") ? globalRef : `DB_${globalRef}`;
        const found = seqFieldUsages.get(withPrefix.toLowerCase()) ?? [];
        if (found.length > 0) usages.push(...found);
      }

      const ioType: SignalChain["ioType"] = wire.wireType === "io"
        ? (io?.signal_type as "DI" | "DQ" | "AI" | "AQ") ?? "DI"
        : wire.wireType === "constant" ? "CONST" : "GLOBAL";

      const broken = wire.direction === "out" && isGlobal && usages.length === 0
        && !wire.connectedTo?.includes("HmiData");

      chains.push({
        id: wire.id,
        ioTag: wire.wireType === "io" ? wire.connectedTo : (isConstant ? wire.connectedTo : null),
        ioAddr: io?.address ?? null,
        ioType,
        ioDesc: io?.description ?? null,
        fbDevice: device.name,
        fbParam: wire.paramName,
        fbName: device.fbName,
        instanceDb: device.instanceDbName,
        globalField,
        globalDb,
        globalRef,
        seqUsages: usages,
        broken,
        direction: wire.direction,
      });
    }
  }

  return chains;
}

function ChainRow({ chain }: { chain: SignalChain & { globalRef: string | null } }) {
  const arrow = "→";
  const isBroken = chain.broken;

  return (
    <div className={cn(
      "flex items-center gap-1 flex-wrap py-0.5 font-mono text-[10px]",
      isBroken && "opacity-60",
    )}>
      {/* Source */}
      {chain.ioType === "CONST" ? (
        <Pill variant="constant">{chain.ioTag}</Pill>
      ) : chain.ioType === "GLOBAL" && chain.direction === "in" ? (
        <Pill variant="global">{chain.globalRef ?? "?"}</Pill>
      ) : chain.ioTag ? (
        <>
          <Pill variant={chain.direction === "in" ? "tag-input" : "tag-output"}>{chain.ioTag}</Pill>
          {chain.ioAddr && (
            <Pill variant={chain.direction === "in" ? "io-input" : "io-output"}>{chain.ioAddr}</Pill>
          )}
        </>
      ) : null}

      <span className="text-muted-foreground/40">{arrow}</span>

      {/* FB */}
      <Pill variant="param">{chain.fbDevice}.{chain.fbParam}</Pill>

      {/* Global DB field (for outputs) */}
      {chain.direction === "out" && chain.globalRef && (
        <>
          <span className="text-muted-foreground/40">{arrow}</span>
          <Pill variant="global">{chain.globalRef}</Pill>
        </>
      )}

      {/* Sequence usages */}
      {chain.seqUsages.length > 0 && (
        <>
          <span className="text-muted-foreground/40">{arrow}</span>
          {chain.seqUsages.slice(0, 3).map((u, i) => (
            <Pill key={i} variant={u.role === "condition" ? "process-var" : "interlock-follows"}>
              {u.seqName.replace(/ Sequence/, "").slice(0, 12)} S{u.step}
            </Pill>
          ))}
          {chain.seqUsages.length > 3 && (
            <span className="text-muted-foreground/50">+{chain.seqUsages.length - 3}</span>
          )}
        </>
      )}

      {/* Broken chain indicator */}
      {isBroken && (
        <Pill variant="interlock-blocks">⚠ NO SEQ USAGE</Pill>
      )}

      {/* Description */}
      {chain.ioDesc && (
        <span className="text-muted-foreground/50 ml-1">— {chain.ioDesc}</span>
      )}
    </div>
  );
}

function WiringMapPanel({
  matrix,
  ioList,
}: {
  matrix: ProcessLinkageMatrix;
  ioList: ForgeSession["io_list"];
}) {
  if (!matrix || matrix.deviceLinkage.length === 0) {
    return (
      <div className="py-6 text-center font-mono text-xs text-muted-foreground">
        No wiring data available — generate the matrix first.
      </div>
    );
  }

  const chains = buildSignalChains(matrix, ioList);
  const inputChains = chains.filter(c => c.direction === "in");
  const outputChains = chains.filter(c => c.direction === "out");
  const brokenCount = chains.filter(c => c.broken).length;

  // Group by device
  const deviceGroups = new Map<string, SignalChain[]>();
  for (const chain of chains) {
    const list = deviceGroups.get(chain.fbDevice) ?? [];
    list.push(chain);
    deviceGroups.set(chain.fbDevice, list);
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="rounded border border-border/40 bg-muted/20 px-3 py-2 flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] text-muted-foreground">
          {inputChains.length} inputs · {outputChains.length} outputs · {chains.length} total chains
        </span>
        {brokenCount > 0 && (
          <Pill variant="interlock-blocks">⚠ {brokenCount} broken chain{brokenCount > 1 ? "s" : ""}</Pill>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <span className="font-mono text-[10px] text-muted-foreground/60">Flow:</span>
          <Pill variant="tag-input">IO</Pill>
          <span className="text-muted-foreground/40 text-[10px]">→</span>
          <Pill variant="param">FB.param</Pill>
          <span className="text-muted-foreground/40 text-[10px]">→</span>
          <Pill variant="global">Global DB</Pill>
          <span className="text-muted-foreground/40 text-[10px]">→</span>
          <Pill variant="process-var">Sequence</Pill>
        </div>
      </div>

      {/* Signal chains grouped by device */}
      {[...deviceGroups.entries()].map(([deviceName, deviceChains]) => {
        const device = matrix.deviceLinkage.find(d => d.name === deviceName);
        const ins = deviceChains.filter(c => c.direction === "in");
        const outs = deviceChains.filter(c => c.direction === "out");
        const hasBroken = deviceChains.some(c => c.broken);

        return (
          <div key={deviceName} className={cn(
            "rounded border bg-card/50 p-3",
            hasBroken ? "border-red-500/30" : "border-border/40",
          )}>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h4 className="font-mono text-xs font-semibold text-foreground">{deviceName}</h4>
              <Pill variant="process-var">{device?.fbName ?? ""}</Pill>
              <Pill variant="global">{device?.instanceDbName ?? ""}</Pill>
              <span className="font-mono text-[10px] text-muted-foreground/60 ml-auto">
                {ins.length}↓ {outs.length}↑
              </span>
            </div>

            {ins.length > 0 && (
              <div className="mb-1">
                <div className="font-mono text-[10px] uppercase tracking-wider text-blue-400/60 mb-0.5">Input chains</div>
                <div className="pl-2 border-l border-blue-500/20">
                  {ins.map(c => <ChainRow key={c.id} chain={c} />)}
                </div>
              </div>
            )}

            {outs.length > 0 && (
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-green-400/60 mb-0.5">Output chains</div>
                <div className="pl-2 border-l border-green-500/20">
                  {outs.map(c => <ChainRow key={c.id} chain={c} />)}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Global data blocks */}
      {matrix.globalData.filter((gd) => gd.fields.length > 0).length > 0 && (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
          <h4 className="font-mono text-xs font-semibold text-amber-400/90 mb-2">Global Data Blocks</h4>
          <div className="space-y-2">
            {matrix.globalData.filter((gd) => gd.fields.length > 0).map((gd) => (
              <div key={gd.id}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Pill variant="global">{gd.dbName}</Pill>
                  <span className="font-mono text-[10px] text-muted-foreground/80">— {gd.purpose}</span>
                </div>
                <div className="pl-2 border-l border-amber-500/20 mt-1 space-y-0.5">
                  {gd.fields.map((f) => (
                    <div key={f.id} className="flex items-center gap-1.5 flex-wrap py-0.5">
                      <Pill variant="param">{f.fieldName}</Pill>
                      <Pill variant="datatype">{f.dataType}</Pill>
                      <span className="font-mono text-[10px] text-muted-foreground/70">— {f.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
