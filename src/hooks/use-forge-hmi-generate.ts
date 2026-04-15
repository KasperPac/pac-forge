import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
// Wave 5: dialect helper available for signal-type emission if needed.
import { toSiemens } from "@/lib/spec-builder/dialect";
void toSiemens;
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildHmiCustomScreenPrompt,
  buildHmiCustomScreenUserMessage,
  // Legacy prompts kept for backward compat — will remove once confirmed
  buildHmiPrompt,
  buildHmiUserMessage,
} from "@/lib/forge-prompts";
import { buildFaceplateCatalog } from "@/lib/hmi-faceplate-catalog";
import { generateDeterministicScreens, resetIdCounter } from "@/lib/hmi-screen-generators";
import { generateUnifiedScreenSuite } from "@/lib/hmi-unified-screen-generators";
import type { HmiUnifiedScreenPayload } from "@/lib/hmi-unified-payload-builder";
import { buildPanelConfig, findPanelModel } from "@/types/hmi-panel";
import type { HmiPanelConfig, HmiScreenCategory, FaceplateCatalogEntry } from "@/types/hmi-panel";
import type { ForgeSession, ForgeArtifact } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { HmiScreenSpec } from "@/types/hmi-screen";

const HMI_GEN_MAX_TOKENS = 16384;

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

function screenToArtifact(screen: HmiScreenSpec, deterministic: boolean): ForgeArtifact {
  return {
    id: crypto.randomUUID(),
    name: screen.name,
    type: "HMI_SCREEN",
    language: "SCL",
    content: JSON.stringify(screen, null, 2),
    xml_content: undefined,
    approved: false,
    stage: "hmi",
    destination_folder: screenRoleToFolder(screen.screenRole),
    dependencies: [],
    compile_after_import: false,
    deterministic,
  };
}

function screenRoleToFolder(role: HmiScreenSpec["screenRole"]): string {
  switch (role) {
    case "template_shell":
      return "HMI/TemplateSuite";
    case "subsystem_checklist":
    case "device_checklist":
      return "HMI/Checklists";
    case "device_faceplate":
      return "HMI/Faceplates";
    default:
      return "HMI/Screens";
  }
}

/**
 * Serialize a Unified HMI screen payload into a ForgeArtifact for the existing
 * review pipeline. The content is the JSON payload itself — the Unified import
 * step POSTs it to /tia/hmi/create-screen rather than going through Comfort's
 * SimaticML import path.
 */
function unifiedPayloadToArtifact(
  payload: HmiUnifiedScreenPayload,
  deterministic: boolean,
): ForgeArtifact {
  return {
    id: crypto.randomUUID(),
    name: payload.name,
    type: "HMI_SCREEN",
    language: "SCL",
    content: JSON.stringify(payload, null, 2),
    xml_content: undefined,
    approved: false,
    stage: "hmi",
    destination_folder: "HMI/Unified",
    dependencies: [],
    compile_after_import: false,
    deterministic,
  };
}

// ---------------------------------------------------------------------------
// AI response parser (for custom screens)
// ---------------------------------------------------------------------------

/**
 * Extract complete top-level JSON objects from a potentially truncated JSON array.
 * If the AI response hit max_tokens, the array won't close properly.
 * This extracts every complete {...} at depth 0 inside the outer array.
 */
function extractCompleteObjects(raw: string): unknown[] {
  // Strip markdown fences if present
  let trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    trimmed = fenceMatch[1].trim();
  }
  // Also handle unclosed fence (truncated response)
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/, "").trim();
  }

  // Try full JSON parse first
  try {
    const full = JSON.parse(trimmed);
    console.log("[hmi-parse] Full JSON parse succeeded");
    return Array.isArray(full) ? full : [full];
  } catch (e) {
    console.log("[hmi-parse] Full JSON parse failed:", (e as Error).message?.slice(0, 100));
  }

  // Truncated — extract complete objects by brace-matching
  const results: unknown[] = [];
  const start = trimmed.indexOf("[");
  if (start < 0) {
    // No array — try single object
    const objStart = trimmed.indexOf("{");
    if (objStart < 0) return results;
    try {
      results.push(JSON.parse(trimmed.slice(objStart)));
    } catch {
      // not valid
    }
    return results;
  }

  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escape = false;

  for (let i = start + 1; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const objStr = trimmed.slice(objStart, i + 1);
        try {
          results.push(JSON.parse(objStr));
        } catch (parseErr) {
          console.warn("[hmi-parse] Failed to parse extracted object:", (parseErr as Error).message?.slice(0, 100));
        }
        objStart = -1;
      }
    }
  }

  console.log("[hmi-parse] Brace-matching extracted", results.length, "objects from truncated response");
  return results;
}

/**
 * Normalize AI-generated elements: the AI often puts style props (backgroundColor,
 * borderColor, textColor, etc.) flat on the element instead of inside a `style` object.
 * Also ensures required fields like `name`, `zIndex`, `style` exist.
 */
