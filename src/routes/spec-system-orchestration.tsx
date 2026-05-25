/**
 * System-level Orchestration phase — full-screen route.
 *
 * URL: /specs/:projectId/:specId/system-orchestration
 *
 * Layout mirrors /specs/.../co-author: header bar + two-pane body (left
 * = conversation, right = tabbed overview + per-state tables).
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Loader2,
  Send,
  Sparkles,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSpecProject } from "@/hooks/use-spec-projects";
import {
  useSystemOrchestration,
  useUpsertSystemOrchestration,
} from "@/hooks/use-system-orchestration";
import { useFdsSystemOrchestrationConversation } from "@/hooks/use-fds-system-orchestration-conversation";
import { useUnconfirmedLock } from "@/hooks/use-unconfirmed-lock";
import { UnconfirmedLockBanner } from "@/components/spec-builder/migrate/unconfirmed-lock-banner";
import { SystemOrchestrationGraph } from "@/components/spec-builder/system-orchestration-graph";
import { SystemOrchestrationPermissiveForm } from "@/components/spec-builder/system-orchestration-permissive-form";
import { SystemOrchestrationInterlockForm } from "@/components/spec-builder/system-orchestration-interlock-form";
import {
  migrateSubsystemConfig,
  migrateOperatingStates,
} from "@/types/spec-builder";
import type { SubsystemConfig, OperatingState } from "@/types/spec-builder";
import type {
  SystemStateSequence,
  SharedPermissive,
  InterSubsystemInterlock,
  SystemOrchestration,
} from "@/types/spec-contract-v2";
import { cn } from "@/lib/utils";

export default function SpecSystemOrchestrationPage() {
  const { projectId, specId } = useParams<{
    projectId: string;
    specId: string;
  }>();
  const { isUnconfirmed, migrateHref } = useUnconfirmedLock(projectId ?? "", specId ?? "");
  const { data: rawSpec, isLoading } = useSpecProject(specId);

  const spec = useMemo(() => {
    if (!rawSpec) return null;
    return {
      ...rawSpec,
      confirmed_subsystems: rawSpec.confirmed_subsystems?.length
        ? migrateSubsystemConfig(rawSpec.confirmed_subsystems)
        : [],
      confirmed_states: rawSpec.confirmed_states?.length
        ? migrateOperatingStates(rawSpec.confirmed_states)
        : [],
      scope_exclusions: rawSpec.scope_exclusions ?? [],
      design_principles: rawSpec.design_principles ?? [],
    };
  }, [rawSpec]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!projectId || !specId || !spec) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md p-6 space-y-3">
          <h2 className="text-sm font-semibold">Spec not found</h2>
          <Link
            to={projectId ? `/specs?projectId=${projectId}` : "/specs"}
            className="text-xs underline"
          >
            Back to Spec Builder
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <SystemOrchestrationLayout
      spec={spec}
      projectId={projectId}
      isUnconfirmed={isUnconfirmed}
      migrateHref={migrateHref}
    />
  );
}

function SystemOrchestrationLayout({
  spec,
  projectId,
  isUnconfirmed,
  migrateHref,
}: {
  spec: {
    id: string;
    doc_code: string;
    title: string;
    revision: string;
    confirmed_subsystems: SubsystemConfig[];
    confirmed_states: OperatingState[];
  } & Record<string, unknown>;
  projectId: string;
  isUnconfirmed: boolean;
  migrateHref: string;
}) {
  const subsystems = spec.confirmed_subsystems;
  const states = spec.confirmed_states;
  const sequentialStates = states.filter((s) => s.state_pattern === "sequential");

  const { data: orchestration } = useSystemOrchestration(spec.id);
  const upsert = useUpsertSystemOrchestration();

  const conv = useFdsSystemOrchestrationConversation({
    // casting — our SystemOrchestrationLayout props narrow the spec shape
    spec: spec as unknown as Parameters<typeof useFdsSystemOrchestrationConversation>[0]["spec"],
    subsystems,
    states,
  });

  const [pendingMessage, setPendingMessage] = useState("");
  const [activeTab, setActiveTab] = useState<string>("overview");

  const handleSend = async () => {
    const text = pendingMessage.trim();
    if (!text || conv.isStreaming) return;
    setPendingMessage("");
    await conv.sendMessage(text);
  };

  const persistStateSequence = async (
    stateId: string,
    next: SystemStateSequence,
  ) => {
    const existing = orchestration?.state_sequences ?? {};
    const state_sequences = { ...existing, [stateId]: next };
    await upsert.mutateAsync({
      spec_project_id: spec.id,
      state_sequences,
      conversation: orchestration?.conversation ?? [],
    });
  };

  const emptySequence = (): SystemStateSequence => ({
    subsystem_order: subsystems.filter((s) => !s.excluded).map((s) => s.subsystem_id),
    shared_permissives: [],
    inter_subsystem_interlocks: [],
    notes: null,
  });

  const revisionLabel = (spec as unknown as { latest_approved_revision_id?: string | null })
    ?.latest_approved_revision_id;

  return (
    <div className="flex h-full flex-col -m-4">
      {isUnconfirmed && <UnconfirmedLockBanner migrateHref={migrateHref} />}
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 h-12 shrink-0">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Back to Spec Builder"
        >
          <Link to={`/specs?projectId=${projectId}&specId=${spec.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-sm font-semibold font-mono">{spec.doc_code}</h1>
        <span className="text-xs text-muted-foreground truncate">{spec.title}</span>
        <Badge variant="outline" className="text-[10px] ml-auto">
          System Orchestration
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          Rev {spec.revision}
        </Badge>
        {revisionLabel && (
          <Badge variant="secondary" className="text-[10px]" title={revisionLabel}>
            Approved
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        {/* Left — conversation */}
        <div className="flex flex-col border-r min-h-0">
          <div className="flex items-center justify-between p-3 border-b shrink-0">
            <h2 className="text-xs font-semibold font-mono">Co-author</h2>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={conv.startInterview}
              disabled={conv.isStreaming || sequentialStates.length === 0}
            >
              <Sparkles className="h-3 w-3 mr-1" />
              Start AI Interview
            </Button>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3 space-y-3">
              {(orchestration?.conversation ?? []).map((turn, i) => (
                <div
                  key={i}
                  className={cn(
                    "text-xs whitespace-pre-wrap rounded-md p-2 border",
                    turn.role === "user"
                      ? "bg-primary/10 border-primary/30"
                      : "bg-muted/40",
                  )}
                >
                  <div className="text-[9px] uppercase font-mono text-muted-foreground mb-1">
                    {turn.role}
                  </div>
                  {turn.content}
                </div>
              ))}
              {conv.isStreaming && conv.streamingText && (
                <div className="text-xs whitespace-pre-wrap rounded-md p-2 border bg-muted/40">
                  <div className="text-[9px] uppercase font-mono text-muted-foreground mb-1">
                    assistant (streaming)
                  </div>
                  {conv.streamingText}
                </div>
              )}
              {conv.error && (
                <div className="text-xs rounded-md p-2 border border-destructive/50 bg-destructive/10 text-destructive">
                  {conv.error}
                </div>
              )}
              {conv.validationErrors.length > 0 && (
                <div className="text-xs rounded-md p-2 border border-amber-500/40 bg-amber-500/10 space-y-1">
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    <AlertCircle className="h-3 w-3" />
                    Delta rejected — asking AI to retry
                  </div>
                  {conv.validationErrors.map((e, i) => (
                    <div key={i} className="text-[10px] font-mono">
                      {e}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="p-3 border-t shrink-0 space-y-2">
            <Textarea
              rows={3}
              value={pendingMessage}
              onChange={(e) => setPendingMessage(e.target.value)}
              placeholder="Ask or answer..."
              className="text-xs resize-none"
              disabled={conv.isStreaming}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSend}
                disabled={conv.isStreaming || !pendingMessage.trim()}
              >
                <Send className="h-3 w-3 mr-1" />
                Send
              </Button>
            </div>
          </div>
        </div>

        {/* Right — tabs */}
        <div className="flex flex-col min-h-0">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-col flex-1 min-h-0"
          >
            <TabsList className="rounded-none justify-start border-b shrink-0 h-9">
              <TabsTrigger value="overview" className="text-xs">
                Overview
              </TabsTrigger>
              {sequentialStates.map((s) => (
                <TabsTrigger
                  key={s.state_id}
                  value={`state:${s.state_id}`}
                  className="text-xs font-mono"
                >
                  {s.state_name}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="overview" className="flex-1 min-h-0 m-0 p-0">
              <SystemOrchestrationGraph
                subsystems={subsystems}
                states={states}
                orchestration={orchestration ?? null}
              />
            </TabsContent>
            {sequentialStates.map((s) => {
              const seq =
                orchestration?.state_sequences[s.state_id] ?? emptySequence();
              return (
                <TabsContent
                  key={s.state_id}
                  value={`state:${s.state_id}`}
                  className="flex-1 min-h-0 m-0 p-0 overflow-hidden"
                >
                  <StateEditor
                    state={s}
                    subsystems={subsystems}
                    states={states}
                    sequence={seq}
                    onChange={(next) => persistStateSequence(s.state_id, next)}
                  />
                </TabsContent>
              );
            })}
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-state editor pane
// ---------------------------------------------------------------------------

function StateEditor({
  state,
  subsystems,
  states,
  sequence,
  onChange,
}: {
  state: OperatingState;
  subsystems: SubsystemConfig[];
  states: OperatingState[];
  sequence: SystemStateSequence;
  onChange: (next: SystemStateSequence) => Promise<void> | void;
}) {
  const [addingPermissive, setAddingPermissive] = useState(false);
  const [addingInterlock, setAddingInterlock] = useState(false);

  const subsystemName = (id: string) =>
    subsystems.find((s) => s.subsystem_id === id)?.subsystem_name ?? id;

  const moveOrder = (idx: number, dir: -1 | 1) => {
    const next = [...sequence.subsystem_order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange({ ...sequence, subsystem_order: next });
  };

  const removeOrder = (idx: number) => {
    const next = sequence.subsystem_order.filter((_, i) => i !== idx);
    onChange({ ...sequence, subsystem_order: next });
  };

  const addPermissive = (p: SharedPermissive) => {
    onChange({
      ...sequence,
      shared_permissives: [...sequence.shared_permissives, p],
    });
    setAddingPermissive(false);
  };

  const removePermissive = (id: string) => {
    onChange({
      ...sequence,
      shared_permissives: sequence.shared_permissives.filter(
        (p) => p.permissive_id !== id,
      ),
    });
  };

  const addInterlock = (il: InterSubsystemInterlock) => {
    onChange({
      ...sequence,
      inter_subsystem_interlocks: [...sequence.inter_subsystem_interlocks, il],
    });
    setAddingInterlock(false);
  };

  const removeInterlock = (id: string) => {
    onChange({
      ...sequence,
      inter_subsystem_interlocks: sequence.inter_subsystem_interlocks.filter(
        (il) => il.interlock_id !== id,
      ),
    });
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5">
        <div>
          <h3 className="text-xs font-mono font-semibold mb-1">
            {state.state_name}
          </h3>
          <p className="text-[10px] text-muted-foreground">
            {state.description}
          </p>
        </div>

        {/* Subsystem order */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold font-mono">Subsystem order</h4>
          {sequence.subsystem_order.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              No ordering yet. The AI interview will seed one.
            </p>
          ) : (
            <ol className="space-y-1">
              {sequence.subsystem_order.map((id, i) => (
                <li
                  key={id}
                  className="flex items-center gap-2 text-xs border rounded-md px-2 py-1 font-mono"
                >
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1 truncate">{subsystemName(id)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={() => moveOrder(i, -1)}
                    disabled={i === 0}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={() => moveOrder(i, 1)}
                    disabled={i === sequence.subsystem_order.length - 1}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={() => removeOrder(i)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Shared permissives */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold font-mono">
              Shared permissives ({sequence.shared_permissives.length})
            </h4>
            {!addingPermissive && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={() => setAddingPermissive(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            )}
          </div>
          {sequence.shared_permissives.map((p) => (
            <div
              key={p.permissive_id}
              className="text-xs border rounded-md p-2 space-y-1"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {p.permissive_id}
                </span>
                <span className="flex-1 truncate">{p.prose}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5"
                  onClick={() => removePermissive(p.permissive_id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">
                {p.condition.kind === "expression"
                  ? p.condition.text
                  : JSON.stringify(p.condition)}
              </div>
            </div>
          ))}
          {addingPermissive && (
            <SystemOrchestrationPermissiveForm
              subsystems={subsystems}
              onSubmit={addPermissive}
              onCancel={() => setAddingPermissive(false)}
            />
          )}
        </section>

        {/* Inter-subsystem interlocks */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold font-mono">
              Inter-subsystem interlocks (
              {sequence.inter_subsystem_interlocks.length})
            </h4>
            {!addingInterlock && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={() => setAddingInterlock(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            )}
          </div>
          {sequence.inter_subsystem_interlocks.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              No interlocks defined for this state.
            </p>
          ) : (
            <table className="w-full text-xs border rounded-md overflow-hidden">
              <thead className="text-[10px] font-mono bg-muted/40">
                <tr>
                  <th className="text-left p-1.5">ID</th>
                  <th className="text-left p-1.5">Source</th>
                  <th className="text-left p-1.5">Condition</th>
                  <th className="text-left p-1.5">Target</th>
                  <th className="text-left p-1.5">Effect</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sequence.inter_subsystem_interlocks.map((il) => (
                  <tr key={il.interlock_id} className="border-t">
                    <td className="p-1.5 font-mono text-[10px] text-muted-foreground">
                      {il.interlock_id}
                    </td>
                    <td className="p-1.5">
                      {subsystemName(il.source_subsystem_id)}
                    </td>
                    <td className="p-1.5 font-mono text-[10px]">
                      {il.source_condition.kind === "expression"
                        ? il.source_condition.text
                        : il.source_condition.kind}
                    </td>
                    <td className="p-1.5">
                      {subsystemName(il.target_subsystem_id)}
                    </td>
                    <td className="p-1.5 font-mono text-[10px]">
                      {il.effect}
                      {il.effect_target?.state_id
                        ? ` → ${il.effect_target.state_id}`
                        : ""}
                    </td>
                    <td className="p-1.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5"
                        onClick={() => removeInterlock(il.interlock_id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {addingInterlock && (
            <SystemOrchestrationInterlockForm
              subsystems={subsystems}
              states={states}
              onSubmit={addInterlock}
              onCancel={() => setAddingInterlock(false)}
            />
          )}
        </section>
      </div>
    </ScrollArea>
  );
}

// Unused-export guard — keeps the type import live for the casted conv call.
export type _InternalSystemOrchestration = SystemOrchestration;
