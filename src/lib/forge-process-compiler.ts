import type { ForgeArtifact } from "@/types/forge";
import type { FaultMatrixEntry, ProcessSequence, SequenceRow } from "@/types/forge-matrix";
import type { LadNode, LadProgram, LadRung, LadSeriesChain, LadVariable } from "@/types/lad";

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
}

export interface DeterministicCompilerInput {
  sequence: ProcessSequence;
  blockName: string;
  dbName: string;
  stepArrayName: string;
  actionArrayName: string;
  language: "SCL" | "LAD";
}

export interface DeterministicFaultCompilerInput {
  faults: FaultMatrixEntry[];
  language: "SCL" | "LAD";
  blockName?: string;
  dbName?: string;
}

const CONDITION_SPLIT_RE = /\s+(?:AND|&&)\s+/i;
const SIMPLE_TOKEN_RE = /^(?:"[^"]+"(?:\.[A-Za-z_][A-Za-z0-9_]*)*|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\[[0-9]+\])?$/;
const SIMPLE_LITERAL_RE = /^(?:-?\d+(?:\.\d+)?|TRUE|FALSE|T#[A-Za-z0-9_]+)$/i;

function sanitizeBlockName(name: string): string {
  return name.replace(/\s+/g, "_");
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

  operand = stripTrailingAnnotation(operand);

  const eqMatch = operand.match(/^(.*?)(?:\s*=\s*(TRUE|FALSE))$/i);
  if (eqMatch) {
    operand = eqMatch[1].trim();
    if (eqMatch[2].toUpperCase() == "FALSE") {
      kind = kind === "nc" ? "no" : "nc";
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
      throw new Error(`${rowLabel}: NOT comparisons are not supported yet; split this into an explicit inverse condition`);
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

function parseFaultConditionAtoms(raw: string, rowLabel: string): ConditionAtom[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("NOT (")) {
    const branches = parseConditionBranches(trimmed, rowLabel);
    if (branches.length !== 1) {
      throw new Error(`${rowLabel}: fault conditions cannot contain XOR/OR branches yet`);
    }
    return branches[0];
  }
  throw new Error(`${rowLabel}: complex grouped fault conditions are not supported yet`);
}

function compilePlan(input: DeterministicCompilerInput): DeterministicPlan {
  const rows = input.sequence.rows ?? [];
  if (rows.length === 0) {
    throw new Error(`Sequence "${input.sequence.name}" has no rows`);
  }

  const orderedSteps = [...new Set(rows.map((row) => row.step))].sort((a, b) => a - b);
  const compiledRows: CompiledRow[] = rows.map((row, index) => ({
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

  const steps = orderedSteps.map((step) => {
    const stepRows = compiledRows.filter((row) => row.step === step && row.type !== "fault_exit");
    const incoming = compiledRows.filter((row) => row.next === step);
    const outgoingTargets = [...new Set(
      stepRows
        .map((row) => row.next)
        .filter((next): next is number => typeof next === "number"),
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

function buildCompareNode(atom: Extract<ConditionAtom, { mode: "compare" }>, id: string): LadNode {
  return {
    type: "element",
    element: {
      id,
      type: "CMP",
      operand: atom.operand,
      operand2: atom.operand2,
      cmpOperator: atom.operator === "=" ? "==" : atom.operator === "<>" ? "!=" : atom.operator,
      dataType: "Int",
    },
  };
}

function buildSeriesFromAtoms(atoms: ConditionAtom[], prefix: string): LadSeriesChain {
  return {
    type: "series",
    nodes: atoms.map((atom, index) =>
      atom.mode === "contact"
        ? buildContactNode(atom.kind, atom.operand, `${prefix}_${index}`)
        : buildCompareNode(atom, `${prefix}_${index}`),
    ),
  };
}

function buildConditionNodes(branches: ConditionAtom[][], prefix: string): LadNode[] {
  if (branches.length === 1) {
    return buildSeriesFromAtoms(branches[0], prefix).nodes;
  }
  return [
    {
      type: "parallel",
      id: `par_${prefix}`,
      branches: branches.map((branch, index) => buildSeriesFromAtoms(branch, `${prefix}_b${index}`)),
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
        ...buildConditionNodes(incoming.conditionBranches, `step_${step.step}_from_${incoming.key}`),
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

function buildActionRung(plan: DeterministicPlan, step: CompiledStep): LadRung {
  return {
    id: `rung_action_${step.step}`,
    title: `Action bit ${step.step}`,
    comment: step.rows.map((row) => row.output ?? row.action).join(" | "),
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
  const rungs: LadRung[] = [buildBootstrapRung(plan)];

  for (const step of plan.steps) {
    rungs.push(buildStepLatchRung(plan, step));
    rungs.push(buildActionRung(plan, step));
  }

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
  const actionOperand = buildDbOperand(plan.dbName, plan.actionArrayName, step.step);

  lines.push(`IF ${stepOperand} THEN`);
  lines.push(`    ${actionOperand} := TRUE;`);

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

function buildDeterministicScl(plan: DeterministicPlan): string {
  const lines: string[] = [
    `FUNCTION "${plan.blockName}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `    // Bootstrap the sequence when all steps are off.`,
    `    IF ${plan.orderedSteps.map((step) => `NOT ${buildDbOperand(plan.dbName, plan.stepArrayName, step)}`).join(" AND ")} THEN`,
    `        ${buildDbOperand(plan.dbName, plan.stepArrayName, plan.orderedSteps[0])} := TRUE;`,
    `    END_IF;`,
    ``,
    `    // Clear action bits every scan, then re-assert the active step's bit deterministically.`,
  ];

  for (const step of plan.orderedSteps) {
    lines.push(`    ${buildDbOperand(plan.dbName, plan.actionArrayName, step)} := FALSE;`);
  }

  lines.push("");
  for (const step of plan.steps) {
    lines.push(`    // Step ${step.step}: ${step.rows.map((row) => row.action).join(" | ")}`);
    lines.push(...renderSclStep(plan, step).map((line) => `    ${line}`.replace(/^ {8}/, "    ")));
    lines.push("");
  }

  lines.push(`END_FUNCTION`);
  return lines.join("\n");
}

export function compileDeterministicProcessArtifact(input: DeterministicCompilerInput): ForgeArtifact {
  const plan = compilePlan(input);

  if (input.language === "LAD") {
    return {
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
    };
  }

  return {
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
  };
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
    faultActive : Bool;
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
  };
}

function buildFaultLatchRung(fault: FaultMatrixEntry, dbName: string): LadRung {
  const atoms = parseFaultConditionAtoms(fault.condition, fault.code);
  const topBranch = buildSeriesFromAtoms(atoms, `${fault.tag}_trigger`);
  const bottomBranch: LadSeriesChain = {
    type: "series",
    nodes: [
      buildContactNode("no", buildDbFieldOperand(dbName, fault.tag), `${fault.tag}_seal`),
      buildContactNode("nc", buildDbFieldOperand(dbName, "faultReset"), `${fault.tag}_reset`),
    ],
  };

  return {
    id: `rung_${fault.tag}`,
    title: `${fault.code} latch`,
    comment: fault.description,
    logic: {
      type: "series",
      nodes: [
        { type: "parallel", id: `par_${fault.tag}`, branches: [topBranch, bottomBranch] },
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

  for (const fault of faults) {
    const expr = renderConditionForScl([parseFaultConditionAtoms(fault.condition, fault.code)]);
    lines.push(`    IF ((${expr}) OR "${dbName}".${fault.tag}) AND NOT "${dbName}".faultReset THEN`);
    lines.push(`        "${dbName}".${fault.tag} := TRUE;`);
    lines.push(`    ELSIF "${dbName}".faultReset THEN`);
    lines.push(`        "${dbName}".${fault.tag} := FALSE;`);
    lines.push(`    END_IF;`);
    lines.push("");
  }

  lines.push(`    "${dbName}".faultActive := ${faults.map((fault) => `"${dbName}".${fault.tag}`).join(" OR ") || "FALSE"};`);
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
  };
}
