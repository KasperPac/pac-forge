/**
 * use-fb-library-import.ts
 *
 * Hook for importing FB templates from a TIA Portal Global Library (.zal file).
 * Opens the library via the bridge, exports all block sources, then
 * groups them into FB templates (FB + companion UDTs) for the FB Library.
 *
 * Optionally accepts a documentation PDF which is split per-FB by AI
 * and attached to each matching template.
 */

import { useState, useCallback } from "react";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { useCreateFbTemplate, useUpdateFbTemplate } from "@/hooks/use-fb-templates";
import { extractBlockName, inferBlockType } from "@/lib/scl-block-parser";
import { extractTextFromPdf } from "@/lib/document-extractor";
import { callStreamingCollect } from "@/hooks/use-generation";
import type { FbBlockType } from "@/types/fb-template";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportProgress {
  phase: string;
  current: number;
  total: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  docsMatched: number;
  docsUnmatched: number;
  errors: string[];
}

interface ExportedBlock {
  name: string;
  language: string;
  source: string;
  blockType: FbBlockType | null;
  declaredName: string;
}

interface LibraryItem {
  name: string;
  path: string;
  kind: string;
  guid: string;
}

interface LibraryContents {
  success: boolean;
  message: string;
  library_name: string;
  types: LibraryItem[];
  master_copies: LibraryItem[];
}

