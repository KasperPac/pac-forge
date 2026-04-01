/**
 * PDF import for the Instruction Library.
 * Uses Claude vision to extract structured instruction definitions
 * from Siemens LAD/SCL instruction manual pages.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getPdfPageCount, renderPdfPageRange } from "@/lib/document-extractor";
import { callNonStreaming } from "@/hooks/use-generation";
import type { InstructionCategory, InstructionLanguage } from "@/types";

const INSTRUCTIONS_KEY = ["instructions"] as const;

// Pages per vision batch — each batch sends multiple page images in one API call
const PAGES_PER_BATCH = 4;
const CONCURRENT_BATCHES = 2;

const EXTRACTION_SYSTEM_PROMPT = `You are an expert at extracting structured instruction definitions from Siemens TIA Portal documentation.

You are processing pages from a Siemens instruction manual (LAD, SCL, or Extended Instructions). Extract every instruction you find on these pages.

For each instruction, extract:
- **name**: Display name (e.g. "TON - Generate on-delay", "R_TRIG - Scan rising edge of signal")
- **element_type**: A code-friendly identifier in UPPER_SNAKE_CASE (e.g. "TON", "R_TRIG", "NORM_X", "SCALE_X", "TP", "SR", "RS")
- **category**: One of: bit_logic, timers_counters, comparators, math, move_convert, extended
- **description**: Brief functional description
- **simatic_part_name**: The exact SimaticML Part Name used in TIA Portal XML (e.g. "TON", "R_Trig", "Norm_X", "Scale_X", "Move", "Contact"). This is the name used in <Part Name="..."> XML elements.
- **programming_language**: "LAD", "SCL", or "BOTH"
- **supported_platforms**: Array like ["S7-1200", "S7-1500"] or ["S7-1200", "S7-1500", "S7-300", "S7-400"]
- **is_box**: true if it's a multi-pin function box (timers, counters, math, etc.), false for contacts/coils
- **is_output**: true if it must be the last element in a LAD rung (coils, math boxes, move)
- **has_instance**: true if it requires an instance DB (timers, counters, edge detection FBs)
- **has_operator**: true if it has sub-operators (compare, math)
- **operators**: Array of operator symbols if has_operator (e.g. ["==","!=",">","<",">=","<="])
- **operator_part_names**: Object mapping operator to Part Name if has_operator (e.g. {"==":"Eq","!=":"Ne"})
- **pins**: Array of pin definitions, each with:
  - pin_name: Exact SimaticML pin name (e.g. "IN", "PT", "Q", "ET", "en", "eno", "in1", "in2", "out", "pre", "operand", "CU", "CD", "PV", "CV", "CLK", "S", "R1")
  - direction: "in", "out", or "inout"
  - data_type: The parameter data type (e.g. "BOOL", "TIME", "INT", "REAL", "ANY", "WORD", "DWORD")
  - is_rung_flow: true if this pin carries the LAD rung power flow (typically: IN/en/pre for inputs, Q/eno/out for outputs), false for data pins
  - description: Brief description of the pin

IMPORTANT:
- Extract ALL instructions shown on the pages, including variations
- Be precise with SimaticML Part Names — these must match what TIA Portal uses in XML
- Pin names must be exact (case-sensitive) as they appear in the SimaticML XML
- If a page shows a parameter table, extract every pin from it
- If a page shows instruction overview/summary tables, extract each listed instruction
- Skip table of contents, introductions, and general explanatory text that don't define specific instructions

Respond with a JSON array of instruction objects. If no instructions are found on these pages, respond with an empty array [].
Wrap your response in \`\`\`json fences.`;

interface ExtractedInstruction {
  name: string;
  element_type: string;
  category: InstructionCategory;
  description: string;
  simatic_part_name: string;
  programming_language: InstructionLanguage;
  supported_platforms: string[];
  is_box: boolean;
  is_output: boolean;
  has_instance: boolean;
  has_operator: boolean;
  operators?: string[];
  operator_part_names?: Record<string, string>;
  pins: Array<{
    pin_name: string;
    direction: "in" | "out" | "inout";
    data_type: string;
    is_rung_flow: boolean;
    description: string;
  }>;
}

interface PdfImportInput {
  file: File;
  startPage?: number;
  endPage?: number;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number, status: string) => void;
  /** Called each time a batch completes with newly extracted instructions (before dedup/save) */
  onExtracted?: (instructions: ExtractedInstruction[]) => void;
}

export type { ExtractedInstruction };

interface PdfImportResult {
  pagesProcessed: number;
  instructionsCreated: number;
  instructionsSkipped: number;
  skippedNames: string[];
}