function normalizeElements(raw: unknown[]): HmiScreenSpec["elements"] {
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((el, i) => {
      const style: Record<string, unknown> = typeof el.style === "object" && el.style !== null
        ? { ...(el.style as Record<string, unknown>) }
        : {};

      // Pull flat style props into the style object
      for (const key of ["backgroundColor", "borderColor", "borderWidth", "textColor", "fontSize", "fontWeight", "textAlign", "borderRadius", "opacity"]) {
        if (el[key] !== undefined && style[key] === undefined) {
          style[key] = el[key];
        }
      }

      return {
        ...el,
        name: String(el.name ?? el.id ?? `elem_${i}`),
        zIndex: typeof el.zIndex === "number" ? el.zIndex : 1,
        style,
      } as HmiScreenSpec["elements"][number];
    });
}

function parseAiScreens(rawContent: string, startScreenNum: number): ForgeArtifact[] {
  const screens: unknown[] = extractCompleteObjects(rawContent);
  if (screens.length === 0) {
    console.warn("[hmi-generate] No complete screen objects extracted from AI response");
    return [];
  }

  return screens
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((screen, index): ForgeArtifact => {
      const normalizedScreen: HmiScreenSpec = {
        id: String(screen.id ?? crypto.randomUUID()),
        name: String(screen.name ?? `CustomScreen_${index + 1}`),
        width: typeof screen.width === "number" ? screen.width : 1920,
        height: typeof screen.height === "number" ? screen.height : 1080,
        backgroundColor: String(screen.backgroundColor ?? "#1E1E1E"),
        elements: Array.isArray(screen.elements) ? normalizeElements(screen.elements) : [],
        screenRole: typeof screen.screenRole === "string" ? screen.screenRole as HmiScreenSpec["screenRole"] : "custom",
        subsystem: typeof screen.subsystem === "string" ? screen.subsystem : undefined,
        deviceType: typeof screen.deviceType === "string" ? screen.deviceType : undefined,
        deviceNames: Array.isArray(screen.deviceNames) ? screen.deviceNames.map(String) : undefined,
        checklistItems: Array.isArray(screen.checklistItems)
          ? screen.checklistItems
              .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
              .map((item, ci) => ({
                id: String(item.id ?? `check_${ci + 1}`),
                label: String(item.label ?? `Checklist Item ${ci + 1}`),
                binding: typeof item.binding === "string" ? item.binding : undefined,
                checkedByDefault: typeof item.checkedByDefault === "boolean" ? item.checkedByDefault : undefined,
              }))
          : undefined,
        screenNumber: startScreenNum + index,
        templateName: typeof screen.templateName === "string" ? screen.templateName : undefined,
        screenEvents: Array.isArray(screen.screenEvents) ? screen.screenEvents as HmiScreenSpec["screenEvents"] : undefined,
        layers: Array.isArray(screen.layers) ? screen.layers as HmiScreenSpec["layers"] : undefined,
        alarmDefinitions: Array.isArray(screen.alarmDefinitions) ? screen.alarmDefinitions as HmiScreenSpec["alarmDefinitions"] : undefined,
      };

      return screenToArtifact(normalizedScreen, false);
    });
}

// ---------------------------------------------------------------------------
// Legacy single-shot generation (kept for backward compat)
// ---------------------------------------------------------------------------

