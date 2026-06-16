import type { ForgeArtifact } from "@/types/forge";
import type { FaultMatrixEntry, ProcessSequence, SequenceRow } from "@/types/forge-matrix";
import type { LadNode, LadProgram, LadRung, LadSeriesChain, LadVariable } from "@/types/lad";
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import {
  compileSequentialStateV2,
  type CompileV2Context,
  type SequenceCompileResult,
} from "@/lib/forge-process-compiler-v2";

type ConditionKind = "no" | "nc";
type CompareOperator = "=" | "<>" | ">" | "<" | ">=" | "<=";

type ConditionAtom =
  | {
      mode: "contact";
      kind: ConditionKind;
      operand: string;
    }
  | {
      mode: "compare";
      operand: string;
      operator: CompareOperator;
      operand2: string;
    };

interface CompiledRow {
  key: string;
  step: number;
  branch: string | null;
  conditionRaw: string;
  conditionBranches: ConditionAtom[][];
  action: string;
  output: string | null;
  next: number | "FAULT" | "IDLE";
  type: SequenceRow["type"];
}

interface CompiledStep {
  step: number;
  rows: CompiledRow[];
  incoming: CompiledRow[];
  outgoingTargets: number[];
}

interface DeterministicPlan {
  blockName: string;
  sequenceName: string;
  dbName: string;
  stepArrayName: string;
  actionArrayName: string;
  orderedSteps: number[];
  steps: CompiledStep[];
  /** Steps that reference stepTimer.Q — need TON instances in the DB */
  timerSteps: Set<number>;
  /** Operand type map for resolving data types in CMP/MOVE elements */
  operandTypes?: OperandTypeMap;
}

/**
 * Map of fully-qualified operand paths (e.g. "DB_ProcessState.tempPv") to their
 * PLC data type (e.g. "Real", "Int", "Bool"). Built from DB artifact SCL declarations.
 */
export type OperandTypeMap = Map<string, string>;

export interface DeterministicCompilerInput {
  sequence: ProcessSequence;
  blockName: string;
  dbName: string;
  stepArrayName: string;
  actionArrayName: string;
  language: "SCL" | "LAD";
  /** Optional type map for resolving operand data types (CMP, MOVE, etc.) */
  operandTypes?: OperandTypeMap;
}

export interface DeterministicFaultCompilerInput {
  faults: FaultMatrixEntry[];
  language: "SCL" | "LAD";
  blockName?: string;
  dbName?: string;
  /** Optional type map for resolving operand data types */
  operandTypes?: OperandTypeMap;
}

/**
 * Build an OperandTypeMap from DB artifact SCL content.
 * Parses VAR declarations to extract field names and their data types.
 * Supports nested struct-like access (e.g. "DB_Config.threshold" → "Real").
 */
export function buildOperandTypeMap(artifacts: ForgeArtifact[]): OperandTypeMap {
  const typeMap: OperandTypeMap = new Map();
  const dbArtifacts = artifacts.filter(a => a.type === "DB" && a.content);

  for (const db of dbArtifacts) {
    const dbName = db.name;
    // Match field declarations: fieldName : DataType; or fieldName : DataType :=
    const fieldRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/gm;
    let match: RegExpExecArray | null;
    while ((match = fieldRe.exec(db.content)) !== null) {
      const fieldName = match[1];
      const fieldType = match[2] ?? match[3]; // quoted or unquoted type
      if (fieldType) {
        // Store both with and without quotes on DB name
        typeMap.set(`${dbName}.${fieldName}`, fieldType);
        typeMap.set(`"${dbName}".${fieldName}`, fieldType);
      }
    }
  }

  return typeMap;
}

/**
 * Resolve the data type for a CMP/MOVE operand.
 * Priority: type map lookup → literal inference → fallback to "Int".
 */
function resolveOperandType(operand: string, operand2: string | undefined, typeMap?: OperandTypeMap): string {
  // 1. Try type map lookup on either operand
  if (typeMap) {
    const t1 = typeMap.get(operand);
    if (t1) return normalizePlcType(t1);
    if (operand2) {
      const t2 = typeMap.get(operand2);
      if (t2) return normalizePlcType(t2);
    }
  }

  // 2. Infer from literal values
  if (operand2) {
    if (/^-?\d+\.\d+$/.test(operand2)) return "Real";
    if (/^T#/i.test(operand2)) return "Time";
    if (/^-?\d+$/.test(operand2)) return "Int";
  }

  // 3. Fallback
  return "Int";
}

/** Normalize PLC type names to what TIA Portal expects in LAD SrcType */
function normalizePlcType(t: string): string {
  const lower = t.toLowerCase();
  if (lower === "real" || lower === "lreal") return "Real";
  if (lower === "int" || lower === "sint" || lower === "usint" || lower === "uint") return "Int";
  if (lower === "dint" || lower === "udint") return "DInt";
  if (lower === "word") return "Word";
  if (lower === "dword") return "DWord";
  if (lower === "bool") return "Bool";
  if (lower === "time") return "Time";
  return t; // pass through as-is
}

const CONDITION_SPLIT_RE = /\s+(?:AND|&&)\s+/i;
const SIMPLE_TOKEN_RE = /^(?:"[^"]+"(?:\.[A-Za-z_][A-Za-z0-9_]*)*|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\[[0-9]+\])?$/;
const SIMPLE_LITERAL_RE = /^(?:-?\d+(?:\.\d+)?|TRUE|FALSE|T#[A-Za-z0-9_]+)$/i;

function sanitizeBlockName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9_\s]/g, "")  // strip all non-alphanumeric/underscore/space chars
    .replace(/\s+/g, "_")             // spaces to underscores
    .replace(/_+/g, "_")              // collapse multiple underscores
    .replace(/^_|_$/g, "");           // trim leading/trailing underscores
}

function buildDbOperand(dbName: string, arrayName: string, index: number): string {
  return `"${dbName}".${arrayName}[${index}]`;
}

function buildDbFieldOperand(dbName: string, fieldName: string): string {
  return `"${dbName}".${fieldName}`;
}

