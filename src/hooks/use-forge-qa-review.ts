import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildQaReviewPrompt,
  buildQaFollowUpPrompt,
  buildQaUpdateAnalysisPrompt,
} from "@/lib/forge-prompts";
import type { QaMessage, SpecAnalysis } from "@/types/forge";

function makeMessage(role: QaMessage["role"], content: string): QaMessage {
  return {
    id: `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect whether the PM response signals the analysis is complete.
 * Looks for "analysis looks complete", "ready to proceed", or presence of a ```json block.
 */
function detectComplete(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("analysis looks complete") ||
    lower.includes("ready to proceed") ||
    lower.includes("no further questions") ||
    lower.includes("all gaps are filled") ||
    /```json/.test(text)
  );
}

/**
 * Extract the first ```json ... ``` block from a PM response.
 */
function extractJsonBlock(text: string): string | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  return match?.[1]?.trim() ?? null;
}

export function useForgeQaReview() {
  const [messages, setMessages] = useState<QaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  const reset = useCallback(() => {
    setMessages([]);
    setLoading(false);
    setError(null);
    setIsComplete(false);
  }, []);

  /**
   * Start the review — sends spec analysis (and raw spec text when sparse) to PM.
   */
  const startReview = useCallback(async (analysis: SpecAnalysis, specText?: string): Promise<string> => {
    setLoading(true);
    setError(null);
    setMessages([]);

    try {
      const controller = new AbortController();

      const analysisIsEmpty =
        (analysis.devices ?? []).length === 0 &&
        (analysis.process_sequences ?? []).length === 0;

      const specTextSection =
        specText
          ? `\n\nOriginal specification document (use this as the primary source of truth):\n\`\`\`\n${specText.slice(0, 20000)}\n\`\`\``
          : "";

      const analysisNote = analysisIsEmpty
        ? "Note: the extracted analysis appears sparse — please read the original specification above and ask questions based on that."
        : "Please review the extracted analysis and ask me any clarifying questions about gaps or ambiguities.";

      const userContent = `Here is the extracted spec analysis. ${analysisNote}\n\n\`\`\`json\n${JSON.stringify(analysis, null, 2)}\n\`\`\`${specTextSection}`;

      const systemPrompt = buildQaReviewPrompt();
      const { content } = await validateAndCall(
        callNonStreaming,
        systemPrompt,
        [{ role: "user", content: userContent }],
        controller.signal,
        4096,
        "pm_qa",
      );

      const assistantMsg = makeMessage("assistant", content);
      setMessages([assistantMsg]);

      if (detectComplete(content)) {
        setIsComplete(true);
      }

      return content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start Q&A review";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Send an engineer answer — gets next PM response.
   */
  const sendMessage = useCallback(async (userText: string): Promise<string> => {
    setLoading(true);
    setError(null);

    const userMsg = makeMessage("user", userText);
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    try {
      const controller = new AbortController();

      // Build message history for the API call
      const apiMessages = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const isFirstFollowUp = updatedMessages.filter((m) => m.role === "user").length === 1;
      const systemPrompt = isFirstFollowUp ? buildQaReviewPrompt() : buildQaFollowUpPrompt();

      const { content } = await validateAndCall(
        callNonStreaming,
        systemPrompt,
        apiMessages,
        controller.signal,
        4096,
        "pm_qa",
      );

      const assistantMsg = makeMessage("assistant", content);
      setMessages((prev) => [...prev, assistantMsg]);

      if (detectComplete(content)) {
        setIsComplete(true);
      }

      return content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      setError(msg);
      // Roll back optimistic user message
      setMessages(messages);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [messages]);

  /**
   * Produce a final updated SpecAnalysis from the conversation.
   * If the PM already output a JSON block, parse that directly.
   * Otherwise, make a dedicated finalization call.
   */
  const finalizeAnalysis = useCallback(async (
    originalAnalysis: SpecAnalysis,
    specText?: string,
  ): Promise<SpecAnalysis> => {
    // Check if the last PM message already has a JSON block.
    // Only trust it if it contains at least as many devices as the original —
    // PM responses during Q&A often include only partial/discussed data.
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant) {
      const jsonBlock = extractJsonBlock(lastAssistant.content);
      if (jsonBlock) {
        try {
          const candidate = JSON.parse(jsonBlock) as SpecAnalysis;
          const originalDeviceCount = (originalAnalysis.devices ?? []).length;
          const candidateDeviceCount = (candidate.devices ?? []).length;
          // Only use if it preserves all original devices (or original had none)
          if (originalDeviceCount === 0 || candidateDeviceCount >= originalDeviceCount) {
            return candidate;
          }
          // Otherwise fall through to dedicated finalization call
        } catch {
          // Fall through to dedicated call
        }
      }
    }

    // No JSON block found — make a dedicated finalization call
    setLoading(true);
    setError(null);

    try {
      const controller = new AbortController();

      // When the analysis is mostly empty, include the original spec text so the
      // AI can re-extract devices/sequences directly rather than relying on
      // the (empty) JSON alone.
      const analysisIsEmpty =
        (originalAnalysis.devices ?? []).length === 0 &&
        (originalAnalysis.process_sequences ?? []).length === 0;

      const specTextSection =
        analysisIsEmpty && specText
          ? [
              "",
              "Original functional specification (use this to extract devices and sequences):",
              "```",
              specText.slice(0, 20000), // cap to avoid exceeding context
              "```",
            ].join("\n")
          : "";

      const userContent = [
        "Original spec analysis (may be incomplete):",
        "```json",
        JSON.stringify(originalAnalysis, null, 2),
        "```",
        specTextSection,
        "",
        "Q&A conversation that clarified gaps:",
        messages.map((m) => `**${m.role === "assistant" ? "PM" : "Engineer"}:** ${m.content}`).join("\n\n"),
        "",
        "Please produce the updated SpecAnalysis JSON now.",
      ].join("\n");

      const { content } = await validateAndCall(
        callNonStreaming,
        buildQaUpdateAnalysisPrompt(),
        [{ role: "user", content: userContent }],
        controller.signal,
        16000,
        "pm_qa",
      );

      // Try to parse the response directly, or extract from a json block
      const jsonBlock = extractJsonBlock(content);
      const jsonStr = jsonBlock ?? content.trim();
      return JSON.parse(jsonStr) as SpecAnalysis;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to finalize analysis";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [messages]);

  return {
    messages,
    loading,
    error,
    isComplete,
    startReview,
    sendMessage,
    finalizeAnalysis,
    reset,
  };
}
