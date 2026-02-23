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
 * Compute a line-level diff between two code strings.
 */
export function computeDiff(original: string, modified: string): DiffResult {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");

  if (original === modified) {
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
