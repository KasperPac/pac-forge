/**
 * Hook for unit orchestration conversation.
 * After individual equipment_modules are defined, engineer and AI collaborate
 * on how the equipment_modules coordinate (execution order, inter-equipment_module interlocks).
 */
import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import type { PromptLayerMeta } from "@/hooks/use-generation";
import {
  buildFdsOrchestrationSystemPrompt,
  buildFdsOrchestrationOpeningMessage,
  extractJsonFromResponse,
  stripJsonFromResponse,
} from "@/lib/spec-builder/fds-prompts";
import type {
  UnitConfig,
  OperationSession,
  UnitProcedure,
  FdsConversationTurn,
} from "@/types/spec-builder";
import type {
  InterEquipmentModuleInterlock,
  OperatingStateV2,
  SharedPermissive,
  UnitProcedureSequence,
} from "@/types/spec-contract-v2";
import { SpecContractPatchSchema, validateSpecContractPatch } from "@/lib/spec-builder/contract";
import { buildValidationFailureTurn } from "@/lib/spec-builder/validation-failure-turn";

interface UseFdsOrchestrationConversationOptions {
  specProjectId: string;
  unit: UnitConfig;
  sessions: OperationSession[];
  orchestration: UnitProcedure | null;
  allStates: OperatingStateV2[];
}

interface UseFdsOrchestrationConversationReturn {
  sendMessage: (text: string) => Promise<void>;
  startInterview: () => Promise<void>;
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
}

