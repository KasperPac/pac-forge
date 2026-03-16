import { useCallback, useState } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import type { ProcessLinkageMatrix, LinkageDevice } from "@/types/process-builder";

export interface MatrixValidationResult {
  issues: string[];
  suggestions: string[];
  verdict: "ok" | "warnings" | "errors";
  /** Number of T# fixes applied client-side */
  timerFixCount: number;
  /** Matrix with all deterministic fixes already applied (T# conversions etc.) */
  correctedMatrix: ProcessLinkageMatrix | null;
}

// ---------------------------------------------------------------------------
// Deterministic T# fix (no AI needed)
// ---------------------------------------------------------------------------

/** Parameter name patterns that indicate a TIME type value */
const TIMER_PARAM_PATTERNS = /time|timer|delay|timeout|duration|preset|pt\b/i;

/** Convert raw ms integer string → T# literal */
function msToTHash(ms: number): string {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `T#${ms / 3_600_000}h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `T#${ms / 60_000}m`;
  if (ms >= 1_000 && ms % 1_000 === 0) return `T#${ms / 1_000}s`;
  return `T#${ms}ms`;
}

/** Fix a single device's wiring — returns { fixed device, count of changes } */
function fixDeviceTimers(device: LinkageDevice): { device: LinkageDevice; count: number } {
  let count = 0;
  const wiring = device.wiring.map(w => {
    if (w.wireType !== "constant") return w;
    const val = w.connectedTo?.trim() ?? "";
    // Pure integer AND parameter looks like a timer preset
    if (/^\d+$/.test(val) && TIMER_PARAM_PATTERNS.test(w.paramName)) {
      count++;
      return { ...w, connectedTo: msToTHash(parseInt(val, 10)) };
    }
    return w;
  });
  return { device: { ...device, wiring }, count };
}

/** Apply all deterministic fixes to a matrix. Returns { matrix, totalFixes } */
export function applyDeterministicFixes(matrix: ProcessLinkageMatrix): { matrix: ProcessLinkageMatrix; count: number } {
  let total = 0;
  const deviceLinkage = matrix.deviceLinkage.map(d => {
    const { device, count } = fixDeviceTimers(d);
    total += count;
    return device;
  });
  return {
    matrix: { ...matrix, deviceLinkage, lastReviewedAt: new Date().toISOString() },
    count: total,
  };
}

// ---------------------------------------------------------------------------
// Validation prompt (text-only, no corrected matrix in response)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior Siemens TIA Portal automation project manager reviewing a Process Linkage Matrix.

Check for these issues (the T# timer format is already fixed automatically, skip it):
1. FB parameter names plausible for the device type
2. Interlocks reference real devices in the device list
3. Step transitions have specific, actionable conditions
4. Instance DB names follow Inst prefix convention
5. Device names consistent between deviceLinkage and processSequences
6. Missing permissives or safety conditions for hazardous sequences
7. Circular interlocks or impossible sequences

Keep response short. Respond with ONLY this format:

VERDICT: ok|warnings|errors

ISSUES:
- (list each issue, or "none")

SUGGESTIONS:
- (list each improvement, or "none")`;

export function useForgeMatrixValidate() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MatrixValidationResult | null>(null);

  const validate = useCallback(async (matrix: ProcessLinkageMatrix) => {
    setLoading(true);
    setResult(null);
    const ctrl = new AbortController();

    try {
      // Step 1: Apply deterministic fixes client-side (T# conversion)
      const { matrix: fixedMatrix, count: timerFixCount } = applyDeterministicFixes(matrix);

      // Step 2: Send a compact summary to Claude for structural validation
      const summary = matrix.deviceLinkage.map(d =>
        `${d.name} (${d.deviceType}): FB=${d.fbName}, DB=${d.instanceDbName}\n` +
        `  wiring: ${d.wiring.map(w => `${w.paramName}→${w.connectedTo}[${w.wireType}]`).join(", ")}\n` +
        `  interlocks: ${d.interlocks.map(i => `${i.direction} ${i.targetDeviceName}`).join(", ") || "none"}`
      ).join("\n\n");

      const seqSummary = matrix.processSequences.map(s =>
        `${s.name}: ${(s.rows ?? s.steps ?? []).length} rows/steps, permissives: ${s.permissives.map(p => p.description).join(", ") || "none"}`
      ).join("\n");

      const { content } = await callNonStreaming(
        SYSTEM_PROMPT,
        [{
          role: "user",
          content: `Devices (${matrix.deviceLinkage.length}):\n${summary}\n\nSequences (${matrix.processSequences.length}):\n${seqSummary}`,
        }],
        ctrl.signal,
        1024,
      );

      const verdictMatch = content.match(/VERDICT:\s*(ok|warnings|errors)/i);
      const issuesMatch = content.match(/ISSUES:\s*([\s\S]*?)(?=SUGGESTIONS:|$)/i);
      const suggestionsMatch = content.match(/SUGGESTIONS:\s*([\s\S]*?)$/i);

      const parseList = (text: string | undefined) =>
        (text ?? "").split("\n")
          .map(l => l.replace(/^[-•*]\s*/, "").trim())
          .filter(l => l && l.toLowerCase() !== "none" && l !== "(none)");

      const issues = parseList(issuesMatch?.[1]);
      const suggestions = parseList(suggestionsMatch?.[1]);
      const verdict = (verdictMatch?.[1] ?? "warnings") as MatrixValidationResult["verdict"];

      // If T# fixes were applied or Claude found no other issues, the matrix is the corrected one
      const hasFixes = timerFixCount > 0;
      const hasIssues = issues.length > 0;

      setResult({
        verdict: hasFixes && !hasIssues ? "warnings" : verdict,
        issues: hasFixes
          ? [`Fixed ${timerFixCount} timer value(s) to T# format`, ...issues]
          : issues,
        suggestions,
        timerFixCount,
        correctedMatrix: hasFixes ? fixedMatrix : null,
      });
    } catch (err) {
      setResult({
        verdict: "errors",
        issues: [err instanceof Error ? err.message : String(err)],
        suggestions: [],
        timerFixCount: 0,
        correctedMatrix: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => setResult(null), []);

  return { validate, loading, result, clear };
}
