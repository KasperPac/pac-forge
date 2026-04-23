import {
  type FbInterfaceContract,
  type FbInterfaceInput,
  type FbInterfaceOutput,
  type InterfaceDataType,
  type InterfaceInputRole,
  type InterfaceOutputRole,
} from "@/types/fb-interface-contract";

/**
 * Parse VAR_INPUT / VAR_OUTPUT declarations out of raw SCL source.
 *
 * Phase 3 of the Assembly FB Library plan (§6 step 3): pre-fill the interface
 * contract editor from existing SCL so Mode A retrofit and Mode B import start
 * from a scaffolded contract rather than a blank form.
 *
 * Scope:
 *   - Fills `name`, `tia_name`, `data_type`, `udt_name` (when applicable),
 *     `default_value`, `description` (from trailing `// comment`).
 *   - Infers `role` from naming conventions when confident (e.g. `AutoRun`
 *     → `auto_run`, `FaultCode` → `fault_code`). Falls back to `other` when
 *     no rule matches — engineer re-labels from the editor.
 *   - Leaves `required` unset (materialiser defaults to false).
 *   - Skips complex declarations (ARRAY, STRUCT inline, multi-var lines) —
 *     "when it can't determine a field, leave it blank rather than guess".
 */

const PRIMITIVE_MAP: Record<string, InterfaceDataType> = {
  BOOL: "BOOL",
  INT: "INT",
  DINT: "DINT",
  REAL: "REAL",
  TIME: "TIME",
  WORD: "WORD",
  DWORD: "DWORD",
  STRING: "STRING",
};

// ---------------------------------------------------------------------------
// Role inference from variable names
// ---------------------------------------------------------------------------
// Match on a normalised form of the variable name: alphanumerics only, lower-
// cased. Patterns are tried in order — specific tokens come before generic
// ones (e.g. `faultcode` before `fault`). When no pattern matches, the caller
// falls back to `"other"`.
//
// Kept generic across machine types (conveyor, lift, transfer, filler, etc.)
// per CLAUDE.md — no project-specific names.

interface RolePattern<R> {
  /** Lower-cased alphanumeric substrings; any match promotes the role. */
  tokens: string[];
  role: R;
}

const INPUT_ROLE_PATTERNS: RolePattern<InterfaceInputRole>[] = [
  { tokens: ["autorun"], role: "auto_run" },
  { tokens: ["estop", "emergencystop", "emstop"], role: "emergency_stop_in" },
  { tokens: ["upstreamready"], role: "upstream_ready" },
  { tokens: ["downstreamready"], role: "downstream_ready" },
  { tokens: ["permissive"], role: "permissive" },
  { tokens: ["setpoint"], role: "setpoint" },
  { tokens: ["resetcmd", "resetcommand", "reset"], role: "reset_cmd" },
  { tokens: ["commandmode", "modecmd", "cmdmode"], role: "command_mode" },
  { tokens: ["commandposition", "positioncmd", "cmdposition"], role: "command_position" },
  { tokens: ["commandlevel", "levelcmd", "cmdlevel"], role: "command_level" },
  { tokens: ["commandlane", "lanecmd", "cmdlane"], role: "command_lane" },
  { tokens: ["commandextend", "extendcmd", "cmdextend"], role: "command_extend" },
  { tokens: ["startcmd", "startcommand", "start"], role: "start_cmd" },
];

const OUTPUT_ROLE_PATTERNS: RolePattern<InterfaceOutputRole>[] = [
  { tokens: ["packageatdischarge"], role: "package_at_discharge" },
  { tokens: ["packagedelivered"], role: "package_delivered" },
  { tokens: ["packagecount"], role: "package_count" },
  { tokens: ["emergencydescendactive", "emergencydescend"], role: "emergency_descend_active" },
  { tokens: ["cyclecomplete"], role: "cycle_complete" },
  { tokens: ["faultcode"], role: "fault_code" },
  { tokens: ["faulted", "fault"], role: "faulted" },
  { tokens: ["athome"], role: "at_home" },
  { tokens: ["attarget"], role: "at_target" },
  { tokens: ["atposition"], role: "at_position" },
  { tokens: ["atspeed"], role: "at_speed" },
  { tokens: ["atlevel"], role: "at_level" },
  { tokens: ["extended"], role: "extended" },
  { tokens: ["retracted"], role: "retracted" },
  { tokens: ["intransit"], role: "in_transit" },
  { tokens: ["lifted"], role: "lifted" },
  { tokens: ["lowered"], role: "lowered" },
  { tokens: ["running"], role: "running" },
  { tokens: ["moving"], role: "moving" },
  { tokens: ["ready"], role: "ready" },
  { tokens: ["empty"], role: "empty" },
  { tokens: ["full"], role: "full" },
];

