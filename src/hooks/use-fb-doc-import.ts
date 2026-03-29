/**
 * use-fb-doc-import.ts
 *
 * Hook for importing library documentation PDF and splitting per-FB.
 * Uses PDF text extraction + AI to identify per-block sections,
 * then attaches each section to the matching FB Library template.
 */

import { useState, useCallback } from "react";
import { extractTextFromPdf } from "@/lib/document-extractor";
import { callStreamingCollect } from "@/hooks/use-generation";
import { useUpdateFbTemplate, useFbTemplates } from "@/hooks/use-fb-templates";
import { useFbDeviceCategories, useCreateFbDeviceCategory } from "@/hooks/use-fb-categories";

interface DocSection {
  fbName: string;
  category: string | null;
  content: string;
  matched: boolean;
  templateId: string | null;
}

interface DocImportProgress {
  phase: string;
  current: number;
  total: number;
}

interface DocImportResult {
  totalSections: number;
  matched: number;
  unmatched: number;
  sections: DocSection[];
}

const SPLIT_PROMPT = `You are a technical documentation parser. You will receive the full text of a PLC library manual that documents multiple Function Blocks.

Your task is to split the document into individual per-FB sections AND identify the device category for each FB.

Each FB typically has:
- A heading with the FB name (e.g., "fbVFD_Analog", "fbValve_Solenoid", "fbIO_AnalogInput")
- Parameter tables (inputs, outputs, in/out)
- Description of behaviour, states, status codes
- Configuration instructions
- Wiring examples

Return a JSON array where each element is:
{
  "fbName": "exact FB name as it appears in the document",
  "category": "one of: motor, vfd, valve, analog_io, digital_io, io, process_control, safety, system, instrument, modbus, general",
  "content": "the full documentation text for this FB — preserve all details, tables, parameter descriptions"
}

Category rules:
- motor: motor starters, reversing motors, soft starters, DOL starters
- vfd: variable frequency drives, G120, MicroMaster, Danfoss, Emerson
- valve: solenoid valves, analog valves, hydraulic valves
- analog_io: analog inputs with scaling, analog outputs
- digital_io: digital inputs/outputs with overrides
- io: general IO blocks that don't fit above
- process_control: PID, sequencers, totalizers, integration, tank level, FIFO
- safety: interlocks, permissives, alarm interfaces
- system: mode control, system control
- instrument: load cells, flow meters, specialized sensors
- modbus: Modbus communication blocks, station blocks
- general: utility blocks, helper functions

Other rules:
- Include ALL text for each FB — do not summarize or shorten
- The fbName must match the FB naming convention (usually starts with "fb" or "udt" prefix)
- Include introductory/overview sections under fbName "OVERVIEW" with category "general"
- Preserve formatting: bullet points, numbered lists, parameter names

Return ONLY the JSON array, no markdown fencing.`;

