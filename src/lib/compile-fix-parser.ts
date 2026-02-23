/**
 * Parse corrected SCL blocks from a Claude compile-fix response.
 *
 * Expected format:
 * ```scl filename="<ArtifactName>"
 * <corrected SCL>
 * ```
 */

export interface FixedSource {
  artifactName: string;
  content: string;
}

export interface CompileFixParseResult {
  fixes: FixedSource[];
  explanation: string;
}

const FIX_BLOCK_REGEX = /```scl\s+filename="([^"]+)"\s*\n([\s\S]*?)```/g;

export function parseCompileFixResponse(text: string): CompileFixParseResult {
  const fixes: FixedSource[] = [];
  let lastBlockEnd = 0;

  let match: RegExpExecArray | null;
  FIX_BLOCK_REGEX.lastIndex = 0;

  while ((match = FIX_BLOCK_REGEX.exec(text)) !== null) {
    fixes.push({
      artifactName: match[1],
      content: match[2].trimEnd(),
    });
    lastBlockEnd = match.index + match[0].length;
  }

  // Everything after the last code block is the explanation
  let explanation = "";
  if (lastBlockEnd > 0) {
    explanation = text.slice(lastBlockEnd).trim();
  } else if (fixes.length === 0) {
    // No code blocks — entire response is explanation
    explanation = text.trim();
  }

  return { fixes, explanation };
}
