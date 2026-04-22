/**
 * Deterministic FB/FC-role classifier — step 11 + taxonomy refresh
 * (see Docs/PAC_AUDIT_DERIVED_SPEC.md §5).
 *
 * Applies a multi-rule cascade in two passes:
 *   Pass 1 — leaves with intrinsic signals (ob, utility, safety, fault,
 *            sequence, io_mapper, device, comms). First rule to match wins.
 *   Pass 2 — containers + fallback (assembly, dispatcher, subsystem,
 *            tentative sequence, logic, unknown).
 *
 * No AI anywhere. Each classification carries a `rule_id` so the
 * engineer review panel can show *why* a block was classified.
 *
 * DB / UDT / SFB / SFC blocks are skipped — classification describes
 * logic blocks, not data storage. FB + FC + OB are all eligible.
 */

import type { AuditCrossReference, FbRole } from "@/types/audit";
import { detectFaultHandling } from "@/lib/audit-analysis/fault-handling-detector";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClassifyBlockInput {
  id: string;
  name: string;
  block_type: string;
  folder_id: string | null;
  /** Optional — only used by fault-write detection when available. */
  source_code?: string | null;
}

export interface ClassifyFolderInput {
  id: string;
  path: string;
}

export interface ClassifyUnderstandingInput {
  block_id: string;
  state_machine: { mechanism: string | null } | null;
}

export interface ClassifyInput {
  blocks: ClassifyBlockInput[];
  folders: ClassifyFolderInput[];
  crossReferences: AuditCrossReference[];
  understandings: ClassifyUnderstandingInput[];
}

export interface ClassifyResult {
  block_id: string;
  role: FbRole;
  rule_id: string;
  auto_reason: string;
}

// ---------------------------------------------------------------------------
// Regex patterns (§5.1)
// ---------------------------------------------------------------------------

const UTILITY_FOLDER_RE = /\/(Library|Libraries|Utilities|Utility)(\/|$)/i;
// Utility names: classic math/scaling helpers PLUS channel abstractions
// (DI_FB / DO_FB / AI_FB / AO_FB / DIGITAL_(INPUT|OUTPUT)_FB).
const UTILITY_NAME_RE =
  /^(PID|Scale|Ramp|Norm|Lim|Avg|DI|DO|AI|AO|DIGITAL_INPUT|DIGITAL_OUTPUT)_(FB|)/i;
const SAFETY_TAG_RE = /\b(ESTOP|E_STOP|DOOR_|LIGHT_CURTAIN|GUARD_|SAFETY_)/i;
const COMMS_NAME_RE = /^(HMI|DATA_EXCH|COMMS)_/i;
const IO_MAPPER_NAME_RE = /^(FC_)?(IO_MAP|MAP_IO|IO_HANDLER|IO_MAPPING|MAP_INPUTS|MAP_OUTPUTS|IO_DIGITAL|IO_ANALOG|FC_IO)/i;
const ABS_IO_ADDR_RE = /^%[IQ]/;

const READ_ACCESS = new Set(["Read", "ReadAndSymbol", "RW", "Modify"]);
const WRITE_ACCESS = new Set(["Write", "WriteAndSymbol", "RW", "Modify"]);
const IO_ACCESS = new Set([...READ_ACCESS, ...WRITE_ACCESS]);
const CALL_ACCESS = "Call";
const INSTANCE_ACCESS = new Set(["InstanceDB", "Multiinstance"]);

/** Threshold between "heavy IO touch = io_mapper" and
 *  "light IO touch = legacy device FB". Tunable. */
const IO_MAPPER_ADDRESS_THRESHOLD = 10;

/** Minimum peer count for the dispatcher rule. */
const DISPATCHER_MIN_PEERS = 3;

// ---------------------------------------------------------------------------
// Index builders — one pass over cross-refs, reused per rule
// ---------------------------------------------------------------------------

interface CrossRefIndex {
  bySource: Map<string, AuditCrossReference[]>;
  byTarget: Map<string, AuditCrossReference[]>;
}

