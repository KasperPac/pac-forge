import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { useUpdateProcessBuilderSession } from "@/hooks/use-process-builder-session";
import {
  streamFromEdgeFunction,
  saveArtifactsAndTurns,
} from "@/hooks/use-generation";
import type { GenerateInput } from "@/hooks/use-generation";
import { executeReviewRewriteLoop } from "@/lib/review-rewrite-loop";
import { parseArtifacts } from "@/lib/artifact-parser";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import { getRelevantReferenceSections } from "@/lib/reference-lookup";
import { getStageContext, validateStagePrerequisites } from "@/lib/process-pipeline";
import {
  buildIoStagePrompt,
  buildFolderStagePrompt,
  buildFbStagePrompt,
  buildDbStagePrompt,
  buildFcObStagePrompt,
} from "@/lib/process-stage-prompts";
import {
  sortAgentsByPipelineOrder,
  isGeneratorAgent,
  isReviewerAgent,
  createPendingStep,
  CODE_GEN_MAX_TOKENS,
} from "@/lib/pipeline";
import { PROCESS_STAGE_ORDER } from "@/types/process-builder";
import type { ProcessStage } from "@/types/process-builder";
import type {
  Project,
  Agent,
  DesignProfile,
  PatternCandidate,
  FbTemplate,
  AgentKnowledgeDoc,
  ReferenceLibrarySection,
} from "@/types";

export interface ProcessPipelineInput {
  project: Project;
  sessionId: string;
  agents: Agent[];
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  designProfile?: DesignProfile;
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  promptSections?: Record<string, string>;
}

