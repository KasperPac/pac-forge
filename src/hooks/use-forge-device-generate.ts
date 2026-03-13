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
  buildDeviceCallFcUserMessage,
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
import type { ForgeSession, ForgeArtifact, ForgeDeviceEntry, ForgeIoEntry } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";
import type { ProcessLinkageMatrix } from "@/types/process-builder";

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
    // Use the FB name as declared inside the SCL (FUNCTION_BLOCK "ActualName"),
    // NOT block_name from the DB which may differ (e.g. file named "ControlMotor_DOL"
    // but declares FUNCTION_BLOCK "ControlMotor"). TIA Portal imports under the declared name.
    const declaredNameMatch = mainFb.scl_code.match(/FUNCTION_BLOCK\s+"([^"]+)"/i);
    const actualFbName = declaredNameMatch?.[1] ?? mainFb.block_name;

    const instDbName = `Inst${device.name.replace(/[^A-Za-z0-9]/g, "")}`;
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
      const ioList = session.io_list as ForgeIoEntry[];
      const matrix = session.linkage_matrix as ProcessLinkageMatrix | null;
      // Global DBs to generate from matrix (HmiData, Configuration, etc.)
      const matrixGlobalDbs = matrix?.globalData ?? [];
      const allArtifacts: ForgeArtifact[] = [];
      // Track template block names already copied — FB/UDT blocks are shared across devices
      const copiedTemplateBlockNames = new Set<string>();
      // Track FB interface text per device type for Device Call FC generation
      const deviceTypeFbInterfaces = new Map<string, string>();

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
          const isExactMatch = device.fb_match_confidence === "exact" && !!matchedTemplate?.blocks?.length;
          console.log(`[forge] device "${device.name}": confidence=${device.fb_match_confidence}, template=${matchedTemplate?.name ?? "none"}, isExactMatch=${isExactMatch}`);

          setProgress({
            current: i + 1,
            total: totalSteps,
            currentDevice: isExactMatch ? `${device.name} (from library)` : device.name,
          });

          let deviceArtifacts: ForgeArtifact[];
          if (isExactMatch && matchedTemplate) {
            deviceArtifacts = copyTemplateAsArtifacts(device, matchedTemplate);
            for (const artifact of deviceArtifacts) {
              if (artifact.type === "DB" && artifact.name.startsWith("Inst")) {
                allArtifacts.push(artifact);
              } else if (!copiedTemplateBlockNames.has(artifact.name)) {
                allArtifacts.push(artifact);
                copiedTemplateBlockNames.add(artifact.name);
              }
            }
          } else {
            deviceArtifacts = await generateSingle(device, session, profile, fbTemplates, patterns);
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
                deviceTypeFbInterfaces.set(
                  device.device_type,
                  `### ${fbArtifact.name}\n\`\`\`\n${matches.join("\n")}\n\`\`\``,
                );
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
          const inputsDbCode = generateInputsDb(ioList);
          allArtifacts.push({
            id: crypto.randomUUID(),
            name: "Inputs",
            type: "DB",
            language: "SCL",
            content: inputsDbCode,
            approved: false,
            stage: "device",
            destination_folder: "Data blocks",
            dependencies: [],
            compile_after_import: true,
          });
        }

        // --- Step 3: Outputs DB (deterministic) ---
        setProgress({
          current: devices.length + 2,
          total: totalSteps,
          currentDevice: "Outputs DB",
        });
        if (ioList?.length > 0) {
          const outputsDbCode = generateOutputsDb(ioList);
          allArtifacts.push({
            id: crypto.randomUUID(),
            name: "Outputs",
            type: "DB",
            language: "SCL",
            content: outputsDbCode,
            approved: false,
            stage: "device",
            destination_folder: "Data blocks",
            dependencies: [],
            compile_after_import: true,
          });
        }

        // --- Step 3b: Global DBs from matrix (HmiData, Configuration, etc.) ---
        for (let i = 0; i < matrixGlobalDbs.length; i++) {
          const gdb = matrixGlobalDbs[i];
          if (!gdb.dbName) continue;
          setProgress({
            current: devices.length + 2 + i + 1,
            total: totalSteps,
            currentDevice: `${gdb.dbName} DB`,
          });
          const dbCode = generateGlobalDb(gdb.dbName, gdb.fields ?? []);
          allArtifacts.push({
            id: crypto.randomUUID(),
            name: gdb.dbName,
            type: "DB",
            language: "SCL",
            content: dbCode,
            approved: false,
            stage: "device",
            destination_folder: "Data blocks",
            dependencies: [],
            compile_after_import: true,
          });
        }

        // --- Step 4: IoLinking FC (deterministic SCL, or LAD via AI) ---
        setProgress({
          current: devices.length + 3 + matrixGlobalDbs.length,
          total: totalSteps,
          currentDevice: "IoLinking FC",
        });
        if (ioList?.length > 0) {
          const ioLang = profile.io_linking_language ?? "SCL";
          if (ioLang === "LAD") {
            // LAD IoLinking still uses AI
            const abort = new AbortController();
            const context: DeviceGenContext = { profile, platformRules: PLATFORM_RULES, patterns };
            const ladPrompt = buildIoLinkingLadPrompt(devices, ioList, context);
            const { content } = await validateAndCall(
              callNonStreaming,
              ladPrompt,
              [{ role: "user", content: "Generate the IoLinking LAD FC." }],
              abort.signal,
              DEVICE_GEN_MAX_TOKENS,
              "io_linking",
              !!profile,
            );
            const artifact = parseLadArtifact(content, "IoLinking", "device");
            if (!artifact) console.warn("[forge] LAD IO linking parse failed:", content.slice(0, 500));
            if (artifact) allArtifacts.push({ ...artifact, type: "FC" as const });
          } else {
            // SCL IoLinking is fully deterministic
            const ioLinkingCode = generateIoLinkingFc(ioList);
            allArtifacts.push({
              id: crypto.randomUUID(),
              name: "IoLinking",
              type: "FC",
              language: "SCL",
              content: ioLinkingCode,
              approved: false,
              stage: "device",
              destination_folder: "Program blocks/Forge",
              dependencies: [],
              compile_after_import: true,
            });
          }
        }

        // --- Step 5: Device Call FCs (one per device type, AI-generated) ---
        for (let i = 0; i < uniqueDeviceTypes.length; i++) {
          const deviceType = uniqueDeviceTypes[i];
          const fcName = deviceTypeToFcName(deviceType, profile.naming_prefix ?? undefined);
          setProgress({
            current: devices.length + 3 + matrixGlobalDbs.length + i + 1,
            total: totalSteps,
            currentDevice: `${fcName} FC`,
          });

          const groupDevices = devices.filter((d) => d.device_type === deviceType);
          const instanceDbNames = groupDevices.map(
            (d) => `Inst${d.name.replace(/[^A-Za-z0-9]/g, "")}`,
          );
          const groupIoSignals = groupDevices.flatMap((d) => d.io_signals ?? []);
          const inputsDbFields = groupIoSignals
            .filter((s) => s.signal_type === "DI" || s.signal_type === "AI")
            .map((s) => s.tag_name);
          const outputsDbFields = groupIoSignals
            .filter((s) => s.signal_type === "DQ" || s.signal_type === "AQ")
            .map((s) => s.tag_name);

          // Extract matrix wiring for devices of this type — engineer-confirmed connections
          const matrixWiring = matrix?.deviceLinkage
            .filter(d => d.deviceType === deviceType)
            .map(d => ({
              deviceName: d.name,
              instanceDbName: d.instanceDbName,
              wiring: d.wiring,
            })) ?? [];

          const context: DeviceCallFcContext = {
            fcName,
            deviceType,
            devices: groupDevices,
            instanceDbNames,
            fbInterfaceSection: deviceTypeFbInterfaces.get(deviceType) ?? "",
            inputsDbFields,
            outputsDbFields,
            inputsDbName: "Inputs",
            outputsDbName: "Outputs",
            profile,
            platformRules: PLATFORM_RULES,
            patterns,
            matrixWiring,
          };

          const abort = new AbortController();
          const { content } = await validateAndCall(
            callNonStreaming,
            buildDeviceCallFcPrompt(context),
            [{ role: "user", content: buildDeviceCallFcUserMessage(context) }],
            abort.signal,
            DEVICE_GEN_MAX_TOKENS,
            "code_architect_scl",
            !!profile,
          );

          const fcArtifacts = parseSclArtifacts(content, "device");
          console.log(`[forge] ${fcName}: produced ${fcArtifacts.length} artifact(s)`);
          allArtifacts.push(...fcArtifacts);
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
    [generateSingle],
  );

  return { generateAll, generateSingle, loading, progress, error };
}
