import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildForgeCompileFixPrompt,
  buildForgeCompileFixUserMessage,
  buildForgePatternAnalysisPrompt,
  buildForgePatternAnalysisUserMessage,
} from "@/lib/forge-agent-prompts";
import {
  buildSclBundle,
  buildForgeManifest,
  buildLadXmlForArtifact,
  buildHmiXmlForArtifact,
} from "@/lib/forge-export";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import { supabase } from "@/lib/supabase";
import type { ForgeArtifact } from "@/types/forge";
import type { ImportLadRequest, ImportHmiRequest } from "@/lib/tia-bridge-contract";

const BRIDGE_BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;
const MAX_FIX_ATTEMPTS = 3;

export type CompilePhase = "uploading" | "compiling" | "fixing" | "recompiling" | "done" | "idle";

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

// ---------------------------------------------------------------------------
// Bridge helpers
// ---------------------------------------------------------------------------

async function uploadSclArtifacts(
  artifacts: ForgeArtifact[],
  tiaProjectPath: string,
): Promise<{ success: boolean; errors: string[]; warnings: string[] }> {
  const sclArtifacts = artifacts.filter((a) => a.language === "SCL");
  if (sclArtifacts.length === 0) return { success: true, errors: [], warnings: [] };

  const manifest = buildForgeManifest(sclArtifacts, tiaProjectPath);
  const bundle = await buildSclBundle(sclArtifacts);

  const resp = await fetch(`${BRIDGE_BASE}/tia/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: crypto.randomUUID(),
      job_type: "IMPORT_COMPILE",
      manifest,
      artifact_bundle: bundle,
      tia_project_path: tiaProjectPath,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { success: false, errors: [`Bridge error ${resp.status}: ${text}`], warnings: [] };
  }

  const data = await resp.json();
  const compileResult = data.compile_result;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (compileResult) {
    for (const e of (compileResult.errors ?? [])) {
      errors.push(`${e.artifact_name ?? "?"}: ${e.error_text}`);
    }
    for (const w of (compileResult.warnings ?? [])) {
      warnings.push(`${w.artifact_name ?? "?"}: ${w.error_text}`);
    }
  }

  return { success: data.success ?? errors.length === 0, errors, warnings };
}

async function uploadLadArtifacts(
  artifacts: ForgeArtifact[],
  tiaProjectPath: string,
): Promise<string[]> {
  const ladArtifacts = artifacts.filter((a) => a.language === "LAD");
  const errors: string[] = [];

  for (const artifact of ladArtifacts) {
    try {
      const xmlContent = await buildLadXmlForArtifact(artifact);
      const body: ImportLadRequest = {
        xml_content: xmlContent,
        block_name: artifact.name,
        block_type: "FC",
        compile: artifact.compile_after_import,
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
        errors.push(`LAD import failed: ${artifact.name} — ${result.message ?? "unknown"}`);
      }
    } catch (err) {
      errors.push(`LAD import error: ${artifact.name} — ${err instanceof Error ? err.message : String(err)}`);
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

/** Save compile-fix pattern (fire-and-forget). */
async function saveCompileFixPattern(
  artifactName: string,
  originalCode: string,
  fixedCode: string,
): Promise<void> {
  try {
    const systemPrompt = buildForgePatternAnalysisPrompt();
    const controller = new AbortController();
    const { content } = await callNonStreaming(
      systemPrompt,
      [{ role: "user", content: buildForgePatternAnalysisUserMessage(originalCode, fixedCode, artifactName) }],
      controller.signal,
      2048,
    );
    const jsonStr = content.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
    const pattern = JSON.parse(jsonStr) as {
      correction_type: string;
      original_snippet: string;
      corrected_snippet: string;
      explanation_tag: string;
      context: string;
    };
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("pattern_candidates").insert({
      plc_brand: "SIEMENS_TIA",
      device_type: artifactName,
      context: pattern.context,
      original_snippet: pattern.original_snippet,
      corrected_snippet: pattern.corrected_snippet,
      correction_type: pattern.correction_type,
      explanation_tag: pattern.explanation_tag,
      status: "PENDING",
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
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<CompileCheckProgress>({ phase: "idle", attempt: 0 });
  const [error, setError] = useState<string | null>(null);

  const compileCheck = useCallback(
    async (
      inputArtifacts: ForgeArtifact[],
      tiaProjectPath: string,
    ): Promise<CompileCheckResult> => {
      setLoading(true);
      setError(null);

      let artifacts = [...inputArtifacts];
      let compileErrors: string[] = [];
      let compileWarnings: string[] = [];
      let fixAttempts = 0;

      try {
        for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
          // Upload
          setProgress({ phase: attempt === 0 ? "uploading" : "recompiling", attempt });

          const sclResult = await uploadSclArtifacts(artifacts, tiaProjectPath);
          const ladErrors = await uploadLadArtifacts(artifacts, tiaProjectPath);

          compileErrors = [...sclResult.errors, ...ladErrors];
          compileWarnings = [...sclResult.warnings];

          if (compileErrors.length === 0) {
            // Clean compile
            setProgress({ phase: "done", attempt });
            return { success: true, artifacts, compileErrors: [], compileWarnings, fixAttempts };
          }

          if (attempt >= MAX_FIX_ATTEMPTS) break;

          // Attempt compile-fix for each erroring artifact
          setProgress({ phase: "fixing", attempt: attempt + 1 });
          fixAttempts++;

          const fixedArtifacts = [...artifacts];
          let anyFixed = false;

          for (const artifact of artifacts.filter((a) => a.language === "SCL")) {
            // Find errors for this artifact
            const artifactErrors = compileErrors.filter((e) =>
              e.toLowerCase().includes(artifact.name.toLowerCase()),
            );
            if (artifactErrors.length === 0) continue;

            const controller = new AbortController();
            const systemPrompt = buildForgeCompileFixPrompt(PLATFORM_RULES);
            const userMessage = buildForgeCompileFixUserMessage(artifact, artifactErrors);

            try {
              const { content } = await validateAndCall(
                callNonStreaming,
                systemPrompt,
                [{ role: "user", content: userMessage }],
                controller.signal,
                8192,
                "compile_fix",
                false,
              );

              const fixed = parseFixedArtifact(content, artifact);
              if (fixed && fixed.content !== artifact.content) {
                const idx = fixedArtifacts.findIndex((a) => a.id === artifact.id);
                if (idx !== -1) {
                  fixedArtifacts[idx] = fixed;
                  anyFixed = true;
                  // Save pattern fire-and-forget
                  void saveCompileFixPattern(artifact.name, artifact.content, fixed.content);
                }
              }
            } catch {
              // If fix fails for one artifact, continue with others
            }
          }

          if (!anyFixed) break; // No progress — stop trying
          artifacts = fixedArtifacts;
        }

        // Return with whatever errors remain
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

  return { compileCheck, uploadHmi, loading, progress, error };
}
