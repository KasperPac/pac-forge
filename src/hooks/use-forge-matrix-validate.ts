import { useCallback, useState } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import type { ProcessLinkageMatrix, LinkageDevice } from "@/types/forge-matrix";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatrixIssue {
  id: string;
  severity: "error" | "warning";
  description: string;
  /** Which field/device is affected, e.g. "deviceLinkage[MotorFwd].instanceDbName" */
  field: string;
  /** Human-readable description of the fix */
  suggestedFix: string;
  /** Original value/snippet — for pattern library */
  wrongSnippet: string;
  /** Corrected value/snippet — for pattern library */
  correctSnippet: string;
}

export interface MatrixValidationResult {
  verdict: "ok" | "warnings" | "errors";
  fixableIssues: MatrixIssue[];
  suggestions: string[];
  /** Number of T# fixes applied client-side */
  timerFixCount: number;
  /** Matrix with deterministic T# fixes already applied */
  correctedMatrix: ProcessLinkageMatrix | null;
}

// ---------------------------------------------------------------------------
// Deterministic T# fix (no AI needed)
// ---------------------------------------------------------------------------

const TIMER_PARAM_PATTERNS = /time|timer|delay|timeout|duration|preset|pt\b/i;

function msToTHash(ms: number): string {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `T#${ms / 3_600_000}h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `T#${ms / 60_000}m`;
  if (ms >= 1_000 && ms % 1_000 === 0) return `T#${ms / 1_000}s`;
  return `T#${ms}ms`;
}

function fixDeviceTimers(device: LinkageDevice): { device: LinkageDevice; count: number } {
  let count = 0;
  const wiring = device.wiring.map(w => {
    if (w.wireType !== "constant") return w;
    const val = w.connectedTo?.trim() ?? "";
    if (/^\d+$/.test(val) && TIMER_PARAM_PATTERNS.test(w.paramName)) {
      count++;
      return { ...w, connectedTo: msToTHash(parseInt(val, 10)) };
    }
    return w;
  });
  return { device: { ...device, wiring }, count };
}

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
// Validation prompt — structured JSON response
// ---------------------------------------------------------------------------

const VALIDATE_SYSTEM_PROMPT = `You are a JSON API. You output only raw JSON. No prose, no explanation, no markdown.

Check the Process Linkage Matrix for:
1. Instance DB names not following Inst prefix convention
2. FB parameter names implausible for the device type
3. Interlocks referencing devices not in the device list
4. Device names inconsistent between deviceLinkage and processSequences
5. Missing permissives or safety conditions for hazardous sequences

Output this exact JSON structure and nothing else:
{"verdict":"ok","issues":[],"suggestions":[]}

Or with issues:
{"verdict":"warnings","issues":[{"id":"i1","severity":"warning","description":"InstESTop should be InstEStop","field":"deviceLinkage[EStop].instanceDbName","suggestedFix":"Rename instanceDbName to InstEStop","wrongSnippet":"InstESTop","correctSnippet":"InstEStop"}],"suggestions":[]}

Rules:
- verdict: "ok" if no issues, "warnings" if minor issues, "errors" if serious issues
- severity: "error" for serious problems, "warning" for minor ones
- field: use format deviceLinkage[DeviceName].fieldName or processSequences[SeqName].fieldName
- wrongSnippet: the exact current bad value (keep short, max 40 chars)
- correctSnippet: the exact corrected value (keep short, max 40 chars)
- description: max 15 words
- suggestedFix: max 10 words
- DO NOT output any text outside the JSON object`;

// ---------------------------------------------------------------------------
// Apply-fixes prompt — Claude rewrites the matrix
// ---------------------------------------------------------------------------