export function useFdsOrchestrationConversation({
  specProjectId,
  unit,
  sessions,
  orchestration,
  allStates,
}: UseFdsOrchestrationConversationOptions): UseFdsOrchestrationConversationReturn {
  const queryClient = useQueryClient();
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sequentialStates = allStates.filter((s) => s.state_pattern === "sequential");

  const equipment_moduleSummaries = sessions
    .filter((s) => s.status === "complete")
    .map((s) => {
      const asm = unit.equipment_modules.find((a) => a.equipment_module_id === s.equipment_module_id);
      return {
        equipment_module_name: asm?.equipment_module_name ?? s.equipment_module_id,
        equipment_module_id: s.equipment_module_id,
        sequential_states: s.sequential_states,
      };
    });

  const buildSystemPrompt = useCallback(() => {
    return buildFdsOrchestrationSystemPrompt(
      unit,
      equipment_moduleSummaries,
      sequentialStates,
    );
  }, [unit, equipment_moduleSummaries, sequentialStates]);

  const conversation = orchestration?.conversation ?? [];

  const persistTurns = useCallback(
    async (
      turns: FdsConversationTurn[],
      stateUpdates?: Array<{ state_id: string; sequence: UnitProcedureSequence }>,
    ) => {
      const updatedConversation = [...conversation, ...turns];
      // state_sequences JSONB holds the V2 UnitProcedureSequence shape post
      // Phase 3; the legacy spec-builder type still types the read path with
      // shared_permissives: string[]. Bridge via unknown at the storage edge.
      const existing = { ...(orchestration?.state_sequences ?? {}) } as unknown as Record<
        string,
        UnitProcedureSequence
      >;
      if (stateUpdates && stateUpdates.length > 0) {
        for (const { state_id, sequence } of stateUpdates) {
          existing[state_id] = sequence;
        }
      }

      await supabase
        .from("fds_unit_procedures")
        .upsert(
          {
            spec_project_id: specProjectId,
            unit_id: unit.unit_id,
            state_sequences: existing,
            conversation: updatedConversation,
          },
          { onConflict: "spec_project_id,unit_id" },
        );

      queryClient.invalidateQueries({ queryKey: ["fds_unit_procedures"] });
    },
    [conversation, orchestration, specProjectId, unit.unit_id, queryClient],
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
      updates: Array<{ state_id: string; sequence: UnitProcedureSequence }>;
      failures: Array<{ state_id: string; issues: string[]; stateLabel: string }>;
    } => {
      const extracted = extractJsonFromResponse(fullText) as unknown as Record<string, unknown> | null;
      if (!extracted) {
        return { updates: [], failures: [] };
      }

      const updates: Array<{ state_id: string; sequence: UnitProcedureSequence }> = [];
      const failures: Array<{ state_id: string; issues: string[]; stateLabel: string }> = [];

      // The system-orchestration prompt emits a single object per turn (not an
      // array). Wrap it in an array uniformly for the loop below.
      const blocks = Array.isArray(extracted) ? extracted : [extracted];

      for (const block of blocks) {
        const rawStateId = block.state_id;
        const stateId = resolveStateId(
          typeof rawStateId === "number" ? String(rawStateId) : (rawStateId as string | undefined),
        );
        if (!stateId) continue;

        // orchestration.state_sequences is typed via the legacy spec-builder
        // UnitProcedureSequence (shared_permissives: string[]). Bridge to the
        // V2 shape used by the validator below.
        const existingRaw = orchestration?.state_sequences[stateId];
        const existing: UnitProcedureSequence = existingRaw
          ? (existingRaw as unknown as UnitProcedureSequence)
          : {
              equipment_module_order: [],
              shared_permissives: [],
              inter_equipment_module_interlocks: [],
              notes: null,
            };

        const sequence: UnitProcedureSequence = {
          equipment_module_order: (block.equipment_module_order as string[]) ?? existing.equipment_module_order,
          shared_permissives:
            (block.shared_permissives as SharedPermissive[]) ?? existing.shared_permissives,
          inter_equipment_module_interlocks:
            (block.inter_equipment_module_interlocks as InterEquipmentModuleInterlock[]) ?? existing.inter_equipment_module_interlocks,
          notes: (block.notes as string | null) ?? existing.notes,
        };

        // Phase 3 — hard validator gate. Build a per-unit orchestration
        // patch and check it. Any issues abort just this block; valid blocks
        // in the same response still merge.
        const patch = {
          unit_procedures: {
            [unit.unit_id]: {
              ...((orchestration?.state_sequences ?? {}) as unknown as Record<string, UnitProcedureSequence>),
              [stateId]: sequence,
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
          const matched = allStates.find((s) => String(s.state_id) === stateId);
          const stateLabel = matched
            ? `${matched.display_name ?? matched.state_name ?? matched.custom_name ?? stateId} (state_id ${stateId})`
            : `state_id ${stateId}`;
          failures.push({ state_id: stateId, issues, stateLabel });
          continue;
        }

        updates.push({ state_id: stateId, sequence });
      }

      return { updates, failures };
    },
    [resolveStateId, orchestration, unit.unit_id, allStates],
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

        const systemPrompt = buildSystemPrompt();
        const messages = [
          ...conversation
            .filter((t) => t.role === "user" || t.role === "assistant")
            .map((t) => ({ role: t.role, content: t.content })),
          { role: "user", content: text.trim() },
        ];

        const plMeta: PromptLayerMeta = {
          prompt_name: "fds_orchestration",
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

        const { updates: stateUpdates, failures } = processAiResponse(fullText);
        const proseContent = stripJsonFromResponse(fullText);

        const assistantTurn: FdsConversationTurn = {
          role: "assistant",
          content: proseContent,
          timestamp: new Date().toISOString(),
        };

        const failureTurns = failures.map((f) =>
          buildValidationFailureTurn({
            stateLabel: f.stateLabel,
            issues: f.issues,
            stateContext: f.state_id,
          }),
        );

        // Single combined persist: user turn + assistant turn + any failure
        // turns (failures come after the assistant message so the engineer
        // sees the AI's prose first, then the validator's complaint).
        await persistTurns(
          [userTurn, assistantTurn, ...failureTurns],
          stateUpdates.length > 0 ? stateUpdates : undefined,
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Conversation failed");
      } finally {
        setIsStreaming(false);
        setStreamingText("");
      }
    },
    [isStreaming, conversation, buildSystemPrompt, persistTurns, processAiResponse],
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
      // buildFdsOrchestrationOpeningMessage still accepts the legacy
      // OperatingState; bridge until that helper is migrated. Only
      // `state_name` is read inside.
      const openingPrompt = buildFdsOrchestrationOpeningMessage(
        unit,
        equipment_moduleSummaries.map((a) => a.equipment_module_name),
        firstState as unknown as import("@/types/spec-builder").OperatingState,
      );

      const plMeta: PromptLayerMeta = {
        prompt_name: "fds_orchestration_opening",
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
      await persistTurns([assistantTurn]);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to start interview");
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [isStreaming, buildSystemPrompt, unit, equipment_moduleSummaries, sequentialStates, persistTurns]);

  return { sendMessage, startInterview, streamingText, isStreaming, error };
}
