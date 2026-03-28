/**
 * use-fb-library-import.ts
 *
 * Hook for importing FB templates from a TIA Portal library project.
 * Opens the project via the bridge, exports all block sources, then
 * groups them into FB templates (FB + companion UDTs) for the FB Library.
 */

import { useState, useCallback } from "react";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { useCreateFbTemplate } from "@/hooks/use-fb-templates";
import { extractBlockName, inferBlockType } from "@/lib/scl-block-parser";
import type { FbBlockType } from "@/types/fb-template";

interface ImportProgress {
  phase: string;
  current: number;
  total: number;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

interface ExportedBlock {
  name: string;
  language: string;
  source: string;
  blockType: FbBlockType | null;
  declaredName: string;
}

const BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

/**
 * Group exported blocks into templates.
 * Logic: each FB becomes a template. UDTs with matching prefix get attached as companion blocks.
 * E.g., fbValve_Solenoid (FB) + udtValve_Solenoid (UDT) → one template "fbValve_Solenoid"
 */
function groupBlocksIntoTemplates(blocks: ExportedBlock[]): Map<string, ExportedBlock[]> {
  const templates = new Map<string, ExportedBlock[]>();

  // First pass: identify all FBs as template anchors
  const fbs = blocks.filter((b) => b.blockType === "FB");
  for (const fb of fbs) {
    templates.set(fb.declaredName, [fb]);
  }

  // Second pass: match UDTs/DBs to their parent FB
  const others = blocks.filter((b) => b.blockType !== "FB");
  for (const block of others) {
    // Try to match by name similarity (e.g., udtVFD_Analog → fbVFD_Analog)
    const baseName = block.declaredName
      .replace(/^udt/i, "")
      .replace(/^type/i, "")
      .replace(/^ERROR_/i, "");

    let matched = false;
    for (const [fbName, group] of templates) {
      const fbBaseName = fbName.replace(/^fb/i, "");
      if (baseName === fbBaseName || block.declaredName.includes(fbBaseName) || fbName.includes(baseName)) {
        group.push(block);
        matched = true;
        break;
      }
    }

    // If no match, create a standalone template
    if (!matched && (block.blockType === "UDT" || block.blockType === "FC")) {
      templates.set(block.declaredName, [block]);
    }
  }

  return templates;
}

export function useFbLibraryImport() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createTemplate = useCreateFbTemplate();

  const importFromTiaProject = useCallback(
    async (
      projectPath: string,
      libraryName: string,
      deviceCategory: string,
    ): Promise<ImportResult> => {
      setLoading(true);
      setError(null);
      setProgress({ phase: "Connecting to TIA Portal...", current: 0, total: 0 });

      const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

      try {
        // 1. Connect to TIA Portal
        const connectRes = await fetch(`${BASE}/tia/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "attach", with_ui: true }),
        });
        if (!connectRes.ok) throw new Error("Failed to connect to TIA Portal");

        // 2. Open the library project
        setProgress({ phase: "Opening project...", current: 0, total: 0 });
        const openRes = await fetch(`${BASE}/tia/open-project`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_path: projectPath }),
        });
        if (!openRes.ok) {
          const body = await openRes.text();
          throw new Error(`Failed to open project: ${body}`);
        }

        // 3. Export all sources
        setProgress({ phase: "Exporting block sources...", current: 0, total: 0 });
        const exportRes = await fetch(`${BASE}/tia/export-sources`, { method: "POST" });
        if (!exportRes.ok) throw new Error("Failed to export sources");
        const exportData = await exportRes.json() as {
          success: boolean;
          sources: Record<string, string>;
          source_languages: Record<string, string>;
          warnings: string[];
        };

        if (!exportData.success) throw new Error("Export failed");

        // 4. Parse exported blocks
        const blocks: ExportedBlock[] = [];
        for (const [name, source] of Object.entries(exportData.sources)) {
          const language = exportData.source_languages[name] ?? "SCL";
          // Skip non-SCL blocks (LAD/FBD export as XML, not useful for templates)
          if (language !== "SCL" && language !== "DB" && language !== "UDT") {
            result.skipped++;
            continue;
          }
          const declaredName = extractBlockName(source) ?? name;
          const blockType = inferBlockType(source) as FbBlockType | null;
          blocks.push({ name, language, source, blockType, declaredName });
        }

        // 5. Group into templates
        const templateGroups = groupBlocksIntoTemplates(blocks);
        const total = templateGroups.size;
        let current = 0;

        // 6. Create FB templates
        for (const [templateName, templateBlocks] of templateGroups) {
          current++;
          setProgress({ phase: `Importing ${templateName}...`, current, total });

          try {
            const mainFb = templateBlocks.find((b) => b.blockType === "FB");
            const description = mainFb
              ? `Imported from ${libraryName}`
              : `${templateBlocks[0].blockType ?? "Block"} from ${libraryName}`;

            await createTemplate.mutateAsync({
              name: templateName,
              device_category: deviceCategory,
              plc_brand: "SIEMENS_TIA",
              description,
              tags: [libraryName.toLowerCase().replace(/\s+/g, "-")],
              blocks: templateBlocks.map((b, i) => ({
                block_name: b.declaredName,
                block_type: (b.blockType ?? "FB") as FbBlockType,
                scl_code: b.source,
                sort_order: i,
              })),
              source: "library" as const,
              library_name: libraryName,
            });
            result.imported++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`${templateName}: ${msg}`);
          }
        }

        setProgress(null);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [createTemplate],
  );

  return { importFromTiaProject, loading, progress, error };
}
