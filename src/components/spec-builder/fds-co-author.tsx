/**
 * FDS Co-Author — Main container.
 * Three-column layout: equipment_module sidebar | conversation | live tables.
 *
 * Stages per equipment_module:
 *   1. Static state review (auto-filled, confirm)
 *   2. Conversational build (chat + live tables)
 *   3. Mark complete
 *
 * After all equipment_modules complete → unit orchestration.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  Loader2,
  Send,
  ShieldAlert,
  MessageSquare,
  Sparkles,
  AlertCircle,
  Copy,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { FdsAssemblySidebar } from "./fds-assembly-sidebar";
import { FdsStaticReview } from "./fds-static-review";
import { FdsTablePane } from "./fds-table-pane";
import { FdsDuplicateDialog } from "./fds-duplicate-dialog";
import {
  useFdsSessionsForProject,
  useEnsureFdsSession,
  useConfirmStaticStates,
  useUpdateSequentialState,
  useCompleteFdsSession,
  useDeleteFdsSession,
  useSaveValidationResults,
} from "@/hooks/use-fds-session";
import { useFdsConversation } from "@/hooks/use-fds-conversation";
import { useFdsOrchestrationConversation } from "@/hooks/use-fds-orchestration-conversation";
import { useFdsOrchestration } from "@/hooks/use-fds-session";
import { validateAssembly } from "@/lib/spec-builder/fds-logic-checker";
import type {
  SpecProject,
  InstrumentRegister,
  InstrumentTag,
  OperatingState,
  ControlModuleStateEntry,
  EquipmentModuleConfig,
  UnitConfig,
  OperationSession,
} from "@/types/spec-builder";
import { migrateOperatingStates } from "@/types/spec-builder";
import type { OperatingStateV2, SequentialStateV2 } from "@/types/spec-contract-v2";
import { cn } from "@/lib/utils";

interface Props {
  spec: SpecProject;
  register: InstrumentRegister;
  /** Render to fill the host container (used by /specs/.../co-author route). */
  fullScreen?: boolean;
}

