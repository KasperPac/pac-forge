import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildDeviceSclPrompt,
  buildDeviceSclUserMessage,
  buildDeviceLadPrompt,
  buildDeviceLadUserMessage,
  buildIoLinkingLadPrompt,
  buildDeviceCallFcPrompt,
  buildDeviceCallFcLadPrompt,
  buildDeviceCallFcUserMessage,
  generateDeviceCallFc,
  generateDeviceCallFcLad,
  generateInputsDb,
  generateOutputsDb,
  generateIoLinkingFc,
  generateGlobalDb,
  deviceTypeToFcName,
  getDeviceCallOrder,
  type DeviceGenContext,
  type DeviceCallFcContext,
} from "@/lib/forge-prompts";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import { parseGeneralRules, parseFolderRules, resolveDestinationFolder } from "@/lib/design-profile-schemas";
import type { ForgeSession, ForgeArtifact, ForgeDeviceEntry, ForgeIoEntry } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";
import type { ProcessLinkageMatrix, LinkageDevice } from "@/types/forge-matrix";
import { getRelevantReferenceSections, formatReferenceSections } from "@/lib/reference-lookup";
import { extractBlockName } from "@/lib/scl-block-parser";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";

const DEVICE_GEN_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the DB naming prefix from structured rules or flat field */
function resolveDbPrefix(profile: DesignProfile): string {
  const general = parseGeneralRules(profile.general_rules);
  return general.naming.db_prefix || profile.db_naming_prefix || "";
}

/** Resolve the instance DB prefix from structured rules (default "Inst") */
function resolveInstDbPrefix(profile: DesignProfile): string {
  const general = parseGeneralRules(profile.general_rules);
  return general.naming.instance_db_prefix || "Inst";
}

/** Resolve the FC prefix from structured rules or flat naming_prefix field */
function resolveFcPrefix(profile: DesignProfile): string {
  const general = parseGeneralRules(profile.general_rules);
  return general.naming.fc_prefix || profile.naming_prefix || "";
}

/**
 * After all device artifacts are collected, fix UDT type name mismatches in
 * DB artifacts (mainly the Configuration DB). The matrix AI invents UDT names
 * that may not exactly match the template's UDT block names.
 *
 * Strategy: for each `: typeSomething` reference in a DB that doesn't match
 * any existing UDT artifact name, find the closest UDT artifact by comparing
 * the name stem (strip "type" prefix, compare lowercase). If confidence is
 * high (one candidate clearly best), rewrite the reference.
 */
function reconcileUdtReferences(
  artifacts: ForgeArtifact[],
  log: (level: DeviceGenLogLevel, msg: string) => void,
): ForgeArtifact[] {
  const udtNames = artifacts.filter(a => a.type === "UDT").map(a => a.name);
  if (udtNames.length === 0) return artifacts;

  const udtSet = new Set(udtNames);

  // Strip "type" prefix and lowercase for fuzzy matching
  const stem = (name: string) => name.replace(/^type/i, "").toLowerCase();
  const udtStems = udtNames.map(n => ({ name: n, stem: stem(n) }));

  function bestMatch(typeName: string): string | null {
    if (udtSet.has(typeName)) return typeName; // exact match — nothing to do
    const s = stem(typeName);
    // Find UDT whose stem matches. Rules:
    // 1. Exact stem match (case-insensitive, "type" prefix stripped)
    // 2. Levenshtein distance ≤ threshold (typo correction only)
    // 3. Substring match ONLY if the shorter stem is at least 60% of the longer
    //    (prevents "estop" matching "pushbuttonconfig")
    const candidates = udtStems.filter(u => {
      if (u.stem === s) return true; // exact stem match
      const dist = levenshtein(u.stem, s);
      const threshold = Math.max(1, Math.floor(Math.min(u.stem.length, s.length) / 5));
      if (dist <= threshold) return true;
      // Substring match with length guard — short stems shouldn't match long unrelated ones
      const shorter = Math.min(u.stem.length, s.length);
      const longer = Math.max(u.stem.length, s.length);
      if (shorter / longer >= 0.6 && (u.stem.includes(s) || s.includes(u.stem))) return true;
      return false;
    });
    if (candidates.length === 1) return candidates[0].name;
    // If multiple candidates, pick shortest-stem distance
    if (candidates.length > 1) {
      candidates.sort((a, b) => levenshtein(a.stem, s) - levenshtein(b.stem, s));
      return candidates[0].name;
    }
    return null;
  }

  return artifacts.map(a => {
    if (a.type !== "DB") return a;
    // Find all ": typeXxx" references in the DB content
    let content = a.content;
    const typeRefs = [...new Set((content.match(/:\s*(type[A-Za-z0-9]+)/g) ?? [])
      .map(r => r.replace(/^:\s*/, "")))];
    for (const ref of typeRefs) {
      if (udtSet.has(ref)) continue; // already correct
      const fix = bestMatch(ref);
      if (fix && fix !== ref) {
        log("fix", `UDT name corrected in ${a.name}: "${ref}" → "${fix}"`);
        content = content.replaceAll(ref, fix);
      } else if (!fix) {
        // Remove lines referencing this phantom UDT — better to drop the field
        // than leave a broken type reference that prevents compilation.
        const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const removedContent = content.replace(
          new RegExp(`^[^\\S\\n]*\\w+\\s*:\\s*${escaped}\\s*;[^\\n]*\\n?`, "gm"),
          "",
        );
        if (removedContent !== content) {
          log("fix", `Phantom UDT field "${ref}" removed from ${a.name} — no matching UDT artifact exists`);
          content = removedContent;
        } else {
          log("warn", `UDT "${ref}" in ${a.name} has no matching UDT artifact — will cause compile error`);
        }
      }
    }
    return content !== a.content ? { ...a, content } : a;
  });
}

/**
 * Normalize instance DB names across all artifacts.
 *
 * Problem: AI may generate "InstPB_Start" while the deterministic formula yields "InstPBStart"
 * (stripping special chars). The Device Call FC uses the deterministic formula, so they
 * never agree. Fix: rename every AI-generated instance DB to the deterministic name, then
 * update all cross-references in other artifacts.
 *
 * Also updates the matrix-provided instanceDbName in the Device Call FC content when the
 * matrix used a different naming convention.
 */
