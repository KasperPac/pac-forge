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
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import type {
  ForgeSession,
  ForgeArtifact,
  ForgeAssemblyEntry,
} from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";
import type { AssemblyBrief } from "@/types/forge-brief";

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
// Main hook
// ---------------------------------------------------------------------------

export function useForgeAssemblyGenerate() {
  const { data: promptSections } = useActivePromptSections();
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
    ): Promise<ForgeArtifact[]> => {
      // Check for library template match
      const matchedTemplate = assembly.fb_template_id
        ? fbTemplates.find((t) => t.id === assembly.fb_template_id) ?? null
        : null;

      if (matchedTemplate && matchedTemplate.blocks && matchedTemplate.blocks.length > 0) {
        log("info", `${assembly.tag}: copying template "${matchedTemplate.name}"`);
        return copyTemplateAsAssemblyArtifacts(assembly, matchedTemplate);
      }

      // AI generation
      log("info", `${assembly.tag}: generating via AI${brief ? " (FDS-driven)" : ""}`);
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
      };

      const systemPrompt = buildAssemblySclPrompt(assembly, context, promptSections ?? undefined);

      let userMessage = buildAssemblySclUserMessage(assembly);
      if (instructions) {
        userMessage += `\n\n## Engineer Instructions\n${instructions}`;
      }

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
    },
    [promptSections, log],
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
