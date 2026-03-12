import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
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

/**
 * Copy template blocks directly as artifacts (exact match — no AI call).
 * Returns FB/UDT/FC blocks from the template + a deterministically-generated instance DB.
 */
function copyTemplateAsArtifacts(
  device: ForgeDeviceEntry,
  template: FbTemplate,
): ForgeArtifact[] {
  const artifacts: ForgeArtifact[] = [];

  for (const block of (template.blocks ?? []).sort((a, b) => a.sort_order - b.sort_order)) {
    artifacts.push({
      id: crypto.randomUUID(),
      name: block.block_name,
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
    const instDbName = `Inst${device.name.replace(/[^A-Za-z0-9]/g, "")}`;
    const instDbCode = [
      `DATA_BLOCK "${instDbName}"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `NON_RETAIN`,
      `"${mainFb.block_name}"`,
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
      dependencies: [mainFb.block_name],
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

      // Exact match — skip AI entirely, copy template blocks as-is
      if (device.fb_match_confidence === "exact" && matchedTemplate?.blocks?.length) {
        return copyTemplateAsArtifacts(device, matchedTemplate);
      }

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

      const { content } = await validateAndCall(
        callNonStreaming,
        systemPrompt,
        [{ role: "user", content: userMessage }],
        abort.signal,
        DEVICE_GEN_MAX_TOKENS,
        isLad ? "code_architect_lad" : "code_architect_scl",
        !!profile,
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

      const ioSystemPrompt = buildIoLinkingPrompt(session.device_list, session.io_list as ForgeIoEntry[], context, ioLang);
      const { content } = await validateAndCall(
        callNonStreaming,
        ioSystemPrompt,
        [{ role: "user", content: `Generate the IO linking FC for all devices.` }],
        abort.signal,
        DEVICE_GEN_MAX_TOKENS,
        "io_linking",
        !!profile,
      );

      if (ioLang === "LAD") {
        const artifact = parseLadArtifact(content, "IoLinking", "device");
        if (!artifact) console.warn("[forge] LAD IO linking parse failed. Raw response:", content.slice(0, 500));
        return artifact ? [{ ...artifact, type: "FC" as const }] : [];
      }
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
      // Track template block names already copied — FB/UDT blocks are shared across devices
      const copiedTemplateBlockNames = new Set<string>();

      setProgress({ current: 0, total: devices.length + 1, currentDevice: "" });

      try {
        for (let i = 0; i < devices.length; i++) {
          const device = devices[i];
          const matchedTemplate =
            device.fb_template_id
              ? fbTemplates.find((t) => t.id === device.fb_template_id) ?? null
              : null;
          const isExactMatch = device.fb_match_confidence === "exact" && !!matchedTemplate?.blocks?.length;
          console.log(`[forge] device "${device.name}": confidence=${device.fb_match_confidence}, template=${matchedTemplate?.name ?? "none"}, blocks=${matchedTemplate?.blocks?.length ?? 0}, isExactMatch=${isExactMatch}`);

          setProgress({
            current: i + 1,
            total: devices.length + 1,
            currentDevice: isExactMatch ? `${device.name} (from library)` : device.name,
          });

          if (isExactMatch && matchedTemplate) {
            // Exact match — copy template, deduplicate shared FB/UDT blocks
            const artifacts = copyTemplateAsArtifacts(device, matchedTemplate);
            for (const artifact of artifacts) {
              if (artifact.type === "DB" && artifact.name.startsWith("Inst")) {
                // Instance DBs are unique per device — always add
                allArtifacts.push(artifact);
              } else if (!copiedTemplateBlockNames.has(artifact.name)) {
                // FB/UDT/FC/global DB blocks — only add once per unique name
                allArtifacts.push(artifact);
                copiedTemplateBlockNames.add(artifact.name);
              }
            }
          } else {
            // No exact match — use AI generation
            const artifacts = await generateSingle(
              device,
              session,
              profile,
              fbTemplates,
              patterns,
            );
            allArtifacts.push(...artifacts);
          }
        }

        // IO linking FC
        setProgress({
          current: devices.length + 1,
          total: devices.length + 1,
          currentDevice: "IO Linking FC",
        });
        const ioList = session.io_list as ForgeIoEntry[];
        const deviceList = session.device_list as ForgeDeviceEntry[];
        console.log(`[forge] IO linking: ${ioList?.length ?? 0} IO entries, ${deviceList?.length ?? 0} devices`);
        if (ioList?.length > 0) {
          const ioArtifacts = await generateIoLinking(session, profile, patterns);
          console.log(`[forge] IO linking produced ${ioArtifacts.length} artifact(s)`);
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