function normalizeInstanceDbNames(
  artifacts: ForgeArtifact[],
  devices: ForgeDeviceEntry[],
  log: (level: DeviceGenLogLevel, msg: string) => void,
  instDbPrefix = "Inst",
): ForgeArtifact[] {
  // Build canonical name map: any "Inst..." DB → canonical deterministic name
  const canonicalName = (deviceName: string) => `${instDbPrefix}${deviceName.replace(/[^A-Za-z0-9]/g, "")}`;
  const renames = new Map<string, string>(); // oldName → newName

  for (const device of devices) {
    const canonical = canonicalName(device.name);
    // Find instance DBs for this device — name starts with prefix and fuzzy-matches device name
    const deviceStem = device.name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const prefixRe = new RegExp(`^${instDbPrefix}`, "i");
    for (const a of artifacts) {
      if (a.type !== "DB" || !prefixRe.test(a.name)) continue;
      if (a.name === canonical) continue; // already correct
      const currentStem = a.name.replace(prefixRe, "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
      if (currentStem === deviceStem) {
        renames.set(a.name, canonical);
        log("fix", `Instance DB renamed: "${a.name}" → "${canonical}"`);
      }
    }
  }

  if (renames.size === 0) return artifacts;

  return artifacts.map(a => {
    // Rename the DB artifact itself
    if (a.type === "DB" && renames.has(a.name)) {
      const newName = renames.get(a.name)!;
      const content = a.content.replace(
        new RegExp(`DATA_BLOCK\\s+"${a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"),
        `DATA_BLOCK "${newName}"`,
      );
      return { ...a, name: newName, content };
    }
    // Update all references in other artifacts
    let content = a.content;
    let changed = false;
    for (const [oldName, newName] of renames) {
      const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match quoted references: "InstPB_Start"( or "InstPB_Start".field
      const re = new RegExp(`"${escaped}"`, "g");
      if (re.test(content)) {
        content = content.replace(re, `"${newName}"`);
        changed = true;
      }
    }
    return changed ? { ...a, content } : a;
  });
}

/**
 * Scan Device Call FCs for "DbName".fieldName references to global DBs (HmiData,
 * Configuration, FaultData, etc.) and add any missing fields to those DB artifacts.
 *
 * Type inference strategy (in priority order):
 * 1. FB param type: if the field appears as `paramName := "DbName".fieldName` in an FC
 *    and `paramName` has a known type from a FB VAR_INPUT section, use that type.
 * 2. Name heuristic: keywords anywhere in the name (delay/timeout/duration → Time,
 *    mode/count/status/code/index/step/state → Int, Config suffix → look for matching UDT).
 * 3. Default → Bool.
 */
function backfillGlobalDbFields(
  artifacts: ForgeArtifact[],
  log: (level: DeviceGenLogLevel, msg: string) => void,
  instDbPrefix = "Inst",
): ForgeArtifact[] {
  const globalDbs = artifacts.filter(
    a => a.type === "DB" && !a.name.startsWith(instDbPrefix) && a.name !== "Inputs" && a.name !== "Outputs",
  );
  if (globalDbs.length === 0) return artifacts;
  const globalDbNames = new Set(globalDbs.map(db => db.name));
  // Also resolve DB names without prefix: "HmiData" → "DB_HmiData"
  const globalDbNameResolve = new Map<string, string>(); // referenced name → actual artifact name
  for (const name of globalDbNames) {
    globalDbNameResolve.set(name, name);
    if (name.startsWith("DB_")) globalDbNameResolve.set(name.slice(3), name);
  }

  function parseDbFields(content: string): Map<string, string> {
    const fields = new Map<string, string>(); // fieldName → currentType
    // Match field declarations with optional := default values and // comments
    const re = /^\s{2,}(\w+)\s*:\s*"?([\w.]+)"?(?:\s*:=[^;]*)?;/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) fields.set(m[1], m[2]);
    return fields;
  }

  // Build paramName → SCL data type from all FB sections (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, VAR/static)
  const fbParamTypes = new Map<string, string>(); // paramName → dataType
  for (const a of artifacts) {
    if (a.type !== "FB" || a.language !== "SCL") continue;
    // Match all VAR sections including static VAR (for UDT outputs like ERROR_Motor)
    const varRe = /(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR\b)([\s\S]*?)END_VAR/gi;
    let vm: RegExpExecArray | null;
    while ((vm = varRe.exec(a.content)) !== null) {
      const fieldRe = /^\s+(\w+)\s*:\s*"?([\w.]+)"?/gm;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRe.exec(vm[2])) !== null) {
        if (!fbParamTypes.has(fm[1])) fbParamTypes.set(fm[1], fm[2]);
      }
    }
  }

  // Build UDT name list for Config-type matching
  const udtNames = artifacts.filter(a => a.type === "UDT").map(a => a.name);

  // Resolve a UDT type for "...Config" fields by matching field stem to known UDT names.
  // This is the only case where we can't read the type from an FB param directly —
  // UDT config params are wired as structs, and we need to know which UDT type to declare.
  function resolveConfigType(fieldName: string): string | null {
    const lower = fieldName.toLowerCase();
    if (!lower.endsWith("config")) return null;
    const fieldStem = lower.slice(0, -6);
    let best: string | null = null;
    let bestDist = Infinity;
    for (const udt of udtNames) {
      const udtStem = udt.replace(/^type/i, "").replace(/Config$/i, "").toLowerCase();
      if (udtStem.length === 0) continue;
      const dist = levenshtein(fieldStem, udtStem);
      const relDist = dist / Math.max(fieldStem.length, udtStem.length);
      if (relDist < 0.5 && dist < bestDist) { bestDist = dist; best = udt; }
    }
    return best ?? null;
  }

  // Collect DB field references with best-effort type inference.
  // authoritative=true means the type came from an FB VAR_INPUT/OUTPUT declaration — trust it to
  // correct existing wrong types. authoritative=false means it came from a name heuristic — only
  // use it to fill in missing fields, never to overwrite what's already there.
  type FieldRef = { dataType: string; authoritative: boolean };
  const fcArtifacts = artifacts.filter(a => a.type === "FC" || a.type === "OB");
  const dbFieldRefs = new Map<string, Map<string, FieldRef>>(); // dbName → fieldName → ref

  function setRef(dbName: string, fieldName: string, ref: FieldRef) {
    if (!dbFieldRefs.has(dbName)) dbFieldRefs.set(dbName, new Map());
    const existing = dbFieldRefs.get(dbName)!.get(fieldName);
    // Authoritative always wins; don't downgrade an authoritative entry with a heuristic one
    if (!existing || (!existing.authoritative && ref.authoritative)) {
      dbFieldRefs.get(dbName)!.set(fieldName, ref);
    }
  }

  for (const fc of fcArtifacts) {
    let m: RegExpExecArray | null;

    // Pattern 1: paramName := "DbName".fieldName — FB input param wired FROM a global DB
    // e.g. clearDelay := "Configuration".pe01ClearDly  →  exact type from FB VAR_INPUT clearDelay
    const paramAssignRe = /(\w+)\s*:=\s*"([A-Za-z][A-Za-z0-9_]*)"\s*\.\s*([A-Za-z]\w*)/g;
    while ((m = paramAssignRe.exec(fc.content)) !== null) {
      const [, paramName, dbName, fieldName] = m;
      const resolvedDb = globalDbNameResolve.get(dbName);
      if (!resolvedDb) continue;
      const fbType = fbParamTypes.get(paramName);
      if (fbType) {
        setRef(resolvedDb, fieldName, { dataType: fbType, authoritative: true });
      } else {
        // UDT config structs won't be in fbParamTypes — try UDT name match
        const udt = resolveConfigType(fieldName);
        if (udt) setRef(resolvedDb, fieldName, { dataType: udt, authoritative: true });
        // Otherwise: unknown type — don't guess, skip
      }
    }

    // Pattern 2a: outputName => "DbName".fieldName — named output param in an FB call (=> syntax)
    // e.g. SensorDlyOnOff => "HmiData".pe01SensorDlyOnOff  →  exact type from FB VAR_OUTPUT SensorDlyOnOff
    const outputAssocRe = /(\w+)\s*=>\s*"([A-Za-z][A-Za-z0-9_]*)"\s*\.\s*([A-Za-z]\w*)/g;
    while ((m = outputAssocRe.exec(fc.content)) !== null) {
      const [, fbOutputName, dbName, fieldName] = m;
      const resolvedDb = globalDbNameResolve.get(dbName);
      if (!resolvedDb) continue;
      const fbType = fbParamTypes.get(fbOutputName);
      if (fbType) setRef(resolvedDb, fieldName, { dataType: fbType, authoritative: true });
    }

    // Pattern 2b: "DbName".fieldName := "Inst...".outputName — explicit assignment style
    // e.g. "HmiData".pe01Status := "InstPE01".status
    const outputWriteRe = /"([A-Za-z][A-Za-z0-9_]*)"\s*\.\s*([A-Za-z]\w*)\s*:=\s*"Inst[A-Za-z0-9_]*"\s*\.\s*([A-Za-z]\w*)/g;
    while ((m = outputWriteRe.exec(fc.content)) !== null) {
      const [, dbName, fieldName, fbOutputName] = m;
      const resolvedDb = globalDbNameResolve.get(dbName);
      if (!resolvedDb) continue;
      const fbType = fbParamTypes.get(fbOutputName);
      if (fbType) setRef(resolvedDb, fieldName, { dataType: fbType, authoritative: true });
    }
  }

  // Scan LAD artifacts (JSON content) for global DB references in callParams
  const ladArtifacts = artifacts.filter(a => a.language === "LAD" && (a.type === "FC" || a.type === "OB"));
  for (const lad of ladArtifacts) {
    try {
      const program = JSON.parse(lad.content);
      for (const rung of (program.rungs ?? [])) {
        const nodes = rung?.logic?.nodes ?? [];
        for (const node of nodes) {
          const el = node?.element;
          if (!el?.callParams) continue;
          for (const param of el.callParams) {
            const value = param.value?.trim();
            if (!value) continue;
            // Parse "DbName".fieldName pattern from the value string
            const dbRef = value.match(/^"([A-Za-z][A-Za-z0-9_]*)"\s*\.\s*([A-Za-z]\w*)$/);
            if (!dbRef) continue;
            const [, dbName, fieldName] = dbRef;
            const resolvedDb = globalDbNameResolve.get(dbName);
            if (!resolvedDb) continue;
            // Use the FB param's data type as the authoritative source
            const fbType = fbParamTypes.get(param.name);
            if (fbType) {
              setRef(resolvedDb, fieldName, { dataType: fbType, authoritative: true });
            } else {
              // Infer from the param's dataType field
              const paramType = param.dataType;
              if (paramType && paramType !== "Variant") {
                setRef(resolvedDb, fieldName, { dataType: paramType, authoritative: false });
              }
            }
          }
        }
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return artifacts.map(a => {
    if (a.type !== "DB") return a;
    const refs = dbFieldRefs.get(a.name);
    if (!refs || refs.size === 0) return a;

    const existing = parseDbFields(a.content);
    const toAdd: string[] = [];
    let corrected = a.content;
    let correctedCount = 0;

    // UDT types (starting with "type" or containing uppercase after first char) need quotes in SCL
    const needsQuotes = (t: string) => /^(type|udt)/i.test(t) || /^[A-Z]/.test(t) && !/^(Bool|Int|DInt|Real|LReal|Word|DWord|Byte|String|WString|Time|LTime|Date|USInt|UInt|UDInt|SInt|LInt|ULInt|Char|WChar|Array)$/i.test(t);
    const formatType = (t: string) => needsQuotes(t) ? `"${t}"` : t;

    for (const [fieldName, { dataType, authoritative }] of refs) {
      const currentType = existing.get(fieldName);
      if (currentType === undefined) {
        // Field missing — add it (quote UDT types)
        toAdd.push(`    ${fieldName} : ${formatType(dataType)};`);
      } else if (authoritative && currentType.toLowerCase() !== dataType.toLowerCase()) {
        // Type mismatch and we have an authoritative source (FB param declaration) — correct it
        const fieldRe = new RegExp(`(^\\s{4}${fieldName}\\s*:\\s*)"?[\\w.]+"?\\s*;`, "m");
        const fixed = corrected.replace(fieldRe, `$1${formatType(dataType)};`);
        if (fixed !== corrected) {
          corrected = fixed;
          correctedCount++;
          log("fix", `${a.name} DB: corrected "${fieldName}" type ${currentType} → ${dataType} (FB param declaration)`);
        }
      }
    }

    if (toAdd.length === 0 && correctedCount === 0) return a;

    let newContent = corrected;
    if (toAdd.length > 0) {
      const insertPoint = newContent.lastIndexOf("  END_VAR");
      if (insertPoint === -1) return a;
      newContent =
        newContent.slice(0, insertPoint) +
        toAdd.join("\n") + "\n" +
        newContent.slice(insertPoint);
      log("fix", `${a.name} DB: added ${toAdd.length} missing field(s) referenced by Device Call FCs`);
    }

    return { ...a, content: newContent };
  });
}

/**
 * After Device Call FCs are generated, scan their content for "Inst..." DB references
 * that don't match any generated DB artifact. For each broken ref, find the closest
 * canonical match and replace it.
 *
 * This catches the case where the AI copies instanceDbName from the matrix wiring
 * code sample (e.g. "InstPB_START") when the actual generated DB uses the canonical
 * formula (e.g. "InstPBSTART").
 */
function fixFcInstanceDbReferences(
  artifacts: ForgeArtifact[],
  log: (level: DeviceGenLogLevel, msg: string) => void,
  instDbPrefix = "Inst",
): ForgeArtifact[] {
  const dbNames = new Set(artifacts.filter(a => a.type === "DB").map(a => a.name));
  const instDbNames = [...dbNames].filter(n => n.startsWith(instDbPrefix));

  return artifacts.map(a => {
    if (a.type !== "FC" && a.type !== "OB") return a;

    let content = a.content;
    let changed = false;

    // Collect all "prefix..." references in this artifact
    const refs = new Set<string>();
    const escapedPrefix = instDbPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const instRefRe = new RegExp(`"(${escapedPrefix}[A-Za-z0-9_]+)"`, "g");
    let m: RegExpExecArray | null;
    while ((m = instRefRe.exec(content)) !== null) {
      refs.add(m[1]);
    }

    for (const ref of refs) {
      if (dbNames.has(ref)) continue; // already exists — nothing to fix

      // Find canonical DB whose stripped stem matches
      const prefixRe = new RegExp(`^${escapedPrefix}`, "i");
      const refStem = ref.replace(prefixRe, "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
      const best = instDbNames.find(n => {
        const nStem = n.replace(/^Inst/i, "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
        return nStem === refStem;
      });

      if (best) {
        const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        content = content.replace(new RegExp(`"${escaped}"`, "g"), `"${best}"`);
        log("fix", `FC instance ref corrected in ${a.name}: "${ref}" → "${best}"`);
        changed = true;
      } else {
        log("warn", `FC "${a.name}" references "${ref}" but no matching DB was generated`);
      }
    }

    return changed ? { ...a, content } : a;
  });
}

/**
 * Remove duplicate named parameter assignments within FB instance calls.
 * TIA Portal errors with "Parameter 'x' exists twice" if the same param appears
 * more than once in a named-association call.
 */
function deduplicateFbCallParams(
  artifacts: ForgeArtifact[],
  log: (level: DeviceGenLogLevel, msg: string) => void,
): ForgeArtifact[] {
  return artifacts.map(a => {
    if (a.type !== "FC" && a.type !== "OB") return a;

    const lines = a.content.split("\n");
    const newLines: string[] = [];
    let changed = false;
    let inCall = false;
    let seenParams = new Set<string>();
    let callInstName = "";

    for (const line of lines) {
      if (!inCall) {
        // Detect start of named-association FB call: "InstName"(
        const startMatch = line.match(/"(Inst[^"]+)"\s*\(/);
        if (startMatch) {
          callInstName = startMatch[1];
          seenParams = new Set();
          inCall = true;
          // Call may end on same line
          if (/\);\s*$/.test(line)) inCall = false;
        }
        newLines.push(line);
        continue;
      }

      // End of call
      if (/^\s*\);\s*$/.test(line)) {
        inCall = false;
        newLines.push(line);
        continue;
      }

      // Named parameter line: "  paramName := value," or "  paramName => target,"
      const paramMatch = line.match(/^\s+(\w+)\s*(?::=|=>)/);
      if (paramMatch) {
        const paramName = paramMatch[1];
        if (seenParams.has(paramName)) {
          log("fix", `Duplicate param "${paramName}" removed from ${a.name} (call to "${callInstName}")`);
          changed = true;
          continue;
        }
        seenParams.add(paramName);
      }
      newLines.push(line);
    }

    return changed ? { ...a, content: newLines.join("\n") } : a;
  });
}

/**
 * Remove duplicate field declarations within DB artifacts.
 * AI may generate the same field twice (once with defaults, once without).
 * Keeps the first occurrence (which typically has comments/defaults).
 */
function deduplicateDbFields(
  artifacts: ForgeArtifact[],
  log: (level: DeviceGenLogLevel, msg: string) => void,
): ForgeArtifact[] {
  return artifacts.map(a => {
    if (a.type !== "DB") return a;
    const lines = a.content.split("\n");
    const newLines: string[] = [];
    const seenFields = new Set<string>();
    let changed = false;

    for (const line of lines) {
      // Match field declaration: "    fieldName : Type"
      const fieldMatch = line.match(/^\s+(\w+)\s*:/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1].toLowerCase();
        if (seenFields.has(fieldName)) {
          log("fix", `Duplicate field "${fieldMatch[1]}" removed from ${a.name}`);
          changed = true;
          continue;
        }
        seenFields.add(fieldName);
      }
      newLines.push(line);
    }

    return changed ? { ...a, content: newLines.join("\n") } : a;
  });
}

/**
 * For each "InstXxx".fieldName reference in FCs, check whether fieldName exists in
 * the FB's VAR_OUTPUT or VAR_IN_OUT section. If not, find the closest matching output
 * by Levenshtein distance and replace, or log a warning with available options.
 */
function fixFbInstanceFieldRefs(
  artifacts: ForgeArtifact[],
  log: (level: DeviceGenLogLevel, msg: string) => void,
  instDbPrefix = "Inst",
): ForgeArtifact[] {
  // Build instDbName → FB artifact map
  const instToFb = new Map<string, ForgeArtifact>();
  const fbByName = new Map(artifacts.filter(a => a.type === "FB" && a.language === "SCL").map(a => [a.name, a]));

  for (const a of artifacts) {
    if (a.type !== "DB" || !a.name.startsWith(instDbPrefix)) continue;
    // Instance DB content has the FB type name on its own quoted line
    for (const line of a.content.split("\n")) {
      const stripped = line.trim();
      if (stripped.startsWith('"') && stripped.endsWith('"') && !stripped.includes(":")) {
        const fbName = stripped.slice(1, -1);
        if (fbByName.has(fbName)) { instToFb.set(a.name, fbByName.get(fbName)!); break; }
      }
    }
  }
  if (instToFb.size === 0) return artifacts;

  // Build instDbName → accessible output field names
  const fbOutputs = new Map<string, string[]>();
  for (const [instName, fb] of instToFb) {
    const fields: string[] = [];
    const sectionRe = /(VAR_OUTPUT|VAR_IN_OUT)([\s\S]*?)END_VAR/gi;
    let sm: RegExpExecArray | null;
    while ((sm = sectionRe.exec(fb.content)) !== null) {
      const fieldRe = /^\s+(\w+)\s*:/gm;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRe.exec(sm[2])) !== null) fields.push(fm[1]);
    }
    if (fields.length > 0) fbOutputs.set(instName, fields);
  }

  return artifacts.map(a => {
    if (a.type !== "FC" && a.type !== "OB") return a;

    // Collect all "InstXxx".fieldName refs
    const refs = new Map<string, Set<string>>();
    const refRe = /"(Inst[A-Za-z0-9_]+)"\.(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(a.content)) !== null) {
      if (!refs.has(m[1])) refs.set(m[1], new Set());
      refs.get(m[1])!.add(m[2]);
    }

    let content = a.content;
    let changed = false;

    for (const [instName, fieldNames] of refs) {
      const validFields = fbOutputs.get(instName);
      if (!validFields || validFields.length === 0) continue;
      const validSet = new Set(validFields);

      for (const fieldName of fieldNames) {
        if (validSet.has(fieldName)) continue;

        const stem = fieldName.toLowerCase();
        let bestField: string | null = null;
        let bestDist = Infinity;
        for (const vf of validFields) {
          const d = levenshtein(stem, vf.toLowerCase());
          if (d < bestDist) { bestDist = d; bestField = vf; }
        }

        const threshold = Math.max(2, Math.floor(stem.length / 3));
        if (bestField && bestDist <= threshold) {
          const escaped = instName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          content = content.replace(
            new RegExp(`"${escaped}"\\.(${fieldName})(?=\\b)`, "g"),
            `"${instName}".${bestField}`,
          );
          log("fix", `Instance field corrected in ${a.name}: "${instName}".${fieldName} → "${instName}".${bestField}`);
          changed = true;
        } else {
          log("warn", `${a.name}: "${instName}".${fieldName} not in FB outputs — available: [${validFields.join(", ")}]`);
        }
      }
    }

    return changed ? { ...a, content } : a;
  });
}

/** Simple Levenshtein distance for short UDT stem comparison. */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/**
 * Scan ALL matrix wiring connectedTo values for global DB field references.
 * Add any missing fields to the global DB artifacts BEFORE Device Call FCs are generated.
 * This ensures the DBs have all required fields regardless of whether the FC generator
 * includes them (SCL AI might, deterministic LAD might filter some out).
 */
function backfillGlobalDbFieldsFromWiring(
  artifacts: ForgeArtifact[],
  matrix: ProcessLinkageMatrix | null,
  fbArtifacts: ForgeArtifact[],
  log: (level: DeviceGenLogLevel, msg: string) => void,
  instDbPrefix = "Inst",
  dbPrefix = "",
): ForgeArtifact[] {
  if (!matrix?.deviceLinkage) return artifacts;

  // Identify global DB artifacts (not Inputs/instance DBs)
  // Outputs DB IS included — device FB outputs (e.g., motor CMD signals) must be backfilled.
  const inputsName = `${dbPrefix}Inputs`;
  const outputsName = `${dbPrefix}Outputs`;
  const globalDbs = artifacts.filter(
    a => a.type === "DB" && !a.name.startsWith(instDbPrefix) && a.name !== inputsName,
  );
  if (globalDbs.length === 0) return artifacts;

  const globalDbNames = new Set(globalDbs.map(db => db.name));
  // Also match without DB_ prefix
  const globalDbNameMap = new Map<string, string>(); // lowercase variants → actual name
  for (const name of globalDbNames) {
    globalDbNameMap.set(name.toLowerCase(), name);
    if (name.startsWith("DB_")) globalDbNameMap.set(name.slice(3).toLowerCase(), name);
  }

  // Build FB param types from all FB artifacts (including static VAR for UDT outputs like ERROR_Motor)
  const fbParamTypes = new Map<string, string>(); // paramName → dataType
  for (const a of [...fbArtifacts, ...artifacts.filter(a => a.type === "FB")]) {
    if (a.language !== "SCL") continue;
    const varRe = /(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR\b)([\s\S]*?)END_VAR/gi;
    let vm: RegExpExecArray | null;
    while ((vm = varRe.exec(a.content)) !== null) {
      const fieldRe = /^\s+(\w+)\s*:\s*"?([\w.]+)"?/gm;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRe.exec(vm[2])) !== null) {
        if (!fbParamTypes.has(fm[1])) fbParamTypes.set(fm[1], fm[2]);
      }
    }
  }

  // Parse existing DB fields
  function parseDbFields(content: string): Set<string> {
    const fields = new Set<string>();
    const re = /^\s+(\w+)\s*:/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) fields.add(m[1]);
    return fields;
  }

  // Normalize a field name for semantic deduplication.
  // Strips common abbreviation differences: cmd↔command, fwd↔forward, rev↔reverse
  function normalizeFieldName(name: string): string {
    return name.toLowerCase()
      .replace(/command/g, "cmd")
      .replace(/forward/g, "fwd")
      .replace(/reverse/g, "rev")
      .replace(/reset/g, "rst")
      .replace(/error/g, "err")
      .replace(/_/g, "");
  }

  // Check if a semantically equivalent field already exists
  function hasSimilarField(existing: Set<string>, candidate: string): string | null {
    const normCandidate = normalizeFieldName(candidate);
    for (const field of existing) {
      if (normalizeFieldName(field) === normCandidate) return field;
    }
    return null;
  }

  // Collect all wiring references to global DBs
  // Stores paramName alongside dataType so we can look up FB interface types by the original param name
  const dbFieldsToAdd = new Map<string, Map<string, { dataType: string; paramName: string }>>(); // dbName → fieldName → { dataType, paramName }

  for (const device of matrix.deviceLinkage) {
    for (const wire of device.wiring) {
      // Check both "global" wireType AND "fb" wireType — the matrix AI may tag
      // global DB references as "fb" since they look like DB.field references.
      if (wire.wireType !== "global" && wire.wireType !== "fb") continue;
      const connectedTo = wire.connectedTo ?? "";
      const dotIdx = connectedTo.indexOf(".");
      if (dotIdx === -1) continue;

      const rawDbName = connectedTo.slice(0, dotIdx);
      const fieldName = connectedTo.slice(dotIdx + 1);
      if (!fieldName) continue;

      // Resolve DB name (try exact, then without DB_ prefix, case-insensitive)
      const resolvedDbName = globalDbNameMap.get(rawDbName.toLowerCase());
      if (!resolvedDbName) continue;

      // For "fb" wires: skip if this is actually an instance DB reference, not a global DB
      if (wire.wireType === "fb") {
        const dbStripped = rawDbName.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
        const looksLikeInstDb = dbStripped.startsWith(instDbPrefix.toLowerCase());
        if (looksLikeInstDb) continue; // instance DB cross-reference, not a global DB
      }

      // Determine data type: from wire.dataType, from FB param, from UDT match, or from name heuristic.
      // Priority: (1) explicit wire dataType, (2) FB interface declaration, (3) UDT artifact match, (4) name heuristic.
      let dataType = wire.dataType;
      if (!dataType || dataType === "Variant") {
        // Try exact param name from FB interface
        dataType = fbParamTypes.get(wire.paramName) ?? undefined;
      }
      if (!dataType || dataType === "Variant") {
        // Try the field name itself (sometimes matrix field name matches FB param name)
        dataType = fbParamTypes.get(fieldName) ?? undefined;
      }
      if (!dataType || dataType === "Variant") {
        // Try matching paramName against UDT artifact names.
        // e.g., paramName "ERROR_Motor" → UDT artifact "udtError_Motor"
        // e.g., paramName "HMI_MotorControl" → UDT artifact "udtHMI_MotorControl"
        const paramLower = wire.paramName.toLowerCase().replace(/_/g, "");
        for (const a of [...fbArtifacts, ...artifacts]) {
          if (a.type !== "UDT") continue;
          const udtLower = a.name.toLowerCase().replace(/^type|^udt/i, "").replace(/_/g, "");
          if (udtLower === paramLower || paramLower === udtLower) {
            dataType = a.name;
            break;
          }
        }
      }
      if (dataType && !/^(Bool|Int|Real|Time|DInt|LInt|SInt|USInt|UInt|UDInt|Word|DWord|LWord|Byte|Char|LReal|LTime|S5Time|Date|TimeOfDay|DateTime|String)$/i.test(dataType)) {
        // dataType is a UDT name — keep it as-is (will be quoted in SCL declaration)
      }
      if (!dataType) {
        // Name-based heuristics — conservative, prefer Int/Word over Bool for ambiguous names
        const lower = fieldName.toLowerCase();
        if (lower.includes("status") || lower.includes("state") || lower.includes("step")) dataType = "Int";
        else if (lower.includes("direction") || lower.includes("mode") || lower.includes("count") || lower.includes("code")) dataType = "Int";
        else if (lower.includes("speed") || lower.includes("temp") || lower.includes("level") || lower.includes("value") || lower.includes("setpoint")) dataType = "Real";
        else if (lower.includes("dly") || lower.includes("delay") || lower.includes("time") || lower.includes("duration") || lower.includes("timeout")) dataType = "Time";
        else if (lower.includes("fault") || lower.includes("run") || lower.includes("stop") || lower.includes("busy") || lower.includes("idle") || lower.includes("active") || lower.includes("faulted") || lower.includes("enable") || lower.includes("forced") || lower.includes("hold") || lower.includes("running") || lower.includes("sensor") || lower.includes("pressed") || lower.includes("ok") || lower.includes("error") || lower.includes("reset") || lower.includes("cmd")) dataType = "Bool";
        else dataType = "Bool"; // safe default
      }

      if (!dbFieldsToAdd.has(resolvedDbName)) dbFieldsToAdd.set(resolvedDbName, new Map());
      if (!dbFieldsToAdd.get(resolvedDbName)!.has(fieldName)) {
        dbFieldsToAdd.get(resolvedDbName)!.set(fieldName, { dataType, paramName: wire.paramName });
      }
    }
  }

  if (dbFieldsToAdd.size === 0) return artifacts;

  return artifacts.map(a => {
    if (a.type !== "DB") return a;
    const fieldsMap = dbFieldsToAdd.get(a.name);
    if (!fieldsMap || fieldsMap.size === 0) return a;

    const existing = parseDbFields(a.content);
    const toAdd: string[] = [];
    // UDT types need quotes in SCL declarations
    const needsQ = (t: string) => /^(type|udt)/i.test(t) || /^[A-Z]/.test(t) && !/^(Bool|Int|DInt|Real|LReal|Word|DWord|Byte|String|WString|Time|LTime|Date|USInt|UInt|UDInt|SInt|LInt|ULInt|Char|WChar|Array)$/i.test(t);
    for (const [fieldName, { dataType, paramName }] of fieldsMap) {
      if (existing.has(fieldName)) continue; // exact match exists
      const similar = hasSimilarField(existing, fieldName);
      if (similar) {
        log("fix", `Skipping duplicate field "${fieldName}" in ${a.name} — semantically equivalent to existing "${similar}"`);
        continue;
      }
      // Final type resolution: if heuristic gave Bool but FB interface says UDT, prefer FB interface.
      // Look up by paramName (the FB's actual parameter name, not the DB field name).
      let resolvedType = dataType;
      if (resolvedType === "Bool" && paramName) {
        const fbType = fbParamTypes.get(paramName);
        if (fbType && fbType !== "Bool") {
          log("fix", `Type override for "${fieldName}": Bool → ${fbType} (from FB param "${paramName}")`);
          resolvedType = fbType;
        }
      }
      const formatted = needsQ(resolvedType) ? `"${resolvedType}"` : resolvedType;
      // Add sensible defaults for Configuration DB Time fields
      let defaultVal = "";
      if (resolvedType === "Time" && (a.name.toLowerCase().includes("config") || a.name.toLowerCase().includes("configuration"))) {
        const lower = fieldName.toLowerCase();
        if (lower.includes("timeout") || lower.includes("feedback")) defaultVal = " := T#5s";
        else if (lower.includes("reset") || lower.includes("hold")) defaultVal = " := T#3s";
        else if (lower.includes("delay") || lower.includes("dly")) defaultVal = " := T#500ms";
        else defaultVal = " := T#5s"; // safe default for unrecognized Time fields
      }
      toAdd.push(`    ${fieldName} : ${formatted}${defaultVal};`);
      existing.add(fieldName); // prevent adding same field twice from different devices
    }

    if (toAdd.length === 0) return a;

    const insertPoint = a.content.lastIndexOf("  END_VAR");
    if (insertPoint === -1) return a;

    const newContent =
      a.content.slice(0, insertPoint) +
      toAdd.join("\n") + "\n" +
      a.content.slice(insertPoint);

    log("fix", `${a.name} DB: added ${toAdd.length} field(s) from matrix wiring [${toAdd.map(f => f.trim().split(" ")[0]).join(", ")}]`);
    return { ...a, content: newContent };
  });
}

// ---------------------------------------------------------------------------
// Shared matrix wiring normalization
// ---------------------------------------------------------------------------

interface NormalizedWiringEntry {
  deviceName: string;
  instanceDbName: string;
  wiring: import("@/types/forge-matrix").FbWire[];
}

/**
 * Build normalized matrix wiring for a device type.
 * Consolidates ALL normalizations:
 * 1. Instance DB name → canonical formula
 * 2. ParamName → actual FB interface (strip _/i_/o_ prefixes)
 * 3. IO connectedTo → actual IO list tag names
 * 4. FB connectedTo instance DB names → canonical names
 * 5. FB connectedTo field names → actual FB interface of referenced device
 * 6. Global DB connectedTo names → actual artifact names (e.g. HmiData → DB_HmiData)
 */
function buildNormalizedMatrixWiring(
  matrix: ProcessLinkageMatrix | null,
  deviceType: string,
  allDevices: ForgeDeviceEntry[],
  instDbPrefix: string,
  ioList: ForgeIoEntry[],
  deviceTypeFbInterfaces: Map<string, string>,
  log: (level: DeviceGenLogLevel, msg: string) => void,
  globalDbNameMap?: Map<string, string>, // referenced name (lowercase) → actual artifact name
): NormalizedWiringEntry[] {
  if (!matrix?.deviceLinkage) return [];

  // --- IO tag normalization ---
  const allIoTags = ioList.map(io => io.tag_name);
  function normalizeIoTag(connectedTo: string): string {
    if (allIoTags.includes(connectedTo)) return connectedTo;
    const stem = connectedTo.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const match = allIoTags.find(t => {
      const ts = t.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
      return ts === stem || stem.includes(ts) || ts.includes(stem);
    });
    if (match && match !== connectedTo) {
      log("fix", `IO tag normalized in matrix wiring: "${connectedTo}" → "${match}"`);
    }
    return match ?? connectedTo;
  }

  // --- FB param name extraction from interface text ---
  function extractFbParams(interfaceText: string): Map<string, string> {
    const params = new Map<string, string>(); // lowercase → original case
    const re = /^\s+(\w+)\s*:/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(interfaceText)) !== null) {
      params.set(m[1].toLowerCase(), m[1]);
    }
    return params;
  }

  // --- Param name remap logic ---
  function remapName(matrixName: string, actualParams: Map<string, string>): string {
    if (actualParams.size === 0) return matrixName;
    const lower = matrixName.toLowerCase();
    if (actualParams.has(lower)) return actualParams.get(lower)!;
    // Strip leading underscore
    if (lower.startsWith("_") && actualParams.has(lower.slice(1))) return actualParams.get(lower.slice(1))!;
    // Add leading underscore
    if (actualParams.has("_" + lower)) return actualParams.get("_" + lower)!;
    // Strip i_, o_, io_ prefixes
    const stripped = lower.replace(/^(i_|o_|io_)/, "");
    if (stripped !== lower && actualParams.has(stripped)) return actualParams.get(stripped)!;
    return matrixName;
  }

  // --- Build canonical instance DB name map (ALL devices, ALL matrix entries) ---
  const instDbCanonicalMap = new Map<string, string>(); // stripped lowercase → canonical
  for (const d of allDevices) {
    const canonical = `${instDbPrefix}${d.name.replace(/[^A-Za-z0-9]/g, "")}`;
    instDbCanonicalMap.set(canonical.toLowerCase(), canonical);
  }
  for (const d of matrix.deviceLinkage) {
    const canonical = `${instDbPrefix}${d.name.replace(/[^A-Za-z0-9]/g, "")}`;
    if (d.instanceDbName) {
      instDbCanonicalMap.set(d.instanceDbName.replace(/[^A-Za-z0-9]/g, "").toLowerCase(), canonical);
    }
    instDbCanonicalMap.set(canonical.toLowerCase(), canonical);
  }

  // --- Build instance DB → FB params map (for cross-device field remapping) ---
  // Maps canonical inst DB name → FB param map (lowercase → original)
  const instDbToFbParams = new Map<string, Map<string, string>>();
  for (const d of allDevices) {
    const canonical = `${instDbPrefix}${d.name.replace(/[^A-Za-z0-9]/g, "")}`;
    const iface = deviceTypeFbInterfaces.get(d.device_type);
    if (iface && !instDbToFbParams.has(canonical)) {
      instDbToFbParams.set(canonical, extractFbParams(iface));
    }
  }

  // --- Normalize connectedTo for fb-type and global-type wires ---
  function normalizeConnectedTo(connectedTo: string, wireType: string): string {
    if (!connectedTo || (wireType !== "fb" && wireType !== "global")) return connectedTo;

    const dotIdx = connectedTo.indexOf(".");
    if (dotIdx === -1) return connectedTo;

    const dbPart = connectedTo.slice(0, dotIdx);
    const fieldPart = connectedTo.slice(dotIdx + 1);

    // First check if this references a global DB (e.g. HmiData → DB_HmiData)
    if (globalDbNameMap) {
      const globalResolved = globalDbNameMap.get(dbPart.toLowerCase());
      if (globalResolved && globalResolved !== dbPart) {
        log("fix", `Wiring global DB name normalized: "${dbPart}" → "${globalResolved}"`);
        return `${globalResolved}.${fieldPart}`;
      }
      if (globalResolved) return connectedTo; // already correct global DB name, skip inst DB logic
    }

    // Normalize instance DB name
    const dbStripped = dbPart.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const canonicalDb = instDbCanonicalMap.get(dbStripped);
    const resolvedDb = canonicalDb ?? dbPart;
    if (canonicalDb && canonicalDb !== dbPart) {
      log("fix", `Wiring connectedTo DB normalized: "${dbPart}" → "${canonicalDb}"`);
    }

    // Warn about direct instance DB access — inter-device signals should
    // flow through global DBs (HmiData, ProcessCommands) not instance DBs.
    if (canonicalDb) {
      log("warn", `Direct instance DB access: "${connectedTo}" — consider routing through a global DB instead`);
    }

    // Remap field name against the referenced device's FB interface
    const fbParams = instDbToFbParams.get(resolvedDb);
    const resolvedField = fbParams ? remapName(fieldPart, fbParams) : fieldPart;
    if (resolvedField !== fieldPart) {
      log("fix", `Wiring connectedTo field remapped: "${dbPart}.${fieldPart}" → "${resolvedDb}.${resolvedField}"`);
    }

    return `${resolvedDb}.${resolvedField}`;
  }

  // --- Current device type's FB params for paramName remapping ---
  const fbInterfaceText = deviceTypeFbInterfaces.get(deviceType) ?? "";
  const actualFbParams = extractFbParams(fbInterfaceText);

  // --- Build normalized wiring ---
  return matrix.deviceLinkage
    .filter(d => d.deviceType === deviceType)
    .map(d => {
      const canonical = `${instDbPrefix}${d.name.replace(/[^A-Za-z0-9]/g, "")}`;
      if (d.instanceDbName && d.instanceDbName !== canonical) {
        log("fix", `Matrix instance DB name normalized: "${d.instanceDbName}" → "${canonical}"`);
      }
      return {
        deviceName: d.name,
        instanceDbName: canonical,
        wiring: d.wiring.map(w => {
          // Remap paramName
          const remappedParam = remapName(w.paramName, actualFbParams);
          if (remappedParam !== w.paramName) {
            log("fix", `Matrix param remapped: "${w.paramName}" → "${remappedParam}" (FB interface)`);
          }

          // Normalize connectedTo based on wireType
          let connectedTo = w.connectedTo ?? "";
          if (w.wireType === "io") {
            connectedTo = normalizeIoTag(connectedTo);
          } else if (w.wireType === "fb" || w.wireType === "global") {
            connectedTo = normalizeConnectedTo(connectedTo, w.wireType);
          }

          return { ...w, paramName: remappedParam, connectedTo };
        }),
      };
    });
}

/**
 * Copy template blocks directly as artifacts (exact match — no AI call).
 * Returns FB/UDT/FC blocks from the template + a deterministically-generated instance DB.
 */
function copyTemplateAsArtifacts(
  device: ForgeDeviceEntry,
  template: FbTemplate,
  instDbPrefix = "Inst",
): ForgeArtifact[] {
  const artifacts: ForgeArtifact[] = [];

  for (const block of (template.blocks ?? []).sort((a, b) => a.sort_order - b.sort_order)) {
    // Use the declared name from inside the SCL (e.g., FUNCTION_BLOCK "ControlMotor"),
    // NOT block_name from the DB which may differ (e.g., "ControlMotor_DOL").
    // TIA Portal imports under the declared name, so all references must match.
    const declaredName = extractBlockName(block.scl_code) ?? block.block_name;
    artifacts.push({
      id: crypto.randomUUID(),
      name: declaredName,
      type: block.block_type as ForgeArtifact["type"],
      language: "SCL",
      content: block.scl_code,
      approved: false,
      fb_template_id: template.id,
      stage: "device",
      destination_folder:
        block.block_type === "UDT" ? "Types"
        : block.block_type === "DB" ? "Data blocks"
        : "Program blocks/Forge",
      dependencies: [],
      compile_after_import: true,
    });
  }

  // Generate instance DB deterministically — no AI needed
  const mainFb = template.blocks?.find((b) => b.block_type === "FB");
  if (mainFb) {
    // Use the FB name as declared inside the SCL (FUNCTION_BLOCK "ActualName"),
    // NOT block_name from the DB which may differ (e.g. file named "ControlMotor_DOL"
    // but declares FUNCTION_BLOCK "ControlMotor"). TIA Portal imports under the declared name.
    const declaredNameMatch = mainFb.scl_code.match(/FUNCTION_BLOCK\s+"([^"]+)"/i);
    const actualFbName = declaredNameMatch?.[1] ?? mainFb.block_name;

    const instDbName = `${instDbPrefix}${device.name.replace(/[^A-Za-z0-9]/g, "")}`;
    const instDbCode = [
      `DATA_BLOCK "${instDbName}"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `NON_RETAIN`,
      `"${actualFbName}"`,
      `BEGIN`,
      `END_DATA_BLOCK`,
    ].join("\n");

    artifacts.push({
      id: crypto.randomUUID(),
      name: instDbName,
      type: "DB",
      language: "SCL",
      content: instDbCode,
      approved: false,
      fb_template_id: template.id,
      stage: "device",
      destination_folder: "Data blocks",
      dependencies: [actualFbName],
      compile_after_import: true,
    });
  }

  return artifacts;
}

/** Parse SCL fenced blocks from Claude response and build ForgeArtifacts. */
function parseSclArtifacts(
  rawContent: string,
  stage: ForgeArtifact["stage"],
): ForgeArtifact[] {
  const artifacts: ForgeArtifact[] = [];

  // Match blocks: ```scl [TYPE:Name] ... ```
  const blockRe = /```scl\s+\[(\w+):([^\]]+)\]\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(rawContent)) !== null) {
    const [, blockType, blockName, code] = match;
    const type = blockType.toUpperCase() as ForgeArtifact["type"];
    artifacts.push({
      id: crypto.randomUUID(),
      name: blockName.trim(),
      type,
      language: "SCL",
      content: code.trim(),
      approved: false,
      stage,
      destination_folder:
        type === "UDT" ? "Types" : type === "OB" ? "Program blocks" : "Program blocks/Forge",
      dependencies: [],
      compile_after_import: true,
    });
  }

  return artifacts;
}

/** Normalize informal element type names that AI sometimes generates to canonical LadElementType values. */
function normalizeLadElementTypes(program: Record<string, unknown>): void {
  const typeMap: Record<string, string> = {
    CONTACT: "NO_CONTACT",
    NO_CONTACT_NORMALLY_OPEN: "NO_CONTACT",
    NORMALLY_OPEN: "NO_CONTACT",
    NC_CONTACT_NORMALLY_CLOSED: "NC_CONTACT",
    NORMALLY_CLOSED: "NC_CONTACT",
    COIL: "OUTPUT_COIL",
    OUTPUT: "OUTPUT_COIL",
  };
  const rungs = program.rungs as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rungs)) return;
  for (const rung of rungs) {
    const logic = rung.logic as Record<string, unknown> | undefined;
    if (!logic) continue;
    normalizeChain(logic, typeMap);
  }
}

function normalizeChain(chain: Record<string, unknown>, typeMap: Record<string, string>): void {
  const nodes = chain.nodes as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (node.type === "element") {
      const el = node.element as Record<string, unknown> | undefined;
      if (el && typeof el.type === "string" && typeMap[el.type]) {
        el.type = typeMap[el.type];
      }
    } else if (node.type === "parallel") {
      const branches = node.branches as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(branches)) {
        for (const branch of branches) normalizeChain(branch, typeMap);
      }
    }
  }
}

/** Parse LadProgram JSON from Claude response.
 * Tries multiple strategies: raw JSON, ```json block, first { ... } object in response.
 */
function parseLadArtifact(
  rawContent: string,
  deviceName: string,
  stage: ForgeArtifact["stage"],
): ForgeArtifact | null {
  const candidates: string[] = [];

  // 1. Extract ```json ... ``` block
  const fenceMatch = rawContent.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1].trim());

  // 2. Strip leading/trailing fences if the whole response is wrapped
  candidates.push(
    rawContent
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim(),
  );

  // 3. First { ... } block in the response
  const objMatch = rawContent.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0].trim());

  for (const candidate of candidates) {
    try {
      const program = JSON.parse(candidate) as Record<string, unknown>;
      normalizeLadElementTypes(program);
      return {
        id: crypto.randomUUID(),
        name: deviceName,
        type: "FB",
        language: "LAD",
        content: JSON.stringify(program),
        approved: false,
        stage,
        destination_folder: "Program blocks/Forge",
        dependencies: [],
        compile_after_import: true,
      };
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface ForgeDeviceGenerateProgress {
  current: number;
  total: number;
  currentDevice: string;
}

export type DeviceGenLogLevel = "info" | "fix" | "warn";
export interface DeviceGenLogEntry {
  level: DeviceGenLogLevel;
  message: string;
  ts: number;
}

export function useForgeDeviceGenerate() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ForgeDeviceGenerateProgress>({
    current: 0,
    total: 0,
    currentDevice: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<DeviceGenLogEntry[]>([]);

  function appendLog(level: DeviceGenLogLevel, message: string) {
    setLog(prev => [...prev, { level, message, ts: Date.now() }]);
    console.log(`[forge:${level}] ${message}`);
  }

  function clearLog() {
    setLog([]);
  }

  const generateSingle = useCallback(
    async (
      device: ForgeDeviceEntry,
      _session: ForgeSession,
      profile: DesignProfile,
      fbTemplates: FbTemplate[],
      patterns: PatternCandidate[],
      log: (level: DeviceGenLogLevel, msg: string) => void,
      additionalInstructions?: string,
    ): Promise<ForgeArtifact[]> => {
      const abort = new AbortController();
      const effectiveLang = device.language_override ?? profile.device_fb_language;
      const isLad = effectiveLang === "LAD";

      const matchedTemplate =
        device.fb_template_id
          ? fbTemplates.find((t) => t.id === device.fb_template_id) ?? null
          : null;

      // Any library match with blocks — copy directly, no AI needed.
      // Confidence level doesn't matter: if a template was associated with this device
      // type, it IS the correct FB. Instance DBs are always regenerated deterministically.
      if (matchedTemplate?.blocks?.length) {
        log("info", `${device.name}: copied from library template "${matchedTemplate.name}"`);
        return copyTemplateAsArtifacts(device, matchedTemplate);
      }

      const context: DeviceGenContext = {
        profile,
        platformRules: PLATFORM_RULES,
        patterns,
        fbTemplate: null, // no template — pure AI generation, don't confuse AI with wrong template
      };

      let systemPrompt: string;
      let userMessage: string;

      if (isLad) {
        systemPrompt = buildDeviceLadPrompt(device, context);
        userMessage = buildDeviceLadUserMessage(device);
      } else {
        systemPrompt = buildDeviceSclPrompt(device, context, promptSections);
        userMessage = buildDeviceSclUserMessage(device);
      }

      const finalUserMessage = additionalInstructions?.trim()
        ? `${userMessage}\n\n## Additional Requirements\n${additionalInstructions}`
        : userMessage;

      const { content } = await validateAndCall(
        callNonStreaming,
        systemPrompt,
        [{ role: "user", content: finalUserMessage }],
        abort.signal,
        DEVICE_GEN_MAX_TOKENS,
        isLad ? "code_architect_lad" : "code_architect_scl",
        !!profile,
      );

      if (isLad) {
        const artifact = parseLadArtifact(content, device.name, "device");
        if (!artifact) log("warn", `${device.name}: LAD parse returned no artifact`);
        else log("info", `${device.name}: generated LAD FB`);
        return artifact ? [artifact] : [];
      }

      // Strip any AI-generated instance DBs — replace with deterministic ones built
      // from the actual FB name declared in the AI response. AI DBs may have wrong
      // fields (copied from a mismatched template context).
      const rawArtifacts = parseSclArtifacts(content, "device");
      const fbArtifact = rawArtifacts.find(a => a.type === "FB");
      const nonDbArtifacts = rawArtifacts.filter(a => a.type !== "DB");

      if (fbArtifact) {
        const declaredNameMatch = fbArtifact.content.match(/FUNCTION_BLOCK\s+"([^"]+)"/i);
        const actualFbName = declaredNameMatch?.[1] ?? fbArtifact.name;
        const instPrefix = resolveInstDbPrefix(profile);
        const instDbName = `${instPrefix}${device.name.replace(/[^A-Za-z0-9]/g, "")}`;
        const instDbCode = [
          `DATA_BLOCK "${instDbName}"`,
          `{ S7_Optimized_Access := 'TRUE' }`,
          `VERSION : 0.1`,
          `NON_RETAIN`,
          `"${actualFbName}"`,
          `BEGIN`,
          `END_DATA_BLOCK`,
        ].join("\n");
        nonDbArtifacts.push({
          id: crypto.randomUUID(),
          name: instDbName,
          type: "DB",
          language: "SCL",
          content: instDbCode,
          approved: false,
          stage: "device",
          destination_folder: "Data blocks",
          dependencies: [actualFbName],
          compile_after_import: true,
        });
        log("info", `${device.name}: generated ${nonDbArtifacts.map(a => `${a.type}:${a.name}`).join(", ")} (instance DB rebuilt deterministically)`);
      } else if (rawArtifacts.length === 0) {
        log("warn", `${device.name}: SCL parse returned no artifacts — check AI output format`);
      } else {
        log("info", `${device.name}: generated ${rawArtifacts.map(a => `${a.type}:${a.name}`).join(", ")}`);
        return rawArtifacts;
      }
      return nonDbArtifacts;
    },
    [],
  );

  const generateAll = useCallback(
    async (
      session: ForgeSession,
      profile: DesignProfile,
      fbTemplates: FbTemplate[],
      patterns: PatternCandidate[],
    ): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);
      clearLog();

      const devices = session.device_list as ForgeDeviceEntry[];
      const ioList = session.io_list as ForgeIoEntry[];
      const matrix = session.linkage_matrix as ProcessLinkageMatrix | null;
      // Global DBs to generate from matrix (HmiData, Configuration, etc.)
      const matrixGlobalDbs = matrix?.globalData ?? [];
      const allArtifacts: ForgeArtifact[] = [];
      // Track template block names already copied — FB/UDT blocks are shared across devices
      const copiedTemplateBlockNames = new Set<string>();
      // Track FB interface text and actual FB name per device type for Device Call FC generation
      const deviceTypeFbInterfaces = new Map<string, string>();
      const deviceTypeFbNames = new Map<string, string>();

      // Resolve naming prefixes from profile
      const dbPrefix = resolveDbPrefix(profile);
      const instDbPrefix = resolveInstDbPrefix(profile);
      const fcPrefix = resolveFcPrefix(profile);
      const inputsDbName = dbPrefix + "Inputs";
      const outputsDbName = dbPrefix + "Outputs";

      // Resolve folder structure from profile
      const folders = parseFolderRules(profile.folder_rules);
      const fbFolder = resolveDestinationFolder(folders, "device_fb");
      const instDbFolder = resolveDestinationFolder(folders, "device_instance_db");
      const callFcFolder = resolveDestinationFolder(folders, "device_call_fc");
      const ioLinkingFolder = resolveDestinationFolder(folders, "io_linking");
      const globalDbFolder = resolveDestinationFolder(folders, "global_db");

      // Unique device types, sorted by call order
      const uniqueDeviceTypes = [
        ...new Set(devices.map((d) => d.device_type)),
      ].sort((a, b) => getDeviceCallOrder(a) - getDeviceCallOrder(b));

      // Total steps: devices + Inputs DB + Outputs DB + Global DBs + IoLinking + one Device Call FC per type
      const totalSteps = devices.length + 3 + matrixGlobalDbs.length + uniqueDeviceTypes.length;
      setProgress({ current: 0, total: totalSteps, currentDevice: "" });

      try {
        // --- Step 1: Generate FBs + instance DBs per device ---
        for (let i = 0; i < devices.length; i++) {
          const device = devices[i];
          const matchedTemplate =
            device.fb_template_id
              ? fbTemplates.find((t) => t.id === device.fb_template_id) ?? null
              : null;
          // Use library template whenever one is associated — confidence level is irrelevant.
          // If the user confirmed (or the system assigned) a template, that template IS correct.
          const useTemplate = !!matchedTemplate?.blocks?.length;
          console.log(`[forge] device "${device.name}": confidence=${device.fb_match_confidence}, template=${matchedTemplate?.name ?? "none"}, useTemplate=${useTemplate}`);

          setProgress({
            current: i + 1,
            total: totalSteps,
            currentDevice: useTemplate ? `${device.name} (from library)` : device.name,
          });

          let deviceArtifacts: ForgeArtifact[];
          if (useTemplate && matchedTemplate) {
            deviceArtifacts = copyTemplateAsArtifacts(device, matchedTemplate, instDbPrefix);
            // Apply profile folder rules to all template artifacts
            for (const a of deviceArtifacts) {
              if (a.type === "FB" || a.type === "FC") a.destination_folder = fbFolder;
              else if (a.type === "DB" && a.name.startsWith(instDbPrefix)) a.destination_folder = instDbFolder;
              else if (a.type === "DB") a.destination_folder = globalDbFolder;
            }
            for (const artifact of deviceArtifacts) {
              if (artifact.type === "DB" && artifact.name.startsWith(instDbPrefix)) {
                allArtifacts.push(artifact);
              } else if (!copiedTemplateBlockNames.has(artifact.name)) {
                allArtifacts.push(artifact);
                copiedTemplateBlockNames.add(artifact.name);
              }
            }
            // Warn if any template FB still has legacy _-prefixed params
            for (const artifact of deviceArtifacts) {
              if (artifact.type === "FB" && artifact.language === "SCL") {
                const underscoreParams = artifact.content.match(/^\s+#_[A-Za-z]/gm);
                if (underscoreParams && underscoreParams.length > 0) {
                  appendLog("warn", `Template FB "${artifact.name}" has ${underscoreParams.length} _-prefixed param(s) — update the template SCL in FB Library to fix compile errors`);
                }
              }
            }
          } else {
            deviceArtifacts = await generateSingle(device, session, profile, fbTemplates, patterns, appendLog);
            // Apply profile folder rules to AI-generated artifacts
            for (const a of deviceArtifacts) {
              if (a.type === "FB") a.destination_folder = fbFolder;
              else if (a.type === "DB" && a.name.startsWith(instDbPrefix)) a.destination_folder = instDbFolder;
              else if (a.type === "DB") a.destination_folder = globalDbFolder;
              else if (a.type === "FC") a.destination_folder = callFcFolder;
            }
            allArtifacts.push(...deviceArtifacts);
          }

          // Capture FB interface for this device type (first encountered wins)
          if (!deviceTypeFbInterfaces.has(device.device_type)) {
            const fbArtifact = deviceArtifacts.find((a) => a.type === "FB" && a.language === "SCL");
            if (fbArtifact) {
              const interfaceRe =
                /(VAR_INPUT[\s\S]*?END_VAR|VAR_OUTPUT[\s\S]*?END_VAR|VAR_IN_OUT[\s\S]*?END_VAR)/gi;
              const matches = fbArtifact.content.match(interfaceRe);
              if (matches) {
                // Use the declared name from inside the SCL (FUNCTION_BLOCK "ActualName"),
                // NOT artifact.name which may differ. TIA imports under the declared name.
                const declaredFbName = extractBlockName(fbArtifact.content) ?? fbArtifact.name;
                deviceTypeFbInterfaces.set(
                  device.device_type,
                  `### ${declaredFbName}\n\`\`\`\n${matches.join("\n")}\n\`\`\``,
                );
                deviceTypeFbNames.set(device.device_type, declaredFbName);
              }
            }
          }
        }

        // --- Step 2: Inputs DB (deterministic) ---
        setProgress({
          current: devices.length + 1,
          total: totalSteps,
          currentDevice: "Inputs DB",
        });
        if (ioList?.length > 0) {
          const inputFields = ioList.filter(io => io.signal_type === "DI" || io.signal_type === "AI");
          const inputsDbCode = generateInputsDb(ioList, inputsDbName);
          allArtifacts.push({
            id: crypto.randomUUID(),
            name: inputsDbName,
            type: "DB",
            language: "SCL",
            content: inputsDbCode,
            approved: false,
            stage: "device",
            destination_folder: globalDbFolder,
            dependencies: [],
            compile_after_import: true,
          });
          appendLog("info", `${inputsDbName} DB: ${inputFields.length} fields — ${inputFields.map(io => io.tag_name).join(", ")}`);
        }

        // --- Step 3: Outputs DB (deterministic) ---
        setProgress({
          current: devices.length + 2,
          total: totalSteps,
          currentDevice: "Outputs DB",
        });
        if (ioList?.length > 0) {
          const outputFields = ioList.filter(io => io.signal_type === "DQ" || io.signal_type === "AQ");
          const outputsDbCode = generateOutputsDb(ioList, outputsDbName);
          allArtifacts.push({
            id: crypto.randomUUID(),
            name: outputsDbName,
            type: "DB",
            language: "SCL",
            content: outputsDbCode,
            approved: false,
            stage: "device",
            destination_folder: globalDbFolder,
            dependencies: [],
            compile_after_import: true,
          });
          appendLog("info", `${outputsDbName} DB: ${outputFields.length} fields — ${outputFields.map(io => io.tag_name).join(", ")}`);
        }

        // --- Step 3b: Global DBs from matrix (HmiData, Configuration, etc.) ---
        for (let i = 0; i < matrixGlobalDbs.length; i++) {
          const gdb = matrixGlobalDbs[i];
          if (!gdb.dbName) continue;
          // Apply db_prefix if the name doesn't already have it
          const prefixedDbName = dbPrefix && !gdb.dbName.startsWith(dbPrefix) ? `${dbPrefix}${gdb.dbName}` : gdb.dbName;
          setProgress({
            current: devices.length + 2 + i + 1,
            total: totalSteps,
            currentDevice: `${prefixedDbName} DB`,
          });
          const dbCode = generateGlobalDb(prefixedDbName, gdb.fields ?? []);
          allArtifacts.push({
            id: crypto.randomUUID(),
            name: prefixedDbName,
            type: "DB",
            language: "SCL",
            content: dbCode,
            approved: false,
            stage: "device",
            destination_folder: globalDbFolder,
            dependencies: [],
            compile_after_import: true,
          });
          appendLog("info", `Global DB "${prefixedDbName}": ${(gdb.fields ?? []).length} fields`);
        }

        // Backfill global DB fields from matrix wiring before generating FCs
        const fbOnlyArtifacts = allArtifacts.filter(a => a.type === "FB");
        const backfilledArtifacts = backfillGlobalDbFieldsFromWiring(allArtifacts, matrix, fbOnlyArtifacts, appendLog, instDbPrefix, dbPrefix);
        // Replace allArtifacts contents with backfilled versions
        allArtifacts.length = 0;
        allArtifacts.push(...backfilledArtifacts);

        // --- Step 4: IoLinking FC (deterministic SCL, or LAD via AI) ---
        const ioLinkingFcName = fcPrefix ? `${fcPrefix}IoLinking` : "IoLinking";
        setProgress({
          current: devices.length + 3 + matrixGlobalDbs.length,
          total: totalSteps,
          currentDevice: `${ioLinkingFcName} FC`,
        });
        if (ioList?.length > 0) {
          const ioLang = profile.io_linking_language ?? "SCL";
          if (ioLang === "LAD") {
            // LAD IoLinking still uses AI
            const abort = new AbortController();
            const context: DeviceGenContext = { profile, platformRules: PLATFORM_RULES, patterns, inputsDbName, outputsDbName };
            const ladPrompt = buildIoLinkingLadPrompt(devices, ioList, context, promptSections);
            const { content } = await validateAndCall(
              callNonStreaming,
              ladPrompt,
              [{ role: "user", content: `Generate the ${ioLinkingFcName} LAD FC.` }],
              abort.signal,
              DEVICE_GEN_MAX_TOKENS,
              "io_linking",
              !!profile,
            );
            const artifact = parseLadArtifact(content, ioLinkingFcName, "device");
            if (!artifact) console.warn("[forge] LAD IO linking parse failed:", content.slice(0, 500));
            if (artifact) allArtifacts.push({ ...artifact, type: "FC" as const });
          } else {
            // SCL IoLinking is fully deterministic
            const ioLinkingCode = generateIoLinkingFc(ioList, inputsDbName, outputsDbName, ioLinkingFcName);
            allArtifacts.push({
              id: crypto.randomUUID(),
              name: ioLinkingFcName,
              type: "FC",
              language: "SCL",
              content: ioLinkingCode,
              approved: false,
              stage: "device",
              destination_folder: ioLinkingFolder,
              dependencies: [],
              compile_after_import: true,
            });
          }
        }

        // --- Step 5: Device Call FCs (one per device type, AI-generated) ---
        const callFcLang = profile.device_call_fc_language ?? "SCL";
        for (let i = 0; i < uniqueDeviceTypes.length; i++) {
          const deviceType = uniqueDeviceTypes[i];
          const fcName = deviceTypeToFcName(deviceType, fcPrefix || undefined);
          setProgress({
            current: devices.length + 3 + matrixGlobalDbs.length + i + 1,
            total: totalSteps,
            currentDevice: `${fcName} FC`,
          });

          const groupDevices = devices.filter((d) => d.device_type === deviceType);
          const instanceDbNames = groupDevices.map(
            (d) => `${instDbPrefix}${d.name.replace(/[^A-Za-z0-9]/g, "")}`,
          );

          // Use IO list tag names (same source as generated Inputs/Outputs DBs) rather than
          // device.io_signals tag names (AI-extracted from spec, may differ from CSV names).
          // Match IO list entries to this device group by comparing tag names case-insensitively.
          const groupSignalTags = new Set(
            groupDevices
              .flatMap((d) => d.io_signals ?? [])
              .map((s) => s.tag_name.replace(/[^A-Za-z0-9]/g, "").toLowerCase()),
          );
          const groupIoListEntries = (ioList ?? []).filter((io) => {
            const ioStem = (io.tag_name ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
            // Match if the IO tag stem contains or is contained in any device signal tag stem
            return [...groupSignalTags].some(
              (s) => ioStem.includes(s) || s.includes(ioStem) || ioStem === s,
            );
          });
          // Fallback: if matching finds nothing, include all IO entries for this signal type
          const relevantInputs = groupIoListEntries.filter(
            (io) => io.signal_type === "DI" || io.signal_type === "AI",
          );
          const relevantOutputs = groupIoListEntries.filter(
            (io) => io.signal_type === "DQ" || io.signal_type === "AQ",
          );
          const inputsDbFields = relevantInputs.map((io) => io.tag_name);
          const outputsDbFields = relevantOutputs.map((io) => io.tag_name);
          appendLog("info", `${fcName}: calling instances [${instanceDbNames.join(", ")}], inputs [${inputsDbFields.join(", ") || "none"}], outputs [${outputsDbFields.join(", ") || "none"}]`);

          // Build global DB name map for wiring normalization (HmiData → DB_HmiData etc.)
          const globalDbMap = new Map<string, string>();
          for (const a of allArtifacts) {
            if (a.type !== "DB" || a.name.startsWith(instDbPrefix) || a.name === inputsDbName || a.name === outputsDbName) continue;
            globalDbMap.set(a.name.toLowerCase(), a.name);
            if (a.name.startsWith("DB_")) globalDbMap.set(a.name.slice(3).toLowerCase(), a.name);
          }

          // Build normalized wiring with all fixes applied
          const matrixWiring = buildNormalizedMatrixWiring(
            matrix, deviceType, devices, instDbPrefix, ioList ?? [], deviceTypeFbInterfaces, appendLog, globalDbMap,
          );

          const fbInterfaceText = deviceTypeFbInterfaces.get(deviceType) ?? "";

          // Look up relevant reference library sections for this device type
          let refSectionsText = "";
          try {
            const refContext = `Device type: ${deviceType}\nFB: ${deviceTypeFbNames.get(deviceType) ?? fcName}\n${fbInterfaceText.slice(0, 2000)}`;
            const refSections = await getRelevantReferenceSections(
              refContext, "generation_request", "SIEMENS_TIA", abort.signal, 10,
            );
            refSectionsText = formatReferenceSections(refSections, callFcLang === "LAD" ? "LAD" : "SCL");
          } catch { /* reference lookup is best-effort */ }

          const context: DeviceCallFcContext = {
            fcName,
            deviceType,
            fbName: deviceTypeFbNames.get(deviceType),
            devices: groupDevices,
            instanceDbNames,
            fbInterfaceSection: fbInterfaceText,
            inputsDbFields,
            outputsDbFields,
            inputsDbName,
            outputsDbName,
            profile,
            platformRules: PLATFORM_RULES,
            patterns,
            matrixWiring,
            referenceSections: refSectionsText || undefined,
          };

          // Only use deterministic generation if EVERY instance has wiring entries in the
          // matrix — partial coverage produces empty () calls that compile but don't function.
          const allInstancesWired = instanceDbNames.every(name =>
            matrixWiring.some(d => d.instanceDbName === name && d.wiring.length > 0),
          );

          // Validate that all wiring param names exist in the FB interface
          const fbParamsRe = /^\s+(\w+)\s*:/gm;
          const actualFbParamSet = new Set<string>();
          let _pm: RegExpExecArray | null;
          while ((_pm = fbParamsRe.exec(fbInterfaceText)) !== null) actualFbParamSet.add(_pm[1].toLowerCase());

          const allWiringParamsValid = actualFbParamSet.size === 0 || matrixWiring.every(d =>
            d.wiring.every(w => actualFbParamSet.has(w.paramName.toLowerCase())),
          );

          if (!allWiringParamsValid) {
            const badParams = matrixWiring
              .flatMap(d => d.wiring.filter(w => !actualFbParamSet.has(w.paramName.toLowerCase())).map(w => w.paramName))
              .filter((v, i, a) => a.indexOf(v) === i);
            appendLog("warn", `${fcName}: matrix param(s) [${badParams.join(", ")}] not found in generated FB — falling back to AI for correct interface`);
          }

          if (!allInstancesWired && matrixWiring.length > 0) {
            appendLog("warn", `${fcName}: ${instanceDbNames.length - matrixWiring.filter(d => d.wiring.length > 0).length} instance(s) missing matrix wiring — falling back to AI`);
          }

          // Deterministic path — all instances wired and params valid
          if (allInstancesWired && allWiringParamsValid) {
            if (callFcLang === "LAD") {
              // Deterministic LAD from matrix
              const ladJson = generateDeviceCallFcLad(context);
              if (ladJson) {
                appendLog("info", `${fcName}: generated LAD deterministically from matrix wiring`);
                allArtifacts.push({
                  id: crypto.randomUUID(),
                  name: fcName,
                  type: "FC",
                  language: "LAD",
                  content: ladJson,
                  approved: false,
                  stage: "device",
                  destination_folder: callFcFolder,
                  dependencies: [],
                  compile_after_import: true,
                });
              }
            } else {
              // Deterministic SCL from matrix
              const deterministicScl = generateDeviceCallFc(context);
              if (deterministicScl) {
                appendLog("info", `${fcName}: generated SCL deterministically from matrix wiring`);
                allArtifacts.push({
                  id: crypto.randomUUID(),
                  name: fcName,
                  type: "FC",
                  language: "SCL",
                  content: deterministicScl,
                  approved: false,
                  stage: "device",
                  destination_folder: callFcFolder,
                  dependencies: [],
                  compile_after_import: true,
                });
              }
            }
          } else if (callFcLang === "LAD") {
            // LAD AI fallback — incomplete matrix wiring
            const abort = new AbortController();
            const { content } = await validateAndCall(
              callNonStreaming,
              buildDeviceCallFcLadPrompt(context),
              [{ role: "user", content: buildDeviceCallFcUserMessage(context) }],
              abort.signal,
              DEVICE_GEN_MAX_TOKENS,
              "code_architect_lad",
              !!profile,
            );
            const artifact = parseLadArtifact(content, fcName, "device");
            if (!artifact) {
              appendLog("warn", `${fcName}: LAD parse failed — no artifact`);
            } else {
              appendLog("info", `${fcName}: generated LAD Call FC via AI`);
              allArtifacts.push({ ...artifact, type: "FC" as const });
            }
          } else {
            // SCL AI fallback — incomplete or no matrix wiring
            const abort = new AbortController();
            const { content } = await validateAndCall(
              callNonStreaming,
              buildDeviceCallFcPrompt(context, promptSections),
              [{ role: "user", content: buildDeviceCallFcUserMessage(context) }],
              abort.signal,
              DEVICE_GEN_MAX_TOKENS,
              "code_architect_scl",
              !!profile,
            );
            const fcArtifacts = parseSclArtifacts(content, "device");
            if (fcArtifacts.length === 0) {
              appendLog("warn", `${fcName}: no artifacts parsed — Device Call FC may be missing`);
            } else {
              appendLog("info", `${fcName}: generated ${fcArtifacts.map(a => a.name).join(", ")}`);
            }
            allArtifacts.push(...fcArtifacts);
          }
        }

        // Deduplicate by type+name — AI device generation may emit global DBs
        // (Configuration, HmiData) that duplicate the matrix-generated ones. Keep
        // the last occurrence so matrix DBs (added in step 3b) win over AI ones.
        const deduped = new Map<string, ForgeArtifact>();
        for (const a of allArtifacts) deduped.set(`${a.type}:${a.name}`, a);
        const dedupedArtifacts = [...deduped.values()];

        appendLog("info", `Post-processing ${dedupedArtifacts.length} artifacts…`);
        const normalized = normalizeInstanceDbNames(dedupedArtifacts, devices, appendLog, instDbPrefix);
        const fixedRefs = fixFcInstanceDbReferences(normalized, appendLog, instDbPrefix);
        const fixedFields = fixFbInstanceFieldRefs(fixedRefs, appendLog, instDbPrefix);
        const deduped2 = deduplicateFbCallParams(fixedFields, appendLog);
        const deduped3 = deduplicateDbFields(deduped2, appendLog);
        const reconciled = reconcileUdtReferences(deduped3, appendLog);
        return backfillGlobalDbFields(reconciled, appendLog, instDbPrefix);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [generateSingle],
  );

  // ---------------------------------------------------------------------------
  // generateFbsOnly — Step 1 only: per-device FB + UDT + instance DB
  // ---------------------------------------------------------------------------
  const generateFbsOnly = useCallback(
    async (
      session: ForgeSession,
      profile: DesignProfile,
      fbTemplates: FbTemplate[],
      patterns: PatternCandidate[],
    ): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);
      clearLog();

      const devices = session.device_list as ForgeDeviceEntry[];
      const allArtifacts: ForgeArtifact[] = [];
      const copiedTemplateBlockNames = new Set<string>();
      const instDbPrefix = resolveInstDbPrefix(profile);

      // Resolve folder structure from profile
      const folders = parseFolderRules(profile.folder_rules);
      const fbFolder = resolveDestinationFolder(folders, "device_fb");
      const instDbFolder = resolveDestinationFolder(folders, "device_instance_db");
      const globalDbFolder = resolveDestinationFolder(folders, "global_db");
      const callFcFolder = resolveDestinationFolder(folders, "device_call_fc");

      setProgress({ current: 0, total: devices.length, currentDevice: "" });

      try {
        for (let i = 0; i < devices.length; i++) {
          const device = devices[i];
          const matchedTemplate =
            device.fb_template_id
              ? fbTemplates.find((t) => t.id === device.fb_template_id) ?? null
              : null;
          const useTemplate = !!matchedTemplate?.blocks?.length;

          setProgress({
            current: i + 1,
            total: devices.length,
            currentDevice: useTemplate ? `${device.name} (from library)` : device.name,
          });

          let deviceArtifacts: ForgeArtifact[];
          if (useTemplate && matchedTemplate) {
            deviceArtifacts = copyTemplateAsArtifacts(device, matchedTemplate, instDbPrefix);
            // Apply profile folder rules
            for (const a of deviceArtifacts) {
              if (a.type === "FB" || a.type === "FC") a.destination_folder = fbFolder;
              else if (a.type === "DB" && a.name.startsWith(instDbPrefix)) a.destination_folder = instDbFolder;
              else if (a.type === "DB") a.destination_folder = globalDbFolder;
            }
            for (const artifact of deviceArtifacts) {
              if (artifact.type === "DB" && artifact.name.startsWith(instDbPrefix)) {
                allArtifacts.push({ ...artifact, stage: "device_fb" });
              } else if (!copiedTemplateBlockNames.has(artifact.name)) {
                allArtifacts.push({ ...artifact, stage: "device_fb" });
                copiedTemplateBlockNames.add(artifact.name);
              }
            }
          } else {
            deviceArtifacts = await generateSingle(device, session, profile, fbTemplates, patterns, appendLog);
            // Apply profile folder rules to AI-generated artifacts
            for (const a of deviceArtifacts) {
              if (a.type === "FB") a.destination_folder = fbFolder;
              else if (a.type === "DB" && a.name.startsWith(instDbPrefix)) a.destination_folder = instDbFolder;
              else if (a.type === "DB") a.destination_folder = globalDbFolder;
              else if (a.type === "FC") a.destination_folder = callFcFolder;
            }
            allArtifacts.push(...deviceArtifacts.map(a => ({ ...a, stage: "device_fb" as const })));
          }
        }

        // Minimal post-processing for FB-only artifacts
        const deduped = new Map<string, ForgeArtifact>();
        for (const a of allArtifacts) deduped.set(`${a.type}:${a.name}`, a);
        const dedupedArtifacts = [...deduped.values()];
        appendLog("info", `FB post-processing ${dedupedArtifacts.length} artifacts…`);
        const normalized = normalizeInstanceDbNames(dedupedArtifacts, devices, appendLog, instDbPrefix);
        return reconcileUdtReferences(normalized, appendLog);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [generateSingle],
  );

  // ---------------------------------------------------------------------------
  // generateCallCode — Steps 2-5 only: uses pre-generated fbArtifacts
  // ---------------------------------------------------------------------------
  const generateCallCode = useCallback(
    async (
      session: ForgeSession,
      profile: DesignProfile,
      fbArtifacts: ForgeArtifact[],
      patterns: PatternCandidate[],
    ): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);
      clearLog();

      const devices = session.device_list as ForgeDeviceEntry[];
      const ioList = session.io_list as ForgeIoEntry[];
      const matrix = session.linkage_matrix as ProcessLinkageMatrix | null;
      const matrixGlobalDbs = matrix?.globalData ?? [];
      const allArtifacts: ForgeArtifact[] = [];

      // Resolve naming prefixes from profile
      const dbPrefix = resolveDbPrefix(profile);
      const instDbPrefix = resolveInstDbPrefix(profile);
      const fcPrefix = resolveFcPrefix(profile);
      const inputsDbName = dbPrefix + "Inputs";
      const outputsDbName = dbPrefix + "Outputs";

      // Resolve folder structure from profile
      const folders = parseFolderRules(profile.folder_rules);
      const callFcFolder = resolveDestinationFolder(folders, "device_call_fc");
      const ioLinkingFolder = resolveDestinationFolder(folders, "io_linking");
      const globalDbFolder = resolveDestinationFolder(folders, "global_db");

      const uniqueDeviceTypes = [
        ...new Set(devices.map((d) => d.device_type)),
      ].sort((a, b) => getDeviceCallOrder(a) - getDeviceCallOrder(b));

      // Build deviceTypeFbInterfaces and FB names from pre-existing FB artifacts
      // Match by fb_template_id first (reliable), then fall back to name matching (no catch-all)
      const deviceTypeFbInterfaces = new Map<string, string>();
      const deviceTypeFbNames = new Map<string, string>();
      for (const device of devices) {
        if (!deviceTypeFbInterfaces.has(device.device_type)) {
          // 1. Match by fb_template_id (most reliable — set during Device FB step)
          let deviceFb = device.fb_template_id
            ? fbArtifacts.find(a =>
                a.type === "FB" && a.fb_template_id === device.fb_template_id
              )
            : undefined;

          // 2. Fall back to name matching (no dangerous catch-all)
          if (!deviceFb) {
            deviceFb = fbArtifacts.find(a =>
              a.type === "FB" && a.language === "SCL" &&
              (a.name.toLowerCase().includes(device.device_type.toLowerCase().replace(/\s+/g, "")) ||
               device.device_type.toLowerCase().replace(/\s+/g, "").includes(a.name.toLowerCase()))
            );
          }

          if (deviceFb) {
            const interfaceRe =
              /(VAR_INPUT[\s\S]*?END_VAR|VAR_OUTPUT[\s\S]*?END_VAR|VAR_IN_OUT[\s\S]*?END_VAR)/gi;
            const matches = deviceFb.content.match(interfaceRe);
            if (matches) {
              // Use the declared name from inside the SCL (FUNCTION_BLOCK "ActualName"),
              // NOT artifact.name which may differ. TIA imports under the declared name.
              const declaredFbName = extractBlockName(deviceFb.content) ?? deviceFb.name;
              deviceTypeFbInterfaces.set(
                device.device_type,
                `### ${declaredFbName}\n\`\`\`\n${matches.join("\n")}\n\`\`\``,
              );
              deviceTypeFbNames.set(device.device_type, declaredFbName);
            }
          }
        }
      }

      const totalSteps = 3 + matrixGlobalDbs.length + uniqueDeviceTypes.length;
      setProgress({ current: 0, total: totalSteps, currentDevice: "" });

      try {
        // --- Step 2: Inputs DB (deterministic) ---
        setProgress({
          current: 1,
          total: totalSteps,
          currentDevice: "Inputs DB",
        });
        if (ioList?.length > 0) {
          const inputFields = ioList.filter(io => io.signal_type === "DI" || io.signal_type === "AI");
          const inputsDbCode = generateInputsDb(ioList, inputsDbName);
          allArtifacts.push({
            id: crypto.randomUUID(),
            name: inputsDbName,
            type: "DB",
            language: "SCL",
            content: inputsDbCode,
            approved: false,
            stage: "device",
            destination_folder: globalDbFolder,
            dependencies: [],
            compile_after_import: true,
          });
          appendLog("info", `${inputsDbName} DB: ${inputFields.length} fields — ${inputFields.map(io => io.tag_name).join(", ")}`);
        }

        // --- Step 3: Outputs DB (deterministic) ---
        setProgress({
          current: 2,
          total: totalSteps,
          currentDevice: "Outputs DB",
        });
        if (ioList?.length > 0) {
          const outputFields = ioList.filter(io => io.signal_type === "DQ" || io.signal_type === "AQ");
          const outputsDbCode = generateOutputsDb(ioList, outputsDbName);
          allArtifacts.push({
            id: crypto.randomUUID(),
            name: outputsDbName,
            type: "DB",
            language: "SCL",
            content: outputsDbCode,
            approved: false,
            stage: "device",
            destination_folder: globalDbFolder,
            dependencies: [],
            compile_after_import: true,
          });
          appendLog("info", `${outputsDbName} DB: ${outputFields.length} fields — ${outputFields.map(io => io.tag_name).join(", ")}`);
        }

        // --- Step 3b: Global DBs from matrix (HmiData, Configuration, etc.) ---
        for (let i = 0; i < matrixGlobalDbs.length; i++) {
          const gdb = matrixGlobalDbs[i];
          if (!gdb.dbName) continue;
          // Apply db_prefix if the name doesn't already have it
          const prefixedDbName = dbPrefix && !gdb.dbName.startsWith(dbPrefix) ? `${dbPrefix}${gdb.dbName}` : gdb.dbName;
          setProgress({
            current: 2 + i + 1,
            total: totalSteps,
            currentDevice: `${prefixedDbName} DB`,
          });
          const dbCode = generateGlobalDb(prefixedDbName, gdb.fields ?? []);
          allArtifacts.push({
            id: crypto.randomUUID(),
            name: prefixedDbName,
            type: "DB",
            language: "SCL",
            content: dbCode,
            approved: false,
            stage: "device",
            destination_folder: globalDbFolder,
            dependencies: [],
            compile_after_import: true,
          });
          appendLog("info", `Global DB "${prefixedDbName}": ${(gdb.fields ?? []).length} fields`);
        }

        // Backfill global DB fields from matrix wiring before generating FCs
        const fbOnlyArtifacts2 = [...fbArtifacts, ...allArtifacts.filter(a => a.type === "FB")];
        const backfilledArtifacts2 = backfillGlobalDbFieldsFromWiring(allArtifacts, matrix, fbOnlyArtifacts2, appendLog, instDbPrefix, dbPrefix);
        allArtifacts.length = 0;
        allArtifacts.push(...backfilledArtifacts2);

        // --- Step 4: IoLinking FC (deterministic SCL, or LAD via AI) ---
        const ioLinkingFcName = fcPrefix ? `${fcPrefix}IoLinking` : "IoLinking";
        setProgress({
          current: 3 + matrixGlobalDbs.length,
          total: totalSteps,
          currentDevice: `${ioLinkingFcName} FC`,
        });
        if (ioList?.length > 0) {
          const ioLang = profile.io_linking_language ?? "SCL";
          if (ioLang === "LAD") {
            const abort = new AbortController();
            const context: DeviceGenContext = { profile, platformRules: PLATFORM_RULES, patterns, inputsDbName, outputsDbName };
            const ladPrompt = buildIoLinkingLadPrompt(devices, ioList, context, promptSections);
            const { content } = await validateAndCall(
              callNonStreaming,
              ladPrompt,
              [{ role: "user", content: `Generate the ${ioLinkingFcName} LAD FC.` }],
              abort.signal,
              DEVICE_GEN_MAX_TOKENS,
              "io_linking",
              !!profile,
            );
            const artifact = parseLadArtifact(content, ioLinkingFcName, "device");
            if (!artifact) console.warn("[forge] LAD IO linking parse failed:", content.slice(0, 500));
            if (artifact) allArtifacts.push({ ...artifact, type: "FC" as const });
          } else {
            const ioLinkingCode = generateIoLinkingFc(ioList, inputsDbName, outputsDbName, ioLinkingFcName);
            allArtifacts.push({
              id: crypto.randomUUID(),
              name: ioLinkingFcName,
              type: "FC",
              language: "SCL",
              content: ioLinkingCode,
              approved: false,
              stage: "device",
              destination_folder: ioLinkingFolder,
              dependencies: [],
              compile_after_import: true,
            });
          }
        }

        // --- Step 5: Device Call FCs (one per device type, AI-generated) ---
        const callFcLang2 = profile.device_call_fc_language ?? "SCL";
        for (let i = 0; i < uniqueDeviceTypes.length; i++) {
          const deviceType = uniqueDeviceTypes[i];
          const fcName = deviceTypeToFcName(deviceType, fcPrefix || undefined);
          setProgress({
            current: 3 + matrixGlobalDbs.length + i + 1,
            total: totalSteps,
            currentDevice: `${fcName} FC`,
          });

          const groupDevices = devices.filter((d) => d.device_type === deviceType);
          const instanceDbNames = groupDevices.map(
            (d) => `${instDbPrefix}${d.name.replace(/[^A-Za-z0-9]/g, "")}`,
          );

          const groupSignalTags = new Set(
            groupDevices
              .flatMap((d) => d.io_signals ?? [])
              .map((s) => s.tag_name.replace(/[^A-Za-z0-9]/g, "").toLowerCase()),
          );
          const groupIoListEntries = (ioList ?? []).filter((io) => {
            const ioStem = (io.tag_name ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
            return [...groupSignalTags].some(
              (s) => ioStem.includes(s) || s.includes(ioStem) || ioStem === s,
            );
          });
          const relevantInputs = groupIoListEntries.filter(
            (io) => io.signal_type === "DI" || io.signal_type === "AI",
          );
          const relevantOutputs = groupIoListEntries.filter(
            (io) => io.signal_type === "DQ" || io.signal_type === "AQ",
          );
          const inputsDbFields = relevantInputs.map((io) => io.tag_name);
          const outputsDbFields = relevantOutputs.map((io) => io.tag_name);
          appendLog("info", `${fcName}: calling instances [${instanceDbNames.join(", ")}], inputs [${inputsDbFields.join(", ") || "none"}], outputs [${outputsDbFields.join(", ") || "none"}]`);

          // Build global DB name map for wiring normalization (HmiData → DB_HmiData etc.)
          const globalDbMap2 = new Map<string, string>();
          for (const a of allArtifacts) {
            if (a.type !== "DB" || a.name.startsWith(instDbPrefix) || a.name === inputsDbName || a.name === outputsDbName) continue;
            globalDbMap2.set(a.name.toLowerCase(), a.name);
            if (a.name.startsWith("DB_")) globalDbMap2.set(a.name.slice(3).toLowerCase(), a.name);
          }

          // Build normalized wiring with all fixes applied
          const matrixWiring = buildNormalizedMatrixWiring(
            matrix, deviceType, devices, instDbPrefix, ioList ?? [], deviceTypeFbInterfaces, appendLog, globalDbMap2,
          );

          const fbIfaceText = deviceTypeFbInterfaces.get(deviceType) ?? "";

          // Look up relevant reference library sections for this device type
          let refSectionsText2 = "";
          try {
            const refContext2 = `Device type: ${deviceType}\nFB: ${deviceTypeFbNames.get(deviceType) ?? fcName}\n${fbIfaceText.slice(0, 2000)}`;
            const callFcLang2 = profile.device_call_fc_language ?? "SCL";
            const refSections2 = await getRelevantReferenceSections(
              refContext2, "generation_request", "SIEMENS_TIA", abort.signal, 10,
            );
            refSectionsText2 = formatReferenceSections(refSections2, callFcLang2 === "LAD" ? "LAD" : "SCL");
          } catch { /* reference lookup is best-effort */ }

          const context: DeviceCallFcContext = {
            fcName,
            deviceType,
            fbName: deviceTypeFbNames.get(deviceType),
            devices: groupDevices,
            instanceDbNames,
            fbInterfaceSection: fbIfaceText,
            inputsDbFields,
            outputsDbFields,
            inputsDbName,
            outputsDbName,
            profile,
            platformRules: PLATFORM_RULES,
            patterns,
            matrixWiring,
            referenceSections: refSectionsText2 || undefined,
          };

          const allInstancesWired = instanceDbNames.every(name =>
            matrixWiring.some(d => d.instanceDbName === name && d.wiring.length > 0),
          );

          // Validate that all wiring param names exist in the FB interface
          const fbParamsRe2 = /^\s+(\w+)\s*:/gm;
          const actualFbParamSet2 = new Set<string>();
          let _pm2: RegExpExecArray | null;
          while ((_pm2 = fbParamsRe2.exec(fbIfaceText)) !== null) actualFbParamSet2.add(_pm2[1].toLowerCase());

          const wiringParamsValid2 = actualFbParamSet2.size === 0 || matrixWiring.every(d =>
            d.wiring.every(w => actualFbParamSet2.has(w.paramName.toLowerCase())),
          );
          if (!wiringParamsValid2) {
            const bad2 = matrixWiring.flatMap(d => d.wiring.filter(w => !actualFbParamSet2.has(w.paramName.toLowerCase())).map(w => w.paramName)).filter((v, i, a) => a.indexOf(v) === i);
            appendLog("warn", `${fcName}: matrix param(s) [${bad2.join(", ")}] not found in FB — falling back to AI`);
          }

          if (!allInstancesWired && matrixWiring.length > 0) {
            appendLog("warn", `${fcName}: ${instanceDbNames.length - matrixWiring.filter(d => d.wiring.length > 0).length} instance(s) missing matrix wiring — falling back to AI`);
          }

          // Deterministic path — all instances wired and params valid
          if (allInstancesWired && wiringParamsValid2) {
            if (callFcLang2 === "LAD") {
              const ladJson = generateDeviceCallFcLad(context);
              if (ladJson) {
                appendLog("info", `${fcName}: generated LAD deterministically from matrix wiring`);
                allArtifacts.push({
                  id: crypto.randomUUID(),
                  name: fcName,
                  type: "FC",
                  language: "LAD",
                  content: ladJson,
                  approved: false,
                  stage: "device",
                  destination_folder: callFcFolder,
                  dependencies: [],
                  compile_after_import: true,
                });
              }
            } else {
              const deterministicScl = generateDeviceCallFc(context);
              if (deterministicScl) {
                appendLog("info", `${fcName}: generated SCL deterministically from matrix wiring`);
                allArtifacts.push({
                  id: crypto.randomUUID(),
                  name: fcName,
                  type: "FC",
                  language: "SCL",
                  content: deterministicScl,
                  approved: false,
                  stage: "device",
                  destination_folder: callFcFolder,
                  dependencies: [],
                  compile_after_import: true,
                });
              }
            }
          } else if (callFcLang2 === "LAD") {
            const abort = new AbortController();
            const { content } = await validateAndCall(
              callNonStreaming,
              buildDeviceCallFcLadPrompt(context),
              [{ role: "user", content: buildDeviceCallFcUserMessage(context) }],
              abort.signal,
              DEVICE_GEN_MAX_TOKENS,
              "code_architect_lad",
              !!profile,
            );
            const artifact = parseLadArtifact(content, fcName, "device");
            if (!artifact) {
              appendLog("warn", `${fcName}: LAD parse failed — no artifact`);
            } else {
              appendLog("info", `${fcName}: generated LAD Call FC via AI`);
              allArtifacts.push({ ...artifact, type: "FC" as const });
            }
          } else {
            const abort = new AbortController();
            const { content } = await validateAndCall(
              callNonStreaming,
              buildDeviceCallFcPrompt(context, promptSections),
              [{ role: "user", content: buildDeviceCallFcUserMessage(context) }],
              abort.signal,
              DEVICE_GEN_MAX_TOKENS,
              "code_architect_scl",
              !!profile,
            );
            const fcArtifacts = parseSclArtifacts(content, "device");
            if (fcArtifacts.length === 0) {
              appendLog("warn", `${fcName}: no artifacts parsed — Device Call FC may be missing`);
            } else {
              appendLog("info", `${fcName}: generated ${fcArtifacts.map(a => a.name).join(", ")}`);
            }
            allArtifacts.push(...fcArtifacts);
          }
        }

        // Post-processing on combined fbArtifacts + allArtifacts
        const combined = [...fbArtifacts, ...allArtifacts];
        const deduped = new Map<string, ForgeArtifact>();
        for (const a of combined) deduped.set(`${a.type}:${a.name}`, a);
        const dedupedArtifacts = [...deduped.values()];

        appendLog("info", `Post-processing ${dedupedArtifacts.length} artifacts…`);
        const normalized = normalizeInstanceDbNames(dedupedArtifacts, devices, appendLog, instDbPrefix);
        const fixedRefs = fixFcInstanceDbReferences(normalized, appendLog, instDbPrefix);
        const fixedFields = fixFbInstanceFieldRefs(fixedRefs, appendLog, instDbPrefix);
        const deduped2 = deduplicateFbCallParams(fixedFields, appendLog);
        const deduped3 = deduplicateDbFields(deduped2, appendLog);
        const reconciled = reconcileUdtReferences(deduped3, appendLog);
        return backfillGlobalDbFields(reconciled, appendLog, instDbPrefix);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const regenerateSingleFb = useCallback(
    async (
      device: ForgeDeviceEntry,
      session: ForgeSession,
      profile: DesignProfile,
      patterns: PatternCandidate[],
      additionalInstructions: string,
    ): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);
      try {
        const artifacts = await generateSingle(
          device, session, profile, [], patterns, appendLog, additionalInstructions,
        );
        return artifacts.map(a => ({ ...a, stage: "device_fb" as const }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [generateSingle],
  );

  return { generateAll, generateFbsOnly, generateCallCode, generateSingle, regenerateSingleFb, loading, progress, error, log, clearLog };
}
