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
  SequentialStateData,
  FdsAssemblySession,
  FdsConversationTurn,
  StepEntry,
} from "@/types/spec-builder";

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
      session.static_states, session.sequential_states, allStates,
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
    async (turn: FdsConversationTurn, tableUpdate?: { state_id: string; data: SequentialStateData }) => {
      const conversation = [...session.conversation, turn];
      const update: Record<string, unknown> = { conversation };

      if (tableUpdate) {
        const existing = { ...session.sequential_states };
        existing[tableUpdate.state_id] = tableUpdate.data;
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

  const processAiResponse = useCallback(
    (fullText: string): { state_id: string; data: SequentialStateData } | undefined => {
      const extracted = extractJsonFromResponse(fullText);
      if (!extracted) return undefined;

      const rawId = extracted.state_id as string | undefined;
      // Validate against known sequential state_ids; if mismatch, match by state_name (case-insensitive)
      let stateId = rawId && sequentialStates.some((s) => s.state_id === rawId) ? rawId : undefined;
      if (!stateId && rawId) {
        const byName = sequentialStates.find(
          (s) => s.state_name.toLowerCase() === rawId.toLowerCase() || s.state_id.toLowerCase() === rawId.toLowerCase(),
        );
        stateId = byName?.state_id;
      }
      if (!stateId) stateId = sequentialStates[0]?.state_id;
      if (!stateId) return undefined;

      const existing = session.sequential_states[stateId] ?? { permissives: [], steps: [], notes: null };

      return {
        state_id: stateId,
        data: {
          permissives: (extracted.permissives as string[]) ?? existing.permissives,
          steps: (extracted.steps as StepEntry[]) ?? existing.steps,
          notes: (extracted.notes as string | null) ?? existing.notes,
        },
      };
    },
    [sequentialStates, session.sequential_states],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming || !text.trim()) return;

      setIsStreaming(true);
      setStreamingText("");
      setError(null);
      abortRef.current = new AbortController();

      try {
        // Persist user turn
        const userTurn: FdsConversationTurn = {
          role: "user",
          content: text.trim(),
          timestamp: new Date().toISOString(),
        };
        await persistTurn(userTurn);

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

        // Extract JSON and persist assistant turn
        const tableUpdate = processAiResponse(fullText);
        const proseContent = stripJsonFromResponse(fullText);

        const assistantTurn: FdsConversationTurn = {
          role: "assistant",
          content: proseContent,
          timestamp: new Date().toISOString(),
          table_delta: tableUpdate?.data,
        };
        await persistTurn(assistantTurn, tableUpdate);
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
