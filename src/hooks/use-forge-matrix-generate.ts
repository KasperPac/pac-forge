import { useState, useCallback } from "react";
import { callStreamingCollect } from "@/hooks/use-generation";
import {
  buildDeviceLinkagePrompt,
  buildDeviceLinkageUserMessage,
  buildSequencesPrompt,
  buildSequencesUserMessage,
} from "@/lib/forge-prompts";
import { formatDesignProfile, formatPatterns } from "@/lib/prompt-builder";
import { loadPlatformRules } from "@/lib/platform-rules";
import type { ForgeDeviceEntry, ForgeIoEntry, ForgeArtifact, SpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type { DesignProfile } from "@/types/design-profile";
import type { PatternCandidate } from "@/types";
import type { AgentKnowledgeDoc } from "@/types";
import type { ProcessLinkageMatrix, ProcessSequence, SequenceRow, LinkageGlobalData, LinkageDevice, FaultMatrixEntry } from "@/types/forge-matrix";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { getRelevantReferenceSections, formatReferenceSections } from "@/lib/reference-lookup";

const DEVICE_LINKAGE_MAX_TOKENS = 20000;
const SEQUENCES_MAX_TOKENS = 28000;

/**
 * Extract all global DB field names from device linkage wiring AND statusMirrors.
 * Groups by DB name (e.g. ProcessCommands, ProcessState, FaultData).
 * These are the ONLY field names the sequence AI should use.
 */
function extractWiringFieldNames(deviceLinkage: LinkageDevice[]): Map<string, Set<string>> {
  const dbFields = new Map<string, Set<string>>();

  function addField(path: string) {
    const dotIdx = path.indexOf(".");
    if (dotIdx === -1) return;
    const dbName = path.slice(0, dotIdx);
    const fieldName = path.slice(dotIdx + 1);
    // Skip sub-field access (e.g. Configuration.motor1Config.faultDelay)
    if (fieldName.includes(".")) return;
    // Skip IO-layer DBs
    if (/^(Inputs|Outputs|DB_Inputs|DB_Outputs)$/i.test(dbName)) return;
    if (!dbFields.has(dbName)) dbFields.set(dbName, new Set());
    dbFields.get(dbName)!.add(fieldName);
  }

  for (const device of deviceLinkage) {
    // Regular wiring
    for (const wire of device.wiring) {
      if (wire.wireType !== "global" || !wire.connectedTo) continue;
      addField(wire.connectedTo);
    }
    // Status mirrors → ProcessState fields
    for (const mirror of device.statusMirrors ?? []) {
      if (mirror.target) addField(mirror.target);
    }
  }

  return dbFields;
}

/**
 * Reconcile sequence variable names against device linkage wiring.
 * Since device linkage and sequences are generated in parallel, the sequence AI
 * may invent shorthand names (m01RunFwd) that don't match the device linkage
 * field names (m01CommandForward). This function builds a mapping from the
 * device linkage wiring and fixes sequence references.
 */
function reconcileSequenceFieldNames(
  sequences: ProcessSequence[],
  globalData: LinkageGlobalData[],
  deviceLinkage: LinkageDevice[],
): ProcessSequence[] {
  // Build canonical field names from device linkage wiring
  const canonicalFields = new Map<string, string>(); // normalized → actual
  for (const device of deviceLinkage) {
    for (const wire of device.wiring) {
      const connected = wire.connectedTo ?? "";
      const dotIdx = connected.indexOf(".");
      if (dotIdx === -1) continue;
      const fieldName = connected.slice(dotIdx + 1);
      if (fieldName) {
        canonicalFields.set(fieldName.toLowerCase(), fieldName);
        // Also index without common prefix variations
        const stripped = fieldName.toLowerCase()
          .replace(/command/g, "cmd")
          .replace(/forward/g, "fwd")
          .replace(/reverse/g, "rev");
        if (stripped !== fieldName.toLowerCase()) {
          canonicalFields.set(stripped, fieldName);
        }
      }
    }
  }
  // Also add globalData field names
  for (const db of globalData) {
    for (const field of db.fields) {
      canonicalFields.set(field.fieldName.toLowerCase(), field.fieldName);
      const stripped = field.fieldName.toLowerCase()
        .replace(/command/g, "cmd")
        .replace(/forward/g, "fwd")
        .replace(/reverse/g, "rev");
      if (stripped !== field.fieldName.toLowerCase()) {
        canonicalFields.set(stripped, field.fieldName);
      }
    }
  }

  // Fix sequence text references
  function fixFieldRef(text: string): string {
    if (!text) return text;
    // Match DB.field patterns
    return text.replace(/(\w+)\.(\w+)/g, (_match, db, field) => {
      const normalized = field.toLowerCase()
        .replace(/command/g, "cmd")
        .replace(/forward/g, "fwd")
        .replace(/reverse/g, "rev");
      const canonical = canonicalFields.get(normalized) ?? canonicalFields.get(field.toLowerCase());
      return canonical && canonical !== field ? `${db}.${canonical}` : _match;
    });
  }

  return sequences.map(seq => ({
    ...seq,
    permissives: seq.permissives.map(p => ({
      ...p,
      description: fixFieldRef(p.description),
    })),
    safetyConditions: (seq.safetyConditions ?? []).map(s => ({
      ...s,
      description: fixFieldRef(s.description),
    })),
    rows: seq.rows?.map((row) => ({
      ...row,
      condition: fixFieldRef(row.condition),
      action: fixFieldRef(row.action),
      output: row.output ? fixFieldRef(row.output) : row.output,
    })),
    steps: seq.steps?.map((step) => ({
      ...step,
      actions: (step.actions ?? []).map((action) => ({
        ...action,
        description: fixFieldRef(action.description),
      })),
      transition: step.transition ? {
        ...step.transition,
        conditions: step.transition.conditions.map((condition) => ({
          ...condition,
          description: fixFieldRef(condition.description),
        })),
      } : step.transition,
      completionCriteria: step.completionCriteria ? fixFieldRef(step.completionCriteria) : step.completionCriteria,
    })),
  }));
}

function tryParseJson<T>(text: string): T | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null) return parsed as T;
  } catch { /* fall through */ }
  return null;
}

