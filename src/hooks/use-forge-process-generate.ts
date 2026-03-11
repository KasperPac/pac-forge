import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  buildProcessSclPrompt,
  buildProcessSclUserMessage,
  buildProcessLadPrompt,
  type ProcessGenContext,
} from "@/lib/forge-prompts";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import type {
  ForgeSession,
  ForgeArtifact,
  ForgeDeviceEntry,
  SpecAnalysis,
  SpecAnalysisProcessSequence,
} from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { PatternCandidate } from "@/types";

const PROCESS_GEN_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract INTERFACE sections from SCL device artifacts for use as FB context. */
function extractFbInterfaces(deviceArtifacts: ForgeArtifact[]): string {
  const interfaces: string[] = [];

  for (const artifact of deviceArtifacts) {
    if (artifact.language !== "SCL" || artifact.type !== "FB") continue;

    // Extract VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT sections
    const interfaceRe =
      /(VAR_INPUT[\s\S]*?END_VAR|VAR_OUTPUT[\s\S]*?END_VAR|VAR_IN_OUT[\s\S]*?END_VAR)/gi;
    const matches = artifact.content.match(interfaceRe);
    if (matches) {
      interfaces.push(
        `// ${artifact.name}\n${matches.join("\n")}`,
      );
    }
  }

  return interfaces.length > 0
    ? interfaces.join("\n\n---\n\n")
    : "(no device FB interfaces available)";
}

/** Parse SCL fenced blocks from Claude response as process-stage artifacts. */
function parseSclArtifacts(rawContent: string): ForgeArtifact[] {
  const artifacts: ForgeArtifact[] = [];
  const blockRe = /```scl\s+\[(\w+):([^\]]+)\]\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(rawContent)) !== null) {
    const [, blockType, blockName, code] = match;
    const type = blockType.toUpperCase() as ForgeArtifact["type"];
    artifacts.push({
      id: crypto.randomUUID(),
      name: blockName.trim(),
      type,
      language: "SCL",
      content: code.trim(),
      approved: false,
      stage: "process",
      destination_folder:
        type === "OB" ? "Program blocks" : "Program blocks/Forge/Process",
      dependencies: [],
      compile_after_import: true,
    });
  }

  return artifacts;
}

/** Parse LadProgram JSON response as process-stage artifact. */
function parseLadArtifact(rawContent: string, name: string): ForgeArtifact | null {
  const cleaned = rawContent
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    JSON.parse(cleaned);
    return {
      id: crypto.randomUUID(),
      name,
      type: "FC",
      language: "LAD",
      content: cleaned,
      approved: false,
      stage: "process",
      destination_folder: "Program blocks/Forge/Process",
      dependencies: [],
      compile_after_import: true,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface ForgeProcessGenerateProgress {
  current: number;
  total: number;
  currentSequence: string;
}

export function useForgeProcessGenerate() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ForgeProcessGenerateProgress>({
    current: 0,
    total: 0,
    currentSequence: "",
  });
  const [error, setError] = useState<string | null>(null);

  const generateSequence = useCallback(
    async (
      sequence: SpecAnalysisProcessSequence,
      session: ForgeSession,
      profile: DesignProfile,
      patterns: PatternCandidate[],
    ): Promise<ForgeArtifact[]> => {
      const abort = new AbortController();
      const isLad = profile.process_code_language === "LAD";
      const devices = session.device_list as ForgeDeviceEntry[];
      const fbInterfaces = extractFbInterfaces(session.device_artifacts);

      const context: ProcessGenContext = {
        profile,
        platformRules: PLATFORM_RULES,
        patterns,
        deviceFbInterfaces: fbInterfaces,
        specAnalysis: session.spec_analysis as SpecAnalysis | undefined,
      };

      let systemPrompt: string;
      let userMessage: string;

      if (isLad) {
        systemPrompt = buildProcessLadPrompt(context);
        userMessage = `Generate sequential LAD logic for: ${sequence.name}\n\nSteps:\n${sequence.steps.map((s) => `Step ${s.step_number}: ${s.action} → Done when: ${s.completion_criteria}`).join("\n")}`;
      } else {
        systemPrompt = buildProcessSclPrompt(context);
        userMessage = buildProcessSclUserMessage(sequence, devices);
      }

      const { content } = await callNonStreaming(
        systemPrompt,
        [{ role: "user", content: userMessage }],
        abort.signal,
        PROCESS_GEN_MAX_TOKENS,
      );

      if (isLad) {
        const artifact = parseLadArtifact(content, sequence.name);
        return artifact ? [artifact] : [];
      }

      return parseSclArtifacts(content);
    },
    [],
  );

  const generateAll = useCallback(
    async (
      session: ForgeSession,
      profile: DesignProfile,
      patterns: PatternCandidate[],
    ): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);

      const specAnalysis = session.spec_analysis as SpecAnalysis | null;
      const sequences = specAnalysis?.process_sequences ?? [];

      setProgress({ current: 0, total: sequences.length, currentSequence: "" });

      const allArtifacts: ForgeArtifact[] = [];

      try {
        for (let i = 0; i < sequences.length; i++) {
          const seq = sequences[i];
          setProgress({
            current: i + 1,
            total: sequences.length,
            currentSequence: seq.name,
          });

          const artifacts = await generateSequence(seq, session, profile, patterns);
          allArtifacts.push(...artifacts);
        }

        return allArtifacts;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [generateSequence],
  );

  return { generateAll, generateSequence, loading, progress, error };
}
