import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getAuthToken } from "@/hooks/use-generation";
import { useAgents } from "@/hooks/use-agents";
import { getAgentProfile } from "@/lib/agent-profiles";
import type {
  Agent,
  KnowledgeUpload,
  KnowledgeDistributionEntry,
} from "@/types";
import { splitIntoSections } from "@/lib/document-sections";
import type { DocSection } from "@/lib/document-sections";

const KNOWLEDGE_UPLOADS_KEY = ["knowledge-uploads"] as const;
const KNOWLEDGE_DOCS_KEY = ["agent-knowledge"] as const;

/**
 * Documents above this size use the two-pass approach
 * (structure scan → targeted extraction) instead of brute-force chunking.
 */
const TWO_PASS_THRESHOLD = 80_000;

/** Max characters per chunk when processing sections. */
const CHUNK_CHAR_LIMIT = 60_000;

/** Preview chars per section in the table of contents. */
const SECTION_PREVIEW_CHARS = 600;

/** Max tokens for PM distribution responses. */
const DISTRIBUTION_MAX_TOKENS = 32_768;

// ---- Queries ----

export function useKnowledgeUploads() {
  return useQuery({
    queryKey: KNOWLEDGE_UPLOADS_KEY,
    queryFn: async (): Promise<KnowledgeUpload[]> => {
      const { data, error } = await supabase
        .from("knowledge_uploads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as KnowledgeUpload[];
    },
  });
}

export function useDeleteKnowledgeUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error: docsErr } = await supabase
        .from("agent_knowledge_docs")
        .delete()
        .eq("source_upload_id", id);
      if (docsErr) console.error("Failed to delete distributed docs:", docsErr);

      const { error } = await supabase
        .from("knowledge_uploads")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_UPLOADS_KEY });
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_DOCS_KEY });
    },
  });
}

// ---- Chunking ----

function chunkContent(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];

  const paragraphs = content.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      if (current.trim()) { chunks.push(current.trim()); current = ""; }
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars));
      }
      continue;
    }
    const combined = current ? `${current}\n\n${para}` : para;
    if (combined.length > maxChars) {
      if (current.trim()) chunks.push(current.trim());
      current = para;
    } else {
      current = combined;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ---- JSON parsing ----

/**
 * Sanitize JSON string values that contain unescaped control characters
 * (newlines, tabs, etc.) which Claude sometimes produces inside content fields.
 */
function sanitizeJsonString(json: string): string {
  // Replace unescaped control chars inside JSON string values.
  // Walk character by character, tracking whether we're inside a string.
  const chars: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (escaped) {
      chars.push(ch);
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      chars.push(ch);
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      chars.push(ch);
      continue;
    }

    // If inside a string and we hit a control character, escape it
    if (inString) {
      if (ch === "\n") { chars.push("\\n"); continue; }
      if (ch === "\r") { chars.push("\\r"); continue; }
      if (ch === "\t") { chars.push("\\t"); continue; }
    }

    chars.push(ch);
  }

  return chars.join("");
}

function extractJsonArray(raw: string): unknown[] {
  const cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON array found in response: ${raw.slice(0, 300)}`);
  }

  const jsonStr = cleaned.slice(start, end + 1);

  // Try parsing directly first, fall back to sanitized version
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) throw new Error("Not an array");
    return parsed;
  } catch {
    // Sanitize unescaped control characters and retry
    const sanitized = sanitizeJsonString(jsonStr);
    const parsed = JSON.parse(sanitized);
    if (!Array.isArray(parsed)) throw new Error("Parsed value is not an array");
    return parsed;
  }
}

// ---- PM API call ----

async function callPM(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = DISTRIBUTION_MAX_TOKENS,
): Promise<unknown[]> {
  const token = await getAuthToken();

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({
        system_prompt: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        stream: false,
        max_tokens: maxTokens,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PM call failed (${response.status}): ${text}`);
  }

  const result = await response.json();
  const raw = (result.content as string).trim();
  return extractJsonArray(raw);
}

// ---- Shared helpers ----

type PMDistribution = {
  agent_id: string;
  agent_name: string;
  title: string;
  content: string;
  reasoning: string;
  compatible_cpus: string[];
};

type PMSectionPick = {
  agent_id: string;
  agent_name: string;
  section_numbers: number[];
  reasoning: string;
};

