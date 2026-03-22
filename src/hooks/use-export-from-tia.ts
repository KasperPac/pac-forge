import { useMutation } from "@tanstack/react-query";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { ExportSourcesResponse } from "@/lib/tia-bridge-contract";

/**
 * Export current PLC block sources from TIA Portal.
 * Calls POST /tia/export-sources on the bridge.
 */
export function useExportFromTia() {
  return useMutation({
    mutationFn: async (): Promise<ExportSourcesResponse> => {
      const response = await fetch(
        `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/export-sources`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(600_000), // TIA export can be slow — large projects (200+ blocks) can take 5+ minutes
        }
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Export failed (${response.status}): ${body}`);
      }

      const data = (await response.json()) as ExportSourcesResponse;
      if (!data.success) {
        throw new Error(data.message || "Export failed");
      }

      return data;
    },
  });
}
