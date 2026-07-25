/**
 * Hook for the FDS co-author AI conversation.
 * Manages streaming interview with JSON extraction for live table updates.
 *
 * Hybrid per-EM state model (Task 9b) — two stages, keyed by the EM's OWN
 * authored states (EmStateV2, EM-local string slugs), NOT the global PackML
 * state list:
 *
 *   Stage A (state machine): when the session has no `em_states` yet, run the
 *     state-machine interview (buildEmStateMachineInterviewPrompt). Extract the
 *     `{ states, transitions }` proposal, validate it, and persist to the
 *     session's `em_states` / `em_transitions`.
 *
 *   Stage B (behavior): once `em_states` exist, run the per-state behavior
 *     interview (buildFdsInterviewSystemPrompt) keyed by the `sequential`-kind
 *     EM states, persisting per-state behavior to `sequential_states` keyed by
 *     the EM-local state_id slug. SP-3c: a sequential state may instead be
 *     command-driven — its blocks carry `command_behavior` (branches +
 *     default_hold) and persist to the session's `command_behavior` column;
 *     steps and command_behavior are mutually exclusive per state.
 */
import { useState, useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import type { PromptLayerMeta } from "@/hooks/use-generation";
import {
  buildFdsInterviewSystemPrompt,
  buildFdsOpeningMessage,
  extractJsonFromResponse,
  stripJsonFromResponse,
} from "@/lib/spec-builder/fds-prompts";
import {
  buildEmStateMachineInterviewPrompt,
  buildEmStateMachineOpeningMessage,
} from "@/lib/spec-builder/em-state-machine-prompts";
import {
  parseStateMachineProposal,
  isLikelyTruncatedProposal,
  validateEmStateMachineAndPackml,
} from "@/lib/spec-builder/em-state-machine";
import type {
  EquipmentModuleConfig,
  UnitConfig,
  InstrumentTag,
  OperationSession,
  FdsConversationTurn,
} from "@/types/spec-builder";
import type {
  PermissiveCondition,
  SequentialStateV2,
  EmStateV2,
  OperatorMode,
  CommandBehaviorV2,
} from "@/types/spec-contract-v2";
import { CommandBehaviorV2Schema } from "@/types/spec-contract-v2";
import { ensureV2 } from "@/lib/spec-builder/sequence-legacy-shim";
import { SpecContractPatchSchema, validateSpecContractPatch } from "@/lib/spec-builder/contract";
import { buildValidationFailureTurn } from "@/lib/spec-builder/validation-failure-turn";
import { useSourceSectionsForEm } from "@/hooks/use-source-sections";

/** The FDS co-author is the brains of the pipeline — pinned to Opus 5.
 * Thinking is on by default (the generate edge function ignores thinking
 * deltas when streaming and finds the text block explicitly non-streaming,
 * so `content[0]` being a thinking block is already handled).
 *
 * Opus 5 over Fable 5: half the token cost ($5/$25 vs $10/$50), and Fable is
 * tuned for long-horizon autonomous runs where a single request can take
 * minutes — the wrong shape for an interactive Stage A/B interview. Fable
 * also requires 30-day data retention. Fable remains the higher-capability
 * tier if the co-author ever needs it. */
const FDS_CO_AUTHOR_MODEL = "claude-opus-5";

/** Which stage of the co-author interview is active for this EM. */
export type FdsConversationStage = "state_machine" | "behavior";

interface UseFdsConversationOptions {
  session: OperationSession;
  equipment_module: EquipmentModuleConfig;
  unit: UnitConfig;
  allTags: InstrumentTag[];
  /** Project-level machine modes — states are gated by these (Stage A). */
  modes: OperatorMode[];
}

interface UseFdsConversationReturn {
  /** "state_machine" until the EM has authored states; then "behavior". */
  stage: FdsConversationStage;
  /** The EM's authored states (empty until Stage A persists them). */
  emStates: EmStateV2[];
  sendMessage: (text: string) => Promise<void>;
  startInterview: () => Promise<void>;
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
}

export function useFdsConversation({
  session,
  equipment_module,
  unit,
  allTags,
  modes,
}: UseFdsConversationOptions): UseFdsConversationReturn {
  const queryClient = useQueryClient();
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Customer-spec requirements bound to THIS equipment module at ingest (Gap 2).
  const { data: emSections = [] } = useSourceSectionsForEm(
    session.spec_project_id,
    equipment_module.equipment_module_id,
  );

  // Hybrid state model (Task 9b): source the EM's OWN authored states from the
  // session (persisted by Stage A / the contract reader). No global allStates.
  const emStates = useMemo<EmStateV2[]>(
    () => session.em_states ?? [],
    [session.em_states],
  );

  // Stage A until the EM has authored its states; Stage B afterwards.
  const stage: FdsConversationStage =
    emStates.length === 0 ? "state_machine" : "behavior";

  // Stage B walks the EM's OWN sequential-kind states.
  const sequentialStates = useMemo<EmStateV2[]>(
    () => emStates.filter((s) => s.kind === "sequential"),
    [emStates],
  );

  const stateLabelFor = useCallback(
    (stateId: string): string => {
      const matched = emStates.find((s) => s.state_id === stateId);
      if (!matched) return `state_id ${stateId}`;
      return `${matched.name} (state_id ${stateId})`;
    },
    [emStates],
  );

  const buildSystemPrompt = useCallback(() => {
    return buildFdsInterviewSystemPrompt(
      equipment_module, unit, allTags,
      session.static_states,
      // Prompt builder now consumes SequentialStateV2 directly (Phase 3 Task 2).
      session.sequential_states,
      emStates,
      emSections,
      // SP-3c: authored command-driven states render as completed.
      session.command_behavior ?? {},
    );
  }, [equipment_module, unit, allTags, session.static_states, session.sequential_states, session.command_behavior, emStates, emSections]);

  const buildMessages = useCallback(
    (extraUserMessage?: string) => {
      const msgs: Array<{ role: string; content: string }> = [];
      for (const turn of session.conversation) {
        if (turn.role === "user" || turn.role === "assistant") {
          // The Anthropic API rejects any message with empty content. Assistant
          // turns whose prose was stripped to "" (JSON-only responses, where
          // stripJsonFromResponse returns an empty string) would otherwise poison
          // every subsequent call. Substitute a neutral placeholder so a JSON-only
          // turn never breaks conversation replay for any EM/project.
          const content =
            turn.content && turn.content.trim().length > 0
              ? turn.content
              : "(Proposed a sequence/state update.)";
          msgs.push({ role: turn.role, content });
        }
      }
      if (extraUserMessage) {
        msgs.push({ role: "user", content: extraUserMessage });
      }
      return msgs;
    },
    [session.conversation],
  );

  const persistTurn = useCallback(
    async (turn: FdsConversationTurn, tableUpdates?: Array<{ state_id: string; data: SequentialStateV2 }>) => {
      const conversation = [...session.conversation, turn];
      const update: Record<string, unknown> = { conversation };

      if (tableUpdates && tableUpdates.length > 0) {
        const existing = { ...session.sequential_states };
        for (const { state_id, data } of tableUpdates) {
          existing[state_id] = data;
        }
        update.sequential_states = existing;
        if (session.status === "static_confirmed") update.status = "in_progress";
      }

      await supabase
        .from("fds_operation_sessions")
        .update(update)
        .eq("id", session.id);

      queryClient.invalidateQueries({ queryKey: ["fds_operation_sessions"] });
    },
    [session, queryClient],
  );

  const resolveStateId = useCallback(
    (rawId: string | undefined): string | undefined => {
      const firstId = sequentialStates[0]?.state_id;
      if (!rawId) return firstId;
      if (sequentialStates.some((s) => s.state_id === rawId)) return rawId;
      const byName = sequentialStates.find(
        (s) =>
          s.name.toLowerCase() === rawId.toLowerCase() ||
          s.state_id.toLowerCase() === rawId.toLowerCase(),
      );
      return byName?.state_id ?? firstId;
    },
    [sequentialStates],
  );

  const processAiResponse = useCallback(
    (fullText: string): {
      updates: Array<{ state_id: string; data: SequentialStateV2 }>;
      commandUpdates: Array<{ state_id: string; data: CommandBehaviorV2 }>;
      failures: Array<{ state_id: string; issues: string[]; stateLabel: string }>;
    } => {
      const extracted = extractJsonFromResponse(fullText) as unknown as Array<Record<string, unknown>> | null;
      if (!extracted || extracted.length === 0) {
        return { updates: [], commandUpdates: [], failures: [] };
      }

      const updates: Array<{ state_id: string; data: SequentialStateV2 }> = [];
      const commandUpdates: Array<{ state_id: string; data: CommandBehaviorV2 }> = [];
      const failures: Array<{ state_id: string; issues: string[]; stateLabel: string }> = [];

      for (const block of extracted) {
        const rawStateId = block.state_id;
        const stateId = resolveStateId(
          typeof rawStateId === "number" ? String(rawStateId) : (rawStateId as string | undefined),
        );
        if (!stateId) continue;

        // SP-3c: route on shape. A block carrying command_behavior authors
        // command-conditional holds for the state; a steps block keeps the
        // existing path. A state is EITHER automatic (steps) OR command-driven
        // (command_behavior) — never both.
        if (block.command_behavior !== undefined) {
          if (block.steps !== undefined) {
            failures.push({
              state_id: stateId,
              issues: [`State "${stateId}": a block must carry EITHER steps OR command_behavior, not both.`],
              stateLabel: stateLabelFor(stateId),
            });
            continue;
          }
          // XOR vs steps — both the persisted sequence AND a steps block that
          // already merged earlier in this same response (updates), so block
          // order within one AI reply cannot smuggle both shapes in.
          if (
            (session.sequential_states[stateId]?.steps?.length ?? 0) > 0 ||
            updates.some((u) => u.state_id === stateId)
          ) {
            failures.push({
              state_id: stateId,
              issues: [`State "${stateId}" already has an authored step sequence. A state is either automatic (steps) or command-driven (command_behavior) — clear the steps first.`],
              stateLabel: stateLabelFor(stateId),
            });
            continue;
          }
          const parsedCb = CommandBehaviorV2Schema.safeParse(block.command_behavior);
          if (!parsedCb.success) {
            failures.push({
              state_id: stateId,
              issues: parsedCb.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
              stateLabel: stateLabelFor(stateId),
            });
            continue;
          }
          // Patch gate: same two-stage machinery as steps blocks. Includes the
          // EM's authored states/transitions so validateCommandBehavior's
          // key-must-be-sequential check engages.
          const cbPatch = {
            equipment_modules: {
              [equipment_module.equipment_module_id]: {
                equipment_module_id: equipment_module.equipment_module_id,
                unit_id: unit.unit_id,
                states: session.em_states ?? [],
                transitions: session.em_transitions ?? [],
                static_states: session.static_states,
                sequential_states: session.sequential_states,
                command_behavior: { ...(session.command_behavior ?? {}), [stateId]: parsedCb.data },
              },
            },
          };
          const cbParsed = SpecContractPatchSchema.safeParse(cbPatch);
          const cbIssues: string[] = [];
          if (!cbParsed.success) {
            for (const issue of cbParsed.error.issues) cbIssues.push(`${issue.path.join(".")}: ${issue.message}`);
          } else {
            cbIssues.push(...validateSpecContractPatch(cbParsed.data));
          }
          if (cbIssues.length > 0) {
            failures.push({ state_id: stateId, issues: cbIssues, stateLabel: stateLabelFor(stateId) });
            continue;
          }
          commandUpdates.push({ state_id: stateId, data: parsedCb.data });
          continue;
        }

        // Non-command block (steps/permissives/notes) for a command-driven
        // state → XOR failure. Fires for ANY table update targeting the state,
        // not only blocks carrying a steps key — a command-driven state has no
        // steps/permissives slots to update.
        if (
          session.command_behavior?.[stateId] !== undefined ||
          commandUpdates.some((u) => u.state_id === stateId)
        ) {
          failures.push({
            state_id: stateId,
            issues: [`State "${stateId}" is authored as command-driven (command_behavior). It cannot be updated via a steps/permissives block — re-emit it as command_behavior, or clear the command behaviour first.`],
            stateLabel: stateLabelFor(stateId),
          });
          continue;
        }

        const existing = session.sequential_states[stateId] ?? { permissives: [], steps: [], notes: null };
        const merged: SequentialStateV2 = {
          ...existing,
          override_kind: (block.override_kind as SequentialStateV2["override_kind"]) ?? existing.override_kind ?? "override",
          permissives: (block.permissives as PermissiveCondition[]) ?? existing.permissives,
          steps: (block.steps as SequentialStateV2["steps"]) ?? existing.steps,
          notes: (block.notes as string | null) ?? existing.notes,
        };
        const v2 = ensureV2(merged, stateId);

        // Phase 3 — hard validator gate. Build a per-state equipment_module patch
        // and check it. Any issues abort just this block; valid blocks in
        // the same response still merge.
        const patch = {
          equipment_modules: {
            [equipment_module.equipment_module_id]: {
              equipment_module_id: equipment_module.equipment_module_id,
              unit_id: unit.unit_id,
              static_states: session.static_states,
              sequential_states: {
                ...session.sequential_states,
                [stateId]: v2,
              },
            },
          },
        };
        // Phase 3 — two-stage gate. Zod first (catches shape issues: bad enum
        // values, missing required fields, wrong discriminator kinds). Structural
        // validator second (catches cross-row invariants: override_kind content,
        // PackML range, modes, parameter_ref).
        const parsed = SpecContractPatchSchema.safeParse(patch);
        const issues: string[] = [];
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            issues.push(`${issue.path.join(".")}: ${issue.message}`);
          }
        } else {
          issues.push(...validateSpecContractPatch(parsed.data));
        }
        if (issues.length > 0) {
          failures.push({ state_id: stateId, issues, stateLabel: stateLabelFor(stateId) });
          continue;
        }

        updates.push({ state_id: stateId, data: v2 });
      }

      return { updates, commandUpdates, failures };
    },
    [
      resolveStateId, session.sequential_states, session.static_states,
      session.em_states, session.em_transitions, session.command_behavior,
      equipment_module.equipment_module_id, unit.unit_id, stateLabelFor,
    ],
  );

  // -------------------------------------------------------------------------
  // Stage A — state-machine interview: persist the proposed {states,transitions}
  // to the session's em_states / em_transitions after validation.
  // -------------------------------------------------------------------------
  const handleStateMachineResponse = useCallback(
    async (
      fullText: string,
      conversationWithUser: FdsConversationTurn[],
    ) => {
      const proposal = parseStateMachineProposal(fullText);
      const proseContent = stripJsonFromResponse(fullText);
      const assistantTurn: FdsConversationTurn = {
        role: "assistant",
        content: proseContent,
        timestamp: new Date().toISOString(),
      };

      if (!proposal) {
        // The AI either is still interviewing (no json fence) OR tried to emit a
        // machine that failed to parse (truncated past the token budget, malformed,
        // or schema-invalid). The latter must NOT be persisted as silent prose —
        // that drops the whole machine with no error shown. Surface it loudly so
        // the engineer can ask the AI to re-emit (a more compact machine if large).
        const extraTurns: FdsConversationTurn[] = [];
        if (isLikelyTruncatedProposal(fullText)) {
          extraTurns.push(
            buildValidationFailureTurn({
              stateLabel: `${equipment_module.equipment_module_name} state machine`,
              issues: [
                "The AI started a JSON state-machine block but it could not be parsed — it was likely truncated (too large for one response), malformed, or schema-invalid. Nothing was persisted.",
                "Ask the AI to re-emit the COMPLETE machine as a single JSON block (split into fewer states/leaner guards if it is large).",
              ],
            }),
          );
        }
        await supabase
          .from("fds_operation_sessions")
          .update({ conversation: [...conversationWithUser, assistantTurn, ...extraTurns] })
          .eq("id", session.id);
        queryClient.invalidateQueries({ queryKey: ["fds_operation_sessions"] });
        return;
      }

      // Validate the proposed machine before persisting: structural invariants
      // AND PackML conformance (SP-3b). Non-PackML slugs / a non-"aborted" safe
      // state are hard-blocked here so em_states only ever holds PackML slugs —
      // making C5 Case A coverage non-vacuous. Empty behavior maps: only
      // states/transitions matter at this gate.
      const issues = validateEmStateMachineAndPackml({
        equipment_module_id: equipment_module.equipment_module_id,
        unit_id: unit.unit_id,
        states: proposal.states,
        transitions: proposal.transitions,
        static_states: {},
        sequential_states: {},
      });

      if (issues.length > 0) {
        const failureTurn = buildValidationFailureTurn({
          stateLabel: `${equipment_module.equipment_module_name} state machine`,
          issues,
        });
        await supabase
          .from("fds_operation_sessions")
          .update({ conversation: [...conversationWithUser, assistantTurn, failureTurn] })
          .eq("id", session.id);
        queryClient.invalidateQueries({ queryKey: ["fds_operation_sessions"] });
        return;
      }

      // Valid — persist the EM's authored state machine.
      await supabase
        .from("fds_operation_sessions")
        .update({
          conversation: [...conversationWithUser, assistantTurn],
          em_states: proposal.states,
          em_transitions: proposal.transitions,
        })
        .eq("id", session.id);
      queryClient.invalidateQueries({ queryKey: ["fds_operation_sessions"] });
    },
    [session.id, equipment_module.equipment_module_id, equipment_module.equipment_module_name, unit.unit_id, queryClient],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming || !text.trim()) return;

      setIsStreaming(true);
      setStreamingText("");
      setError(null);
      abortRef.current = new AbortController();

      try {
        const userTurn: FdsConversationTurn = {
          role: "user",
          content: text.trim(),
          timestamp: new Date().toISOString(),
        };

        // Snapshot conversation with user turn so the assistant persist
        // doesn't overwrite it (session.conversation is a stale closure).
        const conversationWithUser = [...session.conversation, userTurn];
        await supabase
          .from("fds_operation_sessions")
          .update({ conversation: conversationWithUser })
          .eq("id", session.id);

        // Stage-appropriate system prompt.
        const systemPrompt =
          stage === "state_machine"
            ? buildEmStateMachineInterviewPrompt(equipment_module, unit, modes, emSections)
            : buildSystemPrompt();
        const messages = buildMessages(text.trim());

        const plMeta: PromptLayerMeta = {
          prompt_name: stage === "state_machine" ? "fds_state_machine" : "fds_interview",
          agent_role: "fds_co_author",
          model: FDS_CO_AUTHOR_MODEL,
        };

        // A complete state machine for a complex EM (many states + a fault fan-in
        // of one transition per fault tag) is a single structured JSON emission
        // that easily exceeds the 8192 interview budget. Truncation there silently
        // drops the whole machine, so give the state-machine stage the full ceiling
        // (the generate Edge Function caps at 32768). Interview turns stay lean.
        const maxTokens = stage === "state_machine" ? 32768 : 8192;
        let fullText = "";
        await streamFromEdgeFunction(
          { system_prompt: systemPrompt, messages, model: FDS_CO_AUTHOR_MODEL, stream: true },
          abortRef.current.signal,
          (chunk) => {
            fullText += chunk;
            setStreamingText(fullText);
          },
          maxTokens,
          plMeta,
        );

        if (stage === "state_machine") {
          await handleStateMachineResponse(fullText, conversationWithUser);
          return;
        }

        // Stage B — extract JSON (may contain multiple states), validate, persist.
        const { updates: tableUpdates, commandUpdates, failures } = processAiResponse(fullText);
        const proseContent = stripJsonFromResponse(fullText);

        const assistantTurn: FdsConversationTurn = {
          role: "assistant",
          content: proseContent,
          timestamp: new Date().toISOString(),
          table_delta: tableUpdates[0]?.data,
        };

        const failureTurns = failures.map((f) =>
          buildValidationFailureTurn({
            stateLabel: f.stateLabel,
            issues: f.issues,
            stateContext: f.state_id,
          }),
        );

        // Append assistant turn + any failure turns (failures come after the
        // assistant message so the engineer sees the AI's prose first, then
        // the validator's complaint).
        const conversationWithBoth = [...conversationWithUser, assistantTurn, ...failureTurns];
        const update: Record<string, unknown> = { conversation: conversationWithBoth };
        if (tableUpdates.length > 0) {
          const existing = { ...session.sequential_states };
          for (const { state_id, data } of tableUpdates) {
            existing[state_id] = data;
          }
          update.sequential_states = existing;
          if (session.status === "static_confirmed") update.status = "in_progress";
        }
        if (commandUpdates.length > 0) {
          const existingCb = { ...(session.command_behavior ?? {}) };
          for (const { state_id, data } of commandUpdates) {
            existingCb[state_id] = data;
          }
          update.command_behavior = existingCb;
          if (session.status === "static_confirmed") update.status = "in_progress";
        }
        await supabase
          .from("fds_operation_sessions")
          .update(update)
          .eq("id", session.id);
        queryClient.invalidateQueries({ queryKey: ["fds_operation_sessions"] });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Conversation failed");
      } finally {
        setIsStreaming(false);
        setStreamingText("");
      }
    },
    [
      isStreaming, stage, buildSystemPrompt, buildMessages, processAiResponse,
      handleStateMachineResponse, equipment_module, unit, modes, emSections,
      session.id, session.conversation, session.sequential_states, session.status,
      session.command_behavior, queryClient,
    ],
  );

  const startInterview = useCallback(async () => {
    if (isStreaming) return;

    setIsStreaming(true);
    setStreamingText("");
    setError(null);
    abortRef.current = new AbortController();

    try {
      const isStageA = stage === "state_machine";

      const systemPrompt = isStageA
        ? buildEmStateMachineInterviewPrompt(equipment_module, unit, modes, emSections)
        : buildSystemPrompt();

      const openingPrompt = isStageA
        ? buildEmStateMachineOpeningMessage(equipment_module, emSections)
        : buildFdsOpeningMessage(
            equipment_module,
            allTags,
            sequentialStates[0]?.name ?? "the first sequential state",
            emSections,
          );

      const plMeta: PromptLayerMeta = {
        prompt_name: isStageA ? "fds_state_machine_opening" : "fds_interview_opening",
        agent_role: "fds_co_author",
        model: FDS_CO_AUTHOR_MODEL,
      };

      let fullText = "";
      await streamFromEdgeFunction(
        { system_prompt: systemPrompt, messages: [{ role: "user", content: openingPrompt }], model: FDS_CO_AUTHOR_MODEL, stream: true },
        abortRef.current.signal,
        (chunk) => {
          fullText += chunk;
          setStreamingText(fullText);
        },
        // Stage A's opening generates the full state machine (states +
        // transitions with real per-fault guards) — that easily exceeds a
        // small budget and silently truncates the JSON. Give it the full cap
        // (edge fn caps at 32768). Stage B's opening is a short question.
        isStageA ? 32768 : 4096,
        plMeta,
      );

      if (isStageA) {
        // The opening message is conversational (a question); persist as-is.
        // A proposal block, if present, is still handled here.
        await handleStateMachineResponse(fullText, [...session.conversation]);
        return;
      }

      const proseContent = stripJsonFromResponse(fullText);
      const assistantTurn: FdsConversationTurn = {
        role: "assistant",
        content: proseContent,
        timestamp: new Date().toISOString(),
      };
      await persistTurn(assistantTurn);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to start interview");
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [
    isStreaming, stage, buildSystemPrompt, equipment_module, unit, modes,
    emSections, allTags, sequentialStates, handleStateMachineResponse,
    session.conversation, persistTurn,
  ]);

  return { stage, emStates, sendMessage, startInterview, streamingText, isStreaming, error };
}
