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
import { useFbDeviceCategories, useCreateFbDeviceCategory } from "@/hooks/use-fb-categories";
import { parseLibraryExport } from "@/lib/simatic-xml-interface-parser";
import type { ParsedLibraryBlock } from "@/lib/simatic-xml-interface-parser";
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

/**
 * Auto-detect device category from FB name using Open Library naming conventions.
 * Falls back to the user-provided default category.
 */
function detectCategory(fbName: string, defaultCategory: string): string {
  const lower = fbName.toLowerCase();
  if (lower.includes("vfd") || lower.includes("drive") || lower.includes("simocode") || lower.includes("unidrive") || lower.includes("danfoss")) return "vfd";
  if (lower.includes("motor") || lower.includes("starter") || lower.includes("reversing")) return "motor";
  if (lower.includes("valve") || lower.includes("solenoid") || lower.includes("hydraulic")) return "valve";
  if (lower.includes("io_analog") || lower.includes("analoginput") || lower.includes("analogoutput")) return "analog_io";
  if (lower.includes("io_digital") || lower.includes("digitalinput") || lower.includes("digitaloutput")) return "digital_io";
  if (lower.includes("io_")) return "io";
  if (lower.includes("pid") || lower.includes("integration") || lower.includes("totaliz")) return "process_control";
  if (lower.includes("alarm") || lower.includes("interlock") || lower.includes("permissive")) return "safety";
  if (lower.includes("sequen") || lower.includes("mode") || lower.includes("system")) return "system";
  if (lower.includes("siwarex") || lower.includes("flowmeter") || lower.includes("profidrive")) return "instrument";
  if (lower.includes("tank") || lower.includes("level") || lower.includes("fifo")) return "process_control";
  if (lower.includes("pulse") || lower.includes("pwm") || lower.includes("output")) return "io";
  return defaultCategory;
}

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
 * Group parsed library blocks into templates.
 * Each FB becomes a template. UDTs with matching prefix get attached as companion blocks.
 */
