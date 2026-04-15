/**
 * Parser for the hidden "Appendix Z — Machine-Readable Data" tables.
 *
 * Two sub-tables are expected:
 *  1. Completion-criteria override table
 *     Columns: [Assembly ID, State ID, Step, Criterion JSON]
 *     The JSON blob must deserialise into a CompletionCriterion (see
 *     `spec-contract-v2.ts`). A single step may have multiple rows; they
 *     accumulate into the step's `completion_criteria` array, replacing the
 *     fallback expression criterion emitted by the state parser.
 *  2. Revision marker table
 *     Columns: [Revision ID, Revision Number, Status]
 *     Redundant cross-check of the top-of-document `pac-forge:revision:`
 *     sentinel. Inconsistency is a soft warning, not a failure.
 */
import type {
  CompletionCriterion,
  SequentialStateV2,
} from "@/types/spec-contract-v2";
import { CompletionCriterionSchema } from "@/types/spec-contract-v2";
import type { ParsedDocxTable } from "@/lib/spec-builder/docx-ingest";
import { DocxIngestError } from "@/lib/spec-builder/docx-ingest-hierarchy";

interface CriterionOverride {
  assemblyId: string;
  stateId: string;
  step: number;
  criterion: CompletionCriterion;
}

const CRITERIA_HEADERS = ["Assembly ID", "State ID", "Step", "Criterion JSON"] as const;
const REVISION_HEADERS = ["Revision ID", "Revision Number", "Status"] as const;

function headersMatch(headers: string[], target: readonly string[]): boolean {
  for (let i = 0; i < target.length; i++) {
    if (headers[i]?.trim() !== target[i]) return false;
  }
  return true;
}

export interface AppendixParseResult {
  criteriaOverrides: CriterionOverride[];
  revisionCrossCheck: { revisionId: string; revisionNumber: number; status: string } | null;
  warnings: string[];
}

export function parseAppendixTables(
  tables: ParsedDocxTable[],
): AppendixParseResult {
  const result: AppendixParseResult = {
    criteriaOverrides: [],
    revisionCrossCheck: null,
    warnings: [],
  };

  const appendixScope = tables.filter((t) =>
    /pac-forge:appendix-v2/i.test(t.caption),
  );

  for (const table of appendixScope) {
    if (headersMatch(table.headers, CRITERIA_HEADERS)) {
      for (let i = 0; i < table.rows.length; i++) {
        const row = table.rows[i];
        const assemblyId = (row[0] ?? "").trim();
        const stateId = (row[1] ?? "").trim();
        const stepRaw = (row[2] ?? "").trim();
        const json = (row[3] ?? "").trim();
        if (!assemblyId || !stateId || !stepRaw || !json) {
          throw new DocxIngestError(
            `Appendix criteria row ${i + 1}: missing field`,
          );
        }
        const step = Number(stepRaw);
        if (!Number.isFinite(step)) {
          throw new DocxIngestError(
            `Appendix criteria row ${i + 1}: step "${stepRaw}" is not a number`,
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch (e) {
          throw new DocxIngestError(
            `Appendix criteria row ${i + 1}: Criterion JSON is malformed`,
            [String(e)],
          );
        }
        const validated = CompletionCriterionSchema.safeParse(parsed);
        if (!validated.success) {
          throw new DocxIngestError(
            `Appendix criteria row ${i + 1}: JSON does not match CompletionCriterion schema`,
            validated.error.issues.map((z) => `${z.path.join(".")}: ${z.message}`),
          );
        }
        result.criteriaOverrides.push({
          assemblyId,
          stateId,
          step,
          criterion: validated.data,
        });
      }
    } else if (headersMatch(table.headers, REVISION_HEADERS)) {
      const row = table.rows[0];
      if (row) {
        const revisionId = (row[0] ?? "").trim();
        const revisionNumber = Number((row[1] ?? "").trim());
        const status = (row[2] ?? "").trim();
        if (revisionId && Number.isFinite(revisionNumber)) {
          result.revisionCrossCheck = { revisionId, revisionNumber, status };
        }
      }
    }
  }

  return result;
}

/**
 * Apply parsed criteria overrides onto the sequential-state map produced by
 * `parseStateTables`. Mutates the input map and returns it.
 */
export function applyCriteriaOverrides(
  sequentialByAssembly: Record<string, Record<string, SequentialStateV2>>,
  overrides: CriterionOverride[],
): Record<string, Record<string, SequentialStateV2>> {
  for (const ov of overrides) {
    const asy = sequentialByAssembly[ov.assemblyId];
    if (!asy) continue;
    const state = asy[ov.stateId];
    if (!state) continue;
    const step = state.steps.find((s) => s.step === ov.step);
    if (!step) continue;
    // Replace fallback expression criterion on first override, append otherwise.
    const onlyFallback =
      step.completion_criteria.length === 1 &&
      step.completion_criteria[0].kind === "expression";
    if (onlyFallback) {
      step.completion_criteria = [ov.criterion];
    } else {
      step.completion_criteria.push(ov.criterion);
    }
  }
  return sequentialByAssembly;
}