interface LibraryExport {
  success: boolean;
  message: string;
  items: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Doc splitting prompt
// ---------------------------------------------------------------------------

const DOC_SPLIT_PROMPT = `You are a technical documentation parser. Split this PLC library manual text into per-FB sections.

Each FB typically has a heading (e.g., "fbVFD_Analog", "fbValve_Solenoid") followed by parameter tables, behaviour description, status codes, wiring examples.

Return a JSON array:
[
  { "fbName": "exact FB name", "content": "full documentation text for this FB" }
]

Rules:
- Include ALL text for each FB — do not summarize
- The fbName must match the FB naming convention (usually "fb" prefix or "udt" prefix)
- General/overview sections: use fbName "OVERVIEW"
- Preserve formatting, parameter names, tables
- Return ONLY the JSON array, no markdown fencing`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

async function bridgePost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Bridge ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * Group exported blocks into templates.
 * Each FB becomes a template. UDTs with matching prefix get attached as companion blocks.
 */
function groupBlocksIntoTemplates(blocks: ExportedBlock[]): Map<string, ExportedBlock[]> {
  const templates = new Map<string, ExportedBlock[]>();

  // First: FBs as template anchors
  for (const block of blocks) {
    if (block.blockType === "FB") {
      templates.set(block.declaredName, [block]);
    }
  }

  // Second: match UDTs/FCs/DBs to their parent FB
  for (const block of blocks) {
    if (block.blockType === "FB") continue;

    const baseName = block.declaredName
      .replace(/^udt/i, "")
      .replace(/^type/i, "")
      .replace(/^ERROR_/i, "");

    let matched = false;
    for (const [fbName, group] of templates) {
      const fbBase = fbName.replace(/^fb/i, "");
      if (baseName === fbBase || block.declaredName.includes(fbBase) || fbName.includes(baseName)) {
        group.push(block);
        matched = true;
        break;
      }
    }

    if (!matched && block.blockType) {
      templates.set(block.declaredName, [block]);
    }
  }

  return templates;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFbLibraryImport() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createTemplate = useCreateFbTemplate();
  const updateTemplate = useUpdateFbTemplate();

  const importLibrary = useCallback(
    async (
      libraryPath: string,
      libraryName: string,
      deviceCategory: string,
      docFile?: File | null,
    ): Promise<ImportResult> => {
      setLoading(true);
      setError(null);
      setProgress({ phase: "Connecting to TIA Portal...", current: 0, total: 0 });

      const result: ImportResult = { imported: 0, skipped: 0, docsMatched: 0, docsUnmatched: 0, errors: [] };

      try {
        // 1. Connect to TIA Portal
        await bridgePost("/tia/connect", { mode: "attach", with_ui: true });

        // 2. Open the global library and enumerate contents
        setProgress({ phase: "Opening library...", current: 0, total: 0 });
        const contents = await bridgePost<LibraryContents>("/tia/library/open", {
          library_path: libraryPath,
        });

        if (!contents.success) throw new Error(`Failed to open library: ${contents.message}`);
        console.log(`[fb-import] Library: ${contents.library_name}, ${contents.types.length} types, ${contents.master_copies.length} master copies`);

        // 3. Export all items from the library
        setProgress({ phase: "Exporting library blocks...", current: 0, total: 0 });
        const exported = await bridgePost<LibraryExport>("/tia/library/export", {
          library_path: libraryPath,
          item_paths: [], // empty = export all
        });

        if (!exported.success) throw new Error(`Export failed: ${exported.message}`);
        console.log(`[fb-import] Exported ${Object.keys(exported.items).length} items`);

        // 4. Parse exported blocks
        const blocks: ExportedBlock[] = [];
        for (const [name, source] of Object.entries(exported.items)) {
          if (!source || source.length < 10) { result.skipped++; continue; }
          const declaredName = extractBlockName(source) ?? name;
          const blockType = inferBlockType(source) as FbBlockType | null;
          blocks.push({ name, language: "SCL", source, blockType, declaredName });
        }

        // 5. Group into templates
        const templateGroups = groupBlocksIntoTemplates(blocks);

        // 6. Extract documentation from PDF (if provided)
        let docSections: Map<string, string> = new Map();
        if (docFile) {
          setProgress({ phase: "Extracting PDF documentation...", current: 0, total: 0 });
          let pdfText: string;
          if (docFile.name.endsWith(".pdf")) {
            pdfText = await extractTextFromPdf(docFile);
          } else {
            pdfText = await docFile.text();
          }

          if (pdfText.length > 100) {
            // Split into chunks and process with AI
            const CHUNK_SIZE = 50000;
            const chunks: string[] = [];
            for (let i = 0; i < pdfText.length; i += CHUNK_SIZE) {
              chunks.push(pdfText.slice(i, i + CHUNK_SIZE));
            }

            for (let i = 0; i < chunks.length; i++) {
              setProgress({ phase: `Splitting docs (chunk ${i + 1}/${chunks.length})...`, current: i + 1, total: chunks.length });
              const abort = new AbortController();
              try {
                const { content } = await callStreamingCollect(
                  DOC_SPLIT_PROMPT,
                  [{ role: "user", content: chunks[i] }],
                  abort.signal,
                  32768,
                );
                const cleaned = content.trim()
                  .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
                const parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed)) {
                  for (const s of parsed) {
                    if (s.fbName && s.content) {
                      const existing = docSections.get(s.fbName);
                      docSections.set(s.fbName, existing ? existing + "\n\n" + s.content : s.content);
                    }
                  }
                }
              } catch {
                console.warn(`[fb-import] Doc chunk ${i + 1} parse failed`);
              }
            }
            console.log(`[fb-import] Split docs into ${docSections.size} sections`);
          }
        }

        // 7. Create FB templates with blocks + documentation
        const total = templateGroups.size;
        let current = 0;

        for (const [templateName, templateBlocks] of templateGroups) {
          current++;
          setProgress({ phase: `Creating ${templateName}...`, current, total });

          try {
            const mainFb = templateBlocks.find((b) => b.blockType === "FB");

            // Match documentation by name (case-insensitive, fuzzy)
            let doc: string | null = null;
            for (const [docName, docContent] of docSections) {
              const tLower = templateName.toLowerCase();
              const dLower = docName.toLowerCase();
              if (tLower === dLower || tLower.includes(dLower) || dLower.includes(tLower)) {
                doc = docContent;
                result.docsMatched++;
                break;
              }
            }
            if (!doc) result.docsUnmatched++;

            await createTemplate.mutateAsync({
              name: templateName,
              device_category: deviceCategory,
              plc_brand: "SIEMENS_TIA",
              description: mainFb ? `${templateName} from ${libraryName}` : `${templateBlocks[0]?.blockType ?? "Block"} from ${libraryName}`,
              documentation: doc,
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
    [createTemplate, updateTemplate],
  );

  return { importLibrary, loading, progress, error };
}
