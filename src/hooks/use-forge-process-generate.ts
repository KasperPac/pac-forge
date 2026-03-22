import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildProcessSclPrompt,
  buildProcessSclUserMessage,
  buildProcessLadPrompt,
  generateOb1Main,
  deviceTypeToFcName,
  getDeviceCallOrder,
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
import type { ProcessLinkageMatrix, ProcessSequence, SequenceRow } from "@/types/process-builder";

const PROCESS_GEN_MAX_TOKENS = 32768;

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

/**
 * Convert engineer-reviewed SequenceRow[] into a structured steps section for the
 * process code generation prompt. Groups rows by step number, rendering branches
 * as explicit alternatives and fault_exits as error paths.
 */
function buildStepsSectionFromRows(rows: SequenceRow[]): string {
  // Group by step number, preserving order
  const stepMap = new Map<number, SequenceRow[]>();
  for (const row of rows) {
    if (!stepMap.has(row.step)) stepMap.set(row.step, []);
    stepMap.get(row.step)!.push(row);
  }

  const lines: string[] = [];

  for (const [stepNum, stepRows] of stepMap) {
    const actionRows = stepRows.filter(r => r.type !== "fault_exit");
    const faultRows = stepRows.filter(r => r.type === "fault_exit");
    const isBranched = actionRows.some(r => r.branch !== null);

    if (isBranched) {
      lines.push(`  Step ${stepNum}: [BRANCH]`);
      for (const row of actionRows) {
        const label = row.branch ? `${stepNum}${row.branch}` : String(stepNum);
        const out = row.output ? ` → ${row.output}` : "";
        const next = row.next === "FAULT" ? "→ FAULT" : row.next === "IDLE" ? "→ IDLE" : `→ Step ${row.next}`;
        lines.push(`    Branch ${label}: IF ${row.condition} THEN ${row.action}${out} [${next}]`);
      }
    } else {
      const row = actionRows[0];
      if (row) {
        const out = row.output ? ` → ${row.output}` : "";
        const next = row.next === "FAULT" ? "→ FAULT" : row.next === "IDLE" ? "→ IDLE" : `→ Step ${row.next}`;
        const typeTag = row.type === "monitor" ? " [MONITOR — wait for condition]" : "";
        lines.push(`  Step ${stepNum}${typeTag}: IF ${row.condition} THEN ${row.action}${out} [${next}]`);
      }
    }

    for (const fault of faultRows) {
      lines.push(`    FAULT EXIT: IF ${fault.condition} → go to FAULT state (${fault.action})`);
    }
  }

  return lines.join("\n");
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
      matrixSequence?: ProcessSequence,
    ): Promise<ForgeArtifact[]> => {
      const abort = new AbortController();
      const isLad = profile.process_code_language === "LAD";
      const devices = (session.device_list as ForgeDeviceEntry[]) ?? [];
      const deviceArtifacts = (session.device_artifacts as ForgeArtifact[]) ?? [];
      const fbInterfaces = extractFbInterfaces(deviceArtifacts);
      const matrix = session.linkage_matrix as ProcessLinkageMatrix | null;

      const globalDbSchemas = deviceArtifacts
        .filter(a => a.type === "DB" && !a.name.startsWith("Inst") && a.name !== "Inputs" && a.name !== "Outputs")
        .map(a => a.content)
        .join("\n\n");

      const context: ProcessGenContext = {
        profile,
        platformRules: PLATFORM_RULES,
        patterns,
        deviceFbInterfaces: fbInterfaces,
        specAnalysis: session.spec_analysis as SpecAnalysis | undefined,
        linkageMatrix: matrix ?? undefined,
        globalDbSchemas: globalDbSchemas || undefined,
      };

      let systemPrompt: string;
      let userMessage: string;

      if (isLad) {
        systemPrompt = buildProcessLadPrompt(context);
        userMessage = `Generate sequential LAD logic for: ${sequence.name}\n\nSteps:\n${(sequence.steps ?? []).map((s) => `Step ${s.step_number}: ${s.action} → Done when: ${s.completion_criteria}`).join("\n")}`;
      } else {
        systemPrompt = buildProcessSclPrompt(context);
        // Use matrix sequence if available — it has richer structured data
        if (matrixSequence) {
          const permissives = (matrixSequence.permissives ?? []).length > 0
            ? `\n**Permissives (must be true before starting):**\n${(matrixSequence.permissives ?? []).map(p => `  - ${p.description ?? ""}${p.deviceName ? ` (${p.deviceName})` : ""}${!p.polarity ? " [active LOW — check for FALSE]" : ""}`).join("\n")}`
            : "";
          const safety = (matrixSequence.safetyConditions ?? []).length > 0
            ? `\n**Safety Conditions (halt to safe state if violated):**\n${(matrixSequence.safetyConditions ?? []).map(s => `  - ${s.description ?? ""}${s.deviceName ? ` (${s.deviceName})` : ""}${!s.polarity ? " [active LOW — halt when FALSE]" : ""}`).join("\n")}`
            : "";

          let stepsSection: string;

          if (matrixSequence.rows && matrixSequence.rows.length > 0) {
            // Preferred path: use engineer-reviewed SequenceRow[] format
            stepsSection = buildStepsSectionFromRows(matrixSequence.rows);
          } else {
            // Fallback: legacy ProcessStep[] format
            stepsSection = (matrixSequence.steps ?? []).map(s => {
              const actions = (s.actions ?? []).map(a => `    Action: ${a.description ?? ""}${a.deviceName ? ` [${a.deviceName}]` : ""}`).join("\n");
              const conditions = (s.transition?.conditions ?? []).map(c => `      - ${c.description ?? ""}${c.deviceName ? ` [${c.deviceName}]` : ""}`).join("\n");
              return `  Step ${s.stepNumber ?? "?"}:\n${actions || "    (no actions)"}\n    Done when (${s.transition?.combinator ?? "AND"}):\n${conditions || "      (no conditions)"}`;
            }).join("\n");
          }

          userMessage = `Generate the SCL process FB/FC for this sequence:

**Sequence name:** ${matrixSequence.name}
**Description:** ${matrixSequence.description}
${permissives}${safety}

**Steps (engineer-confirmed from Matrix Review):**
${stepsSection}

Generate a complete, compile-ready FB (or FC if purely stateless) using the code structure pattern defined in the system prompt.
Output MUST use the tagged fenced block format: \`\`\`scl [FB:${matrixSequence.name}] ... \`\`\``;
        } else {
          userMessage = buildProcessSclUserMessage(sequence, devices);
        }
      }

      const { content } = await validateAndCall(
        callNonStreaming,
        systemPrompt,
        [{ role: "user", content: userMessage }],
        abort.signal,
        PROCESS_GEN_MAX_TOKENS,
        isLad ? "process_lad" : "process_scl",
        !!profile,
      );

      if (isLad) {
        const artifact = parseLadArtifact(content, sequence.name);
        if (artifact) return [artifact];
        // AI didn't produce valid JSON — fall through to SCL parsing as fallback
      }

      const parsed = parseSclArtifacts(content);
      if (parsed.length > 0) return parsed;

      // Fallback 1: AI didn't use the [TYPE:Name] tag — extract any fenced SCL block (with closing fence)
      const fallbackRe = /```(?:scl)?\s*\n([\s\S]*?)```/gi;
      const fallbackMatch = fallbackRe.exec(content);
      if (fallbackMatch) {
        const code = fallbackMatch[1].trim();
        if (code.length > 50) {
          const isFb = /\bFUNCTION_BLOCK\b/i.test(code);
          return [{
            id: crypto.randomUUID(),
            name: (matrixSequence?.name ?? sequence.name).replace(/\s+/g, "_"),
            type: isFb ? "FB" : "FC" as ForgeArtifact["type"],
            language: "SCL",
            content: code,
            approved: false,
            stage: "process",
            destination_folder: "Program blocks/Forge/Process",
            dependencies: [],
            compile_after_import: true,
          }];
        }
      }

      // Fallback 2: truncated response — opening fence exists but no closing fence
      const truncatedMatch = /```(?:scl)?\s*(?:\[[^\]]+\])?\s*\n([\s\S]+)$/i.exec(content);
      if (truncatedMatch) {
        const code = truncatedMatch[1].trim();
        if (code.length > 50) {
          const isFb = /\bFUNCTION_BLOCK\b/i.test(code);
          return [{
            id: crypto.randomUUID(),
            name: (matrixSequence?.name ?? sequence.name).replace(/\s+/g, "_"),
            type: isFb ? "FB" : "FC" as ForgeArtifact["type"],
            language: "SCL",
            content: code,
            approved: false,
            stage: "process",
            destination_folder: "Program blocks/Forge/Process",
            dependencies: [],
            compile_after_import: true,
          }];
        }
      }

      // Fallback 3: no fences at all — if the response looks like raw SCL, capture it
      if (/\bFUNCTION_BLOCK\b|\bFUNCTION\b/i.test(content) && content.trim().length > 50) {
        const isFb = /\bFUNCTION_BLOCK\b/i.test(content);
        return [{
          id: crypto.randomUUID(),
          name: (matrixSequence?.name ?? sequence.name).replace(/\s+/g, "_"),
          type: isFb ? "FB" : "FC" as ForgeArtifact["type"],
          language: "SCL",
          content: content.trim(),
          approved: false,
          stage: "process",
          destination_folder: "Program blocks/Forge/Process",
          dependencies: [],
          compile_after_import: true,
        }];
      }

      return [];
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
      const specSequences = specAnalysis?.process_sequences ?? [];
      const devices = (session.device_list as ForgeDeviceEntry[]) ?? [];
      const matrix = session.linkage_matrix as ProcessLinkageMatrix | null;
      const matrixSequences = matrix?.processSequences ?? [];

      // Matrix sequences are engineer-confirmed (Matrix Review step) — always prefer them.
      // Fall back to spec analysis sequences only if the matrix has none.
      const useMatrixAsPrimary = matrixSequences.length > 0;

      // Total = sequences + OB1 Main (deterministic, no AI step)
      const totalSteps = (useMatrixAsPrimary ? matrixSequences.length : specSequences.length) + 1;
      setProgress({ current: 0, total: totalSteps, currentSequence: "" });

      const allArtifacts: ForgeArtifact[] = [];

      try {
        // Step 1: Generate all sequence FBs/FCs
        if (useMatrixAsPrimary) {
          // Primary path: drive generation from matrix sequences (engineer-confirmed structure)
          for (let i = 0; i < matrixSequences.length; i++) {
            const matrixSeq = matrixSequences[i];
            setProgress({
              current: i + 1,
              total: totalSteps,
              currentSequence: matrixSeq.name,
            });
            // Find matching spec sequence for any extra context (e.g. high-level description)
            const specSeq = specSequences.find(s =>
              s.name === matrixSeq.name || matrixSeq.name.toLowerCase().includes((s.name ?? "").slice(0, 15).toLowerCase()),
            );
            // Build a minimal SpecAnalysisProcessSequence stub from the matrix sequence if no spec match
            const seqStub: SpecAnalysisProcessSequence = specSeq ?? {
              name: matrixSeq.name,
              subsystem: matrixSeq.description ?? "",
              permissives: [],
              steps: (matrixSeq.steps ?? []).map(s => ({
                step_number: s.stepNumber ?? 0,
                action: (s.actions ?? []).map(a => a.description ?? "").join("; "),
                completion_criteria: (s.transition?.conditions ?? []).map(c => c.description ?? "").join("; "),
              })),
            };
            const artifacts = await generateSequence(seqStub, session, profile, patterns, matrixSeq);
            allArtifacts.push(...artifacts);
          }
        } else {
          // Fallback path: spec analysis sequences (no engineer-confirmed matrix)
          for (let i = 0; i < specSequences.length; i++) {
            const seq = specSequences[i];
            setProgress({
              current: i + 1,
              total: totalSteps,
              currentSequence: seq.name,
            });
            const artifacts = await generateSequence(seq, session, profile, patterns, undefined);
            allArtifacts.push(...artifacts);
          }
        }

        // Step 2: Generate OB1 Main (deterministic — no AI call)
        setProgress({
          current: (useMatrixAsPrimary ? matrixSequences.length : specSequences.length) + 1,
          total: totalSteps,
          currentSequence: "OB1 Main",
        });

        // Derive device call FC names from device list in correct call order
        const uniqueDeviceTypes = [
          ...new Set(devices.map((d) => d.device_type)),
        ].sort((a, b) => getDeviceCallOrder(a) - getDeviceCallOrder(b));
        const deviceCallFcNames = uniqueDeviceTypes.map((dt) =>
          deviceTypeToFcName(dt, profile.naming_prefix ?? undefined),
        );

        // Sequence FBs/FCs generated in Step 1 — call them directly from Main
        const sequenceFcNames = allArtifacts
          .filter((a) => a.type === "FC" || a.type === "FB")
          .map((a) => a.name);

        const ob1Code = generateOb1Main(deviceCallFcNames, sequenceFcNames);
        allArtifacts.push({
          id: crypto.randomUUID(),
          name: "Main",
          type: "OB",
          language: "SCL",
          content: ob1Code,
          approved: false,
          stage: "process",
          destination_folder: "Program blocks",
          dependencies: [],
          compile_after_import: true,
        });

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
