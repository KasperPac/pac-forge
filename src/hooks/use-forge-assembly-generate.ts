/**
 * Hook for generating assembly FBs — extracted from use-forge-device-generate.ts.
 * Supports both FDS-driven generation (AssemblyBrief) and standalone (SpecAnalysis).
 */
import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
// Wave 5: dialect helper reserved for signal-type emission at this site.
import { toSiemens } from "@/lib/spec-builder/dialect";
void toSiemens;
import {
  buildAssemblySclPrompt,
  buildAssemblySclUserMessage,
} from "@/lib/forge-prompts";
import type { AssemblyGenContext } from "@/lib/forge-prompts";
import { loadPlatformRules } from "@/lib/platform-rules";
import type {
  ForgeSession,
  ForgeArtifact,
  ForgeAssemblyEntry,
} from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";
import type { AssemblyBrief } from "@/types/forge-brief";
import { parseDeclaredInterface } from "@/lib/fb-library/scl-interface-parser";
import { compareToContract, formatDriftFeedback } from "@/lib/fb-library/contract-drift";
import type { DriftReport } from "@/lib/fb-library/contract-drift";
import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import { isContractPopulated } from "@/types/fb-interface-contract";

// ---------------------------------------------------------------------------
// Artifact parser (duplicated from use-forge-device-generate — pure function)
// ---------------------------------------------------------------------------