function stripOuterParens(token: string): string {
  let result = token.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function stripTrailingAnnotation(token: string): string {
  let result = token.trim();
  while (/\s+\([^()]*\)$/.test(result)) {
    result = result.replace(/\s+\([^()]*\)$/, "").trim();
  }
  return result;
}

function normalizeCompareOperator(operator: string): CompareOperator {
  if (operator === "==" || operator === "=") return "=";
  if (operator === "!=" || operator === "<>") return "<>";
  if (operator === ">" || operator === "<" || operator === ">=" || operator === "<=") return operator;
  throw new Error(`unsupported compare operator "${operator}"`);
}

function parseConditionTerm(token: string, rowLabel: string): ConditionAtom {
  let kind: ConditionKind = "no";
  let operand = token;

  if (/^NOT\s+/i.test(operand)) {
    kind = "nc";
    operand = operand.replace(/^NOT\s+/i, "").trim();
  }

  // Strip all parens (balanced or not): NOT (X = TRUE) → NOT X = TRUE
  operand = operand.replace(/[()]/g, "").trim();
  operand = stripTrailingAnnotation(operand);

  const eqMatch = operand.match(/^(.*?)(?:\s*=\s*(TRUE|FALSE))$/i);
  if (eqMatch) {
    operand = eqMatch[1].trim();
    if (eqMatch[2].toUpperCase() == "FALSE") {
      kind = kind === "nc" ? "no" : "nc";
    }
    // NOT X = TRUE → NC contact on X (already handled: kind is "nc", eqMatch strips "= TRUE")
    // NOT X = FALSE → NO contact on X (double negation resolved above)
    if (SIMPLE_TOKEN_RE.test(operand)) {
      return { mode: "contact", kind, operand };
    }
  }

  const compareMatch = operand.match(/^(.*?)\s*(==|=|!=|<>|>=|<=|>|<)\s*(.*?)$/);
  if (compareMatch) {
    const left = stripTrailingAnnotation(compareMatch[1].trim());
    const right = stripTrailingAnnotation(compareMatch[3].trim());
    if (!SIMPLE_TOKEN_RE.test(left)) {
      throw new Error(`${rowLabel}: unsupported comparison operand "${left}"`);
    }
    if (!SIMPLE_TOKEN_RE.test(right) && !SIMPLE_LITERAL_RE.test(right)) {
      throw new Error(`${rowLabel}: unsupported comparison operand "${right}"`);
    }
    if (kind === "nc") {
      // NOT (X = 5) → invert the operator
      const inverted = compareMatch[2] === "=" || compareMatch[2] === "==" ? "<>"
        : compareMatch[2] === "!=" || compareMatch[2] === "<>" ? "="
        : compareMatch[2] === ">" ? "<="
        : compareMatch[2] === "<" ? ">="
        : compareMatch[2] === ">=" ? "<"
        : ">";
      return {
        mode: "compare",
        operand: left,
        operator: normalizeCompareOperator(inverted),
        operand2: right,
      };
    }
    return {
      mode: "compare",
      operand: left,
      operator: normalizeCompareOperator(compareMatch[2]),
      operand2: right,
    };
  }

  if (!SIMPLE_TOKEN_RE.test(operand)) {
    throw new Error(`${rowLabel}: unsupported condition syntax "${token}"`);
  }

  return { mode: "contact", kind, operand };
}

function parseAndAtoms(raw: string, rowLabel: string): ConditionAtom[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${rowLabel}: missing condition`);
  }

  if (/\s+OR\s+|\|\|/i.test(trimmed)) {
    throw new Error(`${rowLabel}: OR conditions must be split into separate matrix rows`);
  }

  const atoms = trimmed
    .split(CONDITION_SPLIT_RE)
    .map(stripOuterParens)
    .map(stripTrailingAnnotation)
    .filter(Boolean)
    .map((token) => parseConditionTerm(token, rowLabel));

  if (atoms.length === 0) {
    throw new Error(`${rowLabel}: no usable condition atoms`);
  }

  return atoms;
}

function parseConditionBranches(raw: string, rowLabel: string): ConditionAtom[][] {
  const trimmed = stripTrailingAnnotation(raw.trim());
  const xorMatch = trimmed.match(/^(.*?)\s+XOR\s+(.*?)\s*(?:=\s*TRUE)?$/i);
  if (xorMatch) {
    const left = stripTrailingAnnotation(xorMatch[1].trim());
    const right = stripTrailingAnnotation(xorMatch[2].trim());
    return [
      [parseConditionTerm(left, rowLabel), parseConditionTerm(`NOT ${right}`, rowLabel)],
      [parseConditionTerm(right, rowLabel), parseConditionTerm(`NOT ${left}`, rowLabel)],
    ];
  }
  return [parseAndAtoms(trimmed, rowLabel)];
}

/**
 * Normalize AI-generated condition text before parsing.
 * Transforms pseudo-variables into real DB operands.
 */
function normalizeCondition(condition: string, dbName: string, stepArrayName: string, step: number): string {
  let result = condition;
  // stepNumber = N → "DB".S[N] = TRUE
  result = result.replace(/\bstepNumber\s*=\s*(\d+)/gi, (_m, n) =>
    `${buildDbOperand(dbName, stepArrayName, parseInt(n, 10))} = TRUE`,
  );
  // stepTimer.Q → "DB".instStepTimer_N.Q (TON instance in the step/action DB)
  result = result.replace(/\bstepTimer\.Q\b/gi,
    `"${dbName}".instStepTimer_${step}.Q`,
  );
  return result;
}

/** Check if a condition references a step timer (TON instance needed in the DB). */
function referencesStepTimer(condition: string): boolean {
  return /\bstepTimer\b/i.test(condition);
}

function compilePlan(input: DeterministicCompilerInput): DeterministicPlan {
  const rows = input.sequence.rows ?? [];
  if (rows.length === 0) {
    throw new Error(`Sequence "${input.sequence.name}" has no rows`);
  }

  // Track which steps need timer instances
  const timerSteps = new Set<number>();
  for (const row of rows) {
    if (referencesStepTimer(row.condition)) timerSteps.add(row.step);
  }

  // Normalize conditions before parsing (must pass step number for timer references)
  const normalizedRows = rows.map((row) => ({
    ...row,
    condition: normalizeCondition(row.condition, input.dbName, input.stepArrayName, row.step),
  }));

  const orderedSteps = [...new Set(normalizedRows.map((row) => row.step))].sort((a, b) => a - b);

  // fault_exit rows are skipped — permissives are compiled separately
  const compiledRows: CompiledRow[] = normalizedRows
    .filter((row) => row.type !== "fault_exit")
    .map((row, index) => ({
      key: `${row.step}_${row.branch ?? "main"}_${index}`,
      step: row.step,
      branch: row.branch,
      conditionRaw: row.condition,
      conditionBranches: parseConditionBranches(row.condition, `${input.sequence.name} step ${row.step}${row.branch ?? ""}`),
      action: row.action,
      output: row.output,
      next: row.next,
      type: row.type,
    }));

  // Resolve "FAULT" → actual fault step number (highest step with fault_exit rows pointing to it, or the max step)
  const faultStepNumbers = new Set(
    normalizedRows.filter(r => r.type === "fault_exit" && typeof r.next === "number").map(r => r.next as number),
  );
  // If fault_exit rows use "FAULT" string, find steps that are only reachable via fault paths
  // (typically the highest step number group that has no non-fault incoming transitions)
  const faultTargetStep = faultStepNumbers.size > 0
    ? Math.min(...faultStepNumbers)
    : orderedSteps.length > 0 ? orderedSteps[orderedSteps.length - 1] : -1;

  const steps = orderedSteps.map((step) => {
    const stepRows = compiledRows.filter((row) => row.step === step);
    const incoming = compiledRows.filter((row) => row.next === step);
    // Build outgoing targets from ALL rows including fault_exit (from normalizedRows, not compiledRows)
    const allRawRows = normalizedRows.filter((row) => row.step === step);
    const outgoingTargets = [...new Set(
      allRawRows
        .map((row) => {
          if (typeof row.next === "number") return row.next;
          // Resolve "FAULT" to the actual fault step number
          if (row.next === "FAULT" && faultTargetStep >= 0) return faultTargetStep;
          return null;
        })
        .filter((next): next is number => next !== null),
    )];

    return { step, rows: stepRows, incoming, outgoingTargets };
  });

  return {
    blockName: sanitizeBlockName(input.blockName),
    sequenceName: input.sequence.name,
    dbName: input.dbName,
    stepArrayName: input.stepArrayName,
    actionArrayName: input.actionArrayName,
    orderedSteps,
    steps,
    timerSteps,
    operandTypes: input.operandTypes,
  };
}

function buildContactNode(kind: ConditionKind, operand: string, id: string): LadNode {
  return {
    type: "element",
    element: {
      id,
      type: kind === "no" ? "NO_CONTACT" : "NC_CONTACT",
      operand,
      dataType: "Bool",
    },
  };
}

function buildCompareNode(atom: Extract<ConditionAtom, { mode: "compare" }>, id: string, typeMap?: OperandTypeMap): LadNode {
  return {
    type: "element",
    element: {
      id,
      type: "CMP",
      operand: atom.operand,
      operand2: atom.operand2,
      cmpOperator: atom.operator === "=" ? "==" : atom.operator === "<>" ? "!=" : atom.operator,
      dataType: resolveOperandType(atom.operand, atom.operand2, typeMap),
    },
  };
}

function buildSeriesFromAtoms(atoms: ConditionAtom[], prefix: string, typeMap?: OperandTypeMap): LadSeriesChain {
  return {
    type: "series",
    nodes: atoms.map((atom, index) =>
      atom.mode === "contact"
        ? buildContactNode(atom.kind, atom.operand, `${prefix}_${index}`)
        : buildCompareNode(atom, `${prefix}_${index}`, typeMap),
    ),
  };
}

function buildConditionNodes(branches: ConditionAtom[][], prefix: string, typeMap?: OperandTypeMap): LadNode[] {
  if (branches.length === 1) {
    return buildSeriesFromAtoms(branches[0], prefix, typeMap).nodes;
  }
  return [
    {
      type: "parallel",
      id: `par_${prefix}`,
      branches: branches.map((branch, index) => buildSeriesFromAtoms(branch, `${prefix}_b${index}`, typeMap)),
    },
  ];
}

function buildBootstrapRung(plan: DeterministicPlan): LadRung {
  const bootstrapContacts = plan.orderedSteps.map((step, index) =>
    buildContactNode("nc", buildDbOperand(plan.dbName, plan.stepArrayName, step), `bootstrap_${index}`),
  );

  return {
    id: "rung_bootstrap",
    title: "Bootstrap initial step",
    comment: `When no step is active, energize step ${plan.orderedSteps[0]}.`,
    logic: {
      type: "series",
      nodes: [
        ...bootstrapContacts,
        {
          type: "element",
          element: {
            id: "bootstrap_coil",
            type: "OUTPUT_COIL",
            operand: buildDbOperand(plan.dbName, plan.stepArrayName, plan.orderedSteps[0]),
            dataType: "Bool",
          },
        },
      ],
    },
  };
}

function buildStepLatchRung(plan: DeterministicPlan, step: CompiledStep): LadRung {
  const branches: LadSeriesChain[] = [];

  for (const incoming of step.incoming) {
    branches.push({
      type: "series",
      nodes: [
        buildContactNode("no", buildDbOperand(plan.dbName, plan.stepArrayName, incoming.step), `step_${step.step}_from_${incoming.key}_active`),
        ...buildConditionNodes(incoming.conditionBranches, `step_${step.step}_from_${incoming.key}`, plan.operandTypes),
      ],
    });
  }

  const sealNodes: LadNode[] = [
    buildContactNode("no", buildDbOperand(plan.dbName, plan.stepArrayName, step.step), `step_${step.step}_seal_self`),
    ...step.outgoingTargets.map((target, index) =>
      buildContactNode("nc", buildDbOperand(plan.dbName, plan.stepArrayName, target), `step_${step.step}_seal_block_${index}`),
    ),
  ];
  branches.push({ type: "series", nodes: sealNodes });

  return {
    id: `rung_step_${step.step}`,
    title: `Latch step ${step.step}`,
    comment: step.rows.map((row) => row.action).join(" | "),
    logic: {
      type: "series",
      nodes: [
        { type: "parallel", id: `par_step_${step.step}`, branches },
        {
          type: "element",
          element: {
            id: `coil_step_${step.step}`,
            type: "OUTPUT_COIL",
            operand: buildDbOperand(plan.dbName, plan.stepArrayName, step.step),
            dataType: "Bool",
          },
        },
      ],
    },
  };
}

/**
 * Parse a matrix row output field like "DB_ProcessCommands.cv01Run = TRUE" into
 * an operand and a coil type (SET for TRUE, RESET for FALSE, OUTPUT for non-bool).
 */
function parseOutputAssignment(output: string, typeMap?: OperandTypeMap): { operand: string; coilType: "SET_COIL" | "RESET_COIL" | "OUTPUT_COIL"; dataType: string; value?: string } | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(.+?)\s*=\s*(.+)$/);
  if (!match) return null;

  const operand = match[1].trim();
  const value = match[2].trim();

  // Boolean TRUE — OUTPUT_COIL (scan-dependent, fails safe when step inactive)
  // Never use SET_COIL for process outputs — latches are dangerous for motors/valves.
  if (/^TRUE$/i.test(value)) return { operand, coilType: "OUTPUT_COIL", dataType: "Bool" };
  // Boolean FALSE — skip. With OUTPUT_COIL pattern, outputs are only ON when
  // explicitly driven by an active step. No need to explicitly drive FALSE.
  if (/^FALSE$/i.test(value)) return null;
  // Bool DB field reference (e.g. "DB_FaultData.anyFaultLatched") — treat as Bool copy,
  // not MOVE. The value is a signal reference, not a literal.
  const resolvedType = resolveOperandType(operand, value, typeMap);
  if (resolvedType === "Bool" && /^[A-Za-z_"']/.test(value) && !value.includes("(")) {
    return { operand, coilType: "OUTPUT_COIL", dataType: "Bool", value };
  }
  // Non-boolean assignment — MOVE box, resolve data type from operand
  return { operand, coilType: "OUTPUT_COIL", dataType: resolveOperandType(operand, value, typeMap), value };
}

/**
 * Build consolidated output rungs for the entire plan.
 * Boolean outputs: ONE rung per unique output signal, ORing all steps that set it TRUE.
 *   This uses OUTPUT_COIL (scan-dependent, fails safe) — never SET/RESET.
 * Non-boolean outputs (MOVE): one rung per step assignment (can't consolidate different values).
 */
function buildAllOutputRungs(plan: DeterministicPlan): LadRung[] {
  // Collect all output assignments across all steps
  const boolOutputs = new Map<string, number[]>(); // operand → [step numbers that set it TRUE]
  const moveOutputs: Array<{ step: number; key: string; operand: string; value: string; action: string }> = [];

  for (const step of plan.steps) {
    for (const row of step.rows) {
      if (!row.output) continue;
      const parsed = parseOutputAssignment(row.output, plan.operandTypes);
      if (!parsed) continue; // includes FALSE assignments (null return)

      if (!parsed.value) {
        // Boolean TRUE — collect for consolidation
        if (!boolOutputs.has(parsed.operand)) boolOutputs.set(parsed.operand, []);
        boolOutputs.get(parsed.operand)!.push(step.step);
      } else {
        // Non-boolean MOVE
        moveOutputs.push({ step: step.step, key: row.key, operand: parsed.operand, value: parsed.value, action: row.action });
      }
    }
  }

  const rungs: LadRung[] = [];

  // Boolean output rungs — one rung per output, OR of all action bits
  // Output rungs use A[n] contacts (not S[n]) — the action bit is the interface
  // between step logic and output driving.
  for (const [operand, steps] of boolOutputs) {
    const shortName = operand.split(".").pop() ?? operand;

    if (steps.length === 1) {
      rungs.push({
        id: `rung_out_${shortName}`,
        title: `${shortName}`,
        comment: `Active during action ${steps[0]}`,
        logic: {
          type: "series",
          nodes: [
            buildContactNode("no", buildDbOperand(plan.dbName, plan.actionArrayName, steps[0]), `out_${shortName}_a${steps[0]}`),
            {
              type: "element",
              element: {
                id: `coil_out_${shortName}`,
                type: "OUTPUT_COIL",
                operand,
                dataType: "Bool",
              },
            },
          ],
        },
      });
    } else {
      const branches: LadSeriesChain[] = steps.map((s) => ({
        type: "series" as const,
        nodes: [buildContactNode("no", buildDbOperand(plan.dbName, plan.actionArrayName, s), `out_${shortName}_a${s}`)],
      }));

      rungs.push({
        id: `rung_out_${shortName}`,
        title: `${shortName}`,
        comment: `Active during actions ${steps.join(", ")}`,
        logic: {
          type: "series",
          nodes: [
            { type: "parallel", id: `par_out_${shortName}`, branches },
            {
              type: "element",
              element: {
                id: `coil_out_${shortName}`,
                type: "OUTPUT_COIL",
                operand,
                dataType: "Bool",
              },
            },
          ],
        },
      });
    }
  }

  // MOVE / Bool-copy rungs — driven by action bits, not step bits
  for (const mv of moveOutputs) {
    const shortName = mv.operand.split(".").pop() ?? mv.operand;
    const resolvedType = resolveOperandType(mv.operand, mv.value, plan.operandTypes);

    if (resolvedType === "Bool") {
      // Bool-to-Bool copy: action bit AND source signal → output coil
      // MOVE cannot handle Bool in TIA Portal LAD
      rungs.push({
        id: `rung_boolcopy_${shortName}_a${mv.step}`,
        title: `${shortName} = ${mv.value}`,
        comment: mv.action,
        logic: {
          type: "series",
          nodes: [
            buildContactNode("no", buildDbOperand(plan.dbName, plan.actionArrayName, mv.step), `boolcopy_${shortName}_a${mv.step}_active`),
            buildContactNode("no", mv.value, `boolcopy_${shortName}_a${mv.step}_src`),
            {
              type: "element",
              element: {
                id: `coil_boolcopy_${shortName}_a${mv.step}`,
                type: "OUTPUT_COIL",
                operand: mv.operand,
                dataType: "Bool",
              },
            },
          ],
        },
      });
    } else {
      // Non-Bool: use MOVE box
      rungs.push({
        id: `rung_move_${shortName}_a${mv.step}`,
        title: `${shortName} = ${mv.value}`,
        comment: mv.action,
        logic: {
          type: "series",
          nodes: [
            buildContactNode("no", buildDbOperand(plan.dbName, plan.actionArrayName, mv.step), `move_${shortName}_a${mv.step}_active`),
            {
              type: "element",
              element: {
                id: `move_${shortName}_a${mv.step}`,
                type: "MOVE",
                operand: mv.value,
                outputOperand: mv.operand,
                dataType: resolvedType,
              },
            },
          ],
        },
      });
    }
  }

  return rungs;
}

function buildActionRung(plan: DeterministicPlan, step: CompiledStep): LadRung {
  return {
    id: `rung_action_${step.step}`,
    title: `Action ${step.step}`,
    comment: step.rows.map((row) => row.action).join(" | "),
    logic: {
      type: "series",
      nodes: [
        buildContactNode("no", buildDbOperand(plan.dbName, plan.stepArrayName, step.step), `action_${step.step}_step_active`),
        {
          type: "element",
          element: {
            id: `coil_action_${step.step}`,
            type: "OUTPUT_COIL",
            operand: buildDbOperand(plan.dbName, plan.actionArrayName, step.step),
            dataType: "Bool",
          },
        },
      ],
    },
  };
}

function buildDeterministicLadProgram(plan: DeterministicPlan): LadProgram {
  const variables: LadVariable[] = [];
  const entryStep = plan.orderedSteps[0];
  const rungs: LadRung[] = [buildBootstrapRung(plan)];

  // Section 1: All step latch rungs (skip entry step — bootstrap handles it)
  for (const step of plan.steps) {
    if (step.step === entryStep) continue;
    rungs.push(buildStepLatchRung(plan, step));
  }

  // Section 1b: Timer call rungs — S[n] drives TON instance for steps that need timeouts
  for (const stepNum of plan.timerSteps) {
    const timerInstance = `"${plan.dbName}".instStepTimer_${stepNum}`;
    rungs.push({
      id: `rung_timer_${stepNum}`,
      title: `Step ${stepNum} timeout timer`,
      comment: `TON timer — starts when step ${stepNum} is active, Q goes TRUE after PT elapsed`,
      logic: {
        type: "series",
        nodes: [
          buildContactNode("no", buildDbOperand(plan.dbName, plan.stepArrayName, stepNum), `timer_${stepNum}_in`),
          {
            type: "element",
            element: {
              id: `ton_${stepNum}`,
              type: "TON",
              operand: timerInstance,
              dataType: "Time",
              presetTime: "T#5s",
              instanceDb: `${plan.dbName}`,
            },
          },
        ],
      },
    });
  }

  // Section 2: Action bit rungs — S[n] → A[n] for each step
  for (const step of plan.steps) {
    rungs.push(buildActionRung(plan, step));
  }

  // Section 3: Consolidated output rungs — one rung per output signal
  rungs.push(...buildAllOutputRungs(plan));

  return {
    id: `det_${plan.blockName}`,
    name: plan.blockName,
    blockType: "FC",
    variables,
    rungs,
  };
}

function renderConditionForSclBranch(atoms: ConditionAtom[]): string {
  return atoms
    .map((atom) => {
      if (atom.mode === "contact") {
        return atom.kind === "no" ? atom.operand : `NOT ${atom.operand}`;
      }
      return `${atom.operand} ${atom.operator} ${atom.operand2}`;
    })
    .join(" AND ");
}

function renderConditionForScl(branches: ConditionAtom[][]): string {
  if (branches.length === 1) {
    return renderConditionForSclBranch(branches[0]);
  }
  return branches.map((branch) => `(${renderConditionForSclBranch(branch)})`).join(" OR ");
}

function renderSclStep(plan: DeterministicPlan, step: CompiledStep): string[] {
  const lines: string[] = [];
  const stepOperand = buildDbOperand(plan.dbName, plan.stepArrayName, step.step);

  lines.push(`IF ${stepOperand} THEN`);

  if (step.rows.length > 0) {
    step.rows.forEach((row, index) => {
      const prefix = index === 0 ? "IF" : "ELSIF";
      lines.push(`    ${prefix} ${renderConditionForScl(row.conditionBranches)} THEN`);
      lines.push(`        ${stepOperand} := FALSE;`);
      if (typeof row.next === "number") {
        lines.push(`        ${buildDbOperand(plan.dbName, plan.stepArrayName, row.next)} := TRUE;`);
      }
      if (row.next === "FAULT") {
        lines.push(`        // TODO: route to deterministic fault handling when the fault compiler is in place.`);
      }
    });
    lines.push(`    END_IF;`);
  }

  lines.push(`END_IF;`);
  return lines;
}

