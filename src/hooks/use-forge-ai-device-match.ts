/**
 * use-forge-ai-device-match.ts
 * Sends device list + FB template AI summaries to Claude PM.
 * Claude assigns each device to the best matching template.
 * Falls back to heuristic matching if no summaries exist or AI call fails.
 */

import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { matchDevicesToTemplates, matchAssembliesToTemplates } from "@/lib/forge-device-matcher";
import type { DeviceFbMatch, AssemblyFbMatch } from "@/lib/forge-device-matcher";
import type { ForgeControlModuleEntry, ForgeEquipmentModuleEntry } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

const SYSTEM_PROMPT = `You are a senior PLC project manager assigning Function Block templates to field control_modules.

For each device, select the BEST matching FB template based on the template summaries provided.

Match criteria:
- Does the template's purpose align with this device type?
- Does the template handle the right kind of IO (discrete, analog, mixed)?
- Is the template designed specifically for this device category?

Preference: prefer templates with Source "library" over "custom" when both would work —
library templates have tested LAD code and matched HMI faceplates.

Confidence:
- "exact": Template is clearly the right choice for this device (purpose + IO match well)
- "probable": Template could work with some adaptation by the AI
- "none": No suitable template — use null for template_id

Respond with ONLY valid JSON (no markdown fences, no explanation):
[{"control_module_id":"...","template_id":"..." or null,"confidence":"exact"|"probable"|"none","reason":"one concise sentence"}]`;

