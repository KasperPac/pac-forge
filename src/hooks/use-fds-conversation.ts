/**
 * Hook for the FDS co-author AI conversation.
 * Manages streaming interview with JSON extraction for live table updates.
 */
import { useState, useCallback, useRef } from "react";
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
  AssemblyConfig,
  SubsystemConfig,
  InstrumentTag,
  OperatingState,
  FdsAssemblySession,
  FdsConversationTurn,
} from "@/types/spec-builder";
import type { PermissiveCondition, SequentialStateV2 } from "@/types/spec-contract-v2";
import { ensureV2 } from "@/lib/spec-builder/sequence-legacy-shim";

interface UseFdsConversationOptions {
  session: FdsAssemblySession;
  assembly: AssemblyConfig;
  subsystem: SubsystemConfig;
  allTags: InstrumentTag[];
  allStates: OperatingState[];
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
  assembly,
  subsystem,
  allTags,
  allStates,
}: UseFdsConversationOptions): UseFdsConversationReturn {
  const queryClient = useQueryClient();
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sequentialStates = allStates.filter((s) => s.state_pattern === "sequential");

  const buildSystemPrompt = useCallback(() => {
    return buildFdsInterviewSystemPrompt(
      assembly, subsystem, allTags,
      session.static_states,
      // Prompt builder now consumes SequentialStateV2 directly (Phase 3 Task 2).
      session.sequential_states,
      allStates,
    );
  }, [assembly, subsystem, allTags, session.static_states, session.sequential_states, allStates]);

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
        .from("fds_assembly_sessions")
        .update(update)
        .eq("id", session.id);

      queryClient.invalidateQueries({ queryKey: ["fds_assembly_sessions"] });
    },
    [session, queryClient],
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
    (fullText: string): Array<{ state_id: string; data: SequentialStateV2 }> => {
      // Shim cast: extractJsonFromResponse currently typed as Record,
      // but during SFC v2 migration it yields an array of delta blocks.
      const extracted = extractJsonFromResponse(fullText) as unknown as Array<Record<string, unknown>> | null;
      if (!extracted || extracted.length === 0) return [];

      const results: Array<{ state_id: string; data: SequentialStateV2 }> = [];
      for (const block of extracted) {
        const stateId = resolveStateId(block.state_id as string | undefined);
        if (!stateId) continue;

        const existing = session.sequential_states[stateId] ?? { permissives: [], steps: [], notes: null };
        const merged: SequentialStateV2 = {
          ...existing,
          permissives: (block.permissives as PermissiveCondition[]) ?? existing.permissives,
          steps: (block.steps as SequentialStateV2["steps"]) ?? existing.steps,
          notes: (block.notes as string | null) ?? existing.notes,
        };
        results.push({ state_id: stateId, data: ensureV2(merged, stateId) });
      }
      return results;
    },
    [resolveStateId, session.sequential_states],
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
          .from("fds_assembly_sessions")
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

        // Extract JSON (may contain multiple states) and persist assistant turn
        const tableUpdates = processAiResponse(fullText);
        const proseContent = stripJsonFromResponse(fullText);

        const assistantTurn: FdsConversationTurn = {
          role: "assistant",
          content: proseContent,
          timestamp: new Date().toISOString(),
          table_delta: tableUpdates[0]?.data,
        };

        // Build on conversationWithUser (not stale session.conversation)
        const conversationWithBoth = [...conversationWithUser, assistantTurn];
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
          .from("fds_assembly_sessions")
          .update(update)
          .eq("id", session.id);
        queryClient.invalidateQueries({ queryKey: ["fds_assembly_sessions"] });
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
      const openingPrompt = buildFdsOpeningMessage(assembly, allTags, firstState);

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
  }, [isStreaming, buildSystemPrompt, assembly, allTags, sequentialStates, persistTurn]);

  return { sendMessage, startInterview, streamingText, isStreaming, error };
}