function renderSclOutputs(plan: DeterministicPlan, step: CompiledStep): string[] {
  const lines: string[] = [];
  // Output assignments use action bits (A[n]), not step bits (S[n])
  const actionOperand = buildDbOperand(plan.dbName, plan.actionArrayName, step.step);

  const outputRows = step.rows.filter((r) => r.output);
  if (outputRows.length === 0) return lines;

  lines.push(`IF ${actionOperand} THEN`);
  for (const row of outputRows) {
    const parsed = parseOutputAssignment(row.output!);
    if (!parsed) continue;
    if (parsed.value) {
      // Non-boolean: direct assignment
      lines.push(`    ${parsed.operand} := ${parsed.value}; // ${row.action}`);
    } else if (parsed.coilType === "SET_COIL") {
      lines.push(`    ${parsed.operand} := TRUE; // ${row.action}`);
    } else {
      lines.push(`    ${parsed.operand} := FALSE; // ${row.action}`);
    }
  }
  lines.push(`END_IF;`);
  return lines;
}

function buildDeterministicScl(plan: DeterministicPlan): string {
  const entryStep = plan.orderedSteps[0];
  const lines: string[] = [
    `FUNCTION "${plan.blockName}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `    // Bootstrap the sequence when all steps are off.`,
    `    IF ${plan.orderedSteps.map((step) => `NOT ${buildDbOperand(plan.dbName, plan.stepArrayName, step)}`).join(" AND ")} THEN`,
    `        ${buildDbOperand(plan.dbName, plan.stepArrayName, entryStep)} := TRUE;`,
    `    END_IF;`,
    ``,
    `    // --- Step transitions ---`,
  ];

  // Section 1: Timer calls for steps that need timeouts
  if (plan.timerSteps.size > 0) {
    lines.push(`    // --- Step timers ---`);
    for (const stepNum of plan.timerSteps) {
      const stepOp = buildDbOperand(plan.dbName, plan.stepArrayName, stepNum);
      lines.push(`    "${plan.dbName}".instStepTimer_${stepNum}(IN := ${stepOp}, PT := T#5s);`);
    }
    lines.push("");
  }

  // Section 2: All step transition logic (skip entry step — bootstrap handles it)
  for (const step of plan.steps) {
    if (step.step === entryStep) continue;
    lines.push(`    // Step ${step.step}: ${step.rows.map((row) => row.action).join(" | ")}`);
    lines.push(...renderSclStep(plan, step).map((line) => `    ${line}`.replace(/^ {8}/, "    ")));
    lines.push("");
  }

  // Section 3: Action bits — mirror step bits to action array
  lines.push(`    // --- Action bits ---`);
  for (const step of plan.steps) {
    const stepOp = buildDbOperand(plan.dbName, plan.stepArrayName, step.step);
    const actionOp = buildDbOperand(plan.dbName, plan.actionArrayName, step.step);
    lines.push(`    ${actionOp} := ${stepOp};`);
  }
  lines.push("");

  // Section 3: All output assignments
  const hasOutputs = plan.steps.some((s) => s.rows.some((r) => r.output));
  if (hasOutputs) {
    lines.push(`    // --- Process outputs ---`);
    for (const step of plan.steps) {
      const outputLines = renderSclOutputs(plan, step);
      if (outputLines.length > 0) {
        lines.push(...outputLines.map((line) => `    ${line}`.replace(/^ {8}/, "    ")));
        lines.push("");
      }
    }
  }

  lines.push(`END_FUNCTION`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic validation pass — runs on the plan BEFORE code generation
// ---------------------------------------------------------------------------

export interface CompilerDiagnostic {
  severity: "error" | "warning";
  category: string;
  title: string;
  description: string;
  affectedSteps: number[];
}

export interface DeterministicCompilerResult {
  artifact: ForgeArtifact;
  diagnostics: CompilerDiagnostic[];
}

function collectOutputOperands(step: CompiledStep, typeMap?: OperandTypeMap): string[] {
  const operands: string[] = [];
  for (const row of step.rows) {
    if (!row.output) continue;
    const parsed = parseOutputAssignment(row.output, typeMap);
    if (parsed) operands.push(parsed.operand.toLowerCase());
  }
  return operands;
}

function collectConditionOperands(step: CompiledStep): string[] {
  const operands: string[] = [];
  for (const row of step.rows) {
    for (const branch of row.conditionBranches) {
      for (const atom of branch) {
        if (atom.mode === "contact") operands.push(atom.operand.toLowerCase());
        if (atom.mode === "compare") {
          operands.push(atom.operand.toLowerCase());
          operands.push(atom.operand2.toLowerCase());
        }
      }
    }
  }
  return operands;
}

function checkSelfDefeatingTransitions(plan: DeterministicPlan): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const stepMap = new Map(plan.steps.map((s) => [s.step, s]));

  for (const step of plan.steps) {
    const outputs = collectOutputOperands(step, plan.operandTypes);
    if (outputs.length === 0) continue;

    for (const target of step.outgoingTargets) {
      const targetStep = stepMap.get(target);
      if (!targetStep) continue;
      const conditions = collectConditionOperands(targetStep);
      const overlap = outputs.filter((o) => conditions.includes(o));
      if (overlap.length > 0) {
        diagnostics.push({
          severity: "warning",
          category: "self_defeating_transition",
          title: `Step ${step.step} output immediately satisfies step ${target} condition`,
          description: `Step ${step.step} writes ${overlap.join(", ")} which appears in step ${target}'s transition condition. Step ${step.step} may only be active for one scan cycle.`,
          affectedSteps: [step.step, target],
        });
      }
    }
  }
  return diagnostics;
}

function checkCircularDependencies(plan: DeterministicPlan): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const firstStep = plan.orderedSteps[0];
  const adjacency = new Map<number, number[]>();
  for (const step of plan.steps) {
    // Filter out transitions back to the first step (normal sequence reset)
    // and self-loops on the first step (idle/wait state) — these are not deadlocks.
    const targets = step.outgoingTargets.filter((t) =>
      !(t === firstStep && step.step !== firstStep) && // back-to-start is normal reset
      !(t === step.step && step.step === firstStep),   // self-loop on idle step is normal
    );
    adjacency.set(step.step, targets);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<number, number>();
  const parent = new Map<number, number>();
  for (const s of plan.orderedSteps) color.set(s, WHITE);

  function dfs(u: number): number[] | null {
    color.set(u, GRAY);
    for (const v of adjacency.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        const cycle: number[] = [v, u];
        let cur = u;
        while (cur !== v && parent.has(cur)) {
          cur = parent.get(cur)!;
          cycle.push(cur);
        }
        return cycle;
      }
      if (color.get(v) === WHITE) {
        parent.set(v, u);
        const result = dfs(v);
        if (result) return result;
      }
    }
    color.set(u, BLACK);
    return null;
  }

  for (const s of plan.orderedSteps) {
    if (color.get(s) === WHITE) {
      const cycle = dfs(s);
      if (cycle) {
        const cycleSteps = [...new Set(cycle)];
        if (cycleSteps.length <= 1) continue; // single-step self-loop — not interesting
        const hasExit = cycleSteps.some((cs) => {
          const step = plan.steps.find((st) => st.step === cs);
          return step?.rows.some((r) => r.next === "IDLE" || r.next === "FAULT" || r.next === firstStep);
        });
        diagnostics.push({
          severity: hasExit ? "warning" : "error",
          category: "circular_dependency",
          title: hasExit
            ? `Cycle detected (steps ${cycleSteps.join(" → ")}) with exit path`
            : `Deadlock: steps ${cycleSteps.join(" → ")} form a cycle with no exit`,
          description: hasExit
            ? `Steps ${cycleSteps.join(", ")} form a loop but have an exit — likely an intentional retry.`
            : `Steps ${cycleSteps.join(", ")} form a closed loop with no way to return to idle, FAULT, or step ${firstStep}.`,
          affectedSteps: cycleSteps,
        });
        break;
      }
    }
  }
  return diagnostics;
}

