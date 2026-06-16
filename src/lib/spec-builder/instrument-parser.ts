/**
 * Instrument register parser — deterministic column detection + Haiku AI classification.
 * Parses Excel/CSV instrument registers into structured tag data with unit grouping.
 */
import * as XLSX from "xlsx";
import type {
  InstrumentTag,
  ColumnMapping,
  UnitSummary,
  ParseWarning,
  EquipmentType,
  TokenUsage,
  UnitConfig,
  EquipmentModuleConfig,
  ControlModuleConfig,
  IoSignal,
} from "@/types/spec-builder";
import { CANONICAL_COLUMN_NAMES, UNIT_PREFIX_MAP } from "@/types/spec-builder";
import { callNonStreaming } from "@/hooks/use-generation";
import type { PromptLayerMeta } from "@/hooks/use-generation";

// ---------------------------------------------------------------------------
// Step 1 — Column detection (deterministic, no AI)
// ---------------------------------------------------------------------------

export function detectColumns(sheet: XLSX.WorkSheet): {
  mapping: ColumnMapping;
  headerRow: number;
  unmapped: string[];
} {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  let bestMapping: ColumnMapping | null = null;
  let bestScore = 0;
  let bestRow = 0;
  const bestUnmapped: string[] = [];

  // Scan first 10 rows for header
  for (let r = range.s.r; r <= Math.min(range.s.r + 9, range.e.r); r++) {
    const mapping: ColumnMapping = {
      process_cell: null,
      unit: null,
      equipment_module: null,
      control_module: null,
      tag: null,
      device_type: null,
      description: null,
      signal_type: null,
      io_address: null,
      is_safety: null,
    };
    let score = 0;
    const unmapped: string[] = [];

    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const val = String(cell.v ?? "").trim().toLowerCase();
      if (!val) continue;

      let matched = false;
      for (const [field, names] of Object.entries(CANONICAL_COLUMN_NAMES)) {
        if (names.some((n) => val === n || val.includes(n))) {
          const key = field as keyof ColumnMapping;
          if (mapping[key] === null) {
            mapping[key] = c;
            score++;
            matched = true;
            break;
          }
        }
      }
      if (!matched) unmapped.push(val);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMapping = mapping;
      bestRow = r;
      bestUnmapped.length = 0;
      bestUnmapped.push(...unmapped);
    }
  }

  if (!bestMapping || bestScore < 2) {
    throw new Error(
      "Could not detect instrument register columns. Ensure the file has headers like 'Tag', 'Description', 'Device Type', etc."
    );
  }

  return { mapping: bestMapping, headerRow: bestRow, unmapped: bestUnmapped };
}

// ---------------------------------------------------------------------------
// Step 1b — Extract raw rows from sheet using detected column mapping
// ---------------------------------------------------------------------------

