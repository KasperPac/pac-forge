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
import { generateFbSummaryText } from "@/hooks/use-generate-fb-summary";
import { supabase } from "@/lib/supabase";

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

Each FB typically has a heading (e.g., "fbVFD_Analog", "fbValve_Solenoid") followed by parameter tables, behaviour description, status codes, wiring examples, and configuration steps.

Return a JSON array:
[
  { "fbName": "exact FB name", "content": "full documentation text for this FB" }
]

Rules:
- Include ALL text for each FB — do not summarize or truncate
- The fbName must match the FB naming convention (usually "fb" prefix or "udt" prefix)
- General/overview sections: use fbName "OVERVIEW"
- Preserve formatting, parameter names, parameter tables (Input/Output/InOut with types and descriptions)
- PRESERVE dependency information: which UDTs the FB uses, which other FBs it works with, required companion blocks
- PRESERVE configuration/wiring examples: instance DB naming, HMI tag mapping, VB scripts, mode control wiring
- PRESERVE status code tables, error code lists, HMI faceplate interface descriptions
- If a section describes how to configure/wire a specific FB (even in a general doc), include it under that FB's name
- Return ONLY the JSON array, no markdown fencing`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

/**
 * Keyword → canonical category key mapping.
 * detectCategory returns the canonical key, then matchExistingCategory resolves
 * it to an existing DB category name (case-insensitive, singular/plural).
 */
const CATEGORY_KEYWORDS: Array<{ keywords: string[]; category: string }> = [
  { keywords: ["vfd", "drive", "simocode", "unidrive", "danfoss", "profidrive"], category: "vfd" },
  { keywords: ["motor", "starter", "reversing", "airlock"], category: "motor" },
  { keywords: ["valve", "solenoid", "hydraulic"], category: "valve" },
  { keywords: ["io_analog", "analoginput", "analogoutput"], category: "analog_io" },
  { keywords: ["io_digital", "digitalinput", "digitaloutput"], category: "digital_io" },
  { keywords: ["io_"], category: "io" },
  { keywords: ["pid", "integration", "totaliz", "tank", "level", "fifo", "hopper", "flowmeter", "running_avg", "rate"], category: "process_control" },
  { keywords: ["alarm", "interlock", "permissive"], category: "safety" },
  { keywords: ["sequen", "mode", "system"], category: "system" },
  { keywords: ["siwarex", "loadcell", "calibration"], category: "instrument" },
  { keywords: ["pulse", "pwm"], category: "io" },
  { keywords: ["servo"], category: "servo" },
  { keywords: ["conveyor", "feed"], category: "conveyor" },
];

/**
 * Match a canonical category key against existing DB categories.
 * Tries: exact match, then case-insensitive, then singular/plural fuzzy match.
 */
function matchExistingCategory(canonicalKey: string, existingNames: string[]): string | null {
  // Exact match
  if (existingNames.includes(canonicalKey)) return canonicalKey;

  const keyLower = canonicalKey.toLowerCase().replace(/_/g, "");

  for (const name of existingNames) {
    const nameLower = name.toLowerCase().replace(/[_\s-]/g, "");

    // Case-insensitive exact
    if (nameLower === keyLower) return name;

    // Singular/plural: "motor" matches "Motors", "vfd" matches "VFDs"
    if (nameLower === keyLower + "s" || nameLower + "s" === keyLower) return name;

    // One contains the other
    if (nameLower.includes(keyLower) || keyLower.includes(nameLower)) return name;
  }

  return null;
}

/**
 * Auto-detect device category from FB name using Open Library naming conventions.
 * Matches against existing DB categories first (fuzzy), then returns a canonical key
 * that will be created if it doesn't exist.
 */
function detectCategory(fbName: string, defaultCategory: string, existingCategoryNames?: string[]): string {
  const lower = fbName.toLowerCase();

  // Find canonical category key from FB name keywords
  let canonicalKey: string | null = null;
  for (const { keywords, category } of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      canonicalKey = category;
      break;
    }
  }

  if (!canonicalKey) return defaultCategory;

  // Try to match against existing DB categories
  if (existingCategoryNames && existingCategoryNames.length > 0) {
    const match = matchExistingCategory(canonicalKey, existingCategoryNames);
    if (match) return match;
  }

  return canonicalKey;
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
 * Extract the device type stem from a block name.
 * Open Library naming: fbIO_DigitalOutput → "DigitalOutput"
 *                      udtHMI_DigitalOutput → "DigitalOutput"
 *                      udtError_VFD → "VFD"
 *                      fbVFD_GSeries → "GSeries" (but also "VFD")
 * Returns an array of candidate stems for fuzzy matching.
 */
function extractDeviceStems(name: string): string[] {
  // Strip common prefixes
  const stripped = name
    .replace(/^(fb|fc|udt|type|error)_?/i, "")
    .replace(/^HMI_?/i, "");

  const stems: string[] = [stripped.toLowerCase()];

  // Split on underscore — each part is a potential match key
  const parts = stripped.split("_");
  for (const p of parts) {
    if (p.length >= 3) stems.push(p.toLowerCase());
  }

  // Also add the full name without just the prefix for direct containment checks
  const noPrefix = name.replace(/^(fb|fc|udt|type)/i, "");
  stems.push(noPrefix.toLowerCase());

  return [...new Set(stems)];
}

/**
 * Check if a UDT is referenced in an FB's interface (VAR_IN_OUT or VAR sections).
 * E.g., if fbIO_DigitalOutput has `HMI_IO_DigitalOutput : udtHMI_DigitalOutput` in its interface.
 */
function fbReferencesBlock(fbBlock: ParsedLibraryBlock, otherName: string): boolean {
  return fbBlock.interfaceScl.toLowerCase().includes(otherName.toLowerCase());
}

/**
 * Group parsed library blocks into templates.
 * Each FB becomes a template. UDTs/FCs/DBs get attached to their parent FB
 * using multi-strategy matching: interface references, device type stems, documentation.
 */
function groupBlocksIntoTemplates(blocks: ParsedLibraryBlock[]): Map<string, ParsedLibraryBlock[]> {
  const templates = new Map<string, ParsedLibraryBlock[]>();

  // First: FBs as template anchors
  const fbBlocks: ParsedLibraryBlock[] = [];
  for (const block of blocks) {
    if (block.type === "FB") {
      templates.set(block.name, [block]);
      fbBlocks.push(block);
    }
  }

  // Second: match non-FB blocks to their parent FB
  for (const block of blocks) {
    if (block.type === "FB") continue;

    let matched = false;
    const blockStems = extractDeviceStems(block.name);

    // Strategy 1: Check if any FB's interface SCL references this block by name
    for (const fb of fbBlocks) {
      if (fbReferencesBlock(fb, block.name)) {
        templates.get(fb.name)!.push(block);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Strategy 2: Device type stem overlap
    for (const [fbName, group] of templates) {
      const fbStems = extractDeviceStems(fbName);
      // Check if any stem from the block matches any stem from the FB
      const overlap = blockStems.some((bs) =>
        fbStems.some((fs) => bs === fs || (bs.length >= 5 && fs.includes(bs)) || (fs.length >= 5 && bs.includes(fs)))
      );
      if (overlap) {
        group.push(block);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Strategy 3: Direct containment (legacy fallback)
    for (const [fbName, group] of templates) {
      const fbBase = fbName.replace(/^fb/i, "").toLowerCase();
      const blockBase = block.name.replace(/^(udt|type|error)/i, "").toLowerCase();
      if (fbBase.includes(blockBase) || blockBase.includes(fbBase)) {
        group.push(block);
        matched = true;
        break;
      }
    }

    // No match — create standalone template
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

        // 5b. Filter out supplementary/example/undocumented blocks
        // These are 3rd-party Modbus drivers, example programs, etc. that
        // don't have documentation and aren't standard library FBs.
        const SKIP_PATTERNS = [
          /^example\b/i,
          /^sample\b/i,
          /^test\b/i,
          /^demo\b/i,
        ];
        // Blocks that don't match any known category and aren't core Open Library FBs
        // are likely supplementary. The core FBs follow naming: fb{Category}_{Type}, udt{...}, fc{...}
        const CORE_PREFIX = /^(fb|fc|udt|type)/i;
        let skippedCount = 0;
        for (const [name] of templateGroups) {
          const shouldSkip = SKIP_PATTERNS.some((p) => p.test(name))
            || (!CORE_PREFIX.test(name) && detectCategory(name, "__none__") === "__none__");
          if (shouldSkip) {
            templateGroups.delete(name);
            skippedCount++;
          }
        }
        if (skippedCount > 0) {
          console.log(`[fb-import] Skipped ${skippedCount} supplementary/example blocks`);
          result.skipped = skippedCount;
        }

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

            // Determine if this is a per-FB doc (has sections for individual FBs)
            // or a general library doc (architecture, setup, alarm generation, etc.)
            // Per-FB docs: Block Overview, Example Config, Detailed descriptions — anything with per-device sections
            const isPerFbDoc = /block overview|example.*config|detailed|function block|device.*description/i.test(docFile.name)
              || /\bfb[A-Z]/i.test(pdfText.slice(0, 5000)); // Also detect if content has fbXxx patterns early on

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
              // General library doc (Architecture, Alarm Generation, etc.)
              // These contain library-wide info: modes, naming, UDT structure, alarm config
              // Store under a special key — will be appended to each template's docs
              const key = `GENERAL:${docFile.name.replace(/\.pdf$/i, "")}`;
              // Keep up to 30KB per general doc — these have important reference info
              docSections.set(key, pdfText.slice(0, 30000));
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
        const existingCatList = Array.from(existingCatNames);
        const neededCategories = new Set<string>();
        for (const [templateName] of templateGroups) {
          const cat = detectCategory(templateName, deviceCategory, existingCatList);
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

            const autoCategory = detectCategory(templateName, deviceCategory, existingCatList);
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
                block_xml: b.rawXml || null,
                programming_language: (b.programmingLanguage || "SCL") as "SCL" | "LAD" | "FBD" | "STL" | "GRAPH",
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

        // 9. Generate AI summaries for all imported templates
        if (result.imported > 0) {
          setProgress({ phase: "Generating AI summaries...", current: 0, total: result.imported });

          // Re-fetch created templates to get their IDs
          const { data: createdTemplates } = await supabase
            .from("fb_templates")
            .select("id, name, device_category, tags, documentation, ai_summary")
            .eq("source", "library")
            .eq("library_name", libraryName)
            .is("ai_summary", null);

          if (createdTemplates && createdTemplates.length > 0) {
            // Also fetch their blocks for the summary prompt
            const ids = createdTemplates.map((t) => t.id);
            const { data: allBlocks } = await supabase
              .from("fb_template_blocks")
              .select("template_id, block_type, block_name, scl_code")
              .in("template_id", ids);

            const blocksByTemplate = new Map<string, Array<{ block_type: string; block_name: string; scl_code: string }>>();
            for (const b of allBlocks ?? []) {
              const list = blocksByTemplate.get(b.template_id) ?? [];
              list.push(b);
              blocksByTemplate.set(b.template_id, list);
            }

            let summaryCount = 0;
            for (const t of createdTemplates) {
              summaryCount++;
              setProgress({ phase: `AI summary: ${t.name}...`, current: summaryCount, total: createdTemplates.length });
              try {
                const summary = await generateFbSummaryText({
                  name: t.name,
                  device_category: t.device_category,
                  tags: t.tags ?? [],
                  blocks: blocksByTemplate.get(t.id) ?? [],
                  documentation: t.documentation,
                });
                if (summary) {
                  await supabase
                    .from("fb_templates")
                    .update({ ai_summary: summary })
                    .eq("id", t.id);
                }
              } catch (err) {
                console.warn(`[fb-import] Summary failed for ${t.name}:`, err);
              }
            }
            console.log(`[fb-import] Generated ${summaryCount} AI summaries`);
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