function checkUnstableOutputs(plan: DeterministicPlan): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const outputMap = new Map<string, Array<{ step: number; coilType: string; value?: string }>>();

  for (const step of plan.steps) {
    for (const row of step.rows) {
      if (!row.output) continue;
      const parsed = parseOutputAssignment(row.output, plan.operandTypes);
      if (!parsed) continue;
      const key = parsed.operand.toLowerCase();
      const list = outputMap.get(key) ?? [];
      list.push({ step: step.step, coilType: parsed.coilType, value: parsed.value });
      outputMap.set(key, list);
    }
  }

  for (const [operand, writers] of outputMap) {
    if (writers.length <= 1) continue;
    const coilTypes = new Set(writers.map((w) => w.coilType));
    const values = new Set(writers.map((w) => w.value ?? "TRUE"));
    if (coilTypes.size > 1 || values.size > 1) {
      diagnostics.push({
        severity: "warning",
        category: "unstable_output",
        title: `Output ${operand} written by ${writers.length} steps with different values`,
        description: `Steps ${writers.map((w) => w.step).join(", ")} all write to ${operand}. Values: ${[...values].join(", ")}. Last-write-wins may cause unexpected behaviour.`,
        affectedSteps: writers.map((w) => w.step),
      });
    }
  }
  return diagnostics;
}

