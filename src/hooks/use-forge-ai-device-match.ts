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
import type { ForgeDeviceEntry, ForgeAssemblyEntry } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

const SYSTEM_PROMPT = `You are a senior PLC project manager assigning Function Block templates to field devices.

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
[{"device_id":"...","template_id":"..." or null,"confidence":"exact"|"probable"|"none","reason":"one concise sentence"}]`;

export function useForgeAiDeviceMatch() {
  const [loading, setLoading] = useState(false);

  const match = useCallback(
    async (
      devices: ForgeDeviceEntry[],
      templates: FbTemplate[],
      favourites: Record<string, string> = {},
    ): Promise<DeviceFbMatch[]> => {
      if (templates.length === 0) {
        return devices.map((device) => ({
          device,
          template: null,
          confidence: "none" as const,
          reason: "No templates in library.",
        }));
      }

      // Resolve favourites immediately — don't send these to AI
      const favouriteMatches: DeviceFbMatch[] = [];
      const devicesToMatch: ForgeDeviceEntry[] = [];

      for (const device of devices) {
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
        devicesToMatch.push(device);
      }

      if (devicesToMatch.length === 0) return favouriteMatches;

      // If no templates have AI summaries or documentation, fall back to heuristic
      const hasContext = templates.some((t) => t.ai_summary || t.documentation);
      if (!hasContext) {
        return [...favouriteMatches, ...matchDevicesToTemplates(devicesToMatch, templates, favourites)];
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

        const deviceList = devicesToMatch
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
              content: `TEMPLATES (${templates.length}):\n\n${templateList}\n\n\nDEVICES (${devicesToMatch.length}):\n\n${deviceList}`,
            },
          ],
          new AbortController().signal,
          2048,
        );

        // Extract JSON array from response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("No JSON array in response");

        const assignments: Array<{
          device_id: string;
          template_id: string | null;
          confidence: "exact" | "probable" | "none";
          reason: string;
        }> = JSON.parse(jsonMatch[0]);

        const aiResults = devicesToMatch.map((device): DeviceFbMatch => {
          const a = assignments.find((x) => x.device_id === device.id);
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
        return [...favouriteMatches, ...matchDevicesToTemplates(devicesToMatch, templates, favourites)];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const matchAssemblies = useCallback(
    async (
      assemblies: ForgeAssemblyEntry[],
      templates: FbTemplate[],
      favourites: Record<string, string> = {},
    ): Promise<AssemblyFbMatch[]> => {
      if (templates.length === 0) {
        return assemblies.map((assembly) => ({
          assembly,
          template: null,
          confidence: "none" as const,
          reason: "No assembly templates in library.",
        }));
      }

      const favouriteMatches: AssemblyFbMatch[] = [];
      const assembliesToMatch: ForgeAssemblyEntry[] = [];

      for (const assembly of assemblies) {
        const favId = favourites[assembly.assembly_type];
        if (favId) {
          const template = templates.find((t) => t.id === favId) ?? null;
          if (template) {
            favouriteMatches.push({
              assembly,
              template,
              confidence: "exact",
              reason: `Matched via profile favourite: "${template.name}".`,
            });
            continue;
          }
        }
        assembliesToMatch.push(assembly);
      }

      if (assembliesToMatch.length === 0) return favouriteMatches;

      const hasContext = templates.some((t) => t.ai_summary || t.documentation);
      if (!hasContext) {
        return [...favouriteMatches, ...matchAssembliesToTemplates(assembliesToMatch, templates, favourites)];
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

        const assemblyList = assembliesToMatch
          .map(
            (a) =>
              `ID: ${a.id}\nType: ${a.assembly_type}\nName: ${a.name}\nTag: ${a.tag}\nDescription: ${a.description}\nDevices: ${a.device_ids.length} constituent devices`,
          )
          .join("\n\n---\n\n");

        const assemblyPrompt = `You are a senior PLC project manager assigning Assembly Function Block templates to machine assemblies.

For each assembly, select the BEST matching assembly FB template based on the template summaries provided.

Match criteria:
- Does the template's purpose align with this assembly type (lift table, conveyor, press, etc.)?
- Does the template coordinate the right kind of devices?

Confidence:
- "exact": Template is clearly right for this assembly type
- "probable": Template could work with adaptation
- "none": No suitable template — use null for template_id

Respond with ONLY valid JSON (no markdown fences, no explanation):
[{"assembly_id":"...","template_id":"..." or null,"confidence":"exact"|"probable"|"none","reason":"one concise sentence"}]`;

        const { content } = await callNonStreaming(
          assemblyPrompt,
          [
            {
              role: "user",
              content: `ASSEMBLY TEMPLATES (${templates.length}):\n\n${templateList}\n\n\nASSEMBLIES (${assembliesToMatch.length}):\n\n${assemblyList}`,
            },
          ],
          new AbortController().signal,
          2048,
        );

        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("No JSON array in response");

        const assignments: Array<{
          assembly_id: string;
          template_id: string | null;
          confidence: "exact" | "probable" | "none";
          reason: string;
        }> = JSON.parse(jsonMatch[0]);

        const aiResults = assembliesToMatch.map((assembly): AssemblyFbMatch => {
          const a = assignments.find((x) => x.assembly_id === assembly.id);
          if (!a) {
            return { assembly, template: null, confidence: "none", reason: "No assignment returned by AI." };
          }
          const template = a.template_id
            ? (templates.find((t) => t.id === a.template_id) ?? null)
            : null;
          return { assembly, template, confidence: a.confidence, reason: a.reason };
        });
        return [...favouriteMatches, ...aiResults];
      } catch (err) {
        console.warn("AI assembly matching failed, falling back to heuristic:", err);
        return [...favouriteMatches, ...matchAssembliesToTemplates(assembliesToMatch, templates, favourites)];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { match, matchAssemblies, loading };
}
