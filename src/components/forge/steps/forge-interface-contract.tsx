/**
 * Forge wizard step: FDS Behavioral Review / Interface Contract
 *
 * Two modes:
 * - FDS-linked (spec_project_id set): Shows FDS behavioral data per equipment_module
 *   (operating states, step sequences, device state tables, alarms).
 *   Engineer reviews + annotates + approves.
 * - Standalone (no spec_project_id): Falls back to AI-suggested interface contracts
 *   from SpecAnalysis. Engineer defines signals + states manually.
 */
import { useState, useCallback, useMemo } from "react";
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Zap,
  ShieldAlert,
  MessageSquarePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useForgeFdsHandoff } from "@/hooks/use-forge-fds-handoff";
import { useForgeContractGenerate } from "@/hooks/use-forge-contract-generate";
import type { ForgeSession } from "@/types/forge";
import type { InterfaceContractMap } from "@/types/forge-contract";
import type { EquipmentModuleBrief, EquipmentModuleBriefMap } from "@/types/forge-brief";
import type { ControlModuleStateEntry, StepEntry, OperatingState } from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ForgeInterfaceContractProps {
  session: ForgeSession;
  /** Called with contracts (standalone) or briefs-as-contracts (FDS) */
  onComplete: (contracts: InterfaceContractMap) => void;
  /** Called with equipment_module briefs when FDS-linked */
  onBriefsComplete?: (briefs: EquipmentModuleBriefMap) => void;
}

// ---------------------------------------------------------------------------
// Sub-components for FDS mode
// ---------------------------------------------------------------------------

function StateBadge({ pattern }: { pattern: string }) {
  return (
    <Badge
      variant="outline"
      className={`font-mono text-[9px] px-1 py-0 ${
        pattern === "static"
          ? "border-amber-500/40 text-amber-400"
          : "border-cyan-500/40 text-cyan-400"
      }`}
    >
      {pattern === "static" ? "STATIC" : "SEQ"}
    </Badge>
  );
}

