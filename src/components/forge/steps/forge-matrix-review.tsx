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
import { buildWiringContext } from "@/lib/wiring-context";
import type { ForgeSession, ForgeArtifact } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type {
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

function SequenceRowsTable({ rows }: { rows: SequenceRow[] }) {
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
                  "border-b border-border/20 last:border-0",
                  row.type === "fault_exit" && "bg-red-500/5",
                  row.type === "monitor" && "bg-purple-500/5",
                  row.type === "branch" && "bg-blue-500/5",
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

function SequenceCard({ seq }: { seq: ProcessSequence }) {
  const [expanded, setExpanded] = useState(false);

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
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ForgeMatrixReview({ session, fbTemplates, onComplete }: ForgeMatrixReviewProps) {
  const [matrix, setMatrix] = useState<ProcessLinkageMatrix | null>(
    session.linkage_matrix,
  );
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [diagramFullscreen, setDiagramFullscreen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const { generate, loading, error } = useForgeMatrixGenerate();

  const [activeTab, setActiveTab] = useState<"devices" | "sequences" | "wiring">("devices");
  const [selectedSeqId, setSelectedSeqId] = useState<string | undefined>(undefined);
  const { validate, applySelectedFixes, loading: validating, applying: applyingFixes, result: validationResult, clear: clearValidation } = useForgeMatrixValidate();
  const createPattern = useCreatePatternCandidate();
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [savedToLibrary, setSavedToLibrary] = useState<Set<string>>(new Set());
  const [applyError, setApplyError] = useState<string | null>(null);

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
          <div className="flex items-center gap-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
            validationResult.verdict === "errors" && "border-destructive/30 bg-destructive/10 text-destructive",
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
            {validationResult.fixableIssues.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] opacity-70 uppercase tracking-wider">Issues ({validationResult.fixableIssues.length})</span>
                  <button
                    type="button"
                    className="font-mono text-[10px] opacity-60 hover:opacity-100 transition-opacity"
                    onClick={() => {
                      const allIds = new Set(validationResult.fixableIssues.map(i => i.id));
                      setSelectedIssueIds(prev => prev.size === allIds.size ? new Set() : allIds);
                    }}
                  >
                    {selectedIssueIds.size === validationResult.fixableIssues.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                {validationResult.fixableIssues.map(issue => (
                  <label
                    key={issue.id}
                    className="flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-white/5 transition-colors"
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
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          "font-mono text-[9px] uppercase tracking-wider px-1 rounded",
                          issue.severity === "error" ? "bg-destructive/20" : "bg-amber-500/20",
                        )}>
                          {issue.severity}
                        </span>
                        <span className="opacity-60 font-mono text-[10px]">{issue.field}</span>
                      </div>
                      <div>{issue.description}</div>
                      <div className="opacity-70">→ {issue.suggestedFix}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}

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
                      <SequenceCard key={seq.id} seq={seq} />
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

function WiringMapPanel({
  matrix,
  ioList,
}: {
  matrix: ProcessLinkageMatrix;
  ioList: ForgeSession["io_list"];
}) {
  const wiringText = buildWiringContext(matrix, ioList ?? []);

  if (!wiringText) {
    return (
      <div className="py-6 text-center font-mono text-xs text-muted-foreground">
        No wiring data available — generate the matrix first.
      </div>
    );
  }

  // Parse the markdown-like text into styled sections
  return (
    <div className="space-y-3">
      {wiringText.split("\n### ").map((section, i) => {
        if (i === 0) {
          // Header section (## Project Wiring Map + intro text)
          const lines = section.split("\n").filter((l) => !l.startsWith("## "));
          return (
            <div key="header" className="rounded border border-border/40 bg-muted/20 px-3 py-2">
              <p className="font-mono text-[10px] text-muted-foreground leading-relaxed">
                {lines.filter(Boolean).join(" ")}
              </p>
            </div>
          );
        }

        const lines = section.split("\n");
        const title = lines[0]?.trim() ?? "";
        const body = lines.slice(1);

        // Detect global data section
        const isGlobalData = title === "Global Data Blocks";

        return (
          <div key={title || i} className="rounded border border-border/40 bg-card/50 p-3">
            <h4 className={cn(
              "font-mono text-xs font-semibold",
              isGlobalData ? "text-amber-400/80" : "text-foreground",
            )}>
              {title}
            </h4>
            <div className="mt-1.5 space-y-0.5">
              {body.map((line, j) => {
                const trimmed = line.trimStart();
                if (!trimmed) return null;

                // Color-code by line type
                let lineClass = "text-muted-foreground";
                if (trimmed.startsWith("FB:") || trimmed.startsWith("INPUTS:") || trimmed.startsWith("OUTPUTS:") || trimmed.startsWith("INTERLOCKS:")) {
                  lineClass = "text-muted-foreground font-semibold mt-1";
                } else if (trimmed.includes("←") && trimmed.includes("%")) {
                  lineClass = "text-blue-400/80"; // IO-traced input
                } else if (trimmed.includes("←") && trimmed.includes("from ")) {
                  lineClass = "text-cyan-400/70"; // Cross-device input
                } else if (trimmed.includes("→") && trimmed.includes("%")) {
                  lineClass = "text-green-400/80"; // IO-traced output
                } else if (trimmed.includes("→") && trimmed.includes("drives ")) {
                  lineClass = "text-emerald-400/70"; // Cross-device output
                } else if (trimmed.startsWith("Requires:") || trimmed.startsWith("Blocks:") || trimmed.startsWith("Follows:")) {
                  lineClass = "text-amber-400/70"; // Interlocks
                }

                return (
                  <pre key={j} className={cn("font-mono text-[11px] leading-relaxed whitespace-pre-wrap", lineClass)}>
                    {line}
                  </pre>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
