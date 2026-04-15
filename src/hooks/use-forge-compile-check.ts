import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildForgeCompileFixPrompt,
  buildForgeCompileFixUserMessage,
  buildForgePatternAnalysisPrompt,
  buildForgePatternAnalysisUserMessage,
} from "@/lib/forge-agent-prompts";
import { parseJsonResponse } from "@/lib/json-response";
import {
  buildSclBundle,
  buildForgeManifest,
  buildLadXmlForArtifact,
  buildHmiXmlForArtifact,
} from "@/lib/forge-export";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { loadPlatformRules } from "@/lib/platform-rules";
import { supabase } from "@/lib/supabase";
import type { ForgeArtifact } from "@/types/forge";
import type { ImportLadRequest, ImportHmiRequest } from "@/lib/tia-bridge-contract";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import type { PatternCandidate } from "@/types";

const BRIDGE_BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;
const MAX_FIX_ATTEMPTS = 3;

export type CompilePhase =
  | "uploading"
  | "compiling"
  | "proposing"
  | "fixing"
  | "recompiling"
  | "done"
  | "idle";

export interface CompileCheckProgress {
  phase: CompilePhase;
  attempt: number;
}

export interface CompileCheckResult {
  success: boolean;
  artifacts: ForgeArtifact[];
  compileErrors: string[];
  compileWarnings: string[];
  fixAttempts: number;
}

/** A single compile error with AI-proposed fix for one artifact. */
export interface CompileFixProposal {
  artifactId: string;
  artifactName: string;
  errors: string[];
  originalCode: string;
  proposedCode: string;
  explanation: string;
  accepted: boolean;
}

// ---------------------------------------------------------------------------
// Bridge helpers
// ---------------------------------------------------------------------------

async function uploadSclArtifacts(
  artifacts: ForgeArtifact[],
  tiaProjectPath: string,
): Promise<{ success: boolean; errors: string[]; warnings: string[] }> {
  // Skip library blocks — they already exist in TIA from the global library
  const sclArtifacts = artifacts.filter((a) => a.language === "SCL" && !a.library_block);
  if (sclArtifacts.length === 0) return { success: true, errors: [], warnings: [] };

  const manifest = buildForgeManifest(sclArtifacts, tiaProjectPath);
  const bundle = await buildSclBundle(sclArtifacts);

  const jobId = crypto.randomUUID();
  const submitResp = await fetch(`${BRIDGE_BASE}/tia/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: jobId,
      job_type: "IMPORT_AND_COMPILE",
      manifest,
      artifact_bundle: bundle,
      tia_project_path: tiaProjectPath,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!submitResp.ok) {
    const text = await submitResp.text();
    return { success: false, errors: [`Bridge error ${submitResp.status}: ${text}`], warnings: [] };
  }

  // Poll job status endpoint until COMPLETED or FAILED
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLL_MS = 300_000;
  const deadline = Date.now() + MAX_POLL_MS;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const statusResp = await fetch(`${BRIDGE_BASE}/tia/jobs/${jobId}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!statusResp.ok) continue;

    const statusData = await statusResp.json();
    const status: string = statusData.status ?? "";

    if (status === "COMPLETED" || status === "FAILED") {
      // Fetch compile results from the results endpoint
      const resultsResp = await fetch(`${BRIDGE_BASE}/tia/jobs/${jobId}/results`, {
        signal: AbortSignal.timeout(10_000),
      });

      const errors: string[] = [];
      const warnings: string[] = [];

      if (resultsResp.ok) {
        const data = await resultsResp.json();
        const compileResult = data.compile_result;
        if (compileResult) {
          for (const e of (compileResult.errors ?? [])) {
            errors.push(`${e.artifact_name ?? "?"}: ${e.error_text}`);
          }
          for (const w of (compileResult.warnings ?? [])) {
            warnings.push(`${w.artifact_name ?? "?"}: ${w.error_text}`);
          }
        }
      }

      if (status === "FAILED" && errors.length === 0) {
        errors.push(statusData.error_message ?? "Job failed");
      }

      return { success: errors.length === 0, errors, warnings };
    }
  }

  return { success: false, errors: ["Compile timed out after 5 minutes"], warnings: [] };
}