function buildAgentDescriptions(agents: Agent[]): string {
  return agents
    .filter((a) => !a.specialties.includes("ORCHESTRATE"))
    .map((a) => {
      const profile = getAgentProfile(a.display_name);
      const scopeList = profile.knowledgeScope.map((s) => `    + ${s}`).join("\n");
      const excludeList = profile.knowledgeExclusions.map((s) => `    - ${s}`).join("\n");
      return [
        `- **${a.display_name}** (ID: ${a.id}): ${profile.tagline}`,
        `  Relevant knowledge:`,
        scopeList,
        ...(excludeList ? [`  NOT relevant:`, excludeList] : []),
      ].join("\n");
    })
    .join("\n\n");
}

const DISTRIBUTION_RULES = `
## Distribution Rules
- Be SELECTIVE. Not every agent needs content from every document.
- Match content to each agent's "Relevant knowledge" list. Skip agents whose scope does not match.
- If content is generic SCL reference material (syntax, built-in functions), it belongs with the Code Architect only.
- If content is about safety standards/regulations, it belongs with the Safety Auditor only.
- Hardware IO specifications go to IO Validator only.
- Do NOT distribute the same content to multiple agents unless it genuinely serves different purposes for each.
- When in doubt, distribute to FEWER agents rather than more.`;


// ---- Pass 1: Structure scan (large docs only) ----

async function scanStructure(
  agents: Agent[],
  sections: DocSection[],
  sourceLabel: string,
): Promise<PMSectionPick[]> {
  const agentDesc = buildAgentDescriptions(agents);

  const toc = sections
    .map((s) => {
      const preview = s.content.slice(0, SECTION_PREVIEW_CHARS).replace(/\n/g, " ");
      return `[${s.index}] ${s.heading} (${s.content.length} chars)\n   ${preview}...`;
    })
    .join("\n\n");

  const systemPrompt = `You are the Project Manager agent. Review the table of contents of a large document and decide which sections are relevant for your specialist agents.

## Available Agents
${agentDesc}
${DISTRIBUTION_RULES}

## Instructions
1. Review each section's heading and preview text carefully.
2. For each agent, list which section NUMBERS contain content relevant to their specialty and "Relevant knowledge" list.
3. Be selective — skip boilerplate, table of contents, indexes, appendixes, and generic introductions.
4. Skip agents whose scope does not match the document's content.
5. Note: Some sections may have generic headings like "Section 1" — judge relevance by the preview content, not the heading.
6. When in doubt about a section's relevance, INCLUDE it — we can filter later. It's better to capture useful content than to miss it.
7. Respond with ONLY a JSON array. No other text.

Response format:
[
  { "agent_id": "<uuid>", "agent_name": "<name>", "section_numbers": [0, 3, 7], "reasoning": "<why>" }
]

If nothing is relevant, respond with: []`;

  const userMessage = `Table of contents for "${sourceLabel}" (${sections.length} sections). Which sections are relevant to each agent?\n\n${toc}`;

  return (await callPM(systemPrompt, userMessage, 4096)) as PMSectionPick[];
}

// ---- Pass 2: Targeted extraction ----

async function extractFromSections(
  agents: Agent[],
  sections: DocSection[],
  picks: PMSectionPick[],
  sourceLabel: string,
  onProgress?: (msg: string) => void,
): Promise<PMDistribution[]> {
  const neededIndices = new Set<number>();
  for (const pick of picks) {
    for (const idx of pick.section_numbers) neededIndices.add(idx);
  }
  if (neededIndices.size === 0) return [];

  const relevantContent = sections
    .filter((s) => neededIndices.has(s.index))
    .map((s) => `## ${s.heading}\n\n${s.content}`)
    .join("\n\n---\n\n");

  const chunks = chunkContent(relevantContent, CHUNK_CHAR_LIMIT);
  const agentDesc = buildAgentDescriptions(agents);
  const allDists: PMDistribution[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) onProgress?.(`Extracting knowledge (chunk ${i + 1}/${chunks.length})...`);

    const systemPrompt = `You are the Project Manager agent. Extract relevant knowledge from the document sections below and distribute to specialist agents.

## Available Agents
${agentDesc}
${DISTRIBUTION_RULES}

## Instructions
1. For each agent, extract ONLY content that matches their "Relevant knowledge" list.
2. **PRESERVE COMPLETE CONTENT** — include all relevant details, code examples, parameter tables, constraints, and technical specifications. Do NOT summarize or condense. The agents need the full information to do their jobs correctly. Longer extractions are fine.
3. Create a **descriptive title** that clearly identifies the topic (e.g., "SCL Timer Function Reference", "S7-1500 Memory Addressing Rules"). Do NOT use generic titles like "Section 1" or "Part 2".
4. If a document section covers multiple distinct topics relevant to the same agent, split them into SEPARATE entries with distinct titles.
5. Only include content for multiple agents if it genuinely serves different purposes for each.
6. For each extracted section, determine which PLC CPU models it applies to.
   Valid CPU values: "S7-1200", "S7-1200F", "S7-1500", "S7-1500F", "S7-1500T", "S7-1500TF"
   Use "ALL" if the content applies to all CPU models or if no specific CPU is mentioned.
7. Respond with ONLY a JSON array. No other text.

Response format:
[
  { "agent_id": "<uuid>", "agent_name": "<name>", "title": "<descriptive topic title>", "content": "<full extracted knowledge — include all details, examples, tables>", "reasoning": "<why relevant>", "compatible_cpus": ["ALL"] }
]

If nothing is relevant, respond with: []`;

    const chunkLabel = chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : "";
    const userMessage = `Extract knowledge from these sections of "${sourceLabel}"${chunkLabel}:\n\n${chunks[i]}`;

    const raw = await callPM(systemPrompt, userMessage);
    allDists.push(...(raw as PMDistribution[]));
  }

  return allDists;
}