function buildIndex(refs: AuditCrossReference[]): CrossRefIndex {
  const bySource = new Map<string, AuditCrossReference[]>();
  const byTarget = new Map<string, AuditCrossReference[]>();
  for (const r of refs) {
    const s = bySource.get(r.source_block_id) ?? [];
    s.push(r);
    bySource.set(r.source_block_id, s);
    if (r.target_block_id) {
      const t = byTarget.get(r.target_block_id) ?? [];
      t.push(r);
      byTarget.set(r.target_block_id, t);
    }
  }
  return { bySource, byTarget };
}

/** Distinct absolute-IO addresses (I/Q only) accessed by this block. */
function distinctAbsoluteIoAddresses(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
): string[] {
  const addrs = new Set<string>();
  const refs = index.bySource.get(block.id) ?? [];
  for (const r of refs) {
    if (!r.access || !IO_ACCESS.has(r.access)) continue;
    const addr = r.location_address ?? r.target_address ?? "";
    if (addr && ABS_IO_ADDR_RE.test(addr)) addrs.add(addr);
  }
  return [...addrs];
}

function hasStateMachine(
  block: ClassifyBlockInput,
  understandingByBlockId: Map<string, ClassifyUnderstandingInput>,
): boolean {
  const u = understandingByBlockId.get(block.id);
  if (!u?.state_machine) return false;
  const m = u.state_machine.mechanism;
  return m === "case_on_variable" || m === "step_counter" || m === "seal_in_latch_chain";
}

// ---------------------------------------------------------------------------
// Pass-1 rule predicates
// ---------------------------------------------------------------------------

function matchOb(block: ClassifyBlockInput): ClassifyResult | null {
  if (block.block_type === "OB") {
    return {
      block_id: block.id,
      role: "ob",
      rule_id: "R01_ob_block_type",
      auto_reason: "Block type is OB (organisation block).",
    };
  }
  return null;
}

function matchUtilityByFolder(
  block: ClassifyBlockInput,
  folderPathById: Map<string, string>,
): ClassifyResult | null {
  if (!block.folder_id) return null;
  const path = folderPathById.get(block.folder_id);
  if (!path) return null;
  if (UTILITY_FOLDER_RE.test(path)) {
    return {
      block_id: block.id,
      role: "utility",
      rule_id: "R02_utility_folder",
      auto_reason: `Located in utility-style folder: ${path}`,
    };
  }
  return null;
}

function matchUtilityByName(block: ClassifyBlockInput): ClassifyResult | null {
  if (UTILITY_NAME_RE.test(block.name)) {
    return {
      block_id: block.id,
      role: "utility",
      rule_id: "R03_utility_name",
      auto_reason: `Name matches utility pattern (PID/Scale/Ramp/Norm/Lim/Avg or channel abstraction DI/DO/AI/AO): ${block.name}`,
    };
  }
  return null;
}

function matchSafetyByTagReads(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
): ClassifyResult | null {
  const refs = index.bySource.get(block.id) ?? [];
  const hits: string[] = [];
  for (const r of refs) {
    if (!r.access || !READ_ACCESS.has(r.access)) continue;
    const target = r.location_name ?? r.target_name ?? "";
    if (!target) continue;
    if (SAFETY_TAG_RE.test(target)) {
      hits.push(target);
      if (hits.length >= 3) break;
    }
  }
  if (hits.length > 0) {
    return {
      block_id: block.id,
      role: "safety",
      rule_id: "R04_safety_tag_reads",
      auto_reason: `Reads safety-named tags (${hits.slice(0, 3).join(", ")}${hits.length >= 3 ? ", …" : ""})`,
    };
  }
  return null;
}

