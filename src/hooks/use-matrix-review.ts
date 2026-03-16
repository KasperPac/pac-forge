import { useCallback, useRef } from "react";
import { useProcessBuilderStore } from "@/stores/process-builder-store";
import type { ProcessQaMessage } from "@/stores/process-builder-store";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import { resolveSection } from "@/lib/prompt-defaults";
import { formatDesignProfile } from "@/lib/prompt-builder";
import { parseProcessMatrix } from "@/hooks/use-process-qa";
import type { ProcessLinkageMatrix, DesignProfile } from "@/types";

export interface MatrixReviewInput {
  promptSections?: Record<string, string>;
  designProfile?: DesignProfile | null;
}

/**
 * Hook for sending the current linkage matrix to the PM for validation.
 * Streams the PM's review response into the Q&A chat panel.
 */
export function useMatrixReview() {
  const store = useProcessBuilderStore;
  const abortRef = useRef<AbortController | null>(null);

  const validateMatrix = useCallback(
    async (input: MatrixReviewInput) => {
      const matrix = store.getState().linkageMatrix;
      if (!matrix) return;

      store.getState().clearStreaming();

      const abort = new AbortController();
      abortRef.current = abort;

      // Add a system-style message showing what was sent
      const userMsg: ProcessQaMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: "Please validate my edits to the Linkage Matrix.",
        timestamp: new Date().toISOString(),
      };
      store.getState().addQaMessage(userMsg);

      try {
        const instructions = resolveSection(
          input.promptSections,
          "process_matrix_review",
          "instructions",
        );

        const matrixJson = serializeMatrix(matrix);
        console.log("[MatrixReview] Sending matrix for validation, JSON length:", matrixJson.length);

        const profileSection = input.designProfile ? formatDesignProfile(input.designProfile, "process") : "";

        const systemPrompt = `You are the **Project Manager** reviewing an engineer's edits to the Process Linkage Matrix.

${instructions}

${profileSection}`;

        const fullContent = await streamFromEdgeFunction(
          {
            system_prompt: systemPrompt,
            messages: [
              {
                role: "user" as const,
                content: `Here is the current Process Linkage Matrix after the engineer's edits:\n\n\`\`\`json\n${matrixJson}\n\`\`\`\n\nPlease validate it.`,
              },
            ],
            stream: true,
            max_tokens: 16384,
          },
          abort.signal,
          (chunk) => {
            const current = store.getState().streamingContent;
            store.setState({ streamingContent: (current ?? "") + chunk });
          },
        );

        console.log("[MatrixReview] Response received, length:", fullContent.length);

        // Add PM response
        const pmMsg: ProcessQaMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: fullContent || "No response from PM. Check browser console for errors.",
          timestamp: new Date().toISOString(),
        };
        store.getState().addQaMessage(pmMsg);
        store.getState().clearStreaming();

        // Check for corrected matrix or validation confirmation
        if (fullContent.includes("MATRIX_VALID")) {
          store.getState().setMatrixReviewStatus("pm_validated");
        } else {
          const corrected = parseProcessMatrix(fullContent);
          if (corrected) {
            corrected.reviewStatus = "pm_validated";
            corrected.lastReviewedAt = new Date().toISOString();
            store.getState().setLinkageMatrix(corrected);
          }
        }
      } catch (err) {
        store.getState().clearStreaming();

        if (err instanceof DOMException && err.name === "AbortError") return;

        const errMsg: ProcessQaMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Validation error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString(),
        };
        store.getState().addQaMessage(errMsg);
      }
    },
    [store],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    store.getState().clearStreaming();
  }, [store]);

  return { validateMatrix, cancel };
}

/** Serialize matrix to clean JSON for the PM prompt. */
function serializeMatrix(matrix: ProcessLinkageMatrix): string {
  return JSON.stringify(
    {
      version: matrix.version,
      deviceLinkage: matrix.deviceLinkage.map((d) => ({
        name: d.name,
        deviceType: d.deviceType,
        description: d.description,
        fbName: d.fbName,
        fbTemplateName: d.fbTemplateName,
        fbTemplateId: d.fbTemplateId,
        instanceDbName: d.instanceDbName,
        wiring: d.wiring.map((w) => ({
          param: w.paramName,
          direction: w.direction,
          source: w.connectedTo,
          type: w.wireType,
          ...(w.dataType ? { dataType: w.dataType } : {}),
        })),
        interlocks: d.interlocks.map((il) => ({
          targetDeviceName: il.targetDeviceName,
          condition: il.condition,
          direction: il.direction,
        })),
      })),
      globalData: matrix.globalData.map((gd) => ({
        dbName: gd.dbName,
        purpose: gd.purpose,
        fields: gd.fields.map((f) => ({
          fieldName: f.fieldName,
          dataType: f.dataType,
          description: f.description,
        })),
      })),
      processSequences: matrix.processSequences.map((sq) => ({
        name: sq.name,
        description: sq.description,
        safetyConditions: sq.safetyConditions.map((sc) => ({
          description: sc.description,
          deviceName: sc.deviceName,
          polarity: sc.polarity,
        })),
        permissives: sq.permissives.map((p) => ({
          description: p.description,
          deviceName: p.deviceName,
          polarity: p.polarity,
        })),
        steps: (sq.steps ?? []).map((ps) => ({
          stepNumber: ps.stepNumber,
          transition: {
            combinator: ps.transition.combinator,
            conditions: ps.transition.conditions.map((c) => ({
              description: c.description,
              deviceName: c.deviceName,
            })),
          },
          actions: ps.actions.map((a) => ({
            description: a.description,
            deviceName: a.deviceName,
          })),
          devicesInvolved: ps.devicesInvolved,
          notes: ps.notes,
        })),
      })),
      notes: matrix.notes,
    },
    null,
    2,
  );
}
