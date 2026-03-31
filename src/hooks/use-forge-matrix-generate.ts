import { useState, useCallback } from "react";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import {
  buildDeviceLinkagePrompt,
  buildDeviceLinkageUserMessage,
  buildSequencesPrompt,
  buildSequencesUserMessage,
} from "@/lib/forge-prompts";
import { formatDesignProfile, formatPatterns } from "@/lib/prompt-builder";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import type { ForgeDeviceEntry, ForgeIoEntry, ForgeArtifact, SpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type { DesignProfile } from "@/types/design-profile";
import type { PatternCandidate } from "@/types";
import type { AgentKnowledgeDoc } from "@/types";
import type { ProcessLinkageMatrix, ProcessSequence, LinkageGlobalData, LinkageDevice } from "@/types/forge-matrix";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { getRelevantReferenceSections, formatReferenceSections } from "@/lib/reference-lookup";

const DEVICE_LINKAGE_MAX_TOKENS = 20000;
const SEQUENCES_MAX_TOKENS = 28000;

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
    rows: (seq.rows ?? seq.steps ?? []).map(r => ({
      ...r,
      condition: fixFieldRef(r.condition ?? ""),
      action: fixFieldRef(r.action ?? ""),
      output: r.output ? fixFieldRef(r.output) : r.output,
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

function parseDeviceLinkage(content: string): Pick<ProcessLinkageMatrix, "deviceLinkage"> {
  const tagged = extractTaggedBlock(content, "DEVICE_LINKAGE");
  if (tagged) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "deviceLinkage">>(tagged);
    if (result?.deviceLinkage) return result;
    throw new Error(`Device linkage JSON is invalid: ${tagged.slice(0, 200)}…`);
  }
  const raw = extractJsonFromContent(content);
  if (raw) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "deviceLinkage">>(raw);
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

        const [deviceContent, sequenceContent] = await Promise.all([
          streamFromEdgeFunction(
            {
              system_prompt: buildDeviceLinkagePrompt(promptSections, PLATFORM_RULES, profileRules, patternSection, refSectionsText, knowledgeText),
              messages: [{ role: "user", content: buildDeviceLinkageUserMessage(devices, ioList, fbTemplates, generatedFbArtifacts) }],
              stream: true,
            },
            new AbortController().signal,
            () => {},
            DEVICE_LINKAGE_MAX_TOKENS,
          ),
          streamFromEdgeFunction(
            {
              system_prompt: buildSequencesPrompt(promptSections, PLATFORM_RULES, profileRules, patternSection, refSectionsText, knowledgeText),
              messages: [{ role: "user", content: buildSequencesUserMessage(devices, specAnalysis) }],
              stream: true,
            },
            new AbortController().signal,
            () => {},
            SEQUENCES_MAX_TOKENS,
          ),
        ]);

        const { deviceLinkage } = parseDeviceLinkage(deviceContent);
        const { processSequences, globalData, notes, generatedAt } = parseSequences(sequenceContent);

        // Reconcile sequence field names against device linkage wiring
        // (sequences are generated in parallel and may use shorthand names)
        const reconciledSequences = reconcileSequenceFieldNames(
          processSequences ?? [],
          globalData ?? [],
          deviceLinkage,
        );
        const fixedSequences = fixOrphanSteps(reconciledSequences);

        return {
          version: 1,
          deviceLinkage,
          globalData: globalData ?? [],
          processSequences: fixedSequences,
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