function matchFaultByWrites(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
): ClassifyResult | null {
  const refs = index.bySource.get(block.id) ?? [];
  // Reuse the analyze-side detector — it already looks for fault/alarm/
  // error symbols and fault-DB names in cross-refs + source.
  const detection = detectFaultHandling({
    source: block.source_code ?? null,
    crossReferences: refs,
  });
  if (!detection.detected) return null;
  // Require ≥2 fault signals to avoid classifying any block that touches
  // a single fault bit. True fault handlers aggregate many.
  const signalCount =
    detection.fault_writes.length + detection.fault_db_refs.length;
  if (signalCount < 2) return null;
  const sample = [...detection.fault_writes, ...detection.fault_db_refs]
    .slice(0, 3)
    .join(", ");
  return {
    block_id: block.id,
    role: "fault",
    rule_id: "R04b_fault_writes",
    auto_reason: `Writes ${signalCount} fault/alarm signals (${sample}${signalCount > 3 ? ", …" : ""})`,
  };
}

function matchSequenceByCase(
  block: ClassifyBlockInput,
  understandingByBlockId: Map<string, ClassifyUnderstandingInput>,
): ClassifyResult | null {
  const u = understandingByBlockId.get(block.id);
  if (u?.state_machine?.mechanism === "case_on_variable") {
    return {
      block_id: block.id,
      role: "sequence",
      rule_id: "R05_case_on_variable",
      auto_reason: "CASE-on-variable state machine detected in source.",
    };
  }
  return null;
}

function matchSequenceByCounterOrSealIn(
  block: ClassifyBlockInput,
  understandingByBlockId: Map<string, ClassifyUnderstandingInput>,
): ClassifyResult | null {
  const u = understandingByBlockId.get(block.id);
  const m = u?.state_machine?.mechanism;
  if (m === "step_counter" || m === "seal_in_latch_chain") {
    return {
      block_id: block.id,
      role: "sequence",
      rule_id: m === "step_counter" ? "R06_step_counter" : "R06_seal_in_latch_chain",
      auto_reason: `${m} state-machine mechanism detected in source.`,
    };
  }
  return null;
}

function matchIoMapperByName(block: ClassifyBlockInput): ClassifyResult | null {
  if (IO_MAPPER_NAME_RE.test(block.name)) {
    return {
      block_id: block.id,
      role: "io_mapper",
      rule_id: "R07a_io_mapper_name",
      auto_reason: `Name matches IO-mapping pattern (IO_MAP/MAP_IO/IO_HANDLER/IO_DIGITAL/IO_ANALOG): ${block.name}`,
    };
  }
  return null;
}

function matchIoMapperByCount(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
  understandingByBlockId: Map<string, ClassifyUnderstandingInput>,
): ClassifyResult | null {
  if (hasStateMachine(block, understandingByBlockId)) return null;
  const addrs = distinctAbsoluteIoAddresses(block, index);
  if (addrs.length <= IO_MAPPER_ADDRESS_THRESHOLD) return null;
  return {
    block_id: block.id,
    role: "io_mapper",
    rule_id: "R07b_io_mapper_heavy_io",
    auto_reason: `Touches ${addrs.length} absolute IO addresses with no state machine — flat IO translation pattern.`,
  };
}

function matchDeviceByLightIo(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
): ClassifyResult | null {
  const addrs = distinctAbsoluteIoAddresses(block, index);
  if (addrs.length === 0) return null;
  if (addrs.length > IO_MAPPER_ADDRESS_THRESHOLD) return null;
  return {
    block_id: block.id,
    role: "device",
    rule_id: "R07c_device_light_io",
    auto_reason: `Reads/writes ${addrs.length} absolute IO address(es): ${addrs.slice(0, 3).join(", ")}${addrs.length > 3 ? ", …" : ""}. Likely legacy-style device FB.`,
  };
}