export function useInstructionPdfImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      startPage = 1,
      endPage,
      signal,
      onProgress,
      onExtracted,
    }: PdfImportInput): Promise<PdfImportResult> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const pageCount = await getPdfPageCount(file);
      const effectiveEnd = endPage ? Math.min(endPage, pageCount) : pageCount;
      const totalPages = effectiveEnd - startPage + 1;

      onProgress?.(0, totalPages, `Reading PDF — ${totalPages} pages to process...`);

      // Collect all page images first
      const pageImages: { pageNum: number; base64: string }[] = [];
      let rendered = 0;
      for await (const { pageNum, dataUri } of renderPdfPageRange(file, startPage, effectiveEnd)) {
        if (signal?.aborted) break;
        const base64 = dataUri.replace(/^data:image\/png;base64,/, "");
        pageImages.push({ pageNum, base64 });
        rendered++;
        onProgress?.(rendered, totalPages, `Rendered page ${pageNum}...`);
      }

      // Build batches of pages
      const batches: { pageNum: number; base64: string }[][] = [];
      for (let i = 0; i < pageImages.length; i += PAGES_PER_BATCH) {
        batches.push(pageImages.slice(i, i + PAGES_PER_BATCH));
      }

      onProgress?.(rendered, totalPages, `Extracting instructions from ${batches.length} batch(es)...`);

      // Process batches with limited concurrency
      const allExtracted: ExtractedInstruction[] = [];
      let batchesDone = 0;

      const processBatch = async (batch: { pageNum: number; base64: string }[]) => {
        if (signal?.aborted) return;

        const pageRange = `${batch[0].pageNum}–${batch[batch.length - 1].pageNum}`;
        const parts: Array<
          | { type: "text"; text: string }
          | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
        > = [];

        for (const page of batch) {
          parts.push({
            type: "image",
            source: { type: "base64", media_type: "image/png", data: page.base64 },
          });
        }
        parts.push({
          type: "text",
          text: `Extract all instruction definitions from these ${batch.length} page(s) (pages ${pageRange}). Return a JSON array of structured instruction objects.`,
        });

        try {
          const { content: responseText } = await callNonStreaming(
            EXTRACTION_SYSTEM_PROMPT,
            [{ role: "user", content: parts }],
            signal ?? AbortSignal.timeout(120_000),
            8192,
          );

          const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
          const jsonStr = jsonMatch ? jsonMatch[1].trim() : responseText.trim();
          const parsed = JSON.parse(jsonStr) as ExtractedInstruction[];

          if (Array.isArray(parsed) && parsed.length > 0) {
            allExtracted.push(...parsed);
            onExtracted?.(parsed);
          }
        } catch (err) {
          console.warn(`[Instruction PDF] Batch pages ${pageRange} failed:`, err);
        }

        batchesDone++;
        onProgress?.(
          Math.min(rendered, totalPages),
          totalPages,
          `Extracted ${allExtracted.length} instruction(s) (${batchesDone}/${batches.length} batches)...`,
        );
      };

      // Run batches with concurrency limit
      const active = new Set<Promise<void>>();
      for (const batch of batches) {
        if (signal?.aborted) break;
        const p: Promise<void> = processBatch(batch).finally(() => active.delete(p));
        active.add(p);
        if (active.size >= CONCURRENT_BATCHES) {
          await Promise.race(active);
        }
      }
      await Promise.all(active);

      if (allExtracted.length === 0) {
        onProgress?.(totalPages, totalPages, "No instructions found in PDF.");
        return { pagesProcessed: totalPages, instructionsCreated: 0, instructionsSkipped: 0, skippedNames: [] };
      }

      // Deduplicate within batch by element_type only (keep first occurrence)
      const seenTypes = new Set<string>();
      const unique: ExtractedInstruction[] = [];
      for (const inst of allExtracted) {
        const typeKey = inst.element_type.toUpperCase();
        if (!seenTypes.has(typeKey)) {
          seenTypes.add(typeKey);
          unique.push(inst);
        }
      }

      onProgress?.(totalPages, totalPages, `Saving ${unique.length} instruction(s)...`);

      // Check which element_types already exist in DB
      const { data: existing } = await supabase
        .from("instructions")
        .select("element_type");
      const existingTypes = new Set(
        (existing ?? []).map((r: { element_type: string }) => r.element_type.toUpperCase()),
      );

      let created = 0;
      let skipped = 0;
      const skippedNames: string[] = [];

      for (const inst of unique) {
        if (existingTypes.has(inst.element_type.toUpperCase())) {
          skipped++;
          skippedNames.push(inst.name);
          continue;
        }

        // Insert instruction
        const { data: row, error: iErr } = await supabase
          .from("instructions")
          .insert({
            name: inst.name,
            element_type: inst.element_type,
            category: inst.category,
            description: inst.description || null,
            simatic_part_name: inst.simatic_part_name,
            programming_language: inst.programming_language,
            supported_platforms: inst.supported_platforms ?? ["S7-1200", "S7-1500"],
            is_box: inst.is_box ?? false,
            is_output: inst.is_output ?? false,
            has_instance: inst.has_instance ?? false,
            has_operator: inst.has_operator ?? false,
            operators: inst.operators ?? null,
            operator_part_names: inst.operator_part_names ?? null,
            sort_order: 100 + created,
            created_by: user.id,
          })
          .select("id")
          .single();

        if (iErr) {
          console.warn(`[Instruction PDF] Failed to insert ${inst.element_type}:`, iErr.message);
          skipped++;
          skippedNames.push(inst.name);
          continue;
        }

        // Insert pins
        if (inst.pins && inst.pins.length > 0) {
          const pinRows = inst.pins.map((p, idx) => ({
            instruction_id: row.id,
            pin_name: p.pin_name,
            direction: p.direction,
            data_type: p.data_type || "BOOL",
            is_rung_flow: p.is_rung_flow ?? false,
            is_required: true,
            description: p.description || null,
            sort_order: idx,
          }));
          const { error: pErr } = await supabase
            .from("instruction_pins")
            .insert(pinRows);
          if (pErr) {
            console.warn(`[Instruction PDF] Failed to insert pins for ${inst.element_type}:`, pErr.message);
          }
        }

        created++;
        existingTypes.add(inst.element_type.toUpperCase());
      }

      onProgress?.(totalPages, totalPages, `Done! Created ${created}, skipped ${skipped} (already exist).`);

      return {
        pagesProcessed: totalPages,
        instructionsCreated: created,
        instructionsSkipped: skipped,
        skippedNames,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INSTRUCTIONS_KEY });
    },
  });
}