function extractTaggedBlock(content: string, tag: string): string | null {
  const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
  const m = content.match(re);
  return m ? m[1] : null;
}

function extractJsonFromContent(content: string): string | null {
  // Try fenced code block first
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1];
  // Fall back to outermost JSON object
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) return content.slice(start, end + 1);
  return null;
}

function parseDeviceLinkage(content: string): Pick<ProcessLinkageMatrix, "deviceLinkage" | "configUdts"> {
  const tagged = extractTaggedBlock(content, "DEVICE_LINKAGE");
  if (tagged) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "deviceLinkage" | "configUdts">>(tagged);
    if (result?.deviceLinkage) return result;
    throw new Error(`Device linkage JSON is invalid: ${tagged.slice(0, 200)}…`);
  }
  const raw = extractJsonFromContent(content);
  if (raw) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "deviceLinkage" | "configUdts">>(raw);
    if (result?.deviceLinkage) return result;
  }
  throw new Error(`Could not parse device linkage. Last 300: ${content.slice(-300)}`);
}

function parseSequences(content: string): Pick<ProcessLinkageMatrix, "processSequences" | "globalData" | "notes" | "generatedAt"> {
  const tagged = extractTaggedBlock(content, "SEQUENCES_DATA");
  if (tagged) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "processSequences" | "globalData" | "notes" | "generatedAt">>(tagged);
    if (result?.processSequences) return result;
    throw new Error(`Sequences JSON is invalid: ${tagged.slice(0, 200)}…`);
  }
  const raw = extractJsonFromContent(content);
  if (raw) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "processSequences" | "globalData" | "notes" | "generatedAt">>(raw);
    if (result?.processSequences) return result;
  }
  throw new Error(`Could not parse sequences. Last 300: ${content.slice(-300)}`);
}

/**
 * Post-processing: scan each sequence's rows for "orphan" steps — steps where no
 * other row's `next` pointer targets them (and they're not the entry step).
 * When found, fix the preceding step group's `next` pointers to target the orphan
 * instead of skipping over it.
 */