// ---- Single-pass (small documents) ----

async function distributeSmallDoc(
  agents: Agent[],
  content: string,
  sourceLabel: string,
  onProgress?: (msg: string) => void,
): Promise<PMDistribution[]> {
  const chunks = chunkContent(content, CHUNK_CHAR_LIMIT);
  const agentDesc = buildAgentDescriptions(agents);
  const allDists: PMDistribution[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) onProgress?.(`Analyzing chunk ${i + 1}/${chunks.length}...`);

    const systemPrompt = `You are the Project Manager agent. Analyze the document and distribute relevant sections to specialist agents.

## Available Agents
${agentDesc}
${DISTRIBUTION_RULES}

## Instructions
1. For each agent, extract ONLY sections that match their "Relevant knowledge" list.
2. **PRESERVE COMPLETE CONTENT** — include all relevant details, code examples, parameter tables, constraints, and technical specifications. Do NOT summarize or condense. The agents need the full information to do their jobs correctly. Longer extractions are fine.
3. Create a **descriptive title** that clearly identifies the topic (e.g., "SCL Timer Function Reference", "S7-1500 Memory Addressing Rules"). Do NOT use generic titles like "Section 1" or "Part 2".
4. If a document covers multiple distinct topics relevant to the same agent, split them into SEPARATE entries with distinct titles.
5. Only include content for multiple agents if it genuinely serves different purposes for each.
6. For each extracted section, determine which PLC CPU models it applies to.
   Valid CPU values: "S7-1200", "S7-1200F", "S7-1500", "S7-1500F", "S7-1500T", "S7-1500TF"
   Use "ALL" if the content applies to all CPU models or if no specific CPU is mentioned.
7. Respond with ONLY a JSON array. No other text.

Response format:
[
  { "agent_id": "<uuid>", "agent_name": "<name>", "title": "<descriptive topic title>", "content": "<full extracted knowledge — include all details, examples, tables>", "reasoning": "<why relevant>", "compatible_cpus": ["ALL"] }
]

If nothing is relevant, respond with: []`;

    const chunkLabel = chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : "";
    const userMessage = `Analyze this document${chunkLabel} (source: "${sourceLabel}") and distribute relevant sections:\n\n${chunks[i]}`;

    const raw = await callPM(systemPrompt, userMessage);
    allDists.push(...(raw as PMDistribution[]));
  }

  return allDists;
}

// ---- Public types ----

/** A proposed knowledge distribution (pre-confirmation). */
export interface ProposedDistribution {
  agent_id: string;
  agent_name: string;
  title: string;
  content: string;
  reasoning: string;
  compatible_cpus: string[];
  /** Unique key for the UI to track selection state. */
  key: string;
}

export interface AnalyzeResult {
  uploadId: string;
  proposals: ProposedDistribution[];
}

export interface AnalyzeInput {
  content: string;
  sourceFilename: string;
  fileType: string;
  wordCount: number;
  plcBrand: string;
  compatibleCpus: string[];
  onProgress?: (message: string) => void;
}