export function FdsCoAuthor({ spec, register, fullScreen = false }: Props) {
  const { data: sessions = [] } = useFdsSessionsForProject(spec.id);
  const ensureSession = useEnsureFdsSession();
  const confirmStatic = useConfirmStaticStates();
  const updateSequential = useUpdateSequentialState();
  const completeSession = useCompleteFdsSession();
  const deleteSession = useDeleteFdsSession();
  const saveValidation = useSaveValidationResults();

  const states = useMemo(() => migrateOperatingStates(spec.confirmed_states), [spec.confirmed_states]);
  const staticStates = useMemo(() => states.filter((s) => s.state_pattern === "static"), [states]);
  const sequentialStates = useMemo(() => states.filter((s) => s.state_pattern === "sequential"), [states]);

  // Selection state
  const [selectedSubsystemId, setSelectedSubsystemId] = useState<string | null>(null);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string | null>(null);
  const [orchestrationSubsystemId, setOrchestrationSubsystemId] = useState<string | null>(null);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Find current equipment_module and session
  const activeSubsystem = spec.confirmed_units.find((s) => s.unit_id === selectedSubsystemId);
  const activeAssembly = activeSubsystem?.equipment_modules.find((a) => a.equipment_module_id === selectedAssemblyId);
  const activeSession = sessions.find(
    (s) => s.unit_id === selectedSubsystemId && s.equipment_module_id === selectedAssemblyId,
  );

  // Select an equipment_module — ensure session exists
  const handleSelectAssembly = useCallback(
    async (unitId: string, equipment_moduleId: string) => {
      setSelectedSubsystemId(unitId);
      setSelectedAssemblyId(equipment_moduleId);
      setOrchestrationSubsystemId(null);

      // Ensure a session row exists
      const existing = sessions.find(
        (s) => s.unit_id === unitId && s.equipment_module_id === equipment_moduleId,
      );
      if (!existing) {
        await ensureSession.mutateAsync({
          spec_project_id: spec.id,
          unit_id: unitId,
          equipment_module_id: equipment_moduleId,
        });
      }
    },
    [sessions, spec.id, ensureSession],
  );

  const handleSelectOrchestration = useCallback((unitId: string) => {
    setOrchestrationSubsystemId(unitId);
    setSelectedAssemblyId(null);
    setSelectedSubsystemId(unitId);
  }, []);

  // Confirm static states
  const handleConfirmStatic = useCallback(
    async (staticData: Record<string, ControlModuleStateEntry[]>) => {
      if (!activeSession) return;
      await confirmStatic.mutateAsync({ id: activeSession.id, static_states: staticData });
    },
    [activeSession, confirmStatic],
  );

  // Update sequential state data (from table edits)
  const handleUpdateSequentialState = useCallback(
    (stateId: string, data: SequentialStateV2) => {
      if (!activeSession) return;
      updateSequential.mutate({ id: activeSession.id, state_id: stateId, data });
    },
    [activeSession, updateSequential],
  );

  // Reset (delete) active session so the interview starts fresh
  const handleReset = useCallback(async () => {
    if (!activeSession) return;
    await deleteSession.mutateAsync({
      id: activeSession.id,
      spec_project_id: activeSession.spec_project_id,
    });
  }, [activeSession, deleteSession]);

  // Mark equipment_module complete
  const handleComplete = useCallback(async () => {
    if (!activeSession || !activeAssembly) return;

    // Run validation first
    const result = validateAssembly(
      activeAssembly,
      activeSession.static_states,
      activeSession.sequential_states,
      states,
      register.tags,
    );
    await saveValidation.mutateAsync({ id: activeSession.id, results: result });

    if (result.passed) {
      await completeSession.mutateAsync(activeSession.id);
    }
  }, [activeSession, activeAssembly, states, register.tags, saveValidation, completeSession]);

  // Validation issues for current session
  const validationIssues = activeSession?.validation_results?.issues ?? [];
  const hasErrors = validationIssues.some((i) => i.severity === "error");

  return (
    <div
      className={cn(
        "flex overflow-hidden",
        fullScreen
          ? "h-full w-full border-0 rounded-none"
          : "border rounded-lg h-[600px] max-h-[calc(100vh-220px)]",
      )}
    >
      {/* Left rail — equipment_module sidebar */}
      {sidebarCollapsed ? (
        <div
          className="w-6 border-r shrink-0 bg-muted/30 flex items-start justify-center pt-2 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setSidebarCollapsed(false)}
          title="Expand equipment_modules panel"
        >
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      ) : (
        <div className="w-56 border-r shrink-0 bg-muted/30 flex flex-col">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b shrink-0">
            <span className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">Assemblies</span>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Collapse equipment_modules panel"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <FdsAssemblySidebar
              units={spec.confirmed_units}
              sessions={sessions}
              selectedAssemblyId={selectedAssemblyId}
              selectedOrchestrationSubsystemId={orchestrationSubsystemId}
              onSelectAssembly={handleSelectAssembly}
              onSelectOrchestration={handleSelectOrchestration}
            />
          </div>
        </div>
      )}

      {/* Duplicate dialog */}
      {activeSession && activeAssembly && (
        <FdsDuplicateDialog
          open={showDuplicate}
          onOpenChange={setShowDuplicate}
          specProjectId={spec.id}
          sourceSession={activeSession}
          sourceAssembly={activeAssembly}
          units={spec.confirmed_units}
          existingSessions={sessions}
        />
      )}

      {/* Main workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeAssembly && !orchestrationSubsystemId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select an equipment_module to begin co-authoring
          </div>
        ) : orchestrationSubsystemId ? (
          <OrchestrationStage
            specProjectId={spec.id}
            unit={spec.confirmed_units.find((s) => s.unit_id === orchestrationSubsystemId)!}
            sessions={sessions.filter((s) => s.unit_id === orchestrationSubsystemId)}
            // migrateOperatingStates still returns the legacy V1 shape; bridge
            // to V2 here until that helper is migrated. The fields
            // OrchestrationStage / use-fds-orchestration-conversation use
            // (state_id, state_name, state_pattern, display_name, custom_name)
            // overlap structurally.
            allStates={states as unknown as OperatingStateV2[]}
          />
        ) : activeAssembly && activeSession ? (
          <>
            {/* Assembly header */}
            <div className="px-4 py-2.5 border-b flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate">{activeAssembly.equipment_module_name}</h3>
                <p className="text-[11px] text-muted-foreground">
                  {activeAssembly.control_modules.length} control_modules · {activeSubsystem?.unit_name}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activeSession.status === "complete" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowDuplicate(true)}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                    Duplicate
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleReset}
                  disabled={deleteSession.isPending}
                  className="text-muted-foreground hover:text-destructive"
                  title="Clear and restart this equipment_module's interview"
                >
                  {deleteSession.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RotateCcw className="h-3.5 w-3.5" />}
                </Button>
                {activeSession.status === "complete" ? (
                  <Badge className="text-[10px] bg-green-500/20 text-green-400 border-green-500/30">
                    Complete
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleComplete}
                    disabled={!activeSession.static_confirmed || completeSession.isPending}
                  >
                    {completeSession.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Mark Complete
                  </Button>
                )}
              </div>
            </div>

            {/* Stage content */}
            {!activeSession.static_confirmed ? (
              // Stage 1 — Static state review
              <div className="flex-1 overflow-auto p-4">
                <FdsStaticReview
                  equipment_module={activeAssembly}
                  staticStates={staticStates}
                  allTags={register.tags}
                  currentStaticStates={activeSession.static_states}
                  onConfirm={handleConfirmStatic}
                  confirming={confirmStatic.isPending}
                  alreadyConfirmed={activeSession.static_confirmed}
                />
              </div>
            ) : (
              // Stage 2 — Conversation + live tables
              <ConversationStage
                session={activeSession}
                equipment_module={activeAssembly}
                unit={activeSubsystem!}
                allTags={register.tags}
                // migrateOperatingStates still returns the legacy V1 shape; bridge
                // to V2 here until that helper is migrated. The fields ConversationStage
                // uses (state_id, state_name, state_pattern) overlap structurally.
                allStates={states as unknown as OperatingStateV2[]}
                sequentialStates={sequentialStates}
                onUpdateSequentialState={handleUpdateSequentialState}
              />
            )}

            {/* Validation drawer */}
            {validationIssues.length > 0 && (
              <div className="border-t px-4 py-2 shrink-0 max-h-[150px] overflow-auto">
                <div className="flex items-center gap-2 mb-1.5">
                  <ShieldAlert className={cn("h-3.5 w-3.5", hasErrors ? "text-red-400" : "text-amber-400")} />
                  <span className="text-xs font-semibold">
                    Logic Check: {validationIssues.length} issue{validationIssues.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {validationIssues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px]">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] h-3.5 px-1 shrink-0 mt-0.5",
                          issue.severity === "error" ? "text-red-400 border-red-400/30" :
                          issue.severity === "warning" ? "text-amber-400 border-amber-400/30" :
                          "text-muted-foreground"
                        )}
                      >
                        {issue.severity}
                      </Badge>
                      <span className="text-muted-foreground">{issue.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading session...
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation Stage — extracted to use the conversation hook
// ---------------------------------------------------------------------------

function ConversationStage({
  session,
  equipment_module,
  unit,
  allTags,
  allStates,
  sequentialStates,
  onUpdateSequentialState,
}: {
  session: OperationSession;
  equipment_module: EquipmentModuleConfig;
  unit: UnitConfig;
  allTags: InstrumentTag[];
  allStates: OperatingStateV2[];
  sequentialStates: OperatingState[];
  onUpdateSequentialState: (stateId: string, data: SequentialStateV2) => void;
}) {
  const [chatInput, setChatInput] = useState("");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { sendMessage, startInterview, streamingText, isStreaming, error } =
    useFdsConversation({ session, equipment_module, unit, allTags, allStates });

  // Auto-scroll to bottom when messages change or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.conversation.length, streamingText]);

  const handleSend = useCallback(async () => {
    if (!chatInput.trim() || isStreaming) return;
    const text = chatInput;
    setChatInput("");
    await sendMessage(text);
  }, [chatInput, isStreaming, sendMessage]);

  const hasConversation = session.conversation.length > 0;

  return (
    <div className="flex-1 flex min-h-0">
      {/* Chat pane — collapsible */}
      {chatCollapsed ? (
        <div
          className="w-6 border-r shrink-0 flex items-start justify-center pt-2 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setChatCollapsed(false)}
          title="Expand AI interview panel"
        >
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      ) : (
      <div className="w-[400px] border-r flex flex-col shrink-0">
        {/* Chat header with collapse button */}
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b shrink-0">
          <span className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">AI Interview</span>
          <button
            onClick={() => setChatCollapsed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Collapse chat panel"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Messages */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {!hasConversation && !isStreaming ? (
              <div className="flex items-center justify-center h-[300px]">
                <div className="text-center space-y-3 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mx-auto opacity-30" />
                  <p className="text-xs">
                    Describe how {equipment_module.equipment_module_name} operates,<br />
                    or let the AI interview you.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={startInterview}
                    disabled={isStreaming}
                  >
                    <Sparkles className="h-3 w-3 mr-1.5" />
                    Start AI Interview
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {session.conversation.map((turn, i) => (
                  <div
                    key={i}
                    className={cn(
                      "text-xs rounded-lg px-3 py-2 whitespace-pre-wrap",
                      turn.role === "user"
                        ? "bg-primary/10 ml-8"
                        : turn.role === "assistant"
                          ? "bg-muted/50 mr-8"
                          : "bg-muted/20 text-muted-foreground italic text-center text-[10px]"
                    )}
                  >
                    {turn.content}
                    {turn.table_delta && (
                      <Badge variant="outline" className="mt-1.5 text-[9px]">
                        Table updated
                      </Badge>
                    )}
                  </div>
                ))}

                {/* Streaming indicator */}
                {isStreaming && streamingText && (
                  <div className="text-xs rounded-lg px-3 py-2 bg-muted/50 mr-8 whitespace-pre-wrap">
                    {streamingText}
                    <span className="inline-block w-1.5 h-3 bg-primary/50 animate-pulse ml-0.5" />
                  </div>
                )}
                {isStreaming && !streamingText && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Thinking...
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="flex items-start gap-1.5 text-xs text-red-400 px-3 py-2 bg-red-400/10 rounded-lg">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="p-2 border-t shrink-0">
          <div className="flex gap-1.5">
            <Textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Describe the sequence or answer questions..."
              className="text-xs min-h-[60px] resize-none"
              disabled={isStreaming}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button
              size="icon"
              className="h-[60px] w-10 shrink-0"
              disabled={!chatInput.trim() || isStreaming}
              onClick={handleSend}
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Shift+Enter for new line
          </p>
        </div>
      </div>
      )}

      {/* Table pane */}
      <div className="flex-1 min-w-0">
        <FdsTablePane
          sequentialStates={sequentialStates}
          stateData={session.sequential_states as unknown as Record<string, SequentialStateV2>}
          onUpdateState={onUpdateSequentialState}
          allTags={allTags}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orchestration Stage — unit-level coordination (execution order, interlocks)
// ---------------------------------------------------------------------------

function OrchestrationStage({
  specProjectId,
  unit,
  sessions,
  allStates,
}: {
  specProjectId: string;
  unit: UnitConfig;
  sessions: OperationSession[];
  allStates: OperatingStateV2[];
}) {
  const { data: orchestration } = useFdsOrchestration(specProjectId, unit.unit_id);
  const [chatInput, setChatInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sequentialStates = useMemo(
    () => allStates.filter((s) => s.state_pattern === "sequential"),
    [allStates],
  );

  const { sendMessage, startInterview, streamingText, isStreaming, error } =
    useFdsOrchestrationConversation({
      specProjectId,
      unit,
      sessions,
      orchestration: orchestration ?? null,
      allStates,
    });

  const conversation = orchestration?.conversation ?? [];
  const hasConversation = conversation.length > 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.length, streamingText]);

  const completeCount = sessions.filter((s) => s.status === "complete").length;
  const allComplete = unit.equipment_modules.length > 0 &&
    completeCount === unit.equipment_modules.length;

  const handleSend = useCallback(async () => {
    if (!chatInput.trim() || isStreaming) return;
    const text = chatInput;
    setChatInput("");
    await sendMessage(text);
  }, [chatInput, isStreaming, sendMessage]);

  if (!allComplete) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-6">
        <div className="text-center space-y-3">
          <ShieldAlert className="h-8 w-8 mx-auto opacity-30" />
          <p>Complete all equipment_modules first</p>
          <p className="text-xs">
            {completeCount} of {unit.equipment_modules.length} equipment_modules complete.
            <br />Finish the individual equipment_module behaviours before defining orchestration.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="px-4 py-2.5 border-b flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">{unit.unit_name} — Orchestration</h3>
          <p className="text-[11px] text-muted-foreground">
            Define equipment_module coordination, execution order, and inter-equipment_module interlocks
          </p>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Chat pane */}
        <div className="w-[400px] border-r flex flex-col shrink-0">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {!hasConversation && !isStreaming ? (
                <div className="flex items-center justify-center h-[300px]">
                  <div className="text-center space-y-3 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 mx-auto opacity-30" />
                    <p className="text-xs">
                      Describe how the equipment_modules coordinate,<br />
                      or let the AI interview you.
                    </p>
                    <Button size="sm" variant="outline" onClick={startInterview} disabled={isStreaming}>
                      <Sparkles className="h-3 w-3 mr-1.5" />
                      Start AI Interview
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {conversation.map((turn, i) => (
                    <div
                      key={i}
                      className={cn(
                        "text-xs rounded-lg px-3 py-2 whitespace-pre-wrap",
                        turn.role === "user"
                          ? "bg-primary/10 ml-8"
                          : turn.role === "assistant"
                            ? "bg-muted/50 mr-8"
                            : "bg-muted/20 text-muted-foreground italic text-center text-[10px]"
                      )}
                    >
                      {turn.content}
                    </div>
                  ))}
                  {isStreaming && streamingText && (
                    <div className="text-xs rounded-lg px-3 py-2 bg-muted/50 mr-8 whitespace-pre-wrap">
                      {streamingText}
                      <span className="inline-block w-1.5 h-3 bg-primary/50 animate-pulse ml-0.5" />
                    </div>
                  )}
                  {isStreaming && !streamingText && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Thinking...
                    </div>
                  )}
                </>
              )}
              {error && (
                <div className="flex items-start gap-1.5 text-xs text-red-400 px-3 py-2 bg-red-400/10 rounded-lg">
                  <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
          <div className="p-2 border-t shrink-0">
            <div className="flex gap-1.5">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Describe execution order, interlocks..."
                className="text-xs min-h-[60px] resize-none"
                disabled={isStreaming}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button
                size="icon"
                className="h-[60px] w-10 shrink-0"
                disabled={!chatInput.trim() || isStreaming}
                onClick={handleSend}
              >
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Orchestration display */}
        <div className="flex-1 min-w-0 overflow-auto p-3 space-y-3">
          {sequentialStates.map((state) => {
            const seq = orchestration?.state_sequences[state.state_id];
            return (
              <div key={state.state_id} className="space-y-1.5">
                <h4 className="text-xs font-semibold">{state.state_name}</h4>
                {!seq ? (
                  <p className="text-[11px] text-muted-foreground italic px-1">No orchestration defined</p>
                ) : (
                  <div className="space-y-2 text-xs">
                    {seq.equipment_module_order.length > 0 && (
                      <div>
                        <span className="text-[10px] uppercase text-muted-foreground font-semibold">Order:</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {seq.equipment_module_order.map((asmId, i) => {
                            const asm = unit.equipment_modules.find((a) => a.equipment_module_id === asmId);
                            return (
                              <Badge key={asmId} variant="outline" className="text-[10px] font-mono">
                                {i + 1}. {asm?.equipment_module_name ?? asmId}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {seq.shared_permissives.length > 0 && (
                      <div>
                        <span className="text-[10px] uppercase text-muted-foreground font-semibold">Shared permissives:</span>
                        <ul className="mt-1 space-y-0.5">
                          {seq.shared_permissives.map((p, i) => (
                            <li key={i} className="font-mono text-[11px] pl-2">• {p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {seq.inter_equipment_module_interlocks.length > 0 && (
                      <div>
                        <span className="text-[10px] uppercase text-muted-foreground font-semibold">Inter-equipment_module interlocks:</span>
                        <div className="mt-1 space-y-1">
                          {seq.inter_equipment_module_interlocks.map((il, i) => (
                            <div key={i} className="text-[11px] p-1.5 bg-muted/30 rounded">
                              <div className="font-mono">
                                <span className="text-muted-foreground">{il.source_equipment_module}:</span> {il.source_condition}
                              </div>
                              <div className="text-muted-foreground">→ {il.effect} ({il.target_equipment_module})</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
