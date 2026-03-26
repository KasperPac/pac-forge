import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  streamFromEdgeFunction,
  callNonStreaming,
} from "@/hooks/use-generation";
import { buildAgentChatPrompt } from "@/lib/agent-chat-prompt";
import type { SessionContext } from "@/lib/agent-chat-prompt";
import { useAgentChatStore } from "@/stores/agent-chat-store";
import type { LearningProposal } from "@/stores/agent-chat-store";
import { usePacStStore } from "@/stores/pac-st-store";
import { useTiaConsoleStore } from "@/stores/tia-console-store";
import { useForgeStore } from "@/stores/forge-store";
import { useForgeSession } from "@/hooks/use-forge-session";
import { useAgents } from "@/hooks/use-agents";
import { useAgentKnowledgeDocs } from "@/hooks/use-agent-knowledge";
import { supabase } from "@/lib/supabase";
import { CORRECTION_TYPES } from "@/types/pattern";
import type { CorrectionType } from "@/types/pattern";
import type { ChatMessage } from "@/types";

const CLASSIFY_SYSTEM_PROMPT = `You are a knowledge classification assistant for a PLC automation engineering tool called Pac-Forge.

When an engineer corrects an AI agent during a chat, you classify WHERE the correction should be saved so the system learns from it.

There are two storage types:

1. **agent_knowledge** — Role-specific behavioral guidance for individual agents. Use when the correction is about HOW an agent should behave, review, or prioritize. Example: "The Standards Enforcer should always check for undefined variables before approving code."

2. **correction_pattern** — A concrete code-level rule that ALL code-generating agents need to follow. Use when the correction is about a PLC/SCL technical fact, a TIA Portal limitation, a naming convention, or a wrong-vs-right code pattern. Example: "Don't use CONSTANT declarations because TIA Openness import doesn't handle them; use static variables instead."

You must also decide which agents need this learning:
- Code Architect — generates SCL code
- PLC Standards Enforcer — reviews code for standards compliance
- IO Validator — validates IO mappings
- Safety Auditor — audits safety compliance
- Pattern Librarian — analyzes corrections
- Project Manager — orchestrates pipeline

If the type is "correction_pattern", also include a "correctionType" field — one of: NAMING, IO_MAPPING, STATE_LOGIC, ALARM, SAFETY, TIMING. Pick the one that best describes the correction category.

Respond with ONLY a JSON object (no markdown fences):
{
  "type": "agent_knowledge" | "correction_pattern",
  "reasoning": "1-2 sentence explanation of why you classified it this way",
  "title": "Short descriptive title for the learning",
  "content": "The formatted learning content — preserve the engineer's exact correction and key context",
  "targetAgents": ["Agent Name 1", "Agent Name 2"],
  "correctionType": "NAMING" | "IO_MAPPING" | "STATE_LOGIC" | "ALARM" | "SAFETY" | "TIMING"
}`;