const APPLY_SYSTEM_PROMPT = `You are a senior Siemens TIA Portal automation project manager.
You are given a Process Linkage Matrix JSON and a list of specific issues to fix.
Apply ONLY the listed fixes. Do not change anything else.
Respond with ONLY the corrected matrix as valid JSON — no markdown fences, no explanation.`;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useForgeMatrixValidate() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
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
        VALIDATE_SYSTEM_PROMPT,
        [{
          role: "user",
          content: `Devices (${matrix.deviceLinkage.length}):\n${summary}\n\nSequences (${matrix.processSequences.length}):\n${seqSummary}`,
        }],
        ctrl.signal,
        4096,
      );

      // Parse JSON response — extract the first { ... } block regardless of fencing
      let parsed: { verdict: string; issues: MatrixIssue[]; suggestions: string[] };
      try {
        const startIdx = content.indexOf("{");
        const endIdx = content.lastIndexOf("}");
        if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) throw new Error("no json");
        parsed = JSON.parse(content.slice(startIdx, endIdx + 1));
      } catch {
        // Fallback: parse numbered/bulleted findings from prose into individual issues
        const findings = content
          .split(/\n/)
          .map(l => l.trim())
          .filter(l => /^\d+[\.\)]/.test(l) || /^[-•*]/.test(l))
          .map(l => l.replace(/^\d+[\.\)]\s*/, "").replace(/^[-•*]\s*/, "").trim())
          .filter(l => l.length > 10)
          .slice(0, 10);

        parsed = {
          verdict: "warnings",
          issues: findings.length > 0
            ? findings.map((f, i) => ({
                id: `prose_${i}`,
                severity: "warning" as const,
                description: f,
                field: "matrix",
                suggestedFix: "Review and correct manually",
                wrongSnippet: "",
                correctSnippet: "",
              }))
            : [{
                id: "parse_error",
                severity: "warning" as const,
                description: "Validator returned an unexpected response format. Review the matrix manually.",
                field: "matrix",
                suggestedFix: "Review manually",
                wrongSnippet: "",
                correctSnippet: "",
              }],
          suggestions: [],
        };
      }

      // Coerce any field to string — Claude sometimes returns nested objects
      const str = (v: unknown): string => {
        if (v == null) return "";
        if (typeof v === "string") return v;
        if (typeof v === "object") return JSON.stringify(v);
        return String(v);
      };

      const fixableIssues: MatrixIssue[] = (parsed.issues ?? []).map((issue, i) => ({
        id: str(issue.id) || `issue_${i}`,
        severity: (issue.severity === "error" ? "error" : "warning") as MatrixIssue["severity"],
        description: str(issue.description),
        field: str(issue.field),
        suggestedFix: str(issue.suggestedFix),
        wrongSnippet: str(issue.wrongSnippet),
        correctSnippet: str(issue.correctSnippet),
      }));

      const verdict = (parsed.verdict ?? "warnings") as MatrixValidationResult["verdict"];
      const suggestions = (parsed.suggestions ?? []).map(s => str(s)).filter(Boolean);

      setResult({
        verdict: timerFixCount > 0 && fixableIssues.length === 0 ? "warnings" : verdict,
        fixableIssues,
        suggestions,
        timerFixCount,
        correctedMatrix: timerFixCount > 0 ? fixedMatrix : null,
      });
    } catch (err) {
      setResult({
        verdict: "errors",
        fixableIssues: [{
          id: "exception",
          severity: "error",
          description: err instanceof Error ? err.message : String(err),
          field: "",
          suggestedFix: "",
          wrongSnippet: "",
          correctSnippet: "",
        }],
        suggestions: [],
        timerFixCount: 0,
        correctedMatrix: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Apply a subset of AI-identified issues to the matrix.
   * Sends the matrix + selected issues to Claude for a targeted rewrite.
   * Returns the corrected matrix.
   */
  const applySelectedFixes = useCallback(async (
    matrix: ProcessLinkageMatrix,
    selectedIssues: MatrixIssue[],
  ): Promise<ProcessLinkageMatrix> => {
    setApplying(true);
    const ctrl = new AbortController();

    try {
      const issueList = selectedIssues.map((iss, i) =>
        `${i + 1}. Field: ${iss.field}\n   Problem: ${iss.description}\n   Fix: ${iss.suggestedFix}\n   Change: "${iss.wrongSnippet}" → "${iss.correctSnippet}"`
      ).join("\n\n");

      const { content } = await callNonStreaming(
        APPLY_SYSTEM_PROMPT,
        [{
          role: "user",
          content: `Apply these ${selectedIssues.length} fix(es) to the matrix:\n\n${issueList}\n\nMatrix JSON:\n${JSON.stringify(matrix, null, 2)}`,
        }],
        ctrl.signal,
        8192,
      );

      const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
      const corrected = JSON.parse(cleaned) as ProcessLinkageMatrix;
      return { ...corrected, lastReviewedAt: new Date().toISOString() };
    } finally {
      setApplying(false);
    }
  }, []);

  const clear = useCallback(() => setResult(null), []);

  return { validate, applySelectedFixes, loading, applying, result, clear };
}
