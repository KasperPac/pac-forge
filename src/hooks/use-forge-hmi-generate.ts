import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import { buildHmiPrompt, buildHmiUserMessage } from "@/lib/forge-prompts";
import type { ForgeSession, ForgeArtifact } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { HmiScreenSpec } from "@/types/hmi-screen";

const HMI_GEN_MAX_TOKENS = 8192;

/** Parse HmiScreenSpec JSON array and build HMI ForgeArtifacts. */
function parseHmiArtifacts(rawContent: string): ForgeArtifact[] {
  const cleaned = rawContent
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let screens: unknown[];
  try {
    const parsed = JSON.parse(cleaned);
    screens = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }

  return screens
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((screen, index): ForgeArtifact => {
      const normalizedScreen: HmiScreenSpec = {
        id: String(screen.id ?? crypto.randomUUID()),
        name: String(screen.name ?? "HmiScreen"),
        width: typeof screen.width === "number" ? screen.width : 1920,
        height: typeof screen.height === "number" ? screen.height : 1080,
        backgroundColor: String(screen.backgroundColor ?? "#0f172a"),
        elements: Array.isArray(screen.elements) ? screen.elements as HmiScreenSpec["elements"] : [],
        targetPlatform: (screen.targetPlatform === "wincc_unified_comfort" ? screen.targetPlatform : "wincc_unified_comfort"),
        templateSuite: String(screen.templateSuite ?? "siemens_hmi_template_suite"),
        screenRole: typeof screen.screenRole === "string" ? screen.screenRole as HmiScreenSpec["screenRole"] : (index === 0 ? "template_shell" : "overview"),
        subsystem: typeof screen.subsystem === "string" ? screen.subsystem : undefined,
        deviceType: typeof screen.deviceType === "string" ? screen.deviceType : undefined,
        deviceNames: Array.isArray(screen.deviceNames) ? screen.deviceNames.map(String) : undefined,
        checklistItems: Array.isArray(screen.checklistItems)
          ? screen.checklistItems
              .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
              .map((item, itemIndex) => ({
                id: String(item.id ?? `check_${itemIndex + 1}`),
                label: String(item.label ?? `Checklist Item ${itemIndex + 1}`),
                binding: typeof item.binding === "string" ? item.binding : undefined,
                checkedByDefault: typeof item.checkedByDefault === "boolean" ? item.checkedByDefault : undefined,
              }))
          : undefined,
        screenNumber: typeof screen.screenNumber === "number" ? screen.screenNumber : index + 1,
        templateName: typeof screen.templateName === "string" ? screen.templateName : undefined,
        screenEvents: Array.isArray(screen.screenEvents) ? screen.screenEvents as HmiScreenSpec["screenEvents"] : undefined,
        layers: Array.isArray(screen.layers) ? screen.layers as HmiScreenSpec["layers"] : undefined,
        alarmDefinitions: Array.isArray(screen.alarmDefinitions) ? screen.alarmDefinitions as HmiScreenSpec["alarmDefinitions"] : undefined,
      };

      return {
      id: crypto.randomUUID(),
      name: normalizedScreen.name,
      type: "OB", // Closest available type for HMI — actual import is XML-based
      language: "SCL",
      content: JSON.stringify(normalizedScreen, null, 2),
      xml_content: undefined, // Will be built by hmi-xml-builder at export time
      approved: false,
      stage: "hmi",
      destination_folder: normalizedScreen.screenRole === "template_shell"
        ? "HMI/TemplateSuite"
        : normalizedScreen.screenRole === "subsystem_checklist"
          ? "HMI/Checklists"
          : normalizedScreen.screenRole === "device_faceplate"
            ? "HMI/Faceplates"
            : "HMI/Screens",
      dependencies: [],
      compile_after_import: false,
      };
    });
}

export function useForgeHmiGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateAll = useCallback(
    async (session: ForgeSession, profile: DesignProfile): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);

      const abort = new AbortController();
      const theme = profile.hmi_theme ?? "default";

      try {
        const systemPrompt = buildHmiPrompt(session, theme);
        const userMessage = buildHmiUserMessage(session);

        const { content } = await validateAndCall(
          callNonStreaming,
          systemPrompt,
          [{ role: "user", content: userMessage }],
          abort.signal,
          HMI_GEN_MAX_TOKENS,
          "hmi_generator",
          !!profile,
        );

        return parseHmiArtifacts(content);
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

  return { generateAll, loading, error };
}
