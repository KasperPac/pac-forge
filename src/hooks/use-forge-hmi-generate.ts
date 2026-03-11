import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { buildHmiPrompt, buildHmiUserMessage } from "@/lib/forge-prompts";
import type { ForgeSession, ForgeArtifact, ForgeDeviceEntry } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";

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
    .map((screen): ForgeArtifact => ({
      id: crypto.randomUUID(),
      name: String(screen.name ?? "HmiScreen"),
      type: "OB", // Closest available type for HMI — actual import is XML-based
      language: "SCL",
      content: JSON.stringify(screen, null, 2),
      xml_content: undefined, // Will be built by hmi-xml-builder at export time
      approved: false,
      stage: "hmi",
      destination_folder: "HMI/Screens",
      dependencies: [],
      compile_after_import: false,
    }));
}

export function useForgeHmiGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateAll = useCallback(
    async (session: ForgeSession, profile: DesignProfile): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);

      const abort = new AbortController();
      const devices = session.device_list as ForgeDeviceEntry[];
      const theme = profile.hmi_theme ?? "default";

      try {
        const systemPrompt = buildHmiPrompt(devices, theme);
        const userMessage = buildHmiUserMessage(devices);

        const { content } = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: userMessage }],
          abort.signal,
          HMI_GEN_MAX_TOKENS,
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