function checkUnreachableSteps(plan: DeterministicPlan): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  if (plan.orderedSteps.length === 0) return diagnostics;

  const visited = new Set<number>();
  const queue = [plan.orderedSteps[0]];
  visited.add(plan.orderedSteps[0]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const step = plan.steps.find((s) => s.step === current);
    if (!step) continue;
    console.log(`[reachability] Step ${current} → targets: [${step.outgoingTargets.join(", ")}]`);
    for (const target of step.outgoingTargets) {
      if (!visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }
  }

  console.log(`[reachability] Visited steps: [${[...visited].sort((a,b) => a-b).join(", ")}]`);
  console.log(`[reachability] All steps: [${plan.orderedSteps.join(", ")}]`);

  for (const s of plan.orderedSteps) {
    if (!visited.has(s)) {
      console.log(`[reachability] Step ${s} is UNREACHABLE`);
      diagnostics.push({
        severity: "error",
        category: "unreachable_state",
        title: `Step ${s} is unreachable`,
        description: `No transition path leads to step ${s} from the initial step (${plan.orderedSteps[0]}). This step will never execute.`,
        affectedSteps: [s],
      });
    }
  }
  return diagnostics;
}

function checkTypeMismatches(plan: DeterministicPlan): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  if (!plan.operandTypes || plan.operandTypes.size === 0) return diagnostics;

  for (const step of plan.steps) {
    for (const row of step.rows) {
      for (const branch of row.conditionBranches) {
        for (const atom of branch) {
          if (atom.mode !== "compare") continue;
          const type1 = resolveOperandType(atom.operand, undefined, plan.operandTypes);
          const type2 = resolveOperandType(atom.operand2, undefined, plan.operandTypes);
          const norm1 = normalizePlcType(type1);
          const norm2 = normalizePlcType(type2);
          if (norm1 !== norm2 && norm1 !== "Int" && norm2 !== "Int") {
            diagnostics.push({
              severity: "warning",
              category: "type_mismatch",
              title: `Type mismatch in step ${step.step} comparison: ${norm1} vs ${norm2}`,
              description: `Condition compares ${atom.operand} (${norm1}) with ${atom.operand2} (${norm2}). Silent truncation or wrong values at runtime.`,
              affectedSteps: [step.step],
            });
          }
        }
      }
    }
  }
  return diagnostics;
}