/**
 * Defensive post-processing: if the AI puts OR / || inside a single row's
 * condition, split that row into separate branch rows (a, b, c …) at the
 * same step number.  This prevents the deterministic compiler from throwing
 * "OR conditions must be split into separate matrix rows".
 */
function splitOrRows(sequences: ProcessSequence[]): ProcessSequence[] {
  const OR_RE = /\s+OR\s+|\|\|/i;
  return sequences.map((seq) => {
    if (!seq.rows?.length) return seq;

    let changed = false;
    const out: SequenceRow[] = [];

    for (const row of seq.rows) {
      if (!OR_RE.test(row.condition)) {
        out.push(row);
        continue;
      }

      changed = true;
      const parts = row.condition.split(OR_RE).map((s) => s.trim()).filter(Boolean);

      // Check if any other rows at this step already use branch letters
      const existingBranches = seq.rows
        .filter((r) => r.step === row.step && r.branch)
        .map((r) => r.branch!);

      let nextLetter = "a".charCodeAt(0);
      if (existingBranches.length) {
        const maxCode = Math.max(...existingBranches.map((b) => b.charCodeAt(0)));
        nextLetter = maxCode + 1;
      }

      for (const part of parts) {
        out.push({
          ...row,
          condition: part,
          branch: String.fromCharCode(nextLetter),
          type: "branch",
        });
        nextLetter++;
      }

      console.warn(
        `[forge:matrix] Auto-split OR condition at ${seq.name} step ${row.step}: "${row.condition}" → ${parts.length} branch rows`,
      );
    }

    return changed ? { ...seq, rows: out } : seq;
  });
}

function fixOrphanSteps(sequences: ProcessSequence[]): ProcessSequence[] {
  return sequences.map((seq) => {
    if (!seq.rows?.length) return seq;

    const rows = seq.rows;
    const allStepNums = [...new Set(rows.map((r) => r.step))].sort((a, b) => a - b);
    const entryStep = allStepNums[0];

    // Build set of all steps targeted by a `next` pointer
    const targeted = new Set<number>();
    for (const r of rows) {
      if (typeof r.next === "number") targeted.add(r.next);
    }

    // Orphans: step numbers not targeted by any `next` pointer, excluding the entry step
    const orphans = allStepNums.filter((s) => s !== entryStep && !targeted.has(s));
    if (orphans.length === 0) return seq;

    // For each orphan, find the preceding step group (highest step < orphan)
    // and fix any rows whose `next` currently skips over it
    const fixedRows = rows.map((r) => {
      let row = r;
      for (const orphan of orphans) {
        const prevStep = Math.max(...allStepNums.filter((s) => s < orphan));
        if (
          r.step === prevStep &&
          typeof r.next === "number" &&
          r.next > orphan
        ) {
          row = { ...row, next: orphan };
        }
      }
      return row;
    });

    return { ...seq, rows: fixedRows };
  });
}

function slugToTag(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]+/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "faultGeneric";
  // Cap at 4 words to avoid absurd tag names from full-sentence descriptions
  const capped = parts.slice(0, 4);
  return `fault${capped.map((part) => part[0].toUpperCase() + part.slice(1)).join("")}`;
}

function deriveFaultCondition(
  description: string,
  polarity: boolean,
): string {
  const trimmed = description.trim();
  if (/^(?:"[^"]+"(?:\.[A-Za-z_][A-Za-z0-9_]*)*|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\[[0-9]+\])?$/i.test(trimmed)) {
    return polarity ? trimmed : `NOT ${trimmed}`;
  }
  const match = trimmed.match(/"[^"]+"(?:\.[A-Za-z_][A-Za-z0-9_]*)*|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\[[0-9]+\])?/);
  if (match) {
    return polarity ? match[0] : `NOT ${match[0]}`;
  }
  return polarity ? trimmed : `NOT (${trimmed})`;
}

/**
 * Extract fault field names that the AI actually used in sequence conditions
 * and outputs. These are the canonical names the fault DB must use.
 * Looks for patterns like DB_FaultData.fieldName in conditions and outputs.
 */
