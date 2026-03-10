import { useState } from "react";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { ImportLadRequest, ImportLadResponse } from "@/lib/tia-bridge-contract";
import type { LadProgram } from "@/types/lad";
import { buildLadXml } from "@/lib/lad-xml-builder";

export interface LadImportOptions {
  tiaProjectPath?: string;
  destinationFolder?: string;
  compile: boolean;
}

export interface LadImportState {
  loading: boolean;
  error: string | null;
  result: ImportLadResponse | null;
}

/**
 * Hook for importing a LAD program into TIA Portal via the local bridge.
 * Uses POST /tia/import-lad which calls PlcBlockGroup.Blocks.Import() (SimaticML XML path).
 */
export function useLadImport() {
  const [state, setState] = useState<LadImportState>({
    loading: false,
    error: null,
    result: null,
  });

  async function importToTia(
    program: LadProgram,
    options: LadImportOptions,
  ): Promise<ImportLadResponse | null> {
    setState({ loading: true, error: null, result: null });

    try {
      const xmlContent = buildLadXml(program);

      const body: ImportLadRequest = {
        xml_content: xmlContent,
        block_name: program.name,
        block_type: program.blockType,
        compile: options.compile,
        ...(options.tiaProjectPath ? { tia_project_path: options.tiaProjectPath } : {}),
        ...(options.destinationFolder ? { destination_folder: options.destinationFolder } : {}),
      };

      const resp = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/import-lad`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000), // LAD import + compile can take ~30s
      });

      const data: ImportLadResponse = await resp.json();

      if (!resp.ok || !data.success) {
        const msg = data.message ?? `Bridge returned ${resp.status}`;
        setState({ loading: false, error: msg, result: data });
        return data;
      }

      setState({ loading: false, error: null, result: data });
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reach TIA bridge";
      setState({ loading: false, error: msg, result: null });
      return null;
    }
  }

  function reset() {
    setState({ loading: false, error: null, result: null });
  }

  return { ...state, importToTia, reset };
}
