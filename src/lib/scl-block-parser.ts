import type { FbBlockType } from "@/types/fb-template";

export interface ParsedSclBlock {
  blockName: string;
  blockType: FbBlockType;
  sclCode: string;
}

/**
 * Infer block type from the SCL declaration header.
 * Returns null if the header doesn't match a known pattern.
 */
export function inferBlockType(sclCode: string): FbBlockType | null {
  const trimmed = sclCode.trimStart();
  if (/^TYPE\b/im.test(trimmed)) return "UDT";
  if (/^FUNCTION_BLOCK\b/im.test(trimmed)) return "FB";
  if (/^FUNCTION\b/im.test(trimmed)) return "FC";
  if (/^DATA_BLOCK\b/im.test(trimmed)) return "DB";
  if (/^ORGANIZATION_BLOCK\b/im.test(trimmed)) return "OB";
  return null;
}

/**
 * Extract the block name from an SCL declaration line.
 * Handles both quoted ("BlockName") and unquoted identifiers.
 */
export function extractBlockName(sclCode: string): string | null {
  const trimmed = sclCode.trimStart();

  // Match: FUNCTION_BLOCK "Name" / FUNCTION "Name" : RetType / DATA_BLOCK "Name" / TYPE "Name" / ORGANIZATION_BLOCK "Name"
  const quotedMatch = trimmed.match(
    /^(?:FUNCTION_BLOCK|FUNCTION|DATA_BLOCK|TYPE|ORGANIZATION_BLOCK)\s+"([^"]+)"/im
  );
  if (quotedMatch) return quotedMatch[1];

  // Match unquoted: FUNCTION_BLOCK Name / etc.
  const unquotedMatch = trimmed.match(
    /^(?:FUNCTION_BLOCK|DATA_BLOCK|TYPE|ORGANIZATION_BLOCK)\s+(\w+)/im
  );
  if (unquotedMatch) return unquotedMatch[1];

  // FC with return type: FUNCTION "Name" : ReturnType / FUNCTION Name : ReturnType
  const fcMatch = trimmed.match(/^FUNCTION\s+"?([^"\s:]+)"?\s*:/im);
  if (fcMatch) return fcMatch[1];

  return null;
}

// Regex matching the start of any SCL block declaration
const BLOCK_START_RE =
  /^(?:FUNCTION_BLOCK|FUNCTION|DATA_BLOCK|TYPE|ORGANIZATION_BLOCK)\b/im;

// Regex matching the end of a block
const BLOCK_END_RE =
  /^(?:END_FUNCTION_BLOCK|END_FUNCTION|END_DATA_BLOCK|END_TYPE|END_ORGANIZATION_BLOCK)\b/im;

/**
 * Split a multi-block SCL source into individual blocks.
 * Handles cases where multiple blocks are concatenated in a single file.
 */
export function splitSclBlocks(sclSource: string): ParsedSclBlock[] {
  const lines = sclSource.split(/\r?\n/);
  const blocks: ParsedSclBlock[] = [];
  let currentLines: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    const isStart = BLOCK_START_RE.test(line.trimStart());
    const isEnd = BLOCK_END_RE.test(line.trimStart());

    if (isStart && !inBlock) {
      // Start of a new block
      currentLines = [line];
      inBlock = true;
    } else if (isStart && inBlock) {
      // Previous block didn't have explicit END — flush it
      const code = currentLines.join("\n");
      const blockType = inferBlockType(code);
      const blockName = extractBlockName(code);
      if (blockType && blockName) {
        blocks.push({ blockName, blockType, sclCode: code });
      }
      currentLines = [line];
    } else if (isEnd && inBlock) {
      currentLines.push(line);
      const code = currentLines.join("\n");
      const blockType = inferBlockType(code);
      const blockName = extractBlockName(code);
      if (blockType && blockName) {
        blocks.push({ blockName, blockType, sclCode: code });
      }
      currentLines = [];
      inBlock = false;
    } else if (inBlock) {
      currentLines.push(line);
    }
    // Lines outside blocks are ignored (comments, blank lines between blocks)
  }

  // Flush any unclosed block
  if (inBlock && currentLines.length > 0) {
    const code = currentLines.join("\n");
    const blockType = inferBlockType(code);
    const blockName = extractBlockName(code);
    if (blockType && blockName) {
      blocks.push({ blockName, blockType, sclCode: code });
    }
  }

  return blocks;
}

/**
 * Convert TIA Bridge export sources (filename → SCL) into parsed blocks.
 * Falls back to inferring type from code if the filename doesn't help.
 */
export function parseTiaExportSources(
  sources: Record<string, string>
): ParsedSclBlock[] {
  const blocks: ParsedSclBlock[] = [];
  for (const [filename, sclCode] of Object.entries(sources)) {
    // Try splitting — a single exported source might contain one block
    const parsed = splitSclBlocks(sclCode);
    if (parsed.length > 0) {
      blocks.push(...parsed);
    } else {
      // Fallback: treat the whole file as one block
      const blockType = inferBlockType(sclCode);
      const blockName = extractBlockName(sclCode) ?? filename.replace(/\.scl$/i, "");
      if (blockType) {
        blocks.push({ blockName, blockType, sclCode });
      }
    }
  }
  return blocks;
}