function extractFaultFieldsFromSequences(
  sequences: ProcessSequence[],
  faultDbName = "DB_FaultData",
): Map<string, { tag: string; description: string; condition: string; source: string; sequences: string[] }> {
  const fields = new Map<string, { tag: string; description: string; condition: string; source: string; sequences: string[] }>();
  // Match DB_FaultData.fieldName or FaultData.fieldName references
  // Also match fault-like fields in ProcessState as fallback (e.g. DB_ProcessState.faultF001*)
  const dbPatterns = [faultDbName, faultDbName.replace(/^DB_/, ""), "DB_Faults", "Faults"];
  const fieldRe = new RegExp(
    `(?:${dbPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\.([a-zA-Z_][a-zA-Z0-9_]*)`,
    "g",
  );
  // Fallback: catch fault fields placed in ProcessState (AI sometimes puts them there)
  const fallbackRe = /DB_ProcessState\.(fault[A-Z_][a-zA-Z0-9_]*)/g;

  // Skip meta fields — these are hardcoded in buildDeterministicFaultDb
  const metaFields = new Set(["faultActive", "faultCode", "faultReset", "anyFaultLatched"]);

  for (const seq of sequences) {
    for (const row of seq.rows ?? []) {
      const texts = [row.condition, row.output, row.action].filter(Boolean);
      for (const text of texts) {
        // Primary: scan for DB_FaultData.* references
        let m: RegExpExecArray | null;
        fieldRe.lastIndex = 0;
        while ((m = fieldRe.exec(text!)) !== null) {
          const fieldName = m[1];
          if (metaFields.has(fieldName)) continue;
          if (!fields.has(fieldName)) {
            fields.set(fieldName, {
              tag: fieldName,
              description: row.action || row.condition,
              condition: row.condition,
              source: row.type === "fault_exit" ? "fault_exit" : "sequence_reference",
              sequences: [seq.name],
            });
          } else {
            const entry = fields.get(fieldName)!;
            if (!entry.sequences.includes(seq.name)) entry.sequences.push(seq.name);
          }
        }
        // Fallback: scan for fault-like fields in ProcessState
        fallbackRe.lastIndex = 0;
        while ((m = fallbackRe.exec(text!)) !== null) {
          const fieldName = m[1];
          if (metaFields.has(fieldName) || fields.has(fieldName)) continue;
          fields.set(fieldName, {
            tag: fieldName,
            description: row.action || row.condition,
            condition: row.condition,
            source: row.type === "fault_exit" ? "fault_exit" : "sequence_reference",
            sequences: [seq.name],
          });
        }
      }
    }
  }

  return fields;
}

function deriveFaultMatrix(sequences: ProcessSequence[]): FaultMatrixEntry[] {
  // Primary: extract fault fields the AI actually referenced in sequence logic.
  // This ensures the fault DB field names match what the sequence FCs use.
  const aiFields = extractFaultFieldsFromSequences(sequences);

  const entries: FaultMatrixEntry[] = [];
  let code = 1;
  const seen = new Set<string>();

  // Add AI-referenced fields first (these are the canonical names)
  for (const [fieldName, info] of aiFields) {
    if (seen.has(fieldName)) continue;
    seen.add(fieldName);
    entries.push({
      id: crypto.randomUUID(),
      code: `F${String(code++).padStart(3, "0")}`,
      tag: fieldName,
      description: info.description,
      condition: deriveFaultCondition(info.condition, true),
      resetCondition: `"DB_FaultData".faultReset`,
      source: info.source,
      severity: "fault",
      affectsSequences: info.sequences,
    });
  }

  // Safety conditions are NOT added as separate faults — they are checked
  // by permissives (continuous monitoring) and their fault effects are already
  // captured in the sequence fault_exit rows above. Adding them would create
  // duplicate faults with prose-derived conditions that don't compile.

  return entries;
}

/**
 * Hook to generate a ProcessLinkageMatrix from session data.
 * Runs two parallel AI calls (device linkage + sequences/global data) and merges results.
 */
