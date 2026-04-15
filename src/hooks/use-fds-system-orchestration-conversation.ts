/**
 * System-level orchestration conversation hook (Wave C).
 *
 * Mirrors `use-fds-orchestration-conversation.ts` but is scoped to an
 * entire spec rather than a single subsystem. Persists via the Wave-A
 * `useUpsertSystemOrchestration` mutation.
 */
import { useState, useCallback, useRef } from "react";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import type { PromptLayerMeta } from "@/hooks/use-generation";
import {
  useSystemOrchestration,
  useUpsertSystemOrchestration,
} from "@/hooks/use-system-orchestration";
import {
  buildFdsSystemOrchestrationSystemPrompt,
  buildFdsSystemOrchestrationOpeningMessage,
  validateSystemOrchestrationDelta,
} from "@/lib/spec-builder/system-orchestration-prompts";
import {
  extractJsonFromResponse,
  stripJsonFromResponse,
} from "@/lib/spec-builder/fds-prompts";
import type {
  SpecProject,
  SubsystemConfig,
  OperatingState,
} from "@/types/spec-builder";
import type {
  FdsConversationTurn,
  SystemStateSequence,
  SharedPermissive,
  InterSubsystemInterlock,
} from "@/types/spec-contract-v2";

interface UseFdsSystemOrchestrationConversationOptions {
  spec: SpecProject;
  subsystems: SubsystemConfig[];
  states: OperatingState[];
}

interface UseFdsSystemOrchestrationConversationReturn {
  sendMessage: (text: string) => Promise<void>;
  startInterview: () => Promise<void>;
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  validationErrors: string[];
}

export function useFdsSystemOrchestrationConversation({
  spec,
  subsystems,
  states,
}: UseFdsSystemOrchestrationConversationOptions): UseFdsSystemOrchestrationConversationReturn {
  const { data: orchestration } = useSystemOrchestration(spec.id);
  const upsert = useUpsertSystemOrchestration();

  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const sequentialStates = states.filter((s) => s.state_pattern === "sequential");
  const conversation = orchestration?.conversation ?? [];

  const persistTurn = useCallback(
    async (
      turn: FdsConversationTurn,
      stateUpdate?: { state_id: string; sequence: SystemStateSequence },
    ) => {
      const updatedConversation = [...conversation, turn];
      const existing = orchestration?.state_sequences ?? {};
      const state_sequences = stateUpdate
        ? { ...existing, [stateUpdate.state_id]: stateUpdate.sequence }
        : existing;

      await upsert.mutateAsync({
        spec_project_id: spec.id,
        state_sequences,
        conversation: updatedConversation,
      });
    },
    [conversation, orchestration, spec.id, upsert],
  );

  const processAiResponse = useCallback(
    (fullText: string):
      | { state_id: string; sequence: SystemStateSequence }
      | undefined => {
      const extracted = extractJsonFromResponse(fullText);
      if (!extracted) return undefined;

      const errs = validateSystemOrchestrationDelta(extracted, subsystems, states);
      setValidationErrors(errs);
      if (errs.length > 0) return undefined;

      const stateId = (extracted.state_id as string) ?? sequentialStates[0]?.state_id;
      if (!stateId) return undefined;

      const existing = orchestration?.state_sequences[stateId] ?? {
        subsystem_order: [],
        shared_permissives: [],
        inter_subsystem_interlocks: [],
        notes: null,
      };

      return {
        state_id: stateId,
        sequence: {
          subsystem_order:
            (extracted.subsystem_order as string[]) ?? existing.subsystem_order,
          shared_permissives:
            (extracted.shared_permissives as SharedPermissive[]) ??
            existing.shared_permissives,
          inter_subsystem_interlocks:
            (extracted.inter_subsystem_interlocks as InterSubsystemInterlock[]) ??
            existing.inter_subsystem_interlocks,
          notes: (extracted.notes as string | null) ?? existing.notes,
        },
      };
    },
    [sequentialStates, orchestration, subsystems, states],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming || !text.trim()) return;

      setIsStreaming(true);
      setStreamingText("");
      setError(null);
      setValidationErrors([]);
      abortRef.current = new AbortController();

      try {
        const userTurn: FdsConversationTurn = {
          role: "user",
          content: text.trim(),
          timestamp: new Date().toISOString(),
        };
        await persistTurn(userTurn);

        const systemPrompt = buildFdsSystemOrchestrationSystemPrompt(
          spec,
          subsystems,
          states,
          orchestration ?? null,
        );
        const messages = [
          ...conversation
            .filter((t) => t.role === "user" || t.role === "assistant")
            .map((t) => ({ role: t.role, content: t.content })),
          { role: "user", content: text.trim() },
        ];

        const plMeta: PromptLayerMeta = {
          prompt_name: "fds_system_orchestration",
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

        const stateUpdate = processAiResponse(fullText);
        const proseContent = stripJsonFromResponse(fullText);

        const assistantTurn: FdsConversationTurn = {
          role: "assistant",
          content: proseContent,
          timestamp: new Date().toISOString(),
        };
        await persistTurn(assistantTurn, stateUpdate);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Conversation failed");
      } finally {
        setIsStreaming(false);
        setStreamingText("");
      }
    },
    [
      isStreaming,
      conversation,
      spec,
      subsystems,
      states,
      orchestration,
      persistTurn,
      processAiResponse,
    ],
  );

  const startInterview = useCallback(async () => {
    if (isStreaming) return;

    setIsStreaming(true);
    setStreamingText("");
    setError(null);
    setValidationErrors([]);
    abortRef.current = new AbortController();

    try {
      const firstState = sequentialStates[0];
      if (!firstState) throw new Error("No sequential states defined for this spec");

      const systemPrompt = buildFdsSystemOrchestrationSystemPrompt(
        spec,
        subsystems,
        states,
        orchestration ?? null,
      );
      const openingPrompt = buildFdsSystemOrchestrationOpeningMessage(
        subsystems,
        firstState,
      );

      const plMeta: PromptLayerMeta = {
        prompt_name: "fds_system_orchestration_opening",
        agent_role: "fds_co_author",
        model: "claude-sonnet-4-6",
      };

      let fullText = "";
      await streamFromEdgeFunction(
        {
          system_prompt: systemPrompt,
          messages: [{ role: "user", content: openingPrompt }],
          stream: true,
        },
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
  }, [
    isStreaming,
    spec,
    subsystems,
    states,
    orchestration,
    sequentialStates,
    persistTurn,
  ]);

  return {
    sendMessage,
    startInterview,
    streamingText,
    isStreaming,
    error,
    validationErrors,
  };
}