function normaliseForRoleMatch(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function inferInputRole(name: string): InterfaceInputRole {
  const n = normaliseForRoleMatch(name);
  if (!n) return "other";
  for (const p of INPUT_ROLE_PATTERNS) {
    if (p.tokens.some((t) => n.includes(t))) return p.role;
  }
  return "other";
}

function inferOutputRole(name: string): InterfaceOutputRole {
  const n = normaliseForRoleMatch(name);
  if (!n) return "other";
  for (const p of OUTPUT_ROLE_PATTERNS) {
    if (p.tokens.some((t) => n.includes(t))) return p.role;
  }
  return "other";
}

export interface ParsedInterface {
  inputs: Partial<FbInterfaceInput>[];
  outputs: Partial<FbInterfaceOutput>[];
}

export interface PrefillResult {
  contract: FbInterfaceContract;
  addedInputs: number;
  addedOutputs: number;
  skippedInputs: number;
  skippedOutputs: number;
}

function classifyDataType(raw: string): { data_type: InterfaceDataType; udt_name?: string } {
  const trimmed = raw.trim();

  // Quoted UDT reference, e.g. "udtConfig" or "IEC_TIMER"
  const quoted = trimmed.match(/^"([^"]+)"$/);
  if (quoted) return { data_type: "UDT", udt_name: quoted[1] };

  const upper = trimmed.toUpperCase();

  // STRING with length qualifier, e.g. STRING[80]
  if (/^STRING(\[\d+\])?$/.test(upper)) return { data_type: "STRING" };

  if (PRIMITIVE_MAP[upper]) return { data_type: PRIMITIVE_MAP[upper] };

  // Unquoted identifier that isn't a primitive — treat as UDT and preserve
  // the raw name so the engineer sees exactly what was declared.
  if (/^[A-Za-z_]\w*$/.test(trimmed)) return { data_type: "UDT", udt_name: trimmed };

  // Anything else (ARRAY[...], STRUCT, inline expressions) is out of scope.
  return { data_type: "UDT", udt_name: trimmed };
}

interface ParsedDecl {
  name: string;
  tia_name: string;
  data_type: InterfaceDataType;
  udt_name?: string;
  default_value?: string;
  description: string;
}

function parseDeclLine(rawLine: string): ParsedDecl | null {
  // Extract trailing `// comment` (SCL single-line comment) for description.
  const commentIdx = rawLine.indexOf("//");
  const codePart = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
  const description = commentIdx >= 0 ? rawLine.slice(commentIdx + 2).trim() : "";

  const body = codePart.trim().replace(/;\s*$/, "").trim();
  if (!body) return null;

  // Declaration must have exactly one top-level colon separating name from type.
  const colonIdx = body.indexOf(":");
  if (colonIdx <= 0) return null;

  const name = body.slice(0, colonIdx).trim();
  const rhs = body.slice(colonIdx + 1).trim();

  // Skip invalid / multi-var declarations.
  if (!/^[A-Za-z_]\w*$/.test(name)) return null;
  if (!rhs) return null;

  // Split on `:=` for default value.
  const assignIdx = rhs.indexOf(":=");
  const typeRaw = assignIdx >= 0 ? rhs.slice(0, assignIdx).trim() : rhs;
  const defaultValue = assignIdx >= 0 ? rhs.slice(assignIdx + 2).trim() : "";

  if (!typeRaw) return null;

  // Conservative: skip declarations the contract can't faithfully represent.
  if (/^ARRAY\b/i.test(typeRaw)) return null;
  if (/^STRUCT\b/i.test(typeRaw)) return null;

  const { data_type, udt_name } = classifyDataType(typeRaw);

  const result: ParsedDecl = {
    name,
    tia_name: name,
    data_type,
    description,
  };
  if (udt_name) result.udt_name = udt_name;
  if (defaultValue) result.default_value = defaultValue;
  return result;
}

