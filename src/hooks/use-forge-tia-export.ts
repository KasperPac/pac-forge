import { useState, useCallback } from "react";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { ImportLadRequest, ImportLadResponse, ImportHmiRequest, ImportHmiResponse } from "@/lib/tia-bridge-contract";
import {
  buildSclBundle,
  buildForgeManifest,
  buildLadXmlForArtifact,
  buildHmiXmlForArtifact,
} from "@/lib/forge-export";
import type { ForgeSession, ForgeArtifact, TiaForgeExportResult } from "@/types/forge";

const BRIDGE_BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

export type ForgeExportPhase = "idle" | "scl" | "lad" | "hmi" | "compile" | "done" | "failed";

export interface ForgeTiaExportProgress {
  phase: ForgeExportPhase;
  current: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Bridge helpers
// ---------------------------------------------------------------------------

async function submitSclJob(
  manifest: ReturnType<typeof buildForgeManifest>,
  artifactBundle: string,
  tiaProjectPath: string,
): Promise<{ success: boolean; errors: string[]; warnings: string[] }> {
  const resp = await fetch(`${BRIDGE_BASE}/tia/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: crypto.randomUUID(),
      job_type: "IMPORT_COMPILE",
      manifest,
      artifact_bundle: artifactBundle,
      tia_project_path: tiaProjectPath,
    }),
    signal: AbortSignal.timeout(300_000), // 5 min for large imports
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

async function importLadArtifact(
  artifact: ForgeArtifact,
  tiaProjectPath: string,
  compile = false,
): Promise<ImportLadResponse | null> {
  try {
    const xmlContent = await buildLadXmlForArtifact(artifact);
    const body: ImportLadRequest = {
      xml_content: xmlContent,
      block_name: artifact.name,
      block_type: "FC",
      compile,
      tia_project_path: tiaProjectPath,
      destination_folder: artifact.destination_folder,
    };
    const resp = await fetch(`${BRIDGE_BASE}/tia/import-lad`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    return await resp.json();
  } catch {
    return null;
  }
}

async function importHmiArtifact(
  artifact: ForgeArtifact,
  tiaProjectPath: string,
): Promise<ImportHmiResponse | null> {
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
    return await resp.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useForgeTiaExport() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ForgeTiaExportProgress>({
    phase: "idle",
    current: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const exportAll = useCallback(
    async (session: ForgeSession, tiaProjectPath: string): Promise<TiaForgeExportResult> => {
      setLoading(true);
      setError(null);

      const allArtifacts: ForgeArtifact[] = [
        ...session.device_artifacts,
        ...session.process_artifacts,
      ];

      const approvedArtifacts = allArtifacts.filter((a) => a.approved);
      const sclArtifacts = approvedArtifacts.filter((a) => a.language === "SCL");
      const ladArtifacts = approvedArtifacts.filter((a) => a.language === "LAD" && a.stage !== "hmi");
      const hmiArtifacts = session.hmi_artifacts.filter((a) => a.approved);

      const result: TiaForgeExportResult = {
        success: true,
        scl_imported: 0,
        lad_imported: 0,
        hmi_imported: 0,
        compile_errors: [],
        compile_warnings: [],
        timestamp: new Date().toISOString(),
      };

      try {
        // 1. SCL import + compile
        if (sclArtifacts.length > 0) {
          setProgress({ phase: "scl", current: 0, total: sclArtifacts.length });
          const manifest = buildForgeManifest(sclArtifacts, tiaProjectPath);
          const bundle = await buildSclBundle(sclArtifacts);
          const sclResult = await submitSclJob(manifest, bundle, tiaProjectPath);
          result.scl_imported = sclArtifacts.length;
          result.compile_errors.push(...sclResult.errors);
          result.compile_warnings.push(...sclResult.warnings);
          if (!sclResult.success) result.success = false;
        }

        // 2. LAD imports (one at a time, compile only on the last one)
        if (ladArtifacts.length > 0) {
          setProgress({ phase: "lad", current: 0, total: ladArtifacts.length });
          for (let i = 0; i < ladArtifacts.length; i++) {
            setProgress({ phase: "lad", current: i + 1, total: ladArtifacts.length });
            const isLast = i === ladArtifacts.length - 1;
            const ladResult = await importLadArtifact(ladArtifacts[i], tiaProjectPath, isLast);
            if (ladResult) {
              result.lad_imported++;
              // Capture compile errors/warnings from the final compile
              if (ladResult.compile_result) {
                for (const e of (ladResult.compile_result.errors ?? [])) {
                  result.compile_errors.push(`${e.artifact_name ?? "?"}: ${e.error_text}`);
                }
                for (const w of (ladResult.compile_result.warnings ?? [])) {
                  result.compile_warnings.push(`${w.artifact_name ?? "?"}: ${w.error_text}`);
                }
                if (!ladResult.compile_result.success) result.success = false;
              }
              if (!ladResult.success && !ladResult.compile_result) {
                result.compile_errors.push(
                  `LAD import failed: ${ladArtifacts[i].name} — ${ladResult.message ?? "unknown error"}`,
                );
                result.success = false;
              }
            } else {
              result.compile_errors.push(
                `LAD import failed: ${ladArtifacts[i].name} — unknown error`,
              );
              result.success = false;
            }
          }
        }

        // 3. HMI imports
        if (hmiArtifacts.length > 0) {
          setProgress({ phase: "hmi", current: 0, total: hmiArtifacts.length });
          for (let i = 0; i < hmiArtifacts.length; i++) {
            setProgress({ phase: "hmi", current: i + 1, total: hmiArtifacts.length });
            const hmiResult = await importHmiArtifact(hmiArtifacts[i], tiaProjectPath);
            if (hmiResult?.success) {
              result.hmi_imported++;
            } else {
              result.compile_warnings.push(
                `HMI import failed: ${hmiArtifacts[i].name} — ${hmiResult?.message ?? "unknown error"}`,
              );
            }
          }
        }

        setProgress({ phase: "done", current: 0, total: 0 });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        result.success = false;
        result.compile_errors.push(msg);
        setProgress({ phase: "failed", current: 0, total: 0 });
        return result;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { exportAll, loading, progress, error };
}
