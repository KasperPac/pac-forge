import { useState } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  buildLibraryExtractSystemPrompt,
  buildLibraryExtractUserMessage,
} from "@/lib/library-import-prompts";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LibraryParam {
  name: string;
  data_type: string;
  description: string;
}

export interface ExtractedBlock {
  name: string;
  block_type: "FB" | "FC";
  description: string;
  inputs: LibraryParam[];
  outputs: LibraryParam[];
  in_out: LibraryParam[];
  tags: string[];
  /** Whether the user has selected this block for import */
  selected: boolean;
}

export interface LibraryImportState {
  extracting: boolean;
  progress: string | null;
  blocks: ExtractedBlock[];
  error: string | null;
}

// ─── SCL stub generator ────────────────────────────────────────────────────────

/** Build an interface-only SCL stub from an extracted block definition. */
export function buildSclStub(block: ExtractedBlock): string {
  const keyword = block.block_type === "FB" ? "FUNCTION_BLOCK" : "FUNCTION";
  const endKeyword = block.block_type === "FB" ? "END_FUNCTION_BLOCK" : "END_FUNCTION";
  const lines: string[] = [];

  lines.push(`${keyword} "${block.name}"`);

  if (block.inputs.length > 0) {
    lines.push("VAR_INPUT");
    for (const p of block.inputs) {
      const comment = p.description ? ` // ${p.description}` : "";
      lines.push(`    ${p.name} : ${p.data_type};${comment}`);
    }
    lines.push("END_VAR");
  }

  if (block.in_out.length > 0) {
    lines.push("VAR_IN_OUT");
    for (const p of block.in_out) {
      const comment = p.description ? ` // ${p.description}` : "";
      lines.push(`    ${p.name} : ${p.data_type};${comment}`);
    }
    lines.push("END_VAR");
  }

  if (block.outputs.length > 0) {
    lines.push("VAR_OUTPUT");
    for (const p of block.outputs) {
      const comment = p.description ? ` // ${p.description}` : "";
      lines.push(`    ${p.name} : ${p.data_type};${comment}`);
    }
    lines.push("END_VAR");
  }

  lines.push(`// ${block.description}`);
  lines.push(`// Library block — source code not included`);
  lines.push(endKeyword);

  return lines.join("\n");
}

// ─── Chunk size ────────────────────────────────────────────────────────────────

const CHUNK_CHARS = 50_000;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) {
    chunks.push(text.slice(i, i + CHUNK_CHARS));
  }
  return chunks;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useLibraryImport() {
  const [state, setState] = useState<LibraryImportState>({
    extracting: false,
    progress: null,
    blocks: [],
    error: null,
  });

  function toggleBlock(name: string) {
    setState((s) => ({
      ...s,
      blocks: s.blocks.map((b) =>
        b.name === name ? { ...b, selected: !b.selected } : b,
      ),
    }));
  }

  function selectAll(selected: boolean) {
    setState((s) => ({ ...s, blocks: s.blocks.map((b) => ({ ...b, selected })) }));
  }

  function reset() {
    setState({ extracting: false, progress: null, blocks: [], error: null });
  }

  async function extractFromText(docText: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    setState({ extracting: true, progress: "Preparing document…", blocks: [], error: null });

    try {
      const chunks = chunkText(docText);
      const systemPrompt = buildLibraryExtractSystemPrompt();
      const allBlocks = new Map<string, ExtractedBlock>();

      let completed = 0;
      setState((s) => ({
        ...s,
        progress: `Analysing document (0 / ${chunks.length} ${chunks.length === 1 ? "chunk" : "chunks"})…`,
      }));

      await Promise.all(
        chunks.map(async (chunk, idx) => {
          const userMessage = buildLibraryExtractUserMessage(chunk, idx, chunks.length);
          const { content } = await callNonStreaming(
            systemPrompt,
            [{ role: "user", content: userMessage }],
            signal,
            16384,
          );

          const stripped = content
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/i, "")
            .trim();

          let parsed: ExtractedBlock[] = [];
          try {
            const raw = JSON.parse(stripped) as unknown;
            if (Array.isArray(raw)) parsed = raw as ExtractedBlock[];
          } catch {
            // chunk produced no parseable blocks — skip
          }

          // Deduplicate by name (first occurrence wins)
          for (const block of parsed) {
            if (block.name && !allBlocks.has(block.name)) {
              allBlocks.set(block.name, {
                ...block,
                block_type: block.block_type === "FC" ? "FC" : "FB",
                inputs: block.inputs ?? [],
                outputs: block.outputs ?? [],
                in_out: block.in_out ?? [],
                tags: block.tags ?? [],
                selected: true,
              });
            }
          }

          completed++;
          setState((s) => ({
            ...s,
            progress: `Analysing document (${completed} / ${chunks.length} ${chunks.length === 1 ? "chunk" : "chunks"})…`,
          }));
        }),
      );

      const sorted = [...allBlocks.values()].sort((a, b) => a.name.localeCompare(b.name));
      setState({ extracting: false, progress: null, blocks: sorted, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, extracting: false, progress: null, error: msg }));
      throw err;
    }
  }

  return {
    ...state,
    extractFromText,
    toggleBlock,
    selectAll,
    reset,
  };
}
