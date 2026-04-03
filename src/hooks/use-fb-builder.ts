import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePacStStore } from "@/stores/pac-st-store";
import { buildFbQaPrompt, buildFbGeneratePrompt } from "@/lib/fb-builder-prompt";
import { parseArtifacts } from "@/lib/artifact-parser";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import {
  streamFromEdgeFunction,
  callNonStreaming,
  saveArtifactsAndTurns,
} from "@/hooks/use-generation";
import type { GenerateInput, GenerateResult } from "@/hooks/use-generation";
import { executeReviewRewriteLoop } from "@/lib/review-rewrite-loop";
import { buildSummaryPrompt } from "@/lib/pm-prompt-builder";
import {
  sortAgentsByPipelineOrder,
  isGeneratorAgent,
  isReviewerAgent,
  isPatternAgent,
  isOrchestratorAgent,
  createPendingStep,
  CODE_GEN_MAX_TOKENS,
} from "@/lib/pipeline";
import type { PipelineStepResult } from "@/lib/pipeline";
import { classifyCorrections } from "@/lib/correction-classifier";
import { computeDiff, hasFunctionalChanges, extractFocusedSnippets } from "@/lib/diff-engine";
import { buildPatternLibrarianPrompt, parsePatternLibrarianResponse } from "@/lib/pattern-librarian-prompt";
import { supabase } from "@/lib/supabase";
import { getRelevantReferenceSections } from "@/lib/reference-lookup";
import type {
  Project,
  Agent,
  DesignProfile,
  PatternCandidate,
  FbTemplate,
  AgentKnowledgeDoc,
  ReferenceLibrarySection,
} from "@/types";

export interface FbBuilderMessage {
  id: string;
  role: "user" | "pm";
  content: string;
  timestamp: string;
}