/** @deprecated Use generateStaged instead */
function parseLegacyHmiArtifacts(rawContent: string): ForgeArtifact[] {
  const screens = extractCompleteObjects(rawContent);
  if (screens.length === 0) return [];

  return screens
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((screen, index): ForgeArtifact => {
      const normalized: HmiScreenSpec = {
        id: String(screen.id ?? crypto.randomUUID()),
        name: String(screen.name ?? "HmiScreen"),
        width: typeof screen.width === "number" ? screen.width : 1920,
        height: typeof screen.height === "number" ? screen.height : 1080,
        backgroundColor: String(screen.backgroundColor ?? "#0f172a"),
        elements: Array.isArray(screen.elements) ? normalizeElements(screen.elements) : [],
        screenRole: typeof screen.screenRole === "string" ? screen.screenRole as HmiScreenSpec["screenRole"] : (index === 0 ? "template_shell" : "overview"),
        subsystem: typeof screen.subsystem === "string" ? screen.subsystem : undefined,
        deviceType: typeof screen.deviceType === "string" ? screen.deviceType : undefined,
        deviceNames: Array.isArray(screen.deviceNames) ? screen.deviceNames.map(String) : undefined,
        screenNumber: typeof screen.screenNumber === "number" ? screen.screenNumber : index + 1,
      };
      return screenToArtifact(normalized, false);
    });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface HmiGenerateResult {
  artifacts: ForgeArtifact[];
  panelConfig: HmiPanelConfig;
  catalog: FaceplateCatalogEntry[];
}

export function useForgeHmiGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Staged generation: deterministic screens first, then AI for custom screens.
   */
  const generateStaged = useCallback(
    async (
      session: ForgeSession,
      profile: DesignProfile,
      fbTemplates: FbTemplate[],
      selectedCategories: HmiScreenCategory[],
    ): Promise<HmiGenerateResult> => {
      setLoading(true);
      setError(null);

      try {
        // 1. Build panel config from profile
        const model = findPanelModel(profile.hmi_panel_family, profile.hmi_panel_model);
        const panelConfig: HmiPanelConfig = model
          ? buildPanelConfig(model)
          : {
              family: profile.hmi_panel_family,
              panelModel: profile.hmi_panel_model,
              screenWidth: 1920,
              screenHeight: 1080,
              supportsScreenWindows: true,
              supportsFaceplates: true,
            };

        // 2. Build faceplate catalog
        const catalog = buildFaceplateCatalog(session.device_list, fbTemplates);

        // 3. Deterministic phase
        const specAnalysis = session.spec_analysis;
        if (!specAnalysis) {
          throw new Error("Spec analysis required for HMI generation");
        }

        // 3a. Unified branch — emit HmiUnifiedScreenPayload artifacts for the new bridge path
        if (panelConfig.family === "unified") {
          const unifiedSuite = generateUnifiedScreenSuite({
            panel: panelConfig,
            specAnalysis,
            devices: session.device_list,
            catalog,
            projectName: profile.name ?? "Pac-Forge",
            includeDeviceDetails: false,
            folderPath: "PacForge",
          });

          const unifiedArtifacts = unifiedSuite.screens.map((p) =>
            unifiedPayloadToArtifact(p, true),
          );

          if (unifiedSuite.unmatchedDeviceTypes.length > 0) {
            console.warn(
              "[hmi-generate] Unified Phase 5-lite: device types with no Open Library faceplate:",
              unifiedSuite.unmatchedDeviceTypes,
            );
          }

          return {
            artifacts: unifiedArtifacts,
            panelConfig,
            catalog,
          };
        }

        // 3b. Comfort path (legacy — kept for V18 customer projects)
        resetIdCounter();
        const deterministicScreens = generateDeterministicScreens({
          config: panelConfig,
          specAnalysis,
          devices: session.device_list,
          ioList: session.io_list,
          catalog,
          selectedCategories,
        });

        const deterministicArtifacts = deterministicScreens.map((s) =>
          screenToArtifact(s, true),
        );

        // 4. AI phase (only if custom/AI categories are selected)
        const aiCategories = selectedCategories.filter((c) =>
          ["alarm_summary", "trend", "device_faceplate", "custom"].includes(c),
        );

        let aiArtifacts: ForgeArtifact[] = [];
        if (aiCategories.length > 0) {
          const existingScreenNames = deterministicScreens.map((s) => s.name);
          const nextScreenNum = deterministicScreens.length + 1;

          const systemPrompt = buildHmiCustomScreenPrompt(
            panelConfig, session, catalog, existingScreenNames,
          );
          const userMessage = buildHmiCustomScreenUserMessage(session, aiCategories);

          console.log("[hmi-generate] AI phase starting for categories:", aiCategories);
          console.log("[hmi-generate] Catalog entries:", catalog.length, catalog.map((c) => `${c.deviceType} → ${c.faceplateTypeName}`));

          const abort = new AbortController();
          try {
            const { content } = await validateAndCall(
              callNonStreaming,
              systemPrompt,
              [{ role: "user", content: userMessage }],
              abort.signal,
              HMI_GEN_MAX_TOKENS,
              "hmi_generator",
              !!profile,
              { prompt_name: "forge-hmi-custom-generate", agent_role: "hmi_generator", pipeline_step: "hmi_ai_generate" },
            );

            console.log("[hmi-generate] AI response length:", content.length);
            console.log("[hmi-generate] AI response preview:", content.slice(0, 500));

            aiArtifacts = parseAiScreens(content, nextScreenNum);
            console.log("[hmi-generate] Parsed AI artifacts:", aiArtifacts.length);
          } catch (aiErr) {
            console.error("[hmi-generate] AI phase failed:", aiErr);
            // Don't fail the whole generation — return deterministic screens
          }
        }

        return {
          artifacts: [...deterministicArtifacts, ...aiArtifacts],
          panelConfig,
          catalog,
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

  /**
   * Legacy single-shot generation (for backward compat with old forge-hmi.tsx).
   * @deprecated Use generateStaged instead
   */
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
          { prompt_name: "forge-hmi-generate", agent_role: "hmi_generator", pipeline_step: "hmi_generate" },
        );

        return parseLegacyHmiArtifacts(content);
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

  return { generateStaged, generateAll, loading, error };
}