function checkCoilConflicts(plan: DeterministicPlan): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const outputMap = new Map<string, Array<{ step: number; value?: string; dataType: string }>>();

  for (const step of plan.steps) {
    for (const row of step.rows) {
      if (!row.output) continue;
      const parsed = parseOutputAssignment(row.output, plan.operandTypes);
      if (!parsed) continue;
      const key = parsed.operand.toLowerCase();
      const list = outputMap.get(key) ?? [];
      list.push({ step: step.step, value: parsed.value, dataType: parsed.dataType });
      outputMap.set(key, list);
    }
  }

  for (const [operand, writers] of outputMap) {
    if (writers.length <= 1) continue;
    const uniqueSteps = [...new Set(writers.map((w) => w.step))];
    if (uniqueSteps.length <= 1) continue;

    // Bool outputs with the same value (TRUE) from multiple steps are
    // consolidated into a single OR rung by the compiler — not a conflict.
    const allBoolTrue = writers.every((w) => w.dataType === "Bool" && !w.value);
    if (allBoolTrue) continue;

    // Non-bool MOVE outputs with different values from different steps — real conflict
    const values = [...new Set(writers.map((w) => w.value ?? "TRUE"))];
    if (values.length > 1) {
      diagnostics.push({
        severity: "warning",
        category: "coil_conflict",
        title: `Multiple steps drive ${operand} with different values`,
        description: `Steps ${uniqueSteps.join(", ")} write different values to ${operand}: ${values.join(", ")}. Last-write-wins — verify this is intentional.`,
        affectedSteps: uniqueSteps,
      });
    }
  }
  return diagnostics;
}

