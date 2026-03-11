import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { renderPdfPageRange } from "@/lib/document-extractor";
import type { ReferenceLibraryDoc } from "@/types";

const REF_DOCS_KEY = ["reference-library-docs"] as const;

const VISION_SYSTEM_PROMPT = `You are an expert technical documentation analyzer. You are processing pages from a Siemens industrial automation reference document (HMI screens, PLC programming, or similar).

For each page image, extract ALL content into structured sections. You MUST:

1. **Preserve all text** — transcribe headings, body text, table contents, notes, and captions accurately
2. **Describe images/diagrams** — for any screenshots, diagrams, schematics, or UI mockups, provide a detailed description in square brackets like [IMAGE: Description of what the screenshot shows, including specific UI elements, colors, layout structure, dimensions if visible]
3. **Preserve tables** — format as markdown tables with | delimiters
4. **Mark headings** — use markdown ## for main headings, ### for sub-headings, based on visual hierarchy
5. **Include page context** — note if content continues from a previous page

Respond with the extracted content as clean markdown text. Do NOT wrap in code fences. Do NOT add commentary — only the extracted content.

If the page is a title page, cover page, or blank page, respond with just: [SKIP]
If the page is a table of contents, respond with just: [TOC]`;

interface VisionUploadInput {
  file: File;
  title: string;
  startPage: number;
  endPage: number;
  plcBrand?: string;
  compatibleCpus?: string[];
  onProgress?: (current: number, total: number, status: string) => void;
}

interface VisionUploadResult {
  doc: ReferenceLibraryDoc;
  pagesProcessed: number;
  sectionsCreated: number;
}

/** Process a PDF using Claude vision — renders each page as an image and extracts structured content */
export function useVisionPdfUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      title,
      startPage,
      endPage,
      plcBrand = "SIEMENS_TIA",
      compatibleCpus = ["ALL"],
      onProgress,
    }: VisionUploadInput): Promise<VisionUploadResult> => {
      const { data: { user } } = await supabase.auth.getUser();

      const rangeTotal = endPage - startPage + 1;
      onProgress?.(0, rangeTotal, `Processing pages ${startPage}–${endPage}...`);

      // Process pages one at a time using the range generator (loads PDF once, cleans up per page)
      const pageContents: { pageNum: number; content: string }[] = [];
      let processed = 0;

      for await (const { pageNum, dataUri } of renderPdfPageRange(file, startPage, endPage)) {
        onProgress?.(processed, rangeTotal, `Analyzing page ${pageNum} with AI...`);

        const base64Data = dataUri.replace(/^data:image\/png;base64,/, "");

        const { data: result, error: fnError } = await supabase.functions.invoke("generate", {
          body: {
            system_prompt: VISION_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: base64Data,
                    },
                  },
                  {
                    type: "text",
                    text: `Extract all content from this page (page ${pageNum}, chunk covers pages ${startPage}–${endPage}). Include text, tables, and describe any images/diagrams/screenshots.`,
                  },
                ],
              },
            ],
            max_tokens: 4096,
          },
        });

        processed++;
        onProgress?.(processed, rangeTotal, `Processed page ${pageNum}`);

        if (fnError) {
          console.error(`[Vision PDF] Error on page ${pageNum}:`, fnError);
          pageContents.push({ pageNum, content: `[Error processing page ${pageNum}]` });
          continue;
        }

        const text = result?.content ?? "";
        if (text.trim() !== "[SKIP]" && text.trim() !== "[TOC]") {
          pageContents.push({ pageNum, content: text });
        }
      }

      // Sort by page number and combine
      pageContents.sort((a, b) => a.pageNum - b.pageNum);
      const fullContent = pageContents.map((p) => p.content).join("\n\n");

      if (!fullContent.trim()) {
        throw new Error("No content could be extracted from the PDF");
      }

      onProgress?.(pageCount, pageCount, "Splitting into sections...");

      // Split the vision-extracted content into sections (it already has markdown headings)
      const { splitIntoSections } = await import("@/lib/document-sections");
      const sections = splitIntoSections(fullContent);

      // Generate topic tags using AI (batch of 10)
      onProgress?.(pageCount, pageCount, "Generating topic tags...");
      const sectionTags = await generateTopicTags(sections);

      // Insert parent doc
      const { data: doc, error: docErr } = await supabase
        .from("reference_library_docs")
        .insert({
          title,
          source_filename: file.name,
          file_type: "pdf/vision",
          total_chars: fullContent.length,
          section_count: sections.length,
          plc_brand: plcBrand,
          compatible_cpus: compatibleCpus,
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (docErr) throw docErr;

      // Insert sections
      const sectionRows = sections.map((s) => ({
        doc_id: doc.id,
        section_index: s.index,
        heading: s.heading,
        content: s.content,
        char_count: s.content.length,
        topic_tags: sectionTags[s.index] ?? [],
      }));

      const INSERT_BATCH = 50;
      for (let i = 0; i < sectionRows.length; i += INSERT_BATCH) {
        const batch = sectionRows.slice(i, i + INSERT_BATCH);
        const { error: secErr } = await supabase
          .from("reference_library_sections")
          .insert(batch);
        if (secErr) throw secErr;
      }

      onProgress?.(pageCount, pageCount, "Done!");

      return {
        doc: doc as ReferenceLibraryDoc,
        pagesProcessed: pageContents.length,
        sectionsCreated: sections.length,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REF_DOCS_KEY });
    },
  });
}

// Topic tag generation (same logic as use-reference-library.ts)
const TOPIC_TAG_PROMPT = `You are a topic tag generator for industrial automation documentation sections. Given a batch of document sections, generate 3-8 topic tags per section.

Tags should be specific, searchable terms like:
- HMI concepts: "screen navigation", "faceplate", "tag binding", "graphic view", "alarm indicator"
- SCL instructions: "TON timer", "CASE statement", "FOR loop"
- Visual concepts: "button style", "color scheme", "layout grid", "status indicator"
- Equipment: "motor control", "valve symbol", "conveyor graphic", "tank level"

Return a JSON object where keys are section indices (as strings) and values are arrays of topic tag strings.`;

async function generateTopicTags(
  sections: { index: number; heading: string; content: string }[],
): Promise<Record<number, string[]>> {
  const { callNonStreaming } = await import("@/hooks/use-generation");
  const tags: Record<number, string[]> = {};
  const BATCH_SIZE = 10;

  for (let i = 0; i < sections.length; i += BATCH_SIZE) {
    const batch = sections.slice(i, i + BATCH_SIZE);
    const batchMessage = batch
      .map((s) => {
        const preview = s.content.length > 1000 ? s.content.slice(0, 1000) + "..." : s.content;
        return `### Section ${s.index}: ${s.heading}\n${preview}`;
      })
      .join("\n\n---\n\n");

    try {
      const { content } = await callNonStreaming(
        TOPIC_TAG_PROMPT,
        [{ role: "user", content: batchMessage }],
        AbortSignal.timeout(30_000),
      );
      const jsonStr = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(jsonStr) as Record<string, string[]>;

      for (const [key, tagList] of Object.entries(parsed)) {
        const globalIndex = i + parseInt(key, 10);
        if (globalIndex < sections.length) {
          tags[globalIndex] = tagList;
        }
      }
    } catch {
      for (const s of batch) {
        tags[s.index] = [];
      }
    }
  }

  return tags;
}