export interface ConfirmInput {
  uploadId: string;
  sourceFilename: string;
  fileType: string;
  plcBrand: string;
  /** Only the proposals the user confirmed. */
  confirmed: ProposedDistribution[];
}

interface DistributionResult {
  uploadId: string;
  entries: KnowledgeDistributionEntry[];
}

// ---- Analyze hook (step 1: PM proposes, user reviews) ----

export function useAnalyzeKnowledge() {
  const { data: agents } = useAgents();

  return useMutation({
    mutationFn: async (input: AnalyzeInput): Promise<AnalyzeResult> => {
      if (!agents || agents.length === 0) {
        throw new Error("No agents available for distribution");
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      input.onProgress?.("Saving upload...");

      // Save the upload record (distribution will be filled on confirm)
      const { data: upload, error: uploadErr } = await supabase
        .from("knowledge_uploads")
        .insert({
          source_filename: input.sourceFilename,
          file_type: input.fileType,
          word_count: input.wordCount,
          full_content: input.content,
          distribution: [],
          plc_brand: input.plcBrand,
          compatible_cpus: input.compatibleCpus,
          created_by: user.id,
        })
        .select()
        .single();
      if (uploadErr) throw uploadErr;

      // Run PM analysis
      let distributions: PMDistribution[];

      if (input.content.length > TWO_PASS_THRESHOLD) {
        input.onProgress?.("Scanning document structure...");
        const sections = splitIntoSections(input.content);
        input.onProgress?.(`Found ${sections.length} sections. PM is selecting relevant ones...`);

        const picks = await scanStructure(agents, sections, input.sourceFilename);
        const totalPicked = picks.reduce((sum, p) => sum + p.section_numbers.length, 0);
        input.onProgress?.(`PM selected ${totalPicked} section(s). Extracting knowledge...`);

        distributions = await extractFromSections(
          agents, sections, picks, input.sourceFilename, input.onProgress,
        );
      } else {
        input.onProgress?.("PM is analyzing document...");
        distributions = await distributeSmallDoc(
          agents, input.content, input.sourceFilename, input.onProgress,
        );
      }

      // Convert to proposals with unique keys
      const proposals: ProposedDistribution[] = distributions
        .filter((d) => agents.some((a) => a.id === d.agent_id))
        .map((d, i) => ({
          ...d,
          compatible_cpus: Array.isArray(d.compatible_cpus) && d.compatible_cpus.length > 0
            ? d.compatible_cpus
            : input.compatibleCpus,
          key: `${d.agent_id}-${i}`,
        }));

      return { uploadId: upload.id, proposals };
    },
  });
}

// ---- Confirm hook (step 2: save confirmed distributions) ----

export function useConfirmDistribution() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ConfirmInput): Promise<DistributionResult> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const entries: KnowledgeDistributionEntry[] = [];

      for (const dist of input.confirmed) {
        const { data: doc, error: docErr } = await supabase
          .from("agent_knowledge_docs")
          .insert({
            agent_id: dist.agent_id,
            title: dist.title,
            content: dist.content,
            source_filename: input.sourceFilename,
            file_type: input.fileType,
            word_count: dist.content.split(/\s+/).filter(Boolean).length,
            source_upload_id: input.uploadId,
            distribution_reasoning: dist.reasoning,
            plc_brand: input.plcBrand,
            compatible_cpus: dist.compatible_cpus,
            created_by: user.id,
          })
          .select()
          .single();

        if (docErr) {
          console.error(`Failed to create doc for ${dist.agent_name}:`, docErr);
          continue;
        }

        entries.push({
          agent_id: dist.agent_id,
          agent_name: dist.agent_name,
          doc_id: doc.id,
          title: dist.title,
          reasoning: dist.reasoning,
          content_preview: dist.content.slice(0, 300),
        });
      }

      // Update the upload record with final distribution
      const { error: updateErr } = await supabase
        .from("knowledge_uploads")
        .update({ distribution: entries })
        .eq("id", input.uploadId);
      if (updateErr) console.error("Failed to update upload distribution:", updateErr);

      return { uploadId: input.uploadId, entries };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_UPLOADS_KEY });
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_DOCS_KEY });
    },
  });
}

// ---- Cancel hook (discard upload if user rejects all proposals) ----

export function useCancelUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (uploadId: string) => {
      const { error } = await supabase
        .from("knowledge_uploads")
        .delete()
        .eq("id", uploadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_UPLOADS_KEY });
    },
  });
}
