import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getPdfPageCount, renderPdfPageRange } from "@/lib/document-extractor";
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
  chunkSize?: number;          // pages per chunk, default 100
  plcBrand?: string;
  compatibleCpus?: string[];
  programmingLanguage?: string;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number, status: string) => void;
}

interface VisionUploadResult {
  doc: ReferenceLibraryDoc;
  pagesProcessed: number;
  sectionsCreated: number;
}

/**
 * Process a PDF using Claude vision — automatically splits into chunks of chunkSize
 * pages, processing each chunk sequentially. All sections are stored under a single
 * doc entry. Loads the PDF once per chunk and cleans up page resources after each page.
 */
export function useVisionPdfUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      title,
      chunkSize = 100,
      plcBrand = "SIEMENS_TIA",
      compatibleCpus = ["ALL"],
      programmingLanguage = "GENERAL",
      signal,
      onProgress,
    }: VisionUploadInput): Promise<VisionUploadResult> => {
      const { data: { user } } = await supabase.auth.getUser();

      const pageCount = await getPdfPageCount(file);
      const totalChunks = Math.ceil(pageCount / chunkSize);

      onProgress?.(0, pageCount, `Starting — ${pageCount} pages in ${totalChunks} chunk${totalChunks > 1 ? "s" : ""}...`);

      let docId: string | null = null;
      let totalSections = 0;
      let totalChars = 0;
      let totalPagesProcessed = 0;
      let globalSectionIndex = 0;

      for (let chunk = 0; chunk < totalChunks; chunk++) {
        if (signal?.aborted) break;
        const chunkStart = chunk * chunkSize + 1;
        const chunkEnd = Math.min(chunkStart + chunkSize - 1, pageCount);
        const chunkLabel = totalChunks > 1 ? ` (chunk ${chunk + 1}/${totalChunks})` : "";

        onProgress?.(
          totalPagesProcessed,
          pageCount,
          `Processing pages ${chunkStart}–${chunkEnd}${chunkLabel}...`,
        );

        // Render and analyze pages in this chunk — up to CONCURRENT_PAGES API calls in flight
        const CONCURRENT_PAGES = 5;
        const pageContents: { pageNum: number; content: string }[] = [];

        const callVisionPage = async (pageNum: number, dataUri: string): Promise<void> => {
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
                      source: { type: "base64", media_type: "image/png", data: base64Data },
                    },
                    {
                      type: "text",
                      text: `Extract all content from this page (page ${pageNum} of ${pageCount}). Include text, tables, and describe any images/diagrams/screenshots.`,
                    },
                  ],
                },
              ],
              max_tokens: 4096,
            },
          });

          totalPagesProcessed++;
          onProgress?.(totalPagesProcessed, pageCount, `Processed page ${pageNum}`);

          if (fnError) {
            console.error(`[Vision PDF] Error on page ${pageNum}:`, fnError);
            return;
          }
          const text = result?.content ?? "";
          if (text.trim() !== "[SKIP]" && text.trim() !== "[TOC]") {
            pageContents.push({ pageNum, content: text });
          }
        };

        // Sliding window: render pages sequentially (memory-safe), fire API calls concurrently
        const active = new Set<Promise<void>>();
        for await (const { pageNum, dataUri } of renderPdfPageRange(file, chunkStart, chunkEnd)) {
          if (signal?.aborted) break;
          const p: Promise<void> = callVisionPage(pageNum, dataUri).finally(() => active.delete(p));
          active.add(p);
          if (active.size >= CONCURRENT_PAGES) {
            await Promise.race(active);
          }
        }
        // Drain remaining in-flight calls
        await Promise.all(active);

        if (pageContents.length === 0) continue;

        pageContents.sort((a, b) => a.pageNum - b.pageNum);

        onProgress?.(totalPagesProcessed, pageCount, `Indexing chunk ${chunk + 1}/${totalChunks}...`);

        // One section per page — avoids false heading splits on danger notices, table headers, etc.
        const pageSections = pageContents.map((p, localIdx) => ({
          index: localIdx,
          heading: `Page ${p.pageNum}`,
          content: p.content,
        }));
        const sectionTags = await generateTopicTags(pageSections);

        // Create doc on first chunk, reuse doc ID for subsequent chunks
        if (docId === null) {
          const { data: doc, error: docErr } = await supabase
            .from("reference_library_docs")
            .insert({
              title,
              source_filename: file.name,
              file_type: "pdf/vision",
              total_chars: 0,      // updated at end
              section_count: 0,    // updated at end
              plc_brand: plcBrand,
              compatible_cpus: compatibleCpus,
              programming_language: programmingLanguage,
              created_by: user?.id ?? null,
            })
            .select()
            .single();
          if (docErr) throw docErr;
          docId = doc.id;
        }

        // Insert sections for this chunk (continuing globalSectionIndex)
        const sectionRows = pageSections.map((s) => ({
          doc_id: docId!,
          section_index: globalSectionIndex + s.index,
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

        console.log(`[Vision PDF] Chunk ${chunk + 1}/${totalChunks} saved: ${pageSections.length} sections`);

        globalSectionIndex += pageSections.length;
        totalSections += pageSections.length;
        totalChars += pageSections.reduce((sum, s) => sum + s.content.length, 0);
      }

      if (!docId) throw new Error("No content could be extracted from the PDF");

      // Update final counts on the doc (trigger also handles this, but belt-and-suspenders)
      const { error: updateErr } = await supabase
        .from("reference_library_docs")
        .update({ section_count: totalSections, total_chars: totalChars })
        .eq("id", docId);
      if (updateErr) console.warn("[Vision PDF] Failed to update doc counts:", updateErr);

      onProgress?.(pageCount, pageCount, "Done!");

      const { data: finalDoc } = await supabase
        .from("reference_library_docs")
        .select()
        .eq("id", docId)
        .single();

      return {
        doc: finalDoc as ReferenceLibraryDoc,
        pagesProcessed: totalPagesProcessed,
        sectionsCreated: totalSections,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REF_DOCS_KEY });
    },
  });
}

// Topic tag generation
const TOPIC_TAG_PROMPT = `You are a topic tag generator for industrial automation documentation sections. Given a batch of document sections, generate 3-8 topic tags per section.

Tags should be specific, searchable terms like:
- HMI concepts: "screen navigation", "faceplate", "tag binding", "graphic view", "alarm indicator"
- SCL instructions: "TON timer", "CASE statement", "FOR loop"
- LAD instructions: "contact", "coil", "timer network", "parallel branch"
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
