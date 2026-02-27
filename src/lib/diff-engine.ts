/**
 * Line-level diff engine using the Myers diff algorithm (simplified LCS approach).
 * Computes hunks between two code strings for:
 *   - generated vs approved comparison
 *   - snapshot vs snapshot comparison
 *   - correction detection
 */

export type HunkType = "added" | "removed" | "unchanged";

export interface DiffHunk {
  type: HunkType;
  lines: string[];
  oldStart: number;
  newStart: number;
}

export interface DiffResult {
  hunks: DiffHunk[];
  hasChanges: boolean;
  addedCount: number;
  removedCount: number;
}

/**
 * Compute the longest common subsequence table between two line arrays.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

/**
 * Backtrack through LCS table to produce diff operations.
 */
function backtrack(
  dp: number[][],
  a: string[],
  b: string[]
): Array<{ type: HunkType; line: string; oldIdx: number; newIdx: number }> {
  const ops: Array<{ type: HunkType; line: string; oldIdx: number; newIdx: number }> = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: "unchanged", line: a[i - 1], oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "added", line: b[j - 1], oldIdx: i, newIdx: j - 1 });
      j--;
    } else {
      ops.push({ type: "removed", line: a[i - 1], oldIdx: i - 1, newIdx: j });
      i--;
    }
  }

  return ops.reverse();
}

/**
 * Group consecutive operations of the same type into hunks.
 */
function groupIntoHunks(
  ops: Array<{ type: HunkType; line: string; oldIdx: number; newIdx: number }>
): DiffHunk[] {
  if (ops.length === 0) return [];

  const hunks: DiffHunk[] = [];
  let currentType = ops[0].type;
  let currentLines: string[] = [ops[0].line];
  let oldStart = ops[0].oldIdx;
  let newStart = ops[0].newIdx;

  for (let i = 1; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === currentType) {
      currentLines.push(op.line);
    } else {
      hunks.push({ type: currentType, lines: currentLines, oldStart, newStart });
      currentType = op.type;
      currentLines = [op.line];
      oldStart = op.oldIdx;
      newStart = op.newIdx;
    }
  }

  hunks.push({ type: currentType, lines: currentLines, oldStart, newStart });
  return hunks;
}

/**
 * Normalize line endings: strip \r so TIA Portal exports (\r\n) and
 * generated code (\n) compare cleanly.
 */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r/g, "");
}

/**
 * Check if two code strings have functional (non-whitespace) differences.
 * Used by pattern-saving paths to skip formatting-only changes.
 */
export function hasFunctionalChanges(original: string, modified: string): boolean {
  const normA = normalizeLineEndings(original)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
  const normB = normalizeLineEndings(modified)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
  return normA !== normB;
}

/**
 * Compute a line-level diff between two code strings.
 */
export function computeDiff(original: string, modified: string): DiffResult {
  // Normalize line endings — TIA Portal exports \r\n, generated code uses \n
  const normOriginal = normalizeLineEndings(original);
  const normModified = normalizeLineEndings(modified);

  const oldLines = normOriginal.split("\n");
  const newLines = normModified.split("\n");

  if (normOriginal === normModified) {
    return {
      hunks: [{ type: "unchanged", lines: oldLines, oldStart: 0, newStart: 0 }],
      hasChanges: false,
      addedCount: 0,
      removedCount: 0,
    };
  }

  const dp = lcsTable(oldLines, newLines);
  const ops = backtrack(dp, oldLines, newLines);
  const hunks = groupIntoHunks(ops);

  let addedCount = 0;
  let removedCount = 0;
  for (const hunk of hunks) {
    if (hunk.type === "added") addedCount += hunk.lines.length;
    if (hunk.type === "removed") removedCount += hunk.lines.length;
  }

  return { hunks, hasChanges: true, addedCount, removedCount };
}

/**
 * Get only the changed lines (added + removed) for correction classification.
 */
export function getChangedContent(diff: DiffResult): {
  addedLines: string[];
  removedLines: string[];
} {
  const addedLines: string[] = [];
  const removedLines: string[] = [];

  for (const hunk of diff.hunks) {
    if (hunk.type === "added") addedLines.push(...hunk.lines);
    if (hunk.type === "removed") removedLines.push(...hunk.lines);
  }

  return { addedLines, removedLines };
}

/**
 * Check whether a line is "trivial" — comments, region markers, whitespace,
 * or separator bars that carry no functional meaning.
 */
function isTrivialLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  // Pure comment lines (including region headers and separator bars)
  if (/^\/\//.test(trimmed)) return true;
  // Opening/closing block-comment markers
  if (trimmed === "/*" || trimmed === "*/") return true;
  return false;
}

/**
 * Check whether a change region is trivial (all changed lines are comments,
 * whitespace, or region markers). These regions add noise to correction
 * snippets and should be filtered out when substantive regions exist.
 */
function isTrivialRegion(removedLines: string[], addedLines: string[]): boolean {
  const allChanged = [...removedLines, ...addedLines];
  if (allChanged.length === 0) return true;
  return allChanged.every(isTrivialLine);
}

/**
 * Extract focused before/after snippets from a diff with surrounding context.
 * Finds change regions (consecutive removed+added hunks at the same position)
 * and builds PAIRED snippets so original and corrected show the same code area.
 * Trivial regions (comments, whitespace, region markers) are filtered out when
 * substantive code changes exist, keeping snippets focused on the real fix.
 */
export function extractFocusedSnippets(
  diff: DiffResult,
  contextLines = 3,
  maxLines = 20
): { originalSnippet: string; correctedSnippet: string } {
  // Identify "change regions" — groups of consecutive non-unchanged hunks
  // A change region has removed lines (original) and/or added lines (corrected)
  // at the same position in the file, with shared context around them.
  interface ChangeRegion {
    removedLines: string[];
    addedLines: string[];
    contextBefore: string[];
    contextAfter: string[];
  }

  const regions: ChangeRegion[] = [];
  let i = 0;

  while (i < diff.hunks.length) {
    const hunk = diff.hunks[i];

    if (hunk.type === "unchanged") {
      i++;
      continue;
    }

    // Start of a change region — collect all consecutive non-unchanged hunks
    const removedLines: string[] = [];
    const addedLines: string[] = [];

    // Context before: last N lines of the preceding unchanged hunk
    const prevHunk = i > 0 ? diff.hunks[i - 1] : null;
    const contextBefore =
      prevHunk?.type === "unchanged"
        ? prevHunk.lines.slice(-contextLines)
        : [];

    // Collect all consecutive changed hunks as one region
    while (i < diff.hunks.length && diff.hunks[i].type !== "unchanged") {
      if (diff.hunks[i].type === "removed") {
        removedLines.push(...diff.hunks[i].lines);
      } else if (diff.hunks[i].type === "added") {
        addedLines.push(...diff.hunks[i].lines);
      }
      i++;
    }

    // Context after: first N lines of the following unchanged hunk
    const nextHunk = i < diff.hunks.length ? diff.hunks[i] : null;
    const contextAfter =
      nextHunk?.type === "unchanged"
        ? nextHunk.lines.slice(0, contextLines)
        : [];

    regions.push({ removedLines, addedLines, contextBefore, contextAfter });
  }

  if (regions.length === 0) {
    return { originalSnippet: "(no changes)", correctedSnippet: "(no changes)" };
  }

  // Filter out trivial regions (comments, whitespace, region markers) when
  // substantive code regions exist — keeps snippets focused on the real fix.
  const substantive = regions.filter(
    (r) => !isTrivialRegion(r.removedLines, r.addedLines)
  );
  const effectiveRegions = substantive.length > 0 ? substantive : regions;

  // Build paired snippets from regions until we hit maxLines
  const originalParts: string[] = [];
  const correctedParts: string[] = [];

  for (const region of effectiveRegions) {
    // Both snippets get the same context so they visually correspond
    const origRegion = [
      ...region.contextBefore,
      ...region.removedLines,
      ...region.contextAfter,
    ];
    const corrRegion = [
      ...region.contextBefore,
      ...region.addedLines,
      ...region.contextAfter,
    ];

    // Add separator between regions if we already have content
    if (originalParts.length > 0) {
      originalParts.push("  // ...");
      correctedParts.push("  // ...");
    }

    originalParts.push(...origRegion);
    correctedParts.push(...corrRegion);

    if (originalParts.length >= maxLines || correctedParts.length >= maxLines) break;
  }

  return {
    originalSnippet: originalParts.slice(0, maxLines).join("\n") || "(no removed lines)",
    correctedSnippet: correctedParts.slice(0, maxLines).join("\n") || "(no added lines)",
  };
}
