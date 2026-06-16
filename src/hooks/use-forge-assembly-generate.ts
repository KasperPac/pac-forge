/**
 * Hook for generating Equipment Module FBs — extracted from use-forge-device-generate.ts.
 * Supports both FDS-driven generation (EquipmentModuleBrief) and standalone (SpecAnalysis).
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
  ForgeEquipmentModuleEntry,
} from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";
import type { EquipmentModuleBrief } from "@/types/forge-brief";

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
  _equipment_module: ForgeEquipmentModuleEntry,
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
      stage: "equipment_module_fb" as const,
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
  equipment_moduleTag: string;
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
  const [progress, setProgress] = useState<AssemblyGenProgress>({ current: 0, total: 0, equipment_moduleTag: "" });
  const [error, setError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<AssemblyGenLogEntry[]>([]);

  const log = useCallback((level: AssemblyGenLogLevel, message: string) => {
    setLogEntries((prev) => [...prev, { level, message, timestamp: Date.now() }]);
  }, []);

  const clearLog = useCallback(() => setLogEntries([]), []);

  /**
   * Generate a single equipment_module FB.
   * If a library template matches, copies it. Otherwise generates via AI.
   * When brief is provided, the prompt includes FDS behavioral data.
   */
  const generateSingle = useCallback(
    async (
      equipment_module: ForgeEquipmentModuleEntry,
      session: ForgeSession,
      profile: DesignProfile,
      deviceArtifacts: ForgeArtifact[],
      fbTemplates: FbTemplate[],
      patterns: PatternCandidate[],
      brief?: EquipmentModuleBrief,
      instructions?: string,
    ): Promise<ForgeArtifact[]> => {
      // Check for library template match
      const matchedTemplate = equipment_module.fb_template_id
        ? fbTemplates.find((t) => t.id === equipment_module.fb_template_id) ?? null
        : null;

      if (matchedTemplate && matchedTemplate.blocks && matchedTemplate.blocks.length > 0) {
        log("info", `${equipment_module.tag}: copying template "${matchedTemplate.name}"`);
        return copyTemplateAsAssemblyArtifacts(equipment_module, matchedTemplate);
      }

      // AI generation
      log("info", `${equipment_module.tag}: generating via AI${brief ? " (FDS-driven)" : ""}`);
      const platformRules = await loadPlatformRules();

      const constituentDevices = (session.device_list ?? []).filter(
        (d) => equipment_module.control_module_ids.includes(d.id),
      );

      const specAnalysis = session.spec_analysis;
      const relevantInterlocks = specAnalysis?.interlocks?.filter(
        (i) => i.affected_control_modules?.some(
          (name) =>
            constituentDevices.some((d) => d.name === name || d.tag === name) ||
            name === equipment_module.name ||
            name === equipment_module.tag,
        ),
      );
      // Wave 5 note: the contract-backed path populates `brief.alarmConditions`
      // by control_module_id / equipment_module_id foreign keys. The tag-substring fallback
      // below only fires when no contract is bound (standalone SpecAnalysis
      // mode) — it should be removed once standalone mode is retired.
      const relevantAlarms = specAnalysis?.alarms?.filter(
        (a) =>
          a.affected_sequences?.some((seq) =>
            seq.toLowerCase().includes(equipment_module.tag.toLowerCase()),
          ) || a.description?.toLowerCase().includes(equipment_module.tag.toLowerCase()),
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

      const systemPrompt = buildAssemblySclPrompt(equipment_module, context, promptSections ?? undefined);

      let userMessage = buildAssemblySclUserMessage(equipment_module);
      if (instructions) {
        userMessage += `\n\n## Engineer Instructions\n${instructions}`;
      }

      const controller = new AbortController();
      const { content } = await callNonStreaming(
        systemPrompt,
        [{ role: "user", content: userMessage }],
        controller.signal,
        16384,
        { prompt_name: "forge-assembly-fb", agent_role: "code_architect", pipeline_step: "equipment_module_fb" },
      );

      const artifacts = parseSclArtifacts(content, "equipment_module_fb");
      log("info", `${equipment_module.tag}: generated ${artifacts.length} artifacts`);
      return artifacts;
    },
    [promptSections, log],
  );

  /**
   * Generate all Equipment Module FBs sequentially.
   */
  const generateAll = useCallback(
    async (
      equipment_modules: ForgeEquipmentModuleEntry[],
      session: ForgeSession,
      profile: DesignProfile,
      deviceArtifacts: ForgeArtifact[],
      fbTemplates: FbTemplate[],
      patterns: PatternCandidate[],
      briefs?: Record<string, EquipmentModuleBrief>,
    ): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);
      const allArtifacts: ForgeArtifact[] = [];

      try {
        for (let i = 0; i < equipment_modules.length; i++) {
          const asm = equipment_modules[i];
          setProgress({ current: i + 1, total: equipment_modules.length, equipment_moduleTag: asm.tag });

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
        const msg = err instanceof Error ? err.message : "Equipment Module generation failed";
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