export function parseSclInterface(scl: string): ParsedInterface {
  const inputs: Partial<FbInterfaceInput>[] = [];
  const outputs: Partial<FbInterfaceOutput>[] = [];
  if (!scl) return { inputs, outputs };

  const blockRe = /VAR_(INPUT|OUTPUT)\b([\s\S]*?)\bEND_VAR\b/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(scl)) !== null) {
    const section = match[1].toUpperCase();
    const body = match[2];
    for (const line of body.split(/\r?\n/)) {
      const parsed = parseDeclLine(line);
      if (!parsed) continue;
      if (section === "INPUT") {
        inputs.push({ ...parsed, role: inferInputRole(parsed.name) });
      } else {
        // Outputs don't carry default_value — strip it.
        const { default_value: _dv, ...outputFields } = parsed;
        void _dv;
        outputs.push({ ...outputFields, role: inferOutputRole(parsed.name) });
      }
    }
  }
  return { inputs, outputs };
}

export function parseSclInterfaceFromBlocks(
  blocks: Array<{ scl_code: string }>,
): ParsedInterface {
  const inputs: Partial<FbInterfaceInput>[] = [];
  const outputs: Partial<FbInterfaceOutput>[] = [];
  const seenIn = new Set<string>();
  const seenOut = new Set<string>();

  for (const b of blocks) {
    const p = parseSclInterface(b.scl_code);
    for (const i of p.inputs) {
      const key = (i.tia_name ?? "").toLowerCase();
      if (!key || seenIn.has(key)) continue;
      seenIn.add(key);
      inputs.push(i);
    }
    for (const o of p.outputs) {
      const key = (o.tia_name ?? "").toLowerCase();
      if (!key || seenOut.has(key)) continue;
      seenOut.add(key);
      outputs.push(o);
    }
  }
  return { inputs, outputs };
}

function materialiseInput(p: Partial<FbInterfaceInput>): FbInterfaceInput {
  const row: FbInterfaceInput = {
    name: p.name ?? "",
    tia_name: p.tia_name ?? p.name ?? "",
    data_type: p.data_type ?? "BOOL",
    role: p.role ?? "other",
    description: p.description ?? "",
    required: p.required ?? false,
  };
  if (p.udt_name) row.udt_name = p.udt_name;
  if (p.default_value) row.default_value = p.default_value;
  return row;
}

function materialiseOutput(p: Partial<FbInterfaceOutput>): FbInterfaceOutput {
  const row: FbInterfaceOutput = {
    name: p.name ?? "",
    tia_name: p.tia_name ?? p.name ?? "",
    data_type: p.data_type ?? "BOOL",
    role: p.role ?? "other",
    description: p.description ?? "",
  };
  if (p.udt_name) row.udt_name = p.udt_name;
  return row;
}

/**
 * Merge parsed inputs/outputs into an existing contract.
 *
 * Rows whose `tia_name` already exists on the contract are skipped — the
 * engineer's previously-assigned role / required / description wins. New rows
 * get safe defaults (role="other", required=false) that the engineer
 * re-labels in the editor.
 */
export function prefillContractFromScl(
  contract: FbInterfaceContract,
  blocks: Array<{ scl_code: string }>,
): PrefillResult {
  const parsed = parseSclInterfaceFromBlocks(blocks);
  const existingIn = new Set(contract.inputs.map((i) => i.tia_name.toLowerCase()));
  const existingOut = new Set(contract.outputs.map((o) => o.tia_name.toLowerCase()));

  const newInputs: FbInterfaceInput[] = [];
  let skippedInputs = 0;
  for (const p of parsed.inputs) {
    const key = (p.tia_name ?? "").toLowerCase();
    if (!key) continue;
    if (existingIn.has(key)) {
      skippedInputs++;
      continue;
    }
    newInputs.push(materialiseInput(p));
  }

  const newOutputs: FbInterfaceOutput[] = [];
  let skippedOutputs = 0;
  for (const p of parsed.outputs) {
    const key = (p.tia_name ?? "").toLowerCase();
    if (!key) continue;
    if (existingOut.has(key)) {
      skippedOutputs++;
      continue;
    }
    newOutputs.push(materialiseOutput(p));
  }

  return {
    contract: {
      ...contract,
      inputs: [...contract.inputs, ...newInputs],
      outputs: [...contract.outputs, ...newOutputs],
    },
    addedInputs: newInputs.length,
    addedOutputs: newOutputs.length,
    skippedInputs,
    skippedOutputs,
  };
}
