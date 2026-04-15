import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
// Wave 5: IO validation must assume IEC signal types. No dialect conversion
// happens here — inputs should already be canonical IEC. Emission-site
// hooks handle Siemens conversion via `toSiemens()`.
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildForgeIoValidationPrompt,
  buildForgeIoValidationUserMessage,
} from "@/lib/forge-agent-prompts";
import {
  parseForgeReviewResponse,
  isCleanReview,
  type ForgeReviewResult,
} from "@/lib/forge-review-parser";
import type { ForgeArtifact, ForgeIoEntry, ForgeDeviceEntry } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";

export function useForgeIoValidate() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateIo = useCallback(
    async (
      artifacts: ForgeArtifact[],
      ioList: ForgeIoEntry[],
      devices: ForgeDeviceEntry[],
      profile?: DesignProfile,
    ): Promise<ForgeReviewResult> => {
      setLoading(true);
      setError(null);

      try {
        const systemPrompt = buildForgeIoValidationPrompt(devices, ioList, promptSections);
        const userMessage = buildForgeIoValidationUserMessage(artifacts);
        const controller = new AbortController();

        const { content } = await validateAndCall(
          callNonStreaming,
          systemPrompt,
          [{ role: "user", content: userMessage }],
          controller.signal,
          4096,
          "io_validator",
          !!profile,
          { prompt_name: "forge-io-validate", agent_role: "io_validator", pipeline_step: "io_validate" },
        );

        if (isCleanReview(content)) {
          return {
            findings: [],
            rewriteScope: "TARGETED",
            affectedFiles: [],
            hasCritical: false,
            hasWarning: false,
            rawResponse: content,
          };
        }

        return parseForgeReviewResponse(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "IO validation failed";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { validateIo, loading, error };
}