export function useFbDocImport() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<DocImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: templates } = useFbTemplates();
  const updateTemplate = useUpdateFbTemplate();
  const { data: existingCategories } = useFbDeviceCategories();
  const createCategory = useCreateFbDeviceCategory();

  const importDocumentation = useCallback(
    async (file: File): Promise<DocImportResult> => {
      setLoading(true);
      setError(null);
      setProgress({ phase: "Extracting text from PDF...", current: 0, total: 0 });

      try {
        // 1. Extract text from PDF
        let pdfText: string;
        if (file.name.endsWith(".pdf")) {
          pdfText = await extractTextFromPdf(file);
        } else {
          // Plain text file
          pdfText = await file.text();
        }

        if (!pdfText || pdfText.length < 100) {
          throw new Error("PDF text extraction returned too little content. The PDF may be image-based (not searchable).");
        }

        console.log(`[fb-doc-import] Extracted ${pdfText.length} chars from ${file.name}`);

        // 2. Split into chunks if too large (Claude context limit)
        // Process in chunks of ~50K chars to avoid token limits
        const CHUNK_SIZE = 50000;
        const chunks: string[] = [];
        for (let i = 0; i < pdfText.length; i += CHUNK_SIZE) {
          chunks.push(pdfText.slice(i, i + CHUNK_SIZE));
        }

        setProgress({ phase: "AI splitting into per-FB sections...", current: 0, total: chunks.length });

        // 3. Process each chunk through AI
        const allSections: Array<{ fbName: string; category: string | null; content: string }> = [];
        const abort = new AbortController();

        for (let i = 0; i < chunks.length; i++) {
          setProgress({ phase: `Processing chunk ${i + 1}/${chunks.length}...`, current: i + 1, total: chunks.length });

          const { content } = await callStreamingCollect(
            SPLIT_PROMPT,
            [{ role: "user", content: chunks[i] }],
            abort.signal,
            32768,
          );

          // Parse JSON response
          const cleaned = content
            .trim()
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```\s*$/, "")
            .trim();

          try {
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) {
              for (const section of parsed) {
                if (section.fbName && section.content) {
                  const existing = allSections.find((s) => s.fbName === section.fbName);
                  if (existing) {
                    existing.content += "\n\n" + section.content;
                    if (section.category && !existing.category) existing.category = section.category;
                  } else {
                    allSections.push({ fbName: section.fbName, category: section.category ?? null, content: section.content });
                  }
                }
              }
            }
          } catch {
            console.warn(`[fb-doc-import] Failed to parse chunk ${i + 1} response`);
          }
        }

        // 4. Match sections to FB Library templates
        setProgress({ phase: "Matching to FB templates...", current: 0, total: allSections.length });
        const result: DocSection[] = [];

        for (const section of allSections) {
          // Skip overview/reference sections
          if (section.fbName === "OVERVIEW" || section.fbName === "REFERENCE") {
            result.push({
              fbName: section.fbName,
              category: section.category,
              content: section.content,
              matched: false,
              templateId: null,
            });
            continue;
          }

          // Find matching template by name (case-insensitive, fuzzy)
          const template = templates?.find((t) => {
            const tName = t.name.toLowerCase();
            const sName = section.fbName.toLowerCase();
            return tName === sName || tName.includes(sName) || sName.includes(tName);
          });

          result.push({
            fbName: section.fbName,
            category: section.category,
            content: section.content,
            matched: !!template,
            templateId: template?.id ?? null,
          });
        }

        // 5. Auto-create any new categories from doc sections
        const existingCatNames = new Set((existingCategories ?? []).map((c) => c.name));
        const CATEGORY_LABELS: Record<string, string> = {
          motor: "Motor", vfd: "VFD / Drive", valve: "Valve",
          analog_io: "Analog IO", digital_io: "Digital IO", io: "IO",
          process_control: "Process Control", safety: "Safety / Interlock",
          system: "System / Mode", instrument: "Instrument", modbus: "Modbus",
          general: "General",
        };
        const neededCats = new Set(
          result.filter((s) => s.category && !existingCatNames.has(s.category)).map((s) => s.category!),
        );
        for (const cat of neededCats) {
          try {
            await createCategory.mutateAsync({
              name: cat,
              display_name: CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, " "),
            });
            console.log(`[fb-doc-import] Created category: ${cat}`);
          } catch {
            // May already exist
          }
        }

        // 6. Auto-attach matched sections to templates + update categories
        const matched = result.filter((s) => s.matched && s.templateId);
        setProgress({ phase: "Attaching documentation to templates...", current: 0, total: matched.length });

        for (let i = 0; i < matched.length; i++) {
          const section = matched[i];
          setProgress({ phase: `Attaching ${section.fbName}...`, current: i + 1, total: matched.length });

          try {
            const updates: Record<string, unknown> = { documentation: section.content };
            // Also update category if the AI detected one
            if (section.category && section.category !== "general") {
              updates.device_category = section.category;
              console.log(`[fb-doc-import] ${section.fbName} → category: ${section.category}`);
            }
            await updateTemplate.mutateAsync({
              id: section.templateId!,
              updates,
            });
            console.log(`[fb-doc-import] ✓ ${section.fbName} updated`);
          } catch (err) {
            console.warn(`[fb-doc-import] ✗ Failed to update ${section.fbName}:`, err);
          }
        }

        setProgress(null);
        return {
          totalSections: result.length,
          matched: matched.length,
          unmatched: result.filter((s) => !s.matched).length,
          sections: result,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [templates, updateTemplate],
  );

  return { importDocumentation, loading, progress, error };
}