function DeviceStateTable({ entries }: { entries: ControlModuleStateEntry[] }) {
  if (entries.length === 0) return <span className="text-[10px] text-muted-foreground italic">No device states defined</span>;
  return (
    <div className="rounded border border-border/30 overflow-hidden">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="bg-muted/20 border-b border-border/20">
            <th className="text-left px-2 py-1 font-mono font-medium text-muted-foreground">Tag</th>
            <th className="text-left px-2 py-1 font-medium text-muted-foreground">Description</th>
            <th className="text-left px-2 py-1 font-mono font-medium text-muted-foreground">State</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b border-border/10 last:border-0">
              <td className="px-2 py-1 font-mono text-emerald-400">{e.tag}</td>
              <td className="px-2 py-1">{e.description}</td>
              <td className="px-2 py-1 font-mono font-semibold">{e.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StepSequenceTable({ steps, permissives }: { steps: StepEntry[]; permissives: string[] }) {
  return (
    <div className="space-y-2">
      {permissives.length > 0 && (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5">
          <span className="text-[9px] font-semibold text-amber-400">Permissives</span>
          <ul className="mt-1 space-y-0.5">
            {permissives.map((p, i) => (
              <li key={i} className="text-[10px] text-amber-300/80 flex items-start gap-1">
                <span className="text-amber-500 mt-0.5">•</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {steps.length > 0 && (
        <div className="rounded border border-border/30 overflow-hidden">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-muted/20 border-b border-border/20">
                <th className="text-center px-2 py-1 w-10 font-mono font-medium text-muted-foreground">#</th>
                <th className="text-left px-2 py-1 font-medium text-muted-foreground">Action</th>
                <th className="text-left px-2 py-1 font-medium text-muted-foreground">Completion Criteria</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.step} className="border-b border-border/10 last:border-0">
                  <td className="px-2 py-1 text-center font-mono text-cyan-400">{s.step}</td>
                  <td className="px-2 py-1">{s.action}</td>
                  <td className="px-2 py-1 font-mono text-[9px] text-muted-foreground">{s.completion_criteria}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AlarmList({ alarms }: { alarms: EquipmentModuleBrief["alarmConditions"] }) {
  if (alarms.length === 0) return <span className="text-[10px] text-muted-foreground italic">No alarms matched to this equipment_module</span>;
  return (
    <div className="space-y-1">
      {alarms.map((a, i) => (
        <div key={i} className="flex items-start gap-2 text-[10px] px-1">
          <Badge variant="outline" className="font-mono text-[8px] px-1 py-0 shrink-0 border-red-500/30 text-red-400">
            {a.code}
          </Badge>
          <span className="text-muted-foreground">{a.description}</span>
          <span className="text-[9px] text-red-400/60 ml-auto shrink-0">{a.action}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FDS Behavioral Review Panel (right side)
// ---------------------------------------------------------------------------

function FdsBriefEditor({
  brief,
  operatingStates,
  onAnnotate,
  onToggleApprove,
}: {
  brief: EquipmentModuleBrief;
  operatingStates: OperatingState[];
  onAnnotate: (annotations: string[]) => void;
  onToggleApprove: () => void;
}) {
  const [statesOpen, setStatesOpen] = useState(true);
  const [alarmsOpen, setAlarmsOpen] = useState(true);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [newAnnotation, setNewAnnotation] = useState("");

  // Group operating states by pattern
  const staticStateIds = Object.keys(brief.staticStates);
  const sequentialStateIds = Object.keys(brief.sequentialStates);

  const stateList = operatingStates.map((os) => ({
    ...os,
    hasStatic: staticStateIds.includes(os.state_id),
    hasSequential: sequentialStateIds.includes(os.state_id),
  }));

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-mono text-sm font-semibold">{brief.equipment_moduleTag}</h3>
            <p className="text-[10px] text-muted-foreground">
              {brief.equipment_moduleName} — {brief.equipment_moduleType} — {brief.unitName}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {brief.deviceIds.length} control_modules — {staticStateIds.length} static states — {sequentialStateIds.length} sequential states
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[9px] border-blue-500/30 text-blue-400">
              FDS
            </Badge>
            <Button
              variant={brief.approved ? "default" : "outline"}
              size="sm"
              onClick={onToggleApprove}
              className="gap-2"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {brief.approved ? "Approved" : "Approve"}
            </Button>
          </div>
        </div>

        {/* Operating States */}
        <section>
          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-purple-400 mb-2"
            onClick={() => setStatesOpen(!statesOpen)}
          >
            {statesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <FileText className="h-3 w-3" />
            Operating States ({stateList.length})
          </button>
          {statesOpen && (
            <div className="space-y-3 ml-1">
              {stateList.map((state) => (
                <div key={state.state_id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{state.state_name}</span>
                    <StateBadge pattern={state.state_pattern} />
                    <span className="text-[9px] text-muted-foreground">{state.description}</span>
                  </div>

                  {/* Static state: device state table */}
                  {state.hasStatic && brief.staticStates[state.state_id] && (
                    <DeviceStateTable entries={brief.staticStates[state.state_id]} />
                  )}

                  {/* Sequential state: step sequence */}
                  {state.hasSequential && brief.sequentialStates[state.state_id] && (
                    <StepSequenceTable
                      steps={brief.sequentialStates[state.state_id].steps}
                      permissives={brief.sequentialStates[state.state_id].permissives}
                    />
                  )}

                  {/* State exists in operating states but has no FDS data */}
                  {!state.hasStatic && !state.hasSequential && (
                    <div className="text-[10px] text-yellow-500/70 italic flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      No FDS data for this state — may need annotation
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Alarms */}
        <section>
          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-red-400 mb-2"
            onClick={() => setAlarmsOpen(!alarmsOpen)}
          >
            {alarmsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <ShieldAlert className="h-3 w-3" />
            Alarms ({brief.alarmConditions.length})
          </button>
          {alarmsOpen && <AlarmList alarms={brief.alarmConditions} />}
        </section>

        {/* Annotations */}
        <section>
          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-orange-400 mb-2"
            onClick={() => setAnnotationsOpen(!annotationsOpen)}
          >
            {annotationsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <MessageSquarePlus className="h-3 w-3" />
            Engineer Annotations ({brief.annotations.length})
            <span className="text-[9px] text-muted-foreground font-normal ml-1">
              Clarifications, overrides, missing info
            </span>
          </button>
          {annotationsOpen && (
            <div className="space-y-2 ml-1">
              {brief.annotations.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] bg-orange-500/5 border border-orange-500/20 rounded px-2 py-1.5">
                  <span className="text-orange-400 shrink-0">#{i + 1}</span>
                  <span>{a}</span>
                  <button
                    className="text-muted-foreground hover:text-destructive ml-auto shrink-0"
                    onClick={() => onAnnotate(brief.annotations.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex gap-1.5">
                <Textarea
                  value={newAnnotation}
                  onChange={(e) => setNewAnnotation(e.target.value)}
                  className="text-xs min-h-[60px]"
                  placeholder="Add clarification... e.g. 'Step 3 timeout should be T#10s' or 'Motor needs jog mode in manual'"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto text-xs shrink-0"
                  disabled={!newAnnotation.trim()}
                  onClick={() => {
                    if (newAnnotation.trim()) {
                      onAnnotate([...brief.annotations, newAnnotation.trim()]);
                      setNewAnnotation("");
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ForgeInterfaceContract({
  session,
  onComplete,
  onBriefsComplete,
}: ForgeInterfaceContractProps) {
  const { briefs: fdsBriefs, loading: fdsLoading, isFdsLinked } = useForgeFdsHandoff(session.spec_project_id);

  // Standalone mode (no FDS): AI contract generation
  const { generateContracts, loading: contractLoading, error: contractError } = useForgeContractGenerate();

  // Local state for briefs (FDS mode) or contracts (standalone mode)
  const [localBriefs, setLocalBriefs] = useState<EquipmentModuleBriefMap>({});
  const [standaloneContracts, setStandaloneContracts] = useState<InterfaceContractMap>(
    () => session.interface_contracts ?? {},
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sync FDS briefs into local state when they arrive
  const briefs = useMemo(() => {
    if (!isFdsLinked) return {};
    // Merge FDS briefs with local edits (annotations, approval)
    const merged: EquipmentModuleBriefMap = {};
    for (const [id, fdsBrief] of Object.entries(fdsBriefs)) {
      merged[id] = {
        ...fdsBrief,
        annotations: localBriefs[id]?.annotations ?? fdsBrief.annotations,
        approved: localBriefs[id]?.approved ?? fdsBrief.approved,
      };
    }
    return merged;
  }, [isFdsLinked, fdsBriefs, localBriefs]);

  const equipment_modules = useMemo(
    () => session.spec_analysis?.equipment_modules ?? [],
    [session.spec_analysis],
  );

  const allApproved = useMemo(() => {
    if (isFdsLinked) {
      const briefList = Object.values(briefs);
      return briefList.length > 0 && briefList.every((b) => b.approved);
    }
    return equipment_modules.length > 0 && equipment_modules.every((a) => standaloneContracts[a.id]?.approved);
  }, [isFdsLinked, briefs, equipment_modules, standaloneContracts]);

  // ── Handlers ──

  const updateBrief = useCallback((equipment_moduleId: string, update: Partial<EquipmentModuleBrief>) => {
    setLocalBriefs((prev) => ({
      ...prev,
      [equipment_moduleId]: { ...(briefs[equipment_moduleId] ?? prev[equipment_moduleId]), ...update } as EquipmentModuleBrief,
    }));
  }, [briefs]);

  const handleComplete = useCallback(() => {
    if (isFdsLinked) {
      onBriefsComplete?.(briefs);
      // Also pass empty contracts for backward compat
      onComplete({});
    } else {
      onComplete(standaloneContracts);
    }
  }, [isFdsLinked, briefs, standaloneContracts, onComplete, onBriefsComplete]);

  const handleGenerateStandalone = useCallback(async () => {
    if (!session.spec_analysis) return;
    try {
      const result = await generateContracts(session.spec_analysis);
      setStandaloneContracts(result);
      const firstKey = Object.keys(result)[0];
      if (firstKey) setSelectedId(firstKey);
    } catch {
      // error handled by hook
    }
  }, [session.spec_analysis, generateContracts]);

  const approveAll = useCallback(() => {
    if (isFdsLinked) {
      setLocalBriefs((prev) => {
        const next = { ...prev };
        for (const [id, brief] of Object.entries(briefs)) {
          next[id] = { ...brief, approved: true };
        }
        return next;
      });
    } else {
      setStandaloneContracts((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          next[key] = { ...next[key], approved: true };
        }
        return next;
      });
    }
  }, [isFdsLinked, briefs]);

  // ── Loading state ──

  if (fdsLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading FDS data...</span>
      </div>
    );
  }

  // ── No equipment_modules ──

  const briefList = Object.values(briefs);
  if (isFdsLinked && briefList.length === 0 && equipment_modules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <p className="text-sm">No equipment_modules found in the FDS or spec analysis.</p>
        <Button onClick={() => onComplete({})}>Skip — Continue without behavioral review</Button>
      </div>
    );
  }

  if (!isFdsLinked && equipment_modules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <p className="text-sm">No equipment_modules found in the spec analysis.</p>
        <Button onClick={() => onComplete({})}>Skip — Continue without contracts</Button>
      </div>
    );
  }

  // ── FDS Mode ──

  if (isFdsLinked) {
    const selectedBrief = selectedId ? briefs[selectedId] : null;

    return (
      <div className="flex flex-col h-full gap-3">
        {/* Toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 gap-1">
            <Zap className="h-3 w-3" />
            FDS-Linked
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            Behavioral data from FDS — review and approve each equipment_module
          </span>
          <div className="flex-1" />

          <Button variant="outline" size="sm" onClick={approveAll} disabled={allApproved} className="gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve All
          </Button>

          <Badge variant="outline" className="font-mono text-[10px]">
            {briefList.filter((b) => b.approved).length}/{briefList.length} approved
          </Badge>

          <Button size="sm" disabled={!allApproved} onClick={handleComplete}>
            Continue
          </Button>
        </div>

        {/* Main layout */}
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          {/* Left: Equipment Module list */}
          <ResizablePanel defaultSize={28} minSize={20}>
            <ScrollArea className="h-full">
              <div className="space-y-1 p-2">
                {briefList.map((brief) => {
                  const isSelected = selectedId === brief.equipment_moduleId;
                  const staticCount = Object.keys(brief.staticStates).length;
                  const seqCount = Object.keys(brief.sequentialStates).length;

                  return (
                    <button
                      key={brief.equipment_moduleId}
                      className={`w-full text-left rounded px-2 py-2 transition-colors ${
                        isSelected
                          ? "bg-accent border border-accent-foreground/10"
                          : "hover:bg-muted/50 border border-transparent"
                      }`}
                      onClick={() => setSelectedId(brief.equipment_moduleId)}
                    >
                      <div className="flex items-center gap-2">
                        {brief.approved ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-mono text-xs font-semibold truncate">{brief.equipment_moduleTag}</span>
                        {brief.annotations.length > 0 && (
                          <Badge variant="outline" className="text-[8px] px-1 py-0 border-orange-500/30 text-orange-400">
                            {brief.annotations.length} notes
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground ml-5.5 truncate">
                        {brief.equipment_moduleName} ({brief.equipment_moduleType})
                      </div>
                      <div className="flex gap-2 ml-5.5 mt-0.5">
                        <span className="text-[9px] text-amber-400">{staticCount} static</span>
                        <span className="text-[9px] text-cyan-400">{seqCount} sequential</span>
                        <span className="text-[9px] text-red-400">{brief.alarmConditions.length} alarms</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right: Brief editor */}
          <ResizablePanel defaultSize={72} minSize={40}>
            {selectedBrief ? (
              <FdsBriefEditor
                brief={selectedBrief}
                operatingStates={selectedBrief.operatingStates}
                onAnnotate={(annotations) => updateBrief(selectedBrief.equipment_moduleId, { annotations, approved: false })}
                onToggleApprove={() => updateBrief(selectedBrief.equipment_moduleId, { approved: !selectedBrief.approved })}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select an equipment_module from the list to review its FDS behavioral spec
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  // ── Standalone Mode (no FDS) — AI contract generation fallback ──

  const hasContracts = Object.keys(standaloneContracts).length > 0;

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground gap-1">
          Standalone
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          No FDS linked — using AI to suggest interface contracts from spec analysis
        </span>
        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={handleGenerateStandalone} disabled={contractLoading} className="gap-2">
          {contractLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {hasContracts ? "Re-generate" : "AI Suggest Contracts"}
        </Button>

        {hasContracts && (
          <>
            <Button variant="outline" size="sm" onClick={approveAll} disabled={allApproved} className="gap-2">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve All
            </Button>
            <Button size="sm" disabled={!allApproved} onClick={handleComplete}>
              Continue
            </Button>
          </>
        )}
      </div>

      {contractError && <div className="text-xs text-destructive px-2">{contractError}</div>}

      {hasContracts ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          <div className="text-center space-y-2">
            <p>Standalone contract editor — contract editing UI will be restored here.</p>
            <p className="text-[10px]">For full behavioral review, link an FDS spec project in Project Setup.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <p className="text-sm">Click "AI Suggest Contracts" to generate interface contracts from your spec.</p>
            <p className="text-xs">For full behavioral review with step sequences and device state tables, link an FDS spec project.</p>
          </div>
        </div>
      )}
    </div>
  );
}