async function uploadLadArtifacts(
  artifacts: ForgeArtifact[],
  tiaProjectPath: string,
): Promise<string[]> {
  const ladArtifacts = artifacts.filter((a) => a.language === "LAD");
  const errors: string[] = [];

  for (let i = 0; i < ladArtifacts.length; i++) {
    const artifact = ladArtifacts[i];
    const isLast = i === ladArtifacts.length - 1;
    try {
      const xmlContent = await buildLadXmlForArtifact(artifact);
      const body: ImportLadRequest = {
        xml_content: xmlContent,
        block_name: artifact.name,
        block_type: "FC",
        compile: isLast, // only compile after the last LAD import
        tia_project_path: tiaProjectPath,
        destination_folder: artifact.destination_folder,
      };
      const resp = await fetch(`${BRIDGE_BASE}/tia/import-lad`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const result = await resp.json();
      if (!result.success) {
        // Extract individual compile errors from compile_result if present
        const compileResult = result.compile_result;
        if (compileResult?.errors?.length) {
          for (const e of compileResult.errors) {
            errors.push(`${e.artifact_name ?? artifact.name}: ${e.error_text}`);
          }
        } else {
          errors.push(`LAD import failed: ${artifact.name} — ${result.message ?? "unknown"}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[forge] LAD import error for ${artifact.name}:`, msg);
      errors.push(`LAD import error: ${artifact.name} — ${msg}`);
    }
  }

  return errors;
}

async function uploadHmiArtifacts(
  artifacts: ForgeArtifact[],
  tiaProjectPath: string,
): Promise<string[]> {
  const hmiArtifacts = artifacts.filter((a) => a.stage === "hmi");
  const errors: string[] = [];

  for (const artifact of hmiArtifacts) {
    // Branch on destination folder: Unified artifacts go to the create-screen endpoint,
    // Comfort artifacts go through the legacy SimaticML import path.
    const isUnified = artifact.destination_folder === "HMI/Unified";

    if (isUnified) {
      try {
        // Content is a serialized HmiUnifiedScreenPayload — POST as-is
        const resp = await fetch(`${BRIDGE_BASE}/tia/hmi/create-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: artifact.content,
          signal: AbortSignal.timeout(120_000),
        });
        const result = await resp.json();
        if (!result.success) {
          errors.push(`Unified HMI create failed: ${artifact.name} — ${result.message ?? "unknown"}`);
        } else if (Array.isArray(result.warnings) && result.warnings.length > 0) {
          // Surface bridge warnings but don't fail the artifact
          console.warn(`[upload-hmi] ${artifact.name} warnings:`, result.warnings);
        }
      } catch (err) {
        errors.push(`Unified HMI create error: ${artifact.name} — ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }

    // Comfort legacy path — SimaticML XML import
    try {
      const xmlContent = await buildHmiXmlForArtifact(artifact);
      const body: ImportHmiRequest = {
        tia_project_path: tiaProjectPath,
        screens: { [artifact.name]: xmlContent },
      };
      const resp = await fetch(`${BRIDGE_BASE}/tia/import-hmi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const result = await resp.json();
      if (!result.success) {
        errors.push(`HMI import failed: ${artifact.name} — ${result.message ?? "unknown"}`);
      }
    } catch (err) {
      errors.push(`HMI import error: ${artifact.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return errors;
}

/** Parse one fixed artifact from compile-fix response. */
function parseFixedArtifact(responseText: string, original: ForgeArtifact): ForgeArtifact | null {
  if (/NO_SAFE_FIX_FOUND/i.test(responseText)) return null;

  const blockRe = /```scl\s+\[(\w+):([^\]]+)\]\s*\n([\s\S]*?)```/gi;
  const match = blockRe.exec(responseText);
  if (!match) return null;

  const [, , , code] = match;
  return { ...original, content: code.trim() };
}

/** Extract explanation text from compile-fix response (before the code block). */
function parseFixExplanation(responseText: string): string {
  const codeStart = responseText.indexOf("```scl");
  if (codeStart <= 0) return "";
  return responseText.slice(0, codeStart).trim().slice(0, 500);
}

/** Save compile-fix pattern (fire-and-forget). */
export async function saveCompileFixPattern(
  artifactName: string,
  originalCode: string,
  fixedCode: string,
  promptSections?: Record<string, string>,
): Promise<void> {
  try {
    const systemPrompt = buildForgePatternAnalysisPrompt(promptSections);
    const controller = new AbortController();
    const { content } = await callNonStreaming(
      systemPrompt,
      [{ role: "user", content: buildForgePatternAnalysisUserMessage(originalCode, fixedCode, artifactName) }],
      controller.signal,
      2048,
    );
    const pattern = parseJsonResponse<{
      correction_type: string;
      original_snippet: string;
      corrected_snippet: string;
      explanation_tag: string;
      context: string;
    }>(content);
    if (!pattern) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("pattern_candidates").insert({
      plc_brand: "SIEMENS_TIA",
      device_type: artifactName,
      context: pattern.context,
      original_snippet: pattern.original_snippet,
      corrected_snippet: pattern.corrected_snippet,
      correction_type: pattern.correction_type,
      explanation_tag: pattern.explanation_tag,
      status: "APPROVED",
      created_by: user?.id ?? "",
    });
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useForgeCompileCheck() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<CompileCheckProgress>({ phase: "idle", attempt: 0 });
  const [error, setError] = useState<string | null>(null);

  // ---- Phase 1: Upload & Compile only (no auto-fix) ----
  const uploadAndCompile = useCallback(
    async (
      inputArtifacts: ForgeArtifact[],
      tiaProjectPath: string,
    ): Promise<{ success: boolean; errors: string[]; warnings: string[] }> => {
      setLoading(true);
      setError(null);
      setProgress({ phase: "uploading", attempt: 0 });

      try {
        const sclResult = await uploadSclArtifacts(inputArtifacts, tiaProjectPath);
        const ladErrors = await uploadLadArtifacts(inputArtifacts, tiaProjectPath);

        const errors = [...sclResult.errors, ...ladErrors];
        const warnings = [...sclResult.warnings];
        const success = errors.length === 0;

        setProgress({ phase: "done", attempt: 0 });
        return { success, errors, warnings };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return { success: false, errors: [msg], warnings: [] };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ---- Phase 2: Propose fixes via AI for each erroring artifact ----
  const proposeFixes = useCallback(
    async (
      artifacts: ForgeArtifact[],
      compileErrors: string[],
      patterns?: PatternCandidate[],
    ): Promise<CompileFixProposal[]> => {
      setLoading(true);
      setError(null);
      setProgress({ phase: "proposing", attempt: 0 });

      const proposals: CompileFixProposal[] = [];

      try {
        // ---- Pre-process: redirect "Tag not defined" errors to the correct DB artifact ----
        // Errors like "PhotoelectricSensorCall: Tag 'HmiData.pe01Forced' not defined"
        // should be fixed in DB_HmiData (add the field), not in the calling FC.
        const redirectedErrors = compileErrors.map((errText) => {
          // Match patterns: Tag 'DbName.field' / Tag "DbName".field / "DbName"."field"
          const tagMatch = errText.match(
            /Tag\s+['"]([A-Za-z_]\w*)['"](?:\.|\.['"])(\w+)/i,
          );
          if (!tagMatch) return errText;

          const dbName = tagMatch[1]; // e.g., "HmiData", "Configuration"
          // Find a matching DB artifact
          const dbArtifact = artifacts.find((a) => {
            if (a.type !== "DB") return false;
            const aName = a.name.toLowerCase();
            const target = dbName.toLowerCase();
            // Match: DB_HmiData ↔ HmiData, DB_Configuration ↔ Configuration
            return (
              aName === target ||
              aName === `db_${target}` ||
              aName.replace(/^db_/, "") === target
            );
          });
          if (!dbArtifact) return errText;

          // Rewrite the error prefix so it matches the DB artifact instead of the calling FC
          // Original: "PhotoelectricSensorCall: Tag 'HmiData.xxx' not defined"
          // Rewritten: "DB_HmiData: Tag 'HmiData.xxx' not defined (from: PhotoelectricSensorCall)"
          const colonIdx = errText.indexOf(":");
          if (colonIdx > 0) {
            const originalSource = errText.slice(0, colonIdx).trim();
            const errorBody = errText.slice(colonIdx + 1).trim();
            return `${dbArtifact.name}: ${errorBody} (from: ${originalSource})`;
          }
          return `${dbArtifact.name}: ${errText}`;
        });

        // Match errors to artifacts using multiple strategies:
        // 1. Error text contains artifact name (e.g., "ConveyorControl: ...")
        // 2. Error references a tag/DB name that matches artifact name minus prefix
        //    (e.g., Tag "HmiData".xxx → matches artifact "DB_HmiData")
        // 3. Error references a quoted block name (e.g., "ConveyorControl" → matches artifact)
        const matchedErrorIds = new Set<number>();

        // Build a lookup: for each artifact, collect name variants to match against
        const artifactMatchNames = new Map<string, string[]>();
        for (const a of artifacts) {
          const variants = [a.name.toLowerCase()];
          // Strip common prefixes: DB_, Inst
          if (a.name.startsWith("DB_")) variants.push(a.name.slice(3).toLowerCase());
          if (a.name.startsWith("Inst")) variants.push(a.name.slice(4).toLowerCase());
          // Also try without underscores for fuzzy match
          const noUnderscore = a.name.replace(/_/g, "").toLowerCase();
          if (!variants.includes(noUnderscore)) variants.push(noUnderscore);
          artifactMatchNames.set(a.id, variants);
        }

        // Process ALL artifacts (SCL + LAD) for error matching — use redirectedErrors
        for (const artifact of artifacts) {
          const variants = artifactMatchNames.get(artifact.id) ?? [artifact.name.toLowerCase()];
          const artifactErrors: string[] = [];
          redirectedErrors.forEach((e, idx) => {
            if (matchedErrorIds.has(idx)) return; // already matched to another artifact
            const eLower = e.toLowerCase();
            const matched = variants.some(v => eLower.includes(v));
            if (matched) {
              artifactErrors.push(e);
              matchedErrorIds.add(idx);
            }
          });
          if (artifactErrors.length === 0) continue;

          if (artifact.language === "SCL") {
            // SCL artifacts get AI fix proposals
            const controller = new AbortController();
            const systemPrompt = buildForgeCompileFixPrompt(loadPlatformRules("compile_fix"), patterns, promptSections);
            const hasInterfaceError = artifactErrors.some(e =>
              /formal parameter|invalid.*parameter|parameter.*invalid/i.test(e)
            );
            const referenceFbs = hasInterfaceError
              ? artifacts.filter(a => a.type === "FB" && a.language === "SCL")
              : undefined;
            const userMessage = buildForgeCompileFixUserMessage(artifact, artifactErrors, referenceFbs);

            try {
              const { content } = await validateAndCall(
                callNonStreaming,
                systemPrompt,
                [{ role: "user", content: userMessage }],
                controller.signal,
                8192,
                "compile_fix",
                false,
                { prompt_name: "forge-compile-check", agent_role: "compile_fix", pipeline_step: "compile_fix" },
              );

              const fixed = parseFixedArtifact(content, artifact);
              const explanation = parseFixExplanation(content);

              proposals.push({
                artifactId: artifact.id,
                artifactName: artifact.name,
                errors: artifactErrors,
                originalCode: artifact.content,
                proposedCode: fixed?.content ?? artifact.content,
                explanation: explanation || (fixed ? "AI proposed a fix" : "NO_SAFE_FIX_FOUND"),
                accepted: !!fixed && fixed.content !== artifact.content,
              });
            } catch {
              proposals.push({
                artifactId: artifact.id,
                artifactName: artifact.name,
                errors: artifactErrors,
                originalCode: artifact.content,
                proposedCode: artifact.content,
                explanation: "Failed to generate fix proposal",
                accepted: false,
              });
            }
          } else {
            // LAD artifacts — can't AI-fix, show as manual-fix-required
            proposals.push({
              artifactId: artifact.id,
              artifactName: artifact.name,
              errors: artifactErrors,
              originalCode: "(LAD block — edit in TIA Portal)",
              proposedCode: "(LAD block — edit in TIA Portal)",
              explanation: "LAD blocks cannot be auto-fixed. Fix manually in TIA Portal, then recompile.",
              accepted: false,
            });
          }
        }

        // Collect unmatched errors (not attributed to any artifact)
        const unmatchedErrors = redirectedErrors.filter((_, idx) => !matchedErrorIds.has(idx));
        if (unmatchedErrors.length > 0) {
          proposals.push({
            artifactId: "__unmatched__",
            artifactName: "Other Errors",
            errors: unmatchedErrors,
            originalCode: "",
            proposedCode: "",
            explanation: "These errors could not be attributed to a specific artifact. Review the error text for clues.",
            accepted: false,
          });
        }

        setProgress({ phase: "done", attempt: 0 });
        return proposals;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return proposals;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ---- Phase 3: Apply user-edited fixes and recompile ----
  const applyFixesAndRecompile = useCallback(
    async (
      artifacts: ForgeArtifact[],
      proposals: CompileFixProposal[],
      tiaProjectPath: string,
    ): Promise<CompileCheckResult> => {
      setLoading(true);
      setError(null);
      setProgress({ phase: "recompiling", attempt: 1 });

      try {
        // Apply accepted proposals to artifacts
        const fixedArtifacts = artifacts.map(a => {
          const proposal = proposals.find(p => p.artifactId === a.id && p.accepted);
          if (proposal) {
            return { ...a, content: proposal.proposedCode };
          }
          return a;
        });

        // Re-upload and compile
        const sclResult = await uploadSclArtifacts(fixedArtifacts, tiaProjectPath);
        const ladErrors = await uploadLadArtifacts(fixedArtifacts, tiaProjectPath);

        const compileErrors = [...sclResult.errors, ...ladErrors];
        const compileWarnings = [...sclResult.warnings];
        const success = compileErrors.length === 0;

        // Auto-save patterns for successful fixes (fire-and-forget)
        if (success) {
          for (const proposal of proposals) {
            if (proposal.accepted && proposal.proposedCode !== proposal.originalCode) {
              void saveCompileFixPattern(
                proposal.artifactName,
                proposal.originalCode,
                proposal.proposedCode,
                promptSections,
              );
            }
          }
        }

        setProgress({ phase: "done", attempt: 1 });
        return {
          success,
          artifacts: fixedArtifacts,
          compileErrors,
          compileWarnings,
          fixAttempts: 1,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return {
          success: false,
          artifacts,
          compileErrors: [msg],
          compileWarnings: [],
          fixAttempts: 1,
        };
      } finally {
        setLoading(false);
      }
    },
    [promptSections],
  );

  // ---- Legacy: Full auto-fix loop (kept for backward compat) ----
  const compileCheck = useCallback(
    async (
      inputArtifacts: ForgeArtifact[],
      tiaProjectPath: string,
      patterns?: PatternCandidate[],
    ): Promise<CompileCheckResult> => {
      setLoading(true);
      setError(null);

      let artifacts = [...inputArtifacts];
      let compileErrors: string[] = [];
      let compileWarnings: string[] = [];
      let fixAttempts = 0;

      try {
        for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
          setProgress({ phase: attempt === 0 ? "uploading" : "recompiling", attempt });

          const sclResult = await uploadSclArtifacts(artifacts, tiaProjectPath);
          const ladErrors = await uploadLadArtifacts(artifacts, tiaProjectPath);

          compileErrors = [...sclResult.errors, ...ladErrors];
          compileWarnings = [...sclResult.warnings];

          if (compileErrors.length === 0) {
            setProgress({ phase: "done", attempt });
            return { success: true, artifacts, compileErrors: [], compileWarnings, fixAttempts };
          }

          if (attempt >= MAX_FIX_ATTEMPTS) break;

          setProgress({ phase: "fixing", attempt: attempt + 1 });
          fixAttempts++;

          const fixedArtifacts = [...artifacts];
          let anyFixed = false;

          for (const artifact of artifacts.filter((a) => a.language === "SCL")) {
            const artifactErrors = compileErrors.filter((e) =>
              e.toLowerCase().includes(artifact.name.toLowerCase()),
            );
            if (artifactErrors.length === 0) continue;

            const controller = new AbortController();
            const systemPrompt = buildForgeCompileFixPrompt(loadPlatformRules("compile_fix"), patterns, promptSections);
            const hasInterfaceError = artifactErrors.some(e =>
              /formal parameter|invalid.*parameter|parameter.*invalid/i.test(e)
            );
            const referenceFbs = hasInterfaceError
              ? artifacts.filter(a => a.type === "FB" && a.language === "SCL")
              : undefined;
            const userMessage = buildForgeCompileFixUserMessage(artifact, artifactErrors, referenceFbs);

            try {
              const { content } = await validateAndCall(
                callNonStreaming,
                systemPrompt,
                [{ role: "user", content: userMessage }],
                controller.signal,
                8192,
                "compile_fix",
                false,
                { prompt_name: "forge-compile-check", agent_role: "compile_fix", pipeline_step: "compile_fix" },
              );

              const fixed = parseFixedArtifact(content, artifact);
              if (fixed && fixed.content !== artifact.content) {
                const idx = fixedArtifacts.findIndex((a) => a.id === artifact.id);
                if (idx !== -1) {
                  fixedArtifacts[idx] = fixed;
                  anyFixed = true;
                  void saveCompileFixPattern(artifact.name, artifact.content, fixed.content, promptSections);
                }
              }
            } catch {
              // If fix fails for one artifact, continue with others
            }
          }

          if (!anyFixed) {
            setProgress({ phase: "done", attempt: attempt + 1 });
            break;
          }
          artifacts = fixedArtifacts;
        }

        setProgress(prev => prev.phase !== "done" ? { phase: "done", attempt: prev.attempt } : prev);
        return {
          success: false,
          artifacts,
          compileErrors,
          compileWarnings,
          fixAttempts,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return {
          success: false,
          artifacts,
          compileErrors: [msg],
          compileWarnings,
          fixAttempts,
        };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // HMI-only upload (no compile step)
  const uploadHmi = useCallback(
    async (artifacts: ForgeArtifact[], tiaProjectPath: string): Promise<string[]> => {
      setLoading(true);
      setError(null);
      try {
        return await uploadHmiArtifacts(artifacts, tiaProjectPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return [msg];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return {
    compileCheck,
    uploadAndCompile,
    proposeFixes,
    applyFixesAndRecompile,
    uploadHmi,
    loading,
    progress,
    error,
  };
}