function checkMissingInitialState(plan: DeterministicPlan): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  if (plan.orderedSteps.length === 0) {
    diagnostics.push({
      severity: "error",
      category: "missing_initial_state",
      title: "Sequence has no steps",
      description: "The sequence plan contains zero steps. Nothing will execute.",
      affectedSteps: [],
    });
    return diagnostics;
  }

  const firstStep = plan.steps.find((s) => s.step === plan.orderedSteps[0]);
  if (!firstStep || firstStep.rows.length === 0) {
    diagnostics.push({
      severity: "error",
      category: "missing_initial_state",
      title: `Initial step ${plan.orderedSteps[0]} has no rows`,
      description: `Step ${plan.orderedSteps[0]} is the entry point but contains no transitions. The sequence will be stuck at the initial step.`,
      affectedSteps: [plan.orderedSteps[0]],
    });
  }
  return diagnostics;
}

function checkSequenceResetPath(plan: DeterministicPlan): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const firstStep = plan.orderedSteps[0];
  const resetSteps: number[] = [];

  for (const step of plan.steps) {
    // A step has a reset path if it transitions to IDLE or back to the first step
    const hasReset = step.rows.some((r) =>
      r.next === "IDLE" || (typeof r.next === "number" && r.next === firstStep && step.step !== firstStep),
    );
    if (hasReset) resetSteps.push(step.step);
  }

  if (resetSteps.length === 0) {
    diagnostics.push({
      severity: "error",
      category: "sequence_reset",
      title: "No reset path exists",
      description: `No step transitions to IDLE or back to step ${firstStep}. The sequence will run once and be stuck at the final step.`,
      affectedSteps: plan.orderedSteps,
    });
  } else {
    const lastStep = plan.orderedSteps[plan.orderedSteps.length - 1];
    const onlyFromLast = resetSteps.length === 1 && resetSteps[0] === lastStep;
    if (onlyFromLast && plan.orderedSteps.length > 2) {
      diagnostics.push({
        severity: "warning",
        category: "sequence_reset",
        title: "Reset only from final step",
        description: `Only step ${lastStep} can return to idle/step ${firstStep}. No mid-sequence abort path exists.`,
        affectedSteps: [lastStep],
      });
    }
  }
  return diagnostics;
}

function validatePlan(plan: DeterministicPlan): CompilerDiagnostic[] {
  return [
    ...checkSelfDefeatingTransitions(plan),
    ...checkCircularDependencies(plan),
    ...checkUnstableOutputs(plan),
    ...checkUnreachableSteps(plan),
    ...checkTypeMismatches(plan),
    ...checkCoilConflicts(plan),
    ...checkMissingInitialState(plan),
    ...checkSequenceResetPath(plan),
  ];
}

/**
 * Validate a sequence's rows without full compilation.
 * Used at matrix review time before process code generation.
 * Returns compiler diagnostics for the sequence.
 */
