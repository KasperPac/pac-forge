import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  buildDeviceSclPrompt,
  buildDeviceSclUserMessage,
  buildDeviceLadPrompt,
  buildDeviceLadUserMessage,
  buildIoLinkingPrompt,
  type DeviceGenContext,
} from "@/lib/forge-prompts";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import type { ForgeSession, ForgeArtifact, ForgeDeviceEntry, ForgeIoEntry } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";

const DEVICE_GEN_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Parse LadProgram JSON from Claude response. */
function parseLadArtifact(
  rawContent: string,
  deviceName: string,
  stage: ForgeArtifact["stage"],
): ForgeArtifact | null {
  const cleaned = rawContent
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    JSON.parse(cleaned); // Validate
    return {
      id: crypto.randomUUID(),
      name: deviceName,
      type: "FB",
      language: "LAD",
      content: cleaned,
      approved: false,
      stage,
      destination_folder: "Program blocks/Forge",
      dependencies: [],
      compile_after_import: true,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface ForgeDeviceGenerateProgress {
  current: number;
  total: number;
  currentDevice: string;
}

export function useForgeDeviceGenerate() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ForgeDeviceGenerateProgress>({
    current: 0,
    total: 0,
    currentDevice: "",
  });
  const [error, setError] = useState<string | null>(null);

  const generateSingle = useCallback(
    async (
      device: ForgeDeviceEntry,
      _session: ForgeSession,
      profile: DesignProfile,
      fbTemplates: FbTemplate[],
      patterns: PatternCandidate[],
    ): Promise<ForgeArtifact[]> => {
      const abort = new AbortController();
      const effectiveLang = device.language_override ?? profile.device_fb_language;
      const isLad = effectiveLang === "LAD";

      const matchedTemplate =
        device.fb_template_id
          ? fbTemplates.find((t) => t.id === device.fb_template_id) ?? null
          : null;

      const context: DeviceGenContext = {
        profile,
        platformRules: PLATFORM_RULES,
        patterns,
        fbTemplate: matchedTemplate,
      };

      let systemPrompt: string;
      let userMessage: string;

      if (isLad) {
        systemPrompt = buildDeviceLadPrompt(device, context);
        userMessage = buildDeviceLadUserMessage(device);
      } else {
        systemPrompt = buildDeviceSclPrompt(device, context);
        userMessage = buildDeviceSclUserMessage(device);
      }

      const { content } = await callNonStreaming(
        systemPrompt,
        [{ role: "user", content: userMessage }],
        abort.signal,
        DEVICE_GEN_MAX_TOKENS,
      );

      if (isLad) {
        const artifact = parseLadArtifact(content, device.name, "device");
        return artifact ? [artifact] : [];
      }

      return parseSclArtifacts(content, "device");
    },
    [],
  );

  const generateIoLinking = useCallback(
    async (
      session: ForgeSession,
      profile: DesignProfile,
      patterns: PatternCandidate[],
    ): Promise<ForgeArtifact[]> => {
      const abort = new AbortController();
      const ioLang = profile.io_linking_language ?? "SCL";
      const context: DeviceGenContext = {
        profile,
        platformRules: PLATFORM_RULES,
        patterns,
      };

      const { content } = await callNonStreaming(
        buildIoLinkingPrompt(session.device_list, session.io_list as ForgeIoEntry[], context),
        [{ role: "user", content: `Generate the IO linking FC for all devices. Use ${ioLang}.` }],
        abort.signal,
        DEVICE_GEN_MAX_TOKENS,
      );

      return parseSclArtifacts(content, "device");
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

      const devices = session.device_list as ForgeDeviceEntry[];
      const allArtifacts: ForgeArtifact[] = [];

      setProgress({ current: 0, total: devices.length + 1, currentDevice: "" });

      try {
        for (let i = 0; i < devices.length; i++) {
          const device = devices[i];
          setProgress({
            current: i + 1,
            total: devices.length + 1,
            currentDevice: device.name,
          });

          const artifacts = await generateSingle(
            device,
            session,
            profile,
            fbTemplates,
            patterns,
          );
          allArtifacts.push(...artifacts);
        }

        // IO linking FC
        setProgress({
          current: devices.length + 1,
          total: devices.length + 1,
          currentDevice: "IO Linking FC",
        });
        if (session.io_list && (session.io_list as ForgeIoEntry[]).length > 0) {
          const ioArtifacts = await generateIoLinking(session, profile, patterns);
          allArtifacts.push(...ioArtifacts);
        }

        return allArtifacts;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [generateSingle, generateIoLinking],
  );

  return { generateAll, generateSingle, loading, progress, error };
}