function groupBlocksIntoTemplates(blocks: ParsedLibraryBlock[]): Map<string, ParsedLibraryBlock[]> {
  const templates = new Map<string, ParsedLibraryBlock[]>();

  // First: FBs as template anchors
  for (const block of blocks) {
    if (block.type === "FB") {
      templates.set(block.name, [block]);
    }
  }

  // Second: match UDTs/FCs/DBs to their parent FB
  for (const block of blocks) {
    if (block.type === "FB") continue;

    const baseName = block.name
      .replace(/^udt/i, "")
      .replace(/^type/i, "")
      .replace(/^ERROR_/i, "");

    let matched = false;
    for (const [fbName, group] of templates) {
      const fbBase = fbName.replace(/^fb/i, "");
      if (baseName === fbBase || block.name.includes(fbBase) || fbName.includes(baseName)) {
        group.push(block);
        matched = true;
        break;
      }
    }

    if (!matched) {
      templates.set(block.name, [block]);
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
  const { data: existingCategories } = useFbDeviceCategories();
  const createCategory = useCreateFbDeviceCategory();

  const importLibrary = useCallback(
    async (
      libraryPath: string,
      libraryName: string,
      deviceCategory: string,
      docFiles?: File[],
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

        // 4. Parse exported XML blocks to extract interfaces
        setProgress({ phase: "Parsing block interfaces...", current: 0, total: 0 });
        const blocks = parseLibraryExport(exported.items);
        console.log(`[fb-import] Parsed ${blocks.length} blocks from XML (${blocks.filter(b => b.type === "FB").length} FBs, ${blocks.filter(b => b.type === "UDT").length} UDTs)`);

        // 5. Group into templates
        const templateGroups = groupBlocksIntoTemplates(blocks);

        // 6. Extract documentation from PDFs (if provided)
        const docSections: Map<string, string> = new Map();
        if (docFiles && docFiles.length > 0) {
          for (let fi = 0; fi < docFiles.length; fi++) {
            const docFile = docFiles[fi];
            setProgress({ phase: `Reading ${docFile.name}...`, current: fi + 1, total: docFiles.length });

            let pdfText: string;
            try {
              if (docFile.name.endsWith(".pdf")) {
                pdfText = await extractTextFromPdf(docFile);
              } else {
                pdfText = await docFile.text();
              }
            } catch (err) {
              console.warn(`[fb-import] Failed to extract text from ${docFile.name}:`, err);
              continue;
            }

            if (pdfText.length < 100) {
              console.warn(`[fb-import] ${docFile.name}: too little text (${pdfText.length} chars), skipping`);
              continue;
            }

            console.log(`[fb-import] ${docFile.name}: ${pdfText.length} chars extracted`);

            // Determine if this is a per-FB doc (Block Overview, Example Config)
            // or a general library doc (Architecture, Setup, etc.)
            const isPerFbDoc = /block overview|example.*config|detailed/i.test(docFile.name);

            if (isPerFbDoc) {
              // Split per-FB using AI
              const CHUNK_SIZE = 50000;
              const chunks: string[] = [];
              for (let i = 0; i < pdfText.length; i += CHUNK_SIZE) {
                chunks.push(pdfText.slice(i, i + CHUNK_SIZE));
              }

              for (let i = 0; i < chunks.length; i++) {
                setProgress({ phase: `Splitting ${docFile.name} (chunk ${i + 1}/${chunks.length})...`, current: i + 1, total: chunks.length });
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
            } else {
              // General library doc — attach to all templates as shared reference
              // Store under a special key that we'll merge into each template's docs
              const key = `GENERAL:${docFile.name.replace(/\.pdf$/i, "")}`;
              docSections.set(key, pdfText.slice(0, 10000)); // Truncate general docs to avoid massive prompts
            }
          }
          console.log(`[fb-import] Total doc sections: ${docSections.size}`);
        }

        // Collect general docs (to append to each template)
        const generalDocs: string[] = [];
        for (const [key, content] of docSections) {
          if (key.startsWith("GENERAL:")) {
            generalDocs.push(`## ${key.replace("GENERAL:", "")}\n${content}`);
          }
        }
        const generalDocText = generalDocs.length > 0 ? "\n\n---\n" + generalDocs.join("\n\n") : "";

        // 7. Auto-create device categories that don't exist yet
        const existingCatNames = new Set((existingCategories ?? []).map((c) => c.name));
        const neededCategories = new Set<string>();
        for (const [templateName] of templateGroups) {
          const cat = detectCategory(templateName, deviceCategory);
          if (!existingCatNames.has(cat)) neededCategories.add(cat);
        }
        if (neededCategories.size > 0) {
          setProgress({ phase: `Creating ${neededCategories.size} new categories...`, current: 0, total: 0 });
          const CATEGORY_LABELS: Record<string, string> = {
            vfd: "VFD / Drive",
            motor: "Motor",
            valve: "Valve",
            analog_io: "Analog IO",
            digital_io: "Digital IO",
            io: "IO",
            process_control: "Process Control",
            safety: "Safety / Interlock",
            system: "System / Mode",
            instrument: "Instrument",
          };
          for (const cat of neededCategories) {
            try {
              await createCategory.mutateAsync({
                name: cat,
                display_name: CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, " "),
              });
              existingCatNames.add(cat);
              console.log(`[fb-import] Created category: ${cat}`);
            } catch (err) {
              console.warn(`[fb-import] Failed to create category ${cat}:`, err);
            }
          }
        }

        // 8. Create FB templates with blocks + documentation
        const total = templateGroups.size;
        let current = 0;

        for (const [templateName, templateBlocks] of templateGroups) {
          current++;
          setProgress({ phase: `Creating ${templateName}...`, current, total });

          try {
            const mainFb = templateBlocks.find((b) => b.type === "FB");

            // Match per-FB documentation by name (case-insensitive, fuzzy)
            let doc: string | null = null;
            for (const [docName, docContent] of docSections) {
              if (docName.startsWith("GENERAL:")) continue;
              const tLower = templateName.toLowerCase();
              const dLower = docName.toLowerCase();
              if (tLower === dLower || tLower.includes(dLower) || dLower.includes(tLower)) {
                doc = docContent;
                result.docsMatched++;
                break;
              }
            }
            if (!doc && docSections.size > 0) result.docsUnmatched++;

            // Append general library docs to each template's documentation
            if (doc) {
              doc += generalDocText;
            } else if (generalDocText) {
              doc = generalDocText;
            }

            const autoCategory = detectCategory(templateName, deviceCategory);
            console.log(`[fb-import] ${current}/${total} Creating: ${templateName} (${autoCategory}, ${templateBlocks.length} blocks, doc: ${doc ? doc.length + " chars" : "none"})`);
            await createTemplate.mutateAsync({
              name: templateName,
              device_category: autoCategory,
              plc_brand: "SIEMENS_TIA",
              description: mainFb ? `${templateName} from ${libraryName}` : `${templateBlocks[0]?.type ?? "Block"} from ${libraryName}`,
              documentation: doc,
              tags: [libraryName.toLowerCase().replace(/\s+/g, "-")],
              blocks: templateBlocks.map((b, i) => ({
                block_name: b.name,
                block_type: (b.type === "Unknown" ? "FB" : b.type) as FbBlockType,
                scl_code: b.interfaceScl,
                sort_order: i,
              })),
              source: "library" as const,
              library_name: libraryName,
            });
            result.imported++;
            console.log(`[fb-import] ✓ ${templateName} created`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[fb-import] ✗ ${templateName} FAILED: ${msg}`);
            result.errors.push(`${templateName}: ${msg}`);
          }
        }

        setProgress(null);
        console.log(`[fb-import] DONE: ${result.imported} imported, ${result.skipped} skipped, ${result.docsMatched} docs matched, ${result.errors.length} errors`);
        if (result.errors.length > 0) {
          console.warn("[fb-import] Errors:", result.errors.slice(0, 10));
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
    [createTemplate, updateTemplate, existingCategories, createCategory],
  );

  return { importLibrary, loading, progress, error };
}
