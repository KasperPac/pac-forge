import { useState, useCallback } from "react";
import { callStreamingCollect } from "@/hooks/use-generation";
import {
  buildLogicValidatorSystemPrompt,
  buildLogicValidatorUserMessage,
  buildLogicValidationSystemPrompt,
  buildLogicValidationUserMessage,
  LOGIC_VALIDATOR_MAX_TOKENS,
} from "@/lib/logic-validator-prompt";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import type { ForgeArtifact } from "@/types/forge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogicFindingSeverity = "CRITICAL" | "WARNING";

export type LogicFindingCategory =
  | "self_defeating_transition"
  | "circular_dependency"
  | "unstable_output"
  | "signal_polarity"
  | "call_order"
  | "unreachable_state"
  | "timer_abuse"
  | "counter_deadlock"
  | "type_mismatch"
  | "coil_conflict"
  | "missing_initial_state"
  | "sequence_reset"
  | "retentive_coil_confusion"
  | "edge_detection_order"
  | "uninitialized_tag_read";

export type LogicFindingConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface LogicFinding {
  severity: LogicFindingSeverity;
  category: LogicFindingCategory;
  title: string;
  affected_blocks: string[];
  code_reference: string;
  description: string;
  suggested_fix: string;
  scan_cycle_sensitive: boolean;
  confidence: LogicFindingConfidence;
  /** Which model originally found this */
  found_by?: "claude" | "gemini" | "both";
  /** Which model(s) validated this */
  validated_by?: "claude" | "gemini" | "both" | "disputed";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanJsonResponse(content: string): string {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function parseFindings(content: string): LogicFinding[] {
  const cleaned = cleanJsonResponse(content);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];

  return parsed.map(
    (f: Record<string, unknown>) => ({
      severity: String(f.severity ?? "WARNING") as LogicFindingSeverity,
      category: String(f.category ?? "unstable_output") as LogicFindingCategory,
      title: String(f.title ?? ""),
      affected_blocks: Array.isArray(f.affected_blocks)
        ? f.affected_blocks.map(String)
        : [],
      code_reference: String(f.code_reference ?? ""),
      description: String(f.description ?? ""),
      suggested_fix: String(f.suggested_fix ?? ""),
      scan_cycle_sensitive: Boolean(f.scan_cycle_sensitive ?? false),
      confidence: String(f.confidence ?? "MEDIUM") as LogicFindingConfidence,
    }),
  );
}

interface ValidationResult {
  validated_findings: Array<{
    original_index: number;
    verdict: "CONFIRMED" | "FALSE_POSITIVE" | "SEVERITY_CHANGE";
    adjusted_severity?: LogicFindingSeverity;
    reason: string;
    additional_context: string;
  }>;
  missed_findings: LogicFinding[];
}

function parseValidation(content: string): ValidationResult | null {
  try {
    const cleaned = cleanJsonResponse(content);
    const parsed = JSON.parse(cleaned);
    if (parsed.validated_findings && Array.isArray(parsed.validated_findings)) {
      return parsed as ValidationResult;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if two findings are about the same issue (for deduplication).
 */
function isSameFinding(a: LogicFinding, b: LogicFinding): boolean {
  // Same category + overlapping affected blocks = likely same finding
  if (a.category === b.category) {
    const aBlocks = new Set(a.affected_blocks.map(s => s.toLowerCase()));
    const bBlocks = new Set(b.affected_blocks.map(s => s.toLowerCase()));
    for (const block of aBlocks) {
      if (bBlocks.has(block)) return true;
    }
  }
  // Same title keywords (fuzzy match)
  const aWords = new Set(a.title.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  const bWords = new Set(b.title.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  let overlap = 0;
  for (const w of aWords) {
    if (bWords.has(w)) overlap++;
  }
  return overlap >= 3;
}

/**
 * Merge findings from Claude and Gemini after peer validation.
 */
function mergePeerReviewedFindings(
  claudeFindings: LogicFinding[],
  geminiFindings: LogicFinding[],
  claudeValidation: ValidationResult | null,
  geminiValidation: ValidationResult | null,
): LogicFinding[] {
  const merged: LogicFinding[] = [];
  const usedGeminiIndices = new Set<number>();

  // Process Claude findings (validated by Gemini)
  for (let i = 0; i < claudeFindings.length; i++) {
    const finding = { ...claudeFindings[i] };
    const validation = geminiValidation?.validated_findings.find(v => v.original_index === i);

    if (validation?.verdict === "FALSE_POSITIVE") {
      console.log(`[logic-validator][merge] Claude #${i} rejected by Gemini: ${validation.reason}`);
      continue; // Drop false positive
    }

    finding.found_by = "claude";

    if (validation?.verdict === "SEVERITY_CHANGE" && validation.adjusted_severity) {
      finding.severity = validation.adjusted_severity;
      finding.validated_by = "both";
    } else if (validation?.verdict === "CONFIRMED") {
      finding.validated_by = "both";
    } else {
      finding.validated_by = "claude";
    }

    if (validation?.additional_context) {
      finding.description += `\n[Peer review note: ${validation.additional_context}]`;
    }

    // Check if this finding matches a Gemini finding (= found by both)
    for (let j = 0; j < geminiFindings.length; j++) {
      if (usedGeminiIndices.has(j)) continue;
      if (isSameFinding(finding, geminiFindings[j])) {
        finding.found_by = "both";
        finding.validated_by = "both";
        // Take higher severity
        if (geminiFindings[j].severity === "CRITICAL" && finding.severity === "WARNING") {
          finding.severity = "CRITICAL";
        }
        usedGeminiIndices.add(j);
        break;
      }
    }

    merged.push(finding);
  }

  // Process Gemini-only findings (validated by Claude)
  for (let i = 0; i < geminiFindings.length; i++) {
    if (usedGeminiIndices.has(i)) continue; // Already merged with Claude finding
    const finding = { ...geminiFindings[i] };
    const validation = claudeValidation?.validated_findings.find(v => v.original_index === i);

    if (validation?.verdict === "FALSE_POSITIVE") {
      console.log(`[logic-validator][merge] Gemini #${i} rejected by Claude: ${validation.reason}`);
      continue;
    }

    finding.found_by = "gemini";

    if (validation?.verdict === "SEVERITY_CHANGE" && validation.adjusted_severity) {
      finding.severity = validation.adjusted_severity;
      finding.validated_by = "both";
    } else if (validation?.verdict === "CONFIRMED") {
      finding.validated_by = "both";
    } else {
      finding.validated_by = "gemini";
    }

    if (validation?.additional_context) {
      finding.description += `\n[Peer review note: ${validation.additional_context}]`;
    }

    merged.push(finding);
  }

  // Add missed findings from both validation passes
  const addMissed = (findings: LogicFinding[], source: "claude" | "gemini") => {
    for (const f of findings) {
      // Check not duplicate of existing
      if (merged.some(m => isSameFinding(m, f))) continue;
      merged.push({ ...f, found_by: source, validated_by: source });
    }
  };

  if (claudeValidation?.missed_findings) {
    addMissed(parseFindings(JSON.stringify(claudeValidation.missed_findings)), "claude");
  }
  if (geminiValidation?.missed_findings) {
    addMissed(parseFindings(JSON.stringify(geminiValidation.missed_findings)), "gemini");
  }

  // Sort: CRITICAL first, then WARNING
  merged.sort((a, b) => {
    if (a.severity === "CRITICAL" && b.severity !== "CRITICAL") return -1;
    if (a.severity !== "CRITICAL" && b.severity === "CRITICAL") return 1;
    // "both" found_by ranks higher
    if (a.found_by === "both" && b.found_by !== "both") return -1;
    if (a.found_by !== "both" && b.found_by === "both") return 1;
    return 0;
  });

  return merged;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLogicValidator() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback(
    async (
      deviceArtifacts: ForgeArtifact[],
      processArtifacts: ForgeArtifact[],
    ): Promise<LogicFinding[]> => {
      setLoading(true);
      setError(null);

      try {
        const systemPrompt = buildLogicValidatorSystemPrompt(promptSections);
        const userMessage = buildLogicValidatorUserMessage(
          deviceArtifacts,
          processArtifacts,
        );

        console.log(
          `[logic-validator] Phase 1: Sending ${deviceArtifacts.length} device + ${processArtifacts.length} process artifacts to Claude + Gemini`,
        );

        // ---- Phase 1: Parallel initial analysis ----
        const [claudeResult, geminiResult] = await Promise.all([
          callStreamingCollect(
            systemPrompt,
            [{ role: "user", content: userMessage }],
            new AbortController().signal,
            LOGIC_VALIDATOR_MAX_TOKENS,
            { prompt_name: "forge-logic-validator-claude", agent_role: "logic_validator", pipeline_step: "logic_validate_phase1" },
          ).catch(err => {
            console.error("[logic-validator][claude] Phase 1 failed:", err instanceof Error ? err.message : err);
            return { content: "[]", usage: null };
          }),
          callStreamingCollect(
            systemPrompt,
            [{ role: "user", content: userMessage }],
            new AbortController().signal,
            LOGIC_VALIDATOR_MAX_TOKENS,
            { prompt_name: "forge-logic-validator-gemini", agent_role: "logic_validator", pipeline_step: "logic_validate_phase1", model: "gemini-2.5-pro" },
          ).catch(err => {
            console.error("[logic-validator][gemini] Phase 1 failed:", err instanceof Error ? err.message : err);
            return { content: "[]", usage: null };
          }),
        ]);

        const claudeFindings = parseFindings(claudeResult.content);
        const geminiFindings = parseFindings(geminiResult.content);

        console.log(
          `[logic-validator] Phase 1 complete: Claude=${claudeFindings.length} findings (${claudeFindings.filter(f => f.severity === "CRITICAL").length} critical), Gemini=${geminiFindings.length} findings (${geminiFindings.filter(f => f.severity === "CRITICAL").length} critical)`,
        );

        // If one model failed completely, return the other's findings directly
        if (claudeFindings.length === 0 && geminiFindings.length === 0) {
          console.warn("[logic-validator] Both models returned empty findings");
          return [];
        }
        if (claudeFindings.length === 0) {
          return geminiFindings.map(f => ({ ...f, found_by: "gemini" as const, validated_by: "gemini" as const }));
        }
        if (geminiFindings.length === 0) {
          return claudeFindings.map(f => ({ ...f, found_by: "claude" as const, validated_by: "claude" as const }));
        }

        // ---- Phase 2: Cross-validation (parallel) ----
        console.log("[logic-validator] Phase 2: Cross-validation — Claude reviews Gemini, Gemini reviews Claude");

        const validationSystemPrompt = buildLogicValidationSystemPrompt();

        const [claudeValidatesGemini, geminiValidatesClaude] = await Promise.all([
          // Claude validates Gemini's findings
          callStreamingCollect(
            validationSystemPrompt,
            [{ role: "user", content: buildLogicValidationUserMessage(userMessage, JSON.stringify(geminiFindings, null, 2), "Gemini 2.5 Pro") }],
            new AbortController().signal,
            LOGIC_VALIDATOR_MAX_TOKENS,
            { prompt_name: "forge-logic-validator-claude-validates-gemini", agent_role: "logic_validator", pipeline_step: "logic_validate_phase2" },
          ).catch(err => {
            console.error("[logic-validator][claude→gemini] Validation failed:", err instanceof Error ? err.message : err);
            return { content: "{}", usage: null };
          }),
          // Gemini validates Claude's findings
          callStreamingCollect(
            validationSystemPrompt,
            [{ role: "user", content: buildLogicValidationUserMessage(userMessage, JSON.stringify(claudeFindings, null, 2), "Claude Sonnet 4.6") }],
            new AbortController().signal,
            LOGIC_VALIDATOR_MAX_TOKENS,
            { prompt_name: "forge-logic-validator-gemini-validates-claude", agent_role: "logic_validator", pipeline_step: "logic_validate_phase2", model: "gemini-2.5-pro" },
          ).catch(err => {
            console.error("[logic-validator][gemini→claude] Validation failed:", err instanceof Error ? err.message : err);
            return { content: "{}", usage: null };
          }),
        ]);

        const claudeValidation = parseValidation(claudeValidatesGemini.content);
        const geminiValidation = parseValidation(geminiValidatesClaude.content);

        if (claudeValidation) {
          const confirmed = claudeValidation.validated_findings.filter(v => v.verdict === "CONFIRMED").length;
          const rejected = claudeValidation.validated_findings.filter(v => v.verdict === "FALSE_POSITIVE").length;
          const changed = claudeValidation.validated_findings.filter(v => v.verdict === "SEVERITY_CHANGE").length;
          const missed = claudeValidation.missed_findings?.length ?? 0;
          console.log(`[logic-validator] Claude reviewed Gemini: ${confirmed} confirmed, ${rejected} rejected, ${changed} severity changed, ${missed} missed findings added`);
        }
        if (geminiValidation) {
          const confirmed = geminiValidation.validated_findings.filter(v => v.verdict === "CONFIRMED").length;
          const rejected = geminiValidation.validated_findings.filter(v => v.verdict === "FALSE_POSITIVE").length;
          const changed = geminiValidation.validated_findings.filter(v => v.verdict === "SEVERITY_CHANGE").length;
          const missed = geminiValidation.missed_findings?.length ?? 0;
          console.log(`[logic-validator] Gemini reviewed Claude: ${confirmed} confirmed, ${rejected} rejected, ${changed} severity changed, ${missed} missed findings added`);
        }

        // ---- Phase 3: Merge ----
        const merged = mergePeerReviewedFindings(
          claudeFindings,
          geminiFindings,
          claudeValidation,
          geminiValidation,
        );

        const bothCount = merged.filter(f => f.found_by === "both").length;
        const claudeOnly = merged.filter(f => f.found_by === "claude").length;
        const geminiOnly = merged.filter(f => f.found_by === "gemini").length;
        console.log(
          `[logic-validator] Merged: ${merged.length} total (${merged.filter(f => f.severity === "CRITICAL").length} critical) — ${bothCount} found by both, ${claudeOnly} Claude-only, ${geminiOnly} Gemini-only`,
        );

        return merged;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        console.error("[logic-validator] Failed:", msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [promptSections],
  );

  return { validate, loading, error };
}
