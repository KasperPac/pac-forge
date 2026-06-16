import { useCallback, useState } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import type { ProcessLinkageMatrix, LinkageDevice } from "@/types/forge-matrix";
import { validateSequence, type CompilerDiagnostic } from "@/lib/forge-process-compiler";

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
  /** Deterministic compiler diagnostics per sequence (cycles, unreachable states, coil conflicts, etc.) */
  compilerDiagnostics: CompilerDiagnostic[];
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
3. Interlocks referencing control_modules not in the device list
4. Device names inconsistent between deviceLinkage and processSequences
5. Missing permissives or safety conditions for hazardous sequences
6. Variable name mismatches between processSequences and globalData field names

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
- DO NOT output any text outside the JSON object

Exceptions — do NOT flag these as issues:
- FB inputs wired to FALSE/TRUE constants for unused optional features (e.g. jamSensor=FALSE when no jam sensor exists) — this is valid, not an error
- Stop buttons (PB_STOP) are NOT start permissives — they are runtime stop commands handled by monitor steps, not preconditions
- Bidirectional device wiring (A commands B, B feeds back to A) is normal, NOT a circular dependency
- Interlocks referencing motor control_modules from pushbutton context (e.g. PB_STOP.longHold triggers M01 reset) — this is valid if the interlock description explains the relationship
- Same IO tag wired to multiple FB inputs (e.g. single run feedback to both forward and reverse signal inputs) — flag as "info" only, not warning or error`;

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
      // Step 0: Run deterministic compiler checks on each sequence (instant, no AI)
      const compilerDiagnostics: CompilerDiagnostic[] = [];
      for (const seq of matrix.processSequences) {
        const seqDiags = validateSequence(seq);
        for (const d of seqDiags) {
          compilerDiagnostics.push({
            ...d,
            title: `${seq.name}: ${d.title}`,
          });
        }
      }
      if (compilerDiagnostics.length > 0) {
        console.log(`[matrix-validate] Compiler diagnostics:`,
          compilerDiagnostics.map(d => `[${d.severity}] ${d.category}: ${d.title}`));
      }

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
          .filter(l => /^\d+[.)]/.test(l) || /^[-•*]/.test(l))
          .map(l => l.replace(/^\d+[.)]\s*/, "").replace(/^[-•*]\s*/, "").trim())
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

      // Upgrade verdict if compiler found errors
      const hasCompilerErrors = compilerDiagnostics.some(d => d.severity === "error");
      const hasCompilerWarnings = compilerDiagnostics.length > 0;
      let finalVerdict = verdict;
      if (hasCompilerErrors) finalVerdict = "errors";
      else if (hasCompilerWarnings && finalVerdict === "ok") finalVerdict = "warnings";
      if (timerFixCount > 0 && fixableIssues.length === 0 && !hasCompilerErrors) finalVerdict = "warnings";

      setResult({
        verdict: finalVerdict,
        fixableIssues,
        suggestions,
        timerFixCount,
        correctedMatrix: timerFixCount > 0 ? fixedMatrix : null,
        compilerDiagnostics,
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
        compilerDiagnostics: [],
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

      // Use 32768 tokens — full matrix JSON can easily exceed 8192 for non-trivial projects
      const { content } = await callNonStreaming(
        APPLY_SYSTEM_PROMPT,
        [{
          role: "user",
          content: `Apply these ${selectedIssues.length} fix(es) to the matrix:\n\n${issueList}\n\nMatrix JSON:\n${JSON.stringify(matrix, null, 2)}`,
        }],
        ctrl.signal,
        32768,
      );

      const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

      // Detect JSON truncation (response hit max_tokens before completing)
      try {
        JSON.parse(cleaned);
      } catch {
        throw new Error(
          `Validation fix response was truncated — the matrix is too large for a single fix call. ` +
          `Try selecting fewer issues to fix at once.`
        );
      }

      const corrected = JSON.parse(cleaned) as ProcessLinkageMatrix;
      return { ...corrected, lastReviewedAt: new Date().toISOString() };
    } finally {
      setApplying(false);
    }
  }, []);

  const fixDiagnostic = useCallback(async (
    matrix: ProcessLinkageMatrix,
    diagnostic: CompilerDiagnostic,
    userInstruction?: string,
  ): Promise<ProcessLinkageMatrix> => {
    setApplying(true);
    const ctrl = new AbortController();

    try {
      const instruction = userInstruction?.trim()
        ? `\n\nUser instruction: ${userInstruction.trim()}`
        : "";

      const { content } = await callNonStreaming(
        `You are a senior Siemens TIA Portal automation project manager.
You are given a Process Linkage Matrix JSON and a specific compiler diagnostic to fix.
The diagnostic was found by static analysis of the sequence logic.
Fix ONLY the specific issue described. Do not change anything else in the matrix.
Respond with ONLY the corrected matrix as valid JSON — no markdown fences, no explanation.`,
        [{
          role: "user",
          content: `Fix this compiler diagnostic in the matrix:

Category: ${diagnostic.category}
Severity: ${diagnostic.severity}
Title: ${diagnostic.title}
Description: ${diagnostic.description}
Affected steps: ${diagnostic.affectedSteps.join(", ")}${instruction}

Matrix JSON:
${JSON.stringify(matrix, null, 2)}`,
        }],
        ctrl.signal,
        32768,
      );

      const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
      try {
        JSON.parse(cleaned);
      } catch {
        throw new Error("Fix response was truncated — try again or fix manually.");
      }
      const corrected = JSON.parse(cleaned) as ProcessLinkageMatrix;
      return { ...corrected, lastReviewedAt: new Date().toISOString() };
    } finally {
      setApplying(false);
    }
  }, []);

  const clear = useCallback(() => setResult(null), []);

  return { validate, applySelectedFixes, fixDiagnostic, loading, applying, result, clear };
}