function matchCommsByName(block: ClassifyBlockInput): ClassifyResult | null {
  if (COMMS_NAME_RE.test(block.name)) {
    return {
      block_id: block.id,
      role: "comms",
      rule_id: "R08_comms_name",
      auto_reason: `Name matches comms pattern (HMI/DATA_EXCH/COMMS prefix): ${block.name}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pass-2 predicates — need pass-1 results in `roleByBlockId`
// ---------------------------------------------------------------------------

function distinctInstantiatedTargets(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
): Set<string> {
  const refs = index.bySource.get(block.id) ?? [];
  const targets = new Set<string>();
  for (const r of refs) {
    if (!r.access || !INSTANCE_ACCESS.has(r.access)) continue;
    if (r.target_block_id) targets.add(r.target_block_id);
  }
  return targets;
}

function distinctCallers(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
): Set<string> {
  const refs = index.byTarget.get(block.id) ?? [];
  const callers = new Set<string>();
  for (const r of refs) {
    if (r.access !== CALL_ACCESS) continue;
    callers.add(r.source_block_id);
  }
  return callers;
}

function countOutboundCalls(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
): number {
  const refs = index.bySource.get(block.id) ?? [];
  const targets = new Set<string>();
  for (const r of refs) {
    if (r.access === CALL_ACCESS && r.target_block_id) targets.add(r.target_block_id);
  }
  return targets.size;
}

function matchAssemblyByDeviceChildren(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
  roleByBlockId: Map<string, FbRole>,
): ClassifyResult | null {
  const targets = distinctInstantiatedTargets(block, index);
  const deviceChildren = [...targets].filter((t) => roleByBlockId.get(t) === "device");
  if (deviceChildren.length >= 2) {
    return {
      block_id: block.id,
      role: "assembly",
      rule_id: "R09_instantiates_device_fbs_legacy",
      auto_reason: `Instantiates ${deviceChildren.length} device FBs (legacy assembly pattern).`,
    };
  }
  return null;
}

function matchDispatcher(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
  understandingByBlockId: Map<string, ClassifyUnderstandingInput>,
): ClassifyResult | null {
  // No state machine, no direct IO, instantiates ≥N peer FBs.
  if (hasStateMachine(block, understandingByBlockId)) return null;
  if (distinctAbsoluteIoAddresses(block, index).length > 0) return null;
  const targets = distinctInstantiatedTargets(block, index);
  if (targets.size < DISPATCHER_MIN_PEERS) return null;
  return {
    block_id: block.id,
    role: "dispatcher",
    rule_id: "R12_dispatcher",
    auto_reason: `Instantiates ${targets.size} peer FBs with no state machine or direct IO — bulk-caller pattern.`,
  };
}

function matchSubsystemOrTentativeSequence(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
  roleByBlockId: Map<string, FbRole>,
  blocksById: Map<string, ClassifyBlockInput>,
): ClassifyResult | null {
  const callers = distinctCallers(block, index);
  if (callers.size !== 1) return null;
  const [onlyCaller] = [...callers];
  const callerBlock = blocksById.get(onlyCaller);
  if (!callerBlock || callerBlock.block_type !== "OB") return null;

  const targets = distinctInstantiatedTargets(block, index);
  const assemblyChildren = [...targets].filter((t) => roleByBlockId.get(t) === "assembly");

  if (assemblyChildren.length >= 1) {
    return {
      block_id: block.id,
      role: "subsystem",
      rule_id: "R10_subsystem_ob_called_with_assembly",
      auto_reason: `Called once from OB "${callerBlock.name}" and instantiates ${assemblyChildren.length} assembly FB(s).`,
    };
  }
  return {
    block_id: block.id,
    role: "sequence",
    rule_id: "R11_sequence_ob_called_tentative",
    auto_reason: `Tentative: called once from OB "${callerBlock.name}" with no assembly children — likely a top-level sequence.`,
  };
}

/**
 * Logic fallback — block is "active" (has callers OR makes calls) but
 * didn't fit any specific pattern. Preferable to `unknown` because it
 * tells the engineer "this runs, probably project-specific glue" rather
 * than "no rule fired at all".
 */
function matchLogicFallback(
  block: ClassifyBlockInput,
  index: CrossRefIndex,
): ClassifyResult | null {
  const callers = distinctCallers(block, index);
  const outboundCalls = countOutboundCalls(block, index);
  if (callers.size === 0 && outboundCalls === 0) return null;
  return {
    block_id: block.id,
    role: "logic",
    rule_id: "R13_logic_fallback",
    auto_reason: `${callers.size} caller(s), ${outboundCalls} outbound call(s) — project-specific glue without a crisp role.`,
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function classifyBlocks(input: ClassifyInput): ClassifyResult[] {
  const index = buildIndex(input.crossReferences);
  const folderPathById = new Map<string, string>();
  for (const f of input.folders) folderPathById.set(f.id, f.path);
  const understandingByBlockId = new Map<string, ClassifyUnderstandingInput>();
  for (const u of input.understandings) understandingByBlockId.set(u.block_id, u);
  const blocksById = new Map<string, ClassifyBlockInput>();
  for (const b of input.blocks) blocksById.set(b.id, b);

  const eligible = input.blocks.filter((b) =>
    b.block_type === "OB" || b.block_type === "FB" || b.block_type === "FC",
  );

  const results = new Map<string, ClassifyResult>();

  // --- Pass 1 — first rule wins ----------------------------------------
  const pass1Rules: Array<(b: ClassifyBlockInput) => ClassifyResult | null> = [
    matchOb,
    (b) => matchUtilityByFolder(b, folderPathById),
    matchUtilityByName,
    (b) => matchSafetyByTagReads(b, index),
    (b) => matchFaultByWrites(b, index),
    (b) => matchSequenceByCase(b, understandingByBlockId),
    (b) => matchSequenceByCounterOrSealIn(b, understandingByBlockId),
    matchIoMapperByName,
    (b) => matchIoMapperByCount(b, index, understandingByBlockId),
    (b) => matchDeviceByLightIo(b, index),
    matchCommsByName,
  ];

  for (const block of eligible) {
    for (const rule of pass1Rules) {
      const match = rule(block);
      if (match) {
        results.set(block.id, match);
        break;
      }
    }
  }

  // --- Pass 2 — containers + fallback ---------------------------------
  const roleByBlockId = new Map<string, FbRole>();
  for (const r of results.values()) roleByBlockId.set(r.block_id, r.role);

  // Legacy assembly first (depends on device classification).
  for (const block of eligible) {
    if (results.has(block.id)) continue;
    const m = matchAssemblyByDeviceChildren(block, index, roleByBlockId);
    if (m) {
      results.set(block.id, m);
      roleByBlockId.set(block.id, m.role);
    }
  }

  // Dispatcher before subsystem — a block that both instantiates peers AND
  // is called once from an OB should be labelled as the more specific
  // "bulk caller" concept. Most real dispatchers don't have OB callers
  // anyway, but the ordering matters when they do.
  for (const block of eligible) {
    if (results.has(block.id)) continue;
    const m = matchDispatcher(block, index, understandingByBlockId);
    if (m) {
      results.set(block.id, m);
      roleByBlockId.set(block.id, m.role);
    }
  }

  for (const block of eligible) {
    if (results.has(block.id)) continue;
    const m = matchSubsystemOrTentativeSequence(block, index, roleByBlockId, blocksById);
    if (m) {
      results.set(block.id, m);
      roleByBlockId.set(block.id, m.role);
    }
  }

  // Logic fallback — active but unclassified.
  for (const block of eligible) {
    if (results.has(block.id)) continue;
    const m = matchLogicFallback(block, index);
    if (m) {
      results.set(block.id, m);
      roleByBlockId.set(block.id, m.role);
    }
  }

  // Truly nothing fired.
  for (const block of eligible) {
    if (results.has(block.id)) continue;
    results.set(block.id, {
      block_id: block.id,
      role: "unknown",
      rule_id: "R00_no_match",
      auto_reason: "No classification rule fired. Engineer to resolve.",
    });
  }

  return [...results.values()];
}

// ---------------------------------------------------------------------------
// Convenience — group results by role
// ---------------------------------------------------------------------------

export function countByRole(results: ClassifyResult[]): Record<FbRole, number> {
  const counts = {} as Record<FbRole, number>;
  const roles: FbRole[] = [
    "device", "io_mapper", "dispatcher", "assembly", "subsystem",
    "sequence", "utility", "safety", "comms", "fault", "logic",
    "ob", "unknown",
  ];
  for (const r of roles) counts[r] = 0;
  for (const r of results) counts[r.role] += 1;
  return counts;
}