export function useFbBuilder() {
  const queryClient = useQueryClient();
  const store = usePacStStore;

  // Q&A state
  const [messages, setMessages] = useState<FbBuilderMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Phase 1: PM Q&A (streaming)
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (input: {
      userMessage: string;
      project: Project;
      pmAgent: Agent;
      knowledgeDocs?: AgentKnowledgeDoc[];
      designProfile?: DesignProfile;
      promptSections?: Record<string, string>;
    }) => {
      const { userMessage, project, pmAgent, knowledgeDocs, designProfile, promptSections } = input;

      setError(null);
      setSending(true);
      setStreamingContent("");

      // Add user message to local history
      const userMsg: FbBuilderMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        // Build conversation history from existing messages + this new one
        const conversationHistory = messages.map((m) => ({
          role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.content,
        }));

        const { systemPrompt, messages: promptMessages } = buildFbQaPrompt({
          project,
          pmAgent,
          knowledgeDocs,
          designProfile,
          promptSections,
          conversationHistory,
          userMessage,
        });

        const fullContent = await streamFromEdgeFunction(
          {
            system_prompt: systemPrompt,
            messages: promptMessages,
            stream: true,
          },
          abort.signal,
          (chunk) => setStreamingContent((prev) => (prev ?? "") + chunk),
        );

        // Add PM response to history
        const pmMsg: FbBuilderMessage = {
          id: crypto.randomUUID(),
          role: "pm",
          content: fullContent,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, pmMsg]);
        setStreamingContent(null);
        setSending(false);
      } catch (err) {
        setStreamingContent(null);
        setSending(false);

        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
      }
    },
    [messages],
  );

  // ---------------------------------------------------------------------------
  // Phase 2: Full Pipeline Generation
  // ---------------------------------------------------------------------------

  const generate = useCallback(
    async (
      input: {
        project: Project;
        sessionId: string;
        agents: Agent[];
        approvedPatterns?: PatternCandidate[];
        fbTemplates?: FbTemplate[];
        designProfile?: DesignProfile;
        agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
        promptSections?: Record<string, string>;
      },
      callbacks?: {
        onSuccess?: (result: GenerateResult) => void;
        onError?: (error: Error) => void;
      },
    ) => {
      const { project, sessionId, agents, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs, promptSections } = input;

      setError(null);
      setGenerating(true);

      const abort = new AbortController();
      abortRef.current = abort;

      const pipelineId = crypto.randomUUID();
      store.getState().startPipeline(pipelineId);
      store.getState().clearStreaming();

      const sortedAgents = sortAgentsByPipelineOrder(agents);
      const orchestrator = sortedAgents.find(isOrchestratorAgent);
      const generator = sortedAgents.find(isGeneratorAgent);
      const reviewers = sortedAgents.filter(isReviewerAgent);
      const patternAgent = sortedAgents.find(isPatternAgent);

      let currentArtifacts: ParsedArtifact[] = [];
      let originalArtifacts: ParsedArtifact[] = [];
      let generationSummary = "";

      // Convert Q&A messages to conversation format for the Code Architect
      const qaConversation = messages.map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));

      try {
        // --- Reference Lookup ---
        let referenceSections: ReferenceLibrarySection[] = [];
        try {
          // Use the full Q&A conversation as context for reference lookup
          const qaContext = qaConversation.map((m) => m.content).join("\n");
          referenceSections = await getRelevantReferenceSections(
            qaContext,
            "generation_request",
            project.plc_brand,
            abort.signal,
            20,
            promptSections,
            "SCL",
          );
        } catch {
          // Non-fatal
        }

        // --- Code Architect Generation (streams) ---
        if (!generator) {
          throw new Error("No Code Architect agent found. At least one generator agent must be selected.");
        }

        const genStep = createPendingStep(generator, "generate");
        store.getState().addPipelineStep(genStep);
        store.getState().setActiveAgentName(generator.display_name);
        store.getState().updatePipelineStep(generator.id, { status: "running" });

        const genStartTime = Date.now();
        try {
          const { systemPrompt, messages: promptMessages } = buildFbGeneratePrompt({
            project,
            agents: [generator],
            designProfile,
            approvedPatterns,
            fbTemplates,
            agentKnowledgeDocs,
            promptSections,
            referenceSections,
            qaConversation,
          });

          const fetchBody: Record<string, unknown> = {
            system_prompt: systemPrompt,
            messages: promptMessages,
            project_context: {
              project_id: project.id,
              session_id: sessionId,
            },
            generation_mode: "FB_BUILDER",
            stream: true,
            max_tokens: CODE_GEN_MAX_TOKENS,
          };

          const fullContent = await streamFromEdgeFunction(
            fetchBody,
            abort.signal,
            store.getState().appendStreamChunk,
          );

          store.getState().clearStreaming();

          const { artifacts: parsed, summary, errors } = parseArtifacts(fullContent);
          currentArtifacts = parsed;
          originalArtifacts = parsed.map((a) => ({ ...a }));
          generationSummary = summary;

          store.getState().updatePipelineStep(generator.id, {
            status: "completed",
            systemPrompt,
            userMessage: promptMessages[promptMessages.length - 1]?.content ?? "",
            rawResponse: fullContent,
            tokenUsage: null,
            durationMs: Date.now() - genStartTime,
            artifactsModified: parsed.map((a) => a.name),
            summary: `Generated ${parsed.length} artifact(s)${errors.length > 0 ? ` with ${errors.length} parse error(s)` : ""}`,
          });
        } catch (err) {
          store.getState().clearStreaming();
          store.getState().updatePipelineStep(generator.id, {
            status: "failed",
            durationMs: Date.now() - genStartTime,
            error: err instanceof Error ? err.message : String(err),
            summary: "Generation failed",
          });
          throw err;
        }

        // --- Review reference lookup ---
        let reviewReferenceSections: ReferenceLibrarySection[] = referenceSections;
        if (currentArtifacts.length > 0 && reviewers.length > 0) {
          try {
            const codeContext = currentArtifacts.map((a) => `// ${a.name}\n${a.content}`).join("\n\n");
            const reviewRefs = await getRelevantReferenceSections(
              codeContext,
              "generated_code",
              project.plc_brand,
              abort.signal,
              20,
              promptSections,
              "SCL",
            );
            if (reviewRefs.length > 0) {
              const existingIds = new Set(referenceSections.map((s) => s.id));
              const newSections = reviewRefs.filter((s) => !existingIds.has(s.id));
              reviewReferenceSections = [...referenceSections, ...newSections];
            }
          } catch {
            // Non-fatal
          }
        }

        // --- Review → Rewrite loop ---
        if (reviewers.length > 0 && generator && !abort.signal.aborted) {
          const loopResult = await executeReviewRewriteLoop({
            sessionId: input.sessionId,
            reviewers,
            generator,
            currentArtifacts,
            project,
            agentKnowledgeDocs,
            designProfile,
            approvedPatterns,
            fbTemplates,
            promptSections,
            referenceSections: reviewReferenceSections,
            abortSignal: abort.signal,
            callbacks: {
              addStep: (step) => store.getState().addPipelineStep(step),
              updateStep: (id, updates) => store.getState().updatePipelineStep(id, updates),
              setActiveAgentName: (name) => store.getState().setActiveAgentName(name),
            },
          });

          currentArtifacts = loopResult.artifacts;
          if (loopResult.unresolvedFindings.length > 0) {
            store.getState().setUnresolvedFindings(loopResult.unresolvedFindings);
          }
        }

        // --- Pattern Librarian ---
        if (patternAgent && !abort.signal.aborted) {
          const patternStep = createPendingStep(patternAgent, "patterns");
          store.getState().addPipelineStep(patternStep);
          store.getState().setActiveAgentName(patternAgent.display_name);
          store.getState().updatePipelineStep(patternAgent.id, { status: "running" });

          const patternStartTime = Date.now();
          try {
            const diffs: Array<{ blockName: string; originalCode: string; correctedCode: string }> = [];
            for (const original of originalArtifacts) {
              const final = currentArtifacts.find((a) => a.name === original.name);
              if (!final || final.content === original.content) continue;
              if (!hasFunctionalChanges(original.content, final.content)) continue;
              const diff = computeDiff(original.content, final.content);
              if (diff.hasChanges) {
                diffs.push({ blockName: original.name, originalCode: original.content, correctedCode: final.content });
              }
            }

            let patternCount = 0;
            let analysisMethod = "none";

            if (diffs.length > 0) {
              let aiCorrections: Array<{
                blockName: string;
                correctionType: string;
                explanation: string;
                confidence: number;
              }> | null = null;

              try {
                const { systemPrompt, messages: promptMessages } = buildPatternLibrarianPrompt({
                  diffs,
                  knowledgeDocs: agentKnowledgeDocs?.[patternAgent.id],
                  approvedPatterns,
                  promptSections,
                });

                const { content, usage } = await callNonStreaming(systemPrompt, promptMessages, abort.signal);
                aiCorrections = parsePatternLibrarianResponse(content);
                if (aiCorrections && aiCorrections.length > 0) {
                  analysisMethod = "ai";
                }

                store.getState().updatePipelineStep(patternAgent.id, {
                  systemPrompt,
                  userMessage: promptMessages[0]?.content ?? "",
                  rawResponse: content,
                  tokenUsage: usage,
                });
              } catch {
                // AI failed — fall back to regex
              }

              try {
                const { data: { user } } = await supabase.auth.getUser();

                if (aiCorrections && aiCorrections.length > 0) {
                  const rows = aiCorrections.map((c) => {
                    const diffEntry = diffs.find((d) => d.blockName === c.blockName);
                    const diff = diffEntry ? computeDiff(diffEntry.originalCode, diffEntry.correctedCode) : null;
                    const focused = diff ? extractFocusedSnippets(diff) : { originalSnippet: "(no removed lines)", correctedSnippet: "(no added lines)" };
                    return {
                      plc_brand: project.plc_brand,
                      device_type: c.correctionType,
                      context: c.blockName,
                      original_snippet: focused.originalSnippet,
                      corrected_snippet: focused.correctedSnippet,
                      correction_type: c.correctionType,
                      explanation_tag: c.explanation,
                      status: "PENDING" as const,
                      created_by: user?.id ?? "",
                    };
                  });
                  await supabase.from("pattern_candidates").insert(rows);
                  patternCount = rows.length;
                } else {
                  analysisMethod = "regex";
                  for (const d of diffs) {
                    const diff = computeDiff(d.originalCode, d.correctedCode);
                    const corrections = classifyCorrections(diff, { artifactName: d.blockName });
                    if (corrections.length > 0) {
                      const rows = corrections.map((c) => ({
                        plc_brand: project.plc_brand,
                        device_type: c.correctionType,
                        context: d.blockName,
                        original_snippet: c.originalSnippet,
                        corrected_snippet: c.correctedSnippet,
                        correction_type: c.correctionType,
                        explanation_tag: c.explanationTag,
                        status: "PENDING" as const,
                        created_by: user?.id ?? "",
                      }));
                      await supabase.from("pattern_candidates").insert(rows);
                      patternCount += rows.length;
                    }
                  }
                }
              } catch (persistErr) {
                console.error("Failed to persist pipeline patterns:", persistErr);
              }
            }

            store.getState().updatePipelineStep(patternAgent.id, {
              status: "completed",
              durationMs: Date.now() - patternStartTime,
              summary: patternCount > 0
                ? `Persisted ${patternCount} correction pattern(s) via ${analysisMethod} analysis`
                : "No corrections detected between pipeline stages",
            });
          } catch (err) {
            store.getState().updatePipelineStep(patternAgent.id, {
              status: "failed",
              durationMs: Date.now() - patternStartTime,
              error: err instanceof Error ? err.message : String(err),
              summary: "Pattern analysis failed",
            });
          }
        }

        // --- PM Summary ---
        if (orchestrator && !abort.signal.aborted) {
          const summaryStepId = `${orchestrator.id}-summary`;
          const summaryStep: PipelineStepResult = {
            ...createPendingStep(orchestrator, "summary"),
            agentId: summaryStepId,
          };
          store.getState().addPipelineStep(summaryStep);
          store.getState().setActiveAgentName(`${orchestrator.display_name} (Summary)`);
          store.getState().updatePipelineStep(summaryStepId, { status: "running" });

          const summaryStartTime = Date.now();
          try {
            const pipelineSteps = store.getState().pipelineExecution?.steps ?? [];
            const { systemPrompt, messages: summaryMessages } = buildSummaryPrompt({
              pmAgent: orchestrator,
              project,
              knowledgeDocs: agentKnowledgeDocs?.[orchestrator.id],
              steps: pipelineSteps.filter((s) => s.role !== "summary"),
              artifactCount: currentArtifacts.length,
              promptSections,
            });

            const { content, usage } = await callNonStreaming(systemPrompt, summaryMessages, abort.signal);

            store.getState().updatePipelineStep(summaryStepId, {
              status: "completed",
              systemPrompt,
              userMessage: summaryMessages[0]?.content ?? "",
              rawResponse: content,
              tokenUsage: usage,
              durationMs: Date.now() - summaryStartTime,
              summary: content.slice(0, 300),
            });
          } catch (err) {
            if (abort.signal.aborted) throw err;
            store.getState().updatePipelineStep(summaryStepId, {
              status: "failed",
              durationMs: Date.now() - summaryStartTime,
              error: err instanceof Error ? err.message : String(err),
              summary: "Summary failed",
            });
          }
        }

        // --- Finalize: save artifacts ---
        store.getState().setActiveAgentName(null);

        // Build a GenerateInput-compatible object for saveArtifactsAndTurns
        const generateInput: GenerateInput = {
          project,
          sessionId,
          agents,
          generationMode: "FB_BUILDER",
          userMessage: qaConversation.map((m) => `${m.role === "user" ? "Engineer" : "PM"}: ${m.content}`).join("\n\n"),
          approvedPatterns,
          fbTemplates,
          designProfile,
          agentKnowledgeDocs,
          promptSections,
        };

        const result = await saveArtifactsAndTurns(
          currentArtifacts,
          generationSummary,
          generateInput,
          currentArtifacts.map((a) => a.content).join("\n\n---\n\n"),
        );

        store.getState().completePipeline(result.artifacts.length);

        queryClient.invalidateQueries({ queryKey: ["artifacts"] });
        queryClient.invalidateQueries({ queryKey: ["conversation-turns"] });
        queryClient.invalidateQueries({ queryKey: ["snapshots"] });

        setGenerating(false);
        callbacks?.onSuccess?.(result);
        return result;
      } catch (err) {
        setGenerating(false);
        store.getState().clearStreaming();
        store.getState().setActiveAgentName(null);

        if (err instanceof DOMException && err.name === "AbortError") {
          store.getState().completePipeline(0);
          return undefined;
        }

        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        store.getState().completePipeline(0);
        callbacks?.onError?.(e);
        return undefined;
      }
    },
    [queryClient, store, messages],
  );

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setGenerating(false);
    setStreamingContent(null);
    store.getState().clearStreaming();
    store.getState().setActiveAgentName(null);
  }, [store]);

  const clear = useCallback(() => {
    setMessages([]);
    setStreamingContent(null);
    setError(null);
  }, []);

  return {
    // Q&A state
    messages,
    streamingContent,
    sending,
    sendMessage,
    // Generation state
    generating,
    generate,
    // Shared
    error,
    cancel,
    clear,
  };
}