function parseSclArtifacts(
  rawContent: string,
  stage: ForgeArtifact["stage"],
): ForgeArtifact[] {
  const artifacts: ForgeArtifact[] = [];
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

// ---------------------------------------------------------------------------
// Template copy helper
// ---------------------------------------------------------------------------

function copyTemplateAsAssemblyArtifacts(
  _assembly: ForgeAssemblyEntry,
  template: FbTemplate,
): ForgeArtifact[] {
  return (template.blocks ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((block) => ({
      id: crypto.randomUUID(),
      name: block.block_name,
      type: block.block_type as ForgeArtifact["type"],
      language: "SCL" as const,
      content: block.scl_code,
      approved: false,
      fb_template_id: template.id,
      library_block: template.source === "library",
      stage: "assembly_fb" as const,
      destination_folder:
        block.block_type === "UDT" ? "Types"
        : block.block_type === "DB" ? "Data blocks"
        : "Program blocks/Forge",
      dependencies: [],
      compile_after_import: true,
    }));
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

export interface AssemblyGenProgress {
  current: number;
  total: number;
  assemblyTag: string;
}

export type AssemblyGenLogLevel = "info" | "warn" | "error" | "fix";

export interface AssemblyGenLogEntry {
  level: AssemblyGenLogLevel;
  message: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Drift retry budget
// ---------------------------------------------------------------------------

const MAX_DRIFT_RETRIES = 2;

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useForgeAssemblyGenerate() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<AssemblyGenProgress>({ current: 0, total: 0, assemblyTag: "" });
  const [error, setError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<AssemblyGenLogEntry[]>([]);

  const log = useCallback((level: AssemblyGenLogLevel, message: string) => {
    setLogEntries((prev) => [...prev, { level, message, timestamp: Date.now() }]);
  }, []);

  const clearLog = useCallback(() => setLogEntries([]), []);

  /**
   * Generate a single assembly FB.
   * If a library template matches, copies it. Otherwise generates via AI.
   * When brief is provided, the prompt includes FDS behavioral data.
   */
  const generateSingle = useCallback(
    async (
      assembly: ForgeAssemblyEntry,
      session: ForgeSession,
      profile: DesignProfile,
      deviceArtifacts: ForgeArtifact[],
      fbTemplates: FbTemplate[],
      patterns: PatternCandidate[],
      brief?: AssemblyBrief,
      instructions?: string,
      contract?: FbInterfaceContract,
      subsystem?: string,
    ): Promise<ForgeArtifact[]> => {
      // Check for library template match — contract is ignored for library path
      const matchedTemplate = assembly.fb_template_id
        ? fbTemplates.find((t) => t.id === assembly.fb_template_id) ?? null
        : null;

      if (matchedTemplate && matchedTemplate.blocks && matchedTemplate.blocks.length > 0) {
        log("info", `${assembly.tag}: copying template "${matchedTemplate.name}"`);
        return copyTemplateAsAssemblyArtifacts(assembly, matchedTemplate);
      }

      // AI generation
      log("info", `${assembly.tag}: generating via AI${brief ? " (FDS-driven)" : ""}${contract && isContractPopulated(contract) ? " (contract-constrained)" : ""}`);
      const platformRules = await loadPlatformRules();

      const constituentDevices = (session.device_list ?? []).filter(
        (d) => assembly.device_ids.includes(d.id),
      );

      const specAnalysis = session.spec_analysis;
      const relevantInterlocks = specAnalysis?.interlocks?.filter(
        (i) => i.affected_devices?.some(
          (name) =>
            constituentDevices.some((d) => d.name === name || d.tag === name) ||
            name === assembly.name ||
            name === assembly.tag,
        ),
      );
      // Wave 5 note: the contract-backed path populates `brief.alarmConditions`
      // by device_id / assembly_id foreign keys. The tag-substring fallback
      // below only fires when no contract is bound (standalone SpecAnalysis
      // mode) — it should be removed once standalone mode is retired.
      const relevantAlarms = specAnalysis?.alarms?.filter(
        (a) =>
          a.affected_sequences?.some((seq) =>
            seq.toLowerCase().includes(assembly.tag.toLowerCase()),
          ) || a.description?.toLowerCase().includes(assembly.tag.toLowerCase()),
      );

      const context: AssemblyGenContext = {
        profile,
        platformRules,
        patterns,
        constituentDevices,
        deviceArtifacts,
        interlocks: relevantInterlocks,
        alarms: relevantAlarms,
        brief,
        contract,
        subsystem,
      };

      const systemPrompt = buildAssemblySclPrompt(assembly, context);
      const baseUserMessage = buildAssemblySclUserMessage(assembly);
      let userMessage = instructions
        ? `${baseUserMessage}\n\n## Engineer Instructions\n${instructions}`
        : baseUserMessage;

      // No contract or empty contract — single call, no drift detection (today's behaviour unchanged)
      if (!contract || !isContractPopulated(contract)) {
        const controller = new AbortController();
        const { content } = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: userMessage }],
          controller.signal,
          16384,
          { prompt_name: "forge-assembly-fb", agent_role: "code_architect", pipeline_step: "assembly_fb" },
        );
        const artifacts = parseSclArtifacts(content, "assembly_fb");
        log("info", `${assembly.tag}: generated ${artifacts.length} artifacts`);
        return artifacts;
      }

      // Resolve {subsystem}/{assembly} tokens in process_state_writes/reads before drift check
      const resolvedContract: FbInterfaceContract = {
        ...contract,
        process_state_writes: contract.process_state_writes.map(w =>
          w
            .replace(/\{subsystem\}/g, subsystem ?? "")
            .replace(/\{assembly\}/g, assembly.tag)
        ),
        process_state_reads: contract.process_state_reads.map(r =>
          r
            .replace(/\{subsystem\}/g, subsystem ?? "")
            .replace(/\{assembly\}/g, assembly.tag)
        ),
      };

      let lastReport: DriftReport = { hardDrifts: [], softDrifts: [], hasHardDrift: false };
      let lastContent = "";
      let attempts = 0;

      while (attempts <= MAX_DRIFT_RETRIES) {
        const controller = new AbortController();
        const { content } = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: userMessage }],
          controller.signal,
          16384,
          { prompt_name: "forge-assembly-fb", agent_role: "code_architect", pipeline_step: "assembly_fb" },
        );

        lastContent = content;

        const parsed = parseDeclaredInterface(content);
        lastReport = compareToContract(parsed, resolvedContract);

        if (!lastReport.hasHardDrift) {
          const artifacts = parseSclArtifacts(content, "assembly_fb");
          log("info", `${assembly.tag}: generated ${artifacts.length} artifacts${attempts > 0 ? ` (after ${attempts} drift retries)` : ""}`);
          return artifacts;
        }

        attempts += 1;
        if (attempts > MAX_DRIFT_RETRIES) break;

        log("warn", `${assembly.tag}: retry ${attempts}/${MAX_DRIFT_RETRIES} — ${lastReport.hardDrifts.length} hard drifts`);
        userMessage = `${formatDriftFeedback(lastReport)}\n\n${baseUserMessage}${instructions ? `\n\n## Engineer Instructions\n${instructions}` : ""}`;
      }

      // Persistent drift after retry budget exhausted — surface to caller
      const artifacts = parseSclArtifacts(lastContent, "assembly_fb");
      log("error", `${assembly.tag}: persistent drift after ${MAX_DRIFT_RETRIES} retries — ${lastReport.hardDrifts.length} unresolved drifts`);
      if (artifacts.length > 0) {
        const primaryFb = artifacts.find(a => a.type === "FB") ?? artifacts[0];
        primaryFb.drift = lastReport;
      }
      return artifacts;
    },
    [log],
  );

  /**
   * Generate all assembly FBs sequentially.
   */
  const generateAll = useCallback(
    async (
      assemblies: ForgeAssemblyEntry[],
      session: ForgeSession,
      profile: DesignProfile,
      deviceArtifacts: ForgeArtifact[],
      fbTemplates: FbTemplate[],
      patterns: PatternCandidate[],
      briefs?: Record<string, AssemblyBrief>,
      contracts?: Record<string, FbInterfaceContract>,
      subsystems?: Record<string, string>,
    ): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);
      const allArtifacts: ForgeArtifact[] = [];

      try {
        for (let i = 0; i < assemblies.length; i++) {
          const asm = assemblies[i];
          setProgress({ current: i + 1, total: assemblies.length, assemblyTag: asm.tag });

          const arts = await generateSingle(
            asm,
            session,
            profile,
            deviceArtifacts,
            fbTemplates,
            patterns,
            briefs?.[asm.id],
            undefined,
            contracts?.[asm.id],
            subsystems?.[asm.id],
          );
          allArtifacts.push(...arts);
        }

        return allArtifacts;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Assembly generation failed";
        setError(msg);
        log("error", msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [generateSingle, log],
  );

  return {
    generateAll,
    generateSingle,
    loading,
    progress,
    error,
    log: logEntries,
    clearLog,
  };
}
