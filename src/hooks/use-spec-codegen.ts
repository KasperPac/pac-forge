/**
 * useSpecCodegen — load a confirmed FDS contract, compile to SCL, and return
 * artifacts ready for the TIA export bundle.
 */
import { useCallback, useState } from "react";
import type { Artifact } from "@/types";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import { compileContract, type CodegenResult } from "@/lib/spec-builder/codegen";
import { useFbTemplates } from "@/hooks/use-fb-templates";

/**
 * Map the compiler's lightweight artifacts onto the full Artifact shape the
 * TIA export plumbing consumes.  Required fields get deterministic defaults.
 *
 * @param result    - Output of compileContract()
 * @param projectId - Pac-Forge project id (used as project_id + session_id)
 * @param sessionId - Session id written into the artifact rows
 */
export function toExportArtifacts(
  result: CodegenResult,
  projectId: string,
  sessionId: string,
): Artifact[] {
  return result.artifacts.map((a) => ({
    id: a.name,
    project_id: projectId,
    session_id: sessionId,
    name: a.name,
    // CodegenArtifactType ("UDT"|"FB"|"FC"|"DB"|"OB") is a strict subset of
    // ArtifactType, so this cast is safe.
    type: a.type as Artifact["type"],
    filename: a.filename,
    content: a.content,
    approved_content: a.content,
    destination_folder: a.folder,
    dependencies: a.dependencies,
    compile_after_import: true,
    overwrite_strategy: "CREATE_OR_UPDATE" as const,
    safety_warnings: [],
    notes: "",
    created_at: new Date().toISOString(),
  }));
}

export interface CodegenRun {
  result: CodegenResult;
  artifacts: Artifact[];
}

/**
 * Load the confirmed FDS + FB templates, compile to SCL, and return artifacts
 * ready for the TIA export bundle.
 */
export function useSpecCodegen() {
  const { data: templates = [] } = useFbTemplates();
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<CodegenRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (specProjectId: string): Promise<CodegenRun> => {
      setRunning(true);
      setError(null);
      try {
        const contract = await loadSpecContract(specProjectId);
        const result = compileContract(contract, templates);
        const artifacts = toExportArtifacts(result, specProjectId, specProjectId);
        const next: CodegenRun = { result, artifacts };
        setRun(next);
        return next;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setRunning(false);
      }
    },
    [templates],
  );

  return { generate, running, run, error };
}