export function useAgentChat() {
  const store = useAgentChatStore();
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const { data: agents } = useAgents();

  // Resolve DB agent record from display name
  const agentRecord = agents?.find(
    (a) => a.display_name === store.selectedAgent,
  );
  const { data: knowledgeDocs } = useAgentKnowledgeDocs(agentRecord?.id);

  // Forge wizard session context
  const forgeSessionId = useForgeStore((s) => s.activeSessionId);
  const { data: forgeSession } = useForgeSession(forgeSessionId ?? undefined);

  const sendMessage = useCallback(
    async (userMessage: string) => {
      const { selectedAgent, messages } = useAgentChatStore.getState();
      if (!selectedAgent) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      };
      store.addMessage(userMsg);
      store.setIsStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const { generatedArtifacts, pipelineExecution } =
          usePacStStore.getState();
        const {
          localCompileResult,
          compileFixSession,
          pipelineSteps: tiaPipelineSteps,
        } = useTiaConsoleStore.getState();

        const allPipelineSteps = [
          ...(pipelineExecution?.steps ?? []),
          ...tiaPipelineSteps,
        ];

        const hasContext =
          generatedArtifacts.length > 0 ||
          allPipelineSteps.length > 0 ||
          localCompileResult != null ||
          (compileFixSession?.messages.length ?? 0) > 0 ||
          forgeSession != null;

        let sessionContext: SessionContext | undefined;
        if (hasContext) {
          sessionContext = {
            artifacts: generatedArtifacts,
            pipelineSteps: allPipelineSteps,
            compileResult: localCompileResult,
            compileFixMessages: compileFixSession?.messages,
            forgeSession: forgeSession ?? undefined,
          };
        }

        const systemPrompt = buildAgentChatPrompt(
          selectedAgent,
          knowledgeDocs ?? undefined,
          sessionContext,
        );

        const history = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const fullContent = await streamFromEdgeFunction(
          { system_prompt: systemPrompt, messages: history, stream: true },
          abort.signal,
          (chunk) => {
            useAgentChatStore.getState().appendStreamChunk(chunk);
          },
        );

        useAgentChatStore.getState().finalizeStream(fullContent);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const errorMsg =
          err instanceof Error ? err.message : "An unexpected error occurred";
        useAgentChatStore.getState().finalizeStream(`Error: ${errorMsg}`);
      } finally {
        useAgentChatStore.getState().setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [store, knowledgeDocs, forgeSession],
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    store.setIsStreaming(false);
  }, [store]);

  const saveChat = useCallback(async () => {
    const { selectedAgent, messages } = useAgentChatStore.getState();
    if (!selectedAgent || messages.length === 0) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { error } = await supabase.from("agent_chats").insert({
      user_id: user.id,
      agent_name: selectedAgent,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    });
    if (error) throw error;
  }, []);

  /**
   * Ask AI to classify a user correction and propose where to save it.
   * Sets learningProposal in the store for UI confirmation.
   */
  const classifyCorrection = useCallback(
    async (msgIndex: number) => {
      const { messages, selectedAgent } = useAgentChatStore.getState();
      const userMsg = messages[msgIndex];
      if (!userMsg || userMsg.role !== "user" || !selectedAgent) return;

      store.setIsClassifying(true);
      store.setLearningProposal(null);

      // Gather context: preceding agent message + user correction + follow-up
      let agentBefore = "";
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          agentBefore = messages[i].content;
          break;
        }
      }

      let agentAfter = "";
      if (
        msgIndex + 1 < messages.length &&
        messages[msgIndex + 1].role === "assistant"
      ) {
        agentAfter = messages[msgIndex + 1].content;
      }

      const contextMsg = [
        `Current agent: ${selectedAgent}`,
        agentBefore
          ? `\n## Agent's response before correction:\n${agentBefore}`
          : "",
        `\n## Engineer's correction:\n${userMsg.content}`,
        agentAfter
          ? `\n## Agent's response after correction:\n${agentAfter}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const abort = new AbortController();
        const { content } = await callNonStreaming(
          CLASSIFY_SYSTEM_PROMPT,
          [{ role: "user", content: contextMsg }],
          abort.signal,
        );

        // Parse JSON from response (strip any markdown fences just in case)
        const cleaned = content
          .replace(/^```json?\s*/i, "")
          .replace(/\s*```\s*$/, "")
          .trim();
        const parsed = JSON.parse(cleaned) as {
          type: "agent_knowledge" | "correction_pattern";
          reasoning: string;
          title: string;
          content: string;
          targetAgents: string[];
          correctionType?: string;
        };

        const proposal: LearningProposal = {
          messageId: userMsg.id,
          type: parsed.type,
          reasoning: parsed.reasoning,
          title: parsed.title,
          content: parsed.content,
          targetAgents: parsed.targetAgents,
          correctionType: parsed.correctionType,
        };

        store.setLearningProposal(proposal);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Classification failed";
        throw new Error(msg);
      } finally {
        store.setIsClassifying(false);
      }
    },
    [store],
  );

  /**
   * Save a confirmed learning proposal to the correct destination(s).
   */
  const confirmLearning = useCallback(
    async (proposal: LearningProposal) => {
      const allAgents = agents;

      if (proposal.type === "agent_knowledge") {
        // Save to each target agent's knowledge docs
        for (const agentName of proposal.targetAgents) {
          const record = allAgents?.find((a) => a.display_name === agentName);
          if (!record) continue;

          const { error } = await supabase
            .from("agent_knowledge_docs")
            .insert({
              agent_id: record.id,
              title: proposal.title,
              content: proposal.content,
              source_filename: null,
              file_type: "text",
              word_count: proposal.content.split(/\s+/).length,
              plc_brand: "SIEMENS_TIA",
              compatible_cpus: ["ALL"],
              distribution_reasoning: `Saved from agent chat — classified as agent learning for ${agentName}`,
            });
          if (error) throw error;
        }

        // Invalidate knowledge queries
        queryClient.invalidateQueries({ queryKey: ["agent-knowledge"] });
      } else {
        // Save as a correction pattern
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const validTypes = Object.values(CORRECTION_TYPES);
        const correctionType: CorrectionType = validTypes.includes(
          proposal.correctionType as CorrectionType,
        )
          ? (proposal.correctionType as CorrectionType)
          : "STATE_LOGIC";

        const { error } = await supabase.from("pattern_candidates").insert({
          plc_brand: "SIEMENS_TIA",
          device_type: correctionType,
          context: `Agent chat correction — ${proposal.title}`,
          original_snippet: "",
          corrected_snippet: proposal.content,
          correction_type: correctionType,
          explanation_tag: proposal.title,
          status: "APPROVED",
          created_by: user.id,
        });
        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ["patterns"] });
      }

      store.setLearningProposal(null);
    },
    [agents, queryClient, store],
  );

  return {
    sendMessage,
    cancelStream,
    saveChat,
    classifyCorrection,
    confirmLearning,
  };
}
