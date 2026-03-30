/**
 * use-forge-ai-device-match.ts
 * Sends device list + FB template AI summaries to Claude PM.
 * Claude assigns each device to the best matching template.
 * Falls back to heuristic matching if no summaries exist or AI call fails.
 */

import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { matchDevicesToTemplates } from "@/lib/forge-device-matcher";
import type { DeviceFbMatch } from "@/lib/forge-device-matcher";
import type { ForgeDeviceEntry } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

const SYSTEM_PROMPT = `You are a senior PLC project manager assigning Function Block templates to field devices.

For each device, select the BEST matching FB template based on the template summaries provided.

Match criteria:
- Does the template's purpose align with this device type?
- Does the template handle the right kind of IO (discrete, analog, mixed)?
- Is the template designed specifically for this device category?

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
    ): Promise<DeviceFbMatch[]> => {
      if (templates.length === 0) {
        return devices.map((device) => ({
          device,
          template: null,
          confidence: "none" as const,
          reason: "No templates in library.",
        }));
      }

      // If no templates have AI summaries or documentation, fall back to heuristic
      const hasContext = templates.some((t) => t.ai_summary || t.documentation);
      if (!hasContext) {
        return matchDevicesToTemplates(devices, templates);
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

        const deviceList = devices
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
              content: `TEMPLATES (${templates.length}):\n\n${templateList}\n\n\nDEVICES (${devices.length}):\n\n${deviceList}`,
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

        return devices.map((device): DeviceFbMatch => {
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
      } catch (err) {
        console.warn("AI device matching failed, falling back to heuristic:", err);
        return matchDevicesToTemplates(devices, templates);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { match, loading };
}