export function useForgeMatrixGenerate() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (
      devices: ForgeDeviceEntry[],
      ioList: ForgeIoEntry[],
      specAnalysis: SpecAnalysis | null,
      fbTemplates?: FbTemplate[],
      generatedFbArtifacts?: ForgeArtifact[],
      profile?: DesignProfile,
      patterns?: PatternCandidate[],
      agentKnowledgeDocs?: AgentKnowledgeDoc[],
    ): Promise<ProcessLinkageMatrix> => {
      setLoading(true);
      setError(null);

      try {
        // Format optional knowledge sources
        const profileRules = profile ? formatDesignProfile(profile, "general") : undefined;
        const patternSection = patterns?.length ? formatPatterns(patterns) : undefined;
        const knowledgeText = agentKnowledgeDocs?.length
          ? agentKnowledgeDocs.map(d => `### ${d.title}\n${d.content}`).join("\n\n---\n\n")
          : undefined;

        // Reference library lookup — build context from devices + spec
        const abort = new AbortController();
        let refSectionsText: string | undefined;
        try {
          const refContext = devices.map(d =>
            `${d.name} (${d.device_type}): ${d.description ?? ""}`
          ).join("\n");
          const refSections = await getRelevantReferenceSections(
            refContext, "generation_request", "SIEMENS_TIA", abort.signal, 15,
          );
          const formatted = formatReferenceSections(refSections);
          refSectionsText = formatted || undefined;
        } catch { /* reference lookup is best-effort */ }

        // Step 1: Generate device linkage FIRST — we need the wiring field names
        const deviceResult = await callStreamingCollect(
          buildDeviceLinkagePrompt(promptSections, loadPlatformRules("matrix"), profileRules, patternSection, refSectionsText, knowledgeText),
          [{ role: "user", content: buildDeviceLinkageUserMessage(devices, ioList, fbTemplates, generatedFbArtifacts) }],
          new AbortController().signal,
          DEVICE_LINKAGE_MAX_TOKENS,
          { pipeline_step: "forge.matrix.device_linkage", artifact_type: "matrix" },
        );
        const deviceContent = deviceResult.content;

        const { deviceLinkage, configUdts } = parseDeviceLinkage(deviceContent);

        // Extract wiring field names to feed into sequences prompt
        const wiringFieldNames = extractWiringFieldNames(deviceLinkage);

        // Step 2: Generate sequences WITH the wiring field names from step 1
        console.log("[forge:matrix] Wiring field names for sequences:", JSON.stringify(Object.fromEntries([...wiringFieldNames].map(([k, v]) => [k, [...v]]))));
        const sequenceResult = await callStreamingCollect(
          buildSequencesPrompt(promptSections, loadPlatformRules("matrix"), profileRules, patternSection, refSectionsText, knowledgeText),
          [{ role: "user", content: buildSequencesUserMessage(devices, specAnalysis, wiringFieldNames) }],
          new AbortController().signal,
          SEQUENCES_MAX_TOKENS,
          { pipeline_step: "forge.matrix.sequences", artifact_type: "matrix" },
        );
        const sequenceContent = sequenceResult.content;

        const { processSequences, globalData, notes, generatedAt } = parseSequences(sequenceContent);

        // Reconcile sequence field names against device linkage wiring
        // (sequences are generated in parallel and may use shorthand names)
        const reconciledSequences = reconcileSequenceFieldNames(
          processSequences ?? [],
          globalData ?? [],
          deviceLinkage,
        );
        const fixedSequences = splitOrRows(fixOrphanSteps(reconciledSequences));

        if (configUdts?.length) {
          console.log(`[forge:matrix] ${configUdts.length} config UDT(s) defined: ${configUdts.map(u => u.name).join(", ")}`);
        }

        return {
          version: 1,
          deviceLinkage,
          globalData: globalData ?? [],
          processSequences: fixedSequences,
          faultMatrix: deriveFaultMatrix(fixedSequences),
          configUdts: configUdts ?? [],
          notes: notes ?? "",
          generatedAt: generatedAt ?? new Date().toISOString(),
          lastReviewedAt: null,
          reviewStatus: "draft",
        };
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

  return { generate, loading, error };
}
