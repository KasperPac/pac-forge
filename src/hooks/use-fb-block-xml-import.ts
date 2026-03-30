/**
 * Hook for importing block XML from TIA Portal for existing FB templates.
 * Fetches the raw SimaticML XML via the bridge's /tia/export-block-xml endpoint
 * and updates the template's block_xml + programming_language fields.
 */

import { useState, useCallback } from "react";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { ExportBlockXmlResponse } from "@/lib/tia-bridge-contract";
import { useUpdateFbTemplate } from "@/hooks/use-fb-templates";
import { extractBlockInfo } from "@/lib/lad-xml-parser";
import type { FbTemplate } from "@/types/fb-template";
import type { FbBlockLanguage } from "@/types/fb-template";

const BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

export function useFbBlockXmlImport() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateTemplate = useUpdateFbTemplate();

  const importBlockXml = useCallback(
    async (template: FbTemplate, folder?: string): Promise<{ updated: number; errors: string[] }> => {
      setLoading(true);
      setError(null);
      const result = { updated: 0, errors: [] as string[] };

      try {
        const blocks = template.blocks ?? [];
        if (blocks.length === 0) {
          throw new Error("Template has no blocks");
        }

        const updatedBlocks = [];

        for (const block of blocks) {
          try {
            const res = await fetch(`${BASE}/tia/export-block-xml`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                block_name: block.block_name,
                folder: folder ?? "",
              }),
            });

            if (!res.ok) {
              const text = await res.text();
              result.errors.push(`${block.block_name}: ${res.status} ${text}`);
              updatedBlocks.push({
                block_name: block.block_name,
                block_type: block.block_type,
                scl_code: block.scl_code,
                sort_order: block.sort_order,
              });
              continue;
            }

            const data = (await res.json()) as ExportBlockXmlResponse;
            if (!data.success || !data.xml_content) {
              result.errors.push(`${block.block_name}: ${data.message}`);
              updatedBlocks.push({
                block_name: block.block_name,
                block_type: block.block_type,
                scl_code: block.scl_code,
                sort_order: block.sort_order,
              });
              continue;
            }

            // Detect programming language from the XML
            const info = extractBlockInfo(data.xml_content);
            const lang = (info.language || "SCL") as FbBlockLanguage;

            updatedBlocks.push({
              block_name: block.block_name,
              block_type: block.block_type,
              scl_code: block.scl_code,
              sort_order: block.sort_order,
              block_xml: data.xml_content,
              programming_language: lang,
            });
            result.updated++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`${block.block_name}: ${msg}`);
            updatedBlocks.push({
              block_name: block.block_name,
              block_type: block.block_type,
              scl_code: block.scl_code,
              sort_order: block.sort_order,
            });
          }
        }

        // Update the template with the new block data
        if (result.updated > 0) {
          await updateTemplate.mutateAsync({
            id: template.id,
            updates: { blocks: updatedBlocks },
          });
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [updateTemplate],
  );

  return { importBlockXml, loading, error };
}
