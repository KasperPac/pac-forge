/**
 * Hook for the FDS co-author AI conversation.
 * Manages streaming interview with JSON extraction for live table updates.
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
import type {
  EquipmentModuleConfig,
  UnitConfig,
  InstrumentTag,
  OperationSession,
  FdsConversationTurn,
} from "@/types/spec-builder";
import type {
  OperatingStateV2,
  PermissiveCondition,
  SequentialStateV2,
  EmStateV2,
} from "@/types/spec-contract-v2";
import { ensureV2 } from "@/lib/spec-builder/sequence-legacy-shim";
import { SpecContractPatchSchema, validateSpecContractPatch } from "@/lib/spec-builder/contract";
import { buildValidationFailureTurn } from "@/lib/spec-builder/validation-failure-turn";
import { useSourceSectionsForEm } from "@/hooks/use-source-sections";

interface UseFdsConversationOptions {
  session: OperationSession;
  equipment_module: EquipmentModuleConfig;
  unit: UnitConfig;
  allTags: InstrumentTag[];
  allStates: OperatingStateV2[];
}

interface UseFdsConversationReturn {
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
  allStates,
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

  const sequentialStates = allStates.filter((s) => s.state_pattern === "sequential");

  const stateLabelFor = (stateId: string): string => {
    const matched = allStates.find((s) => String(s.state_id) === stateId);
    if (!matched) return `state_id ${stateId}`;
    const name = matched.display_name ?? matched.state_name ?? matched.custom_name ?? stateId;
    return `${name} (state_id ${stateId})`;
  };

  // Task 9 — the per-EM behavior interview is now keyed by the EM's OWN states
  // (EmStateV2, EM-local string slugs) rather than the global PackML state list.
  //
  // CONCERN (Stage-A wiring): this hook does not yet load the persisted
  // EquipmentModuleContract.states authored in Stage A (Task 8); neither
  // OperationSession nor EquipmentModuleConfig carries EmStateV2[]. To keep the
  // build green and the prompt correctly typed/keyed by string slugs, we adapt
  // the global OperatingStateV2[] into EmStateV2[] here, preserving the existing
  // String(state_id) keys so session.static_states / sequential_states (which are
  // keyed by those same ids) still resolve. Once the EM's authored states are
  // threaded into this hook (and the session maps re-keyed to EM-local slugs),
  // replace this adapter with the real EquipmentModuleContract.states.
  const emStates = useMemo<EmStateV2[]>(
    () =>
      allStates.map((s) => ({
        state_id: String(s.state_id),
        name: s.display_name ?? s.state_name ?? s.custom_name ?? String(s.state_id),
        kind: s.state_pattern === "sequential" ? "sequential" : "static",
        allowed_modes: [],
        is_safe_state: false,
      })),
    [allStates],
  );

  const buildSystemPrompt = useCallback(() => {
    return buildFdsInterviewSystemPrompt(
      equipment_module, unit, allTags,
      session.static_states,
      // Prompt builder now consumes SequentialStateV2 directly (Phase 3 Task 2).
      session.sequential_states,
      emStates,
      emSections,
    );
  }, [equipment_module, unit, allTags, session.static_states, session.sequential_states, emStates, emSections]);

  const buildMessages = useCallback(
    (extraUserMessage?: string) => {
      const msgs: Array<{ role: string; content: string }> = [];
      for (const turn of session.conversation) {
        if (turn.role === "user" || turn.role === "assistant") {
          msgs.push({ role: turn.role, content: turn.content });
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
      const firstId =
        sequentialStates[0]?.state_id !== undefined ? String(sequentialStates[0].state_id) : undefined;
      if (!rawId) return firstId;
      if (sequentialStates.some((s) => String(s.state_id) === rawId)) return rawId;
      const byName = sequentialStates.find(
        (s) =>
          (s.state_name?.toLowerCase() === rawId.toLowerCase()) ||
          String(s.state_id).toLowerCase() === rawId.toLowerCase(),
      );
      return byName?.state_id !== undefined ? String(byName.state_id) : firstId;
    },
    [sequentialStates],
  );

  const processAiResponse = useCallback(
    (fullText: string): {
      updates: Array<{ state_id: string; data: SequentialStateV2 }>;
      failures: Array<{ state_id: string; issues: string[]; stateLabel: string }>;
    } => {
      const extracted = extractJsonFromResponse(fullText) as unknown as Array<Record<string, unknown>> | null;
      if (!extracted || extracted.length === 0) {
        return { updates: [], failures: [] };
      }

      const updates: Array<{ state_id: string; data: SequentialStateV2 }> = [];
      const failures: Array<{ state_id: string; issues: string[]; stateLabel: string }> = [];

      for (const block of extracted) {
        const rawStateId = block.state_id;
        const stateId = resolveStateId(
          typeof rawStateId === "number" ? String(rawStateId) : (rawStateId as string | undefined),
        );
        if (!stateId) continue;

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

      return { updates, failures };
    },
    [resolveStateId, session.sequential_states, session.static_states, equipment_module.equipment_module_id, unit.unit_id, allStates],
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

        // Stream AI response
        const systemPrompt = buildSystemPrompt();
        const messages = buildMessages(text.trim());

        const plMeta: PromptLayerMeta = {
          prompt_name: "fds_interview",
          agent_role: "fds_co_author",
          model: "claude-sonnet-4-6",
        };

        let fullText = "";
        await streamFromEdgeFunction(
          { system_prompt: systemPrompt, messages, stream: true },
          abortRef.current.signal,
          (chunk) => {
            fullText += chunk;
            setStreamingText(fullText);
          },
          8192,
          plMeta,
        );

        // Extract JSON (may contain multiple states), validate, then persist
        const { updates: tableUpdates, failures } = processAiResponse(fullText);
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
    [isStreaming, buildSystemPrompt, buildMessages, persistTurn, processAiResponse],
  );

  const startInterview = useCallback(async () => {
    if (isStreaming) return;

    setIsStreaming(true);
    setStreamingText("");
    setError(null);
    abortRef.current = new AbortController();

    try {
      const firstState = sequentialStates[0];
      if (!firstState) throw new Error("No sequential states defined");

      const systemPrompt = buildSystemPrompt();
      // buildFdsOpeningMessage still accepts the legacy OperatingState; bridge
      // until Task 10 narrows it. Only `state_name` is read inside.
      const openingPrompt = buildFdsOpeningMessage(
        equipment_module,
        allTags,
        firstState as unknown as import("@/types/spec-builder").OperatingState,
      );

      const plMeta: PromptLayerMeta = {
        prompt_name: "fds_interview_opening",
        agent_role: "fds_co_author",
        model: "claude-sonnet-4-6",
      };

      let fullText = "";
      await streamFromEdgeFunction(
        { system_prompt: systemPrompt, messages: [{ role: "user", content: openingPrompt }], stream: true },
        abortRef.current.signal,
        (chunk) => {
          fullText += chunk;
          setStreamingText(fullText);
        },
        4096,
        plMeta,
      );

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
  }, [isStreaming, buildSystemPrompt, equipment_module, allTags, sequentialStates, persistTurn]);

  return { sendMessage, startInterview, streamingText, isStreaming, error };
}
