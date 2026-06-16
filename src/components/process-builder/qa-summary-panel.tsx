import { Check, X, Cpu, Blocks, FolderTree, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { getModuleByMlfb } from "@/lib/module-catalog";

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: typeof Cpu;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/30"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 font-mono text-xs font-medium">{title}</span>
        {count > 0 && (
          <Badge variant="secondary" className="font-mono text-[10px]">
            {count}
          </Badge>
        )}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** Build a compact channel summary string like "8 DI" or "4 AI / 2 AO" */
function formatChannelSummary(mlfb: string): string | null {
  const mod = getModuleByMlfb(mlfb);
  if (!mod) return null;

  const parts: string[] = [];
  if (mod.diChannels > 0) parts.push(`${mod.diChannels} DI`);
  if (mod.dqChannels > 0) parts.push(`${mod.dqChannels} DQ`);
  if (mod.aiChannels > 0) parts.push(`${mod.aiChannels} AI`);
  if (mod.aqChannels > 0) parts.push(`${mod.aqChannels} AQ`);
  return parts.length > 0 ? parts.join(" / ") : null;
}

export function QaSummaryPanel() {
  const matrix = useProcessBuilderStore((s) => s.linkageMatrix);
  const ioRecommendations = useProcessBuilderStore((s) => s.ioRecommendations);
  const fbRecommendations = useProcessBuilderStore((s) => s.fbRecommendations);
  const confirmIo = useProcessBuilderStore((s) => s.confirmIo);
  const confirmFb = useProcessBuilderStore((s) => s.confirmFb);
  const qaMessages = useProcessBuilderStore((s) => s.qaMessages);

  const hasMatrix = !!matrix;
  const hasLegacyRecs = ioRecommendations.length > 0 || fbRecommendations.length > 0;
  const hasAnyData = hasMatrix || hasLegacyRecs;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-3 py-2.5">
        <div className="text-sm font-medium">Q&A Summary</div>
        <div className="font-mono text-xs text-muted-foreground">
          {hasMatrix
            ? "Linkage matrix ready — review and proceed"
            : hasAnyData
              ? "Review and confirm recommendations"
              : "Recommendations will appear as the PM gathers requirements"}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {!hasAnyData && qaMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <FolderTree className="h-6 w-6 text-muted-foreground/30" />
            <div className="font-mono text-xs text-muted-foreground/60">
              Start chatting with the PM to see recommendations here
            </div>
          </div>
        )}

        {/* In-progress: no data yet but conversation has started */}
        {!hasAnyData && qaMessages.length > 0 && (
          <div className="space-y-3 p-4">
            <div className="rounded-md border border-dashed border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <div className="font-mono text-xs font-medium text-amber-400">Gathering requirements...</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                The PM will produce IO/FB recommendations and a Linkage Matrix as it gathers information.
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] font-medium text-muted-foreground">PM PROGRESS</div>
              {[
                { label: "System overview", keyword: /overview|process|machine|system/i },
                { label: "Devices identified", keyword: /motor|valve|sensor|pump|conveyor|actuator|device/i },
                { label: "IO signals discussed", keyword: /digital input|digital output|analog|DI|DQ|AI|AQ|signal|feedback/i },
                { label: "Control logic", keyword: /interlock|state|timer|alarm|logic|control/i },
                { label: "Process sequence", keyword: /sequence|step|flow|order|first|then|after/i },
              ].map(({ label, keyword }) => {
                const covered = qaMessages.some((m) => keyword.test(m.content));
                return (
                  <div key={label} className="flex items-center gap-2">
                    <div className={`h-1.5 w-1.5 rounded-full ${covered ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                    <span className={`font-mono text-[10px] ${covered ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legacy IO Recommendations (backward compat) */}
        {ioRecommendations.length > 0 && (
          <CollapsibleSection
            title="IO Modules"
            icon={Cpu}
            count={ioRecommendations.length}
            defaultOpen={true}
          >
            <div className="space-y-1.5">
              {ioRecommendations.map((rec, i) => (
                <div
                  key={`io-${i}`}
                  className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-medium">{rec.mlfb}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        R{rec.rack}:S{rec.slot}
                      </span>
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {rec.description}
                    </div>
                    {(() => {
                      const channels = formatChannelSummary(rec.mlfb);
                      return channels ? (
                        <div className="font-mono text-[10px] text-blue-400/80">
                          {channels}
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 w-6 p-0 ${rec.confirmed ? "text-green-500" : "text-muted-foreground"}`}
                    onClick={() => confirmIo(i, !rec.confirmed)}
                    title={rec.confirmed ? "Unconfirm" : "Confirm"}
                  >
                    {rec.confirmed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Legacy FB Recommendations (backward compat) */}
        {fbRecommendations.length > 0 && (
          <CollapsibleSection
            title="Function Blocks"
            icon={Blocks}
            count={fbRecommendations.length}
            defaultOpen={true}
          >
            <div className="space-y-1.5">
              {fbRecommendations.map((rec, i) => (
                <div
                  key={`fb-${i}`}
                  className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-medium">{rec.deviceType}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        x{rec.instanceCount}
                      </span>
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {rec.templateId ? rec.templateName : `${rec.templateName} (new)`}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 w-6 p-0 ${rec.confirmed ? "text-green-500" : "text-muted-foreground"}`}
                    onClick={() => confirmFb(i, !rec.confirmed)}
                    title={rec.confirmed ? "Unconfirm" : "Confirm"}
                  >
                    {rec.confirmed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Matrix Overview (new format) */}
        {hasMatrix && (
          <>
            <CollapsibleSection
              title="Matrix Devices"
              icon={Cpu}
              count={matrix.deviceLinkage.length}
              defaultOpen={true}
            >
              {matrix.deviceLinkage.length === 0 ? (
                <div className="font-mono text-xs text-muted-foreground/60">
                  No control_modules in matrix yet
                </div>
              ) : (
                <div className="space-y-1.5">
                  {matrix.deviceLinkage.map((device) => (
                    <div
                      key={device.id}
                      className="rounded-md border bg-muted/30 px-2 py-1.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-medium">{device.name}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {device.deviceType}
                        </Badge>
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {device.description}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-blue-400/80">
                        <span>{device.wiring.length} wires</span>
                        <span>&middot;</span>
                        <span>{device.fbName}</span>
                        <ArrowRight className="h-2.5 w-2.5" />
                        <span>{device.instanceDbName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Process Sequences"
              icon={Blocks}
              count={matrix.processSequences.length}
              defaultOpen={matrix.processSequences.length > 0}
            >
              {matrix.processSequences.length === 0 ? (
                <div className="font-mono text-xs text-muted-foreground/60">
                  No process sequences defined yet
                </div>
              ) : (
                <div className="space-y-1">
                  {matrix.processSequences.map((seq) => (
                    <div
                      key={seq.id}
                      className="rounded-md border bg-muted/30 px-2 py-1"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-medium">{seq.name}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                        <span>{(seq.steps ?? seq.rows ?? []).length} steps</span>
                        <span>&middot;</span>
                        <span>{seq.permissives.length} permissives</span>
                        {seq.safetyConditions.length > 0 && (
                          <>
                            <span>&middot;</span>
                            <span>{seq.safetyConditions.length} safety</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>
          </>
        )}

        {/* Conversation summary stats */}
        {qaMessages.length > 0 && (
          <div className="border-t px-3 py-2">
            <div className="font-mono text-[10px] text-muted-foreground">
              {qaMessages.filter((m) => m.role === "user").length} messages exchanged
              {hasLegacyRecs && (
                <>
                  {" "}&middot; {ioRecommendations.filter((r) => r.confirmed).length}/{ioRecommendations.length} IO confirmed
                  {" "}&middot; {fbRecommendations.filter((r) => r.confirmed).length}/{fbRecommendations.length} FB confirmed
                </>
              )}
              {hasMatrix && (
                <>
                  {" "}&middot; {matrix.deviceLinkage.length} control_modules
                  {" "}&middot; {matrix.processSequences.length} sequence(s)
                </>
              )}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