export function validateSequence(sequence: ProcessSequence): CompilerDiagnostic[] {
  if (!sequence.rows?.length) return [];
  try {
    const plan = compilePlan({
      sequence,
      blockName: sequence.name,
      dbName: "_VALIDATE",
      stepArrayName: "S",
      actionArrayName: "A",
      language: "SCL",
    });
    return validatePlan(plan);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Artifact compilation
// ---------------------------------------------------------------------------

export function compileDeterministicProcessArtifact(input: DeterministicCompilerInput): DeterministicCompilerResult {
  const plan = compilePlan(input);
  const diagnostics = validatePlan(plan);

  const artifact: ForgeArtifact = input.language === "LAD"
    ? {
        id: crypto.randomUUID(),
        name: plan.blockName,
        type: "FC",
        language: "LAD",
        content: JSON.stringify(buildDeterministicLadProgram(plan)),
        approved: false,
        stage: "process",
        destination_folder: "Program blocks/Forge/Process",
        dependencies: [],
        compile_after_import: true,
        deterministic: true,
      }
    : {
        id: crypto.randomUUID(),
        name: plan.blockName,
        type: "FC",
        language: "SCL",
        content: buildDeterministicScl(plan),
        approved: false,
        stage: "process",
        destination_folder: "Program blocks/Forge/Process",
        dependencies: [],
        compile_after_import: true,
        deterministic: true,
      };

  return { artifact, diagnostics };
}

export function buildDeterministicFaultDb(faults: FaultMatrixEntry[], dbName = "DB_FaultData"): ForgeArtifact {
  const faultFieldDecls = faults
    .map((fault) => `    ${fault.tag} : Bool;       // ${fault.code}: ${fault.description} [${fault.source}]`)
    .join("\n");

  const faultDbCode = `DATA_BLOCK "${dbName}"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1

  VAR
${faultFieldDecls}
    anyFaultLatched : Bool;    // Summary: TRUE when any fault is latched
    faultActive : Bool;        // Alias for anyFaultLatched (legacy compatibility)
    faultCode : Word;
    faultReset : Bool;
  END_VAR

BEGIN

END_DATA_BLOCK`;

  return {
    id: crypto.randomUUID(),
    name: dbName,
    type: "DB",
    language: "SCL",
    content: faultDbCode,
    approved: false,
    stage: "process",
    destination_folder: "Program blocks/Forge/Process",
    dependencies: [],
    compile_after_import: false,
    deterministic: true,
  };
}

/**
 * Fault latch rung: self-hold with reset.
 * The fault bit is SET by the sequence FC's output rungs (e.g. A[40] → DB_FaultData.f003 = TRUE).
 * This rung just HOLDS it latched until faultReset clears it.
 * Pattern: faultBit AND NOT faultReset → faultBit (seal-in latch)
 */
function buildFaultLatchRung(fault: FaultMatrixEntry, dbName: string): LadRung {
  return {
    id: `rung_${fault.tag}`,
    title: `${fault.code} latch`,
    comment: fault.description,
    logic: {
      type: "series",
      nodes: [
        buildContactNode("no", buildDbFieldOperand(dbName, fault.tag), `${fault.tag}_seal`),
        buildContactNode("nc", buildDbFieldOperand(dbName, "faultReset"), `${fault.tag}_reset`),
        {
          type: "element",
          element: {
            id: `coil_${fault.tag}`,
            type: "OUTPUT_COIL",
            operand: buildDbFieldOperand(dbName, fault.tag),
            dataType: "Bool",
          },
        },
      ],
    },
  };
}

function buildFaultActiveRung(faults: FaultMatrixEntry[], dbName: string): LadRung {
  return {
    id: "rung_fault_active",
    title: "Aggregate fault active",
    comment: "OR of all individual fault bits.",
    logic: {
      type: "series",
      nodes: [
        {
          type: "parallel",
          id: "par_fault_active",
          branches: faults.map((fault, index) => ({
            type: "series",
            nodes: [
              buildContactNode("no", buildDbFieldOperand(dbName, fault.tag), `fault_active_${index}`),
            ],
          })),
        },
        {
          type: "element",
          element: {
            id: "coil_fault_active",
            type: "OUTPUT_COIL",
            operand: buildDbFieldOperand(dbName, "faultActive"),
            dataType: "Bool",
          },
        },
      ],
    },
  };
}

function buildDeterministicFaultLadProgram(faults: FaultMatrixEntry[], blockName: string, dbName: string): LadProgram {
  return {
    id: `det_${blockName}`,
    name: blockName,
    blockType: "FC",
    variables: [],
    rungs: [
      ...faults.map((fault) => buildFaultLatchRung(fault, dbName)),
      buildFaultActiveRung(faults, dbName),
      // anyFaultLatched mirrors faultActive — sequences reference this name
      {
        id: "rung_any_fault_latched",
        title: "anyFaultLatched",
        comment: "Mirror of faultActive — used by sequence conditions",
        logic: {
          type: "series",
          nodes: [
            buildContactNode("no", buildDbFieldOperand(dbName, "faultActive"), "any_fault_src"),
            {
              type: "element",
              element: {
                id: "coil_any_fault_latched",
                type: "OUTPUT_COIL",
                operand: buildDbFieldOperand(dbName, "anyFaultLatched"),
                dataType: "Bool",
              },
            },
          ],
        },
      },
    ],
  };
}

function buildDeterministicFaultScl(faults: FaultMatrixEntry[], blockName: string, dbName: string): string {
  const lines: string[] = [
    `FUNCTION "${blockName}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
  ];

  // Fault latch: self-hold with reset.
  // The fault bit is SET by sequence FC output rungs. This just holds it latched.
  for (const fault of faults) {
    lines.push(`    // ${fault.code}: ${fault.description}`);
    lines.push(`    IF "${dbName}".${fault.tag} AND NOT "${dbName}".faultReset THEN`);
    lines.push(`        "${dbName}".${fault.tag} := TRUE;`);
    lines.push(`    ELSIF "${dbName}".faultReset THEN`);
    lines.push(`        "${dbName}".${fault.tag} := FALSE;`);
    lines.push(`    END_IF;`);
    lines.push("");
  }

  lines.push(`    "${dbName}".faultActive := ${faults.map((fault) => `"${dbName}".${fault.tag}`).join(" OR ") || "FALSE"};`);
  lines.push(`    "${dbName}".anyFaultLatched := "${dbName}".faultActive;`);
  lines.push(`END_FUNCTION`);
  return lines.join("\n");
}

export function compileDeterministicFaultArtifact(input: DeterministicFaultCompilerInput): ForgeArtifact | null {
  if (input.faults.length === 0) return null;
  const blockName = sanitizeBlockName(input.blockName ?? "FaultHandler");
  const dbName = input.dbName ?? "DB_FaultData";

  if (input.language === "LAD") {
    return {
      id: crypto.randomUUID(),
      name: blockName,
      type: "FC",
      language: "LAD",
      content: JSON.stringify(buildDeterministicFaultLadProgram(input.faults, blockName, dbName)),
      approved: false,
      stage: "process",
      destination_folder: "Program blocks/Forge/Process",
      dependencies: [],
      compile_after_import: true,
      deterministic: true,
    };
  }

  return {
    id: crypto.randomUUID(),
    name: blockName,
    type: "FC",
    language: "SCL",
    content: buildDeterministicFaultScl(input.faults, blockName, dbName),
    approved: false,
    stage: "process",
    destination_folder: "Program blocks/Forge/Process",
    dependencies: [],
    compile_after_import: true,
    deterministic: true,
  };
}

// ---------------------------------------------------------------------------
// Wave D — v2-aware dispatch.
//
// When a caller has a SpecContractV2 + equipment_module/state pair, use this entry
// point. If the target state is `sequence_model_version === 2` it delegates
// to the SFC compiler in `forge-process-compiler-v2.ts`. Otherwise the caller
// should keep using `compileDeterministicProcessArtifact` with a v1
// ProcessSequence — this helper does not attempt to lower a v1 contract
// into a ProcessSequence on the caller's behalf.
// ---------------------------------------------------------------------------

export function compileSequentialStateFromContract(
  contract: SpecContractV2,
  stateId: string,
  equipment_moduleId: string,
  ctx: CompileV2Context = {},
): SequenceCompileResult {
  const equipment_module = contract.equipment_modules[equipment_moduleId];
  const state = equipment_module?.sequential_states?.[stateId];
  if (!state) {
    return {
      ok: false,
      errors: [
        {
          kind: "validation",
          equipment_module_id: equipment_moduleId,
          state_id: stateId,
          message: `state ${stateId} not found on equipment_module ${equipment_moduleId}`,
        },
      ],
    };
  }
  // v2 → SFC compiler. v1 rows still get routed through here because the
  // v2 compiler calls ensureV2() to upgrade in memory first. This keeps a
  // single entry point for contract-shaped data while the v1 ProcessSequence
  // flat-list callers stay on `compileDeterministicProcessArtifact`.
  if (state.sequence_model_version === 2) {
    return compileSequentialStateV2(contract, stateId, equipment_moduleId, ctx);
  }
  return compileSequentialStateV2(contract, stateId, equipment_moduleId, ctx);
}