export function useProcessPipeline() {
  const queryClient = useQueryClient();
  const store = useProcessBuilderStore;
  const updateSession = useUpdateProcessBuilderSession();
  const abortRef = useRef<AbortController | null>(null);

  const executeStage = useCallback(
    async (stage: ProcessStage, input: ProcessPipelineInput) => {
      if (stage === "qa" || stage === "matrix") return; // Q&A and matrix are handled separately

      const { project, sessionId, agents, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs, promptSections } = input;

      // Validate prerequisites
      const { valid, missingStages } = validateStagePrerequisites(
        stage,
        store.getState().stageStatuses,
      );
      if (!valid) {
        throw new Error(`Cannot run ${stage}: prerequisites not met (${missingStages.join(", ")})`);
      }

      const abort = new AbortController();
      abortRef.current = abort;

      // Mark stage as in progress
      store.getState().updateStageStatus(stage, {
        status: "in_progress",
        startedAt: new Date().toISOString(),
      });

      const sortedAgents = sortAgentsByPipelineOrder(agents);
      const generator = sortedAgents.find(isGeneratorAgent);
      const reviewers = sortedAgents.filter(isReviewerAgent);

      if (!generator) {
        store.getState().updateStageStatus(stage, {
          status: "failed",
          error: "No Code Architect agent found",
        });
        return;
      }

      try {
        // Collect context from previous stages
        // FC+OB stage uses compact mode: FB interfaces only (not full implementations)
        // to avoid exceeding context limits
        const stageArtifacts = store.getState().stageArtifacts;
        const previousContext = getStageContext(stageArtifacts, stage, stage === "fc_ob");

        // Reference lookup
        let referenceSections: ReferenceLibrarySection[] = [];
        try {
          const qaContext = store.getState().qaMessages.map((m) => m.content).join("\n");
          referenceSections = await getRelevantReferenceSections(
            qaContext,
            "generation_request",
            project.plc_brand,
            abort.signal,
            20,
            promptSections,
          );
        } catch {
          // Non-fatal
        }

        const baseInput = {
          project,
          designProfile,
          approvedPatterns,
          fbTemplates,
          agentKnowledgeDocs,
          promptSections,
          referenceSections,
          previousArtifactsContext: previousContext,
          linkageMatrix: store.getState().linkageMatrix,
        };

        let allParsedArtifacts: ParsedArtifact[] = [];

        if (stage === "fb") {
          // FB stage: one pass per device type (from linkage matrix)
          const matrix = store.getState().linkageMatrix;
          const deviceTypes = matrix
            ? [...new Set(matrix.deviceLinkage.map((d) => d.deviceType))]
            : [];

          for (const deviceType of deviceTypes) {
            if (abort.signal.aborted) break;

            store.getState().setActiveAgentName(`${generator.display_name} (${deviceType})`);

            const { systemPrompt, messages: promptMessages } = buildFbStagePrompt({
              ...baseInput,
              deviceType,
            });

            const genStep = createPendingStep(generator, "generate");
            const stepId = `${generator.id}-fb-${deviceType}`;
            store.getState().addPipelineStep({ ...genStep, agentId: stepId, stage });
            store.getState().updatePipelineStep(stepId, { status: "running" });

            const startTime = Date.now();
            const fullContent = await streamFromEdgeFunction(
              {
                system_prompt: systemPrompt,
                messages: promptMessages,
                stream: true,
                max_tokens: CODE_GEN_MAX_TOKENS,
              },
              abort.signal,
              (chunk) => {
                const current = store.getState().streamingContent;
                store.setState({ streamingContent: (current ?? "") + chunk });
              },
            );
            store.getState().clearStreaming();

            const { artifacts: parsed } = parseArtifacts(fullContent);
            allParsedArtifacts.push(...parsed);

            store.getState().updatePipelineStep(stepId, {
              status: "completed",
              systemPrompt,
              userMessage: promptMessages[promptMessages.length - 1]?.content ?? "",
              rawResponse: fullContent,
              durationMs: Date.now() - startTime,
              artifactsModified: parsed.map((a) => a.name),
              summary: `Generated ${parsed.length} artifact(s) for ${deviceType}`,
            });
          }
        } else {
          // Single-pass stages: IO, Folders, DB, FC+OB
          store.getState().setActiveAgentName(generator.display_name);

          const promptBuilder = {
            io: buildIoStagePrompt,
            folders: buildFolderStagePrompt,
            db: buildDbStagePrompt,
            fc_ob: buildFcObStagePrompt,
          }[stage];

          if (!promptBuilder) throw new Error(`Unknown stage: ${stage}`);

          const { systemPrompt, messages: promptMessages } = promptBuilder(baseInput);

          const genStep = createPendingStep(generator, "generate");
          store.getState().addPipelineStep({ ...genStep, stage });
          store.getState().updatePipelineStep(generator.id, { status: "running" });

          const startTime = Date.now();
          const fullContent = await streamFromEdgeFunction(
            {
              system_prompt: systemPrompt,
              messages: promptMessages,
              stream: true,
              max_tokens: CODE_GEN_MAX_TOKENS,
            },
            abort.signal,
            (chunk) => {
              const current = store.getState().streamingContent;
              store.setState({ streamingContent: (current ?? "") + chunk });
            },
          );
          store.getState().clearStreaming();

          if (stage === "folders") {
            // Folder stage doesn't produce SCL artifacts — parse JSON instead
            try {
              const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);
              if (jsonMatch) {
                const folderData = JSON.parse(jsonMatch[1]);
                store.getState().setFolderStructure(folderData);
              }
            } catch {
              // Non-fatal — store raw output
            }

            store.getState().updatePipelineStep(generator.id, {
              status: "completed",
              systemPrompt,
              userMessage: promptMessages[promptMessages.length - 1]?.content ?? "",
              rawResponse: fullContent,
              durationMs: Date.now() - startTime,
              summary: "Folder structure generated",
            });
          } else {
            const { artifacts: parsed } = parseArtifacts(fullContent);
            allParsedArtifacts = parsed;

            store.getState().updatePipelineStep(generator.id, {
              status: "completed",
              systemPrompt,
              userMessage: promptMessages[promptMessages.length - 1]?.content ?? "",
              rawResponse: fullContent,
              durationMs: Date.now() - startTime,
              artifactsModified: parsed.map((a) => a.name),
              summary: `Generated ${parsed.length} artifact(s)`,
            });
          }
        }

        // Review-rewrite loop (optional, for stages that produce code artifacts)
        if (
          allParsedArtifacts.length > 0 &&
          reviewers.length > 0 &&
          stage !== "folders" &&
          !abort.signal.aborted
        ) {
          const loopResult = await executeReviewRewriteLoop({
            reviewers,
            generator,
            currentArtifacts: allParsedArtifacts,
            project,
            agentKnowledgeDocs,
            designProfile,
            approvedPatterns,
            fbTemplates,
            promptSections,
            referenceSections,
            stage,
            abortSignal: abort.signal,
            callbacks: {
              addStep: (step) => store.getState().addPipelineStep({ ...step, stage }),
              updateStep: (id, updates) => store.getState().updatePipelineStep(id, updates),
              setActiveAgentName: (name) => store.getState().setActiveAgentName(name),
            },
          });
          allParsedArtifacts = loopResult.artifacts;
        }

        // Save artifacts to DB
        if (allParsedArtifacts.length > 0) {
          const qaContext = store.getState().qaMessages.map((m) => m.content).join("\n");
          const generateInput: GenerateInput = {
            project,
            sessionId,
            agents,
            generationMode: "PROCESS_CODE",
            userMessage: qaContext,
            approvedPatterns,
            fbTemplates,
            designProfile,
            agentKnowledgeDocs,
            promptSections,
          };

          const result = await saveArtifactsAndTurns(
            allParsedArtifacts,
            `Stage ${stage}: generated ${allParsedArtifacts.length} artifact(s)`,
            generateInput,
            allParsedArtifacts.map((a) => a.content).join("\n\n"),
          );

          // Store artifacts in the per-stage map
          store.getState().addStageArtifacts(stage, result.artifacts);

          queryClient.invalidateQueries({ queryKey: ["artifacts"] });
          queryClient.invalidateQueries({ queryKey: ["conversation-turns"] });
        }

        // Mark stage complete
        store.getState().updateStageStatus(stage, {
          status: "completed",
          completedAt: new Date().toISOString(),
          artifactIds: allParsedArtifacts.map((a) => a.name),
        });
        store.getState().setActiveAgentName(null);

        // Auto-save session state (including pipeline log for transcript persistence)
        updateSession.mutate({
          sessionId,
          updates: {
            current_stage: stage,
            stage_statuses: store.getState().stageStatuses,
            pipeline_log: (store.getState().pipelineExecution?.steps ?? []) as unknown as Record<string, unknown>[],
          },
        });

        // Auto-advance to next stage if autoGating is on
        const nextIdx = PROCESS_STAGE_ORDER.indexOf(stage) + 1;
        if (
          store.getState().autoGating &&
          nextIdx < PROCESS_STAGE_ORDER.length &&
          !abort.signal.aborted
        ) {
          const nextStage = PROCESS_STAGE_ORDER[nextIdx];
          store.getState().setStage(nextStage);
          // Recurse — auto-gating runs the next stage automatically
          await executeStage(nextStage, input);
        }
      } catch (err) {
        store.getState().clearStreaming();
        store.getState().setActiveAgentName(null);

        if (err instanceof DOMException && err.name === "AbortError") {
          store.getState().updateStageStatus(stage, { status: "pending" });
          return;
        }

        store.getState().updateStageStatus(stage, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [queryClient, store, updateSession],
  );

  const rollbackToStage = useCallback(
    (stage: ProcessStage, sessionId: string) => {
      store.getState().rollbackToStage(stage);

      updateSession.mutate({
        sessionId,
        updates: {
          current_stage: stage,
          stage_statuses: store.getState().stageStatuses,
        },
      });
    },
    [store, updateSession],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    store.getState().clearStreaming();
    store.getState().setActiveAgentName(null);
  }, [store]);

  return { executeStage, rollbackToStage, cancel };
}
