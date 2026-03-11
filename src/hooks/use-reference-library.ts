import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { callNonStreaming } from "@/hooks/use-generation";
import { splitIntoSections } from "@/lib/document-sections";
import type {
  ReferenceLibraryDoc,
  ReferenceLibrarySection,
} from "@/types";

const REF_DOCS_KEY = ["reference-library-docs"] as const;

// ---- Queries ----

export function useReferenceLibraryDocs() {
  return useQuery({
    queryKey: REF_DOCS_KEY,
    queryFn: async (): Promise<ReferenceLibraryDoc[]> => {
      const { data, error } = await supabase
        .from("reference_library_docs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ReferenceLibraryDoc[];
    },
  });
}

export function useReferenceLibrarySections(docId: string | undefined) {
  return useQuery({
    queryKey: [...REF_DOCS_KEY, "sections", docId],
    queryFn: async (): Promise<ReferenceLibrarySection[]> => {
      const { data, error } = await supabase
        .from("reference_library_sections")
        .select("id, doc_id, section_index, heading, content, char_count, topic_tags, created_at")
        .eq("doc_id", docId!)
        .order("section_index", { ascending: true });
      if (error) throw error;
      return data as ReferenceLibrarySection[];
    },
    enabled: !!docId,
  });
}

/** Fetch all reference library sections (for global conflict detection). */
export function useAllReferenceSections() {
  return useQuery({
    queryKey: [...REF_DOCS_KEY, "all-sections"],
    queryFn: async (): Promise<ReferenceLibrarySection[]> => {
      const { data, error } = await supabase
        .from("reference_library_sections")
        .select("id, doc_id, section_index, heading, content, char_count, topic_tags, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ReferenceLibrarySection[];
    },
  });
}

// ---- Upload ----

const TOPIC_TAG_SYSTEM_PROMPT = `You are a topic tag generator for PLC documentation sections. Given a batch of document sections about Siemens S7-1200/S7-1500 PLC programming, generate 3-8 topic tags per section.

Tags should be specific, searchable terms like:
- SCL instructions: "TON timer", "CASE statement", "FOR loop", "R_TRIG edge detection"
- Data types: "ARRAY declaration", "STRING handling", "UDT STRUCT", "REAL conversion"
- Patterns: "state machine", "alarm handling", "FB call syntax", "PLCopen"
- Concepts: "naming conventions", "optimized access", "symbolic addressing"

Return a JSON object where keys are section indices (as strings) and values are arrays of topic tag strings.
Example: {"0": ["TON timer", "timer reset", "PT parameter"], "1": ["CASE statement", "state machine", "integer labels"]}`;

interface UploadInput {
  title: string;
  content: string;
  sourceFilename: string;
  fileType: string;
  plcBrand?: string;
  compatibleCpus?: string[];
  programmingLanguage?: string;
}

export function useUploadReferenceDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      title,
      content,
      sourceFilename,
      fileType,
      plcBrand = "SIEMENS_TIA",
      compatibleCpus = ["ALL"],
      programmingLanguage = "GENERAL",
    }: UploadInput) => {
      const { data: { user } } = await supabase.auth.getUser();

      // Split into sections
      const sections = splitIntoSections(content);

      // Generate topic tags in batches of 10
      const sectionTags: Record<number, string[]> = {};
      const BATCH_SIZE = 10;

      for (let i = 0; i < sections.length; i += BATCH_SIZE) {
        const batch = sections.slice(i, i + BATCH_SIZE);
        const batchMessage = batch
          .map((s) => {
            const preview = s.content.length > 1000
              ? s.content.slice(0, 1000) + "..."
              : s.content;
            return `### Section ${s.index}: ${s.heading}\n${preview}`;
          })
          .join("\n\n---\n\n");

        try {
          const abort = new AbortController();
          const { content: aiResponse } = await callNonStreaming(
            TOPIC_TAG_SYSTEM_PROMPT,
            [{ role: "user", content: batchMessage }],
            abort.signal,
          );

          // Parse JSON from response (handle markdown code fences)
          const jsonStr = aiResponse
            .replace(/```json\s*/g, "")
            .replace(/```\s*/g, "")
            .trim();
          const parsed = JSON.parse(jsonStr) as Record<string, string[]>;

          for (const [key, tags] of Object.entries(parsed)) {
            const globalIndex = i + parseInt(key, 10);
            if (globalIndex < sections.length) {
              sectionTags[globalIndex] = tags;
            }
          }
        } catch {
          // If AI tagging fails for a batch, continue without tags
          for (const s of batch) {
            sectionTags[s.index] = [];
          }
        }
      }

      // Insert parent doc
      const { data: doc, error: docErr } = await supabase
        .from("reference_library_docs")
        .insert({
          title,
          source_filename: sourceFilename,
          file_type: fileType,
          total_chars: content.length,
          section_count: sections.length,
          plc_brand: plcBrand,
          compatible_cpus: compatibleCpus,
          programming_language: programmingLanguage,
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

      // Insert in batches (Supabase has row limits)
      const INSERT_BATCH = 50;
      for (let i = 0; i < sectionRows.length; i += INSERT_BATCH) {
        const batch = sectionRows.slice(i, i + INSERT_BATCH);
        const { error: secErr } = await supabase
          .from("reference_library_sections")
          .insert(batch);
        if (secErr) throw secErr;
      }

      return doc as ReferenceLibraryDoc;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REF_DOCS_KEY });
    },
  });
}

// ---- Delete ----

export function useDeleteReferenceDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (docId: string) => {
      // Sections cascade on delete
      const { error } = await supabase
        .from("reference_library_docs")
        .delete()
        .eq("id", docId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REF_DOCS_KEY });
    },
  });
}