export function extractRows(
  sheet: XLSX.WorkSheet,
  mapping: ColumnMapping,
  headerRow: number
): Array<Partial<InstrumentTag> & { is_safety_raw?: string }> {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const rows: Array<Partial<InstrumentTag> & { is_safety_raw?: string }> = [];

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const cellVal = (c: number | null) => {
      if (c === null) return "";
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      return cell ? String(cell.v ?? "").trim() : "";
    };

    const tag = cellVal(mapping.tag);
    if (!tag) continue; // skip empty rows

    rows.push({
      tag,
      device_type: cellVal(mapping.device_type),
      description: cellVal(mapping.description),
      signal_type: cellVal(mapping.signal_type),
      io_address: cellVal(mapping.io_address),
      process_cell: cellVal(mapping.process_cell),
      unit: cellVal(mapping.unit),
      equipment_module: cellVal(mapping.equipment_module),
      control_module: cellVal(mapping.control_module),
      is_safety_raw: cellVal(mapping.is_safety),
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Step 2 — Sonnet AI classification (batched)
// ---------------------------------------------------------------------------

const CLASSIFY_SYSTEM_PROMPT = `You are an expert industrial automation instrument classification agent using ISA-88 Part 1 terminology.

Given a batch of tags from an instrument register, enrich each one with classification and ISA-88 hierarchy placement.

Some fields may already be provided in the input (process_cell, unit, equipment_module, control_module, signal_type, device_type, description). When provided, KEEP THEM — do not override. Only fill in what is missing.

ISA-88 PHYSICAL MODEL HIERARCHY:
- Process Cell: the full machine or production line (often one per project)
- Unit: a functional station that can carry out major processing activities (e.g. "Infeed Station", "Hydraulic Press")
- Equipment Module: a coordinated group of devices working together (e.g. "Conveyor CV01", "Lift Table LFT01")
- Control Module: a single physical device with IO signals (e.g. motor M01, sensor LS01, valve SOL01)

For each tag, return:
1. control_module_class: one of [valve, motor, sensor_level, sensor_pressure, sensor_temperature, sensor_weight, sensor_flow, sensor_position, indicator, transmitter, filter, conveyor, hopper, transporter, dryer, cooler, push_button, emergency_stop, other]
2. signal_direction: one of [DI, DO, AI, AO, internal]. If the input already has a signal_type (DI/DO/AI/AO), copy it exactly.
3. process_cell: the top-level system name. If already provided, copy exactly.
4. unit: the ISA-88 Unit this tag belongs to. If already provided, copy exactly. Otherwise infer from context.
5. equipment_module: the ISA-88 Equipment Module (e.g. "Conveyor CV01"). If already provided, copy exactly. Otherwise infer from tag naming and description.
6. control_module: the ISA-88 Control Module — the physical device this tag belongs to (e.g. "M01", "LS01", "SOL_UP"). Multiple tags share the same control_module when they belong to the same device. If already provided, copy exactly. Otherwise infer from the tag name by stripping the signal suffix.
7. is_safety: boolean — true if safety-critical (E-stop, overload relay, pressure switch interlock, rupture disk, safety relay)

DEVICE CLASS RULES:
- Motor Contactor, _CMD, _START, _STOP, _FWD, _REV → "motor"
- Motor Feedback, _RUN, _FB, _RUNNING → "motor"
- Overload Relay, _OL, _FAULT, _TRIP → "motor" (is_safety: true)
- VFD, _VSD, variable frequency drive → "motor"
- Temp Transmitter, _TT, TT prefix → "sensor_temperature"
- Pressure Transmitter, PIT, _PT → "sensor_pressure"
- Push Button, PB prefix, PB_ → "push_button"
- Emergency Stop, ESTOP, E-Stop → "emergency_stop" (is_safety: true)
- Level Switch, LS prefix → "sensor_level"
- Position, ZSL, ZSH → "sensor_position"
- Valve, LP, AY, PRV → "valve"

IMPORTANT: Use the "device_type" and "description" fields from the input to determine control_module_class. The tag name alone may not be sufficient. For example:
- device_type "Motor Contactor" → motor
- device_type "Overload Relay" → motor (is_safety: true)
- device_type "Temp Transmitter" → sensor_temperature
- device_type "PB" or "Push Button" → push_button
- device_type "Emergency Stop" → emergency_stop (is_safety: true)

Respond ONLY with a JSON array, one object per input tag, same order.
[
  { "control_module_class": "...", "signal_direction": "...", "process_cell": "...", "unit": "...", "equipment_module": "...", "control_module": "...", "is_safety": false }
]`;

const BATCH_SIZE = 50;

interface TagClassification {
  control_module_class: InstrumentTag["control_module_class"];
  signal_direction: InstrumentTag["signal_direction"];
  process_cell: string;
  unit: string;
  equipment_module: string;
  control_module: string;
  is_safety: boolean;
}

export async function classifyTags(
  rows: Array<Partial<InstrumentTag>>,
  abortSignal: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<{ classifications: TagClassification[]; usage: TokenUsage }> {
  const allClassifications: TagClassification[] = [];
  const totalUsage: TokenUsage = { input: 0, output: 0 };
  const batches = Math.ceil(rows.length / BATCH_SIZE);

  for (let i = 0; i < batches; i++) {
    const batch = rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const userMessage = JSON.stringify(
      batch.map((r) => {
        const entry: Record<string, string> = { tag: r.tag ?? "" };
        if (r.device_type) entry.device_type = r.device_type;
        if (r.description) entry.description = r.description;
        if (r.signal_type) entry.signal_type = r.signal_type.trim();
        if (r.process_cell) entry.process_cell = r.process_cell;
        if (r.unit) entry.unit = r.unit;
        if (r.equipment_module) entry.equipment_module = r.equipment_module;
        if (r.control_module) entry.control_module = r.control_module;
        return entry;
      })
    );

    const plMeta: PromptLayerMeta = {
      prompt_name: "spec_instrument_classify",
      agent_role: "instrument_classifier",
      model: "claude-sonnet-4-6",
    };

    const result = await callNonStreaming(
      CLASSIFY_SYSTEM_PROMPT,
      [{ role: "user" as const, content: userMessage }],
      abortSignal,
      8192,
      plMeta
    );

    if (result.usage) {
      totalUsage.input = (totalUsage.input ?? 0) + result.usage.input;
      totalUsage.output = (totalUsage.output ?? 0) + result.usage.output;
    }

    try {
      const parsed = JSON.parse(result.content) as TagClassification[];
      allClassifications.push(...parsed);
    } catch {
      for (let k = 0; k < batch.length; k++) {
        allClassifications.push({
          control_module_class: "other",
          signal_direction: "internal",
          process_cell: "",
          unit: "",
          equipment_module: "",
          control_module: "",
          is_safety: false,
        });
      }
    }

    onProgress?.(Math.min((i + 1) * BATCH_SIZE, rows.length), rows.length);
  }

  totalUsage.total = (totalUsage.input ?? 0) + (totalUsage.output ?? 0);
  return { classifications: allClassifications, usage: totalUsage };
}

// ---------------------------------------------------------------------------
// Step 2b — Deterministic classification from existing column data
// ---------------------------------------------------------------------------

const DEVICE_TYPE_MAP: Array<{ pattern: RegExp; control_module_class: InstrumentTag["control_module_class"]; is_safety?: boolean }> = [
  { pattern: /motor\s*contactor|contactor/i, control_module_class: "motor" },
  { pattern: /motor\s*feedback|run\s*feedback/i, control_module_class: "motor" },
  { pattern: /overload|thermal\s*overload/i, control_module_class: "motor", is_safety: true },
  { pattern: /thermistor/i, control_module_class: "motor" },
  { pattern: /vfd|vsd|variable\s*freq|variable\s*speed/i, control_module_class: "motor" },
  { pattern: /brake\s*contactor|brake/i, control_module_class: "motor" },
  { pattern: /braking\s*resistor/i, control_module_class: "motor" },
  { pattern: /temp\s*transmitter|temperature/i, control_module_class: "sensor_temperature" },
  { pattern: /press.*transmitter|pressure/i, control_module_class: "sensor_pressure" },
  { pattern: /level\s*switch|level\s*sensor/i, control_module_class: "sensor_level" },
  { pattern: /weight\s*transmitter/i, control_module_class: "sensor_weight" },
  { pattern: /flow\s*transmitter|flow\s*meter/i, control_module_class: "sensor_flow" },
  { pattern: /photo.?electric|photoeye|photo.?eye|photo.?sensor/i, control_module_class: "sensor_position" },
  { pattern: /position|proximity|limit\s*switch/i, control_module_class: "sensor_position" },
  { pattern: /^pb$|push\s*button|pushbutton/i, control_module_class: "push_button" },
  { pattern: /pendant/i, control_module_class: "push_button" },
  { pattern: /emergency\s*stop|e-?stop/i, control_module_class: "emergency_stop", is_safety: true },
  { pattern: /safety\s*relay/i, control_module_class: "emergency_stop", is_safety: true },
  { pattern: /maintenance\s*switch/i, control_module_class: "emergency_stop", is_safety: true },
  { pattern: /solenoid|valve/i, control_module_class: "valve" },
  { pattern: /indicator|pilot\s*light|horn|strobe|beacon|siren/i, control_module_class: "indicator" },
  { pattern: /circuit\s*breaker|mcb|mccb|ecb/i, control_module_class: "other" },
  { pattern: /transmitter/i, control_module_class: "transmitter" },
  { pattern: /filter/i, control_module_class: "filter" },
  { pattern: /conveyor/i, control_module_class: "conveyor" },
  { pattern: /spare/i, control_module_class: "other" },
];

const TAG_SUFFIX_MAP: Array<{ pattern: RegExp; control_module_class: InstrumentTag["control_module_class"]; signal_direction?: InstrumentTag["signal_direction"]; is_safety?: boolean }> = [
  { pattern: /_CMD$|_START$|_STOP$|_FWD$|_REV$/i, control_module_class: "motor", signal_direction: "DO" },
  { pattern: /_RUN$|_FB$|_RUNNING$/i, control_module_class: "motor", signal_direction: "DI" },
  { pattern: /_OL$|_FAULT$|_TRIP$/i, control_module_class: "motor", signal_direction: "DI", is_safety: true },
  { pattern: /_SPD$|_SPEED$|_HZ$|_FREQ$/i, control_module_class: "motor" },
  { pattern: /^TT\d|_TT$|_TEMP$/i, control_module_class: "sensor_temperature", signal_direction: "AI" },
  { pattern: /^PT\d|^PIT\d|_PT$|_PIT$/i, control_module_class: "sensor_pressure", signal_direction: "AI" },
  { pattern: /^LS\d|_LS$|_LSH$|_LSL$/i, control_module_class: "sensor_level", signal_direction: "DI" },
  { pattern: /^PE\d+|_PE\d+$/i, control_module_class: "sensor_position", signal_direction: "DI" },
  { pattern: /^PB_|^PB\d/i, control_module_class: "push_button", signal_direction: "DI" },
  { pattern: /^ESTOP$|^E_STOP$|^ES\d+$/i, control_module_class: "emergency_stop", signal_direction: "DI", is_safety: true },
];

const SIGNAL_TYPE_MAP: Record<string, InstrumentTag["signal_direction"]> = {
  "DI": "DI",
  "DO": "DO",
  "AI": "AI",
  "AO": "AO",
};

interface DeterministicResult {
  control_module_class: InstrumentTag["control_module_class"] | null;
  signal_direction: InstrumentTag["signal_direction"] | null;
  is_safety: boolean | null;
}

function classifyDeterministic(row: Partial<InstrumentTag>): DeterministicResult {
  let control_module_class: InstrumentTag["control_module_class"] | null = null;
  let signal_direction: InstrumentTag["signal_direction"] | null = null;
  let is_safety: boolean | null = null;

  // 1. Signal direction from signal_type column (highest priority)
  const sigRaw = (row.signal_type ?? "").trim().toUpperCase();
  if (sigRaw in SIGNAL_TYPE_MAP) {
    signal_direction = SIGNAL_TYPE_MAP[sigRaw];
  }

  // 2. Device class from device_type column
  const devType = row.device_type ?? "";
  for (const { pattern, control_module_class: dc, is_safety: sf } of DEVICE_TYPE_MAP) {
    if (pattern.test(devType)) {
      control_module_class = dc;
      if (sf) is_safety = true;
      break;
    }
  }

  // 3. Fallback: device class from tag name suffixes
  if (!control_module_class) {
    const tag = row.tag ?? "";
    for (const { pattern, control_module_class: dc, signal_direction: sd, is_safety: sf } of TAG_SUFFIX_MAP) {
      if (pattern.test(tag)) {
        control_module_class = dc;
        if (sd && !signal_direction) signal_direction = sd;
        if (sf) is_safety = true;
        break;
      }
    }
  }

  // 4. Safety from description keywords
  if (is_safety === null) {
    const desc = (row.description ?? "").toLowerCase();
    if (/e-?stop|emergency|overload|safety|rupture/i.test(desc)) {
      is_safety = true;
    }
  }

  return { control_module_class, signal_direction, is_safety };
}

// ---------------------------------------------------------------------------
// Step 3 — Unit grouping
// ---------------------------------------------------------------------------

export function inferEquipmentType(prefix: string, name: string): EquipmentType {
  const combined = `${prefix} ${name}`;
  for (const { pattern, type } of UNIT_PREFIX_MAP) {
    if (pattern.test(combined)) return type;
  }
  return "Other";
}

export function groupSubsystems(tags: InstrumentTag[]): UnitSummary[] {
  const groups = new Map<string, InstrumentTag[]>();

  for (const tag of tags) {
    const key = tag.unit || "UNGROUPED";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tag);
  }

  const units: UnitSummary[] = [];
  for (const [key, groupTags] of groups) {
    const eqType = inferEquipmentType(key, key);
    units.push({
      unit_id: key,
      unit_name: key,
      equipment_type: eqType,
      tag_count: groupTags.length,
    });
  }

  return units.sort((a, b) => a.unit_name.localeCompare(b.unit_name));
}

// ---------------------------------------------------------------------------
// Step 3b — Build nested hierarchy from tags
// ---------------------------------------------------------------------------

/**
 * Infer equipment_module and device grouping from tag naming conventions.
 *
 * Common patterns:
 *   SUBSYS_DEVICE_SIGNAL  → e.g. GK01_M01_CMD
 *   SUBSYS_SIGNAL         → e.g. GK01_TT01
 *
 * Strategy:
 * 1. Group tags by unit (existing field on InstrumentTag).
 * 2. Within each unit, extract a "device prefix" from the tag name
 *    by stripping the known signal suffixes (_CMD, _FB, _RUN, etc.) and
 *    grouping tags that share the same base.
 * 3. Group control_modules by a coarser "equipment_module prefix" (the first alphanumeric
 *    segment after unit, e.g. "LFT01" from "LFT01_M01").
 *    If all control_modules in a unit share the same prefix, the unit
 *    IS the equipment_module (single-equipment_module unit).
 */

// THERM/THERMISTOR included so a motor's thermistor/fault tag groups with its
// motor device instead of splitting off into its own control module.
const SIGNAL_SUFFIXES = /[_.](?:CMD|FB|RUN|RUNNING|START|STOP|FWD|REV|OL|FAULT|TRIP|THERM|THERMISTOR|SPD|SPEED|HZ|FREQ|LSH|LSL|ZSH|ZSL|SP|PV|AO|AI|DI|DO|EN|ALARM|STATUS|STATE|ACK|RESET|OPN|CLS|OPEN|CLOSE|SET|RST)$/i;

function extractDevicePrefix(tag: string, unit: string): string {
  // Strip unit prefix if tag starts with it (by name match)
  let rest = tag;
  if (unit && rest.toUpperCase().startsWith(unit.toUpperCase())) {
    rest = rest.slice(unit.length).replace(/^[_.-]/, "");
  }

  // Strip signal suffix to get device base
  const base = rest.replace(SIGNAL_SUFFIXES, "");
  const result = base || rest || tag;

  // Strip leading pure-alphabetic unit code segment if present (e.g. "FIL_", "INF_", "OUT_").
  // These are tag-level unit codes — distinguishable from real equipment prefixes which
  // always contain digits (e.g. "CAP01", "LFT01"). Stripping them lets extractAssemblyPrefix
  // correctly identify the equipment_module segment that follows.
  const parts = result.split("_");
  if (parts.length >= 2 && /^[A-Za-z]+$/.test(parts[0])) {
    return parts.slice(1).join("_");
  }

  return result;
}

function extractAssemblyPrefix(devicePrefix: string): string {
  // Equipment Module = the equipment ID portion (letters + digits), e.g. "M01" → "M01", "LFT01_M01" → "LFT01"
  // Take everything up to and including the first number group
  const match = devicePrefix.match(/^([A-Za-z]+\d+)/);
  return match ? match[1] : devicePrefix;
}

/**
 * Infer a human-readable equipment_module name from device descriptions.
 * Strips common device-type keywords from the front of each description,
 * finds the most common meaningful prefix, and returns it.
 * Falls back to the tag-based asmPrefix if nothing useful is found.
 */
const DEVICE_KEYWORD_RE = /\b(motor|contactor|overload|relay|sensor|photoelectric|solenoid|valve|switch|transmitter|encoder|feedback|run|stop|start|command|fault|trip|speed|jam|presence|position|proximity)\b.*/i;

function suggestAssemblyName(descriptions: string[], fallback: string): string {
  const candidates = descriptions
    .map((d) => d.replace(DEVICE_KEYWORD_RE, "").trim())
    .filter((d) => d.length > 0 && d !== fallback);

  if (candidates.length === 0) return fallback;

  // Return the most common non-empty candidate
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c, (counts.get(c) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best?.[0] || fallback;
}

export function buildHierarchyFromTags(tags: InstrumentTag[]): UnitConfig[] {
  // Step 1: Group by unit
  const subGroups = new Map<string, InstrumentTag[]>();
  for (const t of tags) {
    const key = t.unit || "UNGROUPED";
    if (!subGroups.has(key)) subGroups.set(key, []);
    subGroups.get(key)!.push(t);
  }

  const units: UnitConfig[] = [];

  for (const [subKey, subTags] of subGroups) {
    // Check if any tags have explicit hierarchy columns
    const hasExplicitEquipmentModule = subTags.some((t) => t.equipment_module);
    const hasExplicitControlModule = subTags.some((t) => t.control_module);

    // Step 2: Group tags into control_modules by device prefix or explicit control_module
    const deviceGroups = new Map<string, InstrumentTag[]>();
    for (const t of subTags) {
      const devPrefix = hasExplicitControlModule && t.control_module
        ? t.control_module
        : extractDevicePrefix(t.tag, subKey);
      if (!deviceGroups.has(devPrefix)) deviceGroups.set(devPrefix, []);
      deviceGroups.get(devPrefix)!.push(t);
    }

    // Step 3: Group control_modules into equipment_modules
    // If explicit equipment_module column is provided, use it; otherwise infer from tag prefix
    const equipment_moduleGroups = new Map<string, Map<string, InstrumentTag[]>>();
    for (const [devPrefix, devTags] of deviceGroups) {
      const asmKey = hasExplicitEquipmentModule
        ? (devTags[0].equipment_module || subKey)
        : extractAssemblyPrefix(devPrefix);
      if (!equipment_moduleGroups.has(asmKey)) equipment_moduleGroups.set(asmKey, new Map());
      equipment_moduleGroups.get(asmKey)!.set(devPrefix, devTags);
    }

    // Build equipment_modules
    const equipment_modules: EquipmentModuleConfig[] = [];
    for (const [asmPrefix, devMap] of equipment_moduleGroups) {
      const control_modules: ControlModuleConfig[] = [];
      for (const [devPrefix, devTags] of devMap) {
        const ioSignals: IoSignal[] = devTags.map((t) => ({
          tag: t.tag,
          signal_type: t.signal_type || t.signal_direction,
          io_address: t.io_address,
          description: t.description,
        }));
        const representative = devTags[0];
        control_modules.push({
          control_module_id: devPrefix,
          control_module_name: representative.description || devPrefix,
          control_module_class: representative.control_module_class,
          description: representative.description || "",
          is_safety: devTags.some((t) => t.is_safety),
          io_signals: ioSignals,
        });
      }

      const allDescriptions = control_modules.map((d) => d.description).filter(Boolean);
      equipment_modules.push({
        equipment_module_id: asmPrefix,
        equipment_module_name: suggestAssemblyName(allDescriptions, asmPrefix),
        description: "",
        control_modules: control_modules.sort((a, b) => a.control_module_id.localeCompare(b.control_module_id)),
      });
    }

    const eqType = inferEquipmentType(subKey, subKey);
    units.push({
      unit_id: subKey,
      unit_name: subKey,
      equipment_type: eqType,
      description: "",
      equipment_modules: equipment_modules.sort((a, b) => a.equipment_module_id.localeCompare(b.equipment_module_id)),
      excluded: false,
    });
  }

  return units.sort((a, b) => a.unit_name.localeCompare(b.unit_name));
}

// ---------------------------------------------------------------------------
// Step 4 — Parse warnings
// ---------------------------------------------------------------------------

export function generateWarnings(tags: InstrumentTag[]): ParseWarning[] {
  const warnings: ParseWarning[] = [];
  const tagCounts = new Map<string, number>();

  for (const t of tags) {
    tagCounts.set(t.tag, (tagCounts.get(t.tag) ?? 0) + 1);

    if (t.control_module_class === "other") {
      warnings.push({
        tag: t.tag,
        reason: "Could not classify device type",
        severity: "warning",
      });
    }

    if (!t.io_address) {
      warnings.push({
        tag: t.tag,
        reason: "No IO address — may be an internal/virtual tag",
        severity: "info",
      });
    }
  }

  // Duplicate tags
  for (const [tag, count] of tagCounts) {
    if (count > 1) {
      warnings.push({
        tag,
        reason: `Duplicate tag (appears ${count} times)`,
        severity: "error",
      });
    }
  }

  // Small units
  const unitCounts = new Map<string, number>();
  for (const t of tags) {
    const sub = t.unit;
    if (sub) unitCounts.set(sub, (unitCounts.get(sub) ?? 0) + 1);
  }
  for (const [sub, count] of unitCounts) {
    if (count < 3) {
      warnings.push({
        tag: sub,
        reason: `Unit "${sub}" has only ${count} tag(s) — possibly a grouping error`,
        severity: "warning",
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Full parse pipeline
// ---------------------------------------------------------------------------

/**
 * Choose which worksheet holds the register data. Prefer a sheet named
 * "Register" (the template's data sheet), else the first sheet that is not an
 * "Instructions"/legend sheet, else the first sheet. This keeps multi-sheet
 * template workbooks parsing the data, not the legend.
 */
export function pickRegisterSheetName(names: string[]): string | undefined {
  return (
    names.find((n) => /register/i.test(n)) ??
    names.find((n) => !/instruction/i.test(n)) ??
    names[0]
  );
}

export interface ParseResult {
  tags: InstrumentTag[];
  units: UnitSummary[];
  warnings: ParseWarning[];
  usage: TokenUsage;
}

export async function parseInstrumentRegister(
  file: File,
  abortSignal: AbortSignal,
  onProgress?: (stage: string, done: number, total: number) => void
): Promise<ParseResult> {
  // Read file
  onProgress?.("Reading file", 0, 1);
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = pickRegisterSheetName(workbook.SheetNames);
  if (!sheetName) throw new Error("Excel file has no sheets");
  const sheet = workbook.Sheets[sheetName]!;

  // Detect columns
  onProgress?.("Detecting columns", 1, 4);
  const { mapping, headerRow } = detectColumns(sheet);

  // Extract rows
  onProgress?.("Extracting rows", 2, 4);
  const rawRows = extractRows(sheet, mapping, headerRow);
  if (rawRows.length === 0) throw new Error("No data rows found after header");

  // Step 2a — Deterministic classification from column data
  onProgress?.("Classifying tags", 0, rawRows.length);
  const deterministicResults = rawRows.map(classifyDeterministic);

  // Check which rows still need AI help (no control_module_class resolved)
  const needsAi = rawRows.filter((_, i) => !deterministicResults[i].control_module_class);
  let aiClassifications: TagClassification[] = [];
  let usage: TokenUsage = { input: 0, output: 0, total: 0 };

  if (needsAi.length > 0) {
    // Step 2b — AI classification for unresolved tags only (gracefully optional)
    try {
      const aiResult = await classifyTags(
        needsAi,
        abortSignal,
        (done, total) => onProgress?.("Classifying tags (AI)", done, total)
      );
      aiClassifications = aiResult.classifications;
      usage = aiResult.usage;
    } catch (aiErr) {
      // AI classification failed (auth, network, etc.) — fall back to deterministic-only
      console.warn("AI classification unavailable, using deterministic only:", aiErr);
      for (let k = 0; k < needsAi.length; k++) {
        aiClassifications.push({
          control_module_class: "other",
          signal_direction: "internal",
          process_cell: "",
          unit: "",
          equipment_module: "",
          control_module: "",
          is_safety: false,
        });
      }
    }
  }

  // Merge: deterministic first, AI fills gaps
  let aiIdx = 0;
  const tags: InstrumentTag[] = rawRows.map((row, i) => {
    const det = deterministicResults[i];
    let aiCls: TagClassification | null = null;
    if (!det.control_module_class) {
      aiCls = aiClassifications[aiIdx++] ?? null;
    }

    const safetyRaw = (row.is_safety_raw ?? "").trim().toLowerCase();
    const explicitSafety =
      safetyRaw === "" ? undefined : ["true", "yes", "1", "y"].includes(safetyRaw);

    return {
      tag: row.tag ?? "",
      device_type: row.device_type ?? "",
      description: row.description ?? "",
      signal_type: row.signal_type ?? "",
      io_address: row.io_address ?? "",
      control_module_class: det.control_module_class ?? aiCls?.control_module_class ?? "other",
      signal_direction: det.signal_direction ?? aiCls?.signal_direction ?? "internal",
      unit_prefix: row.unit || aiCls?.unit || "",
      // Explicit is_safety column (when present) overrides inferred safety.
      is_safety: explicitSafety ?? det.is_safety ?? aiCls?.is_safety ?? false,
      process_cell: row.process_cell || aiCls?.process_cell || "",
      unit: row.unit || aiCls?.unit || "",
      equipment_module: row.equipment_module || aiCls?.equipment_module || "",
      control_module: row.control_module || aiCls?.control_module || "",
    };
  });

  // Group units
  onProgress?.("Grouping units", 3, 4);
  const units = groupSubsystems(tags);

  // Generate warnings
  onProgress?.("Checking warnings", 4, 4);
  const warnings = generateWarnings(tags);

  return { tags, units, warnings, usage };
}
