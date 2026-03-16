import { useEffect, useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MermaidDiagram } from "@/components/ui/mermaid-diagram";
import { buildProcessFlowDiagram } from "@/lib/process-sequence-diagram";
import { useForgeMatrixGenerate } from "@/hooks/use-forge-matrix-generate";
import { useForgeMatrixValidate } from "@/hooks/use-forge-matrix-validate";
import { cn } from "@/lib/utils";
import type { ForgeSession } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type {
  ProcessLinkageMatrix,
  LinkageDevice,
  ProcessSequence,
  SequenceRow,
} from "@/types/process-builder";

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

const ROW_TYPE_COLORS: Record<string, string> = {
  action: "text-teal-400",
  branch: "text-blue-400",
  monitor: "text-purple-400",
  fault_exit: "text-red-400",
  merge: "text-amber-400",
};

function SequenceRowsTable({ rows }: { rows: SequenceRow[] }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        Sequence Rows
      </div>
      <div className="overflow-x-auto rounded border border-border/40">
        <table className="w-full font-mono text-[10px]">
          <thead>
            <tr className="border-b border-border/40 bg-muted/20 text-muted-foreground">
              <th className="px-2 py-1 text-left">Step</th>
              <th className="px-2 py-1 text-left">Condition</th>
              <th className="px-2 py-1 text-left">Action</th>
              <th className="px-2 py-1 text-left">Output</th>
              <th className="px-2 py-1 text-left">Next</th>
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
                <td className="px-2 py-1 whitespace-nowrap">
                  <span className="font-bold text-primary">{row.step}</span>
                  {row.branch && (
                    <span className="ml-0.5 text-muted-foreground">{row.branch}</span>
                  )}
                  <span className={cn("ml-1.5 text-[9px]", ROW_TYPE_COLORS[row.type] ?? "text-muted-foreground")}>
                    {row.type}
                  </span>
                </td>
                <td className="px-2 py-1 text-muted-foreground max-w-[160px] truncate">{row.condition}</td>
                <td className="px-2 py-1 text-foreground max-w-[160px] truncate">{row.action}</td>
                <td className="px-2 py-1 text-teal-400 whitespace-nowrap">{row.output ?? "—"}</td>
                <td className={cn(
                  "px-2 py-1 whitespace-nowrap",
                  row.next === "FAULT" ? "text-red-400" : row.next === "IDLE" ? "text-amber-400" : "text-muted-foreground",
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
              : `${(seq.steps ?? []).length} steps`} · {seq.permissives.length} permissives
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

          {seq.rows && seq.rows.length > 0 ? (
            <SequenceRowsTable rows={seq.rows} />
          ) : (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Steps
              </div>
              <div className="space-y-2">
                {(seq.steps ?? []).map((step) => (
                  <div
                    key={step.id}
                    className="rounded border border-border/40 bg-background/30 px-2.5 py-2"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-[10px] font-bold text-primary">
                        Step {step.stepNumber}
                      </span>
                      {(step.devicesInvolved ?? []).length > 0 && (
                        <span className="font-mono text-[9px] text-muted-foreground">
                          [{(step.devicesInvolved ?? []).join(", ")}]
                        </span>
                      )}
                    </div>
                    {(step.actions ?? []).length > 0 && (
                      <div className="space-y-0.5">
                        {(step.actions ?? []).map((a) => (
                          <div key={a.id} className="flex items-start gap-1.5 text-xs">
                            <span className="mt-0.5 h-1 w-1 rounded-full bg-primary/60 shrink-0" />
                            <span className="text-foreground">{a.description}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(step.transition?.conditions ?? []).length > 0 && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-xs">
                        <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                          → {step.transition.combinator}:
                        </span>
                        <span className="text-muted-foreground">
                          {step.transition.conditions
                            .map((c) => c.description)
                            .join(` ${step.transition.combinator} `)}
                        </span>
                      </div>
                    )}
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

// ── Main component ────────────────────────────────────────────────────────────

export function ForgeMatrixReview({ session, fbTemplates, onComplete }: ForgeMatrixReviewProps) {
  const [matrix, setMatrix] = useState<ProcessLinkageMatrix | null>(
    session.linkage_matrix,
  );
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [diagramFullscreen, setDiagramFullscreen] = useState(false);
  const { generate, loading, error } = useForgeMatrixGenerate();

  const [activeTab, setActiveTab] = useState<"devices" | "sequences">("devices");
  const [selectedSeqId, setSelectedSeqId] = useState<string | undefined>(undefined);
  const { validate, loading: validating, result: validationResult, clear: clearValidation } = useForgeMatrixValidate();

  // Auto-generate on mount if no matrix exists
  useEffect(() => {
    if (!matrix && !loading) {
      void handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    try {
      const result = await generate(
        session.device_list,
        session.io_list,
        session.spec_analysis,
        fbTemplates,
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

  const diagramChart = activeSeq
    ? buildProcessFlowDiagram(activeSeq, {
        devices: session.device_list ?? [],
        deviceLinkage: matrix?.deviceLinkage ?? [],
        ioList: session.io_list ?? [],
      })
    : "";

  return (
    <div className="flex h-full gap-4 min-h-0">
      {/* Left panel — Matrix editor */}
      <div className="flex w-[55%] shrink-0 flex-col gap-3 min-h-0">
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
              onClick={() => { clearValidation(); if (matrix) void validate(matrix); }}
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
            "rounded border px-3 py-2 text-xs space-y-1.5",
            validationResult.verdict === "ok" && "border-green-500/30 bg-green-500/10 text-green-400",
            validationResult.verdict === "warnings" && "border-amber-500/30 bg-amber-500/10 text-amber-400",
            validationResult.verdict === "errors" && "border-destructive/30 bg-destructive/10 text-destructive",
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-mono font-medium uppercase tracking-wider text-[10px]">
                <ShieldCheck className="h-3 w-3" />
                PM Validation — {validationResult.verdict}
                {validationResult.timerFixCount > 0 && (
                  <span className="text-muted-foreground normal-case tracking-normal">· {validationResult.timerFixCount} timer value{validationResult.timerFixCount !== 1 ? "s" : ""} fixed</span>
                )}
              </div>
              {validationResult.correctedMatrix && (
                <button
                  type="button"
                  className="rounded border border-current px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider hover:opacity-80 transition-opacity"
                  onClick={() => {
                    setMatrix(validationResult.correctedMatrix!);
                    clearValidation();
                  }}
                >
                  Apply {validationResult.timerFixCount} Fix{validationResult.timerFixCount !== 1 ? "es" : ""}
                </button>
              )}
            </div>
            {validationResult.issues.length > 0 && (
              <div className="space-y-0.5">
                <div className="font-mono text-[10px] opacity-70">Issues:</div>
                {validationResult.issues.map((issue, i) => <div key={i} className="pl-2">· {issue}</div>)}
              </div>
            )}
            {validationResult.suggestions.length > 0 && (
              <div className="space-y-0.5">
                <div className="font-mono text-[10px] opacity-70">Suggestions:</div>
                {validationResult.suggestions.map((s, i) => <div key={i} className="pl-2">· {s}</div>)}
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

      {/* Right panel — Sequence diagram */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 min-h-0">
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
            {diagramChart && (
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
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded-md border border-border/60 bg-background/40 p-3 min-h-0">
          {loading && !matrix ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Waiting for matrix…
            </div>
          ) : diagramChart ? (
            <MermaidDiagram chart={diagramChart} className="min-w-[500px]" />
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
              No process sequences defined
            </div>
          )}
        </div>
      </div>

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
            <MermaidDiagram chart={diagramChart} className="min-w-[600px]" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
