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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MermaidDiagram } from "@/components/ui/mermaid-diagram";
import { buildMultiSequenceDiagram } from "@/lib/process-sequence-diagram";
import { useForgeMatrixGenerate } from "@/hooks/use-forge-matrix-generate";
import { cn } from "@/lib/utils";
import type { ForgeSession } from "@/types/forge";
import type {
  ProcessLinkageMatrix,
  LinkageDevice,
  ProcessSequence,
} from "@/types/process-builder";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ForgeMatrixReviewProps {
  session: ForgeSession;
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
            {seq.steps.length} steps · {seq.permissives.length} permissives
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

          <div>
            <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Steps
            </div>
            <div className="space-y-2">
              {seq.steps.map((step) => (
                <div
                  key={step.id}
                  className="rounded border border-border/40 bg-background/30 px-2.5 py-2"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold text-primary">
                      Step {step.stepNumber}
                    </span>
                    {step.devicesInvolved.length > 0 && (
                      <span className="font-mono text-[9px] text-muted-foreground">
                        [{step.devicesInvolved.join(", ")}]
                      </span>
                    )}
                  </div>
                  {step.actions.length > 0 && (
                    <div className="space-y-0.5">
                      {step.actions.map((a) => (
                        <div key={a.id} className="flex items-start gap-1.5 text-xs">
                          <span className="mt-0.5 h-1 w-1 rounded-full bg-primary/60 shrink-0" />
                          <span className="text-foreground">{a.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {step.transition.conditions.length > 0 && (
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
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ForgeMatrixReview({ session, onComplete }: ForgeMatrixReviewProps) {
  const [matrix, setMatrix] = useState<ProcessLinkageMatrix | null>(
    session.linkage_matrix,
  );
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const { generate, loading, error } = useForgeMatrixGenerate();

  const [activeTab, setActiveTab] = useState<"devices" | "sequences">("devices");

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

  const diagramChart =
    matrix?.processSequences?.length
      ? buildMultiSequenceDiagram(matrix.processSequences)
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
              disabled={loading || completing}
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
              className="h-7 gap-1.5 font-mono text-xs"
              onClick={handleConfirm}
              disabled={!matrix || loading || completing}
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
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Sequence Diagram
          </span>
        </div>

        <ScrollArea className="flex-1 rounded-md border border-border/60 bg-background/40 p-3">
          {loading && !matrix ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Waiting for matrix…
            </div>
          ) : diagramChart ? (
            <MermaidDiagram chart={diagramChart} className="w-full" />
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
              No process sequences defined
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