export function useForgeAiDeviceMatch() {
  const [loading, setLoading] = useState(false);

  const match = useCallback(
    async (
      control_modules: ForgeControlModuleEntry[],
      templates: FbTemplate[],
      favourites: Record<string, string> = {},
    ): Promise<DeviceFbMatch[]> => {
      if (templates.length === 0) {
        return control_modules.map((device) => ({
          device,
          template: null,
          confidence: "none" as const,
          reason: "No templates in library.",
        }));
      }

      // Resolve favourites immediately — don't send these to AI
      const favouriteMatches: DeviceFbMatch[] = [];
      const control_modulesToMatch: ForgeControlModuleEntry[] = [];

      for (const device of control_modules) {
        const favId = favourites[device.device_type];
        if (favId) {
          const template = templates.find((t) => t.id === favId) ?? null;
          if (template) {
            favouriteMatches.push({
              device,
              template,
              confidence: "exact",
              reason: `Matched via profile favourite: "${template.name}".`,
            });
            continue;
          }
        }
        control_modulesToMatch.push(device);
      }

      if (control_modulesToMatch.length === 0) return favouriteMatches;

      // If no templates have AI summaries or documentation, fall back to heuristic
      const hasContext = templates.some((t) => t.ai_summary || t.documentation);
      if (!hasContext) {
        return [...favouriteMatches, ...matchDevicesToTemplates(control_modulesToMatch, templates, favourites)];
      }

      setLoading(true);
      try {
        const templateList = templates
          .map((t) => {
            const summary = t.ai_summary
              ?? (t.documentation ? t.documentation.slice(0, 300).replace(/\s+/g, " ").trim() + "…" : null)
              ?? "(no summary)";
            return `ID: ${t.id}\nName: ${t.name}\nCategory: ${t.device_category}\nSource: ${t.source}\nSummary: ${summary}`;
          })
          .join("\n\n---\n\n");

        const deviceList = control_modulesToMatch
          .map(
            (d) =>
              `ID: ${d.id}\nType: ${d.device_type}\nName: ${d.name}\nDescription: ${d.description}\nIO signals: ${(d.io_signals ?? []).map((s) => `${s.signal_type}:${s.tag_name}`).join(", ") || "none"}`,
          )
          .join("\n\n---\n\n");

        const { content } = await callNonStreaming(
          SYSTEM_PROMPT,
          [
            {
              role: "user",
              content: `TEMPLATES (${templates.length}):\n\n${templateList}\n\n\nDEVICES (${control_modulesToMatch.length}):\n\n${deviceList}`,
            },
          ],
          new AbortController().signal,
          2048,
        );

        // Extract JSON array from response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("No JSON array in response");

        const assignments: Array<{
          control_module_id: string;
          template_id: string | null;
          confidence: "exact" | "probable" | "none";
          reason: string;
        }> = JSON.parse(jsonMatch[0]);

        const aiResults = control_modulesToMatch.map((device): DeviceFbMatch => {
          const a = assignments.find((x) => x.control_module_id === device.id);
          if (!a) {
            return {
              device,
              template: null,
              confidence: "none",
              reason: "No assignment returned by AI.",
            };
          }
          const template = a.template_id
            ? (templates.find((t) => t.id === a.template_id) ?? null)
            : null;
          return {
            device,
            template,
            confidence: a.confidence,
            reason: a.reason,
          };
        });
        return [...favouriteMatches, ...aiResults];
      } catch (err) {
        console.warn("AI device matching failed, falling back to heuristic:", err);
        return [...favouriteMatches, ...matchDevicesToTemplates(control_modulesToMatch, templates, favourites)];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const matchAssemblies = useCallback(
    async (
      equipment_modules: ForgeEquipmentModuleEntry[],
      templates: FbTemplate[],
      favourites: Record<string, string> = {},
    ): Promise<AssemblyFbMatch[]> => {
      if (templates.length === 0) {
        return equipment_modules.map((equipment_module) => ({
          equipment_module,
          template: null,
          confidence: "none" as const,
          reason: "No equipment_module templates in library.",
        }));
      }

      const favouriteMatches: AssemblyFbMatch[] = [];
      const equipment_modulesToMatch: ForgeEquipmentModuleEntry[] = [];

      for (const equipment_module of equipment_modules) {
        const favId = favourites[equipment_module.equipment_module_type];
        if (favId) {
          const template = templates.find((t) => t.id === favId) ?? null;
          if (template) {
            favouriteMatches.push({
              equipment_module,
              template,
              confidence: "exact",
              reason: `Matched via profile favourite: "${template.name}".`,
            });
            continue;
          }
        }
        equipment_modulesToMatch.push(equipment_module);
      }

      if (equipment_modulesToMatch.length === 0) return favouriteMatches;

      const hasContext = templates.some((t) => t.ai_summary || t.documentation);
      if (!hasContext) {
        return [...favouriteMatches, ...matchAssembliesToTemplates(equipment_modulesToMatch, templates, favourites)];
      }

      setLoading(true);
      try {
        const templateList = templates
          .map((t) => {
            const summary = t.ai_summary
              ?? (t.documentation ? t.documentation.slice(0, 300).replace(/\s+/g, " ").trim() + "…" : null)
              ?? "(no summary)";
            return `ID: ${t.id}\nName: ${t.name}\nCategory: ${t.device_category}\nSource: ${t.source}\nSummary: ${summary}`;
          })
          .join("\n\n---\n\n");

        const equipment_moduleList = equipment_modulesToMatch
          .map(
            (a) =>
              `ID: ${a.id}\nType: ${a.equipment_module_type}\nName: ${a.name}\nTag: ${a.tag}\nDescription: ${a.description}\nDevices: ${a.control_module_ids.length} constituent control_modules`,
          )
          .join("\n\n---\n\n");

        const equipment_modulePrompt = `You are a senior PLC project manager assigning Equipment Module Function Block templates to machine equipment_modules.

For each equipment_module, select the BEST matching equipment_module FB template based on the template summaries provided.

Match criteria:
- Does the template's purpose align with this equipment_module type (lift table, conveyor, press, etc.)?
- Does the template coordinate the right kind of control_modules?

Confidence:
- "exact": Template is clearly right for this equipment_module type
- "probable": Template could work with adaptation
- "none": No suitable template — use null for template_id

Respond with ONLY valid JSON (no markdown fences, no explanation):
[{"equipment_module_id":"...","template_id":"..." or null,"confidence":"exact"|"probable"|"none","reason":"one concise sentence"}]`;

        const { content } = await callNonStreaming(
          equipment_modulePrompt,
          [
            {
              role: "user",
              content: `ASSEMBLY TEMPLATES (${templates.length}):\n\n${templateList}\n\n\nASSEMBLIES (${equipment_modulesToMatch.length}):\n\n${equipment_moduleList}`,
            },
          ],
          new AbortController().signal,
          2048,
        );

        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("No JSON array in response");

        const assignments: Array<{
          equipment_module_id: string;
          template_id: string | null;
          confidence: "exact" | "probable" | "none";
          reason: string;
        }> = JSON.parse(jsonMatch[0]);

        const aiResults = equipment_modulesToMatch.map((equipment_module): AssemblyFbMatch => {
          const a = assignments.find((x) => x.equipment_module_id === equipment_module.id);
          if (!a) {
            return { equipment_module, template: null, confidence: "none", reason: "No assignment returned by AI." };
          }
          const template = a.template_id
            ? (templates.find((t) => t.id === a.template_id) ?? null)
            : null;
          return { equipment_module, template, confidence: a.confidence, reason: a.reason };
        });
        return [...favouriteMatches, ...aiResults];
      } catch (err) {
        console.warn("AI equipment_module matching failed, falling back to heuristic:", err);
        return [...favouriteMatches, ...matchAssembliesToTemplates(equipment_modulesToMatch, templates, favourites)];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { match, matchAssemblies, loading };
}
