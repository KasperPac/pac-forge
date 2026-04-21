/**
 * Hook for subsystem orchestration conversation.
 * After individual assemblies are defined, engineer and AI collaborate
 * on how the assemblies coordinate (execution order, inter-assembly interlocks).
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
  SubsystemConfig,
  OperatingState,
  FdsAssemblySession,
  SubsystemOrchestration,
  SubsystemStateSequence,
  InterAssemblyInterlock,
  FdsConversationTurn,
} from "@/types/spec-builder";

interface UseFdsOrchestrationConversationOptions {
  specProjectId: string;
  subsystem: SubsystemConfig;
  sessions: FdsAssemblySession[];
  orchestration: SubsystemOrchestration | null;
  allStates: OperatingState[];
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
  subsystem,
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

  const assemblySummaries = sessions
    .filter((s) => s.status === "complete")
    .map((s) => {
      const asm = subsystem.assemblies.find((a) => a.assembly_id === s.assembly_id);
      return {
        assembly_name: asm?.assembly_name ?? s.assembly_id,
        assembly_id: s.assembly_id,
        sequential_states: s.sequential_states,
      };
    });

  const buildSystemPrompt = useCallback(() => {
    // Shim cast: orchestration prompt builder still expects legacy SequentialStateData shape
    return buildFdsOrchestrationSystemPrompt(
      subsystem,
      assemblySummaries as unknown as Array<{
        assembly_name: string;
        assembly_id: string;
        sequential_states: Record<string, import("@/types/spec-builder").SequentialStateData>;
      }>,
      sequentialStates,
    );
  }, [subsystem, assemblySummaries, sequentialStates]);

  const conversation = orchestration?.conversation ?? [];

  const persistTurn = useCallback(
    async (turn: FdsConversationTurn, stateUpdates?: Array<{ state_id: string; sequence: SubsystemStateSequence }>) => {
      const updatedConversation = [...conversation, turn];
      const existing = { ...(orchestration?.state_sequences ?? {}) };
      if (stateUpdates && stateUpdates.length > 0) {
        for (const { state_id, sequence } of stateUpdates) {
          existing[state_id] = sequence;
        }
      }

      await supabase
        .from("fds_subsystem_orchestrations")
        .upsert(
          {
            spec_project_id: specProjectId,
            subsystem_id: subsystem.subsystem_id,
            state_sequences: existing,
            conversation: updatedConversation,
          },
          { onConflict: "spec_project_id,subsystem_id" },
        );

      queryClient.invalidateQueries({ queryKey: ["fds_subsystem_orchestrations"] });
    },
    [conversation, orchestration, specProjectId, subsystem.subsystem_id, queryClient],
  );

  const resolveStateId = useCallback(
    (rawId: string | undefined): string | undefined => {
      if (!rawId) return sequentialStates[0]?.state_id;
      if (sequentialStates.some((s) => s.state_id === rawId)) return rawId;
      const byName = sequentialStates.find(
        (s) => s.state_name.toLowerCase() === rawId.toLowerCase() || s.state_id.toLowerCase() === rawId.toLowerCase(),
      );
      return byName?.state_id ?? sequentialStates[0]?.state_id;
    },
    [sequentialStates],
  );

  const processAiResponse = useCallback(
    (fullText: string): Array<{ state_id: string; sequence: SubsystemStateSequence }> => {
      // Shim cast: extractJsonFromResponse currently typed as Record,
      // but during SFC v2 migration it yields an array of delta blocks.
      const extracted = extractJsonFromResponse(fullText) as unknown as Array<Record<string, unknown>> | null;
      if (!extracted || extracted.length === 0) return [];

      const results: Array<{ state_id: string; sequence: SubsystemStateSequence }> = [];
      for (const block of extracted) {
        const stateId = resolveStateId(block.state_id as string | undefined);
        if (!stateId) continue;

        const existing = orchestration?.state_sequences[stateId] ?? {
          assembly_order: [],
          shared_permissives: [],
          inter_assembly_interlocks: [],
          notes: null,
        };

        results.push({
          state_id: stateId,
          sequence: {
            assembly_order: (block.assembly_order as string[]) ?? existing.assembly_order,
            shared_permissives: (block.shared_permissives as string[]) ?? existing.shared_permissives,
            inter_assembly_interlocks:
              (block.inter_assembly_interlocks as InterAssemblyInterlock[]) ?? existing.inter_assembly_interlocks,
            notes: (block.notes as string | null) ?? existing.notes,
          },
        });
      }
      return results;
    },
    [resolveStateId, orchestration],
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
        await persistTurn(userTurn);

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

        const stateUpdates = processAiResponse(fullText);
        const proseContent = stripJsonFromResponse(fullText);

        const assistantTurn: FdsConversationTurn = {
          role: "assistant",
          content: proseContent,
          timestamp: new Date().toISOString(),
        };
        await persistTurn(assistantTurn, stateUpdates.length > 0 ? stateUpdates : undefined);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Conversation failed");
      } finally {
        setIsStreaming(false);
        setStreamingText("");
      }
    },
    [isStreaming, conversation, buildSystemPrompt, persistTurn, processAiResponse],
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
      const openingPrompt = buildFdsOrchestrationOpeningMessage(
        subsystem,
        assemblySummaries.map((a) => a.assembly_name),
        firstState,
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
      await persistTurn(assistantTurn);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to start interview");
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [isStreaming, buildSystemPrompt, subsystem, assemblySummaries, sequentialStates, persistTurn]);

  return { sendMessage, startInterview, streamingText, isStreaming, error };
}
